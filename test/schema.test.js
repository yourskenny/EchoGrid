'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { EchoGridGame } = require('../src/engine');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'echogrid.js');
const schemaDir = path.join(root, 'schemas');

test('published JSON schemas are parseable and identify protocol surfaces', () => {
  for (const file of ['state.schema.json', 'event.schema.json', 'summary.schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /echogrid/);
    assert.equal(typeof schema.title, 'string');
  }
});

test('state schema required fields match current public state output', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'state.schema.json'), 'utf8'));
  const state = new EchoGridGame({ seed: 48129 }).state();

  for (const field of schema.required) {
    assert.ok(Object.hasOwn(state, field), `missing state field: ${field}`);
  }
  assert.equal(state.protocol, schema.properties.protocol.const);
  assert.equal(state.coordinate_system, schema.properties.coordinate_system.const);
  assert.equal(Array.isArray(state.agent.adjacent), true);
  assert.equal(typeof state.action_hints.goal.source, 'string');
  assert.equal(typeof state.action_hints.next_action, 'string');
  assert.equal(Array.isArray(state.action_hints.preferred), true);
  assert.equal(Array.isArray(state.action_hints.safe_recommended), true);
  assert.equal(Array.isArray(state.action_hints.avoid_repeating), true);
});

test('event and summary schemas align with CLI log and summary output', () => {
  const eventSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'event.schema.json'), 'utf8'));
  const summarySchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'summary.schema.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-schema-'));
  try {
    const logDir = path.join(tmp, 'logs');
    const summaryFile = path.join(tmp, 'summary.json');
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'evaluate',
        '--agent',
        './agents/baseline.js',
        '--seed',
        '9001',
        '--mode',
        'micro',
        '--json',
        '--log-dir',
        logDir,
        '--summary-file',
        summaryFile,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const [startLine, actionLine] = fs.readFileSync(path.join(logDir, '9001.jsonl'), 'utf8').trim().split(/\r?\n/);
    const startEvent = JSON.parse(startLine);
    const actionEvent = JSON.parse(actionLine);
    assert.equal(startEvent.type, eventSchema.oneOf[0].properties.type.const);
    assert.equal(actionEvent.type, eventSchema.oneOf[1].properties.type.const);
    assert.equal(eventSchema.oneOf[2].properties.type.const, 'abort');
    for (const field of eventSchema.oneOf[1].required) {
      assert.ok(Object.hasOwn(actionEvent, field), `missing action event field: ${field}`);
    }

    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    for (const field of summarySchema.required) {
      assert.ok(Object.hasOwn(summary, field), `missing summary field: ${field}`);
    }
    for (const field of summarySchema.properties.aggregate.required) {
      assert.ok(Object.hasOwn(summary.aggregate, field), `missing aggregate field: ${field}`);
    }
    for (const field of summarySchema.properties.results.items.required) {
      assert.ok(Object.hasOwn(summary.results[0], field), `missing result field: ${field}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
