/**
 * Help + onboarding surface. Renders two things off the shared help store:
 *
 *  1. The **help panel** — a calm reference card (what Jarwiz can do +
 *     keyboard shortcuts), opened from the topbar "?" button.
 *  2. The **guided tour** — a step-by-step walkthrough whose callout points at
 *     the relevant region of the UI (right rail, top action bar, prompt bar…).
 *     Auto-opens once for a first-time user (after the new-board dialog is
 *     done), and is replayable anytime via "Take the tour" in the panel.
 *
 * Both honor reduced-motion (animations are gated in CSS) and never block the
 * canvas permanently — Esc / Skip / Done always return you to the board.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getActiveBoard, subscribeBoards } from '../boards/boardStore';
import {
  closeHelp,
  endTour,
  getHelpState,
  hasSeenTour,
  setTourStep,
  startTour,
  subscribeHelp,
} from './help';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/** Where a tour callout sits, and which way its caret points. */
type Anchor = 'center' | 'rail' | 'cardbar' | 'prompt' | 'topbar';

interface TourStep {
  anchor: Anchor;
  title: string;
  body: string;
}

const TOUR: TourStep[] = [
  {
    anchor: 'center',
    title: 'Welcome to Jarwiz',
    body: 'An infinite canvas where AI agents work alongside you — researching, summarising, clustering, and drafting, all as cards you can move and connect. Here is the 60-second tour.',
  },
  {
    anchor: 'rail',
    title: 'Build anything',
    body: 'The right rail has your creators and primitives: docs, sticky notes, shapes, arrows, frames. Press d for a doc or n for a sticky note.',
  },
  {
    anchor: 'center',
    title: 'Bring in your own material',
    body: 'Drop a PDF or paste a link straight onto the canvas. Jarwiz reads it and offers smart starting questions, so you are never staring at a blank board.',
  },
  {
    anchor: 'prompt',
    title: 'Ask anything',
    body: 'Type in the prompt bar and the answer streams onto the board. Select a card first to ground the question on it; the chips suggest the next best prompt.',
  },
  {
    anchor: 'prompt',
    title: 'Agents with opinions',
    body: 'Open the Agents menu to scan the whole board: find tensions between cards, surface what you are missing, or get a sharp devil’s-advocate critique.',
  },
  {
    anchor: 'cardbar',
    title: 'Refine any card',
    body: 'Select a card and this action bar lights up — make it shorter, go deeper, turn it into a table or flowchart, discuss it, or see what it was based on.',
  },
  {
    anchor: 'center',
    title: 'Turn notes into themes',
    body: 'Select three or more sticky notes, then Refine → Cluster & summarise. Jarwiz sorts them into named themes and writes the summary for you.',
  },
  {
    anchor: 'topbar',
    title: 'Boards & this guide',
    body: 'Switch projects from the board chip up here. You can reopen this guide or the shortcut reference anytime from the ? button.',
  },
];

const FEATURES: Array<{ glyph: string; title: string; body: string }> = [
  { glyph: '◧', title: 'Build with primitives', body: 'Docs, sticky notes, shapes, arrows, and frames from the right rail.' },
  { glyph: '⬓', title: 'Drop PDFs & links', body: 'Jarwiz reads them and suggests starting questions.' },
  { glyph: '✦', title: 'Ask & create', body: 'Type in the prompt bar; select a card to ground the answer on it.' },
  { glyph: '⚖', title: 'Agents with opinions', body: 'Scan for tensions, gaps, or a devil’s-advocate critique.' },
  { glyph: '↺', title: 'Refine any card', body: 'Shorten, deepen, reformat as a table or flowchart, or regenerate.' },
  { glyph: '◳', title: 'Cluster & summarise', body: 'Turn a wall of stickies into named themes with one click.' },
  { glyph: '💬', title: 'Discuss & revise', body: 'Open a thread on a doc and rewrite it in place.' },
];

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['d'], label: 'New doc' },
  { keys: ['n'], label: 'New sticky note' },
  { keys: ['V'], label: 'Select tool' },
  { keys: ['H'], label: 'Hand / pan' },
  { keys: ['T'], label: 'Text' },
  { keys: ['R'], label: 'Rectangle' },
  { keys: ['A'], label: 'Arrow' },
  { keys: ['F'], label: 'Frame' },
  { keys: [MOD, 'Z'], label: 'Undo' },
];

export function HelpLayer() {
  const { panelOpen, tourStep } = useSyncExternalStore(subscribeHelp, getHelpState, getHelpState);
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const autoStarted = useRef(false);

  // Auto-launch the tour exactly once for a first-time user — but only after the
  // new-board dialog (BoardEntry) has been resolved, so the two don't stack.
  const boardReady = Boolean(board) && !board?.isNew;
  useEffect(() => {
    if (autoStarted.current) return;
    if (boardReady && !hasSeenTour()) {
      autoStarted.current = true;
      const t = setTimeout(() => {
        // Don't barge in if the user already opened help themselves.
        if (getHelpState().tourStep === null && !getHelpState().panelOpen) startTour();
      }, 700);
      return () => clearTimeout(t);
    }
  }, [boardReady]);

  // Esc closes whichever surface is up.
  useEffect(() => {
    if (!panelOpen && tourStep === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (tourStep !== null) endTour();
        else closeHelp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, tourStep]);

  return (
    <>
      {panelOpen ? <HelpPanel /> : null}
      {tourStep !== null ? <Tour step={tourStep} /> : null}
    </>
  );
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

        <div className="jz-help-foot">
          <button className="jz-help-tour-btn" onClick={startTour}>✦ Take the guided tour</button>
        </div>
      </div>
    </div>
  );
}

function Tour({ step }: { step: number }) {
  const total = TOUR.length;
  const current = Math.min(Math.max(step, 0), total - 1);
  const s = TOUR[current]!;
  const isFirst = current === 0;
  const isLast = current === total - 1;

  return (
    <div className="jz-tour-scrim" onPointerDown={endTour}>
      <div
        className={`jz-tour-bubble jz-tour-bubble--${s.anchor}`}
        role="dialog"
        aria-label={`Tour step ${current + 1} of ${total}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className={`jz-tour-caret jz-tour-caret--${s.anchor}`} aria-hidden />
        <div className="jz-tour-step">Step {current + 1} of {total}</div>
        <h3 className="jz-tour-title">{s.title}</h3>
        <p className="jz-tour-body">{s.body}</p>

        <div className="jz-tour-foot">
          <div className="jz-tour-dots" aria-hidden>
            {TOUR.map((_, i) => (
              <span key={i} className={`jz-tour-dot${i === current ? ' jz-tour-dot--on' : ''}`} />
            ))}
          </div>
          <div className="jz-tour-actions">
            {isFirst ? (
              <button className="jz-tour-skip" onClick={endTour}>Skip</button>
            ) : (
              <button className="jz-tour-skip" onClick={() => setTourStep(current - 1)}>Back</button>
            )}
            <button className="jz-tour-next" onClick={() => (isLast ? endTour() : setTourStep(current + 1))}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
