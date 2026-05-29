# EchoGrid 108 小时评委向打磨计划

来源：ChatGPT 分享页 `https://chatgpt.com/share/6a188352-df68-83ea-a0f4-b4e94f9f1116`

## 最终判断

最后 108 小时不要把 EchoGrid 改造成传统人类可玩的可视化小游戏，而要把它打磨成一个“评委 30 秒能看懂、5 分钟能信服、20 分钟能复现”的 agent-native 推理游戏 demo / 小型 benchmark。

它现在最强的资产不是画面，而是：结构化状态协议、确定性种子、隐藏规则推断、受限资源规划、JSONL 审计日志、回放、比较竞技场、leaderboard、scorecard、submission bundle。README 已经把项目定义为 “agent-first CLI-native inference and planning game”，并明确强调结构化 JSON、离散动作、确定性种子、隐藏规则、日志/回放/报告/批评测这些差异点。

我没有在本地实际执行仓库命令；下面判断基于我读取到的仓库文档、脚本、代码与外部相似项目资料。因此给 Codex 的计划里，第一步必须是干净环境下跑完整 gate，而不是默认现状已经全部通过。

## 1. 当前项目本质：它已经不是“游戏原型”，而是“可审计的 agent 推理场”

EchoGrid 当前核心闭环是：

```text
seed -> STATE JSON -> agent action -> EVENT -> next STATE -> terminal result -> report/replay/benchmark
```

这比一般 game jam demo 更像一个轻量 agent 评测环境。它的公开协议已经定义了 turn contract：每回合引擎给 agent 一个 STATE JSON，agent 输出一行动作；坐标为零基；inspect 可能泄露隐藏答案，不能作为评测输入。

当前动作空间也已经足够完整：移动、探测、扫描行/列/象限、标记、提取、等待、声明隐藏规则，并且每类动作有明确成本、合法条件、结果类型和惩罚。 默认世界配置是 8x8，180 energy，3 integrity，130 turn limit，8 个墙、10 个 hazard、4 个 artifact、要求收集 3 个 artifact，动作成本也已经定义在 generator 里。

隐藏规则池目前有五个方向：artifact 抑制邻近 hazard、墙附近 echo 反转、exit 半径安全、C 区正好两个 unstable cell、某一行 scan 会披露固定 hazard count。 这说明项目的游戏性不应再押注“多做地图元素”，而应押注“让规则推断过程被看见、被证明、被比较”。

目前 demo:full 已经被设计成完整评委路径：跑测试、比较 random/baseline/rule-aware、跑 showcase seed、生成 battle report、replay timeline、HTML replay、HTML arena、leaderboard、judge brief、scorecard、mission-control dashboard、index、protocol trace、manifest。 submission:check 也已经覆盖完整 demo、可视化 smoke、public/adversarial/rule-signals benchmark、submission bundle 和 verify。

这意味着：最后 108 小时的主线不是“补功能”，而是“锁边界、强叙事、强验收、强证据链”。

## 2. 外部相似项目给 EchoGrid 的启发

### 2.1 MiniGrid / BabyAI / Procgen / NLE：小环境也能成立，前提是评测清晰

MiniGrid/MiniWorld 是面向 RL 的小型 2D/3D 环境套件，强调 minimalistic design、快速创建新环境和研究社区采用度；这说明 EchoGrid 不需要大型画面，也能凭借清晰协议和可扩展任务成立。 BabyAI 用逐步增加难度的 19 个 level、合成语言和 expert demonstration 研究 grounded language learning 的 sample efficiency；它对 EchoGrid 的启发是：任务分层、协议清晰、可解释 expert/reference agent 比“内容很多”更重要。 Procgen Benchmark 用 16 个程序生成游戏环境测试 sample efficiency 和 generalization，说明固定 public seed 与 held-out seed 的分离很关键。 NetHack Learning Environment 则证明 procedurally generated、stochastic、rich、fast 的环境可以驱动 exploration、planning、skill acquisition 等能力研究。

EchoGrid 应该吸收这些项目的优点：明确协议、确定性复现、seed set、可比较 reference agents、held-out 评测路径。不要试图在 108 小时内追求大型环境复杂度。

### 2.2 Minesweeper / roguelike：隐藏信息 + 局部线索是成熟玩法，但 EchoGrid 需要超越“扫雷”

