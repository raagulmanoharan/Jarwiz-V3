/**
 * Jarwiz thin agent server.
 *
 *   GET  /api/health             → { ok: true }
 *   POST /api/link/preview       → LinkPreview (server-side fetch, SSRF-guarded)
 *   POST /api/agents/:id/run     → SSE stream of typed AgentEvents
 *
 * Secrets (ANTHROPIC_API_KEY) live only here — the client never sees a key.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';
import { isAgentId } from '@jarwiz/shared';
import type { AgentEvent } from '@jarwiz/shared';
import { buildLinkPreview, SsrfError } from './linkPreview.js';
import { streamAgentRun } from './agentRun.js';
import { parseRunRequest, RunRequestError } from './agents/request.js';

// Load apps/server/.env when present (no-op otherwise).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  /* .env is optional */
}

const app = new Hono();
app.use(logger());

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/link/preview', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { "url": string }' }, 400);
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.trim() === '') {
    return c.json({ error: 'Expected a JSON body: { "url": string }' }, 400);
  }

  try {
    const preview = await buildLinkPreview(url.trim());
    return c.json(preview);
  } catch (error) {
    if (error instanceof SsrfError) {
      return c.json({ error: error.message }, 400);
    }
    const message = error instanceof Error ? error.message : 'Preview failed';
    return c.json({ error: `Could not fetch a preview: ${message}` }, 502);
  }
});

app.post('/api/agents/:agentId/run', async (c) => {
  const agentId = c.req.param('agentId');
  if (!isAgentId(agentId)) {
    return c.json(
      { error: `Unknown agent "${agentId}". Expected one of: researcher, summarizer, brainstormer, writer.` },
      404,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { source, placement, selection? }' }, 400);
  }

  let request;
  try {
    request = parseRunRequest(body);
  } catch (error) {
    const message = error instanceof RunRequestError ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }

  // streamSSE frames every event as `data: {json}\n\n`.
  return streamSSE(c, async (stream) => {
    const send = (event: AgentEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamAgentRun(agentId, request, signal)) {
        await send(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent run failed';
      await send({ type: 'error', message });
    }
  });
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[jarwiz/server] listening on http://localhost:${info.port}`);
});
