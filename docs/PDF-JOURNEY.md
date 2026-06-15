# PDF Journey — Product Spec (v1)

Status: **spec / plan of record** (no code yet). This is the first primitive in a
deliberate "one shape, fully thought through" reset. Decisions captured here were
made with the product owner on 2026-06-15.

## Decisions locked

| Question | Decision |
|---|---|
| AI framing | **Ask AI first.** No agent-picking. Named agents disappear from the UI; routing is invisible. |
| Response shape | **Auto + prompt hints.** Inferred from question/content; phrasing ("…as a table") steers it. No format picker. |
| Reader depth (v1) | **Flip + resize.** Real paged rendering (pdf.js), page navigation, resize scales the preview. No text layer. |
| Contextual pills | **Predefined, content-aware Ask prompts.** Pills are seed prompts that defeat the blank slate — the *same* pipeline as free-form Ask, just pre-filled. |
| PDF storage | **tldraw `TLAssetStore` + server blob.** Card holds a reference; bytes live in object storage. (Rationale + research below.) |

## 0. Design principles (the spine)

1. **One AI verb: "Ask."** The user clicks a suggested prompt or types a question. Routing (summarize / extract / compare / find) is internal and invisible.
2. **The answer chooses its own form.** A response is a doc, table, or list because the content wants that shape — steerable by phrasing, never by a format control.
3. **Everything is a card; every answer has a parent.** Each response sits adjacent to its source(s) with a provenance edge. Asking is recursive — you can ask about an answer, or about several cards at once.
4. **Manual primitives start empty; AI primitives start full.** A hand-placed table is a blank 2-column "Untitled" scaffold. An AI table arrives populated and shaped to the answer. These are two different mental models and must look/behave differently. (The current 4-mystery-column manual default is wrong and gets removed.)

## 1. Objects in this journey

| Object | What it is | Born from |
|---|---|---|
| **PDF card** | The embedded reader (the source) | Upload / drop / paste |
| **Ask input** | Transient inline field anchored to a card or selection | Clicking "Ask AI" (or a pill, pre-filled) |
| **Response card** | Auto-shaped answer (doc / table / list) | An Ask submission |
| **Provenance edge** | Visible link source → response | Every response |
| **Cluster** | Implicit group formed when you ask across a multi-selection | Selecting 2+ cards and asking |

## 2. The reader (the non-negotiable baseline)

- **Ingest paths:** drag-and-drop, paste, toolbar file-picker; later, a URL that resolves to a PDF.
- **Rendering:** real pages via **pdf.js**. Page 1 renders on drop. Only the visible page renders (lazy) so a 200-page deck doesn't choke.
- **Navigation:** prev/next + a page indicator (`3 / 12`); arrow keys page when the card is focused. *(Open: jump-to-page input — v1 or later.)*
- **Resize:** dragging the card handles scales the page preview, preserving aspect ratio; sensible min, and a max so it can't swallow the canvas.
- **States to design:** loading → first-page render → ready; plus the failure set — **scanned/image-only** (no extractable text), **password-protected**, **corrupt/unsupported**, **very large** (page count + bytes). Each gets an honest visual, never an endless spinner.

## 3. Ask AI + contextual pills (one pipeline)

There is exactly **one code path**: `ask(prompt, sources[]) → response card`. Typing a
question and clicking a pill both resolve to it; only where the `prompt` string
comes from differs.

**Pills = predefined, content-aware seed prompts.** On successful ingest, a
background content pass (server-side text extraction, capped) proposes **2–4
specific Ask prompts plus an always-present "Ask AI" entry.** Specificity is the
whole point: not "Summarize" but "Summarize the obligations," "Extract the key
dates," "Explain the indemnity clause." Pills answer *"what's even worth asking?"*;
once the user knows, they type their own.

**The Ask interaction:**
1. **Affordance:** an "Ask AI" pill on the card (and on any selection).
2. **Expand:** it becomes an inline input anchored to the card — *"Ask anything about this PDF…"* A pill pre-fills this same input.
3. **Submit (Enter):** a response card spawns adjacent, streams in, draws a provenance edge.
4. **Shape inference:** "compare the two plans" → **table**; "what does clause 4 mean" → **doc**; "list every deadline" → **list**. Phrasing is the steering wheel.
5. **Lifecycle:** cancellable while running; the question is editable / re-askable; empty or junk input never produces an empty card.

