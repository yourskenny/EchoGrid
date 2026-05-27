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

For faster local verification during judging or development:

```bash
npm run demo:verify
```

This runs tests, the rule-aware showcase, and the three-agent showcase comparison without printing the full replay timeline.

## What To Look For

EchoGrid is designed around agent behavior, not a visual board. The important artifacts are:

- `STATE` JSON: structured partial information for the agent.
- Action lines: deterministic, parseable commands.
- JSONL logs: complete audit trail.
- Replay: turn-by-turn reconstruction.
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
```

## Expected Story

The random agent fails because arbitrary probing and movement waste resources.

The baseline agent succeeds because it maintains known terrain, probes frontiers, follows artifact traces, extracts artifacts, and routes to the exit.

The rule-aware agent scores higher in the showcase because it performs an early sector scan, claims the hidden rule when the signal is present, then completes the mission with baseline navigation.

## Competition Pitch

EchoGrid is an agent-first CLI-native inference and planning game. Unlike human-first games adapted for AI, EchoGrid is designed around structured state, discrete actions, deterministic seeds, hidden rules, JSONL logs, replay, and batch evaluation. Agents must explore a hidden grid, manage limited resources, infer world rules from observations, collect artifacts, and reach the exit. The project demonstrates how minigames can become lightweight, auditable testbeds for reasoning agents.
