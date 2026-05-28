# Test And Optimization Cycle Summary - 2026-05-28

This document summarizes the repeated external-agent test loop for EchoGrid.

## Scope

Models and agents tested:

- `deepseek-v4-pro`
- `deepseek-v4-flash`
- Codex CLI in an isolated session without thread context
- local reference agents: random, baseline, rule-aware

API keys were used only through environment variables and were not committed.

## Loop 1: Raw DeepSeek Smoke

Command family:

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt
```

Result:

- both DeepSeek models failed raw play
- repeated empty final `message.content`
- many fallback `wait` actions
- no useful model completion signal without diagnostics

Optimization:

- added `agents/llm-openai-compatible.js`
- added `scripts/run-llm-eval.js`
- added diagnostic logging to JSONL action events

## Loop 2: Protocol Affordances

Finding:

LLMs had to infer local legal moves from compact map rows, which led to bad actions such as moving into known walls.

Optimization:

- added `agent.current_cell`
- added `agent.adjacent`
- added `action_hints.safe_recommended`

Observed effect:

- Flash invalid actions dropped from 47 to 0 on the analyzed showcase run
- model still had high empty-final/fallback rate

## Loop 3: Budgeted Hybrid Evaluation

Finding:

Full model control is slow and unstable because some models spend too many tokens in reasoning and produce no final action.

Optimization:

- added `ECHOGRID_LLM_MAX_MODEL_TURNS`
- added `ECHOGRID_LLM_MAX_TOKENS`
- added baseline fallback for empty/failed model actions

Observed showcase result:

```text
deepseek-v4-flash: success, score=860, turns=85, artifacts=3/3
deepseek-v4-pro:   success, score=860, turns=85, artifacts=3/3
```

Interpretation:

This is a hybrid run. It is valid for integration and diagnostics, but not a pure-model leaderboard.

## Loop 4: Codex Isolation

Codex was run through `codex exec` with a prompt limited to repository inspection and local commands. No thread context was provided.

Commands executed by Codex:

```bash
npm test
node ./bin/echogrid.js evaluate --agent ./agents/rule-aware.js --seed 9001 --json
node ./scripts/compare.js --seeds ./seeds/showcase.txt
```

Results:

```text
npm test: 8 passed initially, later 11 passed after added diagnostics
rule-aware showcase: success, score=977, artifacts=3/3
compare showcase:
  random:     success=0, score=138
  baseline:   success=1, score=862
  rule-aware: success=1, score=977
```

Optimization:

- added `npm run demo:verify`
- documented faster verification path

## Loop 5: Diagnostics And Analysis

Optimizations:

- added `scripts/summarize-llm-logs.js`
- added `scripts/analyze-run.js`
- added LLM diagnostic counts to battle reports
- added BOM-tolerant JSONL reading
- added `evaluate --summary-file`

These changes turn model runs into reusable evidence:

- per-run quality flags
- fallback dominance
- model contribution rate
- invalid/wait/oscillation rates
- aggregate summary JSON

## Loop 6: Persistent Agent Protocol

Finding:

The default evaluation path spawned a fresh agent process every turn. This is simple and compatible, but it adds avoidable overhead for longer benchmark runs and makes future external-agent harnesses harder to scale.

Optimization:

- added `evaluate --agent-mode persistent`
- added `agents/baseline-policy.js` so one-shot and persistent baseline agents share the same policy
- added `agents/baseline-persistent.js` as a reference persistent line-protocol agent
- documented persistent mode in README and the agent authoring guide

Verification:

```text
node --test test/cli.test.js: 8 pass / 0 fail
baseline-persistent seed 48129: success, score=856, turns=92, artifacts=3/3
persistent baseline seed 9001: JSON result matches one-shot baseline
```

Interpretation:

Persistent mode is opt-in and keeps the existing one-shot agent protocol as the default compatibility path. It prepares EchoGrid for larger benchmark loops and lower-overhead external agent testing without changing game mechanics or score semantics.

## Loop 7: Pure vs Hybrid LLM Leaderboards

Finding:

Budgeted DeepSeek runs were useful integration tests, but final success scores could be misread because baseline fallback sometimes rescued the run after limited model-controlled turns.

Optimization:

- added `--leaderboard pure|hybrid|both` to `scripts/run-llm-eval.js`
- added `ECHOGRID_LLM_FALLBACK_MODE=none` for pure-model runs
- disabled local obvious-action handling in pure mode with `ECHOGRID_LLM_LOCAL_POLICY=0`
- updated LLM summaries and per-run analysis with `leaderboard` and `model_error_actions`
- kept hybrid mode for model-plus-baseline integration diagnostics

Verification:

```text
pure mode without API key: fallback_actions=0, model_error_actions>0, leaderboard=pure
LLM summary table: includes Board and Errors columns
DeepSeek micro run, max_model_turns=4:
  pure/deepseek-v4-flash: failure, score=-1168, model_errors=70, fallback=0
  pure/deepseek-v4-pro:   failure, score=-1168, model_errors=70, fallback=0
  hybrid/deepseek-v4-flash: success, score=606, model_actions=1, fallback=56
  hybrid/deepseek-v4-pro:   success, score=606, model_actions=0, fallback=57
