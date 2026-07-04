/**
 * Autopilot avatars — one Jarwiz per active fill, parked at that card (or
 * hopping cell to cell while a table fills). Because Autopilot runs are
 * concurrent background tasks, several can show at once: fire a continuation
 * here, start another there, and you'll see Jarwiz working in both places.
 *
 * Uses the shared JarwizAvatar (Sparkle-in-white-circle) — same identity as
 * the rest of the product.
 */

import { useSyncExternalStore } from 'react';
import {
  getAutopilotSnapshot,
  subscribeAutopilot,
  type AutopilotSession,
} from './autopilotStore';
import { JarwizAvatar } from './AgentCursorLayer';

export function AutopilotPresenceLayer() {
  const sessions = useSyncExternalStore(subscribeAutopilot, getAutopilotSnapshot, getAutopilotSnapshot);

  return (
    <>
      {[...sessions.values()].map((session) =>
        session.anchor ? <Avatar key={session.cardId} session={session} /> : null,
      )}
    </>
  );
}

function Avatar({ session }: { session: AutopilotSession }) {
  return <JarwizAvatar page={session.anchor!} status={session.status} />;
}
