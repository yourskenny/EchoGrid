# Protocol Reference

This is the stable public contract for writing EchoGrid agents.

## Turn Contract

EchoGrid sends one `STATE` JSON object to the agent. The agent must print exactly one action line. The first non-empty stdout line is used; extra commentary is ignored by the runner only if it appears after the first action line.

Coordinates are zero-based `[x, y]`. `(0, 0)` is the northwest corner. Directions are `N`, `S`, `E`, and `W`.

The hidden answer is not present during evaluation. `inspect` output is a debugging path and may include hidden answer data; it must not be used as agent input during scored runs.

## Action Reference

| Action | Syntax | Turn/energy cost | Valid when | Outcome type | Notes |
|---|---|---:|---|---|---|
| Move | `move N\|S\|E\|W` | 1 | Target is in bounds and not a wall | `move` | Moving into a hazard is valid but reduces integrity and records damage. Moving reveals the target cell. |
| Probe | `probe x y` | 2 | Target coordinate is in bounds | `probe` | Reveals one cell and returns a cell observation. Probing an already visible cell is valid but counted as wasted. |
| Scan row | `scan row r` | 4 | `r` is an in-bounds row index | `scan` | Returns aggregate counts for that row. |
| Scan column | `scan col c` | 4 | `c` is an in-bounds column index | `scan` | Returns aggregate counts for that column. |
| Scan sector | `scan sector A\|B\|C\|D` | 4 | Sector id exists | `scan` | Returns aggregate counts for a quadrant sector. |
| Mark | `mark x y hazard\|safe\|artifact\|entity` | 0 | Coordinate is in bounds | `mark` | Marks are scored later. Incorrect marks create `false_mark_penalty`. |
| Extract | `extract` | 1 | Current cell is an uncollected artifact, or current cell is exit after required artifacts are collected | `extract_artifact` or `extract_exit` | The same command collects artifacts and completes the mission at the exit. |
| Wait | `wait` | 1 | Always valid | `wait` | Re-observes the current cell. Usually low value. |
| Claim rule | `claim_rule rule_id` or `claim_rule rule_id because rationale` | 1 | `rule_id` exists in `rules.catalog` | `claim_rule` | Only the first claim can score. A second claim is wasted. A wrong first claim is counted as invalid. Optional rationale is logged for audit only and does not affect scoring. |

Malformed actions, out-of-bounds targets, moving into walls, extracting in the wrong place, extracting at the exit before enough artifacts, and unknown rule ids are invalid. Invalid actions consume one turn and add an invalid-action penalty.

## State Fields

Use these fields first:

- `turn.current`, `turn.limit`, `turn.terminal`
- `resources.energy`, `resources.integrity`
- `objective.artifacts_required`, `objective.artifacts_collected`, `objective.exit`
- `agent.position`
- `agent.current_cell`
- `agent.adjacent`
- `map.rows`
- `map.cells`
- `observations.recent`
- `rules.catalog`, `rules.claim`
- `action_hints`
- `score`, `score_breakdown`, `metrics`

`map.rows` is a compact projection for humans and simple agents. `map.cells` is the structured source of visible cells and marks.

## Terrain And Rows

| Symbol | Terrain / state |
|---|---|
| `?` | unknown |
| `.` | known safe empty cell |
| `#` | wall |
| `!` | hazard |
| `A` | artifact |
| `E` | exit |
| `@` | agent |
| `h` | marked hazard |
| `s` | marked safe |
| `a` | marked artifact |
| `e` | marked entity |

Visible terrain values are `unknown`, `empty`, `wall`, `hazard`, `artifact`, and `exit`.

## Cell Observations

Cell observations appear on visible cells and in recent observations:

| Field | Values | Meaning |
|---|---|---|
| `terrain` | `empty`, `wall`, `hazard`, `artifact`, `exit` | Revealed terrain for that coordinate. |
| `mine_signal` | integer or `null` | Adjacent hazard count for non-wall/non-hazard cells. |
| `heat` | `none`, `low`, `high` | Public proximity signal to remaining uncollected artifacts. `high` means very near; `low` means nearby. |
| `echo` | `stable`, `unstable` | Public signal affected by hazards and some hidden rules. |
| `trace` | `north-biased`, `south-biased`, `east-biased`, `west-biased`, `local` | Directional signal toward a remaining artifact. `local` means the signal points at the current area. |
| `noise` | number | Observation noise indicator. Higher values mean the signal context is less clean. |
| `sector` | `A`, `B`, `C`, `D` | Public sector id for the coordinate. |

Signals are public and legal to use, but they are not equivalent to the hidden answer. Hidden rules may affect how signals should be interpreted.

## Scan Observations

Scan outcomes return:

- `kind`: `row`, `col`, or `sector`
- `value`: row index, column index, or sector id
- `hazard_count`
- `wall_count`
- `artifact_heat`: `none`, `low`, or `high`
- `echo_unstable_count`

Some hidden rules add public rule evidence:

- `rule_signal`
- `disclosed_hazard_count`
- `confidence`

## Rule-Claim Rationale

Agents may attach a short audited rationale to a hidden-rule claim:

```text
claim_rule sector_c_two_unstable because sector C scan showed exactly two unstable echoes
```

The rationale is stored in `rules.claim.rationale`, the `rule_claim` observation, reports, replay milestones, and judge briefs. It is agent-authored audit text only; EchoGrid does not treat it as evidence, does not reveal hidden answers through it, and does not change score based on its wording.

## Action Hints

`action_hints` are public helper fields. They do not reveal hidden terrain.

- `goal.source`: `heat`, `trace`, or `exit`
- `goal.coord`: public target used to rank hints
- `goal.reason`: why the target was selected
- `next_action`: first recommended public action
- `preferred`: ranked public actions
- `safe_recommended`: locally valid or useful actions from current public state
- `avoid_repeating`: moves that revisit recent route positions

Agents may ignore hints, but a simple robust policy can start with `next_action`, then fall back to `preferred`, then to `safe_recommended`.

## Event Logs

JSONL logs contain:

- `start`: initial state
- `action`: command, outcome, score, terminal state, and next state
- `abort`: runner-side abort such as timeout or model budget exhaustion

For LLM agents, `agent_diagnostic` may include model name, fallback mode, final-output errors, and recovery metadata. These diagnostics are audit data, not game state.

## Score Components

See [scoring.md](./scoring.md) for the full score interpretation. Current components are:

- mission completion
- artifacts collected
- visible map certainty and correct marks
- correct hidden-rule claim
- unused energy
- remaining integrity
- damage, false marks, invalid actions, and wasted actions

## Compatibility Notes

The published schemas in `schemas/` define the machine-readable surface. Some nested event and observation objects remain intentionally extensible in this MVP, so robust agents should ignore unknown fields.
