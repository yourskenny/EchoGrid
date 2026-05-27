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

test('compare script prints agent comparison table', () => {
  const result = spawnSync(process.execPath, ['./scripts/compare.js', '--seeds', './seeds/showcase.txt'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ECHO GRID AGENT COMPARISON/);
  assert.match(result.stdout, /agents\/random\.js/);
  assert.match(result.stdout, /agents\/baseline\.js/);
  assert.match(result.stdout, /agents\/rule-aware\.js/);
});
