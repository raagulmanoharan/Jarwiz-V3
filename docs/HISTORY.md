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

## 2026-07-04 — The drop moment gets a face

Roadmap §10 item 3 (delight): the first five seconds after a PDF drop now
offer a one-glance profile — "✦ Profile this document" on a quiet chip under
the just-landed card. Accepting streams a compact profile (what this is,
who's behind it, key dates, red flags, start here, three questions) as an
ordinary answer card. Learnings:

- **The cheapest correct architecture was "it's just an ask."** The spec
  said "uses the suggest pipeline," but routing the profile through the Ask
  pipeline instead meant the streamed card, provenance edge, page-citation
  chips, Keep/Discard, cancel, and error pills all came free — the entire
  feature is a store, a chip, and a prompt. When a new capability looks like
  a new pipeline, check whether it's actually a new *prompt* first.
- **Offered, never forced, needs three exits**: ✕ remembers the document and
  never re-offers it; accepting consumes the offer before the ask starts (so
  a retry can't double-offer); deleting the card clears silently without
  remembering (a re-drop should offer again). The durable path lives in the
  Refine menu so declining the moment never means losing the capability.
- **Playwright can drive real ingestion**: dispatching a `DragEvent` with a
  `DataTransfer` holding a `File` onto `.tl-container` exercises the true
  drop path (tldraw handler → upload → offer), no test-only hooks needed.
- The model skips an optional "# " title line when the prompt says "no
  preamble" — if the card needs a title, ask for the heading explicitly.

### Same day, owner feedback round

Raagul reviewed the screenshots: the Refine bar was rendering *inside* tall
cards, and the profile belongs on the floating panel as a fixed action ("a
profile is basically the summary"), not on a transient chip. Three fixes:

- **Profile is now a fixed "✦ Profile" button on the card action bar** for
  PDF cards. Since a dropped PDF lands selected, the bar appearing IS the
  drop-moment offer — the chip, its store, and its dismissal semantics all
  deleted. Less chrome, same moment.
- **The bar's top-edge clamp was shoving it into cards** (floor 118px,
  assuming a full-width topbar; the topbar's clusters are actually corner-
  only). Floor is now 62px: above the card whenever possible, adaptive —
  sliding over the card only when the card is truly at the screen edge.
- **Two bugs the round exposed**: (1) `jz-menu-in` animates `transform`,
  which *replaces* the bar's inline `translate(-50%,-100%)` lift during the
  entrance — the bar flashed inside the card. My stylesheet repair had just
  revived that animation; the bar now has its own keyframes that carry the
  lift. Lesson: never animate `transform` on an element positioned by an
  inline transform. (2) When the server strips a streamed "# Title" line
  into the card title, the following blank lines streamed into the body —
  every titled answer card rendered an empty band above its content.

## 2026-07-04 — Feel pass: the quiet gap thinks, the cold load slims

Roadmap §10 item 4. Two small builds, both about how the app *feels*:

- **Seed-pill shimmer.** The 5-20s between dropping a PDF and its tailored
  pills arriving used to be dead air. Now three shimmering placeholder pills
  hold the space (cache `undefined` = fetch in flight — the store already
  distinguished "loading" from "empty", the UI just never used it). One
  cascade gotcha: a `--modifier` class must sit AFTER its base class in the
  file, or the base's `background` wins.
- **Lazy pdf.js.** Mermaid was already dynamic-imported; pdf.js wasn't —
  335kB (85kB gzipped) riding the main chunk for every visitor who never
  opens a PDF. Same lazy-singleton pattern now (`getPdfjs()`), with the
  module stashed in a ref beside the document so the render effect stays
  synchronous. Cold load fetches no pdf chunk (asserted by watching network
  requests in the eval); the reader paints on demand. Main chunk: 2,347kB →
  2,059kB.

## 2026-07-04 — Find the board you mean

Roadmap §10 item 7 (scale of use): the side panel's Boards section now has
a search field. Titles filter as you type; board *contents* match a beat
later — read straight from each board's local database via the same layer
backup uses (extracted to `boards/boardDb.ts`), so no board needs mounting
to be searchable. Hits show a one-line snippet under the board name; click
switches. Learnings:

- **Extraction must be keyed, not blind.** Indexing every string prop would
  match colors, statuses, and megabyte data-URLs. The searchable text is an
  explicit list: text/title/name/code/description/url, table cells, and a
  walk of TipTap rich-text leaves for native shapes.
- **The eval caught a pre-existing UX dead-end**: double-click-to-rename on
  a board row could never fire, because the row's single-click handler
  switched boards and closed the panel before the second click landed.
  Clicking the already-active board now keeps the panel open (and
  switch-to-self is a no-op), which also makes rename reachable.
- Reusable selector lesson for our evals: `.jz-side-item-name` is shared by
  the Workspace and Backup rows — scope board-row assertions to
  `.jz-side-row`.

## 2026-07-04 — The table grows up

Owner direction: tables should carry more than comparisons (Cove as the
reference) — itineraries with links and photos — and the chrome should get
out of the way. What shipped:

- **Rich cells, plain strings.** Cells stay strings in the schema (backup,
  search, autopilot untouched); the static renderer understands minimal
  inline markdown — [label](url) links, ![alt](src) images (https/data/
  asset-store only), bare-URL links labelled by hostname, **bold**, line
  breaks. The table system prompt now permits exactly that vocabulary, so
  "plan me a tour" can land as an itinerary with booking links. Edit mode
  deliberately shows the raw source.
- **Chrome recedes.** +Row/+Column buttons became slim + strips on the
  bottom/right edges (the fit wrapper reserves the right lane while
  editing); row/column deletes are invisible until you hover what they
  delete; the header is the same size as body cells, just bolder — same
  quiet grid, no separate style.
- Watch the cascade when a card's frame is height:100%: anything measured
  for fit-height must be an auto-height inner element, and anything
  absolute (the right + strip) stays out of the measured flow.

### Typed columns + readability round

Owner go-ahead on column types, plus readability feedback. Columns now
carry a type — text / link / photo — cycled from a glyph button in the
edit header (stored as an OPTIONAL parallel prop, so every existing table
stays valid with no migration). A photo column's empty cells offer
"+ Photo" (file picker → blob store → thumbnail; the asset route now
sniffs magic bytes so images stop being served as application/pdf — SVG
deliberately excluded, it's an XSS vector inline). A link column enriches
a bare URL on blur into a [Title](url) chip via the link card's existing
SSRF-guarded preview, guarded so async completions never stomp newer
edits. Readability: the grid sits inset from the frame like the doc card,
cells got roomier, generated tables scale width with column count, and
stray ** markers (unclosed streaming bold) never reach the reader.

## 2026-07-05 — The dogfood pays off: trust fixes + three interaction calls

Fixed the ranked findings from yesterday's full-flow session and shipped
three owner directives on top. Learnings:

- **Vacuums get filled with confident nonsense.** An ask grounded on an
  empty card made the model riff on its own system prompt. The fix is
  structural, not prompt-side: toSource returns null for contentless
  shapes, so empty cards simply don't count as context — the ask proceeds
  as a free-standing question (a first-cut refusal pill was rightly
  challenged by the owner: never block the user when ignoring the empty
  card gives the behavior they meant). Provenance edges now come only
  from shapes that actually contributed.
- **tldraw groups ARE the "invisible frame".** Generated flowcharts group
  on completion: click selects the diagram as one askable unit (toSource
  walks the group's children), double-click enters it to edit — zero new
  chrome.
- **Stickies got a philosophy**: user annotation only. The router never
  chooses them; the rail gained a Sticky tool; the palette went muted.
  The ONE path to AI stickies is the explicit "/" pick — user intent.
- **"/" is a mode selector**: typing / in an empty prompt (or the footer
  button) opens "Answer as… Text / List / Table / Diagram / Stickies";
  the pick pins an accent chip and forces the response shape server-side
  (whitelisted like currentShape). One ask, then it clears.
- Generated diagrams now clear occupied space (footprint check + one
  re-layout below blockers) and frame themselves before drawing.
