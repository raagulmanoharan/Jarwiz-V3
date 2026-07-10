/**
 * Preview notice — sets expectations on deployments with no AI server (the
 * GitHub Pages build serves the web app only, so every /api call dies with a
 * 404/405 and visitors read it as "the app is broken"). One quiet pill under
 * the topbar says what this build is and isn't, before anyone hits the wall.
 *
 * Detection is live, not build-flagged: one GET /api/health on mount — if it
 * answers, the server is there and the notice never renders (local dev, a
 * future hosted deploy). Dismissal persists for the session only, so a
 * returning visitor is reminded next visit.
 */

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { isDemo, isEmbed, isUseCases } from '../boards/demo';

const DISMISS_KEY = 'jarwiz-preview-notice-dismissed';
const REPO_URL = 'https://github.com/raagulmanoharan/Jarwiz-V3#readme';

export function PreviewNotice() {
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // The scripted showcase iframes (hero showreel, use-cases) narrate
    // themselves — no chrome belongs there.
    if (isEmbed() || isUseCases() || isDemo()) return;
    let alive = true;
    void fetch('/api/health')
      .then((r) => { if (alive && !r.ok) setOffline(true); })
      .catch(() => { if (alive) setOffline(true); });
    return () => { alive = false; };
  }, []);

  if (!offline || dismissed) return null;
  return (
    <div className="jz-preview-notice" role="status">
      <Info size={13} strokeWidth={2} aria-hidden />
      <span>
        You’re in the <b>live preview</b> — Jarwiz’s AI isn’t connected here, so asks won’t answer.
        Explore the canvas, or{' '}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">run it with your own key</a>.
      </span>
      <button
        className="jz-preview-notice-x"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* fine */ }
        }}
      >
        <X size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}
