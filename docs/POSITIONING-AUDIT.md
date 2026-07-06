# Positioning Audit — July 2026

What Jarwiz claims, what it currently delivers, and what's missing between
"fully functional" and "world class." Written right after the July surgery,
against the browser-verified state of `claude/tender-sagan-rxmrbk`.

---

## 1. The claim vs. the product

The vision (docs/VISION.md, ROADMAP §1) stakes two bets:

1. **Presence is the product** — visible agents working on the board is the moat.
2. **The board is the memory** — every card remembers where it came from.

**The uncomfortable finding: the Flora restyle quietly drifted the product away
from both bets.** In collapsing to a single Jarwiz identity and parking the
summon surfaces, the most visible AI element became… a right-edge chat drawer.
A canvas with an AI chat panel is exactly the category where differentiation
goes to die — it's Miro AI, FigJam AI, Cove, Kuse, and every tldraw fork. The
product's *plumbing* is still differentiated (streaming cards, provenance
edges, grounded asks, in-place autopilot); its *face* currently isn't.

This isn't an argument to revert Flora — the chrome is genuinely better. It's
an argument that the next builds must put the differentiators back on stage:

| Differentiator (built, working) | Current visibility |
|---|---|
| Answers stream as artifacts *on the board* | ✅ Center stage — this is the demo moment |
| Provenance ("Based on", drawn-from edges) | ⚠️ A dropdown menu item; the graph is invisible until you look |
| Live presence (avatar walks to the card) | ⚠️ One cursor; the "team of specialists" story is dormant |
| Four specialist agents (server-side) | ❌ No UI entry at all since the cull |
| Tab-to-continue autopilot in your doc | ⚠️ Discoverable only by accident (the nudge) |

## 2. Positioning decisions that need an owner's call

**2.1 The crew vs. the single identity.** The Flora commit "collapse to a
single Jarwiz identity" is a real positioning fork, not a style tweak.
Two coherent stories exist; the current build is between them:

- *Story A — "a team of specialists on your board"* (the original vision):
  named agents with colors and specialties, summoned deliberately. Higher
  ceiling for the presence moat, more theatrical demos; more surface to craft.
- *Story B — "Jarwiz, one collaborator with many skills"*: single identity,
  skills expressed as verbs (Ask, Refine, Scan, Continue). Calmer, more
  credible for a daily driver; but then presence choreography must be
  *exceptional* to stay differentiated, and the chat drawer must feel like
  Jarwiz-on-the-canvas, not a sidebar bot.

The codebase can serve either (agent registry intact). Pick one and make the
copy, colors, and summon UI agree with it. **Recommendation: Story B for the
daily-driver phase — but rename/reframe the chat drawer (see 2.3) and pour the
saved complexity into presence quality.**

**2.2 The wedge is fuzzy.** The empty state says "Start a new idea"
(ideation); the strongest built journey is PDF → interrogate → synthesize
(analysis); the Instagram series pitches "build what you'd actually use"
(builder audience). A world-class product at this stage has *one* sentence.
The honest one, given what's actually good today:

> **"Drop in the documents you have to understand. Jarwiz reads them and
> thinks with you on a canvas — every answer a card you can move, question,
> and build into your own document."**

That's the analyst/PM/researcher wedge. Ideation (stickies, clustering,
brainstorm) is real but supporting-cast — it strengthens the wedge instead of
competing with it.

**2.3 The vendor leaks into the product.** The drawer is titled "Claude," the
rail tooltip says "Ask Claude." Users should meet *Jarwiz*; the model is an
implementation detail (and a swap risk). Rename the surface (e.g. "Chat with
your board") and keep vendor names in docs only.

**2.4 The brand mark went missing.** The wordmark/spark chip died with the old
topbar; the logo button is the only mark, and the `--jz-accent` purple now
does the identity work the amber spark used to. Fine — but codify it: one
mark, one accent, used in the app, the deck, and the series thumbnails.

## 3. Missing for "fully functional" (daily-driver bar)

In priority order — each is a hole a real daily user hits in week one:

1. **No way out.** Zero export: no copy-as-markdown, no PDF, no share link.
   Work created in Jarwiz is trapped in IndexedDB. Even a "Copy card as
   Markdown / Export board as Markdown" menu item flips this from lock-in to
   trust. (Deliberately deferred in DECISIONS.md — for a daily driver it now
   costs more than it saves.)
2. **No search.** Boards accumulate; there is no way to find a card across
   (or even within) boards. A simple title/text filter in the side panel is
   80% of the value.
3. **Specialist agents unreachable.** Researcher/Summarizer/Brainstormer run
   server-side with no button. Either surface them (summon spec, ROADMAP §10.3)
   or delete them — shipping dormant capability is positioning debt.
4. **PDF journey robustness.** The wedge depends on it: large/scanned PDFs
   (OCR exists but untested at scale), multi-PDF cross-referencing UX, and
   citation-to-page jump need hardening + an eval.
5. **Model failure ergonomics.** Error pills + retry now exist everywhere;
   what's missing is *rate-limit* honesty (429s read as generic errors) and
   an offline/no-key first-run explanation better than the demo card.
6. **tldraw production license** — the watermark is fine for personal use,
   blocking for anything public.
7. **Data durability story.** IndexedDB is one browser profile away from
   loss. A one-click "back up all boards to a file / restore" is cheap
   insurance and pairs with export.

## 4. Missing for "world class" (the craft bar)

- **The signature moment is unowned.** The 10-second clip that sells the
  product — an ask streaming onto the board while the avatar walks to it,
  edges drawing in — works today but isn't *choreographed* (camera, timing,
  settle). ROADMAP C4 named this; it's still the highest-leverage craft work.
  This same clip is Episode 1's B-roll.
- **Performance headroom.** 500kB+ chunks (no code-splitting; pdf.js and
  mermaid should be lazy), board-wide scans serialize every card every time,
  and `useValue` recomputations on large boards are unmeasured. Budget: cold
  load < 2s, ask-to-first-token < 1.5s with a key.
- **Quality harness.** `scripts/eval-*.mjs` exist but aren't a gate. A small
  eval suite over the ask pipeline (grounding fidelity, shape choice,
  clarify behavior) run before merge is what separates "works in the demo"
  from "works."
- **Consolidation debt, remainder.** Server routes still hand-roll the
  streaming bridge (AUDIT P2.1); shape-utils still copy scaffolding (P2.3).
  Not user-visible, but every future feature pays the tax.
- **Onboarding for the second user.** The tour is honest now but generic;
  the BoardEntry-vs-hydration race remains; and there's no sample board — a
  pre-seeded "tour board" with a real PDF beats eight tooltips.
- **A public story.** No landing page, no README-for-humans with the clip,
  no positioning line anywhere a stranger can read. The Instagram series
  (content/STRATEGY.md) is the distribution plan — it needs the one-liner
  from §2.2 to anchor every episode.

## 5. Recommended sequence

1. **Decide 2.1 (identity) and adopt the one-liner (2.2)** — every build
   after this inherits the decision. One conversation, zero code.
2. **Export + backup (3.1, 3.7)** — trust before features.
3. **Rename the chat surface (2.3)** — one hour, removes the biggest
   positioning smell.
4. **Search (3.2)** — the side panel already lists boards; extend it.
5. **Signature-moment choreography + license (4.1, 3.6)** — unlocks the
   series and any public showing.
6. **Summon spec or delete (3.3)** — resolve the dormant crew either way.

Everything else (perf, evals, consolidation remainder, onboarding) slots
behind these without blocking them.
