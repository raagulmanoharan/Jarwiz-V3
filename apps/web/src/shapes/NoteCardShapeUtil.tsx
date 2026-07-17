import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { continueProse } from '../agents/autopilotStore';
import { useAutopilot } from '../agents/useAutopilot';
import { useTypingPause } from '../agents/useTypingPause';
import { NOTE_RADIUS, roundedRectPath } from './cardGeometry';
import { useCardSelected } from './useCardSelected';
import { useStreamState } from './useStreamState';
import { JarwizSpark } from '../ui/JarwizSpark';
import { StreamingPlaceholder } from '../ui/StreamingPlaceholder';

export interface NoteCardProps {
  w: number;
  h: number;
  text: string;
  /** Paper tint — clusters in an affinity diagram share a colour. */
  color: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'note-card': NoteCardProps;
  }
}

export type NoteCardShape = TLShape<'note-card'>;

export const NOTE_CARD_SIZE = { w: 220, h: 220 };

/** Tinted paper, per the design tokens — muted to sit inside the Flora
 *  chrome rather than pop against it (stickies are the user's own margin
 *  notes, not artifacts demanding attention). */
export const NOTE_PAPER = '#f1ece0';

/** Muted primary tints, cycled by index — each hue clearly readable (red /
 *  orange / yellow / green / blue / purple) but softened to sit inside the
 *  Flora chrome. The earlier palette was so desaturated the colours read as
 *  one (owner call 2026-07-05). */
export const AFFINITY_COLORS = ['#eaccc4', '#f0dcbe', '#eee6b8', '#cfe0cb', '#c9dbe9', '#dcd2e8'] as const;

/** Pick a stable cluster tint by index. */
export function affinityColor(index: number): string {
  return AFFINITY_COLORS[index % AFFINITY_COLORS.length]!;
}

export class NoteCardShapeUtil extends ShapeUtil<NoteCardShape> {
  static override type = 'note-card' as const;

  static override props: RecordProps<NoteCardShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    color: T.string,
  };

  override getDefaultProps(): NoteCardShape['props'] {
    return { ...NOTE_CARD_SIZE, text: '', color: NOTE_PAPER };
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override onResize(shape: NoteCardShape, info: TLResizeInfo<NoteCardShape>) {
    return resizeBox(shape, info, { minWidth: 140, minHeight: 120 });
  }

  override getGeometry(shape: NoteCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: NoteCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, NOTE_RADIUS);
  }

  override component(shape: NoteCardShape) {
    return (
      <HTMLContainer>
        <NoteCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function NoteCardBody({ shape }: { shape: NoteCardShape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const isSelected = useCardSelected(shape.id);
  const { text, color } = shape.props;
  const { isGenerating } = useStreamState(shape.id);
  const autopilot = useAutopilot();
  const [paused, resetPause] = useTypingPause(isEditing ? text : '', 1800);
  const showNudge = isEditing && paused && !isGenerating;

  return (
    <div className={`jz-note${isSelected ? ' jz-card-selected' : ''}`} style={{ background: color || NOTE_PAPER }}>
      {isEditing ? (
        <>
        <textarea
          autoFocus
          value={text}
          placeholder="Write something… (Tab to continue)"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') resetPause();
            autopilot.onKeyDown(shape.id, e);
          }}
          onFocus={(e) => {
            const length = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(length, length);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            editor.updateShape<NoteCardShape>({
              id: shape.id,
              type: 'note-card',
              props: { text: value },
            });
          }}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
        {showNudge && (
          <button
            className="jz-fillnudge jz-fillnudge--float"
            title="Let Jarwiz continue from what's here"
            style={{ pointerEvents: 'all' }}
            onPointerDown={stopEventPropagation}
            onClick={() => void continueProse(editor, shape.id)}
          ><JarwizSpark size={10} className="jz-spark-inline" /> Fill</button>
        )}
        </>
      ) : (
        <div className={`jz-note-text${text ? '' : ' jz-note-placeholder'}`}>
          {text ? text : isGenerating ? <StreamingPlaceholder /> : 'Double-click to write'}
          {isGenerating && text ? <span className="jz-stream-caret" aria-hidden /> : null}
        </div>
      )}
    </div>
  );
}
