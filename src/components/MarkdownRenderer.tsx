import React, { useEffect, useState } from 'react';
import { Info, Lightbulb, AlertTriangle, FileText, Image as ImageIcon } from 'lucide-react';
import { Note } from '../types/vault';
import {
  isImagePlaceholderUrl,
  parseCalloutHeader,
  parseMarkdownImage,
} from '../utils/editorCommands';
import {
  getCachedLocalImage,
  isLocalMediaUrl,
  resolveLocalImageUrl,
} from '../utils/localMedia';

interface MarkdownRendererProps {
  content: string;
  notes: Note[];
  onOpenWikilink: (targetTitle: string) => void;
  onSelectTag: (tag: string) => void;
  onToggleCheckbox: (lineIndex: number) => void;
}

const LocalAwareImage: React.FC<{
  src: string;
  alt: string;
  inline?: boolean;
  width?: number;
  height?: number;
}> = ({ src, alt, inline = false, width, height }) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
    isLocalMediaUrl(src) ? getCachedLocalImage(src) : src
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!isLocalMediaUrl(src)) {
      setResolvedSrc(src);
      return;
    }
    const cached = getCachedLocalImage(src);
    if (cached) {
      setResolvedSrc(cached);
      return;
    }
    let active = true;
    void resolveLocalImageUrl(src).then((dataUrl) => {
      if (!active) return;
      if (dataUrl) {
        setResolvedSrc(dataUrl);
      } else {
        setFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [src]);

  if (isImagePlaceholderUrl(src)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 px-2.5 py-1 text-xs text-zinc-500 dark:text-zinc-400">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Image placeholder ({alt || 'alt'})</span>
      </span>
    );
  }

  if (failed || !resolvedSrc) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-2.5 py-1 text-xs text-zinc-500 dark:text-zinc-400">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>{failed ? `Missing image: ${alt || src}` : 'Loading image…'}</span>
      </span>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || 'Embedded image'}
      onError={() => setFailed(true)}
      style={{
        width: width && width > 0 ? `${width}px` : undefined,
        height: height && height > 0 ? `${height}px` : undefined,
        maxHeight: height && height > 0 ? 'none' : undefined,
        maxWidth: '100%',
      }}
      className={
        inline
          ? `inline-block max-h-24 max-w-full rounded border border-zinc-200 dark:border-zinc-800 align-middle mx-1 ${
              width && height ? 'object-fill' : 'object-contain'
            }`
          : `max-h-[460px] max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800 ${
              width && height ? 'object-fill' : 'object-contain'
            }`
      }
    />
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  notes,
  onOpenWikilink,
  onSelectTag,
  onToggleCheckbox,
}) => {
  const existingTitles = new Set(notes.map((n) => n.title.trim().toLowerCase()));

  const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
    const tokens: React.ReactNode[] = [];
    const regex =
      /(!\[[^[\]]*\]\([^)]*\)|\[\[[^[\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*|==[^=]+==|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|(?:^|\s)#[a-zA-Z][a-zA-Z0-9_/-]*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(text.slice(lastIndex, match.index));
      }

      const raw = match[0];
      const tokenKey = `${keyPrefix}-${idx++}`;

      if (raw.startsWith('![')) {
        const parsedImg = parseMarkdownImage(raw);
        if (parsedImg) {
          tokens.push(
            <LocalAwareImage
              key={tokenKey}
              src={parsedImg.url}
              alt={parsedImg.alt}
              width={parsedImg.width}
              height={parsedImg.height}
              inline
            />
          );
        } else {
          tokens.push(raw);
        }
      } else if (raw.startsWith('[[') && raw.endsWith(']]')) {
        const inner = raw.slice(2, -2);
        const [targetPart, aliasPart] = inner.split('|');
        const targetTitle = targetPart.split('#')[0].trim();
        const display = (aliasPart || targetPart).trim();
        const exists = existingTitles.has(targetTitle.toLowerCase());

        tokens.push(
          <button
            key={tokenKey}
            type="button"
            onClick={() => onOpenWikilink(targetTitle)}
            className={`inline font-medium underline underline-offset-4 transition-colors cursor-pointer ${
              exists
                ? 'text-violet-600 dark:text-violet-400 decoration-violet-400/50 hover:text-violet-500'
                : 'text-zinc-500 dark:text-zinc-400 decoration-dashed decoration-zinc-400/60 hover:text-violet-400'
            }`}
            title={exists ? `Open "${targetTitle}"` : `Create "${targetTitle}"`}
          >
            {display}
          </button>
        );
      } else if (raw.startsWith('`') && raw.endsWith('`')) {
        tokens.push(
          <code key={tokenKey} className="font-mono">
            {raw.slice(1, -1)}
          </code>
        );
      } else if (raw.startsWith('**') && raw.endsWith('**') && raw.slice(2, -2).trim().length > 0) {
        tokens.push(
          <strong key={tokenKey} className="font-semibold text-zinc-900 dark:text-zinc-50">
            {renderInline(raw.slice(2, -2), `${tokenKey}-b`)}
          </strong>
        );
      } else if (raw.startsWith('==') && raw.endsWith('==') && raw.slice(2, -2).trim().length > 0) {
        tokens.push(
          <mark
            key={tokenKey}
            className="rounded-xs bg-amber-300/35 dark:bg-amber-400/25 px-1 text-zinc-900 dark:text-amber-100"
          >
            {renderInline(raw.slice(2, -2), `${tokenKey}-hl`)}
          </mark>
        );
      } else if (raw.startsWith('*') && raw.endsWith('*') && raw.slice(1, -1).trim().length > 0) {
        tokens.push(<em key={tokenKey}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith('[') && raw.includes('](')) {
        const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
        if (linkMatch) {
          tokens.push(
            <a
              key={tokenKey}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-600 dark:text-violet-400 underline underline-offset-4 hover:text-violet-500"
            >
              {linkMatch[1]}
            </a>
          );
        } else {
          tokens.push(raw);
        }
      } else if (raw.trimStart().startsWith('#')) {
        const leadingSpace = raw.startsWith(' ') ? ' ' : '';
        const tag = raw.trim().slice(1).toLowerCase();
        if (leadingSpace) tokens.push(leadingSpace);
        tokens.push(
          <button
            key={tokenKey}
            type="button"
            onClick={() => onSelectTag(tag)}
            className="inline font-mono text-[13px] text-violet-600 dark:text-violet-400 hover:underline underline-offset-2 cursor-pointer"
          >
            #{tag}
          </button>
        );
      } else {
        tokens.push(raw);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      tokens.push(text.slice(lastIndex));
    }

    return tokens;
  };

  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      const startLine = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(
        <pre key={`code-${startLine}`} className="relative">
          {lang && (
            <span className="block mb-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 select-none">
              {lang}
            </span>
          )}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Markdown Table
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1].trim())
    ) {
      const startLine = i;
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <div
          key={`tbl-${startLine}`}
          className="my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-100 dark:bg-[#181B20] border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3.5 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    {renderInline(h, `th-${startLine}-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((r, rIdx) => (
                <tr key={rIdx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-zinc-700 dark:text-zinc-300">
                      {renderInline(r[cIdx] || '', `td-${startLine}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Standalone Markdown Image block `![alt](url)`
    const imgBlock = parseMarkdownImage(trimmed);
    if (imgBlock) {
      if (isImagePlaceholderUrl(imgBlock.url)) {
        blocks.push(
          <div
            key={`img-ph-${i}`}
            className="my-4 flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400"
          >
            <ImageIcon className="h-4 w-4 shrink-0" />
            <span>Image placeholder — switch to Live Preview to upload or embed an image</span>
          </div>
        );
      } else {
        const showCaption =
          imgBlock.alt &&
          imgBlock.alt.toLowerCase() !== 'alt' &&
          imgBlock.alt.toLowerCase() !== 'image';
        blocks.push(
          <figure key={`img-${i}`} className="my-4">
            <LocalAwareImage
              src={imgBlock.url}
              alt={imgBlock.alt}
              width={imgBlock.width}
              height={imgBlock.height}
            />
            {showCaption && (
              <figcaption className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {imgBlock.alt}
              </figcaption>
            )}
          </figure>
        );
      }
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} />);
      i++;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = `heading-${i + 1}`;
      if (level === 1) {
        blocks.push(
          <h1 id={id} key={`h1-${i}`} className="text-zinc-900 dark:text-zinc-50">
            {renderInline(text, `h1-${i}`)}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 id={id} key={`h2-${i}`} className="text-zinc-900 dark:text-zinc-100">
            {renderInline(text, `h2-${i}`)}
          </h2>
        );
      } else {
        blocks.push(
          <h3 id={id} key={`h3-${i}`} className="text-zinc-900 dark:text-zinc-100">
            {renderInline(text, `h3-${i}`)}
          </h3>
        );
      }
      i++;
      continue;
    }

    // Obsidian Callout or Blockquote (`> [!note]` or `> `)
    if (trimmed.startsWith('>')) {
      const startLine = i;
      const callout = parseCalloutHeader(trimmed);
      const quoteLines: string[] = [];
      if (callout) i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }

      if (callout) {
        const isWarn = callout.type === 'warning' || callout.type === 'danger';
        const isTip = callout.type === 'tip';
        blocks.push(
          <div
            key={`callout-${startLine}`}
            className={`my-4 rounded-lg border p-3.5 ${
              isWarn
                ? 'border-amber-500/35 bg-amber-500/8'
                : isTip
                ? 'border-emerald-500/35 bg-emerald-500/8'
                : 'border-violet-500/35 bg-violet-500/8'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">
              {isWarn ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              ) : isTip ? (
                <Lightbulb className="h-3.5 w-3.5 text-emerald-500" />
              ) : callout.type === 'info' ? (
                <Info className="h-3.5 w-3.5 text-violet-500" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-violet-500" />
              )}
              <span>{callout.title}</span>
            </div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1">
              {quoteLines.map((ql, qIdx) => (
                <p key={qIdx} className="mb-0 last:mb-0">
                  {renderInline(ql, `co-${startLine}-${qIdx}`)}
                </p>
              ))}
            </div>
          </div>
        );
      } else {
        blocks.push(
          <blockquote key={`bq-${startLine}`} className="text-zinc-700 dark:text-zinc-300">
            {quoteLines.map((ql, qIdx) => (
              <p key={qIdx} className="last:mb-0">
                {renderInline(ql, `bq-${startLine}-${qIdx}`)}
              </p>
            ))}
          </blockquote>
        );
      }
      continue;
    }

    // Task list / Unordered list (preserving nested indentation visually)
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: Array<{ lineIdx: number; text: string; checked: boolean | null; indent: number }> = [];
      const startLine = i;
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemLine = lines[i];
        const leadingSpaces = itemLine.search(/\S|$/);
        const indent = Math.floor(leadingSpaces / 2);
        const taskMatch = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(itemLine);
        if (taskMatch) {
          listItems.push({
            lineIdx: i,
            checked: taskMatch[1].toLowerCase() === 'x',
            text: taskMatch[2],
            indent,
          });
        } else {
          listItems.push({
            lineIdx: i,
            checked: null,
            text: itemLine.replace(/^\s*[-*]\s+/, ''),
            indent,
          });
        }
        i++;
      }

      const hasCheckboxes = listItems.some((item) => item.checked !== null);
      blocks.push(
        <ul
          key={`ul-${startLine}`}
          className={hasCheckboxes ? 'list-none pl-1 space-y-1.5' : undefined}
        >
          {listItems.map((item) => {
            const padStyle = item.indent > 0 ? { marginLeft: `${item.indent * 1.25}rem` } : undefined;
            if (item.checked !== null) {
              return (
                <li key={`li-${item.lineIdx}`} style={padStyle} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => onToggleCheckbox(item.lineIdx)}
                    aria-label={`Toggle task: ${item.text}`}
                    className="mt-1.5 h-4 w-4 rounded border-zinc-400 dark:border-zinc-600 accent-violet-600 cursor-pointer shrink-0"
                  />
                  <span
                    className={
                      item.checked
                        ? 'line-through text-zinc-400 dark:text-zinc-500'
                        : 'text-zinc-800 dark:text-zinc-200'
                    }
                  >
                    {renderInline(item.text, `li-${item.lineIdx}`)}
                  </span>
                </li>
              );
            }
            return (
              <li key={`li-${item.lineIdx}`} style={padStyle} className="text-zinc-800 dark:text-zinc-200">
                {renderInline(item.text, `li-${item.lineIdx}`)}
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: Array<{ lineIdx: number; text: string }> = [];
      const startLine = i;
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push({
          lineIdx: i,
          text: lines[i].replace(/^\s*\d+\.\s+/, ''),
        });
        i++;
      }
      blocks.push(
        <ol key={`ol-${startLine}`}>
          {listItems.map((item) => (
            <li key={`oli-${item.lineIdx}`} className="text-zinc-800 dark:text-zinc-200">
              {renderInline(item.text, `oli-${item.lineIdx}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    const startLine = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      parseMarkdownImage(lines[i].trim()) === null &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim()) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length === 0) {
      paraLines.push(lines[i]);
      i++;
    }

    blocks.push(
      <p key={`p-${startLine}`} className="text-zinc-800 dark:text-zinc-200">
        {renderInline(paraLines.join(' '), `p-${startLine}`)}
      </p>
    );
  }

  return (
    <div className="markdown-prose max-w-none">
      {blocks.length > 0 ? (
        blocks
      ) : (
        <p className="text-zinc-400 dark:text-zinc-500 italic">
          This note is empty. Switch to Live Preview or Source mode to start writing.
        </p>
      )}
    </div>
  );
};
