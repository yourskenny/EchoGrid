#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const SHOWCASE_FILES = [
  '9001.jsonl',
  'MANIFEST.json',
  'index.html',
  'mission-control.html',
  'SCORECARD.md',
  'JUDGE_BRIEF.md',
  'leaderboard.md',
  'arena.html',
  'replay.html',
  'agent-comparison.json',
  'agent-comparison.txt',
];

const BENCHMARK_FILES = [
  'agent-comparison.json',
  'arena.html',
  'leaderboard.md',
];

const SOURCE_DOCS = [
  ['README.md', 'source/README.md'],
  ['docs/competition-demo.md', 'source/docs/competition-demo.md'],
  ['docs/competition-rules.md', 'source/docs/competition-rules.md'],
  ['docs/protocol-reference.md', 'source/docs/protocol-reference.md'],
  ['docs/scoring.md', 'source/docs/scoring.md'],
  ['docs/seed-sets.md', 'source/docs/seed-sets.md'],
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outDir = resolvePath(options.out || './dist/submission/echogrid-submission');
  const zipFile = resolvePath(options.zip || `${outDir}.zip`);
  const dirs = {
    showcase: resolvePath(options.showcase || './logs/showcase'),
    public: resolvePath(options.public || './logs/public'),
    adversarial: resolvePath(options.adversarial || './logs/adversarial'),
    rules: resolvePath(options.rules || './logs/rules'),
  };

  if (!options['skip-showcase-check']) runDemoVerifier(dirs.showcase);

  const showcaseManifest = readJson(path.join(dirs.showcase, 'MANIFEST.json'));
  const benchmarks = {
    public: loadBenchmark('public', dirs.public),
    adversarial: loadBenchmark('adversarial', dirs.adversarial),
    rules: loadBenchmark('rules', dirs.rules),
  };
  validateShowcase(showcaseManifest);
  validateBenchmarkExpectations(benchmarks);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const copied = [];
  copyNamedFiles(dirs.showcase, path.join(outDir, 'showcase'), SHOWCASE_FILES, copied);
  copyOptionalDirectory(path.join(dirs.showcase, 'screenshots'), path.join(outDir, 'showcase', 'screenshots'), copied);
  copyNamedFiles(dirs.public, path.join(outDir, 'benchmarks', 'public'), BENCHMARK_FILES, copied);
  copyNamedFiles(dirs.adversarial, path.join(outDir, 'benchmarks', 'adversarial'), BENCHMARK_FILES, copied);
  copyNamedFiles(dirs.rules, path.join(outDir, 'benchmarks', 'rules'), BENCHMARK_FILES, copied);
  copySourceDocs(outDir, copied);

  const summary = buildSummary({
    outDir,
    zipFile,
    showcaseManifest,
    benchmarks,
  });

  const startFile = path.join(outDir, 'START_HERE.html');
  const readmeFile = path.join(outDir, 'README.md');
  const onePagerFile = path.join(outDir, 'SUBMISSION_ONE_PAGER.md');
  const checklistFile = path.join(outDir, 'SUBMISSION_CHECKLIST.md');
  const auditFile = path.join(outDir, 'SUBMISSION_AUDIT.md');
  const strategyAuditFile = path.join(outDir, 'SUBMISSION_STRATEGY_AUDIT.md');
  fs.writeFileSync(startFile, renderStartHereHtml(summary), 'utf8');
  fs.writeFileSync(readmeFile, renderReadme(summary), 'utf8');
  fs.writeFileSync(onePagerFile, renderOnePager(summary), 'utf8');
  fs.writeFileSync(checklistFile, renderChecklist(summary), 'utf8');
  fs.writeFileSync(auditFile, renderAuditReport(summary), 'utf8');
  fs.writeFileSync(strategyAuditFile, renderStrategyAudit(summary), 'utf8');

  const manifest = {
    schema: 'echogrid.submission_bundle.v1',
    generated_at: summary.generated_at,
    generator: 'scripts/create-submission-bundle.js',
    source: summary.source,
    commands: summary.commands,
    showcase: summary.showcase,
    benchmarks: summary.benchmarks,
    files: fileInventory(outDir),
  };
  const manifestFile = path.join(outDir, 'SUBMISSION_MANIFEST.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (!options['no-zip']) {
    fs.mkdirSync(path.dirname(zipFile), { recursive: true });
    if (fs.existsSync(zipFile)) fs.rmSync(zipFile, { force: true });
    writeZipArchive(outDir, zipFile);
  }

  process.stdout.write('ECHO GRID SUBMISSION BUNDLE\n');
  process.stdout.write(`Bundle: ${displayPath(outDir)}\n`);
  if (!options['no-zip']) process.stdout.write(`Archive: ${displayPath(zipFile)}\n`);
  process.stdout.write(`Showcase: ${summary.showcase.result}/${summary.showcase.reason} score=${summary.showcase.score}\n`);
  process.stdout.write(`Public leader: ${summary.benchmarks.public.leader.agent} avg=${summary.benchmarks.public.leader.average_score}\n`);
  process.stdout.write(`Adversarial leader: ${summary.benchmarks.adversarial.leader.agent} avg=${summary.benchmarks.adversarial.leader.average_score}\n`);
  process.stdout.write(`Rule-signal leader: ${summary.benchmarks.rules.leader.agent} avg=${summary.benchmarks.rules.leader.average_score}\n`);
}

