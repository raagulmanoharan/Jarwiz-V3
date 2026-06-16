import { useSyncExternalStore } from 'react';
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
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { useAutopilot } from '../agents/useAutopilot';
import { useMention } from '../agents/useMention';
import { NOTE_RADIUS, roundedRectPath } from './cardGeometry';

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

/** Tinted paper, per the design tokens. */
export const NOTE_PAPER = '#fbf6e9';

/** Soft tints for affinity-diagram clusters; cycled by cluster index. */
export const AFFINITY_COLORS = ['#fef0c7', '#dcefe1', '#dde7fb', '#fbe0e6', '#ece1f7', '#fbeada'] as const;

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
  const { text, color } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const autopilot = useAutopilot();
  const mention = useMention();

  return (
    <div className="jz-note" style={{ background: color || NOTE_PAPER }}>
      {isEditing ? (
        <textarea
          autoFocus
          value={text}
          placeholder="Write something… (Tab to continue, @ to call an agent)"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            if (mention.onKeyDown(shape.id, e)) return;
            autopilot.onKeyDown(shape.id, e);
          }}
          onFocus={(e) => {
            const length = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(length, length);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            const caret = e.currentTarget.selectionStart ?? value.length;
            editor.updateShape<NoteCardShape>({
              id: shape.id,
              type: 'note-card',
              props: { text: value },
            });
            mention.sync(shape.id, value, caret);
          }}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
      ) : (
        <div className={`jz-note-text${text ? '' : ' jz-note-placeholder'}`}>
          {text || 'Double-click to write'}
          {isStreaming && <span className="jz-stream-caret" aria-hidden />}
        </div>
      )}
    </div>
  );
}
