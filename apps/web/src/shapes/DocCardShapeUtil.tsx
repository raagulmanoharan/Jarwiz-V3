import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
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
import { CardShapeUtil } from './CardShapeUtil';
import type { RichBlock } from '@jarwiz/shared';
import { StreamingPlaceholder } from '../ui/StreamingPlaceholder';
import { useStreamState } from './useStreamState';
import { DocMarkdown } from '../ui/DocMarkdown';
import { RichBlocks } from '../ui/RichBlocks';
import { RichDocEditor } from '../ui/RichDocEditor';
import { docHasSpecialSyntax } from '../ui/docBridge';
import { CardSources } from '../ui/CardSources';
import { openCardFocus } from '../ui/focusCard';
import { frameBounds } from '../ui/bringIntoView';
import { setPdfPage } from '../pdf/pdfView';
import { toggleInline } from '../ask/textFormat';
import { deriveTitle, titleIsAuto } from './shapeTitle';
import { useFitHeight } from './useFitHeight';
import { isExpanded, subscribeExpand } from './cardExpand';
import { DOC_RADIUS, roundedRectPath } from './cardGeometry';
import { useFix } from '../ask/fixHighlight';

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

export class DocCardShapeUtil extends CardShapeUtil<DocCardShape> {
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

  override hideRotateHandle() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canEdit() { return true; }

  override onResize(shape: DocCardShape, info: TLResizeInfo<DocCardShape>) {
    return resizeBox(shape, info, { minWidth: 240, minHeight: 80 });
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

/* ── Source-doc preview ──────────────────────────────────────────────────────
 * A pasted transcript/notes card (meta.jzSourceDoc, made by the composer's
 * text attachment) is REFERENCE material, not an artifact — at full height a
 * 3,000-word paste would tower over the board. It renders as a truncated
 * preview (the first few lines) with a "View more" row that opens the card in
 * focus mode (the full-page reader/editor). Owner call, 2026-07-11. */
const SOURCE_PREVIEW_CHARS = 550;

/** Cut at a line boundary near the budget so the preview never ends mid-word
 *  (and never mid-table-row — pasted sources are line-oriented text). */
function previewSlice(text: string): { preview: string; more: number } {
  if (text.length <= SOURCE_PREVIEW_CHARS * 1.3) return { preview: text, more: 0 };
  const head = text.slice(0, SOURCE_PREVIEW_CHARS);
  const nl = head.lastIndexOf('\n');
  const preview = (nl > SOURCE_PREVIEW_CHARS / 2 ? head.slice(0, nl) : head).trimEnd();
  const more = text.slice(preview.length).split('\n').filter((l) => l.trim()).length;
  return { preview, more };
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
  // `isStreaming` = page-shaping stream (drives width-grow); `isGenerating` also
  // covers compose/debrief cards a layout owns — both show the caret + the
  // "writing…" placeholder, only the former reflows width.
  const { isStreaming, isGenerating, isFocused } = useStreamState(shape.id);
  const expanded = useSyncExternalStore(subscribeExpand, () => isExpanded(shape.id), () => false);
  // Transient "just changed" spotlight after a "Let Jarwiz fix it" refine.
  const fix = useFix(shape.id);

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
    // Track the content height exactly, both ways. The visible card is
    // height:auto (it hugs its content), so a shape box taller than the content
    // is INVISIBLE — but it still hit-tests, so a click in the empty band below
    // a short card's text selected the card even though the card visibly ended
    // above (bug report 2026-07-21). Keeping the box == content height makes the
    // hit area match what's drawn. (Supersedes the 2026-07-14 growOnly call,
    // which only ever preserved that invisible dead band on an auto-height card.)
    growWidth: { max: 800, step: 128, ratio: 1.4 },
  });
  const collapsed = overflowing && !expanded && !isStreaming;

