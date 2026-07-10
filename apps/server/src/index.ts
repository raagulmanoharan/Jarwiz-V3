/**
 * Jarwiz thin agent server.
 *
 *   GET  /api/health             → { ok: true }
 *   GET  /api/capabilities       → { live } (real key vs scripted demo)
 *   POST /api/link/preview       → LinkPreview (server-side fetch, SSRF-guarded)
 *   POST /api/agents/:id/run     → SSE stream of typed AgentEvents
 *   POST /api/autopilot          → SSE stream of AutopilotEvents (Tab-to-continue)
 *
 * Keys: the server's own ANTHROPIC_API_KEY (env, local dev) or a visitor's
 * BYOK key sent per-request as `x-anthropic-key` (hosted trial — see model.ts).
 * The client never sees the server's key; visitor keys are never stored.
 */

import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
import { buildLinkPreview, fetchYouTubeText, SsrfError } from './linkPreview.js';
import { ingestVideo, videoTools } from './video.js';
import { parseSheetGrid } from './sheets.js';
import { discoverResources } from './discover.js';
import { reviewBoard } from './notice.js';
import { streamCompose } from './compose.js';
import { annotateBoard } from './annotate.js';
import { getMachine } from './machines.js';
import { streamMachineBoard } from './machineBoard.js';
import { getAsset, isValidAssetId, MAX_ASSET_BYTES, putAsset, sniffMime } from './assets.js';
import { cachedImageUrl } from './imageCache.js';
import { classifyRefineIntent, proposeSeedPrompts, streamAsk, suggestShape } from './ask.js';
import type { AnalyzeCard, AnalyzeMode, AnalyzeRequest, AskRequest, ClusterRequest, DiagramRequest, ReviseRequest } from '@jarwiz/shared';
import { streamAgentRun } from './agentRun.js';
import { streamAutopilot, streamTableAutopilot } from './autopilot.js';
import { generateDiagram } from './diagram.js';
import { generateClusters } from './cluster.js';
import { streamAnalysis } from './analyze.js';
import { sidecarAvailable } from './sidecar.js';
import { proposeClusterSuggestions, proposeSuggestions } from './suggest.js';
import type { ClusterSuggestRequest, SuggestRequest } from '@jarwiz/shared';
import { handleSyncSocket } from './sync.js';
import { parseRunRequest, RunRequestError } from './agents/request.js';
import { hasModelKey, runWithRequestKey, sanitizeRequestKey } from './model.js';

// Load apps/server/.env when present (no-op otherwise).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  /* .env is optional */
}

const app = new Hono();
app.use(logger());

/**
 * Cross-origin + BYOK. The hosted client is a static site (GitHub Pages) on a
 * different origin than this server, and visitors bring their own Anthropic
 * key as an `x-anthropic-key` header (see model.ts). JARWIZ_ALLOWED_ORIGINS
 * (comma-separated) pins CORS to known frontends; unset, any origin may call —
 * fine for a BYOK server that holds no key of its own.
 */
const allowedOrigins = (process.env.JARWIZ_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  '/api/*',
  cors({
    origin: (origin) =>
      allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? origin : '',
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-anthropic-key'],
    maxAge: 86400,
  }),
);
app.use('/api/*', (c, next) =>
  runWithRequestKey(sanitizeRequestKey(c.req.header('x-anthropic-key')), () => next()),
);

app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * Asset blob storage. The client first asks for an upload URL (presign), then
 * uploads bytes directly to it — the Miro/Figma pattern. In dev the upload URL
 * is our own PUT endpoint; swapping to S3/R2 means returning a signed bucket URL
 * here and nothing else changes. The card stores only the GET URL, keeping
 * large binaries out of the synced document.
 */
app.post('/api/assets/presign', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prefix?: unknown };
  const prefix =
    typeof body.prefix === 'string' && /^[a-z]{1,12}$/.test(body.prefix) ? body.prefix : 'asset';
  const assetId = `${prefix}_${randomUUID()}`;
  return c.json({ assetId, uploadUrl: `/api/assets/${assetId}`, getUrl: `/api/assets/${assetId}`, method: 'PUT' });
});

app.put('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidAssetId(id)) return c.json({ error: 'invalid asset id' }, 400);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty body' }, 400);
  if (body.byteLength > MAX_ASSET_BYTES) return c.json({ error: 'asset too large' }, 413);
  await putAsset(id, Buffer.from(body));
  return c.json({ ok: true, url: `/api/assets/${id}` });
});

