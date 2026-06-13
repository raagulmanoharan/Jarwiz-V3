# Jarwiz — Roadmap

_Owner: Product · Last updated: 2026-06-13 · Status: living document_

Companion to [VISION.md](./VISION.md), [ARCHITECTURE.md](./ARCHITECTURE.md),
and [DESIGN.md](./DESIGN.md). This is the product roadmap: where we are, where
we're going, and the bar each step has to clear.

---

## 1. Thesis

The chat box was the command line of AI. Jarwiz is the GUI moment: thinking
happens **on a canvas**, and the collaborators are agents you can see working —
not a text stream you wait on. Two bets, in order of importance:

1. **Presence is the product.** The felt sense that a capable teammate is on
   the board with you — moving, working, leaving artifacts — is the moat. If we
   cut anywhere, never here.
2. **The board is the memory.** Every artifact is a card; every card remembers
   where it came from. The graph of cards _is_ the record of how you thought.

Competitors validate the space (Cove, Kuse, tldraw-based tools) but compete on
features. **We compete on craft and presence.** A board that feels alive and
beautiful beats a board with one more agent.

---

## 2. Where we are (shipped)

| Milestone | State | What works |
|---|---|---|
| **M0 — Foundation** | ✅ | Monorepo, infinite tldraw canvas, card shapes (link/yt/image/pdf/note), drop-paste ingestion, SSRF-guarded previews, SSE protocol |
| **M1 — First live agent** | ✅ | Agent runtime (Anthropic tool-use loop → SSE), Summarizer end-to-end, live presence (cursor + dock + streaming doc card), proactive "Summarize this?" offer |
| **M2 — The crew** | ✅ | Researcher (web_search) + Brainstormer, multi-select summoning, free-space placement, agent-colored provenance edges |
| **M3 — Writer** | ✅ | Writer agent synthesizes the selection into one long-form draft, connected back to every input with green "drawn from" edges; in-place doc editing. Completes golden-path steps 5–6 |
| **Craft C0/C1** | ✅ | Token foundation; editorial surfaces (Fraunces+Inter, dot-grid paper, cards, empty state) |
| **Craft C2** | ✅ | Cinematic presence: dock removed; Figma-style agent avatars; card materialization; streaming caret; refined edges |
| **Craft C3** | ◐ | ⌘K command palette (shows "what the agent sees"), demo-mode badge, first-run ⌘K nudge. Remaining: full onboarding, more error-state design |

Golden-path **steps 1–6** work end to end. The plumbing is sound and the craft
bar is rising. Next: finish C3 flows, then **M4 Autopilot** (§9), then C4.

---

## 3. The initiative: "Craft" (this roadmap's focus)

> Elevate Jarwiz from _functional prototype_ to _product people screenshot and
> share_ — without adding agent count. Evolve the signature look (warm but
> ownable, editorial), make presence cinematic, and make every state — empty,
> working, error, dense — feel considered.

Calibration bar: **Arc / editorial typography** for point of view, **Cove &
Kuse** for AI-canvas interaction craft, **FigJam** for presence feel.

### Phase ordering (why this sequence)

Foundation before surfaces, surfaces before flows, flows before delight. You
cannot polish a button on top of an ad-hoc token system; you cannot choreograph
a flow whose components aren't yet crafted.

---

## 4. Phases

### Phase C0 — Cleanup & design-system foundation `← in progress`
**Goal:** one source of truth for the visual language; remove drift and dead
code so every later pixel inherits quality for free.

- Design tokens: a real **type scale** (editorial display + UI sans), warm
  **color ramp**, **spacing/radius/elevation/motion** scales — as CSS custom
  properties, documented in DESIGN.md.
- Retire ad-hoc values scattered across components; everything references
  tokens.
- Code hygiene: kill stale "arrives in M1" comments, dead props, duplicated
  geometry; consistent component file shape; a `ui/` primitives layer.
- Typography swap: load the new display + UI families; wire `--jz-font-*`.

**Exit:** `grep` finds no raw hex/px in component files for themeable values;
the board looks materially more refined with zero new features; typecheck +
build + M1/M2 e2e still green.

### Phase C1 — The surfaces (chrome & cards)
**Goal:** every persistent surface is crafted to the new bar.

- **Canvas:** refined paper — warm base, optional dot-grid, subtle grain;
  considered selection/hover treatments.
- **Cards:** rebuilt hierarchy and type for every kind (link, youtube, image,
  pdf, note, doc); crafted loading/skeleton; consistent headers, footers,
  affordances; the doc card reads like an editorial document.
- **Dock:** from utilitarian strip to a calm, beautiful presence bar with real
  idle/active/working states.
- **Topbar / wordmark:** a signature mark, not a label.

**Exit:** a screenshot of any single card or the dock could ship in a landing
page. Visual QA against DESIGN.md component specs passes.

### Phase C2 — Presence, made cinematic
**Goal:** the differentiator becomes unmistakable.

