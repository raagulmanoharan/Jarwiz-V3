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
import { NOTE_RADIUS, roundedRectPath } from './cardGeometry';

export interface NoteCardProps {
  w: number;
  h: number;
  text: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'note-card': NoteCardProps;
  }
}

export type NoteCardShape = TLShape<'note-card'>;

export const NOTE_CARD_SIZE = { w: 220, h: 220 };

/** Tinted paper, per the design tokens. */
const NOTE_PAPER = '#fbf6e9';

export class NoteCardShapeUtil extends ShapeUtil<NoteCardShape> {
  static override type = 'note-card' as const;

  static override props: RecordProps<NoteCardShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  override getDefaultProps(): NoteCardShape['props'] {
    return { ...NOTE_CARD_SIZE, text: '' };
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
  const { text } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);

  return (
    <div className="jz-note" style={{ background: NOTE_PAPER }}>
      {isEditing ? (
        <textarea
          autoFocus
          value={text}
          placeholder="Write something…"
          style={{ pointerEvents: 'all' }}
          onFocus={(e) => {
            const length = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(length, length);
          }}
          onChange={(e) =>
            editor.updateShape<NoteCardShape>({
              id: shape.id,
              type: 'note-card',
              props: { text: e.currentTarget.value },
            })
          }
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
