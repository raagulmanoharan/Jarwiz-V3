/**
 * Machine block — an on-canvas "Thinking Machine". You drop it from the rail,
 * type the subject into it, and hit Run; it produces the analysis card beside
 * it (via the Ask pipeline, driven by MachineRunner in the overlay so this shape
 * needn't import Ask). A block is a premade analysis (SWOT, competitive, risk…);
 * which one it is comes from `machineId`, resolved against the catalog.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useValue,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { ArrowRight, Loader2, Check } from 'lucide-react';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { MACHINES, resolveMachineOptions } from '../machines/catalog';
import { MACHINE_ICONS } from '../machines/icons';
import { requestMachineRun } from '../machines/runStore';
import { useFitHeight } from './useFitHeight';

export interface MachineCardProps {
  w: number;
  h: number;
  /** Which machine this is — a catalog id (e.g. "swot"). */
  machineId: string;
  /** The subject the user typed in. */
  subject: string;
  /** 'idle' | 'running' | 'done'. */
  status: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'machine-card': MachineCardProps;
  }
}

export type MachineCardShape = TLShape<'machine-card'>;

export const MACHINE_CARD_SIZE = { w: 300, h: 286 };

export class MachineCardShapeUtil extends ShapeUtil<MachineCardShape> {
  static override type = 'machine-card' as const;

  static override props: RecordProps<MachineCardShape> = {
    w: T.number,
    h: T.number,
    machineId: T.string,
    subject: T.string,
    status: T.string,
  };

  override getDefaultProps(): MachineCardShape['props'] {
    return { ...MACHINE_CARD_SIZE, machineId: 'swot', subject: '', status: 'idle' };
  }

  override canResize() {
    return true;
  }
  override canEdit() {
    return true;
  }
  override onResize(shape: MachineCardShape, info: TLResizeInfo<MachineCardShape>) {
    return resizeBox(shape, info, { minWidth: 276, minHeight: 248 });
  }
  override getGeometry(shape: MachineCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }
  override getIndicatorPath(shape: MachineCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }
  override component(shape: MachineCardShape) {
    return (
      <HTMLContainer>
        <MachineCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function MachineCardBody({ shape }: { shape: MachineCardShape }) {
  const editor = useEditor();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const m = MACHINES.find((x) => x.id === shape.props.machineId) ?? MACHINES[0]!;
  const { subject, status } = shape.props;
  // The one shared selected state (the CSS ring) — the sole thing that thickens
  // a card's edge, identical across every card type.
  const isSelected = useValue('machine-selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor]);
  const running = status === 'running';
  const done = status === 'done';
  const options = m.options ?? [];
  const enabled = new Set(resolveMachineOptions((shape.meta as { options?: unknown }).options, m));

  // The block grows to fit its content — laid out at its natural height, the
  // card's measured height drives the shape height (so it grows as you type).
  useFitHeight(shape.id, cardRef, [subject], {});

  // Auto-grow the subject input with its content (Miro-style text box). When
  // empty, clear the inline height so the CSS one-row min-height governs — the
  // scrollHeight of a freshly-focused empty textarea can measure tall.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = subject ? `${el.scrollHeight}px` : '';
  }, [subject]);

  // A freshly-dropped machine is ready for typing — focus its input.
  useEffect(() => {
    if (!subject && !running) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSubject = (v: string) =>
    editor.updateShape<MachineCardShape>({ id: shape.id, type: 'machine-card', props: { subject: v } });
  const toggleOption = (id: string) => {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    editor.updateShape<MachineCardShape>({ id: shape.id, type: 'machine-card', meta: { options: [...next] } });
  };
  const run = () => {
    if (!subject.trim() || running) return;
    requestMachineRun(shape.id);
  };

  return (
    <div ref={cardRef} className={`jz-machine-card${running ? ' jz-machine-card--running' : ''}${isSelected ? ' jz-card-selected' : ''}`}>
      <div className="jz-machine-card-head">
        <span className="jz-machine-card-badge">{MACHINE_ICONS[m.icon]}</span>
        <span className="jz-machine-card-name">{m.name}</span>
        {done ? <span className="jz-machine-card-done" title="Ran"><Check size={12} strokeWidth={3} /></span> : null}
      </div>
      <p className="jz-machine-card-desc">{m.description}</p>
      <textarea
        ref={ref}
        rows={1}
        className="jz-machine-card-input"
        value={subject}
        placeholder="What should I analyse?"
        style={{ pointerEvents: 'all' }}
        onPointerDown={stopEventPropagation}
        onPointerMove={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            run();
          }
        }}
        onChange={(e) => setSubject(e.currentTarget.value)}
      />
      {options.length > 0 ? (
        <div className="jz-machine-card-opts">
          {options.map((o) => (
            <label
              key={o.id}
              className="jz-machine-opt"
              style={{ pointerEvents: 'all' }}
              onPointerDown={stopEventPropagation}
            >
              <input
                type="checkbox"
                checked={enabled.has(o.id)}
                onChange={() => toggleOption(o.id)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : null}
      <button
        className="jz-machine-card-run"
        disabled={!subject.trim() || running}
        style={{ pointerEvents: 'all' }}
        onPointerDown={stopEventPropagation}
        onClick={run}
        title="Run this machine (⌘↵)"
      >
        {running ? (
          <><Loader2 size={14} className="jz-machine-spin" /> Thinking…</>
        ) : done ? (
          <>Run again <ArrowRight size={14} /></>
        ) : (
          <>Run analysis <ArrowRight size={14} /></>
        )}
      </button>
    </div>
  );
}
