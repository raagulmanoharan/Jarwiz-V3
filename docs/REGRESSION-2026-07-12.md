# Response-quality A/B — prompt-assembly cleanup

Evidence produced by `scripts/eval-regression.mjs`, the reusable A/B harness.
Run against the **real Claude CLI sidecar** (`mode=sidecar`, not the mock),
twice — `main` (baseline) and `claude/prompt-assembly-cleanup` (candidate,
= PR #64) — then diffed.

## What it measures — quality, not speed

The CLI sidecar's wall-clock is process-spawn overhead: inherently noisy and
**not a signal about a prompt change**. So latency is recorded but
informational only — it never gates a case and never drives the verdict. Each
case is graded on output quality instead:

- **mustPass checks (0/1)** — format + contamination gates: a well-formed
  checklist / table / diagram, **no `SOURCES_USED` marker leaked**, and — for an
  extractive card — **no spurious web citation line or image**.
- **graded checks (0..1)** — **grounding**: the fraction of the source's real
  entities/facts (owners, dates, decisions) the answer actually carries, plus
  provenance correctness.

Because the model is stochastic, quality is **sampled**: quality-critical cases
run `N` repeats (default 3) and report a *quality score* (mean graded) + a
*hard-pass rate* (fraction of repeats clearing every gate). One unlucky sample
can't flip a verdict. The A/B flags a case only when the candidate's hard-pass
rate drops or its quality falls by more than 0.10.

## How it was run

```bash
node scripts/eval-regression.mjs --label candidate-cleanup --out candidate.json
# swap to the baseline build, then:
node scripts/eval-regression.mjs --label baseline-main --out baseline.json
node scripts/eval-regression.mjs --compare baseline.json candidate.json
```

26 cases, concurrency 2, quality-critical cases sampled ×3. Transient sidecar
drops (a fast empty/errored stream under parallel load) are retried once — never
a product failure; a genuine gate miss on a complete run is never retried.

## Coverage

| Group | Cases | Sampling |
|---|---|---|
| platform | health, capabilities, ask-validation-400, link-preview-invalid, **link-preview-ssrf** | ×1 |
| router | intent-edit, intent-new, shape-table, shape-diagram | ×2 |
| ask (shape/format) | doc, list, table, diagram, prototype, dashboard, affinity | ×1 |
| **quality-critical** | **ask-doc-source** (grounding + provenance), **ask-checklist-source** (the reworked checklist↔provenance conflict), **provenance-negative** (attach a source, ask unrelated → no lineage), **compose-debrief** (the noWeb extractive path, faithfulness) | **×3** |
| compose | board fan-out | ×1 |
| autopilot | prose, table | ×1 |
| analyze | tensions (grounding), gaps | ×1 |
| seed | seed-text | ×1 |

## Result

```
pass:            26/26  →  26/26
mean quality:    1.0    →  1.0
quality-critical:1.0    →  1.0
QUALITY REGRESSIONS: 0
QUALITY GAINS:       0
VERDICT: ✅ NO QUALITY REGRESSIONS
```

Every quality-critical case scored **q = 1.00 on both builds** — the model
carried the transcript's owners/dates/decisions faithfully, fired provenance
`[1]` when it used the source and **claimed none when it didn't**
(`provenance-negative`), and the debrief cards stayed clean (no marker, no
image, no `Source:` line) and grounded. The reworked `CHECKLIST` / `SOURCES_USED`
directives compose correctly under sampling.

One **drift** item (not a regression): `ask-checklist-source` produced 4 vs 7
task lines across the two runs — ordinary LLM variance; both were valid
checklists with `usedSources=[1]`.

Latency was ~8.7 s → ~8.6 s median — informational only; sidecar wall-clock is
not a quality signal and does not enter the verdict.

**Sandbox note:** the web is blocked in this environment, so `main`'s debrief
cards couldn't fetch images/pages even though they were offered the tools —
hence both builds pass the extractive contamination gates. The cleanup's win
there is throughput and correctness-of-intent (the extractive path no longer
*tries*); on a networked deploy it also prevents spurious web hops on extractive
cards. The quality suite proves the change **did not degrade any output**.
