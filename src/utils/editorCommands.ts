export interface TextTransformResult {
  doc: string;
  from: number;
  to: number;
}

interface MarkerToken {
  start: number;
  end: number;
}

interface MarkerSpan {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

function findMarkerTokensInLine(lineText: string, marker: string): MarkerToken[] {
  const tokens: MarkerToken[] = [];
  if (!marker) return tokens;

  if (marker === '*') {
    let i = 0;
    while (i < lineText.length) {
      if (lineText[i] === '*') {
        let j = i;
        while (j < lineText.length && lineText[j] === '*') j++;
        const runLen = j - i;
        if (runLen === 1) {
          tokens.push({ start: i, end: i + 1 });
        } else if (runLen >= 3) {
          const nextIsWord = j < lineText.length && !/\s/.test(lineText[j]);
          tokens.push(nextIsWord ? { start: j - 1, end: j } : { start: i, end: i + 1 });
        }
        i = j;
      } else {
        i++;
      }
    }
    return tokens;
  }

  if (marker === '**') {
    let i = 0;
    while (i < lineText.length) {
      if (lineText[i] === '*' && lineText[i + 1] === '*') {
        let j = i;
        while (j < lineText.length && lineText[j] === '*') j++;
        const runLen = j - i;
        if (runLen === 3) {
          const nextIsWord = j < lineText.length && !/\s/.test(lineText[j]);
          tokens.push(nextIsWord ? { start: i, end: i + 2 } : { start: j - 2, end: j });
        } else {
          tokens.push({ start: i, end: i + 2 });
        }
        i += runLen === 3 ? 3 : 2;
      } else {
        i++;
      }
    }
    return tokens;
  }

  let pos = 0;
  while (pos <= lineText.length - marker.length) {
    const idx = lineText.indexOf(marker, pos);
    if (idx === -1) break;
    tokens.push({ start: idx, end: idx + marker.length });
    pos = idx + marker.length;
  }
  return tokens;
}

function stripTokensWithCleanSpacing(
  slice: string,
  sliceStart: number,
  tokens: MarkerToken[]
): string {
  if (tokens.length === 0) return slice;
  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  let justStripped = false;

  for (const tok of sorted) {
    const relStart = tok.start - sliceStart;
    const relEnd = tok.end - sliceStart;
    if (relStart < cursor || relEnd > slice.length) continue;
    let chunk = slice.slice(cursor, relStart);
    if (justStripped && result.endsWith(' ') && chunk.startsWith(' ')) {
      chunk = chunk.replace(/^ +/, '');
    }
    result += chunk;
    cursor = relEnd;
    justStripped = true;
  }

  let tail = slice.slice(cursor);
  if (justStripped && result.endsWith(' ') && tail.startsWith(' ')) {
    tail = tail.replace(/^ +/, '');
  }
  return result + tail;
}

function toggleWrapOnSingleLine(
  doc: string,
  rawStart: number,
  rawEnd: number,
  marker: string,
  wasEmptySelection: boolean
): TextTransformResult {
  const mLen = marker.length;
  const prevNl = doc.lastIndexOf('\n', rawStart - 1);
  const lineStart = prevNl === -1 ? 0 : prevNl + 1;
  const nextNl = doc.indexOf('\n', rawEnd);
  const lineEnd = nextNl === -1 ? doc.length : nextNl;
  const lineText = doc.slice(lineStart, lineEnd);

  let rStart = rawStart - lineStart;
  let rEnd = rawEnd - lineStart;

  if (!wasEmptySelection) {
    while (rStart < rEnd && /\s/.test(lineText[rStart])) {
      rStart++;
    }
    while (rEnd > rStart && /\s/.test(lineText[rEnd - 1])) {
      rEnd--;
    }
    if (rStart === rEnd) {
      return { doc, from: rawStart, to: rawEnd };
    }

    // Preserve Markdown block line prefixes (callout/quote, heading, task, bullet, numbered list)
    const prefixMatch =
      /^(\s*(?:>\s*(?:\[![a-zA-Z]+\]\s*)?|#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+))/.exec(
        lineText
      );
    if (prefixMatch && rStart < prefixMatch[1].length) {
      rStart = prefixMatch[1].length;
      while (rStart < rEnd && /\s/.test(lineText[rStart])) {
        rStart++;
      }
      if (rStart >= rEnd) {
        return { doc, from: rawStart, to: rawEnd };
      }
    }
  }

  const tokens = findMarkerTokensInLine(lineText, marker);
  const spans: MarkerSpan[] = [];
  const unpaired: MarkerToken[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    spans.push({
      openStart: tokens[i].start,
      openEnd: tokens[i].end,
      closeStart: tokens[i + 1].start,
      closeEnd: tokens[i + 1].end,
    });
  }
  if (tokens.length % 2 === 1) {
    unpaired.push(tokens[tokens.length - 1]);
  }

  // Case 1: Selection sits strictly inside an existing span `[openEnd, closeStart]`
  const enclosing = spans.find((s) => rStart >= s.openEnd && rEnd <= s.closeStart);
  if (enclosing) {
    const leftRaw = lineText.slice(enclosing.openEnd, rStart);
    const midRaw = lineText.slice(rStart, rEnd);
    const rightRaw = lineText.slice(rEnd, enclosing.closeStart);

    const leftTrim = leftRaw.replace(/\s+$/, '');
    const leftWs = leftRaw.slice(leftTrim.length);
    const rightTrim = rightRaw.replace(/^\s+/, '');
    const rightWs = rightRaw.slice(0, rightRaw.length - rightTrim.length);

    const leftPart = leftTrim.length > 0 ? `${marker}${leftTrim}${marker}${leftWs}` : leftRaw;
    const rightPart = rightTrim.length > 0 ? `${rightWs}${marker}${rightTrim}${marker}` : rightRaw;

    const replacement = `${leftPart}${midRaw}${rightPart}`;
    const nextLine =
      lineText.slice(0, enclosing.openStart) + replacement + lineText.slice(enclosing.closeEnd);
    const nextDoc = doc.slice(0, lineStart) + nextLine + doc.slice(lineEnd);
    const nextFrom = lineStart + enclosing.openStart + leftPart.length;
    return {
      doc: nextDoc,
      from: nextFrom,
      to: nextFrom + midRaw.length,
    };
  }

  // Case 2: Merge / unwrap any overlapping spans or stray markers on this line
  let mStart = rStart;
  let mEnd = rEnd;
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of spans) {
      if (s.openStart < mEnd && s.closeEnd > mStart) {
        if (s.openStart < mStart) {
          mStart = s.openStart;
          changed = true;
        }
        if (s.closeEnd > mEnd) {
          mEnd = s.closeEnd;
          changed = true;
        }
      }
    }
    for (const t of unpaired) {
      if (t.start <= mEnd && t.end >= mStart) {
        if (t.start < mStart) {
          mStart = t.start;
          changed = true;
        }
        if (t.end > mEnd) {
          mEnd = t.end;
          changed = true;
        }
      }
    }
  }

