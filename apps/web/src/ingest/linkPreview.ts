/** Client for the server's POST /api/link/preview endpoint. */

import type { LinkPreview } from '@jarwiz/shared';

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const response = await fetch('/api/link/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    let message = `Preview request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  return (await response.json()) as LinkPreview;
}