**Degradation:** if the content pass can't read the PDF (scanned/encrypted), there
are simply **no seed pills** — the bare "Ask AI" input remains. No special-casing.

This collapses today's agent roster, the ⌘K "pick an agent" palette, and the
Writer's hidden compare-vs-prose routing into "Ask → auto-shape."

## 4. Nesting & clusters

- **Ask on a response card.** The answer becomes a source for the next question — recursion is the core loop ("turn this summary into a checklist").
- **Ask across a selection.** Select a PDF + a response, or two PDFs, and Ask; the selection *is* the cluster. The response hangs off all of them.
- **Context depth (recommendation):** selected cards **+ their immediate sources**, capped — so "ask across these two summaries" still knows which PDFs they came from.

## 5. Provenance & citations

Every response edges back to its source(s). **Page-level citations are
recommended for v1** because compliance Q&A lives or dies on verifiability: an
answer cites the page it drew from ("…per p.4") so the user can flip the reader to
check. This is also the honesty backstop — if a claim can't be grounded in the
text, the answer says so rather than inventing.

## 6. Storage architecture (researched)

**Decision: tldraw `TLAssetStore` backed by server blob storage.** The card holds
an `assetId`; the asset *record* (metadata: page count, name, mime — synced) is
separate from the *bytes* (in object storage — not synced). pdf.js renders from
the resolved URL; the server, holding the blob, runs the text-extraction content
pass directly (no shipping the PDF back up for suggestions).

- **Dev:** a filesystem-backed `PUT/GET /api/assets/:id` implementing `upload()` / `resolve()` / `remove()`.
- **Prod:** swap the same interface to S3/R2; optional Miro-style signed direct-to-bucket upload for large files later.
- **Replaces** the current `syncAssets` stub, which backs uploads with data URLs — the path tldraw explicitly calls out as in-memory-only.

**Why (field research, 2026-06-15):** the pattern is consistent everywhere —
*nobody puts file bytes in the synced document; the document holds a reference,
bytes live in object storage, the client uploads via a (often signed) URL.*
- **tldraw** separates the synced asset record from the bytes and recommends S3/object storage for sync servers.
- **Figma/FigJam** store uploads in object storage served via CDN, referenced by id/hash.
- **Miro** mints signed URLs so the client uploads bytes directly to cloud storage, served via CDN.

Data URLs survive only as the in-memory / single-player / tiny-file fallback.

## 7. Edge cases (what makes it feel real)

- **Scanned / image-only PDF:** no text layer → no seed pills; Ask honestly says it can only see images (OCR is a future decision, not v1).
- **Encrypted PDF:** prompt for a password or show a clear locked state.
- **Huge PDF:** cap the content pass, render lazily, tell the user the AI read the first N pages.
- **Ambiguous question:** the response asks one clarifying line rather than guessing.
- **Demo mode (no AI):** pills/Ask appear but explain a live model is needed — never silently dead.
- **Duplicate upload, offline, mid-stream disconnect:** each needs defined behavior.

## 8. The manual-table fix

A toolbar table = **2 columns, header "Untitled," empty editable cells** — a blank
scaffold you grow. AI tables are the opposite (arrive full, shaped to the answer).
Keeping the two visually/behaviorally distinct kills the "why are these columns
here?" confusion.

## 9. Open decisions for the build review

1. **Citations granularity** — page-level (recommended) vs. none in v1.
2. **OCR for scanned PDFs** — ever in scope?
3. **Jump-to-page** in the reader — v1 or later?
4. **Cluster context depth** — confirm the §4 recommendation.
5. **Signed direct-upload** — needed for v1, or fine to proxy bytes through our API at first?

## 10. Suggested build order

- **Phase 1 — Reader:** pdf.js card (flip, resize, all load/error states) + the asset-store/blob plumbing. *(No AI.)*
- **Phase 2 — Ask AI:** inline input → adjacent auto-shaped response + provenance edge (the one pipeline).
- **Phase 3 — Content pills:** the quick-pass seed prompts feeding Phase 2.
- **Phase 4 — Nesting & clusters:** ask-on-response, ask-across-selection.
- **Phase 5 — Citations + failure-mode polish.**
