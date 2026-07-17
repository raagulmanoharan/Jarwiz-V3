/**
 * The pre-text state of a card being written by Jarwiz. An empty streaming card
 * used to show only a bare blinking caret — the person couldn't tell whether
 * anything was happening in the background. This says it plainly: the sparkle
 * pulses and the label names the wait ("Writing this in…"), carrying the live
 * server stage when we have one. The moment real text arrives the card renders
 * its content and the caret rides the words instead (owner ask, 2026-07-17).
 */

import { JarwizSpark } from './JarwizSpark';

export function StreamingPlaceholder({ label = 'Writing this in…' }: { label?: string }) {
  return (
    <div className="jz-stream-writing" aria-live="polite">
      <span className="jz-stream-writing-spark" aria-hidden>
        <JarwizSpark size={12} />
      </span>
      <span className="jz-stream-writing-label">{label}</span>
    </div>
  );
}
