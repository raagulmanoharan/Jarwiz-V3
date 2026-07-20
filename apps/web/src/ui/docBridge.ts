/**
 * Bridge between Jarwiz's doc Markdown and the TipTap (ProseMirror) document
 * model — the safety layer under formatted (WYSIWYG) doc editing.
 *
 * Doc cards store a BESPOKE markdown dialect (see ui/DocMarkdown.tsx), NOT
 * standard CommonMark: `__x__` is UNDERLINE (not bold), `[p.N]` are citations,
 * and ```map / ```widget fences render as live blocks. An off-the-shelf editor
 * would rewrite all of that on save. So instead of a generic serializer we own
 * both directions here and match DocMarkdown's parser exactly:
 *
 *   mdToDoc(text)   → ProseMirror JSON the editor renders (parse mirrors
 *                     DocMarkdown so what you edit == what read mode shows).
 *   docToMd(json)   → markdown in DocMarkdown's own shape (so read mode keeps
 *                     rendering correctly after every edit — no reflow of the
 *                     dialect, no lost marks).
 *
 * SCOPE (v1): docs that use the dialect-only features — ```map / ```widget
 * fences or `[p.N]` citations — are NOT edited here. `docHasSpecialSyntax`
 * detects them and the card falls back to the raw-text editor, so those docs
 * are never at risk. Everything else (prose, headings, lists, task lists,
 * tables, links, images, the inline marks) round-trips through here.
 *
 * These are pure functions with no DOM dependency, so scripts/eval-docbridge.mjs
 * can exercise the round-trip headlessly.
 */

import type { JSONContent } from '@tiptap/react';

/** Docs containing these dialect-only constructs skip the rich editor (v1). */
export function docHasSpecialSyntax(text: string): boolean {
  if (/^```(?:map|widget)\s*$/m.test(text)) return true; // live fence blocks
  if (/\[p{1,2}\.\s*[\d\s,&–-]+\]/.test(text)) return true; // page citations
  return false;
}

/* ── Markdown → ProseMirror JSON ───────────────────────────────────────────
 * The block loop mirrors DocMarkdown.tsx so the editor's structure matches
 * read mode line-for-line. Blocks are separated by blank lines; within a block
 * (lists, tables) lines are contiguous — exactly what DocMarkdown expects. */

const TASK_RE = /^- \[([ xX])\]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*:?-{2,}:?\s*$/;

/** True when a line opens a structural block (heading / rule / table / list) —
 *  used to stop paragraph gathering at the next block. Mirrors the block order
 *  in mdToDoc so a line is only gathered into a paragraph when nothing else claims it. */
function startsBlock(line: string): boolean {
  const t = line.trim();
  return (
    /^#{1,3} /.test(line) || // heading
    /^[-—–]{2,}$/.test(t) || // hairline rule
    (t.startsWith('|') && t.length > 1) || // table row
    line.startsWith('- ') // bullet / task list
  );
}

function tableCells(line: string): string[] {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

export function mdToDoc(text: string): JSONContent {
  const lines = text.split('\n');
  const content: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue; // blank lines are block separators; spacing is re-emitted on serialize
    }

    // Headings (# / ## / ###)
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1]!.length }, content: inlineToNodes(h[2] ?? '') });
      i++;
      continue;
    }

    // Hairline divider — a line of only dashes (or the em/en-dash variants).
    if (/^[-—–]{2,}$/.test(trimmed)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Tables: contiguous "| a | b |" lines; a |---|---| row marks the header.
    if (trimmed.startsWith('|') && trimmed.length > 1) {
      const rows: string[][] = [];
      let headerRows = 0;
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const cells = tableCells(lines[i] ?? '');
        if (cells.length > 0 && cells.every((c) => TABLE_SEP_RE.test(c))) {
          if (rows.length > 0) headerRows = rows.length;
        } else {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) content.push(tableNode(rows, headerRows));
      continue;
    }

    // Lists — bullets and task lists (`- [ ] ` / `- [x] `). A run of `- ` lines
    // is one list; task lines make it a taskList (matches DocMarkdown).
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('- ')) {
        items.push(lines[i] ?? '');
        i++;
      }
      const isTask = items.every((it) => TASK_RE.test(it));
      if (isTask) {
        content.push({
          type: 'taskList',
          content: items.map((it) => {
            const m = TASK_RE.exec(it)!;
            return {
              type: 'taskItem',
              attrs: { checked: m[1] !== ' ' },
              content: [{ type: 'paragraph', content: inlineToNodes(m[2] ?? '') }],
            };
          }),
        });
      } else {
        content.push({
          type: 'bulletList',
          content: items.map((it) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: inlineToNodes(it.slice(2)) }],
          })),
        });
      }
      continue;
    }

    // Paragraph — gather consecutive non-blank plain lines into ONE paragraph
    // with soft line breaks between them. Blank lines separate paragraphs; only
    // a blank (or the start of a structural block) ends this one. This keeps
    // adjacent lines adjacent on round-trip (e.g. "1. a\n2. b" stays tight,
    // never gains blank lines) while blank-separated prose stays separate.
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (!l.trim() || startsBlock(l)) break;
      paraLines.push(l);
      i++;
    }
    const paraContent: JSONContent[] = [];
    paraLines.forEach((pl, idx) => {
      if (idx > 0) paraContent.push({ type: 'hardBreak' });
      paraContent.push(...inlineToNodes(pl));
    });
    content.push({ type: 'paragraph', content: paraContent });
  }

  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function tableNode(rows: string[][], headerRows: number): JSONContent {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const cell = (text: string, header: boolean): JSONContent => ({
    type: header ? 'tableHeader' : 'tableCell',
    content: [{ type: 'paragraph', content: inlineToNodes(text) }],
  });
  return {
    type: 'table',
    content: rows.map((r, ri) => ({
      type: 'tableRow',
      // The first `headerRows` rows are the header band (0 = no header row).
      content: Array.from({ length: width }, (_, ci) => cell(r[ci] ?? '', ri < headerRows)),
    })),
  };
}

/* ── Inline parsing ─── matches DocMarkdown.renderInline (non-nesting). ────── */

// Same alternation as DocMarkdown, minus citations (dialect-only → fallback).
const INLINE_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+|\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;

function textNode(text: string, mark?: string, attrs?: Record<string, unknown>): JSONContent {
  const marks = mark ? [attrs ? { type: mark, attrs } : { type: mark }] : undefined;
  return marks ? { type: 'text', text, marks } : { type: 'text', text };
}

function inlineToNodes(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let pos = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > pos) nodes.push(textNode(text.slice(pos, m.index)));
    if (m[1]) nodes.push(textNode(m[1], 'bold'));
    else if (m[2]) nodes.push(textNode(m[2], 'italic'));
    else if (m[3]) nodes.push(textNode(m[3], 'underline'));
    else if (m[4]) nodes.push(textNode(m[4], 'strike'));
    else if (m[5]) nodes.push(textNode(m[5], 'code'));
    else if (m[7]) nodes.push({ type: 'image', attrs: { src: m[7], alt: m[6] ?? '' } });
    else if (m[8] && m[9]) nodes.push(textNode(m[8], 'link', { href: m[9] }));
    else if (m[10]) nodes.push(textNode(m[10], 'link', { href: m[10] }));
    pos = INLINE_RE.lastIndex;
  }
  if (pos < text.length) nodes.push(textNode(text.slice(pos)));
  return nodes;
}

/* ── ProseMirror JSON → Markdown ─── emits DocMarkdown's dialect. ──────────── */

export function docToMd(doc: JSONContent): string {
  const blocks = (doc.content ?? []).map(serializeBlock).filter((b) => b !== null) as string[];
  return blocks.join('\n\n');
}

function serializeBlock(node: JSONContent): string | null {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(3, Math.max(1, (node.attrs?.level as number) ?? 1)))} ${serializeInline(node.content)}`;
    case 'paragraph':
      return serializeInline(node.content);
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return (node.content ?? [])
        .map((li) => `- ${serializeInline(li.content?.[0]?.content)}`)
        .join('\n');
    case 'taskList':
      return (node.content ?? [])
        .map((ti) => `- [${ti.attrs?.checked ? 'x' : ' '}] ${serializeInline(ti.content?.[0]?.content)}`)
        .join('\n');
    case 'table':
      return serializeTable(node);
    default:
      // Unknown block: never drop content — emit its text if any.
      return node.content ? serializeInline(node.content) : '';
  }
}

