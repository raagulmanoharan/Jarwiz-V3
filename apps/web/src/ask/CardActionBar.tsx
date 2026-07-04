/**
 * The card action bar (Stitch-style) — a fixed contextual bar just below the
 * header that lights up in the SAME place whenever a single card is selected, so
 * the actions are predictable (no hunting, no per-card float). It holds one-tap
 * OPERATIONS on the artifact: Refine ▾ (transforms), Discuss, Based on ▾
 * (provenance). Typed/open questions live in the bottom prompt bar instead.
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue, type TLShapeId } from 'tldraw';
import { ASKABLE } from './askable';
import { useAsk } from './useAsk';
import { useDiagram } from '../agents/useDiagram';
import { useTidy, canTidy } from '../agents/useTidy';
import { useCluster, canCluster } from '../agents/useCluster';
import { getProvenance, getProvenanceMap, subscribeProvenance } from './provenance';
import { getOpenDiscuss, subscribeDiscuss, toggleDiscuss } from './discuss';

const ANSWER = new Set(['doc-card', 'table-card', 'diagram-card']);
type Transform = { label: string; run: () => void };

export function CardActionBar() {
  const editor = useEditor();
  const { ask } = useAsk();
  const { diagram } = useDiagram();
  const { tidy } = useTidy();
  const { cluster } = useCluster();
  useSyncExternalStore(subscribeProvenance, getProvenanceMap, getProvenanceMap);
  const openDiscuss = useSyncExternalStore(subscribeDiscuss, getOpenDiscuss, getOpenDiscuss);
  const [menu, setMenu] = useState<null | 'refine' | 'based'>(null);

  // One or more askable shapes selected → the bar lights up (same place always).
  const sel = useValue(
    'cardbar-selection',
    () => {
      const ids = editor.getSelectedShapeIds().filter((i) => { const t = editor.getShape(i)?.type; return t ? ASKABLE.has(t) : false; });
      if (ids.length === 0) return null;
      if (ids.length > 1) {
        const pdfCount = ids.filter((i) => editor.getShape(i)?.type === 'pdf-card').length;
        return { multi: true as const, ids, pdfCount, type: '', id: ids[0]! };
      }
      const id = ids[0]!;
      const s = editor.getShape(id)!;
      return { multi: false as const, ids, id, type: s.type };
    },
    [editor],
  );

  if (!sel) return null;
  const id = sel.id as TLShapeId;
  const ids = sel.ids as TLShapeId[];
  const prov = sel.multi ? undefined : getProvenance(id);

  const transforms: Transform[] = [];
  if (!sel.multi && ANSWER.has(sel.type)) {
    transforms.push(
      { label: 'Make it shorter', run: () => ask('Make this shorter and tighter, keeping the key points.', [id], { targetId: id }) },
      { label: 'Go deeper', run: () => ask('Go deeper — add detail, nuance, and specifics.', [id], { targetId: id }) },
    );
    if (sel.type !== 'table-card') transforms.push({ label: 'As a table', run: () => ask('Reformat this as a comparison table.', [id]) });
    if (sel.type !== 'diagram-card') transforms.push({ label: 'As a diagram', run: () => ask('Turn this into a diagram.', [id]) });
    transforms.push({ label: 'Regenerate', run: () => ask('Regenerate this, same intent, fresh take.', [id], { targetId: id }) });
  }
  if (sel.multi) {
    // Multi-select gets the same bar, with cross-selection transforms.
    transforms.push(
      { label: '✦ Summarise the selection', run: () => ask('Summarise the selected cards together into one concise doc.', ids) },
      { label: '✦ Combine into a doc', run: () => ask('Combine the selected cards into one structured document.', ids) },
    );
    if (sel.pdfCount >= 2) {
      transforms.push(
        { label: 'Find conflicts', run: () => ask('Find conflicts and contradictions between these documents, clause by clause.', ids) },
        { label: 'Compare clauses', run: () => ask('Compare these documents clause by clause, showing where each one stands and where they differ.', ids) },
      );
    }
  }
  if (canCluster(editor, ids)) transforms.push({ label: '✦ Cluster & summarise', run: () => cluster() });
  if (canTidy(editor, ids)) transforms.push({ label: '⤢ Tidy layout', run: () => tidy(ids) });
  transforms.push({ label: '◇ Make a flowchart', run: () => diagram('Turn this into a flowchart.', ids) });

  const runTransform = (t: Transform) => { setMenu(null); t.run(); };
  const zoomTo = (sid: TLShapeId) => {
    setMenu(null);
    const b = editor.getShapePageBounds(sid);
    editor.select(sid);
    if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 120 });
  };

  const style = {} as CSSProperties;
  return (
    <div className="jz-cardbar" style={style} onPointerDown={stopEventPropagation}>
      <div className="jz-cardbar-group">
        <button className={`jz-cardbar-btn${menu === 'refine' ? ' jz-cardbar-btn--open' : ''}`} onClick={() => setMenu(menu === 'refine' ? null : 'refine')}>
          ✦ Refine <span className="jz-cardbar-caret" aria-hidden>▾</span>
        </button>
        {menu === 'refine' ? (
          <div className="jz-cardbar-menu" role="menu">
            {transforms.map((t) => (
              <button key={t.label} className="jz-cardbar-item" onClick={() => runTransform(t)}>{t.label}</button>
            ))}
          </div>
        ) : null}
      </div>

      {sel.type === 'doc-card' ? (
        <button className={`jz-cardbar-btn${openDiscuss === id ? ' jz-cardbar-btn--on' : ''}`} onClick={() => toggleDiscuss(id)}>
          💬 Discuss
        </button>
      ) : null}

      {prov ? (
        <div className="jz-cardbar-group">
          <button className={`jz-cardbar-btn${menu === 'based' ? ' jz-cardbar-btn--open' : ''}`} onClick={() => setMenu(menu === 'based' ? null : 'based')}>
            Based on <span className="jz-cardbar-caret" aria-hidden>▾</span>
          </button>
          {menu === 'based' ? (
            <div className="jz-cardbar-menu" role="menu">
              {prov.sourceIds.map((sid, i) => editor.getShape(sid) ? (
                <button key={sid} className="jz-cardbar-item" onClick={() => zoomTo(sid)}>{prov.labels[i] ?? 'Source'}</button>
              ) : null)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
