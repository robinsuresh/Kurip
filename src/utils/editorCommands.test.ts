import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCodeBlockEnter,
  computeCodeBlockExit,
  computeSlashInsert,
  computeSmartEnterContinuation,
  computeSmartPrefixBackspace,
  deleteBlock,
  findBlockRangeAtLine,
  isImagePlaceholderUrl,
  moveBlockDown,
  moveBlockUp,
  parseCalloutHeader,
  parseMarkdownImage,
  serializeMarkdownImage,
  serializeMarkdownTable,
  toggleTaskLine,
  toggleWrapFormatting,
} from './editorCommands';

test('toggleWrapFormatting wraps and unwraps selection or word under cursor', () => {
  const wrapped = toggleWrapFormatting('Hello world', 6, 11, '**');
  assert.equal(wrapped.doc, 'Hello **world**');
  assert.equal(wrapped.from, 8);
  assert.equal(wrapped.to, 13);

  const unwrapped = toggleWrapFormatting(wrapped.doc, wrapped.from, wrapped.to, '**');
  assert.equal(unwrapped.doc, 'Hello world');
  assert.equal(unwrapped.from, 6);
  assert.equal(unwrapped.to, 11);

  const wordCursor = toggleWrapFormatting('Hello world', 8, 8, '==');
  assert.equal(wordCursor.doc, 'Hello ==world==');
});

test('toggleWrapFormatting keeps boundary whitespace outside markers and ignores whitespace-only selections', () => {
  const res = toggleWrapFormatting('> highlighted note test', 2, 19, '==');
  assert.equal(res.doc, '> ==highlighted note== test');
  assert.equal(res.doc.slice(res.from, res.to), 'highlighted note');

  const wsOnly = toggleWrapFormatting('Hello   world', 5, 8, '==');
  assert.equal(wsOnly.doc, 'Hello   world');

  // Cursor inside ==word== should not consume = into word boundary
  const cursorInside = toggleWrapFormatting('==highlighted note==', 16, 16, '==');
  assert.equal(cursorInside.doc, '==highlighted== note');
});

test('toggleWrapFormatting cleanly merges/unwraps overlapping, partial, and fragmented markers inside callouts', () => {
  // Extending highlight when selection starts after hidden == in Live Preview
  const extended = toggleWrapFormatting('> ==highlighted note== test', 4, 27, '==');
  assert.equal(extended.doc, '> ==highlighted note test==');
  assert.equal(extended.doc.slice(extended.from, extended.to), 'highlighted note test');

  // Clicking highlight again on the full span unwraps cleanly
  const toggledOff = toggleWrapFormatting(extended.doc, extended.from, extended.to, '==');
  assert.equal(toggledOff.doc, '> highlighted note test');

  // Recovering from broken/fragmented markers like `==highlighted note == test == ==`
  const broken = '> ==highlighted note == test == ==';
  const fixed = toggleWrapFormatting(broken, 4, 32, '==');
  assert.equal(fixed.doc, '> ==highlighted note test== ');
  assert.equal(fixed.doc.slice(fixed.from, fixed.to), 'highlighted note test');

  // Unwrapping when existing span had trailing space inside markers
  const unwrapTrailingWs = toggleWrapFormatting('> ==highlighted note ==', 4, 20, '==');
  assert.equal(unwrapTrailingWs.doc, '> highlighted note ');

  // Preserving callout/quote prefix `> ` if selection begins at column 0
  const prefixSafe = toggleWrapFormatting('> highlighted note', 0, 18, '==');
  assert.equal(prefixSafe.doc, '> ==highlighted note==');

  // Bold vs italic disambiguation
  const boldAndItalic = toggleWrapFormatting('**hello**', 2, 7, '*');
  assert.equal(boldAndItalic.doc, '***hello***');
  const unItalic = toggleWrapFormatting(boldAndItalic.doc, boldAndItalic.from, boldAndItalic.to, '*');
  assert.equal(unItalic.doc, '**hello**');
});

test('toggleTaskLine cycles plain, bullet, unchecked, and checked tasks', () => {
  assert.equal(toggleTaskLine('Write tests'), '- [ ] Write tests');
  assert.equal(toggleTaskLine('  - Write tests'), '  - [ ] Write tests');
  assert.equal(toggleTaskLine('  - [ ] Write tests'), '  - [x] Write tests');
  assert.equal(toggleTaskLine('  - [x] Write tests'), '  - [ ] Write tests');
});

