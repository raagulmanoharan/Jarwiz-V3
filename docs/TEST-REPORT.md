# Jarwiz — Test & Usability Report

_Date: 2026-06-16 · Branch: `claude/tender-sagan-rxmrbk` · Build: production `vite preview` + Hono server (Claude CLI sidecar)_

A full pass over what we've built so far: automated evals, end-to-end runs against
a real model, and synthetic-persona usability walkthroughs — with screenshots and
a prioritised list of what to improve next.

How to reproduce (preview + server up):

```bash
npm run build --workspace=apps/web
npm run dev --workspace=apps/server          # :3001  (background)
npm run preview --workspace=apps/web -- --port 5173 --strictPort   # (background)
node scripts/eval-suite.mjs       # client rendering surface
node scripts/eval-inplace.mjs     # in-place regeneration behaviour
node scripts/eval-personas.mjs    # real Ask flows, 3 personas
```

---

## 1. Scorecard

| Suite | Result | What it proves |
|---|---|---|
| Server routing (curl) | **3/3** | Refinements keep shape; format/prose requests branch |
| Client rendering (`eval-suite.mjs`) | **15/16** | Every card renders; 1 real UX finding (dock overlap) |
| In-place regeneration (`eval-inplace.mjs`) | **8/8** | Same card updated; Cmd+Z restores exactly |
| Persona end-to-end (`eval-personas.mjs`) | **4/5** | Live pipeline works; 1 harness timeout (feature OK) |