- **Agent cursors:** named, colored, with smooth arrival, a working "thinking"
  pulse, and a tasteful trail/anchor to the active card.
- **Status language:** honest, specific, beautifully typeset; status travels
  with the cursor and the dock in sync.
- **Card materialization:** cards arrive with intention (not a pop); streaming
  text has a living caret; completion has a quiet settle.
- **Edges:** provenance edges draw on with motion, in agent color, legible at
  any zoom.

**Exit:** a 10-second screen recording of one summon feels like magic to a
first-time viewer. Motion obeys the system (durations/easings), respects
`prefers-reduced-motion`.

### Phase C3 — Flows & first-run
**Goal:** the product explains and sells itself in the first 60 seconds.

- **Empty state:** a cold board invites the golden path — not a blank void.
- **Onboarding:** a single, skippable, non-modal guide to the first summon.
- **Summon UX:** evolve "Ask an agent" into a fast, delightful surface
  (contextual + ⌘K command palette); Kuse-style precise "what the agent sees".
- **Honest system states:** offers, errors, rate limits, empty results, the
  no-API-key demo mode — all designed, never raw.

**Exit:** a new user with no instructions reaches a streamed artifact on their
first session. Every error path has a designed state.

### Phase C4 — Signature & delight (ongoing)
**Goal:** the memorable moments that make it _Jarwiz_.

- Micro-interactions, sound-off delight, the "board comes alive" first-agent
  moment, export/share that looks intentional, dark/editorial mode exploration.

**Exit:** at least three "signature moments" land that no competitor has.

---

## 5. Interaction with product milestones

Craft and capability interleave, they don't block each other:

- **M3 — Writer + doc editing** (from ARCHITECTURE.md) lands _on top of_ the
  C1/C2 foundation, so the Writer's document card is born world-class.
- Golden-path **steps 5–6** (Writer synthesis + in-place editing) complete the
  acceptance scenario once C-phases give them a surface worthy of it.
- **M4 — Autopilot (Tab-to-continue)** — the signature capability: press Tab
  and an agent picks up your cursor and pen, filling in the artifact you're
  authoring (a plan, a script, a table) live and multiplayer-style. Specced in
  full in §9. Depends on M3 (editing substrate) and C2 (avatars + caret, now
  shipped).

Recommended order: **C0 → C1 → C2 → (M3 + C3 together) → M4 → C4.**

---

## 6. What "world-class" means here (success signals)

Not vanity. Observable bars:

- **Screenshot test:** any frame of the product is share-worthy without
  cropping or apology.
- **First-summon awe:** a first-time viewer reacts to the presence moment.
- **Zero raw states:** no un-designed empty/error/loading screens remain.
- **Coherence:** every surface visibly belongs to the same system (type, color,
  motion, spacing) — verifiable against DESIGN.md.
- **Performance:** presence motion holds 60fps on a mid laptop; canvas stays
  fluid at 100+ cards.
- **Accessibility:** AA contrast on text, full keyboard path to summon,
  reduced-motion honored.

---

## 7. Risks & mitigations

- **Polish sprawl** (craft is infinite) → phases have exit criteria; ship per
  phase, don't gold-plate.
- **Token churn breaks layout** → land C0 behind green e2e; visual-diff
  screenshots before/after.
- **Motion over-design** → every motion cites a system token and a purpose;
  reduced-motion is a first-class path.
- **tldraw constraints** → custom shapes already own their rendering; chrome
  lives in overlays we fully control.

---

## 8. Definition of done (per change, going forward)

1. References a design token — no magic values.
2. Has a designed state for empty / loading / error where applicable.
3. Keyboard-reachable and AA-contrast.
4. Motion respects the system + reduced-motion.
5. typecheck + build + e2e green; a screenshot is attached to the PR.

---

## 9. M4 — Autopilot (Tab-to-continue) `proposed`

> You're authoring on the board — a launch plan, a cold-outreach script, a
> comparison table. You've written the title and a stub or two. You press
> **Tab**. An agent glides in, takes the pen, and **continues the artifact in
> place** — you watch its cursor move and the fields fill, the way a teammate
> would in a multiplayer doc. Keep typing to take the pen back; Esc to stop.

This is the sharpest expression of the thesis. Where today's agents hand you a
_finished card_, Autopilot lets an agent _co-author the card you're already in_.
It collapses the gap between "thinking" and "the agent helping you think" to a
single keystroke, and it is **pure presence** — the agent literally shares your
cursor. No competitor's chat box can do this; few canvases dare to.

### 9.1 The product insight

A huge share of real work isn't "summarize this" — it's **structured
authoring**: you start a scaffold (a heading, a few bullets, column names, the
first line of a script) and grind out the rest. Chat-box AI forces a context
switch: describe what you have, copy the reply back, reformat. On an infinite
canvas the agent can simply **continue from your caret, in the artifact, where
you are** — and because Jarwiz already renders agents as present collaborators
(avatars, gliding cursor, streaming caret from C2), the continuation _looks and
feels_ like a person working beside you, not a result being pasted in.

