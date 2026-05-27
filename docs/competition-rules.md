# Competition Rules

This document defines the recommended judging contract for EchoGrid demo submissions.

## Official Environment

- Node.js `>=20`
- Install dependencies with `npm install` when needed.
- Run commands from the repository root.
- Agents communicate through stdin/stdout and must not require interactive input.

## Official Demo Command

```bash
npm run demo:full
```

This command is the judge-facing demo path. It runs tests, compares bundled agents, evaluates the showcase seed, prints a battle report, and prints a replay timeline.

For a shorter smoke check:

```bash
npm run demo:verify
```

## Official Agent Evaluation

One seed:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seed 48129 --log-dir ./logs
```

Seed file:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
```

Persistent agents may use:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline-persistent.js --seed 48129 --agent-mode persistent
```

The one-shot and persistent modes use the same action protocol. Persistent mode only changes process lifetime.

## Seed Groups

- `seeds/showcase.txt`: small judge-facing showcase set.
- `seeds/demo.txt`: bundled demo comparison set.
- `seeds/public.txt`: public benchmark seeds for local comparison.
- Private or hidden competition seeds should use the same protocol and scoring path.

Public seeds are for development and explanation. Final rankings should use held-out seeds when possible.

## Allowed Agent Inputs

Agents may use:

- the `STATE` JSON provided on stdin
- their own internal memory within a run
- source code and public docs before the run
- public seed ids if the competition explicitly provides them

Agents must output one valid action line per turn.

## Disallowed Inputs

Agents must not use:

- `inspect` output, including any hidden answer data it prints
- direct imports from `src/generator.js`, `src/engine.js`, or hidden world internals during an evaluated run
- JSONL logs from the same hidden/private evaluation before choosing actions
- filesystem reads that reveal hidden answer artifacts
- network calls unless the competition explicitly allows external models or tools

For local debugging, `inspect` is allowed only outside scored evaluation.

## Timeouts And Failures

The evaluator enforces per-turn agent timeouts. If the agent fails to produce a parseable action, the command is invalid or the runner may abort depending on the evaluation path.

Invalid game actions consume a turn and add an invalid-action penalty. Runner aborts such as process timeout, model budget exhaustion, or empty model final output should be reported separately from normal game failure.

## LLM Leaderboard Modes

`scripts/run-llm-eval.js` supports separate modes:

- `pure`: no baseline fallback and no local policy
- `hybrid`: model plus baseline fallback/local policy for integration diagnostics

Use `pure` for leaderboard-like model results:

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/public.txt --mode mvp --leaderboard pure --max-model-turns 96
```

Use recovery diagnostics only when explicitly reported:

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-flash --seeds ./seeds/public.txt --mode mvp --leaderboard pure --max-model-turns 96 --recover-reasoning-action
```

Recovery can prove that a model had a usable action in its reasoning stream, but it should not be mixed silently with strict pure results.

API keys must be supplied through environment variables such as `ECHOGRID_LLM_API_KEY`. Do not commit keys, logs with secrets, or provider credentials.

## Required Report Items

A judged submission should provide:

- command used
- agent path
- seed file or seed list
- success rate
- average score
- average turns
- per-seed status
- JSONL log directory
- any model diagnostics or fallback policy

Recommended supporting commands:

```bash
node ./scripts/summarize-llm-logs.js ./logs/llm
node ./scripts/analyze-run.js ./logs/llm/pure/deepseek-v4-flash/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
node ./bin/echogrid.js replay ./logs/48129.jsonl
```

## Fairness Notes

EchoGrid is deterministic by seed, so repeated runs on the same agent and seed should be reproducible except for external LLM output variability. Reports should distinguish deterministic engine behavior from provider instability such as empty final content, rate limits, or timeout.
