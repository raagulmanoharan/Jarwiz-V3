/**
 * Minimal markdown renderer for doc cards.
 *
 * Handles: headings, bold, italics, lists, line breaks. Renders as HTML with
 * safe className hooks for styling. No external dependencies.
 */

interface DocMarkdownProps {
  content: string;
}

export function DocMarkdown({ content }: DocMarkdownProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="jz-md-h3">
          {renderInline(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="jz-md-h2">
          {renderInline(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="jz-md-h1">
          {renderInline(line.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    // Lists
    if (line.startsWith('- ')) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length) {
        const currentLine = lines[i] ?? '';
        if (!currentLine.startsWith('- ')) break;
        listItems.push(
          <li key={`li-${i}`}>{renderInline(currentLine.slice(2))}</li>,
        );
        i++;
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className="jz-md-ul">
          {listItems}
        </ul>,
      );
      continue;
    }

    // Paragraphs (non-empty lines)
    if (line.trim()) {
      elements.push(
        <p key={`p-${i}`} className="jz-md-p">
          {renderInline(line)}
        </p>,
      );
    }

    i++;
  }

  return <div className="jz-markdown">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let pos = 0;

  // Simple inline pattern matching: **bold**, *italic*, `code`
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > pos) {
      parts.push(text.slice(pos, match.index));
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <strong key={`strong-${pos}`}>{match[1]}</strong>,
      );
    } else if (match[2]) {
      // *italic*
      parts.push(
        <em key={`em-${pos}`}>{match[2]}</em>,
      );
    } else if (match[3]) {
      // `code`
      parts.push(
        <code key={`code-${pos}`}>{match[3]}</code>,
      );
    }

    pos = pattern.lastIndex;
  }

  // Add remaining text
  if (pos < text.length) {
    parts.push(text.slice(pos));
  }

  return parts.length === 0 ? text : parts;
}