Minesweeper 的核心是隐藏地雷、通过相邻数字线索推断安全格；这是 EchoGrid mine_signal、hazard、probe/scan 的直觉来源之一。 但如果 EchoGrid 停留在“AI 玩扫雷”，创新性不够。它必须把 artifact routing、exit extraction、资源消耗、隐藏世界规则、rule claim rationale 和 multi-agent 对照放在台前。

Roguelike 传统强调程序生成、回合制、网格、资源压力、失败成本；这些都能服务 EchoGrid 的 run-based benchmark 结构。 FTL 这类成功作品也说明：小规模系统只要有资源压力、路线选择和可复现故事，就能形成强烈的 run narrative。

### 2.3 Baba Is You / Obra Dinn / Into the Breach / Duskers：评委容易被“清楚的推理瞬间”打动

Baba Is You 的核心是把规则本身做成可操作对象；它对 EchoGrid 的启发是：隐藏规则不能只是后台 buff，而要成为玩家/agent 主动识别、声明、得分的主要戏剧点。 Return of the Obra Dinn 的成功来自“证据 -> 推断 -> 结论”的可读性，它赢得了 IGF Seumas McNally Grand Prize；EchoGrid 的 protocol trace、judge brief、strategy audit 应当承担同样的证据账本作用。 Into the Breach 的敌方攻击 telegraph 让复杂战术变得一眼可读；EchoGrid 的 dashboard/replay 也要把“agent 为什么这么做”可视化出来，而不是只显示分数。 Duskers 证明命令行输入本身可以成为沉浸式玩法，而不是缺点；EchoGrid 应把 CLI 包装成 mission terminal / audit console，而不是为没有 3D 画面辩解。

IGF 的优秀作品里，FTL、Baba Is You、Obra Dinn 都体现出一个共同点：评委奖励的是清晰、强概念、高完成度，而不是功能堆叠。

## 3. 最终作品定位

我建议把最终 pitch 固定为：

> EchoGrid is a tiny, auditable world-modeling arena for agents. Agents receive partial structured state, act through one-line commands, infer hidden rules from public evidence, manage resources, collect artifacts, extract, and leave a replayable proof trail.

中文版本：

> EchoGrid 是一个面向智能体的可审计推理游戏：智能体读取局部可见的结构化世界状态，用单行动作探索、扫描、标记、推断隐藏规则，在有限资源内收集 artifact 并撤离；每一次行动都能被日志、回放、报告和榜单复现。

这个定位有三个重要边界：

第一，它是 agent-first game，不是“人类小游戏加 AI wrapper”。这一点与 README 当前说法一致。

第二，它是 inference + planning game，不是单纯路径规划。得分体系已经覆盖 mission、artifact、map certainty、rule discovery、energy、integrity，以及 damage/false mark/invalid/wasted penalties。

第三，它是 auditable competition demo，不是只给开发者看的 CLI。现有 demo artifact 已经包含 replay viewer、arena、leaderboard、judge brief、scorecard、mission-control、protocol trace、manifest。最后 108 小时应把这些变成评委体验的主角。

## 4. 108 小时功能边界

### 必须保留并打磨的范围

#### 核心游戏闭环

保留 8x8 deterministic seed 世界、start/exit、wall/hazard/artifact、energy/integrity/turn limit、probe/scan/mark/extract/claim_rule。不要在最后阶段改成大地图或实时制。当前配置已经足够表达推理、资源和路径规划。

#### 隐藏规则与 rule claim

保留五个规则族，但不要轻易增加很多规则。现在最重要的是让每个规则都有：公开提示、可观察信号、可复现 seed、agent 可利用策略、文档解释、scorecard 展示。规则声明 rationale 已经会被记录进 observation、report、replay milestone 和 judge brief，但分数只取决于 rule id 是否正确；这正好适合作为“审计文本，不泄露答案”的设计。

#### 三类 agent 对照

必须保留 random、baseline、rule-aware 的叙事层级：random 失败证明不是随便走；baseline 成功证明公开协议可玩；rule-aware 更高分证明主动实验和规则推断有价值。competition-demo 文档已经明确这种 expected story。

#### 评委 artifact

