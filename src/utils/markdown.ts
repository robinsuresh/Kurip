import { BacklinkMatch, HeadingItem, Note } from '../types/vault';

/**
 * Computes a fast deterministic 32-bit FNV-1a hex hash for note content comparison.
 */
export function hashContent(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Extracts all unique [[wikilink]] targets from Markdown content.
 * Supports aliases like [[Target Note|Display Label]] and heading links [[Target#Section]].
 */
export function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^[\]]+)\]\]/g;
  const targets = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const raw = match[1].split('|')[0].split('#')[0].trim();
    if (raw) {
      targets.add(raw);
    }
  }
  return Array.from(targets);
}

/**
 * Extracts all unique #tags outside of fenced code blocks and URLs.
 */
export function extractTags(content: string): string[] {
  const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const regex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
  const tags = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(withoutCode)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
}

/**
 * Extracts H1-H3 headings for the Document Outline inspector.
 */
export function extractHeadings(content: string): HeadingItem[] {
  const lines = content.split('\n');
  const headings: HeadingItem[] = [];
  let inCodeBlock = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;

    const normalized = trimmed.replace(/^[-*]\s+/, '');
    const match = /^(#{1,3})\s+(.+)$/.exec(normalized);
    if (match) {
      headings.push({
        level: match[1].length as 1 | 2 | 3,
        text: match[2].trim(),
        line: idx + 1,
      });
    }
  });

  return headings;
}

/**
 * Computes word and character statistics for a note.
 */
export function computeNoteStats(content: string): { words: number; chars: number; readingMinutes: number } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { words: 0, chars: 0, readingMinutes: 0 };
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.ceil(words / 220));
  return { words, chars: content.length, readingMinutes };
}

/**
 * Computes linked backlinks and unlinked mentions targeting `activeNote` across the vault.
 */
export function computeBacklinks(activeNote: Note, allNotes: Note[]): BacklinkMatch[] {
  const results: BacklinkMatch[] = [];
  const targetTitleLower = activeNote.title.trim().toLowerCase();
  if (!targetTitleLower) return results;

  for (const note of allNotes) {
    if (note.id === activeNote.id) continue;

    const lines = note.content.split('\n');
    let foundLinked = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const wikilinks = extractWikilinks(line).map((w) => w.toLowerCase());
      if (wikilinks.includes(targetTitleLower)) {
        foundLinked = true;
        results.push({
          sourceNoteId: note.id,
          sourceTitle: note.title,
          sourceFolder: note.folder,
          snippet: line.trim(),
          line: i + 1,
          isUnlinkedMention: false,
        });
      }
    }

    if (!foundLinked && targetTitleLower.length >= 3) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const idx = lowerLine.indexOf(targetTitleLower);
        if (idx !== -1) {
          // Ensure whole-word-ish match
          const before = idx === 0 ? ' ' : lowerLine[idx - 1];
          const after = idx + targetTitleLower.length >= lowerLine.length ? ' ' : lowerLine[idx + targetTitleLower.length];
          if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
            results.push({
              sourceNoteId: note.id,
              sourceTitle: note.title,
              sourceFolder: note.folder,
              snippet: line.trim(),
              line: i + 1,
              isUnlinkedMention: true,
            });
            break;
          }
        }
      }
    }
  }

  return results;
}

/**
 * Sanitizes a note title into a valid Google Drive Markdown filename.
 */
export function noteTitleToFilename(title: string): string {
  const clean = title.trim().replace(/[/\\:*?"<>|]/g, '-');
  return `${clean || 'Untitled'}.md`;
}

/**
 * Extracts a note title from a Google Drive `.md` filename.
 */
export function filenameToNoteTitle(filename: string): string {
  return filename.replace(/\.md$/i, '').trim() || 'Untitled';
}

/**
 * Toggles a checkbox on a specific 0-indexed line in Markdown content.
 */
export function toggleMarkdownCheckbox(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return content;

  if (/^(\s*[-*]\s)\[ \]/.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s)\[ \]/, '$1[x]');
  } else if (/^(\s*[-*]\s)\[[xX]\]/.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s)\[[xX]\]/, '$1[ ]');
  }
  return lines.join('\n');
}
