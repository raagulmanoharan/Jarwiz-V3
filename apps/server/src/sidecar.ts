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
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  /** Base64 images (dropped image cards) with no file on disk — the sidecar
   *  writes each to a temp file so the model can Read it, same as frames. */
  imageData?: Array<{ mediaType: string; data: string }>;
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
  imageData,
}: SidecarOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const hasVision = Boolean(imagePaths?.length || imageData?.length);
    const allow: string[] = [];
    if (web) allow.push('WebSearch', 'WebFetch');
    if (hasVision) allow.push('Read');
    const toolArgs = allow.length > 0
      ? ['--allowed-tools', allow.join(',')]
      : ['--disallowed-tools', '*'];
    const limitMs = timeoutMs ?? (web || hasVision ? WEB_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    // Read renders images by extension, but asset files are extensionless and
    // image cards arrive as base64. Stage both as extensioned files in one
    // throwaway dir: symlink the frame files, decode the base64 images.
    let frameDir: string | null = null;
    let frameLinks: string[] = [];
    if (hasVision) {
      try {
        frameDir = mkdtempSync(join(tmpdir(), 'jz-frames-'));
        (imagePaths ?? []).forEach((p, i) => {
          const link = join(frameDir!, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
          symlinkSync(p, link);
          frameLinks.push(link);
        });
        (imageData ?? []).forEach((im, i) => {
          const ext = im.mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
          const file = join(frameDir!, `image_${String(i + 1).padStart(2, '0')}.${ext}`);
          writeFileSync(file, Buffer.from(im.data, 'base64'));
          frameLinks.push(file);
        });
      } catch {
        frameLinks = imagePaths ?? []; // staging denied → raw frame paths still Read
      }
    }
    const turn = frameLinks.length
      ? `${user}\n\n[${frameLinks.length} image(s) are attached as files (video frames in time order, and/or dropped images). Read EACH file below to actually SEE it before answering:\n${frameLinks.join('\n')}]`
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

/** Leading agentic-narration the headless CLI sometimes prints before the
 *  actual answer ("Have enough confirmed info now.", "Let me search…"). These
 *  slip past the answer's own "no preamble" instruction because they're the
 *  CLI's planning voice, not the model's reply — and a stray first line steals
 *  the doc card's title slot. Strip whole leading lines that match. */
const META_PREAMBLE =
  /^\s*(?:have enough|let me|i'?ll |i will |i'?ve |i have |now i|okay[,.]|alright[,.]|got it|based on (?:my|the) (?:search|research|reading)|let'?s |first[,.]|great[,.]|perfect[,.]|here'?s what|now (?:i|let)|searching|looking|checking|i now have|that gives me|this (?:confirms|gives)|good[,.])[^\n]*\n+/i;

/** Strip stray model artifacts that occasionally leak from the CLI stream. */
function cleanOutput(raw: string): string {
  let out = raw
    .replace(/<\/?s>/gi, '') // end-of-sequence token leaks (</s>)
    .replace(/<\|(?:eot_id|endoftext|end_of_turn)\|>/gi, '')
    .trimStart();
  // Peel leading narration lines (a couple at most) before the real content.
  for (let i = 0; i < 3 && META_PREAMBLE.test(out); i++) out = out.replace(META_PREAMBLE, '');
  return out.trim();
}
