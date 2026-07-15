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

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  createShapeId,
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
import { AppWindow, ArrowRight, Loader2 } from 'lucide-react';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
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

/**
 * Results-out bridge, injected into every prototype's document. Rather than ask
 * the model to hand-wire postMessage into every recompute (unreliable), the
 * model just marks its headline outputs with `data-jz-output="<label>"`; this
 * script reads those elements' text and publishes them to the parent on load
 * and whenever they change (MutationObserver, debounced). Inert when nothing is
 * marked. Runs inside the same sandbox (allow-scripts) — one-way, no reads. */
const PROTO_OUTPUT_BRIDGE = `<script>(function(){try{
  function collect(){var els=document.querySelectorAll('[data-jz-output]');var out=[];els.forEach(function(el){var label=(el.getAttribute('data-jz-output')||'').trim();var value=(el.getAttribute('data-jz-value')||el.textContent||'').trim().replace(/\\s+/g,' ');if(label||value)out.push({label:label.slice(0,48),value:value.slice(0,48)});});if(out.length)parent.postMessage({type:'jz:proto',outputs:out.slice(0,6)},'*');}
  var t;function schedule(){clearTimeout(t);t=setTimeout(collect,120);}
  if(document.readyState!=='loading')schedule();else addEventListener('DOMContentLoaded',schedule);
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-jz-output','data-jz-value']});
}catch(e){}})();<\/script>`;

export class PrototypeCardShapeUtil extends ShapeUtil<PrototypeCardShape> {
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

  override canResize() {
    return true;
  }
  override onResize(shape: PrototypeCardShape, info: TLResizeInfo<PrototypeCardShape>) {
    return resizeBox(shape, info, { minWidth: 240, minHeight: 140 });
  }
  override getGeometry(shape: PrototypeCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
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
  // Append the results-out bridge so any element the model marked with
  // data-jz-output publishes itself to the canvas (see PROTO_OUTPUT_BRIDGE).
  const framedDoc = hasDoc ? doc + PROTO_OUTPUT_BRIDGE : doc;
  const running = status === 'running';
  const errored = status === 'error';

  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id) || running;
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

  // Results-out: a model prototype can publish its computed outputs to the
  // canvas. The sandboxed frame can't touch our DOM/storage (no
  // allow-same-origin), but a one-way postMessage from THIS frame is allowed —
  // we accept only messages whose source is our own iframe, of the exact shape,
  // and keep them in ephemeral state (no schema change). They surface below the
  // card and can be pushed out as a real note the rest of the board can use.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [outputs, setOutputs] = useState<Array<{ label: string; value: string }>>([]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const data = e.data as { type?: string; outputs?: unknown } | null;
      if (!data || data.type !== 'jz:proto' || !Array.isArray(data.outputs)) return;
      const clean = (data.outputs as Array<Record<string, unknown>>)
        .slice(0, 6)
        .map((o) => ({ label: String(o?.label ?? '').slice(0, 48), value: String(o?.value ?? '').slice(0, 48) }))
        .filter((o) => o.label || o.value);
      if (clean.length) setOutputs(clean);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Reloading / regenerating the frame drops any stale published outputs.
  useEffect(() => { setOutputs([]); }, [refreshNonce]);

  const pushToNote = () => {
    if (!outputs.length) return;
    const bounds = editor.getShapePageBounds(shape.id);
    const x = bounds ? bounds.maxX + 40 : shape.x + shape.props.w + 40;
    const y = bounds ? bounds.minY : shape.y;
    const body = outputs.map((o) => `- ${o.label}: **${o.value}**`).join('\n');
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'note-card',
      x,
      y,
      props: { w: 264, h: 200, text: `**${(title || 'Model').trim()} — results**\n\n${body}` },
    });
    editor.setSelectedShapes([id]);
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
      <div className={`jz-prototype${interactive ? ' jz-prototype--interactive' : ''}${sel}`}>
        <iframe
          key={refreshNonce}
          ref={frameRef}
          className="jz-prototype-frame"
          title={title || 'Prototype'}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={framedDoc}
          style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        />
        {outputs.length ? (
          <div className="jz-proto-outputs" onPointerDown={stopEventPropagation}>
            <div className="jz-proto-outputs-list">
              {outputs.map((o, i) => (
                <span key={i} className="jz-proto-output">
                  <span className="jz-proto-output-label">{o.label}</span>
                  <span className="jz-proto-output-value">{o.value}</span>
                </span>
              ))}
            </div>
            <button
              className="jz-proto-outputs-push"
              style={{ pointerEvents: 'all' }}
              onPointerDown={stopEventPropagation}
              onClick={pushToNote}
              title="Push these results to a note on the board"
            >
              Push to note
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className={`jz-prototype jz-prototype--composer${sel}`}>
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
