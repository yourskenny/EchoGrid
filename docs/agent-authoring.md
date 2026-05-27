# Agent Authoring

An EchoGrid agent is any executable that reads one JSON state from stdin and prints one action line to stdout.

## Minimal JavaScript Agent

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const state = JSON.parse(fs.readFileSync(0, 'utf8'));

const current = state.map.cells.find(
  (cell) =>
    cell.coord[0] === state.agent.position[0] &&
    cell.coord[1] === state.agent.position[1],
);

if (current?.terrain === 'artifact') {
  console.log('extract');
} else {
  console.log('wait');
}
```

## Evaluation

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seed 48129
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
```

By default, evaluation starts the agent once per turn. Agents that can stay alive across turns may opt into persistent mode:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline-persistent.js --seed 48129 --agent-mode persistent
```

In persistent mode, EchoGrid starts the agent once per seed, writes one compact state JSON line to stdin on each turn, and reads the first non-empty stdout line as that turn's action. This reduces process startup overhead while keeping the same action protocol.

Machine-readable protocol references live in:

- `schemas/state.schema.json`
- `schemas/event.schema.json`
- `schemas/summary.schema.json`

## State Fields

Important fields:

- `seed`: deterministic world seed.
- `turn`: current turn, limit, and terminal result.
- `resources`: `energy` and `integrity`.
- `objective`: artifact target and exit coordinate.
- `agent.position`: current coordinate.
- `map.rows`: compact known-map projection.
- `map.cells`: structured visible cells and marks.
- `observations.recent`: recent probe, scan, move, extract, and rule-claim events.
- `rules.catalog`: claimable hidden-rule ids.
- `action_hints.preferred`: first-choice actions after local safety and repeat filtering.
- `action_hints.safe_recommended`: locally safe or useful actions.
- `action_hints.avoid_repeating`: actions that immediately return to the previous cell.
- `score_breakdown`: auditable score components.
- `metrics`: invalid actions, damage, marks, visible cells.

The hidden answer is never included during evaluation. `inspect --seed` is only for debugging.

## Action Rules

Actions must match one documented command exactly:

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

Invalid actions consume a turn and reduce score.
