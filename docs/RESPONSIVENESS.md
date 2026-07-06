# Responsiveness & Discoverability — Plan of Record

> Source: principal-PM plan after the persona's second test session (June 2026).
> She loved the synthesis but hammered one thing: the batch AI actions wait
> 20–35s in near-silence and sometimes no-show. This is the fix.

## Diagnosis

Two streaming classes, and the seam is exactly what hurt:
- **Streaming (feels instant):** `/api/ask`, `/api/autopilot`, `/api/autopilot/table`,
  `/api/comment`, `/api/agents/:id/run` — SSE, content grows token-by-token.
- **Batch (feels broken):** `/api/cluster`, `/api/analyze`, `/api/diagram`,
  `/api/revise` — `c.json(...)` after the *whole* generation; tiny far-off label,
  nothing at the destination, and the client hooks **swallow errors to console**
  (silent no-show under load).

Not a model-speed problem — a perceived-performance + honesty problem.

## Principles (grounded in UX research)

- Attention drifts after ~1s of dead time; feedback makes a wait feel 11–15%
  faster (NN/g); thresholds 0.1s / 1s / 10s.
- Skeletons feel faster than spinners (structure > "something's happening");
  Facebook ~300ms perceived gain. Skeletons for structured content in seconds;
  streaming/progress for long opaque jobs.
- Streaming LLM output feels faster at identical total time; TTFT 200–500ms.
  2025 agent-UI protocols (AG-UI, A2UI) stream *structured* objects for
  progressive rendering + optimistic placeholders.

**The bar every AI action must clear:** (1) never silent — placeholder < 100ms;
(2) stream text, skeleton structure, optimistic where shape is known; (3) always
cancellable, never a dead end (error + Retry, no swallowed errors); (4) feedback
escalates with time; (5) one shared "agent is working" language.

## Unified primitive

One `agentTask` store + layer (status line · Cancel · error+Retry) that every AI
action drives — like `presence`/`streaming`/`draft` back the Ask flow. Structure
skeletons (ghost columns / nodes) are action-specific.

## Workstream A — streaming + skeletons

- **A1. Analyze (tensions/gaps/critique) → stream.** Prompts emit plain markdown
  (not JSON); drop a titled doc card instantly with a skeleton, stream the body.
- **A2. Revise → stream in place.** Shimmer the body, stream the new text, one undo.
- **A3. Cluster → optimistic skeleton + streamed summary.** Instant ghost columns
  + dimmed notes; snap notes into themed columns on first payload; stream the
  summary doc text.
- **A4. Diagram → draw node-by-node.** Model emits JSONL; client creates each
  shape as it arrives, avatar moving to each. Fallback skeleton frame.
- **A5. Reliability.** Surface errors + Retry (kill silent console.error); client
  timeout (~60s); keep per-action Cancel; concurrency guard so back-to-back
  actions degrade gracefully.

## Workstream B — first-run onboarding fires

`boardStore` makes the legacy board `isNew:false` to avoid onboarding over a
returning user's canvas — but a brand-new user gets the same, so the dialog never
fires on first open. Fix: at init, if the legacy snapshot (`jarwiz-pdf-v2`) is
**absent** → fresh install → `isNew:true`; if present → upgrade → `isNew:false`.

## Workstream C — discoverability

(1) Relabel the launcher (icon + "Agents"); (2) contextual quick-action chips
above the prompt bar when the board has content and nothing is selected; (3)
one-time coachmark at ~5 cards.

## Phasing — all shipped ✅

- **P1 ✅:** agentTask primitive + AgentCursorLayer; analyze + revise stream into
  a card with a skeleton; agent cursor works on the card live; error/Retry/timeout/
  Cancel; onboarding fix; launcher relabelled "✦ Agents". `eval-responsiveness` 5/5.
- **P2 ✅:** the agent DRAWS the flowchart node-by-node (cursor hops to each box);
  cluster lays notes into columns + writes the summary in live. Distinct agent
  identities so concurrent actions show distinct cursors; concurrency stays open
  (each action independent + timeouts) per the collaborative ask.
  `eval-canvas-p2` 5/5, `eval-cluster` 6/6.
- **P3 ✅:** contextual quick-action chips above the prompt bar; one-time
  coachmark at ≥5 cards. `eval-discoverability` 6/6.

Also delivered (from the follow-up ask): **agent presence during streaming** —
the Writer/Summarizer cursor parks on the card/columns and moves as it works, so
it reads as a collaborator at the canvas alongside you (the concurrent
human-edits-doc / agent-fills-table case already works via separate stores).

## Success metrics & eval

Time-to-first-feedback < 300ms (assert skeleton appears); streamed text grows;
zero silent failures (force error → Retry state); onboarding fires on simulated
fresh install, not on upgrade; re-test with the persona after P1.

## NOT doing

Model speedups; generic global toasts; reviving the roster; fake progress
percentages.
