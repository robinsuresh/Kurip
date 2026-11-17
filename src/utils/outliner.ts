export interface OutlinerBlock {
  id: string;
  content: string;
  level: number;
  collapsed?: boolean;
}

function makeBlockId(index: number): string {
  return `blk-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Parses a Markdown string (including Logseq-style indented bullets and standard Markdown)
 * into a normalized flat list of OutlinerBlocks with valid indentation levels.
 */
export function parseMarkdownToBlocks(markdown: string): OutlinerBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: OutlinerBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Preserve fenced code blocks inside a single block
    const fenceMatch = /^(\s*)```/.exec(line);
    if (fenceMatch) {
      const indentSpaces = fenceMatch[1].length;
      const level = Math.floor(indentSpaces / 2);
      const codeLines = [line.trimStart()];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        codeLines.push(nextLine.slice(Math.min(indentSpaces, nextLine.search(/\S|$/) )));
        if (nextLine.trim().startsWith('```')) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({
        id: makeBlockId(blocks.length),
        content: codeLines.join('\n'),
        level,
      });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Standard Logseq/Markdown bullet line: "  - text" or "* text"
    const bulletMatch = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const level = Math.floor(bulletMatch[1].replace(/\t/g, '  ').length / 2);
      let content = bulletMatch[2];
      // Convert Markdown checkbox "- [ ] foo" / "- [x] foo" to clean internal representation
      if (/^\[ \]\s*/.test(content)) {
        content = 'TODO ' + content.replace(/^\[ \]\s*/, '');
      } else if (/^\[[xX]\]\s*/.test(content)) {
        content = 'DONE ' + content.replace(/^\[[xX]\]\s*/, '');
      }
      blocks.push({
        id: makeBlockId(blocks.length),
        content,
        level,
      });
      i++;
      continue;
    }

    // Non-bullet line (heading, paragraph, blockquote, ordered item) -> top-level block
    blocks.push({
      id: makeBlockId(blocks.length),
      content: line.trim(),
      level: 0,
    });
    i++;
  }

  if (blocks.length === 0) {
    return [{ id: makeBlockId(0), content: '', level: 0 }];
  }

  // Normalize levels so first block is 0 and no child jumps more than +1 above previous
  blocks[0].level = 0;
  for (let idx = 1; idx < blocks.length; idx++) {
    const maxAllowed = blocks[idx - 1].level + 1;
    if (blocks[idx].level > maxAllowed) {
      blocks[idx].level = maxAllowed;
    }
    if (blocks[idx].level < 0) {
      blocks[idx].level = 0;
    }
  }

  return blocks;
}

/**
 * Serializes OutlinerBlocks back into clean Logseq-compatible Markdown
 * for local persistence, wikilink/tag indexing, and Google Drive .md sync.
 */
export function serializeBlocksToMarkdown(blocks: OutlinerBlock[]): string {
  if (blocks.length === 0) return '';

  return blocks
    .map((block) => {
      const indent = '  '.repeat(Math.max(0, block.level));
      let content = block.content;

      // Serialize TODO / DONE cleanly as Markdown task bullets so external Markdown viewers render them too
      if (/^TODO\s+/.test(content)) {
        content = `[ ] ${content.replace(/^TODO\s+/, '')}`;
      } else if (/^DOING\s+/.test(content)) {
        content = `[ ] DOING ${content.replace(/^DOING\s+/, '')}`;
      } else if (/^DONE\s+/.test(content)) {
        content = `[x] ${content.replace(/^DONE\s+/, '')}`;
      }

      if (content.includes('\n')) {
        const indentedLines = content
          .split('\n')
          .map((l, idx) => (idx === 0 ? l : `${indent}  ${l}`))
          .join('\n');
        return `${indent}- ${indentedLines}`;
      }

      return `${indent}- ${content}`;
    })
    .join('\n');
}

/**
 * Returns true if the block at `index` has at least one child block immediately below it.
 */
export function hasBlockChildren(blocks: OutlinerBlock[], index: number): boolean {
  if (index < 0 || index >= blocks.length - 1) return false;
  return blocks[index + 1].level > blocks[index].level;
}

/**
 * Computes the end index (exclusive) of a block's subtree.
 */
export function getSubtreeEndIndex(blocks: OutlinerBlock[], index: number): number {
  const baseLevel = blocks[index].level;
  let end = index + 1;
  while (end < blocks.length && blocks[end].level > baseLevel) {
    end++;
  }
  return end;
}

/**
 * Returns visible blocks respecting collapsed parents and optional zoomedBlockId subtree focus.
 */
export function getVisibleBlocks(
  blocks: OutlinerBlock[],
  zoomedBlockId: string | null = null
): Array<{ block: OutlinerBlock; index: number; hasChildren: boolean; relativeLevel: number }> {
  let startIdx = 0;
  let endIdx = blocks.length;
  let baseLevel = 0;

  if (zoomedBlockId) {
    const foundIdx = blocks.findIndex((b) => b.id === zoomedBlockId);
    if (foundIdx !== -1) {
      startIdx = foundIdx + 1;
      endIdx = getSubtreeEndIndex(blocks, foundIdx);
      baseLevel = blocks[foundIdx].level + 1;
    }
  }

  const visible: Array<{
    block: OutlinerBlock;
    index: number;
    hasChildren: boolean;
    relativeLevel: number;
  }> = [];

  let hiddenAboveLevel: number | null = null;

  for (let i = startIdx; i < endIdx; i++) {
    const block = blocks[i];
    if (hiddenAboveLevel !== null) {
      if (block.level > hiddenAboveLevel) {
        continue;
      }
      hiddenAboveLevel = null;
    }

    const hasChildren = hasBlockChildren(blocks, i);
    visible.push({
      block,
      index: i,
      hasChildren,
      relativeLevel: Math.max(0, block.level - baseLevel),
    });

    if (block.collapsed && hasChildren) {
      hiddenAboveLevel = block.level;
    }
  }

  return visible;
}

