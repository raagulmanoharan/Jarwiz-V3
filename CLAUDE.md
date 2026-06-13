# CLAUDE.md — working notes for this repo

Operating guide for Claude Code in **Jarwiz**: an infinite canvas where live AI
agents collaborate with you, taking ideas from zero to finished artifacts.
Read this first; it captures the architecture, the conventions, and the
hard-won process gotchas so each session doesn't relearn them.

See also: `docs/VISION.md` (product), `docs/ARCHITECTURE.md` (decisions + wire
protocol), `docs/ROADMAP.md` (Craft phases C0–C4, milestones M0–M4 incl. the
Autopilot spec in §9), `docs/DESIGN.md` (design system + tokens).

## Layout

npm-workspaces monorepo:

- `apps/web` — Vite + React + **tldraw 5.1**. The canvas, custom card shapes,
  agent presence overlay, ingestion. Design tokens in `src/styles/tokens.css`;
  component CSS in `src/styles/index.css` (everything themeable references a
  `--jz-*` token — no raw hex/px for themeable values).
- `apps/server` — Hono + Node. Thin agent runtime: SSE stream of typed
  `AgentEvent`s, SSRF-guarded link previews. Secrets (`ANTHROPIC_API_KEY`) live
  only here.
- `packages/shared` — the wire protocol + agent registry. **After changing
  anything in `packages/shared/src`, run `npm run build --workspace=packages/shared`**
  so `dist/` regenerates, or the web/server typecheck won't see it.

## Commands

```bash
npm run dev          # web (5173) + server (3001) together, HMR on
npm run build        # build all workspaces
npm run typecheck    # tsc --noEmit across all workspaces
# single workspace:
npm run typecheck --workspace=apps/web
npm run build --workspace=apps/web
```

Always run `npm run typecheck` (web + server) before committing. The web app
also typechecks as part of `build`.

## Conventions

- Match the surrounding house style: file-top doc comment explaining the
  *why*, tokens over magic values, `jz-` CSS class prefix, agent identity
  colors come from `packages/shared/src/agents.ts` (the single source).
- Motion cites a token (`--jz-dur-*`, `--jz-ease-*`) and honors
  `prefers-reduced-motion`.
- Branch + commits: develop on the designated `claude/*` branch, push with
  `git push -u origin <branch>`, open a **draft** PR. Commit messages end with
  the session URL. Do **not** put the model id anywhere in committed artifacts.

## Adding an agent (server)

The runtime (`apps/server/src/agents/runtime.ts`) is a manual Anthropic
tool-use loop. An agent is almost entirely a **system prompt + `buildUserTurn`**;
the runtime owns the canvas tools (`begin_card`/`finish_card`/`create_note`/
`create_link_card`/`connect_cards`) and emits all board events. To add one
(see `summarizer.ts`, `writer.ts` as templates):

1. Create `apps/server/src/agents/<id>.ts` exporting an `AgentDefinition`
   (`meta: getAgent('<id>')`, frozen `systemPrompt`, optional `serverTools`,
   `buildUserTurn(request)`). Keep the system prompt static (prompt caching).
2. Register it in `apps/server/src/agentRun.ts` (`AGENT_DEFINITIONS`).
3. Add a branch in `apps/server/src/agents/mock.ts` (`runMockLoop` switch) so
   the agent is demoable with **no API key** — mock drives the same `emit()`
   event shapes as the real loop.
4. The agent's edge color is the palette mapping in
   `apps/web/src/agents/useAgentRun.ts` (`ARROW_COLOR`).

`AgentEvent` variants: `status`, `cursor`, `card.create`, `card.delta`,
`card.done`, `edge.create`, `done`, `error`.

## Presence & streaming (web)

- Agents render as **Figma-style avatars** (`AgentCursorLayer.tsx`) driven by
  an external store (`presence.ts`, `useSyncExternalStore`).
- Live streaming caret: `streaming.ts` external store; `useAgentRun` flips it on
  `card.create` (doc/note) and off on `card.done`; doc/note shapes subscribe.
- Summon paths: contextual "Ask an agent" (`AskAgentAffordance.tsx`) and the
  **⌘K command palette** (`CommandPalette.tsx`). The palette listens on
  `window` for `(meta|ctrl)+k`.
- Demo mode: `GET /api/capabilities` → `{ live }`; `useCapabilities` →
  "Demo mode" badge in the Topbar when no key.

## Screenshots / visual QA (`scripts/screens.mjs`)

Playwright is available at `/opt/node22/lib/node_modules/playwright/`, chromium
at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. **Hard-won gotchas in
this sandbox — heed them or you'll burn an hour:**

1. **Use the production build via `vite preview`, never `npm run dev`, for
   screenshots.** Dev HMR's websocket fails in the sandbox (blocked, cert
   errors) and the page enters a full-reload loop. `vite.config.ts` has a
   `preview.proxy` mirroring `server.proxy` so `/api` still reaches :3001.
   ```bash
   npm run build --workspace=apps/web
   # start API server + preview as BACKGROUND tasks (run_in_background), not (cmd &)
   npm run dev --workspace=apps/server         # :3001
   npm run preview --workspace=apps/web -- --port 5173 --strictPort
   node scripts/screens.mjs                     # → /tmp/jz-*.png
   ```
2. **Start servers with the harness's real background mechanism**
   (`run_in_background: true`), not a `(cmd &)` subshell — the latter gets
   reaped between tool calls and the port goes dead (ERR_CONNECTION_REFUSED).
3. **The sandbox intermittently tears down the page's JS execution context**
   ("Execution context was destroyed, most likely because of a navigation") —
   often with *no* `framenavigated` event — when you drive `window.editor`
   right after load or right after `createShape`. It WORSENS the longer the
   preview server runs (restart it fresh before a capture run). Mitigations
   that actually help: a single browser **session** for the whole capture (not
   a fresh browser per shot); a generous settle (`sleep ~1.3–2.5s`) after load,
   after clearing, and after seeding; and keeping the seed **small** (one card
   is far more stable than several). Tight retry-polling of `window.editor`
   *during* a teardown re-triggers it — prefer fixed settles over hot retries.
4. The **empty-state shot is reliable** (no shape creation). Multi-step
   seed→summon captures are flaky here; they work in a normal environment.
5. ⌘K from a real keypress is eaten by tldraw once the canvas holds a
   selection; dispatch the keydown straight to the window listener instead:
   `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`
   (it toggles — only fire it when the palette is closed).

## Process / working style for this product

- Work like a product owner: small, shippable milestones; typecheck + build
  green before commit; attach a screengrab to the PR when a visible change
  lands; keep `docs/ROADMAP.md` current as the plan of record.
- When a capability and craft phase interleave, land capability on top of the
  crafted surface (e.g. the Writer's doc card inherits C1/C2 polish).
- Be honest about environment limits (e.g. screenshot flakiness above) rather
  than faking results.
