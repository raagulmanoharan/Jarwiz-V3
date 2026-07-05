/**
 * Machine block — an on-canvas "Thinking Machine". You drop it from the rail,
 * type the subject into it, and hit Run; it produces the analysis card beside
 * it (via the Ask pipeline, driven by MachineRunner in the overlay so this shape
 * needn't import Ask). A block is a premade analysis (SWOT, competitive, risk…);
 * which one it is comes from `machineId`, resolved against the catalog.
 */

import { useEffect, useRef } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { Grid2x2, Swords, Scale, ShieldAlert, CornerDownRight, UserRound, Boxes, ArrowRight, Loader2 } from 'lucide-react';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { MACHINES } from '../machines/catalog';
import { requestMachineRun } from '../machines/runStore';

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

export const MACHINE_CARD_SIZE = { w: 340, h: 188 };

const ICONS: Record<string, React.ReactNode> = {
  Grid2x2: <Grid2x2 size={15} />,
  Swords: <Swords size={15} />,
  Scale: <Scale size={15} />,
  ShieldAlert: <ShieldAlert size={15} />,
  CornerDownRight: <CornerDownRight size={15} />,
  UserRound: <UserRound size={15} />,
};

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
    return resizeBox(shape, info, { minWidth: 280, minHeight: 172 });
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
  const m = MACHINES.find((x) => x.id === shape.props.machineId) ?? MACHINES[0]!;
  const { subject, status } = shape.props;
  const running = status === 'running';

  // A freshly-dropped machine is ready for typing — focus its input.
  useEffect(() => {
    if (!subject && !running) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSubject = (v: string) =>
    editor.updateShape<MachineCardShape>({ id: shape.id, type: 'machine-card', props: { subject: v } });
  const run = () => {
    if (!subject.trim() || running) return;
    requestMachineRun(shape.id);
  };

  return (
    <div className={`jz-machine-card${running ? ' jz-machine-card--running' : ''}`}>
      <div className="jz-machine-card-head">
        <span className="jz-machine-card-badge"><Boxes size={11} /></span>
        <span className="jz-machine-card-icon">{ICONS[m.icon]}</span>
        <span className="jz-machine-card-name">{m.name}</span>
        {status === 'done' ? <span className="jz-machine-card-done">✓</span> : null}
      </div>
      <textarea
        ref={ref}
        className="jz-machine-card-input"
        value={subject}
        placeholder="Type what to analyse…"
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
      <div className="jz-machine-card-foot">
        <span className="jz-machine-card-hint">{m.blurb}</span>
        <button
          className="jz-machine-card-run"
          disabled={!subject.trim() || running}
          style={{ pointerEvents: 'all' }}
          onPointerDown={stopEventPropagation}
          onClick={run}
          title="Run this machine (⌘↵)"
        >
          {running ? (
            <><Loader2 size={13} className="jz-machine-spin" /> Thinking…</>
          ) : (
            <>Run <ArrowRight size={13} /></>
          )}
        </button>
      </div>
    </div>
  );
}
