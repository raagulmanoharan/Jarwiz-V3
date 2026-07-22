/**
 * Structured rich-card blocks — the rich card's content model (owner call
 * 2026-07-20). A doc card IS the rich card: there is ONE card, composed of these
 * typed blocks — not a separate "doc" kind versus a "rich" kind.
 *
 * The card body is a SEQUENCE OF TYPED BLOCKS, not a wall of markdown the model
 * has to remember to format. The model emits the blocks as newline-delimited
 * JSON — one block object per line (see BLOCK_FORMAT in apps/server's ask.ts) —
 * and the server VALIDATES + HYDRATES each line (a map's stops geocoded, an
 * image's query searched, a link's URL previewed), streaming it to the canvas as
 * a `block.add` event. This is what makes rich constructs — tables, maps, images,
 * links, checklists — reliable and structured, instead of hoping the model writes
 * correct markdown. Images in particular are DECLARED, not fetched by the model:
 * the block carries a query and the server finds the real photo — so a card only
 * shows an image when the model actually emits an image block.
 *
 * Inline text (`paragraph`, `heading`, list items, cells) still carries the
 * small markdown marks the renderer already understands (**bold**, *italic*,
 * `code`, [links](url), [p.N] citations) — those are lightweight and safe.
 * Block-level structure (tables, maps, images) is what moves to typed blocks.
 */

import type { MapStop } from './protocol.js';

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  /** Inline markdown allowed (bold/italic/code/links/citations). */
  text: string;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: string[];
}

export interface ChecklistBlock {
  type: 'checklist';
  items: Array<{ text: string; done: boolean }>;
}

export interface TableBlock {
  type: 'table';
  columns: string[];
  /** Row-major; each cell may carry inline marks (a `![](url)` image cell too). */
  rows: string[][];
}

export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
}

export interface MapBlock {
  type: 'map';
  ordered: boolean;
  /** Geocoded server-side (get_map) before the block is emitted. */
  stops: MapStop[];
}

export interface LinkBlock {
  type: 'link';
  url: string;
  title?: string;
  description?: string;
  /** Preview image URL, when the page had one. */
  image?: string;
  siteName?: string;
}

export interface DividerBlock {
  type: 'divider';
}

/** One block in a structured rich card. */
export type RichBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | ChecklistBlock
  | TableBlock
  | ImageBlock
  | MapBlock
  | LinkBlock
  | DividerBlock;

/** Flatten a rich card's blocks into plain text — for grounding, search, and
 *  anywhere a structured card needs to read back as prose (a block-stream card
 *  keeps its body here in meta.jzBlocks, not in props.text). */
export function blocksToText(blocks: readonly RichBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        parts.push(b.text);
        break;
      case 'list':
        parts.push(b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : '-'} ${i}`).join('\n'));
        break;
      case 'checklist':
        parts.push(b.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n'));
        break;
      case 'table':
        parts.push([b.columns.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n'));
        break;
      case 'map':
        parts.push(b.stops.map((s) => s.name).filter(Boolean).join(', '));
        break;
      case 'link':
        parts.push([b.title, b.description, b.url].filter(Boolean).join(' — '));
        break;
      case 'image':
        if (b.caption || b.alt) parts.push(b.caption ?? b.alt ?? '');
        break;
      case 'divider':
        break;
    }
  }
  return parts.filter((p) => p.trim()).join('\n\n');
}

