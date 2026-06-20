# Canvas Pivot — from card-first to FigJam-grade

> Source: product pivot session, 20 June 2026.
> Framing: "Right now we think everything in terms of cards. But FigJam lets me
> add shapes, arrows, freeform text — primitives I can tweak, flowcharts I build
> by hand. I want that experience. Reimagine everything we've built like FigJam."
> Decision: **write the plan first** (this doc), and aim the north star at agents
> that both **read and build** primitives — a full FigJam-grade collaborator.

---

## The headline

This pivot is far cheaper than it looks, because **tldraw already *is* a
FigJam-grade canvas — we deliberately switched the FigJam parts off** to keep the
early product calm and card-focused.

In `apps/web/src/App.tsx` the chrome is suppressed by hand:

```ts
Toolbar: null, StylePanel: null, QuickActions: null, MainMenu: null, …
```

The engine underneath is untouched. tldraw ships native geo shapes, free text,
connectors, freehand draw, frames, and lines, and they are still registered in
our store — the proof is that **arrows already work**: provenance edges are real
tldraw `arrow` shapes, and `autopilotStore.ts` reads `s.type === 'arrow'` straight
off the page. We never removed the primitives; we removed the *UI to create them*.

So the work is mostly **"turn the engine back on, then teach the agents to see and
use it"** — not a rebuild.

---

## The reframe: one board, two tiers

Today the model is *card-first*: every human or agent artifact is a card, and the
AI only understands cards. FigJam is *canvas-first*: the surface is full of cheap,
tweakable primitives and structure emerges from arrangement.

We adopt **one unified "thing on the board" model with two tiers:**

- **Primitives** (FigJam-native, human-first) — sticky notes, free text, shapes
  (rect / ellipse / diamond / …), connectors, freehand draw, frames / sections,
  lines. Cheap, directly manipulable, styleable.
- **Rich cards** (Jarwiz-native, content-first) — doc, table, PDF, link, image,
  diagram, affinity. "Smart shapes" with their own internal editor and agent
  affordances.

**The rule for which is which:** primitives are visual / structural / freeform;
rich cards are structured content with an internal editor.

**The principle that makes it cohere:** *everything on the board is selectable,
connectable, askable, and is context for the AI.* A hand-drawn box with a label
must feed an agent exactly as much as a doc card does. This is the whole pivot in
one sentence.

---

## North star

A user can sketch a rough flowchart by hand — boxes, arrows, a few labels — select
it, and say "make this real." An agent reads the sketch *as a graph*, cleans the
geometry, aligns and labels it, and can extend it. The same agent, asked "what's
missing from this flow?", answers by pointing at the actual shapes. Humans and
agents work the same freeform surface; what makes the agents agents is their
powers, not a separate UI. (This is the VISION north star, finally on a canvas
worthy of it.)

---

## What changes, system by system ("touch everything")

### Canvas chrome — `App.tsx`
Reintroduce a Jarwiz-styled toolbar (select · text · sticky · shapes · connector ·
draw · frame) and a calm style panel so primitives are tweakable (color / fill /
stroke / font). This is where most of the *visible* work lives. We must also
reconcile keyboard shortcuts: we bind `d` (doc) and `n` (note) at the window
level, which collide with tldraw's `d` (draw) and sticky tools. Decide one map and
own it.

### Board-context gathering — `apps/web/src/agents/autopilotStore.ts`
Highest-leverage AI change. `CARD_TYPES` is a hard whitelist of `*-card` types and
`extractCardText` cannot see a native shape, a text element, or a connector label.
**The flowchart you draw is invisible to the AI today.** Generalize the extractor
to read native text / geo / sticky content and connector labels, and to follow
connectors (not just card-bound arrows) when walking "connected" context.

### Selection & Ask — `apps/web/src/ask/SelectionAsk.tsx`, `useAsk`
Ask must work on *any* selection — a shape, a text element, a sketch, or a mixed
bag — not only cards. The selection→context serializer generalizes the same way
the context-gatherer does. `RunCard` / `CardKind` in the protocol grow to describe
primitives, not just the seven card kinds.

### Agent runtime tools — `apps/server/src/agents/runtime.ts`
Today the agent's only canvas tools are `begin_card` / `create_note` /
`create_table` / `create_link_card` / `connect_cards`. To let an agent *build a
flowchart* instead of dropping cards, add primitive tools: `create_shape`,
`create_text`, `create_connector` (with real bindings + labels), `create_frame`,
`set_style`. **Wrinkle:** the runtime's elegant trick — stream model text straight
into an open card body via `card.delta` — does not map to geo shapes. Shape
creation is input-based, so we add a second, non-streaming emission path
alongside the streaming one. The wire protocol (`AgentEvent`, `CardKind`) grows a
shape vocabulary; `mock.ts` gains matching branches so it stays demoable with no
API key.

### Provenance edges → real connectors
Today edges are provenance-only. In FigJam, connectors are first-class content.
Merge them: one connector primitive serves both the user's flowchart and the
agent's provenance arrows, distinguished by style/metadata, not by being two
different concepts.

### Templates — `apps/web/src/boards/templates.ts` (Week 1)
Reimagine as mixed-primitive scaffolds — a flowchart skeleton, a 2×2 matrix drawn
with shapes and axes, swimlanes as frames — not only card grids. The Week 1
template machinery (`createShapes` + zoom-fit) already supports arbitrary shape
types, so this is additive.

