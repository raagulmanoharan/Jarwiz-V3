/**
 * Tool rail — Flora-style vertical nav column on the left edge.
 * Icons from lucide-react (consistent stroke weight, same family throughout).
 *
 * Cursor → Hand → Text → Upload → Folder → HelpCircle
 */

import { createShapeId, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { MousePointer2, Hand, Type, Shapes, ArrowUpRight, Upload, Folder, HelpCircle } from 'lucide-react';
import { DOC_CARD_SIZE, type DocCardShape } from '../shapes';
import { toggleSidePanel } from './sidePanelStore';
import { toggleHelp } from './help';
import { useSyncExternalStore } from 'react';

/** Open a native file picker and hand the chosen PDFs to the same ingestion
 *  path a drag-and-drop takes (registerIngestion's 'files' handler). */
function pickAndIngestPdfs(editor: ReturnType<typeof useEditor>) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const vp = editor.getViewportPageBounds();
    editor.putExternalContent({ type: 'files', files, point: { x: vp.midX, y: vp.midY } });
  };
  input.click();
}

const ICON_SIZE = 18;
const ICON_PROPS = { size: ICON_SIZE, strokeWidth: 1.7 };

function spawnDocCard(editor: ReturnType<typeof useEditor>) {
  const vp = editor.getViewportPageBounds();
  const { w, h } = DOC_CARD_SIZE;
  const GAP = 24; // minimum gap between cards

  // Try viewport center first, then nudge down-right until we find clear space.
  let x = vp.midX - w / 2;
  let y = vp.midY - h / 2;

  const allShapes = editor.getCurrentPageShapes();
  const isOverlapping = (cx: number, cy: number) =>
    allShapes.some((s) => {
      const b = editor.getShapePageBounds(s.id);
      if (!b) return false;
      return (
        cx < b.maxX + GAP && cx + w > b.minX - GAP &&
        cy < b.maxY + GAP && cy + h > b.minY - GAP
      );
    });

  // Nudge in a spiral-like cascade until we find a clear spot (max 20 attempts).
  const step = Math.max(w, h) + GAP;
  for (let i = 0; i < 20 && isOverlapping(x, y); i++) {
    x += step * 0.5;
    y += step * 0.35;
  }

  const id = createShapeId();
  editor.createShape<DocCardShape>({
    id,
    type: 'doc-card',
    x,
    y,
    props: { w, h, text: '', title: '', sourcePdfId: '' },
  });
  editor.select(id);
  editor.setEditingShape(id);
  editor.setCurrentTool('select');

  // Pan camera so the new card is comfortably centered in view.
  const bounds = editor.getShapePageBounds(id);
  if (bounds) {
    editor.centerOnPoint({ x: bounds.midX, y: bounds.midY }, { animation: { duration: 200 } });
  }
}

export function ToolRail() {
  const editor = useEditor();
  const toolId = useValue('rail-tool', () => editor.getCurrentToolId(), [editor]);

  return (
    <div className="jz-rail" onPointerDown={stopEventPropagation}>
      <RailTool label="Select (V)" active={toolId === 'select'} onClick={() => editor.setCurrentTool('select')}>
        <MousePointer2 {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Pan (H)" active={toolId === 'hand'} onClick={() => editor.setCurrentTool('hand')}>
        <Hand {...ICON_PROPS} />
      </RailTool>
      <RailTool label="New doc" active={false} onClick={() => spawnDocCard(editor)}>
        <Type {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Shape (R)" active={toolId === 'geo'} onClick={() => editor.setCurrentTool('geo')}>
        <Shapes {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Arrow (A)" active={toolId === 'arrow'} onClick={() => editor.setCurrentTool('arrow')}>
        <ArrowUpRight {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Upload a PDF" active={false} onClick={() => pickAndIngestPdfs(editor)}>
        <Upload {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Boards" active={false} onClick={toggleSidePanel}>
        <Folder {...ICON_PROPS} />
      </RailTool>
      <div className="jz-rail-spacer" aria-hidden />
      <RailTool label="Help" active={false} onClick={toggleHelp}>
        <HelpCircle {...ICON_PROPS} />
      </RailTool>
    </div>
  );
}

function RailTool({ children, label, active, onClick }: { children: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`jz-rail-tool${active ? ' jz-rail-tool--active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
