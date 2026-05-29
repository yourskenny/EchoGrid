# EchoGrid

<p align="center">
  <a href="#english">English</a> |
  <a href="#中文">中文</a>
</p>

> EchoGrid is an agent-first CLI-native inference and planning game.
>
> EchoGrid 是一个 agent-first、CLI-native 的推理与规划游戏。

<details open id="english">
<summary><strong>English</strong></summary>

## English

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
6. self-contained HTML replay viewer
7. self-contained HTML comparison arena
8. tournament-style leaderboard
9. generated judge brief
10. generated capability scorecard
11. generated mission-control dashboard
12. generated demo index with a first-screen competition verdict
13. generated protocol trace
14. generated artifact manifest with sha256 hashes

It recreates `logs/showcase` for the showcase run.
Open `logs/showcase/index.html` first after `npm run demo:full` for the first-screen competition verdict and artifact order, then open `logs/showcase/mission-control.html` for the guided briefing, dashboard, and route playback, `logs/showcase/SCORECARD.md`, `logs/showcase/JUDGE_BRIEF.md`, `logs/showcase/PROTOCOL_TRACE.md`, `logs/showcase/leaderboard.md`, `logs/showcase/arena.html`, and `logs/showcase/replay.html`. Use `logs/showcase/MANIFEST.json` to verify artifact sizes and hashes.

To render the browser-facing artifacts through headless Chrome/Edge and save desktop/mobile screenshots:

```bash
npm run demo:visual
```

This writes `logs/showcase/screenshots` with PNG screenshots and `visual-smoke.json`.

To build the final judge handoff bundle after the showcase and benchmark logs exist:

```bash
npm run submission:bundle
```

This writes `dist/submission/echogrid-submission` and `dist/submission/echogrid-submission.zip`, including the browser-first `START_HERE.html`, showcase package, protocol trace, visual smoke screenshots when available, public benchmark, adversarial benchmark, rule-signals benchmark, source docs, agent-authoring guide, JSON schemas, one-pager, checklist, generated audit report, reproduce report, strategy audit, and sha256 bundle manifest.

To verify the generated handoff directory, source commit, HTML entry links, and zip archive:

```bash
npm run submission:verify
```

For a shorter verification path, run:

```bash
npm run demo:verify
```

To validate the generated showcase artifacts after `npm run demo:full`:

```bash
npm run demo:check
```

For the full submission gate used by CI:

```bash
npm run submission:check
```

This runs the full showcase package, artifact verifier, visual smoke gate, public benchmark, adversarial benchmark, rule-signals benchmark, submission bundle generator, and final bundle verifier, including the manifest source commit and local links in the browser entry pages.

CI provisions stable Chrome explicitly for the visual smoke gate and passes it through `ECHOGRID_BROWSER`, so the browser-rendered screenshots do not depend on whatever browser happens to be preinstalled on the runner.

## Useful Commands

```bash
npm run demo
npm run compare
npm run showcase
npm run demo:ci
npm run demo:visual
npm run submission:bundle
npm run submission:verify
npm run submission:check
npm run benchmark:public
npm run benchmark:adversarial
npm run benchmark:rules
npm run benchmark:heldout
node ./scripts/compare.js --seeds ./seeds/demo.txt --concurrency 3

node ./bin/echogrid.js inspect --seed 48129
node ./bin/echogrid.js run --seed 48129 --pretty
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --summary-file ./logs/summary.json
node ./bin/echogrid.js replay ./logs/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
npm run replay:html -- ./logs/48129.jsonl --out ./logs/48129.replay.html
npm run demo:brief
npm run demo:protocol
npm run demo:scorecard
npm run demo:dashboard
npm run demo:index
npm run demo:manifest
```

`inspect` is a local debugging command and may print hidden answer data. Do not use its output as evaluated agent input.

For private final rankings, set `ECHOGRID_HELDOUT_SEEDS` to a seed file outside the repo and run `npm run benchmark:heldout`. The generated held-out outputs redact seed ids by default and record the seed file sha256.

