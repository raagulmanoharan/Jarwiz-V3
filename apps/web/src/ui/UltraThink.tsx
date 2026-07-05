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
            {resources.map((r) => (
              <ResourceRow key={r.url} r={r} added={added.has(r.url)} onAdd={() => addOne(r)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResourceRow({ r, added, onAdd }: { r: SuggestedResource; added: boolean; onAdd: () => void }) {
  return (
    <div className="jz-ultra-row">
      <span className="jz-ultra-kind" title={r.kind}>{KIND_ICON[r.kind]}</span>
      <div className="jz-ultra-body">
        <a className="jz-ultra-rtitle" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>
          {r.title}
        </a>
        {r.description ? <div className="jz-ultra-desc">{r.description}</div> : null}
        <div className="jz-ultra-meta">
          {r.reason ? <span className="jz-ultra-reason">{r.reason}</span> : null}
          <span className="jz-ultra-source">{r.source}</span>
        </div>
      </div>
      <button
        className={`jz-ultra-add${added ? ' jz-ultra-add--done' : ''}`}
        onClick={onAdd}
        disabled={added}
        aria-label={added ? 'Added' : 'Add to board'}
      >
        {added ? <Check size={14} /> : <Plus size={14} />}
      </button>
    </div>
  );
}
