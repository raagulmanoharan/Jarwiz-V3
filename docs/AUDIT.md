# Codebase Audit — July 2026

A full-repo audit run across six parallel review passes (ask pipeline, agents directory, shapes/boards/UI chrome, server, CSS/tokens, shared package/cross-cutting) plus a seventh pass over the `feat/flora-alignment` UI branch. Every finding below was verified against the code (file:line), not inferred. Branch audited: `claude/tender-sagan-rxmrbk` at `164e424`, with the Flora delta audited at `ee09ae6`.

**The one-paragraph verdict:** the instinct that the code is bloated with conflicting logic is correct, and the root cause is legible — the repo carries **two generations of the same product**. An older generation of surfaces (`AgentPresenceLayer` and its 15 dependent files, `AskLayer`, `ProvenanceLayer`, the ⌘K palette, the offers/suggestions/comment-thread systems) was superseded by the current PromptBar/CardActionBar generation but never deleted. That accounts for ~2,300 dead lines in `apps/web` alone, and — worse — the dead generation still has live tendrils: doc/note cards route keystrokes into a mention system whose UI never mounts, so typing `@word` + Enter silently deletes text. Beyond the two-generations problem there are a handful of genuinely dangerous bugs (cross-board revert data loss, sync schema drift, SSRF gaps) and ~800–900 lines of mechanical duplication that make every change cost more than it should.

---

## P0 — Fix before anything else (data loss / security / broken-in-prod)

### P0.1 Timeline "Revert" can overwrite one board with another board's snapshot
`apps/web/src/log/eventLog.ts:23`, `Timeline.tsx:94`, `boardStore.ts:116-121`. The event log is module-global and never cleared on board switch; tldraw remounts but `events` survives. After switching boards, the Timeline still lists board A's events, and Revert runs `editor.loadSnapshot(...)` with board A's snapshot **inside board B**, which then persists under board B's key. Silent cross-board data destruction. Fix: scope the log by board id (or clear it in `switchBoard`). Related: every logged event stores a full editor snapshot with no cap — unbounded session memory growth (`eventLog.ts:60`).