必须让 logs/showcase/index.html 成为第一入口，mission-control.html 成为主展示页，replay.html 展示单局过程，arena.html 展示多 agent 对照，SCORECARD.md 和 JUDGE_BRIEF.md 解释能力与结果，PROTOCOL_TRACE.md 证明真实协议，MANIFEST.json 证明 artifact 完整性。当前 docs 已经将这些列为 judge-facing 重点。

#### submission bundle

最终必须能产出 dist/submission/echogrid-submission.zip，包含 START_HERE、showcase、benchmarks、docs、schemas、one-pager、checklist、audit、reproduce、strategy audit、manifest。

### 明确不做的范围

最后 108 小时不要做这些：

不做实时图形引擎，不做 3D，不做多人，不做在线服务器，不做账号系统，不做在线排行榜，不做大型美术资产，不做 RL 训练框架，不把评测 agent 改成需要网络才能跑，不在最后 36 小时改公开协议，不引入复杂 build pipeline，不做会破坏 deterministic/replay/hash 的动态外部依赖。

LLM bridge 可以作为 bonus smoke test，但不能成为核心 demo 的依赖。competition rules 已经区分 pure/hybrid leaderboard、provider settings、retry diagnostics 和 API key 环境变量；这部分必须被报告清楚，不能混进 deterministic reference demo。

## 5. 明确需求与验收标准

### R1：一命令评委路径

验收标准：

`npm run demo:full` 能从干净状态生成完整 showcase 包；`npm run demo:check` 能验证 artifact；`npm run demo:visual` 能生成桌面/移动截图或在缺浏览器时给出清楚失败原因；`npm run submission:check` 是最终 gate。现有 package scripts 已经包含这些命令路径。

### R2：协议稳定

验收标准：

STATE 中核心字段稳定：`turn/resources/objective/agent/map/observations/rules/action_hints/score/metrics`；agent 仍然只需输出一行动作。protocol reference 已经列出优先使用字段，并说明 `map.cells` 是结构化源，`map.rows` 只是紧凑投影。

不要在 108 小时内重命名这些字段。新增字段只能 additive，agent 应能忽略 unknown fields。

### R3：隐藏规则必须可验证

验收标准：

每个 hidden rule 至少有一个 public/adversarial/rule-signals seed 能覆盖；每个能得分的 rule claim 都必须来自公开 observation 或 scan，不依赖 inspect、generator internals 或 hidden answer。competition rules 已经明确 allowed inputs 和 disallowed inputs。

### R4：agent 分层必须明显

验收标准：

showcase 和 benchmark 中至少展示：

- random：低成功/低分或明显浪费资源。
- baseline：能完成基础目标，遵循 public `action_hints.next_action` 和保守探索。baseline-policy 当前确实优先 extract，随后使用 `action_hints.next_action`，再进行 artifact/exit/frontier 探索。
- rule-aware：通过 bounded public experiments 获取 rule signal，并声明规则。当前 rule-aware 会查找 sector C 的 rule_signal 或 row disclosure，然后输出带 rationale 的 `claim_rule`。

### R5：评委首屏必须“懂”

验收标准：

`START_HERE.html` 和 `logs/showcase/index.html` 第一屏必须包含：

- 作品一句话定位。
- 本次 showcase 是否成功。
- rule-aware 相对 baseline/random 的分数优势。
- 打开 Mission Control / Replay / Arena / Scorecard 的顺序。
- 一句“为什么这不是普通扫雷/寻路”的解释。
- 复现命令和 bundle hash 链接。

### R6：可复现与可审计

验收标准：

所有 showcase artifact 有 manifest size/hash；submission bundle 有 sha256 manifest；HTML 本地打开不依赖外部资源；CI 或本地 gate 能验证链接、文件存在、hash 和 benchmark 输出。demo 文档已经把 manifest、protocol trace、scorecard、strategy audit、bundle manifest 作为重要 artifact。

### R7：文档必须服务评委，而不是服务开发者

验收标准：

README 顶部给出 5 分钟 judge path。`docs/competition-demo.md` 保持为主评委说明。`SUBMISSION_ONE_PAGER.md` 用非开发者语言解释价值。`SUBMISSION_REPRODUCE.md` 给出干净复现步骤。`SUBMISSION_AUDIT.md` 解释不作弊边界。`SUBMISSION_STRATEGY_AUDIT.md` 解释 rule-aware 为什么比 baseline 强。

