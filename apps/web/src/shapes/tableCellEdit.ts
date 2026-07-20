/**
 * Inline Markdown ↔ HTML bridge for FORMATTED in-cell editing of table cards.
 *
 * Table cells store the same "minimal inline markdown" the static renderer
 * (tableRich) understands — **bold** *italic* __underline__ ~~strike~~ and
 * [label](url) links. To let a cell be edited AS IT LOOKS (not as raw
 * markdown), the editing cell is a contentEditable seeded with `cellToHtml`
 * and read back with `htmlToCell` on every input.
 *
 * `htmlToCell` must survive whatever the browser produces while editing —
 * `execCommand` emits <b>/<i>/<u>/<strike> OR style spans, and typing can wrap
 * text in <div>/<span> or drop <br>. It maps all of those back to the cell
 * dialect so a round-trip never corrupts or reformats a cell. Pure functions
 * (htmlToCell walks a DOM node) — see scripts/eval-tablecell for the tests.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESCAPES[c]!);
}

// Same inline vocabulary as tableRich, in the same precedence order.
const INLINE_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~/g;

/** Cell markdown → HTML for the contentEditable's initial content. */
export function cellToHtml(md: string): string {
  let out = '';
  let pos = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(md)) !== null) {
    if (m.index > pos) out += esc(md.slice(pos, m.index));
    if (m[1] && m[2]) out += `<a href="${esc(m[2])}">${esc(m[1])}</a>`;
    else if (m[3]) out += `<a href="${esc(m[3])}">${esc(m[3])}</a>`;
    else if (m[4]) out += `<strong>${esc(m[4])}</strong>`;
    else if (m[5]) out += `<em>${esc(m[5])}</em>`;
    else if (m[6]) out += `<u>${esc(m[6])}</u>`;
    else if (m[7]) out += `<s>${esc(m[7])}</s>`;
    pos = INLINE_RE.lastIndex;
  }
  if (pos < md.length) out += esc(md.slice(pos));
  return out;
}

type Wrap = { b: boolean; i: boolean; u: boolean; s: boolean };
const NONE: Wrap = { b: false, i: false, u: false, s: false };

function styleWrap(el: HTMLElement): Wrap {
  const tag = el.tagName.toLowerCase();
  const st = el.style;
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  return {
    b: tag === 'b' || tag === 'strong' || Number(st.fontWeight) >= 600 || st.fontWeight === 'bold',
    i: tag === 'i' || tag === 'em' || st.fontStyle === 'italic',
    u: tag === 'u' || /underline/.test(deco),
    s: tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(deco),
  };
}

/** Wrap already-serialized inner markdown with any NEWLY-added marks (marks the
 *  ancestors didn't already carry), innermost-first, matching cellToHtml. */
function applyMarks(inner: string, w: Wrap, active: Wrap): string {
  if (!inner) return inner;
  let t = inner;
  if (w.s && !active.s) t = `~~${t}~~`;
  if (w.u && !active.u) t = `__${t}__`;
  if (w.i && !active.i) t = `*${t}*`;
  if (w.b && !active.b) t = `**${t}**`;
  return t;
}

/** DOM node (a contentEditable cell) → cell markdown. `active` tracks marks the
 *  ancestors already applied so nested same-mark elements don't double-wrap. */
export function htmlToCell(node: Node, active: Wrap = NONE): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') { out += '\n'; return; }
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const label = htmlToCell(el, active);
      out += href && label === href ? href : `[${label}](${href})`;
      return;
    }
    const w = styleWrap(el);
    const merged: Wrap = { b: w.b || active.b, i: w.i || active.i, u: w.u || active.u, s: w.s || active.s };
    const inner = htmlToCell(el, merged);
    out += applyMarks(inner, w, active);
  });
  return out;
}
