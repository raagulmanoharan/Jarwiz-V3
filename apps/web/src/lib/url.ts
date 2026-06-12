/** Small URL display helpers shared by the card shapes and ingestion. */

/** "https://www.theverge.com/x/y" → "theverge.com" (never throws). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A single uppercase glyph for media fallbacks: "theverge.com" → "T". */
export function domainInitial(url: string): string {
  const domain = domainOf(url);
  const first = domain.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}

/** True when a pasted/dropped string is a lone http(s) URL. */
export function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
