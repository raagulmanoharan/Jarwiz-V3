/**
 * Thinking Machines — a left-rail tool with a flyout submenu of premade analysis
 * blocks (SWOT, competitive, risk, …). Pick one and it DROPS onto the canvas as
 * a machine block; you type the subject into the block and hit Run, and it
 * produces the analysis card beside it. Input is typed into the block.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createShapeId, stopEventPropagation, useEditor, type Editor } from 'tldraw';
import { Boxes } from 'lucide-react';
import { MACHINE_CARD_SIZE, type MachineCardShape } from '../shapes';
import { MACHINES, type Machine } from '../machines/catalog';
import { MACHINE_ICONS } from '../machines/icons';
import { getTheme, subscribeTheme } from './theme';
import { bringIntoView } from './bringIntoView';

/** Drop a machine block near the viewport centre, nudged clear of other shapes,
 *  then select it and put it into edit mode so its input is ready to type. */
function spawnMachine(editor: Editor, machine: Machine) {
  const { w, h } = MACHINE_CARD_SIZE;
  const vp = editor.getViewportPageBounds();
  const GAP = 24;
  let x = vp.midX - w / 2;
  let y = vp.midY - h / 2;
  const shapes = editor.getCurrentPageShapes();
  const overlaps = (cx: number, cy: number) =>
    shapes.some((s) => {
      const b = editor.getShapePageBounds(s.id);
      return b ? cx < b.maxX + GAP && cx + w > b.minX - GAP && cy < b.maxY + GAP && cy + h > b.minY - GAP : false;
    });
  for (let i = 0; i < 20 && overlaps(x, y); i++) {
    x += (w + GAP) * 0.5;
    y += (h + GAP) * 0.35;
  }
  const id = createShapeId();
  editor.createShape<MachineCardShape>({
    id, type: 'machine-card', x, y,
    props: { w, h, machineId: machine.id, subject: '', status: 'idle' },
  });
  editor.select(id);
  editor.setEditingShape(id);
  bringIntoView(editor, id);
}

/** The Machines rail tool + its flyout submenu. Rendered inside the left ToolRail. */
export function MachinesRail() {
  const editor = useEditor();
  useSyncExternalStore(subscribeTheme, getTheme, getTheme); // re-skin on theme flip
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.jz-machines')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (m: Machine) => {
    spawnMachine(editor, m);
    setOpen(false);
  };

  return (
    <div className="jz-machines" onPointerDown={stopEventPropagation}>
      <button
        className={`jz-rail-tool jz-machines-tool${open ? ' jz-rail-tool--active' : ''}`}
        title="Thinking Machines — premade analysis blocks"
        aria-label="Thinking Machines"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Boxes size={18} strokeWidth={1.7} />
      </button>

      {open ? (
        <div className="jz-machines-panel" role="menu">
          <div className="jz-machines-title"><Boxes size={13} /> Thinking Machines</div>
          <div className="jz-machines-list">
            {MACHINES.map((m) => (
              <button key={m.id} className="jz-machine-row" role="menuitem" onClick={() => pick(m)} title={m.blurb}>
                <span className="jz-machine-icon">{MACHINE_ICONS[m.icon]}</span>
                <span className="jz-machine-text">
                  <span className="jz-machine-name">{m.name}</span>
                  <span className="jz-machine-blurb">{m.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
