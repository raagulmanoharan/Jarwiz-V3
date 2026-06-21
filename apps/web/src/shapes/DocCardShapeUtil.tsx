import { useRef, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  type Editor,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { useAutopilot } from '../agents/useAutopilot';
import { useMention } from '../agents/useMention';
import { useTypingPause } from '../agents/useTypingPause';
import { DocMarkdown } from '../ui/DocMarkdown';
import { getResponsePdfSource } from '../pdf/provenance';
import { setPdfPage } from '../pdf/pdfView';
import { useFitHeight } from './useFitHeight';
import { MAX_CARD_H, isExpanded, subscribeExpand, toggleExpand } from './cardExpand';
import { ExpandToggle } from './ExpandToggle';
import { DOC_RADIUS, roundedRectPath } from './cardGeometry';

export interface DocCardProps {
  w: number;
  h: number;
  text: string;
  title?: string;
  /** Source PDF shape id, so [p.N] citations survive reload (not a session map). */
  sourcePdfId: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'doc-card': DocCardProps;
  }
}

export type DocCardShape = TLShape<'doc-card'>;

export const DOC_CARD_SIZE = { w: 520, h: 360 };

export class DocCardShapeUtil extends ShapeUtil<DocCardShape> {
  static override type = 'doc-card' as const;

  static override props: RecordProps<DocCardShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    title: T.string,
    sourcePdfId: T.string,
  };

  override getDefaultProps(): DocCardShape['props'] {
    return { ...DOC_CARD_SIZE, text: '', title: '', sourcePdfId: '' };
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override onResize(shape: DocCardShape, info: TLResizeInfo<DocCardShape>) {
    return resizeBox(shape, info, { minWidth: 280, minHeight: 200 });
  }

  override getGeometry(shape: DocCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: DocCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, DOC_RADIUS);
  }

  override component(shape: DocCardShape) {
    return (
      <HTMLContainer>
        <DocCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

/** A markdown task line, capturing leading bullet, checkbox state, and the rest. */
const TASK_LINE_RE = /^(\s*[-*]\s+)\[([ xX])\](\s+.*)$/;

/** Flip the Nth task line (`- [ ]` ↔ `- [x]`) in the card's source text. */
function toggleTask(editor: Editor, shape: DocCardShape, ordinal: number, checked: boolean): void {
  let n = -1;
  const next = shape.props.text
    .split('\n')
    .map((line) => {
      const m = line.match(TASK_LINE_RE);
      if (!m) return line;
      n += 1;
      if (n !== ordinal) return line;
      return `${m[1]}[${checked ? 'x' : ' '}]${m[3]}`;
    })
    .join('\n');
  editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { text: next } });
}

function DocCardBody({ shape }: { shape: DocCardShape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { text, title } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const autopilot = useAutopilot();
  const mention = useMention();
  const expanded = useSyncExternalStore(subscribeExpand, () => isExpanded(shape.id), () => false);
  // Pause detection — resets whenever title or text changes; `reset` is called on Tab
  // so the nudge disappears the instant autopilot (or the cold-start clarify) fires.
  const [paused, resetPause] = useTypingPause(isEditing ? `${title}|${text}` : '', 1800);
  const showNudge = isEditing && paused && !isStreaming;
  // Grow to fit content; once settled, clamp past the threshold (collapsible).
  const fitRef = useRef<HTMLDivElement | null>(null);
  const overflowing = useFitHeight(shape.id, fitRef, [text, title], {
    enabled: !isEditing,
    streaming: isStreaming,
    expanded,
    maxHeight: MAX_CARD_H,
  });
  const collapsed = overflowing && !expanded && !isStreaming;

  if (isEditing) {
    return (
      <div className="jz-doc">
        <div className="jz-doc-header">
          <input
            autoFocus
            type="text"
            value={title}
            placeholder="Document title"
            className="jz-doc-title-input"
            onChange={(e) =>
              editor.updateShape<DocCardShape>({
                id: shape.id,
                type: 'doc-card',
                props: { title: e.currentTarget.value },
              })
            }
            onPointerDown={stopEventPropagation}
            onPointerMove={stopEventPropagation}
            onPointerUp={stopEventPropagation}
          />
        </div>
        <textarea
          value={text}
          placeholder="Write something… (Tab to continue, @ to call an agent)"
          className="jz-doc-textarea"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') resetPause();
            if (mention.onKeyDown(shape.id, e)) return;
            autopilot.onKeyDown(shape.id, e);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            const caret = e.currentTarget.selectionStart ?? value.length;
            editor.updateShape<DocCardShape>({
              id: shape.id,
              type: 'doc-card',
              props: { text: value },
            });
            mention.sync(shape.id, value, caret);
          }}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
        {showNudge && (
          <div className="jz-autopilot-nudge" aria-hidden>
            <span className="jz-autopilot-nudge-spark">✦</span>Tab
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`jz-doc jz-doc-auto${collapsed ? ' jz-card-collapsed' : ''}`} ref={fitRef}>
      <div className="jz-doc-header">
        <div className="jz-doc-title">{title || 'Document'}</div>
      </div>
      <div className={`jz-doc-content${text || (isStreaming && !isEditing) ? '' : ' jz-doc-placeholder'}`}>
        {text ? (
          <DocMarkdown
            content={text}
            onCite={(page) => {
              const pdfId = (shape.props.sourcePdfId as TLShapeId) || getResponsePdfSource(shape.id);
              if (!pdfId || !editor.getShape(pdfId)) return;
              setPdfPage(pdfId, page);
              editor.select(pdfId);
              const bounds = editor.getShapePageBounds(pdfId);
              if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 220 }, inset: 80 });
            }}
            onToggleTask={isStreaming ? undefined : (ordinal, checked) => toggleTask(editor, shape, ordinal, checked)}
          />
        ) : isStreaming && !isEditing ? (
          // The agent has the card but no words yet — show a skeleton, not a husk.
          <div className="jz-doc-skeleton" aria-hidden>
            <span className="jz-skel-line" style={{ width: '92%' }} />
            <span className="jz-skel-line" style={{ width: '78%' }} />
            <span className="jz-skel-line" style={{ width: '85%' }} />
            <span className="jz-skel-line" style={{ width: '60%' }} />
          </div>
        ) : (
          'Double-click to edit'
        )}
        {isStreaming && text && <span className="jz-stream-caret" aria-hidden />}
      </div>
      {overflowing && !isStreaming ? <ExpandToggle shapeId={shape.id} expanded={expanded} /> : null}
    </div>
  );
}
