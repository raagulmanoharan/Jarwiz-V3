/**
 * Prototype card — a generative-UI card ("describe a screen, see it built").
 * Two ways in: drop it from the rail as a small prompt card (Thinking-Machine
 * style) and type what to build, or generate one straight from the composer /
 * "/" Prototype mode. Either way the model returns ONE self-contained HTML
 * document that renders LIVE inside the card; the small prompt card grows to a
 * full canvas the moment generation starts.
 *
 * No header chrome — the card IS the screen. Rendering & safety: the document
 * renders in a SANDBOXED iframe with `sandbox="allow-scripts"` and NO
 * `allow-same-origin` (an opaque origin) — its scripts run (a timer counts down,
 * a tab switches) but it can't reach our app's DOM, cookies, or storage. The
 * frame fills the card edge-to-edge like the PDF card's page, and the rendered
 * UI is directly interactive; while it's still streaming the frame stays inert.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useValue,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CardShapeUtil } from './CardShapeUtil';
import { AppWindow, ArrowRight, Loader2 } from 'lucide-react';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { useStreamState } from './useStreamState';
import { requestPrototypeRun } from '../agents/prototypeRun';
import { getPrototypeRefresh, subscribePrototypeRefresh } from '../agents/prototypeRefresh';

export interface PrototypeCardProps {
  w: number;
  h: number;
  /** A self-contained HTML document (inline CSS/JS, no external resources). */
  html: string;
  title?: string;
  /** What the user asked to prototype (kept so it can be re-generated). */
  prompt: string;
  /** 'idle' (awaiting a prompt) | 'running' | 'done' | 'error'. */
  status: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'prototype-card': PrototypeCardProps;
  }
}

export type PrototypeCardShape = TLShape<'prototype-card'>;

/** The rendered UI canvas — a screen-sized card. */
export const PROTOTYPE_CARD_SIZE = { w: 520, h: 400 };
/** The small prompt card you drop from the rail (grows on generate) — sized and
 *  styled to match the Thinking-Machine block. */
export const PROTOTYPE_PROMPT_SIZE = { w: 300, h: 248 };

/** Strip any ``` fences the model might wrap the document in. */
function stripFences(html: string): string {
  return html.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/i, '');
}

export class PrototypeCardShapeUtil extends CardShapeUtil<PrototypeCardShape> {
  static override type = 'prototype-card' as const;

  static override props: RecordProps<PrototypeCardShape> = {
    w: T.number,
    h: T.number,
    html: T.string,
    title: T.string,
    prompt: T.string,
    status: T.string,
  };

  override getDefaultProps(): PrototypeCardShape['props'] {
    return { ...PROTOTYPE_CARD_SIZE, html: '', title: '', prompt: '', status: 'idle' };
  }

  override onResize(shape: PrototypeCardShape, info: TLResizeInfo<PrototypeCardShape>) {
    return resizeBox(shape, info, { minWidth: 240, minHeight: 140 });
  }
  override getIndicatorPath(shape: PrototypeCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }
  override component(shape: PrototypeCardShape) {
    return (
      <HTMLContainer>
        <PrototypeCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function PrototypeCardBody({ shape }: { shape: PrototypeCardShape }) {
  const editor = useEditor();
  const { html, title, prompt, status } = shape.props;
  const doc = stripFences(html);
  const hasDoc = Boolean(doc.trim());
  const running = status === 'running';
  const errored = status === 'error';

  // Generating (compose fan-out) counts the same as streaming here: an empty,
  // being-built prototype shows the "Generating the UI…" state, never the idle
  // prompt composer.
  const { isGenerating, isFocused } = useStreamState(shape.id);
  const isStreaming = isGenerating || running;
  // Only the card being written right now wears the glow (a `running` in-card
  // generate counts); pending fan-out placeholders stay quiet.
  const glow = isFocused || running;
  // The one shared selected state (the CSS ring) — the sole thing that thickens
  // a card's edge, identical across every card type.
  const isSelected = useValue('prototype-selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor]);
  const sel = isSelected ? ' jz-card-selected' : '';
  // Reset counter — bumping it (via the refine menu) remounts the iframe below,
  // reloading the UI to its initial state without regenerating.
  const refreshNonce = useSyncExternalStore(
    subscribePrototypeRefresh,
    () => getPrototypeRefresh(shape.id),
    () => 0,
  );
  // The rendered UI is directly interactive once it has settled; while it's
  // still streaming the frame stays inert so a half-written UI isn't clickable.
  const interactive = hasDoc && !isStreaming;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const setPrompt = (v: string) =>
    editor.updateShape<PrototypeCardShape>({ id: shape.id, type: 'prototype-card', props: { prompt: v } });
  const generate = () => {
    if (!prompt.trim() || running) return;
    requestPrototypeRun(shape.id);
  };

  // Auto-grow the prompt input with its content, and focus a freshly-dropped
  // (empty) card so the user can start typing straight away.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = prompt ? `${el.scrollHeight}px` : '';
  }, [prompt]);
  useEffect(() => {
    if (!hasDoc && !isStreaming) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDoc, isStreaming]);

  // A live/complete document → the rendered UI; generating with nothing yet → a
  // spinner; otherwise (idle/error/empty) → the small prompt composer.
  if (hasDoc) {
    return (
      <div className={`jz-prototype${interactive ? ' jz-prototype--interactive' : ''}${sel}${glow ? ' jz-card-streaming' : ''}`}>
        <iframe
          key={refreshNonce}
          className="jz-prototype-frame"
          title={title || 'Prototype'}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        />
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className={`jz-prototype jz-prototype--composer${sel}${glow ? ' jz-card-streaming' : ''}`}>
        <div className="jz-prototype-loading">
          <Loader2 size={16} className="jz-machine-spin" />
          <span>Generating the UI…</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`jz-prototype jz-prototype--composer${sel}`}>
      <div className="jz-prototype-head">
        <span className="jz-prototype-badge" aria-hidden>
          <AppWindow size={16} strokeWidth={1.8} />
        </span>
        <span className="jz-prototype-name">Prototype</span>
      </div>
      <p className="jz-prototype-desc">Describe a screen and I&rsquo;ll build a live, interactive UI right here.</p>
      <textarea
        ref={inputRef}
        rows={2}
        className="jz-prototype-input"
        value={prompt}
        placeholder="e.g. “a timer app”"
        style={{ pointerEvents: 'all' }}
        onPointerDown={stopEventPropagation}
        onPointerMove={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            generate();
          }
        }}
        onChange={(e) => setPrompt(e.currentTarget.value)}
      />
      {errored ? <p className="jz-prototype-error">Generation failed — try again.</p> : null}
      <button
        className="jz-prototype-run"
        disabled={!prompt.trim() || running}
        style={{ pointerEvents: 'all' }}
        onPointerDown={stopEventPropagation}
        onClick={generate}
        title="Generate (⌘↵)"
      >
        Generate <ArrowRight size={14} />
      </button>
    </div>
  );
}
