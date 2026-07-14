/**
 * Deep Think — the discovery button that turns Jarwiz from a collection tool
 * into a discovery one. Once the board has enough substance, it reads the
 * canvas and surfaces REAL related resources from the web (grounded search,
 * server-side; see discover.ts).
 *
 * Behaviour: a calm accent button at rest. Turn it on and it researches in
 * parallel — you keep working. When it lands it flips to "N resources found"
 * with an attention-drawing gradient; clicking opens a drawer of add-able
 * cards. Adding a card drops it on the board (surfaced on top) and removes it
 * from the drawer, so the list is a to-do that empties as you go.
 *
 * Always present, but gated on board substance (≥3 contentful cards) before it
 * can fire: at rest the button doubles as a progress meter — an accent fill
 * creeps left→right as contentful cards land, and the button only "activates"
 * (becomes clickable, solid accent) once the fill tops out. Lives in the
 * topbar's right cluster.
 */

import { useState, useSyncExternalStore } from 'react';
import { useEditor, useValue } from 'tldraw';
import { Plus, X, Video, FileText, BookOpen, GitBranch, Link2, Newspaper, File } from 'lucide-react';
import { JarwizSpark } from './JarwizSpark';
import type { ResourceKind, SuggestedResource } from '@jarwiz/shared';
import { gatherBoardCards } from '../agents/boardText';
import { useDiscover } from '../ask/useDiscover';
import { getTheme, subscribeTheme } from './theme';

const KIND_ICON: Record<ResourceKind, React.ReactNode> = {
  video: <Video size={13} />,
  news: <Newspaper size={13} />,
  article: <FileText size={13} />,
  paper: <BookOpen size={13} />,
  pdf: <File size={13} />,
  doc: <FileText size={13} />,
  repo: <GitBranch size={13} />,
  other: <Link2 size={13} />,
};

export function UltraThink() {
  const editor = useEditor();
  useSyncExternalStore(subscribeTheme, getTheme, getTheme); // re-skin on theme flip
  const { phase, resources, run, dismiss, addOne } = useDiscover();
  const [open, setOpen] = useState(false);

  // The button is always shown, but only fires once there's a real collection
  // to extend. Below the bar it reads as a progress meter that fills as
  // contentful cards land; `progress` (0→1) drives the CSS fill width.
  const NEEDED = 3;
  const count = useValue('ultrathink-count', () => gatherBoardCards(editor).length, [editor]);
  const progress = Math.min(count / NEEDED, 1);
  // "Filling" = at rest and not yet unlocked. Once research is in flight or has
  // landed (thinking/ready/…), the button owns those states regardless of count.
  const filling = phase === 'idle' && count < NEEDED;

  const label =
    phase === 'thinking' ? 'Thinking…'
    : phase === 'ready' ? `${resources.length} resource${resources.length === 1 ? '' : 's'} found`
    : phase === 'empty' ? 'Nothing new'
    : phase === 'error' ? 'Try again'
    : 'Deep think';

  const onClick = () => {
    if (filling) return; // not enough on the board yet — the meter is still filling
    if (phase === 'idle' || phase === 'empty' || phase === 'error') {
      setOpen(false);
      run();
    } else if (phase === 'thinking') {
      dismiss();
    } else if (phase === 'ready') {
      setOpen((o) => !o);
    }
  };

  const drawerOpen = phase === 'ready' && open;

  return (
    <div className="jz-ultra">
      <button
        className={`jz-ultra-btn${phase === 'thinking' ? ' jz-ultra-btn--busy' : ''}${phase === 'ready' ? ' jz-ultra-btn--ready' : ''}${filling ? ' jz-ultra-btn--filling' : ''}`}
        style={{ '--jz-ultra-fill': progress } as React.CSSProperties}
        onClick={onClick}
        aria-disabled={filling}
        title={
          filling
            ? 'Add a few cards to your board to unlock Deep think'
            : phase === 'ready'
              ? 'Open the resources found for your board'
              : 'Research real related resources from the web, grounded on your board'
        }
      >
        <JarwizSpark size={14} className="jz-ultra-spark" />
        <span>{label}</span>
      </button>

      {drawerOpen ? (
        <div className="jz-ultra-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="jz-ultra-drawer-head">
            <span className="jz-ultra-drawer-title">
              <JarwizSpark size={13} className="jz-ultra-spark" /> Found for your board
            </span>
            <div className="jz-ultra-drawer-actions">
              <button className="jz-ultra-again" onClick={() => { setOpen(false); run(); }}>Think again</button>
              <button className="jz-ultra-close" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
            </div>
          </div>
          <div className="jz-ultra-list">
            {groupByTopic(resources).map(([topic, rows]) => (
              <div className="jz-ultra-group" key={topic || 'more'}>
                {topic ? <div className="jz-ultra-topic">{topic}</div> : null}
                {rows.map((r) => (
                  <ResourceRow key={r.url} r={r} onAdd={() => addOne(r)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Preserve server order, but collect each theme's rows together. */
function groupByTopic(resources: SuggestedResource[]): Array<[string, SuggestedResource[]]> {
  const groups: Array<[string, SuggestedResource[]]> = [];
  const index = new Map<string, SuggestedResource[]>();
  for (const r of resources) {
    const key = r.topic || '';
    let bucket = index.get(key);
    if (!bucket) {
      bucket = [];
      index.set(key, bucket);
      groups.push([key, bucket]);
    }
    bucket.push(r);
  }
  return groups;
}

/** The whole row is the add target — clicking it spawns the card and the row
 *  leaves the list. No URL is shown: just the title, a brief description and a
 *  one-line reason for why it belongs on the board. */
function ResourceRow({ r, onAdd }: { r: SuggestedResource; onAdd: () => void }) {
  return (
    <button className="jz-ultra-row" onClick={onAdd} title="Click to add this card to the board">
      <span className="jz-ultra-kind" title={r.kind}>{KIND_ICON[r.kind]}</span>
      <div className="jz-ultra-body">
        <div className="jz-ultra-rtitle">{r.title}</div>
        {r.description ? <div className="jz-ultra-desc">{r.description}</div> : null}
        {r.reason ? <div className="jz-ultra-reason">{r.reason}</div> : null}
      </div>
      <span className="jz-ultra-add" aria-hidden><Plus size={14} /></span>
    </button>
  );
}
