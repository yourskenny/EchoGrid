# Scoring

EchoGrid reports both a total score and an auditable `score_breakdown`.

## Positive Components

- `mission_value`: awarded when the agent extracts at the exit after collecting enough artifacts.
- `artifact_value`: reward for collected artifacts.
- `map_certainty_bonus`: reward for revealed cells and correct marks.
- `rule_discovery_bonus`: reward for a correct `claim_rule`.
- `unused_energy_bonus`: reward for efficient resource use.
- `integrity_bonus`: reward for avoiding damage.

## Penalties

- `damage_penalty`: hazard contact or other integrity loss.
- `false_mark_penalty`: marks that do not match the hidden terrain.
- `invalid_action_penalty`: malformed or illegal actions.
- `wasted_action_penalty`: repeated probes and other low-value actions.

## Capability Reading

The score is not only a win/loss result. It indicates agent behavior:

- High mission and artifact value: objective completion.
- High map certainty: systematic exploration and marking.
- High rule discovery: successful world-model inference.
- High unused energy: efficient planning.
- Low penalties: robust action validation and risk control.

`metrics` expose supporting audit fields such as visible cells, marks, false marks, damage events, invalid actions, and wasted actions.
