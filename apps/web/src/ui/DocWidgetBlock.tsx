/**
 * The inline widget block — a small model-authored interactive inside a doc
 * answer (the fence architecture's first GENERATIVE block; the map block is
 * the structured one). The doc's ```widget fence carries only the BRIEF
 * ({concept, controls, note}), so the doc streams fast; this component
 * hydrates it through POST /api/widget (generated on the prototype budget,
 * cached per brief server-side AND here) and renders the result exactly the
 * way the prototype card does: a sandboxed iframe — no network, no escape.
 * Unparseable or failed briefs degrade to nothing; the prose still carries
 * the answer.
 */

import { useEffect, useMemo, useState } from 'react';

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

export function DocWidgetBlock({ raw }: { raw: string }) {
  // A brief must at least parse and name a concept — anything else renders as
  // nothing (degrade-to-nothing, like dead images).
  const valid = useMemo(() => {
    try {
      const json = JSON.parse(raw) as { concept?: unknown };
      return typeof json.concept === 'string' && json.concept.trim().length > 0;
    } catch {
      return false;
    }
  }, [raw]);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    void hydrate(raw.trim()).then((result) => {
      if (!alive) return;
      if (result) setHtml(result);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [raw, valid]);

  if (!valid || failed) return null;
  if (!html) return <div className="jz-widget-block jz-widget-block--pending">building the widget…</div>;

  return (
    <div
      className="jz-widget-block"
      // The widget is interactive by nature — its region owns the pointer
      // (same contract as checkboxes and links inside a doc).
      style={{ pointerEvents: 'all' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <iframe
        className="jz-widget-frame"
        title="Interactive widget"
        // Same sandbox as the prototype card: scripts may run, nothing may
        // escape — no same-origin, no network (opaque origin blocks fetches).
        sandbox="allow-scripts allow-forms"
        srcDoc={html}
      />
    </div>
  );
}