## 6. 最值得强调的创新点

### 创新点 1：agent-native，而不是 human-first + AI wrapper

很多小游戏是先给人玩，再让 AI 读屏或套接口。EchoGrid 的强点是从一开始就把 state/action/log/schema 做成机器可读协议。这个方向与 README 的项目定义完全一致。

### 创新点 2：隐藏规则推断是得分项，不是背景设定

Minesweeper 式局部线索只能证明局部推断；EchoGrid 的 `claim_rule` 把“世界模型假设”变成正式动作和 score component。scan 也有 `rule_signal`、`disclosed_hazard_count`、`confidence` 等可审计信号。

### 创新点 3：游戏结果自带证据链

JSONL、replay、report、protocol trace、manifest、scorecard、arena 不是附属工具，而是 gameplay 的可审计外壳。对评委来说，这会比单个华丽截图更可信。

### 创新点 4：它是轻量 benchmark，也是一局游戏

MiniGrid、BabyAI、Procgen、NLE 说明小环境可以成为严肃 agent benchmark；Baba Is You、Obra Dinn、Into the Breach 说明规则、证据和可读战术可以成为强游戏体验。EchoGrid 的机会就在中间：既能被 agent 批量跑，又能被人类评委看懂一局为什么精彩。

### 创新点 5：公平性边界清楚

允许 agent 使用 STATE、内部 run memory、公开 docs 和公开 seed；禁止使用 inspect、hidden internals、同一 hidden/private evaluation 的日志或隐藏 artifact 文件。这个边界让它更像正式比赛项目，而不是普通 demo。

## 7. 108 小时开发排程

### 0–6 小时：冻结产品主线，跑基线

目标：确认现在真实能跑到哪里。

任务：

- 运行 `npm install`，然后依次跑 `npm test`、`npm run demo:verify`、`npm run demo:full`、`npm run demo:check`。
- 记录所有失败，不做新功能。
- 打开 `logs/showcase/index.html`、`mission-control.html`、`replay.html`、`arena.html`，人工检查首屏是否能在 30 秒内讲清楚项目。
- 形成 `docs/FINAL_108H_STATUS.md`：列出通过项、失败项、必须修复项、可选项。

完成标准：所有 P0 gate 的失败项都被列出，且没有开始大重构。

### 6–18 小时：修复阻塞项，锁协议

目标：让基础 demo 和 artifact 骨架稳定。

任务：

- 修复测试失败、路径错误、manifest 缺文件、HTML broken links、schema 不一致、CLI 参数不一致。
- 检查 `schemas/state.schema.json`、`event.schema.json`、`summary.schema.json` 是否覆盖当前输出。
- 确保新增字段全是 additive。
- 检查 `demo:full` 是否重建 `logs/showcase` 且不会误删其他 logs。
- 确保 inspect 在文档中被明确标为调试命令，不能用于评测。

完成标准：`npm test && npm run demo:full && npm run demo:check` 通过。

### 18–36 小时：强化“评委一眼懂”的 presentation layer

目标：把 demo 从“能跑”变成“能打动”。

任务：

- 重写或强化 `index.html` 首屏：Competition Verdict、Why it matters、Open in this order、Result snapshot、Agent separation、Audit gates。
- 强化 `mission-control.html`：展示最终公共地图、路线回放、关键 milestone、rule claim rationale、score construction、agent comparison。
- 强化 `JUDGE_BRIEF.md`：一页内解释目标、结果、关键动作、规则推断证据、为什么 rule-aware 更强。
- 强化 `SCORECARD.md`：mission completion、artifact routing、rule inference、resource discipline、agent separation、audit integrity 六个 gate。
- 确保所有 HTML 自包含，无外部 CSS/JS/CDN。

完成标准：一个不了解项目的人打开 `index.html` 后，能按顺序看完 Mission Control、Replay、Arena、Scorecard。

### 36–54 小时：benchmark 与 seed 覆盖

目标：让“不是 showcase 偶然性”成立。

任务：

