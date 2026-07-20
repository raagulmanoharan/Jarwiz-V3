/**
 * A table cell you edit AS IT LOOKS — a contentEditable that renders the cell's
 * inline markdown formatted (bold / italic / underline / strike / links) and
 * edits in place, so a selected table and an editing table are identical (no
 * raw `*asterisks*`). All markdown ↔ HTML conversion lives in tableCellEdit.
 *
 * The element is UNCONTROLLED: its HTML is seeded once on mount and the browser
 * owns it thereafter, so the shape updates React fires on every keystroke never
 * reset the caret. ⌘B/I/U are handled natively by the browser; the format bar
 * drives it via execCommand (see ask/CardActionBar).
 */

import { useLayoutEffect, useRef } from 'react';
import { stopEventPropagation } from 'tldraw';
import { cellToHtml, htmlToCell } from './tableCellEdit';

interface TableCellEditableProps {
  value: string;
  className: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  /** (event, the cell's plain text) — for row insert/delete key handling. */
  onKeyDown?: (e: React.KeyboardEvent, text: string) => void;
}

export function TableCellEditable({ value, className, placeholder, autoFocus, onChange, onBlur, onKeyDown }: TableCellEditableProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Seed the formatted HTML once. Uncontrolled thereafter — re-renders from the
  // shape update don't touch innerHTML, so the caret never jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = cellToHtml(value);
    if (autoFocus) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // caret to end
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // Mount only — value is the seed, not a controlled prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder}
      data-placeholder={placeholder}
      style={{ pointerEvents: 'all' }}
      onInput={() => { if (ref.current) onChange(htmlToCell(ref.current)); }}
      onBlur={() => { if (ref.current) onBlur?.(htmlToCell(ref.current)); }}
      onKeyDown={(e) => onKeyDown?.(e, ref.current?.textContent ?? '')}
      onPointerDown={stopEventPropagation}
      onPointerMove={stopEventPropagation}
      onPointerUp={stopEventPropagation}
    />
  );
}
