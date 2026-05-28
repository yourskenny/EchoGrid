# Seed Sets

EchoGrid seed files are deterministic benchmark surfaces. They are public by design in this repo; final competitions should still use held-out seeds for ranking.

## Current Sets

| File | Purpose |
| --- | --- |
| `seeds/showcase.txt` | Single judge-facing showcase seed. |
| `seeds/demo.txt` | Small bundled comparison set used by `npm run demo:full`. |
| `seeds/public.txt` | Broader public local benchmark set. |
| `seeds/adversarial.txt` | Stress set with longer routes and hidden-rule coverage. |
| `seeds/targeted-oscillation.txt` | Regression seeds for recent loop-recovery fixes. |
| `seeds/llm-smoke.txt` | Small external-model integration smoke set. |

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
