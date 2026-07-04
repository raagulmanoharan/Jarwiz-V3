/**
 * The one-glance document profile ask (docs/PDF-EDGE.md build 3). Lives on the
 * card action bar as a fixed "✦ Profile" action for PDF cards — a dropped PDF
 * lands selected, so the bar appearing IS the drop-moment offer. Runs through
 * the ordinary Ask pipeline: streamed doc card, provenance edge, page
 * citations, Keep/Discard, nothing bespoke.
 */

/** Structure over prose: scannable in ten seconds. The explicit '# ' heading
 *  matters — the doc system prompt treats titles as optional and "no preamble"
 *  otherwise suppresses them, leaving an untitled card. */
export const PROFILE_PROMPT = [
  'Give me a one-glance profile of this document — compact, scannable in ten seconds.',
  "Start with a '# Profile — <short document name>' title line.",
  'Then short markdown sections with bold labels, no preamble:',
  '**What this is** — the document type and a one-line gist.',
  "**Who's behind it** — authors or parties and their roles.",
  '**Key dates** — only the ones that matter.',
  "**Red flags** — anything unusual, risky, or conspicuously missing; say 'none apparent' honestly if so.",
  '**Start here** — the one section to read first, and why.',
  'End with the three questions most worth asking this document, as a short list.',
].join('\n');
