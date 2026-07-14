/**
 * Export modal — the view over the export run. It's a pure subscriber to the
 * export store: while the artifact builds it shows an honest, rotating status;
 * once ready it presents the result and the ways to take it out of Jarwiz.
 *
 *  - Slideshow → a live 16:9 preview of the deck (rendered in a sandboxed
 *    iframe so its own keyboard nav / fullscreen work), plus Open in new tab /
 *    Download .html / Copy.
 *  - Markdown  → the document in a monospace pane, plus Copy / Download .md.
 *
 * Backdrop click or Escape closes it (aborting a run in flight). Modeled on
 * PersonaModal's dialog shell + the token set, so it re-skins with the theme.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  closeExport,
  getExportState,
  retryExport,
  subscribeExport,
} from './exportStore';
import { copyText, downloadText, openHtmlInNewTab, printDeckToPdf, slugify } from './download';

export function ExportModal() {
  const state = useSyncExternalStore(subscribeExport, getExportState, getExportState);
  const { open } = state;

  // Keep mounted briefly after close so the panel can play its exit fade.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeExport();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mounted) return null;

  const isSlideshow = state.mode === 'slideshow';
  const heading = isSlideshow ? 'Export as slideshow' : 'Export as Markdown';

  return (
    <div
      className={`jz-export-overlay${open ? '' : ' jz-export-overlay--leaving'}`}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onClick={closeExport}
    >
      <div
        className={`jz-export-panel${state.phase === 'ready' && isSlideshow ? ' jz-export-panel--wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="jz-export-head">
          <div className="jz-export-head-titles">
            <h2 className="jz-export-title">{heading}</h2>
            <p className="jz-export-subtitle">{state.title}</p>
          </div>
          <button className="jz-export-close" onClick={closeExport} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {state.phase === 'working' ? <WorkingView status={state.status} slideshow={isSlideshow} /> : null}
        {state.phase === 'error' ? <ErrorView message={state.error ?? 'Something went wrong.'} /> : null}
        {state.phase === 'ready' ? (
          isSlideshow ? (
            <SlideshowResult html={state.text} title={state.title} />
          ) : (
            <MarkdownResult markdown={state.text} title={state.title} />
          )
        ) : null}
      </div>
    </div>
  );
}

function WorkingView({ status, slideshow }: { status: string; slideshow: boolean }) {
  // A smoothly-easing progress bar: we can't know the true duration, so it
  // decelerates toward ~92% and the view swaps to the result on done. Reads as
  // the deck being "pieced together" rather than a dead spinner.
  const [pct, setPct] = useState(6);
  useEffect(() => {
    const id = window.setInterval(() => {
      setPct((p) => (p >= 92 ? p : p + (92 - p) * 0.08));
    }, 350);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="jz-export-body jz-export-working">
      <div className="jz-export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span className="jz-export-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="jz-export-status">{status || 'Working…'}</p>
      <p className="jz-export-hint">
        {slideshow
          ? 'Piecing together your slides — Jarwiz is reading the whole board and designing each page.'
          : 'Jarwiz is capturing the session into a comprehensive handoff.'}
      </p>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="jz-export-body jz-export-error">
      <p className="jz-export-error-msg">{message}</p>
      <div className="jz-export-actions">
        <button className="jz-export-action jz-export-action--primary" onClick={retryExport}>
          Try again
        </button>
        <button className="jz-export-action" onClick={closeExport}>
          Close
        </button>
      </div>
    </div>
  );
}

function SlideshowResult({ html, title }: { html: string; title: string }) {
  const filename = `${slugify(title)}-slides.html`;
  return (
    <div className="jz-export-body">
      <div className="jz-export-preview jz-export-preview--deck" aria-label="Slideshow preview">
        {/* The deck is a static paged document (no scripts) — a plain sandbox
            is enough; it scrolls to show every page. */}
        <iframe
          className="jz-export-iframe"
          title="Slideshow preview"
          srcDoc={html}
          sandbox=""
        />
      </div>
      <div className="jz-export-actions">
        <button
          className="jz-export-action jz-export-action--primary"
          onClick={() => printDeckToPdf(html)}
        >
          Download PDF
        </button>
        <button className="jz-export-action" onClick={() => openHtmlInNewTab(html, filename)}>
          Open in new tab
        </button>
      </div>
      <p className="jz-export-note">In the print dialog, choose “Save as PDF”. Each slide becomes one page.</p>
    </div>
  );
}

function MarkdownResult({ markdown, title }: { markdown: string; title: string }) {
  const filename = `${slugify(title)}.md`;
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (await copyText(markdown)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div className="jz-export-body">
      <pre className="jz-export-md" tabIndex={0}>
        {markdown}
      </pre>
      <div className="jz-export-actions">
        <button className="jz-export-action jz-export-action--primary" onClick={doCopy}>
          {copied ? 'Copied ✓' : 'Copy Markdown'}
        </button>
        <button className="jz-export-action" onClick={() => downloadText(markdown, filename, 'text/markdown')}>
          Download .md
        </button>
      </div>
    </div>
  );
}
