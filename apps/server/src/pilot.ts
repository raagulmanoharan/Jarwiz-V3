/**
 * Closed-pilot gate — invite codes with a metered budget on the server's key.
 *
 * The pilot lets a handful of invited people use the FULL app on the owner's
 * ANTHROPIC_API_KEY, without keys of their own, while keeping the worst-case
 * bill a number chosen in advance:
 *
 *   JARWIZ_PILOT_CODES="mira-x7k2,arjun-p3v9"   comma-separated invite codes
 *   JARWIZ_PILOT_ACTIONS=100                    per-code budget (default 100)
 *   JARWIZ_PILOT_TOTAL=1000                     global ceiling across codes
 *
 * A "action" is one card-producing agent run (ask/analyze/compose/…); the
 * cheap helper calls (shape hints, seed pills) ride along unmetered — they're
 * pennies, and metering them would burn a visible budget invisibly. Counts
 * persist best-effort to disk (tmpdir on the free tier, so a redeploy resets
 * them — pilot-grade, documented in docs/DEPLOYMENT.md); the global ceiling
 * is the real backstop.
 *
 * Codes are compared case-insensitively and never logged.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const COUNTS_FILE = join(process.env.JARWIZ_PILOT_DIR || join(tmpdir(), 'jarwiz-pilot'), 'counts.json');

function codes(): string[] {
  return (process.env.JARWIZ_PILOT_CODES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function pilotConfigured(): boolean {
  return codes().length > 0;
}

export function perCodeLimit(): number {
  const n = Number.parseInt(process.env.JARWIZ_PILOT_ACTIONS ?? '100', 10);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function totalLimit(): number {
  const n = Number.parseInt(process.env.JARWIZ_PILOT_TOTAL ?? '1000', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

// In-memory counts, hydrated from disk once at first use.
let counts: Map<string, number> | null = null;

async function loadCounts(): Promise<Map<string, number>> {
  if (counts) return counts;
  counts = new Map();
  try {
    const raw = JSON.parse(await readFile(COUNTS_FILE, 'utf8')) as Record<string, number>;
    for (const [code, n] of Object.entries(raw)) {
      if (typeof n === 'number' && n >= 0) counts.set(code, n);
    }
  } catch {
    /* first run or wiped disk — start at zero */
  }
  return counts;
}

async function saveCounts(): Promise<void> {
  if (!counts) return;
  try {
    await mkdir(join(COUNTS_FILE, '..'), { recursive: true });
    await writeFile(COUNTS_FILE, JSON.stringify(Object.fromEntries(counts)));
  } catch {
    /* best-effort — the in-memory count still enforces within this process */
  }
}

/** A known invite code (normalized), or undefined. Never throws. */
export function validatePilotCode(header: string | undefined): string | undefined {
  const code = header?.trim().toLowerCase();
  if (!code || code.length > 80) return undefined;
  return codes().includes(code) ? code : undefined;
}

export async function pilotUsed(code: string): Promise<number> {
  return (await loadCounts()).get(code) ?? 0;
}

async function totalUsed(): Promise<number> {
  let sum = 0;
  for (const n of (await loadCounts()).values()) sum += n;
  return sum;
}

/** True when this code (or the whole pilot) has spent its budget. */
export async function pilotExhausted(code: string): Promise<boolean> {
  return (await pilotUsed(code)) >= perCodeLimit() || (await totalUsed()) >= totalLimit();
}

/** Record one card-producing action against a code. */
export async function recordPilotAction(code: string): Promise<void> {
  const map = await loadCounts();
  map.set(code, (map.get(code) ?? 0) + 1);
  void saveCounts();
}

/** The card-producing endpoints that spend pilot budget. Helper calls
 *  (suggest-shape, intent, seed-prompts, notice, link previews) stay free. */
const METERED_PATHS = [
  '/api/ask',
  '/api/analyze',
  '/api/autopilot',
  '/api/autopilot/table',
  '/api/cluster',
  '/api/annotate',
  '/api/compose',
  '/api/export',
  '/api/diagram',
  '/api/discover',
  '/api/image',
  '/api/agents/',
] as const;

export function isMeteredPath(path: string): boolean {
  return METERED_PATHS.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

/** What a spent budget answers with — the client shows this verbatim. */
export const PILOT_EXHAUSTED_MESSAGE =
  'Your demo actions are used up — thank you for testing Jarwiz! See "Get full access" in the boards panel to keep going.';
