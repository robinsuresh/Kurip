import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Minus,
  Plus,
  Quote,
} from 'lucide-react';
import { Note } from '../types/vault';
import {
  cycleBlockTaskStatus,
  getBlockBreadcrumbs,
  getVisibleBlocks,
  indentBlock,
  insertBlockAfter,
  mergeOrRemoveBlock,
  outdentBlock,
  OutlinerBlock,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  toggleBlockCollapsed,
} from '../utils/outliner';

interface LogseqOutlinerProps {
  noteId: string;
  noteTitle: string;
  content: string;
  allNotes: Note[];
  onChangeContent: (nextMarkdown: string) => void;
  onOpenWikilink: (targetTitle: string) => void;
  onSelectTag: (tag: string) => void;
}

interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  apply: (current: string) => string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'todo',
    label: 'TODO Task',
    hint: 'Add interactive task checkbox',
    icon: <CheckSquare className="h-3.5 w-3.5" />,
    apply: (cur) => `TODO ${cur}`,
  },
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Large section heading',
    icon: <Heading1 className="h-3.5 w-3.5" />,
    apply: (cur) => `# ${cur}`,
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Subsection heading',
    icon: <Heading2 className="h-3.5 w-3.5" />,
    apply: (cur) => `## ${cur}`,
  },
  {
    id: 'quote',
    label: 'Blockquote',
    hint: 'Callout or quote line',
    icon: <Quote className="h-3.5 w-3.5" />,
    apply: (cur) => `> ${cur}`,
  },
  {
    id: 'code',
    label: 'Code Block',
    hint: 'Fenced monospace snippet',
    icon: <Code2 className="h-3.5 w-3.5" />,
    apply: (cur) => `\`\`\`ts\n${cur}\n\`\`\``,
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Horizontal separator',
    icon: <Minus className="h-3.5 w-3.5" />,
    apply: () => `---`,
  },
];

