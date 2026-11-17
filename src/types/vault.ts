export type ViewMode = 'live' | 'source' | 'preview';

export type SyncStatus =
  | 'disconnected'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'error'
  | 'offline';

export interface Note {
  id: string;
  title: string;
  folder: string; // e.g. "" for root, "Projects", "Daily Notes"
  content: string;
  updatedAt: number; // epoch ms
  createdAt: number; // epoch ms
  pinned?: boolean;
  // Google Drive sync metadata
  driveFileId?: string;
  driveModifiedTime?: string; // ISO timestamp from Google Drive
  lastSyncedHash?: string;
  dirty?: boolean; // modified locally since last Drive sync
}

export interface RemoteDriveFile {
  id: string;
  name: string; // e.g. "Welcome to Kurip.md"
  modifiedTime: string;
  md5Checksum?: string;
  appProperties?: {
    kuripId?: string;
    folder?: string;
  };
}

export interface SyncConflict {
  noteId: string;
  noteTitle: string;
  driveFileId: string;
  localContent: string;
  localUpdatedAt: number;
  remoteContent: string;
  remoteModifiedTime: string;
}

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  action: 'push' | 'pull' | 'create' | 'delete' | 'conflict' | 'error';
  message: string;
}

export interface TabItem {
  id: string; // noteId or 'graph'
  type: 'note' | 'graph';
  title: string;
}

export interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  line: number;
}

export interface BacklinkMatch {
  sourceNoteId: string;
  sourceTitle: string;
  sourceFolder: string;
  snippet: string;
  line: number;
  isUnlinkedMention: boolean;
}
