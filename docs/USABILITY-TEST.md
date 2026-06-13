# Jarwiz — usability test (5 persona agents)

_Run: 2026-06-13 · Method: 5 Claude agents role-played real users and evaluated
the running product against their own job-to-be-done._

## Method & honesty

- **Testers**: five Claude "sidecar" agents acting as real users — a Product
  Manager, a Tour/Travel Planner, a Teacher, a YouTuber, and a freelance Content
  Creator. Each pursued its own use case end-to-end and judged where the product
  supported it, shone, or broke.
- **Grounding**: each agent reviewed the actual running product via five real
  screenshots from this build (empty/first-run, Tab-to-continue, table cell-fill,
  @mention + roster, comment thread) plus a precise feature briefing.
- **Honest limits**: (1) the build ran in **demo mode** (no API key), so the
  agents' *internal* text output is scripted — every tester could judge UX,
  flow, and fit but flagged that **AI output quality is untested**; a keyed run
  is needed to settle it. (2) We deliberately did **not** repurpose the Claude
  Code OAuth credential into the server to fake "real" output — that auth is
  scoped to Claude Code. (3) Agents evaluated via a guided walkthrough of the
  real product + screenshots rather than fully hands-on driving (the CI sandbox
  intermittently tears down browser automation on shape creation).

## Verdict at a glance

| Persona | Score | One-line |
|---|---|---|
| Product Manager | 6 / 10 | Best-in-class AI-canvas interactions, but no export, no steering controls, demo-mode hides the deliverable. |
| Tour / Travel Planner | 5.5 / 10 | Delightful research-and-compare canvas, but missing the spine of the job: dates, maps, budget math. |
| Teacher | 6 / 10 | Fits how teachers think; blocked by no PDF/print, no citations, no reading-level control. |
| YouTuber | 6 / 10 | A better *thinking* environment for scripting; can't *finish* — no script export, no runtime/teleprompter. |
| Content Creator | 6 / 10 | Nails the creative front-half; not a content tool without brand voice, export, and a repurpose loop. |

**Average ≈ 5.9 / 10.** Unanimous shape: _"a delightful, well-crafted thinking
canvas — not yet a finish-and-ship tool."_

## What shines (cross-cutting, every tester independently praised)

1. **The summon model.** Four ways to call an agent, and the ⌘K palette showing
   "what the agent sees" (your selection). Agents-as-named-teammates (roster,
   @mention) read as collaborators, not a chatbox. "Instantly familiar" to
   selection-native users.
2. **Tab-to-fill the table.** The single most-cited standout. Cell-by-cell fill,
   avatar hopping the grid, never overwrites a cell you typed, one undo for the
   whole fill. The comparison matrix is the most common artifact for the PM,
   planner, and teacher — and this nails it.
3. **Provenance arrows.** Research physically wired to the artifacts it produced.
   Called a "superpower" (YouTuber), "auditable" (PM), "gold for client
   questions" (content creator).
4. **Autopilot beats the blank page.** Outline → Tab → draft, in place, with a
   trust contract (type to reclaim, Esc, one undo) writers actually want.
5. **Frictionless capture + warm craft.** Paste-a-link-becomes-a-card and the
   editorial paper aesthetic make the messy gathering phase pleasant.

## What breaks (cross-cutting, ranked by frequency × severity)

1. **No export / no way out — BLOCKER (4 of 5).** PM, Teacher, YouTuber, Content
   Creator all independently called this a hard blocker. A handout, one-pager,
   script, or blog post that lives only on the canvas is a dead end — their
   stakeholders live in Docs, Slack, PDF, a CMS, a teleprompter. _Highest-signal
   finding of the test._
2. **No steering / brief per summon — MAJOR (PM, Content Creator, Teacher).**
   Selection-as-context is elegant but too blunt. Users need to tell the agent
   *how*: tone, length, audience, reading level, and — for the content creator —
   a stored **brand/voice profile per client** (called a Blocker by them).
3. **Demo-mode hides AI quality — MAJOR (all 5).** Every tester could judge the
   choreography but not the substance, and the canned text ("Strong fit for
   Notion", "with an API key I'd answer this") leaks into the work. Needs a
   keyed run to evaluate the actual value.
4. **Domain spines missing — BLOCKER within each domain.** Travel needs
   **dates, maps, budget math** (planner: "an itinerary tool with no dates, no
   map, no money is missing the spine"). Teacher needs **citations + reading
   level + print**. YouTuber needs **runtime estimation + teleprompter view**.
   Content needs **repurpose-to-formats + organization/search**.
5. **Table readability + zoom friction — MAJOR/MINOR (PM, Teacher, YouTuber).**
   Columns clip at the card edge ("Watch-outs" cut off), the working avatar
   parks on top of cells mid-fill, and sustained editing forces high zoom
   (211–350%) with no "open this card to write" focus mode.
6. **Organization & search — MAJOR (Content Creator).** No folders, projects,
   tags, or search across an infinite canvas; multi-client weekly work would
   become chaos.

## What this means for the roadmap

The test reorders priorities away from *more agent capabilities* (e.g. A3
proactive offers) toward **making what exists shippable**:

1. **Export** (markdown / PDF / copy-out, per-card and per-board) — unblocks 4
   of 5 personas. Do this first.
2. **A brief box on summon** (tone / length / audience) + a saved **voice/brief
   profile** — unblocks steering and brand voice.
3. **A keyed run** to validate AI output quality (or a real "sidecar" wired
   properly) — turns every "I couldn't judge" into a real score.
4. **Card-focus mode + table polish** (no clipping, avatar offset, full-screen
   write) — removes the daily friction.
5. **Light organization** (named boards / search) — multiplayer rooms already
   exist; give them names and a finder.
6. _Then_ domain depth (dates/maps for travel, citations/print for teachers,
   runtime for creators) — likely as templates rather than core.

The interaction design earns the benefit of the doubt across every persona; the
gap to adoption is **finishing and exporting**, not inventing more.