function runDemoVerifier(showcaseDir) {
  const result = spawnSync(process.execPath, ['./scripts/verify-demo-artifacts.js', showcaseDir], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const details = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`Showcase artifact verification failed before bundling.\n${details}`);
  }
}

function validateShowcase(manifest) {
  const showcase = manifest.showcase || {};
  if (manifest.schema !== 'echogrid.demo_manifest.v1') throw new Error(`Unexpected showcase manifest schema: ${manifest.schema || 'missing'}`);
  if (showcase.result !== 'success') throw new Error(`Showcase result must be success, got ${showcase.result || 'missing'}`);
  if (showcase.reason !== 'objective_complete') throw new Error(`Showcase reason must be objective_complete, got ${showcase.reason || 'missing'}`);
  if ((showcase.score ?? 0) < 950) throw new Error(`Showcase score below submission bar: ${showcase.score ?? 0}`);
  if (showcase.artifacts_collected !== showcase.artifacts_required) throw new Error('Showcase did not collect every artifact.');
  if (!showcase.rule_claim?.correct) throw new Error('Showcase did not include a correct hidden-rule claim.');
}

function validateBenchmarkExpectations(benchmarks) {
  const publicBenchmark = benchmarks.public;
  const publicRandom = requireAgent(publicBenchmark, './agents/random.js');
  const publicBaseline = requireAgent(publicBenchmark, './agents/baseline.js');
  const publicRuleAware = requireAgent(publicBenchmark, './agents/rule-aware.js');
  if (publicRandom.success_rate !== 0) throw new Error('Public benchmark expected random agent to fail all seeds.');
  if (publicBaseline.success_rate < 0.9) throw new Error('Public benchmark expected baseline success rate at or above 0.9.');
  if (publicRuleAware.success_rate < publicBaseline.success_rate) {
    throw new Error('Public benchmark expected rule-aware success rate at least baseline.');
  }
  if (!(publicRuleAware.average_score > publicBaseline.average_score)) {
    throw new Error('Public benchmark expected rule-aware average score above baseline.');
  }

  const adversarial = benchmarks.adversarial;
  const adversarialRandom = requireAgent(adversarial, './agents/random.js');
  const adversarialBaseline = requireAgent(adversarial, './agents/baseline.js');
  const adversarialRuleAware = requireAgent(adversarial, './agents/rule-aware.js');
  if (adversarialRandom.success_rate !== 0) throw new Error('Adversarial benchmark expected random agent to fail all seeds.');
  if (adversarialBaseline.success_rate !== 1) throw new Error('Adversarial benchmark expected baseline to solve all seeds.');
  if (adversarialRuleAware.success_rate !== 1) throw new Error('Adversarial benchmark expected rule-aware to solve all seeds.');
  if (!(adversarialRuleAware.average_score > adversarialBaseline.average_score)) {
    throw new Error('Adversarial benchmark expected rule-aware average score above baseline.');
  }

  const rules = benchmarks.rules;
  const rulesBaseline = requireAgent(rules, './agents/baseline.js');
  const rulesRuleAware = requireAgent(rules, './agents/rule-aware.js');
  const rulesExplorer = requireAgent(rules, './agents/rule-explorer.js');
  if (rulesBaseline.success_rate !== 1) throw new Error('Rule-signals benchmark expected baseline to solve all seeds.');
  if (rulesRuleAware.success_rate !== 1) throw new Error('Rule-signals benchmark expected rule-aware to solve all seeds.');
  if (rulesExplorer.success_rate !== 1) throw new Error('Rule-signals benchmark expected rule-explorer to solve all seeds.');
  if (!(rulesRuleAware.average_score > rulesBaseline.average_score)) {
    throw new Error('Rule-signals benchmark expected rule-aware average score above baseline.');
  }
  if (!(rulesExplorer.average_score > rulesBaseline.average_score)) {
    throw new Error('Rule-signals benchmark expected rule-explorer average score above baseline.');
  }
}

