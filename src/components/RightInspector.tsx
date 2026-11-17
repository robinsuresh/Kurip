import React, { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Link2, ListTree } from 'lucide-react';
import { Note, SyncLogEntry } from '../types/vault';
import { computeBacklinks, extractHeadings, extractWikilinks } from '../utils/markdown';

interface RightInspectorProps {
  activeNote: Note | null;
  allNotes: Note[];
  syncLogs: SyncLogEntry[];
  onSelectNote: (noteId: string) => void;
  onOpenWikilink: (targetTitle: string) => void;
  onJumpToLine?: (line: number) => void;
}

type InspectorTab = 'backlinks' | 'outline' | 'sync';

export const RightInspector: React.FC<RightInspectorProps> = ({
  activeNote,
  allNotes,
  syncLogs,
  onSelectNote,
  onOpenWikilink,
  onJumpToLine,
}) => {
  const [tab, setTab] = useState<InspectorTab>('backlinks');

  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return computeBacklinks(activeNote, allNotes);
  }, [activeNote, allNotes]);

  const outgoingLinks = useMemo(() => {
    if (!activeNote) return [];
    return extractWikilinks(activeNote.content);
  }, [activeNote]);

  const headings = useMemo(() => {
    if (!activeNote) return [];
    return extractHeadings(activeNote.content);
  }, [activeNote]);

  const linkedBacklinks = backlinks.filter((b) => !b.isUnlinkedMention);
  const unlinkedMentions = backlinks.filter((b) => b.isUnlinkedMention);

  return (
    <aside
      aria-label="Note Inspector"
      className="flex h-full w-64 shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800/90 bg-zinc-50/70 dark:bg-[#16191E]"
    >
      {/* Inspector Tabs */}
      <div
        role="tablist"
        aria-label="Inspector sections"
        className="flex h-9 shrink-0 items-center border-b border-zinc-200 dark:border-zinc-800/90 px-2 gap-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'backlinks'}
          onClick={() => setTab('backlinks')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
            tab === 'backlinks'
              ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <Link2 className="h-3.5 w-3.5" />
          <span>Links</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'outline'}
          onClick={() => setTab('outline')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
            tab === 'outline'
              ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <ListTree className="h-3.5 w-3.5" />
          <span>Outline</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sync'}
          onClick={() => setTab('sync')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors cursor-pointer ${
            tab === 'sync'
              ? 'bg-white dark:bg-[#22262E] text-zinc-900 dark:text-zinc-100 shadow-xs'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Sync Log</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {tab === 'backlinks' && (
          <>
            {!activeNote ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Open a note to inspect linked mentions and outgoing wikilinks.
              </p>
            ) : (
              <>
                <section>
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                    <span>Linked Mentions</span>
                    <span className="font-mono tabular-nums">{linkedBacklinks.length}</span>
                  </div>
                  {linkedBacklinks.length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      No other notes link to this note yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {linkedBacklinks.map((item, idx) => (
                        <button
                          key={`${item.sourceNoteId}-${idx}`}
                          type="button"
                          onClick={() => onSelectNote(item.sourceNoteId)}
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111317] p-2.5 text-left hover:border-violet-500/40 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                            <span className="truncate">{item.sourceTitle}</span>
                            <ArrowUpRight className="h-3 w-3 shrink-0 text-zinc-400" />
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {item.snippet}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                    <span>Unlinked Mentions</span>
                    <span className="font-mono tabular-nums">{unlinkedMentions.length}</span>
                  </div>
                  {unlinkedMentions.length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      No unlinked text mentions found.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {unlinkedMentions.map((item, idx) => (
                        <button
                          key={`${item.sourceNoteId}-unlinked-${idx}`}
                          type="button"
                          onClick={() => onSelectNote(item.sourceNoteId)}
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111317] p-2.5 text-left hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
                        >
                          <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {item.sourceTitle}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {item.snippet}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                    <span>Outgoing Links</span>
                    <span className="font-mono tabular-nums">{outgoingLinks.length}</span>
                  </div>
                  {outgoingLinks.length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      Type [[Note Title]] to link another note.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {outgoingLinks.map((target) => (
                        <li key={target}>
                          <button
                            type="button"
                            onClick={() => onOpenWikilink(target)}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 cursor-pointer"
                          >
                            <span className="truncate">{target}</span>
                            <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {tab === 'outline' && (
          <section>
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              <span>Document Outline</span>
              <span className="font-mono tabular-nums">{headings.length}</span>
            </div>
            {headings.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Add # Headings to build a table of contents.
              </p>
            ) : (
              <ul className="space-y-1">
                {headings.map((h, i) => (
                  <li key={`${h.line}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onJumpToLine?.(h.line);
                        const el = document.getElementById(`heading-${h.line}`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`block w-full text-left truncate rounded px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 cursor-pointer ${
                        h.level === 1
                          ? 'font-semibold'
                          : h.level === 2
                          ? 'pl-4'
                          : 'pl-6 text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'sync' && (
          <section>
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              <span>Google Drive Activity</span>
              <span className="font-mono tabular-nums">{syncLogs.length}</span>
            </div>
            {syncLogs.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                No sync activity yet. Connect Google Drive from the top bar to sync vault files.
              </p>
            ) : (
              <ul className="space-y-2">
                {syncLogs.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111317] p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                      <span className="uppercase">{entry.action}</span>
                      <span className="tabular-nums">
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-300 leading-snug">
                      {entry.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  );
};