app.get('/api/assets/:id', async (c) => {
  const buf = await getAsset(c.req.param('id'));
  if (!buf) return c.notFound();
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': sniffMime(buf), 'Cache-Control': 'private, max-age=3600' },
  });
});

/**
 * Cache-proxy for a web image cited by a generated card (`Image("https://…")`
 * or `![alt](https://…)`). The browser hotlinking these directly is fragile —
 * hotlink protection, CORS, expired URLs — so the server fetches the image
 * once (SSRF-guarded, size/type-validated in imageCache) into the asset store
 * and redirects to the same-origin copy. Any failure is a plain 404: the rich
 * card's Image component hides itself rather than showing a broken frame.
 */
app.get('/api/image', async (c) => {
  const src = c.req.query('src') ?? '';
  if (!/^https?:\/\//i.test(src)) return c.json({ error: 'src must be an http(s) URL' }, 400);
  const cached = await cachedImageUrl(src);
  if (!cached) return c.json({ error: 'image unavailable' }, 404);
  return c.redirect(cached, 302);
});

/** Parsed grid for a sheet card — the capped rows/sheets it renders. */
app.get('/api/sheet/:id/grid', async (c) => {
  const id = c.req.param('id');
  if (!isValidAssetId(id)) return c.json({ error: 'invalid asset id' }, 400);
  const grid = await parseSheetGrid(id);
  if (!grid) return c.json({ error: 'could not parse spreadsheet' }, 422);
  return c.json(grid);
});

/**
 * What this server can do right now. Output is "live" (real Claude) when an
 * ANTHROPIC_API_KEY is set OR the Claude CLI sidecar is available; otherwise the
 * runtime serves a scripted mock and the client shows an honest "Demo mode"
 * badge. `mode` distinguishes the three so the UI can be precise.
 */
app.get('/api/capabilities', (c) => {
  // Per-request: a visitor's x-anthropic-key header (BYOK) counts as 'api',
  // so the client's probe answers for THIS visitor, not the server at large.
  const mode = hasModelKey() ? 'api' : sidecarAvailable() ? 'sidecar' : 'demo';
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

/** Video ingest for a video card — captions + WATCHED frames when the host
 *  has yt-dlp/ffmpeg (video.ts), caption-scrape fallback otherwise, honest
 *  metadata-only state when nothing is readable (drives the card's badge).
 *  Accepts YouTube URLs and (dev/tests) direct http(s) media URLs. */
app.post('/api/youtube/text', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected a JSON body: { "url": string }' }, 400);
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    return c.json({ error: 'Expected a video URL' }, 400);
  }
  const trimmed = url.trim().slice(0, 2000);
  if (videoTools().ytdlp) {
    try {
      const result = await ingestVideo(trimmed, true);
      return c.json(result);
    } catch {
      /* fall through to the scrape (yt-dlp blocked ≠ page blocked) */
    }
  }
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
    return c.json({ error: 'Video unreachable' }, 502);
  }
  try {
    const result = await fetchYouTubeText(trimmed, 16_000);
    return c.json({ ...result, frames: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcript fetch failed';
    return c.json({ error: message }, 502);
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
    // Nearby-board grounding — sanitized like everything else: capped card
    // count, capped text, relation whitelisted (autopilot.ts feeds it straight
    // into the prompt).
    boardContext: Array.isArray(raw.boardContext)
      ? raw.boardContext.slice(0, 30).map((card) => ({
          kind: typeof card?.kind === 'string' ? card.kind.slice(0, 40) : 'card',
          title: typeof card?.title === 'string' ? card.title.slice(0, 200) : undefined,
          text: typeof card?.text === 'string' ? card.text.slice(0, 500) : '',
          relation:
            card?.relation === 'connected' || card?.relation === 'selected' || card?.relation === 'nearby'
              ? card.relation
              : 'board',
        }))
      : undefined,
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

/** Edit-vs-new intent: with a single card selected and no "/" mode, does the
 *  typed instruction refine THAT card in place, or make a new doc from it? The
 *  composer calls this before dispatching. Fails safe to "new". */
app.post('/api/intent', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ intent: 'new' });
  }
  const b = body as { prompt?: unknown; cardType?: unknown };
  const prompt = typeof b.prompt === 'string' ? b.prompt : '';
  const cardType = typeof b.cardType === 'string' ? b.cardType : '';
  if (!prompt.trim()) return c.json({ intent: 'new' });
  const ac = new AbortController();
  c.req.raw.signal?.addEventListener('abort', () => ac.abort());
  try {
    const intent = await classifyRefineIntent(prompt, cardType, ac.signal);
    return c.json({ intent });
  } catch {
    return c.json({ intent: 'new' });
  }
});

/** Response-shape suggestion: as the user types a from-scratch prompt, guess the
 *  best "/" mode so the composer can pre-pin the chip (they can still change it).
 *  Returns { shape } as one of the mode names, or { shape: null } for doc/none. */
app.post('/api/suggest-shape', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ shape: null });
  }
  const prompt = typeof (body as { prompt?: unknown }).prompt === 'string' ? (body as { prompt: string }).prompt : '';
  if (!prompt.trim()) return c.json({ shape: null });
  const ac = new AbortController();
  c.req.raw.signal?.addEventListener('abort', () => ac.abort());
  try {
    const shape = await suggestShape(prompt, ac.signal);
    return c.json({ shape });
  } catch {
    return c.json({ shape: null });
  }
});