```

Interpretation:

Pure model scores and hybrid integration scores are now separated at the harness and log-analysis levels. This prevents model quality claims from being inflated by fallback success while preserving the practical diagnostic path for provider/API failures.

## Loop 8: Published Protocol Schemas

Finding:

Codex and external model harnesses can inspect README prose, but a mature agent-first benchmark also needs machine-readable contracts for the state, JSONL event log, and evaluation summary.

Optimization:

- added `schemas/state.schema.json`
- added `schemas/event.schema.json`
- added `schemas/summary.schema.json`
- documented schema locations in README and the agent authoring guide
- added schema alignment tests against current engine and CLI output

Verification:

```text
schema files parse as JSON Schema draft 2020-12
current public state contains every required state schema field
evaluate JSONL start/action events match the documented event surfaces
evaluate --summary-file output contains every required summary/result field
```

Interpretation:

EchoGrid now exposes its protocol as a contract rather than only as examples. This helps Codex-style isolated agents, LLM wrappers, and future third-party agents validate assumptions before running full games.

## Loop 9: Codex Isolation Recheck

Codex was run again in an isolated `codex exec` session with no thread context. It was instructed to run fixed local commands and inspect only repository files.

Commands executed:

```text
npm test
node ./bin/echogrid.js evaluate --agent ./agents/rule-aware.js --seed 9001 --json
node ./scripts/compare.js --seeds ./seeds/showcase.txt
node ./scripts/summarize-llm-logs.js ./logs/llm
```

Results:

```text
npm test: 18 passed, 0 failed
rule-aware showcase: success, score=977, turns=86
compare showcase: random failed; baseline and rule-aware succeeded
LLM summary: hybrid runs succeeded; pure runs failed separately
```

Codex assessment:

- understandable: yes
- testable: yes
- agent-friendly: yes
- pure vs hybrid LLM separation: yes

## Loop 10: Fast Abort For Pure Model Errors

Finding:

Pure leaderboard mode correctly avoided fallback, but model failures consumed the full game budget as repeated invalid `__model_unavailable__` actions. This made smoke tests noisy and slow, and inflated invalid-action counts.

Optimization:

- added `abort_evaluation` diagnostics for pure LLM model errors
- added evaluator-level abort records in JSONL logs
- updated replay, summary, analysis, and schema handling for `abort` events
- kept hybrid behavior unchanged

Verification:

```text
pure missing-key smoke: failure, reason=model_missing_api_key, turns=1, fallback=0, model_error_actions=1
DeepSeek micro run, max_model_turns=4:
  pure/deepseek-v4-flash: failure, score=212, turns=2, errors=1, abort=yes
  pure/deepseek-v4-pro:   failure, score=212, turns=1, errors=1, abort=yes
  hybrid/deepseek-v4-flash: success, score=606, turns=59, fallback=56
  hybrid/deepseek-v4-pro:   success, score=606, turns=59, fallback=57