### Ambient autopilot — doc/note/table shape utils (Week-1 era)
Extend "Tab to continue" and the pause-nudge to free text elements, and add powers
that only make sense here: "tidy this diagram," "label these arrows," "turn this
sketch into a real flowchart."

### Presence & streaming — `AgentCursorLayer.tsx`, `streaming.ts`
An agent drawing shapes needs its avatar to move along the geometry, and the
streaming caret concept generalizes from "writing in a card" to "editing this
shape." Mostly a matter of feeding the existing stores shape ids + anchors.

### Multi-board / persistence — Week 1, **structurally untouched**
tldraw persists native shapes exactly like cards, and `SyncedBoard` already
registers `defaultShapeUtils`, so multiplayer is fine. Any *new* custom shapes we
add need schema migrations, but the board/onboarding/template work from Week 1
needs no rework.

---

## Why it's worth it

Not just FigJam parity — it makes the *agent* vision dramatically better. Once
agents can see and build primitives:

- You sketch rough boxes and arrows → "make this real" → an agent returns a clean,
  aligned, labelled flowchart.
- An agent reads your diagram *as a graph* and reasons over its structure.
- The Big Rocks Week 2/3 agents ("synthesize my board", "what am I missing?") get
  far richer material — they can finally see the diagram, not just the cards.

---

## Phased plan

Bigger than a week; phase it so value lands early and the risky AI surface comes
after the cheap human win.

> **Status:** P0 ✅, P1 ✅, P2 ✅ shipped. Humans have the full FigJam toolbar +
> styleable shapes/connectors/text/frames (self-hosted assets); the AI reads
> every primitive as context (autopilot + Ask); and "◇ Flowchart" has an agent
> build a real, editable graph of native shapes + connectors from a selection.
> Verified by `eval-canvas-p0` (8/8), `eval-canvas-p1` (4/4), `eval-canvas-p2`
> (5/5); Week 1 + writing-partner still green. P3 (native-canvas craft — mixed
> templates, "tidy this diagram", connector unification) remains.

```
P0  Human primitives        →  P1  AI sees primitives  →  P2  AI builds primitives  →  P3  Native canvas craft
Toolbar + shapes + style       Context + Ask-any          Runtime tools + emission     Mixed templates, ambient
Reconcile shortcuts            Follow connectors          Mock parity, protocol        Connector unification
(no AI changes)                Selection serializer        path for shapes             Presence on geometry
```

### P0 — Human primitives (low risk, immediate FigJam feel)
Re-enable a Jarwiz-styled toolbar, the core primitive tools, and a calm style
panel. Reconcile keyboard shortcuts. **No AI changes.** Humans get FigJam
expressiveness on day one. Ship + eval (creation, styling, persistence across
board switches, shortcut map).

### P1 — AI sees primitives
Generalize `gatherBoardContext` / `extractCardText` to read every text-bearing
shape and connector label; follow connectors when walking "connected" context.
Generalize Ask to operate on any selection. Agents become aware of your sketches
and diagrams. **This is where Big Rocks synthesis gets its upgrade** — so the two
roadmaps merge here.

### P2 — AI builds primitives (the north star)
Add `create_shape` / `create_text` / `create_connector` / `create_frame` /
`set_style` to the runtime, with the non-streaming emission path and `mock.ts`
parity. Extend the protocol. First flagship flow: **"make this sketch a real
flowchart."**

### P3 — Native-canvas craft
Mixed-primitive templates; ambient powers ("tidy this diagram", "label these
arrows"); fold provenance edges into the unified connector; presence/streaming
along geometry.

---

## What we're explicitly NOT doing (yet)

- **Rebuilding the canvas** — we're re-enabling tldraw, not replacing it.
- **Throwing away rich cards** — doc/table/PDF/etc. stay; they become the
  "content" tier of the unified model, not a competing one.
- **A bespoke style system on day one** — P0 can lean on tldraw's style panel,
  calmed with our tokens; a fully custom panel is a later polish, not a blocker.
- **Reworking Week 1** — multi-board, onboarding, persistence are unaffected.

---

## Open questions (resolve before/within each phase)

1. **Keyboard map.** Final shortcuts for doc / note / draw / shape / text /
   connector / frame, given our existing `d` and `n` window bindings. (P0)
2. **Primitive-vs-rich boundary cases.** Is an agent's short answer a `text`
   primitive or a doc card? Proposed default: structured/long → card; a label or
   one-liner → text primitive. (P1/P2)
3. **Emission model for shapes.** Confirm the non-streaming path's event shapes
   and how undo batches a multi-shape agent build into one step (mirror the
   existing `markHistoryStoppingPoint` contract). (P2)
4. **Connector unification migration.** How existing provenance edges map onto the
   unified connector without breaking old boards. (P3)
5. **Cost/iteration budget.** Building a flowchart is many tool calls; set a sane
   `MAX_ITERATIONS` envelope and a quality bar before P2 ships. (P2)

---

*This document is the plan of record for the canvas pivot. Keep it honest and keep
it current — when a phase ships, mark it, like we do in BIG-ROCKS.md.*