/** The Ask pipeline — a prompt against source cards → one auto-shaped answer. */
app.post('/api/ask', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { prompt, sources[] }' }, 400);
  }
  const raw = body as Partial<AskRequest>;
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
    return c.json({ error: 'prompt is required' }, 400);
  }
  const SHAPES = ['doc', 'table', 'list', 'diagram', 'affinity', 'prototype', 'dashboard'] as const;
  const request: AskRequest = {
    prompt: raw.prompt.trim().slice(0, 2000),
    sources: Array.isArray(raw.sources)
      ? raw.sources.slice(0, 8).map((s) => ({
          kind: s?.kind ?? 'note',
          assetId: typeof s?.assetId === 'string' ? s.assetId : undefined,
          title: typeof s?.title === 'string' ? s.title.slice(0, 200) : undefined,
          text: typeof s?.text === 'string' ? s.text.slice(0, 8000) : undefined,
          // Image data URL for vision sources (validated/parsed in ask.ts).
          dataUrl:
            typeof s?.dataUrl === 'string' && s.dataUrl.startsWith('data:image/') ? s.dataUrl : undefined,
          // Web-page source URL — link citations point at it. http(s) only.
          url: typeof s?.url === 'string' && /^https?:\/\//i.test(s.url) ? s.url.slice(0, 2000) : undefined,
          // Watched-video frames: validated ids only, hard-capped per source.
          frameAssetIds: Array.isArray(s?.frameAssetIds)
            ? s.frameAssetIds.filter((f): f is string => typeof f === 'string' && isValidAssetId(f)).slice(0, 12)
            : undefined,
        }))
      : [],
    // The shape of the card being refined in place — keeps a same-type tweak on
    // the same format. Whitelisted so a bad value can't steer the router.
    currentShape: SHAPES.includes(raw.currentShape as (typeof SHAPES)[number])
      ? raw.currentShape
      : undefined,
    // Explicit response shape from the prompt bar's "/" mode selector —
    // whitelisted like currentShape; wins over the prompt-based router.
    shape: SHAPES.includes(raw.shape as (typeof SHAPES)[number]) ? raw.shape : undefined,
    // Set once the user answered a clarifying question — skips re-triage.
    skipClarify: raw.skipClarify === true,
    // Deep research pass — bigger web budget, dossier answer. Boolean-gated.
    deep: raw.deep === true,
    // Thinking Machine skill id — runs that machine's server-side skill instead
    // of the router (the `prompt` is the subject typed into the block).
    machineId: typeof raw.machineId === 'string' ? raw.machineId.slice(0, 60) : undefined,
  };

  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamAsk(request, signal)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ask failed';
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message }) });
    }
  });
});

app.post('/api/diagram', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { prompt, sources? }' }, 400);
  }
  const raw = body as Partial<DiagramRequest>;
  if (typeof raw.prompt !== 'string' && !Array.isArray(raw.sources)) {
    return c.json({ error: 'prompt or sources is required' }, 400);
  }
  const request: DiagramRequest = {
    prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 2000) : '',
    sources: Array.isArray(raw.sources)
      ? raw.sources.slice(0, 8).map((s) => ({
          kind: s?.kind ?? 'note',
          title: typeof s?.title === 'string' ? s.title.slice(0, 200) : undefined,
          text: typeof s?.text === 'string' ? s.text.slice(0, 8000) : undefined,
        }))
      : undefined,
  };

  try {
    const spec = await generateDiagram(request, c.req.raw.signal);
    return c.json(spec);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diagram failed';
    return c.json({ error: message }, 500);
  }
});

