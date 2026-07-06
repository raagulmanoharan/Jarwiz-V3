/**
 * Help surface — the **help panel**, a calm reference card (what Jarwiz can do +
 * keyboard shortcuts) opened from the rail's "?" button. It never blocks the
 * canvas permanently — Esc always returns you to the board.
 *
 * (A guided tour used to live here too; it was cut once it had gone stale and
 * undiscoverable — the reference panel stands on its own.)
 */

import { useEffect, useSyncExternalStore } from 'react';
import { closeHelp, getHelpState, subscribeHelp } from './help';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/** The reference feature list — the powerful surfaces first, so a newcomer sees
 *  what makes Jarwiz more than a whiteboard. */
const FEATURES: Array<{ glyph: string; title: string; body: string }> = [
  { glyph: '◱', title: 'Thinking Machines', body: 'Premade analysis blocks — SWOT, Effort–Impact, Competitive, Risk — that deep-research the web and fan out a board of cards. Pick one from the left rail.' },
  { glyph: '✧', title: 'Autopilot', body: 'Hand Jarwiz a goal in the prompt bar and it plans, researches, and builds the board for you.' },
  { glyph: '✦', title: 'Ask & create', body: 'Type in the prompt bar; the answer streams onto a card. Select a card first to ground the question on it.' },
  { glyph: '⌕', title: 'Deep research', body: 'Research-heavy asks pull live data from the web and cite their sources — not just what the model remembers.' },
  { glyph: '⬓', title: 'Bring in your material', body: 'Drop a PDF, spreadsheet, video, or link — Jarwiz reads it and works from it, and suggests starting questions.' },
  { glyph: '↺', title: 'Card actions', body: 'Select a card to shorten it, go deeper, reformat as a table or flowchart, summarise, or regenerate.' },
  { glyph: '◳', title: 'Cluster & summarise', body: 'Select three or more sticky notes and turn a wall of them into named themes in one click.' },
];

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['V'], label: 'Select tool' },
  { keys: ['H'], label: 'Hand / pan' },
  { keys: ['R'], label: 'Rectangle' },
  { keys: ['A'], label: 'Arrow' },
  { keys: ['F'], label: 'Frame' },
  { keys: ['Tab'], label: 'Continue writing (in a doc)' },
  { keys: ['Esc'], label: 'Stop a running generation' },
  { keys: [MOD, 'Z'], label: 'Undo' },
];

export function HelpLayer() {
  const { panelOpen } = useSyncExternalStore(subscribeHelp, getHelpState, getHelpState);

  // Esc closes the panel.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeHelp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  return panelOpen ? <HelpPanel /> : null;
}

function HelpPanel() {
  return (
    <div className="jz-help-scrim" onPointerDown={closeHelp}>
      <div
        className="jz-help-panel"
        role="dialog"
        aria-label="Help — what Jarwiz can do"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="jz-help-head">
          <h2 className="jz-help-title">
            <span className="jz-help-spark" aria-hidden>✦</span> What you can do with Jarwiz
          </h2>
          <button className="jz-help-close" aria-label="Close help" onClick={closeHelp}>✕</button>
        </div>

        <div className="jz-help-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="jz-help-feature">
              <span className="jz-help-feature-glyph" aria-hidden>{f.glyph}</span>
              <div className="jz-help-feature-text">
                <span className="jz-help-feature-title">{f.title}</span>
                <span className="jz-help-feature-body">{f.body}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="jz-help-shortcuts">
          <span className="jz-help-section-label">Keyboard</span>
          <div className="jz-help-keys">
            {SHORTCUTS.map((s) => (
              <span key={s.label} className="jz-help-key-row">
                <span className="jz-help-key-combo">
                  {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                </span>
                <span className="jz-help-key-label">{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
