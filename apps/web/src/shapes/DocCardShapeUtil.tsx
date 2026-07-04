import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  useValue,
  type Editor,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import { Sparkle } from 'lucide-react';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { useAutopilot } from '../agents/useAutopilot';
import { useTypingPause } from '../agents/useTypingPause';
import { isAutopilotReady, isAutopilotRunning, subscribeAutopilot } from '../agents/autopilotStore';
import { DocMarkdown } from '../ui/DocMarkdown';
import { getResponsePdfSource } from '../pdf/provenance';
import { setPdfPage } from '../pdf/pdfView';
import { useFitHeight } from './useFitHeight';
import { MAX_CARD_H, isExpanded, subscribeExpand } from './cardExpand';
import { ExpandToggle } from './ExpandToggle';
import { DOC_RADIUS, roundedRectPath } from './cardGeometry';

export interface DocCardProps {
  w: number;
  h: number;
  text: string;
  title?: string;
  sourcePdfId: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'doc-card': DocCardProps;
  }
}

export type DocCardShape = TLShape<'doc-card'>;

export const DOC_CARD_SIZE = { w: 364, h: 240 };

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

  override canResize() { return true; }
  override hideRotateHandle() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canEdit() { return true; }

  override onResize(shape: DocCardShape, info: TLResizeInfo<DocCardShape>) {
    return resizeBox(shape, info, { minWidth: 240, minHeight: 80 });
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

const TASK_LINE_RE = /^(\s*[-*]\s+)\[([ xX])\](\s+.*)$/;


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
  const isSelected = useValue('doc-selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor]);
  const { text, title } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const autopilot = useAutopilot();
  const expanded = useSyncExternalStore(subscribeExpand, () => isExpanded(shape.id), () => false);
  const [paused, resetPause] = useTypingPause(isEditing ? `${title}|${text}` : '', 1800);

  // Only nudge once the agent has real signal to continue from — a finished
  // thought, a structural unit, a title, or surrounding board context.
  // Recomputed on text/title/selection changes (see useValue tick).
  const ready = useValue('autopilot-ready', () => isAutopilotReady(editor, shape.id), [editor, shape.id, text, title]);
  const showNudge = isEditing && paused && !isStreaming && ready;

  // Is autopilot actively writing into this card right now?
  const autopilotActive = useSyncExternalStore(
    subscribeAutopilot,
    () => isAutopilotRunning(shape.id),
    () => false,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus at end of text when entering edit mode.
  useLayoutEffect(() => {
    if (!isEditing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [isEditing]);

  // Grow card height as content exceeds current bounds. Only expands, never shrinks
  // while editing so manual resize is preserved.
  useLayoutEffect(() => {
    if (!isEditing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const needed = ta.scrollHeight;
    const cur = editor.getShape(shape.id);
    if (!cur) return;
    const curH = (cur.props as DocCardProps).h;
    if (needed > curH + 1) {
      editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { h: needed } });
    }
  }, [text]);

  // Streaming agent cards auto-fit height in read mode.
  const fitRef = useRef<HTMLDivElement | null>(null);
  const overflowing = useFitHeight(shape.id, fitRef, [text, title], {
    enabled: !isEditing && isStreaming,
    streaming: isStreaming,
    expanded,
    maxHeight: MAX_CARD_H,
  });
  const collapsed = overflowing && !expanded && !isStreaming;

  if (isEditing) {
    return (
      <div className={`jz-doc jz-doc-editing${autopilotActive ? ' jz-doc-autopilot' : ''}`}>
        <textarea
          ref={textareaRef}
          value={text}
          placeholder="Write something…"
          className="jz-doc-textarea"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') resetPause();
            autopilot.onKeyDown(shape.id, e);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { text: value } });
          }}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
        {autopilotActive && (
          // Read-only mirror laid on top of the textarea — the browser places the
          // Sparkle right after the last character, so it's pixel-perfect with no
          // measurement math. Whitespace-pre-wrap matches textarea wrapping.
          <div className="jz-autopilot-mirror" aria-hidden>
            {text}
            <span className="jz-autopilot-cursor">
              <Sparkle size={11} strokeWidth={1.5} fill="currentColor" />
            </span>
          </div>
        )}
        {autopilotActive ? (
          <div className="jz-autopilot-nudge jz-autopilot-nudge--takeover" aria-live="polite">
            <Sparkle size={12} strokeWidth={1.7} color="white" fill="white" />
            Press <kbd className="jz-autopilot-nudge-kbd">Tab</kbd> to take over
          </div>
        ) : showNudge ? (
          <div className="jz-autopilot-nudge" aria-hidden>
            <Sparkle size={12} strokeWidth={1.7} color="white" fill="white" />
            Press <kbd className="jz-autopilot-nudge-kbd">Tab</kbd> to continue
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`jz-doc jz-doc-auto${collapsed ? ' jz-card-collapsed' : ''}${isSelected ? ' jz-doc--selected' : ''}`}
      ref={fitRef}
    >
      {title ? <div className="jz-doc-title-row"><div className="jz-doc-title">{title}</div></div> : null}
      <div className="jz-doc-content">
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
        ) : isStreaming ? (
          <div className="jz-doc-skeleton" aria-hidden>
            <span className="jz-skel-line" style={{ width: '92%' }} />
            <span className="jz-skel-line" style={{ width: '78%' }} />
            <span className="jz-skel-line" style={{ width: '85%' }} />
            <span className="jz-skel-line" style={{ width: '60%' }} />
          </div>
        ) : (
          <span className="jz-doc-placeholder-text">Write something…</span>
        )}
        {isStreaming && text && <span className="jz-stream-caret" aria-hidden />}
      </div>
      {overflowing && !isStreaming ? <ExpandToggle shapeId={shape.id} expanded={expanded} /> : null}
    </div>
  );
}
