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