**30 automated checks pass.** Two non-passes: one genuine bug (sticky-note dock
overlaps tldraw's navigation panel) and one test-harness timeout where the feature
actually rendered correctly (slow dev sidecar call).

---

## 2. Server routing (the in-place decision)

Refinements carry the selected card's `currentShape`; the server keeps that shape
unless the prompt explicitly names a different format.

| Input | `currentShape` | Routed to | Correct? |
|---|---|---|---|
| "add another node" | diagram | **diagram** (in place) | ✅ |
| "reformat as a comparison table" | diagram | **table** (new card) | ✅ |
| "rewrite as a short written summary" | table | **doc** (new card) | ✅ |

A bug was found and fixed during testing: `/api/ask` was rebuilding the request
object and silently dropping `currentShape`, so every refinement fell back to the
prose router. Now forwarded with a whitelist.

---

## 3. Client rendering surface — 15/16

✅ Empty state · ✅ Sticky note via `n` key · ✅ Sticky note via dock handler ·
✅ Doc markdown headings · ✅ Task list → 3 live checkboxes · ✅ Toggling a checkbox
rewrites the source line · ✅ Table grid (9 cells) · ✅ Diagram renders SVG ·
✅ **Diagram has no Expand toggle** · ✅ **Diagram not clamped** · ✅ **Diagram card
height fits the whole diagram** (387px card for a 311px SVG) · ✅ Affinity board (5
notes) · ✅ Refine chips for doc / table / diagram cards.

❌ **Dock button reachable** — the "Sticky note" dock button (bottom-left) is
overlapped by tldraw's navigation panel, which intercepts the click. The handler
works (a direct DOM click drops a note); the button is just not reliably clickable
where it sits. See Findings.

### Diagram renders whole (the requested fix)

Diagram cards no longer clamp or show an Expand toggle — the card grows to the full
rendered diagram, so nothing is scrolled or truncated. A tall mindmap renders in
full:

![Diagram renders whole](assets/qa/diagram-render-whole.png)

### Checklists are live inside cards

`- [ ]` task lines render as real checkboxes; toggling one rewrites the card's
source text (`- [ ]` ↔ `- [x]`).

![Doc checklist](assets/qa/doc-checklist-toggle.png)

---

## 4. In-place regeneration — 8/8

Selecting an answer card and asking a same-type tweak rewrites **that** card:
same id, no new shape, content changed; a single Cmd+Z restores the prior content
exactly (the clear + every streamed delta are squashed into one history step).
"Shorter" took a 456-char doc to 303 chars in place.

---

## 5. Synthetic-persona walkthroughs (real model) — 4/5

### Maya — PM, competitive analysis

"Compare these three tools as a table" → a grounded comparison table beside the
source, linked by a provenance edge. **6.1s.**

![Maya table](assets/qa/persona-maya-table.png)

### Devin — engineer, system mapping + in-place refine

"Create a flowchart diagram of this login flow" → a full flowchart (**7.9s**). Then,
with the diagram selected, "Add a node for password reset" updated **the same card**
— a complete reset branch (Login screen → Forgot password? → Enter email → Send
reset link → Reset password) appended, original flow preserved, no second card
(**5.7s**). This is the headline interaction working end to end on a real model.

![Devin diagram](assets/qa/persona-devin-diagram.png)
![Devin in-place refine](assets/qa/persona-devin-refined-inplace.png)

### Sam — researcher, ideation + action items

"Brainstorm ideas as clustered sticky notes" → a colour-coded affinity board of
clusters (**12.1s**). "Extract the action items as a checklist" → an Action Items
card with five live checkboxes from the notes (rendered correctly; the harness's
120s wait was just short of the 122s the dev sidecar took — see Findings).

![Sam affinity](assets/qa/persona-sam-affinity.png)
![Sam checklist](assets/qa/persona-sam-checklist.png)

---

## 6. Findings & what to improve next

**Prioritised.** P1 = fix soon (correctness/clear friction), P2 = polish, P3 = nice-to-have.

1. **[P1] Sticky-note dock overlaps tldraw's navigation panel.** Both live
   bottom-left; the nav panel intercepts clicks so the dock button is effectively
   unclickable there. Fix by repositioning the dock (e.g. bottom-center, or above
   the nav panel) or nulling/relocating tldraw's `NavigationPanel`. _Caught by the
   eval; reproduced reliably._

2. **[P1] Follow-up / refine chips overlap card content.** The chips
   (Shorter / Go deeper / As a table …) float over the bottom-center of the source
   card, sitting on top of its text or diagram (visible in the Maya and Devin
   shots). Move them clear of the card's body — below its bottom edge or to the
   side — or reveal on hover.

3. **[P2 · FIXED] In-place regeneration has no progress/cancel affordance.** Now
   shows a "Regenerating…" pill with a **Cancel** under the card while it streams
   (`RegenControls`). Cancel aborts the model call and bails the history mark, so
   the card's previous content is restored exactly. _Eval: `eval-regen-cancel.mjs`,
   3/3._

4. **[P2 · FIXED] No real cancel on long Asks.** "Stop & discard" on a streaming
   draft now actually aborts the in-flight model call (`cancelActiveAsk`), not just
   hides the card. (Dev sidecar latency remains high/variable; production uses the
   streaming Anthropic API.)

5. **[P2] Affinity can over-generate** (one brainstorm produced ~31 notes across 5
   clusters). Readable but dense. Consider capping notes/cluster or laying clusters
   out with more breathing room.

6. **[P3] Wide diagrams scale down to card width** and can get small. Now that
   height is unconstrained, consider letting very wide diagrams widen the card too,
   so labels stay legible.

7. **[P3] No "refine the last answer" entry without selecting it.** Every Ask path
   requires a selection, so the "infer the most recent response" half of the
   in-place design has no trigger today. A ⌘K "refine last answer" or a persistent
   ask bar would complete it. (We do auto-select a kept answer, which covers most
   of the gap.)

8. **[P3] Table in-place edits re-stream the whole grid.** "Add a row" regenerates
   and refills every cell rather than appending, which flickers. Functional, but a
   diff-and-append would feel smoother.

---

## 7. Follow-up changes landed after this pass

- **In-place regen progress + cancel** (findings 3 & 4) — `RegenControls` pill with
  Cancel; "Stop & discard" now truly aborts the model. Evals: `eval-regen-cancel.mjs` (3/3).
- **Full table editing** — table cards now support add/edit/**delete** for both rows
  and columns (a corner × per header, a × per row in a trailing gutter), on top of
  the existing cell editing and Tab-to-fill. Eval: `eval-table.mjs` (7/7).

## 8. Combine sources + disambiguation (new)

Three capabilities landed together (`eval-combine.mjs`, 4/4):

- **Images as context (vision).** Image cards are now Ask sources — selecting an
  image (alone or with other cards) shows the Ask affordance, and the image is
  sent to the model as a vision input on the API path. (The dev sidecar is
  text-only, so it notes the image but can't see it; verified it degrades to a
  card rather than erroring.)
- **Multi-source combining affordance.** A multi-select shows "Combining N · Doc ·
  Image · …", so it's clear what a single Ask will fuse.
- **Disambiguation.** When a request is genuinely ambiguous, the server returns one
  short question with tappable options instead of guessing (a cheap heuristic gate
  + a triage pass — biased hard toward acting, so clear requests never get asked).
  Answering re-runs the same Ask with the answer folded in and both sources wired
  to the result.

![Combining + clarify](assets/qa/combine-clarify.png)
![Answered](assets/qa/combine-answered.png)

_Server routing verified by curl: "do something with these" (doc + image) → a
`clarify` event with options; "summarize this document" → straight to a doc, no
question._

## 9. Coverage gaps (not yet evaluated here)

The older agent surface — Summarizer / Writer / Brainstormer / Researcher,
@mention, the ⌘K command palette, comment threads with agent voice, and
Tab-to-continue Autopilot — was not re-evaluated in this pass; it has its own
harnesses (`scripts/verify-m1.mjs`, `verify-m2.mjs`, `eval-ui.mjs`). PDF ingestion
and seed prompts were exercised indirectly (the Ask pipeline) but not via a real
file upload in this run.

---

# 2026-07-04 — Full-flow dogfood: every shape, one deep-dive session

**Method.** One browser session against the production preview with a live
model, driving a realistic deep dive ("Should we adopt trace-based JIT?"):
onboarding → PDF drop → profile → compare pill → table → checklist →
flowchart → affinity → fresh doc + Tab autopilot → labeled native sketch
asked about → combine → link/image cards → timeline → light theme.
15 screenshots (`/tmp/jz-dive-*.png`), phase log in session notes. Latency
excluded from findings by owner instruction. What WORKED end to end: drop →
profile with page citations → format-aware pill → cited comparison table →
checklist with live checkboxes → flowchart as native editable shapes →
autopilot continuing a half-written memo → an ask grounded on a hand-drawn
sketch → combine → per-board activity log → full light/dark reskin. The
spine of the product holds.

## Bugs found (ranked)

1. **Empty cards are legitimate ask sources — worst case is system-prompt
   leakage.** Grounding a brainstorm on the empty starter doc produced 30
   sticky notes about *Jarwiz itself* ("Trust in AI output", "Unclear how to
   summon agents") — the model, given no content, riffed on its own system
   prompt. The same empty source made Combine emit an apology paragraph as
   section 1. The content gate protects pills and transforms but not
   prompt-bar asks. Gate ask grounding on `hasAskableContent`, or have the
   server refuse empty sources.
2. **"Start blank" isn't blank.** It creates an empty doc card titled with
   the board name, left in edit mode. That card became permanent clutter,
   then the poisoned source in (1). Blank should mean an empty canvas.
3. **A one-sided comparison renders as a broken table.** "Trace-based vs
   method-based" on a paper that covers only trace-based produced a 3-column
   table whose third column is entirely empty cells — honest (no invention)
   but reads broken. When a compared side has no grounding, the cell should
   say so ("not covered in this source") or the pill shouldn't offer a
   two-sided compare.
4. **Doc answers can carry raw Mermaid/code.** "Answer in two sentences"
   about a sketch returned two sentences PLUS a mermaid code block, rendered
   as raw monospace text in the doc card. DocMarkdown has no fence handling
   and the doc prompt doesn't forbid fences; either render fences, reroute
   them to a diagram card, or prompt them away.
5. **Waiting shimmer never resolved on empty/title-only cards** — selected
   empty card showed placeholder pills forever (`ensureCardSeeds` early-
   returned without caching, so the UI read "fetch in flight" indefinitely).
   FIXED this session.
6. **Diagram generation happens off-screen.** The flowchart built at the far
   right edge, half out of the viewport, its running-task pill anchored at
   the OPPOSITE corner. No camera follow like asks have. It reads as
   "nothing happened" until you pan.
7. **Pill labels truncate mid-word** ("Challenge type-stability assumpt",
   "Nested trace tree algorithm chec") — the server's 32-char slice needs a
   word boundary + ellipsis, or a larger cap.
8. **Citations below the card fold are unreachable.** A collapsed profile
   card clamps at max height; its later `[p.N]` chips can't be clicked
   until Expand. The activity log also mislabels the profile as "List".
9. **Placement collisions.** The profile card landed overlapping the starter
   doc; "New doc" spawns at viewport centre regardless of occupancy.
   placeInLane avoids its own lane but not other shapes.
10. **Card action bar chrome collisions.** The floating bar overlaps the
    card's outside title tag, and when the selected card's top edge is
    off-screen the bar pins mid-air, visually detached from what it acts on.

## UX friction

- **Bottom-centre pileup.** Coach bubble + shimmer/pill row + scan chips +
  prompt bar can all stack; the coach bubble literally describes the two
  chips rendered directly beneath it — redundant teaching, and it never
  auto-dismisses.
- **The board is one endless row.** Lane placement appends everything
  rightward; after eight artifacts the session sits at 28% zoom on a
  ~6000px strip. No auto-sections/frames for a work session; Tidy is
  selection-only.
- **Affinity output is a wall**: 30 stickies in 7 columns for one
  brainstorm; cluster labels aren't visually distinct from notes; selecting
  the result floods the prompt bar's ground chips ("+27").
- Arrow labels wrap mid-word at default widths ("hot loop detect‑ed").
- Timeline entries show raw prompt text as labels — fine for asks, awkward
  for long canned prompts (the profile's full instruction block).

## Capability gaps / doc-reality mismatches

- **No way to get an image onto the canvas.** image-card renders fine but
  has no creator: ingestion accepts only PDFs, no image drop/paste path.
  (Typed photo table-columns can upload now — the canvas itself can't.)
- **Prompt bar's + (attach) and / (commands) are dead buttons** that log
  to console. Visible chrome that does nothing erodes trust in the rest.
- **Workspace section is a stub** ("workspace switching is not wired up").
- **CLAUDE.md/docs still describe a right-edge ClaudePanel chat drawer**;
  the current rail has no chat toggle. Docs and chrome disagree.
- Link cards can't retry a failed preview (relevant offline/flaky network).
- Multi-PDF drop doesn't lay out a reading row (roadmap item, confirming
  still open).

## Test-harness notes

- Tension/gap scan chips confirmed visible with empty selection, but the
  scan run itself was lost to a driver bug (returned the Editor from
  `evaluate` — CLAUDE.md gotcha #3 strikes again; the board-scan surface
  still deserves a dedicated pass).
- Link preview untestable here (sandbox blocks outbound web).

## 2026-07-05 — Fixes landed (same-day)

Bugs 1–2 (empty cards no longer count as ask context — the ask runs
free-standing and the empty card earns no provenance edge; truly-blank
onboarding),
5 (stranded shimmer), 6 (diagram camera-follow + occupancy-aware placement),
7 (word-boundary pill labels), 3–4 via prompt rules (one-sided comparison
column says "Not covered in this source"; doc answers may not emit code/
mermaid fences), 9 (lane placement clears vertical spans), 10 (action bar
clears title tags), plus: image drop/paste ingestion, dead +// buttons and
the coach bubble removed, CLAUDE.md chat-drawer mismatch corrected, friendly
activity labels for canned prompts. Owner directives shipped alongside:
generated flowcharts arrive as ONE muted-grey group (click = ask about the
whole diagram, double-click = edit inside), stickies are user-annotation
only (router never picks them; rail gains a Sticky tool; muted palette), and
the prompt bar's "/" is a mode selector forcing the answer's shape (Text /
List / Table / Diagram / Stickies — the one explicit path to stickies).
`scripts/eval-fixes.mjs` proves the set end-to-end: 9/9.

Still open from the report: under-fold citations, board-level organization
(the sprawl), affinity output volume, workspace stub, link-preview retry.
