import { useState, useSyncExternalStore } from 'react';
import { getActiveBoard, subscribeBoards } from '../boards/boardStore';
import { BoardSwitcher } from '../boards/BoardSwitcher';
import { useCapabilities } from './useCapabilities';

/** Top-left chrome: the Jarwiz wordmark chip, active board name, and live/demo badge. */
export function Topbar() {
  const caps = useCapabilities();
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <>
      <div className="jz-topbar">
        <div className="jz-wordmark">
          <span className="jz-spark" aria-hidden>
            ✦
          </span>
          Jarwiz
        </div>
        <div className="jz-board-chip-wrap">
          <button
            className={`jz-board-chip${switcherOpen ? ' jz-board-chip--open' : ''}`}
            onClick={() => setSwitcherOpen((v) => !v)}
            title="Switch boards"
          >
            {board?.name ?? 'My workspace'}
            <span className="jz-board-chip-caret" aria-hidden>
              ▾
            </span>
          </button>
          {switcherOpen && <BoardSwitcher onClose={() => setSwitcherOpen(false)} />}
        </div>
        {caps?.live === false ? (
          <span
            className="jz-demo-badge"
            title="No API key configured — agents run a scripted demo, so output is illustrative rather than real."
          >
            Demo mode
          </span>
        ) : null}
      </div>
    </>
  );
}
