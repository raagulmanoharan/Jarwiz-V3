/**
 * Ask the server what it can do. Right now the one signal that matters is
 * `live` — whether a real Anthropic key is configured. When it's false the
 * runtime serves a scripted mock, and the UI owes the user an honest "Demo
 * mode" badge. Fetched once on mount; defaults to live so a slow/failed probe
 * never wrongly accuses a real server of being a demo.
 */

import { useEffect, useState } from 'react';

export interface Capabilities {
  live: boolean;
}

export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities')
      .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : null))
      .then((data) => {
        if (!cancelled && data) setCaps({ live: Boolean(data.live) });
      })
      .catch(() => {
        /* probe failed — leave null, the UI treats unknown as live */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return caps;
}
