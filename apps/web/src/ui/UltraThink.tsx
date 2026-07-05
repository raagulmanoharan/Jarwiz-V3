/**
 * Ultra Think — the gradient discovery button that turns Jarwiz from a
 * collection tool into a discovery one. Once the board has enough substance,
 * the button reads the canvas and surfaces REAL related resources from the web
 * (grounded search, server-side; see discover.ts). Results open in a drawer of
 * add-able cards, each anchored to something you saved.
 *
 * Gated on board substance (≥3 contentful cards) so it never appears on a
 * blank canvas. Lives in the topbar's right cluster.
 */

import { useSyncExternalStore } from 'react';
import { useEditor, useValue } from 'tldraw';
import { Sparkles, Plus, Check, X, Video, FileText, BookOpen, GitBranch, Link2, Newspaper } from 'lucide-react';
import type { ResourceKind, SuggestedResource } from '@jarwiz/shared';
import { gatherBoardCards } from '../agents/boardText';
import { useDiscover } from '../ask/useDiscover';
import { getTheme, subscribeTheme } from './theme';

const KIND_ICON: Record<ResourceKind, React.ReactNode> = {
  video: <Video size={13} />,
  article: <Newspaper size={13} />,
  paper: <BookOpen size={13} />,
  doc: <FileText size={13} />,
  repo: <GitBranch size={13} />,
  other: <Link2 size={13} />,
};

export function UltraThink() {
  const editor = useEditor();
  useSyncExternalStore(subscribeTheme, getTheme, getTheme); // re-skin on theme flip
  const { phase, resources, added, run, dismiss, addOne } = useDiscover();

  // Gate: only worth offering once there's a real collection to extend.
  const enough = useValue('ultrathink-gate', () => gatherBoardCards(editor).length >= 3, [editor]);
  if (!enough && phase === 'idle') return null;

  const label =
    phase === 'thinking' ? 'Thinking…'
    : phase === 'ready' ? `${resources.length} found`
    : phase === 'empty' ? 'Nothing new'
    : phase === 'error' ? 'Try again'
    : 'Ultra think';

  return (
    <div className="jz-ultra">
      <button
        className={`jz-ultra-btn${phase === 'thinking' ? ' jz-ultra-btn--busy' : ''}${phase === 'ready' ? ' jz-ultra-btn--ready' : ''}`}
        onClick={() => (phase === 'idle' || phase === 'empty' || phase === 'error' ? run() : phase === 'thinking' ? dismiss() : undefined)}
        title="Find real related resources from the web, grounded on your board"
      >
        <Sparkles size={14} className="jz-ultra-spark" />
        <span>{label}</span>
      </button>

      {phase === 'ready' ? (
        <div className="jz-ultra-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="jz-ultra-drawer-head">
            <span className="jz-ultra-drawer-title">
              <Sparkles size={13} className="jz-ultra-spark" /> Found for your board
            </span>
            <div className="jz-ultra-drawer-actions">
              <button className="jz-ultra-again" onClick={() => run()}>Think again</button>
              <button className="jz-ultra-close" aria-label="Close" onClick={() => dismiss()}><X size={15} /></button>
            </div>
          </div>
          <div className="jz-ultra-list">
            {groupByTopic(resources).map(([topic, rows]) => (
              <div className="jz-ultra-group" key={topic || 'more'}>
                {topic ? <div className="jz-ultra-topic">{topic}</div> : null}
                {rows.map((r) => (
                  <ResourceRow key={r.url} r={r} added={added.has(r.url)} onAdd={() => addOne(r)} />
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

/** The whole row is the add target — clicking it spawns the card. The title
 *  stays a real link (opens the source in a new tab; it stops propagation so a
 *  title click doesn't also add). */
function ResourceRow({ r, added, onAdd }: { r: SuggestedResource; added: boolean; onAdd: () => void }) {
  return (
    <button
      className={`jz-ultra-row${added ? ' jz-ultra-row--done' : ''}`}
      onClick={() => !added && onAdd()}
      title={added ? 'Added to board' : 'Click to add this card to the board'}
    >
      <span className="jz-ultra-kind" title={r.kind}>{KIND_ICON[r.kind]}</span>
      <div className="jz-ultra-body">
        <div className="jz-ultra-toprow">
          <a
            className="jz-ultra-rtitle"
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            title={r.url}
            onClick={(e) => e.stopPropagation()}
          >
            {r.title}
          </a>
          <span className="jz-ultra-source">{r.source}</span>
        </div>
        {r.description ? <div className="jz-ultra-desc">{r.description}</div> : null}
        {r.reason ? <div className="jz-ultra-reason">{r.reason}</div> : null}
      </div>
      <span className={`jz-ultra-add${added ? ' jz-ultra-add--done' : ''}`} aria-hidden>
        {added ? <Check size={14} /> : <Plus size={14} />}
      </span>
    </button>
  );
}