app.post('/api/cluster', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { items: string[] }' }, 400);
  }
  const raw = body as Partial<ClusterRequest>;
  if (!Array.isArray(raw.items) || raw.items.some((i) => typeof i !== 'string')) {
    return c.json({ error: 'Expected { items: string[] }' }, 400);
  }
  const request: ClusterRequest = { items: raw.items.slice(0, 30).map((s) => s.slice(0, 1000)) };

  try {
    const result = await generateClusters(request, c.req.raw.signal);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cluster failed';
    return c.json({ error: message }, 500);
  }
});

app.post('/api/analyze', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { mode, cards[] }' }, 400);
  }
  const raw = body as Partial<AnalyzeRequest>;
  const MODES: AnalyzeMode[] = ['tensions', 'gaps', 'critique'];
  if (!MODES.includes(raw.mode as AnalyzeMode) || !Array.isArray(raw.cards)) {
    return c.json({ error: 'Expected { mode: tensions|gaps|critique, cards: [] }' }, 400);
  }
  const request: AnalyzeRequest = {
    mode: raw.mode as AnalyzeMode,
    cards: raw.cards.slice(0, 30).map((card) => ({
      kind: typeof card?.kind === 'string' ? card.kind : 'note',
      title: typeof card?.title === 'string' ? card.title.slice(0, 200) : undefined,
      text: typeof card?.text === 'string' ? card.text.slice(0, 2000) : '',
      assetId: typeof card?.assetId === 'string' ? card.assetId : undefined,
    })),
  };

  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    try {
      for await (const event of streamAnalysis(request, signal)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyze failed';
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message }) });
    }
  });
});

/** Ultra Think — grounded discovery of real related resources for the board. */
app.post('/api/discover', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { cards[] }' }, 400);
  }
  const raw = body as { cards?: unknown; existingUrls?: unknown };
  if (!Array.isArray(raw.cards)) return c.json({ error: 'cards must be an array' }, 400);
  const cards = raw.cards.slice(0, 24).map((card) => ({
    kind: typeof (card as AnalyzeCard)?.kind === 'string' ? (card as AnalyzeCard).kind : 'note',
    title: typeof (card as AnalyzeCard)?.title === 'string' ? (card as AnalyzeCard).title!.slice(0, 200) : undefined,
    text: typeof (card as AnalyzeCard)?.text === 'string' ? (card as AnalyzeCard).text.slice(0, 2000) : '',
    assetId: typeof (card as AnalyzeCard)?.assetId === 'string' ? (card as AnalyzeCard).assetId : undefined,
  }));
  const existingUrls = Array.isArray(raw.existingUrls)
    ? raw.existingUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 60)
    : [];
  try {
    const resources = await discoverResources({ cards, existingUrls }, c.req.raw.signal);
    return c.json({ resources });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    return c.json({ resources: [], error: message }, 502);
  }
});

/** Notice — proactive comments Jarwiz pins to cards after the board settles. */
app.post('/api/notice', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { cards[] }' }, 400);
  }
  const raw = body as { cards?: unknown; today?: unknown };
  if (!Array.isArray(raw.cards)) return c.json({ error: 'cards must be an array' }, 400);
  const cards = raw.cards
    .filter((card) => typeof (card as { id?: unknown })?.id === 'string')
    .slice(0, 24)
    .map((card) => ({
      id: String((card as { id: string }).id),
      kind: typeof (card as AnalyzeCard)?.kind === 'string' ? (card as AnalyzeCard).kind : 'note',
      title: typeof (card as AnalyzeCard)?.title === 'string' ? (card as AnalyzeCard).title!.slice(0, 200) : undefined,
      text: typeof (card as AnalyzeCard)?.text === 'string' ? (card as AnalyzeCard).text.slice(0, 2000) : '',
      assetId: typeof (card as AnalyzeCard)?.assetId === 'string' ? (card as AnalyzeCard).assetId : undefined,
    }));
  const today = typeof raw.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.today) ? raw.today : undefined;
  try {
    const comments = await reviewBoard({ cards, today }, c.req.raw.signal);
    return c.json({ comments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Review failed';
    return c.json({ comments: [], error: message }, 502);
  }
});

