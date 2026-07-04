# PDF-EDGE — the plan of record

_Owner decision (2026-07-04, docs/DECISIONS.md): the PDF edge is the wedge.
Jarwiz is the document-analysis companion. This doc is the build-out plan:
what makes it killer, what makes it unique, and what gets cut._

## The claim

> **Drop in the documents you have to understand. Jarwiz reads them and
> thinks with you on a canvas — every answer a card you can move, question,
> trace back to its source, and build into your own document.**

## Why we win (the structural edge)

Every competitor is a **linear** reader: NotebookLM, ChatPDF, Adobe AI
Assistant, Claude/ChatGPT-with-files all produce a chat transcript next to a
document. Their output evaporates; their context is invisible; their answers
can't be arranged, compared, or composed. Jarwiz's architecture — artifacts +
provenance + space — produces things they structurally cannot:

1. **The investigation is a place.** Your questions and their answers are
   laid out spatially, connected to sources. Day-3 you returns to a map, not
   a scrolled-away transcript.
2. **Trace (shipped).** Any conclusion lights up its full ancestry — which
   answer came from which document, through which intermediate steps. This is
   "citations" upgraded to "show your work."
3. **Cross-document work is native.** Two PDFs side by side with "Find
   conflicts" / "Compare clauses" (shipped) beats uploading both to a chat
   and hoping. Space is the natural UI for comparison.
4. **The synthesis is yours.** The end state isn't reading the AI's answer —
   it's your doc card, drawn from the answers, with "drawn from" edges. You
   leave with a deliverable.

## The killer flow (target end-state)

**Drop → Read → Interrogate → Cross-examine → Synthesize → Deliver**

| Stage | Today | Target |
|---|---|---|
| **Drop** | PDF drag/paste/upload ✅; seed-prompt suggestions ✅ | + Instant doc profile card: what this is, who wrote it, what to worry about — offered, not forced. Multi-file drop lays out a reading row. |
| **Read** | In-card PDF reader ✅, text-selection ask ✅, OCR fallback ✅ | + "Ask about this passage" gets page-anchored highlights that persist as cards; answer cites page numbers that **click-jump** the reader. |
| **Interrogate** | Grounded asks ✅, content-aware starters ✅, clarify ✅ | + Every answer records page-level citations (not just doc-level), rendered as small `p.12` chips → click jumps the PDF card to that page. **This is the single most important build.** |
| **Cross-examine** | Find conflicts / Compare clauses (2+ PDFs) ✅ | + Conflict answers cite both sides page-precisely; a comparison lands as a table whose cells trace to pages. + "What does doc B say about this?" on any answer card. |
| **Synthesize** | Combine into doc ✅, drawn-from edges ✅, Trace ✅ | + "The board noticed": consent-gated tension/gap nudges as material accumulates (endpoints exist — needs the quiet surface). |
| **Deliver** | ❌ nothing leaves the app | + Export synthesis as Markdown/PDF **with the source trail as footnotes** — the lineage graph becomes the bibliography. Nobody else can generate this, because nobody else has the graph. |

## Build order

1. **Page-anchored citations** (the moat-maker): server returns `{page, quote}`
   spans with each PDF-grounded answer; client renders citation chips on
   answer cards; click scrolls the PDF card to the page and flashes the
   region. Trace + citations together = full-fidelity "show your work."
2. **Export with the source trail**: copy-as-Markdown per card; board/doc
   export where provenance edges become numbered footnotes ("Drawn from:
   Contract.pdf p.12; Answer 'Termination risks'…"). Trust + shareability.
3. **Drop-moment profile card** ✅: on ingest, offer (never force) a compact
   profile: type, parties/authors, dates, red flags, suggested first
   questions. Shipped 2026-07-04 through the Ask pipeline (not suggest — the
   profile is a streamed, cited, provenance-edged doc card like any answer);
   the offer chip is the drop-moment shortcut, the Refine menu the durable
   path. Eval: `scripts/eval-profile.mjs`.
4. **Reader robustness**: 100+ page PDFs (lazy page rendering), scanned-PDF
   OCR at scale, password flow polish, multi-hundred-MB guardrails with
   honest errors. An eval PDF set (contract, paper, financial report,
   scanned doc) run before merge.
5. **"The board noticed"**: after N new answer cards, one quiet chip —
   "✦ Two of your answers disagree — want to see?" → lights both cards with
   the tension named. Consent-gated, rate-limited, never modal.
6. **The clip**: choreograph drop → profile → ask → cite-jump → trace for
   the ten-second recording. This is Episode 1.

## What gets cut or parked (doesn't serve the wedge)

- **YouTube cards** — creator already dead; remove the shape at the next
  schema-migration opportunity, and the server oEmbed paths with it.
- **Image cards** — no creator exists; same treatment. (Image *inside* PDF
  workflows — figures, scans — stays via OCR.)
- **Link-card enrichment surface area** — keep paste-a-link basic; the
  Researcher/web_search story is parked with the crew.
- **Specialist-crew summon UI** — parked indefinitely; the single-Jarwiz
  identity carries the wedge. Server agents stay as plumbing.
- **Board templates** (ideation-flavored) — keep "Start blank", demote the
  rest; the PDF drop IS the onboarding.
- Already parked: multiplayer, chat drawer (removed), ⌘K/mentions/offers
  (deleted).

Stickies + clustering **stay**: turning extracted findings into themes is a
legitimate analysis move, not ideation fluff.

## Success signal

One real person (Raagul) processes a real 50-page document start-to-finish in
Jarwiz instead of Claude/ChatGPT — because the map, the citations, and the
export made it *better*, not just prettier. Then a second person does.