export const LogseqOutliner: React.FC<LogseqOutlinerProps> = ({
  noteId,
  noteTitle,
  content,
  allNotes,
  onChangeContent,
  onOpenWikilink,
  onSelectTag,
}) => {
  const [blocks, setBlocks] = useState<OutlinerBlock[]>(() => parseMarkdownToBlocks(content));
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [zoomedBlockId, setZoomedBlockId] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<{ blockId: string; query: string } | null>(null);
  const [wikiQuery, setWikiQuery] = useState<{
    blockId: string;
    query: string;
    startIndex: number;
  } | null>(null);

  const lastEmittedMarkdownRef = useRef<string>(serializeBlocksToMarkdown(blocks));
  const lastNoteIdRef = useRef<string>(noteId);
  const blockInputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const pendingCursorRef = useRef<{ blockId: string; pos: number } | null>(null);

  // Re-parse only when switching notes or receiving an external sync update
  useEffect(() => {
    if (noteId !== lastNoteIdRef.current) {
      lastNoteIdRef.current = noteId;
      const parsed = parseMarkdownToBlocks(content);
      lastEmittedMarkdownRef.current = serializeBlocksToMarkdown(parsed);
      setBlocks(parsed);
      setFocusedBlockId(null);
      setZoomedBlockId(null);
      setSlashQuery(null);
      setWikiQuery(null);
      return;
    }

    if (content !== lastEmittedMarkdownRef.current) {
      const parsed = parseMarkdownToBlocks(content);
      lastEmittedMarkdownRef.current = serializeBlocksToMarkdown(parsed);
      setBlocks(parsed);
    }
  }, [noteId, content]);

  const commitBlocks = (nextBlocks: OutlinerBlock[]) => {
    setBlocks(nextBlocks);
    const serialized = serializeBlocksToMarkdown(nextBlocks);
    lastEmittedMarkdownRef.current = serialized;
    onChangeContent(serialized);
  };

  // Focus & cursor restoration after Enter/Backspace/Tab operations
  useEffect(() => {
    if (!focusedBlockId) return;
    const el = blockInputRefs.current.get(focusedBlockId);
    if (el) {
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
      if (pendingCursorRef.current?.blockId === focusedBlockId) {
        const pos = pendingCursorRef.current.pos;
        el.setSelectionRange(pos, pos);
        pendingCursorRef.current = null;
      }
    }
  }, [focusedBlockId, blocks]);

  const visibleItems = useMemo(
    () => getVisibleBlocks(blocks, zoomedBlockId),
    [blocks, zoomedBlockId]
  );

  const breadcrumbs = useMemo(
    () => getBlockBreadcrumbs(blocks, zoomedBlockId),
    [blocks, zoomedBlockId]
  );

  const zoomedBlock = useMemo(
    () => (zoomedBlockId ? blocks.find((b) => b.id === zoomedBlockId) || null : null),
    [blocks, zoomedBlockId]
  );

  const existingTitles = useMemo(
    () => new Set(allNotes.map((n) => n.title.trim().toLowerCase())),
    [allNotes]
  );

  const wikiCandidates = useMemo(() => {
    if (!wikiQuery) return [];
    const q = wikiQuery.query.toLowerCase();
    return allNotes
      .filter((n) => n.id !== noteId && n.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [wikiQuery, allNotes, noteId]);

  const slashCandidates = useMemo(() => {
    if (!slashQuery) return [];
    const q = slashQuery.query.toLowerCase();
    return SLASH_COMMANDS.filter(
      (cmd) => cmd.label.toLowerCase().includes(q) || cmd.id.includes(q)
    );
  }, [slashQuery]);

  const handleBlockTextChange = (blockId: string, value: string, cursorPos: number) => {
    const next = blocks.map((b) => (b.id === blockId ? { ...b, content: value } : b));
    commitBlocks(next);

    // Resize textarea smoothly
    const el = blockInputRefs.current.get(blockId);
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }

    // Check active [[wikilink]] autocomplete
    const beforeCursor = value.slice(0, cursorPos);
    const openWiki = beforeCursor.lastIndexOf('[[');
    const closeWiki = beforeCursor.lastIndexOf(']]');
    if (openWiki !== -1 && openWiki > closeWiki) {
      const q = beforeCursor.slice(openWiki + 2);
      if (!q.includes('\n')) {
        setWikiQuery({ blockId, query: q, startIndex: openWiki });
        setSlashQuery(null);
        return;
      }
    }
    setWikiQuery(null);

    // Check active /slash command at block start
    if (beforeCursor.startsWith('/') && !beforeCursor.includes(' ') && !beforeCursor.includes('\n')) {
      setSlashQuery({ blockId, query: beforeCursor.slice(1) });
    } else {
      setSlashQuery(null);
    }
  };

  const applySlashCommand = (cmd: SlashCommand, blockId: string) => {
    const target = blocks.find((b) => b.id === blockId);
    if (!target) return;
    const stripped = target.content.replace(/^\/[^\s]*/, '').trimStart();
    const updatedText = cmd.apply(stripped);
    const next = blocks.map((b) => (b.id === blockId ? { ...b, content: updatedText } : b));
    commitBlocks(next);
    setSlashQuery(null);
    pendingCursorRef.current = { blockId, pos: updatedText.length };
  };

  const insertWikilink = (title: string) => {
    if (!wikiQuery) return;
    const target = blocks.find((b) => b.id === wikiQuery.blockId);
    const el = blockInputRefs.current.get(wikiQuery.blockId);
    if (!target || !el) return;

    const cursor = el.selectionStart;
    const before = target.content.slice(0, wikiQuery.startIndex);
    const after = target.content.slice(cursor);
    const inserted = `[[${title}]]`;
    const nextText = `${before}${inserted}${after}`;
    const next = blocks.map((b) =>
      b.id === wikiQuery.blockId ? { ...b, content: nextText } : b
    );
    commitBlocks(next);
    setWikiQuery(null);
    pendingCursorRef.current = {
      blockId: wikiQuery.blockId,
      pos: before.length + inserted.length,
    };
  };

  const handleBlockKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    block: OutlinerBlock,
    visibleIdx: number
  ) => {
    const el = e.currentTarget;

    if (e.key === 'Escape') {
      if (wikiQuery || slashQuery) {
        e.preventDefault();
        setWikiQuery(null);
        setSlashQuery(null);
        return;
      }
      setFocusedBlockId(null);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        commitBlocks(outdentBlock(blocks, block.id));
      } else {
        commitBlocks(indentBlock(blocks, block.id));
      }
      pendingCursorRef.current = { blockId: block.id, pos: el.selectionStart };
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // If slash command popover is open and matches, apply the first command
      if (slashQuery && slashQuery.blockId === block.id && slashCandidates.length > 0) {
        e.preventDefault();
        applySlashCommand(slashCandidates[0], block.id);
        return;
      }
      // If wiki popover is open and matches, insert the first note
      if (wikiQuery && wikiQuery.blockId === block.id && wikiCandidates.length > 0) {
        e.preventDefault();
        insertWikilink(wikiCandidates[0].title);
        return;
      }

      e.preventDefault();
      // Logseq behavior: pressing Enter on an empty indented block outdents it first
      if (block.content.trim() === '' && block.level > 0) {
        commitBlocks(outdentBlock(blocks, block.id));
        return;
      }

      const res = insertBlockAfter(blocks, block.id, el.selectionStart);
      commitBlocks(res.blocks);
      setFocusedBlockId(res.newBlockId);
      pendingCursorRef.current = { blockId: res.newBlockId, pos: 0 };
      setSlashQuery(null);
      setWikiQuery(null);
      return;
    }

    if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (block.level > 0 && block.content.length === 0) {
        e.preventDefault();
        commitBlocks(outdentBlock(blocks, block.id));
        return;
      }
      const res = mergeOrRemoveBlock(blocks, block.id);
      if (res.blocks !== blocks) {
        e.preventDefault();
        commitBlocks(res.blocks);
        if (res.focusBlockId) {
          setFocusedBlockId(res.focusBlockId);
          pendingCursorRef.current = { blockId: res.focusBlockId, pos: res.cursorOffset };
        }
      }
      return;
    }

    if (e.key === 'ArrowUp' && !e.altKey) {
      const beforeCursor = block.content.slice(0, el.selectionStart);
      if (!beforeCursor.includes('\n') && visibleIdx > 0) {
        e.preventDefault();
        const prevBlock = visibleItems[visibleIdx - 1].block;
        setFocusedBlockId(prevBlock.id);
        pendingCursorRef.current = { blockId: prevBlock.id, pos: prevBlock.content.length };
      }
      return;
    }

    if (e.key === 'ArrowDown' && !e.altKey) {
      const afterCursor = block.content.slice(el.selectionEnd);
      if (!afterCursor.includes('\n') && visibleIdx < visibleItems.length - 1) {
        e.preventDefault();
        const nextBlock = visibleItems[visibleIdx + 1].block;
        setFocusedBlockId(nextBlock.id);
        pendingCursorRef.current = { blockId: nextBlock.id, pos: 0 };
      }
    }
  };

  const renderInlineTokens = (text: string, keyPrefix: string): React.ReactNode[] => {
    const tokens: React.ReactNode[] = [];
    const regex =
      /(\[\[[^[\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|(?:^|\s)#[a-zA-Z][a-zA-Z0-9_/-]*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(text.slice(lastIndex, match.index));
      }
      const raw = match[0];
      const key = `${keyPrefix}-${idx++}`;

      if (raw.startsWith('[[') && raw.endsWith(']]')) {
        const inner = raw.slice(2, -2);
        const [targetPart, aliasPart] = inner.split('|');
        const targetTitle = targetPart.split('#')[0].trim();
        const display = (aliasPart || targetPart).trim();
        const exists = existingTitles.has(targetTitle.toLowerCase());
        tokens.push(
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenWikilink(targetTitle);
            }}
            className={`inline font-medium underline underline-offset-4 cursor-pointer ${
              exists
                ? 'text-violet-600 dark:text-violet-400 decoration-violet-400/50 hover:text-violet-500'
                : 'text-zinc-500 dark:text-zinc-400 decoration-dashed decoration-zinc-400/60 hover:text-violet-400'
            }`}
          >
            {display}
          </button>
        );
      } else if (raw.startsWith('`') && raw.endsWith('`')) {
        tokens.push(
          <code
            key={key}
            className="rounded bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] text-zinc-800 dark:text-zinc-200"
          >
            {raw.slice(1, -1)}
          </code>
        );
      } else if (raw.startsWith('**') && raw.endsWith('**')) {
        tokens.push(
          <strong key={key} className="font-semibold text-zinc-900 dark:text-zinc-50">
            {renderInlineTokens(raw.slice(2, -2), `${key}-b`)}
          </strong>
        );
      } else if (raw.startsWith('*') && raw.endsWith('*')) {
        tokens.push(<em key={key}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith('[') && raw.includes('](')) {
        const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
        if (linkMatch) {
          tokens.push(
            <a
              key={key}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-violet-600 dark:text-violet-400 underline underline-offset-4"
            >
              {linkMatch[1]}
            </a>
          );
        } else {
          tokens.push(raw);
        }
      } else if (raw.trimStart().startsWith('#')) {
        const leadingSpace = raw.startsWith(' ') ? ' ' : '';
        const tag = raw.trim().slice(1).toLowerCase();
        if (leadingSpace) tokens.push(leadingSpace);
        tokens.push(
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTag(tag);
            }}
            className="inline font-mono text-[13px] text-violet-600 dark:text-violet-400 hover:underline underline-offset-2 cursor-pointer"
          >
            #{tag}
          </button>
        );
      } else {
        tokens.push(raw);
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      tokens.push(text.slice(lastIndex));
    }
    return tokens;
  };

  const renderBlockContent = (block: OutlinerBlock) => {
    const text = block.content;
    if (!text.trim()) {
      return (
        <span className="text-zinc-400 dark:text-zinc-500 italic text-[14.5px]">
          Click to type… (Tab to indent, / for commands, [[ to link)
        </span>
      );
    }

    // Fenced code block inside a block
    if (text.trimStart().startsWith('```')) {
      const lines = text.split('\n');
      const lang = lines[0].replace(/^```/, '').trim();
      const body = lines.slice(1, lines[lines.length - 1]?.trim() === '```' ? -1 : undefined).join('\n');
      return (
        <pre className="my-1 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#16191E] p-3 font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          {lang && <div className="mb-1 text-[11px] text-zinc-400 select-none">{lang}</div>}
          <code>{body}</code>
        </pre>
      );
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(text.trim())) {
      return <hr className="my-2 border-zinc-200 dark:border-zinc-800" />;
    }

    // Task prefix (TODO / DOING / DONE)
    const taskMatch = /^(TODO|DOING|DONE)\s+(.*)$/.exec(text);
    if (taskMatch) {
      const status = taskMatch[1];
      const body = taskMatch[2];
      const isDone = status === 'DONE';
      return (
        <div className="flex items-start gap-2 text-[15px] leading-relaxed">
          <input
            type="checkbox"
            checked={isDone}
            onClick={(e) => e.stopPropagation()}
            onChange={() => {
              const next = blocks.map((b) =>
                b.id === block.id ? { ...b, content: cycleBlockTaskStatus(b.content) } : b
              );
              commitBlocks(next);
            }}
            aria-label={`Toggle task: ${body}`}
            className="mt-1.5 h-4 w-4 shrink-0 rounded border-zinc-400 dark:border-zinc-600 accent-violet-600 cursor-pointer"
          />
          <span
            className={`font-mono text-[11px] mt-1 font-semibold ${
              isDone
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-violet-600 dark:text-violet-400'
            }`}
          >
            {status}
          </span>
          <span
            className={
              isDone
                ? 'line-through text-zinc-400 dark:text-zinc-500'
                : 'text-zinc-800 dark:text-zinc-200'
            }
          >
            {renderInlineTokens(body, block.id)}
          </span>
        </div>
      );
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(text.trim());
    if (headingMatch) {
      const level = headingMatch[1].length;
      const body = headingMatch[2];
      const cls =
        level === 1
          ? 'font-display text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50'
          : level === 2
          ? 'font-display text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100'
          : 'font-display text-base font-semibold text-zinc-800 dark:text-zinc-100';
      return <div className={cls}>{renderInlineTokens(body, block.id)}</div>;
    }

    // Blockquote
    if (text.trimStart().startsWith('> ')) {
      return (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16191E] px-3 py-1.5 text-[14.5px] italic text-zinc-700 dark:text-zinc-300">
          {renderInlineTokens(text.trimStart().slice(2), block.id)}
        </div>
      );
    }

    return (
      <div className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
        {renderInlineTokens(text, block.id)}
      </div>
    );
  };

  return (
    <div
      data-testid="logseq-outliner"
      className="flex-1 overflow-y-auto px-6 py-5"
      onClick={() => {
        // Clicking open canvas below blocks blurs active block
        if (focusedBlockId) {
          setFocusedBlockId(null);
          setWikiQuery(null);
          setSlashQuery(null);
        }
      }}
    >
      <div className="mx-auto max-w-3xl">
        {/* Logseq Zoom Breadcrumb Bar */}
        {zoomedBlock && (
          <nav
            aria-label="Block zoom breadcrumbs"
            className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16191E] px-3 py-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoomedBlockId(null)}
              className="font-medium text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
            >
              {noteTitle || 'Untitled'}
            </button>
            {breadcrumbs.map((crumb) => (
              <React.Fragment key={crumb.id}>
                <span aria-hidden="true" className="text-zinc-400">
                  ›
                </span>
                <button
                  type="button"
                  onClick={() => setZoomedBlockId(crumb.id)}
                  className={`truncate max-w-[200px] cursor-pointer ${
                    crumb.id === zoomedBlock.id
                      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {crumb.content.replace(/^#+\s*/, '') || 'Block'}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

        {/* Zoomed Parent Title Header */}
        {zoomedBlock && (
          <div className="mb-3 pb-2 border-b border-zinc-200/70 dark:border-zinc-800/70">
            <h2 className="font-display text-xl font-bold text-zinc-900 dark:text-zinc-50">
              {renderInlineTokens(zoomedBlock.content.replace(/^#+\s*/, ''), 'zoom-hdr')}
            </h2>
          </div>
        )}

        {/* Hierarchical Outliner Blocks */}
        <div role="list" aria-label="Outliner blocks" className="space-y-0.5">
          {visibleItems.map(({ block, hasChildren, relativeLevel }, visibleIdx) => {
            const isEditing = focusedBlockId === block.id;
            return (
              <div
                key={block.id}
                role="listitem"
                data-block-level={relativeLevel}
                className="group relative flex items-stretch"
                onClick={(e) => {
                  e.stopPropagation();
                  setFocusedBlockId(block.id);
                }}
              >
                {/* Vertical Indent Guide Lines */}
                {Array.from({ length: relativeLevel }).map((_, depthIdx) => (
                  <div
                    key={depthIdx}
                    aria-hidden="true"
                    className="relative w-6 shrink-0"
                  >
                    <div className="absolute top-0 bottom-0 left-[11px] w-px bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 transition-colors" />
                  </div>
                ))}

                {/* Collapse Chevron + Logseq Bullet Dot */}
                <div className="relative flex w-7 shrink-0 items-start justify-center pt-1.5">
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitBlocks(toggleBlockCollapsed(blocks, block.id));
                      }}
                      aria-label={block.collapsed ? 'Expand child blocks' : 'Collapse child blocks'}
                      className={`absolute -left-2.5 top-1.5 rounded p-0.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-opacity cursor-pointer ${
                        block.collapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      }`}
                    >
                      {block.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomedBlockId(block.id);
                    }}
                    aria-label={`Zoom into block: ${block.content.slice(0, 32) || 'empty block'}`}
                    title="Click bullet to zoom into block"
                    className={`mt-1 flex h-4 w-4 items-center justify-center rounded-full transition-colors cursor-pointer ${
                      block.collapsed
                        ? 'bg-violet-500/20 ring-2 ring-violet-500/40'
                        : 'hover:bg-zinc-200/80 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isEditing || block.collapsed
                          ? 'bg-violet-500'
                          : 'bg-zinc-400 dark:bg-zinc-500 group-hover:bg-zinc-700 dark:group-hover:bg-zinc-300'
                      }`}
                    />
                  </button>
                </div>

                {/* Block Content (Live Edit Textarea vs Rendered Markdown Block) */}
                <div className="relative min-w-0 flex-1 py-1">
                  {isEditing ? (
                    <div className="relative">
                      <textarea
                        ref={(el) => {
                          if (el) blockInputRefs.current.set(block.id, el);
                          else blockInputRefs.current.delete(block.id);
                        }}
                        rows={1}
                        value={block.content}
                        onChange={(e) =>
                          handleBlockTextChange(block.id, e.target.value, e.target.selectionStart)
                        }
                        onKeyDown={(e) => handleBlockKeyDown(e, block, visibleIdx)}
                        aria-label={`Edit block ${visibleIdx + 1}`}
                        placeholder="Type Markdown, / for commands, or [[ to link…"
                        className="w-full resize-none overflow-hidden rounded-md bg-zinc-100/70 dark:bg-[#191D24] px-2 py-0.5 text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                      />

                      {/* Inline [[Wikilink]] Autocomplete Popover */}
                      {wikiQuery && wikiQuery.blockId === block.id && wikiCandidates.length > 0 && (
                        <div
                          role="listbox"
                          aria-label="Wikilink suggestions"
                          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181B20] shadow-xl py-1"
                        >
                          <div className="px-3 py-1 text-[11px] font-medium text-zinc-400">
                            Link to page
                          </div>
                          {wikiCandidates.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                insertWikilink(c.title);
                              }}
                              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-800 dark:text-zinc-200 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300 cursor-pointer"
                            >
                              <span className="truncate font-medium">{c.title}</span>
                              {c.folder && (
                                <span className="ml-2 text-[11px] text-zinc-400 truncate">
                                  {c.folder}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Inline /Slash Command Menu */}
                      {slashQuery && slashQuery.blockId === block.id && slashCandidates.length > 0 && (
                        <div
                          role="listbox"
                          aria-label="Slash commands"
                          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181B20] shadow-xl py-1"
                        >
                          <div className="px-3 py-1 text-[11px] font-medium text-zinc-400">
                            Block Commands
                          </div>
                          {slashCandidates.map((cmd) => (
                            <button
                              key={cmd.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                applySlashCommand(cmd, block.id);
                              }}
                              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-zinc-800 dark:text-zinc-200 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300 cursor-pointer"
                            >
                              <span className="text-zinc-400">{cmd.icon}</span>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium">{cmd.label}</div>
                                <div className="text-[11px] text-zinc-400 truncate">{cmd.hint}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md px-2 py-0.5 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors cursor-text">
                      {renderBlockContent(block)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Clickable "Add block" affordance below last bullet (Logseq signature) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const lastVisible = visibleItems[visibleItems.length - 1]?.block || blocks[blocks.length - 1];
            if (lastVisible) {
              const res = insertBlockAfter(blocks, lastVisible.id);
              commitBlocks(res.blocks);
              setFocusedBlockId(res.newBlockId);
              pendingCursorRef.current = { blockId: res.newBlockId, pos: 0 };
            }
          }}
          className="mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add block</span>
        </button>
      </div>
    </div>
  );
};
