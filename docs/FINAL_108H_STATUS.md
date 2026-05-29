# EchoGrid Final 108h Status

Generated: 2026-05-29
Planning baseline commit: `8ff7a4f` (`Add EchoGrid 108h judge plan`)

## Current Status

EchoGrid is past the final automated submission gate for the current
competition package. The project should be treated as a competition-ready,
judge-facing, agent-native inference game demo unless a new blocker appears.

The current stable framing is:

> EchoGrid is a tiny, auditable world-modeling arena for agents. Agents receive
> partial structured state, act through one-line commands, infer hidden rules
> from public evidence, manage resources, collect artifacts, extract, and leave
> a replayable proof trail.

What is ready:

- The deterministic showcase succeeds on seed `9001` with the rule-aware agent.
- Random, baseline, and rule-aware agents produce the expected comparison
  curve.
- Public, adversarial, and rule-signal benchmark gates pass.
- The generated submission bundle verifies locally.
- Mission Control, Replay, Arena, Scorecard, Judge Brief, Protocol Trace,
  Leaderboard, Manifest, and `START_HERE.html` exist in generated artifacts.
- Visual smoke covers desktop and mobile screenshots and now detects blank
  first-viewport regressions.
- Replay HTML no longer leaks machine-specific source paths.
- Independent Codex verification passed the requested local readiness checks.
- Credentialed DeepSeek smoke checks passed for both `deepseek-v4-pro` and
  `deepseek-v4-flash` when given enough pure model turn budget.

What should not change late:

- Do not pivot into a human-first graphical game.
- Do not rename or remove core public STATE/action protocol fields.
- Do not add network requirements to deterministic reference agents.
- Do not include secrets, provider credentials, or machine-specific absolute
  paths in committed files or generated submission bundles.

Primary local handoff artifacts:

- `logs/showcase/index.html`
- `logs/showcase/mission-control.html`
- `logs/showcase/replay.html`
- `logs/showcase/arena.html`
- `logs/showcase/SCORECARD.md`
- `dist/submission/echogrid-submission/START_HERE.html`
- `dist/submission/echogrid-submission.zip`

`logs/` and `dist/` are generated local artifact directories and are ignored by
Git. Regenerate them with `npm run submission:check`.

## Phase

Baseline through final bundle gate.

The current goal is to establish the real project state before adding new
features, then advance through the judge-facing gates in
`docs/echogrid-108h-judge-plan.md`. This pass installed dependencies, ran the
core gates, generated the showcase package, verified visual artifacts, ran all
benchmark groups, generated the submission bundle, and completed the final
submission check.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `npm install` | Pass | No vulnerabilities. Created `package-lock.json` for reproducible install metadata. |
| `npm test` | Pass | 49 tests passed. |
| `npm run demo:verify` | Pass | Re-ran tests, evaluated rule-aware on seed `9001`, and compared showcase agents. |
| `npm run demo:full` | Pass | Generated the full `logs/showcase` package. |
| `npm run demo:check` | Pass | Verified required showcase artifacts and manifest references. |
| `npm run demo:visual` | Pass | Generated desktop/mobile screenshots using Chrome and verified top-half render coverage. |
| `npm run benchmark:public` | Pass | Rule-aware led public benchmark at 926.7 average score. |
| `npm run benchmark:adversarial` | Pass | Rule-aware led adversarial benchmark at 881.2 average score. |
| `npm run benchmark:rules` | Pass | Rule-aware led rule-signals benchmark at 962 average score. |
| `npm run submission:bundle` | Pass | Created `dist/submission/echogrid-submission` and `.zip`. |
| `npm run submission:verify` | Pass | Verified bundle files, links, manifest, and zip. |
| `npm run submission:check` | Pass | Final gate passed end to end. |

## Baseline Results

Showcase seed `9001`:

- Agent: `agents/rule-aware.js`
- Result: success / `objective_complete`
- Score: 991
- Turns: 53 / 130
- Artifacts: 3 / 3
- Resources: 99 energy, 3 integrity
- Hidden rule: `sector_c_two_unstable`
- Accepted rule claim: turn 2, rationale `sector C scan showed exactly two unstable echoes`
- Damage events: 0
- Invalid actions: 0
- Wasted actions: 0

Demo comparison over `seeds/demo.txt`:

| Agent | Success Rate | Avg Score | Avg Turns |
| --- | ---: | ---: | ---: |
| `./agents/random.js` | 0% | 218.5 | 112.8 |
| `./agents/baseline.js` | 100% | 874.0 | 57.8 |
| `./agents/rule-aware.js` | 100% | 929.5 | 59.3 |

The expected judge-facing story is present: random fails, baseline completes
the basic mission, and rule-aware gains score through public rule evidence.

## Generated Showcase Artifacts

`npm run demo:full` produced:

