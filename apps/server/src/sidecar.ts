/**
 * Sidecar generation — real Claude output without an API key, via the Claude
 * Code CLI in headless mode (`claude -p`). This is the official, supported way
 * to script Claude; it uses the environment's existing auth, no credentials are
 * read or forwarded. The server shells out to it as a sidecar process for a
 * single text completion.
 *
 * Used when ANTHROPIC_API_KEY is unset but the CLI is present: Autopilot,
 * table-fill, comment replies, and the text-producing agents (Summarizer,
 * Writer, Brainstormer) become genuinely real instead of scripted.
 */

import { spawn } from 'node:child_process';

const CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const DEFAULT_TIMEOUT_MS = 60_000;

let cached: boolean | null = null;

/** Is the Claude CLI usable as a sidecar? (no API key, binary present) */
export function sidecarAvailable(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return false; // prefer the real API
  if (process.env.JZ_DISABLE_SIDECAR) return false;
  if (cached !== null) return cached;
  cached = true; // resolved lazily on first call; spawn failure flips it off
  return cached;
}

export interface SidecarOptions {
  /** Replace the agent's whole system prompt — makes it a plain generator. */
  system: string;
  /** The user turn, piped via stdin (no arg-length/escaping limits). */
  user: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * One headless completion. Resolves the model's plain-text output. Rejects on
 * non-zero exit, timeout, or abort. Tools are disabled so it never wanders off
 * into agentic file/web actions — pure text in, text out.
 */
export function sidecarGenerate({
  system,
  user,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: SidecarOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const child = spawn(
      CLI,
      ['-p', '--output-format', 'text', '--system-prompt', system, '--disallowed-tools', '*'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('sidecar timed out'));
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      cached = false; // binary not actually usable — stop trying
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `claude exited ${code}`));
    });

    child.stdin.write(user);
    child.stdin.end();
  });
}
