# Jarwiz

**Thinking made visual.** Jarwiz is an infinite canvas where live AI agents are your collaborators — think FigJam, but the other cursors on the board are a researcher, a summarizer, a brainstormer, and a writer. You spread ideas out as cards and primitives, and the agents work alongside you on the board itself: pulling sources, summarizing videos, fanning out sticky notes, clustering them into themes, drafting documents, building flowcharts — every artifact a card you can see, move, connect, and keep.

## Monorepo layout

```
apps/web         Canvas app — Vite + React + tldraw 5.1, custom card shapes, agent presence layer
apps/server      Thin agent server — link previews, SSE agent runs, holds API keys
packages/shared  @jarwiz/shared — the agent wire protocol and agent registry (single source of truth)
docs/            VISION, ARCHITECTURE, ROADMAP, DESIGN + the pivot specs
```

## Quickstart

Requires **Node ≥ 20** (developed on 22).

```sh
git clone https://github.com/raagulmanoharan/Jarwiz-V3.git
cd Jarwiz-V3
npm install
npm run dev
```

Open **http://localhost:5173**. The web app proxies `/api` to the server on
:3001 — `npm run dev` starts both together with HMR.

That's it — **the whole app works out of the box with no API key** (you'll see a
"Demo mode" badge; agents reply with high-quality scripted output so every flow
is demoable).

### Turning on live AI (optional)

For real Claude responses, pick **either**:

- **Claude Code CLI (no key needed).** If you have the `claude` CLI installed
  and signed in, the server uses it as a sidecar automatically — nothing to
  configure. The badge flips from "Demo mode" to live.
- **An API key.** Copy the env template and drop in a key:
  ```sh
  cp apps/server/.env.example apps/server/.env
  # edit apps/server/.env → ANTHROPIC_API_KEY=sk-ant-...
  ```

Check which mode you're in: `curl http://localhost:3001/api/capabilities`
→ `{"live":true,"mode":"sidecar"}` (or `"api"` / demo `{"live":false}`).

### Try it in 60 seconds

1. Answer "What are you working on?" (or skip) — drops you onto a board.
2. Drag out a few sticky notes (`n`) or a doc (`d`), or paste a link / drop a PDF.
3. Select 3+ stickies → **✦ Refine ▾ → Cluster & summarise** to watch them sort
   into named themes with a summary doc.
4. Select any card → use the bottom prompt bar's starter chips, or **Refine ▾ →
   Make a flowchart**. Watch the agent's cursor build it live on the board.

## Other scripts

```sh
npm run build       # build all workspaces
npm run typecheck   # tsc --noEmit across all workspaces
```

## Read the spec

Start at the docs index — **[docs/README.md](docs/README.md)** — which ties
together everything below:

- [docs/VISION.md](docs/VISION.md) — what Jarwiz is and why presence is the product
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, agent runtime, wire protocol
- [docs/DECISIONS.md](docs/DECISIONS.md) — the running decision log (what we chose and why)
- [docs/HISTORY.md](docs/HISTORY.md) — conversation / session history, milestone by milestone
- [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/BIG-ROCKS.md](docs/BIG-ROCKS.md) — the plan and the priorities
- [CLAUDE.md](CLAUDE.md) — working notes / conventions for the codebase

## Troubleshooting

- **Port already in use?** Web is 5173, server is 3001. Stop whatever's holding
  them, or set `PORT` in `apps/server/.env` (the Vite proxy expects 3001).
- **Fresh checkout typecheck errors referencing `@jarwiz/shared`?** Rebuild the
  shared package so `dist/` exists: `npm run build --workspace=packages/shared`.
- **PDF text/OCR:** the bundled `eng.traineddata` (Tesseract) ships in the repo,
  so dropped PDFs are read without any extra download.
