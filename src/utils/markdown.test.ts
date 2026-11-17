import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBacklinks,
  computeNoteStats,
  extractHeadings,
  extractTags,
  extractWikilinks,
  filenameToNoteTitle,
  hashContent,
  noteTitleToFilename,
  toggleMarkdownCheckbox,
} from './markdown';
import { Note } from '../types/vault';

test('extractWikilinks handles plain, aliased, and heading links uniquely', () => {
  const md = 'See [[Project Alpha]], [[Project Alpha|Alias]], and [[Design Doc#Layout]].';
  assert.deepEqual(extractWikilinks(md), ['Project Alpha', 'Design Doc']);
});

test('extractTags ignores code blocks and extracts lowercase tags', () => {
  const md = 'Notes on #Architecture and #sync-engine.\n```\n#IgnoredCodeTag\n```\nAlso `#inlineIgnored` and #Research.';
  assert.deepEqual(extractTags(md), ['architecture', 'sync-engine', 'research']);
});

test('extractHeadings captures H1-H3 outside code fences including outliner bullets', () => {
  const md = '# Top\nIntro\n```\n## Not a heading\n```\n- ## Section Two\n  - ### Sub';
  assert.deepEqual(extractHeadings(md), [
    { level: 1, text: 'Top', line: 1 },
    { level: 2, text: 'Section Two', line: 6 },
    { level: 3, text: 'Sub', line: 7 },
  ]);
});

test('computeBacklinks finds linked references and unlinked mentions', () => {
  const notes: Note[] = [
    {
      id: '1',
      title: 'Sync Engine',
      folder: '',
      content: '# Sync Engine',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: '2',
      title: 'Architecture',
      folder: 'Engineering',
      content: 'The [[Sync Engine]] polls Google Drive.',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: '3',
      title: 'Daily Log',
      folder: 'Daily Notes',
      content: 'Reviewed the sync engine latency today.',
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const backlinks = computeBacklinks(notes[0], notes);
  assert.equal(backlinks.length, 2);
  assert.equal(backlinks[0].isUnlinkedMention, false);
  assert.equal(backlinks[0].sourceNoteId, '2');
  assert.equal(backlinks[1].isUnlinkedMention, true);
  assert.equal(backlinks[1].sourceNoteId, '3');
});

test('noteTitleToFilename and filenameToNoteTitle sanitize properly', () => {
  assert.equal(noteTitleToFilename('Q4/2026: Plan'), 'Q4-2026- Plan.md');
  assert.equal(filenameToNoteTitle('Welcome to Kurip.md'), 'Welcome to Kurip');
});

test('toggleMarkdownCheckbox flips task status on target line', () => {
  const md = '- [ ] First task\n- [x] Done task';
  const toggled = toggleMarkdownCheckbox(md, 0);
  assert.equal(toggled, '- [x] First task\n- [x] Done task');
  assert.equal(toggleMarkdownCheckbox(toggled, 1), '- [x] First task\n- [ ] Done task');
});

test('computeNoteStats and hashContent produce deterministic values', () => {
  const stats = computeNoteStats('Hello world from Kurip vault');
  assert.equal(stats.words, 5);
  assert.equal(stats.readingMinutes, 1);
  assert.equal(hashContent('abc'), hashContent('abc'));
  assert.notEqual(hashContent('abc'), hashContent('abd'));
});