```

Interpretation:

Pure model runs now fail fast when the model cannot produce a usable action, while still logging the exact model diagnostic reason. This makes repeated model smoke loops faster and easier to interpret without weakening the pure-vs-hybrid separation.

## Loop 11: Repeat-Avoidance Hints For Model Planning

Finding:

With a higher token budget, `deepseek-v4-pro` produced multiple valid pure-model actions, but one run oscillated between adjacent cells (`move S`, then `move N`). The model needed a public, local hint that identifies immediate backtracking without revealing hidden terrain.

Optimization:

- added `action_hints.avoid_repeating` to public state
- added repeat-avoidance to `schemas/state.schema.json`
- added repeat-avoidance guidance to the LLM prompt summary
- documented the field in the agent authoring guide

Verification:

```text
npm test: 19 pass / 0 fail
npm run demo:verify: pass
deepseek-v4-pro pure micro, max_tokens=512, max_model_turns=6:
  model_actions=3
  model_error_actions=1
  movement_oscillations=0
  model_contribution_rate=0.75
```

Interpretation:

The new field gives LLMs a cheap way to avoid one-step backtracking. It does not leak hidden information because it is derived only from the agent's previous public move.

## Loop 12: Reasoning Recovery Diagnostic

Finding:

DeepSeek responses often had empty final `message.content`, but the `reasoning_content` preview contained a concrete legal action. This makes strict pure leaderboard failures ambiguous: some are reasoning failures, while others are final-channel formatting failures.

Optimization:

- added opt-in `ECHOGRID_LLM_RECOVER_REASONING_ACTION=1`
- added `--recover-reasoning-action` to the LLM runner
- added recovered-action counts to `analyze-run` and `summarize-llm-logs`
- kept strict pure leaderboard behavior unchanged by default

Verification:

```text
deepseek-v4-pro pure micro diagnostic:
  model_actions=6
  recovered_reasoning_actions=1
  movement_oscillations=0

deepseek-v4-flash pure micro diagnostic:
  model_actions=6
  recovered_reasoning_actions=2
  movement_oscillations=0
```

Interpretation:

Reasoning recovery is diagnostic only. It shows that both DeepSeek models sometimes identify valid actions in reasoning but fail to emit them in the final answer. This separates planning capability from output-channel reliability without inflating the strict pure leaderboard.

## Loop 13: Preferred Action Hints

Finding:

Even after repeat-avoidance hints, LLMs still had to choose among safe actions, avoided actions, and adjacent cell descriptions. This added prompt load and sometimes caused empty final answers after several valid actions.

Optimization:

- added `action_hints.preferred`
- filtered immediate backtracking out of `preferred`
- updated the LLM prompt to output the first preferred action exactly when available
- documented `preferred` in the agent authoring guide and state schema

Verification:

```text
deepseek-v4-pro strict pure micro:
  model_actions=4
  model_error_actions=1
  movement_oscillations=0
  model_contribution_rate=0.80

deepseek-v4-flash strict pure micro:
  model_actions=6
  model_error_actions=1
  movement_oscillations=0
  model_contribution_rate=0.857

npm test: 20 pass / 0 fail
npm run demo:verify: pass
```

Interpretation:

Preferred hints make the public protocol more executable for LLM agents while preserving uncertainty. Flash reached the configured six model turns in strict pure mode without reasoning recovery or fallback, which is a clearer pure-model diagnostic signal.

## Loop 14: Move-First Preferred Ordering

Finding:

The first preferred hint still mixed movement through already-known safe cells with probes into unknown cells. In the strict pure trace, Flash spent extra model turns probing around the start instead of advancing along the trace once a safe adjacent cell was visible.

Optimization:

- sorted preferred hints by action type: `extract`, then `move`, then `probe`, then scans/rule actions, then `wait`
- kept `safe_recommended` unsorted as the full local action set
- added a test confirming known safe movement is ranked before probing

Verification:

```text
deepseek-v4-flash strict pure micro:
  model_actions=8
  model_error_actions=1
  movement_oscillations=0
  model_contribution_rate=0.889

deepseek-v4-pro strict pure micro:
  model_actions=1
  model_error_actions=1
  movement_oscillations=0

