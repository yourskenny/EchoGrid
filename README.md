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

## Useful Commands

```bash
npm run demo
npm run compare
npm run showcase

node ./bin/echogrid.js inspect --seed 48129
node ./bin/echogrid.js run --seed 48129 --pretty
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
node ./bin/echogrid.js replay ./logs/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
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

## MVP Features

- 8x8 deterministic maps from fixed seeds.
- Terrain: unknown, safe, hazard, wall, artifact, exit.
- Resources: `energy`, `integrity`, `turn_limit`.
- Observations: adjacent hazard count, heat, echo, trace, noise, sector.
- Hidden rule pool: artifact suppression, wall echo inversion, exit radius safety, sector-C unstable cells, row count disclosure.
- Scoring: mission completion, artifact yield, map certainty, rule claim, unused resources, damage, false marks, invalid actions, wasted actions.
- JSONL logs plus replay and standard battle reports.

## Demo Agents

- `agents/random.js`: weak deterministic random policy; included to prove the game is not solved by arbitrary movement.
- `agents/baseline.js`: conservative explorer that uses visible terrain, trace, and path planning.
- `agents/rule-aware.js`: showcase agent that actively checks a hidden-rule signal before delegating to baseline.

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

For a guided explanation, see [docs/competition-demo.md](./docs/competition-demo.md).
For scoring details, see [docs/scoring.md](./docs/scoring.md).
For representative report output, see [docs/sample-report.md](./docs/sample-report.md).

## Project Direction

Short term, EchoGrid is a mature minigame competition demo. Long term, it should become an agent-native inference game platform: lightweight enough for fast local evaluation, strict enough for benchmark use, and readable enough for human review through reports and replay viewers.
