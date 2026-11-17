import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { SyncStatus } from '../types/vault';

interface TopBarProps {
  vaultName: string;
  activeFolder: string;
  activeTitle: string;
  isSidebarOpen: boolean;
  isInspectorOpen: boolean;
  isDark: boolean;
  syncStatus: SyncStatus;
  userEmail: string | null;
  lastSyncedAt: number | null;
  conflictCount: number;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onToggleTheme: () => void;
  onOpenSyncModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  vaultName,
  activeFolder,
  activeTitle,
  isSidebarOpen,
  isInspectorOpen,
  isDark,
  syncStatus,
  userEmail,
  lastSyncedAt,
  conflictCount,
  onToggleSidebar,
  onToggleInspector,
  onToggleTheme,
  onOpenSyncModal,
}) => {
  const renderSyncLabel = () => {
    if (!userEmail) {
      return (
        <>
          <CloudOff className="h-3.5 w-3.5 text-zinc-400" />
          <span>Connect Google Drive</span>
        </>
      );
    }
    if (conflictCount > 0 || syncStatus === 'conflict') {
      return (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          <span>{conflictCount} Sync Conflict{conflictCount === 1 ? '' : 's'}</span>
        </>
      );
    }
    if (syncStatus === 'syncing') {
      return (
        <>
          <RefreshCw className="h-3.5 w-3.5 text-violet-500 animate-spin" />
          <span>Syncing Drive…</span>
        </>
      );
    }
    if (syncStatus === 'error') {
      return (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          <span>Sync Error</span>
        </>
      );
    }
    if (syncStatus === 'synced') {
      const timeStr = lastSyncedAt
        ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Ready';
      return (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>Drive Synced · {timeStr}</span>
        </>
      );
    }
    return (
      <>
        <Cloud className="h-3.5 w-3.5 text-violet-500" />
        <span>Google Drive Ready</span>
      </>
    );
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-[#14171C] px-3">
      {/* Left: Brand & Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Collapse file explorer' : 'Expand file explorer'}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <span className="font-display text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap shrink-0">
          {vaultName}
        </span>

        <nav
          aria-label="Note breadcrumb"
          className="hidden sm:flex min-w-0 items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
        >
          <span aria-hidden="true">/</span>
          {activeFolder && (
            <>
              <span className="truncate max-w-[140px]">{activeFolder}</span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span className="truncate max-w-[240px] text-zinc-800 dark:text-zinc-200 font-medium">
            {activeTitle}
          </span>
        </nav>
      </div>

      {/* Right: Sync Status + Theme + Inspector */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenSyncModal}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-[#1B1F26] px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {renderSyncLabel()}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onToggleInspector}
          aria-label={isInspectorOpen ? 'Hide right inspector' : 'Show right inspector'}
          title="Backlinks & Outline"
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
