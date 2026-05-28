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
8. Generates a tournament-style leaderboard at `logs/showcase/leaderboard.md`.
9. Generates a one-page judge brief at `logs/showcase/JUDGE_BRIEF.md`.
10. Generates a capability scorecard at `logs/showcase/SCORECARD.md`.
11. Generates a mission-control dashboard at `logs/showcase/mission-control.html`.
12. Generates a single-entry demo index with a first-screen competition verdict at `logs/showcase/index.html`.
13. Generates an artifact hash manifest at `logs/showcase/MANIFEST.json`.

For browser-level verification of the generated HTML pages:

```bash
npm run demo:visual
```

This renders the index, Mission Control, replay, and arena pages through headless Chrome/Edge at desktop and mobile viewport sizes. It writes screenshots and `visual-smoke.json` under `logs/showcase/screenshots`.

For faster local verification during judging or development:

```bash
npm run demo:verify
```

This runs tests, the rule-aware showcase, and the three-agent showcase comparison without printing the full replay timeline or generating the viewer.

For CI-style verification of the full judge package:

```bash
npm run submission:check
```

This runs the full demo, checks the generated judge package, renders the browser visual smoke screenshots, runs the public, adversarial, and rule-signals benchmarks, and creates `dist/submission/echogrid-submission` plus `dist/submission/echogrid-submission.zip`. GitHub Actions uses the same command and uploads both the generated `logs` directory and the submission bundle as evaluation artifacts.

If the logs already exist and only the final handoff package needs to be rebuilt:

```bash
npm run submission:bundle
```

The bundle includes `START_HERE.html`, the showcase package, visual smoke screenshots when available, public benchmark, adversarial benchmark, rule-signals benchmark, source docs, agent-authoring guide, JSON schemas, `SUBMISSION_ONE_PAGER.md`, `SUBMISSION_CHECKLIST.md`, `SUBMISSION_AUDIT.md`, `SUBMISSION_REPRODUCE.md`, `SUBMISSION_STRATEGY_AUDIT.md`, and `SUBMISSION_MANIFEST.json` with sha256 hashes for every copied file.

To verify the handoff package without rebuilding it:

```bash
npm run submission:verify
```

This checks required files, source commit freshness, bundle-level hashes, visual smoke screenshots, benchmark outcomes, local links in the browser entry pages, and the zip central directory against the generated bundle directory.

## What To Look For

EchoGrid is designed around agent behavior, not a visual board. The important artifacts are:

- `STATE` JSON: structured partial information for the agent.
- Action lines: deterministic, parseable commands.
- JSONL logs: complete audit trail.
- Replay: turn-by-turn reconstruction.
- HTML replay viewer: browser-based board, controls, score curve, key events, and action timeline for judges.
- HTML comparison arena: side-by-side agent aggregate and per-seed score matrix.
- Leaderboard: ranked Markdown output for tournament-style judging.
- Public benchmark: broader public pressure set that records full reference-policy completion and average-score separation.
- Mission-control dashboard: first-glance presentation page with a competition verdict strip, guided judge briefing, final public map, scrub/play route playback, clickable milestones, score construction, strategy edge, agent tournament, and evidence links.
- Visual smoke screenshots: browser-rendered desktop and mobile PNGs for the index, Mission Control, replay, and arena pages.
- Judge brief: generated one-page handoff with result snapshot, key events, score breakdown, audit notes, and comparison output.
- Demo index: generated HTML entry point with a first-screen competition verdict, artifact links, runbook, milestones, leaderboard snapshot, and audit gates.
- Manifest: generated JSON inventory with commit id, command names, showcase result, artifact sizes, and sha256 hashes.
- Scorecard: generated capability gates for mission completion, artifact routing, rule inference, resource discipline, score bar, and agent separation.
- Submission bundle: generated final handoff directory and zip that gathers the showcase, public benchmarks, docs, checklist, and bundle-level sha256 manifest.
- Strategy audit: generated per-seed benchmark deltas and rule-claim evidence for explaining why the rule-aware policy is stronger than baseline.
- Report: summary of outcome, scoring, risks, and transferable lesson.
- Compare table: demonstrates that strategy quality changes results.
- Agent-authoring guide and schemas: bundled under `source/docs/agent-authoring.md` and `source/schemas/` so judges can inspect the exact state/event/summary contract without browsing the repository.

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
npm run demo:scorecard
npm run demo:dashboard
npm run demo:index
npm run demo:manifest
```

After `npm run demo:full`, open `logs/showcase/index.html` first for the demo package entry point. Then open `logs/showcase/mission-control.html` for the guided judge briefing, presentation dashboard, and quick route playback, `logs/showcase/SCORECARD.md` for the capability gates, `logs/showcase/JUDGE_BRIEF.md` for the short judging script and result snapshot, `logs/showcase/leaderboard.md` for ranked results, `logs/showcase/arena.html` for the side-by-side agent comparison, and `logs/showcase/replay.html` for the single-run replay. The HTML viewers are single files with no server or external assets. The replay viewer shows the public board state, current action, outcome, score curve, key events, and clickable turn timeline. Use `logs/showcase/MANIFEST.json` to verify the generated files by size and sha256 hash.

## Expected Story

The random agent fails because arbitrary probing and movement waste resources.

The baseline agent succeeds because it follows the same public `action_hints.next_action` protocol exposed to external agents, with a conservative visible-terrain fallback.

The rule-aware agent scores higher because it performs bounded public experiments for sector and row hidden-rule signals, claims only when a `rule_signal` is present, then completes the mission through the shared baseline policy.

## Competition Pitch

EchoGrid is an agent-first CLI-native inference and planning game. Unlike human-first games adapted for AI, EchoGrid is designed around structured state, discrete actions, deterministic seeds, hidden rules, JSONL logs, replay, and batch evaluation. Agents must explore a hidden grid, manage limited resources, infer world rules from observations, collect artifacts, and reach the exit. The project demonstrates how minigames can become lightweight, auditable testbeds for reasoning agents.
