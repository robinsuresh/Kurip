import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyncPlan,
  reconcileEditorExternalContent,
  reconcileSyncResults,
  resolvePullOutcome,
} from './sync';
import { hashContent } from './markdown';
import { Note, RemoteDriveFile } from '../types/vault';

test('buildSyncPlan separates new local notes, dirty updates, and remote pulls', () => {
  const syncedContent = '# Clean';
  const localNotes: Note[] = [
    {
      id: 'n1',
      title: 'Local Only',
      folder: '',
      content: 'Brand new note',
      createdAt: 100,
      updatedAt: 100,
      dirty: true,
    },
    {
      id: 'n2',
      title: 'Clean Note',
      folder: '',
      content: syncedContent,
      createdAt: 100,
      updatedAt: 100,
      driveFileId: 'drv-2',
      driveModifiedTime: '2026-11-16T08:00:00.000Z',
      lastSyncedHash: hashContent(syncedContent),
      dirty: false,
    },
    {
      id: 'n3',
      title: 'Edited Note',
      folder: '',
      content: 'Updated locally',
      createdAt: 100,
      updatedAt: 200,
      driveFileId: 'drv-3',
      driveModifiedTime: '2026-11-16T08:00:00.000Z',
      lastSyncedHash: hashContent('Old content'),
      dirty: true,
    },
  ];

  const remoteFiles: RemoteDriveFile[] = [
    { id: 'drv-2', name: 'Clean Note.md', modifiedTime: '2026-11-16T08:00:00.000Z' },
    { id: 'drv-3', name: 'Edited Note.md', modifiedTime: '2026-11-16T08:00:00.000Z' },
    { id: 'drv-4', name: 'Remote Only.md', modifiedTime: '2026-11-16T08:05:00.000Z' },
  ];

  const plan = buildSyncPlan(localNotes, remoteFiles);
  assert.equal(plan.toCreateInDrive.length, 1);
  assert.equal(plan.toCreateInDrive[0].id, 'n1');
  assert.equal(plan.toUpdateInDrive.length, 1);
  assert.equal(plan.toUpdateInDrive[0].id, 'n3');
  assert.equal(plan.toPullFromDrive.length, 1);
  assert.equal(plan.toPullFromDrive[0].remote.id, 'drv-4');
  assert.equal(plan.unchangedCount, 1);
});

test('resolvePullOutcome detects conflict when both local dirty and remote differ', () => {
  const local: Note = {
    id: 'n1',
    title: 'Shared Note',
    folder: '',
    content: 'Local edit',
    createdAt: 100,
    updatedAt: 200,
    driveFileId: 'drv-1',
    driveModifiedTime: '2026-11-16T08:00:00.000Z',
    lastSyncedHash: hashContent('Original'),
    dirty: true,
  };

  const remote: RemoteDriveFile = {
    id: 'drv-1',
    name: 'Shared Note.md',
    modifiedTime: '2026-11-16T08:05:00.000Z',
  };

  const outcome = resolvePullOutcome(local, 'Remote edit from another device', remote);
  assert.equal(outcome.status, 'conflict');

  const identicalOutcome = resolvePullOutcome(local, 'Local edit', remote);
  assert.equal(identicalOutcome.status, 'already_identical');
});

test('reconcileSyncResults preserves newer keystrokes typed while upload or download was in-flight', () => {
  const latestNotes: Note[] = [
    {
      id: 'n-typing',
      title: 'Drafting',
      folder: '',
      content: 'First sentence. Second sentence typed mid-sync!',
      createdAt: 100,
      updatedAt: 500,
      driveFileId: 'drv-1',
      driveModifiedTime: '2026-11-17T08:00:00.000Z',
      lastSyncedHash: hashContent('Old'),
      dirty: true,
    },
    {
      id: 'n-clean',
      title: 'Clean',
      folder: '',
      content: 'Unchanged text',
      createdAt: 100,
      updatedAt: 200,
      driveFileId: 'drv-2',
      driveModifiedTime: '2026-11-17T08:00:00.000Z',
      lastSyncedHash: hashContent('Unchanged text'),
      dirty: false,
    },
    {
      id: 'n-started-typing-during-pull',
      title: 'Pulled',
      folder: '',
      content: 'User started writing before download finished',
      createdAt: 100,
      updatedAt: 520,
      driveFileId: 'drv-3',
      driveModifiedTime: '2026-11-17T08:00:00.000Z',
      lastSyncedHash: hashContent('Base'),
      dirty: true,
    },
  ];

  const result = reconcileSyncResults(latestNotes, {
    uploads: [
      {
        noteId: 'n-typing',
        driveFileId: 'drv-1',
        driveModifiedTime: '2026-11-17T08:05:00.000Z',
        pushedContent: 'First sentence.',
        pushedTitle: 'Drafting',
        pushedFolder: '',
        action: 'push',
      },
      {
        noteId: 'n-clean',
        driveFileId: 'drv-2',
        driveModifiedTime: '2026-11-17T08:05:00.000Z',
        pushedContent: 'Unchanged text',
        pushedTitle: 'Clean',
        pushedFolder: '',
        action: 'push',
      },
    ],
    pulls: [
      {
        existingLocalId: 'n-started-typing-during-pull',
        remote: {
          id: 'drv-3',
          name: 'Pulled.md',
          modifiedTime: '2026-11-17T08:05:00.000Z',
        },
        remoteContent: 'Older remote change',
      },
    ],
  });

  const typingNote = result.nextNotes.find((n) => n.id === 'n-typing')!;
  assert.equal(typingNote.content, 'First sentence. Second sentence typed mid-sync!');
  assert.equal(typingNote.dirty, true);
  assert.equal(typingNote.driveModifiedTime, '2026-11-17T08:05:00.000Z');
  assert.equal(typingNote.lastSyncedHash, hashContent('First sentence.'));

  const cleanNote = result.nextNotes.find((n) => n.id === 'n-clean')!;
  assert.equal(cleanNote.dirty, false);

  const pullRaceNote = result.nextNotes.find((n) => n.id === 'n-started-typing-during-pull')!;
  assert.equal(pullRaceNote.content, 'User started writing before download finished');
  assert.equal(result.detectedConflicts.length, 1);
  assert.equal(result.detectedConflicts[0].noteId, 'n-started-typing-during-pull');
});

test('reconcileEditorExternalContent ignores stale delayed renders of previously emitted local typing', () => {
  const pending = [hashContent('Hi'), hashContent('Hi there'), hashContent('Hi there!')];

  // Stale render with "Hi" while editor is already at "Hi there!"
  const stale = reconcileEditorExternalContent('Hi', 'Hi there!', pending);
  assert.equal(stale.shouldApply, false);
  assert.deepEqual(stale.nextPendingHashes, [hashContent('Hi there'), hashContent('Hi there!')]);

  // Catching up to current doc clears pending queue
  const caughtUp = reconcileEditorExternalContent('Hi there!', 'Hi there!', stale.nextPendingHashes);
  assert.equal(caughtUp.shouldApply, false);
  assert.deepEqual(caughtUp.nextPendingHashes, []);

  // Genuine external update (not in pending) applies cleanly
  const external = reconcileEditorExternalContent('Remote overwrite', 'Hi there!', caughtUp.nextPendingHashes);
  assert.equal(external.shouldApply, true);
});

