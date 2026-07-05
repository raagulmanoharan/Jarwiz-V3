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

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const DEFAULT_TIMEOUT_MS = 60_000;
/** Web-enabled runs search/fetch before answering — give them real headroom. */
const WEB_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 5_000;

let cached: boolean | null = null;

/**
 * Is the Claude CLI usable as a sidecar? (no API key, binary present).
 * The first call actually probes the binary (`claude --version`, cached) so a
 * keyless machine without the CLI honestly reports demo mode via
 * /api/capabilities and routes to the mock loop, instead of claiming a sidecar
 * it can't spawn.
 */
export function sidecarAvailable(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return false; // prefer the real API
  if (process.env.JZ_DISABLE_SIDECAR) return false;
  if (cached !== null) return cached;
  try {
    const probe = spawnSync(CLI, ['--version'], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS });
    cached = probe.status === 0; // ENOENT/timeout leave status null → false
  } catch {
    cached = false;
  }
  return cached;
}

export interface SidecarOptions {
  /** Replace the agent's whole system prompt — makes it a plain generator. */
  system: string;
  /** The user turn, piped via stdin (no arg-length/escaping limits). */
  user: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Allow the CLI's WebSearch/WebFetch so the answer can use live data —
   *  the sidecar's mirror of the API path's server tools (webTools.ts). */
  web?: boolean;
  /** Video-frame image files the model should SEE: whitelists Read and tells
   *  the model to open each one — the sidecar's stand-in for vision inputs. */
  imagePaths?: string[];
}

/**
 * One headless completion. Resolves the model's plain-text output. Rejects on
 * non-zero exit, timeout, or abort. Tools are disabled so it never wanders off
 * into agentic file actions — pure text in, text out — except `web`, which
 * whitelists exactly the two read-only web tools.
 */
export function sidecarGenerate({
  system,
  user,
  timeoutMs,
  signal,
  web,
  imagePaths,
}: SidecarOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const allow: string[] = [];
    if (web) allow.push('WebSearch', 'WebFetch');
    if (imagePaths?.length) allow.push('Read');
    const toolArgs = allow.length > 0
      ? ['--allowed-tools', allow.join(',')]
      : ['--disallowed-tools', '*'];
    const limitMs = timeoutMs ?? (web || imagePaths?.length ? WEB_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    // Asset files are extensionless; Read renders images by extension. Give
    // the model .jpg views via symlinks in a throwaway dir.
    let frameDir: string | null = null;
    let frameLinks: string[] = [];
    if (imagePaths?.length) {
      try {
        frameDir = mkdtempSync(join(tmpdir(), 'jz-frames-'));
        frameLinks = imagePaths.map((p, i) => {
          const link = join(frameDir!, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
          symlinkSync(p, link);
          return link;
        });
      } catch {
        frameLinks = imagePaths; // symlink denied → raw paths still work for Read
      }
    }
    const turn = frameLinks.length
      ? `${user}\n\n[${frameLinks.length} sampled video frames are attached as image files, in time order. Read EACH file below to actually see the video before answering:\n${frameLinks.join('\n')}]`
      : user;
    const cleanupFrames = () => {
      if (frameDir) rmSync(frameDir, { recursive: true, force: true });
    };
    const child = spawn(
      CLI,
      ['-p', '--output-format', 'text', '--system-prompt', system, ...toolArgs],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('sidecar timed out'));
    }, limitMs);

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
      cleanupFrames();
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      cleanupFrames();
      if (code === 0) resolve(cleanOutput(out));
      else reject(new Error(err.trim() || `claude exited ${code}`));
    });

    child.stdin.write(turn);
    child.stdin.end();
  });
}

/** Strip stray model artifacts that occasionally leak from the CLI stream. */
function cleanOutput(raw: string): string {
  return raw
    .replace(/<\/?s>/gi, '') // end-of-sequence token leaks (</s>)
    .replace(/<\|(?:eot_id|endoftext|end_of_turn)\|>/gi, '')
    .trim();
}
