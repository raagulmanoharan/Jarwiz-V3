# Jarwiz — Architecture (v1)

Companion to [VISION.md](./VISION.md). This document records the locked
decisions, the system design, and the milestone plan.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Deployment shape | **Client + thin server** | Prove the magic interaction first. Client is local-first (boards in IndexedDB); the thin Node server holds API keys, fetches real page content (no CORS), and streams agent runs. Clean seam to add auth/sync later. |
| Canvas | **tldraw SDK** | Production-grade pan/zoom/select/arrows + fully custom React shapes. Months of canvas-feel engineering for free; multiplayer-ready when we want it. Watermark acceptable until licensed. |
| LLM provider | **Claude (Anthropic)** | Strongest multi-step agentic behavior and tool use — exactly what the agent crew does. |
| Agent UX | **Hybrid** | Summoned agents + proactive one-tap *offers*. Proactive output never lands without consent. |
| v1 agents | Researcher, Summarizer, Brainstormer, Writer | Fewer, deeper. Covers the golden path end to end. |
| Presence | **Full** (cursors, streaming cards, status, dock) | This is the differentiator; see VISION.md. |

## System overview

```
┌────────────────────────────  Browser  ────────────────────────────┐
│  apps/web (Vite + React + tldraw)                                 │
│                                                                   │
│  ┌─ Canvas layer ────────────┐   ┌─ Agent presence layer ──────┐  │
│  │ tldraw editor             │   │ AgentDock (who's active)    │  │
│  │ custom shapes:            │   │ AgentCursor overlay         │  │
│  │  link / youtube / image / │   │ SuggestionChip (offers)     │  │
│  │  pdf / note / doc         │◄──┤ stream → shape updates      │  │
│  │ arrows = provenance edges │   └──────────▲──────────────────┘  │
│  │ persistence: IndexedDB    │              │ SSE (AgentEvent)    │
│  └───────────────────────────┘              │                     │
└─────────────────────────────────────────────┼─────────────────────┘
                                              │ /api (Vite proxy in dev)
┌─────────────────────────────────────────────┼─────────────────────┐
│  apps/server (Node + TS)                    │                     │
│   POST /api/link/preview   ── server-side fetch + metadata        │
│   POST /api/agents/:id/run ── agent loop ──► SSE stream           │
│                                  │                                │
│   Anthropic API (key server-side only)                            │
│    • claude-opus-4-8 + adaptive thinking + streaming (agent work) │
│    • server-side web_search / web_fetch tools (Researcher)        │
│    • claude-haiku-4-5 (cheap metadata enrichment only)            │
└───────────────────────────────────────────────────────────────────┘
```

Monorepo (npm workspaces):

```
apps/web        canvas app
apps/server     thin agent server
packages/shared agent wire protocol + agent registry (single source of truth)
docs/           VISION.md, ARCHITECTURE.md
```

## The agent runtime

### Core idea: the canvas is the agent's hands

Each agent run is a server-side Anthropic tool-use loop. The agent's tools
are **canvas actions**, not text replies:

- `begin_card(kind, x, y, title?)` / `finish_card(cardId)` — open a streaming
  doc/note card; text the model emits between them streams to the canvas as
  `card.delta` events (the `write_to_card` design was rejected — streaming tool
  *input* can't be relayed live; see runtime.ts's header)
- `create_link_card(url, …)` / `create_note(text, …)` / `create_table(columns,
  rows, …)` — place complete artifacts
- `connect_cards(fromId, toId, label?)` — draw a provenance edge
- plus per-agent capabilities: Researcher additionally gets the Anthropic
  **server-side `web_search_20260209` / `web_fetch_20260209` tools**, so
  search runs on Anthropic infra with citations and no scraping code on
  our side.

The server executes a canvas tool by **emitting an `AgentEvent` over SSE**;
the client applies it to the tldraw store (creating shapes, streaming text
deltas into them, drawing arrows) and animates the agent cursor to wherever
the event lands. The model literally manipulates the board, and presence
falls out of the protocol for free.

### Wire protocol (`packages/shared`)

```ts
type AgentEvent =
  | { type: 'status';      message: string }                      // dock + chip text
  | { type: 'cursor';      x: number; y: number }                 // cursor target
  | { type: 'card.create'; cardId: string; kind: CardKind;
      x: number; y: number; title?: string }
  | { type: 'card.delta';  cardId: string; textDelta: string }    // streaming text
  | { type: 'card.done';   cardId: string }
  | { type: 'edge.create'; fromCardId: string; toCardId: string; label?: string }
  | { type: 'done' }
  | { type: 'error';       message: string };
```

The run request carries **board context**: the selected shapes (serialized
compactly — kind, title, text, position), nearby shapes, and the free space
the client computed for placement. Agents decide *what* to make; the
protocol keeps *where* sane.