function serializeTable(node: JSONContent): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      header: cell.type === 'tableHeader',
      text: serializeInline(cell.content?.[0]?.content).replace(/\|/g, '\\|'),
    })),
  );
  if (rows.length === 0) return '';
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r: Array<{ text: string }>) =>
    `| ${Array.from({ length: width }, (_, c) => r[c]?.text ?? '').join(' | ')} |`;
  const out: string[] = [];
  const headerCount = rows.filter((r) => r.length > 0 && r.every((c) => c.header)).length;
  rows.forEach((r, ri) => {
    out.push(pad(r));
    // Emit the |---| separator right after the last header row. A header-less
    // table emits no separator and round-trips back to an all-body table.
    if (headerCount > 0 && ri === headerCount - 1) {
      out.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
    }
  });
  return out.join('\n');
}

/** Wrap order: code innermost, then strike, underline, italic, bold. DocMarkdown
 *  doesn't nest marks, so combined marks are rare; this keeps output parseable. */
function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  return nodes.map(serializeInlineNode).join('');
}

function serializeInlineNode(node: JSONContent): string {
  if (node.type === 'image') {
    return `![${(node.attrs?.alt as string) ?? ''}](${(node.attrs?.src as string) ?? ''})`;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type !== 'text') return '';
  let text = node.text ?? '';
  const marks = new Set((node.marks ?? []).map((mk) => mk.type));
  const link = (node.marks ?? []).find((mk) => mk.type === 'link');
  if (marks.has('code')) text = `\`${text}\``;
  if (marks.has('strike')) text = `~~${text}~~`;
  if (marks.has('underline')) text = `__${text}__`;
  if (marks.has('italic')) text = `*${text}*`;
  if (marks.has('bold')) text = `**${text}**`;
  if (link) {
    const href = (link.attrs?.href as string) ?? '';
    // A bare URL (label === href) serializes back to the bare URL, not a
    // [url](url) link — DocMarkdown renders both the same, this keeps it stable.
    text = text === href ? text : `[${text}](${href})`;
  }
  return text;
}
