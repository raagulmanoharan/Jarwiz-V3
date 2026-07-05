/**
 * Server-side link metadata extraction for POST /api/link/preview.
 *
 * Fetches the page (10s budget, capped redirects, real UA, SSRF-guarded on
 * every hop with connect-time DNS pinning via publicOnlyAgent), parses title /
 * description / og:image / favicon / theme-color with cheerio, and — only when
 * ANTHROPIC_API_KEY is set — runs a one-shot claude-haiku-4-5 cleanup over the
 * title/description (8s cap). Any enrichment failure or timeout falls back to
 * the raw metadata; the API key never reaches the client.
 */

import * as cheerio from 'cheerio';
import type { LinkPreview } from '@jarwiz/shared';
import { assertPublicHttpUrl, publicOnlyAgent } from './ssrf.js';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MiB of HTML is plenty for <head>
/** Enrichment is optional sugar — never let a slow model hold a preview open. */
const ENRICH_TIMEOUT_MS = 8_000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 JarwizLinkPreview/0.1';

/**
 * Fetch with manual redirect-following so every hop is SSRF-checked, over the
 * `publicOnlyAgent` dispatcher so the connect-time DNS resolution is re-vetted
 * too (a fast-flux resolver can't rebind us to a private IP between the
 * pre-flight check and the socket connect).
 */
async function fetchPublicPage(rawUrl: string): Promise<{ finalUrl: URL; html: string }> {
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = await assertPublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: deadline,
      dispatcher: publicOnlyAgent,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      response.body?.cancel().catch(() => {});
      if (!location) throw new Error(`Redirect without a Location header (${response.status})`);
      url = await assertPublicHttpUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new Error(`Upstream responded ${response.status}`);
    }

    const html = await readCapped(response, MAX_HTML_BYTES);
    return { finalUrl: url, html };
  }

  throw new Error('Too many redirects');
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function parseMetadata(html: string, finalUrl: URL): LinkPreview {
  const $ = cheerio.load(html);

  const meta = (selector: string): string | undefined =>
    $(selector).first().attr('content')?.trim() || undefined;

  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    $('title').first().text().trim() ??
    '';

  const description =
    meta('meta[property="og:description"]') ??
    meta('meta[name="description"]') ??
    meta('meta[name="twitter:description"]') ??
    '';

  const resolve = (href: string | undefined): string | undefined => {
    if (!href) return undefined;
    try {
      return new URL(href, finalUrl).href;
    } catch {
      return undefined;
    }
  };

  const image = resolve(
    meta('meta[property="og:image"]') ??
      meta('meta[property="og:image:url"]') ??
      meta('meta[name="twitter:image"]'),
  );

  const faviconHref =
    $('link[rel="icon"]').first().attr('href') ??
    $('link[rel="shortcut icon"]').first().attr('href') ??
    $('link[rel="apple-touch-icon"]').first().attr('href') ??
    '/favicon.ico';
  const favicon = resolve(faviconHref);

  const themeColor = meta('meta[name="theme-color"]');
  const siteName = meta('meta[property="og:site_name"]');

  // Readable page text, from the same fetch — so a pasted link is groundable
  // content (summarise / ask / scan), not just a pretty preview. Prefer the
  // article/main region; strip chrome; cap hard.
  $('script, style, noscript, svg, nav, header, footer, aside, form').remove();
  const region = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
  const text = region.text().replace(/\s+/g, ' ').trim().slice(0, 8_000);

  return {
    url: finalUrl.href,
    title: title || finalUrl.hostname,
    description,
    ...(image ? { image } : {}),
    ...(favicon ? { favicon } : {}),
    ...(themeColor ? { themeColor } : {}),
    ...(siteName ? { siteName } : {}),
    ...(text ? { text } : {}),
  };
}

/**
 * Optional Haiku cleanup of scraped title/description. Strictly best-effort:
 * no key, an API error, or malformed output all return the raw preview.
 */
