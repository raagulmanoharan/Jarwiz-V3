/**
 * Scout — the discovery companion that turns Jarwiz from a collection tool
 * into a discovery one. Once the board has enough substance, it reads the
 * canvas and surfaces REAL related resources from the web — the things you
 * didn't know to look for (grounded search, server-side; see discover.ts).
 *
 * Behaviour: at rest the button doubles as a progress meter — an accent fill
 * creeps left→right as contentful cards land, and Scout only "activates"
 * (becomes clickable, solid accent) once the fill tops out. Turn it on and it
 * scouts in parallel — you keep working. When it lands it flips to "N resources
 * found" with an attention-drawing gradient; clicking opens a drawer of add-able
 * cards. Adding a card drops it on the board (surfaced on top) and removes it
 * from the drawer, so the list is a to-do that empties as you go.
 *
 * Always present, but gated on a readiness score before it can fire: Jarwiz
 * re-reads the board on every change and scores how substantial AND cohesive
 * it is (see boardConfidence.ts). That confidence drives the fill, so a
 * scattered or thin board stays low no matter how many cards it has. Lives in
 * the topbar's right cluster.
 */

import { useState, useSyncExternalStore } from 'react';
import { useEditor, useValue } from 'tldraw';
import { Plus, X, Video, FileText, BookOpen, GitBranch, Link2, Newspaper, File } from 'lucide-react';
import { JarwizSpark } from './JarwizSpark';
import type { ResourceKind, SuggestedResource } from '@jarwiz/shared';
import { gatherBoardCards } from '../agents/boardText';
import { scoutReadiness } from '../agents/boardConfidence';
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

export function Scout() {
  const editor = useEditor();
  useSyncExternalStore(subscribeTheme, getTheme, getTheme); // re-skin on theme flip
  const { phase, resources, run, dismiss, addOne } = useDiscover();
  const [open, setOpen] = useState(false);

  // The button is always shown, but only fires once the board holds a cohesive,
  // substantial thread worth scouting. On every board change Jarwiz re-scores
  // readiness (substance × cohesion — see boardConfidence.ts) and that
  // confidence, not a headcount, drives the fill: three thin or unrelated cards
  // stay low; three rich cards on one topic fill it up.
  const readiness = useValue('scout-readiness', () => scoutReadiness(gatherBoardCards(editor)), [editor]);
  const progress = readiness.progress;
  // "Filling" = at rest and not yet unlocked. Once research is in flight or has
  // landed (thinking/ready/…), the button owns those states regardless of score.
  const filling = phase === 'idle' && !readiness.active;

  const label =
    phase === 'thinking' ? 'Thinking…'
    : phase === 'ready' ? `${resources.length} resource${resources.length === 1 ? '' : 's'} found`
    : phase === 'empty' ? 'Nothing new'
    : phase === 'error' ? 'Try again'
    : 'Scout';

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
    <div className="jz-scout">
      <button
        className={`jz-scout-btn${phase === 'thinking' ? ' jz-scout-btn--busy' : ''}${phase === 'ready' ? ' jz-scout-btn--ready' : ''}${filling ? ' jz-scout-btn--filling' : ''}`}
        style={{ '--jz-scout-fill': progress } as React.CSSProperties}
        onClick={onClick}
        aria-disabled={filling}
        title={
          filling
            ? readiness.reason
            : phase === 'ready'
              ? 'Open the resources found for your board'
              : 'Scout the web for real resources related to your board'
        }
      >
        <JarwizSpark size={14} className="jz-scout-spark" />
        <span>{label}</span>
      </button>

      {drawerOpen ? (
        <div className="jz-scout-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="jz-scout-drawer-head">
            <span className="jz-scout-drawer-title">
              <JarwizSpark size={13} className="jz-scout-spark" /> Found for your board
            </span>
            <div className="jz-scout-drawer-actions">
              <button className="jz-scout-again" onClick={() => { setOpen(false); run(); }}>Think again</button>
              <button className="jz-scout-close" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
            </div>
          </div>
          <div className="jz-scout-list">
            {groupByTopic(resources).map(([topic, rows]) => (
              <div className="jz-scout-group" key={topic || 'more'}>
                {topic ? <div className="jz-scout-topic">{topic}</div> : null}
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
    <button className="jz-scout-row" onClick={onAdd} title="Click to add this card to the board">
      <span className="jz-scout-kind" title={r.kind}>{KIND_ICON[r.kind]}</span>
      <div className="jz-scout-body">
        <div className="jz-scout-rtitle">{r.title}</div>
        {r.description ? <div className="jz-scout-desc">{r.description}</div> : null}
        {r.reason ? <div className="jz-scout-reason">{r.reason}</div> : null}
      </div>
      <span className="jz-scout-add" aria-hidden><Plus size={14} /></span>
    </button>
  );
}
