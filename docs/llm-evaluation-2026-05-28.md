# LLM Evaluation Notes - 2026-05-28

This report records the first external-model test loop for EchoGrid. API keys are intentionally excluded from logs, docs, and committed files.

## Models Tested

- `deepseek-v4-pro`
- `deepseek-v4-flash`
- Codex CLI isolated review

DeepSeek was tested through the OpenAI-compatible chat completions interface with `agents/llm-openai-compatible.js`. Codex was tested in a separate `codex exec` session with a prompt that only referenced the repository, not this thread context.

## Test Seeds

- `9001` for showcase behavior.
- `48129` was also used in the first smoke pass.

## Findings

### 1. Raw LLM play exposed protocol friction

Initial DeepSeek runs on `9001` and `48129` failed with turn-limit outcomes. Both models repeatedly fell back to `wait` because the response body contained no final `message.content`.

Diagnosis showed:

- `deepseek-v4-pro` often spent the whole completion budget on `reasoning_content`.
- `deepseek-v4-flash` could output valid actions, but still produced many empty-final responses on full game states.
- When Flash did produce actions, it attempted illegal movement into known walls because the public state required too much local-action reconstruction from `map.rows` and `map.cells`.

Representative pre-optimization result for Flash on `9001`:

```text
status=failure
reason=turn_limit
score=-712
artifacts=0
invalid_actions=47
wait_actions=73
```

### 2. Adding explicit local affordances improved agent usability

The state protocol now exposes:

- `agent.current_cell`
- `agent.adjacent`
- `action_hints.safe_recommended`

This keeps the hidden map hidden while making local legal action choices obvious to agents.

After this change, Flash on `9001` improved:

```text
status=failure
reason=turn_limit
score=401
artifacts=2
invalid_actions=0
wait_actions=82
```

The result proves that the game became more agent-readable: invalid moves disappeared without exposing hidden answers.

### 3. Budgeted model control plus baseline fallback makes tests reliable

`agents/llm-openai-compatible.js` now supports:

- `ECHOGRID_LLM_MAX_MODEL_TURNS`
- `ECHOGRID_LLM_MAX_TOKENS`
- diagnostic logging for fallback reasons
- baseline fallback when a model returns no final action

Budgeted showcase result:

```text
deepseek-v4-flash:
  status=success
  score=860
  turns=85
  artifacts=3
  invalid_actions=0
  model_actions=7

deepseek-v4-pro:
  status=success
  score=860
  turns=85
  artifacts=3
  invalid_actions=0
  model_actions=2
```

This should be interpreted as a hybrid test: the external model contributes early actions, then baseline fallback guarantees the run remains evaluable. The fallback count is recorded, so model contribution remains auditable.

### 4. Codex isolated review

Codex was run in a separate non-interactive session without this thread context. It inspected repository docs and source. Runtime execution was blocked by its read-only policy, but the isolated assessment was:

- understandable: yes
- verifiable: mostly; documented commands and sample report exist
- agent-friendly: yes

It specifically confirmed README, package scripts, competition demo docs, sample report, `rule-aware` agent behavior, and test coverage.

Follow-up Codex isolation was run with local command execution enabled and still without this thread context. It executed:

```text
npm test
node ./bin/echogrid.js evaluate --agent ./agents/rule-aware.js --seed 9001 --json
node ./scripts/compare.js --seeds ./seeds/showcase.txt
```

Results:

```text
npm test: 8 passed, 0 failed
rule-aware showcase: success, score=977, turns=86, artifacts=3/3, rule_claim=sector_c_two_unstable
compare showcase:
  random success=0 score=138
  baseline success=1 score=862
  rule-aware success=1 score=977
```

Codex's isolated assessment after execution: understandable yes, verifiable yes, agent-friendly yes.

## Optimizations Implemented

1. Added OpenAI-compatible LLM agent:
   - `agents/llm-openai-compatible.js`

2. Added DeepSeek/OpenAI-compatible evaluation runner:
   - `scripts/run-llm-eval.js`

3. Added LLM smoke seeds:
   - `seeds/llm-smoke.txt`

