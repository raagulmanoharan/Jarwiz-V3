# Persona study — "can Jarwiz run an extensive market study?"

A goal-driven evaluation, not a feature demo. Persona: **Arjun**, a UX designer
in Bangalore weighing a venture — an on-demand laundry + linen service for
Airbnb / short-term-rental hosts. His goal: decide whether the gap is real and
which of **Bangalore, Chennai, Pondicherry** to launch first.

Run for real against the **CLI sidecar** (`mode:"sidecar"`, live WebSearch /
WebFetch) in a real Chromium browser, driven by `scripts/eval-market-study.mjs`.
Affordances isolated separately in `scripts/probe-synthesis.mjs`.

## The arc that worked

1. **Explore** — four live-web research dossiers (opportunity, competition,
   host pain, Pondicherry-as-a-different-market). Rendered as `dashboard-card`s:
   verdict + KPIs + charts + tabs + real cited sources (AirDNA, Airbtics,
   Tumbledry, The Linen People, Sulekha, SCMP).
2. **Synthesise** — select the dossiers → ask → Jarwiz builds a *new* answer
   **grounded** on them (provenance edges, "FROM ↩card ↩card"). The comparison
   card grounded on 3 sources (`shape=doc, sources=3`) and produced a clear
   launch verdict: **Chennai first** — not the biggest (Bangalore, too crowded
   to win pricing power) nor the emptiest (Pondicherry, ~1,600 listings @ 28%,
   too thin/seasonal).

So the study *can* be completed inside the tool: zero → sourced, city-by-city,
decision-ready. Grounding + the "/" shape menu (Table, Debrief) + the header
"Deep think" toggle are all present and functional (menu opens via the visible
button; grounded decision produces a card wired to its sources).

## What's missing (roadmap signal)

1. **Latency + hard timeout ceiling.** ~3.5–5 min per deep dossier; the broadest
   query (all 3 cities at once) hit **"sidecar timed out" → a blank card** with
   no partial-result recovery. Easy to mistake the empty card for a real finding
   (the failure is a transient toast). *(Keyless sidecar; an API key would
   token-stream faster — but the broad-query timeout risk is real.)*
2. **No study-level structure/memory.** Each card is an independent answer;
   Jarwiz doesn't know the six cards are one study. No research plan, no
   coverage tracking, no auto-linking of related dossiers. Synthesis is manual
   (remember to select the right cards, re-ask).
3. **Discoverability of synthesis.** Multi-card grounding, "/" Table/Debrief and
   Deep think are subtle; a first-time non-technical founder would likely pile
   up disconnected dossiers and never select-and-synthesise.
4. **Grounding is opaque/capped.** Comparison grounded on 3 of 4 selected cards
   (the timed-out blank contributed nothing); no visibility/control over how
   much of each card is passed.
5. **No export / report-out.** A market study's endpoint is a shareable
   doc/deck; Jarwiz produces a board with no obvious "compile into a report".
6. **Data confidence varies by market.** Metro numbers solid + multiply-sourced;
   small-market figures (Pondicherry; Chennai ranged 880–1,455 across sources)
   thin — Jarwiz flags the disagreement but can't resolve it.

**Bottom line:** the intelligence and grounding are genuinely there; what's
missing is the scaffolding *around* it — a sense of "one study", timeout
resilience, discoverable synthesis, and a way to get the study out of the board.

## Freestyle follow-up — "is this just 4 ChatGPT queries in boxes?"

Re-run without forcing shapes (`scripts/eval-freestyle.mjs`): hand Jarwiz the
whole goal in one sentence and let it choose the shapes. This is where the
canvas paradigm earns its keep — things a linear chat can't do:

- **`/Board` compose: one goal → a planned workspace.** Jarwiz decomposed the
  goal itself into **6 typed cards** (City Market Size, Competitive Landscape,
  Host Pain Points, Unit Economics Model, a **City Fit Scorecard** = weighted
  decision matrix, Biggest Risks & Mitigations) — tables + docs, laid out
  spatially. Not one essay: a set of distinct, editable artifacts.
- **Analyze across the board.** One "What's missing?" click read all 6 cards
  (`sources=6`) and named the go/no-go gaps — CAC vs the $8.60 contribution
  margin, damage/liability, effluent/GST/gig-labor compliance — cross-artifact
  reasoning a chat can't do without re-pasting everything.
- **Map** of the three cities; grounding/provenance wires later answers to the
  cards they came from (a connected research graph).

So the differentiator is NOT per-answer content (chatbot-grade either way) — it's
that Jarwiz turns a goal into a **structured, spatial, inter-linked workspace and
reasons over the whole thing.**

Limits that make it *feel* like chat: the winning move (`/` → Board) is hidden
(the mode button doesn't even render on an empty board, so a first-timer gets one
doc card); compose runs the fast **non-deep** budget (broad but shallow,
directional numbers); ~5.5 min to compose on the keyless sidecar. The biggest gap
is discoverability, not capability — a new user won't find the canvas-native
moves on their own.
