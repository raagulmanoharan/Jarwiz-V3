# Jarwiz — conversation & session history

A curated, chronological record of how Jarwiz was built session by session:
the request that drove each chunk of work, the key choices made, and what
shipped. It's the narrative companion to [DECISIONS.md](./DECISIONS.md) (the
*why* in table form) and [ROADMAP.md](./ROADMAP.md) (the *plan* of record).

This is a human-readable log distilled from the working sessions — not a raw
transcript. Where a request changed direction, the pivot is called out so the
reasoning survives.

---

## 1. Foundation — the canvas and the crew

**Intent:** resurrect the LinkCanvas prototype as Jarwiz — a genuinely good
multiplayer canvas where autonomous agents participate the way humans do.

- Stood up the npm-workspaces monorepo: `apps/web` (Vite + React + tldraw 5.1),
  `apps/server` (Hono + Node, SSE), `packages/shared` (the wire protocol +
  agent registry).
- Custom card shapes (link / youtube / image / pdf / note / doc), drop & paste
  ingestion via the server's SSRF-guarded link-preview endpoint.
- The agent runtime as a manual Anthropic tool-use loop whose tools are
  **canvas actions** — the model literally manipulates the board, and presence
  (cursors, streaming cards, status) falls out of the protocol for free.
- The crew: Researcher, Summarizer, Brainstormer, Writer (M0–M3).

→ Detail: [ARCHITECTURE.md](./ARCHITECTURE.md), milestones M0–M3.

## 2. Writing partner & response shapes

- Doc entry (`d`), board-aware Tab autopilot (connected → selected → nearby →
  board context, cited), cold-start clarify, ambient pause-nudge.
- Agent output became first-class, editable cards (tables, docs, diagrams) with
  in-place regeneration and cancel. → [RESPONSE-SHAPES.md](./RESPONSE-SHAPES.md).

## 3. The PDF journey

**Intent:** a dropped PDF shouldn't be a dead end.

- Content-aware **seed prompts** fetched per asset (`/api/seed-prompts`) so a
  fresh PDF offers real starting questions instead of a blank slate.
- Cross-document actions for two+ PDFs ("Find conflicts", "Compare clauses").
- Bundled Tesseract (`eng.traineddata`) so PDFs are read without a download.

→ Detail: [PDF-JOURNEY.md](./PDF-JOURNEY.md).

## 4. Big Rocks — depth over breadth

**Intent (PRD):** invest in a few high-leverage capabilities.

- **Cluster** — select 3+ sticky notes → sort them into named themes with a
  summary doc, recolored and re-laid into columns, all as a single undo.
- **Opinion agents** — board-level scans: ⚖ tensions, ✦ what am I missing,
  ⚔ devil's advocate.
- **Provenance** — every agent artifact remembers its sources.
- Conversational depth: Discuss a doc and revise it in a thread.

→ Detail: [BIG-ROCKS.md](./BIG-ROCKS.md).

## 5. The canvas pivot — card-first → canvas-first

**Intent:** "Read the codebase, then build the primitives." Key insight: tldraw
already shipped every primitive; we'd suppressed the chrome. So the work was
"turn the engine back on, then teach the agents to see and use it."

- **P0 — humans get primitives.** Curated toolbar (select · text · shapes ·
  arrow · line · draw · frame), gated style panel, self-hosted tldraw assets.
- **P1 — the AI sees primitives.** Autopilot + Ask read native geo shapes, free
  text, sticky notes, labelled connectors, frame names.
- **P2 — the AI builds primitives.** `/api/diagram` returns a graph; the client
  lays it out as native, editable shapes + bound connectors (one undo).
- **P3 — native-canvas craft.** "⤢ Tidy" auto-lays-out a connected selection;
  a "Flowchart" starter template.

→ Detail: [CANVAS-PIVOT.md](./CANVAS-PIVOT.md).

## 6. Make it feel alive — responsiveness

**Intent:** "When I ask the agent to build something, I want to feel it working
alongside me — the cursor moving, artifacts streaming in as a collaborative
space." Chosen direction: all three phases, drawn node-by-node.

- Live text streaming into cards, skeleton placeholders, and **agent presence
  cursors** that move to where each artifact lands while it's being built.

→ Detail: [RESPONSIVENESS.md](./RESPONSIVENESS.md).

## 7. Persona pressure-tests

**Intent:** "Populate the board the way a seasoned PM would after a 3-hour
brainstorm — a real mix of docs, notes, synthesis, diagrams — then bring the
persona back to try it again."

- Drove comprehensive, realistic boards end-to-end and captured screenshots;
  brought the original "big rocks" persona back to re-evaluate.

→ Detail: [USABILITY-TEST.md](./USABILITY-TEST.md), [TEST-REPORT.md](./TEST-REPORT.md).

## 8. The Stitch-inspired layout pivot

