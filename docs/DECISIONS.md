# Jarwiz — decision log

The running record of significant decisions and *why* we made them. The
original architecture-level choices live in
[ARCHITECTURE.md](./ARCHITECTURE.md#locked-decisions); this log captures the
product, UX, and engineering decisions made as the build progressed, so the
reasoning survives even when the code changes. The chronological story is in
[HISTORY.md](./HISTORY.md).

Format: each entry is **Decision → Choice → Why**, plus what it superseded.

---

## Foundational (see ARCHITECTURE.md for the full table)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Deployment shape | Client + thin server | Local-first board (IndexedDB); the server only holds keys, fetches pages (no CORS), and streams agent runs. Clean seam for auth/sync later. |
| D2 | Canvas engine | tldraw SDK | Production pan/zoom/select/arrows + custom React shapes; multiplayer-ready. |
| D3 | LLM provider/model | Claude, `claude-opus-4-8` | Strongest agentic tool use; `claude-haiku-4-5` for micro-tasks only. |
| D4 | Agent's "hands" | Canvas actions, not text | Each agent tool emits an `AgentEvent` the client applies to the board, so presence falls out of the protocol for free. |
| D5 | v1 crew | Researcher, Summarizer, Brainstormer, Writer | Fewer, deeper; covers the golden path. |

## Engineering

| # | Decision | Choice | Why |
|---|---|---|---|
| D6 | Live AI without an API key | **Claude CLI sidecar** (`claude -p`, tools disabled) | Real output using the environment's existing auth — no credentials read or forwarded. Server prefers a real `ANTHROPIC_API_KEY` when present, else the sidecar, else graceful scripted demo mode. `/api/capabilities` reports `api` / `sidecar` / `demo`. |
| D7 | Streaming for "batch" agents | Shared `textStream` (API stream → sidecar chunking → mock) | Slow agents (analyze, revise) feel as alive as Autopilot. |
| D8 | Self-hosted tldraw assets | `getAssetUrlsByImport()` | Icons/fonts render without `cdn.tldraw.com` (unreachable in some envs). |
| D9 | Shared package build step | `npm run build --workspace=packages/shared` after editing `shared/src` | `dist/` must regenerate or web/server typecheck won't see protocol changes. |
| D10 | Demo mode is first-class | Scripted mock drives the same `emit()` shapes as the real loop | Every flow is demoable with no key; new agents add a `mock.ts` branch. |

## The canvas pivot (card-first → canvas-first)

| # | Decision | Choice | Why |
|---|---|---|---|
| D11 | Primitives vs. cards | Turn tldraw's native primitives back on alongside agent cards | tldraw already shipped them; we'd suppressed the chrome. Cheaper and better than reinventing a card-only model. |
| D12 | Agents read native shapes | Autopilot + Ask serialize geo shapes, text, notes, labelled connectors, frame names | A flowchart you draw becomes real context, not invisible. |
| D13 | Agents build native shapes | `/api/diagram` → graph → client lays out editable shapes + bound connectors | Output is editable canvas, not a baked image; one undo. |

## UX / layout (the Stitch-inspired pivot)

| # | Decision | Choice | Why |
|---|---|---|---|
| D14 | Tool placement | Custom **right vertical rail** (`ToolRail.tsx`) | tldraw's built-in toolbar hard-docks vertical-left with off-screen transforms and fought CSS repositioning; a custom rail is predictable and on-brand. |
| D15 | Per-card actions | **Fixed top card action bar** below the header | Lights up in the *same place* on any selection — predictable, no hunting, no per-card float. |
| D16 | Top bar vs. prompt bar | **Transforms up top, questions below** | Resolves the confusion: one-tap verbs (Refine ▾, Discuss, Based on ▾) live in the top bar; open-ended, editable questions live in the bottom prompt bar. Confirmed with the user. |
| D17 | Multi-select | Identical top-bar behavior, with cross-selection transforms | Consistency; plus Summarise/Combine and (for 2+ PDFs) Find conflicts / Compare clauses. |
| D18 | Selection display | Removable **chips in the prompt bar** | Explicit grounding; supersedes a separate selection label. |
| D19 | Card-name label | **Removed** from the top bar | Redundant — identity already shows as the prompt-bar chip. |
| D20 | Zoom & log | Zoom **bottom-right**, activity log **bottom-left** | Frees bottom-center for the prompt bar alone; matches the Stitch reference. |
| D21 | Provenance UI | Folded into **"Based on ▾"** in the top bar | Removed the floating provenance layer; provenance is on-demand, not always-on chrome. |
| D22 | Bottom density | Spaced dock, roomier chips, taller rounded 2-line prompt bar | The starter chips + selection chip + input were too cramped. |

## Capabilities ("big rocks")

| # | Decision | Choice | Why |
|---|---|---|---|
| D23 | Cluster | 3+ stickies → named themes + summary doc, recolored & re-laid, single undo | Turns a wall of notes into structure in one move. |
| D24 | Opinion agents | Board scans: tensions / gaps / critique | Proactive, board-level value beyond per-card asks. |
| D25 | Conversational depth | Discuss a doc → revise in a thread (`/api/revise`) | Iterate on an artifact without spawning new cards. |
| D26 | PDF seed prompts | Per-asset content-aware starters, graceful fallback to curated questions | Defeats the blank-slate problem on a freshly dropped PDF. |

## Presence / responsiveness

| # | Decision | Choice | Why |
|---|---|---|---|
| D27 | Make work visible | Live text streaming + skeleton placeholders + **agent presence cursors** that move to each artifact | The user asked to *feel* the agent working alongside them — a collaborative space, not a spinner. |

## Process / guardrails

| # | Decision | Choice | Why |
|---|---|---|---|
| D28 | Shipping cadence | Small, shippable milestones; typecheck + build green before commit; screenshot the visible change; keep ROADMAP current | Product-owner discipline; honest about environment limits. |
| D29 | Eval-gated | Playwright evals (cluster, canvas-P3, discoverability, …) kept green through refactors | Consolidation didn't regress behavior; triggers updated to the new bar. |

---

When you make a call worth remembering, add a row here (Decision → Choice →
Why), note what it supersedes, and cross-link the deep-dive doc.