/** Annotate — Stickies mode: Jarwiz drops a sticky note next to each relevant card. */
app.post('/api/annotate', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { prompt, cards[] }' }, 400);
  }
  const raw = body as { prompt?: unknown; cards?: unknown };
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.slice(0, 500) : '';
  const cards = Array.isArray(raw.cards)
    ? raw.cards
        .filter((card) => typeof (card as { id?: unknown })?.id === 'string')
        .slice(0, 24)
        .map((card) => ({
          id: String((card as { id: string }).id),
          kind: typeof (card as AnalyzeCard)?.kind === 'string' ? (card as AnalyzeCard).kind : 'note',
          title: typeof (card as AnalyzeCard)?.title === 'string' ? (card as AnalyzeCard).title!.slice(0, 200) : undefined,
          text: typeof (card as AnalyzeCard)?.text === 'string' ? (card as AnalyzeCard).text.slice(0, 2000) : '',
          assetId: typeof (card as AnalyzeCard)?.assetId === 'string' ? (card as AnalyzeCard).assetId : undefined,
        }))
    : [];
  try {
    const notes = await annotateBoard({ prompt, cards }, c.req.raw.signal);
    return c.json({ notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Annotate failed';
    return c.json({ notes: [], error: message }, 502);
  }
});

/** Compose — the board fan-out: one intent → many laid-out cards (streamed). */
app.post('/api/compose', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { board[] }' }, 400);
  }
  const raw = body as { board?: unknown; intent?: unknown };
  const board = Array.isArray(raw.board)
    ? raw.board.slice(0, 24).map((card) => ({
        kind: typeof (card as AnalyzeCard)?.kind === 'string' ? (card as AnalyzeCard).kind : 'note',
        title: typeof (card as AnalyzeCard)?.title === 'string' ? (card as AnalyzeCard).title!.slice(0, 200) : undefined,
        text: typeof (card as AnalyzeCard)?.text === 'string' ? (card as AnalyzeCard).text.slice(0, 2000) : '',
        assetId: typeof (card as AnalyzeCard)?.assetId === 'string' ? (card as AnalyzeCard).assetId : undefined,
      }))
    : [];
  const intent = typeof raw.intent === 'string' ? raw.intent.slice(0, 400) : undefined;
  // The debrief recipe path: a fixed three-card plan over the given transcript.
  const rawRecipe = (raw as { recipe?: unknown }).recipe;
  const recipe = rawRecipe === 'debrief' ? ('debrief' as const) : undefined;
  const rawTranscript = (raw as { transcript?: { title?: unknown; text?: unknown } }).transcript;
  const transcript =
    recipe && typeof rawTranscript?.text === 'string' && rawTranscript.text.trim()
      ? {
          title: typeof rawTranscript.title === 'string' ? rawTranscript.title.slice(0, 120) : undefined,
          text: rawTranscript.text.slice(0, 20_000),
        }
      : undefined;
  const machine = getMachine(typeof (raw as { machineId?: unknown }).machineId === 'string' ? (raw as { machineId: string }).machineId : undefined);
  const options = Array.isArray((raw as { options?: unknown }).options)
    ? ((raw as { options: unknown[] }).options).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 12)
    : [];
  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    try {
      // A board Thinking Machine fans its analysis into a framework of cards; the
      // generic planner handles a free-form "plan my …" fan-out.
      const events =
        machine && machine.output === 'board'
          ? streamMachineBoard(machine, intent ?? '', signal, options)
          : streamCompose({ board, intent, recipe, transcript }, signal);
      for await (const event of events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Compose failed';
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message }) });
    }
  });
});

/** Predefined, content-aware Ask prompts for a dropped PDF (the blank-slate on-ramp). */
app.post('/api/seed-prompts', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected JSON: { assetId } or { text, title? }' }, 400);
  }
  const raw = body as { assetId?: unknown; text?: unknown; title?: unknown };
  const hasAsset = typeof raw.assetId === 'string' && isValidAssetId(raw.assetId);
  const hasText = typeof raw.text === 'string' && raw.text.trim().length > 0;
  if (!hasAsset && !hasText) {
    return c.json({ error: 'assetId or text required' }, 400);
  }
  const source = hasAsset
    ? { assetId: raw.assetId as string }
    : {
        text: (raw.text as string).slice(0, 12_000),
        title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : undefined,
      };
  try {
    const prompts = await proposeSeedPrompts(source, c.req.raw.signal);
    return c.json({ prompts });
  } catch (error) {
    return c.json({ prompts: [], error: error instanceof Error ? error.message : 'failed' });
  }
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
// Parked behind JARWIZ_ENABLE_SYNC pending security hardening — an origin
// check, room GC, and client/server schema lockstep are prerequisites to
// re-enabling it by default (docs/AUDIT.md P0.4). sync.ts stays intact so
// flipping the env var brings it back for local testing.
if (process.env.JARWIZ_ENABLE_SYNC) {
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
} else {
  console.log(
    '[jarwiz/server] multiplayer sync is parked pending security hardening (set JARWIZ_ENABLE_SYNC=1 to enable)',
  );
  (server as HttpServer).on('upgrade', (_req, socket) => {
    socket.destroy();
  });
}
