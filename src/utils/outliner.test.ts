import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleBlockTaskStatus,
  getBlockBreadcrumbs,
  getVisibleBlocks,
  indentBlock,
  insertBlockAfter,
  mergeOrRemoveBlock,
  outdentBlock,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  toggleBlockCollapsed,
} from './outliner';

test('parseMarkdownToBlocks and serializeBlocksToMarkdown round-trip nested bullets and tasks', () => {
  const md = `- Top level block\n  - Nested child\n    - Deep grandchild\n  - [ ] Task item\n  - [x] Completed item`;
  const blocks = parseMarkdownToBlocks(md);

  assert.equal(blocks.length, 5);
  assert.equal(blocks[0].level, 0);
  assert.equal(blocks[1].level, 1);
  assert.equal(blocks[2].level, 2);
  assert.equal(blocks[3].content, 'TODO Task item');
  assert.equal(blocks[4].content, 'DONE Completed item');

  const serialized = serializeBlocksToMarkdown(blocks);
  assert.equal(serialized, md);
});

test('indentBlock and outdentBlock shift a block and its entire subtree', () => {
  const blocks = parseMarkdownToBlocks(`- Parent A\n- Parent B\n  - Child B1`);
  const bId = blocks[1].id;

  const indented = indentBlock(blocks, bId);
  assert.equal(indented[1].level, 1);
  assert.equal(indented[2].level, 2);

  const outdented = outdentBlock(indented, bId);
  assert.equal(outdented[1].level, 0);
  assert.equal(outdented[2].level, 1);
});

test('insertBlockAfter splits text at cursor and respects child nesting', () => {
  const blocks = parseMarkdownToBlocks(`- Hello World`);
  const firstId = blocks[0].id;

  const res = insertBlockAfter(blocks, firstId, 5);
  assert.equal(res.blocks.length, 2);
  assert.equal(res.blocks[0].content, 'Hello');
  assert.equal(res.blocks[1].content, ' World');
  assert.equal(res.blocks[1].id, res.newBlockId);
});

test('mergeOrRemoveBlock merges current block into previous block on Backspace', () => {
  const blocks = parseMarkdownToBlocks(`- Alpha\n- Beta`);
  const res = mergeOrRemoveBlock(blocks, blocks[1].id);
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].content, 'AlphaBeta');
  assert.equal(res.cursorOffset, 5);
});

test('getVisibleBlocks hides collapsed descendants and supports zoom breadcrumbs', () => {
  const blocks = parseMarkdownToBlocks(`- Root\n  - Child\n    - Grandchild\n- Sibling`);
  const collapsed = toggleBlockCollapsed(blocks, blocks[0].id);
  const visible = getVisibleBlocks(collapsed);
  assert.equal(visible.length, 2);
  assert.equal(visible[0].block.content, 'Root');
  assert.equal(visible[1].block.content, 'Sibling');

  const zoomed = getVisibleBlocks(blocks, blocks[1].id);
  assert.equal(zoomed.length, 1);
  assert.equal(zoomed[0].block.content, 'Grandchild');
  assert.equal(zoomed[0].relativeLevel, 0);

  const crumbs = getBlockBreadcrumbs(blocks, blocks[1].id);
  assert.deepEqual(
    crumbs.map((c) => c.content),
    ['Root', 'Child']
  );
});

test('cycleBlockTaskStatus toggles TODO and DONE prefixes', () => {
  assert.equal(cycleBlockTaskStatus('TODO Ship feature'), 'DONE Ship feature');
  assert.equal(cycleBlockTaskStatus('DONE Ship feature'), 'TODO Ship feature');
});
