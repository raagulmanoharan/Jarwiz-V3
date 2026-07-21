# CHANGELOG.md — every merged PR, tagged to the feature it touched

The **streamlined, human-readable lens over `main`'s merge history.** The raw
`git log` is noisy — early PRs landed as merge-commits that dragged their WIP
onto `main`, later ones as clean squash lines — so this file is the canonical
"what shipped, when, and to which part of the product" record. `HISTORY.md`
tells the *story* (what was asked, how it felt); this file is the *ledger*.

**Keep it current:** every time a PR merges, add one row to the release log
below and, if it opens a new area, a line under "By feature area." This is now
part of the merge ritual (see `CLAUDE.md` → "Git & merge discipline").

## Feature tags

Every change is tagged to the surface it touches. A PR that spans two surfaces
carries both tags (primary first).

| Tag | Surface |
|---|---|
| `foundation` | Core platform, monorepo, wire protocol, licensing, CI, clone-readiness |
| `canvas` | The tldraw surface: tool rail, presence, tidy, boards panel, board search, chrome |
| `cards` | Card shapes, action bar, drag, rich/dashboard cards, tables, provenance |
| `agents` | Server runtime, Ask router, Thinking Machines, research answers, recipes, generation feel |
| `onboarding` | Intent/persona onboarding, ambient scene, demo content, first-touch entry points |
| `landing` | Marketing page: hero, showreel, OG/favicon, copy |
| `embeds` | Marketing embed / iframe isolation + fixes |
| `deploy` | Hosting, GitHub Pages, the hosted trial |
| `docs` | Documentation and process |

## Why the raw history looks erratic (two merge eras)

