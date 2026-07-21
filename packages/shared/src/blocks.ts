/**
 * Structured rich-card blocks — the answer content model (owner call 2026-07-20).
 *
 * A doc answer is a SEQUENCE OF TYPED BLOCKS, not a wall of markdown the model
 * has to remember to format. The model composes it by calling construction tools
 * (add_paragraph / add_table / add_map / find_image / …); each tool appends one
 * validated, hydrated block. The card renders the blocks. This makes rich
 * constructs — tables, maps, images, links, checklists — reliable and
 * structured, instead of hoping the model writes correct markdown.
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

