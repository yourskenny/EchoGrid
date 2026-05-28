'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { EchoGridGame } = require('../src/engine');
const { buildStateSummary } = require('../agents/llm-openai-compatible');
const { verifyLocalHtmlLinks, verifySourceCommit } = require('../scripts/verify-submission-bundle');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'echogrid.js');

test('scripted run emits compact STATE and ACTION records', () => {
  const result = spawnSync(process.execPath, [cli, 'run', '--seed', '48129', '--script', './scripts/sample.eg'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const stateLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('STATE '));
  const actionLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('ACTION '));
  assert.ok(stateLines.length >= 2);
  assert.ok(actionLines.length >= 1);
  const state = JSON.parse(stateLines[0].slice('STATE '.length));
  assert.equal(state.protocol, 'echogrid.state.v1');
  assert.equal(state.coordinate_system, 'zero_based');
});

test('baseline agent can complete a known public seed through evaluate', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/baseline.js', '--seed', '48129', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.aggregate.seeds, 1);
  assert.equal(output.aggregate.successes, 1);
  assert.equal(output.results[0].status, 'success');
});

test('demo agents produce a judge-friendly comparison curve', () => {
  const baseline = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/baseline.js', '--seeds', './seeds/demo.txt', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  const ruleAware = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/rule-aware.js', '--seeds', './seeds/demo.txt', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  );

  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(ruleAware.status, 0, ruleAware.stderr);
  const baselineOutput = JSON.parse(baseline.stdout);
  const ruleAwareOutput = JSON.parse(ruleAware.stdout);
  assert.equal(baselineOutput.aggregate.successes, baselineOutput.aggregate.seeds);
  assert.equal(ruleAwareOutput.aggregate.successes, ruleAwareOutput.aggregate.seeds);
  assert.ok(ruleAwareOutput.aggregate.average_score > baselineOutput.aggregate.average_score);
  assert.ok(Math.min(...baselineOutput.results.map((item) => item.score)) > 0);
  assert.ok(Math.min(...ruleAwareOutput.results.map((item) => item.score)) > 0);
});

test('rule explorer claims row-count disclosure from public scan signal', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/rule-explorer.js', '--seed', '44', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const row = output.results[0];
  assert.equal(row.status, 'success');
  assert.equal(row.hidden_rule, 'row_count_disclosure');
  assert.equal(row.rule_claim.id, 'row_count_disclosure');
  assert.equal(row.rule_claim.correct, true);
  assert.match(row.rule_claim.rationale, /row 2 scan disclosed/);
});

test('rule-aware agent claims row-count disclosure after bounded experiments', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/rule-aware.js', '--seed', '44', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const row = output.results[0];
  assert.equal(row.status, 'success');
  assert.equal(row.hidden_rule, 'row_count_disclosure');
  assert.equal(row.rule_claim.id, 'row_count_disclosure');
  assert.equal(row.rule_claim.correct, true);
  assert.match(row.rule_claim.rationale, /row 2 scan disclosed/);
});

