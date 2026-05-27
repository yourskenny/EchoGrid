# EchoGrid

EchoGrid is an agent-first CLI-native inference and planning game demo. It starts from the provided design document and implements the v0.1 MVP: deterministic hidden grids, structured state output, discrete actions, resource limits, JSONL logs, replay, batch evaluation, and a baseline agent.

## Run

```bash
npm test
npm run demo
node ./bin/echogrid.js inspect --seed 48129
node ./bin/echogrid.js run --seed 48129 --pretty
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
node ./bin/echogrid.js replay ./logs/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
```

## Agent Protocol

Each turn prints one `STATE {json}` object. Agents should emit exactly one action line:

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

Coordinates are zero-based. `(0,0)` is the northwest corner.

For batch evaluation, EchoGrid runs the agent once per turn and sends the full `STATE` JSON on stdin. The first non-empty stdout line is used as the action.

## MVP Features

- 8x8 deterministic maps from fixed seeds.
- Terrain: unknown, safe, hazard, wall, artifact, exit.
- Resources: `energy`, `integrity`, `turn_limit`.
- Observations: adjacent hazard count, heat, echo, trace, noise, sector.
- Hidden rule pool: artifact suppression, wall echo inversion, exit radius safety, sector-C unstable cells, row count disclosure.
- Scoring: mission completion, artifact yield, map certainty, rule claim, unused resources, damage, false marks, invalid actions, wasted actions.
- JSONL replay logs plus standard battle reports for audit and strategy transfer.

## Design Notes

The CLI intentionally favors machine-readable state over terminal art. Human-readable rows are included only as a compact projection of the structured cell list.