4. Added protocol affordances:
   - `agent.current_cell`
   - `agent.adjacent`
   - `action_hints.safe_recommended`

5. Added agent diagnostics to JSONL action logs:
   - fallback reason
   - model name
   - finish reason
   - fallback policy

## Design Implications

The test loop validates the project direction: EchoGrid needs to be agent-first not only in principle, but in concrete protocol affordances. LLMs are poor at reconstructing legal local moves from compact board rows. A mature agent-native game should expose action-relevant structure directly while keeping hidden-world uncertainty intact.

Next improvements should focus on:

- stronger structured action schemas
- optional belief/reason fields
- faster persistent-agent evaluation
- explicit per-turn legal/recommended action lists
- separate "pure model" and "hybrid model+baseline" leaderboards

## Leaderboard Separation

The LLM runner now supports explicit leaderboard modes:

```bash
node ./scripts/run-llm-eval.js --leaderboard pure
node ./scripts/run-llm-eval.js --leaderboard hybrid
node ./scripts/run-llm-eval.js --leaderboard both
```

`pure` disables local obvious-action handling and baseline fallback. If the model cannot produce a valid action, the action is logged as a model error and the game receives an invalid `__model_unavailable__ ...` command. This makes pure-model scores honest.

`hybrid` keeps the baseline fallback and local obvious-action handling. It is still useful for integration and latency diagnostics, but should not be mixed with pure-model leaderboard results.

The summarizer now prints a `Board` column plus model error counts, so reports can distinguish model contribution from fallback rescue.

Short verification run:

```text
pure/deepseek-v4-flash: failure, score=212, turns=2, model_errors=1, abort=yes
pure/deepseek-v4-pro:   failure, score=212, turns=1, model_errors=1, abort=yes
hybrid/deepseek-v4-flash: success, score=606, model_actions=1, fallback=56
hybrid/deepseek-v4-pro:   success, score=606, model_actions=0, fallback=57
```

This confirms the split is working: pure mode honestly records model inability to produce valid actions and now aborts quickly, while hybrid mode remains useful for exercising the full game loop through fallback.

Follow-up pure-model probe with `max_tokens=512` showed that `deepseek-v4-pro` can produce several valid actions before an empty final response:

```text
model_actions=3
model_error_actions=1
movement_oscillations=0
model_contribution_rate=0.75
```

The public state now includes `action_hints.avoid_repeating`, and the LLM summary prompt includes `avoid_actions`. This reduced immediate backtracking without exposing hidden map information.

## Reasoning Recovery Diagnostic

DeepSeek sometimes returns an empty final `message.content` while `reasoning_content` contains a concrete action. The LLM runner now has an opt-in diagnostic mode:

```bash
node ./scripts/run-llm-eval.js --leaderboard pure --recover-reasoning-action
```

This mode extracts a valid EchoGrid action from `reasoning_content` only for diagnosis. It is not the default strict pure leaderboard behavior.

Short diagnostic run with `max_tokens=512` and `max_model_turns=6`:

```text
deepseek-v4-pro:   model_actions=6, recovered_reasoning_actions=1, movement_oscillations=0
deepseek-v4-flash: model_actions=6, recovered_reasoning_actions=2, movement_oscillations=0
```

Interpretation: both models sometimes know a valid action but fail to place it in the final answer field. The strict pure leaderboard still treats that as a model-output failure; the recovery mode is useful for separating reasoning capability from final-channel formatting reliability.

## Preferred Action Hints

The public state now includes `action_hints.preferred`, which applies local safety and repeat-avoidance filtering before presenting the model with first-choice actions. The LLM prompt tells the model to output the first preferred action exactly when present.

Strict pure follow-up without reasoning recovery:

```text
deepseek-v4-pro:
  model_actions=4
  model_error_actions=1
  movement_oscillations=0

deepseek-v4-flash:
  model_actions=6
  model_error_actions=1
  movement_oscillations=0
```

This keeps the strict leaderboard honest while reducing action-selection friction in the public protocol.

