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

## 2026-07-05 (later) — One title, one family: primitive coherence

Two owner directives, landed together: names live OUTSIDE the cards, and
every primitive reads as one visual family.

- **The primitive title is now a system, not a doc-card feature.** The
  text card lost its internal title input — it's pure text. In its place,
  ONE overlay (`ui/CardTitleTag`) renders an editable title above the
  top-left of whatever single shape is selected — text card, table,
  sticky, PDF, image, diagram group. `shapes/shapeTitle.ts` is the single
  read/write path: each type keeps its title where it always lived
  (doc/diagram `title`, pdf/image/frame `name`), and shapes with no such
  prop store it in `shape.meta.jzTitle` — meta needs no schema migration,
  which is what makes "titles for ALL primitives" a 40-line change. The
  same string is the composer's ground chip, the grounding title sent to
  the model, and part of cross-board search.
- **The box inside the sticky was the a11y focus ring.** Text inputs
  always match `:focus-visible`, so the global keyboard-focus rule drew a
  2px box around the sticky's textarea on every double-click. In-card
  editors are now excluded — the caret is the editing indicator there.
- **Coherence = one radius, one border weight, one stroke.** Stickies
  dropped the skeuomorphic dog-ear/paper-stack for the doc card's radius,
  hairline, and shadow; link/pdf/image/diagram frames went from
  hairline-strong to hairline; tldraw geo/arrow/line strokes render at
  1px via CSS (tldraw's thinnest is 2px — a CSS rule outweighs the SVG
  presentation attribute). Sticky tints moved into the refine bar as a
  7-swatch switcher (the style panel stays hidden).
- **The refine bar now flips.** Scrolled INTO a tall card (top off-screen)
  the bar used to squat on the content at its clamp floor. It now flips
  below the card's bottom edge when there's no headroom above, and only
  docks over the card when neither edge is on-screen.

## 2026-07-05 (later still) — Links become readable, text cards become writable

- **Paste a URL → link card** (skeleton → SSRF-guarded preview), and the
  same fetch now extracts the page's READABLE TEXT (article/main region,
  8k cap) into the card's optional `text` prop. That one field upgrades
  links from decoration to material: asks ground on page content, the
  Refine menu gains "✦ Summarise the page" / "Key takeaways", contextual
  pills get real substance, and board scans read linked pages.
- **Text card formatting**: B/I/U/S + bullet/checklist buttons on the
  refine bar operating on the editing textarea's selection as markdown
  edits (shared pure helpers in ask/textFormat.ts; ⌘B/I/U shortcuts).
  DocMarkdown learned __underline__ and ~~strike~~. Buttons preventDefault
  on mousedown so the textarea keeps its selection.
- **Focus mode**: Maximize on the format group opens the card as a
  full-screen page — deep-dimmed board, sticky label-voice header (pinned
  14px below the screen edge, with a fixed dim strip covering the gap so
  text fades out rather than showing raw), autosizing textarea so the page
  grows forever and the backdrop scrolls. Esc/X/backdrop closes; edits are
  live on the shape so there is no save step. Gotcha: `flex: 1` on the
  textarea silently overrode the autosize height (flex-basis 0) — pinning
  the page at min-height with an inner scrollbar.
- **Scan quality**: tensions/gaps open with a framing sentence (bullet-
  first cards read broken); scan chips gate on gatherBoardCards() substance
  rather than raw shape count; PDFs join scans as capped extracted text;
  and a scan card's own pills phrase themselves as GENERATION — one per
  named gap ("Draft the success metrics") — closing diagnose → generate.

## 2026-07-05 (evening) — Jarwiz reaches the live web

- **Web access on every ask** via Anthropic server tools
  (`web_search_20260209` / `web_fetch_20260209`, declared per-generation in
  `apps/server/src/webTools.ts`): prose/list/table answers and table fills
  can search and fetch today's pages, cited inline as markdown links with
  closing "Source:" lines. Handle `stop_reason: "pause_turn"` by replaying
  the assistant content (bounded continuations) — server tools legitimately
  pause long turns. The keyless dev path mirrors this with the Claude CLI's
  own WebSearch/WebFetch (`--allowed-tools`, longer timeout); it works but
  emits no mid-run statuses, so only the API path narrates
  "searching the web…" on the avatar.
