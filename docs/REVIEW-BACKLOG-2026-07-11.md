# Review backlog — grouped for agent execution

Every finding from `docs/PRODUCT-REVIEW-2026-07-11.md`, turned into buildable
work. Grouped so each group is **one branch → one PR** (per
`docs/WORKFLOW.md`), sized to land together, and specced so an agent session
can pick a group up cold. Recommended order: G1 → G4 → G2 → G3 → G5 → G6.

Ground rules for whoever builds these:

- One group per PR. Don't mix groups even if the diff is small.
- Every group ships with typecheck + build green, and a screenshot (or an
  honest "please click X and confirm Y") per `CLAUDE.md`.
- Tokens over magic values; new cards keep the `*-card` naming convention.
- Respect the owner call of 2026-07-05: **no persistent provenance clutter**
  on the canvas. G2 works within that decision, it does not reverse it.

---

## G1 — First-touch entry points *(small, do first)*

The first five minutes of a new user's life. Three fixes, one surface.

1. **Make the onramp pills live.** `drop a PDF / paste a link / paste a
   transcript` under the hero are styled as buttons but are
   `pointer-events: none` decoration (`.jz-pb-onramp` in
   `apps/web/src/styles/index.css`, rendered by
   `apps/web/src/ask/PromptBar.tsx`). Wire them: *drop a PDF* opens a file
   picker (route into the existing ingest path,
   `apps/web/src/ingest/registerIngestion.ts`); *paste a link* and *paste a
   transcript* focus the prompt with a mode-appropriate hint (or open a paste
   sheet). Keyboard-reachable, hover state, cursor pointer.
2. **Mode pill legibility.** The Board/Diagram/Table pill auto-cycles with the
   placeholder and reads as a setting the user chose. Label it as a suggestion
   (e.g. prefix "Suggested:"), freeze it once the user starts typing, and make
   the detected mode for *real* input visible before send
   (`apps/web/src/ask/modeShape.ts`, `boardIntent.ts`, `PromptBar.tsx`).
3. **Empty-state vignette vs boards panel.** The decorative corner cards
   overlap the opened boards panel (see
   `docs/assets/qa/review-0711-empty-state.png` vs panel-open state). Fix the
   stacking/layout so the panel always wins (`apps/web/src/ui/EmptyState.tsx`,
   `SidePanel.tsx`).

**Acceptance:** a new user can click each onramp and end up in the right
flow; the mode pill never changes under a typing user; boards panel renders
above/beside the vignettes cleanly.

## G2 — The source is sacred *(medium — the differentiator group)*

The transcript I pasted produced great artifacts and then vanished — the
board can't answer "what did Marco actually say?". Lineage exists
(`meta.jzSources` + select-to-reveal hairlines in
`apps/web/src/ask/ProvenanceLayer.tsx`) but a new user never discovers it.

1. **Pasted long text lands as a source card.** When the prompt submission
   includes pasted text above a threshold (say ~400 chars of multi-line
   content), also create a collapsed **source card** on the board (doc-card
   with a "Source" treatment, title auto-derived — "Product sync — Jul 9"),
   and record it in the artifact's `meta.jzSources` via
   `useAsk.recordSources` (`apps/web/src/ask/useAsk.ts`) so the existing
   ProvenanceLayer picks it up. The artifact is the star; the source arrives
   collapsed and calm.
2. **Lineage discoverability.** Add a small "built from N sources" affordance
   on cards that have `jzSources` (title-tag area,
   `apps/web/src/ui/CardTitleTag.tsx` / shape chrome). Hover or tap = the
   same hairlines the ProvenanceLayer draws on selection today. No persistent
   arrows — this stays within the 2026-07-05 owner call.
3. **Lineage on pill runs.** Verify (and fix if missing) that
   suggestion-pill runs ("Scan for tensions") record their input cards as
   sources, so the Tensions card's hairlines reach both docs it read.

**Acceptance:** paste transcript → artifact + collapsed source card; select
artifact → hairline to source; every generated card shows its "built from"
affordance; pill-generated cards have sources too.

## G3 — Generation feel *(medium)*

~15 s of silence before the first token, and new artifacts land half
off-screen. The bones exist; wire them.

1. **Narrated status.** The wire protocol already has a `status` event —
   drive it with honest stages from the ask/compose paths
   (`apps/server/src/compose.ts`, `ask.ts`): "Reading the transcript…",
   "Found 6 action items…", "Drafting the plan…". Web renders whatever
   arrives (`presence.ts` chip + the Generating chip in `PromptBar.tsx`).
   Honest text only — no fake progress (VISION principle 3).