- `logs/showcase/9001.jsonl`
- `logs/showcase/index.html`
- `logs/showcase/mission-control.html`
- `logs/showcase/replay.html`
- `logs/showcase/arena.html`
- `logs/showcase/SCORECARD.md`
- `logs/showcase/JUDGE_BRIEF.md`
- `logs/showcase/PROTOCOL_TRACE.md`
- `logs/showcase/MANIFEST.json`
- `logs/showcase/leaderboard.md`
- `logs/showcase/agent-comparison.json`
- `logs/showcase/agent-comparison.txt`

`npm run demo:check` accepted all required files.

## P0 Blockers

None open.

Current P0 gates passing:

- `npm test`
- `npm run demo:verify`
- `npm run demo:full`
- `npm run demo:check`
- `npm run demo:visual`
- `npm run benchmark:public`
- `npm run benchmark:adversarial`
- `npm run benchmark:rules`
- `npm run submission:bundle`
- `npm run submission:verify`
- `npm run submission:check`

## P1 Findings

- `logs/showcase/index.html` includes the expected judge entry points:
  Competition Verdict, Mission Control, Scorecard, Judge Brief, Protocol Trace,
  Leaderboard, Arena, Replay, and Manifest.
- `logs/showcase/mission-control.html` includes the final public map, mission
  timeline, accepted rule claim rationale, score construction, agent tournament,
  and strategy edge.
- `logs/showcase/replay.html` mobile layout was fixed so initialization no
  longer scrolls the page to a mostly blank first viewport. Timeline selection
  now scrolls only the internal timeline container.
- `scripts/smoke-demo-visuals.js` now records and checks top-half color
  diversity, so a page with overall color but a blank first viewport is caught.
- `logs/showcase/replay.html` source labeling was fixed to use repository
  relative paths such as `logs/showcase/9001.jsonl` instead of machine-specific
  absolute paths.
- `START_HERE.html` exists in the generated bundle and links to Mission Control,
  Replay, Arena, Scorecard, benchmark leaderboards, Strategy Audit, Reproduce
  Report, and the submission manifest.

## Remaining Risks

- No P0/P1 gate risk is currently known.
- Optional remaining work is copy polish and deeper manual review of the
  generated HTML pages after any future content changes.

## External Verification

### Codex isolated verification

Date: 2026-05-29

Output:

- Local ignored artifact: `logs/codex-verification-full-2026-05-29.md`

Result:

- Pass. A separate `codex exec` session ran the requested checks with no source
  edits.
- `npm test`: pass, 49 / 49 tests.
- `npm run demo:check`: pass.
- `npm run demo:visual`: pass, Chrome found locally.
- `npm run submission:verify`: pass.
- `node ./scripts/run-llm-eval.js --help`: pass.
- Replay source labels were confirmed as repository-relative:
  `Source: logs/showcase/9001.jsonl`.
- The generated replay HTML files were scanned for common absolute-path labels
  such as `C:\`, `C:/`, `file://`, `/Users/`, and `/home/`; none were found.

Residual note:

- The working tree was already dirty during verification because this status
  pass intentionally added `docs/FINAL_108H_STATUS.md`, `package-lock.json`, and
  the replay/visual-smoke fixes.

### DeepSeek verification

Date: 2026-05-29

Result:

- Pass for credentialed smoke coverage of both requested models.
- The API key was supplied only through the command process environment and was
  not written to repo files or persistent environment variables.
- Secret scan over `logs/llm`, `logs/llm-pure64`, and this status document found
  no API key material.

Commands:

- `node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt --mode micro --max-model-turns 12 --leaderboard both`
- `node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt --mode micro --max-model-turns 64 --leaderboard pure --out-dir ./logs/llm-pure64`

Artifacts:

- Local ignored artifact: `logs/llm/summary.json`
- Local ignored artifact: `logs/llm-pure64/summary.json`

Results:

| Run | Model | Leaderboard | Result | Score | Turns | Notes |
| --- | --- | --- | --- | ---: | ---: | --- |
| 12-turn smoke | `deepseek-v4-pro` | pure | failure | 208 | 13 | model turn budget exhausted |
| 12-turn smoke | `deepseek-v4-flash` | pure | failure | 208 | 13 | model turn budget exhausted |
| 12-turn smoke | `deepseek-v4-pro` | hybrid | success | 606 | 55 | local fallback after model budget |
| 12-turn smoke | `deepseek-v4-flash` | hybrid | success | 606 | 55 | local fallback after model budget |
| 64-turn strict pure | `deepseek-v4-pro` | pure | success | 606 | 55 | no fallback, no local policy, no recovered action |
| 64-turn strict pure | `deepseek-v4-flash` | pure | success | 606 | 55 | no fallback, no local policy, no recovered action |

## Next Step

Treat the repository as past the final automated submission gate. Future work
should be limited to copy fixes, broken-link fixes, final pitch preparation,
or other low-risk polish unless a new blocker appears.