Preferred actions are now ordered by action type so known safe movement ranks before probing unknown cells after the local frontier is opened. In a strict pure follow-up, Flash reached eight model-controlled turns without oscillation:

```text
deepseek-v4-flash:
  model_actions=8
  model_error_actions=1
  movement_oscillations=0
  model_contribution_rate=0.889
```

The same run still showed Pro failing early with an empty final response, so model-output reliability remains model-dependent.

The analysis tools now report movement progress separately from oscillation. `analyze-run` includes `unique_positions`, `final_distance_to_exit`, `min_distance_to_exit`, `distance_to_exit_delta`, and `quality.exploration_rate`; `summarize-llm-logs` includes `Unique` and `MinExit` columns. On the same move-first strict pure run:

```text
deepseek-v4-flash:
  unique_positions=3
  min_distance_to_exit=12
  distance_to_exit_delta=2

deepseek-v4-pro:
  unique_positions=1
  min_distance_to_exit=14
```

This separates "the model avoided backtracking" from "the model made measurable route progress." It is now easier to identify runs where prompt or state changes improve action validity but not navigation.

## Next Action Hint

Follow-up inspection of the move-first strict pure trace showed that a preferred-action array still leaves room for model choice. `deepseek-v4-flash` sometimes selected the second preferred action or continued probing even when the first action was the intended safe move.

The public state now includes `action_hints.next_action`, a scalar alias for `action_hints.preferred[0]`. The LLM bridge prompt now says to output `next_action` exactly when present. This keeps the uncertainty model unchanged but reduces protocol friction for LLM agents that are less reliable at respecting ordered arrays.

Strict pure follow-up:

```text
deepseek-v4-flash:
  model_actions=8
  model_error_actions=1
  unique_positions=4
  min_distance_to_exit=11
  distance_to_exit_delta=3

deepseek-v4-pro:
  model_actions=1
  model_error_actions=1
  unique_positions=1
  min_distance_to_exit=14
```

Compared with the move-first run, Flash followed the single-action hint more reliably and advanced one additional cell before the configured model-turn budget was exhausted. Pro still failed on empty final output, so its bottleneck remains provider response formatting rather than state affordance.

## Follow-Up Change

A `micro` mode was added after the first loop so LLM smoke tests can finish faster while still exercising the same public protocol. It uses a smaller objective and is meant for integration diagnostics, not the main competition score. Follow-up tests showed that micro outcomes are sensitive to early model detours, so the reliable competition signal remains the full MVP evaluation plus diagnostics such as invalid-action count, fallback count, and model-action count.

An LLM log summarizer was added:

```bash
node ./scripts/summarize-llm-logs.js ./logs/llm
```

It prints success status, score, turns, artifacts, invalid actions, waits, model actions, fallback actions, local policy actions, and top fallback reasons. This makes repeated model-test loops auditable without manually reading JSONL.

For a single run, use:

```bash
node ./scripts/analyze-run.js ./logs/llm/deepseek-v4-flash/9001.jsonl
```

This returns JSON quality flags such as `not_successful`, `high_wait_rate`, `fallback_dominant`, `low_model_contribution`, and `movement_oscillation`.

Example diagnostic row from a micro Flash run:

```text
model=deepseek-v4-flash
seed=9001
status=failure
score=192
artifacts=0/1
invalid=0
waits=0
model_actions=5
fallback_actions=65
top_reasons=baseline_after_model_budget:62, model:5, empty_model_action:3
```

Interpretation: the protocol avoided invalid and idle actions, but early model choices still left the fallback policy unable to complete the micro objective. This is useful benchmark information rather than an engine failure.

## Test Loop Maintenance

The compare smoke test was shortened to a single-agent table check, reducing `npm test` feedback from roughly 28 seconds to roughly 13 seconds on this machine. Full three-agent comparison remains covered by `npm run demo:verify`.

Battle reports now include LLM diagnostic counts when a log contains model diagnostics:

- model actions
- fallback actions
- local policy actions
- diagnostic reasons

This lets a single `report` output explain whether a run was mostly model-driven or fallback-driven.
