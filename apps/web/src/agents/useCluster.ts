/**
 * Cluster & summarise (Big Rocks 2.1 + responsiveness P2). Synthesises the
 * user's stickies into named themes. Never silent: the Summarizer's cursor lands
 * on the notes and a control appears immediately; on result it lays the notes
 * into colour-coded columns and writes the "Themes" summary in live. One undo,
 * cancellable, error + Retry.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type Editor, type TLShapeId } from 'tldraw';
import { getAgent, type ClusterResult } from '@jarwiz/shared';
import { affinityColor, DOC_CARD_SIZE, type DocCardShape, type NoteCardShape } from '../shapes';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { frameBounds } from '../ui/bringIntoView';
import { startStreaming, stopStreaming } from './streaming';
import { clearAgentTask, setAgentTask } from './agentTask';

const AGENT = getAgent('summarizer');
const COL_W = 240;
const GAP_X = 44;
const GAP_Y = 14;
const HEADER_H = 40;
const TIMEOUT_MS = 60_000;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => { if (signal.aborted) return res(); const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

function selectedNotes(editor: Editor): TLShapeId[] {
  return editor
    .getSelectedShapeIds()
    .map((id) => ({ id, b: editor.getShapePageBounds(id), s: editor.getShape(id) }))
    .filter((x) => x.s?.type === 'note-card' && x.b)
    .sort((a, b) => (Math.abs(a.b!.minY - b.b!.minY) > 24 ? a.b!.minY - b.b!.minY : a.b!.minX - b.b!.minX))
    .map((x) => x.id);
}

export function canCluster(editor: Editor, ids: TLShapeId[]): boolean {
  let n = 0;
  for (const id of ids) if (editor.getShape(id)?.type === 'note-card') n++;
  return n >= 3;
}

export function useCluster() {
  const editor = useEditor();
  const [isClustering, setIsClustering] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cluster = useCallback(async () => {
    if (isClustering) return;
    const noteIds = selectedNotes(editor);
    if (noteIds.length < 3) return;

    const items = noteIds.map((id) => String((editor.getShape(id)?.props as { text?: string })?.text ?? ''));
    const bounds = noteIds.map((id) => editor.getShapePageBounds(id)).filter((b): b is NonNullable<typeof b> => Boolean(b));
    const originX = Math.min(...bounds.map((b) => b.minX));
    const originY = Math.min(...bounds.map((b) => b.minY));

    const taskId = 'cluster';
    setIsClustering(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let cancelled = false, timedOut = false;

    // Never silent: Summarizer arrives on the notes; control appears.
    startPresence(AGENT.id);
    setPresenceStatus(AGENT.id, 'Synthesising themes…');
    setPresenceCursor(AGENT.id, originX + 100, originY + 60);
    setAgentTask({ id: taskId, anchorId: noteIds[0] ?? null, status: 'running', label: 'Synthesising themes…', onCancel: () => { cancelled = true; ac.abort(); } });
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);

    const created: TLShapeId[] = [];
    let summaryId: TLShapeId | null = null;
    try {
      const res = await fetch('/api/cluster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), signal: ac.signal });
      if (!res.ok) throw new Error(`cluster failed (${res.status})`);
      const result = (await res.json()) as ClusterResult;
      if (!result?.themes?.length) throw new Error('no themes');
      if (ac.signal.aborted) throw new Error('aborted');

      editor.markHistoryStoppingPoint('cluster-stickies'); // one undo

      // Lay the notes into colour-coded columns — cursor sweeps each column.
      result.themes.forEach((theme, c) => {
        const x = originX + c * (COL_W + GAP_X);
        const tint = affinityColor(c);
        const headerId = createShapeId();
        created.push(headerId);
        editor.createShape({ id: headerId, type: 'text', x, y: originY, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: theme.name }] }] }, size: 's', color: 'black', w: COL_W, autoSize: false, scale: 1 } } as Parameters<typeof editor.createShape>[0]);
        setPresenceCursor(AGENT.id, x + COL_W / 2, originY);
        let y = originY + HEADER_H + GAP_Y;
        for (const m of theme.members) {
          const id = noteIds[m];
          if (!id) continue;
          const shape = editor.getShape(id) as NoteCardShape | undefined;
          if (!shape) continue;
          editor.updateShape<NoteCardShape>({ id, type: 'note-card', x, y, props: { w: COL_W, color: tint } });
          y += shape.props.h + GAP_Y;
        }
      });

      // Write the summary doc in live (chunked) with the streaming caret.
      summaryId = createShapeId();
      created.push(summaryId);
      const summaryX = originX + result.themes.length * (COL_W + GAP_X);
      editor.createShape<DocCardShape>({ id: summaryId, type: 'doc-card', x: summaryX, y: originY, props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, title: 'Themes', text: '', sourcePdfId: '' } });
      startStreaming(summaryId);
      setPresenceStatus(AGENT.id, 'Writing the summary…');
      const words = result.summary.split(/(?<=\s)/);
      let acc = '';
      for (let i = 0; i < words.length; i += 4) {
        if (ac.signal.aborted) throw new Error('aborted');
        acc += words.slice(i, i + 4).join('');
        editor.updateShape<DocCardShape>({ id: summaryId, type: 'doc-card', props: { text: acc } });
        const b = editor.getShapePageBounds(summaryId);
        if (b) setPresenceCursor(AGENT.id, b.maxX - 14, b.maxY - 16);
        await sleep(45, ac.signal);
      }
      stopStreaming(summaryId);
      clearAgentTask(taskId);
      editor.select(...created, ...noteIds);
      const b = editor.getSelectionPageBounds();
      if (b) frameBounds(editor, b, { margin: 40, animation: { duration: 300 } });
      editor.selectNone();
    } catch (err) {
      if (summaryId) stopStreaming(summaryId);
      if (cancelled) {
        if (created.length) editor.deleteShapes(created); // roll back the partial layout
        clearAgentTask(taskId);
      } else {
        const message = timedOut ? 'The agent timed out.' : err instanceof Error ? err.message : 'Clustering failed.';
        if (created.length) editor.deleteShapes(created);
        setAgentTask({ id: taskId, anchorId: noteIds[0] ?? null, status: 'error', label: 'Cluster', error: message, onRetry: () => { clearAgentTask(taskId); void cluster(); } });
      }
    } finally {
      clearTimeout(timer);
      endPresence(AGENT.id);
      setIsClustering(false);
    }
  }, [editor, isClustering]);

  return { cluster, isClustering };
}
