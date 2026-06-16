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

    // Paragraphs (non-empty lines)
    if (line.trim()) {
      elements.push(
        <p key={`p-${i}`} className="jz-md-p">
          {renderInline(line, onCite)}
        </p>,
      );
    }

    i++;
  }

  return <div className="jz-markdown">{elements}</div>;
}

function renderInline(text: string, onCite?: (page: number) => void): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let pos = 0;

  // Inline patterns: **bold**, *italic*, `code`, and [p.N] page citations.
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[p{1,2}\.\s*([\d\s,&–-]+)\]/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > pos) parts.push(text.slice(pos, match.index));

    if (match[1]) {
      parts.push(<strong key={`strong-${pos}`}>{match[1]}</strong>);
    } else if (match[2]) {
      parts.push(<em key={`em-${pos}`}>{match[2]}</em>);
    } else if (match[3]) {
      parts.push(<code key={`code-${pos}`}>{match[3]}</code>);
    } else if (match[4]) {
      const pageList = match[4];
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