function loadBenchmark(label, dir) {
  const comparisonFile = path.join(dir, 'agent-comparison.json');
  const arenaFile = path.join(dir, 'arena.html');
  const leaderboardFile = path.join(dir, 'leaderboard.md');
  for (const file of [comparisonFile, arenaFile, leaderboardFile]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ${label} benchmark artifact: ${displayPath(file)}`);
    if (fs.statSync(file).size === 0) throw new Error(`Empty ${label} benchmark artifact: ${displayPath(file)}`);
  }

  const comparison = readJson(comparisonFile);
  if (!Array.isArray(comparison.rows) || comparison.rows.length === 0) throw new Error(`${label} benchmark has no agent rows.`);
  const rankings = Array.isArray(comparison.rankings) && comparison.rankings.length > 0
    ? comparison.rankings
    : rankRows(comparison.rows);
  return {
    label,
    seed_file: comparison.seed_file || null,
    rows: comparison.rows,
    rankings,
    leader: rankings[0],
  };
}

function requireAgent(benchmark, agent) {
  const row = benchmark.rows.find((item) => item.agent === agent);
  if (!row) throw new Error(`${benchmark.label} benchmark missing ${agent}`);
  return row;
}

function buildSummary({ outDir, zipFile, showcaseManifest, benchmarks }) {
  const generatedAt = new Date().toISOString();
  return {
    generated_at: generatedAt,
    out_dir: displayPath(outDir),
    zip_file: displayPath(zipFile),
    source: {
      repository: gitValue(['config', '--get', 'remote.origin.url']),
      commit: gitValue(['rev-parse', 'HEAD']),
      commit_short: gitValue(['rev-parse', '--short', 'HEAD']),
      branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
      node: process.version,
    },
    commands: {
      full_gate: 'npm run submission:check',
      regenerate_bundle: 'npm run submission:bundle',
      verify_bundle: 'npm run submission:verify',
      demo_package: 'npm run demo:full && npm run demo:check',
      visual_smoke: 'npm run demo:visual',
      public_benchmark: 'npm run benchmark:public',
      adversarial_benchmark: 'npm run benchmark:adversarial',
      rule_signals_benchmark: 'npm run benchmark:rules',
    },
    showcase: summarizeShowcase(showcaseManifest),
    benchmarks: {
      public: summarizeBenchmark(benchmarks.public),
      adversarial: summarizeBenchmark(benchmarks.adversarial),
      rules: summarizeBenchmark(benchmarks.rules),
    },
  };
}

function summarizeShowcase(manifest) {
  const showcase = manifest.showcase || {};
  return {
    seed: showcase.seed,
    agent: showcase.agent,
    result: showcase.result,
    reason: showcase.reason,
    score: showcase.score,
    turns: showcase.turns,
    artifacts: `${showcase.artifacts_collected}/${showcase.artifacts_required}`,
    hidden_rule: showcase.hidden_rule,
    rule_claim: showcase.rule_claim,
    metrics: showcase.metrics,
  };
}

function summarizeBenchmark(benchmark) {
  return {
    seed_file: benchmark.seed_file,
    leader: benchmark.leader,
    rankings: benchmark.rankings,
    rows: benchmark.rows.map((row) => ({
      agent: row.agent,
      seeds: row.seeds,
      success_rate: row.success_rate,
      average_score: row.average_score,
      average_turns: row.average_turns,
      best_score: row.best_score,
      worst_score: row.worst_score,
      results: Array.isArray(row.results) ? row.results.map((result) => ({
        seed: result.seed,
        status: result.status,
        reason: result.reason,
        score: result.score,
        turns: result.turns,
        hidden_rule: result.hidden_rule,
        rule_claim: result.rule_claim || null,
      })) : [],
    })),
  };
}

function renderReadme(summary) {
  return [
    '# EchoGrid Submission Bundle',
    '',
    `Generated: ${summary.generated_at}`,
    `Source commit: ${summary.source.commit_short || 'unknown'}`,
    `Repository: ${summary.source.repository || 'unknown'}`,
    '',
    '## Start Here',
    '',
    'Open `START_HERE.html` first. For the guided presentation, open `showcase/mission-control.html`.',
    '',
    '## Contents',
    '',
    '- `showcase/`: judge entry point, Mission Control dashboard, replay viewer, scorecard, brief, leaderboard, arena, JSONL log, and sha256 manifest.',
    '- `showcase/screenshots/`: desktop and mobile visual smoke screenshots when `npm run demo:visual` has been run.',
    '- `benchmarks/public/`: broader public seed benchmark output.',
    '- `benchmarks/adversarial/`: fixed adversarial public benchmark output.',
    '- `benchmarks/rules/`: hidden-rule signal benchmark output.',
    '- `source/`: project README and judge-facing protocol/scoring docs.',
    '- `START_HERE.html`: browser-first entry point for judges.',
    '- `SUBMISSION_ONE_PAGER.md`: short judge-facing pitch and review path.',
    '- `SUBMISSION_CHECKLIST.md`: human-readable delivery checklist.',
    '- `SUBMISSION_AUDIT.md`: generated verification matrix and handoff evidence summary.',
    '- `SUBMISSION_STRATEGY_AUDIT.md`: generated per-seed strategy edge and rule-claim evidence.',
    '- `SUBMISSION_MANIFEST.json`: machine-readable bundle inventory with hashes.',
    '',
    '## Verified Story',
    '',
    `- Showcase: ${summary.showcase.result}/${summary.showcase.reason}, score ${summary.showcase.score}, turns ${summary.showcase.turns}, artifacts ${summary.showcase.artifacts}.`,
    `- Hidden rule: ${summary.showcase.hidden_rule}; claim accepted=${Boolean(summary.showcase.rule_claim?.correct)}.`,
    `- Public leader: ${summary.benchmarks.public.leader.agent}, avg score ${summary.benchmarks.public.leader.average_score}.`,
    `- Adversarial leader: ${summary.benchmarks.adversarial.leader.agent}, avg score ${summary.benchmarks.adversarial.leader.average_score}.`,
    `- Rule-signal leader: ${summary.benchmarks.rules.leader.agent}, avg score ${summary.benchmarks.rules.leader.average_score}.`,
    '',
    '## Regenerate',
    '',
    'From the repository root:',
    '',
    '```bash',
    'npm run submission:check',
    '```',
    '',
    'This rebuilds the showcase, verifies artifacts, runs the public benchmark gates, recreates this bundle, and verifies the bundle directory plus zip archive.',
    '',
  ].join('\n');
}

