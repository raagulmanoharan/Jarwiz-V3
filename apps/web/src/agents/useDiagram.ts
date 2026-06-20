/**
 * "Turn this into a flowchart" (canvas pivot P2 — the AI builds primitives).
 *
 * Calls /api/diagram for a { nodes, edges } graph, then lays it out as NATIVE
 * tldraw geo shapes + bound connectors — real, editable primitives the user can
 * drag, restyle, and extend, not a fixed Mermaid card. The whole build is one
 * undo. This is the agent authoring on the same surface humans draw on.
 */

import { useCallback, useRef, useState } from 'react';
import {
  renderPlaintextFromRichText,
  useEditor,
  type Editor,
  type TLRichText,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import type { AskSource, DiagramSpec } from '@jarwiz/shared';
import { buildFlowchart } from './flowLayout';

function plainText(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try {
    return renderPlaintextFromRichText(editor, richText as TLRichText).trim();
  } catch {
    return '';
  }
}

/** Compact text grounding from a selected shape (card or primitive). */
function sourceFromShape(editor: Editor, shape: TLShape): AskSource | null {
  const p = shape.props as Record<string, unknown>;
  if (shape.type === 'doc-card' || shape.type === 'note-card') {
    const t = typeof p.text === 'string' ? p.text : '';
    return t ? { kind: 'note', text: t.slice(0, 2000) } : null;
  }
  if (shape.type === 'table-card') {
    const cols = (p.columns as string[]) ?? [];
    const rows = (p.rows as string[][]) ?? [];
    const text = [cols, ...rows].map((r) => r.join(' | ')).join('\n');
    return text.trim() ? { kind: 'note', text } : null;
  }
  if (shape.type === 'geo' || shape.type === 'text' || shape.type === 'note' || shape.type === 'arrow') {
    const t = plainText(editor, p.richText);
    return t ? { kind: 'note', text: t } : null;
  }
  return null;
}

export function useDiagram() {
  const editor = useEditor();
  const [isDiagramming, setIsDiagramming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const diagram = useCallback(
    async (prompt: string, sourceIds: TLShapeId[]) => {
      if (isDiagramming) return;

      const sources = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s))
        .map((s) => sourceFromShape(editor, s))
        .filter((s): s is AskSource => Boolean(s));

      // Anchor: to the right of the selection, else viewport centre.
      const selBounds = sourceIds.length ? editor.getShapePageBounds(sourceIds[0]!) : null;
      const allBounds = sourceIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      let origin: { x: number; y: number };
      if (allBounds.length) {
        const right = Math.max(...allBounds.map((b) => b.maxX));
        const top = Math.min(...allBounds.map((b) => b.minY));
        origin = { x: right + 80, y: top };
      } else {
        const c = editor.getViewportPageBounds().center;
        origin = { x: c.x - 100, y: c.y - 100 };
      }
      void selBounds;

      setIsDiagramming(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch('/api/diagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, sources: sources.length ? sources : undefined }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`diagram failed (${res.status})`);
        const spec = (await res.json()) as DiagramSpec;
        if (!spec?.nodes?.length) return;
        editor.markHistoryStoppingPoint('build-flowchart'); // whole build = one undo
        const ids = buildFlowchart(editor, spec, origin);
        if (ids.length) {
          editor.select(...ids);
          const b = editor.getSelectionPageBounds();
          if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 80 });
          editor.selectNone();
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[jarwiz] diagram error:', err.message);
        }
      } finally {
        setIsDiagramming(false);
      }
    },
    [editor, isDiagramming],
  );

  return { diagram, isDiagramming };
}
