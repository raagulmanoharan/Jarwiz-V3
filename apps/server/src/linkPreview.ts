/**
 * Server-side link metadata extraction for POST /api/link/preview.
 *
 * Fetches the page (10s budget, capped redirects, real UA, SSRF-guarded on
 * every hop), parses title / description / og:image / favicon / theme-color
 * with cheerio, and — only when ANTHROPIC_API_KEY is set — runs a one-shot
 * claude-haiku-4-5 cleanup over the title/description. Any enrichment
 * failure falls back to the raw metadata; the API key never reaches the
 * client.
 */

import * as cheerio from 'cheerio';
import type { LinkPreview } from '@jarwiz/shared';
import { assertPublicHttpUrl } from './ssrf.js';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MiB of HTML is plenty for <head>

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 JarwizLinkPreview/0.1';

/** Fetch with manual redirect-following so every hop is SSRF-checked. */
async function fetchPublicPage(rawUrl: string): Promise<{ finalUrl: URL; html: string }> {
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = await assertPublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: deadline,
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

  return {
    url: finalUrl.href,
    title: title || finalUrl.hostname,
    description,
    ...(image ? { image } : {}),
    ...(favicon ? { favicon } : {}),
    ...(themeColor ? { themeColor } : {}),
    ...(siteName ? { siteName } : {}),
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

    const response = await client.messages.create({
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
    });

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

export { SsrfError } from './ssrf.js';