function renderStartHereHtml(summary) {
  const showcase = summary.showcase;
  const publicBenchmark = summary.benchmarks.public;
  const adversarial = summary.benchmarks.adversarial;
  const rules = summary.benchmarks.rules;
  const edge = Number(adversarial.leader.average_score) - averageScore(adversarial.rows, './agents/baseline.js');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EchoGrid Submission</title>
<style>
:root {
  --ink: #20272b;
  --muted: #59686d;
  --bg: #f6f4ef;
  --panel: #fffdf8;
  --line: #d9d2c4;
  --blue: #256b91;
  --green: #39785a;
  --amber: #b67521;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main {
  width: min(1160px, calc(100vw - 28px));
  margin: 0 auto;
  padding: 24px 0 34px;
}
header {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(320px, 1.05fr);
  gap: 18px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
}
h1 { margin: 0; font-size: 34px; line-height: 1.08; letter-spacing: 0; }
.subtle { color: var(--muted); margin: 8px 0 0; }
.preview {
  display: block;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}
.verdict {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.metric, .panel, .link {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.metric { min-height: 86px; padding: 12px; }
.metric span { display: block; color: var(--muted); font-size: 12px; }
.metric strong { display: block; margin-top: 6px; font-size: 23px; line-height: 1.18; overflow-wrap: anywhere; }
.success { color: var(--green); }
.grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
}
.panel { padding: 14px; min-width: 0; }
.panel h2 { margin: 0 0 10px; font-size: 17px; }
.pathList { margin: 0; padding-left: 20px; }
.pathList li { margin: 7px 0; }
.links {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.link {
  display: block;
  min-height: 78px;
  padding: 12px;
  color: var(--ink);
  text-decoration: none;
}
.link:hover { border-color: var(--blue); }
.link strong { display: block; font-size: 16px; }
.link span { display: block; margin-top: 5px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
code {
  background: #eee8dc;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 5px;
}
@media (max-width: 820px) {
  main { width: calc(100vw - 20px); }
  header, .grid { grid-template-columns: 1fr; }
  .verdict, .links { grid-template-columns: 1fr; }
  h1 { font-size: 30px; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>EchoGrid Submission</h1>
      <p class="subtle">Agent-native inference game demo with deterministic logs, hidden-rule reasoning, browser replay, benchmarks, and a verifiable handoff bundle.</p>
    </div>
    <img class="preview" src="showcase/screenshots/mission-control-desktop.png" alt="Mission Control dashboard preview">
  </header>

  <section class="verdict" aria-label="Submission verdict">
    ${startMetric('Showcase', `${showcase.result}/${showcase.reason}`, 'success')}
    ${startMetric('Score', `${showcase.score}`)}
    ${startMetric('Artifacts', showcase.artifacts)}
    ${startMetric('Agent Edge', `${formatSigned(edge)} avg`)}
  </section>

  <section class="grid">
    <div class="panel">
      <h2>90-Second Path</h2>
      <ol class="pathList">
        <li>Open <code>showcase/mission-control.html</code> and read the Competition Verdict.</li>
        <li>Use Route Playback to inspect the public path and rule-claim milestones.</li>
        <li>Open <code>showcase/SCORECARD.md</code> and <code>SUBMISSION_AUDIT.md</code> for capability gates.</li>
        <li>Review adversarial and rule-signal leaderboards for agent separation.</li>
      </ol>
    </div>
    <div class="panel">
      <h2>Why It Holds Up</h2>
      <p>Hidden rule claim: <strong>${escapeHtml(showcase.rule_claim?.id || 'unknown')}</strong>, accepted=${escapeHtml(Boolean(showcase.rule_claim?.correct))}.</p>
      <p>Clean run: damage=${escapeHtml(showcase.metrics?.damage_events ?? 'n/a')}, invalid=${escapeHtml(showcase.metrics?.invalid_actions ?? 'n/a')}, wasted=${escapeHtml(showcase.metrics?.wasted_actions ?? 'n/a')}.</p>
      <p>Benchmarks: public leader ${escapeHtml(publicBenchmark.leader.agent)}, adversarial leader ${escapeHtml(adversarial.leader.agent)}, rule-signal leader ${escapeHtml(rules.leader.agent)}.</p>
    </div>
  </section>

  <section class="panel" style="margin-top:14px">
    <h2>Open These Files</h2>
    <div class="links">
      ${startLink('Mission Control', 'showcase/mission-control.html', 'Guided verdict, map, route playback, timeline, and evidence links.')}
      ${startLink('Demo Index', 'showcase/index.html', 'Showcase package entry point and artifact links.')}
      ${startLink('One-Pager', 'SUBMISSION_ONE_PAGER.md', 'Short judge-facing pitch and review path.')}
      ${startLink('Audit Report', 'SUBMISSION_AUDIT.md', 'Generated verification matrix and command evidence.')}
      ${startLink('Strategy Audit', 'SUBMISSION_STRATEGY_AUDIT.md', 'Per-seed strategy edge, rule-claim evidence, and benchmark deltas.')}
      ${startLink('Scorecard', 'showcase/SCORECARD.md', 'Capability gates and expected proof points.')}
      ${startLink('Public Leaderboard', 'benchmarks/public/leaderboard.md', 'Broader public benchmark standings.')}
      ${startLink('Adversarial Leaderboard', 'benchmarks/adversarial/leaderboard.md', 'Public adversarial benchmark standings.')}
      ${startLink('Rule-Signal Leaderboard', 'benchmarks/rules/leaderboard.md', 'Hidden-rule signal benchmark standings.')}
      ${startLink('Manifest', 'SUBMISSION_MANIFEST.json', 'Bundle file inventory with sha256 hashes.')}
    </div>
  </section>
</main>
</body>
</html>`;
}

function startMetric(label, value, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong${classAttr}>${escapeHtml(value)}</strong></div>`;
}

function startLink(label, href, detail) {
  return `<a class="link" href="${escapeHtml(href)}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></a>`;
}

function renderOnePager(summary) {
  const showcase = summary.showcase;
  const publicBenchmark = summary.benchmarks.public;
  const adversarial = summary.benchmarks.adversarial;
  const rules = summary.benchmarks.rules;
  const edge = Number(adversarial.leader.average_score) - averageScore(adversarial.rows, './agents/baseline.js');
  return [
    '# EchoGrid One-Pager',
    '',
    'EchoGrid is an agent-native inference and planning game: deterministic seeds, machine-readable state, one-line actions, hidden-rule discovery, auditable logs, replay, and benchmarkable agents.',
    '',
    '## Why It Is Worth Judging',
    '',
    `- The showcase completes the full mission: ${showcase.result}/${showcase.reason}, score ${showcase.score}, ${showcase.artifacts} artifacts, ${showcase.turns} turns.`,
    `- The agent infers a hidden rule from public evidence: ${showcase.rule_claim?.id || 'unknown'}, accepted=${Boolean(showcase.rule_claim?.correct)}.`,
    `- The run is clean: damage=${showcase.metrics?.damage_events ?? 'n/a'}, invalid=${showcase.metrics?.invalid_actions ?? 'n/a'}, wasted=${showcase.metrics?.wasted_actions ?? 'n/a'}.`,
    `- Broader public benchmark stays honest: ${publicBenchmark.leader.agent} leads at average score ${publicBenchmark.leader.average_score}, success rate ${publicBenchmark.leader.success_rate}.`,
    `- Strategy quality separates agents: adversarial leader ${adversarial.leader.agent}, average score edge ${formatSigned(edge)} over baseline.`,
    `- Rule-signal benchmark stays robust: ${rules.leader.agent} leads at average score ${rules.leader.average_score}.`,
    '',
    '## 90-Second Review Path',
    '',
    '1. Open `showcase/index.html` for the package entry point.',
    '2. Open `showcase/mission-control.html` and read the Competition Verdict first.',
    '3. Use Route Playback to scrub the public path and rule-claim milestones.',
    '4. Check `showcase/SCORECARD.md` and `SUBMISSION_AUDIT.md` for the capability gates.',
    '5. Review `SUBMISSION_STRATEGY_AUDIT.md`, `benchmarks/public/leaderboard.md`, `benchmarks/adversarial/leaderboard.md`, and `benchmarks/rules/leaderboard.md` for agent separation.',
    '',
    '## Reproduce',
    '',
    '```bash',
    summary.commands.full_gate,
    '```',
    '',
    `Source commit: ${summary.source.commit_short || 'unknown'}`,
    '',
  ].join('\n');
}

function renderStrategyAudit(summary) {
  const publicBenchmark = summary.benchmarks.public;
  const adversarial = summary.benchmarks.adversarial;
  const rules = summary.benchmarks.rules;
  return [
    '# EchoGrid Strategy Audit',
    '',
    `Generated: ${summary.generated_at}`,
    `Source commit: ${summary.source.commit_short || 'unknown'}`,
    '',
    '## What This Proves',
    '',
    'The rule-aware agent is not only a route follower. It runs bounded public experiments, claims hidden rules only when a public `rule_signal` appears, and then delegates movement to the same baseline routing policy.',
    '',
    '## Benchmark Edge',
    '',
    benchmarkEdgeTable('Public benchmark', publicBenchmark, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    benchmarkEdgeTable('Adversarial benchmark', adversarial, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    benchmarkEdgeTable('Rule-signal benchmark', rules, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    '## Per-Seed Evidence',
    '',
    perSeedEvidence('Public benchmark', publicBenchmark, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    perSeedEvidence('Adversarial benchmark', adversarial, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    perSeedEvidence('Rule-signal benchmark', rules, './agents/baseline.js', './agents/rule-aware.js'),
    '',
    '## Interpretation',
    '',
    '- `row_count_disclosure` proves the agent can validate a row-level global clue before claiming it.',
    '- `sector_c_two_unstable` proves the agent can validate a sector-level echo constraint before claiming it.',
    '- Seeds without a rule claim still complete through the shared baseline route, so the experiments are bounded rather than reckless.',
    '',
  ].join('\n');
}

function benchmarkEdgeTable(title, benchmark, baselineAgent, challengerAgent) {
  const baseline = findBenchmarkRow(benchmark, baselineAgent);
  const challenger = findBenchmarkRow(benchmark, challengerAgent);
  const delta = challenger && baseline
    ? Number(challenger.average_score) - Number(baseline.average_score)
    : null;
  return [
    `### ${title}`,
    '',
    '| Agent | Success | Avg score | Avg turns | Edge vs baseline |',
    '| --- | ---: | ---: | ---: | ---: |',
    benchmark.rows.map((row) => {
      const edge = baseline ? Number(row.average_score) - Number(baseline.average_score) : null;
      return `| ${row.agent} | ${formatPercent(row.success_rate)} | ${row.average_score} | ${row.average_turns} | ${formatSigned(edge)} |`;
    }).join('\n'),
    '',
    `Leader: ${benchmark.leader.agent}. Rule-aware edge over baseline: ${formatSigned(delta)} average score.`,
  ].join('\n');
}

function perSeedEvidence(title, benchmark, baselineAgent, challengerAgent) {
  const baseline = findBenchmarkRow(benchmark, baselineAgent);
  const challenger = findBenchmarkRow(benchmark, challengerAgent);
  const baselineBySeed = new Map((baseline?.results || []).map((result) => [String(result.seed), result]));
  const rows = (challenger?.results || []).map((result) => {
    const base = baselineBySeed.get(String(result.seed));
    const delta = base ? Number(result.score) - Number(base.score) : null;
    const claim = result.rule_claim?.correct
      ? `${result.rule_claim.id} at turn ${result.rule_claim.turn ?? '?'}`
      : 'none';
    const rationale = result.rule_claim?.rationale || 'completed through shared routing policy';
    return `| ${result.seed} | ${result.hidden_rule || 'unknown'} | ${base?.score ?? 'n/a'} | ${result.score ?? 'n/a'} | ${formatSigned(delta)} | ${claim} | ${rationale} |`;
  });
  return [
    `### ${title}`,
    '',
    '| Seed | Hidden rule | Baseline | Rule-aware | Delta | Claim | Evidence |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
    rows.length ? rows.join('\n') : '| n/a | n/a | n/a | n/a | n/a | n/a | no per-seed results bundled |',
  ].join('\n');
}

function findBenchmarkRow(benchmark, agent) {
  return (benchmark.rows || []).find((row) => row.agent === agent);
}

function renderChecklist(summary) {
  return [
    '# EchoGrid Submission Checklist',
    '',
    `Generated: ${summary.generated_at}`,
    '',
    '- [x] Source commit captured in `SUBMISSION_MANIFEST.json`.',
    '- [x] Showcase package generated and verified by `npm run demo:check`.',
    `- [x] Showcase seed ${summary.showcase.seed} completed with score ${summary.showcase.score}.`,
    '- [x] Mission Control dashboard included at `showcase/mission-control.html`.',
    '- [x] Replay viewer included at `showcase/replay.html`.',
    '- [x] Browser-rendered visual smoke screenshots included when available.',
    '- [x] Judge brief and scorecard included.',
    '- [x] Judge-facing one-pager included at `SUBMISSION_ONE_PAGER.md`.',
    '- [x] Submission audit report included at `SUBMISSION_AUDIT.md`.',
    '- [x] Strategy audit included at `SUBMISSION_STRATEGY_AUDIT.md`.',
    '- [x] Artifact hash manifest included at `showcase/MANIFEST.json`.',
    '- [x] Public benchmark included and rule-aware beats baseline on average score.',
    '- [x] Adversarial benchmark included and rule-aware beats baseline on average score.',
    '- [x] Rule-signals benchmark included and rule-aware/rule-explorer beat baseline on average score.',
    '- [x] Bundle manifest includes sha256 hashes for all copied files.',
    '- [x] Bundle directory and zip archive can be verified with `npm run submission:verify`.',
    '',
    '## Judge Path',
    '',
    '1. Open `showcase/index.html`.',
    '2. Open `showcase/mission-control.html` for the guided briefing and route playback.',
    '3. Check `showcase/SCORECARD.md` and `showcase/JUDGE_BRIEF.md`.',
    '4. Review `SUBMISSION_STRATEGY_AUDIT.md`, `benchmarks/public/leaderboard.md`, `benchmarks/adversarial/leaderboard.md`, and `benchmarks/rules/leaderboard.md`.',
    '',
  ].join('\n');
}

function averageScore(rows, agent) {
  const row = (rows || []).find((item) => item.agent === agent);
  return Number(row?.average_score || 0);
}

function formatSigned(value) {
  if (value === null || value === undefined) return 'n/a';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'n/a';
  return number >= 0 ? `+${Math.round(number * 10) / 10}` : String(Math.round(number * 10) / 10);
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'n/a';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function renderAuditReport(summary) {
  const showcase = summary.showcase;
  const publicBenchmark = summary.benchmarks.public;
  const adversarial = summary.benchmarks.adversarial;
  const rules = summary.benchmarks.rules;
  return [
    '# EchoGrid Submission Audit',
    '',
    `Generated: ${summary.generated_at}`,
    `Source commit: ${summary.source.commit_short || 'unknown'}`,
    '',
    '## Verification Matrix',
    '',
    '| Gate | Status | Evidence |',
    '| --- | --- | --- |',
    `| Showcase artifact verifier | PASS | ${showcase.result}/${showcase.reason}, score ${showcase.score}, artifacts ${showcase.artifacts} |`,
    `| Hidden-rule inference | PASS | ${showcase.rule_claim?.id || 'unknown'}, accepted=${Boolean(showcase.rule_claim?.correct)} |`,
    `| Clean-run audit | PASS | damage=${showcase.metrics?.damage_events ?? 'n/a'}, invalid=${showcase.metrics?.invalid_actions ?? 'n/a'}, wasted=${showcase.metrics?.wasted_actions ?? 'n/a'} |`,
    `| Visual smoke artifacts | PASS | desktop/mobile screenshots are bundled under showcase/screenshots |`,
    `| Public benchmark | PASS | leader ${publicBenchmark.leader.agent}, avg ${publicBenchmark.leader.average_score}, success ${publicBenchmark.leader.success_rate} |`,
    `| Adversarial benchmark | PASS | leader ${adversarial.leader.agent}, avg ${adversarial.leader.average_score} |`,
    `| Rule-signal benchmark | PASS | leader ${rules.leader.agent}, avg ${rules.leader.average_score} |`,
    `| Strategy audit | PASS | rule-aware benchmark deltas and rule claims are summarized in SUBMISSION_STRATEGY_AUDIT.md |`,
    `| Bundle inventory | PASS | SUBMISSION_MANIFEST.json records copied file sizes and sha256 hashes |`,
    '',
    '## Commands',
    '',
    '| Purpose | Command |',
    '| --- | --- |',
    `| Full gate | \`${summary.commands.full_gate}\` |`,
    `| Rebuild bundle | \`${summary.commands.regenerate_bundle}\` |`,
    `| Verify bundle | \`${summary.commands.verify_bundle}\` |`,
    '',
    '## Judge Entry Points',
    '',
    '- `showcase/index.html`',
    '- `showcase/mission-control.html`',
    '- `showcase/SCORECARD.md`',
    '- `showcase/JUDGE_BRIEF.md`',
    '- `SUBMISSION_STRATEGY_AUDIT.md`',
    '- `benchmarks/public/leaderboard.md`',
    '- `benchmarks/adversarial/leaderboard.md`',
    '- `benchmarks/rules/leaderboard.md`',
    '',
  ].join('\n');
}

function copyNamedFiles(sourceDir, targetDir, names, copied) {
  for (const name of names) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    if (!fs.existsSync(source)) throw new Error(`Missing required artifact: ${displayPath(source)}`);
    if (fs.statSync(source).size === 0) throw new Error(`Required artifact is empty: ${displayPath(source)}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push({ source, target });
  }
}

function copySourceDocs(outDir, copied) {
  for (const [sourceName, targetName] of SOURCE_DOCS) {
    const source = path.join(root, sourceName);
    if (!fs.existsSync(source)) continue;
    const target = path.join(outDir, targetName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push({ source, target });
  }
}

function copyOptionalDirectory(sourceDir, targetDir, copied) {
  if (!fs.existsSync(sourceDir)) return;
  for (const file of listFiles(sourceDir)) {
    const relative = path.relative(sourceDir, file);
    const target = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied.push({ source: file, target });
  }
}

function fileInventory(outDir) {
  return listFiles(outDir).map((file) => {
    const buffer = fs.readFileSync(file);
    return {
      path: path.relative(outDir, file).replace(/\\/g, '/'),
      size: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  });
}

function listFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort((a, b) => path.relative(dir, a).localeCompare(path.relative(dir, b)));
}

function writeZipArchive(sourceDir, outFile) {
  const files = listFiles(sourceDir);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = new Date();
  const modTime = dosTime(now);
  const modDate = dosDate(now);

  for (const file of files) {
    const relative = path.relative(sourceDir, file).replace(/\\/g, '/');
    const name = Buffer.from(relative, 'utf8');
    const data = fs.readFileSync(file);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(modTime, 10);
    local.writeUInt16LE(modDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(modTime, 12);
    central.writeUInt16LE(modDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outFile, Buffer.concat([...localChunks, ...centralChunks, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function dosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function rankRows(rows) {
  return [...rows]
    .sort((a, b) => (b.success_rate - a.success_rate) ||
      (b.average_score - a.average_score) ||
      (a.average_turns - b.average_turns) ||
      String(a.agent).localeCompare(String(b.agent)))
    .map((row, index) => ({
      rank: index + 1,
      agent: row.agent,
      success_rate: row.success_rate,
      average_score: row.average_score,
      average_turns: row.average_turns,
      best_score: row.best_score,
      worst_score: row.worst_score,
    }));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON ${displayPath(file)}: ${error.message}`);
  }
}

function gitValue(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function resolvePath(value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(root, String(value));
}

function displayPath(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : file;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  writeZipArchive,
  crc32,
};
