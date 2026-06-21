/**
 * "Discuss" thread on an answer card (Big Rocks 3.3 — conversational depth).
 * Select a doc card → a "Discuss" chip at its top-right opens an inline thread.
 * Type a follow-up ("yes, but what about enterprise customers?") and the same
 * agent revises THIS card in place — no orphan cards — logging the exchange.
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import type { ReviseResult } from '@jarwiz/shared';
import { addTurn, getThread, getThreads, subscribeDiscuss } from './discuss';
import type { DocCardShape } from '../shapes';

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
    addTurn(target.id, { role: 'you', text: instruction });
    setValue('');
    setBusy(true);
    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: shape.props.text, instruction, thread: prior }),
      });
      if (!res.ok) throw new Error(`revise failed (${res.status})`);
      const result = (await res.json()) as ReviseResult;
      const current = editor.getShape(target.id) as DocCardShape | undefined;
      if (current && result?.text) {
        editor.markHistoryStoppingPoint('discuss-revise'); // one undo per revision
        editor.updateShape<DocCardShape>({ id: target.id, type: 'doc-card', props: { text: result.text } });
      }
      addTurn(target.id, { role: 'agent', text: 'Revised the document with your point.' });
    } catch (err) {
      if (err instanceof Error) {
        addTurn(target.id, { role: 'agent', text: `Couldn't revise: ${err.message}` });
      }
    } finally {
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
