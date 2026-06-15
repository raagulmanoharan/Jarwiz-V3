/**
 * Jarwiz thin agent server.
 *
 *   GET  /api/health             → { ok: true }
 *   GET  /api/capabilities       → { live } (real key vs scripted demo)
 *   POST /api/link/preview       → LinkPreview (server-side fetch, SSRF-guarded)
 *   POST /api/agents/:id/run     → SSE stream of typed AgentEvents
 *   POST /api/autopilot          → SSE stream of AutopilotEvents (Tab-to-continue)
 *
 * Secrets (ANTHROPIC_API_KEY) live only here — the client never sees a key.
 */

import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';
import { isAgentId } from '@jarwiz/shared';
import type {
  AgentEvent,
  AutopilotEvent,
  AutopilotRequest,
  CommentReplyRequest,
  TableAutopilotEvent,
  TableAutopilotRequest,
} from '@jarwiz/shared';
import { buildLinkPreview, SsrfError } from './linkPreview.js';
import { streamAgentRun } from './agentRun.js';
import { streamAutopilot, streamTableAutopilot } from './autopilot.js';
import { streamComment } from './comment.js';
import { sidecarAvailable } from './sidecar.js';
import { proposeClusterSuggestions, proposeSuggestions } from './suggest.js';
import type { ClusterSuggestRequest, SuggestRequest } from '@jarwiz/shared';
import { handleSyncSocket } from './sync.js';
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

/**
 * What this server can do right now. Output is "live" (real Claude) when an
 * ANTHROPIC_API_KEY is set OR the Claude CLI sidecar is available; otherwise the
 * runtime serves a scripted mock and the client shows an honest "Demo mode"
 * badge. `mode` distinguishes the three so the UI can be precise.
 */
app.get('/api/capabilities', (c) => {
  const mode = process.env.ANTHROPIC_API_KEY?.trim()
    ? 'api'
    : sidecarAvailable()
      ? 'sidecar'
      : 'demo';
  return c.json({ live: mode !== 'demo', mode });
});

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

app.post('/api/autopilot', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { kind, text, title? }' }, 400);
  }

  const raw = body as Partial<AutopilotRequest>;
  if ((raw.kind !== 'doc' && raw.kind !== 'note') || typeof raw.text !== 'string') {
    return c.json({ error: 'Expected { kind: "doc" | "note", text: string, title?: string }' }, 400);
  }
  const request: AutopilotRequest = {
    kind: raw.kind,
    text: raw.text.slice(0, 8000),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : undefined,
  };

  return streamSSE(c, async (stream) => {
    const send = (event: AutopilotEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamAutopilot(request, signal)) {
        await send(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Autopilot failed';
      await send({ type: 'error', message });
    }
  });
});

app.post('/api/autopilot/table', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { columns, rows }' }, 400);
  }

  const raw = body as Partial<TableAutopilotRequest>;
  const okColumns = Array.isArray(raw.columns) && raw.columns.every((c) => typeof c === 'string');
  const okRows =
    Array.isArray(raw.rows) &&
    raw.rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === 'string'));
  if (!okColumns || !okRows) {
    return c.json({ error: 'Expected { columns: string[], rows: string[][] }' }, 400);
  }
  const request: TableAutopilotRequest = {
    columns: raw.columns!.slice(0, 8),
    rows: raw.rows!.slice(0, 24).map((r) => r.slice(0, 8)),
  };

  return streamSSE(c, async (stream) => {
    const send = (event: TableAutopilotEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamTableAutopilot(request, signal)) {
        await send(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Table autopilot failed';
      await send({ type: 'error', message });
    }
  });
});

app.post('/api/comment', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { agentId, cardKind, thread }' }, 400);
  }

  const raw = body as Partial<CommentReplyRequest>;
  if (
    typeof raw.agentId !== 'string' ||
    !isAgentId(raw.agentId) ||
    typeof raw.cardKind !== 'string' ||
    !Array.isArray(raw.thread)
  ) {
    return c.json({ error: 'Expected { agentId, cardKind, cardTitle?, cardText?, thread[] }' }, 400);
  }
  const request: CommentReplyRequest = {
    agentId: raw.agentId,
    cardKind: raw.cardKind,
    cardTitle: typeof raw.cardTitle === 'string' ? raw.cardTitle.slice(0, 200) : undefined,
    cardText: typeof raw.cardText === 'string' ? raw.cardText.slice(0, 4000) : undefined,
    cardUrl: typeof raw.cardUrl === 'string' ? raw.cardUrl.slice(0, 2000) : undefined,
    thread: raw.thread
      .slice(-20)
      .map((m) => ({ author: String(m?.author ?? 'you'), text: String(m?.text ?? '').slice(0, 1000) })),
  };

  return streamSSE(c, async (stream) => {
    const send = (event: AutopilotEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamComment(request, signal)) {
        await send(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reply failed';
      await send({ type: 'error', message });
    }
  });
});

app.post('/api/suggest', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { kind, url?, title?, pdfDataUrl? }' }, 400);
  }
  const raw = body as Partial<SuggestRequest>;
  if (raw.kind !== 'youtube' && raw.kind !== 'link' && raw.kind !== 'pdf') {
    return c.json({ error: 'kind must be one of: youtube, link, pdf' }, 400);
  }
  const request: SuggestRequest = {
    kind: raw.kind,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : undefined,
    pdfDataUrl: typeof raw.pdfDataUrl === 'string' ? raw.pdfDataUrl : undefined,
  };
  try {
    const suggestions = await proposeSuggestions(request, c.req.raw.signal);
    return c.json({ suggestions });
  } catch {
    return c.json({ suggestions: [] });
  }
});

app.post('/api/cluster-suggest', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { items, theme? }' }, 400);
  }
  const raw = body as Partial<ClusterSuggestRequest>;
  if (!Array.isArray(raw.items)) return c.json({ error: 'items must be an array' }, 400);
  const request: ClusterSuggestRequest = {
    items: raw.items
      .slice(0, 12)
      .map((i) => ({ kind: String(i?.kind ?? 'card'), title: String(i?.title ?? '').slice(0, 300) })),
    theme: typeof raw.theme === 'string' ? raw.theme.slice(0, 80) : undefined,
  };
  try {
    const suggestions = await proposeClusterSuggestions(request, c.req.raw.signal);
    return c.json({ suggestions });
  } catch {
    return c.json({ suggestions: [] });
  }
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[jarwiz/server] listening on http://localhost:${info.port}`);
});

// Multiplayer sync: upgrade ws://…/api/sync/:roomId into a tldraw sync session.
const wss = new WebSocketServer({ noServer: true });
(server as HttpServer).on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');
  const match = /^\/api\/sync\/(.+)$/.exec(pathname);
  if (!match) {
    socket.destroy();
    return;
  }
  const roomId = decodeURIComponent(match[1]!);
  const sessionId = searchParams.get('sessionId') ?? randomUUID();
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleSyncSocket(roomId, sessionId, ws);
  });
});
