import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Network,
  Pin,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Note } from '../types/vault';
import { extractTags } from '../utils/markdown';

interface SidebarProps {
  notes: Note[];
  folders: string[];
  activeNoteId: string | null;
  activeTabId: string | null;
  selectedTag: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: (folder?: string) => void;
  onCreateFolder: (folderName: string) => void;
  onRequestDeleteFolder: (folderName: string) => void;
  onRequestDeleteNote: (note: Note) => void;
  onOpenGraph: () => void;
  onOpenQuickSwitcher: () => void;
  onSelectTag: (tag: string | null) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  notes,
  folders,
  activeNoteId,
  activeTabId,
  selectedTag,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRequestDeleteFolder,
  onRequestDeleteNote,
  onOpenGraph,
  onOpenQuickSwitcher,
  onSelectTag,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    Engineering: true,
    'Daily Notes': true,
    Research: true,
  });
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of extractTags(note.content)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (!selectedTag) return notes;
    return notes.filter((n) => extractTags(n.content).includes(selectedTag));
  }, [notes, selectedTag]);

  const folderGroups = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const f of folders) {
      map.set(f, []);
    }
    const rootNotes: Note[] = [];

    for (const note of filteredNotes) {
      if (!note.folder) {
        rootNotes.push(note);
      } else {
        const list = map.get(note.folder) || [];
        list.push(note);
        map.set(note.folder, list);
      }
    }

    const sortNotes = (arr: Note[]) =>
      [...arr].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return a.title.localeCompare(b.title);
      });

    return {
      rootNotes: sortNotes(rootNotes),
      folders: Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, items]) => [name, sortNotes(items)] as const),
    };
  }, [filteredNotes, folders]);

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
  };

  const handleFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (trimmed) {
      onCreateFolder(trimmed);
      setExpandedFolders((prev) => ({ ...prev, [trimmed]: true }));
    }
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const renderNoteRow = (note: Note, nested = false) => {
    const isActive = activeTabId !== 'graph' && activeNoteId === note.id;
    return (
      <div
        key={note.id}
        className={`group flex items-center justify-between gap-1 rounded-md py-1.5 pr-1.5 transition-colors ${
          nested ? 'pl-6' : 'pl-2.5'
        } ${
          isActive
            ? 'bg-violet-500/12 text-violet-700 dark:bg-violet-500/18 dark:text-violet-300 font-medium'
            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectNote(note.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] cursor-pointer"
        >
          <FileText
            className={`h-3.5 w-3.5 shrink-0 ${
              isActive ? 'text-violet-600 dark:text-violet-400' : 'text-zinc-400 dark:text-zinc-500'
            }`}
          />
          <span className="truncate">{note.title || 'Untitled'}</span>
          {note.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" aria-label="Pinned note" />
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {note.dirty && (
            <span
              className="text-[10px] font-mono text-amber-600 dark:text-amber-400 px-1"
              title="Unsynced local edits"
            >
              *
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDeleteNote(note);
            }}
            aria-label={`Delete '${note.title || 'Untitled'}'`}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Vault Explorer"
      className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800/90 bg-zinc-100/80 dark:bg-[#16191E] select-none"
    >
      {/* Vault Quick Actions */}
      <div className="p-3 space-y-2 border-b border-zinc-200 dark:border-zinc-800/90">
        <button
          type="button"
          onClick={onOpenQuickSwitcher}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-[#111317] px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            <span>Quick Switcher</span>
          </span>
          <kbd className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">⌘K</kbd>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCreateNote('')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>New Note</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingFolder((v) => !v)}
            aria-label="New Folder"
            title="New Folder"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-[#1C2027] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenGraph}
            aria-label="Open Knowledge Graph"
            title="Knowledge Graph"
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors shrink-0 cursor-pointer ${
              activeTabId === 'graph'
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                : 'border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-[#1C2027] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
          </button>
        </div>

        {isCreatingFolder && (
          <form onSubmit={handleFolderSubmit} className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              autoFocus
              aria-label="New folder name"
              className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#111317] px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-2.5 py-1 text-xs font-medium text-white dark:text-zinc-900"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* Active Tag Filter Banner */}
      {selectedTag && (
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/90 bg-violet-500/10 px-3 py-1.5 text-xs">
          <span className="font-mono text-violet-700 dark:text-violet-300 truncate">
            Filtering: #{selectedTag}
          </span>
          <button
            type="button"
            onClick={() => onSelectTag(null)}
            aria-label="Clear tag filter"
            className="rounded p-0.5 text-violet-600 dark:text-violet-300 hover:bg-violet-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-1">
        <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          <span>Vault Files</span>
          <span className="font-mono tabular-nums">{filteredNotes.length}</span>
        </div>

        {folderGroups.folders.map(([folderName, folderNotes]) => {
          const isExpanded = expandedFolders[folderName] ?? true;
          return (
            <div key={folderName} className="space-y-0.5">
              <div className="group flex items-center justify-between rounded-md px-1.5 py-1 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70">
                <button
                  type="button"
                  onClick={() => toggleFolder(folderName)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  )}
                  <span className="truncate">{folderName}</span>
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateNote(folderName);
                    }}
                    aria-label={`New note in ${folderName}`}
                    title={`New note in ${folderName}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-1 text-zinc-400 hover:text-violet-500 transition-opacity cursor-pointer"
                  >
                    <FilePlus2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDeleteFolder(folderName);
                    }}
                    aria-label={`Delete folder '${folderName}'`}
                    title={`Delete folder '${folderName}'`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 transition-opacity cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="space-y-0.5">
                  {folderNotes.length > 0 ? (
                    folderNotes.map((n) => renderNoteRow(n, true))
                  ) : (
                    <div className="pl-7 py-1 text-[11px] text-zinc-400 dark:text-zinc-500 italic">
                      Empty folder
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {folderGroups.rootNotes.map((n) => renderNoteRow(n, false))}

        {filteredNotes.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400 space-y-2">
            <p>No notes match the current filter.</p>
            <button
              type="button"
              onClick={() => (selectedTag ? onSelectTag(null) : onCreateNote(''))}
              className="text-violet-600 dark:text-violet-400 font-medium hover:underline"
            >
              {selectedTag ? 'Clear tag filter' : 'Create your first note'}
            </button>
          </div>
        )}
      </div>

      {/* Tags Index (Clean unboxed typography, zero pills) */}
      {allTags.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800/90 px-3 py-2.5 max-h-40 overflow-y-auto">
          <div className="flex items-center gap-1.5 pb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            <Hash className="h-3 w-3" />
            <span>Tags</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {allTags.map(([tag, count]) => {
              const active = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSelectTag(active ? null : tag)}
                  className={`text-xs font-mono transition-colors cursor-pointer ${
                    active
                      ? 'text-violet-600 dark:text-violet-400 font-semibold underline underline-offset-4'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  #{tag} <span className="text-zinc-400 dark:text-zinc-500 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
