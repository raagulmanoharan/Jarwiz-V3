# Jarwiz — Design System & UX Spec

_Owner: Design · Last updated: 2026-06-13 · Status: living document_

The single source of truth for how Jarwiz looks, moves, and feels. Companion to
[VISION.md](./VISION.md) and [ROADMAP.md](./ROADMAP.md). Every surface in the
product must trace back to a token or pattern defined here.

---

## 0. Design principles

Inherited from VISION.md, sharpened for craft:

1. **Presence over chrome.** The board and the agents are the interface.
   Tooling recedes; when no agent works, the board is silent paper.
2. **Editorial warmth.** Warm paper, ink, and a confident serif give Jarwiz a
   point of view — analog and considered, never another gray SaaS tool.
3. **Honest motion.** Every animation has a purpose and a system token. Cursors
   glide because an agent is _going_ somewhere; text streams because it's being
   _written_. Nothing bounces for attention.
4. **Calm density.** Generous space by default; information arrives only when
   relevant. A full board still breathes.
5. **One system.** Type, color, spacing, elevation, and motion are shared
   scales. Coherence is a feature.

---

## 1. The signature: Editorial Warmth

Jarwiz pairs a **soft serif display** voice (warm, human, editorial — the
"thinking" voice) with a **clean humanist sans** for UI (precise, quiet, the
"tooling" voice). On warm paper, with ink that's never pure black and color
used only to mean something. The reference triangle:

- **Arc / editorial** → typographic point of view, signature moments.
- **Cove / Kuse** → AI-canvas interaction craft; cards as the unit of thought;
  the agent's scope is always legible ("what it sees").
- **FigJam** → presence: named cursors, things happening _with_ you.

---

## 2. Typography

Two families, loaded variable where possible.

| Role | Family | Usage |
|---|---|---|
| **Display / editorial** | **Fraunces** (variable, opsz+wght, soft serif) | Wordmark, doc-card titles & headings, empty-state hero, agent names. The "thinking" voice. |
| **UI / body** | **Inter** (variable) | Dock, status, controls, body text, link/note cards, captions. The "tooling" voice. |

### Type scale

CSS tokens (`--jz-text-*`) — `size / line-height / weight / family`:

| Token | Size/LH | Weight | Family | Use |
|---|---|---|---|---|
| `display` | 40 / 44 | 560 | Fraunces (opsz 96) | Empty-state hero |
| `title-lg` | 24 / 30 | 540 | Fraunces (opsz 40) | Doc-card title |
| `title` | 17 / 24 | 540 | Fraunces (opsz 24) | Card titles (editorial) |
| `heading` | 15 / 22 | 600 | Inter | Section labels, link-card title |
| `body` | 14 / 22 | 400 | Inter | Default body, doc content |
| `body-sm` | 13 / 20 | 400 | Inter | Dense body, descriptions |
| `caption` | 12 / 16 | 500 | Inter | Dock names, chips |
| `micro` | 11 / 14 | 500 | Inter | Domains, meta, status detail |

Rules: tabular numbers off; letter-spacing `-0.01em` on Inter ≥15; Fraunces
gets `font-optical-sizing: auto`. Body line-length in doc cards capped ~68ch.

---

## 3. Color

Warm, ink-on-paper. Neutrals are **tinted warm** (never `#808080`).

### Surfaces & ink

| Token | Value | Use |
|---|---|---|
| `--jz-paper` | `#f1e8d9` | Canvas base |
| `--jz-paper-deep` | `#e9dcc7` | Canvas vignette / behind cards |
| `--jz-surface` | `#fffdf8` | Card background |
| `--jz-surface-raised` | `#fffefb` | Floating chrome (dock, menus, cursor label bg) |
| `--jz-ink-900` | `#2a2622` | Headings |
| `--jz-ink-700` | `#4b443c` | Strong body |
| `--jz-ink-500` | `#6f665b` | Body secondary |
| `--jz-ink-400` | `#988d7d` | Muted / meta |
| `--jz-ink-300` | `#c3b6a3` | Faint / disabled |
| `--jz-hairline` | `rgba(42,38,34,0.10)` | Borders, dividers |
| `--jz-hairline-strong` | `rgba(42,38,34,0.16)` | Card border |

### Agent identity (unchanged base hues — they're protocol-wide)

Each agent owns a hue used for its cursor, status, offer chip, card accent, and
provenance edge. For each, define `--agent-color` (base), and derived washes:

| Agent | Base | `ink` (AA text) | `tint` (≈10% wash) | `ring` (≈20%) |
|---|---|---|---|---|
| Researcher | `#2563eb` | `#1d4ed8` | `color-mix(blue 10%, surface)` | `color-mix(blue 20%, transparent)` |
| Summarizer | `#d97706` | `#b45309` | amber wash | amber ring |
| Brainstormer | `#db2777` | `#be185d` | pink wash | pink ring |
| Writer | `#059669` | `#047857` | green wash | green ring |