### Anthropic usage rules

- **Models.** `claude-opus-4-8` for all agent reasoning, with
  `thinking: { type: "adaptive" }` and streaming (always — runs are long).
  `claude-haiku-4-5` only for micro-tasks (link metadata cleanup). No
  sampling params (`temperature` etc. are removed on Opus 4.8).
- **Loop.** Manual agentic loop (not the SDK tool runner): we need to
  interleave streamed text deltas, tool execution (= SSE emission), and
  cancellation. Cap iterations per run; treat `pause_turn` by re-sending.
- **Prompt caching.** Per-agent system prompts are static (frozen strings,
  `cache_control` on the last system block); volatile board context goes in
  the user turn.
- **Cost controls.** Per-run `max_tokens` ceilings, iteration caps, and a
  visible per-run summary later. Proactive *offers* cost ~0 (heuristics —
  e.g. "is YouTube URL" — not model calls) until accepted.
- **Errors.** Typed SDK exceptions; refusal/overload surface as honest
  `status`/`error` events on the board, never silent failures.

### Per-agent design

| Agent | Model calls | Canvas tools | Notes |
|---|---|---|---|
| Researcher | Opus 4.8 + server-side web_search/web_fetch | create_card(link), connect_cards | Emits one link card per vetted source; status reflects actual fetches |
| Summarizer | Opus 4.8 (web_fetch for articles; YouTube via fetched transcript/metadata) | create_card(note/doc), write_to_card, connect_cards | Triggered mostly by accepted offers |
| Brainstormer | Opus 4.8 | create_card(note) ×N, connect_cards | Fans sticky notes around the seed; each note one idea |
| Writer | Opus 4.8, high effort | create_card(doc), write_to_card, connect_cards | Long streaming output into one document card; edges to every input card |

### Proactive offers (the cheap half of hybrid)

Client-side heuristics watch ingestion: URL kind, file type, cluster size.
When one fires, a `SuggestionChip` renders next to the new card in the
relevant agent's color. Accepting starts a normal `/run`. No model tokens
are spent on offering.

## Canvas layer

- **Shapes.** Custom tldraw `ShapeUtil`s: `link-card`, `youtube-card`,
  `image-card`, `pdf-card`, `note-card` (sticky), `doc-card` (markdown
  document, editable). All are first-class tldraw shapes: selectable,
  movable, arrow-bindable, undo-able.
- **Edges.** tldraw arrows with bindings = provenance. Agent-created edges
  carry the agent's color.
- **Persistence.** `persistenceKey` → IndexedDB, automatic. Board export/
  import as a JSON snapshot is the cheap insurance policy.
- **Presence overlay.** Agent cursors are rendered in canvas space (so they
  pan/zoom with the board) and tween toward the latest `cursor` event.
  Status chips anchor to the dock and to the active card.

## Server

- Node + TypeScript. Endpoints: `/api/health`, `/api/link/preview`,
  `/api/agents/:id/run` (SSE).
- **Link preview** fetches pages server-side (timeout, redirect cap, UA),
  parses title/description/og:image/favicon/theme-color, optional Haiku
  cleanup, **SSRF-guarded** (http(s) only; private/loopback/link-local IP
  ranges rejected).
- Secrets live only in server env (`ANTHROPIC_API_KEY`). The client never
  sees a key — the prototype's key-in-browser flaw is structurally gone.

## Milestones

| # | Scope | Exit criterion |
|---|---|---|
| **M0 — Foundation** | Monorepo, tldraw canvas in Jarwiz skin, card shapes, drop/paste ingestion via server link-preview, agent dock (visual), SSE protocol stub | Board feels great; prototype parity surpassed on a real infinite canvas |
| **M1 — First live agent** | Agent runtime (loop + SSE + presence overlay), **Summarizer** end-to-end incl. its proactive offer | Drop a YouTube link → tap the offer → watch the summary stream in, connected |
| **M2 — The crew** | Researcher (web_search) + Brainstormer; multi-select summoning | Steps 1–4 of the golden path work |
| **M3 — Zero to 100** | Writer + doc card editing + polish pass (motion, empty states, cost/status honesty) | Full golden-path scenario, demo-able |

## Risks & mitigations

- **tldraw API churn** → pin the version; custom shapes follow current docs,
  not memory.
- **YouTube transcripts** are not reliably fetchable → Summarizer degrades
  to metadata + description + (when available) transcript; honest status.
- **Agent placement quality** (overlapping cards) → client computes free
  space and sends placement hints; agents place relative to hints.
- **Runaway cost** → iteration caps, token ceilings, offers are heuristic.
- **Sandbox/network limits in CI** → build must pass without network at
  runtime; agent features no-op gracefully without `ANTHROPIC_API_KEY`.
