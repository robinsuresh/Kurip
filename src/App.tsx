import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { SEED_NOTES } from './data/seedVault';
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './services/auth';
import {
  createDriveNote,
  downloadDriveNoteContent,
  DriveAuthExpiredError,
  ensureVaultFolder,
  getChangesStartPageToken,
  listDriveNotes,
  pollDriveChanges,
  trashDriveNote,
  updateDriveNote,
} from './services/driveSync';
import { ConfirmModal } from './components/ConfirmModal';
import { EditorPane } from './components/EditorPane';
import { GraphView } from './components/GraphView';
import { QuickSwitcherModal } from './components/QuickSwitcherModal';
import { RightInspector } from './components/RightInspector';
import { Sidebar } from './components/Sidebar';
import { SyncSettingsModal } from './components/SyncSettingsModal';
import { TopBar } from './components/TopBar';
import {
  Note,
  SyncConflict,
  SyncLogEntry,
  SyncStatus,
  TabItem,
  ViewMode,
} from './types/vault';
import { hashContent, toggleMarkdownCheckbox } from './utils/markdown';
import {
  buildSyncPlan,
  PulledNoteSyncEffect,
  reconcileSyncResults,
  UploadedNoteSyncEffect,
} from './utils/sync';
import { applyDeleteFolder, DeleteFolderMode } from './utils/vaultFolders';

const NOTES_STORAGE_KEY = 'kurip.vault.notes.v1';
const FOLDERS_STORAGE_KEY = 'kurip.vault.folders.v1';
const THEME_STORAGE_KEY = 'kurip.vault.theme.v1';
const VAULT_FOLDER_NAME = 'Kurip Vault';

function loadInitialNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Note[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to deterministic seed vault
  }
  return SEED_NOTES;
}

function loadInitialFolders(notes: Note[]): string[] {
  const fromNotes = new Set<string>(
    notes.map((n) => n.folder).filter((f) => Boolean(f && f.trim()))
  );
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      for (const f of parsed) {
        if (f && f.trim()) fromNotes.add(f);
      }
    }
  } catch {
    // ignore
  }
  return Array.from(fromNotes).sort((a, b) => a.localeCompare(b));
}

interface PendingConfirm {
  title: string;
  description: string;
  items?: string[];
  confirmLabel: string;
  secondaryLabel?: string;
  variant: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
  onSecondary?: () => Promise<void> | void;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>(loadInitialNotes);
  const [folders, setFolders] = useState<string[]>(() => loadInitialFolders(loadInitialNotes()));
  const [tabs, setTabs] = useState<TabItem[]>(() => {
    const initial = loadInitialNotes();
    const first = initial[0];
    return first ? [{ id: first.id, type: 'note', title: first.title }] : [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const initial = loadInitialNotes();
    return initial[0]?.id ?? null;
  });
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [scrollToLineRequest, setScrollToLineRequest] = useState<{
    line: number;
    seq: number;
  } | null>(null);

  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved ? saved === 'dark' : true;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const [isQuickSwitcherOpen, setIsQuickSwitcherOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Google Auth & Drive Sync State
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [changesToken, setChangesToken] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const driveFolderIdRef = useRef<string | null>(driveFolderId);
  driveFolderIdRef.current = driveFolderId;
  const changesTokenRef = useRef<string | null>(changesToken);
  changesTokenRef.current = changesToken;
  const lastLocalEditAtRef = useRef<number>(0);
  const isSyncingRef = useRef(false);
  const pendingResyncRef = useRef(false);
  const autoSyncEnabledRef = useRef(autoSyncEnabled);
  autoSyncEnabledRef.current = autoSyncEnabled;

  const addSyncLog = useCallback((action: SyncLogEntry['action'], message: string) => {
    setSyncLogs((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), action, message },
      ...prev.slice(0, 39),
    ]);
  }, []);