async function enrichWithHaiku(preview: LinkPreview): Promise<LinkPreview> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return preview;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system:
          'You clean up scraped web page metadata for display on link preview cards. ' +
          'Respond with strict JSON only: {"title": string, "description": string}. ' +
          'Trim site-name suffixes and SEO boilerplate from the title, keep it under ' +
          '90 characters, and rewrite the description as one or two crisp sentences ' +
          '(under 200 characters). Preserve the original language and meaning. Do not invent facts.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              url: preview.url,
              title: preview.title,
              description: preview.description,
              siteName: preview.siteName ?? null,
            }),
          },
        ],
      },
      { signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS) },
    );

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return preview;

    const jsonText = block.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const cleaned: unknown = JSON.parse(jsonText);
    if (
      typeof cleaned === 'object' &&
      cleaned !== null &&
      typeof (cleaned as Record<string, unknown>).title === 'string' &&
      typeof (cleaned as Record<string, unknown>).description === 'string'
    ) {
      const { title, description } = cleaned as { title: string; description: string };
      return {
        ...preview,
        title: title.trim() || preview.title,
        description: description.trim() || preview.description,
      };
    }
    return preview;
  } catch {
    // Enrichment is optional sugar — never let it break a preview.
    return preview;
  }
}

export async function buildLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const { finalUrl, html } = await fetchPublicPage(rawUrl);
  const preview = parseMetadata(html, finalUrl);
  return enrichWithHaiku(preview);
}

/** Fetch a page and return its title + cleaned visible body text (capped). */
export async function fetchPageText(
  rawUrl: string,
  maxChars = 6000,
): Promise<{ title: string; text: string }> {
  const { finalUrl, html } = await fetchPublicPage(rawUrl);
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, header, footer, nav').remove();
  const title = $('title').first().text().trim() || finalUrl.hostname;
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, maxChars);
  return { title, text };
}

const YT_OEMBED_TIMEOUT_MS = 6_000;

async function youTubeOEmbed(url: string): Promise<{ title?: string; author?: string }> {
  try {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('format', 'json');
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(YT_OEMBED_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { title?: string; author_name?: string };
    return { title: j.title, author: j.author_name };
  } catch {
    return {};
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Read what we honestly can from a YouTube video: the title/author (oEmbed,
 * reliable) and, best-effort, the caption transcript scraped from the watch
 * page. When captions aren't available the text says so plainly rather than
 * pretending — the agent should never fabricate what's said in a video.
 */
export async function fetchYouTubeText(
  rawUrl: string,
  maxChars = 6000,
): Promise<{ title: string; text: string; hasTranscript: boolean }> {
  const meta = await youTubeOEmbed(rawUrl);
  const title = meta.title?.trim() || 'YouTube video';
  let transcript = '';
  try {
    const { html } = await fetchPublicPage(rawUrl);
    const match = html.match(/"captionTracks":(\[.*?\])/s);
    if (match?.[1]) {
      const tracks = JSON.parse(match[1]) as Array<{ baseUrl?: string; languageCode?: string }>;
      const track = tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
      if (track?.baseUrl) {
        const { html: xml } = await fetchPublicPage(track.baseUrl);
        transcript = [...xml.matchAll(/<text[^>]*>(.*?)<\/text>/gs)]
          .map((m) => decodeEntities((m[1] ?? '').replace(/<[^>]+>/g, ' ')))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxChars);
      }
    }
  } catch {
    /* transcript unavailable — fall back to metadata */
  }
  if (transcript) {
    const by = meta.author ? ` by ${meta.author}` : '';
    return { title, text: `Transcript of the video "${title}"${by}:\n${transcript}`, hasTranscript: true };
  }
  const by = meta.author ? ` by ${meta.author}` : '';
  return {
    title,
    text: `This is the YouTube video "${title}"${by}. No captions/transcript are available to read, so only the title and author are known — the spoken content can't be seen.`,
    hasTranscript: false,
  };
}

export { SsrfError } from './ssrf.js';