/**
 * Returns the ancestor breadcrumb trail leading up to `zoomedBlockId`.
 */
export function getBlockBreadcrumbs(
  blocks: OutlinerBlock[],
  zoomedBlockId: string | null
): OutlinerBlock[] {
  if (!zoomedBlockId) return [];
  const targetIdx = blocks.findIndex((b) => b.id === zoomedBlockId);
  if (targetIdx === -1) return [];

  const chain: OutlinerBlock[] = [blocks[targetIdx]];
  let neededLevel = blocks[targetIdx].level - 1;

  for (let i = targetIdx - 1; i >= 0 && neededLevel >= 0; i--) {
    if (blocks[i].level === neededLevel) {
      chain.unshift(blocks[i]);
      neededLevel--;
    }
  }

  return chain;
}

/**
 * Indents a block (and its subtree) by +1 level if a valid preceding sibling/parent exists.
 */
export function indentBlock(blocks: OutlinerBlock[], blockId: string): OutlinerBlock[] {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx <= 0) return blocks;

  const current = blocks[idx];
  const prev = blocks[idx - 1];
  if (current.level > prev.level) return blocks;

  const end = getSubtreeEndIndex(blocks, idx);
  return blocks.map((b, i) => (i >= idx && i < end ? { ...b, level: b.level + 1 } : b));
}

/**
 * Outdents a block (and its subtree) by -1 level (minimum 0).
 */
export function outdentBlock(blocks: OutlinerBlock[], blockId: string): OutlinerBlock[] {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1 || blocks[idx].level <= 0) return blocks;

  const end = getSubtreeEndIndex(blocks, idx);
  return blocks.map((b, i) =>
    i >= idx && i < end ? { ...b, level: Math.max(0, b.level - 1) } : b
  );
}

/**
 * Inserts a new block right after `blockId` (or as first child if expanded and has children),
 * optionally splitting `blocks[idx].content` at `splitPos`.
 */
export function insertBlockAfter(
  blocks: OutlinerBlock[],
  blockId: string,
  splitPos?: number
): { blocks: OutlinerBlock[]; newBlockId: string } {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) {
    const newId = makeBlockId(blocks.length);
    return { blocks: [...blocks, { id: newId, content: '', level: 0 }], newBlockId: newId };
  }

  const target = blocks[idx];
  let beforeText = target.content;
  let afterText = '';

  if (splitPos !== undefined && splitPos >= 0 && splitPos <= target.content.length) {
    beforeText = target.content.slice(0, splitPos);
    afterText = target.content.slice(splitPos);
  }

  const childrenExist = hasBlockChildren(blocks, idx);
  const newLevel = childrenExist && !target.collapsed ? target.level + 1 : target.level;
  const newBlockId = makeBlockId(blocks.length + 1);

  const next = blocks.map((b, i) => (i === idx ? { ...b, content: beforeText } : b));
  next.splice(idx + 1, 0, { id: newBlockId, content: afterText, level: newLevel });

  return { blocks: next, newBlockId };
}

/**
 * Deletes an empty block or merges its content into the previous block on Backspace at start.
 */
export function mergeOrRemoveBlock(
  blocks: OutlinerBlock[],
  blockId: string
): { blocks: OutlinerBlock[]; focusBlockId: string | null; cursorOffset: number } {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx <= 0 || blocks.length <= 1) {
    return { blocks, focusBlockId: blocks[0]?.id ?? null, cursorOffset: 0 };
  }

  const current = blocks[idx];
  const prev = blocks[idx - 1];
  const cursorOffset = prev.content.length;

  const next = blocks.map((b, i) =>
    i === idx - 1 ? { ...b, content: prev.content + current.content } : b
  );
  next.splice(idx, 1);

  return { blocks: next, focusBlockId: prev.id, cursorOffset };
}

/**
 * Toggles block collapse state.
 */
export function toggleBlockCollapsed(blocks: OutlinerBlock[], blockId: string): OutlinerBlock[] {
  return blocks.map((b) => (b.id === blockId ? { ...b, collapsed: !b.collapsed } : b));
}

/**
 * Cycles or toggles task status (TODO -> DOING -> DONE -> TODO) on a block's content.
 */
export function cycleBlockTaskStatus(content: string): string {
  if (/^TODO\s+/.test(content)) {
    return content.replace(/^TODO\s+/, 'DONE ');
  }
  if (/^DOING\s+/.test(content)) {
    return content.replace(/^DOING\s+/, 'DONE ');
  }
  if (/^DONE\s+/.test(content)) {
    return content.replace(/^DONE\s+/, 'TODO ');
  }
  return `TODO ${content}`;
}