### P0.2 Multiplayer sync schema has drifted from the real shapes (4 of 8 cards)
`packages/shared/src/cardSchemas.ts` vs the web ShapeUtils. The sync server builds its schema from the shared file (`apps/server/src/sync.ts:21-31`), but: `diagram-card` is **absent entirely**; `note-card` is missing `color`; `doc-card` is missing `sourcePdfId`; `pdf-card` is missing `assetId`/`pages`/`status`. Any shared-room session touching those shapes hits schema validation mismatch. Fix: bring `cardSchemas.ts` back into lockstep (and add a typecheck-time guard, e.g. `satisfies` against the ShapeUtil prop types, so it can't drift again).

### P0.3 @mention eats keystrokes and deletes text (dead-generation tendril in live code)
`DocCardShapeUtil.tsx:163`, `NoteCardShapeUtil.tsx:115` → `useMention.ts` → `mention.ts:76` → `summon.ts:19-21`. Cards fully wire the mention state machine, but the picker (`MentionMenu`) and the only `onSummon` listener live in the never-mounted `AgentPresenceLayer`. Typing `@res` shows no picker; Enter/Tab/Escape are swallowed; `commitMention` strips the `@token` from the card text and fires a summon nobody hears. **The Flora branch already deletes `MentionMenu`/`mention.ts`/`useMention`** — verify the shape-util call sites were cleaned up with them (see Flora section).

### P0.4 Server security gaps (all reachable from client input)
- **SSRF / DNS rebinding**: `ssrf.ts:112` vets the IP via `lookup()`, then `linkPreview.ts:30` fetches with a *second* independent resolution — a rebinding hostname passes the check and connects internally. Also `http://[::ffff:7f00:1]/` (hex-form IPv4-mapped IPv6) bypasses the blocklist entirely (`ssrf.ts:56-68`), as do NAT64/6to4 ranges. Fix: pin the vetted IP with a custom undici Agent, and normalize mapped IPv6 before checking.
- **Sync WebSocket**: no Origin check, no auth, and rooms are never disposed (`index.ts:525-537`, `sync.ts:33-42`) — any website can open `ws://localhost:3001/api/sync/<room>` (cross-site WebSocket hijacking) and each new room id allocates memory forever.
- **Assets**: "presign" signs nothing — `PUT /api/assets/:id` accepts any well-formed id, so any room participant can overwrite another's PDF (`index.ts:65-71`, `assets.ts:50-54`); `GET` hardcodes `Content-Type: application/pdf` for all blobs (`index.ts:87`). (Path traversal itself is properly defended.)

### P0.5 Two features silently broken end-to-end in production
- **Autopilot board context is dropped by the route**: client sends `boardContext` (`autopilotStore.ts:295`), the prompt builder consumes it (`autopilot.ts:48-51`), but the route handler rebuilds the request without it (`index.ts:182-186`). The "grounded in nearby cards" behavior never happens. One-line fix + validation.
- **`/api/suggest` + `/api/cluster-suggest` always return `[]` with an API key**: both gate on "sidecar OR key" but then call *only* `sidecarGenerate` — there is no API branch (`suggest.ts:129-163`). In key mode the CLI spawn fails, the error is swallowed, result is empty. PDF seed suggestions and cluster suggestions are dead in production.

### P0.6 Regen failure silently wipes the card
`useAsk.ts:271, 408-410, 452-463`. In-place regen clears the card content up front; on a server `error` the handler calls `updateDraft(...)` — a no-op because regen never creates a draft — then the `finally` squashes history, committing the blank card, and clears the "Regenerating…" pill. Card wiped, no error shown, recoverable only via manual undo. Sibling bugs: a failed ask before `card.create` surfaces no error anywhere (`useAsk.ts:447-451`), and Cancel can abort the *wrong* run because five `useAsk()` instances share one module-global `activeAbort` while the regen path bypasses the draft guard (`useAsk.ts:42-46, 150, 177, 464`).

---

## P1 — The two-generations problem (the "bloat")

### P1.1 Dead code inventory (all grep-verified, zero importers)

**`apps/web/src/agents/` — 16 files, 1,908 lines (53% of the directory), rooted at one never-imported file:**

| File | Lines | Note |
|---|---|---|
| AgentPresenceLayer.tsx | 201 | the root — imported by nothing |
| useAgentRun.ts | 337 | 4th copy of the stream-apply loop |
| cluster.ts | 190 | dead on both ends — producer `noteDrop()` has zero callers |
| CommandPalette.tsx | 173 | ⌘K does nothing in the running app (docs still advertise it) |
| suggestions.ts | 125 | `suggestionsForDrop`/`fetchTailoredSuggestions`: zero callers ever |
| CommentThread.tsx + useCommentReply.ts + comments.ts | 309 | superseded by ask/discuss.ts + DiscussLayer |
| SuggestionPills.tsx, runRequest.ts, offers.ts | 282 | |
| AskAgentAffordance.tsx, AutopilotPresenceLayer.tsx, MentionMenu.tsx, ClusterButton.tsx, ParticipantRoster.tsx | 284 | Flora already deletes MentionMenu + mention chain |

**`apps/web/src/ask/`:** `AskLayer.tsx` (~250 of 273 lines dead — but live code imports the `ASKABLE` constant from it, so it can't be deleted mechanically); `ProvenanceLayer.tsx` (62 lines — feature was rebuilt as CardActionBar's "Based on" menu).

**`apps/web` misc:** `ui/FirstRunHint.tsx` (32), `ui/onboarding.ts` (40), `ingest/youtube.ts` (35), `ingest/linkPreview.ts`, `lib/url.ts:isHttpUrl`. Link/YouTube cards are unreachable at runtime (their only creators sit in the dead chain; pasted URLs fall through to tldraw's default bookmark); `image-card` has **no creator at all**.

**CSS:** ~220 dead lines in `index.css` (ingestion preview panel 1043–1164 is half of it in one cut; also legacy tool palette, discuss chip, `.jz-ask-*` blocks styling the dead AskLayer, `.jz-prov*` styling dead ProvenanceLayer).

**`packages/shared`:** dead exports `SuggestResponse`, `AnalyzeResult`, `ReviseResult`, `CardShapeType`; `card.create` kinds `youtube|image|pdf` are dead protocol surface. Server: dead exports `activeRoomCount`, `analyzeTitle`, re-exported `ReviseTurn`.

### P1.2 Design logic that lives *only* in the dead generation
- Clarify/regen mutual exclusion ("don't stack pills on the same card") is implemented only in dead `AskLayer.tsx:117-146`; the mounted surfaces can stack `DraftControls`/`RegenControls` on one anchor point.
- The clustering gate exists twice with different rules: dead `AskLayer` (`noteCount >= 3` inline) vs live `canCluster()`.

### P1.3 Recommended cull
Delete the entire dead graph in one commit (move `ASKABLE` into `CardActionBar` or a small `askable.ts` first). Then either delete the mention/⌘K/offers *concepts* from docs (CLAUDE.md and ARCHITECTURE.md both describe dead surfaces — see P3) or schedule their reintroduction on the new chrome deliberately. Estimated: **~2,400 lines of TS/TSX + ~220 lines of CSS removed, zero behavior change** (except fixing P0.3 by removing the mention tendril).

---

## P2 — Conflicting/duplicated systems in live code

### P2.1 Server: one helper exists, seven routes don't use it (~400–500 lines)
`textStream.ts` is the intended shared streaming helper but only `analyze.ts` and `revise.ts` use it. Duplicated across the other routes: the push→pull queue bridge (×4), `chunk()` word-splitter (×6), abort-aware `sleep()` (×6), `new Anthropic()` per call (×10 — no shared client), key/sidecar/mock routing (×7), JSON-fence-strip + parse (×10), the SSE route wrapper in `index.ts` (×7, byte-identical), `describeCard()` (×5), YouTube oEmbed fetch (×3). Consolidating structurally eliminates a class of drift bugs that already exist:
- ask is the only route with **no demo fallback** (throws in demo mode; every other route mocks);
- diagram/cluster mock-fallback on sidecar parse failure but **500** on API parse failure;
- `linkPreview.ts:143` alone checks the untrimmed API key;
- `done` is emitted **after** `error` (`textStream.ts:104→118`, same in autopilot/comment) — any consumer treating `done` as success sees failed runs as complete;
- max_tokens for "write a card body" is 1400 (ask) vs 4096 (revise) vs 1500 (textStream) vs 1024 (analyze) — a doc revised via revise can grow past what ask can regenerate.

### P2.2 Web: five SSE parsers, three presence systems, six card-text extractors
- `sse.ts` exists to be the shared parser (its comment claims Ask uses it — false); verbatim copies live in `useAsk.ts`, `autopilotStore.ts`, `useCommentReply.ts`, `useAgentRun.ts`.
- Presence: `presence.ts`+`AgentCursorLayer` (live) vs autopilot sessions+`AutopilotPresenceLayer` (dead renderer — the store still recomputes an anchor on every SSE delta for an avatar that never draws) vs `AgentPresenceLayer` (dead, and would double-mount `AgentCursorLayer` if ever revived).
- "Shape → text for the model" extractor: six implementations (`boardText.ts`, `autopilotStore.ts`, `useDiagram.ts`, `runRequest.ts`, `useCommentReply.ts`, `AgentPresenceLayer.tsx`); the `plainText` helper is triplicated verbatim.
- The stream-orchestration skeleton (AbortController + 60s timeout + presence choreography + task pill + finally cleanup) is copy-pasted across `useAnalyze`/`useCluster`/`useDiagram` (~50 lines each) — one `runAgentAction()` helper collapses them.
- Two arrow factories (`flowLayout.createFlowEdge` vs `useAgentRun.createEdge`); refinable-card set defined 3×; shape-label map defined 3× with drift; PDF provenance recorded via **four** mechanisms in one function (`useAsk.ts:319-327`).

### P2.3 Shape utils: ~230–260 copy-pasted scaffolding lines across 8 classes
`getGeometry`/`getIndicatorPath`/`canResize`/`onResize`/`HTMLContainer` wrapper/`declare module` block are byte-identical modulo constants in all 8 ShapeUtils. A parameterized base class cuts each from ~50 lines to ~10. Plus duplicated wiring: streaming subscription ×4, autopilot nudge ×3, expand/collapse ×2, `stopEventPropagation` textarea block ×5, and two separate skeleton-loading systems. Ten hand-rolled external stores (`listeners: Set` / `emit` / `subscribe`) across the app — one `createExternalStore<T>()` removes ~80 lines and the divergent edge-cases (help.ts treats missing localStorage as "seen", onboarding.ts as "not seen").

### P2.4 Onboarding: four systems, one race
BoardEntry dialog, HelpLayer auto-tour, dead FirstRunHint/onboarding.ts, and the EmptyState hero all fire on first run. Live race: completing BoardEntry with "Start blank" puts the user in edit mode, then the tour's 700ms timer drops a full-screen scrim over them mid-typing (`HelpLayer.tsx:113-123` checks only that help isn't open, not that a shape is being edited). BoardEntry's own 400ms "hydration" timer is a guess, not a signal — on slow devices the new-board modal appears over an existing board (`BoardEntry.tsx:31-35`).

### P2.5 Board chrome vs shared rooms
`SyncedBoard` ignores boardStore entirely, but the Topbar switcher and BoardEntry still render in `?room=` mode: switching boards there mutates local metadata while the canvas stays put, and a first-time visitor's BoardEntry can dump template shapes into the shared room (`App.tsx:117-133`, `Topbar.tsx:33`).

---

## P3 — Correctness bugs (live, lower blast radius)

| # | Bug | Where |
|---|---|---|
| 1 | Empty note-card autopilot: clarify loop can never proceed (answer→title only for doc-card, then re-asks forever) | `autopilotStore.ts:260-277` |
| 2 | Cluster cancel doesn't roll back moved/recolored stickies (mark set, never bailed) | `useCluster.ts:78,94,125-129` |
| 3 | Task-checkbox ordinals: two divergent regexes → clicking checkbox N can flip a different line | `DocCardShapeUtil.tsx:93` vs `DocMarkdown.tsx:22,64` |
| 4 | `deleteBoard` cleans localStorage but data lives in IndexedDB — every deleted board orphaned forever; deletion is single-click, no confirm | `boardStore.ts:135-143`, `BoardSwitcher.tsx:47-50` |
| 5 | Shared `writer` presence key: concurrent Analyze + Discuss clobber each other's status/avatar (no refcount) | `useAnalyze.ts:18`, `presence.ts:69-73` |
| 6 | Ask `status` event emitted by server, silently dropped by client (no case, no default) | `ask.ts:388` vs `useAsk.ts:230-411` |
| 7 | Mid-stream `error` dropped by autopilot (×2) and comment-reply consumers — failed runs look complete | `autopilotStore.ts:301,387`, `useCommentReply.ts:75` |
| 8 | Ask can emit `card.create` then die without `card.done` — caret stuck (runtime.ts closes cards on error; ask.ts doesn't) | `ask.ts:480,555` vs `index.ts:320-323` |
| 9 | `useFitHeight` measures a `height:100%` element → ratchet; fights doc-card's own onResize | `useFitHeight.ts:8-9` vs `index.css:2097` |
| 10 | PdfCard: dead error guard + stale `needsPassword` closure; in-flight pdf.js task leaked on unmount | `PdfCardShapeUtil.tsx:154-165` |
| 11 | DiscussLayer: history mark never squashed/bailed; error after partial stream leaves truncated revision | `DiscussLayer.tsx:59,88` |
| 12 | `serializeEmit` chain-poisoning: one rejected emit → all later emits reject, `void emit()` becomes unhandled rejection (latent) | `runtime.ts:167-173,372` |
| 13 | `sidecarAvailable()` returns true without checking — keyless machines report `live:true` and error instead of mocking until first failure | `sidecar.ts:24-26` |
| 14 | Link-preview Haiku enrichment has no timeout (page fetch budgeted 10s; model call unbounded) | `linkPreview.ts:148-150` |
| 15 | boardStore `_init` trusts unvalidated JSON + stale active-id → phantom board | `boardStore.ts:55-58` |
| 16 | `@tldraw/tlschema` used by server but undeclared (phantom dep via sync-core) | `apps/server/src/sync.ts:15`, `package.json` |
| 17 | Session stores never prune deleted shapes (discuss/provenance/pdf maps, cardExpand, pdfView) | various |

---

## P4 — CSS & tokens

- **Phantom tokens (8)**: referenced, defined nowhere — `--jz-accent` (×26 — the app's accent purple exists only as inline fallbacks), `--jz-ink-800`, `--jz-spark`, `--jz-dur-1`, `--jz-ease`, `--jz-ink-50`, `--jz-ink-200`, and `--jz-radius-full` at `index.css:1645` **with no fallback** — the autopilot nudge renders square (live bug). Promote them into tokens.css.
- **83 stale `var(--jz-x, #hex)` fallbacks** contradicting tokens.css (two *different* stale fallbacks for `--jz-ink-400` alone) — all deletable, pure drift hazard.
- **60 bare hex colors** — worst: `#faf6ec` ×17, `#fff` ×13, `#d97706` ×11 total.
- **Reduced-motion**: 49 of 75 animated rules (65%) uncovered despite the convention — one catch-all PRM block fixes all of them.
- **Duplication**: zero true conflicting selectors (good); scrim/dialog trio is copy-pasted ×3 with timing drift between forked keyframes (`jz-shimmer` 1.6s vs 1.5s).
- 10 unused tokens; 22 ad-hoc z-index values with no scale.

*(Note: the Flora branch rewrites much of this file — reconcile before acting; see next section.)*

## P5 — `feat/flora-alignment` branch delta

*(pending — being audited now; this section will reconcile which of the above UI-chrome/CSS findings the restyle already resolves or supersedes, and what new issues the 20 commits introduce)*

## P6 — Docs drift

- CLAUDE.md: advertises the ⌘K palette and `AskAgentAffordance` summon path (both dead); tool list missing `create_table`.
- ARCHITECTURE.md: documents `create_card`/`write_to_card` tools that were explicitly rejected in favor of `begin_card`/`finish_card` (runtime.ts's own header says so); `AgentEvent` snippet missing fields; "never silent failures" rule contradicted by P3.6/7.
- Stale comments asserting falsehoods: `TableCardShapeUtil.tsx:40` claims sync with autopilot math that doesn't reference it; `sse.ts` claims Ask uses it; `boardStore.ts` contains two directly contradictory comments about where board data lives.

---

## Suggested sequencing

1. **P0 fixes** — small, surgical, each independently shippable. (P0.1 and P0.2 first; P0.3 may be resolved by merging Flora's deletions.)
2. **The cull (P1)** — one large delete-only PR. No behavior change, ~2,600 lines gone, and the codebase stops lying about what exists.
3. **Consolidation (P2)** — three PRs: server streaming helper, web `runAgentAction` + single SSE parser, shape-util base class + `createExternalStore`. Each mechanically removes a bug class.
4. **P3/P4 fixes** — batched by area.
5. **Docs (P6)** — after the cull, so the docs describe what remains.
