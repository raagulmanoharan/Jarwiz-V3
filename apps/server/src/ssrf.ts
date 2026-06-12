/**
 * SSRF guard for the link-preview fetcher.
 *
 * Only http(s) URLs are allowed, and every hostname is resolved before we
 * connect — requests to private, loopback, link-local, or otherwise
 * non-public address ranges are rejected. Re-checked on every redirect hop.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0);
}

function inCidr4(ip: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata lives here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, prefix]) => inCidr4(n, base, prefix));
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped / IPv4-compatible (::ffff:a.b.c.d) — check the embedded v4.
  const v4Match = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match?.[1] && isIP(v4Match[1]) === 4) return isBlockedIpv4(v4Match[1]);

  if (lower === '::' || lower === '::1') return true; // unspecified / loopback

  // Expand the first hextet to classify prefixes.
  const first = lower.split(':').find((part) => part.length > 0) ?? '';
  const firstHextet = Number.parseInt(first.padStart(4, '0'), 16);
  if (Number.isNaN(firstHextet)) return true; // unparseable — fail closed

  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (firstHextet === 0x2001 && lower.startsWith('2001:db8')) return true; // docs

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP at all — fail closed
}

/**
 * Validates a URL for outbound fetching. Throws SsrfError when the URL is
 * not plain http(s) or its hostname resolves to a non-public address.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('Only http(s) URLs are allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfError('URL resolves to a non-public address');
    }
    return url;
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfError('URL resolves to a non-public address');
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError('Hostname could not be resolved');
  }

  if (addresses.length === 0) {
    throw new SsrfError('Hostname could not be resolved');
  }
  if (addresses.some((addr) => isBlockedAddress(addr.address))) {
    throw new SsrfError('URL resolves to a non-public address');
  }

  return url;
}