test('persistent agent mode matches one-shot baseline results', () => {
  const oneShot = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/baseline.js', '--seed', '9001', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  const persistent = spawnSync(
    process.execPath,
    [cli, 'evaluate', '--agent', './agents/baseline-persistent.js', '--seed', '9001', '--agent-mode', 'persistent', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  assert.equal(oneShot.status, 0, oneShot.stderr);
  assert.equal(persistent.status, 0, persistent.stderr);
  assert.deepEqual(JSON.parse(persistent.stdout), JSON.parse(oneShot.stdout));
});

test('evaluate can write summary file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const summaryFile = path.join(tmp, 'summary.json');
    const result = spawnSync(
      process.execPath,
      [cli, 'evaluate', '--agent', './agents/baseline.js', '--seed', '9001', '--mode', 'micro', '--json', '--summary-file', summaryFile],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    assert.equal(summary.aggregate.seeds, 1);
    assert.equal(summary.results[0].seed, '9001');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('report command summarizes a JSONL run log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logFile = path.join(tmp, 'sample.jsonl');
    const run = spawnSync(process.execPath, [cli, 'run', '--seed', '48129', '--script', './scripts/sample.eg', '--log', logFile], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);

    const report = spawnSync(process.execPath, [cli, 'report', logFile], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /ECHO GRID BATTLE REPORT/);
    assert.match(report.stdout, /Seed: 48129/);
    assert.match(report.stdout, /SCORE BREAKDOWN/);
    assert.match(report.stdout, /KEY EVENTS/);
    assert.match(report.stdout, /TRANSFERABLE LESSON/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('render replay html creates a self-contained viewer', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logDir = path.join(tmp, 'logs');
    const outFile = path.join(tmp, 'replay.html');
    const arenaFile = path.join(tmp, 'arena.html');
    const leaderboardFile = path.join(tmp, 'leaderboard.md');
    const comparisonFile = path.join(tmp, 'agent-comparison.txt');
    const comparisonJsonFile = path.join(tmp, 'agent-comparison.json');
    const briefFile = path.join(tmp, 'JUDGE_BRIEF.md');
    const indexFile = path.join(tmp, 'index.html');
    const manifestFile = path.join(tmp, 'MANIFEST.json');
    const scorecardFile = path.join(tmp, 'SCORECARD.md');
    const dashboardFile = path.join(tmp, 'mission-control.html');
    const run = spawnSync(
      process.execPath,
      [cli, 'evaluate', '--agent', './agents/rule-aware.js', '--seed', '9001', '--log-dir', logDir],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(run.status, 0, run.stderr);

    const render = spawnSync(
      process.execPath,
      ['./scripts/render-replay-html.js', path.join(logDir, '9001.jsonl'), '--out', outFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /Wrote/);
    const html = fs.readFileSync(outFile, 'utf8');
    assert.match(html, /EchoGrid Replay/);
    assert.match(html, /Seed 9001/);
    assert.match(html, /id="board"/);
    assert.match(html, /id="timelineRows"/);
    assert.match(html, /const frames = /);
    assert.match(html, /Score Curve/);
    assert.match(html, /Key Events/);
    assert.match(html, /const milestones = /);
    assert.match(html, /Rule claim/);
    assert.match(html, /objective complete/);
    assert.match(html, /extract_artifact/);

    fs.writeFileSync(comparisonFile, 'ECHO GRID AGENT COMPARISON\n./agents/rule-aware.js  1  991\n', 'utf8');
    const brief = spawnSync(
      process.execPath,
      ['./scripts/write-judge-brief.js', path.join(logDir, '9001.jsonl'), '--out', briefFile, '--replay-html', outFile, '--arena-html', arenaFile, '--leaderboard', leaderboardFile, '--comparison', comparisonFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(brief.status, 0, brief.stderr);
    assert.match(brief.stdout, /Wrote/);
    const markdown = fs.readFileSync(briefFile, 'utf8');
    assert.match(markdown, /EchoGrid Judge Brief/);
    assert.match(markdown, /90-Second Judge Script/);
    assert.match(markdown, /arena\.html/);
    assert.match(markdown, /leaderboard\.md/);
    assert.match(markdown, /SUCCESS \/ objective_complete/);
    assert.match(markdown, /rule claim accepted/);
    assert.match(markdown, /exit extraction completed/);
    assert.match(markdown, /ECHO GRID AGENT COMPARISON/);

    fs.writeFileSync(comparisonJsonFile, JSON.stringify({
      seed_file: './seeds/demo.txt',
      rows: [
        { agent: './agents/random.js', seeds: 1, successes: 0, success_rate: 0, average_score: 138, average_turns: 100, best_score: 138, worst_score: 138, results: [] },
        { agent: './agents/baseline.js', seeds: 1, successes: 1, success_rate: 1, average_score: 876, average_turns: 53, best_score: 876, worst_score: 876, results: [] },
        { agent: './agents/rule-aware.js', seeds: 1, successes: 1, success_rate: 1, average_score: 991, average_turns: 53, best_score: 991, worst_score: 991, results: [] },
      ],
      rankings: [
        { rank: 1, agent: './agents/rule-aware.js', success_rate: 1, average_score: 991, average_turns: 53, best_score: 991, worst_score: 991 },
        { rank: 2, agent: './agents/baseline.js', success_rate: 1, average_score: 876, average_turns: 53, best_score: 876, worst_score: 876 },
        { rank: 3, agent: './agents/random.js', success_rate: 0, average_score: 138, average_turns: 100, best_score: 138, worst_score: 138 },
      ],
    }), 'utf8');
    const scorecard = spawnSync(
      process.execPath,
      ['./scripts/write-demo-scorecard.js', path.join(logDir, '9001.jsonl'), '--out', scorecardFile, '--comparison-json', comparisonJsonFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(scorecard.status, 0, scorecard.stderr);
    assert.match(scorecard.stdout, /Wrote/);
    const scorecardMarkdown = fs.readFileSync(scorecardFile, 'utf8');
    assert.match(scorecardMarkdown, /EchoGrid Demo Scorecard/);
    assert.match(scorecardMarkdown, /Capability gates passed: 6\/6/);
    assert.match(scorecardMarkdown, /Hidden-rule inference/);
    const dashboard = spawnSync(
      process.execPath,
      ['./scripts/write-demo-dashboard.js', path.join(logDir, '9001.jsonl'), '--out', dashboardFile, '--comparison-json', comparisonJsonFile, '--replay-html', outFile, '--arena-html', arenaFile, '--leaderboard', leaderboardFile, '--scorecard', scorecardFile, '--brief', briefFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(dashboard.status, 0, dashboard.stderr);
    assert.match(dashboard.stdout, /Wrote/);
    const dashboardHtml = fs.readFileSync(dashboardFile, 'utf8');
    assert.match(dashboardHtml, /EchoGrid Mission Control/);
    assert.match(dashboardHtml, /Competition Verdict/);
    assert.match(dashboardHtml, /Complete run\. Ready\./);
    assert.match(dashboardHtml, /verdictGrid/);
    assert.match(dashboardHtml, /Audit Trail/);
    assert.match(dashboardHtml, /Judge Briefing/);
    assert.match(dashboardHtml, /id="briefNext"/);
    assert.match(dashboardHtml, /data-brief-index/);
    assert.match(dashboardHtml, /Final Public Map/);
    assert.match(dashboardHtml, /Mission Timeline/);
    assert.match(dashboardHtml, /Route Playback/);
    assert.match(dashboardHtml, /Score Construction/);
    assert.match(dashboardHtml, /Agent Tournament/);
    assert.match(dashboardHtml, /Strategy Edge/);
    assert.match(dashboardHtml, /Average score edge/);
    assert.match(dashboardHtml, /Accepted rule claims/);
    assert.match(dashboardHtml, /Random agent failures/);
    assert.match(dashboardHtml, /deltaWrap/);
    assert.match(dashboardHtml, /Evidence Links/);
    assert.match(dashboardHtml, /const missionControl = /);
    assert.match(dashboardHtml, /id="routeSlider"/);
    assert.match(dashboardHtml, /initRoutePlayback/);
    assert.match(dashboardHtml, /class="jumpButton"/);
    assert.match(dashboardHtml, /data-route-index/);
    assert.match(dashboardHtml, /sector C scan showed exactly two unstable echoes/);
    const index = spawnSync(
      process.execPath,
      ['./scripts/write-demo-index.js', path.join(logDir, '9001.jsonl'), '--out', indexFile, '--manifest', manifestFile, '--dashboard-html', dashboardFile, '--scorecard', scorecardFile, '--brief', briefFile, '--replay-html', outFile, '--arena-html', arenaFile, '--leaderboard', leaderboardFile, '--comparison-json', comparisonJsonFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(index.status, 0, index.stderr);
    assert.match(index.stdout, /Wrote/);
    const indexHtml = fs.readFileSync(indexFile, 'utf8');
    assert.match(indexHtml, /EchoGrid Demo Index/);
    assert.match(indexHtml, /90-Second Runbook/);
    assert.match(indexHtml, /Leaderboard Snapshot/);
    assert.match(indexHtml, /Audit Gates/);
    assert.match(indexHtml, /const demoSummary = /);
    assert.match(indexHtml, /MANIFEST\.json/);
    assert.match(indexHtml, /mission-control\.html/);
    assert.match(indexHtml, /SCORECARD\.md/);
    assert.match(indexHtml, /JUDGE_BRIEF\.md/);
    assert.match(indexHtml, /replay\.html/);

    const manifest = spawnSync(
      process.execPath,
      ['./scripts/write-demo-manifest.js', path.join(logDir, '9001.jsonl'), '--out', manifestFile, '--index', indexFile, '--dashboard-html', dashboardFile, '--scorecard', scorecardFile, '--brief', briefFile, '--replay-html', outFile, '--arena-html', arenaFile, '--leaderboard', leaderboardFile, '--comparison-json', comparisonJsonFile, '--comparison', comparisonFile],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(manifest.status, 0, manifest.stderr);
    assert.match(manifest.stdout, /Wrote/);
    const parsedManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(parsedManifest.schema, 'echogrid.demo_manifest.v1');
    assert.equal(parsedManifest.showcase.result, 'success');
    assert.equal(parsedManifest.showcase.score, 991);
    assert.ok(parsedManifest.artifacts.find((item) => item.name === 'scorecard')?.sha256);
    assert.ok(parsedManifest.artifacts.find((item) => item.name === 'index')?.sha256);
    assert.ok(parsedManifest.artifacts.find((item) => item.name === 'dashboard')?.sha256);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('report command handles BOM JSONL and LLM diagnostics', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logFile = path.join(tmp, 'llm.jsonl');
    const lines = [
      '{"type":"start","agent":"agents/llm-openai-compatible.js","state":{"seed":"1","mode":"mvp"}}',
      '{"type":"action","command":"probe 1 0","agent_diagnostic":{"model":"model-a","fallback":false,"action":"probe 1 0"},"event":{"turn":1,"outcome":{"ok":true,"type":"probe"},"score":10},"state":{"seed":"1","mode":"mvp","turn":{"current":1,"limit":10,"terminal":{"status":"failure","reason":"turn_limit","score":10,"hidden_rule":"unknown"}},"score":10,"score_breakdown":{"total":10},"metrics":{},"objective":{"artifacts_collected":0,"artifacts_required":1},"resources":{"energy":1,"integrity":3}}}',
      '{"type":"action","command":"wait","agent_diagnostic":{"model":"model-a","fallback":true,"reason":"empty_model_action"},"event":{"turn":2,"outcome":{"ok":true,"type":"wait"},"score":9},"state":{"seed":"1","mode":"mvp","turn":{"current":2,"limit":10,"terminal":{"status":"failure","reason":"turn_limit","score":9,"hidden_rule":"unknown"}},"score":9,"score_breakdown":{"total":9},"metrics":{},"objective":{"artifacts_collected":0,"artifacts_required":1},"resources":{"energy":0,"integrity":3}}}',
    ];
    fs.writeFileSync(logFile, `\uFEFF${lines.join('\n')}\n`, 'utf8');

    const report = spawnSync(process.execPath, [cli, 'report', logFile], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /Model actions: 1/);
    assert.match(report.stdout, /Fallback actions: 1/);
    assert.match(report.stdout, /Model errors: 0/);
    assert.match(report.stdout, /Diagnostic reasons: model:1, empty_model_action:1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('compare script prints agent comparison table', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const jsonFile = path.join(tmp, 'comparison.json');
    const htmlFile = path.join(tmp, 'arena.html');
    const leaderboardFile = path.join(tmp, 'leaderboard.md');
    const result = spawnSync(
      process.execPath,
      ['./scripts/compare.js', '--seeds', './seeds/showcase.txt', '--agents', './agents/baseline.js,./agents/rule-aware.js', '--concurrency', '2', '--json-out', jsonFile, '--html-out', htmlFile, '--leaderboard-out', leaderboardFile],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ECHO GRID AGENT COMPARISON/);
    assert.match(result.stdout, /Concurrency: 2/);
    assert.match(result.stdout, /agents\/rule-aware\.js/);

    const comparison = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    assert.equal(comparison.seed_file, './seeds/showcase.txt');
    assert.equal(comparison.concurrency, 2);
    assert.equal(comparison.rows.length, 2);
    assert.equal(comparison.rows[0].agent, './agents/baseline.js');
    assert.equal(comparison.rows[1].agent, './agents/rule-aware.js');
    assert.equal(comparison.rankings[0].rank, 1);
    assert.ok(Array.isArray(comparison.rows[0].results));

    const html = fs.readFileSync(htmlFile, 'utf8');
    assert.match(html, /EchoGrid Arena/);
    assert.match(html, /Per-Seed Matrix/);
    assert.match(html, /const comparison = /);
    assert.match(html, /rule-aware/);

    const leaderboard = fs.readFileSync(leaderboardFile, 'utf8');
    assert.match(leaderboard, /EchoGrid Leaderboard/);
    assert.match(leaderboard, /Per-Seed Winners/);
    assert.match(leaderboard, /Ranked by success rate/);
    assert.match(leaderboard, /agents\/rule-aware\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('held-out benchmark redacts private seed ids and writes ranking artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const seedsFile = path.join(tmp, 'private-seeds.txt');
    const outDir = path.join(tmp, 'heldout');
    fs.writeFileSync(seedsFile, '9001\n', 'utf8');

    const result = spawnSync(
      process.execPath,
      [
        './scripts/run-heldout-benchmark.js',
        '--seeds',
        seedsFile,
        '--agents',
        './agents/baseline.js,./agents/rule-aware.js',
        '--out',
        outDir,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ECHO GRID HELD-OUT BENCHMARK/);

    const json = fs.readFileSync(path.join(outDir, 'heldout-results.json'), 'utf8');
    const benchmark = JSON.parse(json);
    assert.equal(benchmark.schema, 'echogrid.heldout_benchmark.v1');
    assert.equal(benchmark.seed_file.redacted, true);
    assert.equal(benchmark.seed_file.count, 1);
    assert.equal(benchmark.rows.length, 2);
    assert.equal(benchmark.rows[0].results[0].seed, 'heldout-001');
    assert.doesNotMatch(json, /"seed":\s*"9001"/);

    const leaderboard = fs.readFileSync(path.join(outDir, 'heldout-leaderboard.md'), 'utf8');
    assert.match(leaderboard, /EchoGrid Held-Out Leaderboard/);
    assert.match(leaderboard, /heldout-001/);
    assert.doesNotMatch(leaderboard, /\|\s*9001\s*\|/);

    const summary = fs.readFileSync(path.join(outDir, 'HELDOUT_SUMMARY.md'), 'utf8');
    assert.match(summary, /Seed file sha256/);
    assert.match(summary, /Seed ids are redacted by default/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('demo artifact verifier accepts a complete showcase package', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const log = [
      { type: 'start', state: { seed: '9001' } },
      {
        type: 'action',
        event: { outcome: { type: 'scan', observation: { rule_signal: 'sector_c_exactly_two_unstable' } } },
        state: { seed: '9001' },
      },
      {
        type: 'action',
        event: { outcome: { type: 'claim_rule', observation: { accepted: true, rationale: 'scan evidence' } } },
        state: { seed: '9001' },
      },
      ...[1, 2, 3].map((count) => ({
        type: 'action',
        event: { outcome: { type: 'extract_artifact' } },
        state: { seed: '9001', objective: { artifacts_collected: count, artifacts_required: 3 } },
      })),
      {
        type: 'action',
        event: { outcome: { type: 'extract_exit' } },
        state: {
          seed: '9001',
          score: 991,
          turn: {
            terminal: {
              status: 'success',
              reason: 'objective_complete',
              score: 991,
              hidden_rule: 'sector_c_two_unstable',
            },
          },
          objective: { artifacts_collected: 3, artifacts_required: 3 },
          rules: {
            claim: {
              id: 'sector_c_two_unstable',
              correct: true,
              turn: 2,
              rationale: 'sector C scan showed exactly two unstable echoes',
            },
          },
          metrics: { damage_events: 0, invalid_actions: 0, wasted_actions: 0 },
        },
      },
    ];
    fs.writeFileSync(path.join(tmp, '9001.jsonl'), `${log.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    fs.writeFileSync(path.join(tmp, 'index.html'), 'EchoGrid Demo Index 90-Second Runbook Leaderboard Snapshot Audit Gates const demoSummary = MANIFEST.json mission-control.html SCORECARD.md JUDGE_BRIEF.md replay.html arena.html sector C scan showed exactly two unstable echoes', 'utf8');
    fs.writeFileSync(path.join(tmp, 'mission-control.html'), 'EchoGrid Mission Control Competition Verdict Complete run. Ready. verdictGrid Audit Trail Judge Briefing id="briefNext" data-brief-index Final Public Map Mission Timeline Route Playback Score Construction Agent Tournament Strategy Edge Average score edge Accepted rule claims Random agent failures deltaWrap Evidence Links const missionControl = id="routeSlider" initRoutePlayback class="jumpButton" data-route-index sector C scan showed exactly two unstable echoes data-coord="7,7"', 'utf8');
    fs.writeFileSync(path.join(tmp, 'SCORECARD.md'), 'EchoGrid Demo Scorecard Capability gates passed: 6/6 Mission completion Hidden-rule inference Agent separation PASS rule-aware avg=929.5', 'utf8');
    fs.writeFileSync(path.join(tmp, 'replay.html'), 'EchoGrid Replay Score Curve Key Events const frames = const milestones = objective complete', 'utf8');
    fs.writeFileSync(path.join(tmp, 'arena.html'), 'EchoGrid Arena Average Score Aggregate Table Per-Seed Matrix const comparison = ./agents/rule-aware.js', 'utf8');
    fs.writeFileSync(path.join(tmp, 'JUDGE_BRIEF.md'), 'EchoGrid Judge Brief 90-Second Judge Script SUCCESS / objective_complete logs/showcase/arena.html logs/showcase/replay.html ECHO GRID AGENT COMPARISON', 'utf8');
    fs.writeFileSync(path.join(tmp, 'agent-comparison.txt'), 'ECHO GRID AGENT COMPARISON ./agents/random.js ./agents/baseline.js ./agents/rule-aware.js', 'utf8');
    fs.writeFileSync(path.join(tmp, 'leaderboard.md'), 'EchoGrid Leaderboard Ranked by success rate Per-Seed Winners ./agents/rule-aware.js', 'utf8');
    fs.writeFileSync(path.join(tmp, 'agent-comparison.json'), JSON.stringify({
      seed_file: './seeds/demo.txt',
      rows: [
        { agent: './agents/random.js', seeds: 4, successes: 0, average_score: 218.5 },
        { agent: './agents/baseline.js', seeds: 4, successes: 4, average_score: 874 },
        { agent: './agents/rule-aware.js', seeds: 4, successes: 4, average_score: 929.5 },
      ],
    }), 'utf8');
    const manifest = spawnSync(
      process.execPath,
      [
        './scripts/write-demo-manifest.js',
        path.join(tmp, '9001.jsonl'),
        '--out',
        path.join(tmp, 'MANIFEST.json'),
        '--index',
        path.join(tmp, 'index.html'),
        '--dashboard-html',
        path.join(tmp, 'mission-control.html'),
        '--scorecard',
        path.join(tmp, 'SCORECARD.md'),
        '--brief',
        path.join(tmp, 'JUDGE_BRIEF.md'),
        '--replay-html',
        path.join(tmp, 'replay.html'),
        '--arena-html',
        path.join(tmp, 'arena.html'),
        '--leaderboard',
        path.join(tmp, 'leaderboard.md'),
        '--comparison-json',
        path.join(tmp, 'agent-comparison.json'),
        '--comparison',
        path.join(tmp, 'agent-comparison.txt'),
      ],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(manifest.status, 0, manifest.stderr);

    const result = spawnSync(process.execPath, ['./scripts/verify-demo-artifacts.js', tmp], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DEMO ARTIFACT CHECK PASSED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('submission bundle gathers showcase and benchmark artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const showcaseDir = path.join(tmp, 'showcase');
    const adversarialDir = path.join(tmp, 'adversarial');
    const rulesDir = path.join(tmp, 'rules');
    const outDir = path.join(tmp, 'bundle');
    writeMinimalShowcasePackage(showcaseDir);
    writeMinimalVisualSmokePackage(showcaseDir);
    writeBenchmarkPackage(adversarialDir, {
      seed_file: './seeds/adversarial.txt',
      rows: [
        { agent: './agents/random.js', seeds: 2, successes: 0, success_rate: 0, average_score: 150, average_turns: 100, best_score: 200, worst_score: 100, results: [] },
        { agent: './agents/baseline.js', seeds: 2, successes: 2, success_rate: 1, average_score: 830, average_turns: 104, best_score: 850, worst_score: 810, results: [] },
        { agent: './agents/rule-aware.js', seeds: 2, successes: 2, success_rate: 1, average_score: 860, average_turns: 105, best_score: 970, worst_score: 825, results: [] },
      ],
    });
    writeBenchmarkPackage(rulesDir, {
      seed_file: './seeds/rule-signals.txt',
      rows: [
        { agent: './agents/baseline.js', seeds: 2, successes: 2, success_rate: 1, average_score: 849, average_turns: 98, best_score: 856, worst_score: 842, results: [] },
        { agent: './agents/rule-aware.js', seeds: 2, successes: 2, success_rate: 1, average_score: 904.5, average_turns: 99, best_score: 971, worst_score: 838, results: [] },
        { agent: './agents/rule-explorer.js', seeds: 2, successes: 2, success_rate: 1, average_score: 890.5, average_turns: 102, best_score: 957, worst_score: 824, results: [] },
      ],
    });

    const result = spawnSync(
      process.execPath,
      [
        './scripts/create-submission-bundle.js',
        '--showcase',
        showcaseDir,
        '--adversarial',
        adversarialDir,
        '--rules',
        rulesDir,
        '--out',
        outDir,
      ],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ECHO GRID SUBMISSION BUNDLE/);
    assert.ok(fs.existsSync(path.join(outDir, 'README.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'START_HERE.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'SUBMISSION_AUDIT.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'SUBMISSION_CHECKLIST.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'SUBMISSION_MANIFEST.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'SUBMISSION_ONE_PAGER.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'SUBMISSION_STRATEGY_AUDIT.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'showcase', 'mission-control.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'benchmarks', 'adversarial', 'leaderboard.md')));
    assert.ok(fs.existsSync(`${outDir}.zip`));

    const verify = spawnSync(
      process.execPath,
      ['./scripts/verify-submission-bundle.js', outDir],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /SUBMISSION BUNDLE CHECK PASSED/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'SUBMISSION_MANIFEST.json'), 'utf8'));
    assert.equal(manifest.schema, 'echogrid.submission_bundle.v1');
    assert.equal(manifest.showcase.result, 'success');
    assert.equal(manifest.benchmarks.adversarial.leader.agent, './agents/rule-aware.js');
    assert.ok(manifest.files.find((item) => item.path === 'START_HERE.html')?.sha256);
    assert.ok(manifest.files.find((item) => item.path === 'showcase/MANIFEST.json')?.sha256);
    assert.ok(manifest.files.find((item) => item.path === 'SUBMISSION_AUDIT.md')?.sha256);
    assert.ok(manifest.files.find((item) => item.path === 'SUBMISSION_CHECKLIST.md')?.sha256);
    assert.ok(manifest.files.find((item) => item.path === 'SUBMISSION_ONE_PAGER.md')?.sha256);
    assert.ok(manifest.files.find((item) => item.path === 'SUBMISSION_STRATEGY_AUDIT.md')?.sha256);
    const audit = fs.readFileSync(path.join(outDir, 'SUBMISSION_AUDIT.md'), 'utf8');
    assert.match(audit, /EchoGrid Submission Audit/);
    assert.match(audit, /Verification Matrix/);
    assert.match(audit, /Bundle inventory/);
    const onePager = fs.readFileSync(path.join(outDir, 'SUBMISSION_ONE_PAGER.md'), 'utf8');
    assert.match(onePager, /EchoGrid One-Pager/);
    assert.match(onePager, /Why It Is Worth Judging/);
    assert.match(onePager, /90-Second Review Path/);
    assert.match(onePager, /SUBMISSION_STRATEGY_AUDIT\.md/);
    const strategyAudit = fs.readFileSync(path.join(outDir, 'SUBMISSION_STRATEGY_AUDIT.md'), 'utf8');
    assert.match(strategyAudit, /EchoGrid Strategy Audit/);
    assert.match(strategyAudit, /Benchmark Edge/);
    assert.match(strategyAudit, /Per-Seed Evidence/);
    assert.match(strategyAudit, /Rule-aware edge over baseline/);
    const startHere = fs.readFileSync(path.join(outDir, 'START_HERE.html'), 'utf8');
    assert.match(startHere, /EchoGrid Submission/);
    assert.match(startHere, /mission-control-desktop\.png/);
    assert.match(startHere, /showcase\/mission-control\.html/);
    assert.match(startHere, /SUBMISSION_STRATEGY_AUDIT\.md/);
    assert.equal(fs.readFileSync(`${outDir}.zip`).subarray(0, 2).toString('utf8'), 'PK');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('submission bundle verifier checks local html links', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'assets', 'good.txt'), 'ok\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'image.png'), 'ok\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'index.html'), [
      '<a href="assets/good.txt">good</a>',
      '<img src="image.png?size=1#preview">',
      '<a href="#local-anchor">anchor</a>',
      '<a href="https://example.com/reference">external</a>',
    ].join('\n'), 'utf8');

    const cleanErrors = [];
    verifyLocalHtmlLinks(tmp, cleanErrors);
    assert.deepEqual(cleanErrors, []);

    fs.writeFileSync(path.join(tmp, 'broken.html'), [
      '<a href="missing.html">missing</a>',
      '<img src="../outside.png">',
    ].join('\n'), 'utf8');

    const brokenErrors = [];
    verifyLocalHtmlLinks(tmp, brokenErrors);
    assert.match(brokenErrors.join('\n'), /broken\.html has broken href: missing\.html/);
    assert.match(brokenErrors.join('\n'), /broken\.html has src outside bundle: \.\.\/outside\.png/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('submission bundle verifier catches stale source commit metadata', () => {
  const errors = [];
  verifySourceCommit({
    source: {
      commit: '0000000000000000000000000000000000000000',
      commit_short: '0000000',
    },
  }, errors);

  assert.match(errors.join('\n'), /manifest source commit 0000000 does not match current HEAD/);

  const skipped = [];
  verifySourceCommit({
    source: {
      commit: '0000000000000000000000000000000000000000',
      commit_short: '0000000',
    },
  }, skipped, { 'skip-source-commit-check': true });
  assert.deepEqual(skipped, []);
});

test('analyze-run reports quality flags for JSONL logs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logFile = path.join(tmp, 'run.jsonl');
    const lines = [
      '{"type":"start","state":{"seed":"1","mode":"mvp"}}',
      '{"type":"action","command":"wait","agent_diagnostic":{"model":"model-a","fallback":true,"reason":"empty_model_action"},"event":{"outcome":{"ok":true,"type":"wait"}},"state":{"seed":"1","turn":{"current":1,"terminal":null},"agent":{"position":[0,0]},"score":1,"objective":{"artifacts_collected":0,"artifacts_required":1}}}',
      '{"type":"action","command":"wait","agent_diagnostic":{"model":"model-a","fallback":true,"reason":"empty_model_action"},"event":{"outcome":{"ok":true,"type":"wait"}},"state":{"seed":"1","turn":{"current":2,"terminal":{"status":"failure","reason":"turn_limit","score":0}},"agent":{"position":[0,0]},"score":0,"objective":{"artifacts_collected":0,"artifacts_required":1}}}',
    ];
    fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');

    const result = spawnSync(process.execPath, ['./scripts/analyze-run.js', logFile], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const analysis = JSON.parse(result.stdout);
    assert.equal(analysis.status, 'failure');
    assert.equal(analysis.fallback_actions, 2);
    assert.equal(analysis.unique_positions, 1);
    assert.equal(analysis.distance_to_exit_delta, null);
    assert.ok(analysis.flags.includes('high_wait_rate'));
    assert.ok(analysis.flags.includes('fallback_dominant'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('LLM pure mode records model errors without baseline fallback', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logDir = path.join(tmp, 'pure');
    const result = spawnSync(
      process.execPath,
      [cli, 'evaluate', '--agent', './agents/llm-openai-compatible.js', '--seed', '9001', '--mode', 'micro', '--json', '--timeout', '3000', '--log-dir', logDir],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          ECHOGRID_LLM_API_KEY: '',
          DEEPSEEK_API_KEY: '',
          OPENAI_API_KEY: '',
          ECHOGRID_LLM_FALLBACK_MODE: 'none',
          ECHOGRID_LLM_LOCAL_POLICY: '0',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.aggregate.successes, 0);
    assert.equal(output.results[0].reason, 'model_missing_api_key');
    assert.equal(output.results[0].turns, 1);

    const analysis = spawnSync(process.execPath, ['./scripts/analyze-run.js', path.join(logDir, '9001.jsonl')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(analysis.status, 0, analysis.stderr);
    const parsed = JSON.parse(analysis.stdout);
    assert.equal(parsed.leaderboard, 'pure');
    assert.equal(parsed.aborted, true);
    assert.equal(parsed.fallback_actions, 0);
    assert.equal(parsed.model_error_actions, 1);
    assert.ok(parsed.top_diagnostic_reasons.some((item) => item.reason === 'missing_api_key'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('LLM state summary does not invent avoid actions from probe observations', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  const summary = JSON.parse(buildStateSummary(game.state()));

  assert.equal(summary.action_hints.next_action, 'move S');
  assert.equal(summary.must_copy_action, 'move S');
  assert.equal(summary.extract_valid_now, false);
  assert.equal(summary.action_hints.avoid_repeating.length, 0);
  assert.equal(Object.hasOwn(summary, 'avoid_actions'), false);
  assert.equal(Object.hasOwn(summary, 'previous_position'), false);
});

test('LLM state summary marks extract validity from the public current cell', () => {
  const game = new EchoGridGame({ seed: 1024, mode: 'micro' });
  for (const action of [
    'probe 1 0',
    'move E',
    'probe 2 0',
    'move E',
    'probe 2 1',
    'move S',
    'probe 3 1',
    'move E',
  ]) {
    game.step(action);
  }

  const summary = JSON.parse(buildStateSummary(game.state()));
  assert.equal(summary.current.terrain, 'artifact');
  assert.equal(summary.extract_valid_now, true);
  assert.equal(summary.must_copy_action, 'extract');
});

test('LLM log summary separates pure model errors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logDir = path.join(tmp, 'llm', 'pure', 'model-a');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, '1.jsonl');
    const lines = [
      '{"type":"start","agent":"agents/llm-openai-compatible.js","agent_mode":"oneshot","state":{"seed":"1","mode":"micro"}}',
      '{"type":"action","command":"__model_unavailable__ missing_api_key","agent_diagnostic":{"model":"model-a","fallback_mode":"none","fallback":false,"model_error":true,"reason":"missing_api_key"},"event":{"turn":1,"outcome":{"ok":false,"type":"invalid"},"score":-20},"state":{"seed":"1","turn":{"current":1,"terminal":{"status":"failure","reason":"turn_limit","score":-20}},"score":-20,"objective":{"artifacts_collected":0,"artifacts_required":1}}}',
    ];
    fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');

    const summary = spawnSync(process.execPath, ['./scripts/summarize-llm-logs.js', path.join(tmp, 'llm')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /Board/);
    assert.match(summary.stdout, /pure/);
    assert.match(summary.stdout, /Errors/);
    assert.match(summary.stdout, /Abort/);
    assert.match(summary.stdout, /missing_api_key:1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('report command counts model errors separately from model actions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logFile = path.join(tmp, 'pure.jsonl');
    const lines = [
      '{"type":"start","agent":"agents/llm-openai-compatible.js","state":{"seed":"1","mode":"micro"}}',
      '{"type":"action","command":"__model_unavailable__ missing_api_key","agent_diagnostic":{"model":"model-a","fallback_mode":"none","fallback":false,"model_error":true,"reason":"missing_api_key"},"event":{"turn":1,"outcome":{"ok":false,"type":"invalid","message":"Could not parse action"},"score":-20},"state":{"seed":"1","turn":{"current":1,"limit":1,"terminal":{"status":"failure","reason":"turn_limit","score":-20,"hidden_rule":"unknown"}},"score":-20,"score_breakdown":{"total":-20},"metrics":{"invalid_actions":1},"objective":{"artifacts_collected":0,"artifacts_required":1},"resources":{"energy":1,"integrity":3}}}',
    ];
    fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');

    const report = spawnSync(process.execPath, [cli, 'report', logFile], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /Model actions: 0/);
    assert.match(report.stdout, /Model errors: 1/);
    assert.match(report.stdout, /Diagnostic reasons: missing_api_key:1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reasoning recovery diagnostics stay separate from model errors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  try {
    const logDir = path.join(tmp, 'recover');
    const result = spawnSync(
      process.execPath,
      [cli, 'evaluate', '--agent', './agents/fake-empty-final-llm.js', '--seed', '9001', '--mode', 'micro', '--json', '--timeout', '3000', '--log-dir', logDir],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          ECHOGRID_LLM_RECOVER_REASONING_ACTION: '1',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.results[0].turns, 70);

    const analysis = spawnSync(process.execPath, ['./scripts/analyze-run.js', path.join(logDir, '9001.jsonl')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(analysis.status, 0, analysis.stderr);
    const parsed = JSON.parse(analysis.stdout);
    assert.equal(parsed.recovered_reasoning_actions, 70);
    assert.equal(parsed.model_error_actions, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('LLM bridge retries empty final output without fallback', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      requests.push(JSON.parse(body || '{}'));
      const content = requests.length === 1 ? '' : 'move S';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content,
              reasoning_content: requests.length === 1 ? 'The next action is move S.' : '',
            },
          },
        ],
      }));
    });
  });

  try {
    await listen(server);
    const port = server.address().port;
    const logDir = path.join(tmp, 'retry');
    const result = await spawnProcess(
      process.execPath,
      [cli, 'evaluate', '--agent', './agents/llm-openai-compatible.js', '--seed', '9001', '--mode', 'micro', '--json', '--timeout', '3000', '--log-dir', logDir],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          ECHOGRID_LLM_API_KEY: 'test-key',
          ECHOGRID_LLM_BASE_URL: `http://127.0.0.1:${port}`,
          ECHOGRID_LLM_MODEL: 'deepseek-v4-flash',
          ECHOGRID_LLM_FALLBACK_MODE: 'none',
          ECHOGRID_LLM_LOCAL_POLICY: '0',
          ECHOGRID_LLM_MAX_MODEL_TURNS: '1',
          ECHOGRID_LLM_RETRY_EMPTY_ACTION: '1',
          ECHOGRID_LLM_RECOVER_REASONING_ACTION: '0',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].thinking, { type: 'disabled' });
    assert.match(requests[1].messages[1].content, /previous final answer was empty/i);

    const output = JSON.parse(result.stdout);
    assert.notEqual(output.results[0].reason, 'model_empty_model_action');

    const log = fs.readFileSync(path.join(logDir, '9001.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    const action = log.find((entry) => entry.type === 'action');
    assert.equal(action.command, 'move S');
    assert.equal(action.agent_diagnostic.fallback, false);
    assert.equal(action.agent_diagnostic.model_error, undefined);
    assert.equal(action.agent_diagnostic.model_retry_attempts, 1);
    assert.equal(action.agent_diagnostic.thinking_mode, 'disabled');
  } finally {
    await closeServer(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function spawnProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeout || 30000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function writeMinimalShowcasePackage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const log = [
    { type: 'start', state: { seed: '9001' } },
    {
      type: 'action',
      event: { outcome: { type: 'scan', observation: { rule_signal: 'sector_c_exactly_two_unstable' } } },
      state: { seed: '9001' },
    },
    {
      type: 'action',
      event: { outcome: { type: 'claim_rule', observation: { accepted: true, rationale: 'scan evidence' } } },
      state: { seed: '9001' },
    },
    ...[1, 2, 3].map((count) => ({
      type: 'action',
      event: { outcome: { type: 'extract_artifact' } },
      state: { seed: '9001', objective: { artifacts_collected: count, artifacts_required: 3 } },
    })),
    {
      type: 'action',
      event: { outcome: { type: 'extract_exit' } },
      state: {
        seed: '9001',
        score: 991,
        turn: {
          terminal: {
            status: 'success',
            reason: 'objective_complete',
            score: 991,
            hidden_rule: 'sector_c_two_unstable',
          },
        },
        objective: { artifacts_collected: 3, artifacts_required: 3 },
        rules: {
          claim: {
            id: 'sector_c_two_unstable',
            correct: true,
            turn: 2,
            rationale: 'sector C scan showed exactly two unstable echoes',
          },
        },
        metrics: { damage_events: 0, invalid_actions: 0, wasted_actions: 0 },
      },
    },
  ];
  fs.writeFileSync(path.join(dir, '9001.jsonl'), `${log.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'), 'EchoGrid Demo Index 90-Second Runbook Leaderboard Snapshot Audit Gates const demoSummary = MANIFEST.json mission-control.html SCORECARD.md JUDGE_BRIEF.md replay.html arena.html sector C scan showed exactly two unstable echoes', 'utf8');
  fs.writeFileSync(path.join(dir, 'mission-control.html'), 'EchoGrid Mission Control Competition Verdict Complete run. Ready. verdictGrid Audit Trail Judge Briefing id="briefNext" data-brief-index Final Public Map Mission Timeline Route Playback Score Construction Agent Tournament Strategy Edge Average score edge Accepted rule claims Random agent failures deltaWrap Evidence Links const missionControl = id="routeSlider" initRoutePlayback class="jumpButton" data-route-index sector C scan showed exactly two unstable echoes data-coord="7,7"', 'utf8');
  fs.writeFileSync(path.join(dir, 'SCORECARD.md'), 'EchoGrid Demo Scorecard Capability gates passed: 6/6 Mission completion Hidden-rule inference Agent separation PASS rule-aware avg=929.5', 'utf8');
  fs.writeFileSync(path.join(dir, 'replay.html'), 'EchoGrid Replay Score Curve Key Events const frames = const milestones = objective complete', 'utf8');
  fs.writeFileSync(path.join(dir, 'arena.html'), 'EchoGrid Arena Average Score Aggregate Table Per-Seed Matrix const comparison = ./agents/rule-aware.js', 'utf8');
  fs.writeFileSync(path.join(dir, 'JUDGE_BRIEF.md'), 'EchoGrid Judge Brief 90-Second Judge Script SUCCESS / objective_complete logs/showcase/arena.html logs/showcase/replay.html ECHO GRID AGENT COMPARISON', 'utf8');
  fs.writeFileSync(path.join(dir, 'agent-comparison.txt'), 'ECHO GRID AGENT COMPARISON ./agents/random.js ./agents/baseline.js ./agents/rule-aware.js', 'utf8');
  fs.writeFileSync(path.join(dir, 'leaderboard.md'), 'EchoGrid Leaderboard Ranked by success rate Per-Seed Winners ./agents/rule-aware.js', 'utf8');
  fs.writeFileSync(path.join(dir, 'agent-comparison.json'), JSON.stringify({
    seed_file: './seeds/demo.txt',
    rows: [
      { agent: './agents/random.js', seeds: 4, successes: 0, average_score: 218.5 },
      { agent: './agents/baseline.js', seeds: 4, successes: 4, average_score: 874 },
      { agent: './agents/rule-aware.js', seeds: 4, successes: 4, average_score: 929.5 },
    ],
  }), 'utf8');
  const manifest = spawnSync(
    process.execPath,
    [
      './scripts/write-demo-manifest.js',
      path.join(dir, '9001.jsonl'),
      '--out',
      path.join(dir, 'MANIFEST.json'),
      '--index',
      path.join(dir, 'index.html'),
      '--dashboard-html',
      path.join(dir, 'mission-control.html'),
      '--scorecard',
      path.join(dir, 'SCORECARD.md'),
      '--brief',
      path.join(dir, 'JUDGE_BRIEF.md'),
      '--replay-html',
      path.join(dir, 'replay.html'),
      '--arena-html',
      path.join(dir, 'arena.html'),
      '--leaderboard',
      path.join(dir, 'leaderboard.md'),
      '--comparison-json',
      path.join(dir, 'agent-comparison.json'),
      '--comparison',
      path.join(dir, 'agent-comparison.txt'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(manifest.status, 0, manifest.stderr);
}

function writeBenchmarkPackage(dir, comparison) {
  fs.mkdirSync(dir, { recursive: true });
  const rankings = [...comparison.rows]
    .sort((a, b) => (b.success_rate - a.success_rate) ||
      (b.average_score - a.average_score) ||
      (a.average_turns - b.average_turns) ||
      a.agent.localeCompare(b.agent))
    .map((row, index) => ({
      rank: index + 1,
      agent: row.agent,
      success_rate: row.success_rate,
      average_score: row.average_score,
      average_turns: row.average_turns,
      best_score: row.best_score,
      worst_score: row.worst_score,
    }));
  fs.writeFileSync(path.join(dir, 'agent-comparison.json'), `${JSON.stringify({ ...comparison, rankings }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'arena.html'), 'EchoGrid Arena const comparison = ./agents/rule-aware.js', 'utf8');
  fs.writeFileSync(path.join(dir, 'leaderboard.md'), 'EchoGrid Leaderboard Ranked by success rate ./agents/rule-aware.js', 'utf8');
}

function writeMinimalVisualSmokePackage(showcaseDir) {
  const screenshotsDir = path.join(showcaseDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const entries = [
    ['index.html', 'desktop', 1365, 900],
    ['index.html', 'mobile', 390, 844],
    ['mission-control.html', 'desktop', 1365, 900],
    ['mission-control.html', 'mobile', 390, 844],
    ['replay.html', 'desktop', 1365, 900],
    ['replay.html', 'mobile', 390, 844],
    ['arena.html', 'desktop', 1365, 900],
    ['arena.html', 'mobile', 390, 844],
  ].map(([page, viewport, width, height]) => {
    const name = `${page.replace(/\.html$/, '')}-${viewport}.png`;
    fs.writeFileSync(path.join(screenshotsDir, name), Buffer.from(TINY_PNG_BASE64, 'base64'));
    return {
      page,
      viewport,
      width,
      height,
      unique_colors: 32,
      size: 68,
      screenshot: `logs/showcase/screenshots/${name}`,
    };
  });
  fs.writeFileSync(path.join(screenshotsDir, 'visual-smoke.json'), `${JSON.stringify({
    schema: 'echogrid.visual_smoke.v1',
    generated_at: '2026-05-28T00:00:00.000Z',
    generator: 'scripts/smoke-demo-visuals.js',
    browser: 'test-browser',
    showcase_dir: 'logs/showcase',
    screenshots: entries,
  }, null, 2)}\n`, 'utf8');
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC0lEQVR4nGP4zwAAAgEBAJzQnxcAAAAASUVORK5CYII=';
