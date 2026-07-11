/**
 * Tool rail — Flora-style vertical nav column on the left edge.
 * Icons from lucide-react (consistent stroke weight, same family throughout).
 *
 * Select → Pan → Text → Sticky → Prototype → Machines → Upload → Help
 */

import { createShapeId, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { MousePointer2, Hand, Type, StickyNote, AppWindow, Upload, HelpCircle } from 'lucide-react';
import { DOC_CARD_SIZE, NOTE_CARD_SIZE, NOTE_PAPER, PROTOTYPE_PROMPT_SIZE, type DocCardShape, type NoteCardShape, type PrototypeCardShape } from '../shapes';
import { toggleHelp } from './help';
import { MachinesRail } from './MachinesPalette';
import { useSyncExternalStore } from 'react';
import { isOnboarding, subscribeOnboarding } from '../ask/onboardingStore';
import { bringIntoView } from './bringIntoView';

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

/** Viewport-centred position nudged down-right until it doesn't overlap
 *  anything (max 20 attempts) — shared by the doc and sticky spawners. */
function findFreeSpot(editor: ReturnType<typeof useEditor>, w: number, h: number) {
  const vp = editor.getViewportPageBounds();
  const GAP = 24;
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
  const step = Math.max(w, h) + GAP;
  for (let i = 0; i < 20 && isOverlapping(x, y); i++) {
    x += step * 0.5;
    y += step * 0.35;
  }
  return { x, y };
}

function focusNewShape(editor: ReturnType<typeof useEditor>, id: ReturnType<typeof createShapeId>) {
  editor.select(id);
  editor.setEditingShape(id);
  editor.setCurrentTool('select');
  bringIntoView(editor, id);
}

function spawnDocCard(editor: ReturnType<typeof useEditor>) {
  const { w, h } = DOC_CARD_SIZE;
  const { x, y } = findFreeSpot(editor, w, h);
  const id = createShapeId();
  editor.createShape<DocCardShape>({
    id,
    type: 'doc-card',
    x,
    y,
    props: { w, h, text: '', title: '', sourcePdfId: '' },
  });
  focusNewShape(editor, id);
}

/** Drop a Prototype card, open for its prompt — the user types what UI to build
 *  ("a timer app") and the card generates a live, self-contained UI in place. */
function spawnPrototypeCard(editor: ReturnType<typeof useEditor>) {
  const { w, h } = PROTOTYPE_PROMPT_SIZE;
  const { x, y } = findFreeSpot(editor, w, h);
  const id = createShapeId();
  editor.createShape<PrototypeCardShape>({
    id,
    type: 'prototype-card',
    x,
    y,
    props: { w, h, html: '', title: '', prompt: '', status: 'idle' },
  });
  focusNewShape(editor, id);
}

/** One sticky, open for typing — stickies are the USER's annotation medium
 *  (owner decision 2026-07-05), so they need a first-class creator; until now
 *  they only appeared in AI-generated batches. */
function spawnStickyNote(editor: ReturnType<typeof useEditor>) {
  const { w, h } = NOTE_CARD_SIZE;
  const { x, y } = findFreeSpot(editor, w, h);
  const id = createShapeId();
  editor.createShape<NoteCardShape>({
    id,
    type: 'note-card',
    x,
    y,
    props: { w, h, text: '', color: NOTE_PAPER },
  });
  focusNewShape(editor, id);
}

export function ToolRail() {
  const editor = useEditor();
  const toolId = useValue('rail-tool', () => editor.getCurrentToolId(), [editor]);
  // During intent-first onboarding the rail steps off-screen, then slides back
  // in as the board opens (onboardingStore, driven by the PromptBar).
  const onboarding = useSyncExternalStore(subscribeOnboarding, isOnboarding, isOnboarding);

  return (
    <div className={`jz-rail${onboarding ? ' jz-rail--away' : ''}`} onPointerDown={stopEventPropagation}>
      <RailTool label="Select (V)" active={toolId === 'select'} onClick={() => editor.setCurrentTool('select')}>
        <MousePointer2 {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Pan (H)" active={toolId === 'hand'} onClick={() => editor.setCurrentTool('hand')}>
        <Hand {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Text card" active={false} onClick={() => spawnDocCard(editor)}>
        <Type {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Sticky note" active={false} onClick={() => spawnStickyNote(editor)}>
        <StickyNote {...ICON_PROPS} />
      </RailTool>
      {/* The geo Shape tool is gone (owner call 2026-07-10): it armed a
          draw-a-shape mode that read as "nothing happened", and raw geo
          primitives sit outside the card design system anyway. The Arrow and
          Boards buttons followed (owner call 2026-07-11) — arrows stay on the
          A shortcut and in generated diagrams; the Boards panel opens from
          the topbar's workspace name. */}
      <RailTool label="Prototype a UI" active={false} onClick={() => spawnPrototypeCard(editor)}>
        <AppWindow {...ICON_PROPS} />
      </RailTool>
      <MachinesRail />
      <RailTool label="Upload a PDF" active={false} onClick={() => pickAndIngestPdfs(editor)}>
        <Upload {...ICON_PROPS} />
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