- 检查 `seeds/showcase.txt`、`demo.txt`、`public.txt`、`adversarial.txt`、`rule-signals.txt` 的用途。
- 补充或调整 seed，使五个 hidden rule 在 public/adversarial/rule-signals 中都有覆盖。
- 确保 `benchmark:public`、`benchmark:adversarial`、`benchmark:rules` 输出 JSON、arena、leaderboard。
- 生成 strategy audit：每个 seed 的 agent 分数、成功状态、规则声明、关键差异。
- 检查 rule-aware 没有读取 hidden internals。
- 如果 benchmark 中 rule-aware 没有稳定优势，优先调整 seed set 和公开信号可读性；不要让 rule-aware 作弊。

完成标准：benchmark 能证明 agent 策略质量改变结果，而不是只靠随机性。

### 54–72 小时：可视化 smoke、移动端、打包质量

目标：让交付物像成熟 demo。

任务：

- 跑 `npm run demo:visual`，确认桌面/移动截图可生成。
- 修复 HTML 在窄屏下的溢出、不可读、按钮无效、路径错误。
- 确保 replay/arena/dashboard 都能本地 file-open。
- 在 manifest 中记录关键 artifact size/hash。
- 检查 generated docs 是否引用真实存在的文件。

完成标准：`logs/showcase/screenshots` 和 `visual-smoke.json` 存在，或缺浏览器时 verify 给出明确诊断；CI 环境仍应使用稳定 Chrome。

### 72–90 小时：submission bundle 与复现路径

目标：让评委拿到 zip 后不需要猜。

任务：

- 运行 `npm run benchmark:public`、`npm run benchmark:adversarial`、`npm run benchmark:rules`。
- 运行 `npm run submission:bundle`、`npm run submission:verify`。
- 打开 `dist/submission/echogrid-submission/START_HERE.html` 人工检查。
- 检查 bundle 中 source docs、schemas、one-pager、checklist、audit、reproduce、strategy audit、manifest 是否完整。
- 写 `KNOWN_LIMITATIONS.md` 或在 audit 中诚实列出当前限制：不是图形游戏、LLM 需要 API key、hidden rule 数量有限、reference agents 是展示级不是最优 solver。

完成标准：submission zip 可单独交付。

### 90–102 小时：干净环境 final dry run

目标：停止扩展，只修 blocker。

任务：

- 删除本地 `logs/dist` 后重跑 `npm run submission:check`。
- 最好在另一个干净目录 clone 一次跑同样命令。
- 确认 README、competition-demo、START_HERE 的命令一致。
- 确认没有 secrets、API keys、绝对路径、机器相关路径。
- 确认 GitHub Actions 或本地 CI 与最终 gate 一致。

完成标准：final gate 通过；所有新失败都按 blocker 处理。

### 102–108 小时：冻结与最终提交

目标：交付，不再冒险。

任务：

- 只允许修改文案 typo、broken links、manifest mismatch、命令错误。
- 打最终 zip。
- 记录 commit hash、命令输出摘要、artifact 路径。
- 准备 90 秒口头介绍和 5 分钟评委 walkthrough。
- 保留最后可回滚 commit。

完成标准：最终 submission bundle、README、START_HERE、CI/gate 状态一致。

## 8. 给 Codex 的 goal-mode 长线建构计划

下面这段可以直接作为 Codex 的长任务提示使用。