npm test: 21 pass / 0 fail
npm run demo:verify: pass
```

Interpretation:

Move-first ordering improved Flash's strict pure continuity and kept the agent moving away from the start. Pro remained dominated by empty final-output instability in this run, which supports keeping reasoning recovery as a diagnostic rather than a leaderboard setting.

## Loop 15: Movement Progress Metrics

Finding:

After move-first ordering, `movement_oscillations=0` was no longer enough to explain model behavior. A model can avoid immediate backtracking while still failing to make meaningful route progress toward the exit.

Optimization:

- added `unique_positions` to single-run analysis
- added `final_distance_to_exit`, `min_distance_to_exit`, and `distance_to_exit_delta`
- added `quality.exploration_rate`
- added a `no_exit_progress` quality flag for non-successful runs that do not reduce exit distance
- added `Unique` and `MinExit` columns to the LLM log summary table

Verification:

```text
deepseek-v4-flash strict pure micro:
  model_actions=8
  model_error_actions=1
  movement_oscillations=0
  unique_positions=3
  final_distance_to_exit=12
  min_distance_to_exit=12
  distance_to_exit_delta=2
  exploration_rate=0.333

summary table:
  deepseek-v4-flash Unique=3 MinExit=12
  deepseek-v4-pro   Unique=1 MinExit=14

node --test test/cli.test.js: 12 pass / 0 fail
npm test: 21 pass / 0 fail
npm run demo:verify: pass
```

Interpretation:

The analyzer can now distinguish "the model did not oscillate" from "the model actually explored and reduced distance to the exit." This gives the next optimization loop a better signal for route progress without changing game mechanics or exposing hidden information.

## Loop 16: Explicit Next Action Hint

Finding:

The move-first strict pure trace showed that `deepseek-v4-flash` did not always follow the first item in `action_hints.preferred`. It treated the array like a candidate set and spent extra turns on probes even when a known safe movement action was ranked first.

Optimization:

- added `action_hints.next_action` as a scalar alias for the first preferred public action
- updated the LLM bridge prompt to prioritize `next_action`
- updated the state schema and agent authoring guide
- added tests that `next_action` matches the first preferred hint

Verification:

```text
node --test test/engine.test.js test/schema.test.js: 9 pass / 0 fail
inspect --seed 9001 --mode micro --json: action_hints.next_action="probe 0 1"

deepseek-v4-flash strict pure micro:
  model_actions=8
  model_error_actions=1
  unique_positions=4
  min_distance_to_exit=11
  distance_to_exit_delta=3
  exploration_rate=0.444

deepseek-v4-pro strict pure micro:
  model_actions=1
  model_error_actions=1
  unique_positions=1
  min_distance_to_exit=14

npm test: 21 pass / 0 fail
npm run demo:verify: pass
Codex isolated verification: pass
```

Interpretation:

This does not add new hidden knowledge. It makes the existing preferred ordering easier for LLM agents to execute by exposing the intended first action as a single field instead of relying on array-order obedience. Flash made one additional forward move compared with Loop 15 (`unique_positions` 3 -> 4, `min_distance_to_exit` 12 -> 11). Pro remained blocked by empty final output behavior.

## Loop 17: Goal-Progress Preferred Ordering

Finding:

With a larger Flash budget, the explicit `next_action` exposed a second ranking problem. Preferred actions still prioritized all known safe moves before probes, so at `[1,2]` the model was guided toward `move N`, which increased distance to the public exit and eventually brought it back toward the start.

Optimization:

- changed preferred-action sorting to rank actions that reduce public Manhattan distance to the exit before neutral or regressive actions
- kept action-type priority as a tie-breaker after public goal progress
- added a regression test for the `[1,2]` state where `move N` should not be the next action

Verification:

```text
npm test: 22 pass / 0 fail
npm run demo:verify: pass

deepseek-v4-flash strict pure, max_model_turns=16:
  first run: empty final output at turn 2
  retry: empty final output at turn 2

deepseek-v4-flash diagnostic recovery, max_model_turns=16:
  model_actions=16
  recovered_reasoning_actions=1
  unique_positions=7
  min_distance_to_exit=8
  distance_to_exit_delta=6
  movement_oscillations=0