- **Deep research is an intent, not a button.** A research-sounding ask on
  any card ("what do guests say", "find reviews", "is this legit",
  "research this") upgrades itself to a dossier pass: subject-adaptive
  mission (listing → reviews/prices; repo → maturity/traction; paper →
  credibility/counter-sources), 10 searches + 8 fetches, longer output,
  5-minute sidecar window. First ✦ Research shipped as a card-bar button on
  link cards; owner killed it same session — the prompt IS the mode. The
  intent regex is tested against every canned prompt in the app so a
  refine-bar "Go deeper" can never trigger a 5-minute run.
- Verified live twice: a hotel link surfaced cross-platform reviews and the
  fact the property was REBRANDED (Leela → St. Regis, 2022) as the lead
  verdict; a repo link chose entirely different angles and even
  fact-checked the probe's own typo'd URL.
- **Long answers grow page-ward**: while streaming, a doc card whose
  content height passes 1.4× its width widens a step (416 → … → 800)
  before growing tall — dossiers land page-shaped, not skyscraper-shaped.
  Width growth only runs while streaming so user-set widths are never
  fought over.
- **Formatting parity locked in**: in-card markdown headings flattened to
  body size (weight-only hierarchy — the format tool has no type scale, so
  cards never show text a user couldn't produce); `---` (and em-dash
  autocorrect variants) renders the system hairline divider — typing it is
  the divider control; bare URLs in card text are clickable, protocol
  stripped and clipped at 48 chars so tracking tails can't stretch the
  measure.
- Probe gotcha for future sessions: a fresh board shows the board-entry
  dialog (`jz-boardentry-scrim`) which swallows prompt-bar clicks — press
  Escape first, or create a shape (any shape auto-dismisses it).

## 2026-07-05 (late) — Videos join the board's context

- **Pasted YouTube links become playable video cards that read their own
  captions**: `/api/youtube/text` (16k budget) fills the card's `text` prop
  at paste time; a header badge is the honesty contract — "transcript ✓"
  vs dashed "title only". Video cards finally ground asks (toSource) and
  board scans; caption-less videos contribute an explicit never-guess line.
  Bug found by probing, not review: the toSource branch was dead until
  `youtube-card` joined the ASKABLE set — the prompt bar filters selection
  BEFORE grounding. If a new card type should ground asks, it needs BOTH.
- Full journey + remaining phases in docs/USECASE-CREATOR.md (style scans,
  script mode, ASR are B–D).
- Sandbox truth: youtube.com is unreachable here (proxe refuses), so the
  live caption fetch is verified only as the honest-failure path; the
  grounding path was verified by seeding a transcript and asking — the
  answer quoted it. Image CDNs are also blocked: link-card enrichment
  stores real og:image URLs (verified with github.com) but the browser
  can't render the pixels here — letter placeholder is the sandbox look,
  not the product look.

## 2026-07-05 (night) — Jarwiz watches

- **The watching pipeline is real and verified end to end in one session**:
  two locally-built test videos with opposite identities (16 hard-cut hype
  slides vs a 3-shot slow film) went through the REAL paste flow; dedup kept
  16 frames for one and exactly 3 for the other (the frame pattern IS the
  editing fingerprint); and a transcript-less "compare the editing and
  visual style" ask produced a table whose every cell was a pure-vision
  observation — it read the words off the slides, inferred cut rhythm from
  frame density, named both palettes, and honestly noted "text cards, not
  live footage".
- Dev-sandbox tricks worth remembering: pip's yt-dlp + imageio-ffmpeg's
  static binary (no drawtext — render slides as HTML via Chromium
  screenshots, assemble with the concat demuxer); serve test media over
  localhost so yt-dlp's generic extractor exercises the real download path;
  the sidecar sees frames via .jpg symlinks it Reads (asset files are
  extensionless).
