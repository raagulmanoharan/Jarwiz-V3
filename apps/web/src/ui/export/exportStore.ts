/**
 * Export store — the board → shareable artifact, driven straight from the header
 * dropdown (no separate modal). The two modes (slideshow PDF, LLM markdown) run
 * as INDEPENDENT slots, so the user can kick both off at once and each shows its
 * own progress → download inline in the same panel.
 *
 * An external store (useSyncExternalStore) so the state survives the dropdown
 * closing and reopening: a run started, then dismissed from view, keeps
 * streaming and is there (working or ready) when the panel is reopened.
 */

import type { AnalyzeCard, ExportEvent, ExportMode } from '@jarwiz/shared';
import { readSSE } from '../../agents/sse';

export type ExportPhase = 'idle' | 'working' | 'ready' | 'error';

export interface ExportSlot {
  phase: ExportPhase;
  /** Honest "what it's doing now" line while working. */
  status: string;
  /** The finished artifact (HTML deck or markdown) — what Download uses. */
  text: string;
  format: 'html' | 'markdown' | null;
  error: string | null;
}

export interface ExportState {
  slideshow: ExportSlot;
  markdown: ExportSlot;
  /** Board title for download filenames (from the last started run). */
  title: string;
  /** The chosen slideshow template id (deckTemplates.ts) — restyles instantly. */
  template: string;
}

const idleSlot = (): ExportSlot => ({ phase: 'idle', status: '', text: '', format: null, error: null });

let state: ExportState = {
  slideshow: idleSlot(),
  markdown: idleSlot(),
  title: 'Untitled board',
  template: 'editorial',
};
const listeners = new Set<() => void>();

function commit(next: ExportState): void {
  state = next;
  for (const l of listeners) l();
}

function patchSlot(mode: ExportMode, patch: Partial<ExportSlot>): void {
  commit({ ...state, [mode]: { ...state[mode], ...patch } });
}

export function subscribeExport(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getExportState(): ExportState {
  return state;
}

/** Pick the slideshow template (restyles the generated deck instantly — no
 *  regeneration; the client re-wraps the same slides). */
export function setExportTemplate(id: string): void {
  if (id !== state.template) commit({ ...state, template: id });
}

// Per-mode in-flight handle + remembered inputs (for Try again).
const controllers: Record<ExportMode, AbortController | null> = { slideshow: null, markdown: null };
const lastInput: Record<ExportMode, { cards: AnalyzeCard[]; title: string } | null> = {
  slideshow: null,
  markdown: null,
};

/** Kick off (or restart) one mode. Independent of the other mode — both can run
 *  concurrently. Called from the dropdown with the board already gathered. */
export function startExport(mode: ExportMode, cards: AnalyzeCard[], title: string): void {
  const cleanTitle = title.trim() || 'Untitled board';
  lastInput[mode] = { cards, title: cleanTitle };
  commit({ ...state, title: cleanTitle });
  patchSlot(mode, { phase: 'working', status: 'Reading your whole board…', text: '', format: null, error: null });
  void run(mode);
}

/** Re-run one mode from scratch (after an error, or a manual retry). */
export function retryExport(mode: ExportMode): void {
  const input = lastInput[mode];
  if (input) startExport(mode, input.cards, input.title);
}

/** Clear one mode back to idle (and abort it if still running). */
export function dismissExport(mode: ExportMode): void {
  controllers[mode]?.abort();
  controllers[mode] = null;
  patchSlot(mode, idleSlot());
}

async function run(mode: ExportMode): Promise<void> {
  const input = lastInput[mode];
  if (!input) return;
  controllers[mode]?.abort();
  const ac = new AbortController();
  controllers[mode] = ac;

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, board: input.cards, title: input.title }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      // Surface the server's own message when it sent one (e.g. pilot budget).
      let message = `Export failed (${res.status}).`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* non-JSON body — keep the status message */
      }
      throw new Error(message);
    }

    let acc = '';
    await readSSE<ExportEvent>(res.body, (e) => {
      switch (e.type) {
        case 'status':
          if (state[mode].phase === 'working') patchSlot(mode, { status: e.message });
          break;
        case 'delta':
          acc += e.textDelta;
          patchSlot(mode, { text: acc });
          break;
        case 'done':
          patchSlot(mode, { phase: 'ready', format: e.format, text: acc });
          break;
        case 'error':
          patchSlot(mode, { phase: 'error', error: e.message });
          break;
      }
    });

    // Stream ended without a terminal event — treat non-empty output as ready.
    if (state[mode].phase === 'working') {
      if (acc.trim().length > 0) {
        patchSlot(mode, { phase: 'ready', format: mode === 'slideshow' ? 'html' : 'markdown', text: acc });
      } else {
        patchSlot(mode, { phase: 'error', error: 'The export came back empty.' });
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return; // dismissed / restarted
    patchSlot(mode, { phase: 'error', error: err instanceof Error ? err.message : 'Export failed' });
  } finally {
    if (controllers[mode] === ac) controllers[mode] = null;
  }
}
