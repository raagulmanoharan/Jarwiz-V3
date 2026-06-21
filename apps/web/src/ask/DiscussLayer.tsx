/**
 * "Discuss" thread on an answer card (Big Rocks 3.3 — conversational depth).
 * Select a doc card → a "Discuss" chip at its top-right opens an inline thread.
 * Type a follow-up ("yes, but what about enterprise customers?") and the same
 * agent revises THIS card in place — no orphan cards — logging the exchange.
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import { addTurn, getThread, getThreads, subscribeDiscuss } from './discuss';
import { readSSE } from '../agents/sse';
import { startStreaming, stopStreaming } from '../agents/streaming';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from '../agents/presence';
import type { DocCardShape } from '../shapes';

const REVISE_AGENT = getAgent('writer');
type Delta = { type: 'delta'; textDelta: string } | { type: 'done' } | { type: 'error'; message: string };

export function DiscussLayer() {
  const editor = useEditor();
  useSyncExternalStore(subscribeDiscuss, getThreads, getThreads);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const target = useValue(
    'jz discuss target',
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const id = ids[0]!;
      const shape = editor.getShape(id);
      if (!shape || shape.type !== 'doc-card') return null;
      const b = editor.getShapePageBounds(id);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.maxX, y: b.minY });
      const vp = editor.getViewportScreenBounds();
      return { id, x: Math.min(p.x + 8, vp.w - 300), y: Math.max(8, p.y) };
    },
    [editor],
  );

  if (!target) return null;
  const thread = getThread(target.id);

  const submit = async () => {
    const instruction = value.trim();
    if (!instruction || busy) return;
    const shape = editor.getShape(target.id) as DocCardShape | undefined;
    if (!shape) return;
    const prior = getThread(target.id);
    const cardId = target.id;
    const baseText = shape.props.text;
    addTurn(cardId, { role: 'you', text: instruction });
    setValue('');
    setBusy(true);

    // The Writer takes the pen on this card and rewrites it live.
    editor.markHistoryStoppingPoint('discuss-revise'); // one undo per revision
    startStreaming(cardId);
    startPresence(REVISE_AGENT.id);
    setPresenceStatus(REVISE_AGENT.id, 'Revising the doc…');
    const moveCursor = () => { const b = editor.getShapePageBounds(cardId); if (b) setPresenceCursor(REVISE_AGENT.id, b.maxX - 14, b.maxY - 16); };
    moveCursor();

    let acc = '';
    let cleared = false;
    let errorMsg: string | null = null;
    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: baseText, instruction, thread: prior }),
      });
      if (!res.ok || !res.body) throw new Error(`revise failed (${res.status})`);
      await readSSE<Delta>(res.body, (ev) => {
        if (ev.type === 'delta') {
          if (!cleared) { cleared = true; } // swap to the new draft on first token
          acc += ev.textDelta;
          const cur = editor.getShape(cardId) as DocCardShape | undefined;
          if (cur) { editor.updateShape<DocCardShape>({ id: cardId, type: 'doc-card', props: { text: acc } }); moveCursor(); }
        } else if (ev.type === 'error') { errorMsg = ev.message; }
      });
      if (errorMsg) throw new Error(errorMsg);
      addTurn(cardId, { role: 'agent', text: 'Revised the document with your point.' });
    } catch (err) {
      // Roll back to the original text if nothing usable streamed in.
      if (!acc) { const cur = editor.getShape(cardId) as DocCardShape | undefined; if (cur) editor.updateShape<DocCardShape>({ id: cardId, type: 'doc-card', props: { text: baseText } }); }
      addTurn(cardId, { role: 'agent', text: `Couldn't revise: ${err instanceof Error ? err.message : 'failed'}` });
    } finally {
      stopStreaming(cardId);
      endPresence(REVISE_AGENT.id);
      setBusy(false);
    }
  };

  const style = { left: target.x, top: target.y } as CSSProperties;

  return (
    <div className="jz-discuss" style={style} onPointerDown={stopEventPropagation}>
      <button
        className={`jz-discuss-chip${open ? ' jz-discuss-chip--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        💬 Discuss{thread.length ? ` · ${thread.filter((t) => t.role === 'you').length}` : ''}
      </button>
      {open ? (
        <div className="jz-discuss-panel">
          <div className="jz-discuss-thread">
            {thread.length === 0 ? (
              <p className="jz-discuss-empty">Push back on this draft — the agent revises it in place.</p>
            ) : (
              thread.map((t, i) => (
                <div key={i} className={`jz-discuss-turn jz-discuss-turn--${t.role}`}>
                  <span className="jz-discuss-role">{t.role === 'you' ? 'You' : '✦ Agent'}</span>
                  <span className="jz-discuss-text">{t.text}</span>
                </div>
              ))
            )}
            {busy ? <div className="jz-discuss-turn jz-discuss-turn--agent"><span className="jz-discuss-role">✦ Agent</span><span className="jz-discuss-text">Revising…</span></div> : null}
          </div>
          <div className="jz-discuss-input-row">
            <textarea
              className="jz-discuss-input"
              value={value}
              rows={2}
              placeholder="Argue with it…"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button className="jz-discuss-send" disabled={!value.trim() || busy} onClick={() => void submit()}>
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
