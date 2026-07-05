/**
 * "Turn this into a flowchart" (canvas pivot P2 + responsiveness P2). The agent
 * fetches a graph, then VISIBLY DRAWS it: its cursor hops to each position and a
 * node pops in, one by one, then the connectors — so it reads as a collaborator
 * holding the pen. Never silent (task control + cursor up front), cancellable,
 * with error + Retry. One undo for the whole drawing.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Box,
  renderPlaintextFromRichText,
  useEditor,
  type Editor,
  type TLRichText,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import { getAgent, type AskSource, type DiagramSpec } from '@jarwiz/shared';
import { createFlowEdge, createFlowNode, groupFlowchart, layoutFlow } from './flowLayout';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { clearAgentTask, setAgentTask } from './agentTask';

const AGENT = getAgent('writer');
const DRAW_STEP_MS = 240;
const TIMEOUT_MS = 60_000;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => { if (signal.aborted) return res(); const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

function plainText(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try { return renderPlaintextFromRichText(editor, richText as TLRichText).trim(); } catch { return ''; }
}

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

      const allBounds = sourceIds.map((id) => editor.getShapePageBounds(id)).filter((b): b is NonNullable<typeof b> => Boolean(b));
      let origin: { x: number; y: number };
      if (allBounds.length) origin = { x: Math.max(...allBounds.map((b) => b.maxX)) + 80, y: Math.min(...allBounds.map((b) => b.minY)) };
      else { const c = editor.getViewportPageBounds().center; origin = { x: c.x - 100, y: c.y - 120 }; }

      const taskId = 'diagram';
      setIsDiagramming(true);
      const ac = new AbortController();
      abortRef.current = ac;
      let cancelled = false, timedOut = false;
      // Never silent: the Writer walks to the spot and a control appears, before
      // the model has even replied.
      startPresence(AGENT.id);
      setPresenceStatus(AGENT.id, 'Drawing a flowchart…');
      setPresenceCursor(AGENT.id, origin.x, origin.y);
      setAgentTask({ id: taskId, anchorId: sourceIds[0] ?? null, status: 'running', label: 'Drawing a flowchart…', onCancel: () => { cancelled = true; ac.abort(); } });
      const timer = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);

      const created: TLShapeId[] = [];
      try {
        const res = await fetch('/api/diagram', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, sources: sources.length ? sources : undefined }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`diagram failed (${res.status})`);
        const spec = (await res.json()) as DiagramSpec;
        if (!spec?.nodes?.length) throw new Error('empty diagram');

        editor.markHistoryStoppingPoint('draw-flowchart'); // whole draw = one undo
        let placed = layoutFlow(spec, origin);
        // The origin only cleared the SOURCES — if the layout's footprint
        // overlaps anything else (an answer card in the same lane), drop the
        // whole diagram below the blockers and lay out again.
        {
          const footprint = (ps: typeof placed) =>
            new Box(
              Math.min(...ps.map((p) => p.x)) - 40,
              Math.min(...ps.map((p) => p.y)) - 40,
              Math.max(...ps.map((p) => p.x + 220)) - Math.min(...ps.map((p) => p.x)) + 80,
              Math.max(...ps.map((p) => p.y + 120)) - Math.min(...ps.map((p) => p.y)) + 80,
            );
          const fp = footprint(placed);
          const blockers = editor
            .getCurrentPageShapes()
            .filter((s) => s.type !== 'arrow')
            .map((s) => editor.getShapePageBounds(s.id))
            .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.collides(fp));
          if (blockers.length) {
            origin = { x: origin.x, y: Math.max(...blockers.map((b) => b.maxY)) + 100 };
            placed = layoutFlow(spec, origin);
          }
        }
        const nodeId = new Map<string, TLShapeId>();

        // Bring the drawing area on screen BEFORE the pen starts. The draw is
        // deliberate choreography — happening outside the viewport it reads as
        // "nothing happened" (dogfood 2026-07-04 finding #6).
        {
          const xs = placed.map((p) => p.cx);
          const ys = placed.map((p) => p.cy);
          const area = new Box(
            Math.min(...xs) - 180,
            Math.min(...ys) - 120,
            Math.max(...xs) - Math.min(...xs) + 360,
            Math.max(...ys) - Math.min(...ys) + 260,
          );
          const union = allBounds.reduce((acc, b) => acc.union(b), area);
          // Fit, never magnify: targetZoom caps at 100% so a small diagram
          // doesn't blow up and clip (owner report 2026-07-05).
          editor.zoomToBounds(union, { animation: { duration: 320 }, inset: 100, targetZoom: 1 });
        }

        // Draw the nodes one by one — cursor hops to each, then it pops in.
        for (const p of placed) {
          if (ac.signal.aborted) throw new Error('aborted');
          setPresenceCursor(AGENT.id, p.cx, p.cy);
          await sleep(DRAW_STEP_MS, ac.signal);
          if (ac.signal.aborted) throw new Error('aborted');
          const id = createFlowNode(editor, p);
          nodeId.set(p.node.id, id);
          created.push(id);
        }
        // Then draw the connectors.
        for (const e of spec.edges) {
          if (ac.signal.aborted) throw new Error('aborted');
          const from = nodeId.get(e.from);
          const to = nodeId.get(e.to);
          if (from && to) { created.push(createFlowEdge(editor, from, to, e.label)); await sleep(90, ac.signal); }
        }

        clearAgentTask(taskId);
        // One unit: group the finished diagram (click = select-all-of-it for
        // asking; double-click enters the group to edit shapes) and LEAVE it
        // selected so the ask affordances are immediately at hand.
        const groupId = groupFlowchart(editor, created);
        editor.select(...(groupId ? [groupId] : created));
        const b = editor.getSelectionPageBounds();
        if (b) {
          // Pad the frame's bottom for the prompt-bar overlay (~180px of
          // screen the camera doesn't know about) so the last row isn't
          // hidden behind it.
          const padded = new Box(b.x, b.y, b.w, b.h + 180 / editor.getZoomLevel());
          editor.zoomToBounds(padded, { animation: { duration: 300 }, inset: 90, targetZoom: 1 });
        }
      } catch (err) {
        if (cancelled) {
          if (created.length) editor.deleteShapes(created); // undo the partial draw
          clearAgentTask(taskId);
        } else {
          const message = timedOut ? 'The agent timed out drawing.' : err instanceof Error ? err.message : 'Drawing failed.';
          if (created.length) editor.deleteShapes(created);
          setAgentTask({ id: taskId, anchorId: null, status: 'error', label: 'Flowchart', error: message, onRetry: () => { clearAgentTask(taskId); void diagram(prompt, sourceIds); } });
        }
      } finally {
        clearTimeout(timer);
        endPresence(AGENT.id);
        setIsDiagramming(false);
      }
    },
    [editor, isDiagramming],
  );

  return { diagram, isDiagramming };
}
