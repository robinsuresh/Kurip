import { Note, RemoteDriveFile, SyncConflict, SyncLogEntry } from '../types/vault';
import { filenameToNoteTitle, hashContent } from './markdown';

export interface SyncPlan {
  toCreateInDrive: Note[];
  toUpdateInDrive: Note[];
  toPullFromDrive: Array<{ remote: RemoteDriveFile; existingLocal?: Note }>;
  unchangedCount: number;
}

export interface UploadedNoteSyncEffect {
  noteId: string;
  driveFileId: string;
  driveModifiedTime: string;
  pushedContent: string;
  pushedTitle: string;
  pushedFolder: string;
  action: 'create' | 'push';
}

export interface PulledNoteSyncEffect {
  existingLocalId?: string;
  remote: RemoteDriveFile;
  remoteContent: string;
}

export interface SyncReconciliationResult {
  nextNotes: Note[];
  detectedConflicts: SyncConflict[];
  createdFolders: string[];
  logs: Array<{ action: SyncLogEntry['action']; message: string }>;
}

/**
 * Plans synchronization actions between local vault notes and Google Drive remote files.
 * Conflict detection happens during pull/download when both local (dirty) and remote changed.
 */
export function buildSyncPlan(localNotes: Note[], remoteFiles: RemoteDriveFile[]): SyncPlan {
  const remoteById = new Map<string, RemoteDriveFile>();
  const remoteByKuripId = new Map<string, RemoteDriveFile>();
  const remoteByTitleLower = new Map<string, RemoteDriveFile>();

  for (const rf of remoteFiles) {
    remoteById.set(rf.id, rf);
    if (rf.appProperties?.kuripId) {
      remoteByKuripId.set(rf.appProperties.kuripId, rf);
    }
    const titleKey = filenameToNoteTitle(rf.name).toLowerCase();
    remoteByTitleLower.set(titleKey, rf);
  }

  const matchedRemoteIds = new Set<string>();
  const toCreateInDrive: Note[] = [];
  const toUpdateInDrive: Note[] = [];
  const toPullFromDrive: Array<{ remote: RemoteDriveFile; existingLocal?: Note }> = [];
  let unchangedCount = 0;

  for (const local of localNotes) {
    const remote =
      (local.driveFileId ? remoteById.get(local.driveFileId) : undefined) ||
      remoteByKuripId.get(local.id) ||
      remoteByTitleLower.get(local.title.trim().toLowerCase());

    if (!remote) {
      toCreateInDrive.push(local);
      continue;
    }

    matchedRemoteIds.add(remote.id);

    const localHash = hashContent(local.content);
    const localChanged = local.dirty || (local.lastSyncedHash !== undefined && local.lastSyncedHash !== localHash);
    const remoteChanged =
      !local.driveModifiedTime ||
      new Date(remote.modifiedTime).getTime() > new Date(local.driveModifiedTime).getTime();

    if (localChanged && remoteChanged && local.driveFileId) {
      // Needs content inspection to determine if conflict or identical content
      toPullFromDrive.push({ remote, existingLocal: local });
    } else if (localChanged) {
      toUpdateInDrive.push({ ...local, driveFileId: remote.id });
    } else if (remoteChanged) {
      toPullFromDrive.push({ remote, existingLocal: local });
    } else {
      unchangedCount++;
    }
  }

  for (const rf of remoteFiles) {
    if (!matchedRemoteIds.has(rf.id)) {
      toPullFromDrive.push({ remote: rf, existingLocal: undefined });
    }
  }

  return {
    toCreateInDrive,
    toUpdateInDrive,
    toPullFromDrive,
    unchangedCount,
  };
}

/**
 * Evaluates whether pulling remote content causes a conflict with a locally dirty note.
 */
export function resolvePullOutcome(
  local: Note | undefined,
  remoteContent: string,
  remote: RemoteDriveFile
):
  | { status: 'create_local'; note: Note }
  | { status: 'update_local'; note: Note }
  | { status: 'already_identical'; note: Note }
  | { status: 'conflict' } {
  const remoteHash = hashContent(remoteContent);
  const remoteTitle = filenameToNoteTitle(remote.name);
  const remoteFolder = remote.appProperties?.folder ?? '';

  if (!local) {
    const now = Date.now();
    return {
      status: 'create_local',
      note: {
        id: remote.appProperties?.kuripId || `note-${remote.id.slice(0, 8)}-${now}`,
        title: remoteTitle,
        folder: remoteFolder,
        content: remoteContent,
        createdAt: new Date(remote.modifiedTime).getTime() || now,
        updatedAt: new Date(remote.modifiedTime).getTime() || now,
        driveFileId: remote.id,
        driveModifiedTime: remote.modifiedTime,
        lastSyncedHash: remoteHash,
        dirty: false,
      },
    };
  }

  const localHash = hashContent(local.content);
  if (localHash === remoteHash && local.title === remoteTitle) {
    return {
      status: 'already_identical',
      note: {
        ...local,
        driveFileId: remote.id,
        driveModifiedTime: remote.modifiedTime,
        lastSyncedHash: remoteHash,
        dirty: false,
      },
    };
  }

  const localIsDirty = Boolean(local.dirty) || (local.lastSyncedHash !== undefined && local.lastSyncedHash !== localHash);
  if (localIsDirty) {
    return { status: 'conflict' };
  }

  return {
    status: 'update_local',
    note: {
      ...local,
      title: remoteTitle,
      folder: remoteFolder || local.folder,
      content: remoteContent,
      updatedAt: new Date(remote.modifiedTime).getTime() || Date.now(),
      driveFileId: remote.id,
      driveModifiedTime: remote.modifiedTime,
      lastSyncedHash: remoteHash,
      dirty: false,
    },
  };
}