test('computeSmartEnterContinuation continues tasks, bullets, numbered lists, and exits empty items', () => {
  assert.deepEqual(computeSmartEnterContinuation('  - [ ] Task one', 16), {
    insertPrefix: '  - [ ] ',
  });
  assert.deepEqual(computeSmartEnterContinuation('  - [ ] ', 8), {
    replaceLineWith: '',
    insertPrefix: '',
  });
  assert.deepEqual(computeSmartEnterContinuation('2. Second item', 14), {
    insertPrefix: '3. ',
  });
  assert.deepEqual(computeSmartEnterContinuation('> Quote line', 12), {
    insertPrefix: '> ',
  });
  assert.equal(computeSmartEnterContinuation('Normal prose line', 17), null);
});

test('parseCalloutHeader extracts Obsidian callout type and title', () => {
  assert.deepEqual(parseCalloutHeader('> [!tip] Sync Strategy'), {
    type: 'tip',
    title: 'Sync Strategy',
  });
  assert.deepEqual(parseCalloutHeader('> [!warning]'), {
    type: 'warning',
    title: 'Warning',
  });
  assert.equal(parseCalloutHeader('> Regular quote'), null);
});

test('computeSmartPrefixBackspace unwraps hidden Live Preview line prefixes cleanly', () => {
  assert.deepEqual(computeSmartPrefixBackspace('## Section Title', 3), {
    replaceLineWith: 'Section Title',
    nextCol: 0,
  });
  assert.deepEqual(computeSmartPrefixBackspace('### Subheading', 4), {
    replaceLineWith: 'Subheading',
    nextCol: 0,
  });
  assert.deepEqual(computeSmartPrefixBackspace('  - [ ] Task', 8), {
    replaceLineWith: '  - Task',
    nextCol: 4,
  });
  assert.deepEqual(computeSmartPrefixBackspace('  - Bullet', 4), {
    replaceLineWith: '  Bullet',
    nextCol: 2,
  });
  assert.deepEqual(computeSmartPrefixBackspace('> Quote', 2), {
    replaceLineWith: 'Quote',
    nextCol: 0,
  });
  assert.equal(computeSmartPrefixBackspace('## Section Title', 6), null);
});

test('serializeMarkdownTable formats headers and rows cleanly', () => {
  const md = serializeMarkdownTable(['Name', 'Status'], [['Sync', 'Ready'], ['Graph', 'Done']]);
  assert.equal(
    md,
    '| Name | Status |\n| --- | --- |\n| Sync | Ready |\n| Graph | Done |'
  );
});

test('computeCodeBlockEnter auto-pairs opening fence and exits on extra Enter', () => {
  const autoPaired = computeCodeBlockEnter('```ts', 5);
  assert.deepEqual(autoPaired, {
    doc: '```ts\n\n```\n',
    from: 6,
    to: 6,
  });

  // Does not exit mid-block when code follows
  const midDoc = '```ts\nconst a = 1;\n\nconst b = 2;\n```';
  assert.equal(computeCodeBlockEnter(midDoc, 19), null);

  // Exits closed block on extra Enter at trailing empty line
  const closedDoc = '```ts\nconst a = 1;\n\n```\n';
  const exited = computeCodeBlockEnter(closedDoc, 19);
  assert.deepEqual(exited, {
    doc: '```ts\nconst a = 1;\n```\n',
    from: 23,
    to: 23,
  });

  // Closes and exits an unclosed block on extra Enter at trailing empty line
  const unclosedDoc = '```ts\nconst a = 1;\n';
  const closedExited = computeCodeBlockEnter(unclosedDoc, 19);
  assert.deepEqual(closedExited, {
    doc: '```ts\nconst a = 1;\n```\n',
    from: 23,
    to: 23,
  });
});

test('computeCodeBlockExit jumps cursor immediately after closing fence', () => {
  const doc = '```ts\nconst a = 1;\n```\nNext line';
  const exited = computeCodeBlockExit(doc, 10);
  assert.deepEqual(exited, {
    doc: '```ts\nconst a = 1;\n```\n\nNext line',
    from: 23,
    to: 23,
  });
});