- **Era 1 — merge-commits (PRs #1–#19, Jul 6–8).** Merged with
  `Merge pull request …`, so every intermediate WIP commit ("WIP: landing
  bento…", "Hero showreel: recolor the You cursor rust red") is stitched onto
  `main`. That's the tangle you see in `git log`.
- **Era 2 — squash-merges (PRs #20+, Jul 8 onward).** Each feature collapses to
  a single titled commit ending in `(#NN)`. Clean, one-line-per-feature.

Going forward we **squash-merge only** (codified in `CLAUDE.md`), so `main`
stays one-line-per-feature. This changelog papers over Era 1 retroactively.

---

## Release log (chronological, newest first)

### Jul 21, 2026
| PR | Tags | What shipped |
|---|---|---|
| #133 | `foundation` | Stop a cold Claude CLI from stranding a keyless server in demo mode — the `sidecarAvailable()` probe (`claude --version`, 5s timeout) loses to a *cold* first launch (~15s) and cached the miss permanently, so the sidecar deployment would serve mock answers even though the CLI was really there. Warm the binary at module load (fire-and-forget, flips the cache the moment it succeeds), bump the probe timeout to 8s, and — crucially — only cache a *definitive* result (available, or ENOENT-absent), never a mere timeout, so a later request can still recover into sidecar mode (reliability bug found during sidecar QA) |
| #132 | `foundation` · `agents` | Consolidate the board-summary card formatter into `util.ts` — notice, discover, and compose each rebuilt the same `[kind: title] — clipped body` line for their board-summary prompt; now one exported `cardLabelBody(card, maxText)`, with each caller keeping only its own line prefix (an `id=` for notice, an ordinal for discover/compose). Zero behaviour change — verified live against `/api/discover`, `/api/notice`, and both `/api/compose` paths, 4/4 green (consolidation, part 5) |
| #131 | `agents` · `foundation` | Consolidate the agents' `describeCard` input-rendering helper into `runtime.ts` — summarizer, writer, researcher, and brainstormer each carried their own copy of the "render one input card as a labelled cardId/kind/url/title/text block"; now one exported `describeCard(card, label, { position? })`, with the `position` flag adding the x/y/w/h line the layout-aware agents (summarizer, writer) want. The sidecar loop keeps its own terser variant. Zero behaviour change — the composer regression suite (question, sourced card, @mention, table shortcut, action-bar refine) stays 5/5 green (consolidation, part 4) |
| #130 | `agents` | Stop two AI runs from fighting over the camera — the board fan-out (`useCompose`) never joined the global one-run-at-a-time slot that Ask, regen, and the debrief recipe share, so a compose could start over a live Ask (or vice-versa) and each spun up its own `makeCardFollower`, the two yanking the viewport against each other. `useCompose` now `claimActiveRun`s the same slot (and releases it in `finally`), exactly like the debrief recipe: a second run is cleanly refused instead of starting a rival follower (audit bug — the camera-fighting symptom behind the parked presence-collision note) |
| #129 | `foundation` | Consolidate the one-shot model-call boilerplate into a new `generate.ts` — the "API key first (with the pause_turn web-tool continuation loop), else the CLI sidecar, else throw" block was hand-copied as `review`/`planText`/`groundedSearch`/`research` across `notice.ts`, `compose.ts`, `discover.ts`, and `machineBoard.ts`. Now one `generateText({ system, user, signal, maxTokens, sidecarTimeoutMs, web? })` — the buffered sibling of `textStream.ts` — with `web` gating the research toolset. Zero behaviour change, verified against the live `/api/notice`, `/api/discover`, and both `/api/compose` paths (consolidation, part 3) |
| #128 | `foundation` | Consolidate the tolerant loose-JSON parsers into `util.ts` — the "strip ``` fences, slice to the outermost `{…}`/`[…]`, parse-or-null" helper was hand-copied as `parseObject`/`parseArray`/`parseResources` across `machineBoard.ts`, `compose.ts`, `discover.ts`, and `notice.ts`; now one `parseJsonObject` + one `parseJsonArray`, imported. Zero behaviour change — verified against the live `/api/discover`, `/api/notice`, and both `/api/compose` (free-form + SWOT board) paths (consolidation, part 2) |
| #127 | `foundation` | Consolidate the copy-pasted `sleep(ms, signal)` and `chunkWords(text, size)` helpers into one `apps/server/src/util.ts` — the abort-aware pacing delay and word-chunk streamer were byte-identical across `ask.ts`, `textStream.ts`, `export.ts`, `sidecarLoop.ts`, and `mock.ts`; now defined once and imported (export.ts keeps its own char-based `chunk`, a genuinely different function). Zero behaviour change (consolidation, part 1) |
| #126 | `cards` | Stop numbered lists silently vanishing on save — the doc editor left TipTap's `orderedList` on, but the markdown dialect has no `1.` serializer/renderer, so a typed numbered list round-tripped to an empty string. Disable `orderedList` in the editor so `1.` stays literal text (preserved) instead; bullet + task lists are unaffected (audit bug) |
| #125 | `canvas` | Fix a theme-listener leak on board switch — `handleMount` dropped `subscribeTheme`'s unsubscribe, so every `<Tldraw key={board.id}>` remount stacked another listener pinning the dead editor; the subscription now rides `editor.disposables` and is torn down with the editor (audit bug) |
| #124 | `foundation` · `agents` | Prune dead types from the wire protocol — the `Revise*`, `Annotate*`, `Suggest*`/`ClusterSuggest*`/`AgentSuggestion`, and `Diagram{Node,Edge,Spec,Request}` families, the never-returned `AnalyzeResult`/`DiscoverResult`/`NoticeResult`/`CommentMessage` wrappers, and the dead `affinity` AskShape + its `affinity.cluster`/`affinity.note` events and server guards; plus `RichDoc`, `RICH_BLOCK_TYPES`, `JARWIZ`, `CardShapeType`. ~190 fewer lines of contract (dead-code sweep, part 4) |
| #123 | `agents` · `foundation` | Remove dead server routes, modules, and exports — the client-unreachable `/api/suggest` + `/api/cluster-suggest` (whole `suggest.ts`) and `/api/diagram` (whole `diagram.ts`, the never-wired flowchart path; the live Mermaid ask-diagram path is untouched), `WEB_FILL_DIRECTIVE`, `analyzeTitle`, `activeRoomCount`, `looksLikeSpreadsheet`, `requestPilot`, the `linkRefs` leftover, and two stale metered-path entries; drop the obsolete eval blocks (dead-code sweep, part 3) |
| #122 | `foundation` | Remove scattered dead web exports + unused locals surfaced by the audit — the abandoned BYOK key store (`subscribeApiKey`/`getApiKey`/`setApiKey`/`getPilotCode` + orphaned listener set), `runningTaskCount`, `clearComments`, `isHttpUrl`, `MAX_CARD_H`, `openHtmlInNewTab`/`copyText`, `dismissExport`, `openHelp`, `getActiveRichEditor`, and five unused imports/vars (presence exports left untouched pending a product call) (dead-code sweep, part 2) |
| #121 | `foundation` | Delete orphaned web files surfaced by the codebase audit — `EmbedComposer`, `boardIntent`, `ExpandToggle`, and `boards/templates.ts` (nothing imports them) — and trim `flowLayout.ts` to the `computeRows`/gap helpers Tidy actually uses (the `buildFlowchart`/`layoutFlow`/node-builder chain was reachable only from the deleted template) (dead-code sweep, part 1) |

### Jul 20, 2026
| PR | Tags | What shipped |
|---|---|---|
| #120 | `agents` | Remove the dead citation/sources-marker machinery from the ask loop — the SOURCES_USED marker + directive, the CITE and link-cite directives, their parse/stream-filter helpers, streamDoc's always-zero `trackSources` plumbing, and gatherContext's unused `citable` (the `sources.used` event stays; the table path still emits it) |
| #119 | `agents` · `cards` | Thinking Machines and deep research answer as rich block cards — one BLOCK_FORMAT grammar across ask/machine/research, a uniform block-card vertical rhythm, the map hand-off moved inside the frame, and a fix for map pins vanishing app-wide (MapLibre collapsed the map container to 0 height) |

### Jul 18, 2026
| PR | Tags | What shipped |
|---|---|---|
| #118 | `agents` · `foundation` | Remove the dead affinity handlers from the ask loop + the vestigial 'board' mode (consolidation cleanup, part a2) |
| #117 | `agents` · `foundation` | Remove the dead Board/Stickies workflow leftovers — affinity generation, useAnnotate + /api/annotate, and four orphaned prompt constants (consolidation cleanup, part a1) |
| #116 | `canvas` · `agents` | Every agent reframe (compose/debrief/dashboard/cluster/analyze/map-expand/doc-expand) goes through the shared frameBounds — one framing behavior, no more raw zoom-to-fit (camera consolidation, part b) |
| #115 | `canvas` · `agents` | Compose & Debrief stop fighting their own camera hand-off — their final reframe now respects the follower's yield (camera consolidation, part a) |
| #114 | `agents` · `cards` | Doc answers stream as hydrated structured blocks — the model emits NDJSON blocks, the server geocodes maps / finds images / previews links, the card fills block by block (rich-card rebuild, phase B) |
| #113 | `cards` | Structured rich-card blocks — a typed block protocol + renderer (heading/paragraph/list/checklist/table/image/map/link/divider); doc card renders blocks or falls back to markdown (rich-card rebuild, phase A) |
| #112 | `agents` | Use images for visual answers — inline and as a leading image column in tables — instead of skipping them (find_image runs in API mode) |
| #111 | `agents` | The rich doc auto-builds the right constructs — table, checklist, list, map, image — from the response shape without being asked; drop the keyword checklist gate (consolidation, phase 3.5) |
| #110 | `cards` · `canvas` | Merge the two diagram paths into one "Make a flow" (the Flow card); route "As a table" to a rich doc; delete the redundant native useDiagram (consolidation, phase 3) |
| #109 | `agents` | The rich doc carries a proper table for comparisons (not a token sketch); resolve the fenced-code conflict so only map/widget blocks are allowed (consolidation, phase 2) |
| #108 | `agents` · `cards` | Consolidate answer shapes to four — Doc · Prototype · Dashboard · Flow; table/list/map answers become rich docs (card-type consolidation, phase 1) |
| #107 | `agents` | Unselected asks actually use the board (forward the card-title index that #105 dropped) and lean on web search for verifiable facts instead of guessing from memory |
| #106 | `onboarding` | Mode pill is non-dismissible and toggles the shape menu; Doc is a menu item; roomier padding |
| #105 | `agents` | An unselected ask gets ambient board context — card titles so "his films"/"these" resolve without attaching a source |
| #104 | `agents` · `cards` | Every answer shape drops an instant "building…" card on enter — tables/diagrams/maps no longer wait in silence |
| #103 | `agents` · `onboarding` | Always show the answer-shape chip, defaulting to "Doc" — the mode selector is visible, not hidden until non-doc |
| #102 | `cards` · `canvas` | Double-click any card opens it full-screen in focus mode — no more inline on-canvas editing |
| #101 | `canvas` · `agents` | Provenance lineage always enters the answer at its left-middle — a stable socket that doesn't hop edges |
| #100 | `agents` · `cards` | Drop the answer card the instant you hit enter — a streaming skeleton, not a dead wait |
| #99 | `canvas` · `agents` | Hand the camera back the moment you pan or zoom mid-generation — no view hijack |
| #98 | `canvas` · `agents` | Frame a generated answer legibly instead of zooming out to a speck; same floor for Tidy |
| #97 | `canvas` | Keep cards from overlapping when one grows, not just moves |
| #96 | `canvas` | Cards don't overlap — push overlapping cards apart on move |
| #95 | `cards` · `canvas` | Declutter the card action bar; move sources into the card as pills |
| #94 | `cards` | Edit table cards formatted in place — no raw markdown, matching read |
| #93 | `cards` | Hug content when editing a doc — no dead space, no expand |
| #92 | `cards` | Harden the doc editor round-trip for complex/mixed formatting |
| #91 | `cards` | Rich editing in focus mode; stop the doc card resizing on edit |
| #90 | `cards` | Fix doc-card edit spacing and height to match read mode |
| #89 | `cards` | Keep the card title on a grab cursor until you rename it |
| #88 | `cards` | Edit doc cards formatted, in place — no more raw markdown on double-click |
| #87 | `agents` · `cards` | Remove the Tab-to-continue / ✦ Fill in-card writing copilot |
| #86 | `foundation` | Load the server .env when the repo path contains spaces |
| #84 | `agents` | Auto-keep streamed answers instead of a Keep/Discard bar |
| #83 | `canvas` | Remove the roaming Jarwiz cursor from the canvas |
| #80 | `agents` · `canvas` | Make streaming visible: card placeholders, a named wait, a camera that follows |
| #78 | `canvas` | Fix trackpad pan hijacked by the browser back/forward gesture |
| #73 | `canvas` | Export the board: slick slideshow + LLM-ready markdown |
| #63 | `docs` | Feature-tagged CHANGELOG ledger + git/merge discipline in CLAUDE.md |

### Jul 17, 2026
| PR | Tags | What shipped |
|---|---|---|
| #77 | `agents` | Agent errors get one home: a banner above the composer |
| #66 | `canvas` | Presence: give Jarwiz a home dock so it rests after quiet spells |

### Jul 16, 2026
| PR | Tags | What shipped |
|---|---|---|
| #75 | `onboarding` · `cards` | Use-case boards: six workspaces built from the new card vocabulary |

### Jul 14, 2026
| PR | Tags | What shipped |
|---|---|---|
| #69 | `agents` · `canvas` | Scout: always-present discovery button with a confidence-gated fill meter |
| #70 | `cards` | Doc card keeps a fixed height instead of collapsing to its content |
| #71 | `cards` · `agents` | On-card TL;DR for dropped link / video / PDF / sheet cards |

### Jul 13, 2026
| PR | Tags | What shipped |
|---|---|---|
| #65 | `onboarding` | Playground: collapse three "AI is off" notices into one |
| #67 | `cards` · `agents` | Inline @mention composer with source attribution |
| #68 | `landing` · `deploy` | Site: private-beta front door — request access + invite code |

### Jul 12, 2026
| PR | Tags | What shipped |
|---|---|---|
| #60 | `deploy` | Closed pilot: invite links, the owner's key, a metered budget |
| #62 | `onboarding` | Onboarding: drop the composer's shape-preview pill, keep the typing |
| #54 | `cards` · `agents` | Map card + inline widgets: maps in doc answers, the trip view, model-authored interactives |
| #61 | `onboarding` | Use-case selection: six choices, and the pick summons a contextual room |
| #34 | `deploy` | Hosted trial: full product on GitHub Pages, bring-your-own-key agents |
| #59 | `canvas` | Board-wide search: rail icon opens a centred spotlight over a darkened board |
| #58 | `agents` | Meeting-debrief recipe: transcript in, a connected cluster out |

### Jul 11, 2026
| PR | Tags | What shipped |
|---|---|---|
| #49 | `onboarding` | Ambient scene stays on its stage — no painting over the docked panel |
| #57 | `agents` | Generation feel: narrated waits, final camera settle, contained tables |
| #45 | `cards` | Composer ground chip: long titles ellipsize instead of clipping the ✕ |
| #56 | `canvas` | Chrome overlap polish: five paper cuts from the product review |
| #51 | `cards` | Drag out of a rich card — tables, images, prose, charts become real cards |
| #55 | `onboarding` | First-touch entry points: live on-ramps, one-behaviour mode chip, attach button |
| #53 | `cards` · `agents` | Sources are sacred: paste-to-attach, truncated source cards, honest lineage |
| #50 | `docs` | Product review + agent-ready backlog: transcript → plan use case |
| #52 | `cards` | Card action bar polish: consistent icons, honest Regenerate, inverted control pills |
| #48 | `canvas` | Boards panel docks left and pushes the canvas instead of floating |
| #47 | `canvas` | Tool rail polish: drop Arrow + Boards; Machines flyout opens screen-centred |
| #44 | `agents` · `cards` | Everyday doc answers: find_image when warranted + depth calibrated to the ask |

### Jul 10, 2026
| PR | Tags | What shipped |
|---|---|---|
| #43 | `cards` | Table mode: web-found images in cells, no broken frames |
| #41 | `cards` | Cards: drag by title, one border + one selected state across every card |
| #42 | `onboarding` | "Try it free" lands on the intent-first onboarding, not the demo board |
| #40 | `canvas` | Presence etiquette: Jarwiz never sits on what you're working with |
| #39 | `canvas` | Tool rail: drop the Shape tool; spawns land in view at a readable zoom |
| #35 | `cards` · `agents` | Rich research answers: prose, tables, charts, real images and tabs in one card |
| #33 | `cards` | Provenance cleanup + auto-sync: cards that stay true to their sources |
| #38 | `onboarding` | Ambient onboarding: births measure the orb at birth time, not mount time |
| #37 | `onboarding` | Preview notice: set expectations where the AI server isn't connected |
| #32 | `docs` | HISTORY entry for the onboarding + persona + neutral-demo session |
| #31 | `onboarding` | Onboarding: "What brings you here?" ask-once persona modal that re-themes the first run |
| #29 | `onboarding` | Intent-first onboarding + ambient "board is already alive" scene |
| #30 | `onboarding` | Demo content: retire the CRM comparison for a neutral PM-tools scenario |

### Jul 8, 2026
| PR | Tags | What shipped |
|---|---|---|
| #28 | `landing` | Landing: use the bento grid as the link-preview (OG) image |
| #27 | `landing` | Hero: sticky-only intro (sketch is a source) + dense starting-frame OG image |
| #26 | `landing` · `foundation` | Add Jarwiz favicon + rich link previews (OG/Twitter) |
| #25 | `landing` | Landing: humanize copy — kill em dashes, AI-speak, heading orphans |
| #24 | `foundation` | Clone-readiness pass: patch vulns, document optional env, fix Node floor |
| #23 | `landing` | Landing: loop the prose wall + sharper section headings |
| #22 | `landing` | Hero showreel: left image entrance, typed sticky, seamless clear, fix border |
| #21 | `landing` | Hero showreel: creation intro + right-aligned comment pin + reading dwell |
| #20 | `embeds` | Isolate embed iframes + remove board captions |

### Jul 7–8, 2026 (Era 1 — merge-commits)
| PR | Tags | What shipped |
|---|---|---|
| #19 | `landing` | Hero showreel: anchor the whole cast to the canvas; tied file-drag; image PDF |
| #18 | `landing` | Hero showreel: fixed height (no scrollbar) + slower, richer story |
| #17 | `landing` | Make the use-cases board zoomable and pannable |
| #16 | `foundation` | Add tldraw license key (removes watermark + unlicensed-production path) |
| #15 | `embeds` | Fix Safari iframe blanking: stop clipping embeds from the outside |
| #14 | `embeds` | Fix embed iframes white-ing out after the canvas zooms |
| #13 | `embeds` | Fix marketing embeds going blank on interaction |
| #12 | `landing` | Landing pass: sections trim, wedge rework, showreel camera |
| #11 | `landing` | Landing polish + canvas-over-chat hero showreel |
| #10 | `landing` | Landing page: fresh bento-led redesign + diagram card polish |
| #9  | `canvas` | Tidy Up spike: masonry board tidy (global button + right-click) |
| #7  | `cards` | Interactive dashboards, full-screen focus mode, smarter shape suggestion |
| #6  | `cards` | Prototype card: a generative-UI card for the canvas (+ OpenUI) |
| #5  | `deploy` | CI: auto-enable GitHub Pages so the site deploys |
| #2  | `cards` · `agents` | Roadmap 2–4 + 7: table power pass, format-aware pills, style groundwork |
| #1  | `foundation` | Jarwiz v1: thinking made visual — infinite canvas with live agents |

---

## By feature area (cross-index)

- **foundation** — #1, #16, #24, #26, #5 (CI)
- **canvas** — #9, #39, #40, #47, #48, #56, #59, #66, #69, #73, #78, #80
- **cards** — #2, #6, #7, #33, #35, #41, #43, #44, #45, #51, #52, #53, #54, #67, #70, #71, #75
- **agents** — #2, #35, #44, #53, #57, #58, #54, #67, #69, #71, #77, #80
- **onboarding** — #29, #30, #31, #37, #38, #42, #49, #55, #61, #62, #65, #75
- **landing** — #10, #11, #12, #17, #18, #19, #21, #22, #23, #25, #26, #27, #28, #68
- **embeds** — #13, #14, #15, #20
- **deploy** — #5, #34, #60, #68
- **docs** — #32, #50, #63

---

## Explored but not shipped (closed without merge)

Kept here so the ideas aren't lost and nobody re-spikes them by accident.

| PR | Area | Idea | Why parked |
|---|---|---|---|
| #3 | `canvas` | Jarwiz cursor entity: idle roam, flies to new cards | Superseded by the presence-etiquette model (#40) |
| #4 | `agents` | Ultra Think mode: grounded content discovery | Folded into the Ask router's shape system |
| #8 | `cards` | Smart response-shape inference in the prompt bar | Landed differently via the "/" mode chip (#7) |
| #46 | `onboarding` | Onboarding scene retires on first board touch | Reworked into ambient-scene containment (#49) |

## In flight (open drafts)

_Snapshot as of 2026-07-18. Move each to the release log as it merges._

| PR | Tags | State |
|---|---|---|
| #79 | `docs` | Roadmap note: the advisor tool as an Autopilot-era execution model. Docs-only. |
| #76 | `cards` · `docs` | Thesys study + richer product dashboard card (viz tokens, KPI/chart polish). |
| #74 | `deploy` · `landing` | Capture beta signups + send a confirmation email (Resend, env-gated). |
| #72 | `docs` | Persona study: Airbnb-laundry market study + Jarwiz eval. Eval harness + docs. |
| #64 | `agents` · `docs` | Prompt-assembly cleanup + response-quality A/B harness (real sidecar). |
| #36 | `docs` | 100-case stress harness + report. Verdict now predates ~70 commits; re-run before trusting the "100/100" claim. |
