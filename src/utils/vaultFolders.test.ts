import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeleteFolder } from './vaultFolders';
import { Note, TabItem } from '../types/vault';

const makeNote = (id: string, title: string, folder: string): Note => ({
  id,
  title,
  folder,
  content: `# ${title}`,
  createdAt: 1000,
  updatedAt: 1000,
  dirty: false,
});

test('applyDeleteFolder removes an empty folder without modifying notes or tabs', () => {
  const notes = [makeNote('n1', 'Welcome', ''), makeNote('n2', 'Design', 'Engineering')];
  const tabs: TabItem[] = [{ id: 'n1', type: 'note', title: 'Welcome' }];

  const result = applyDeleteFolder({
    notes,
    folders: ['Engineering', 'Archive'],
    tabs,
    activeTabId: 'n1',
    folderName: 'Archive',
    mode: 'delete-notes',
  });

  assert.deepEqual(result.nextFolders, ['Engineering']);
  assert.equal(result.nextNotes.length, 2);
  assert.equal(result.removedNotes.length, 0);
  assert.equal(result.nextActiveTabId, 'n1');
});

test('applyDeleteFolder with delete-notes removes folder notes, closes tabs, and selects fallback tab', () => {
  const notes = [
    makeNote('n1', 'Welcome', ''),
    makeNote('n2', 'Arch', 'Engineering'),
    makeNote('n3', 'Roadmap', 'Engineering'),
  ];
  const tabs: TabItem[] = [
    { id: 'n1', type: 'note', title: 'Welcome' },
    { id: 'n2', type: 'note', title: 'Arch' },
    { id: 'n3', type: 'note', title: 'Roadmap' },
  ];

  const result = applyDeleteFolder({
    notes,
    folders: ['Engineering'],
    tabs,
    activeTabId: 'n2',
    folderName: 'Engineering',
    mode: 'delete-notes',
  });

  assert.deepEqual(result.nextFolders, []);
  assert.deepEqual(result.nextNotes.map((n) => n.id), ['n1']);
  assert.deepEqual(result.removedNotes.map((n) => n.id), ['n2', 'n3']);
  assert.deepEqual(result.nextTabs.map((t) => t.id), ['n1']);
  assert.equal(result.nextActiveTabId, 'n1');
});

test('applyDeleteFolder with move-to-root moves contained notes to root and marks them dirty', () => {
  const notes = [
    makeNote('n1', 'Welcome', ''),
    makeNote('n2', 'Research Index', 'Research'),
  ];
  const tabs: TabItem[] = [{ id: 'n2', type: 'note', title: 'Research Index' }];

  const result = applyDeleteFolder({
    notes,
    folders: ['Research'],
    tabs,
    activeTabId: 'n2',
    folderName: 'Research',
    mode: 'move-to-root',
    now: 5000,
  });

  assert.deepEqual(result.nextFolders, []);
  assert.equal(result.removedNotes.length, 0);
  assert.equal(result.nextNotes[1].folder, '');
  assert.equal(result.nextNotes[1].dirty, true);
  assert.equal(result.nextNotes[1].updatedAt, 5000);
  assert.equal(result.nextActiveTabId, 'n2');
});
