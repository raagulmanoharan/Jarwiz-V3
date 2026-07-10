/**
 * The PDF card — a real embedded reader. Renders pages with pdf.js to a canvas
 * sized to the card (resizing the card rescales the preview), with page
 * navigation. Bytes live in the server blob store (docs/PDF-JOURNEY.md §6); the
 * card holds only the asset URL, so the synced document stays light.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { getPdfjs, type PdfDocument } from '../lib/pdfjs';
import { getPdfPage, setPdfPage, subscribePdfView } from '../pdf/pdfView';
import { setPdfSelection } from '../pdf/pdfSelection';
import { getPdfHighlight, subscribePdfHighlight } from '../pdf/pdfHighlight';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { useCardSelected } from './useCardSelected';

export type PdfStatus = 'uploading' | 'ready' | 'error';

export interface PdfCardProps {
  w: number;
  h: number;
  /** GET URL of the stored PDF (server blob); empty while uploading. */
  src: string;
  /** Server asset id, for content extraction / Ask. */
  assetId: string;
  name: string;
  /** Page count once the document loads (0 until known). */
  pages: number;
  status: PdfStatus;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'pdf-card': PdfCardProps;
  }
}

export type PdfCardShape = TLShape<'pdf-card'>;

export const PDF_CARD_SIZE = { w: 420, h: 540 };
const FOOTER_H = 40;

export class PdfCardShapeUtil extends ShapeUtil<PdfCardShape> {
  static override type = 'pdf-card' as const;

