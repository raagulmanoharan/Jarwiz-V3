/**
 * Edit-vs-new intent for a selected card + a typed composer prompt.
 *
 * SHAPE is always explicit (the "/" mode; no mode → doc). But when a single
 * artifact card is selected and you type an instruction, whether that EDITS the
 * card in place ("make it shorter", "focus on APAC", "add a column") or spins up
 * a NEW card from it ("write a summary", "what are the risks") is inferred from
 * intent — asked of the model, not a keyword regex (owner call 2026-07-07).
 *
 * The classifier lives on the server (`/api/intent`); this is the thin client
 * that calls it. On any failure it returns 'new' — the non-destructive default
 * (a new card is undo-free; an in-place edit replaces the artifact).
 */

import type { AskShape } from '@jarwiz/shared';

/** Card types whose content can be regenerated IN PLACE, and the AskShape the
 *  edit keeps (so a table stays a table, a dashboard a dashboard). Cards absent
 *  here (pdf/image/link/youtube/sheet/note) are never edited in place — a typed
 *  prompt on them always makes a new doc. */
export const REFINE_SHAPE: Record<string, AskShape> = {
  'doc-card': 'doc',
  'table-card': 'table',
  'diagram-card': 'diagram',
  'prototype-card': 'prototype',
  'dashboard-card': 'dashboard',
  'map-card': 'map',
};

export const INLINE_EDITABLE = new Set(Object.keys(REFINE_SHAPE));

/** Ask the server whether the prompt edits the selected card or makes a new one. */
export async function classifyRefineIntent(prompt: string, cardType: string): Promise<'edit' | 'new'> {
  try {
    const res = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cardType }),
    });
    if (!res.ok) return 'new';
    const data = (await res.json()) as { intent?: string };
    return data.intent === 'edit' ? 'edit' : 'new';
  } catch {
    return 'new';
  }
}

/** Ask the server which @mentioned card (if any) the PROMPT asks to update in
 *  place — the multi-card case ("rewrite @A using @B"). Returns the 0-based
 *  index into `cards`, or null for a new card. Fails safe to null (new). */
export async function resolveMentionTarget(
  prompt: string,
  cards: Array<{ title: string; type: string }>,
): Promise<number | null> {
  if (cards.length === 0) return null;
  try {
    const res = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cards }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { target?: number | null };
    return typeof data.target === 'number' && data.target >= 0 && data.target < cards.length ? data.target : null;
  } catch {
    return null;
  }
}
