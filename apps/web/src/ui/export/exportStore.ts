/**
 * Export store — the whole board → a shareable artifact, one modal, one run.
 *
 * The header's Export menu gathers the board's cards (it has the editor) and
 * calls `openExport`, which opens the modal and streams a generation from
 * POST /api/export. This module owns the run so the modal is a pure view:
 * it subscribes, shows the honest status while the artifact builds in, and
 * offers open/download/copy once it's ready. Inputs are remembered so "Try
 * again" re-runs without re-gathering the board.
 *
 * An external store (useSyncExternalStore) rather than React state because the
 * trigger (Topbar) and the view (App overlay) live in different trees — same
 * pattern as presence/streaming/sidePanel.
 */

import type { AnalyzeCard, ExportEvent, ExportMode } from '@jarwiz/shared';
import { readSSE } from '../../agents/sse';

export type ExportPhase = 'working' | 'ready' | 'error';

export interface ExportState {
  open: boolean;
  mode: ExportMode | null;
  phase: ExportPhase;
  /** Honest "what it's doing now" line while working. */
  status: string;
  /** The artifact as it streams in (HTML or markdown). */
  text: string;
  format: 'html' | 'markdown' | null;
  error: string | null;
  /** Board title — drives the deck title and download filenames. */
  title: string;
}

const IDLE: ExportState = {
  open: false,
  mode: null,
  phase: 'working',
  status: '',
  text: '',
  format: null,
  error: null,
  title: 'Untitled board',
};

let state: ExportState = IDLE;
const listeners = new Set<() => void>();

function emit(next: Partial<ExportState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function subscribeExport(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getExportState(): ExportState {
  return state;
}

// Remembered inputs (for Try again) + the in-flight run's abort handle.
let lastInput: { mode: ExportMode; cards: AnalyzeCard[]; title: string } | null = null;
let controller: AbortController | null = null;

/** Kick off an export and open the modal. Called from the header menu with the
 *  board already gathered (the menu has the editor). */
export function openExport(mode: ExportMode, cards: AnalyzeCard[], title: string): void {
  const cleanTitle = title.trim() || 'Untitled board';
  lastInput = { mode, cards, title: cleanTitle };
  emit({
    open: true,
    mode,
    phase: 'working',
    status: mode === 'slideshow' ? 'Reading your whole board…' : 'Reading your whole board…',
    text: '',
    format: null,
    error: null,
    title: cleanTitle,
  });
  void run();
}

/** Re-run the last export from scratch (after an error, or a manual retry). */
export function retryExport(): void {
  if (!lastInput) return;
  openExport(lastInput.mode, lastInput.cards, lastInput.title);
}

/** Close the modal and abort any run in flight. */
export function closeExport(): void {
  controller?.abort();
  controller = null;
  emit({ open: false });
}

async function run(): Promise<void> {
  if (!lastInput) return;
  controller?.abort();
  const ac = new AbortController();
  controller = ac;
  const { mode, cards, title } = lastInput;

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, board: cards, title }),
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
          // Only advance status while still working (a late status after done
          // must not flip the ready modal back into a spinner).
          if (state.phase === 'working') emit({ status: e.message });
          break;
        case 'delta':
          acc += e.textDelta;
          emit({ text: acc });
          break;
        case 'done':
          emit({ phase: 'ready', format: e.format, text: acc });
          break;
        case 'error':
          emit({ phase: 'error', error: e.message });
          break;
      }
    });

    // Stream ended without a terminal event — treat a non-empty artifact as
    // ready, otherwise as an error rather than an eternal spinner.
    if (state.phase === 'working') {
      if (acc.trim().length > 0) emit({ phase: 'ready', format: mode === 'slideshow' ? 'html' : 'markdown', text: acc });
      else emit({ phase: 'error', error: 'The export came back empty.' });
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return; // user closed / retried
    emit({ phase: 'error', error: err instanceof Error ? err.message : 'Export failed' });
  } finally {
    if (controller === ac) controller = null;
  }
}
