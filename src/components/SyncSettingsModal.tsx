import React, { useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderSync,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react';
import { SyncConflict, SyncStatus } from '../types/vault';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SyncSettingsModalProps {
  isOpen: boolean;
  userEmail: string | null;
  userName: string | null;
  isLoggingIn: boolean;
  authError: string | null;
  vaultFolderName: string;
  driveFolderId: string | null;
  autoSyncEnabled: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  conflicts: SyncConflict[];
  pendingCount: number;
  onClose: () => void;
  onGoogleLogin: () => void;
  onLogout: () => void;
  onRequestToggleAutoSync: (nextEnabled: boolean) => void;
  onRequestManualSync: () => void;
  onRequestResolveConflict: (conflict: SyncConflict, choice: 'local' | 'remote') => void;
}

export const SyncSettingsModal: React.FC<SyncSettingsModalProps> = ({
  isOpen,
  userEmail,
  userName,
  isLoggingIn,
  authError,
  vaultFolderName,
  driveFolderId,
  autoSyncEnabled,
  syncStatus,
  lastSyncedAt,
  lastSyncError,
  conflicts,
  pendingCount,
  onClose,
  onGoogleLogin,
  onLogout,
  onRequestToggleAutoSync,
  onRequestManualSync,
  onRequestResolveConflict,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-sync-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#181B20] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <FolderSync className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="drive-sync-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Google Drive Real-Time Sync
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Store notes as standard .md files inside your Google Drive folder
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive sync settings"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Account Section */}
        <div className="py-5 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Google Account
          </div>

          {!userEmail ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#111317] p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Connect Google Drive
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Sign in to sync your Markdown notes to a dedicated “{vaultFolderName}” folder in Drive.
                </p>
              </div>
              <GoogleSignInButton
                onClick={onGoogleLogin}
                disabled={isLoggingIn}
                label={isLoggingIn ? 'Signing in…' : 'Sign in with Google'}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#111317] p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {userName || userEmail}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {userEmail} · Folder: {vaultFolderName}
                  {driveFolderId ? ` (${driveFolderId.slice(0, 8)}…)` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          )}

          {authError && (
            <p className="text-xs text-red-600 dark:text-red-400">{authError}</p>
          )}
        </div>

        {/* Sync Controls */}
        <div className="py-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Real-Time Background Sync
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Automatically pushes local edits (1.5s debounce) and polls Drive changes every 10s.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSyncEnabled}
              disabled={!userEmail}
              onClick={() => onRequestToggleAutoSync(!autoSyncEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                autoSyncEnabled ? 'bg-violet-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoSyncEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#111317] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              {syncStatus === 'synced' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : syncStatus === 'syncing' ? (
                <RefreshCw className="h-4 w-4 text-violet-500 animate-spin shrink-0" />
              ) : (
                <FolderSync className="h-4 w-4 text-zinc-400 shrink-0" />
              )}
              <span>
                {!userEmail
                  ? 'Local-only mode'
                  : lastSyncedAt
                  ? `Last synced at ${new Date(lastSyncedAt).toLocaleTimeString()}`
                  : 'Connected · Ready for initial sync'}
                {pendingCount > 0 ? ` · ${pendingCount} local change(s) pending` : ''}
              </span>
            </div>

            <button
              type="button"
              disabled={!userEmail || syncStatus === 'syncing'}
              onClick={onRequestManualSync}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3.5 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <span>Sync Vault Now</span>
            </button>
          </div>

          {lastSyncError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              {lastSyncError}
            </div>
          )}
        </div>

        {/* Conflict Resolution Section */}
        {conflicts.length > 0 && (
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span>Resolve {conflicts.length} Sync Conflict(s)</span>
            </div>

            {conflicts.map((conflict) => (
              <div
                key={conflict.noteId}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {conflict.noteTitle}
                  </span>
                  <span className="text-[11px] font-mono text-zinc-500">
                    Drive updated {new Date(conflict.remoteModifiedTime).toLocaleTimeString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111317] p-2.5">
                    <div className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Local Copy
                    </div>
                    <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {conflict.localContent.slice(0, 240)}
                    </pre>
                  </div>
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111317] p-2.5">
                    <div className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Google Drive Copy
                    </div>
                    <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {conflict.remoteContent.slice(0, 240)}
                    </pre>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onRequestResolveConflict(conflict, 'remote')}
                    className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Use Drive Version
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestResolveConflict(conflict, 'local')}
                    className="rounded-md bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                  >
                    Keep Local Version
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