Washes/rings are computed with `color-mix(in srgb, …)` from `--agent-color`, so
components stay hue-agnostic. **Color only ever means provenance** — never
decoration.

### Semantic

`--jz-danger #c2410c` (errors, honestly warm not alarm-red), `--jz-focus`
= active agent color or `--jz-ink-700` fallback for focus rings.

---

## 4. Space, radius, elevation

**Spacing** (`--jz-space-*`, 4px base): 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

**Radius** (`--jz-radius-*`): `xs 6`, `sm 8`, `md 12`, `lg 16` (cards), `xl 20`,
`pill 999`. Note cards keep an asymmetric sticky radius (`4 4 14 4`).

**Elevation** — warm-tinted shadows (shadow color `rgba(64,50,34,a)`):

| Token | Use | Spec |
|---|---|---|
| `--jz-e1` | hover lift | `0 1px 2px /.05`, `0 2px 6px /.06` |
| `--jz-e2` | card resting | `0 1px 2px /.05`, `0 6px 16px /.07`, `0 16px 36px /.06` |
| `--jz-e3` | floating chrome | `0 2px 8px /.08`, `0 12px 32px /.12` |
| `--jz-e4` | cursor label / popovers | `0 4px 12px /.14`, `0 18px 48px /.16` |

---

## 5. Motion

Tokens: `--jz-dur-instant 80ms`, `--jz-dur-fast 140ms`, `--jz-dur-base 220ms`,
`--jz-dur-slow 420ms`, `--jz-dur-glide 600ms`.

Easings: `--jz-ease-out cubic-bezier(0.2,0,0,1)` (enters), `--jz-ease-in
cubic-bezier(0.4,0,1,1)` (exits), `--jz-ease-glide cubic-bezier(0.22,1,0.36,1)`
(cursor travel, card arrival), `--jz-ease-spring cubic-bezier(0.34,1.56,0.64,1)`
(sparingly, for "pop" confirmations).

**Named choreography:**

- **cursor-glide** — transform over `--jz-dur-slow`/`ease-glide`.
- **card-materialize** — opacity 0→1 + translateY(6px)→0 + scale(.98)→1 over
  `--jz-dur-base`/`ease-glide`. Cards _arrive_, never pop.
- **stream-caret** — a 2px agent-colored caret blinks at the end of streaming
  text; removed on `card.done` with a quiet fade.
- **edge-draw** — provenance edge fades/grows in over `--jz-dur-base`.
- **thinking-pulse** — agent dot/cursor ring breathes (1.4s) while active.

**`prefers-reduced-motion`:** all travel/scale collapse to a ≤`fast` opacity
fade; the thinking-pulse becomes a static ring. Presence is still legible.

---

## 6. Canvas treatment

- Base `--jz-paper` with a faint **dot grid** (1px dots, `--jz-ink-300` at ~14%
  alpha, 24px pitch) that fades when zoomed far out.
- An optional ultra-subtle **grain** overlay (SVG fractal noise, ≤3% opacity)
  for the analog paper feel. Off under reduced-data/perf if needed.
- **Selection:** 1.5px ring in `--jz-ink-700` (neutral) — agents color _edges_,
  not the user's selection.
- **Hover** on a card: `--jz-e1` lift + 1px hairline brighten, `--jz-dur-fast`.

---

## 7. Components

Each spec lists anatomy + states. Implementation lives in `apps/web/src`.

### 7.1 Wordmark / topbar
A signature mark, not a label: "Jarwiz" set in **Fraunces** with a small spark
glyph in Summarizer amber. Floats top-left in a `--jz-surface-raised` pill,
`--jz-e3`. The "+ Note" affordance sits beside it as a quiet secondary control.

### 7.2 Agent dock
A calm presence bar, bottom-center, `--jz-surface-raised` / `--jz-e3`,
`pill`-rounded. Per agent: identity dot, name (`caption`), and a status line
(`micro`).
- **Idle:** dot at rest, status "idle" in `--jz-ink-400`.
- **Active:** tinted cell (`agent.tint`), name in `--jz-ink-900`, dot ring
  breathing (thinking-pulse), status in `agent.ink` (honest, specific).
- **Done (transient):** a brief checkmark settle before returning to idle.

### 7.3 Agent cursor
The presence hero. A precise arrow in `--agent-color` (white keyline for
contrast on any background), gliding via cursor-glide. A pill label
(`--jz-surface-raised`, `--jz-e4`) trails it: agent **name** (caption, ink) +
live **status** (micro, `--jz-ink-500`). While thinking, a soft ring breathes
around the arrow. The cursor is never theatrical — it only appears when the
agent is genuinely active, and rests on the card it's writing.

