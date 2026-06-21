/**
 * The tool rail — Jarwiz's content creators + FigJam primitives as a vertical
 * rail on the right edge (Stitch-style layout). We render our own rail rather
 * than tldraw's bottom toolbar so the bottom-centre is the prompt bar's alone and
 * we control placement; each button drives the real tldraw tool via the editor.
 *
 * Top group: Doc (`d`) and Sticky note (`n`) — our agent-aware content cards.
 * Then the primitives: select · hand · text · rectangle · ellipse · diamond ·
 * arrow · line · draw · frame · eraser (tldraw's own tools + shortcuts).
 */

import { useEffect } from 'react';
import {
  createShapeId,
  GeoShapeGeoStyle,
  stopEventPropagation,
  useEditor,
  useValue,
  type TLGeoShape,
} from 'tldraw';
import { NOTE_CARD_SIZE, NOTE_PAPER, DOC_CARD_SIZE, type NoteCardShape, type DocCardShape } from '../shapes';

type Geo = 'rectangle' | 'ellipse' | 'diamond';

export function ToolRail() {
  const editor = useEditor();
  const toolId = useValue('rail-tool', () => editor.getCurrentToolId(), [editor]);
  const geo = useValue('rail-geo', () => {
    try { return editor.getStyleForNextShape(GeoShapeGeoStyle) as Geo; } catch { return null; }
  }, [editor]);

  const addDoc = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<DocCardShape>({ id, type: 'doc-card', x: c.x - DOC_CARD_SIZE.w / 2, y: c.y - DOC_CARD_SIZE.h / 2, props: { ...DOC_CARD_SIZE, text: '', title: '', sourcePdfId: '' } });
    editor.select(id); editor.setEditingShape(id);
  };
  const addNote = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<NoteCardShape>({ id, type: 'note-card', x: c.x - NOTE_CARD_SIZE.w / 2, y: c.y - NOTE_CARD_SIZE.h / 2, props: { ...NOTE_CARD_SIZE, text: '', color: NOTE_PAPER } });
    editor.select(id); editor.setEditingShape(id);
  };

  const setTool = (id: string) => editor.setCurrentTool(id);
  const setGeo = (g: Geo) => {
    editor.run(() => {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, g);
      editor.setCurrentTool('geo');
    });
  };

  // d / n create content cards; never while typing or editing a shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing || editor.getEditingShapeId()) return;
      if (e.key === 'd') { e.preventDefault(); addDoc(); }
      if (e.key === 'n') { e.preventDefault(); addNote(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const geoActive = (g: Geo) => toolId === 'geo' && geo === g;

  return (
    <div className="jz-rail" onPointerDown={stopEventPropagation}>
      <button className="jz-rail-create" title="Start a doc (d)" data-testid="rail.doc" onClick={addDoc}>
        <Icon name="doc" /><span className="jz-rail-label">Doc</span>
      </button>
      <button className="jz-rail-create" title="Add a sticky note (n)" data-testid="rail.note" onClick={addNote}>
        <Icon name="note" /><span className="jz-rail-label">Note</span>
      </button>
      <span className="jz-rail-divider" aria-hidden />
      <RailTool name="select" label="Select (V)" icon="select" active={toolId === 'select'} onClick={() => setTool('select')} />
      <RailTool name="hand" label="Hand (H)" icon="hand" active={toolId === 'hand'} onClick={() => setTool('hand')} />
      <RailTool name="text" label="Text (T)" icon="text" active={toolId === 'text'} onClick={() => setTool('text')} />
      <RailTool name="rectangle" label="Rectangle (R)" icon="rectangle" active={geoActive('rectangle')} onClick={() => setGeo('rectangle')} />
      <RailTool name="ellipse" label="Ellipse (O)" icon="ellipse" active={geoActive('ellipse')} onClick={() => setGeo('ellipse')} />
      <RailTool name="diamond" label="Diamond" icon="diamond" active={geoActive('diamond')} onClick={() => setGeo('diamond')} />
      <RailTool name="arrow" label="Arrow (A)" icon="arrow" active={toolId === 'arrow'} onClick={() => setTool('arrow')} />
      <RailTool name="line" label="Line (L)" icon="line" active={toolId === 'line'} onClick={() => setTool('line')} />
      <RailTool name="draw" label="Draw" icon="draw" active={toolId === 'draw'} onClick={() => setTool('draw')} />
      <RailTool name="frame" label="Frame (F)" icon="frame" active={toolId === 'frame'} onClick={() => setTool('frame')} />
      <RailTool name="eraser" label="Eraser (E)" icon="eraser" active={toolId === 'eraser'} onClick={() => setTool('eraser')} />
    </div>
  );
}

function RailTool({ name, label, icon, active, onClick }: { name: string; label: string; icon: IconName; active: boolean; onClick: () => void }) {
  return (
    <button className={`jz-rail-tool${active ? ' jz-rail-tool--active' : ''}`} title={label} data-testid={`rail.${name}`} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

type IconName = 'doc' | 'note' | 'select' | 'hand' | 'text' | 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'draw' | 'frame' | 'eraser';

/** Compact 18px line icons (stroke = currentColor) — our own, so the rail is
 *  self-contained and matches the warm-ink aesthetic. */
function Icon({ name }: { name: IconName }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'doc': return <svg {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M9 12h6M9 16h6M9 8h3" /></svg>;
    case 'note': return <svg {...p}><path d="M5 5h14v9l-5 5H5z" /><path d="M19 14h-5v5" /></svg>;
    case 'select': return <svg {...p}><path d="M5 3l7 16 2.5-6.5L21 10z" /></svg>;
    case 'hand': return <svg {...p}><path d="M8 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L7 15.5c-.8-1.2.9-2.6 1.9-1.5L10 15" /></svg>;
    case 'text': return <svg {...p}><path d="M5 6V5h14v1M12 5v14M9 19h6" /></svg>;
    case 'rectangle': return <svg {...p}><rect x="4" y="6" width="16" height="12" rx="1.5" /></svg>;
    case 'ellipse': return <svg {...p}><ellipse cx="12" cy="12" rx="8" ry="6.5" /></svg>;
    case 'diamond': return <svg {...p}><path d="M12 4l8 8-8 8-8-8z" /></svg>;
    case 'arrow': return <svg {...p}><path d="M4 18L18 6M9 6h9v9" /></svg>;
    case 'line': return <svg {...p}><path d="M5 19L19 5" /></svg>;
    case 'draw': return <svg {...p}><path d="M4 20l4-1L19 8a2 2 0 00-3-3L5 16z" /></svg>;
    case 'frame': return <svg {...p}><path d="M8 3v18M16 3v18M3 8h18M3 16h18" /></svg>;
    case 'eraser': return <svg {...p}><path d="M5 15l6-6 8 8-3 3H9zM3 21h12" /></svg>;
  }
}
