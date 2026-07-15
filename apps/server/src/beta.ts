/**
 * Beta access signups — capture an email from the landing page and send the
 * visitor a confirmation.
 *
 * The landing page (site/index.html) is a static GitHub Pages document with no
 * backend of its own, so its "Request access" bar POSTs here. This module owns
 * three jobs, each independently best-effort so a missing piece never 500s the
 * request:
 *
 *   1. validate  — a real-looking address, capped length.
 *   2. record    — append to a JSONL file (deduped), same tmpdir-on-free-tier
 *                  grain as pilot.ts / assets.ts. The list is a nice-to-have;
 *                  the confirmation email is the product promise.
 *   3. confirm   — email the visitor via Resend's REST API (no SDK dependency,
 *                  just fetch) when RESEND_API_KEY + JARWIZ_BETA_FROM are set,
 *                  and optionally ping the owner at JARWIZ_BETA_NOTIFY.
 *
 * Email sending is env-gated: with no provider configured (local dev, an
 * un-provisioned deploy) recordSignup still succeeds and reports
 * `confirmationSent: false`, so the client can fall back to a plain
 * "you're on the list" rather than promising an inbox that never arrives.
 *
 *   RESEND_API_KEY      provider key (dashboard secret) — enables sending
 *   JARWIZ_BETA_FROM    verified From, e.g. "Jarwiz <hello@jarwiz.app>"
 *   JARWIZ_BETA_NOTIFY  optional owner address to CC each new signup to
 *   JARWIZ_BETA_DIR     where signups.jsonl lives (default: tmpdir)
 *
 * Emails are lowercased for dedupe, and never logged.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SIGNUPS_FILE = join(process.env.JARWIZ_BETA_DIR || join(tmpdir(), 'jarwiz-beta'), 'signups.jsonl');

// Pragmatic address check: one @, a dot-bearing domain, no spaces. Deliberately
// not RFC 5322 — the goal is "won't bounce for an obvious typo", and the real
// proof of a good address is the confirmation email landing.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LEN = 254; // RFC 5321 max total length

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/** Normalize for dedupe + storage (case-insensitive, trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// In-memory dedupe set, hydrated from disk once at first use. Mirrors pilot.ts:
// the file is best-effort (wiped by a free-tier redeploy), the Set enforces
// within the process.
let seen: Set<string> | null = null;

async function loadSeen(): Promise<Set<string>> {
  if (seen) return seen;
  seen = new Set();
  try {
    const raw = await readFile(SIGNUPS_FILE, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { email?: unknown };
        if (typeof rec.email === 'string') seen.add(rec.email);
      } catch {
        /* skip a torn line */
      }
    }
  } catch {
    /* first run or wiped disk — start empty */
  }
  return seen;
}

/**
 * Persist a signup. Returns whether this is a NEW address (false = already on
 * the list — still a success from the visitor's point of view, just no second
 * write). Never throws: a disk failure degrades to in-memory only.
 */
export async function recordSignup(email: string, meta?: { source?: string }): Promise<{ isNew: boolean }> {
  const set = await loadSeen();
  if (set.has(email)) return { isNew: false };
  set.add(email);
  try {
    await mkdir(join(SIGNUPS_FILE, '..'), { recursive: true });
    // ISO timestamp keeps the log grep-able without a schema; source tags
    // hero-vs-footer so the owner can see which CTA converts.
    const record = { email, at: new Date().toISOString(), source: meta?.source ?? 'site' };
    await appendFile(SIGNUPS_FILE, JSON.stringify(record) + '\n');
  } catch {
    /* best-effort — the in-memory set still dedupes within this process */
  }
  return { isNew: true };
}

// ── Abuse guard: a small per-IP rate limit ──────────────────────────────────
// A public, unauthenticated endpoint needs a floor against a script hammering
// it. Fixed-window counter in memory — coarse but enough for a landing page;
// no dependency, resets on restart. Keyed by caller IP.

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 5; // submissions per IP per window
const hits = new Map<string, { count: number; resetAt: number }>();

/** True when this IP is over budget for the current window. */
export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Opportunistic sweep so the map can't grow unbounded from unique IPs.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

// ── Confirmation email (Resend REST — no SDK dependency) ────────────────────

interface ResendConfig {
  apiKey: string;
  from: string;
  notify?: string;
}

function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.JARWIZ_BETA_FROM?.trim();
  if (!apiKey || !from) return null;
  const notify = process.env.JARWIZ_BETA_NOTIFY?.trim();
  return { apiKey, from, notify: notify || undefined };
}

/** True when an email provider is configured — the client can promise an inbox. */
export function canSendEmail(): boolean {
  return resendConfig() !== null;
}

async function resendSend(
  cfg: ResendConfig,
  msg: { to: string; subject: string; html: string; text: string },
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal,
    });
    return res.ok;
  } catch {
    return false; // network/abort — caller reports confirmationSent:false
  }
}

const CONFIRM_SUBJECT = 'You’re on the Jarwiz early-access list';

function confirmBodyText(): string {
  return [
    'Thanks for asking to try Jarwiz — you’re on the early-access list.',
    '',
    'Jarwiz is an infinite canvas where live AI agents take your ideas from a',
    'single prompt to a finished doc, table, diagram, prototype, or whole board.',
    '',
    'We’re letting people in as we widen the beta, and we’ll email you the moment',
    'your invite is ready. No action needed from you — just keep an eye on this',
    'inbox.',
    '',
    '— The Jarwiz team',
  ].join('\n');
}

function confirmBodyHtml(): string {
  // Inline styles only — email clients strip <style>. Kept plain and legible;
  // the point is a real, trustworthy confirmation, not a marketing blast.
  return `<!doctype html><html><body style="margin:0;background:#09090b;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e4e4e7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
    <tr><td style="padding:0 8px 24px;font-size:20px;font-weight:700;color:#fafafa;">Jarwiz</td></tr>
    <tr><td style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:28px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#fafafa;">You’re on the early-access list ✦</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d8;">
        Thanks for asking to try Jarwiz — an infinite canvas where live AI agents take your
        ideas from a single prompt to a finished doc, table, diagram, prototype, or whole board.
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d8;">
        We’re letting people in as we widen the beta, and we’ll email you the moment your invite
        is ready. No action needed — just keep an eye on this inbox.
      </p>
      <p style="margin:24px 0 0;font-size:14px;color:#a1a1aa;">— The Jarwiz team</p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Send the visitor their confirmation (and optionally notify the owner).
 * Returns true only when the confirmation to the VISITOR was accepted by the
 * provider; the owner ping is fire-and-forget and never gates the result.
 */
export async function sendConfirmationEmail(email: string, signal?: AbortSignal): Promise<boolean> {
  const cfg = resendConfig();
  if (!cfg) return false;
  const sent = await resendSend(
    cfg,
    { to: email, subject: CONFIRM_SUBJECT, html: confirmBodyHtml(), text: confirmBodyText() },
    signal,
  );
  if (cfg.notify) {
    // Best-effort owner heads-up; failure here doesn't change what the visitor sees.
    void resendSend(
      cfg,
      {
        to: cfg.notify,
        subject: `New Jarwiz signup: ${email}`,
        html: `<p>New early-access signup:</p><p><strong>${email}</strong></p>`,
        text: `New early-access signup: ${email}`,
      },
      signal,
    );
  }
  return sent;
}