  // Typing auto-populates the primitive title from the first line — until the
  // user (or the server) names the card explicitly. Shared by both editors.
  const applyText = (value: string) => {
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
  };
  // Keep the shape's bounds honest to the editor's content height. The card
  // itself hugs its content (jz-doc-auto, above), so this only syncs the shape
  // box for a clean selection outline — it doesn't move the visible card, so
  // there's no jump/expand on entering edit (owner ask 2026-07-20).
  const fitHeight = (needed: number) => {
    const cur = editor.getShape(shape.id);
    if (!cur) return;
    const curH = (cur.props as DocCardProps).h;
    const next = Math.max(80, Math.round(needed));
    if (Math.abs(next - curH) > 1) {
      editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { h: next } });
    }
  };

  if (isEditing) {
    // Formatted, in-place editing — you edit the doc as it LOOKS, not as raw
    // markdown. Docs that use dialect-only syntax the rich editor can't yet
    // represent (```map / ```widget / [p.N] citations) fall back to the
    // raw-text editor, so that content is never rewritten on save.
    if (!docHasSpecialSyntax(text)) {
      return (
        // jz-doc-auto: hug the content in edit too (like read mode), so the
        // card never fills a taller shape and shows dead space / "expands".
        <div className="jz-doc jz-doc-editing jz-doc-auto">
          <RichDocEditor
            initialMarkdown={text}
            onChange={applyText}
            onExit={() => editor.setEditingShape(null)}
            onHeight={fitHeight}
          />
        </div>
      );
    }
    // Fallback: pure text — no internal title/header. The card's name is the
    // primitive title tag (ui/CardTitleTag), rendered outside the frame.
    return (
      <div className="jz-doc jz-doc-editing">
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
          }}
          onChange={(e) => applyText(e.currentTarget.value)}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
      </div>
    );
  }

  // Source docs (pasted transcripts/notes) render a truncated preview — the
  // fit-height hook measures the preview, so the card stays compact while the
  // full text lives on the shape (and in focus mode).
  const isSourceDoc = shape.meta?.jzSourceDoc === true;
  const { preview, more } = isSourceDoc ? previewSlice(text) : { preview: text, more: 0 };
  const truncated = isSourceDoc && more > 0;
  // Structured blocks (the new content model) ride in meta so there's no shape
  // migration; when present they render instead of the markdown text.
  const blocks = Array.isArray(shape.meta?.jzBlocks) ? (shape.meta!.jzBlocks as unknown as RichBlock[]) : null;

  return (
    <div
      className={`jz-doc jz-doc-auto${collapsed ? ' jz-card-collapsed' : ''}${isSelected ? ' jz-card-selected' : ''}${isFocused ? ' jz-card-streaming' : ''}${fix?.whole ? ' jz-fix-glow' : ''}`}
      ref={fitRef}
    >
      <div className="jz-doc-content">
        <CardSources shapeId={shape.id} />
        {blocks && blocks.length > 0 ? (
          // Structured rich card — the model emits typed blocks as NDJSON,
          // hydrated server-side (owner call 2026-07-20). Carried in meta.jzBlocks
          // so no shape migration; falls back to markdown text when absent.
          <RichBlocks
            blocks={blocks}
            highlight={fix?.blocks}
            onCite={(page) => {
              const pdfId = shape.props.sourcePdfId as TLShapeId;
              if (!pdfId || !editor.getShape(pdfId)) return;
              setPdfPage(pdfId, page);
              editor.select(pdfId);
              const bounds = editor.getShapePageBounds(pdfId);
              if (bounds) frameBounds(editor, bounds, { margin: 40, animation: { duration: 220 } });
            }}
          />
        ) : text ? (
          <DocMarkdown
            content={truncated ? preview : text}
            onCite={(page) => {
              const pdfId = shape.props.sourcePdfId as TLShapeId;
              if (!pdfId || !editor.getShape(pdfId)) return;
              setPdfPage(pdfId, page);
              editor.select(pdfId);
              const bounds = editor.getShapePageBounds(pdfId);
              if (bounds) frameBounds(editor, bounds, { margin: 40, animation: { duration: 220 } });
            }}
            // Truncation would desynchronize checkbox ordinals against the
            // full text — a preview is read-only until opened in focus mode.
            onToggleTask={isGenerating || truncated ? undefined : (ordinal, checked) => toggleTask(editor, shape, ordinal, checked)}
            // A ```map block's "expand map" wires its promoted card back here.
            sourceId={shape.id}
          />
        ) : isGenerating ? (
          // Empty + being written → name the wait instead of a bare caret.
          <StreamingPlaceholder />
        ) : (
          <span className="jz-doc-placeholder-text">Write something…</span>
        )}
        {truncated && (
          <button
            className="jz-doc-viewmore"
            style={{ pointerEvents: 'all' }}
            title="Open the full text"
            onPointerDown={stopEventPropagation}
            onClick={() => openCardFocus(shape.id)}
          >
            View more · {more} more lines
          </button>
        )}
        {/* Once real text is flowing, the caret rides the last paragraph. While
            still empty the StreamingPlaceholder above carries its own cue, so the
            bare caret only shows alongside actual content. */}
        {isGenerating && text ? <span className="jz-stream-caret" aria-hidden /> : null}
      </div>
    </div>
  );
}
