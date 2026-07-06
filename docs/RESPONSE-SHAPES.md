# Response shapes — how an agent picks the format of its answer

_Owner: Product · Status: living · Companion to ARCHITECTURE.md & ROADMAP.md._

A chat box has one output shape: a wall of text. Jarwiz's advantage is that the
**board has many shapes**, and the right one depends on the content. A
comparison wants a table; steps want a numbered list; an argument wants flowing
prose; a single thought wants a sticky note. Choosing well is part of the craft
— a table of three options reads in a glance where the same content as prose is
a slog, and vice-versa.

This doc defines the shape taxonomy and the **selection rules** every
content-producing agent (and Autopilot) should follow.

## The shapes

| Shape | Card | Use it when… | Don't use it when… |
|---|---|---|---|
| **Prose / document** | `doc` (markdown) | Explanation, argument, narrative, a summary's gist, anything where sentences and flow carry meaning. Headings + short paragraphs. | The content is a set of parallel items compared on the same dimensions (→ table) or a flat enumeration (→ list). |
| **List** | `doc` with a markdown list | Steps in order, options, a checklist, ranked items, a handful of takeaways — a **1-D enumeration** where each item is a line, not a record. | Each item has multiple comparable attributes (→ table). |
| **Table** | `table` | A **2-D matrix**: items × dimensions. Comparisons (tools × price/pros/cons), schedules (day × slot), specs, scorecards, anything you'd reach for a spreadsheet for. | There's only one column of values (→ list) or the content is explanatory (→ prose). |
| **Note** | `note` | One short idea, hook, name, or snippet — a single unit of thought. | The answer needs structure or length (→ doc/table). |
| **Source** | `link` | Citing an external page/article/video found on the web. | — |

Prose and list share the `doc` card (lists are just markdown inside a doc); the
**table** is the distinct structural choice an agent must consciously make.

## The decision rule (what an agent asks itself)

1. **Is it a comparison or matrix?** Parallel items, each described on the same
   2+ dimensions? → **table**. Signals in the ask: "compare", "vs", "options",
   "pros and cons", "matrix", "trade-offs", "by week/region/tier".
2. **Else, is it a flat enumeration?** Steps, a checklist, a ranked shortlist,
   "list of…"? → **list inside a doc**.
3. **Else, is it explanatory?** Reasoning, narrative, a summary, an argument? →
   **prose doc**.
4. **Is it a single small thought?** → **note**.

When two fit, prefer the one that's faster to scan for the reader's goal. A
table earns its structure only when the rows truly share columns; a forced table
(ragged, half-empty) is worse than a tidy list.

## How it's wired

- The **Writer** is the format-flexible agent: its runtime offers both
  `begin_card`/`finish_card` (stream a prose/markdown doc) **and** `create_table`
  (place a structured table in one step). Its system prompt encodes the rule
  above. Other v1 agents have a fixed natural shape (Summarizer → prose gist,
  Researcher → link cards, Brainstormer → notes) and don't choose.
- Protocol: `CardKind` includes `'table'`; `card.create` carries optional
  `columns` / `rows` for table cards. Agent-created tables arrive complete;
  **Autopilot** (Tab) is what fills a table cell-by-cell, live.
- Future: a lightweight **format detector** can power proactive offers — notice
  a doc that's really a comparison and offer "make this a table?", or an empty
  table and offer "fill this?" (ROADMAP §9 A3).

## Definition of done (for a format-producing agent)

The agent reaches for a table when (and only when) the content is a real matrix;
otherwise it writes prose with lists where they help. No forced tables, no walls
of prose where three columns would do. The choice is legible to a first-time
viewer without explanation.