  const tokensInside = tokens.filter((t) => t.start >= mStart && t.end <= mEnd);
  if (tokensInside.length > 0) {
    const overlappingSpans = spans.filter((s) => s.openStart < mEnd && s.closeEnd > mStart);
    const hasUnpairedInside = unpaired.some((t) => t.start >= mStart && t.end <= mEnd);

    let allNonWsCovered = !hasUnpairedInside && overlappingSpans.length > 0;
    if (allNonWsCovered) {
      for (let i = mStart; i < mEnd; i++) {
        if (!/\s/.test(lineText[i])) {
          const insideSpan = overlappingSpans.some((s) => i >= s.openStart && i < s.closeEnd);
          if (!insideSpan) {
            allNonWsCovered = false;
            break;
          }
        }
      }
    }

    const rawSlice = lineText.slice(mStart, mEnd);
    const stripped = stripTokensWithCleanSpacing(rawSlice, mStart, tokensInside);
    const leadingWs = /^\s*/.exec(stripped)?.[0] ?? '';
    const trailingWs = /\s*$/.exec(stripped)?.[0] ?? '';
    const core = stripped.slice(leadingWs.length, stripped.length - trailingWs.length);

    if (core.length === 0) {
      // Degenerate empty/whitespace marker pair (e.g. `== ==`): strip completely
      const nextLine = lineText.slice(0, mStart) + stripped + lineText.slice(mEnd);
      const nextDoc = doc.slice(0, lineStart) + nextLine + doc.slice(lineEnd);
      const pos = lineStart + mStart + stripped.length;
      return { doc: nextDoc, from: pos, to: pos };
    }

    if (allNonWsCovered) {
      const replacement = `${leadingWs}${core}${trailingWs}`;
      const nextLine = lineText.slice(0, mStart) + replacement + lineText.slice(mEnd);
      const nextDoc = doc.slice(0, lineStart) + nextLine + doc.slice(lineEnd);
      const nextFrom = lineStart + mStart + leadingWs.length;
      return {
        doc: nextDoc,
        from: nextFrom,
        to: nextFrom + core.length,
      };
    }

    const replacement = `${leadingWs}${marker}${core}${marker}${trailingWs}`;
    const nextLine = lineText.slice(0, mStart) + replacement + lineText.slice(mEnd);
    const nextDoc = doc.slice(0, lineStart) + nextLine + doc.slice(lineEnd);
    const nextFrom = lineStart + mStart + leadingWs.length + mLen;
    return {
      doc: nextDoc,
      from: nextFrom,
      to: nextFrom + core.length,
    };
  }

