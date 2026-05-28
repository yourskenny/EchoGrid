# Competition Demo

This document is the judge-facing path for the EchoGrid minigame demo.

## One Command

```bash
npm run demo:full
```

This command proves the demo end to end:

1. Runs the automated test suite.
2. Compares three agents on fixed demo seeds.
3. Runs the showcase agent on seed `9001`.
4. Generates a battle report.
5. Prints a replay timeline.
6. Generates a self-contained HTML replay viewer at `logs/showcase/replay.html`.
7. Generates a self-contained HTML comparison arena at `logs/showcase/arena.html`.
8. Generates a one-page judge brief at `logs/showcase/JUDGE_BRIEF.md`.

For faster local verification during judging or development:

```bash
npm run demo:verify
```

This runs tests, the rule-aware showcase, and the three-agent showcase comparison without printing the full replay timeline or generating the viewer.

For CI-style verification of the full judge package:

```bash
npm run demo:ci
```

This runs the full demo and then checks that the JSONL log, replay viewer, comparison arena, comparison JSON, and judge brief were generated and contain the expected showcase result.

## What To Look For

EchoGrid is designed around agent behavior, not a visual board. The important artifacts are:

- `STATE` JSON: structured partial information for the agent.
- Action lines: deterministic, parseable commands.
- JSONL logs: complete audit trail.
- Replay: turn-by-turn reconstruction.
- HTML replay viewer: browser-based board, controls, score curve, key events, and action timeline for judges.
- HTML comparison arena: side-by-side agent aggregate and per-seed score matrix.
- Judge brief: generated one-page handoff with result snapshot, key events, score breakdown, audit notes, and comparison output.
- Report: summary of outcome, scoring, risks, and transferable lesson.
- Compare table: demonstrates that strategy quality changes results.

Representative report output is stored in [sample-report.md](./sample-report.md).
The full action and observation contract is in [protocol-reference.md](./protocol-reference.md).
Judging boundaries and leaderboard modes are in [competition-rules.md](./competition-rules.md).

## Showcase Seed

The showcase seed is `9001`. It is chosen because the rule-aware agent can identify a structured hidden-rule signal and complete the mission.

Run it directly:

```bash
npm run showcase
node ./bin/echogrid.js report ./logs/showcase/9001.jsonl
node ./bin/echogrid.js replay ./logs/showcase/9001.jsonl
npm run replay:html -- ./logs/showcase/9001.jsonl --out ./logs/showcase/replay.html
npm run demo:brief
```

After `npm run demo:full`, open `logs/showcase/JUDGE_BRIEF.md` first for the short judging script and result snapshot. Then open `logs/showcase/arena.html` for the side-by-side agent comparison and `logs/showcase/replay.html` for the single-run replay. Both viewers are single HTML files with no server or external assets. The replay viewer shows the public board state, current action, outcome, score curve, key events, and clickable turn timeline.

## Expected Story

The random agent fails because arbitrary probing and movement waste resources.

The baseline agent succeeds because it follows the same public `action_hints.next_action` protocol exposed to external agents, with a conservative visible-terrain fallback.

The rule-aware agent scores higher because it performs an early sector scan, claims the hidden rule when the signal is present, then completes the mission through the shared baseline policy.

## Competition Pitch

EchoGrid is an agent-first CLI-native inference and planning game. Unlike human-first games adapted for AI, EchoGrid is designed around structured state, discrete actions, deterministic seeds, hidden rules, JSONL logs, replay, and batch evaluation. Agents must explore a hidden grid, manage limited resources, infer world rules from observations, collect artifacts, and reach the exit. The project demonstrates how minigames can become lightweight, auditable testbeds for reasoning agents.
