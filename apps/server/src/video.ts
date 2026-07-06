/**
 * Video ingestion — Jarwiz learns to WATCH (docs/USECASE-CREATOR.md G7,
 * recipe from bradautomates/claude-video): yt-dlp pulls captions (sturdier
 * than scraping the watch page), ffmpeg samples budget-capped frames which a
 * cheap grayscale-diff dedup thins, and the frames land in the asset store so
 * asks can ship them to the model as vision inputs with [m:ss] markers.
 * Everything degrades honestly: no yt-dlp → caller falls back to the caption
 * scrape; no ffmpeg → transcript only; nothing readable → title only.
 *
 * Tool paths override via JZ_YTDLP_PATH / JZ_FFMPEG_PATH (the dev sandbox
 * uses pip's yt-dlp and imageio-ffmpeg's static binary).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { putAsset } from './assets.js';

const YT_DLP = process.env.JZ_YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.JZ_FFMPEG_PATH || 'ffmpeg';

const CAPTION_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const FRAME_TIMEOUT_MS = 60_000;
/** Keep downloads bounded — frames don't need more than SD. */
const FORMAT = 'mp4[height<=480]/best[height<=480]/best';
const MAX_FILESIZE = '200m';
/** Near-duplicate threshold: mean abs diff on a 16×16 grayscale thumb (0-255). */
const DEDUP_THRESHOLD = 2.0;
/** Frames that survive dedup are capped hard — every frame is paid tokens. */
const MAX_FRAMES = 24;

let caps: { ytdlp: boolean; ffmpeg: boolean } | null = null;