  // Case 3: Plain unwrapped selection
  const selected = lineText.slice(rStart, rEnd);
  const wrapped = `${marker}${selected}${marker}`;
  const nextLine = lineText.slice(0, rStart) + wrapped + lineText.slice(rEnd);
  const nextDoc = doc.slice(0, lineStart) + nextLine + doc.slice(lineEnd);
  const nextFrom = lineStart + rStart + mLen;
  return {
    doc: nextDoc,
    from: nextFrom,
    to: nextFrom + selected.length,
  };
}

/**
 * Toggles wrapping a selection (or current word) with a symmetric Markdown marker
 * such as '**', '*', '==', or '`'. Safely keeps whitespace/line-prefixes outside
 * markers and cleanly merges or unwraps overlapping or fragmented markers.
 */
export function toggleWrapFormatting(
  doc: string,
  from: number,
  to: number,
  marker: string
): TextTransformResult {
  let start = Math.min(from, to);
  let end = Math.max(from, to);
  const wasEmptySelection = start === end;

  // If no selection, expand to word boundaries around cursor
  if (wasEmptySelection) {
    while (start > 0 && /[^\s[\]()`*_~=]/.test(doc[start - 1])) {
      start--;
    }
    while (end < doc.length && /[^\s[\]()`*_~=]/.test(doc[end])) {
      end++;
    }
    return toggleWrapOnSingleLine(doc, start, end, marker, true);
  }

  // Single-line selection
  if (!doc.slice(start, end).includes('\n')) {
    return toggleWrapOnSingleLine(doc, start, end, marker, false);
  }

  // Multi-line selection: apply line-by-line from bottom to top
  let nextDoc = doc;
  const lineRanges: Array<{ from: number; to: number }> = [];
  let pos = start;
  while (pos <= end) {
    const nl = nextDoc.indexOf('\n', pos);
    const segEnd = nl === -1 || nl >= end ? end : nl;
    lineRanges.push({ from: pos, to: segEnd });
    if (nl === -1 || nl >= end) break;
    pos = nl + 1;
  }

  let outFrom = start;
  let outTo = end;
  for (let i = lineRanges.length - 1; i >= 0; i--) {
    const seg = lineRanges[i];
    if (nextDoc.slice(seg.from, seg.to).trim().length === 0) continue;
    const prevLen = nextDoc.length;
    const res = toggleWrapOnSingleLine(nextDoc, seg.from, seg.to, marker, false);
    const delta = res.doc.length - prevLen;
    nextDoc = res.doc;
    if (i === 0) outFrom = res.from;
    if (i === lineRanges.length - 1) {
      outTo = res.to;
    } else {
      outTo += delta;
    }
  }

  return { doc: nextDoc, from: outFrom, to: Math.max(outFrom, outTo) };
}

/**
 * Toggles task state on a single Markdown line (Obsidian Ctrl/Cmd+Enter behavior):
 * - Plain text -> `- [ ] text`
 * - `- item` -> `- [ ] item`
 * - `- [ ] item` -> `- [x] item`
 * - `- [x] item` -> `- [ ] item`
 */
