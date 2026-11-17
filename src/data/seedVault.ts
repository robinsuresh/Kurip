import { Note } from '../types/vault';

const now = Date.now();

export const SEED_NOTES: Note[] = [
  {
    id: 'note-welcome',
    title: 'Welcome to Kurip',
    folder: '',
    createdAt: now - 1000 * 60 * 60 * 48,
    updatedAt: now - 1000 * 60 * 25,
    pinned: true,
    content: `Kurip combines **Obsidian-style Live Preview Markdown** with **real-time Google Drive synchronization** across your local vault.

## Seamless Live Preview Writing
Click any line to inspect or edit raw Markdown syntax; move your cursor away and headings, **bold**, *italic*, ==highlights==, interactive checkboxes, and [[Architecture & Sync]] links render cleanly inline.

- Type \`/\` on a new line for block commands (tasks, headings, callouts, code blocks, tables)
- Type \`[[\` anywhere to autocomplete and link notes like [[Research Index]]
- Select any phrase to reveal the floating formatting toolbar or press \`Cmd/Ctrl + B\` / \`Cmd/Ctrl + I\`
- Press \`Cmd/Ctrl + Enter\` on any line to toggle a task checkbox, or \`Alt + Up/Down\` to reorder lines

> [!tip] Keyboard-First Navigation
> Use \`Cmd/Ctrl + K\` for Quick Switcher, \`Cmd/Ctrl + E\` to switch between Live Preview and Reading view, and click any heading in the right Outline inspector to jump straight to that line.

## Active Tasks
- [x] Upgrade editor to continuous CodeMirror 6 Live Preview
- [ ] Connect Google Drive for real-time cloud backup
- [ ] Review daily priorities in [[Daily Note 2026-11-16]]

#workspace #getting-started`,
  },
  {
    id: 'note-architecture',
    title: 'Architecture & Sync',
    folder: 'Engineering',
    createdAt: now - 1000 * 60 * 60 * 36,
    updatedAt: now - 1000 * 60 * 15,
    content: `Every note lives as portable standard \`.md\` Markdown locally and inside your **Kurip Vault** folder on Google Drive.

## Real-Time Sync Pipeline
| Stage | Mechanism | Interval / Trigger |
| --- | --- | --- |
| Auto-Push | Debounced Drive v3 \`PATCH\` | 1.5s after local edit |
| Change Polling | Drive Changes API delta check | Every 10 seconds |
| Integrity | FNV-1a deterministic hash | Pre-upload comparison |

> [!note] Safe Conflict Resolution
> Kurip never silently overwrites diverging revisions. If both local and Drive copies change, you choose which revision to keep.

Related notes: [[Welcome to Kurip]] and [[Product Roadmap]]. #architecture #sync-engine`,
  },
  {
    id: 'note-daily',
    title: 'Daily Note 2026-11-16',
    folder: 'Daily Notes',
    createdAt: now - 1000 * 60 * 60 * 6,
    updatedAt: now - 1000 * 60 * 5,
    content: `## Focus for Today
- [ ] Finalize bidirectional wikilink index inside [[Architecture & Sync]]
- [ ] Review open research threads in [[Research Index]]
- [x] Verify Quick Switcher shortcut (\`Cmd/Ctrl + K\`)

## Scratchpad
==Highlight key takeaways== directly inline while drafting technical notes or meeting summaries.

\`\`\`ts
const links = extractWikilinks(note.content);
const tags = extractTags(note.content);
\`\`\`

#daily #journal`,
  },
  {
    id: 'note-research',
    title: 'Research Index',
    folder: 'Research',
    createdAt: now - 1000 * 60 * 60 * 24,
    updatedAt: now - 1000 * 60 * 40,
    content: `A central hub for evergreen topics, reading notes, and system design references.

## Linked Topics
- [[Architecture & Sync]] — Local-first storage + Drive v3 reconciliation
- [[Product Roadmap]] — Editing ergonomics & cloud sync milestones
- [[Welcome to Kurip]] — Live Preview shortcuts and getting started

#research #evergreen`,
  },
  {
    id: 'note-roadmap',
    title: 'Product Roadmap',
    folder: 'Engineering',
    createdAt: now - 1000 * 60 * 60 * 18,
    updatedAt: now - 1000 * 60 * 50,
    content: `## Milestone 1: Obsidian-Grade Editor & Knowledge Graph
- [x] Continuous CodeMirror 6 surface with line-aware Live Preview
- [x] Heading folding gutters, smart Enter continuation, and floating toolbar
- [x] Slash commands & inline \`[[\` wikilink autocomplete
- [x] Force-directed knowledge graph canvas

## Milestone 2: Google Drive Real-Time Sync
- [x] Google Sign-In via Firebase Auth
- [x] Automatic Drive vault folder provisioning
- [x] Real-time background sync & conflict detection

Linked from [[Architecture & Sync]] and [[Research Index]]. #roadmap #planning`,
  },
];
