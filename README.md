# EchoGrid

EchoGrid is an agent-first CLI-native inference and planning game. It is not a human puzzle with an AI wrapper; the primary interface is a structured state protocol, deterministic seeds, discrete actions, auditable logs, replay, reports, and batch evaluation.

The game tests whether an agent can observe partial information, infer hidden world rules, manage limited resources, plan under uncertainty, collect artifacts, and extract through the exit.

## Why It Exists

Most minigames are designed for humans first and adapted for agents later. EchoGrid is designed for agents from the beginning:

- State is machine-readable JSON, with compact rows only as a projection.
- Actions are one-line commands that are easy to validate and replay.
- Every run is deterministic from a seed.
- Hidden rules make the task about world modeling, not only navigation.
- Logs, replay, reports, and comparison tables make behavior auditable.

## Quick Start

```bash
npm test
npm run demo:full
```

`npm run demo:full` runs the full competition demo:

1. test suite
2. random vs baseline vs rule-aware comparison
3. showcase seed evaluation
4. battle report
5. replay timeline
6. self-contained HTML replay viewer

It recreates `logs/showcase` for the showcase run.
Open `logs/showcase/replay.html` in a browser after `npm run demo:full` for the judge-friendly visual replay.

For a shorter verification path, run:

```bash
npm run demo:verify
```

## Useful Commands

```bash
npm run demo
npm run compare
npm run showcase

node ./bin/echogrid.js inspect --seed 48129
node ./bin/echogrid.js run --seed 48129 --pretty
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --summary-file ./logs/summary.json
node ./bin/echogrid.js replay ./logs/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
npm run replay:html -- ./logs/48129.jsonl --out ./logs/48129.replay.html
```

`inspect` is a local debugging command and may print hidden answer data. Do not use its output as evaluated agent input.

LLM-compatible smoke testing can be run with an OpenAI-compatible endpoint:

```bash
set ECHOGRID_LLM_API_KEY=...
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt --mode micro --leaderboard pure
node ./scripts/summarize-llm-logs.js ./logs/llm
node ./scripts/analyze-run.js ./logs/llm/pure/deepseek-v4-flash/9001.jsonl
```

The key is read only from the environment and should never be committed.
This command is an integration smoke test for model behavior and diagnostics; scores may vary by provider latency and model output quality.
By default, the LLM runner separates `pure` model runs from `hybrid` model-plus-baseline-fallback runs so leaderboard scores and integration diagnostics do not get mixed. Pass `--leaderboard pure` to run only the strict model path and reduce provider calls.
Use `--process-timeout` for longer public seed batches, for example `--process-timeout 1800000` for public10 strict pure runs.
The LLM bridge retries an empty final action once by default through `ECHOGRID_LLM_RETRY_EMPTY_ACTION=1`; set it to `0` to measure first-response-only strictness.
For DeepSeek V4 models, the bridge sends `thinking: { "type": "disabled" }` by default so short action prompts are not consumed by hidden reasoning tokens. Override with `ECHOGRID_LLM_THINKING_MODE`.

For targeted regression of the latest public oscillation fixes:

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/targeted-oscillation.txt --mode mvp --leaderboard pure --max-model-turns 96 --process-timeout 1800000
```

## Game Loop

Each run starts from a seed and an agent. On every turn, EchoGrid sends a `STATE` JSON object to the agent. The agent returns exactly one action line. EchoGrid validates the action, updates the hidden world, records an event, and eventually produces a score, JSONL log, replay, and report.

```text
seed -> STATE -> action -> EVENT -> STATE -> ... -> terminal result -> report
```

## Agent Protocol

Coordinates are zero-based. `(0,0)` is the northwest corner.

```text
move N|S|E|W
probe x y
scan row r
scan col c
scan sector A|B|C|D
mark x y hazard|safe|artifact|entity
extract
wait
claim_rule rule_id
```

For batch evaluation, EchoGrid runs the agent once per turn and sends the full `STATE` JSON on stdin. The first non-empty stdout line is used as the action.
Protocol schemas are published in `schemas/state.schema.json`, `schemas/event.schema.json`, and `schemas/summary.schema.json`.
For action costs, outcome types, observations, and event-log semantics, see [docs/protocol-reference.md](./docs/protocol-reference.md).

Agents that support line-by-line operation can use persistent mode:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline-persistent.js --seed 48129 --agent-mode persistent
```

Persistent mode starts the agent once per seed, sends one state JSON line per turn, and reads one action line per turn. The default one-shot mode remains the compatibility path for simple agents.

## MVP Features

- 8x8 deterministic maps from fixed seeds.
- Terrain: unknown, safe, hazard, wall, artifact, exit.
- Resources: `energy`, `integrity`, `turn_limit`.
- Observations: adjacent hazard count, heat, echo, trace, noise, sector.
- Public action hints: a public hint goal from heat/trace/exit, a single next action, preferred actions, safe recommended actions, and repeat-avoidance hints.
- Hidden rule pool: artifact suppression, wall echo inversion, exit radius safety, sector-C unstable cells, row count disclosure.
- Scoring: mission completion, artifact yield, map certainty, rule claim, unused resources, damage, false marks, invalid actions, wasted actions.
- JSONL logs plus replay and standard battle reports.

## Demo Agents

- `agents/random.js`: weak deterministic random policy; included to prove the game is not solved by arbitrary movement.
- `agents/baseline.js`: conservative reference agent that follows public `action_hints.next_action` and falls back to visible terrain search.
- `agents/baseline-persistent.js`: same baseline policy over the persistent line protocol.
- `agents/rule-aware.js`: showcase agent that actively checks a hidden-rule signal before delegating to baseline.
- `agents/llm-openai-compatible.js`: OpenAI-compatible LLM bridge for DeepSeek/OpenAI-style chat completion APIs.

Example comparison:

```text
ECHO GRID AGENT COMPARISON
Agent                   Success  Avg Score  Avg Turns
./agents/random.js      0        ...
./agents/baseline.js    1        ...
./agents/rule-aware.js  1        ...
```

## Competition Demo

The recommended judging path is:

```bash
npm run demo:full
```

The showcase seed is `9001`. It demonstrates the full loop: structured observations, rule-aware action, artifact collection, extraction, scoring, report, and replay.

For a guided explanation, including the HTML replay viewer path, see [docs/competition-demo.md](./docs/competition-demo.md).
For the full agent protocol, see [docs/protocol-reference.md](./docs/protocol-reference.md).
For judging boundaries and official evaluation modes, see [docs/competition-rules.md](./docs/competition-rules.md).
For scoring details, see [docs/scoring.md](./docs/scoring.md).
For representative report output, see [docs/sample-report.md](./docs/sample-report.md).
For the first LLM evaluation loop, see [docs/llm-evaluation-2026-05-28.md](./docs/llm-evaluation-2026-05-28.md).
For the repeated test/optimization cycle summary, see [docs/test-optimization-cycle-summary-2026-05-28.md](./docs/test-optimization-cycle-summary-2026-05-28.md).

## Project Direction

Short term, EchoGrid is a mature minigame competition demo. Long term, it should become an agent-native inference game platform: lightweight enough for fast local evaluation, strict enough for benchmark use, and readable enough for human review through reports and replay viewers.