```text
You are Codex working in the EchoGrid repository.

Mission:
Finalize EchoGrid into a competition-ready, judge-facing, agent-native inference game demo within the remaining 108-hour window. Do not pivot the project into a traditional graphical game. Treat the current project spine as correct: structured STATE protocol, deterministic seeds, one-line actions, hidden-rule inference, resource planning, JSONL logs, replay, reports, scorecard, arena, benchmark, and submission bundle.

Primary product thesis:
EchoGrid is a tiny, auditable world-modeling arena for agents. Agents receive partial structured state, act through one-line commands, infer hidden rules from public evidence, manage resources, collect artifacts, extract, and leave a replayable proof trail.

Non-negotiable constraints:
1. Keep Node.js >=20 and CommonJS style unless the repo already requires otherwise.
2. Do not introduce a server, online dependency, account system, external CDN, realtime graphics engine, or heavyweight build system.
3. Do not require network access for official deterministic demo agents.
4. Do not commit API keys, secrets, provider logs with credentials, or machine-specific absolute paths.
5. Do not let evaluated agents use inspect output, generator internals, engine hidden internals, hidden answer files, or same-run hidden logs.
6. Keep the public STATE/action protocol backward-compatible. Additive fields are acceptable; renaming or deleting core fields is not.
7. All generated HTML artifacts must be self-contained and openable from local files.
8. All benchmark and showcase outputs must be reproducible from commands.
9. Generated manifests must include correct file sizes and sha256 hashes.
10. In the final 24 hours, only fix blockers, broken links, documentation mismatches, visual readability issues, and verification failures.

Definition of Done:
- npm test passes.
- npm run demo:full passes and generates logs/showcase.
- npm run demo:check passes.
- npm run demo:visual passes in an environment with Chrome/Edge, or fails with a clear browser diagnostic while CI remains configured to provide a browser.
- npm run benchmark:public passes.
- npm run benchmark:adversarial passes.
- npm run benchmark:rules passes.
- npm run submission:bundle creates dist/submission/echogrid-submission and dist/submission/echogrid-submission.zip.
- npm run submission:verify passes.
- npm run submission:check passes before final freeze.
- START_HERE.html and logs/showcase/index.html are understandable in under 30 seconds.
- Mission Control, Replay, Arena, Scorecard, Judge Brief, Protocol Trace, Leaderboard, and Manifest all exist and link correctly.
- Strategy audit clearly explains why rule-aware beats baseline without cheating.
- The final bundle can be reviewed without browsing the repository.

Workstream A — Baseline health check:
1. Run:
   npm install
   npm test
   npm run demo:verify
   npm run demo:full
   npm run demo:check
2. Record failures in docs/FINAL_108H_STATUS.md.
3. Do not start new features until P0 failures are fixed.
4. Fix failures in the smallest possible patches.
5. After each fix, rerun the smallest affected command, then rerun the relevant gate.

Workstream B — Protocol and schema hardening:
1. Inspect emitted STATE, EVENT, and summary outputs from showcase logs.
2. Verify schemas in schemas/ match current outputs.
3. Do not remove or rename:
   protocol, seed, mode, coordinate_system, turn, resources, objective, agent, map, observations, rules, valid_actions, action_hints, score, score_breakdown, metrics.
4. If new fields are added, update schemas, docs/protocol-reference.md, and tests.
5. Ensure agents ignore unknown fields safely.
6. Ensure inspect remains documented as a debugging-only command and is not used in evaluated paths.

Workstream C — Hidden-rule coverage and fairness:
1. List all rules from src/rules.js.
2. For each hidden rule, confirm:
   - It has a publicHint.
   - It has observable public evidence or a scan/cell signal.
   - It can be represented in reports/replay/scorecard.
   - At least one seed in public/adversarial/rule-signals can exercise it.
3. Do not add a new hidden rule unless all of these are implemented:
   - rules.js catalog entry
   - generator or engine behavior
   - public observation evidence
   - rule-aware or reference strategy
   - tests
   - seed coverage
   - docs
   - scorecard/report wording
4. Prefer strengthening existing five rules over adding new rules.
5. Verify rule-aware never reads hidden answers, inspect output, src/generator.js internals, src/engine.js hidden internals, or precomputed hidden logs.

Workstream D — Agent comparison:
1. Preserve the story:
   - random is weak and wasteful
   - baseline can complete basic tasks using public hints and conservative exploration
   - rule-aware performs bounded public experiments and claims rules when evidence appears
2. Run comparisons on showcase, public, adversarial, and rule-signals seeds.
3. Ensure comparison outputs include success rate, average score, average turns, per-seed status, and rule-claim evidence where applicable.
4. If rule-aware fails to separate from baseline, first inspect seed coverage and public evidence. Do not cheat by using hidden information.
5. Keep LLM smoke tests optional and clearly separated from deterministic reference demo.

Workstream E — Judge-facing artifact polish:
1. logs/showcase/index.html must be the first entry point.
2. First screen must include:
   - one-sentence product thesis
   - showcase result
   - agent comparison snapshot
   - why this is innovative
   - ordered links: Mission Control, Replay, Arena, Scorecard, Judge Brief, Protocol Trace, Manifest
   - reproduce command
3. mission-control.html must show:
   - final public map
   - route playback or timeline
   - key milestones
   - rule claim and rationale
   - score construction
   - strategy edge
   - links to evidence artifacts
4. replay.html must show turn-by-turn board/action/outcome/score.
5. arena.html must show side-by-side agent comparison and per-seed matrix.
6. SCORECARD.md must include capability gates:
   - mission completion
   - artifact routing
   - rule inference
   - resource discipline
   - low penalty behavior
   - agent separation
   - audit integrity
7. JUDGE_BRIEF.md must fit a one-page review path.
8. PROTOCOL_TRACE.md must show real STATE -> ACTION -> EVENT -> STATE examples from the showcase log.
9. MANIFEST.json must hash all key artifacts.

Workstream F — Submission bundle:
1. Run benchmark outputs before bundling:
   npm run benchmark:public
   npm run benchmark:adversarial
   npm run benchmark:rules
2. Run:
   npm run submission:bundle
   npm run submission:verify
3. Confirm bundle includes:
   - START_HERE.html
   - showcase package
   - public benchmark
   - adversarial benchmark
   - rule-signals benchmark
   - source docs
   - agent-authoring guide
   - schemas
   - SUBMISSION_ONE_PAGER.md
   - SUBMISSION_CHECKLIST.md
   - SUBMISSION_AUDIT.md
   - SUBMISSION_REPRODUCE.md
   - SUBMISSION_STRATEGY_AUDIT.md
   - SUBMISSION_MANIFEST.json
4. Confirm all local links in START_HERE.html work after copying the bundle to a separate directory.
5. Confirm zip central directory and manifest match the bundle directory.

Workstream G — Tests and CI:
1. Prefer adding tests before changing core logic.
2. Cover:
   - action parsing
   - scoring consistency
   - rule claim scoring and rationale logging
   - seed solvability
   - schema validation
   - artifact generation
   - manifest hashing
   - submission verification
3. CI should run the same final submission gate or the closest practical equivalent.
4. Browser visual smoke should use an explicit Chrome/Edge path when CI provides one.
5. No flaky tests; deterministic seeds only.

Workstream H — Documentation and pitch:
1. README top section must tell judges:
   - what EchoGrid is
   - why it is agent-native
   - what command to run
   - where to start reviewing generated artifacts
2. docs/competition-demo.md must remain the detailed judge path.
3. docs/competition-rules.md must clearly define allowed/disallowed agent inputs.
4. docs/scoring.md must match actual score_breakdown.
5. Add or update a short final pitch:
   "EchoGrid turns hidden-world inference into an auditable agent game: every observation, action, rule claim, score delta, and replay artifact is machine-readable and judge-readable."
6. Maintain a known limitations section:
   - not a human-first graphical game
   - limited rule pool in this demo
   - LLM tests require external API keys and are optional
   - reference agents are demonstration policies, not exhaustive optimal solvers

Milestone reporting format after each completed phase:
Milestone:
Changed files:
Commands run:
Results:
Artifacts produced:
Remaining risks:
Next step:

Priority policy:
- P0: anything blocking npm test, demo:full, demo:check, benchmark scripts, submission bundle, submission verify.
- P1: judge readability, artifact links, scorecard clarity, strategy audit, visual smoke.
- P2: optional LLM smoke polish, extra hidden-rule depth, extra screenshots, copy polish.
- Never start P2 while any P0 is failing.
- In the final 24 hours, stop adding new mechanics.
```

## 9. 最后建议：把“完成度”压过“野心”

EchoGrid 已经有一个相当清晰的技术骨架：agent protocol、hidden rules、reference agents、benchmarks、submission bundle、visual smoke、manifest、scorecard。接下来最容易犯的错是觉得“还不够像游戏”，于是加 UI、加规则、加模式，最后破坏稳定性。

更好的策略是：把现有系统包装成一个不可误解的评委体验。

评委打开第一屏时应该立刻看到：

- “这是一个 agent 推理游戏。”
- “agent 不是在走迷宫，而是在建立世界模型。”
- “rule-aware 通过公开证据做实验并声明隐藏规则。”
- “所有东西都能复现、回放、审计、比较。”
- “这个 demo 有明确边界，但扩展点清楚。”

这会比最后 108 小时堆出半成品图形界面更有冲击力。
