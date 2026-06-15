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
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { pdfjsLib, type PdfDocument } from '../lib/pdfjs';
import { getPdfPage, setPdfPage, subscribePdfView } from '../pdf/pdfView';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

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
const PAD = 10;

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

  override onResize(shape: PdfCardShape, info: TLResizeInfo<PdfCardShape>) {
    return resizeBox(shape, info, { minWidth: 240, minHeight: 240 });
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
  const { src, name, status, w, h } = shape.props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDocument | null>(null);
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

  const areaW = Math.max(40, w - PAD * 2);
  const areaH = Math.max(40, h - FOOTER_H - PAD);

  // Load (and cache) the document when the URL becomes available. Encrypted
  // PDFs surface a password prompt in the card; the entered password retries.
  useEffect(() => {
    if (status !== 'ready' || !src) return;
    let cancelled = false;
    setLoadError(false);
    const task = pdfjsLib.getDocument(attempt ? { url: src, password: attempt } : { url: src });
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
      },
      () => {
        if (!cancelled && !task.onPassword) setLoadError(true);
        // onPassword path keeps the prompt up rather than showing a render error
        if (!cancelled && !needsPassword) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [src, status, attempt, shape.id]);

  // Render the current page, fit-to-contain, at the card's current size.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let renderTask: ReturnType<Awaited<ReturnType<typeof doc.getPage>>['render']> | null = null;
    let cancelled = false;
    doc.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(areaW / base.width, areaH / base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: fit * dpr });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(base.width * fit)}px`;
      canvas.style.height = `${Math.floor(base.height * fit)}px`;
      renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      renderTask.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [page, pageCount, areaW, areaH]);

  const total = pageCount || shape.props.pages || 0;
  const go = (delta: number) => setPdfPage(shape.id, Math.max(1, Math.min(total || 1, page + delta)));

  const unlock = () => {
    if (password.trim()) setAttempt(password);
  };

  return (
    <div className="jz-card jz-pdf-card">
      <div className="jz-pdf-stage" style={{ padding: PAD }}>
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
          <canvas ref={canvasRef} className="jz-pdf-canvas" />
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