- Probe lesson repeated: "Compare…" routes to a TABLE — a probe watching
  for a doc-card reports null while the right artifact sits on the board.

## 2026-07-05 (late night) — 5-persona dogfood + the fixes it surfaced

- Ran an end-to-end pass as PM / student / creator / designer / traveller,
  each hitting a different capability cluster (real headless Chromium on the
  production build, real clicks/typing/upload, real sidecar model calls).
  Wins: link-grounded student summary + cited live research; the creator's
  video dissection read cut-rhythm/palette/typography straight off sampled
  frames; the traveller's hotel query auto-escalated to the cited dossier.
- Four real breakpoints found and fixed the same session:
  1. **Image cards were vision-blind on the sidecar** (video frames weren't).
     Fixed by staging image-card base64 into the sidecar's temp frame dir and
     Reading it — dropped images now get a real critique in dev. Verified.
  2. **Comparison tables wrote "Not covered in this source" for an analytical
     column the user asked for** (Risk). TABLE_SYSTEM now reasons judgement
     columns from the source; placeholder reserved for absent FACTUAL columns.
  3. **Leaked CLI narration** ("Have enough confirmed info now.") opened
     answers and stole the doc title slot — cleanOutput now peels leading
     agentic-preamble lines.
  4. **"What am I missing" hidden at 2 cards** — threshold ≥3 → ≥2.
  ("&amp; in a cell" was a false alarm — the notification pane HTML-escaped a
  plain ampersand.)
- Probe gotcha logged: the persisted board (shared persistence key)
  accumulates shapes across probe runs; a wedged record makes a later
  createShape throw a validation error. Wrap createShape and/or hard-reset
  the store between runs.
- Link-access boundary (owner asked re: LinkedIn): public
  articles/blogs/docs/GitHub/YouTube/PDF → full read; login-walled
  (LinkedIn, X, IG, FB) → NO (auth stops both our scrape and the model's
  web_fetch); paywalls → headline/description only; bot-walled (Airbnb) →
  thin scrape but research-around fills the gap. LinkedIn is the clearest
  "can't" today; honest fallback = a "can't read this" badge + paste-the-text.

## 2026-07-05 (deep night) — Ultra Think, rebuilt on Claude

- **The Gemini question, answered honestly.** PR #4 ("Ultra Think") was
  generated against `main` — the ORIGINAL flat scaffold (root App.tsx,
  services/geminiService.ts, Gemini) that predates the monorepo restructure
  and was never merged forward. The live app (apps/web + apps/server +
  packages/shared) is 100% Claude/Anthropic — zero Gemini refs. So PR #4
  can't merge; the feature had to be re-implemented on our stack.
- **Ultra Think, natively on Claude.** discover.ts summarises the board and
  runs Claude web_search (grounded) to surface REAL related resources, then
  validates (http(s)) and dedupes (vs board + within) before returning typed
  SuggestedResource[]. Verified: a tldraw/canvas/CRDT board returned 8
  diverse, anchored, real links (tldraw docs, Yjs/Automerge, the Ink & Switch
  local-first essay, a CRDT benchmarks repo, Matuschak's canvas note).
- UI: a gradient "Ultra think" topbar button (gated ≥3 cards, shimmer at
  rest, spin while searching) → "N found" → a drawer of add-able rows (kind
  icon, title, description, accent "because you saved…" reason, source, Plus→
  check). Add spawns a real card via putExternalContent (reusing link/video
  ingestion). Full flow verified end to end.
- Lesson for future sessions: when a PR "mentions Gemini," check its BASE —
  `main` is the stale pre-restructure app; all real work lives on the
  monorepo feature branches (PR #2 lineage).
## 2026-07-05 (later still) — Jarwiz becomes a living entity on the board

**Intent:** "Jarwiz needs to be a living entity on the board, with its own
mind — like a user cursor on a FigJam board, moving around, looking at what
you've added. When a card or PDF is added, the time it takes to process
should be visible: the cursor comes, lands on it, and reads."

- The avatar no longer exists only during agent runs. A rAF **brain**
  (`agents/AgentCursorLayer.tsx`) keeps it on the canvas full-time with three
  tiers of attention: an active run owns it outright (presence store,
  priority unchanged); a freshly dropped link/PDF/image pulls it over into a
  **"reading…"** pose held for the card's real processing window (link-preview
  fetch / blob upload, with a cap so a stuck pipeline can't trap it — and a
  floor so even an instant image gets a beat of attention); otherwise it
  idles like a curious collaborator — roams the viewport, parks on card
  corners (the same spot ask choreography uses), drifts faintly in place.
- **Human motion** (`agents/cursorMotion.ts`): curved bezier arcs with
  overshoot-and-settle, pace proportional to *screen* distance (so zoom
  doesn't change the beat), zig-zag reading sweeps, sub-pixel tremor at
  rest. The `.jz-avatar` CSS transform transition is gone (opacity-only
  now) — scripted motion and a 420ms transition fight each other.
- **Attention feed** (`agents/jarwizLife.ts`): ingestion explicitly reports
  each *user-added* card. Presence stays honest — agent-created cards keep
  their own run choreography, and reading ends when the shape's own
  `loading`/`status` props resolve, not on a fake timer.
- Reduced motion preserves the old calm exactly: no roaming, instant parks,
  visible only while working.

## 2026-07-05 (continued) — The entity gets a face and a sense of humour

- **Cursor look decided** (from a four-way visual lineup: orb / pointer+pill /
  sparkle-as-cursor / pointer+sparkle-badge — Raagul picked **pointer + pill**):
  the classic collaborator arrow in Jarwiz ink with a paper outline, hotspot
  on the tip, and ONE trailing pill — name always, status beside it while
  working. Ink pill + paper text auto-invert with the theme tokens. The orb
  avatar (disc/ring/stacked badge) is retired.
- **Reading quips**: while a card processes, the pill cycles a shuffled,
  kind-themed script (links: "dodging cookie banners…"; PDFs: "squinting at
  fine print…"; images: "admiring the pixels…") — always opening with the
  honest "reading…". First swap lands early (~1.2s) and the min-read floor
  rose to 2.8s so even an instant card gets one joke. Each quip enters with
  a soft rise (`jz-status-swap`, keyed remount; keyframes have no `to` block
  so the text settles at its resting 0.72 opacity).

## 2026-07-10 — Intent-first onboarding becomes a first impression with a pulse

**Intent:** two outside reviewers bounced in a row — Sanchit ("I felt lost
coming in without a purpose") and a second tester ("couldn't assess the
audience you have in mind"). Fix the first five seconds: show intelligence
immediately, let people bring their own content, and learn who's standing at
the composer. Also: get the demo content off a competitor minefield.

- **Intent-first onboarding shipped (#29).** The "What are you working on?"
  modal is gone. On a brand-new empty board the composer rises to the centre
  ("What are we figuring out?"), types example intents on its own with a live
  shape-preview chip, and glides down into its dock on the first ask while the
  tool rail slides in.
- **The ambient scene** (`onboarding/AmbientOnboarding.tsx`): collaborators
  (PM / Researcher / Designer / Founder) sweep in from the edges *carrying*
  real-looking mini cards, drop them, and linger; the composer's ✦ orb pulses
  and **births one Jarwiz cursor per card** — organic bézier flights, verb
  tooltips stepping through specific actions, subtle in-place drift. Decorative
  overlay (pointer-events off), hushed the instant you engage the composer.
  Iterated through ~8 rounds on a concept artifact before touching product
  code — cheap to steer there, exact to port after.
- **Composer attachments.** Drop/paste a PDF, image, or sheet straight onto
  the composer → a persistent paperclip pill (NOT tied to canvas selection);
  the source card materialises only on send, grounding the ask. Gotcha that
  cost a round: tldraw's canvas drop handler eats React `onDrop` — intercept
  at the document **capture phase**.
- **Demo content neutralised (#30).** The hero/landing demo compared CRMs by
  name — recommending some vendors and literally advising "skip Salesforce"
  (Raagul's employer). Whole scenario swapped to PM tools (Notion / Linear /
  Asana…), "skip" line names no one, evidence sheet + hero/OG images
  regenerated to match. Lesson: demo content is positioning — keep it off
  anyone's day job.
- **Persona modal (#31).** "What brings you here?" — three identity cards
  (icon + a one-sentence blurb of example asks) over the live ambient scene.
  One tap re-themes the starters, the self-typing examples, and the ambient
  cards/verbs in place; every answer (incl. "Just exploring", stored 'none')
  persists ask-once in `personaStore`. Started as a chip row on the intent
  screen; Raagul called it to a modal — the veil darkened and bullets became
  paragraphs in the polish rounds. The pick is the hook for persona-tuned
  seed pills / Ultra Think later, and a listening post on who actually
  shows up.

## 2026-07-10 (later) — Provenance grows up: cards that stay true to their sources

**Intent:** "the edges/provenance logic is messy" → clean it to one system,
then make lineage *do* something: edit a source card and the cards generated
from it should proactively update themselves, with a visible, undoable receipt.

- **Cleanup first.** Three dead generations of provenance removed: the
  session "Based on:" store (`ask/provenance.ts` — written on every ask, read
  by nothing), the ephemeral PDF map (`pdf/provenance.ts` — redundant with the
  durable `sourcePdfId` prop), the always-empty `draft.arrowIds`, and the
  stale "drawn edges" comments. `meta.jzSources` + ProvenanceLayer is now the
  ONE lineage system; the server's unused `edge.create` is annotated as
  reserved for the summon UI (map it onto jzSources, not arrows).
- **Auto-sync shipped (`ask/sync.ts` + `SyncLayer.tsx`).** Answers now also
  record their ask in `meta.jzPrompt`. A store listener watches content props
  only (per-type whitelist — moves/resizes never trigger), debounces 2.6s of
  quiet, then re-runs the original ask **in place** on each dependent
  (forceShape pins the format) and crawls on down the chain with a visited-set
  cycle guard. One update at a time, always queued behind the human's own
  asks; streaming/suppress guards keep the engine's own writes from reading
  as user edits.
- **The receipt.** Each updated card gets a card-anchored pill in the draft
  controls' anatomy — "✦ Updated to match "Table"" with Undo (restores the
  pre-update snapshot; chained updates keep the OLDEST snapshot so Undo
  returns to the last user-approved state) and a quiet dismiss. A manual edit
  to an updated card retires its pill — the user took over.
- Verified end-to-end in the sandbox browser: table edit → summary card
  rewrote itself with the new numbers → Undo restored the original, no
  runaway re-syncs.

## 2026-07-10 (evening) — Research answers stop being text-only

**Intent:** "don't restrict what comes back from web research to text" —
a research card should mix prose, tables, charts, images, tabs, whatever the
content calls for. Owner pointed at the OpenUI plumbing we already use for
dashboards.

- **The dashboard's generative-UI vocabulary grew up** (`dashboard/library.tsx`):
  `Markdown(text)` (full rich text via DocMarkdown — headings, bold, citation
  links, bullets, inline images), `Image(src, caption)` (hides itself on a
  dead URL — never a broken frame), `Tabs(labels, panels)` (client-side, for
  parallel angles like Reviews / Specs / Alternatives). One grammar, one
  renderer, shared by dashboards and research.
- **Deep research now answers as a rich card.** The dossier prompt was rebuilt
  on the OpenUI grammar (`RICH_RESEARCH_SYSTEM`): verdict Markdown up top,
  then per-subject sections mixing components by what each point of content
  IS; charts only from real gathered numbers; images only from URLs the model
  actually saw. The markdown-dossier prompt was deleted outright — one
  research answer shape, not two.
- **Web images stopped being fragile.** New SSRF-guarded `/api/image`
  cache-proxy: any remote image a generated card cites is fetched once
  server-side into the asset store and served same-origin (hotlink
  protection, CORS, dead URLs all survive). Doc-card markdown images route
  through it too, and plain web-grounded asks are now invited to embed
  genuinely illustrative images they saw.
- Verified with a live model: "research the Hubble Space Telescope" produced
  a card with a cited verdict, four KPI tiles (36 yrs / 22,000+ papers / 6:1
  demand / $98M cost), a Hubble-vs-JWST cost chart, and four tabs including a
  comparison table — and the deliberately dead image hid itself.
- Gotcha for future evals: Playwright's synthetic click can't reach buttons
  inside a card (tldraw's background intercepts the pointer pipeline);
  dispatch DOM `.click()` in an evaluate instead. Also: this sandbox blocks
  ALL server-side outbound fetches (even link previews 403) — the proxy's
  fetch leg needs a normal environment to test.
- **Follow-up (same evening):** owner called out that images were only
  *possible*, not *reliable* — and that a sparse image floated with dead space.
  Added `find_image`: a client tool in the research generation loop that
  searches Wikimedia Commons (relevance-ordered, photo mimes only, license +
  attribution carried) so the model gets REAL image URLs instead of hoping a
  page exposed one; the sidecar prompt carries a web-fetch fallback to the
  same API. Card images became true heroes: full content width, 21/9 crop,
  caption beneath. Chart width now derives from data density (a slot per
  bar/point, shrink-only CSS) after "two bars filled the card".
- **Second follow-up:** "still looks hand-rolled — can we do Google-grade
  images?" → find_image became a provider chain: Google Programmable Search
  (image mode, behind GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID) wins
  outright; else the keyless open trio in parallel — Wikipedia lead images
  (the canonical photo of any notable subject), Wikimedia Commons, Openverse
  (~800M CC images) — merged in that order, de-duped, skip-not-fake on empty.
  All four parsers fixture-tested; the live round-trip is untestable in this
  fully-offline sandbox, so the first research ask on a real machine is the
  acceptance test.

## 2026-07-10 (night) — "Try it free" opens with the question, not a finished board

**Intent:** the owner clicked "Try it free" on the marketing site and landed on
the pre-seeded demo board — "what happened to the flow where it asks what
you're using it for, and the cards disappear as I type?" Nothing had been
removed: the intent-first onboarding (persona ask + ambient scene) shipped in
#29/#31 and was live, but the CTA linked to `?demo=1`, which deliberately
suppresses onboarding, and the persona ask is ask-once per browser. The owner
called it: the CTA should land in the "What brings you here?" flow.

- Added a **fresh-start entry, `?start=1`** (`boards/freshStart.ts`), and
  pointed all three "Try it free" buttons at it. It guarantees the first-run
  experience for *everyone*: re-arms the ask-once persona question
  (`resetPersona()`), and if the visitor's active board is already in use,
  quietly creates a brand-new board — existing boards stay untouched in the
  switcher. Runs pre-mount (main.tsx) because the active board decides
  tldraw's persistenceKey at first paint; the param is then stripped from the
  URL so a refresh doesn't stack a board per reload.
- `?demo=1` itself is unchanged — the seeded SWOT board remains available for
  anything that still links to it; it's just no longer the front door.
- Verified end-to-end in the sandbox (production build + Playwright): first
  visit shows the modal over the live ambient scene; a persona pick re-themes
  the starters; typing hushes the ambient cards; and — the case that prompted
  this — a browser that had already explored the demo board still gets the
  full onboarding through the new door.
- Trade-off noted: first-time visitors no longer see finished artifacts
  instantly; the ambient scene + self-typing composer now carry the "show
  intelligence early" job. If that proves too subtle, a themed seed *after*
  the persona pick is the natural follow-up.

## 2026-07-10 (night) — Tables join the rich club

**Intent:** "table mode should have web enrichment too — real-time data from
the web, and images in the table if applicable."

- Tables already reached the live web (prices/ratings/availability via
  web_search/web_fetch); what they lacked was images. The `find_image`
  provider chain is now offered on the table path too — `generate()` (the
  non-streaming loop) learned the same client-tool handling `generateStream`
  got for research.
- Prompt: rows of VISUAL things (products, places, devices…) earn an "Image"
  first column, one `![name](url)` per row, URLs verbatim from find_image or
  fetched pages; the column is skipped for non-visual grids and the
  clause-diff table stays text-only. Cell caps got URL headroom (500 chars
  for cells carrying image/link tokens) so a thumbnail URL can't be sliced.
- Client: cell thumbnails route through the `/api/image` cache-proxy and hide
  on error — same no-broken-frames rule as the rich card hero.
- Browser-verified: image column renders thumbnails, a dead web URL degrades
  to an empty cell, link chips intact.

## 2026-07-10 (late night) — Everyday answers earn images too

**Intent:** "extend find_image to everyday doc answers — if the response
warrants it."

- The find_image bundle became one shared const (`FIND_IMAGE_CLIENT`) offered
  on every web-enabled path: research, tables, and now plain doc/list asks.
- WEB_DIRECTIVE gained a judgment gate: ONE image when the answer centres on
  something visual (place, product, artwork, person); analysis/plans/how-tos
  skip freely; never invent a URL, ship imageless when nothing real came back.
- Doc-card markdown images hide on error — same no-broken-frames rule
  everywhere.
- Live sidecar test (the Lake Bled ask through the real prompt bar) showed the
  honesty rule end-to-end: the sandbox blocked the fetch, and the model
  declined to fake a URL — noting it in the card instead of inventing one.

## 2026-07-11 (later) — Rich cards give up their pieces: drag out

**Intent:** "can I drag a table or image out of a rich card into a new card?"
→ build drag-out first (drop-in composition comes later).

- Every extractable block inside a generative-UI card — table, image, prose
  section, chart — grows a quiet grab handle on hover (`dashboard/extract.tsx`
  + wrappers in `library.tsx`). Drag it onto the canvas and it lands as a
  REAL card of the right type: table → editable table-card, image →
  image-card (proxied URL travels), prose → doc-card (raw markdown; the doc
  card re-proxies images itself), chart → a mini one-statement dashboard-card.
  Instant — the data is already in the rendered spec, no model round-trip.
- Extraction inherits the day's lineage system for free: the new card records
  the rich card in `meta.jzSources`, so click-to-reveal provenance and
  auto-sync treat it like any other derived card.
- Mechanics: handle pointerdown stops propagation (tldraw never mistakes it
  for a card translate), a ghost pill rides the pointer, Escape cancels,
  release must land on the canvas outside the host card. Import note: the
  library pulls card sizes from specific shape files, not the shapes barrel —
  the barrel imports the dashboard util which imports the library (cycle).
- Verified in the browser against the real Hubble research spec: table (3×6,
  from inside a tab) and image both extracted with lineage intact.

## 2026-07-11 — Card actions audit: real icons, honest Regenerate

**Intent:** "audit all the actions shown on the card types — is Regenerate on
a doc card valid? And give every action a proper icon; only the flowchart had
one and it looked generic."

- Every entry in the card bar's Actions and ⋯ menus now leads with a lucide
  icon (14px, muted `--jz-ink-500` in a fixed 16px column, same sizing as the
  format row) — replacing the mixed text glyphs (✦ ◇ ⤢ ↻ ✎ ⧉ 🗑) that only
  some actions carried. The ✦ Actions / ✦ Summary bar buttons use the
  Sparkles icon proper. Flowchart got `Workflow` (a real flowchart glyph).
- Regenerate audit verdict: valid only on cards **Jarwiz generated** — it
  re-runs the ask in place, so on a hand-typed doc it read as "the AI will
  overwrite my writing". Now gated on the card's recorded lineage
  (`meta.jzPrompt`/`meta.jzSources`, the same provenance auto-sync uses).
  Prototype and dashboard cards keep it unconditionally (they're always
  generated). Known gap for a follow-up: the Analyze/Cluster paths don't
  record provenance yet, so their docs won't offer Regenerate until they do.
- Browser-verified both ways: generated doc shows the full menu with icons
  incl. Regenerate; hand-written doc shows the same menu without it.

## 2026-07-11 — Sources are sacred: paste-to-attach + honest provenance (G2)

**Intent:** from the product review's top finding — "the transcript never
lands on the board" — the owner specced: pasted text joins the composer as a
dismissible attachment, renders on canvas as a truncated doc card opening in
focus mode, and lineage links only what a generation *actually used*
("just because it was attached doesn't mean it's a source").

- A long multi-line paste into the composer becomes a **text attachment chip**
  (the same pipeline files already used — `AttachmentKind` grew `'text'`),
  dismissible before send; the prompt input stays clean and the placeholder
  invites the instruction ("What should I do with this?").
- On send it materializes as a normal doc card flagged `meta.jzSourceDoc`:
  renders a ~550-char preview with a fade + **"View more · N more lines"**
  that opens the existing focus-mode reader. Checkbox toggling disables on
  truncated previews (ordinals would desync against the full text).
- **Honest provenance:** with sources riding along, the model ends its answer
  with one machine-read `SOURCES_USED: 1, 3` line (tables: a `usedSources`
  JSON key). The server strips it mid-stream (a prefix-hold filter that never
  delays prose) and re-emits it as a new `sources.used` AskEvent; the client
  prunes `meta.jzSources` to just the declared-used cards — including down to
  empty (attach transcript, ask about OKRs → source card on board, no
  hairline). Verified live end-to-end, positive and negative cases.

## 2026-07-11 (later) — First-touch entry points (G1)

**Intent:** the review's first-five-minutes fixes, with the owner's mode-pill
calls: one chip behaviour (no "Suggested:" label split), tappable body,
narration-style intro preview, cadence untouched.

- **On-ramps are real buttons.** "drop a PDF / paste a link / paste a
  transcript" were `pointer-events: none` decoration styled as pills — every
  new user's first click was dead. Now: PDF opens a file picker into the
  composer-attachment pipeline; the paste on-ramps focus the composer with a
  transient placeholder hint ("Paste your transcript here (⌘V)…").
- **The mode chip has ONE behaviour** whoever pinned it: clicking the body
  opens the "/" picker (the natural gesture on a wrong guess), ✕ clears to a
  doc. No label distinction between guess and pick (owner call).
- **The intro preview reads as narration** — the self-typing placeholder's
  shape preview renders ghosted/dashed as "→ Table", visibly part of the
  animation, so the first solid chip a user sees is a real control.
- **Boards panel paints above the ambient vignettes** (panel joined the
  chrome layer, z 160 over the scene's 150).

## 2026-07-11 (evening) — Chrome overlap polish (G4)

**Intent:** the review's five overlap paper cuts, taken one by one — each
reproduced on current main before fixing, each re-verified after.

- **Keep/Discard never covers content.** The draft bar's dock clamp used to
  pull it up over a tall card's body. `useCardAnchor` grew `flipWhenCovered`:
  when the clamp engages the bar flips above the card's top edge, and for a
  card taller than the viewport it pins to the top strip (44) over the card's
  padding band — never mid-content. Verified across a full streaming run
  (14 samples, zero content overlaps).
- **Dock pills stand down while a draft exists** (streaming or Keep-pending)
  — they describe the previous card and floated over the fresh artefact.
- **The card bar's menu is scoped to the selection moment.** The bar stays
  mounted across selections, so an open menu used to resurrect over whatever
  card got selected next (including auto-selected generations). Now it resets
  on selection change and closes on Escape / outside pointer-down.
- **The avatar clamps to the viewport** — badge included — so it can't park
  half off-screen at an edge.
- **The send button relaxes into a pill when busy** ("Planning…",
  "Scanning…") instead of spilling its label out of the 30px circle.
