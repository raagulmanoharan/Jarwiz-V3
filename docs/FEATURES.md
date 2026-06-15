# Jarwiz — Feature Inventory

What's built and **verified working** today. Every claim here is backed by an
automated check in `scripts/eval-server.mjs` (backend, 10 checks) or
`scripts/eval-ui.mjs` (browser, 8 checks). Last run: **server 10/10, UI 8/8**.

Run them yourself (with `npm run dev` up, or a `vite preview` build for the UI
suite):

```bash
node scripts/eval-server.mjs   # backend endpoints + response shapes
node scripts/eval-ui.mjs       # real-browser user flows (Playwright)
```

---

## The canvas

- **Infinite tldraw 5.1 board** with seven custom card shapes — note, doc,
  table, link, image, PDF, YouTube (`apps/web/src/shapes/*`). Each is a real
  `ShapeUtil` with its own geometry and editing surface.
  *Verified:* `Local board mounts + roster`.
- **Ingestion by drop/paste** — URLs, files (PDF/image), and text become the
  right card type automatically (`apps/web/src/ingest`).
  *Verified:* `Drop → suggestion pills` (a dropped URL becomes a link card).

## Live agents

Four agents, each a system-prompt + turn-builder over a shared runtime
(`packages/shared/src/agents.ts`, `apps/server/src/agents/*`):

| Agent | Produces | Verified by |
|---|---|---|
| **Summarizer** | a doc card "gist" (streamed) | `POST /api/agents/summarizer/run` (doc + deltas) |
| **Writer** | a synthesis doc — or a **comparison table** when the brief reads as a comparison | `Writer response-shape routing` (comparison → table) |
| **Brainstormer** | a fan of sticky notes | shared runtime path |
| **Researcher** | scripted, citable sources (honest mock; no fabricated URLs) | — |

- **Streaming to the canvas** — agents emit `card.create → card.delta… →
  card.done → edge.create`, so cards fill in live and draw provenance edges
  back to their inputs.
- **Real output without an API key** — a Claude CLI **sidecar** powers genuine
  generation in demo mode; the same event shapes drive a no-dependency mock.
  *Verified:* `GET /api/capabilities` reports `mode=sidecar, live=true`.

## Autopilot

- **Tab-to-continue on docs** — press Tab in a doc card and the prose extends
  itself. *Verified:* `Autopilot extends a doc` (real browser, text grows) and
  `POST /api/autopilot` (15 deltas).
- **Table cell-fill** — Tab in a table with empty cells fills them in.
  *Verified:* `Table cell-fill` (browser) and `POST /api/autopilot/table`.

## Proactive suggestions (content-aware)

- **Per-artifact pills** — a freshly dropped card gets tailored agent-action
  pills based on its actual content (PDF text via `pdf-parse`, link text via
  `cheerio`, YouTube via oEmbed).
  *Verified:* `Drop → suggestion pills`, `POST /api/suggest (PDF)` returns
  tailored, agent-attributed actions.
- **Cluster pills** — related drops are detected and offered cross-cutting
  actions ("Across N"). Per-artifact and cluster pills **coexist**, and a new
  related drop **joins** an existing cluster (gets both its own pills and the
  cluster's). *Verified:* `Auto-cluster related drops`,
  `POST /api/cluster-suggest`.

## Collaboration

- **Multiplayer sync** — `?room=<id>` opens a shared board over WebSockets
  (`@tldraw/sync` + `TLSocketRoom`); edits propagate between clients.
  *Verified:* `Multiplayer sync (2 clients)` — client B sees client A's shape;
  `WS /api/sync/:room` upgrade accepted.
- **@mentions** — type `@` in a card to summon an agent from the picker.
  *Verified:* `@mention picker` (all four agents listed).
- **Comment threads with agent replies** — comment on a card, tap an agent, and
  it replies in-thread. *Verified:* `Comment thread + agent reply`,
  `POST /api/comment`.
- **Summon surfaces** — contextual "Ask an agent" affordance and the ⌘K command
  palette.

## Platform / safety

- **SSRF-guarded link previews** (`POST /api/link/preview`).
- **Secrets server-side only**; the web app never holds keys.
- **Demo mode** badge when no live backend is configured.

---

## Test harness note (the "context destroyed" trap)

The UI suite drives a real browser. tldraw's `Editor` methods are chainable and
return the Editor, so `evaluate(() => editor.createShape(...))` makes Playwright
serialize a huge circular object — which fails *as* "Execution context was
destroyed, most likely because of a navigation," looking exactly like a sandbox
flake. The fix is structural: editor-mutating `evaluate` calls use a `{ … }`
body (returning `undefined` or a primitive), never the Editor. With that, even
two synced clients run deterministically. See the header of `scripts/eval-ui.mjs`.
