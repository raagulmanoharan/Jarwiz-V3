/**
 * Minimal markdown renderer for doc cards.
 *
 * Handles: headings, bold, italics, lists, task lists (- [ ] / - [x]), line
 * breaks. Renders as HTML with safe className hooks for styling. Task items
 * render as live checkboxes; toggling one calls `onToggleTask` with the task's
 * ordinal (its order among all task lines) so the card can rewrite its source.
 * No external dependencies.
 */

import { stopEventPropagation } from 'tldraw';

interface DocMarkdownProps {
  content: string;
  /** When set, [p.N] citations render as clickable chips that flip the source. */
  onCite?: (page: number) => void;
  /** When set, `- [ ]` items render as checkboxes; toggling calls this. */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
}

/** Matches a markdown task line, capturing the checked state and the label. */
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

/** A line that is ONLY a link (bare URL, or [label](url)) → a link chip card. */
const LINK_LINE_RE = /^(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/\S+))$/;

/** A markdown table separator row: | --- | :--: | … */
const TABLE_SEP_RE = /^\s*:?-{2,}:?\s*$/;

/** Split a "| a | b |" row into trimmed cells. */
function tableCells(line: string): string[] {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

export function DocMarkdown({ content, onCite, onToggleTask }: DocMarkdownProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  // Running index across ALL task lines, so a toggle maps to the right source line.
  let taskOrdinal = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="jz-md-h3">
          {renderInline(line.slice(4), onCite)}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="jz-md-h2">
          {renderInline(line.slice(3), onCite)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="jz-md-h1">
          {renderInline(line.slice(2), onCite)}
        </h1>,
      );
      i++;
      continue;
    }

    // Hairline divider — a line of only dashes ("---", also the em-dash
    // variants autocorrect produces). Typing it IS the divider control.
    if (/^[-—–]{2,}$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="jz-md-hr" />);
      i++;
      continue;
    }

    // A lone link on its own line renders as a small link CARD — bordered
    // chip with the label and its host — not an underlined string.
    {
      const link = line.trim().match(LINK_LINE_RE);
      if (link) {
        const url = link[2] ?? link[3] ?? '';
        let host = '';
        try {
          host = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          host = '';
        }
        const label = link[1] ?? host ?? url;
        elements.push(
          <a
            key={`linkcard-${i}`}
            className="jz-md-linkcard"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ pointerEvents: 'all' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="jz-md-linkcard-label">{label}</span>
            {host && host !== label ? <span className="jz-md-linkcard-host">{host}</span> : null}
          </a>,
        );
        i++;
        continue;
      }
    }

    // Tables: consecutive "| a | b |" lines; the |---|---| separator row
    // marks the row above it as the header.
    if (line.trim().startsWith('|') && line.trim().length > 1) {
      const rows: string[][] = [];
      let headerRows = 0;
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const cells = tableCells(lines[i] ?? '');
        if (cells.length > 0 && cells.every((c) => TABLE_SEP_RE.test(c))) {
          if (rows.length > 0) headerRows = rows.length; // rows so far are the header
        } else {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) {
        const head = rows.slice(0, headerRows);
        const body = rows.slice(headerRows);
        elements.push(
          <table key={`table-${elements.length}`} className="jz-md-table">
            {head.length > 0 ? (
              <thead>
                {head.map((r, ri) => (
                  <tr key={`thr-${ri}`}>
                    {r.map((c, ci) => (
                      <th key={`th-${ri}-${ci}`}>{renderInline(c, onCite)}</th>
                    ))}
                  </tr>
                ))}
              </thead>
            ) : null}
            <tbody>
              {body.map((r, ri) => (
                <tr key={`tr-${ri}`}>
                  {r.map((c, ci) => (
                    <td key={`td-${ri}-${ci}`}>{renderInline(c, onCite)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }

    // Lists (including task lists: "- [ ] …" / "- [x] …")
    if (line.startsWith('- ')) {
      const listItems: React.ReactNode[] = [];
      let hasTask = false;
      while (i < lines.length) {
        const currentLine = lines[i] ?? '';
        if (!currentLine.startsWith('- ')) break;
        const body = currentLine.slice(2);
        const task = body.match(TASK_RE);
        if (task) {
          hasTask = true;
          const checked = task[1] !== ' ';
          const ordinal = taskOrdinal++;
          listItems.push(
            <li key={`li-${i}`} className="jz-md-task">
              <input
                type="checkbox"
                className="jz-md-checkbox"
                checked={checked}
                disabled={!onToggleTask}
                style={{ pointerEvents: 'all' }}
                onPointerDown={stopEventPropagation}
                onChange={() => onToggleTask?.(ordinal, !checked)}
              />
              <span className={checked ? 'jz-md-task-done' : undefined}>
                {renderInline(task[2] ?? '', onCite)}
              </span>
            </li>,
          );
        } else {
          listItems.push(<li key={`li-${i}`}>{renderInline(body, onCite)}</li>);
        }
        i++;
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className={hasTask ? 'jz-md-ul jz-md-tasklist' : 'jz-md-ul'}>
          {listItems}
        </ul>,
      );
      continue;
    }

    // Paragraphs (non-empty lines). Empty lines render as explicit spacers so
    // read mode matches the textarea — clicking to edit doesn't shift the layout.
    if (line.trim()) {
      elements.push(
        <p key={`p-${i}`} className="jz-md-p">
          {renderInline(line, onCite)}
        </p>,
      );
    } else {
      elements.push(<div key={`blank-${i}`} className="jz-md-blank" aria-hidden />);
    }

    i++;
  }

  return <div className="jz-markdown">{elements}</div>;
}

function renderInline(text: string, onCite?: (page: number) => void): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let pos = 0;

  // Inline patterns: **bold**, *italic*, __underline__, ~~strike~~, `code`,
  // [p.N] page citations, [label](url) links, bare http(s) URLs (a pasted
  // link is clickable as-is), and ![alt](url) images. (__ is underline
  // here, not md-strong — the format bar writes it and nothing else does.)
  // Image URLs accept http(s), data:, AND root-relative /api/assets paths —
  // the "insert image" upload returns a same-origin asset URL, not an absolute
  // one; without the `/…` alternative it rendered as literal text.
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\[p{1,2}\.\s*([\d\s,&–-]+)\]|!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+|\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > pos) parts.push(text.slice(pos, match.index));

    if (match[1]) {
      parts.push(<strong key={`strong-${pos}`}>{match[1]}</strong>);
    } else if (match[2]) {
      parts.push(<em key={`em-${pos}`}>{match[2]}</em>);
    } else if (match[3]) {
      parts.push(<u key={`u-${pos}`}>{match[3]}</u>);
    } else if (match[4]) {
      parts.push(<s key={`s-${pos}`}>{match[4]}</s>);
    } else if (match[5]) {
      parts.push(<code key={`code-${pos}`}>{match[5]}</code>);
    } else if (match[8]) {
      // ![alt](url) — the image itself, bounded to the card's width.
      parts.push(
        <img
          key={`img-${pos}`}
          className="jz-md-img"
          src={match[8]}
          alt={match[7] ?? ''}
          draggable={false}
          referrerPolicy="no-referrer"
        />,
      );
    } else if (match[9] && match[10]) {
      parts.push(
        <a
          key={`link-${pos}`}
          className="jz-md-link"
          href={match[10]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {match[9]}
        </a>,
      );
    } else if (match[11]) {
      // Bare URL — clickable, shown without the protocol and clipped so a
      // long tracking-parameter tail can't wreck the card's measure.
      const url = match[11];
      const label = url.replace(/^https?:\/\//, '');
      parts.push(
        <a
          key={`url-${pos}`}
          className="jz-md-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {label.length > 48 ? `${label.slice(0, 47)}…` : label}
        </a>,
      );
    } else if (match[6]) {
      const pageList = match[6];
      const first = Number((pageList.match(/\d+/) ?? ['0'])[0]);
      const label = `p.${pageList.replace(/\s+/g, '')}`;
      if (onCite && first > 0) {
        parts.push(
          <button
            key={`cite-${pos}`}
            className="jz-cite"
            title={`Go to page ${first}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCite(first);
            }}
          >
            {label}
          </button>,
        );
      } else {
        parts.push(`[${label}]`);
      }
    }

    pos = pattern.lastIndex;
  }

  if (pos < text.length) parts.push(text.slice(pos));

  return parts.length === 0 ? text : parts;
}