LLM-compatible smoke testing can be run with an OpenAI-compatible endpoint:

```bash
set ECHOGRID_LLM_API_KEY=...
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt --mode micro --leaderboard pure
node ./scripts/summarize-llm-logs.js ./logs/llm
node ./scripts/analyze-run.js ./logs/llm/pure/deepseek-v4-flash/9001.jsonl
```

The key is read only from the environment and should never be committed.
This command is an integration smoke test for model behavior and diagnostics; scores may vary by provider latency and model output quality.
By default, the LLM runner separates `pure` model runs from `hybrid` model-plus-baseline-fallback runs so leaderboard scores and integration diagnostics do not get mixed. Pass `--leaderboard pure` to run only the strict model path and reduce provider calls.
Use `--process-timeout` for longer public seed batches, for example `--process-timeout 1800000` for public10 strict pure runs.
The LLM bridge retries an empty final action once by default through `ECHOGRID_LLM_RETRY_EMPTY_ACTION=1`; set it to `0` to measure first-response-only strictness.
For DeepSeek V4 models, the bridge sends `thinking: { "type": "disabled" }` by default so short action prompts are not consumed by hidden reasoning tokens. Override with `ECHOGRID_LLM_THINKING_MODE`.

For targeted regression of the latest public oscillation fixes:

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/targeted-oscillation.txt --mode mvp --leaderboard pure --max-model-turns 96 --process-timeout 1800000
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
claim_rule rule_id because rationale
```

For batch evaluation, EchoGrid runs the agent once per turn and sends the full `STATE` JSON on stdin. The first non-empty stdout line is used as the action.
Protocol schemas are published in `schemas/state.schema.json`, `schemas/event.schema.json`, and `schemas/summary.schema.json`.
For action costs, outcome types, observations, and event-log semantics, see [docs/protocol-reference.md](./docs/protocol-reference.md).

Agents that support line-by-line operation can use persistent mode:

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline-persistent.js --seed 48129 --agent-mode persistent
```

Persistent mode starts the agent once per seed, sends one state JSON line per turn, and reads one action line per turn. The default one-shot mode remains the compatibility path for simple agents.

## MVP Features

- 8x8 deterministic maps from fixed seeds.
- Terrain: unknown, safe, hazard, wall, artifact, exit.
- Resources: `energy`, `integrity`, `turn_limit`.
- Observations: adjacent hazard count, heat, echo, trace, noise, sector.
- Public action hints: a public hint goal from heat/trace/exit, a single next action, preferred actions, safe recommended actions, and repeat-avoidance hints.
- Hidden rule pool: artifact suppression, wall echo inversion, exit radius safety, sector-C unstable cells, row count disclosure.
- Scoring: mission completion, artifact yield, map certainty, rule claim, unused resources, damage, false marks, invalid actions, wasted actions.
- JSONL logs plus replay and standard battle reports.

## Demo Agents

- `agents/random.js`: weak deterministic random policy; included to prove the game is not solved by arbitrary movement.
- `agents/baseline.js`: conservative reference agent that follows public `action_hints.next_action` and falls back to visible terrain search.
- `agents/baseline-persistent.js`: same baseline policy over the persistent line protocol.
- `agents/rule-aware.js`: showcase agent that runs bounded public rule experiments for sector and row signals before delegating to baseline.
- `agents/rule-explorer.js`: experimental rule agent that checks a row-disclosure signal before delegating to baseline.
- `agents/llm-openai-compatible.js`: OpenAI-compatible LLM bridge for DeepSeek/OpenAI-style chat completion APIs.

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

For a guided explanation, including the HTML replay viewer path, see [docs/competition-demo.md](./docs/competition-demo.md).
For the full agent protocol, see [docs/protocol-reference.md](./docs/protocol-reference.md).
For judging boundaries and official evaluation modes, see [docs/competition-rules.md](./docs/competition-rules.md).
For scoring details, see [docs/scoring.md](./docs/scoring.md).
For seed-set purposes, see [docs/seed-sets.md](./docs/seed-sets.md).
For representative report output, see [docs/sample-report.md](./docs/sample-report.md).
For the first LLM evaluation loop, see [docs/llm-evaluation-2026-05-28.md](./docs/llm-evaluation-2026-05-28.md).
For the repeated test/optimization cycle summary, see [docs/test-optimization-cycle-summary-2026-05-28.md](./docs/test-optimization-cycle-summary-2026-05-28.md).

