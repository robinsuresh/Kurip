import React from 'react';
import {
  BookOpen,
  Code2,
  FileText,
  Network,
  PenLine,
  Pin,
  Trash2,
  X,
} from 'lucide-react';
import { Note, TabItem, ViewMode } from '../types/vault';
import { computeNoteStats } from '../utils/markdown';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ObsidianEditor } from './ObsidianEditor';

interface EditorPaneProps {
  tabs: TabItem[];
  activeTabId: string | null;
  activeNote: Note | null;
  allNotes: Note[];
  folders: string[];
  viewMode: ViewMode;
  isDark: boolean;
  scrollToLineRequest?: { line: number; seq: number } | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onUpdateNote: (noteId: string, patch: Partial<Pick<Note, 'title' | 'content' | 'folder' | 'pinned'>>) => void;
  onToggleCheckbox: (noteId: string, lineIndex: number) => void;
  onOpenWikilink: (targetTitle: string) => void;
  onSelectTag: (tag: string) => void;
  onRequestDeleteNote: (note: Note) => void;
  onCreateNote: () => void;
  renderGraphView: () => React.ReactNode;
}

export const EditorPane: React.FC<EditorPaneProps> = ({
  tabs,
  activeTabId,
  activeNote,
  allNotes,
  folders,
  viewMode,
  isDark,
  scrollToLineRequest,
  onSelectTab,
  onCloseTab,
  onChangeViewMode,
  onUpdateNote,
  onToggleCheckbox,
  onOpenWikilink,
  onSelectTag,
  onRequestDeleteNote,
  onCreateNote,
  renderGraphView,
}) => {
  const stats = activeNote
    ? computeNoteStats(activeNote.content)
    : { words: 0, chars: 0, readingMinutes: 0 };

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#111317]">
      {/* Open Tabs Strip */}
      <div
        role="tablist"
        aria-label="Open workspace tabs"
        className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-200 dark:border-zinc-800/90 bg-zinc-50 dark:bg-[#16191E] px-1.5 gap-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex h-7 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors shrink-0 ${
                isActive
                  ? 'bg-white dark:bg-[#111317] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700/80 font-medium'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTab(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate cursor-pointer"
              >
                {tab.type === 'graph' ? (
                  <Network className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                )}
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close tab ${tab.title}`}
                className="rounded p-0.5 text-zinc-400 opacity-60 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Graph View Mode */}
      {activeTabId === 'graph' ? (
        <div className="flex-1 min-h-0">{renderGraphView()}</div>
      ) : !activeNote ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <FileText className="h-10 w-10 text-zinc-400 dark:text-zinc-600 mb-3" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No note open
          </h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Select a note from the explorer, press Ctrl/Cmd+K to jump anywhere, or create a new Markdown note.
          </p>
          <button
            type="button"
            onClick={onCreateNote}
            className="mt-4 rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2 text-sm font-medium text-white transition-colors cursor-pointer"
          >
            Create New Note
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Note Header (Title + Clean Unboxed Metadata + Obsidian Mode Switcher) */}
          <div className="border-b border-zinc-200/70 dark:border-zinc-800/60 px-6 pt-5 pb-3.5">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start justify-between gap-4">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => onUpdateNote(activeNote.id, { title: e.target.value })}
                  placeholder="Untitled Note"
                  aria-label="Note title"
                  className="min-w-0 flex-1 bg-transparent font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none"
                />

                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <div
                    role="group"
                    aria-label="Editor mode"
                    className="flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#16191E] p-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('live')}
                      title="Live Preview (Cmd/Ctrl+E to toggle Reading)"
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        viewMode === 'live'
                          ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <PenLine className="h-3 w-3" />
                      <span>Live Preview</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('source')}
                      title="Source Mode (Raw Markdown)"
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        viewMode === 'source'
                          ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Code2 className="h-3 w-3" />
                      <span>Source</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('preview')}
                      title="Reading View (Cmd/Ctrl+E)"
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        viewMode === 'preview'
                          ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <BookOpen className="h-3 w-3" />
                      <span>Reading</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onUpdateNote(activeNote.id, { pinned: !activeNote.pinned })}
                    aria-label={activeNote.pinned ? 'Unpin note' : 'Pin note'}
                    title={activeNote.pinned ? 'Unpin note' : 'Pin note'}
                    className={`rounded-md p-1.5 transition-colors cursor-pointer ${
                      activeNote.pinned
                        ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                        : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onRequestDeleteNote(activeNote)}
                    aria-label={`Delete '${activeNote.title || 'Untitled'}'`}
                    title="Delete note"
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <label className="flex items-center gap-1.5">
                  <span className="sr-only">Folder</span>
                  <select
                    aria-label="Note folder"
                    value={activeNote.folder}
                    onChange={(e) => onUpdateNote(activeNote.id, { folder: e.target.value })}
                    className="bg-transparent text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-white dark:bg-[#181B20]">
                      Vault Root
                    </option>
                    {folders.map((f) => (
                      <option key={f} value={f} className="bg-white dark:bg-[#181B20]">
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{stats.words} words</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{stats.readingMinutes} min read</span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeNote.driveFileId
                    ? activeNote.dirty
                      ? 'Pending Google Drive push'
                      : 'Synced to Google Drive'
                    : 'Local vault'}
                </span>
              </div>
            </div>
          </div>

          {/* Obsidian Live Preview / Source (CodeMirror 6) OR Reading View */}
          {viewMode === 'preview' ? (
            <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto w-full max-w-3xl pb-24">
                <MarkdownRenderer
                  content={activeNote.content}
                  notes={allNotes}
                  onOpenWikilink={onOpenWikilink}
                  onSelectTag={onSelectTag}
                  onToggleCheckbox={(lineIdx) => onToggleCheckbox(activeNote.id, lineIdx)}
                />
              </div>
            </div>
          ) : (
            <ObsidianEditor
              noteId={activeNote.id}
              content={activeNote.content}
              isLivePreview={viewMode === 'live'}
              isDark={isDark}
              allNotes={allNotes}
              scrollToLineRequest={scrollToLineRequest}
              onChangeContent={(nextMarkdown) =>
                onUpdateNote(activeNote.id, { content: nextMarkdown })
              }
              onOpenWikilink={onOpenWikilink}
              onSelectTag={onSelectTag}
            />
          )}
        </div>
      )}
    </main>
  );
};