/** Which halves of the pipeline this host can run (probed once). */
export function videoTools(): { ytdlp: boolean; ffmpeg: boolean } {
  if (caps) return caps;
  const probe = (cmd: string) => {
    try {
      return spawnSync(cmd, ['-version'], { stdio: 'ignore', timeout: 5_000 }).status !== null;
    } catch {
      return false;
    }
  };
  caps = { ytdlp: probe(YT_DLP), ffmpeg: probe(FFMPEG) };
  return caps;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** One raw frame from a run, before storage. */
interface RawFrame {
  path: string;
  /** Seconds into the video. */
  t: number;
}

export interface StoredFrame {
  assetId: string;
  t: number;
}

export interface VideoIngestResult {
  title: string;
  /** [m:ss]-marked transcript, or '' when no captions. */
  text: string;
  hasTranscript: boolean;
  frames: StoredFrame[];
}

/** Parse a VTT cue timestamp ("00:01:02.500" or "01:02.500") to seconds. */
function vttSeconds(ts: string): number {
  const parts = ts.split(':').map((p) => Number.parseFloat(p));
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** VTT → [m:ss]-bucketed plain text. Auto-captions repeat rolling lines, so
 *  consecutive duplicate lines collapse. */
export function vttToTranscript(vtt: string, maxChars = 16_000): string {
  const parts: string[] = [];
  let lastBucket = -1;
  let lastLine = '';
  let cueStart = NaN;
  for (const raw of vtt.split('\n')) {
    const line = raw.trim();
    const cue = /^(\d{1,2}:)?\d{1,2}:\d{2}\.\d{3}\s+-->/.exec(line);
    if (cue) {
      cueStart = vttSeconds(line.split(/\s+/)[0] ?? '');
      continue;
    }
    if (!line || line === 'WEBVTT' || /^(Kind|Language|NOTE|STYLE|::cue)/.test(line) || /^\d+$/.test(line)) continue;
    const text = line.replace(/<[^>]+>/g, '').trim();
    if (!text || text === lastLine) continue;
    if (Number.isFinite(cueStart)) {
      const bucket = Math.floor(cueStart / 20);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        const mm = Math.floor(cueStart / 60);
        const ss = String(Math.floor(cueStart % 60)).padStart(2, '0');
        parts.push(`[${mm}:${ss}]`);
      }
    }
    parts.push(text);
    lastLine = text;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/** Captions + title via yt-dlp. Null when the tool or the captions aren't there. */
async function captionsViaYtDlp(
  url: string,
  dir: string,
): Promise<{ title: string; text: string } | null> {
  const res = await run(
    YT_DLP,
    [
      '--skip-download', '--no-playlist',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', 'en.*,en', '--sub-format', 'vtt',
      '-o', 'cap.%(ext)s',
      '--print', 'title',
      url,
    ],
    CAPTION_TIMEOUT_MS,
    dir,
  );
  if (res.code !== 0) return null;
  const title = res.stdout.trim().split('\n')[0] ?? '';
  const vttFile = (await readdir(dir)).find((f) => f.endsWith('.vtt'));
  if (!vttFile) return { title, text: '' };
  const text = vttToTranscript(await readFile(join(dir, vttFile), 'utf8'));
  return { title, text };
}

/** Duration-aware frame budget (fewer than /watch's — transcripts ride along). */
function frameBudget(durationS: number): number {
  if (durationS <= 30) return 16;
  if (durationS <= 60) return 20;
  if (durationS <= 180) return 24;
  if (durationS <= 600) return 32;
  return 40;
}

/** Video duration in seconds, parsed from ffmpeg's banner (no ffprobe in the
 *  static bundle). */
async function ffDuration(file: string): Promise<number> {
  const res = await run(FFMPEG, ['-i', file], 10_000);
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(res.stderr);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 16×16 grayscale signature of a JPEG (256 bytes) for the dedup pass. */
async function graySig(file: string): Promise<Buffer | null> {
  const res = await new Promise<Buffer | null>((resolve) => {
    const child = spawn(FFMPEG, ['-i', file, '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
  return res && res.length >= 256 ? res : null;
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / n;
}

/** Uniformly sample budgeted 512px frames, then drop near-duplicates. */
async function extractFrames(file: string, dir: string): Promise<RawFrame[]> {
  const duration = await ffDuration(file);
  if (duration <= 0) return [];
  const budget = frameBudget(duration);
  const step = duration / budget;
  const res = await run(
    FFMPEG,
    ['-i', file, '-vf', `fps=1/${step.toFixed(4)},scale=512:-2`, '-q:v', '4', join(dir, 'f%03d.jpg')],
    FRAME_TIMEOUT_MS,
  );
  if (res.code !== 0) return [];
  const files = (await readdir(dir)).filter((f) => /^f\d{3}\.jpg$/.test(f)).sort();
  const kept: RawFrame[] = [];
  let lastSig: Buffer | null = null;
  for (const [i, f] of files.entries()) {
    const p = join(dir, f);
    const sig = await graySig(p);
    // Compare against the last KEPT frame so slow fades still register.
    if (sig && lastSig && meanAbsDiff(sig, lastSig) <= DEDUP_THRESHOLD) continue;
    if (sig) lastSig = sig;
    kept.push({ path: p, t: Math.round((i + 0.5) * step) });
    if (kept.length >= MAX_FRAMES) break;
  }
  return kept;
}

/**
 * Full ingest: captions (+title) and, when ffmpeg is available, watched
 * frames stored as assets. `wantFrames: false` keeps paste-time latency low.
 */
export async function ingestVideo(url: string, wantFrames: boolean): Promise<VideoIngestResult> {
  const tools = videoTools();
  if (!tools.ytdlp) throw new Error('yt-dlp unavailable');
  const dir = await mkdtemp(join(tmpdir(), 'jz-video-'));
  try {
    const caps2 = await captionsViaYtDlp(url, dir);
    if (!caps2) throw new Error('video unreachable');
    const { title } = caps2;
    let frames: StoredFrame[] = [];
    if (wantFrames && tools.ffmpeg) {
      const dl = await run(
        YT_DLP,
        ['--no-playlist', '-f', FORMAT, '--max-filesize', MAX_FILESIZE, '-o', 'video.%(ext)s', url],
        DOWNLOAD_TIMEOUT_MS,
        dir,
      );
      if (dl.code === 0) {
        const vid = (await readdir(dir)).find((f) => f.startsWith('video.'));
        if (vid) {
          const raw = await extractFrames(join(dir, vid), dir);
          for (const fr of raw) {
            const assetId = `vf_${randomUUID().replace(/-/g, '')}`;
            await putAsset(assetId, await readFile(fr.path));
            frames.push({ assetId, t: fr.t });
          }
        }
      }
    }
    const hasTranscript = caps2.text.length > 0;
    const by = title ? `Transcript of the video "${title}":\n` : 'Transcript:\n';
    return {
      title,
      text: hasTranscript ? `${by}${caps2.text}` : '',
      hasTranscript,
      frames,
    };
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
