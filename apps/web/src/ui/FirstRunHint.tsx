/**
 * The first-run nudge — a calm, non-modal pill that teaches the one shortcut
 * that unlocks the product: ⌘K to summon an agent. Shows once, until the user
 * either dismisses it or summons for the first time (markOnboarded). Never
 * blocks the canvas; it sits bottom-center and fades on its own.
 */

import { useSyncExternalStore } from 'react';
import { getOnboarded, markOnboarded, subscribeOnboarded } from './onboarding';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function FirstRunHint() {
  const onboarded = useSyncExternalStore(subscribeOnboarded, getOnboarded, getOnboarded);
  if (onboarded) return null;

  return (
    <div className="jz-firstrun" role="note">
      <span className="jz-firstrun-spark" aria-hidden>
        ✦
      </span>
      <span className="jz-firstrun-text">
        Press <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd>K</kbd> to summon an agent
      </span>
      <button className="jz-firstrun-dismiss" aria-label="Dismiss" onClick={markOnboarded}>
        ✕
      </button>
    </div>
  );
}
