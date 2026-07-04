/**
 * SSRF guard for the link-preview fetcher.
 *
 * Only http(s) URLs are allowed, and every hostname is resolved before we
 * connect — requests to private, loopback, link-local, or otherwise
 * non-public address ranges are rejected. Re-checked on every redirect hop.
 *
 * IPv6 handling normalizes embedded-IPv4 forms (IPv4-mapped ::ffff:0:0/96 in
 * both dotted and hex spelling, NAT64 64:ff9b::/96, 6to4 2002::/16) and runs
 * the embedded IPv4 through the same v4 blocklist, so `[::ffff:7f00:1]` can't
 * sneak past as "not loopback".
 *
 * DNS rebinding: `assertPublicHttpUrl` vets what lookup() returns, but a plain
 * fetch() would re-resolve and could be handed a different (private) address by
 * a fast-flux DNS server. `publicOnlyAgent` closes that gap — it is an undici
 * dispatcher whose connect-time `lookup` re-vets every resolved address at the
 * moment the socket is opened, so the address we checked IS the address we
 * connect to (TLS SNI/cert validation still use the original hostname).
 * Callers doing outbound fetches of untrusted URLs must pass it as the
 * `dispatcher`. Residual risk: requests that skip the agent (fixed, trusted
 * hosts like the YouTube oEmbed endpoint) rely on the pre-flight check alone.
 */

import { lookup } from 'node:dns/promises';
import { lookup as lookupCb } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

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

/**
 * Expand an IPv6 literal to its 8 hextets (dotted-quad tails folded into the
 * last two). Returns null when unparseable — callers fail closed on null.
 */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();

  // Fold a trailing dotted quad (::ffff:127.0.0.1) into two hex hextets so
  // both spellings normalize identically.
  const v4Match = /^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4Match) {
    if (isIP(v4Match[2]!) !== 4) return null;
    const n = ipv4ToInt(v4Match[2]!) >>> 0;
    s = `${v4Match[1]}:${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  let hextets: string[];
  if (s.includes('::')) {
    const [rawHead = '', rawTail = ''] = s.split('::', 2);
    const head = rawHead === '' ? [] : rawHead.split(':');
    const tail = rawTail === '' ? [] : rawTail.split(':');
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    hextets = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    hextets = s.split(':');
  }
  if (hextets.length !== 8) return null;

  const out: number[] = [];
  for (const part of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    out.push(Number.parseInt(part, 16));
  }
  return out;
}

/** Reassemble an IPv4 dotted quad from two embedded hextets. */
function embeddedIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isBlockedIpv6(ip: string): boolean {
  const h = expandIpv6(ip);
  if (h === null) return true; // unparseable — fail closed
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number, number, number, number, number, number, number, number,
  ];

  // Embedded-IPv4 transition prefixes — vet the inner IPv4 with the v4 list.
  // ::ffff:0:0/96 (IPv4-mapped) and ::/96 (deprecated IPv4-compatible; also
  // covers `::` and `::1`, since 0.0.0.0/8 is blocked).
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0 || h5 === 0xffff)) {
    return isBlockedIpv4(embeddedIpv4(h6, h7));
  }
  // 64:ff9b::/96 — NAT64 well-known prefix.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isBlockedIpv4(embeddedIpv4(h6, h7));
  }
  // 2002::/16 — 6to4 (the IPv4 lives in hextets 1–2).
  if (h0 === 0x2002) {
    return isBlockedIpv4(embeddedIpv4(h1, h2));
  }

  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h0 === 0x2001 && h1 === 0x0db8) return true; // 2001:db8::/32 docs

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an IP at all — fail closed
}

/**
 * Undici dispatcher that re-vets DNS at connect time, defeating rebinding: the
 * custom `lookup` runs every resolved address through the blocklist and hands
 * the connector only vetted addresses, so fetch() cannot be steered to a
 * private IP between our pre-flight check and the actual connect.
 *
 * Cast at the boundary: undici@7's Agent is runtime-compatible with Node 22's
 * built-in fetch (`dispatcher` option), but the two declaration sets
 * (undici vs the undici-types bundled in @types/node) disagree on incidental
 * types like FormData iterators, so structural assignability fails.
 */
export const publicOnlyAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookupCb(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, []);
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
          return callback(new SsrfError('URL resolves to a non-public address'), []);
        }
        callback(null, list);
      });
    },
  },
}) as unknown as NonNullable<RequestInit['dispatcher']>;

/**
 * Validates a URL for outbound fetching. Throws SsrfError when the URL is
 * not plain http(s) or its hostname resolves to a non-public address.
 * Pre-flight only — pair the fetch with `publicOnlyAgent` so the connect-time
 * resolution is pinned to vetted addresses too.
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
