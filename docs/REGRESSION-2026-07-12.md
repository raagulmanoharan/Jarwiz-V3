# Regression + performance A/B — prompt-assembly cleanup

Point-in-time evidence produced by `scripts/eval-regression.mjs` (the reusable
A/B harness). Run against the **real Claude CLI sidecar** — `mode=sidecar`, not
the mock — twice: `main` (baseline) and `claude/prompt-assembly-cleanup`
(candidate, = PR #64), then diffed.

## How it was run

```bash
# candidate build up on :3001 (sidecar)
node scripts/eval-regression.mjs --label candidate-cleanup --out candidate.json
# swap to the baseline build, then:
node scripts/eval-regression.mjs --label baseline-main --out baseline.json
node scripts/eval-regression.mjs --compare baseline.json candidate.json
```

25 cases, concurrency 2, transient sidecar drops retried once (a fast
empty/errored stream under parallel load is not a product failure; a genuine
invariant fail on a complete run is never retried).

## Coverage (25 cases)

| Group | Cases |
|---|---|
| platform | health, capabilities, ask-validation-400, link-preview-invalid, link-preview-ssrf |
| router | intent-edit, intent-new, shape-table, shape-diagram |
| ask (all 7 shapes) | doc, doc+source (provenance), list, **checklist+source** (the reworded conflict), table, diagram, prototype, dashboard, affinity |
| compose | board fan-out, **debrief** (the noWeb path) |
| autopilot | prose, table |
| analyze | tensions, gaps |
| seed | seed-text |

Each case asserts **structural invariants** (robust to LLM wording), records
**values** (routing/provenance/counts — drift surfaces without false alarms),
and captures **latency + time-to-first-event**.

## Result

```
pass: 25/25  →  25/25
REGRESSIONS (baseline-pass → candidate-fail): 0
FIXES (baseline-fail → candidate-pass): 0
VERDICT: ✅ NO REGRESSIONS
```

Recorded-value diffs were benign run-to-run LLM variance (both runs of
`ask-checklist-source` produced a valid checklist with `usedSources=[1]`; task
counts differed 7↔4).

### Performance (LLM cases)

| | baseline (main) | candidate (cleanup) | Δ |
|---|--:|--:|--:|
| p50 | 13034 ms | 12716 ms | −318 ms |
| p90 | 115426 ms | 121183 ms | +5757 ms |
| ttfb p50 | 9 ms | 8 ms | −1 ms |

Notable per-case shifts (≥2 s and ≥20 %):

| case | baseline | candidate | Δ |
|---|--:|--:|--:|
| compose-debrief (noWeb path) | 40261 ms | 29969 ms | −26 % |
| ask-table | 25698 ms | 14940 ms | −42 % |
| ask-dashboard | 18400 ms | 12121 ms | −34 % |
| seed-text | 13034 ms | 6881 ms | −47 % |
| autopilot-prose | 11738 ms | 17445 ms | +49 % |

**Honest caveat:** single-run sidecar latency is very noisy — the per-case
shifts are *directional*, not statistically conclusive. The `compose-debrief`
−26 % is consistent with the `noWeb` gating (no web-tool consideration, shorter
system prompt) and is the most relevant signal; p90 is dominated by the one
100 s-class case and swings run to run. The **solid, defensible claim is the
invariant result: zero behavioural regressions** across every response shape,
the debrief recipe, autopilot, analyze, the routers, and the platform guards.

**Sandbox note:** the web is blocked in this environment, so `main`'s debrief
cards couldn't actually fetch images/pages even though they were offered the
tools — hence the output invariants (no images / no `Source:` lines) pass on
both sides. The cleanup's win there is throughput and correctness-of-intent
(the extractive path no longer *tries*), which the latency trend reflects; on a
networked deploy it would also prevent spurious web hops on extractive cards.
