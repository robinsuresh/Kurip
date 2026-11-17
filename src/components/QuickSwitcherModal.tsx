import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Network, Plus, Search, X } from 'lucide-react';
import { Note } from '../types/vault';

interface QuickSwitcherModalProps {
  isOpen: boolean;
  notes: Note[];
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  onCreateNoteWithTitle: (title: string) => void;
  onOpenGraph: () => void;
}

export const QuickSwitcherModal: React.FC<QuickSwitcherModalProps> = ({
  isOpen,
  notes,
  onClose,
  onSelectNote,
  onCreateNoteWithTitle,
  onOpenGraph,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.folder.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
    );
  }, [notes, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const exactMatch = notes.some(
    (n) => n.title.trim().toLowerCase() === query.trim().toLowerCase()
  );
  const showCreateOption = query.trim().length > 0 && !exactMatch;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = results.length + (showCreateOption ? 1 : 0) - 1;
      setSelectedIndex((i) => Math.min(Math.max(0, max), i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < results.length) {
        onSelectNote(results[selectedIndex].id);
        onClose();
      } else if (showCreateOption) {
        onCreateNoteWithTitle(query.trim());
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[14vh] p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Switcher"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#181B20] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find or create a note…"
            autoFocus
            aria-label="Search notes"
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick switcher"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {results.map((note, idx) => (
            <button
              key={note.id}
              type="button"
              onClick={() => {
                onSelectNote(note.id);
                onClose();
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="truncate font-medium">{note.title}</span>
              </span>
              {note.folder && (
                <span className="ml-3 text-xs text-zinc-400 shrink-0">{note.folder}</span>
              )}
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              onClick={() => {
                onCreateNoteWithTitle(query.trim());
                onClose();
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm cursor-pointer ${
                selectedIndex === results.length
                  ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>Create note “{query.trim()}”</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onOpenGraph();
              onClose();
            }}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-zinc-200/70 dark:border-zinc-800/70 px-3 py-2 text-left text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 cursor-pointer"
          >
            <Network className="h-3.5 w-3.5 shrink-0" />
            <span>Open Knowledge Graph View</span>
          </button>
        </div>
      </div>
    </div>
  );
};