### 9.2 User journeys

1. **The plan.** User drops a note titled "Beta launch plan" and types three
   bullet stubs. Presses Tab. The agent's avatar glides to the card, the caret
   turns its color, and it extends the plan — milestones, owners, rough dates —
   bullet by bullet. The user edits a date inline; the agent yields instantly,
   then resumes on the next Tab.
2. **The script.** A doc card "Cold outreach — Series A founders" with one
   opening line. Tab. The agent continues the script in voice, paragraph by
   paragraph, caret streaming. Tab again to push past where it stopped.
3. **The table.** User makes a comparison table card with headers
   `Tool · Price · Strengths · Watch-outs` and one filled row. Tab. The agent
   fills the remaining rows **cell by cell**, its cursor hopping across the grid
   like a collaborator tabbing through a spreadsheet.

### 9.3 Needs vs. wants

- **Needs:** finish structured artifacts without leaving the canvas or
  round-tripping through chat; stay the author (accept / reject / steer); trust
  what the agent is reading.
- **Wants:** to _feel_ a capable teammate working with them (the multiplayer
  moment); momentum — one key keeps the work flowing; the artifact stays whole
  and in place, never a sidecar.

### 9.4 Interaction model (control is the whole game)

The feature lives or dies on the user never feeling hijacked. Rules:

- **Tab** — trigger Autopilot at the caret; while running, Tab = _accept the
  current run and continue_ (extend further).
- **Type anything** — instantly reclaim the pen. The agent yields mid-stream,
  no confirmation, no fight. This is the trust contract.
- **Esc** — stop Autopilot, keep what landed.
- **⌘Z** — one continuation = one undo step. A whole autopilot fill is
  reversible in a single stroke; the board is never left in a half-state.
- **Insert, don't overwrite.** The agent only adds at/after the caret (or into
  empty cells); it never silently rewrites text the user typed.
- **Visible reading.** Before it types, the agent shows _what it sees_
  (this card + nearby/linked cards) — the same Kuse-style transparency as the
  ⌘K palette — so the continuation is never a black box.

Open question to validate with users: **ghost-preview vs. live-commit.**
Copilot-style dimmed "ghost text" that Tab commits is safer; live multiplayer
typing is more magical and on-thesis. Lean live-commit (bounded + instantly
interruptible + single-undo), prototype both, let the awe test decide.

### 9.5 What it reuses (cheap because C2 shipped)

- **Avatar + glide** — the agent parks its avatar on the card it's autopiloting.
- **Streaming caret** — already agent-colored; becomes the literal authoring
  caret during a fill.
- **SSE runtime + emit()** — Autopilot is a run whose deltas target an
  _existing_ card/field instead of creating a new one. The wire protocol needs
  a field/anchor target, not a new transport.

### 9.6 Phasing

- **A0 — Prose continue.** Tab inside a note/doc card; agent continues the text
  at the caret, streaming with its caret + parked avatar. Yield-on-type, Esc,
  single-undo. _Exit: a first-timer presses Tab in a half-written note and
  audibly reacts._
- **A1 — Structured cards.** Introduce a **table/list card** kind; Autopilot
  fills cells/rows, cursor hopping fields. _Exit: a 4-row comparison table
  fills itself, legibly, cell by cell._
- **A2 — Steering.** Partial accept (Tab a word/line), inline ghost-preview
  option, per-field re-roll, multi-field plan fills. _Exit: a user can shape a
  long plan with Tab/Esc alone, never touching a menu._
- **A3 — Proactive autopilot.** When the agent detects a scaffold (empty table
  rows, a heading with no body), it _offers_ to continue — consent-first, same
  as today's "Summarize this?" chip. _Exit: offers convert without feeling
  pushy; dismiss rate stays low._

### 9.7 Risks & mitigations

- **Runaway generation** → bounded continuations (a few bullets / rows / a
  paragraph per run), always interruptible, one undo.
- **Feels like hijacking** → yield-on-type is sacred; insert-only; the agent
  parks _near_ the caret, never wrestles it.
- **Latency dulls the magic** → stream tokens immediately; show avatar
  "thinking" pulse for the gap, then type.
- **Structured-card scope creep** → ship prose (A0) before the table card; the
  table is its own design problem (resize, overflow, edit) gated behind A1.
- **Discoverability** → first-run hint already teaches one shortcut (⌘K);
  add a contextual "Tab to continue" ghost affordance inside an editing card.

### 9.8 Definition of done (M4)

Beyond §8: yield-on-type is instantaneous and never drops a keystroke; every
fill is a single undo; the agent's "what I see" is inspectable before it types;
motion (glide, caret, cursor hops) obeys the system and reduced-motion; a
10-second recording of a Tab-fill reads as _a teammate writing with you_.
