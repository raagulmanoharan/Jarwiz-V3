/**
 * Per-request model access — BYOK (bring your own key).
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
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';

const requestKeyStore = new AsyncLocalStorage<string>();

/** Anthropic keys are sk-ant-… strings; anything else is noise, not a key.
 *  Loose on purpose — the API is the real validator (bad keys get a 401). */
export function sanitizeRequestKey(header: string | undefined): string | undefined {
  const key = header?.trim();
  if (!key || key.length > 250 || !/^sk-[A-Za-z0-9_-]+$/.test(key)) return undefined;
  return key;
}

/** Run `fn` (the rest of the request) with the visitor's key in scope. */
export function runWithRequestKey<T>(key: string | undefined, fn: () => T): T {
  return key ? requestKeyStore.run(key, fn) : fn();
}

/** The key this call should use: the request's BYOK header, else the env. */
export function modelKey(): string | undefined {
  const requestKey = requestKeyStore.getStore();
  if (requestKey) return requestKey;
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  return envKey || undefined;
}

/** True when a real model call is possible for the current request. */
export function hasModelKey(): boolean {
  return Boolean(modelKey());
}

/** An Anthropic client bound to the current request's key. */
export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: modelKey() });
}