### 7.4 Offer chip ("Summarize this?")
Proactive, consent-first. Anchors above the source card, `pill`,
`--jz-surface-raised`, `--jz-e3`, accent in the offering agent's color.
Primary = the offer (agent dot + label in `agent.ink`); secondary = dismiss
(✕). Enters with card-materialize; never lands without a tap.

### 7.5 Summon surface
Two paths to the same action:
- **Contextual** — selecting card(s) raises "✦ Ask an agent"; opening it shows
  the four agents with name + tagline + identity dot. Shows _what the agent will
  see_ (Kuse-style scope hint: "Researcher will read this note").
- **Command (⌘K)** — a fast palette: type to pick an agent / action. Keyboard
  path to everything. (Phase C3.)

### 7.6 Cards
Shared: `--jz-surface`, `--jz-radius-lg`, `--jz-hairline-strong` border,
`--jz-e2`, card-materialize on create. Each kind:

- **Link / source** — 16:9 media (og:image) or graceful domain-initial
  fallback; `heading` title (2-line clamp), `body-sm` description (3-line),
  favicon + domain (`micro`) footer, open affordance. Crafted shimmer skeleton
  while loading.
- **YouTube** — header drag-bar (red dot + title + "double-click to play"),
  privacy `youtube-nocookie` iframe, pointer-safe until edit.
- **Image** — padded frame, object-fit cover, caption (`micro`).
- **PDF** — embedded object with a dignified fallback + filename footer.
- **Note** — sticky paper (`--jz-paper`-family tint), asymmetric radius,
  `body-sm`, placeholder when empty. Brainstormer notes arrive pre-filled.
- **Doc** — the editorial artifact. `title-lg` (Fraunces) header on a hairline,
  body in `body` with real markdown (h1–h3 in Fraunces, lists, bold/italic,
  inline code in a warm chip). Streaming caret while writing; edit-in-place.

### 7.7 Provenance edges
tldraw arrows in `agent.color`, edge-draw on create, optional short label
(`micro` on a paper chip). Legible at any zoom; never crosses _through_ a card
when avoidable (placement helps).

### 7.8 Toasts & honest states
Bottom-center, above the dock, `--jz-surface-raised`, `--jz-e3`. Errors use
`--jz-danger`, plain language, and say what to do next. Never a raw exception.

---

## 8. Key screens & states

1. **Cold board (empty state).** Not a void: a centered, calm hero — Fraunces
   line ("Drop a link, or write a thought.") + three quiet affordances (paste a
   link · drag a file · ✦ ask an agent). Disappears on first content.
2. **First-run onboarding.** One non-modal coachmark on the first summon
   opportunity ("This is the Summarizer — tap to see it work"). Skippable,
   shown once (localStorage).
3. **Idle populated.** Silent paper, cards at rest, dock idle. Calm.
4. **Agent working.** Cursor glides to the source, dock cell lights, status is
   specific, artifact materializes and streams, edge draws on. The hero moment.
5. **Multi-agent (future-safe).** Multiple cursors + dock cells coexist without
   visual collision; each owns its color lane.
6. **Honest system states.** Designed treatments for: demo mode (no API key),
   rate-limited, empty results ("Researcher didn't find strong sources"),
   refusal, network error. Each is a calm card/toast, never raw.
7. **Dense / zoomed-out.** Grid fades, labels simplify, cards keep legible
   hierarchy; presence still readable.

---

## 9. Accessibility

- Text meets **WCAG AA** (≥4.5:1 body, ≥3:1 large). Agent `ink` variants exist
  precisely so colored text stays AA on `--jz-surface`.
- **Keyboard:** every action reachable — summon via ⌘K, dismiss via Esc, offer
  acceptable via Enter when focused.
- **Focus** rings are visible (2px, `--jz-focus`).
- **Reduced motion** honored everywhere (see §5).
- Cursors/labels have non-color cues (name text), so colorblind users still
  attribute work correctly.

---

## 10. Implementation notes

- All tokens live as CSS custom properties in `apps/web/src/styles/tokens.css`
  (imported first), consumed by `index.css` and components. **No raw themeable
  hex/px in component files.**
- Fonts loaded in `index.html` (Fraunces + Inter, variable, `display=swap`,
  preconnected).
- Color washes use `color-mix(in srgb, var(--agent-color) …)` so components are
  hue-agnostic and new agents need no new CSS.
- Motion uses the duration/easing tokens; components must gate travel/scale
  behind `@media (prefers-reduced-motion: no-preference)`.
- A small `ui/` primitives layer (Surface, Pill, IconButton) keeps chrome
  consistent and DRY.

---

## 11. Open design questions (tracked)

- ⌘K palette vs. radial summon as the primary fast path (lean palette).
- Dark / nocturne editorial mode — explore in C4, not committed.
- Grain on/off default (perf vs. warmth) — A/B by feel during C1.
