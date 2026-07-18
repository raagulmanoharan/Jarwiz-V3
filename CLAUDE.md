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
- **Cards hide tldraw's style/opacity control.** No Jarwiz card takes tldraw
  styles (color/size/opacity) — the look is the design system's. This is gated
  in `CanvasToolbar.tsx` on the `*-card` naming convention, so **every card,
  present and future, hides the opacity dial automatically**; just name a new
  card type `*-card` (owner call — applies to all new cards, 2026-07-07).

## Git & merge discipline

`docs/WORKFLOW.md` is the full playbook; these are the non-negotiables that keep
`main`'s history readable (the early history wasn't — see `docs/CHANGELOG.md` for
why). Follow them every time:

1. **One feature → one branch → one PR.** Split unrelated work even when asked
   for two things at once. Never stack a second feature onto a branch under
   review.
2. **Squash-merge only. Never a merge-commit.** Every feature must land as a
   single commit on `main` titled `<summary> (#NN)`. Merge-commits drag WIP onto
   `main` and are what made Era 1 of the history a tangle. If a merge would
   create a merge-commit, stop and squash instead.
3. **PR title = the changelog line.** Write it as the one sentence future-you
   wants to read in `git log`: plain-language outcome, not mechanics. It becomes
   the squash commit and the `docs/CHANGELOG.md` row verbatim.
4. **Tag the feature surface.** Every PR touches one of the tags in
   `docs/CHANGELOG.md` (`foundation`/`canvas`/`cards`/`agents`/`onboarding`/
   `landing`/`embeds`/`deploy`/`docs`). Know which before opening the PR; it's
   how the ledger stays sortable.
5. **On merge, update the ledger.** Add one row to `docs/CHANGELOG.md`'s release
   log (and a cross-index line if it's a new area) as part of merging — same
   ritual as the `docs/HISTORY.md` note. The changelog is the durable
   feature→PR map; don't let it drift.
6. **Keep branches fresh.** Sync with `main` before opening a PR and before
   merging; resolve conflicts on the feature branch, never on `main`.
7. **Green before merge.** `npm run typecheck` + `npm run build` pass; never
   `--no-verify`. Commit messages end with the session URL; no model id in any
   committed artifact.

## Adding an agent (server)

The runtime (`apps/server/src/agents/runtime.ts`) is a manual Anthropic
tool-use loop. An agent is almost entirely a **system prompt + `buildUserTurn`**;
the runtime owns the canvas tools (`begin_card`/`finish_card`/`create_note`/
`create_link_card`/`create_table`/`connect_cards`) and emits all board events.
To add one (see `summarizer.ts`, `writer.ts` as templates):

1. Create `apps/server/src/agents/<id>.ts` exporting an `AgentDefinition`
   (`meta: getAgent('<id>')`, frozen `systemPrompt`, optional `serverTools`,
   `buildUserTurn(request)`). Keep the system prompt static (prompt caching).
2. Register it in `apps/server/src/agentRun.ts` (`AGENT_DEFINITIONS`).
3. Add a branch in `apps/server/src/agents/mock.ts` (`runMockLoop` switch) so
   the agent is demoable with **no API key** — mock drives the same `emit()`
   event shapes as the real loop.

Note: the specialist agents (`researcher`/`summarizer`/`brainstormer`) are
currently server-side only — the web UI presents a single **Jarwiz** identity
and reaches the model through Ask/Analyze/Autopilot/Chat. A deliberate summon
UI is a roadmap item (docs/ROADMAP.md).

`AgentEvent` variants: `status`, `cursor`, `card.create`, `card.delta`,
`card.done`, `edge.create`, `done`, `error`.

## Presence & streaming (web)

- One **Jarwiz avatar** (`AgentCursorLayer.tsx`) driven by an external store
  (`presence.ts`, `useSyncExternalStore`); board scans park it on the card.
- Live streaming caret: `streaming.ts` external store; useAsk/autopilot flip it
  on card create/done; doc/note shapes subscribe.
- Ask paths: the bottom **PromptBar** (grounded on the selection) and the
  **CardActionBar** on a selected card (fixed ✦ Profile on PDFs + Refine ▾
  transforms). (The right-edge ClaudePanel chat drawer described in older
  docs was removed in the July 2026 surgery — no chat drawer exists today.)
- Multiplayer (`?room=`) is **parked** behind `VITE_JARWIZ_ENABLE_SYNC` /
  `JARWIZ_ENABLE_SYNC` pending security hardening — see docs/AUDIT.md P0.4.

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
3. **"Execution context was destroyed" is (almost always) YOUR return value,
   not the sandbox.** tldraw's `Editor` methods are chainable and return the
   Editor itself, so `page.evaluate(() => window.editor.createShape(...))` —
   or `.setCamera(...)`, `.select(...)`, `.zoomToFit(...)`, `.deleteShapes(...)`
   — asks Playwright to serialize a huge circular object across the CDP
   boundary. That serialization fails and surfaces as *"Execution context was
   destroyed, most likely because of a navigation"* with **no** real navigation.
   Proven deterministic: returning the Editor = teardown every time; returning
   `undefined`/a primitive = clean every time, even with two synced clients.
   **Fix:** give every editor-mutating evaluate a `{ … }` body so it returns
   `undefined` (or return `s.id`, a length, etc.). This was previously
   mis-attributed to a flaky sandbox; it is not. (Independent advice that still
   holds: start servers as real background tasks, restart a long-running
   `vite preview` if pages start failing, and block `cdn.tldraw.com` /
   `fonts.googleapis.com` requests — unreachable here — to keep the console
   clean.) See `scripts/eval-ui.mjs` for the canonical pattern.
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

## Working with the owner (Raagul)

Raagul is a **UX designer, not a developer**. He is building Jarwiz into a
world-class product piece-by-piece in long sessions with Claude Code. Adapt
behavior:

- **Drive the engineering process.** Pick branch names, commit messages, when
  to merge, when to deploy. Don't ask him "should I create a branch?" — just
  do the right thing and tell him what you did and why in one line.
- **Explain in product/design terms** when explaining what you did. Not
  "rebased onto main" — "synced your branch with the latest changes so we're
  not building on stale code."
- **Be the safety net.** Before any destructive action (force-push, hard
  reset, deleting branches, dropping uncommitted work), pause and confirm in
  plain English what's at stake. Never `--no-verify`. Treat his uncommitted
  work as sacred.
- **One feature → one branch → one PR.** Even if he asks for two things,
  split them. The full workflow he agreed to lives in
  [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — read that whenever you're starting
  a feature, opening a PR, or about to merge. **Don't deviate without asking.**
- **Verify before claiming done.** UI changes require either a screenshot or
  an honest "I can't test the canvas interaction in this sandbox — please
  click X and confirm Y." Typecheck + build green is necessary but not
  sufficient.
- **Capture session learnings in `docs/HISTORY.md`** at the end of each
  feature, while context is fresh.
