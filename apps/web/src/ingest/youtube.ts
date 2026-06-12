/** YouTube URL detection for ingestion (watch / shorts / youtu.be / embed). */

export function parseYouTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, '');
  const isValidId = (id: string | null | undefined): id is string =>
    typeof id === 'string' && /^[\w-]{6,}$/.test(id);

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return isValidId(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'watch') {
      const id = url.searchParams.get('v');
      return isValidId(id) ? id : null;
    }
    if ((segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') && segments[1]) {
      return isValidId(segments[1]) ? segments[1] : null;
    }
    // youtube.com/?v=… (rare, but cheap to support)
    const id = url.searchParams.get('v');
    return isValidId(id) ? id : null;
  }

  return null;
}