export function toggleTaskLine(lineText: string): string {
  if (/^(\s*[-*]\s)\[ \](\s*)/.test(lineText)) {
    return lineText.replace(/^(\s*[-*]\s)\[ \]/, '$1[x]');
  }
  if (/^(\s*[-*]\s)\[[xX]\](\s*)/.test(lineText)) {
    return lineText.replace(/^(\s*[-*]\s)\[[xX]\]/, '$1[ ]');
  }
  if (/^(\s*[-*]\s+)/.test(lineText)) {
    return lineText.replace(/^(\s*[-*]\s+)/, '$1[ ] ');
  }
  const indentMatch = /^(\s*)(.*)$/.exec(lineText);
  const indent = indentMatch?.[1] ?? '';
  const body = indentMatch?.[2] ?? '';
  return `${indent}- [ ] ${body}`;
}

/**
 * Computes smart Enter continuation for lists, tasks, ordered lists, and blockquotes.
 * Returns `null` if standard newline should occur.
 */
export function computeSmartEnterContinuation(
  lineText: string,
  cursorCol: number
): { replaceLineWith?: string; insertPrefix: string } | null {
  const beforeCursor = lineText.slice(0, cursorCol);

  // Task list item: `  - [ ] text` or `  - [x] text`
  const taskMatch = /^(\s*)([-*])\s+\[[ xX]\]\s*(.*)$/.exec(beforeCursor);
  if (taskMatch) {
    const [, indent, bullet, body] = taskMatch;
    if (body === '' && lineText.trim() === `${bullet} [ ]` || lineText.trim() === `${bullet} [x]`) {
      return { replaceLineWith: '', insertPrefix: '' };
    }
    return { insertPrefix: `${indent}${bullet} [ ] ` };
  }

  // Unordered list item: `  - text` or `* text`
  const ulMatch = /^(\s*)([-*])\s+(.*)$/.exec(beforeCursor);
  if (ulMatch) {
    const [, indent, bullet, body] = ulMatch;
    if (body === '' && lineText.trim() === bullet) {
      return { replaceLineWith: '', insertPrefix: '' };
    }
    return { insertPrefix: `${indent}${bullet} ` };
  }

  // Ordered list item: `  1. text`
  const olMatch = /^(\s*)(\d+)\.\s+(.*)$/.exec(beforeCursor);
  if (olMatch) {
    const [, indent, numStr, body] = olMatch;
    if (body === '' && lineText.trim() === `${numStr}.`) {
      return { replaceLineWith: '', insertPrefix: '' };
    }
    return { insertPrefix: `${indent}${Number(numStr) + 1}. ` };
  }

  // Blockquote: `> text`
  const quoteMatch = /^(\s*)>\s+(.*)$/.exec(beforeCursor);
  if (quoteMatch) {
    const [, indent, body] = quoteMatch;
    if (body === '' && lineText.trim() === '>') {
      return { replaceLineWith: '', insertPrefix: '' };
    }
    return { insertPrefix: `${indent}> ` };
  }

  return null;
}

export interface CalloutInfo {
  type: string;
  title: string;
}

/**
 * Parses an Obsidian callout header line like `> [!note] Architecture Notes`.
 */