## Project Direction

Short term, EchoGrid is a mature minigame competition demo. Long term, it should become an agent-native inference game platform: lightweight enough for fast local evaluation, strict enough for benchmark use, and readable enough for human review through reports and replay viewers.

</details>

<details id="中文">
<summary><strong>中文</strong></summary>

## 中文

EchoGrid 是一个 agent-first、CLI-native 的推理与规划游戏。它不是“人类谜题外面套一层 AI wrapper”；它的主要界面是结构化状态协议、确定性 seed、离散动作、可审计日志、回放、报告和批量评测。

这个游戏测试的是：智能体能否在局部信息下观察世界、推断隐藏规则、管理有限资源、在不确定性中规划、收集 artifact，并最终通过出口撤离。

## 为什么存在

多数小游戏先为人类设计，再后接给 agent。EchoGrid 从一开始就是为 agent 设计的：

- 状态是机器可读 JSON，紧凑地图行只作为投影视图。
- 动作是单行命令，容易验证，也容易回放。
- 每次运行都由 seed 确定，可复现。
- 隐藏规则让任务聚焦于世界建模，而不只是寻路。
- 日志、回放、报告和对比表让行为可以被审计。

## 快速开始

```bash
npm test
npm run demo:full
```

`npm run demo:full` 会运行完整比赛 demo：

1. 测试套件
2. random、baseline、rule-aware 三类 agent 对比
3. showcase seed 评测
4. battle report
5. replay timeline
6. 自包含 HTML 回放查看器
7. 自包含 HTML 对比竞技场
8. tournament-style leaderboard
9. 生成 judge brief
10. 生成 capability scorecard
11. 生成 mission-control dashboard
12. 生成带首屏竞争结论的 demo index
13. 生成 protocol trace
14. 生成带 sha256 哈希的 artifact manifest

它会为 showcase run 重建 `logs/showcase`。
运行 `npm run demo:full` 后，先打开 `logs/showcase/index.html` 查看首屏竞争结论和 artifact 阅读顺序；再打开 `logs/showcase/mission-control.html` 查看导览、dashboard 和路线回放；随后查看 `logs/showcase/SCORECARD.md`、`logs/showcase/JUDGE_BRIEF.md`、`logs/showcase/PROTOCOL_TRACE.md`、`logs/showcase/leaderboard.md`、`logs/showcase/arena.html` 和 `logs/showcase/replay.html`。使用 `logs/showcase/MANIFEST.json` 校验 artifact 大小与哈希。

如果要用 headless Chrome/Edge 渲染面向浏览器的 artifact，并保存桌面/移动端截图：

```bash
npm run demo:visual
```

该命令会写入 `logs/showcase/screenshots` 中的 PNG 截图，以及 `visual-smoke.json`。

当 showcase 与 benchmark 日志已存在后，构建最终评委交付包：

```bash
npm run submission:bundle
```

该命令会写入 `dist/submission/echogrid-submission` 和 `dist/submission/echogrid-submission.zip`，其中包含浏览器优先入口 `START_HERE.html`、showcase 包、protocol trace、可视化 smoke 截图（如果存在）、public benchmark、adversarial benchmark、rule-signals benchmark、源码文档、agent authoring guide、JSON schemas、one-pager、checklist、生成的 audit report、reproduce report、strategy audit，以及 sha256 bundle manifest。

验证生成的交付目录、source commit、HTML 入口链接和 zip 归档：

```bash
npm run submission:verify
```

更短的验证路径：

```bash
npm run demo:verify
```

在 `npm run demo:full` 后校验生成的 showcase artifacts：

```bash
npm run demo:check
```

CI 使用的完整 submission gate：

```bash
npm run submission:check
```

