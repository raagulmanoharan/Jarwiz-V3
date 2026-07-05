/**
 * The card action bar — floats just ABOVE the selected card(s), so the
 * operations sit visually on the thing they act on (anchored via
 * useCardAnchor, camera-tracked, clamped clear of the topbar). It holds
 * one-tap OPERATIONS on the artifact: the Refine ▾ transforms. Typed/open
 * questions live in the prompt bar; provenance lives in the drawn edges.
 */

import { useState, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue, type TLShapeId } from 'tldraw';
import { AFFINITY_COLORS, NOTE_PAPER, type NoteCardShape } from '../shapes';
import { ASKABLE, hasAskableContent } from './askable';
import { PROFILE_PROMPT } from './profilePrompt';
import { useAsk } from './useAsk';
import { useDiagram } from '../agents/useDiagram';
import { useTidy, canTidy } from '../agents/useTidy';
import { useCluster, canCluster } from '../agents/useCluster';
import { useCardAnchor } from './useCardAnchor';

const ANSWER = new Set(['doc-card', 'table-card', 'diagram-card']);
type Transform = { label: string; run: () => void };

/** The sticky's muted palette — the refine bar doubles as its colour switcher
 *  (the tldraw style panel is hidden for our cards). */
const STICKY_TINTS = [NOTE_PAPER, ...AFFINITY_COLORS];

export function CardActionBar() {
  const editor = useEditor();
  const { ask } = useAsk();
  const { diagram } = useDiagram();
  const { tidy } = useTidy();
  const { cluster } = useCluster();
  const [menu, setMenu] = useState<null | 'refine' | 'tint'>(null);

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

  // dy clears the card's OUTSIDE title tag (doc/table titles render above the
  // card's top edge) — at -10 the bar sat on top of them.
  const anchor = useCardAnchor((sel?.ids ?? null) as TLShapeId[] | null, { edge: 'top', dy: -34 });

  // The selected sticky's current tint (drives the palette's "on" dot).
  const stickyColor = useValue(
    'cardbar-sticky-color',
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const s = editor.getShape(ids[0]!);
      return s?.type === 'note-card' ? String((s.props as { color?: string }).color || NOTE_PAPER) : null;
    },
    [editor],
  );

  if (!sel) return null;
  const id = sel.id as TLShapeId;
  const ids = sel.ids as TLShapeId[];
  // Content gate: an empty card has nothing to shorten, deepen, discuss, or
  // summarise — offering those reads as broken. Same predicate the prompt
  // bar's starter chips use.
  const contentful = ids.filter((i) => hasAskableContent(editor, editor.getShape(i)));
  const hasContent = !sel.multi && contentful.length === 1;

  const transforms: Transform[] = [];
  if (!sel.multi && hasContent && ANSWER.has(sel.type)) {
    transforms.push(
      { label: 'Make it shorter', run: () => ask('Make this shorter and tighter, keeping the key points.', [id], { targetId: id, skipClarify: true }) },
      { label: 'Go deeper', run: () => ask('Go deeper — add detail, nuance, and specifics.', [id], { targetId: id, skipClarify: true }) },
    );
    if (sel.type !== 'table-card') transforms.push({ label: 'As a table', run: () => ask('Reformat this as a comparison table.', [id], { skipClarify: true }) });
    if (sel.type !== 'diagram-card') transforms.push({ label: 'As a diagram', run: () => ask('Turn this into a diagram.', [id], { skipClarify: true }) });
    transforms.push({ label: 'Regenerate', run: () => ask('Regenerate this, same intent, fresh take.', [id], { targetId: id }) });
  }
  // The drop-moment profile (docs/PDF-EDGE.md build 3): a dropped PDF lands
  // selected, so this bar IS the drop moment — Profile rides it as a fixed
  // action (a profile is the document's summary; owner call, 2026-07-04),
  // not buried in the Refine menu.
  const profileable = !sel.multi && hasContent && sel.type === 'pdf-card';

  if (sel.multi && contentful.length > 0) {
    // Multi-select gets the same bar, with cross-selection transforms —
    // as long as at least one selected card actually holds content.
    transforms.push(
      { label: '✦ Summarise the selection', run: () => ask('Summarise the selected cards together into one concise doc.', ids, { skipClarify: true }) },
      { label: '✦ Combine into a doc', run: () => ask('Combine the selected cards into one structured document.', ids, { skipClarify: true }) },
    );
    if (sel.pdfCount >= 2) {
      transforms.push(
        { label: 'Find conflicts', run: () => ask('Find conflicts and contradictions between these documents, clause by clause.', ids, { skipClarify: true }) },
        { label: 'Compare clauses', run: () => ask('Compare these documents clause by clause, showing where each one stands and where they differ.', ids, { skipClarify: true }) },
      );
    }
  }
  if (canCluster(editor, ids)) transforms.push({ label: '✦ Cluster & summarise', run: () => cluster() });
  if (canTidy(editor, ids)) transforms.push({ label: '⤢ Tidy layout', run: () => tidy(ids) });
  if (contentful.length > 0) transforms.push({ label: '◇ Make a flowchart', run: () => diagram('Turn this into a flowchart.', ids) });

  const runTransform = (t: Transform) => { setMenu(null); t.run(); };

  // A sticky always gets its colour switcher — even empty (colour is how the
  // user organises annotations, independent of content).
  const sticky = !sel.multi && sel.type === 'note-card';

  // Nothing meaningful to offer (e.g. a single empty card) → no bar at all.
  // Provenance itself needs no button: the drawn edges ARE the lineage.
  if (transforms.length === 0 && !profileable && !sticky) return null;
  if (!anchor) return null;

  // Flipped below the card (no headroom above), the bar renders downward from
  // its anchor instead of upward — the CSS modifier keeps the entrance
  // animation's transform in agreement.
  const below = anchor.placement === 'below';
  const style: CSSProperties = {
    left: anchor.x,
    top: anchor.y,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
  return (
    <div className={`jz-cardbar${below ? ' jz-cardbar--below' : ''}`} style={style} onPointerDown={stopEventPropagation}>
      {profileable ? (
        <button
          className="jz-cardbar-btn"
          title="A one-glance summary: what this is, who wrote it, red flags, where to start"
          onClick={() => ask(PROFILE_PROMPT, [id], { skipClarify: true, logLabel: 'Summarized the document' })}
        >
          ✦ Summary
        </button>
      ) : null}
      {sticky ? (
        <div className="jz-cardbar-group">
          <button
            className={`jz-cardbar-btn${menu === 'tint' ? ' jz-cardbar-btn--open' : ''}`}
            aria-label="Sticky colour"
            title="Sticky colour"
            onClick={() => setMenu(menu === 'tint' ? null : 'tint')}
          >
            <span className="jz-cardbar-dot" style={{ background: stickyColor ?? NOTE_PAPER }} aria-hidden />
            <span className="jz-cardbar-caret" aria-hidden>▾</span>
          </button>
          {menu === 'tint' ? (
            <div className="jz-cardbar-menu jz-cardbar-menu--tints" role="menu" aria-label="Sticky colour">
              {STICKY_TINTS.map((c) => (
                <button
                  key={c}
                  className={`jz-cardbar-swatch${stickyColor === c ? ' jz-cardbar-swatch--on' : ''}`}
                  style={{ background: c }}
                  role="menuitem"
                  aria-label="Sticky colour"
                  onClick={() => {
                    setMenu(null);
                    editor.updateShape<NoteCardShape>({ id, type: 'note-card', props: { color: c } });
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {transforms.length > 0 ? (
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
      ) : null}



    </div>
  );
}
