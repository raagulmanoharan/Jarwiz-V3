/**
 * Model-inferred response-shape suggestion for the composer.
 *
 * As the user types a from-scratch prompt, we ask the model which shape the
 * answer wants and pre-pin the "/" mode chip for them — a smart head-start, not
 * a lock. The shape stays EXPLICIT: the chip IS the mode, and the user can
 * change it or dismiss it at any time (owner call 2026-07-07). This replaces the
 * earlier regex spike (PR #8) with a real classifier — no keyword rules.
 *
 * Returns a mode name ('list'|'table'|'diagram'|'prototype'|'dashboard'|'board')
 * or null (→ no chip; the default doc). Fails soft to null on any error.
 */

import type { ModeShape } from './modeShape';

const VALID: ReadonlySet<string> = new Set(['list', 'table', 'diagram', 'prototype', 'dashboard', 'map', 'board']);

export async function suggestShape(prompt: string, signal?: AbortSignal): Promise<ModeShape | null> {
  if (prompt.trim().length < 4) return null;
  try {
    const res = await fetch('/api/suggest-shape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { shape?: unknown };
    const shape = typeof data.shape === 'string' ? data.shape : '';
    return VALID.has(shape) ? (shape as ModeShape) : null;
  } catch {
    return null; // aborted or failed — no suggestion
  }
}
