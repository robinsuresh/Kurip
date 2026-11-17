import { Note, TabItem } from '../types/vault';

export type DeleteFolderMode = 'delete-notes' | 'move-to-root';

export interface DeleteFolderParams {
  notes: Note[];
  folders: string[];
  tabs: TabItem[];
  activeTabId: string | null;
  folderName: string;
  mode: DeleteFolderMode;
  now?: number;
}

export interface DeleteFolderResult {
  nextNotes: Note[];
  nextFolders: string[];
  nextTabs: TabItem[];
  nextActiveTabId: string | null;
  removedNotes: Note[];
}

/**
 * Pure state transition for deleting a folder from the vault, either deleting
 * its contained notes (and closing their tabs) or moving them to vault root.
 */
export function applyDeleteFolder({
  notes,
  folders,
  tabs,
  activeTabId,
  folderName,
  mode,
  now = Date.now(),
}: DeleteFolderParams): DeleteFolderResult {
  const nextFolders = folders.filter((f) => f !== folderName);

  if (mode === 'move-to-root') {
    const nextNotes = notes.map((n) =>
      n.folder === folderName
        ? { ...n, folder: '', updatedAt: now, dirty: true }
        : n
    );
    return {
      nextNotes,
      nextFolders,
      nextTabs: tabs,
      nextActiveTabId: activeTabId,
      removedNotes: [],
    };
  }

  const removedNotes: Note[] = [];
  const nextNotes: Note[] = [];
  for (const n of notes) {
    if (n.folder === folderName) {
      removedNotes.push(n);
    } else {
      nextNotes.push(n);
    }
  }

  const removedIds = new Set(removedNotes.map((n) => n.id));
  const oldActiveIdx = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;
  const nextTabs = tabs.filter((t) => !removedIds.has(t.id));

  let nextActiveTabId = activeTabId;
  if (activeTabId && removedIds.has(activeTabId)) {
    const fallbackIdx = Math.max(0, Math.min(oldActiveIdx, nextTabs.length - 1));
    nextActiveTabId = nextTabs[fallbackIdx]?.id ?? null;
  }

  return {
    nextNotes,
    nextFolders,
    nextTabs,
    nextActiveTabId,
    removedNotes,
  };
}