```

Interpretation:

The strict pure leaderboard remains honest about empty final-output failures. The recovery diagnostic shows the protocol-level ranking improved: Flash followed the route past the prior local trap and reduced public exit distance from 14 to 8 instead of returning to the start area.

## Loop 18: Remove LLM Prompt Avoid-Action Conflict

Finding:

DeepSeek empty-final traces showed a contradiction in the LLM bridge summary. The engine state had `action_hints.next_action="move S"`, but the bridge inferred a separate `avoid_actions=["move S"]` from the latest probe observation. This was not true repeat avoidance; it confused a probed cell with a previous agent position and caused the model to spend tokens resolving conflicting instructions.

Optimization:

- removed private `avoid_actions` and `previous_position` inference from the LLM bridge summary
- updated the prompt to reference only the engine-provided `action_hints.avoid_repeating`
- exported `buildStateSummary` behind a CommonJS module guard for regression testing
- added a test proving that a probe observation does not invent a conflicting avoid action

Verification:

```text
node --test test/cli.test.js: 13 pass / 0 fail
module import check: buildStateSummary exported without running the agent

deepseek-v4-flash strict pure, max_model_turns=16:
  model_actions=16
  model_error_actions=1
  unique_positions=8
  min_distance_to_exit=7
  distance_to_exit_delta=7
  movement_oscillations=0

deepseek-v4-pro strict pure, max_model_turns=16:
  model_actions=16
  model_error_actions=1
  unique_positions=8
  min_distance_to_exit=7
  distance_to_exit_delta=7
  movement_oscillations=0

npm test: 23 pass / 0 fail
```

Interpretation:

This keeps repeat-avoidance authoritative in the engine state and removes a self-inflicted final-output reliability problem for DeepSeek. Both strict pure models now run to the configured model-turn budget with valid final actions instead of failing at turn 2 with empty final content.

## Loop 19: Trace-Aware Hint Goal

Finding:

After output reliability improved, strict pure models followed public hints but treated route progress as exit progress. On micro seed `9001`, the nearest artifact is guided by the public `trace` signal before the exit matters. Ranking hints only by exit distance made the model move down/right without exposing why the preferred action was still searching for an artifact.

Optimization:

- changed preferred-action ranking to use the current public trace direction while artifacts remain
- kept exit-distance ranking after the artifact requirement is satisfied
- added `action_hints.goal` with `source`, `coord`, and `reason` so agents can see whether the current hint target comes from `trace` or `exit`
- updated state schema, README, and agent authoring docs
- added tests for trace-goal ranking before artifact completion and exit-goal ranking after completion

Verification:

```text
npm test: 24 pass / 0 fail
npm run demo:verify: pass

deepseek-v4-flash strict pure, max_model_turns=16:
  model_actions=16
  model_error_actions=1
  unique_positions=7
  min_distance_to_exit=8
  movement_oscillations=0

deepseek-v4-pro strict pure, max_model_turns=16:
  model_actions=1
  model_error_actions=1
  early empty final output

deepseek-v4-flash strict pure, max_model_turns=32:
  model_actions=32
  unique_positions=12
  visible_cells=19
  artifacts=0/1
```

Interpretation:

The public hint now explains the intended target source and follows artifact trace before exit routing. The 32-turn Flash run shows the next bottleneck: once heat becomes `low` or `high`, the model needs a stronger local artifact-search affordance or metric. It explored more cells but still did not reveal/extract the artifact within the model budget.

## Loop 20: Heat-Aware Artifact Search Goal

Finding:

The 32-turn Flash trace reached low/high heat cells but did not prioritize the unknown cells most likely to reveal the artifact. The previous `goal.source=trace` kept following directional trace even after public heat made the local artifact-search area clear.

Optimization:

- added `goal.source="heat"` when public high heat is visible and artifacts remain
- set `goal.heat_coord` to the public high-heat cell
- set `goal.coord` by following the high-heat cell's public trace direction
- updated the state schema, README, and agent authoring guide for `heat|trace|exit`
- added a regression test where seed `9001` must prefer `probe 0 5` around a high-heat cell instead of drifting back to trace-only routing

Verification:

```text
npm test: 25 pass / 0 fail
npm run demo:verify: pass
Codex isolated verification: pass

