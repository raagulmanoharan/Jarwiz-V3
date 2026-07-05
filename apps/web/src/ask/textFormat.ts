/**
 * Markdown formatting operations for the text card — pure functions over
 * (text, selectionStart, selectionEnd) so the format bar buttons and the
 * ⌘B/⌘I/⌘U shortcuts share one implementation. Each returns the new source
 * plus where the selection should land, so the caret never jumps.
 */

export interface FormatResult {
  text: string;
  selStart: number;
  selEnd: number;
}

/** Wrap the selection in `marker` (e.g. ** for bold), or unwrap if it
 *  already is — checking both inside the selection and just outside it.
 *  An empty selection inserts the markers and parks the caret between. */
export function toggleInline(text: string, start: number, end: number, marker: string): FormatResult {
  const sel = text.slice(start, end);
  const m = marker.length;
  // Markers just outside the selection: |**bold**| selected without them.
  if (text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return {
      text: text.slice(0, start - m) + sel + text.slice(end + m),
      selStart: start - m,
      selEnd: end - m,
    };
  }
  // Markers inside the selection: |**bold**| selected with them.
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= m * 2) {
    const inner = sel.slice(m, sel.length - m);
    return { text: text.slice(0, start) + inner + text.slice(end), selStart: start, selEnd: start + inner.length };
  }
  const wrapped = marker + sel + marker;
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    selStart: start + m,
    selEnd: end + m,
  };
}

/** Insert a block on its own line at the caret (a table skeleton, an image),
 *  guaranteeing a blank-ish separation so it renders as its own block. When
 *  `selectToken` is given, the caret lands on that substring (e.g. the first
 *  "Column" of a fresh table) so the user can type straight over it. */
export function insertBlock(
  text: string,
  start: number,
  end: number,
  block: string,
  selectToken?: string,
): FormatResult {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const pre = before.length === 0 || before.endsWith('\n') ? '' : '\n';
  const post = after.length === 0 || after.startsWith('\n') ? '' : '\n';
  const at = start + pre.length;
  let selStart = at;
  let selEnd = at + block.length;
  if (selectToken) {
    const idx = block.indexOf(selectToken);
    if (idx >= 0) {
      selStart = at + idx;
      selEnd = selStart + selectToken.length;
    }
  }
  return { text: before + pre + block + post + after, selStart, selEnd };
}

/** A 2×2 markdown table skeleton, caret on the first header cell. */
export function insertTableBlock(text: string, start: number, end: number): FormatResult {
  const block = ['| Column | Column |', '| --- | --- |', '|  |  |'].join('\n');
  return insertBlock(text, start, end, block, 'Column');
}

/** Apply a format to a textarea React controls: the native value setter plus
 *  a bubbling input event runs the component's OWN onChange, so the edit
 *  flows through whatever that textarea writes to (a doc's text, a table
 *  cell, a header) — no caller needs to know the write path. */
export function formatControlledTextarea(
  ta: HTMLTextAreaElement,
  run: (t: string, s: number, e: number) => FormatResult,
): void {
  const { text, selStart, selEnd } = run(ta.value, ta.selectionStart, ta.selectionEnd);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
  });
}

/** The ⌘/Ctrl-key → inline marker mapping shared by every doc editor surface
 *  (card textarea, focus mode). Returns null when the key isn't a shortcut. */
export function shortcutMarker(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string }): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  return e.key === 'b' ? '**' : e.key === 'i' ? '*' : e.key === 'u' ? '__' : null;
}

/** Toggle a line prefix ("- " bullets, "- [ ] " checklist) on every line the
 *  selection touches. If ALL touched lines already carry it, strip it;
 *  otherwise add it (converting between bullet and checklist cleanly). */
export function toggleLinePrefix(text: string, start: number, end: number, prefix: string): FormatResult {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  // Strip any existing list marker to judge (and rebuild) each line cleanly.
  const bare = (l: string) => l.replace(/^- \[[ xX]\] /, '').replace(/^- /, '');
  const allPrefixed = lines.every((l) => !l.trim() || l.startsWith(prefix));
  const next = lines
    .map((l) => {
      if (!l.trim()) return l;
      return allPrefixed ? bare(l) : prefix + bare(l);
    })
    .join('\n');
  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + next.length,
  };
}