/**
 * Merges completed async Google Drive upload/pull results into the latest live `notes`
 * state so any keystrokes, renames, creations, or deletions performed while network
 * requests were in-flight are never reverted to a pre-sync snapshot.
 */
export function reconcileSyncResults(
  latestNotes: Note[],
  effects: {
    uploads: UploadedNoteSyncEffect[];
    pulls: PulledNoteSyncEffect[];
  }
): SyncReconciliationResult {
  const uploadByNoteId = new Map<string, UploadedNoteSyncEffect>();
  for (const u of effects.uploads) {
    uploadByNoteId.set(u.noteId, u);
  }

  const pullByLocalId = new Map<string, PulledNoteSyncEffect>();
  const pullByDriveId = new Map<string, PulledNoteSyncEffect>();
  for (const p of effects.pulls) {
    if (p.existingLocalId) {
      pullByLocalId.set(p.existingLocalId, p);
    }
    pullByDriveId.set(p.remote.id, p);
  }

  const consumedDriveIds = new Set<string>();
  const detectedConflicts: SyncConflict[] = [];
  const createdFolders: string[] = [];
  const logs: SyncReconciliationResult['logs'] = [];

  const nextNotes = latestNotes.map((latest) => {
    let merged = latest;

    const upload = uploadByNoteId.get(latest.id);
    if (upload) {
      const pushedHash = hashContent(upload.pushedContent);
      const editedDuringUpload =
        latest.content !== upload.pushedContent ||
        latest.title !== upload.pushedTitle ||
        latest.folder !== upload.pushedFolder;

      merged = {
        ...latest,
        driveFileId: upload.driveFileId,
        driveModifiedTime: upload.driveModifiedTime,
        lastSyncedHash: pushedHash,
        dirty: editedDuringUpload ? true : false,
      };
      logs.push({
        action: upload.action,
        message:
          upload.action === 'create'
            ? `Uploaded "${upload.pushedTitle}.md" to Google Drive`
            : `Pushed updates for "${upload.pushedTitle}.md"`,
      });
    }

    const pull =
      pullByLocalId.get(merged.id) ||
      (merged.driveFileId ? pullByDriveId.get(merged.driveFileId) : undefined);

    if (pull) {
      consumedDriveIds.add(pull.remote.id);
      const outcome = resolvePullOutcome(merged, pull.remoteContent, pull.remote);
      if (outcome.status === 'conflict') {
        detectedConflicts.push({
          noteId: merged.id,
          noteTitle: merged.title,
          driveFileId: pull.remote.id,
          localContent: merged.content,
          localUpdatedAt: merged.updatedAt,
          remoteContent: pull.remoteContent,
          remoteModifiedTime: pull.remote.modifiedTime,
        });
        logs.push({
          action: 'conflict',
          message: `Conflict detected on "${merged.title}"`,
        });
      } else if (outcome.status === 'update_local') {
        merged = outcome.note;
        logs.push({
          action: 'pull',
          message: `Updated "${outcome.note.title}" from Google Drive`,
        });
      } else if (outcome.status === 'already_identical') {
        merged = outcome.note;
      }
    }

    return merged;
  });

  // Append newly discovered remote-only notes (ignoring any local note deleted mid-sync)
  for (const pull of effects.pulls) {
    if (consumedDriveIds.has(pull.remote.id) || pull.existingLocalId) continue;
    const remoteKuripId = pull.remote.appProperties?.kuripId;
    if (nextNotes.some((n) => n.driveFileId === pull.remote.id || (remoteKuripId && n.id === remoteKuripId))) {
      continue;
    }
    const outcome = resolvePullOutcome(undefined, pull.remoteContent, pull.remote);
    if (outcome.status === 'create_local') {
      nextNotes.push(outcome.note);
      if (outcome.note.folder && !createdFolders.includes(outcome.note.folder)) {
        createdFolders.push(outcome.note.folder);
      }
      logs.push({
        action: 'pull',
        message: `Downloaded "${outcome.note.title}.md" from Google Drive`,
      });
    }
  }

  return {
    nextNotes,
    detectedConflicts,
    createdFolders,
    logs,
  };
}

/**
 * Prevents delayed React renders containing previously emitted local editor content
 * from overwriting newer keystrokes inside CodeMirror, while still applying genuine
 * external changes (remote pulls, conflict resolutions, checkbox toggles).
 */
export function reconcileEditorExternalContent(
  incomingContent: string,
  currentDocContent: string,
  pendingLocalHashes: string[]
): { shouldApply: boolean; nextPendingHashes: string[] } {
  const incomingHash = hashContent(incomingContent);
  const matchIdx = pendingLocalHashes.lastIndexOf(incomingHash);

  if (incomingContent === currentDocContent) {
    return {
      shouldApply: false,
      nextPendingHashes: matchIdx !== -1 ? pendingLocalHashes.slice(matchIdx + 1) : [],
    };
  }

  if (matchIdx !== -1) {
    return {
      shouldApply: false,
      nextPendingHashes: pendingLocalHashes.slice(matchIdx + 1),
    };
  }

  return {
    shouldApply: true,
    nextPendingHashes: [],
  };
}

