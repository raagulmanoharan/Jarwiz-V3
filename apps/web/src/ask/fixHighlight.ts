/**
 * Transient "just changed" highlight. When "Let Jarwiz fix it" applies a
 * suggestion in place (CommentLayer), the card rewrites itself — this spotlights
 * exactly WHAT moved (the changed blocks of a doc, the changed cells of a table,
 * or the whole card when it was a full rewrite) with a soft glow that fades after
 * a couple of seconds.
 *
 * Kept OUT of shape.meta on purpose: it's ephemeral UI, not content, so it must
 * not land in the document, in undo history, or in a room sync. A tiny external
 * store keyed by shape id, with a self-clearing timer, is all it needs.
 */

import { useSyncExternalStore } from 'react';
import type { RichBlock } from '@jarwiz/shared';
import { createExternalStore } from '../lib/externalStore';

export interface FixHighlight {
  /** Bumps on every flash so a re-fire is always a distinct value. */
  nonce: number;
  /** Changed block indices — rich doc cards (meta.jzBlocks). */
  blocks?: number[];
  /** Changed [row, col] cells — table cards. */
  cells?: Array<[number, number]>;
  /** No per-part resolution (full rewrite / plain-text doc) → glow the card. */
  whole?: boolean;
}

const store = createExternalStore<Map<string, FixHighlight>>(new Map());
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nonce = 0;

/** Long enough to catch the eye and follow, short enough not to linger. Matches
 *  the ~2.4s glow animation in index.css (.jz-fix-glow), plus a little slack. */
const FIX_GLOW_MS = 2600;

/** Spotlight what a fix changed on `id`. No-op when nothing actually changed. */
export function flashFix(id: string, spec: Omit<FixHighlight, 'nonce'>): void {
  const has = (spec.blocks?.length ?? 0) > 0 || (spec.cells?.length ?? 0) > 0 || spec.whole === true;
  if (!has) return;
  store.update((m) => {
    const next = new Map(m);
    next.set(id, { ...spec, nonce: ++nonce });
    return next;
  });
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      store.update((m) => {
        if (!m.has(id)) return m;
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    }, FIX_GLOW_MS),
  );
}

/** Subscribe a card to its own fix-highlight (null when it isn't glowing). */
export function useFix(id: string): FixHighlight | null {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().get(id) ?? null,
    () => null,
  );
}

// ── Diffs ──────────────────────────────────────────────────────────────────
// The refine streams a whole fresh body, so "what changed" is a positional diff
// of the before/after content — good enough to spotlight, and honest: a moved
// paragraph or a rewritten cell reads as changed.

/** Content-only, order-sensitive key for one block. */
function blockKey(b: RichBlock): string {
  return JSON.stringify(b);
}

/** Indices of blocks new-or-changed vs `before` (by position). */
export function diffBlocks(before: readonly RichBlock[] | null, after: readonly RichBlock[]): number[] {
  const prev = before ?? [];
  const changed: number[] = [];
  for (let i = 0; i < after.length; i++) {
    if (i >= prev.length || blockKey(prev[i]!) !== blockKey(after[i]!)) changed.push(i);
  }
  return changed;
}

/** [row, col] of cells whose (trimmed) text changed vs `before`. */
export function diffCells(before: readonly string[][] | null, after: readonly string[][]): Array<[number, number]> {
  const prev = before ?? [];
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < after.length; r++) {
    const row = after[r]!;
    for (let c = 0; c < row.length; c++) {
      const b = (prev[r]?.[c] ?? '').trim();
      const a = (row[c] ?? '').trim();
      if (a !== b) cells.push([r, c]);
    }
  }
  return cells;
}
