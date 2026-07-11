# Product review — new-user walkthrough, 2026-07-11

A principal-PM-style dogfood of the current build: arrive as a brand-new user,
touch every surface, then take **one** use case end to end and judge the whole
journey. Environment: production web build via `vite preview` + live sidecar
backend (`mode=sidecar, live=true`), driven in a real browser. Screenshots in
`docs/assets/qa/review-0711-*.png`.

**The use case:** paste a raw product-sync transcript and build a real artifact
out of it — the "I just left a meeting, make this useful" job.

---

## What happened, end to end

1. **First run.** "What brings you here?" persona picker → *Building a
   product*. The hero ("What are we figuring out?") appears with tuned
   suggestion chips, a cycling placeholder, and three onramps: *drop a PDF /
   paste a link / paste a transcript*.
2. **Pasted a 25-turn product-sync transcript** into the prompt and sent.
   Jarwiz's cursor walked out, a status chip said *Generating… / Stop &
   discard*, and a doc card streamed in.
3. **Result 1:** *"Onboarding Revamp — Action Items (Jul 9, 2026 sync)"* — a
   real checkbox checklist. All six items faithful to the transcript: owners,
   dates, and nuance ("reusable by the animated feature later"). A
   **Keep / Discard** bar asked before the card committed to the board.
4. **Selected the card, asked** "turn this into a launch plan table…" →
   *"Onboarding Revamp — Launch Plan"*: a table with workstream / owner /
   milestone / date / **biggest risk**, where the risk column showed genuine
   judgment (flagged the brand-team external dependency and the undated
   analytics item), plus a **Sequencing note** naming the Friday voice-guide
   deadline as the highest-leverage risk in the chain.
5. **The card's own suggestion pills** offered *⚖ Scan for tensions* and
   *✦ What am I missing?*. One tap → a **Tensions** card that caught a real
   cross-card contradiction (the sequencing note's stated order vs. the
   actual scheduled dates).
6. **Checked off an action item** on the checklist → the Launch Plan table
   **rewrote itself to match** ("Jul 10 — ✅ Done", every downstream risk cell
   re-reasoned) with an *"Updated to match…"* toast and **Undo**.

Verdict on the use case: **it works, end to end, and the ending is better than
the promise.** Four interactions took a raw transcript to a checklist, a
risk-annotated plan, and a critique of that plan.

## What delighted

- **Live-linked artifacts** (step 6) is the demo-able magic moment. Checking a
  box and watching the plan re-reason its risk column — with consent via
  Undo toast — is a capability I haven't seen elsewhere. This is the thing to
  name, market, and build the roadmap around.
- **Extraction quality.** Owners, dates, decisions, and hedges all survived the
  transcript → checklist hop. Zero hallucinated items.
- **Content-aware pills that read like a sharp coworker** ("Overdue brand
  voice guide risk") rather than generic verbs ("Summarize").
- **Consent grammar is consistent**: Keep/Discard on arrival, Stop & discard
  mid-stream, Undo on cascades, honest status chips ("Scanning for
  tensions…"). The VISION's "consent over magic" principle is genuinely
  implemented, not aspirational.
- **The empty state** — persona picker, cycling prompts, corner vignettes of
  agents at work — sells intelligence in the first five seconds.

## What's broken or missing (ranked)

1. **The source transcript never lands on the board.** Prompt-pasted text
   produces artifacts with no source card and no way back to the original.
   You can't re-ask "what exactly did Marco say about the renderer?" — the
   raw material is gone. The transcript should land as its own (collapsed)
   card, wired to what was made from it.
2. **No visible provenance.** Zero edges were drawn between checklist → plan →
   tensions, even though the live-link cascade proves the relationships exist
   internally. The board is supposed to *be* the memory; today the wiring is
   invisible. Draw the edges the system already knows about.
3. **Dead-click onramps.** *drop a PDF / paste a link / paste a transcript*
   are styled as buttons but are `pointer-events: none` decoration. Every new
   user who arrives holding a transcript will click "paste a transcript" and
   nothing will happen. Make them live (open a paste sheet / file picker).
4. **Latency without narration.** ~15 s to first token on the first build,
   and the table took minutes. The cursor + chip help, but the status never
   says *what* it's doing ("Reading the transcript… found 6 action items…").
   Honest narration would convert dead air into perceived depth. (Sidecar
   mode may exaggerate absolute numbers; the UX gap is real regardless.)
5. **Overlap bugs around generated cards**: Keep/Discard bar covers table
   cells; a closed Actions menu re-appeared open over a card during the next
   generation; stale suggestion pills from card 1 float over card 2; the
   empty-state vignette card overlaps the open boards panel; Jarwiz's avatar
   parks half off-screen at the viewport edge.
6. **No board-wide search.** The magnifier is the zoom menu. Fine at 3 cards,
   unusable at 40. (⌘K also didn't open anything in this harness — worth a
   manual check.)
7. **"Board you can shape" oversells v1 of the layout.** The hero promises a
   laid-out board; a transcript yields one card. Great card — but decisions /
   actions / risks as a small connected cluster would deliver the promise.

## Nice-to-haves (not ranked, all earn their place)

- **Export the artifact.** The checklist + plan want to leave the canvas —
  copy as Markdown, share link, push to Linear/Slack. Today value is trapped
  on the board.
- **A "meeting debrief" recipe**: transcript in → actions + decisions + risks
  cluster in one shot, since this will be a top-3 real-world job.
- Camera choreography: pan/zoom to frame a new artifact when it lands
  (the new card rendered partly off-viewport).
- Mode pill legibility: Board/Diagram/Table auto-cycles with the placeholder;
  users can't tell if it's a promise, a setting, or a guess.
- Pills truncate ("Activation metric vs picke…") and don't say whether they
  ask, transform, or create — a verb prefix would fix it.
- Surface **Thinking Machines** (SWOT, Effort–Impact, Risk Assessment, 5
  Whys…) contextually — they're exactly what a PM wants *after* a plan
  exists, but nothing points there from the artifact.
- History log exists (counter ticks up) but is easy to miss; the live-link
  cascade makes an inspectable "what changed and why" log more important.

## Docs drift noted

`docs/FEATURES.md` still claims @mentions, comment threads with agent
replies, and always-on multiplayer as verified features; the current build
(post-July surgery, sync behind a flag) doesn't surface them. Worth a pass so
the inventory matches the product.
