import { Note, RemoteDriveFile } from '../types/vault';
import { noteTitleToFilename } from '../utils/markdown';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export class DriveAuthExpiredError extends Error {
  constructor(message = 'Google Drive session expired. Please sign in again.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

async function driveFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Google Drive API error (${res.status}): ${errText}`);
  }
  return res;
}

/**
 * Finds or creates the dedicated Kurip Vault folder in Google Drive.
 */
export async function ensureVaultFolder(token: string, folderName = 'Kurip Vault'): Promise<string> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const query = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`;
  const listUrl = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`;

  const res = await driveFetch(listUrl, token);
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await driveFetch(`${DRIVE_API}/files?fields=id`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        kuripVault: 'true',
      },
    }),
  });

  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Lists all Markdown notes inside the Drive vault folder.
 */
export async function listDriveNotes(token: string, folderId: string): Promise<RemoteDriveFile[]> {
  const query = `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,modifiedTime,md5Checksum,appProperties)&pageSize=200&orderBy=modifiedTime desc`;

  const res = await driveFetch(url, token);
  const data = (await res.json()) as { files?: RemoteDriveFile[] };
  return (data.files || []).filter((f) => f.name.toLowerCase().endsWith('.md'));
}

/**
 * Downloads the raw UTF-8 Markdown content of a Drive file.
 */
export async function downloadDriveNoteContent(token: string, fileId: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, token);
  return await res.text();
}

function buildMultipartBody(metadata: Record<string, unknown>, content: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');
}

/**
 * Uploads a new Markdown note file into the Google Drive vault folder.
 */
export async function createDriveNote(
  token: string,
  folderId: string,
  note: Note
): Promise<{ id: string; modifiedTime: string }> {
  const boundary = `kurip_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: noteTitleToFilename(note.title),
    parents: [folderId],
    mimeType: 'text/markdown',
    appProperties: {
      kuripId: note.id,
      folder: note.folder,
    },
  };

  const body = buildMultipartBody(metadata, note.content, boundary);
  const res = await driveFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,modifiedTime`,
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  return (await res.json()) as { id: string; modifiedTime: string };
}

/**
 * Updates an existing Markdown note's metadata and content in Google Drive.
 */
export async function updateDriveNote(
  token: string,
  fileId: string,
  note: Note
): Promise<{ id: string; modifiedTime: string }> {
  const boundary = `kurip_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: noteTitleToFilename(note.title),
    appProperties: {
      kuripId: note.id,
      folder: note.folder,
    },
  };

  const body = buildMultipartBody(metadata, note.content, boundary);
  const res = await driveFetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,modifiedTime`,
    token,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  return (await res.json()) as { id: string; modifiedTime: string };
}

/**
 * Moves a note to trash in Google Drive (must only be called after explicit user confirmation).
 */
export async function trashDriveNote(token: string, fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/**
 * Gets the initial page token for Google Drive Changes API real-time polling.
 */
export async function getChangesStartPageToken(token: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_API}/changes/startPageToken`, token);
  const data = (await res.json()) as { startPageToken: string };
  return data.startPageToken;
}

/**
 * Checks Google Drive Changes API for any remote changes since `pageToken`.
 */
export async function pollDriveChanges(
  token: string,
  pageToken: string
): Promise<{
  newStartPageToken: string;
  hasChanges: boolean;
  removedFileIds: string[];
}> {
  const url = `${DRIVE_API}/changes?pageToken=${encodeURIComponent(
    pageToken
  )}&fields=newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,trashed,parents))`;

  const res = await driveFetch(url, token);
  const data = (await res.json()) as {
    newStartPageToken?: string;
    nextPageToken?: string;
    changes?: Array<{
      fileId: string;
      removed?: boolean;
      file?: { id: string; name: string; trashed?: boolean; parents?: string[] };
    }>;
  };

  const changes = data.changes || [];
  const removedFileIds = changes
    .filter((c) => c.removed || c.file?.trashed)
    .map((c) => c.fileId);

  return {
    newStartPageToken: data.newStartPageToken || data.nextPageToken || pageToken,
    hasChanges: changes.length > 0,
    removedFileIds,
  };
}
