/**
 * Tiny browser file helpers for the export modal — hand a blob to the browser
 * as a download, open an HTML string in a new tab, and copy text to the
 * clipboard. Kept apart from the store so the view can call them directly.
 */

/** A filesystem-safe slug of the board title for a filename. */
export function slugify(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'jarwiz-board';
}

/** Save `text` as a download named `filename` with the given MIME type. */
export function downloadText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick so the click's navigation has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Open a full HTML document in a new tab (blob URL, so it's a real navigable
 *  page — the deck's keyboard nav and fullscreen work). Falls back to a
 *  download if the tab is blocked by a popup blocker. */
export function openHtmlInNewTab(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    // Popup blocked — give them the file instead of failing silently.
    downloadText(html, filename, 'text/html');
  }
  // Keep the URL alive long enough for the new tab to load, then release.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Copy text to the clipboard; resolves true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts where the async API is unavailable.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
