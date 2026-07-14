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
import { copyText, downloadText, openHtmlInNewTab, slugify } from './download';

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
  return (
    <div className="jz-export-body jz-export-working">
      <div className="jz-export-spinner" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p className="jz-export-status">{status || 'Working…'}</p>
      <p className="jz-export-hint">
        {slideshow
          ? 'Jarwiz is reading the whole board and designing a presentation — this takes a moment.'
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
  const filename = `${slugify(title)}-slideshow.html`;
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (await copyText(html)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div className="jz-export-body">
      <div className="jz-export-preview" aria-label="Slideshow preview">
        {/* allow-same-origin so the deck's location.hash deep-linking works;
            allow-scripts for its nav; sandboxed otherwise. It's our own
            generated content shown back to the same user. */}
        <iframe
          className="jz-export-iframe"
          title="Slideshow preview"
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
          allow="fullscreen"
        />
      </div>
      <div className="jz-export-actions">
        <button
          className="jz-export-action jz-export-action--primary"
          onClick={() => openHtmlInNewTab(html, filename)}
        >
          Open full screen
        </button>
        <button className="jz-export-action" onClick={() => downloadText(html, filename, 'text/html')}>
          Download .html
        </button>
        <button className="jz-export-action" onClick={doCopy}>
          {copied ? 'Copied ✓' : 'Copy HTML'}
        </button>
      </div>
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
