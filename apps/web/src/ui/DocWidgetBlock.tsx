/**
 * The inline widget block — a small model-authored interactive inside a doc
 * answer (the fence architecture's first GENERATIVE block; the map block is
 * the structured one). The doc's ```widget fence carries only the BRIEF
 * ({concept, interaction, note}), so the doc streams fast; this component
 * hydrates it through POST /api/widget and renders the result exactly the
 * way the prototype card does: a sandboxed iframe — no network, no escape.
 *
 * The delight layer (owner call 2026-07-11):
 *  - the wait is HONEST and specific — the pending state shows the brief
 *    itself ("building: drag force vs speed · speed slider + van toggle"),
 *    the same transparency as "what the agent sees";
 *  - the Jarwiz avatar parks beside the doc while the widget builds
 *    (WidgetPresenceLayer listens to the hydration events fired here);
 *  - widgets arrive wearing the DESIGN TOKENS — the current theme's surface/
 *    ink/accent are injected as --jzw-* custom properties into the srcdoc,
 *    re-injected when the theme flips, so a widget is never a white patch
 *    in dark mode;
 *  - the widget introduces itself (a ~1.2s authored demo sweep) — that part
 *    lives in WIDGET_SYSTEM, authored into the widget itself.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getTheme, subscribeTheme } from './theme';

/** Hydration lifecycle events — WidgetPresenceLayer turns these into the
 *  avatar parking beside the card while its widget builds. */
export const WIDGET_HYDRATION_EVENT = 'jz:widget-hydration';
export interface WidgetHydrationDetail {
  /** Stable per-block key (the brief text). */
  key: string;
  /** The doc card the block lives in, when known. */
  sourceId?: string;
  concept: string;
  phase: 'start' | 'done';
}

interface Brief {
  concept: string;
  interaction?: string;
}

function parseBrief(raw: string): Brief | null {
  try {
    const json = JSON.parse(raw) as { concept?: unknown; interaction?: unknown; controls?: unknown };
    if (typeof json.concept !== 'string' || !json.concept.trim()) return null;
    const interaction =
      typeof json.interaction === 'string' && json.interaction.trim()
        ? json.interaction.trim()
        : Array.isArray(json.controls)
          ? json.controls.map((c) => String(c)).join(' · ')
          : undefined;
    return { concept: json.concept.trim(), interaction };
  } catch {
    return null;
  }
}

/** One hydration per distinct brief — docs re-render on every stream delta
 *  and selection; the generator must see each brief once. */
const hydrateCache = new Map<string, Promise<string | null>>();
function hydrate(brief: string): Promise<string | null> {
  let inflight = hydrateCache.get(brief);
  if (!inflight) {
    inflight = fetch('/api/widget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { html?: string } | null) => (typeof data?.html === 'string' && data.html.trim() ? data.html : null))
      .catch(() => null);
    hydrateCache.set(brief, inflight);
    void inflight.then((v) => {
      if (!v) hydrateCache.delete(brief); // a transient failure may succeed later
    });
  }
  return inflight;
}

/** The current theme's tokens, mapped to the --jzw-* contract WIDGET_SYSTEM
 *  teaches the model to use (with fallbacks, so old/foreign widgets survive). */
function themeVars(): string {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return [
    `--jzw-surface:${v('--jz-card-surface', '#fafafa')}`,
    `--jzw-ink:${v('--jz-ink-900', '#1a1a1a')}`,
    `--jzw-muted:${v('--jz-ink-500', '#6a6a6a')}`,
    `--jzw-line:${v('--jz-ink-200', '#d4d4d4')}`,
    `--jzw-accent:${v('--jz-accent', '#0f0f0f')}`,
    `--jzw-accent-ink:${v('--jz-accent-ink', '#ffffff')}`,
  ].join(';');
}

/** Dress the widget in the current theme: inject the token custom properties
 *  at the top of its document (head when present, else prepended). */
function themed(html: string): string {
  const style = `<style>:root{${themeVars()}}</style>`;
  return html.includes('<head>') ? html.replace('<head>', `<head>${style}`) : style + html;
}

export function DocWidgetBlock({ raw, sourceId }: { raw: string; sourceId?: string }) {
  const brief = useMemo(() => parseBrief(raw), [raw]);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Theme flips re-dress (and reload) the widget — its intro sweep replays,
  // which reads as the widget waking up in its new clothes.
  const theme = useSyncExternalStore(subscribeTheme, getTheme);

  useEffect(() => {
    if (!brief) return;
    let alive = true;
    const key = raw.trim();
    window.dispatchEvent(
      new CustomEvent<WidgetHydrationDetail>(WIDGET_HYDRATION_EVENT, {
        detail: { key, sourceId, concept: brief.concept, phase: 'start' },
      }),
    );
    const finish = () =>
      window.dispatchEvent(
        new CustomEvent<WidgetHydrationDetail>(WIDGET_HYDRATION_EVENT, {
          detail: { key, sourceId, concept: brief.concept, phase: 'done' },
        }),
      );
    void hydrate(key).then((result) => {
      finish();
      if (!alive) return;
      if (result) setHtml(result);
      else setFailed(true);
    });
    return () => {
      alive = false;
      finish(); // unmounting mid-build must not leave the avatar parked
    };
  }, [raw, brief, sourceId]);

  // A brief that doesn't parse (or a build that failed) renders as nothing —
  // degrade-to-nothing; the prose still carries the answer.
  if (!brief || failed) return null;
  if (!html) {
    return (
      <div className="jz-widget-block jz-widget-block--pending">
        <span className="jz-widget-pending-title">building: {brief.concept}</span>
        {brief.interaction ? <span className="jz-widget-pending-sub">{brief.interaction}</span> : null}
      </div>
    );
  }

  return (
    <div
      className="jz-widget-block jz-widget-block--live"
      // The widget is interactive by nature — its region owns the pointer
      // (same contract as checkboxes and links inside a doc).
      style={{ pointerEvents: 'all' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <iframe
        key={theme}
        className="jz-widget-frame"
        title={`Interactive: ${brief.concept}`}
        // Same sandbox as the prototype card: scripts may run, nothing may
        // escape — no same-origin, no network (opaque origin blocks fetches).
        sandbox="allow-scripts allow-forms"
        srcDoc={themed(html)}
      />
    </div>
  );
}
