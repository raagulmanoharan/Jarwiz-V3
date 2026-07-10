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
import { abortAutopilot, continueProse, isAutopilotReady, isAutopilotRunning, subscribeAutopilot } from '../agents/autopilotStore';
import { DocMarkdown } from '../ui/DocMarkdown';
import { setPdfPage } from '../pdf/pdfView';
import { toggleInline } from '../ask/textFormat';
import { deriveTitle, titleIsAuto } from './shapeTitle';
import { useFitHeight } from './useFitHeight';
import { isExpanded, subscribeExpand } from './cardExpand';
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

export const DOC_CARD_SIZE = { w: 416, h: 240 };

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

// Must match EXACTLY the lines DocMarkdown renders as checkboxes (`- [ ] …`,
// no indent, `-` bullet only) — the renderer's task ordinals index into the
// same sequence this regex produces. A broader pattern here (indented or `*`
// bullets) desynchronizes the ordinals and toggling flips the wrong line.
const TASK_LINE_RE = /^(- )\[([ xX])\](\s+.*)$/;


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

  // Streaming agent cards auto-fit in read mode: height tracks the content,
  // and a long answer widens page-ward (to ~2× default) before growing tall —
  // a research dossier lands as a page, not a skyscraper column.
  const fitRef = useRef<HTMLDivElement | null>(null);
  const overflowing = useFitHeight(shape.id, fitRef, [text, title], {
    // Keep the card at its content height whenever it isn't being edited — not
    // only while streaming. A fan-out card can receive its whole body in one
    // burst (the ResizeObserver never measured before streaming stopped), which
    // left it collapsed; fitting always keeps every card as tall as it needs.
    enabled: !isEditing,
    streaming: isStreaming,
    expanded,
    // Cards grow as tall as their content needs — no clamp, no Expand toggle
    // (owner call). `overflowing` therefore stays false and never collapses.
    maxHeight: Infinity,
    growWidth: { max: 800, step: 128, ratio: 1.4 },
  });
  const collapsed = overflowing && !expanded && !isStreaming;

  if (isEditing) {
    // Pure text — no internal title/header. The card's name is the primitive
    // title tag (ui/CardTitleTag), rendered outside the frame on selection.
    return (
      <div className={`jz-doc jz-doc-editing${autopilotActive ? ' jz-doc-autopilot' : ''}`}>
        <textarea
          ref={textareaRef}
          value={text}
          placeholder="Write something…"
          className="jz-doc-textarea"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            // ⌘/Ctrl B·I·U — same operations as the format bar buttons.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
              const marker = e.key === 'b' ? '**' : e.key === 'i' ? '*' : e.key === 'u' ? '__' : null;
              if (marker) {
                e.preventDefault();
                const ta = e.currentTarget;
                const { text: next, selStart, selEnd } = toggleInline(ta.value, ta.selectionStart, ta.selectionEnd, marker);
                editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { text: next } });
                requestAnimationFrame(() => ta.setSelectionRange(selStart, selEnd));
                return;
              }
            }
            if (e.key === 'Tab') resetPause();
            autopilot.onKeyDown(shape.id, e);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            // Typing auto-populates the primitive title from the first line —
            // until the user (or the server) names the card explicitly.
            if (titleIsAuto(shape)) {
              editor.updateShape<DocCardShape>({
                id: shape.id,
                type: 'doc-card',
                props: { text: value, title: deriveTitle(value) },
                meta: { ...shape.meta, jzTitleAuto: true },
              });
            } else {
              editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { text: value } });
            }
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
          <button
            className="jz-autopilot-nudge jz-autopilot-nudge--takeover"
            aria-live="polite"
            style={{ pointerEvents: 'all' }}
            onPointerDown={stopEventPropagation}
            onClick={() => abortAutopilot(shape.id)}
          >
            <Sparkle size={12} strokeWidth={1.7} color="white" fill="white" />
            Writing — click (or type) to take over
          </button>
        ) : showNudge ? (
          // The same "✦ Fill" pill the table's fresh column wears — one look
          // for "let Jarwiz take it from here" everywhere. Appears after an
          // idle pause; click hands the pen to Jarwiz.
          <button
            className="jz-fillnudge jz-fillnudge--float"
            title="Let Jarwiz continue from what's here"
            style={{ pointerEvents: 'all' }}
            onPointerDown={stopEventPropagation}
            onClick={() => void continueProse(editor, shape.id)}
          >
            ✦ Fill
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`jz-doc jz-doc-auto${collapsed ? ' jz-card-collapsed' : ''}${isSelected ? ' jz-card-selected' : ''}`}
      ref={fitRef}
    >
      <div className="jz-doc-content">
        {text ? (
          <DocMarkdown
            content={text}
            onCite={(page) => {
              const pdfId = shape.props.sourcePdfId as TLShapeId;
              if (!pdfId || !editor.getShape(pdfId)) return;
              setPdfPage(pdfId, page);
              editor.select(pdfId);
              const bounds = editor.getShapePageBounds(pdfId);
              if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 220 }, inset: 80, targetZoom: 1 });
            }}
            onToggleTask={isStreaming ? undefined : (ordinal, checked) => toggleTask(editor, shape, ordinal, checked)}
          />
        ) : isStreaming ? null : (
          <span className="jz-doc-placeholder-text">Write something…</span>
        )}
        {/* The caret IS the pre-text state: a writer's cursor waiting on the
            empty card, then riding the real paragraphs as they arrive — no
            fake skeleton blobs pretending to be content. */}
        {isStreaming && <span className="jz-stream-caret" aria-hidden />}
      </div>
    </div>
  );
}