test('findBlockRangeAtLine, moveBlockUp, moveBlockDown, and deleteBlock handle multi-line blocks atomically', () => {
  const doc = [
    'Intro paragraph',
    '```ts',
    'const x = 1;',
    '```',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n');
  const lines = doc.split('\n');

  assert.deepEqual(findBlockRangeAtLine(lines, 2), {
    startLine: 1,
    endLine: 3,
    type: 'code',
  });
  assert.deepEqual(findBlockRangeAtLine(lines, 5), {
    startLine: 4,
    endLine: 6,
    type: 'table',
  });

  const movedUp = moveBlockUp(doc, doc.indexOf('const x = 1;'));
  assert.ok(movedUp);
  assert.equal(
    movedUp.doc,
    ['```ts', 'const x = 1;', '```', 'Intro paragraph', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n')
  );

  const movedDown = moveBlockDown(movedUp.doc, movedUp.doc.indexOf('const x = 1;'));
  assert.ok(movedDown);
  assert.equal(movedDown.doc, doc);

  const tableDeleted = deleteBlock(doc, doc.indexOf('| 1 | 2 |'));
  assert.equal(tableDeleted.doc, ['Intro paragraph', '```ts', 'const x = 1;', '```'].join('\n'));
});

test('computeSlashInsert handles H3 block and inline Page Link insertion cleanly', () => {
  // H3 at line start or indented whitespace starts at col 0
  assert.deepEqual(computeSlashInsert('/h3', 0, '### ', undefined, true), {
    replaceFromCol: 0,
    insert: '### ',
    nextCursorOffset: 4,
  });
  assert.deepEqual(computeSlashInsert('  /h3', 2, '### ', undefined, true), {
    replaceFromCol: 0,
    insert: '### ',
    nextCursorOffset: 4,
  });
  // H3 after text starts a new line
  assert.deepEqual(computeSlashInsert('Intro /h3', 6, '### ', undefined, true), {
    replaceFromCol: 6,
    insert: '\n### ',
    nextCursorOffset: 5,
  });
  // Inline Page Link replaces only /query in-place
  assert.deepEqual(computeSlashInsert('See /page', 4, '[[', undefined, false), {
    replaceFromCol: 4,
    insert: '[[',
    nextCursorOffset: 2,
  });
});

test('parseMarkdownImage, isImagePlaceholderUrl, and serializeMarkdownImage handle local, remote, and sized images', () => {
  assert.deepEqual(parseMarkdownImage('![alt](url)'), { alt: 'alt', url: 'url' });
  assert.deepEqual(parseMarkdownImage('![System Diagram](/assets/diagram.png "Arch")'), {
    alt: 'System Diagram',
    url: '/assets/diagram.png',
  });
  assert.deepEqual(parseMarkdownImage('![Diagram|320x180](local://abc/photo.png)'), {
    alt: 'Diagram',
    url: 'local://abc/photo.png',
    width: 320,
    height: 180,
  });
  assert.deepEqual(parseMarkdownImage('![|240](/assets/thumb.png)'), {
    alt: '',
    url: '/assets/thumb.png',
    width: 240,
  });
  assert.deepEqual(parseMarkdownImage('![](local://abc/photo.png)'), {
    alt: '',
    url: 'local://abc/photo.png',
  });
  assert.equal(parseMarkdownImage('[regular link](https://example.com)'), null);

  assert.equal(isImagePlaceholderUrl('url'), true);
  assert.equal(isImagePlaceholderUrl(''), true);
  assert.equal(isImagePlaceholderUrl('/assets/diagram.png'), false);
  assert.equal(isImagePlaceholderUrl('local://abc/photo.png'), false);

  assert.equal(serializeMarkdownImage('My Photo', '/assets/my photo.png'), '![My Photo](/assets/my%20photo.png)');
  assert.equal(serializeMarkdownImage('Diagram', '/assets/a.png', 320.4, 180.6), '![Diagram|320x181](/assets/a.png)');
  assert.equal(serializeMarkdownImage('Diagram', '/assets/a.png', 320), '![Diagram|320](/assets/a.png)');
  assert.equal(serializeMarkdownImage('', ''), '![Image](url)');
});




