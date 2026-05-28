# Seed Sets

EchoGrid seed files are deterministic benchmark surfaces. They are public by design in this repo; final competitions should still use held-out seeds for ranking.

## Current Sets

| File | Purpose |
| --- | --- |
| `seeds/showcase.txt` | Single judge-facing showcase seed. |
| `seeds/demo.txt` | Small bundled comparison set used by `npm run demo:full`. |
| `seeds/public.txt` | Broader public local benchmark set. |
| `seeds/rule-signals.txt` | Compact rule-signal demonstration set. |
| `seeds/adversarial.txt` | Stress set with longer routes and hidden-rule coverage. |
| `seeds/targeted-oscillation.txt` | Regression seeds for recent loop-recovery fixes. |
| `seeds/llm-smoke.txt` | Small external-model integration smoke set. |

## Public Set

`seeds/public.txt` is the broader public pressure set used by the submission bundle:

```bash
npm run benchmark:public
```

The command writes `logs/public/agent-comparison.json`, `logs/public/arena.html`, and `logs/public/leaderboard.md`. The set is intentionally broader than the single showcase path and includes a known-hard exit-routing seed. The bundle verifier checks that random has 0% success, both reference policies solve every public seed, and rule-aware beats baseline on average score.

## Rule-Signal Set

`seeds/rule-signals.txt` is a compact reasoning showcase for audited rule claims:

```bash
npm run benchmark:rules
```

The rules benchmark writes `logs/rules/agent-comparison.json`, `logs/rules/arena.html`, and `logs/rules/leaderboard.md`. It includes `agents/rule-aware.js`, which checks bounded sector and row signals, plus `agents/rule-explorer.js`, which focuses on the row hidden-rule signal before falling back to baseline routing.

| Hidden rule | Seeds |
| --- | --- |
| `row_count_disclosure` | `44` |
| `sector_c_two_unstable` | `48` |

## Adversarial Set

`seeds/adversarial.txt` is not the default judge demo. It is a harder public benchmark for regression and tournament-style comparisons:

```bash
npm run benchmark:adversarial
```

The command writes `logs/adversarial/agent-comparison.json`, `logs/adversarial/arena.html`, and `logs/adversarial/leaderboard.md`.

The set covers all current hidden-rule families with one compact stress seed each:

| Hidden rule | Seeds |
| --- | --- |
| `row_count_disclosure` | `44` |
| `wall_echo_inversion` | `111` |
| `artifact_suppression` | `223` |
| `exit_radius_safe` | `168` |
| `sector_c_two_unstable` | `48` |

These seeds were selected because the bundled reference policies can complete them, but they are longer and lower-scoring than the main showcase route. They are useful for catching regressions that a single showcase seed will not expose.

## Competition Use

- Use `showcase` and `demo` for quick review.
- Use `public` and `adversarial` for local hardening before submission.
- Use held-out seeds for final rankings when possible.
- Do not let evaluated agents inspect hidden answers or prior logs from the same held-out run.

## Held-Out Workflow

For final ranking, keep the private seed file outside the repository and point EchoGrid at it:

```bash
set ECHOGRID_HELDOUT_SEEDS=C:\path\to\heldout-seeds.txt
npm run benchmark:heldout
```

The script writes `logs/heldout/heldout-results.json`, `logs/heldout/heldout-leaderboard.md`, and `logs/heldout/HELDOUT_SUMMARY.md`. Generated outputs redact seed ids by default and identify the seed file by sha256 plus seed count. This lets judges verify they used a stable held-out set without publishing the actual seeds.

To disclose seed ids intentionally, run:

```bash
node ./scripts/run-heldout-benchmark.js --seeds C:\path\to\heldout-seeds.txt --show-seeds
```