  // Persist theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  // Persist vault notes & folders locally
  useEffect(() => {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsub = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setSyncStatus((prev) => (prev === 'disconnected' ? 'synced' : prev));
      },
      () => {
        setUser(null);
        setAutoSyncEnabled(false);
        setSyncStatus('disconnected');
      }
    );
    return () => unsub();
  }, []);

  // Core Google Drive bi-directional synchronization routine
  const runDriveSync = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    if (isSyncingRef.current) {
      pendingResyncRef.current = true;
      return;
    }

    isSyncingRef.current = true;
    pendingResyncRef.current = false;
    setSyncStatus('syncing');
    setLastSyncError(null);

    try {
      let folderId = driveFolderIdRef.current;
      if (!folderId) {
        folderId = await ensureVaultFolder(token, VAULT_FOLDER_NAME);
        driveFolderIdRef.current = folderId;
        setDriveFolderId(folderId);
      }

      if (!changesTokenRef.current) {
        const startToken = await getChangesStartPageToken(token);
        changesTokenRef.current = startToken;
        setChangesToken(startToken);
      }

      const remoteFiles = await listDriveNotes(token, folderId);
      const plan = buildSyncPlan(notesRef.current, remoteFiles);

      const uploads: UploadedNoteSyncEffect[] = [];
      const pulls: PulledNoteSyncEffect[] = [];

      // 1. Create new notes in Google Drive (capture exact snapshot uploaded)
      for (const note of plan.toCreateInDrive) {
        const pushedContent = note.content;
        const pushedTitle = note.title;
        const pushedFolder = note.folder;
        const created = await createDriveNote(token, folderId, note);
        uploads.push({
          noteId: note.id,
          driveFileId: created.id,
          driveModifiedTime: created.modifiedTime,
          pushedContent,
          pushedTitle,
          pushedFolder,
          action: 'create',
        });
      }

      // 2. Push dirty local edits to Google Drive (capture exact snapshot uploaded)
      for (const note of plan.toUpdateInDrive) {
        if (!note.driveFileId) continue;
        const pushedContent = note.content;
        const pushedTitle = note.title;
        const pushedFolder = note.folder;
        const updated = await updateDriveNote(token, note.driveFileId, note);
        uploads.push({
          noteId: note.id,
          driveFileId: updated.id,
          driveModifiedTime: updated.modifiedTime,
          pushedContent,
          pushedTitle,
          pushedFolder,
          action: 'push',
        });
      }

      // 3. Download remote candidates
      for (const item of plan.toPullFromDrive) {
        const remoteContent = await downloadDriveNoteContent(token, item.remote.id);
        pulls.push({
          existingLocalId: item.existingLocal?.id,
          remote: item.remote,
          remoteContent,
        });
      }

      // Merge completed sync effects against the LIVE notes state so any typing
      // that occurred while network requests were in-flight is never overwritten.
      const latestEvaluation = reconcileSyncResults(notesRef.current, { uploads, pulls });

      if (uploads.length > 0 || pulls.length > 0) {
        setNotes((prev) => reconcileSyncResults(prev, { uploads, pulls }).nextNotes);

        if (latestEvaluation.createdFolders.length > 0) {
          setFolders((prev) => {
            const merged = new Set([...prev, ...latestEvaluation.createdFolders]);
            return Array.from(merged).sort((a, b) => a.localeCompare(b));
          });
        }

        setTabs((prev) =>
          prev.map((t) => {
            if (t.type !== 'note') return t;
            const matched = latestEvaluation.nextNotes.find((n) => n.id === t.id);
            return matched ? { ...t, title: matched.title } : t;
          })
        );

        for (const entry of latestEvaluation.logs) {
          addSyncLog(entry.action, entry.message);
        }
      }

      setConflicts(latestEvaluation.detectedConflicts);
      setLastSyncedAt(Date.now());
      setSyncStatus(latestEvaluation.detectedConflicts.length > 0 ? 'conflict' : 'synced');
    } catch (err: unknown) {
      if (err instanceof DriveAuthExpiredError) {
        clearAccessToken();
        setAutoSyncEnabled(false);
        setSyncStatus('disconnected');
        setLastSyncError(err.message);
        addSyncLog('error', err.message);
      } else {
        const msg = err instanceof Error ? err.message : 'Google Drive sync failed.';
        setSyncStatus('error');
        setLastSyncError(msg);
        addSyncLog('error', msg);
      }
    } finally {
      isSyncingRef.current = false;
      if (
        pendingResyncRef.current &&
        autoSyncEnabledRef.current &&
        getAccessToken() &&
        notesRef.current.some((n) => n.dirty)
      ) {
        pendingResyncRef.current = false;
        window.setTimeout(() => {
          void runDriveSync();
        }, 1500);
      }
    }
  }, [addSyncLog]);

  // Debounced auto-push on local edits when Real-Time Sync is enabled
  useEffect(() => {
    if (!autoSyncEnabled || !user || !getAccessToken()) return;
    const hasDirty = notes.some((n) => n.dirty);
    if (!hasDirty) return;

    const timer = window.setTimeout(() => {
      void runDriveSync();
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [notes, autoSyncEnabled, user, runDriveSync]);

  // Real-Time Google Drive Changes API polling loop (every 10s)
  useEffect(() => {
    if (!autoSyncEnabled || !user || !getAccessToken()) return;

    const interval = window.setInterval(async () => {
      const token = getAccessToken();
      if (!token || isSyncingRef.current) return;

      try {
        const activeToken = changesTokenRef.current;
        if (!activeToken) {
          if (Date.now() - lastLocalEditAtRef.current >= 1500) {
            await runDriveSync();
          }
          return;
        }
        const delta = await pollDriveChanges(token, activeToken);
        changesTokenRef.current = delta.newStartPageToken;
        setChangesToken(delta.newStartPageToken);
        if (delta.hasChanges && Date.now() - lastLocalEditAtRef.current >= 1500) {
          await runDriveSync();
        }
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          clearAccessToken();
          setAutoSyncEnabled(false);
          setSyncStatus('disconnected');
        }
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [autoSyncEnabled, user, runDriveSync]);

  // Note & Tab Actions
  const openNoteInTab = useCallback(
    (noteId: string) => {
      const target = notesRef.current.find((n) => n.id === noteId);
      if (!target) return;

      setTabs((prev) => {
        if (prev.some((t) => t.id === noteId)) return prev;
        return [...prev, { id: noteId, type: 'note', title: target.title }];
      });
      setActiveTabId(noteId);
    },
    []
  );

  const openGraphTab = useCallback(() => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === 'graph')) return prev;
      return [...prev, { id: 'graph', type: 'graph', title: 'Knowledge Graph' }];
    });
    setActiveTabId('graph');
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, idx - 1)] || next[0] || null;
          setActiveTabId(fallback ? fallback.id : null);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const createNewNote = useCallback(
    (folder = '', initialTitle?: string) => {
      const now = Date.now();
      const baseTitle = initialTitle?.trim() || `Untitled Note ${notesRef.current.length + 1}`;
      const newNote: Note = {
        id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title: baseTitle,
        folder,
        content: '',
        createdAt: now,
        updatedAt: now,
        dirty: true,
      };
      setNotes((prev) => [newNote, ...prev]);
      setTabs((prev) => [...prev, { id: newNote.id, type: 'note', title: newNote.title }]);
      setActiveTabId(newNote.id);
    },
    []
  );

  const createFolder = useCallback((folderName: string) => {
    setFolders((prev) => (prev.includes(folderName) ? prev : [...prev, folderName].sort()));
  }, []);

  const updateNote = useCallback(
    (noteId: string, patch: Partial<Pick<Note, 'title' | 'content' | 'folder' | 'pinned'>>) => {
      lastLocalEditAtRef.current = Date.now();
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n;
          return {
            ...n,
            ...patch,
            updatedAt: Date.now(),
            dirty: true,
          };
        })
      );

      if (patch.title !== undefined) {
        setTabs((prev) =>
          prev.map((t) => (t.id === noteId ? { ...t, title: patch.title || 'Untitled' } : t))
        );
      }
    },
    []
  );

  const handleToggleCheckbox = useCallback((noteId: string, lineIndex: number) => {
    lastLocalEditAtRef.current = Date.now();
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              content: toggleMarkdownCheckbox(n.content, lineIndex),
              updatedAt: Date.now(),
              dirty: true,
            }
          : n
      )
    );
  }, []);


  const handleOpenWikilink = useCallback(
    (targetTitle: string) => {
      const existing = notesRef.current.find(
        (n) => n.title.trim().toLowerCase() === targetTitle.trim().toLowerCase()
      );
      if (existing) {
        openNoteInTab(existing.id);
      } else {
        createNewNote('', targetTitle);
      }
    },
    [openNoteInTab, createNewNote]
  );

  // Destructive Folder Deletion (with explicit confirmation and option to keep notes at root)
  const requestDeleteFolder = useCallback(
    (folderName: string) => {
      const folderNotes = notesRef.current.filter((n) => n.folder === folderName);
      const hasNotes = folderNotes.length > 0;
      const syncedNotes = folderNotes.filter((n) => Boolean(n.driveFileId && getAccessToken()));

      const executeDelete = async (mode: DeleteFolderMode) => {
        if (mode === 'delete-notes') {
          const token = getAccessToken();
          if (token) {
            for (const note of folderNotes) {
              if (!note.driveFileId) continue;
              try {
                await trashDriveNote(token, note.driveFileId);
                addSyncLog('delete', `Moved "${note.title}.md" to Google Drive Trash`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to trash file in Drive';
                addSyncLog('error', msg);
              }
            }
          }
        }

        const result = applyDeleteFolder({
          notes: notesRef.current,
          folders,
          tabs,
          activeTabId,
          folderName,
          mode,
        });

        setNotes(result.nextNotes);
        setFolders(result.nextFolders);
        setTabs(result.nextTabs);
        setActiveTabId(result.nextActiveTabId);
        setPendingConfirm(null);
      };

      setPendingConfirm({
        title: `Delete folder "${folderName}"?`,
        description: hasNotes
          ? syncedNotes.length > 0
            ? `This folder contains ${folderNotes.length} note${
                folderNotes.length === 1 ? '' : 's'
              }. You can move ${
                folderNotes.length === 1 ? 'it' : 'them'
              } to Vault Root or permanently delete the folder and its notes (including Google Drive copies).`
            : `This folder contains ${folderNotes.length} note${
                folderNotes.length === 1 ? '' : 's'
              }. You can move ${
                folderNotes.length === 1 ? 'it' : 'them'
              } to Vault Root or delete the folder along with ${
                folderNotes.length === 1 ? 'its note' : 'its notes'
              }.`
          : 'This empty folder will be removed from your vault.',
        items: hasNotes
          ? folderNotes.map((n) => `${folderName}/${n.title || 'Untitled'}.md`)
          : undefined,
        confirmLabel: hasNotes
          ? `Delete Folder & ${folderNotes.length} ${folderNotes.length === 1 ? 'Note' : 'Notes'}`
          : 'Delete Folder',
        secondaryLabel: hasNotes ? 'Move Notes to Root' : undefined,
        variant: 'danger',
        onConfirm: () => executeDelete('delete-notes'),
        onSecondary: hasNotes ? () => executeDelete('move-to-root') : undefined,
      });
    },
    [folders, tabs, activeTabId, addSyncLog]
  );

  // Destructive Note Deletion (MANDATORY explicit confirmation before deleting locally or in Drive)
  const requestDeleteNote = useCallback(
    (note: Note) => {
      const isSynced = Boolean(note.driveFileId && getAccessToken());
      setPendingConfirm({
        title: `Delete "${note.title || 'Untitled'}"?`,
        description: isSynced
          ? 'This will permanently remove the note from your local vault and move its Markdown file to Trash in Google Drive.'
          : 'This will remove the note from your local vault. This action cannot be undone.',
        items: [`${note.folder ? `${note.folder}/` : ''}${note.title || 'Untitled'}.md`],
        confirmLabel: isSynced ? 'Delete from Vault & Drive' : 'Delete Note',
        variant: 'danger',
        onConfirm: async () => {
          const token = getAccessToken();
          if (note.driveFileId && token) {
            try {
              await trashDriveNote(token, note.driveFileId);
              addSyncLog('delete', `Moved "${note.title}.md" to Google Drive Trash`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to trash file in Drive';
              addSyncLog('error', msg);
            }
          }
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
          closeTab(note.id);
          setPendingConfirm(null);
        },
      });
    },
    [closeTab, addSyncLog]
  );

  // Google Auth Handlers
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setSyncStatus('synced');
        // Prompt user confirmation before writing/updating files in Google Drive
        setPendingConfirm({
          title: 'Sync Vault with Google Drive?',
          description: `You are signed in as ${
            res.user.email || 'Google user'
          }. Enabling sync will create/update your Markdown notes inside the "${VAULT_FOLDER_NAME}" folder on Google Drive.`,
          items: notesRef.current.map((n) => `${n.title}.md`),
          confirmLabel: 'Enable Real-Time Sync',
          variant: 'primary',
          onConfirm: async () => {
            setPendingConfirm(null);
            setAutoSyncEnabled(true);
            await runDriveSync();
          },
        });
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setAutoSyncEnabled(false);
    driveFolderIdRef.current = null;
    changesTokenRef.current = null;
    setDriveFolderId(null);
    setChangesToken(null);
    setSyncStatus('disconnected');
  };

  const requestToggleAutoSync = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      setAutoSyncEnabled(false);
      return;
    }
    setPendingConfirm({
      title: 'Enable Real-Time Google Drive Sync?',
      description: `Kurip will automatically upload local edits and download remote changes inside your "${VAULT_FOLDER_NAME}" Google Drive folder.`,
      items: notesRef.current.filter((n) => n.dirty || !n.driveFileId).map((n) => `${n.title}.md`),
      confirmLabel: 'Enable & Sync Now',
      variant: 'primary',
      onConfirm: async () => {
        setPendingConfirm(null);
        setAutoSyncEnabled(true);
        await runDriveSync();
      },
    });
  };

  const requestManualSync = () => {
    const dirtyNotes = notesRef.current.filter((n) => n.dirty || !n.driveFileId);
    if (dirtyNotes.length === 0) {
      void runDriveSync();
      return;
    }
    setPendingConfirm({
      title: `Sync ${dirtyNotes.length} Note(s) to Google Drive?`,
      description: `This will create or update the following Markdown files inside your "${VAULT_FOLDER_NAME}" Google Drive folder.`,
      items: dirtyNotes.map((n) => `${n.title}.md`),
      confirmLabel: 'Sync Vault Now',
      variant: 'primary',
      onConfirm: async () => {
        setPendingConfirm(null);
        await runDriveSync();
      },
    });
  };

  const requestResolveConflict = (conflict: SyncConflict, choice: 'local' | 'remote') => {
    setPendingConfirm({
      title:
        choice === 'local'
          ? `Overwrite Google Drive copy of "${conflict.noteTitle}"?`
          : `Overwrite local note "${conflict.noteTitle}" with Google Drive copy?`,
      description:
        choice === 'local'
          ? 'Your local Markdown content will overwrite the file currently stored in Google Drive.'
          : 'Your unsynced local edits will be replaced by the latest revision from Google Drive.',
      confirmLabel: choice === 'local' ? 'Overwrite Drive File' : 'Overwrite Local Note',
      variant: 'danger',
      onConfirm: async () => {
        setPendingConfirm(null);
        const token = getAccessToken();
        if (choice === 'local') {
          const target = notesRef.current.find((n) => n.id === conflict.noteId);
          if (target && token) {
            const updated = await updateDriveNote(token, conflict.driveFileId, target);
            const contentHash = hashContent(target.content);
            setNotes((prev) =>
              prev.map((n) =>
                n.id === target.id
                  ? {
                      ...n,
                      driveModifiedTime: updated.modifiedTime,
                      lastSyncedHash: contentHash,
                      dirty: false,
                    }
                  : n
              )
            );
            addSyncLog('push', `Resolved conflict for "${target.title}" using local copy`);
          }
        } else {
          const remoteHash = hashContent(conflict.remoteContent);
          setNotes((prev) =>
            prev.map((n) =>
              n.id === conflict.noteId
                ? {
                    ...n,
                    content: conflict.remoteContent,
                    updatedAt: new Date(conflict.remoteModifiedTime).getTime() || Date.now(),
                    driveModifiedTime: conflict.remoteModifiedTime,
                    lastSyncedHash: remoteHash,
                    dirty: false,
                  }
                : n
            )
          );
          addSyncLog('pull', `Resolved conflict for "${conflict.noteTitle}" using Google Drive copy`);
        }
        setConflicts((prev) => prev.filter((c) => c.noteId !== conflict.noteId));
        setSyncStatus('synced');
      },
    });
  };

  // Global keyboard shortcuts (Cmd/Ctrl+K, Cmd/Ctrl+N, Cmd/Ctrl+E)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsQuickSwitcherOpen((v) => !v);
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNewNote('');
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'preview' ? 'live' : 'preview'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNewNote]);

  const activeNote = useMemo(() => {
    if (!activeTabId || activeTabId === 'graph') return null;
    return notes.find((n) => n.id === activeTabId) || null;
  }, [notes, activeTabId]);

  const pendingSyncCount = useMemo(
    () => notes.filter((n) => n.dirty || !n.driveFileId).length,
    [notes]
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-50 dark:bg-[#111317] text-zinc-900 dark:text-[#E8EAED]">
      <TopBar
        vaultName="Kurip"
        activeFolder={activeNote?.folder || ''}
        activeTitle={
          activeTabId === 'graph' ? 'Knowledge Graph' : activeNote?.title || 'No Note Open'
        }
        isSidebarOpen={isSidebarOpen}
        isInspectorOpen={isInspectorOpen}
        isDark={isDark}
        syncStatus={syncStatus}
        userEmail={user?.email ?? null}
        lastSyncedAt={lastSyncedAt}
        conflictCount={conflicts.length}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        onToggleInspector={() => setIsInspectorOpen((v) => !v)}
        onToggleTheme={() => setIsDark((v) => !v)}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isSidebarOpen && (
          <Sidebar
            notes={notes}
            folders={folders}
            activeNoteId={activeNote?.id ?? null}
            activeTabId={activeTabId}
            selectedTag={selectedTag}
            onSelectNote={openNoteInTab}
            onCreateNote={(folder) => createNewNote(folder || '')}
            onCreateFolder={createFolder}
            onRequestDeleteFolder={requestDeleteFolder}
            onRequestDeleteNote={requestDeleteNote}
            onOpenGraph={openGraphTab}
            onOpenQuickSwitcher={() => setIsQuickSwitcherOpen(true)}
            onSelectTag={setSelectedTag}
          />
        )}

        <EditorPane
          tabs={tabs}
          activeTabId={activeTabId}
          activeNote={activeNote}
          allNotes={notes}
          folders={folders}
          viewMode={viewMode}
          isDark={isDark}
          scrollToLineRequest={scrollToLineRequest}
          onSelectTab={(id) => setActiveTabId(id)}
          onCloseTab={closeTab}
          onChangeViewMode={setViewMode}
          onUpdateNote={updateNote}
          onToggleCheckbox={handleToggleCheckbox}
          onOpenWikilink={handleOpenWikilink}
          onSelectTag={(tag) => setSelectedTag(tag)}
          onRequestDeleteNote={requestDeleteNote}
          onCreateNote={() => createNewNote('')}
          renderGraphView={() => (
            <GraphView
              notes={notes}
              activeNoteId={activeNote?.id ?? null}
              isDark={isDark}
              onSelectNote={openNoteInTab}
            />
          )}
        />

        {isInspectorOpen && (
          <RightInspector
            activeNote={activeNote}
            allNotes={notes}
            syncLogs={syncLogs}
            onSelectNote={openNoteInTab}
            onOpenWikilink={handleOpenWikilink}
            onJumpToLine={(line) =>
              setScrollToLineRequest((prev) => ({ line, seq: (prev?.seq ?? 0) + 1 }))
            }
          />
        )}
      </div>

      <QuickSwitcherModal
        isOpen={isQuickSwitcherOpen}
        notes={notes}
        onClose={() => setIsQuickSwitcherOpen(false)}
        onSelectNote={openNoteInTab}
        onCreateNoteWithTitle={(title) => createNewNote('', title)}
        onOpenGraph={openGraphTab}
      />

      <SyncSettingsModal
        isOpen={isSyncModalOpen}
        userEmail={user?.email ?? null}
        userName={user?.displayName ?? null}
        isLoggingIn={isLoggingIn}
        authError={authError}
        vaultFolderName={VAULT_FOLDER_NAME}
        driveFolderId={driveFolderId}
        autoSyncEnabled={autoSyncEnabled}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
        lastSyncError={lastSyncError}
        conflicts={conflicts}
        pendingCount={pendingSyncCount}
        onClose={() => setIsSyncModalOpen(false)}
        onGoogleLogin={handleGoogleLogin}
        onLogout={handleLogout}
        onRequestToggleAutoSync={requestToggleAutoSync}
        onRequestManualSync={requestManualSync}
        onRequestResolveConflict={requestResolveConflict}
      />

      <ConfirmModal
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || ''}
        description={pendingConfirm?.description || ''}
        items={pendingConfirm?.items}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        secondaryLabel={pendingConfirm?.secondaryLabel}
        variant={pendingConfirm?.variant || 'primary'}
        onConfirm={() => {
          void pendingConfirm?.onConfirm();
        }}
        onSecondary={
          pendingConfirm?.onSecondary
            ? () => {
                void pendingConfirm.onSecondary?.();
              }
            : undefined
        }
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
