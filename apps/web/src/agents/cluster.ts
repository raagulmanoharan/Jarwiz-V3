/**
 * Surface-level clustering of recent drops.
 *
 * Researchers dump several artifacts at once — a link, a video, a doc — about
 * one topic. We watch the recent drops and, using only *surface* signals
 * (titles, filenames, domains — no deep content fetch, so it's instant), look
 * for a common thread. When two or more recent drops share one, we offer an
 * "auto-cluster" button; accepting tidies them together and raises content-aware
 * pills on the cluster.
 *
 * External store (useSyncExternalStore) so the ClusterButton stays live.
 */

import type { TLShapeId } from 'tldraw';
import { domainOf } from '../lib/url';

interface DropRecord {
  id: TLShapeId;
  kind: string;
  label: string;
  domain?: string;
  keywords: string[];
  ts: number;
}

export interface ClusterCandidate {
  ids: TLShapeId[];
  /** A short human label for the shared thread, e.g. "compliance". */
  theme: string;
}

const WINDOW_MS = 4 * 60_000; // only cluster things dropped in the last few minutes
const MAX_POOL = 12;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'from', 'into', 'how',
  'why', 'what', 'when', 'where', 'video', 'youtube', 'watch', 'pdf', 'doc', 'docx',
  'com', 'www', 'http', 'https', 'html', 'org', 'net', 'about', 'guide', 'intro',
  'overview', 'final', 'draft', 'copy', 'untitled', 'document', 'page', 'home',
]);

let pool: DropRecord[] = [];
let candidate: ClusterCandidate | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Clusters the user has already formed — new related drops join these. */
interface FormedCluster {
  offerId: string;
  ids: Set<TLShapeId>;
  keys: Set<string>;
  theme: string;
}
let formed: FormedCluster[] = [];
const joinListeners = new Set<(e: { offerId: string; shapeId: TLShapeId; theme: string }) => void>();

/** Signal keys for matching: significant keywords + a domain marker. */
function signalKeys(d: DropRecord): Set<string> {
  const keys = new Set(d.keywords);
  if (d.domain) keys.add(`dom:${d.domain}`);
  return keys;
}

function keywordsOf(label: string): string[] {
  return [
    ...new Set(
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
    ),
  ];
}

/** Two drops are linked if they share a keyword or the same domain. */
function linked(a: DropRecord, b: DropRecord): boolean {
  if (a.domain && b.domain && a.domain === b.domain) return true;
  return a.keywords.some((k) => b.keywords.includes(k));
}

/** Largest connected group of ≥2 recent drops, with a theme word. */
function recompute(): void {
  const now = Date.now();
  pool = pool.filter((d) => now - d.ts < WINDOW_MS).slice(-MAX_POOL);

  // Connected components over the "linked" graph.
  const seen = new Set<TLShapeId>();
  let best: DropRecord[] = [];
  for (const start of pool) {
    if (seen.has(start.id)) continue;
    const group: DropRecord[] = [];
    const stack = [start];
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      group.push(node);
      for (const other of pool) {
        if (!seen.has(other.id) && linked(node, other)) stack.push(other);
      }
    }
    if (group.length > best.length) best = group;
  }

  if (best.length < 2) {
    candidate = null;
    emit();
    return;
  }
  // Theme = the keyword (or domain) most shared across the group.
  const counts = new Map<string, number>();
  for (const d of best) for (const k of d.keywords) counts.set(k, (counts.get(k) ?? 0) + 1);
  const theme =
    [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    best.find((d) => d.domain)?.domain ??
    'related';
  candidate = { ids: best.map((d) => d.id), theme };
  emit();
}

/** Record a drop (or update its label once a title/preview arrives). */
export function noteDrop(d: { id: TLShapeId; kind: string; title?: string; url?: string }): void {
  const title = d.title && d.title.trim() && d.title !== 'YouTube' ? d.title.trim() : '';
  const domain = d.url ? domainOf(d.url) : undefined;
  const label = title || domain || d.kind;
  const record: DropRecord = {
    id: d.id,
    kind: d.kind,
    label,
    domain,
    keywords: keywordsOf(`${label} ${domain ?? ''}`),
    ts: Date.now(),
  };

  // Whenever something new is added, check it against already-formed clusters —
  // if it shares the thread, it joins (and gets the cluster's pills too).
  const recKeys = signalKeys(record);
  for (const f of formed) {
    if (!f.ids.has(record.id) && [...recKeys].some((k) => f.keys.has(k))) {
      f.ids.add(record.id);
      recKeys.forEach((k) => f.keys.add(k));
      pool = pool.filter((p) => p.id !== record.id);
      recompute();
      joinListeners.forEach((l) => l({ offerId: f.offerId, shapeId: record.id, theme: f.theme }));
      return;
    }
  }

  pool = [...pool.filter((p) => p.id !== d.id), record];
  recompute();
}

/** Listen for a new drop joining an existing cluster. */
export function onClusterJoin(
  cb: (e: { offerId: string; shapeId: TLShapeId; theme: string }) => void,
): () => void {
  joinListeners.add(cb);
  return () => {
    joinListeners.delete(cb);
  };
}

/** Register a freshly-formed cluster so later related drops can join it. */
export function formCluster(offerId: string, ids: TLShapeId[], theme: string): void {
  const keys = new Set<string>();
  for (const d of pool) if (ids.includes(d.id)) signalKeys(d).forEach((k) => keys.add(k));
  formed.push({ offerId, ids: new Set(ids), keys, theme });
  clearFromPool(ids); // they're clustered now — stop offering them as a candidate
}

export function dissolveCluster(offerId: string): void {
  formed = formed.filter((f) => f.offerId !== offerId);
}

/** Remove drops from the pool (e.g. after they've been clustered or deleted). */
export function clearFromPool(ids: TLShapeId[]): void {
  const set = new Set(ids);
  pool = pool.filter((p) => !set.has(p.id));
  recompute();
}

export function subscribeCluster(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getClusterCandidate(): ClusterCandidate | null {
  return candidate;
}
