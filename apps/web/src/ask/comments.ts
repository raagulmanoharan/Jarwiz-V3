/**
 * Proactive comments store — the FigJam-style notes Jarwiz pins to cards. An
 * external store the CommentLayer subscribes to; useNotice fills it from the
 * server's review pass. Dismissals are sticky (persisted by a content
 * signature) so a note the user waved off never nags them again.
 */

import type { NoticeComment } from '@jarwiz/shared';
import { createExternalStore } from '../lib/externalStore';

export interface BoardComment extends NoticeComment {
  /** Local id for React keys + open/dismiss targeting. */
  id: string;
  /** Content signature (cardId + body) — dedupe + sticky-dismiss key. */
  sig: string;
}

interface CommentState {
  comments: BoardComment[];
  /** Which comment's popover is open (only one at a time). */
  openId: string | null;
}

const DISMISS_KEY = 'jz-notice-dismissed';

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
const dismissed = loadDismissed();
function persistDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed].slice(-400)));
  } catch {
    /* storage full / unavailable — dismissals just won't persist */
  }
}

/** Stable-ish signature for a comment (cardId + normalised body). */
export function commentSig(c: NoticeComment): string {
  return `${c.cardId}::${c.body.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}`;
}

const store = createExternalStore<CommentState>({ comments: [], openId: null });

/** Replace the live comments with a fresh review's results, dropping anything
 *  the user has already dismissed and de-duping by signature. Preserves the
 *  open popover if that comment survives. */
export function setComments(incoming: NoticeComment[]): void {
  const seen = new Set<string>();
  const next: BoardComment[] = [];
  for (const c of incoming) {
    const sig = commentSig(c);
    if (dismissed.has(sig) || seen.has(sig)) continue;
    seen.add(sig);
    next.push({ ...c, sig, id: sig }); // sig is a fine stable id
  }
  store.update((s) => ({
    comments: next,
    openId: next.some((c) => c.id === s.openId) ? s.openId : null,
  }));
}

export function dismissComment(id: string): void {
  store.update((s) => {
    const c = s.comments.find((x) => x.id === id);
    if (c) {
      dismissed.add(c.sig);
      persistDismissed();
    }
    return { comments: s.comments.filter((x) => x.id !== id), openId: s.openId === id ? null : s.openId };
  });
}

export function toggleComment(id: string): void {
  store.update((s) => ({ ...s, openId: s.openId === id ? null : id }));
}

export function closeComments(): void {
  store.update((s) => (s.openId === null ? s : { ...s, openId: null }));
}

/** Clear everything on-screen without touching dismissals (e.g. board switch). */
export function clearComments(): void {
  store.set({ comments: [], openId: null });
}

export const subscribeComments = store.subscribe;
export const getComments = store.get;
