'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

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
  const result = spawnSync(process.execPath, ['./scripts/compare.js', '--seeds', './seeds/showcase.txt', '--agents', './agents/random.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ECHO GRID AGENT COMPARISON/);
  assert.match(result.stdout, /agents\/random\.js/);
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
