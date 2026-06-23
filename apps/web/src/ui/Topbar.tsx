import { useState, useSyncExternalStore, useEffect } from 'react';
import { useEditor, useValue, exportAs, type TLShapeId } from 'tldraw';
import { getActiveBoard, subscribeBoards } from '../boards/boardStore';
import { BoardSwitcher } from '../boards/BoardSwitcher';
import { toggleHelp } from './help';

/**
 * Canvas chrome — top bar.
 *
 *   Left cluster:   ✦ Jarwiz · board chip ▾ · ⤺ ⤻ (undo/redo)
 *   Right cluster:  agent presence · Share · Export ⤓ · ? help · ⊙ profile
 *
 * Share is intentionally a no-op stub today (real sharing lands later).
 */
export function Topbar() {
  return (
    <div className="jz-topbar">
      <div className="jz-topbar-left">
        <Wordmark />
        <BoardChip />
        <UndoRedo />
      </div>
      <div className="jz-topbar-right">
        <AgentPresence />
        <ShareButton />
        <ExportMenu />
        <HelpButton />
        <ProfileChip />
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="jz-wordmark">
      <span className="jz-spark" aria-hidden>✦</span>
      Jarwiz
    </div>
  );
}

function BoardChip() {
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const [open, setOpen] = useState(false);
  return (
    <div className="jz-board-chip-wrap">
      <button
        className={`jz-board-chip${open ? ' jz-board-chip--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Switch boards"
      >
        {board?.name ?? 'My workspace'}
        <span className="jz-board-chip-caret" aria-hidden>▾</span>
      </button>
      {open && <BoardSwitcher onClose={() => setOpen(false)} />}
    </div>
  );
}

function UndoRedo() {
  const editor = useEditor();
  const canUndo = useValue('can-undo', () => editor.getCanUndo(), [editor]);
  const canRedo = useValue('can-redo', () => editor.getCanRedo(), [editor]);
  return (
    <div className="jz-tb-group">
      <button
        className="jz-tb-icon"
        title="Undo (⌘Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => editor.undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        className="jz-tb-icon"
        title="Redo (⌘⇧Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => editor.redo()}
      >
        <Icon name="redo" />
      </button>
    </div>
  );
}

/**
 * Agent presence — small circles for the four agents that live on every board.
 * Status today is "idle" for all four; the real per-agent activity wire-up
 * (presence store → status dot) lands with the agent-presence feature.
 */
const AGENTS = [
  { id: 'researcher', initial: 'R', color: '#3b82f6', label: 'Researcher' },
  { id: 'summarizer', initial: 'S', color: '#8b5cf6', label: 'Summarizer' },
  { id: 'brainstormer', initial: 'B', color: '#f59e0b', label: 'Brainstormer' },
  { id: 'writer', initial: 'W', color: '#10b981', label: 'Writer' },
];

function AgentPresence() {
  return (
    <div className="jz-presence" title="Agents on this board">
      {AGENTS.map((a) => (
        <span
          key={a.id}
          className="jz-presence-dot"
          style={{ background: a.color }}
          title={a.label}
          aria-label={a.label}
        >
          {a.initial}
        </span>
      ))}
    </div>
  );
}

function ShareButton() {
  return (
    <button
      className="jz-tb-pill"
      title="Share this board"
      onClick={() => {
        // Stub — real sharing lands later. Tell the user it's a placeholder
        // rather than silently doing nothing.
        console.info('[jarwiz] share is not wired up yet');
      }}
    >
      Share
    </button>
  );
}

function ExportMenu() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.jz-export-wrap')) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleExport = async (format: 'png' | 'svg') => {
    setOpen(false);
    const ids = Array.from(editor.getCurrentPageShapeIds()) as TLShapeId[];
    if (ids.length === 0) return;
    try {
      await exportAs(editor, ids, { format, name: 'jarwiz-board', background: true });
    } catch (err) {
      console.error('[jarwiz] export failed', err);
    }
  };

  return (
    <div className="jz-export-wrap">
      <button
        className="jz-tb-icon"
        title="Export board"
        aria-label="Export board"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="export" />
      </button>
      {open ? (
        <div className="jz-export-menu" role="menu">
          <button className="jz-export-item" onClick={() => handleExport('png')}>Export as PNG</button>
          <button className="jz-export-item" onClick={() => handleExport('svg')}>Export as SVG</button>
        </div>
      ) : null}
    </div>
  );
}

function HelpButton() {
  return (
    <button
      className="jz-tb-icon"
      title="Help — what Jarwiz can do, shortcuts, and a guided tour"
      aria-label="Help"
      onClick={toggleHelp}
    >
      ?
    </button>
  );
}

function ProfileChip() {
  // No auth yet — placeholder slot so the chrome reads as "real product".
  return (
    <button className="jz-profile" title="You (sign-in coming)" aria-label="Profile">
      R
    </button>
  );
}

type IconName = 'undo' | 'redo' | 'export';

function Icon({ name }: { name: IconName }) {
  const p = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'undo':
      return <svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg>;
    case 'redo':
      return <svg {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></svg>;
    case 'export':
      return <svg {...p}><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>;
  }
}
