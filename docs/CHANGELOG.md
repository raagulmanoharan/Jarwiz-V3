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

### Jul 12, 2026
| PR | Tags | What shipped |
|---|---|---|
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
- **canvas** — #9, #39, #40, #47, #48, #56, #59
- **cards** — #2, #6, #7, #33, #35, #41, #43, #44, #45, #51, #52, #53
- **agents** — #2, #35, #44, #53, #57, #58
- **onboarding** — #29, #30, #31, #37, #38, #42, #49, #55
- **landing** — #10, #11, #12, #17, #18, #19, #21, #22, #23, #25, #26, #27, #28
- **embeds** — #13, #14, #15, #20
- **deploy** — #5, #34
- **docs** — #32, #50

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

| PR | Tags | State |
|---|---|---|
| #54 | `cards` · `agents` | Map card (P0 + P1). Draft — **conflicts with `main`** (`ask.ts`, `HISTORY.md`) pending a sync. |
| #36 | `docs` | 100-case stress harness + report. Draft — verdict predates ~55 commits; re-run before trusting the "100/100" claim. |
