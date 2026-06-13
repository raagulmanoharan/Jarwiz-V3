/**
 * Comment threads — a human primitive that agents also speak through.
 *
 * Each card can carry a thread of messages from you and from agents. Stored
 * module-side and persisted to localStorage (the board is the memory), keyed by
 * the card's stable shape id. External-store shape so the UI re-renders on
 * change; snapshots are stable references (a frozen EMPTY for threadless cards)
 * so useSyncExternalStore doesn't loop.
 */

import type { CommentMessage } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

type Threads = Record<string, CommentMessage[]>;

const KEY = 'jz-comments';
// A single stable empty array so threadless cards return a constant reference.
const EMPTY: CommentMessage[] = [];
const listeners = new Set<() => void>();

let threads: Threads = load();

function load(): Threads {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Threads) : {};
  } catch {
    return {};
  }
}

function commit(next: Threads): void {
  threads = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(threads));
  } catch {
    /* private mode — keep this session only */
  }
  listeners.forEach((l) => l());
}

export function subscribeComments(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCommentsSnapshot(): Threads {
  return threads;
}

export function getThread(cardId: TLShapeId): CommentMessage[] {
  return threads[cardId] ?? EMPTY;
}

export function commentCount(cardId: TLShapeId): number {
  return threads[cardId]?.length ?? 0;
}

let seq = 0;
const newId = () => `c${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function addComment(cardId: TLShapeId, message: Omit<CommentMessage, 'id' | 'ts'>): string {
  const id = newId();
  const msg: CommentMessage = { id, ts: Date.now(), ...message };
  commit({ ...threads, [cardId]: [...(threads[cardId] ?? []), msg] });
  return id;
}

/** Append streamed text to an existing message (an agent reply filling in). */
export function appendToComment(cardId: TLShapeId, id: string, delta: string): void {
  const thread = threads[cardId];
  if (!thread) return;
  commit({
    ...threads,
    [cardId]: thread.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)),
  });
}

export function clearThread(cardId: TLShapeId): void {
  if (!threads[cardId]) return;
  const next = { ...threads };
  delete next[cardId];
  commit(next);
}