export function parseCalloutHeader(lineText: string): CalloutInfo | null {
  const match = /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/.exec(lineText.trim());
  if (!match) return null;
  const type = match[1].toLowerCase();
  const title = match[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
  return { type, title };
}

/**
 * Unwraps a hidden Markdown line prefix (heading, task, bullet, quote) when the user
 * presses Backspace right at the visual start of the rendered content in Live Preview.
 */
export function computeSmartPrefixBackspace(
  lineText: string,
  cursorCol: number
): { replaceLineWith: string; nextCol: number } | null {
  // Task prefix: `  - [ ] text` or `  - [x] text` -> `  - text`
  const taskMatch = /^(\s*)([-*]\s+\[[ xX]\]\s+)(.*)$/.exec(lineText);
  if (taskMatch && cursorCol === taskMatch[1].length + taskMatch[2].length) {
    const indent = taskMatch[1];
    return {
      replaceLineWith: `${indent}- ${taskMatch[3]}`,
      nextCol: indent.length + 2,
    };
  }

  // Bullet prefix: `  - text` -> `  text`
  const bulletMatch = /^(\s*)([-*]\s+)(.*)$/.exec(lineText);
  if (bulletMatch && cursorCol === bulletMatch[1].length + bulletMatch[2].length) {
    const indent = bulletMatch[1];
    return {
      replaceLineWith: `${indent}${bulletMatch[3]}`,
      nextCol: indent.length,
    };
  }

  // Heading prefix: `## Heading` -> `Heading`
  const headingMatch = /^(#{1,3}\s+)(.*)$/.exec(lineText);
  if (headingMatch && cursorCol === headingMatch[1].length) {
    return {
      replaceLineWith: headingMatch[2],
      nextCol: 0,
    };
  }

  // Blockquote prefix: `> quote` -> `quote`
  const quoteMatch = /^(>\s+)(.*)$/.exec(lineText);
  if (quoteMatch && cursorCol === quoteMatch[1].length) {
    return {
      replaceLineWith: quoteMatch[2],
      nextCol: 0,
    };
  }

  return null;
}

/**
 * Serializes table headers and rows into a clean GFM Markdown table string.
 */
export function serializeMarkdownTable(headers: string[], rows: string[][]): string {
  const colCount = Math.max(1, headers.length);
  const sanitizeCell = (val: string) => (val || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  const normalizedHeaders = Array.from({ length: colCount }, (_, c) => sanitizeCell(headers[c] || '') || ' ');
  const sep = Array.from({ length: colCount }, () => '---');
  const lines = [
    `| ${normalizedHeaders.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((row) => {
      const cells = Array.from({ length: colCount }, (_, c) => sanitizeCell(row[c] || '') || ' ');
      return `| ${cells.join(' | ')} |`;
    }),
  ];
  return lines.join('\n');
}

interface FenceBlockRange {
  openIdx: number;
  closeIdx: number | null;
}

function findFenceBlocks(lines: string[]): FenceBlockRange[] {
  const blocks: FenceBlockRange[] = [];
  let activeOpen: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (activeOpen === null && /^```([^\s`]*)\s*$/.test(trimmed)) {
      activeOpen = i;
    } else if (activeOpen !== null && /^```\s*$/.test(trimmed)) {
      blocks.push({ openIdx: activeOpen, closeIdx: i });
      activeOpen = null;
    }
  }
  if (activeOpen !== null) {
    blocks.push({ openIdx: activeOpen, closeIdx: null });
  }
  return blocks;
}

function getLineOffsets(lines: string[]): Array<{ from: number; to: number }> {
  const offsets: Array<{ from: number; to: number }> = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const from = pos;
    const to = pos + lines[i].length;
    offsets.push({ from, to });
    pos = to + 1;
  }
  return offsets;
}

function locateLineIndex(offsets: Array<{ from: number; to: number }>, cursorPos: number): number {
  for (let i = 0; i < offsets.length; i++) {
    if (cursorPos >= offsets[i].from && cursorPos <= offsets[i].to) {
      return i;
    }
  }
  return Math.max(0, offsets.length - 1);
}

/**
 * Handles Enter inside a fenced code block:
 * - Auto-pairs an unclosed ` ```lang ` opening fence on Enter.
 * - Exits the code block when pressing an extra Enter on a trailing empty line right before
 *   the closing fence (removing the trailing blank line inside the fence and placing the
 *   cursor on a fresh line below ` ``` `).
 * - Closes an unclosed code block when pressing an extra Enter on a trailing blank line.
 */
export function computeCodeBlockEnter(
  doc: string,
  cursorPos: number
): TextTransformResult | null {
  const lines = doc.split('\n');
  const offsets = getLineOffsets(lines);
  const lineIdx = locateLineIndex(offsets, cursorPos);
  const line = lines[lineIdx] ?? '';
  const col = cursorPos - offsets[lineIdx].from;

  const blocks = findFenceBlocks(lines);
  const block = blocks.find(
    (b) => lineIdx >= b.openIdx && (b.closeIdx === null || lineIdx <= b.closeIdx)
  );
  if (!block) return null;

  // 1. Auto-pair unclosed opening fence ```lang when pressing Enter at line end
  if (lineIdx === block.openIdx && block.closeIdx === null && col === line.length) {
    const trailingNewline = lineIdx === lines.length - 1 ? '\n' : '';
    const insert = `\n\n\`\`\`${trailingNewline}`;
    const nextDoc = doc.slice(0, cursorPos) + insert + doc.slice(cursorPos);
    return {
      doc: nextDoc,
      from: cursorPos + 1,
      to: cursorPos + 1,
    };
  }

  // 2. Exit closed code block on extra Enter on trailing empty line before closing fence
  if (
    block.closeIdx !== null &&
    lineIdx === block.closeIdx - 1 &&
    lineIdx > block.openIdx + 1 &&
    line.trim() === ''
  ) {
    const nextLines = [...lines];
    // Remove the trailing empty line inside the code block
    nextLines.splice(lineIdx, 1);
    const nextCloseIdx = block.closeIdx - 1;
    const afterCloseIdx = nextCloseIdx + 1;
    if (afterCloseIdx >= nextLines.length || nextLines[afterCloseIdx].trim() !== '') {
      nextLines.splice(afterCloseIdx, 0, '');
    }
    const nextDoc = nextLines.join('\n');
    const nextOffsets = getLineOffsets(nextLines);
    const targetPos = nextOffsets[afterCloseIdx].from;
    return {
      doc: nextDoc,
      from: targetPos,
      to: targetPos,
    };
  }

  // 3. Close & exit an unclosed code block on extra Enter on a trailing empty line
  if (
    block.closeIdx === null &&
    lineIdx > block.openIdx + 1 &&
    line.trim() === '' &&
    (lineIdx === lines.length - 1 || lines[lineIdx - 1].trim() === '')
  ) {
    const nextLines = [...lines];
    nextLines[lineIdx] = '```';
    const afterCloseIdx = lineIdx + 1;
    if (afterCloseIdx >= nextLines.length || nextLines[afterCloseIdx].trim() !== '') {
      nextLines.splice(afterCloseIdx, 0, '');
    }
    const nextDoc = nextLines.join('\n');
    const nextOffsets = getLineOffsets(nextLines);
    const targetPos = nextOffsets[afterCloseIdx].from;
    return {
      doc: nextDoc,
      from: targetPos,
      to: targetPos,
    };
  }

  return null;
}

/**
 * Exits a fenced code block immediately (e.g. via Mod-Enter) and moves the cursor
 * onto a clean line right after the closing fence.
 */
export function computeCodeBlockExit(
  doc: string,
  cursorPos: number
): TextTransformResult | null {
  const lines = doc.split('\n');
  const offsets = getLineOffsets(lines);
  const lineIdx = locateLineIndex(offsets, cursorPos);
  const blocks = findFenceBlocks(lines);
  const block = blocks.find(
    (b) => lineIdx >= b.openIdx && (b.closeIdx === null || lineIdx <= b.closeIdx)
  );
  if (!block) return null;

  const nextLines = [...lines];
  let nextCloseIdx: number;

  if (block.closeIdx !== null) {
    nextCloseIdx = block.closeIdx;
  } else {
    if (lines[lineIdx].trim() === '' && lineIdx > block.openIdx) {
      nextLines[lineIdx] = '```';
      nextCloseIdx = lineIdx;
    } else {
      nextLines.splice(lineIdx + 1, 0, '```');
      nextCloseIdx = lineIdx + 1;
    }
  }

  const afterCloseIdx = nextCloseIdx + 1;
  if (afterCloseIdx >= nextLines.length || nextLines[afterCloseIdx].trim() !== '') {
    nextLines.splice(afterCloseIdx, 0, '');
  }

  const nextDoc = nextLines.join('\n');
  const nextOffsets = getLineOffsets(nextLines);
  const targetPos = nextOffsets[afterCloseIdx].from;
  return {
    doc: nextDoc,
    from: targetPos,
    to: targetPos,
  };
}

export interface BlockRange {
  startLine: number;
  endLine: number;
  type: 'code' | 'table' | 'callout' | 'line';
}

/**
 * Resolves the enclosing block (fenced code block, Markdown table, Obsidian callout, or single line)
 * for a given 0-based line index.
 */
export function findBlockRangeAtLine(lines: string[], lineIdx: number): BlockRange {
  const safeIdx = Math.max(0, Math.min(lineIdx, lines.length - 1));

  // 1. Check fenced code blocks
  const blocks = findFenceBlocks(lines);
  for (const b of blocks) {
    const end = b.closeIdx ?? lines.length - 1;
    if (safeIdx >= b.openIdx && safeIdx <= end) {
      return { startLine: b.openIdx, endLine: end, type: 'code' };
    }
  }

  // 2. Check Markdown tables (skipping lines inside code fences)
  const inCode = (idx: number) =>
    blocks.some((b) => idx >= b.openIdx && idx <= (b.closeIdx ?? lines.length - 1));

  let i = 0;
  while (i < lines.length) {
    if (!inCode(i)) {
      const t = lines[i].trim();
      if (
        t.startsWith('|') &&
        i + 1 < lines.length &&
        !inCode(i + 1) &&
        /^\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1].trim())
      ) {
        const start = i;
        let end = i + 1;
        while (end + 1 < lines.length && !inCode(end + 1) && lines[end + 1].trim().startsWith('|')) {
          end++;
        }
        if (safeIdx >= start && safeIdx <= end) {
          return { startLine: start, endLine: end, type: 'table' };
        }
        i = end + 1;
        continue;
      }
    }
    i++;
  }

  // 3. Check Obsidian callout blocks
  i = 0;
  while (i < lines.length) {
    if (!inCode(i) && /^>\s*\[!([a-zA-Z]+)\]/.test(lines[i].trim())) {
      const start = i;
      let end = i;
      while (end + 1 < lines.length && !inCode(end + 1) && /^>\s?/.test(lines[end + 1].trim())) {
        end++;
      }
      if (safeIdx >= start && safeIdx <= end) {
        return { startLine: start, endLine: end, type: 'callout' };
      }
      i = end + 1;
      continue;
    }
    i++;
  }

  return { startLine: safeIdx, endLine: safeIdx, type: 'line' };
}

/**
 * Moves the enclosing block (code block, table, callout, or line) up by one block/line.
 */
export function moveBlockUp(doc: string, cursorPos: number): TextTransformResult | null {
  const lines = doc.split('\n');
  const offsets = getLineOffsets(lines);
  const lineIdx = locateLineIndex(offsets, cursorPos);
  const block = findBlockRangeAtLine(lines, lineIdx);
  if (block.startLine === 0) return null;

  const prevBlock = findBlockRangeAtLine(lines, block.startLine - 1);
  const swapStart = prevBlock.startLine;
  const cursorDelta = Math.max(0, cursorPos - offsets[block.startLine].from);

  const aboveSlice = lines.slice(swapStart, block.startLine);
  const blockSlice = lines.slice(block.startLine, block.endLine + 1);
  const nextLines = [
    ...lines.slice(0, swapStart),
    ...blockSlice,
    ...aboveSlice,
    ...lines.slice(block.endLine + 1),
  ];

  const nextDoc = nextLines.join('\n');
  const nextOffsets = getLineOffsets(nextLines);
  const nextBlockLen = blockSlice.join('\n').length;
  const nextPos = nextOffsets[swapStart].from + Math.min(cursorDelta, nextBlockLen);
  return { doc: nextDoc, from: nextPos, to: nextPos };
}

/**
 * Moves the enclosing block (code block, table, callout, or line) down by one block/line.
 */
export function moveBlockDown(doc: string, cursorPos: number): TextTransformResult | null {
  const lines = doc.split('\n');
  const offsets = getLineOffsets(lines);
  const lineIdx = locateLineIndex(offsets, cursorPos);
  const block = findBlockRangeAtLine(lines, lineIdx);
  if (block.endLine >= lines.length - 1) return null;

  const nextBlock = findBlockRangeAtLine(lines, block.endLine + 1);
  const swapEnd = nextBlock.endLine;
  const cursorDelta = Math.max(0, cursorPos - offsets[block.startLine].from);

  const blockSlice = lines.slice(block.startLine, block.endLine + 1);
  const belowSlice = lines.slice(block.endLine + 1, swapEnd + 1);
  const nextLines = [
    ...lines.slice(0, block.startLine),
    ...belowSlice,
    ...blockSlice,
    ...lines.slice(swapEnd + 1),
  ];

  const nextDoc = nextLines.join('\n');
  const nextOffsets = getLineOffsets(nextLines);
  const newStartLine = block.startLine + belowSlice.length;
  const nextBlockLen = blockSlice.join('\n').length;
  const nextPos = nextOffsets[newStartLine].from + Math.min(cursorDelta, nextBlockLen);
  return { doc: nextDoc, from: nextPos, to: nextPos };
}

/**
 * Deletes the entire enclosing block (code block, table, callout, or line).
 */
export function deleteBlock(doc: string, cursorPos: number): TextTransformResult {
  const lines = doc.split('\n');
  const offsets = getLineOffsets(lines);
  const lineIdx = locateLineIndex(offsets, cursorPos);
  const block = findBlockRangeAtLine(lines, lineIdx);

  const nextLines = [
    ...lines.slice(0, block.startLine),
    ...lines.slice(block.endLine + 1),
  ];
  if (nextLines.length === 0) {
    nextLines.push('');
  }

  const nextDoc = nextLines.join('\n');
  const nextOffsets = getLineOffsets(nextLines);
  const targetLine = Math.min(block.startLine, nextLines.length - 1);
  const targetPos = nextOffsets[targetLine].from;
  return { doc: nextDoc, from: targetPos, to: targetPos };
}

/**
 * Computes exact replacement range and cursor position when inserting a slash command
 * on a line, handling line-start, indented, and mid-line invocations cleanly.
 */
export function computeSlashInsert(
  lineText: string,
  slashStartCol: number,
  insertText: string,
  cursorOffset: number | undefined,
  isBlock: boolean
): { replaceFromCol: number; insert: string; nextCursorOffset: number } {
  const beforeSlash = lineText.slice(0, slashStartCol);
  const baseOffset = cursorOffset ?? insertText.length;

  if (isBlock) {
    if (beforeSlash.length > 0 && beforeSlash.trim() === '') {
      return {
        replaceFromCol: 0,
        insert: insertText,
        nextCursorOffset: baseOffset,
      };
    }
    if (beforeSlash.trim().length > 0) {
      return {
        replaceFromCol: slashStartCol,
        insert: `\n${insertText}`,
        nextCursorOffset: 1 + baseOffset,
      };
    }
  }

  return {
    replaceFromCol: slashStartCol,
    insert: insertText,
    nextCursorOffset: baseOffset,
  };
}

export interface ParsedMarkdownImage {
  alt: string;
  url: string;
  width?: number;
  height?: number;
}

/**
 * Parses a standalone or inline Markdown image token `![alt](url)` or `![alt|WxH](url)` (with optional title).
 */
export function parseMarkdownImage(raw: string): ParsedMarkdownImage | null {
  const match = /^!\[([^[\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?|)\)$/.exec(raw.trim());
  if (!match) return null;
  const rawBracket = match[1].trim();
  const rawUrlPart = match[2].trim();
  const url = rawUrlPart.replace(/\s+"[^"]*"$/, '').trim();

  let alt = rawBracket;
  let width: number | undefined;
  let height: number | undefined;

  const sizeMatch = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(rawBracket);
  if (sizeMatch) {
    alt = sizeMatch[1].trim();
    const parsedW = Number(sizeMatch[2]);
    const parsedH = sizeMatch[3] ? Number(sizeMatch[3]) : undefined;
    if (parsedW > 0) width = parsedW;
    if (parsedH && parsedH > 0) height = parsedH;
  }

  return {
    alt,
    url,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

/**
 * Returns true if the image URL represents an unfilled placeholder (e.g. `url` or empty).
 */
export function isImagePlaceholderUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'url' ||
    normalized === 'image-url' ||
    normalized === 'path/to/image.png'
  );
}

/**
 * Serializes alt text, URL, and optional width/height into standard Markdown image syntax `![alt|WxH](url)`.
 */
export function serializeMarkdownImage(
  alt: string,
  url: string,
  width?: number,
  height?: number
): string {
  const cleanAlt = alt.replace(/[[\]\r\n|]/g, '').trim() || 'Image';
  const cleanUrl = url.trim().replace(/\s+/g, '%20') || 'url';
  const w = width && width > 0 ? Math.round(width) : undefined;
  const h = height && height > 0 ? Math.round(height) : undefined;
  const sizeSuffix = w && h ? `|${w}x${h}` : w ? `|${w}` : '';
  return `![${cleanAlt}${sizeSuffix}](${cleanUrl})`;
}




