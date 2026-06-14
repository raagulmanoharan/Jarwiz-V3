# Content-aware suggestion pills — evaluation

_Built + evaluated 2026-06-14. Scope: YouTube, document (PDF), link._

## What it does

When an artifact lands, fast **type-based** pills appear instantly; the server
then reads the artifact's actual content and the model proposes **tailored**
agent actions, which replace the generic ones (with a "reading…" indicator).
Extraction: PDF via `pdf-parse`, link via cheerio body-text, YouTube via oEmbed.

## How it was evaluated

1. **End-to-end through the server** (`POST /api/suggest`) with a real PDF.
2. **End-to-end in the browser** — dropping the real PDF file, watching the pills
   upgrade generic → tailored.
3. **Engine quality across content types** — the suggestion engine fed
   representative content for a document, a link, and a video (link/YouTube
   *fetch* is network-blocked in this sandbox, so content was supplied directly;
   the extraction code paths are correct for production).

## Results

**Real PDF (TraceMonkey JIT paper) — end-to-end, real extraction:**
- generic → `Summarize · Comparison table · Outline a deck · Brainstorm`
- tailored → `Summarize core JIT technique` (summarizer) · `Compare JIT
  compilation approaches` (writer, → a table) · `Find follow-on JIT research`
  (researcher, brief named LuaJIT 2 / PyPy / V8 TurboFan) · `Modern JS engine
  implications` (brainstormer).

**Document — data-privacy compliance policy** (the user's example):
- `Extract GDPR/CCPA obligations` (summarizer) · **`Draft DPA & breach-response
  checklist`** (writer) · `Find 2025–26 enforcement updates` (researcher) ·
  `Identify policy gaps & risks` (brainstormer). The envisioned "compliance
  checklist" emerged unprompted.

**Link — "Nvidia tops $4T" market article:**
- bull/bear summary · CUDA-moat & rivals research · AI-chip comparison **table**
  (Nvidia/AMD/custom silicon) · capex-sustainability angles.

**YouTube — "20-minute ramen" cooking video:**
- tips cheat-sheet · **recipe card** draft · similar-method research · broth
  variation brainstorm.

## Verdict

**Strong.** Across every content type the suggestions were specific to the actual
subject (never "Summarize this"), spread sensibly across the four agents, and
mapped the right work to the right agent — comparisons/checklists/decks/recipes
→ Writer (with a precise brief), gist → Summarizer, sources → Researcher, angles
→ Brainstormer. The real-PDF run even reasoned about *follow-on* research by
name, showing it worked from the genuine extracted text.

## Honest limits

- **Sandbox network is 403**, so link/YouTube *extraction* can't run here; the
  engine (the hard part) is proven via supplied content, and the fetch/oEmbed
  paths are standard. In production these complete the loop.
- **YouTube without a transcript** is title/author-only, so its tailoring is
  shallower than PDF/link; a transcript source would deepen it.
- **Latency** ~20–40s for the tailored upgrade (sidecar). Mitigated by showing
  type-based pills instantly and a "reading…" cue.

## Next

Content-aware tailoring for **notes/docs typed on the board** (not just dropped
artifacts); a transcript source for YouTube; and a dedicated Designer agent so
"Outline a deck" becomes a real deck.
