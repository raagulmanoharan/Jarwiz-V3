/**
 * Lineage trace — "thinking you can see." Given an answer card, walk its
 * provenance edges backwards (arrows pointing INTO it, recursively) to
 * collect the full ancestry: the sources, the intermediate answers, and the
 * arrows connecting them. The LineageLayer renders the set as a spotlight —
 * members at full opacity, everything else dimmed — with zero shape mutation
 * (pure CSS), so tracing never touches undo history or the persisted board.
 */

import type { Editor, TLArrowBinding, TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

export interface Lineage {
  /** The card being traced (stays selected while the trace is up). */
  rootId: TLShapeId;
  /** Every shape in the ancestry: root, ancestors, and connecting arrows. */
  members: ReadonlySet<TLShapeId>;
}

const store = createExternalStore<Lineage | null>(null);

export const subscribeLineage = store.subscribe;
export const getLineage = store.get;

/** Arrows that END at this shape, paired with the shape each STARTS from. */
function incomingEdges(editor: Editor, id: TLShapeId): Array<{ arrow: TLShapeId; from: TLShapeId }> {
  const out: Array<{ arrow: TLShapeId; from: TLShapeId }> = [];
  for (const binding of editor.getBindingsToShape<TLArrowBinding>(id, 'arrow')) {
    if (binding.props.terminal !== 'end') continue;
    const arrowId = binding.fromId as TLShapeId;
    const start = editor
      .getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')
      .find((b) => b.props.terminal === 'start');
    if (start && start.toId !== id) out.push({ arrow: arrowId, from: start.toId as TLShapeId });
  }
  return out;
}

/** Walk the provenance graph upstream from `rootId`. Cycle-safe. */
export function collectAncestry(editor: Editor, rootId: TLShapeId): Set<TLShapeId> {
  const members = new Set<TLShapeId>([rootId]);
  const queue: TLShapeId[] = [rootId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const { arrow, from } of incomingEdges(editor, current)) {
      members.add(arrow);
      if (!members.has(from)) {
        members.add(from);
        queue.push(from);
      }
    }
  }
  return members;
}

/** Does this card have anything upstream worth tracing? */
export function hasAncestry(editor: Editor, id: TLShapeId): boolean {
  return incomingEdges(editor, id).length > 0;
}

export function traceLineage(editor: Editor, rootId: TLShapeId): void {
  const members = collectAncestry(editor, rootId);
  if (members.size <= 1) return; // nothing upstream — no veil for no reason
  store.set({ rootId, members });
}

export function clearLineage(): void {
  store.set(null);
}

export function isTracing(rootId?: TLShapeId): boolean {
  const l = store.get();
  return rootId ? l?.rootId === rootId : l !== null;
}
