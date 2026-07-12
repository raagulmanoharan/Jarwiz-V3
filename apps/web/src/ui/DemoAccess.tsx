/**
 * Demo access surfaces — the counter chip beside the board title and the
 * "Get full access" card pinned to the bottom of the boards side panel.
 *
 * The hosted demo/pilot no longer asks anyone for an API key (owner call,
 * 2026-07-10: BYOK stays server-side but out of the UI). Instead the chip
 * quietly shows the actions budget ("42 left") — or just "Demo" for keyless
 * visitors — and clicking it opens the side panel, where the pinned card
 * spells out what the demo includes and carries the full-access CTA. The CTA
 * is a deliberate placeholder: where it leads (waitlist, checkout, contact)
 * is an owner decision still to come.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
import { getBackendSnapshot, reprobeBackend, subscribeBackend } from '../lib/backend';
import { isSidePanelOpen, openSidePanel, subscribeSidePanel } from './sidePanelStore';

/** Counter chip beside the board title. Renders only on the hosted demo
 *  (a budget to count, or the keyless scripted demo) — local dev and full
 *  installs see nothing. */
export function DemoCounterChip() {
  const backend = useSyncExternalStore(subscribeBackend, getBackendSnapshot, getBackendSnapshot);
  const relevant = Boolean(backend.pilot) || backend.mode === 'demo';
  if (!relevant) return null;

  const left = backend.pilot ? Math.max(0, backend.pilot.limit - backend.pilot.used) : null;
  const spent = left === 0;
  const label = left === null ? 'Demo' : `${left} action${left === 1 ? '' : 's'} left`;

  return (
    <button
      className={`jz-democount${spent ? ' jz-democount--spent' : ''}`}
      onClick={() => openSidePanel()}
      title="About this demo & getting full access"
      aria-label={`${label} — about this demo and getting full access`}
    >
      <span className="jz-democount-dot" aria-hidden />
      {label}
    </button>
  );
}

/** The pinned card at the bottom of the boards side panel. */
export function DemoAccessCard() {
  const backend = useSyncExternalStore(subscribeBackend, getBackendSnapshot, getBackendSnapshot);
  const panelOpen = useSyncExternalStore(subscribeSidePanel, isSidePanelOpen, isSidePanelOpen);

  // The budget moves as actions spend — refresh the count each time the
  // panel opens so the card never shows a stale number.
  useEffect(() => {
    if (panelOpen && (getBackendSnapshot().pilot || getBackendSnapshot().mode === 'demo')) {
      reprobeBackend();
    }
  }, [panelOpen]);

  const relevant = Boolean(backend.pilot) || backend.mode === 'demo';
  if (!relevant) return null;

  const pilot = backend.pilot;
  const left = pilot ? Math.max(0, pilot.limit - pilot.used) : null;

  return (
    <div className="jz-side-access">
      <div className="jz-side-access-head">
        <Sparkles size={14} strokeWidth={1.8} aria-hidden />
        <span>You’re in the demo</span>
      </div>
      {pilot ? (
        <>
          <div className="jz-side-access-count">
            <strong>{left}</strong> of {pilot.limit} AI actions left
          </div>
          <div className="jz-side-access-meter" role="img" aria-label={`${left} of ${pilot.limit} AI actions left`}>
            <span style={{ width: `${Math.round(((left ?? 0) / pilot.limit) * 100)}%` }} />
          </div>
        </>
      ) : null}
      <ul className="jz-side-access-limits">
        <li>{pilot ? 'AI actions are limited to your invite' : 'Agents answer with a scripted demo'}</li>
        <li>Boards and files live only in this browser</li>
        <li>No sharing or multiplayer yet</li>
      </ul>
      {/* Placeholder CTA — destination is an owner decision, wired later. */}
      <button className="jz-side-access-cta" title="Coming soon">
        Get full Jarwiz access
      </button>
    </div>
  );
}
