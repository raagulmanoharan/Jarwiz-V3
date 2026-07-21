/**
 * Small shared server utilities. These were copy-pasted (byte-identical) across
 * the generation modules; consolidated here so there's one definition each.
 */

/** Resolve after `ms`, or immediately when `signal` aborts — so a cancelled run
 *  never waits out a pacing delay. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Split text into groups of `size` whitespace-delimited words, keeping the
 *  trailing spaces so the joined chunks reproduce the original exactly. Used to
 *  chunk-stream the sidecar's one-shot output for a live-typing feel. */
export function chunkWords(text: string, size: number): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}
