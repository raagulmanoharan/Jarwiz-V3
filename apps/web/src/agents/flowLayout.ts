/**
 * Shared layered-row layout for the canvas pivot. Used by "⤢ Tidy" to re-lay an
 * existing graph into top-down rows. Framework-free so non-hook callers can use it.
 */

/** Horizontal / vertical gap between laid-out cells. */
export const GAP_X = 88;
export const GAP_Y = 108;

/**
 * Group ids into layered rows by longest-path depth (bounded so a cycle / back-
 * edge can't loop), then compress to consecutive rows so a back-edge can't leave
 * a huge vertical gap. Order within a row follows input order. Edge endpoints not
 * in `ids` are ignored.
 */
export function computeRows(ids: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const depth = new Map<string, number>();
  for (const id of ids) depth.set(id, 0);
  const cap = ids.length;
  for (let i = 0; i < cap; i++) {
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      const next = (depth.get(e.from) ?? 0) + 1;
      if (next <= cap && next > (depth.get(e.to) ?? 0)) depth.set(e.to, next);
    }
  }
  const used = [...new Set(ids.map((id) => depth.get(id) ?? 0))].sort((a, b) => a - b);
  const rank = new Map(used.map((d, i) => [d, i]));
  const rows: string[][] = used.map(() => []);
  for (const id of ids) rows[rank.get(depth.get(id) ?? 0)!]!.push(id);
  return rows;
}