2. **Camera frames the new artifact.** `apps/web/src/ui/bringIntoView.ts`
   already solves this for rail spawns — call it (or a gentler pan-only
   variant for mid-stream) when an ask/compose artifact is created in
   `useAsk.ts`. The launch-plan table in the review rendered partly outside
   the viewport.
3. **Streaming skeleton.** Between card.create and the first delta, show a
   subtle skeleton/shimmer in the card body so the card never sits as a
   1-character husk (doc/table shape utils, `streaming.ts` store).

**Acceptance:** every generation narrates at least 2 honest stages; a new
artifact is always fully in view at readable zoom; no empty-looking card
during first-token wait.

## G4 — Card chrome overlap polish *(small — bundle of paper cuts)*

All cosmetic, all real, all seen in one 20-minute session. One PR.

1. **Keep/Discard bar** (`apps/web/src/ask/DraftControls.tsx`) floats over
   card content — anchor it below the card bounds (or in the title row),
   never over text/cells.
2. **Stale suggestion pills** from a previous card linger over a newer card
   and the avatar. Dismiss/suppress a card's pills when another generation
   starts or the card is no longer relevant (`apps/web/src/ask/suggestShape.ts`
   + pills layer).
3. **Actions ▾ menu persistence** — the menu re-appeared open over a card
   during a later generation after Escape had closed it. Close on Escape,
   outside-click, and on any generation start (`apps/web/src/ask/CardActionBar.tsx`).
4. **Avatar parking** — Jarwiz's chip parks half off-screen at the viewport
   edge; clamp the parked position to the visible viewport
   (`apps/web/src/agents/AgentCursorLayer.tsx` / presence store).
5. **Send-button spinner** overlaps the status text in the prompt bar during
   pill runs (`PromptBar.tsx` layout).

**Acceptance:** a full transcript → plan → tensions run with zero overlapping
chrome at 1440×900, light and dark.

## G5 — Meeting debrief recipe *(medium-large — builds on G2)*

The review's use case, productised: transcript in → a small connected cluster
out, in one shot. This also makes good on the hero's "I'll lay it out as a
board" promise (today a transcript yields one card).

- Detect transcript-like input (speaker-turn pattern) in the intent path
  (`apps/web/src/ask/boardIntent.ts` + server response shapes — see
  `docs/RESPONSE-SHAPES.md`).
- Output: **Decisions**, **Action items** (checklist), **Risks / open
  questions** as separate cards laid out as a cluster, each with
  `jzSources` → the source card from G2; camera frames the cluster (G3).
- Offer it, don't force it: if detection is confident, the mode pill reads
  "Suggested: Debrief" and the user can switch back to a single doc.

**Acceptance:** pasting the review's sample transcript produces the cluster
with correct owners/dates, lineage hairlines from each card to the source,
and one tap switches to single-doc mode instead.

## G6 — Find it, take it away *(medium — two features, one theme: value at scale)*

Fine at 3 cards, dead at 40. Can be split into two PRs if the diff grows.

1. **Board-wide search.** The magnifier today is only the zoom menu
   (`apps/web/src/ui/Topbar.tsx`). Add search over card titles + text: ⌘K or
   the magnifier opens an input, results jump the camera
   (`bringIntoView`) and flash-highlight the match. (The review also
   couldn't trigger any ⌘K palette — reconcile with whatever ⌘K is meant to
   do today.)
2. **Export / egress.** Artifacts are trapped on the canvas. Per-card **Copy
   as Markdown** in the card's overflow menu (`CardActionBar.tsx`) — doc
   cards copy their markdown, tables copy a markdown table; board-level
   **Export board as Markdown** next to Back up in the side panel
   (`SidePanel.tsx`).
3. **Docs drift pass** (rides along): update `docs/FEATURES.md` — remove or
   flag @mentions, comment threads, and always-on multiplayer until they're
   surfaced again.

**Acceptance:** typing a word from any card in search lands the camera on it;
Copy as Markdown round-trips the launch-plan table into a valid markdown
table; FEATURES.md matches the shipping product.

---

## Deliberately not scheduled

- **History/log surfacing** — the log exists (bottom-left counter). Revisit
  after G2/G5 make cascades more common; an inspectable "what changed and
  why" view is the likely shape.
- **Thinking Machines contextual surfacing** — right idea, needs a design
  pass first (when does a machine pitch itself on an existing artifact
  without becoming clippy?). Park until G5 shows how recipes feel.
- **Latency itself** — sidecar mode exaggerates absolute numbers; G3's
  narration addresses the felt problem first. Re-measure on the production
  path before optimising.
