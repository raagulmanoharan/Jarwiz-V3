# Jarwiz — comprehensive UX research

_Principal-researcher study · 2026-06-13 · real-AI build (sidecar)._

## Methodology

Three complementary methods, so findings are triangulated, not opinion-only:

1. **Hands-on journey testing** — a real multi-step authoring journey driven
   through the live product (create a plan note → Tab-to-continue → add an
   options table → Tab-fill → return to the note to comment → @mention), so
   flow/state bugs that single-shot tests hide could surface.
2. **Heuristic + source audit** — a systematic pass over the web client for
   accessibility, error/empty states, edge cases, responsive, discoverability,
   and visual/layout defects, each tied to `file:line` and a severity.
3. **Persona task study** — five Claude agents (PM, tour planner, teacher,
   YouTuber, content creator) ran their own jobs-to-be-done across two rounds
   (demo, then real AI) and rated value, adoption, and desires. See
   [USABILITY-TEST.md](./USABILITY-TEST.md).

Honest limits: the CI sandbox intermittently tears down browser automation on
shape creation, so the journey probe uses retries; one probe finding ("comment
didn't open on re-select") was an artifact of the probe's own tool-state call,
not a product bug — the audit found the *real* comment defects instead.

## Product value & adoption — would they use it?

**Yes, with one gate.** Across the persona study, adoption scores rose from an
average **5.9/10 (demo) to 7.5/10 (real AI)** once output quality could be
judged. Every persona independently reached the same verdict: _the thinking
environment and the AI are genuinely good; the gap to daily use is finishing —
**export** — not more capability._ Representative:

- YouTuber (8/10): "strong hook, correct science, real explainer structure — a
  B+ draft I'd record from."
- Content creator (8/10): "actually sharp, not generic AI — I'd ship it with
  light edits."
- Teacher (7.5/10): WW1 handout "accurate, unbiased, classroom-grade"; typing
  "for a 9th-grade reader" really did steer reading level.
- PM (7/10): build/buy/partner matrix "coherent, on-domain, names the *kind* of
  risk."

**What they'd like (desirability, ranked by demand):**
1. **Export** — Markdown / PDF / copy-out, per card and per board (5 of 5; the
   single thing between pilot and adopt).
2. **A brief/steering box per summon** — tone, length, audience; and a stored
   **brand/voice profile** (content creator, PM, teacher).
3. **Domain spines** — dates/maps/budget (travel), citations + print +
   reading-level toggle (teacher), runtime + teleprompter (YouTuber),
   repurpose-to-formats + organization/search (content).
4. **Card-focus / full-screen write mode** — sustained writing without zooming.

## Findings

Severity: **Blocker** (stops a real task / data loss), **Major** (frequent
friction or invisible failure), **Minor** (polish).

### A. Usability bugs
- **[Major] Autopilot/agent failures are invisible.** Non-200, network drop, or
  malformed stream are swallowed in empty catches (`autopilotStore.ts`,
  `useAgentRun.ts` mid-stream `error` events only log + set a fleeting avatar
  status). The avatar just vanishes — a broken run looks identical to a finished
  one, so users press Tab again and again with no feedback.
- **[Major] Summoning an empty card is allowed.** `handlePickAgent`
  (`AgentPresenceLayer.tsx`) only checks selection count, never whether the card
  has content; an empty note + "Ask Writer" runs on nothing and wastes a call.
- **[Minor] Comment-reply errors persist as fake comments.** A failed reply
  appends the literal "(couldn't reply just now)" into the thread and saves it
  to localStorage forever (`useCommentReply.ts`).
- **[Minor] A second summon while one runs is silently dropped** (`useAgentRun`
  `if (isRunning) return`) — no toast, no queue.

### B. Product-design & flow (journey) issues
- **[Major] Four summon paths, inconsistent rules.** Palette / roster /
  affordance act on the *selection*; @mention acts on the *card being edited*;
  the offer chip hard-codes the Summarizer. Empty-selection behavior differs
  (toast vs inline guidance). Users can't form one mental model of "ask an
  agent."
- **[Major] The headline features hide the moment you need them.**
  Tab-to-continue and @mention are taught only by placeholder text, which
  disappears as soon as you type — exactly when Tab becomes useful. No persistent
  affordance, no onboarding beyond the one-time ⌘K nudge.
- **[Major] No way out (export).** A finished artifact can only live on the
  canvas; there is no copy-as-markdown, PDF, or send-to. (Confirmed across the
  whole study as the #1 adoption blocker.)
- **[Minor] Competing affordances on one selection.** A selected card can show
  both the "Ask an agent" button (top) and the comment thread (right); two
  summon surfaces plus comments crowd a single selection.

### C. Behavioral issues
- **[Major] Latency reshapes behavior.** Real generation runs ~20–40s (sidecar);
  with no progress beyond a parked avatar, users can't tell "thinking" from
  "stuck," and the silent-failure bug compounds it. Personas downgraded latency
  to Minor for one-shot use but flagged it as friction for iterative work.
- **[Behavioral truth] The multi-card authoring journey works.** J1–J4
  succeeded: note → real Tab-continue → second card (table) → real cell-fill,
  with state accumulating correctly. The core loop holds under multi-step use.
- **[Major] Trust depends on visible provenance + reading what landed** — yet
  table cells hide their content (see G) and the avatar covered the cell it was
  writing (fixed), undercutting the very "watch it work" trust the product sells.

### D. Accessibility (blockers)
- **[Blocker] No `:focus-visible` anywhere; `outline: none` on every control.**
  Keyboard-only users get zero focus indicator across the palette, roster,
  table cells, comment input, and editors. _(Fixed this session.)_
- **[Blocker] The ⌘K palette is not a real modal.** No focus trap, no
  `aria-modal`, the canvas behind isn't inert — Tab escapes into hidden content
  and focus never returns on close (`CommandPalette.tsx`).
- **[Major] @mention and "Ask an agent" menus are mouse-only** — no roving
  focus / active-descendant; the highlighted item and the committed item can
  diverge (`MentionMenu.tsx` + `useMention.ts`).
- **[Minor] No `aria-live` on agent status** — screen readers get no
  announcement that an agent started, is working, or finished.

### E. Error / edge / state integrity (blockers)
- **[Blocker] Deleting a card orphaned its comment thread forever.** Nothing
  cleaned `jz-comments` on delete → unbounded localStorage growth → eventual
  quota failure that silently stops *all* new comments from saving.
  _(Fixed this session: an `afterDelete` side-effect now clears the thread.)_
- **[Blocker] Deleting a card mid-Autopilot leaked the session + controller.**
  The in-flight fetch kept streaming and `isAutopilotRunning` stayed true for a
  dead id. _(Fixed this session: the same side-effect aborts the session.)_
- **[Major] Ragged / 0-column tables break.** `columns.length === 0` →
  `repeat(0, …)` grid and a divide-by-zero NaN avatar anchor; agent-built tables
  can arrive with `[]` columns. _(Partially hardened: cell anchor now guards
  `cols < 1`.)_
- **[Minor] Capabilities-probe failure is treated as "live"** — a real demo
  server whose probe times out would hide its "Demo mode" badge and pass canned
  output off as real (`useCapabilities.ts`).

### F. Responsive & touch
- **[Major] Zero width media queries.** The topbar (top-left) and roster
  (top-right) both sit in the top band at fixed positions; below ~768px they
  collide and become unclickable.
- **[Major] The comment thread can render off-screen.** It anchors at the card's
  right edge with a fixed 268px width and never flips left, so a right-edge
  card's thread is partly/fully hidden.
- **[Major] Touch users can't reach the magic.** ⌘K, Tab-to-continue, and @ are
  all keyboard-only; on a tablet/phone the two signature affordances are
  unreachable.

### G. Visual / layout
- **[Major] Table cells hide their content.** `nowrap + ellipsis` with no wrap
  truncates any cell longer than its column, and many-column agent tables keep a
  fixed width so each column is a sliver. _(Partially fixed: a `title` tooltip
  now shows the full value on hover; wrap/auto-width still wanted.)_
- **[Major→fixed] The Autopilot avatar parked on top of the cell it was
  filling,** occluding the new text as it landed — the worst possible spot.
  _(Fixed this session: the avatar now parks at the cell's right edge.)_
- **[Fixed earlier] Continuation welded onto the seed text** (raw `##` leaking)
  and a stray `</s>` stop-token — both fixed in the round-2 pass.

## Fixed during this study
1. Card deletion now aborts any Autopilot session and clears its comment thread
   (two data-integrity blockers).
2. Keyboard `:focus-visible` rings restored across the overlays (a11y blocker).
3. Autopilot avatar moved off the live table cell; cell tooltips added; cell
   anchor guards 0 columns (visual + edge-case).
4. (Round 2) continuation join whitespace + `</s>` artifact stripping.

## Prioritized backlog

**P0 — adoption blockers**
- **Export**: copy-as-Markdown + PDF, per card and per board.
- Surface Autopilot/agent errors to the user (replace the silent catches).
- Finish the a11y modal work: real focus trap + `aria-modal` on the palette;
  keyboard navigation for the @ / Ask menus.

**P1 — friction & trust**
- A per-summon brief box (tone/length/audience) + saved brand-voice profiles.
- Table cells: wrap or auto-size columns (tooltip is a stopgap).
- Empty-card and second-summon guidance (toasts instead of silent drops).
- Comment thread: flip left at the right edge.

**P2 — reach & polish**
- Responsive layout + a touch summon path; `aria-live` agent status.
- Persistent discoverability for Tab/@ (a small in-card affordance).
- Light organization (named rooms + search), then domain templates.

The interaction model and the AI both earned the benefit of the doubt across
every method. The work between here and adoption is **finishing**: export,
honest error states, accessibility, and letting users read and steer what the
agents produce.