该命令会运行完整 showcase 包、artifact verifier、visual smoke gate、public benchmark、adversarial benchmark、rule-signals benchmark、submission bundle generator 和最终 bundle verifier，并检查 manifest source commit 以及浏览器入口页面中的本地链接。

CI 会为 visual smoke gate 显式准备稳定 Chrome，并通过 `ECHOGRID_BROWSER` 传入，因此浏览器渲染截图不依赖 runner 上碰巧预装的浏览器。

## 常用命令

```bash
npm run demo
npm run compare
npm run showcase
npm run demo:ci
npm run demo:visual
npm run submission:bundle
npm run submission:verify
npm run submission:check
npm run benchmark:public
npm run benchmark:adversarial
npm run benchmark:rules
npm run benchmark:heldout
node ./scripts/compare.js --seeds ./seeds/demo.txt --concurrency 3

node ./bin/echogrid.js inspect --seed 48129
node ./bin/echogrid.js run --seed 48129 --pretty
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --log-dir ./logs
node ./bin/echogrid.js evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt --summary-file ./logs/summary.json
node ./bin/echogrid.js replay ./logs/48129.jsonl
node ./bin/echogrid.js report ./logs/48129.jsonl
npm run replay:html -- ./logs/48129.jsonl --out ./logs/48129.replay.html
npm run demo:brief
npm run demo:protocol
npm run demo:scorecard
npm run demo:dashboard
npm run demo:index
npm run demo:manifest
```

`inspect` 是本地调试命令，可能打印隐藏答案数据。不要把它的输出作为被评测 agent 的输入。

对于 private final rankings，可将 `ECHOGRID_HELDOUT_SEEDS` 设置为仓库外的 seed 文件，然后运行 `npm run benchmark:heldout`。生成的 held-out 输出默认会隐藏 seed id，并记录 seed 文件的 sha256。

可以使用 OpenAI-compatible endpoint 运行 LLM-compatible smoke test：

```bash
set ECHOGRID_LLM_API_KEY=...
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/llm-smoke.txt --mode micro --leaderboard pure
node ./scripts/summarize-llm-logs.js ./logs/llm
node ./scripts/analyze-run.js ./logs/llm/pure/deepseek-v4-flash/9001.jsonl
```

API key 只从环境变量读取，绝不应提交到仓库。
该命令是面向模型行为与诊断的集成 smoke test；分数可能因 provider latency 和模型输出质量而波动。
默认情况下，LLM runner 会把 `pure` 模型运行与 `hybrid` 模型加 baseline fallback 运行分开，避免 leaderboard 分数和集成诊断混在一起。传入 `--leaderboard pure` 可只运行严格模型路径，并减少 provider calls。
长 public seed batch 可使用 `--process-timeout`，例如 public10 strict pure run 使用 `--process-timeout 1800000`。
LLM bridge 默认通过 `ECHOGRID_LLM_RETRY_EMPTY_ACTION=1` 对空最终动作重试一次；将其设为 `0` 可测量 first-response-only strictness。
对于 DeepSeek V4 models，bridge 默认发送 `thinking: { "type": "disabled" }`，避免短动作 prompt 被隐藏推理 token 消耗。可用 `ECHOGRID_LLM_THINKING_MODE` 覆盖。

针对最新 public oscillation fixes 的定向回归：

```bash
node ./scripts/run-llm-eval.js --models deepseek-v4-pro,deepseek-v4-flash --seeds ./seeds/targeted-oscillation.txt --mode mvp --leaderboard pure --max-model-turns 96 --process-timeout 1800000
```

## 游戏循环

每次运行都从一个 seed 和一个 agent 开始。每回合 EchoGrid 会把一个 `STATE` JSON 对象发送给 agent。agent 返回恰好一行动作。EchoGrid 验证动作、更新隐藏世界、记录 event，并最终产出分数、JSONL 日志、回放和报告。

```text
seed -> STATE -> action -> EVENT -> STATE -> ... -> terminal result -> report
```

## Agent 协议