deepseek-v4-flash strict pure, max_model_turns=32:
  artifacts=1/1
  score=299
  model_actions=32
  unique_positions=13
  movement_oscillations=0

deepseek-v4-pro strict pure, max_model_turns=32:
  artifacts=1/1
  score=299
  model_actions=32
  movement_oscillations=0

deepseek-v4-flash strict pure, max_model_turns=64:
  status=success
  score=604
  turns=58
  artifacts=1/1
  invalid_actions=0
  fallback_actions=0
```

Interpretation:

Heat-aware goals turned the micro DeepSeek run from "explores but never extracts" into "finds and extracts the artifact." With enough strict pure model budget, Flash now completes the micro task end-to-end without fallback. Pro also reaches artifact extraction but remains vulnerable to empty final output after the artifact is collected.

## Loop 21: MVP Strict Pure Smoke

Finding:

After heat-aware goals made the micro task solvable, the next question was whether the same public protocol scales to the full MVP objective on seed `9001`.

Verification:

```text
deepseek-v4-flash strict pure MVP, max_model_turns=96:
  status=success
  score=866
  turns=68
  artifacts=3/3
  invalid_actions=0
  fallback_actions=0
  model_actions=68

deepseek-v4-pro strict pure MVP, max_model_turns=96:
  status=failure
  score=471
  artifacts=2/3
  model_actions=26
  model_error_actions=1
  reason=empty_model_action

deepseek-v4-pro MVP recovery diagnostic, max_model_turns=96:
  status=success
  score=844
  turns=71
  artifacts=3/3
  recovered_reasoning_actions=3
  fallback_actions=0
```

Interpretation:

Flash now completes the full MVP seed as a strict pure model with no fallback. Pro can also solve the task, but only when reasoning recovery is enabled, confirming that its remaining blocker is final-channel action emission rather than EchoGrid navigation or artifact-search affordances.

## Loop 22: Exit Frontier Routing And Soft Loop Avoidance

Finding:

The first full-MVP public seed set exposed a different failure mode after all artifacts were collected. DeepSeek Flash with reasoning-action recovery collected `3/3` artifacts on seeds `1024` and `7331`, but exhausted the 96-turn model budget while orbiting known public cells instead of opening a route to the exit. Inspecting the JSONL showed the model was mostly following `action_hints.next_action`; the hint itself was producing route loops, so this was an engine affordance problem rather than a model-only failure.

Optimization:

- changed repeat avoidance from a hard preferred-action filter into a soft ranking penalty
- added public-map exit frontier routing that searches known safe cells and probes the frontier closest to the public exit
- kept direct known exit paths available even when the first move was recently visited
- ensured `extract` outranks route hints when the agent is already on the exit
- prevented artifact extraction after the required artifact count has already been reached
- added regression tests that execute the hint policy from the previous `1024` and `7331` loop states and require it to complete without repeating a public-state signature

Verification:

```text
npm test: 27 pass / 0 fail
npm run demo:verify: pass

Before this fix, Flash public3 recovery:
  seeds=3
  successes=1
  success_rate=0.333
  failures=1024,7331

After exit-frontier routing only:
  seeds=3
  successes=2
  success_rate=0.667
  1024: success, score=882, turns=37
  7331: success, score=856, turns=87
  48129: failed at 2/3 artifacts due to a trace/heat loop
```

Interpretation:

The exit-stage loop was fixed without exposing hidden map data. The remaining failure moved back to artifact search, which was a better-localized and earlier-stage issue.

## Loop 23: Artifact-Stage Soft Repeat Ranking

Finding:

After exit-frontier routing, seed `48129` failed at `2/3` artifacts. The public `trace` and `heat` cues pointed across a partially blocked pocket. The previous ranking compared goal progress before recent-route repetition, so `move N` / `move S` oscillation outranked a useful public probe such as `probe 5 4`.

Optimization:

- moved the soft repeat penalty ahead of goal-distance progress for ordinary hints
- kept `extract` and explicit route hints as stronger priorities
- verified with a local hint-policy simulation that the previously stuck `48129` state now probes the side branch, reveals the final artifact, then reaches the exit

Verification:

```text
npm test: 27 pass / 0 fail
npm run demo:verify: pass

