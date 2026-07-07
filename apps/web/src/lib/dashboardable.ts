/**
 * Is a grid of cells worth turning into an interactive dashboard? A *data-aware*
 * gate — it inspects the actual cells, not the prompt text (the old
 * regex-on-intent approach can't tell a sheet of numbers from a sheet of prose).
 *
 * The rule mirrors what a dashboard needs: a header, enough rows to plot, at
 * least one mostly-numeric MEASURE column, and at least one non-numeric
 * LABEL/category (or date) column to axis it against. So "Region, Q1, Q2, Q3"
 * passes; a column of meeting notes doesn't.
 */

/** Fraction of non-empty cells in a column that parse as numbers (tolerating
 *  currency symbols, %, and thousands separators). */
function numericFraction(values: string[]): number {
  const filled = values.filter((v) => v.trim() !== '');
  if (filled.length === 0) return 0;
  const nums = filled.filter((v) => {
    const cleaned = v.replace(/[$€£¥,%\s]/g, '');
    return cleaned !== '' && Number.isFinite(Number(cleaned));
  });
  return nums.length / filled.length;
}

/** True when the grid has the shape of chartable data. */
export function gridIsDashboardable(rows: string[][]): boolean {
  if (!Array.isArray(rows) || rows.length < 4) return false; // header + ≥3 data rows
  const body = rows.slice(1).filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (body.length < 3) return false;
  const colCount = Math.max(0, ...rows.map((r) => r.length));
  if (colCount < 2) return false;

  let measureCols = 0;
  let labelCols = 0;
  for (let c = 0; c < colCount; c++) {
    const col = body.map((r) => r[c] ?? '');
    const nf = numericFraction(col);
    const filled = col.filter((v) => v.trim() !== '').length;
    if (nf >= 0.7) measureCols++;
    else if (filled >= body.length * 0.6) labelCols++; // a well-populated text column = a dimension
  }
  return measureCols >= 1 && labelCols >= 1;
}

/** Serialise a grid to compact CSV for embedding in a generation prompt. */
export function gridToCsv(rows: string[][], maxRows = 80, maxCols = 14): string {
  return rows
    .slice(0, maxRows)
    .map((r) =>
      r
        .slice(0, maxCols)
        .map((c) => {
          const v = String(c ?? '');
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join('\n');
}