**Intent (from a Google Stitch reference):** "After I select a card, show
follow-up actions in a bar at the top; put refine/follow-ups under dropdowns;
show which card I've selected in the bottom prompt bar; right-bottom is for
zoom; left-bottom is the log." Chosen direction: right vertical tool rail +
all of it.

- **Right tool rail** (`ToolRail.tsx`) replacing tldraw's built-in toolbar
  (which hard-docks vertical-left off-screen).
- **Fixed top card action bar** (`CardActionBar.tsx`) — lights up in the *same
  predictable place* below the header on any selection. Holds one-tap
  transforms: Refine ▾ / Discuss / Based on ▾.
- **Bottom prompt bar** carries the selection as removable chips and surfaces
  editable next-best **questions**.
- Zoom moved bottom-right; the activity log bottom-left.
- The governing rule, confirmed with the user: **transforms up top, questions
  below.** Multi-select gets the identical top-bar behavior.

## 9. Declutter pass (latest)

**Intent:** "Hide the redundant card name from the top bar; reduce the bottom
density; add the PDF actions back."

- Dropped the card-name label from the top bar (identity already lives in the
  prompt-bar selection chip).
- Spaced out the bottom dock — roomier chips, a taller rounded prompt bar.
- Restored PDF flows: a selected PDF surfaces its seed prompts as starters
  (graceful fallback to curated questions); two+ PDFs get cross-doc transforms.

---

## How to keep this current

When a session lands a meaningful change: add a short section here (intent →
what shipped → link to the deep-dive doc), record the *why* in
[DECISIONS.md](./DECISIONS.md), and update [ROADMAP.md](./ROADMAP.md) if the
plan moved. Keep entries narrative and link out rather than duplicating detail.

## 2026-07-04 — The audit & the surgery

Merged `feat/flora-alignment` as the final chrome, then ran a six-slice
parallel audit (docs/AUDIT.md) and a surgical cleanup on top. Learnings:

- **The bloat had one root cause**: the repo carried two generations of the
  same product, and the dead generation (rooted at a single never-imported
  component) was 53% of `agents/` by line count. Deleting from the import
  graph root, after moving the one live constant out, removed ~2,400 lines
  with zero behavior change.
- **The worst bugs were quiet ones**: cross-board Timeline revert (module
  state surviving a remount), a regen error path that committed a blanked
  card, and two server features that silently no-oped in production
  (autopilot board context dropped by the route; suggest.ts never calling the
  API). None threw; all needed reading the wire, not the logs.
- **Restyles strand behavior**: Flora moved the rail left and rebuilt the
  topbar, but the tour, empty state, and help copy still described the old
  chrome — and the overlays were unmounted "while we design", severing live
  store writes from their renderers. Chrome PRs need a "what anchors to me"
  checklist.
- **Playwright QA in this sandbox works** (19/19 flows green) if you follow
  CLAUDE.md's gotchas, wait out React batching before asserting, and remember
  a scrim eats the first outside click — that's product behavior, not a bug.
- Session limits can kill subagents mid-edit; commit green checkpoints early
  and keep each agent's blast radius to files you can hand-finish.

## 2026-07-04 — Backup/restore, and the stylesheet was quietly broken

Roadmap §10 item 2 (trust): every hour invested in Jarwiz lived in one
browser profile, unrecoverable. Now: side panel → Backup → one JSON file
holding board metadata, every board's tldraw document (read straight from
the per-board IndexedDB databases), and the PDF bytes from the server blob
store; restore is a confirmed full replace that re-uploads PDFs under their
original ids. `scripts/eval-backup.mjs` proves the loop 10/10, including a
canary note surviving a wreck-and-restore and a PDF card surviving a wiped
server. Learnings:

- **The restore's hard problem is the open database.** tldraw holds a live
  IndexedDB connection to the active board; rewriting under it (or deleting
  its database) blocks or races. The clean move was structural: a module
  flag (`isRestoring`) that App reads to unmount the canvas — React does the
  disconnect, then the writes proceed, then `location.reload()` remounts on
  the restored data.
- **A board backup that skips server assets is a lie.** PDF cards store only
  `/api/assets/<id>` URLs; the bytes live in a temp dir on the server. The
  backup embeds them (base64) and restore PUTs them back under the same id —
  verified by wiping the server's asset dir mid-eval. That wipe also exposed
  a real server bug: `putAsset`'s memoized mkdir meant a vanished dir failed
  every subsequent write forever.
- **CSS parsers fail silent.** The July 4 cull's automated edit left ten
  `@media` preludes braceless, two comments unclosed (swallowing the
  keyboard focus ring and the `jz-menu-in` keyframes app-wide), and four
  orphaned declaration blocks. Nothing errored; the browser just dropped
  rules. A strict postcss parse is now the cheap check — worth running after
  any scripted edit to the stylesheet.