  static override props: RecordProps<PdfCardShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    assetId: T.string,
    name: T.string,
    pages: T.number,
    status: T.literalEnum('uploading', 'ready', 'error'),
  };

  override getDefaultProps(): PdfCardShape['props'] {
    return { ...PDF_CARD_SIZE, src: '', assetId: '', name: '', pages: 0, status: 'uploading' };
  }

  override canResize() {
    return true;
  }

  /** Double-click enters editing — the state where the page text is selectable. */
  override canEdit() {
    return true;
  }

  override onResize(shape: PdfCardShape, info: TLResizeInfo<PdfCardShape>) {
    const next = resizeBox(shape, info, { minWidth: 240, minHeight: 240 });
    // The card tracks the page's aspect ratio (set once the document loads),
    // so the page always fills the stage edge-to-edge — no letterbox bars.
    const aspect = Number(shape.meta.jzPdfAspect);
    if (aspect > 0 && next.props?.w) {
      next.props.h = Math.round(next.props.w * aspect) + FOOTER_H;
    }
    return next;
  }

  override getGeometry(shape: PdfCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: PdfCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: PdfCardShape) {
    return (
      <HTMLContainer>
        <PdfCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function PdfCardBody({ shape }: { shape: PdfCardShape }) {
  const editor = useEditor();
  const { src, name, status, w, h } = shape.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PdfDocument | null>(null);
  // The lazily-loaded pdf.js module — set by the load effect before docRef, so
  // the render effect (gated on docRef) can use it synchronously.
  const libRef = useRef<Awaited<ReturnType<typeof getPdfjs>> | null>(null);
  const selectText = useIsEditing(shape.id);
  const isSelected = useCardSelected(shape.id);
  const highlight = useSyncExternalStore(
    subscribePdfHighlight,
    () => getPdfHighlight(shape.id),
    () => undefined,
  );
  const [pageCount, setPageCount] = useState(shape.props.pages || 0);
  // Current page lives in the shared view store so citations can flip it.
  const page = useSyncExternalStore(
    subscribePdfView,
    () => getPdfPage(shape.id),
    () => 1,
  );
  const [loadError, setLoadError] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState(false);
  const [attempt, setAttempt] = useState('');

  // The page fills the stage completely — the card's aspect is locked to the
  // page's (below + onResize), so contain-fit leaves no bars.
  const areaW = Math.max(40, w);
  const areaH = Math.max(40, h - FOOTER_H);

  // Load (and cache) the document when the URL becomes available. Encrypted
  // PDFs surface a password prompt in the card; the entered password retries.
  useEffect(() => {
    if (status !== 'ready' || !src) return;
    let cancelled = false;
    setLoadError(false);
    getPdfjs().then(
      (lib) => {
        if (cancelled) return;
        libRef.current = lib;
        const task = lib.getDocument(attempt ? { url: src, password: attempt } : { url: src });
        task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
          // reason 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
          if (cancelled) return;
          setNeedsPassword(true);
          setPwError(reason === 2);
        };
        task.promise.then(
          (doc) => {
            if (cancelled) {
              doc.destroy();
              return;
            }
            docRef.current = doc;
            setNeedsPassword(false);
            setPwError(false);
            setPageCount(doc.numPages);
            if (getPdfPage(shape.id) > doc.numPages) setPdfPage(shape.id, doc.numPages);
            // Lock the card to the page's aspect ratio so the render fills
            // the stage exactly (no letterbox bars, no side padding).
            doc.getPage(1).then((p1) => {
              if (cancelled) return;
              const vp1 = p1.getViewport({ scale: 1 });
              const aspect = vp1.height / vp1.width;
              const cur = editor.getShape(shape.id) as PdfCardShape | undefined;
              if (!cur) return;
              const targetH = Math.round(cur.props.w * aspect) + FOOTER_H;
              if (Math.abs(cur.props.h - targetH) > 2 || Number(cur.meta.jzPdfAspect) !== aspect) {
                editor.updateShape<PdfCardShape>({
                  id: shape.id,
                  type: 'pdf-card',
                  props: { h: targetH },
                  meta: { ...cur.meta, jzPdfAspect: aspect },
                });
              }
            });
          },
          () => {
            if (!cancelled && !task.onPassword) setLoadError(true);
            // onPassword path keeps the prompt up rather than showing a render error
            if (!cancelled && !needsPassword) setLoadError(true);
          },
        );
      },
      // The pdf.js chunk itself failed to fetch (offline mid-session) — an
      // honest render error beats an eternally blank stage.
      () => {
        if (!cancelled) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [src, status, attempt, shape.id]);

  // Render the current page, fit-to-contain, at the card's current size — plus a
  // selectable text layer aligned over the canvas, then any active highlight.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const lib = libRef.current; // set before docRef by the load effect
    if (!doc || !canvas || !lib) return;
    let renderTask: ReturnType<Awaited<ReturnType<typeof doc.getPage>>['render']> | null = null;
    let cancelled = false;
    doc.getPage(page).then(async (pdfPage) => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(areaW / base.width, areaH / base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const dispW = Math.floor(base.width * fit);
      const dispH = Math.floor(base.height * fit);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const viewport = pdfPage.getViewport({ scale: fit * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${dispW}px`;
      canvas.style.height = `${dispH}px`;
      if (wrapRef.current) {
        wrapRef.current.style.width = `${dispW}px`;
        wrapRef.current.style.height = `${dispH}px`;
      }
      renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      await renderTask.promise.catch(() => {});
      if (cancelled) return;

      // Text layer (selectable), aligned via --scale-factor = display scale.
      const textDiv = textRef.current;
      if (textDiv) {
        textDiv.innerHTML = '';
        textDiv.style.setProperty('--scale-factor', String(fit));
        try {
          const tc = await pdfPage.getTextContent();
          if (cancelled) return;
          const tl = new lib.TextLayer({
            textContentSource: tc,
            container: textDiv,
            viewport: pdfPage.getViewport({ scale: fit }),
          });
          await tl.render();
          if (cancelled) return;
          applyHighlight(textDiv, highlight && highlight.page === page ? highlight.quote : '');
        } catch {
          /* text layer is best-effort (e.g., scanned page) */
        }
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [page, pageCount, areaW, areaH, highlight]);

  const total = pageCount || shape.props.pages || 0;
  const go = (delta: number) => setPdfPage(shape.id, Math.max(1, Math.min(total || 1, page + delta)));

  const unlock = () => {
    if (password.trim()) setAttempt(password);
  };

  return (
    <div className={`jz-card jz-pdf-card${isSelected ? ' jz-card-selected' : ''}`}>
      <div className="jz-pdf-stage">
        {status === 'uploading' ? (
          <PdfMessage label={`Uploading ${name || 'PDF'}…`} spinner />
        ) : status === 'error' ? (
          <PdfMessage label={`Couldn't upload ${name || 'this PDF'}`} />
        ) : needsPassword ? (
          <div className="jz-pdf-message" onPointerDown={stopEventPropagation}>
            <PdfGlyph size={26} />
            <span>{pwError ? 'Wrong password — try again' : 'This PDF is password-protected'}</span>
            <div className="jz-pdf-pwrow">
              <input
                type="password"
                className="jz-pdf-pw"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') unlock();
                }}
                onPointerDown={stopEventPropagation}
              />
              <button className="jz-pdf-unlock" onClick={unlock}>
                Unlock
              </button>
            </div>
          </div>
        ) : loadError ? (
          <PdfMessage label="Couldn't render this PDF" />
        ) : (
          <div
            ref={wrapRef}
            className={`jz-pdf-wrap${selectText ? ' jz-pdf-selectable' : ''}`}
            {...(selectText ? { onPointerDown: stopEventPropagation } : {})}
            onMouseUp={() => {
              if (!selectText) return;
              const sel = window.getSelection();
              const text = sel?.toString().trim() ?? '';
              if (!text || text.length < 3) {
                setPdfSelection(null);
                return;
              }
              const rect = sel!.getRangeAt(0).getBoundingClientRect();
              setPdfSelection({
                shapeId: shape.id,
                assetId: shape.props.assetId,
                name,
                page,
                text: text.slice(0, 1200),
                x: rect.left + rect.width / 2,
                y: rect.bottom,
              });
            }}
          >
            <canvas ref={canvasRef} className="jz-pdf-canvas" />
            <div ref={textRef} className="jz-pdf-textlayer" />
          </div>
        )}
      </div>
      <div className="jz-pdf-footer" onPointerDown={stopEventPropagation}>
        <PdfGlyph />
        <span className="jz-pdf-name" title={name}>
          {name || 'Document.pdf'}
        </span>
        {status === 'ready' && total > 0 ? (
          <span className="jz-pdf-pager">
            <button
              className="jz-pdf-nav"
              aria-label="Previous page"
              disabled={page <= 1}
              onPointerDown={stopEventPropagation}
              onClick={() => go(-1)}
            >
              ‹
            </button>
            <span className="jz-pdf-count">
              {page} / {total}
            </span>
            <button
              className="jz-pdf-nav"
              aria-label="Next page"
              disabled={page >= total}
              onPointerDown={stopEventPropagation}
              onClick={() => go(1)}
            >
              ›
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Mark the text-layer spans that make up a quoted passage. */
function applyHighlight(container: HTMLElement, quote: string): void {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const q = norm(quote);
  container.querySelectorAll('span').forEach((sp) => {
    sp.classList.remove('jz-pdf-hl');
    if (!q) return;
    const t = norm(sp.textContent ?? '');
    if (t.length >= 4 && q.includes(t)) sp.classList.add('jz-pdf-hl');
  });
}

function PdfMessage({ label, spinner = false }: { label: string; spinner?: boolean }) {
  return (
    <div className="jz-pdf-message">
      {spinner ? <span className="jz-pdf-spinner" aria-hidden /> : <PdfGlyph size={26} />}
      <span>{label}</span>
    </div>
  );
}

function PdfGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden style={{ flex: 'none' }}>
      <path
        d="M3.5 1.5h4.8L11.5 4.7v7.8a.8.8 0 0 1-.8.8H3.5a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M8.2 1.7v3.1h3.1" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
