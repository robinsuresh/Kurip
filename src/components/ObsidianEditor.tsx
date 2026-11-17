import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  MessageSquareQuote,
  Minus,
  Table,
  Trash2,
} from 'lucide-react';
import { Note } from '../types/vault';
import { createObsidianLivePreviewExtension } from '../utils/cmLivePreview';
import {
  BlockRange,
  computeCodeBlockEnter,
  computeCodeBlockExit,
  computeSlashInsert,
  computeSmartEnterContinuation,
  computeSmartPrefixBackspace,
  deleteBlock,
  findBlockRangeAtLine,
  moveBlockDown,
  moveBlockUp,
  parseMarkdownImage,
  serializeMarkdownImage,
  toggleTaskLine,
  toggleWrapFormatting,
} from '../utils/editorCommands';
import { saveLocalImageFile } from '../utils/localMedia';
import { computeNoteStats, hashContent } from '../utils/markdown';
import { reconcileEditorExternalContent } from '../utils/sync';

interface ObsidianEditorProps {
  noteId: string;
  content: string;
  isLivePreview: boolean;
  isDark: boolean;
  allNotes: Note[];
  scrollToLineRequest?: { line: number; seq: number } | null;
  onChangeContent: (next: string) => void;
  onOpenWikilink: (title: string) => void;
  onSelectTag: (tag: string) => void;
}

interface SlashItem {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  insertText: string;
  cursorOffset?: number;
  isInline?: boolean;
  keywords?: string[];
}

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'task',
    label: 'Task Checkbox',
    hint: '- [ ] Action item',
    icon: <CheckSquare className="h-3.5 w-3.5" />,
    insertText: '- [ ] ',
    isInline: true,
    keywords: ['todo', 'checkbox', 'task'],
  },
  {
    id: 'h1',
    label: 'Heading 1',
    hint: '# Section heading',
    icon: <Heading1 className="h-3.5 w-3.5" />,
    insertText: '# ',
    keywords: ['h1', 'title', 'heading'],
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: '## Subsection heading',
    icon: <Heading2 className="h-3.5 w-3.5" />,
    insertText: '## ',
    keywords: ['h2', 'subtitle', 'heading'],
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: '### Small section heading',
    icon: <Heading3 className="h-3.5 w-3.5" />,
    insertText: '### ',
    keywords: ['h3', 'subheading', 'heading'],
  },
  {
    id: 'pagelink',
    label: 'Page Link',
    hint: '[[Note]] Link to another page',
    icon: <Link2 className="h-3.5 w-3.5" />,
    insertText: '[[',
    isInline: true,
    keywords: ['page', 'link', 'wikilink', 'note', '[['],
  },
  {
    id: 'callout',
    label: 'Callout Box',
    hint: '> [!note] Highlighted note',
    icon: <MessageSquareQuote className="h-3.5 w-3.5" />,
    insertText: '> [!note] Note\n> ',
    keywords: ['callout', 'note', 'admonition'],
  },
  {
    id: 'code',
    label: 'Code Block',
    hint: 'Multi-line fenced code block',
    icon: <Code2 className="h-3.5 w-3.5" />,
    insertText: '```ts\n\n```\n',
    cursorOffset: 6,
    keywords: ['code', 'fence', 'snippet'],
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'Live-editable Markdown table',
    icon: <Table className="h-3.5 w-3.5" />,
    insertText: '|   |   |\n| --- | --- |\n|   |   |\n',
    keywords: ['table', 'grid'],
  },
  {
    id: 'image',
    label: 'Image',
    hint: '![alt](url) Embed local or URL image',
    icon: <ImageIcon className="h-3.5 w-3.5" />,
    insertText: '![alt](url)\n',
    keywords: ['image', 'img', 'picture', 'photo', 'media', 'embed'],
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Horizontal rule ---',
    icon: <Minus className="h-3.5 w-3.5" />,
    insertText: '---',
    keywords: ['divider', 'hr', 'line', 'separator'],
  },
];

const obsidianHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.meta, opacity: '0.55' },
  { tag: tags.processingInstruction, opacity: '0.5' },
]);

export const ObsidianEditor: React.FC<ObsidianEditorProps> = ({
  noteId,
  content,
  isLivePreview,
  allNotes,
  scrollToLineRequest,
  onChangeContent,
  onOpenWikilink,
  onSelectTag,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveCompartmentRef = useRef(new Compartment());

  const isLiveRef = useRef(isLivePreview);
  isLiveRef.current = isLivePreview;

  const existingTitlesRef = useRef<Set<string>>(new Set());
  existingTitlesRef.current = useMemo(
    () => new Set(allNotes.map((n) => n.title.trim().toLowerCase())),
    [allNotes]
  );

  const onChangeRef = useRef(onChangeContent);
  onChangeRef.current = onChangeContent;
  const onOpenWikiRef = useRef(onOpenWikilink);
  onOpenWikiRef.current = onOpenWikilink;
  const onSelectTagRef = useRef(onSelectTag);
  onSelectTagRef.current = onSelectTag;

  const lastNoteIdRef = useRef(noteId);
  const pendingLocalHashesRef = useRef<string[]>([]);

  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 });
  const [wikiSuggest, setWikiSuggest] = useState<{
    query: string;
    startFrom: number;
    endTo: number;
    top: number;
    left: number;
  } | null>(null);
  const [slashSuggest, setSlashSuggest] = useState<{
    query: string;
    startFrom: number;
    endTo: number;
    top: number;
    left: number;
  } | null>(null);
  const [selectionBar, setSelectionBar] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [blockBar, setBlockBar] = useState<{
    startLine: number;
    endLine: number;
    totalLines: number;
    type: BlockRange['type'];
    pos: number;
    top: number;
    right: number;
  } | null>(null);
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(0);

  const wikiListboxRef = useRef<HTMLDivElement | null>(null);
  const slashListboxRef = useRef<HTMLDivElement | null>(null);

  const wikiCandidates = useMemo(() => {
    if (!wikiSuggest) return [];
    const q = wikiSuggest.query.trim();
    const qLower = q.toLowerCase();
    const matches = allNotes
      .filter((n) => n.id !== noteId && n.title.toLowerCase().includes(qLower))
      .slice(0, 6)
      .map((n) => ({ id: n.id, title: n.title, folder: n.folder, isNew: false }));

    const hasExactMatch = allNotes.some(
      (n) => n.title.trim().toLowerCase() === qLower
    );
    if (q.length > 0 && !hasExactMatch) {
      matches.push({
        id: `__new__:${q}`,
        title: q,
        folder: 'Create link',
        isNew: true,
      });
    }
    return matches;
  }, [wikiSuggest, allNotes, noteId]);

  const slashCandidates = useMemo(() => {
    if (!slashSuggest) return [];
    const q = slashSuggest.query.toLowerCase();
    return SLASH_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.id.includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.keywords?.some((kw) => kw.includes(q))
    );
  }, [slashSuggest]);

  useEffect(() => {
    const activeOpt =
      slashListboxRef.current?.querySelector('[aria-selected="true"]') ||
      wikiListboxRef.current?.querySelector('[aria-selected="true"]');
    if (activeOpt instanceof HTMLElement) {
      activeOpt.scrollIntoView({ block: 'nearest' });
    }
  }, [activeSuggestIndex, slashSuggest, wikiSuggest]);

  const stats = useMemo(() => computeNoteStats(content), [content]);

  const applyFormatMarker = (marker: string) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const doc = view.state.doc.toString();
    const res = toggleWrapFormatting(doc, sel.from, sel.to, marker);
    if (res.doc === doc && res.from === sel.from && res.to === sel.to) {
      view.focus();
      return;
    }

    let prefixLen = 0;
    const minLen = Math.min(doc.length, res.doc.length);
    while (prefixLen < minLen && doc[prefixLen] === res.doc[prefixLen]) {
      prefixLen++;
    }
    let docSuffix = doc.length;
    let nextSuffix = res.doc.length;
    while (
      docSuffix > prefixLen &&
      nextSuffix > prefixLen &&
      doc[docSuffix - 1] === res.doc[nextSuffix - 1]
    ) {
      docSuffix--;
      nextSuffix--;
    }

    view.dispatch({
      changes: {
        from: prefixLen,
        to: docSuffix,
        insert: res.doc.slice(prefixLen, nextSuffix),
      },
      selection: { anchor: res.from, head: res.to },
    });
    view.focus();
  };

  const applyTaskToggleOnCursor = (view: EditorView) => {
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const nextLine = toggleTaskLine(line.text);
    const delta = nextLine.length - line.text.length;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: nextLine },
      selection: { anchor: Math.max(line.from, sel.head + delta) },
    });
  };

  const wikiSuggestRef = useRef(wikiSuggest);
  wikiSuggestRef.current = wikiSuggest;
  const wikiCandidatesRef = useRef(wikiCandidates);
  wikiCandidatesRef.current = wikiCandidates;
  const slashSuggestRef = useRef(slashSuggest);
  slashSuggestRef.current = slashSuggest;
  const slashCandidatesRef = useRef(slashCandidates);
  slashCandidatesRef.current = slashCandidates;
  const activeSuggestIndexRef = useRef(activeSuggestIndex);
  activeSuggestIndexRef.current = activeSuggestIndex;

  const insertWikilinkCandidate = (title: string) => {
    const view = viewRef.current;
    const current = wikiSuggestRef.current;
    if (!view || !current) return;
    const insert = `[[${title}]]`;
    view.dispatch({
      changes: { from: current.startFrom, to: current.endTo, insert },
      selection: { anchor: current.startFrom + insert.length },
    });
    setWikiSuggest(null);
    view.focus();
  };

  const applySlashItem = (item: SlashItem) => {
    const view = viewRef.current;
    const current = slashSuggestRef.current;
    if (!view || !current) return;
    const lineAtStart = view.state.doc.lineAt(current.startFrom);
    const slashStartCol = current.startFrom - lineAtStart.from;
    const computed = computeSlashInsert(
      lineAtStart.text,
      slashStartCol,
      item.insertText,
      item.cursorOffset,
      !item.isInline
    );
    const replaceFrom = lineAtStart.from + computed.replaceFromCol;
    const nextCursor = replaceFrom + computed.nextCursorOffset;
    view.dispatch({
      changes: { from: replaceFrom, to: current.endTo, insert: computed.insert },
      selection: { anchor: nextCursor },
    });
    setSlashSuggest(null);
    if (item.id === 'table') {
      window.requestAnimationFrame(() => {
        const firstTh = hostRef.current?.querySelector('.cm-obs-table-widget th') as HTMLElement | null;
        if (firstTh) {
          firstTh.focus();
        } else {
          view.focus();
        }
      });
    } else if (item.id === 'image') {
      window.requestAnimationFrame(() => {
        const urlInput = hostRef.current?.querySelector(
          `[data-image-from="${replaceFrom}"] .cm-obs-image-input`
        ) as HTMLInputElement | null;
        if (urlInput) {
          urlInput.focus();
        } else {
          view.focus();
        }
      });
    } else {
      view.focus();
    }
  };

  const updateBlockBarForPos = (view: EditorView, pos: number) => {
    const host = hostRef.current;
    if (!host) return;
    const doc = view.state.doc;
    const lines = doc.toString().split('\n');
    if (lines.length === 1 && lines[0] === '') {
      setBlockBar(null);
      return;
    }
    const clampedPos = Math.min(Math.max(0, pos), doc.length);
    const lineIdx = doc.lineAt(clampedPos).number - 1;
    const range = findBlockRangeAtLine(lines, lineIdx);
    if (
      range.type === 'table' ||
      (isLiveRef.current && range.type === 'line' && parseMarkdownImage(lines[lineIdx]) !== null)
    ) {
      setBlockBar(null);
      return;
    }
    const startLineObj = doc.line(range.startLine + 1);
    const coords = view.coordsAtPos(startLineObj.from);
    if (!coords) return;
    const hostRect = host.getBoundingClientRect();
    const contentRect = view.contentDOM.getBoundingClientRect();
    const top = Math.max(
      4,
      coords.top - hostRect.top + host.scrollTop + (range.type === 'code' || range.type === 'callout' ? 6 : 0)
    );
    const right = Math.max(12, hostRect.right - contentRect.right + 8);
    setBlockBar({
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: lines.length,
      type: range.type,
      pos: startLineObj.from,
      top,
      right,
    });
  };

  const handleMoveBlockAtPos = (pos: number, direction: 'up' | 'down') => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    const res = direction === 'up' ? moveBlockUp(doc, pos) : moveBlockDown(doc, pos);
    if (!res) return;
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: res.doc },
      selection: { anchor: res.from, head: res.to },
    });
    view.focus();
    window.requestAnimationFrame(() => updateBlockBarForPos(view, res.from));
  };

  const handleDeleteBlockAtPos = (pos: number) => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    const res = deleteBlock(doc, pos);
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: res.doc },
      selection: { anchor: res.from, head: res.to },
    });
    view.focus();
    window.requestAnimationFrame(() => updateBlockBarForPos(view, res.from));
  };

  const moveBlockRef = useRef(handleMoveBlockAtPos);
  moveBlockRef.current = handleMoveBlockAtPos;
  const deleteBlockRef = useRef(handleDeleteBlockAtPos);
  deleteBlockRef.current = handleDeleteBlockAtPos;

  // Mount CodeMirror 6 once
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const liveExt = createObsidianLivePreviewExtension({
      getIsLivePreview: () => isLiveRef.current,
      getExistingTitles: () => existingTitlesRef.current,
      onOpenWikilink: (title) => onOpenWikiRef.current(title),
      onSelectTag: (tag) => onSelectTagRef.current(tag),
      onMoveBlockAtPos: (pos, dir) => moveBlockRef.current(pos, dir),
      onDeleteBlockAtPos: (pos) => deleteBlockRef.current(pos),
    });

    const obsidianKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Mod-b',
          run: () => {
            applyFormatMarker('**');
            return true;
          },
        },
        {
          key: 'Mod-i',
          run: () => {
            applyFormatMarker('*');
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: (view) => {
            const sel = view.state.selection.main;
            if (sel.empty) {
              const doc = view.state.doc.toString();
              const exited = computeCodeBlockExit(doc, sel.head);
              if (exited) {
                view.dispatch({
                  changes: { from: 0, to: doc.length, insert: exited.doc },
                  selection: { anchor: exited.from, head: exited.to },
                });
                return true;
              }
            }
            applyTaskToggleOnCursor(view);
            return true;
          },
        },
        {
          key: 'Alt-ArrowUp',
          run: (view) => {
            const doc = view.state.doc.toString();
            const res = moveBlockUp(doc, view.state.selection.main.head);
            if (!res) return false;
            view.dispatch({
              changes: { from: 0, to: doc.length, insert: res.doc },
              selection: { anchor: res.from, head: res.to },
            });
            return true;
          },
        },
        {
          key: 'Alt-ArrowDown',
          run: (view) => {
            const doc = view.state.doc.toString();
            const res = moveBlockDown(doc, view.state.selection.main.head);
            if (!res) return false;
            view.dispatch({
              changes: { from: 0, to: doc.length, insert: res.doc },
              selection: { anchor: res.from, head: res.to },
            });
            return true;
          },
        },
        {
          key: 'Tab',
          run: (view) => {
            if (wikiSuggestRef.current && wikiCandidatesRef.current.length > 0) {
              const cand =
                wikiCandidatesRef.current[activeSuggestIndexRef.current] ||
                wikiCandidatesRef.current[0];
              insertWikilinkCandidate(cand.title);
              return true;
            }
            return indentMore(view);
          },
        },
        {
          key: 'Shift-Tab',
          run: indentLess,
        },
        {
          key: 'ArrowDown',
          run: () => {
            if (wikiSuggestRef.current && wikiCandidatesRef.current.length > 0) {
              const len = wikiCandidatesRef.current.length;
              setActiveSuggestIndex((i) => (i + 1) % len);
              return true;
            }
            if (slashSuggestRef.current && slashCandidatesRef.current.length > 0) {
              const len = slashCandidatesRef.current.length;
              setActiveSuggestIndex((i) => (i + 1) % len);
              return true;
            }
            return false;
          },
        },
        {
          key: 'ArrowUp',
          run: () => {
            if (wikiSuggestRef.current && wikiCandidatesRef.current.length > 0) {
              const len = wikiCandidatesRef.current.length;
              setActiveSuggestIndex((i) => (i - 1 + len) % len);
              return true;
            }
            if (slashSuggestRef.current && slashCandidatesRef.current.length > 0) {
              const len = slashCandidatesRef.current.length;
              setActiveSuggestIndex((i) => (i - 1 + len) % len);
              return true;
            }
            return false;
          },
        },
        {
          key: 'Escape',
          run: () => {
            if (wikiSuggestRef.current || slashSuggestRef.current) {
              setWikiSuggest(null);
              setSlashSuggest(null);
              return true;
            }
            return false;
          },
        },
        {
          key: 'Enter',
          run: (view) => {
            if (wikiSuggestRef.current && wikiCandidatesRef.current.length > 0) {
              const cand =
                wikiCandidatesRef.current[activeSuggestIndexRef.current] ||
                wikiCandidatesRef.current[0];
              insertWikilinkCandidate(cand.title);
              return true;
            }
            if (slashSuggestRef.current && slashCandidatesRef.current.length > 0) {
              const item =
                slashCandidatesRef.current[activeSuggestIndexRef.current] ||
                slashCandidatesRef.current[0];
              applySlashItem(item);
              return true;
            }

            const sel = view.state.selection.main;
            if (!sel.empty) return false;

            const doc = view.state.doc.toString();
            const codeEnter = computeCodeBlockEnter(doc, sel.head);
            if (codeEnter) {
              view.dispatch({
                changes: { from: 0, to: doc.length, insert: codeEnter.doc },
                selection: { anchor: codeEnter.from, head: codeEnter.to },
              });
              return true;
            }

            const line = view.state.doc.lineAt(sel.head);
            const col = sel.head - line.from;

            const continuation = computeSmartEnterContinuation(line.text, col);
            if (!continuation) return false;

            if (continuation.replaceLineWith !== undefined) {
              view.dispatch({
                changes: { from: line.from, to: line.to, insert: continuation.replaceLineWith },
                selection: { anchor: line.from },
              });
              return true;
            }

            const insert = `\n${continuation.insertPrefix}`;
            view.dispatch({
              changes: { from: sel.head, to: sel.head, insert },
              selection: { anchor: sel.head + insert.length },
            });
            return true;
          },
        },
        {
          key: 'Backspace',
          run: (view) => {
            if (!isLiveRef.current) return false;
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const line = view.state.doc.lineAt(sel.head);
            const col = sel.head - line.from;
            const bs = computeSmartPrefixBackspace(line.text, col);
            if (!bs) return false;
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: bs.replaceLineWith },
              selection: { anchor: line.from + bs.nextCol },
            });
            return true;
          },
        },
      ])
    );

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const nextDoc = update.state.doc.toString();
        const nextHash = hashContent(nextDoc);
        const queue = pendingLocalHashesRef.current;
        queue.push(nextHash);
        if (queue.length > 500) {
          queue.splice(0, queue.length - 500);
        }
        onChangeRef.current(nextDoc);
      }

      if (update.selectionSet || update.docChanged) {
        const sel = update.state.selection.main;
        const line = update.state.doc.lineAt(sel.head);
        setCursorInfo({ line: line.number, col: sel.head - line.from + 1 });

        const hostRect = host.getBoundingClientRect();

        // Floating selection bar
        if (!sel.empty && sel.to - sel.from >= 2) {
          const coords = update.view.coordsAtPos(sel.from);
          if (coords) {
            setSelectionBar({
              top: Math.max(8, coords.top - hostRect.top + host.scrollTop - 42),
              left: Math.max(12, Math.min(hostRect.width - 240, coords.left - hostRect.left)),
            });
          }
        } else {
          setSelectionBar(null);
        }

        // Caret-anchored [[wikilink]] and /slash popovers
        if (sel.empty) {
          const textBefore = line.text.slice(0, sel.head - line.from);
          const openWiki = textBefore.lastIndexOf('[[');
          const closeWiki = textBefore.lastIndexOf(']]');
          if (openWiki !== -1 && openWiki > closeWiki) {
            const coords = update.view.coordsAtPos(sel.head);
            if (coords) {
              setWikiSuggest({
                query: textBefore.slice(openWiki + 2),
                startFrom: line.from + openWiki,
                endTo: sel.head,
                top: coords.bottom - hostRect.top + host.scrollTop + 6,
                left: Math.max(12, Math.min(hostRect.width - 280, coords.left - hostRect.left)),
              });
              setSlashSuggest(null);
              setActiveSuggestIndex(0);
              return;
            }
          }
          setWikiSuggest(null);

          const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
          if (slashMatch) {
            const coords = update.view.coordsAtPos(sel.head);
            if (coords) {
              const slashIdx = textBefore.lastIndexOf('/');
              setSlashSuggest({
                query: slashMatch[1],
                startFrom: line.from + slashIdx,
                endTo: sel.head,
                top: coords.bottom - hostRect.top + host.scrollTop + 6,
                left: Math.max(12, Math.min(hostRect.width - 260, coords.left - hostRect.left)),
              });
              setActiveSuggestIndex(0);
              return;
            }
          }
          setSlashSuggest(null);
        } else {
          setWikiSuggest(null);
          setSlashSuggest(null);
        }

        if (update.view.hasFocus) {
          updateBlockBarForPos(update.view, sel.head);
        }
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        codeFolding(),
        foldGutter({
          openText: '▾',
          closedText: '▸',
        }),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(obsidianHighlight),
        liveCompartmentRef.current.of(liveExt),
        obsidianKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        cmPlaceholder('Start writing Markdown… Type [[ to link a note or / for block commands.'),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure Live Preview vs Source mode cleanly without resetting undo history
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const liveExt = createObsidianLivePreviewExtension({
      getIsLivePreview: () => isLiveRef.current,
      getExistingTitles: () => existingTitlesRef.current,
      onOpenWikilink: (title) => onOpenWikiRef.current(title),
      onSelectTag: (tag) => onSelectTagRef.current(tag),
      onMoveBlockAtPos: (pos, dir) => moveBlockRef.current(pos, dir),
      onDeleteBlockAtPos: (pos) => deleteBlockRef.current(pos),
    });
    view.dispatch({
      effects: liveCompartmentRef.current.reconfigure(liveExt),
    });
  }, [isLivePreview]);

  // Sync doc when switching notes or receiving genuine external updates (never revert live typing)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (noteId !== lastNoteIdRef.current) {
      lastNoteIdRef.current = noteId;
      pendingLocalHashesRef.current = [];
      setWikiSuggest(null);
      setSlashSuggest(null);
      setSelectionBar(null);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: 0 },
      });
      return;
    }

    const currentDoc = view.state.doc.toString();
    const decision = reconcileEditorExternalContent(
      content,
      currentDoc,
      pendingLocalHashesRef.current
    );
    pendingLocalHashesRef.current = decision.nextPendingHashes;

    if (decision.shouldApply) {
      const curPos = Math.min(view.state.selection.main.head, content.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: curPos },
      });
    }
  }, [noteId, content]);

  // Scroll to heading when clicked in Document Outline
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scrollToLineRequest) return;
    const targetLineNum = Math.min(
      Math.max(1, scrollToLineRequest.line),
      view.state.doc.lines
    );
    const line = view.state.doc.line(targetLineNum);
    view.dispatch({
      selection: { anchor: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
    });
    view.focus();
  }, [scrollToLineRequest]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Continuous Obsidian CodeMirror 6 Surface */}
      <div
        ref={hostRef}
        data-testid="obsidian-cm-editor"
        onMouseMove={(e) => {
          const view = viewRef.current;
          if (!view) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('[aria-label="Block controls"]')) return;
          if (target?.closest('.cm-obs-table-widget, .cm-obs-image-widget')) {
            setBlockBar(null);
            return;
          }
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos !== null) {
            updateBlockBarForPos(view, pos);
          }
        }}
        onPaste={(e) => {
          const view = viewRef.current;
          if (!view) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.cm-obs-image-widget, .cm-obs-table-widget')) return;
          const files = Array.from(e.clipboardData?.files || []).filter((f) =>
            f.type.startsWith('image/')
          );
          if (files.length === 0) return;
          e.preventDefault();
          const insertPos = view.state.selection.main.head;
          void (async () => {
            const parts: string[] = [];
            for (const file of files) {
              const saved = await saveLocalImageFile(file);
              parts.push(serializeMarkdownImage(saved.alt, saved.url));
            }
            const line = view.state.doc.lineAt(insertPos);
            const prefix = line.text.trim().length > 0 && insertPos > line.from ? '\n' : '';
            const insert = `${prefix}${parts.join('\n')}\n`;
            view.dispatch({
              changes: { from: insertPos, to: insertPos, insert },
              selection: { anchor: insertPos + insert.length },
            });
          })();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          const view = viewRef.current;
          if (!view) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.cm-obs-image-widget')) return;
          const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
            f.type.startsWith('image/')
          );
          if (files.length === 0) return;
          e.preventDefault();
          const coordsPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const insertPos = coordsPos ?? view.state.selection.main.head;
          void (async () => {
            const parts: string[] = [];
            for (const file of files) {
              const saved = await saveLocalImageFile(file);
              parts.push(serializeMarkdownImage(saved.alt, saved.url));
            }
            const line = view.state.doc.lineAt(insertPos);
            const prefix = line.text.trim().length > 0 && insertPos > line.from ? '\n' : '';
            const insert = `${prefix}${parts.join('\n')}\n`;
            view.dispatch({
              changes: { from: insertPos, to: insertPos, insert },
              selection: { anchor: insertPos + insert.length },
            });
            view.focus();
          })();
        }}
        onMouseLeave={() => {
          if (!viewRef.current?.hasFocus) {
            setBlockBar(null);
          }
        }}
        onBlur={(e) => {
          if (!hostRef.current?.contains(e.relatedTarget as Node | null)) {
            setBlockBar(null);
          }
        }}
        className={`relative min-h-0 flex-1 overflow-y-auto px-4 sm:px-8 py-4 ${
          isLivePreview ? 'obsidian-live-preview' : 'obsidian-source-mode'
        }`}
      >
        {/* Floating Block Move / Delete Toolbar */}
        {blockBar && (
          <div
            role="toolbar"
            aria-label="Block controls"
            style={{ top: blockBar.top, right: blockBar.right }}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-20 flex items-center gap-0.5 rounded-md border border-zinc-200/90 dark:border-zinc-700/80 bg-white/95 dark:bg-[#1C2027]/95 px-1 py-0.5 shadow-sm backdrop-blur-sm"
          >
            <button
              type="button"
              disabled={blockBar.startLine === 0}
              onClick={() => handleMoveBlockAtPos(blockBar.pos, 'up')}
              aria-label="Move block up"
              title="Move block up (Alt+Up)"
              className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              disabled={blockBar.endLine >= blockBar.totalLines - 1}
              onClick={() => handleMoveBlockAtPos(blockBar.pos, 'down')}
              aria-label="Move block down"
              title="Move block down (Alt+Down)"
              className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => handleDeleteBlockAtPos(blockBar.pos)}
              aria-label="Delete block"
              title="Delete block"
              className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Floating Selection Formatting Bar */}
        {selectionBar && (
          <div
            role="toolbar"
            aria-label="Selection formatting"
            style={{ top: selectionBar.top, left: selectionBar.left }}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1C2027] px-1.5 py-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => applyFormatMarker('**')}
              aria-label="Bold selection"
              title="Bold (Cmd/Ctrl+B)"
              className="rounded p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatMarker('*')}
              aria-label="Italic selection"
              title="Italic (Cmd/Ctrl+I)"
              className="rounded p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatMarker('==')}
              aria-label="Highlight selection"
              title="Highlight (==text==)"
              className="rounded p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Highlighter className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatMarker('`')}
              aria-label="Inline code selection"
              title="Inline code"
              className="rounded p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                const view = viewRef.current;
                if (!view) return;
                const sel = view.state.selection.main;
                const text = view.state.doc.sliceString(sel.from, sel.to);
                const leadingWs = /^\s*/.exec(text)?.[0] ?? '';
                const trailingWs = /\s*$/.exec(text)?.[0] ?? '';
                const core = text.slice(leadingWs.length, text.length - trailingWs.length);
                if (!core) {
                  view.focus();
                  return;
                }
                const insert = `${leadingWs}[[${core}]]${trailingWs}`;
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert },
                  selection: { anchor: sel.from + leadingWs.length + core.length + 4 },
                });
                view.focus();
              }}
              aria-label="Wrap selection as wikilink"
              title="Convert to Wikilink"
              className="rounded p-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Caret-Anchored [[Wikilink]] Autocomplete */}
        {wikiSuggest && (
          <div
            ref={wikiListboxRef}
            role="listbox"
            aria-label="Wikilink suggestions"
            style={{ top: wikiSuggest.top, left: wikiSuggest.left }}
            className="absolute z-30 max-h-72 w-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181B20] shadow-xl py-1"
          >
            <div className="px-3 py-1 text-[11px] font-medium text-zinc-400">
              Link to note
            </div>
            {wikiCandidates.length > 0 ? (
              wikiCandidates.map((cand, idx) => (
                <button
                  key={cand.id}
                  type="button"
                  role="option"
                  aria-selected={idx === activeSuggestIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertWikilinkCandidate(cand.title)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs cursor-pointer ${
                    idx === activeSuggestIndex
                      ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                      : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="truncate font-medium">
                    {cand.isNew ? `Create [[${cand.title}]]` : cand.title}
                  </span>
                  {cand.folder && (
                    <span className="ml-2 text-[11px] text-zinc-400 truncate">{cand.folder}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-zinc-400">
                Type a note title to create a page link…
              </div>
            )}
          </div>
        )}

        {/* Caret-Anchored /Slash Command Palette */}
        {slashSuggest && slashCandidates.length > 0 && (
          <div
            ref={slashListboxRef}
            role="listbox"
            aria-label="Slash commands"
            style={{ top: slashSuggest.top, left: slashSuggest.left }}
            className="absolute z-30 max-h-72 w-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181B20] shadow-xl py-1"
          >
            <div className="px-3 py-1 text-[11px] font-medium text-zinc-400">
              Insert Block
            </div>
            {slashCandidates.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === activeSuggestIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySlashItem(item)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs cursor-pointer ${
                  idx === activeSuggestIndex
                    ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="text-zinc-400">{item.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-[11px] text-zinc-400 truncate">{item.hint}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Subtle Obsidian Bottom Editor Status Bar */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/70 dark:bg-[#14171C] px-4 text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-3">
          <span>
            Ln {cursorInfo.line}, Col {cursorInfo.col}
          </span>
          <span aria-hidden="true">·</span>
          <span>{isLivePreview ? 'Live Preview' : 'Source'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{stats.words} words</span>
          <span aria-hidden="true">·</span>
          <span>{stats.chars} chars</span>
        </div>
      </div>
    </div>
  );
};