deepseek-v4-flash public3 recovery, max_model_turns=96:
  seeds=3
  successes=3
  success_rate=1.000
  1024:  success, score=882, turns=37, artifacts=3/3, invalid=0
  48129: success, score=870, turns=63, artifacts=3/3, invalid=0
  7331:  success, score=856, turns=87, artifacts=3/3, invalid=0
  fallback_actions=0 for all runs

deepseek-v4-flash public3 strict pure, max_model_turns=96:
  seeds=3
  successes=2
  success_rate=0.667
  1024:  success, score=882, turns=37
  48129: success, score=870, turns=63
  7331:  failure, empty_model_action after 3/3 artifacts

deepseek-v4-pro public3 recovery:
  1024:  success, score=882, turns=37
  48129: success, score=870, turns=63
  7331:  success on isolated rerun, score=835, turns=91
```

Codex isolated verification was also rerun without this thread context. It passed `npm test` and `npm run demo:verify`, and identified the next non-engine priorities: a protocol reference, tighter observation/event schemas, a judge-friendly demo output, and competition rules documentation.

Interpretation:

The public-state hint system is now strong enough for both DeepSeek models to complete the three-seed MVP public set when reasoning-action recovery is enabled and no baseline fallback is used. Strict pure Flash still exposes provider final-output reliability as a leaderboard-relevant failure mode, so recovery should stay diagnostic unless the leaderboard explicitly permits it.

## Loop 24: Empty-Final Strict Pure Retry

Finding:

After route and artifact hints were fixed, `deepseek-v4-flash` still had a strict pure failure on seed `7331` from an empty final `message.content`. The reasoning preview contained the right context, but no parseable final action. A first retry implementation helped locally but still used a short token budget, and DeepSeek again ended with `finish_reason=length`.

Optimization:

- added `ECHOGRID_LLM_RETRY_EMPTY_ACTION`, defaulting to one retry
- retried only empty or unparsable final actions
- kept fallback disabled in pure mode; retry is another call to the same model, not a baseline action
- made the retry prompt short and explicit: copy the first recommended action exactly
- recorded `model_retry_attempts` in `agent_diagnostic`
- added a local OpenAI-compatible fake-server test where the first response is empty and the retry returns a valid action

Verification:

```text
npm test: 28 pass / 0 fail
npm run demo:verify: pass

deepseek-v4-flash seed 7331 strict pure after retry prompt:
  status=success
  score=856
  turns=87
  artifacts=3/3
  fallback_actions=0
  recovered_reasoning_actions=0

deepseek-v4-flash public3 strict pure after retry prompt:
  seeds=3
  successes=3
  success_rate=1.000
  average_score=869.3
  average_turns=62.3
  model_error_actions=0
```

Interpretation:

This closes the last observed Flash public3 strict pure gap without weakening leaderboard separation. A retry-assisted pure run is still fully model-driven, but diagnostics preserve whether any action needed a second final-answer attempt.

## Current Verification Snapshot

Latest local verification:

```text
npm test: 28 pass / 0 fail
npm run demo:verify: pass
```

Previous pushed commit before the persistent-agent iteration:

```text
73015dd Summarize test optimization cycles
```

## Current Assessment

EchoGrid is now more mature as an agent-first testbed:

- external LLMs can be connected through an OpenAI-compatible bridge
- model failures are auditable rather than hidden by final score alone
- Codex independently verified the competition path
- reports and analyzers expose whether a run was model-driven or fallback-driven
- the state protocol is more agent-friendly without revealing hidden answers

## Next Recommended Iterations

1. Add a small HTML replay viewer for judges.
2. Add stronger rule-discovery seeds where model planning matters more than baseline routing.
3. Add persistent-mode support to the LLM bridge when provider latency makes process reuse useful.
4. Add reasoned action output for optional model explanations.
5. Add stricter schema validation with a bundled validator if dependencies become acceptable.
