/**
 * Per-request model access — BYOK (bring your own key) and pilot codes.
 *
 * The hosted trial runs this server with NO key of its own: a visitor pastes
 * their Anthropic key into the client (stored only in their browser), and it
 * rides along as an `x-anthropic-key` header on every /api call. Middleware
 * in index.ts parks that header in an AsyncLocalStorage scope for the life of
 * the request; everything below asks `modelKey()` / `anthropic()` instead of
 * reading process.env directly, so the visitor's key and the server's own
 * ANTHROPIC_API_KEY are interchangeable. Precedence: request header first
 * (the visitor's key does the work even when a server key exists), env
 * fallback second (local dev unchanged). Keys are never logged or stored.
 *
 * Closed pilot: when JARWIZ_PILOT_CODES is set (see pilot.ts), the env key
 * stops being a free-for-all — it only serves requests carrying a valid,
 * under-budget invite code (parked in the same request scope). Everyone else
 * falls back to BYOK/demo exactly as before. Without pilot codes configured,
 * nothing changes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { pilotConfigured } from './pilot.js';

interface RequestContext {
  /** The visitor's own Anthropic key (BYOK header), if any. */
  key?: string;
  /** A validated, under-budget pilot code, if any. */
  pilot?: string;
}

const requestStore = new AsyncLocalStorage<RequestContext>();

/** Anthropic keys are sk-ant-… strings; anything else is noise, not a key.
 *  Loose on purpose — the API is the real validator (bad keys get a 401). */
export function sanitizeRequestKey(header: string | undefined): string | undefined {
  const key = header?.trim();
  if (!key || key.length > 250 || !/^sk-[A-Za-z0-9_-]+$/.test(key)) return undefined;
  return key;
}

/** Run `fn` (the rest of the request) with the visitor's context in scope. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return ctx.key || ctx.pilot ? requestStore.run(ctx, fn) : fn();
}

/** The validated pilot code on the current request, if any. */
export function requestPilot(): string | undefined {
  return requestStore.getStore()?.pilot;
}

/** The key this call should use: the request's BYOK header first, else the
 *  server's env key — which, in pilot mode, only answers for invite holders. */
export function modelKey(): string | undefined {
  const ctx = requestStore.getStore();
  if (ctx?.key) return ctx.key;
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!envKey) return undefined;
  if (pilotConfigured() && !ctx?.pilot) return undefined;
  return envKey;
}

/** True when a real model call is possible for the current request. */
export function hasModelKey(): boolean {
  return Boolean(modelKey());
}

/** An Anthropic client bound to the current request's key. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: modelKey() });
}
