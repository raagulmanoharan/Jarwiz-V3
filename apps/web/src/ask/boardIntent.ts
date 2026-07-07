/**
 * Does an ask want to be a whole BOARD of cards rather than one card? The
 * prompt bar uses this to route: a "plan my Goa weekend" fans out into a
 * comparison table + day docs + tips stickies + budget (compose), while
 * "summarise this" or "make a table of X" stays a single card (ask).
 *
 * Deliberately conservative — when unsure we keep the single-card path (the
 * cheaper, less surprising one). The "/" Board mode is the explicit override.
 */

// Clear single-artifact intents — a specific shape is being asked for, so even
// if other board words appear, honour the single card.
const SINGLE = /\b(summari[sz]e|tl;?dr|rewrite|reword|shorten|condense|expand this|translate|define|proofread|make (a|this) (table|list|diagram|chart|flow ?chart)|as a (table|list|diagram|bullet)|turn this into a)\b/i;

// Composite / build-a-board intents — the answer naturally wants several
// distinct cards laid out together. NOTE: "dashboard" is deliberately NOT here —
// it is now a first-class single card (the interactive dashboard), so a prompt
// mentioning "dashboard" must route to that card, not a board fan-out. (The
// substring also lurks inside "dashboard" itself — "focus this dashboard on
// APAC" must never be read as board intent.)
const BOARD =
  /\b(plan|organi[sz]e|build (it |this )?out|build me|map out|break (this|it) down|break down|set (this |it )?up|put together|lay out|storyboard|itinerary|workspace|a board|full board|whole board|everything (i|we|you) need|end[- ]to[- ]end|from scratch|kit|starter pack|game ?plan|road ?map|walk me through (planning|setting)|help me (plan|organi[sz]e|prepare for))\b/i;

export function looksLikeBoard(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length < 4) return false;
  if (SINGLE.test(p)) return false;
  return BOARD.test(p);
}
