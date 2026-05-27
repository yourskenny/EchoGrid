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
