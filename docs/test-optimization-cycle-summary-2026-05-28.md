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

## Current Verification Snapshot

Latest local verification:

```text
npm test: 12 pass / 0 fail
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
