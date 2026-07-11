/**
 * The Jarwiz sparkle — THE brand mark (the four-point star from the topbar
 * logo), as a shared component so every surface that speaks in the app's
 * voice (action bar, sync/draft pills, comments, prompt bar, Ultra Think)
 * draws the exact same glyph. One path, one source: before this, the spark
 * appeared as a ✦ text glyph here and lucide's three-star Sparkles there
 * (owner call 2026-07-11 — one mark everywhere). Inherits `currentColor`.
 */

import type { SVGProps } from 'react';

export function JarwizSpark({ size = 14, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...rest}>
      <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" fill="currentColor" />
    </svg>
  );
}
