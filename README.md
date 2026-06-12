# Jarwiz

**Thinking made visual.** Jarwiz is an infinite canvas where live AI agents are your collaborators — think FigJam, but the other cursors on the board are a researcher, a summarizer, a brainstormer, and a writer. You spread ideas out as cards, and the agents work alongside you on the board itself: pulling sources, summarizing videos, fanning out sticky notes, drafting documents — every artifact a card you can see, move, connect, and keep.

## Monorepo layout

```
apps/web         Canvas app — Vite + React + tldraw, custom card shapes, agent presence layer
apps/server      Thin agent server — link previews, SSE agent runs, holds API keys
packages/shared  @jarwiz/shared — the agent wire protocol and agent registry (single source of truth)
docs/            VISION.md and ARCHITECTURE.md — the spec
```

## Quickstart

```sh
npm install
cp apps/server/.env.example apps/server/.env   # optional: add ANTHROPIC_API_KEY
npm run dev
```

The web app runs at http://localhost:5173 and proxies `/api` to the server at http://localhost:3001. Everything works without an API key — `ANTHROPIC_API_KEY` only enables optional link-metadata cleanup.

Other scripts: `npm run build` and `npm run typecheck` (both fan out across all workspaces).

## Read the spec

- [docs/VISION.md](docs/VISION.md) — what Jarwiz is and why presence is the product
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — locked decisions, system design, milestones

## Status

**Milestone 0 — Foundation.** Infinite canvas in the Jarwiz skin, card shapes (link / YouTube / image / PDF / note), drop & paste ingestion via the server's link-preview endpoint, the agent dock (visual), and the SSE agent-event protocol stub. Live agents arrive in Milestone 1.
