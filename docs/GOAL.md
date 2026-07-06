# Active goal — M4 A1: the structured table + cell-fill Autopilot

_Owner: Product · Status: in progress · Companion to ROADMAP §9 (Autopilot)._

## The goal in one line

Make **structured authoring** the second Autopilot surface: a user builds a
comparison **table** — column headers and a row or two — presses **Tab**, and an
agent fills the rest **cell by cell**, its avatar hopping across the grid like a
collaborator tabbing through a spreadsheet.

## Why this, now

A0 proved Tab-to-continue for prose. The biggest unmet need beyond prose is the
table/matrix/checklist — the artifact people most often build by hand and most
dread finishing. It's also the most *legibly* magical place to show presence:
discrete cells filling one at a time, in order, is unmistakable.

## User journey (the bar)

1. User clicks **+ Table** (or summons one), gets a 3×4 grid with editable
   headers (`Option · Cost · Strengths · Watch-outs`) and an empty body.
2. They fill the header row and the first row themselves.
3. They press **Tab**. The Writer's avatar glides to the first empty cell; the
   cell fills; the avatar hops to the next; and so on, row by row.
4. They can edit any cell after; typing yields the pen instantly; the whole
   fill is a single undo.

## Scope (A1)

- **`table-card` shape** — `columns: string[]`, `rows: string[][]`; clean grid
  with a header band; per-cell editing in edit mode; resize; materializes like
  other cards.
- **+ Table affordance** in the topbar that drops a starter grid.
- **Table-fill Autopilot** — `POST /api/autopilot/table` (SSE) streaming
  `{ cell, row, col, text }` events; real Anthropic completion parsed to a grid
  then emitted cell-by-cell (so the hop reads), scripted mock with no key.
- **Client**: Tab in an editing table → fill empty cells; the Writer avatar
  hops to each cell's screen position as it lands; yield-on-type, Esc,
  single-undo, insert-only (never overwrites a non-empty cell).

## Out of scope (later)

- Adding `table` to the agent-summon `CardKind` (other agents acting on tables).
- Column add/remove UI, drag-resize columns, markdown in cells.
- Per-cell agent-colored caret (A2 polish).

## Definition of done

Tab on a half-filled table fills the empty cells in order with the avatar
hopping cell to cell; typing reclaims the pen; one undo reverts the whole fill;
typecheck + build green; a screengrab of a table filling itself is attached.