坐标为零基。`(0,0)` 是西北角。

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
claim_rule rule_id because rationale
```

批量评测时，EchoGrid 每回合运行一次 agent，并通过 stdin 发送完整 `STATE` JSON。第一个非空 stdout 行会被用作动作。
协议 schema 发布在 `schemas/state.schema.json`、`schemas/event.schema.json` 和 `schemas/summary.schema.json`。
动作成本、outcome type、observations 和 event-log 语义见 [docs/protocol-reference.md](./docs/protocol-reference.md)。

支持逐行操作的 agent 可以使用 persistent mode：

```bash
node ./bin/echogrid.js evaluate --agent ./agents/baseline-persistent.js --seed 48129 --agent-mode persistent
```

Persistent mode 会在每个 seed 上启动一次 agent，每回合发送一行 state JSON，并读取一行动作。默认 one-shot mode 仍然是简单 agent 的兼容路径。

## MVP 功能

- 基于固定 seed 的 8x8 确定性地图。
- 地形：unknown、safe、hazard、wall、artifact、exit。
- 资源：`energy`、`integrity`、`turn_limit`。
- 观察：adjacent hazard count、heat、echo、trace、noise、sector。
- 公开 action hints：来自 heat/trace/exit 的 public hint goal、单个 next action、preferred actions、safe recommended actions，以及 repeat-avoidance hints。
- 隐藏规则池：artifact suppression、wall echo inversion、exit radius safety、sector-C unstable cells、row count disclosure。
- 计分：mission completion、artifact yield、map certainty、rule claim、unused resources、damage、false marks、invalid actions、wasted actions。
- JSONL 日志，以及 replay 和标准 battle report。

## Demo Agents

- `agents/random.js`：弱 deterministic random policy；用于证明游戏不是靠随便移动就能解决。
- `agents/baseline.js`：保守 reference agent，遵循公开 `action_hints.next_action`，并 fallback 到可见地形搜索。
- `agents/baseline-persistent.js`：同一 baseline policy 的 persistent line protocol 版本。
- `agents/rule-aware.js`：showcase agent，会对 sector 和 row signals 进行有界公开规则实验，然后委托 baseline。
- `agents/rule-explorer.js`：实验性规则 agent，会先检查 row-disclosure signal，再委托 baseline。
- `agents/llm-openai-compatible.js`：用于 DeepSeek/OpenAI-style chat completion APIs 的 OpenAI-compatible LLM bridge。

对比例子：

```text
ECHO GRID AGENT COMPARISON
Agent                   Success  Avg Score  Avg Turns
./agents/random.js      0        ...
./agents/baseline.js    1        ...
./agents/rule-aware.js  1        ...
```

## Competition Demo

推荐评审路径是：

```bash
npm run demo:full
```

showcase seed 是 `9001`。它展示完整循环：结构化观察、rule-aware action、artifact 收集、撤离、计分、报告和回放。

包含 HTML replay viewer 路径的导览说明见 [docs/competition-demo.md](./docs/competition-demo.md)。
完整 agent 协议见 [docs/protocol-reference.md](./docs/protocol-reference.md)。
评审边界和 official evaluation modes 见 [docs/competition-rules.md](./docs/competition-rules.md)。
计分细节见 [docs/scoring.md](./docs/scoring.md)。
seed set 用途见 [docs/seed-sets.md](./docs/seed-sets.md)。
代表性 report 输出见 [docs/sample-report.md](./docs/sample-report.md)。
第一次 LLM evaluation loop 见 [docs/llm-evaluation-2026-05-28.md](./docs/llm-evaluation-2026-05-28.md)。
重复 test/optimization cycle 总结见 [docs/test-optimization-cycle-summary-2026-05-28.md](./docs/test-optimization-cycle-summary-2026-05-28.md)。

## 项目方向

短期看，EchoGrid 是一个成熟的 minigame competition demo。长期看，它应该成为一个 agent-native inference game platform：足够轻量，适合快速本地评测；足够严格，适合 benchmark；也足够可读，方便人类通过报告和回放查看行为。

</details>
