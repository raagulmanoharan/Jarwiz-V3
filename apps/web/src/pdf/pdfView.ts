/**
 * Per-card current-page store for PDF readers. Page is *view state* (where I'm
 * looking), not document state, so it lives in an ephemeral external store keyed
 * by shape id rather than a synced shape prop. The reader reads its page from
 * here; citation clicks on a response card flip the source here too.
 */

const pages = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribePdfView(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPdfPage(id: string): number {
  return pages.get(id) ?? 1;
}

export function setPdfPage(id: string, page: number): void {
  const next = Math.max(1, Math.floor(page));
  if (pages.get(id) === next) return;
  pages.set(id, next);
  emit();
}
