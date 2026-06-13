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

Golden-path **steps 1–4** work. The plumbing is sound. **What's missing is the
craft** — the product works but doesn't yet _feel_ world-class. That is the
subject of the next initiative.

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

Recommended order: **C0 → C1 → C2 → (M3 + C3 together) → C4.**

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
