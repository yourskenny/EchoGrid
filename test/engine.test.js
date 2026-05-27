'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EchoGridGame, parseAction } = require('../src/engine');

test('world generation is deterministic for a seed', () => {
  const first = new EchoGridGame({ seed: 48129 }).state({ includeAnswer: true }).answer;
  const second = new EchoGridGame({ seed: 48129 }).state({ includeAnswer: true }).answer;
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.hidden_rule, second.hidden_rule);
});

test('action parser accepts the documented protocol', () => {
  assert.deepEqual(parseAction('move E'), { ok: true, action: 'move', direction: 'E' });
  assert.deepEqual(parseAction('probe 2 3'), { ok: true, action: 'probe', x: 2, y: 3 });
  assert.deepEqual(parseAction('scan sector C'), { ok: true, action: 'scan', kind: 'sector', value: 'C' });
  assert.deepEqual(parseAction('mark 1 2 hazard'), { ok: true, action: 'mark', x: 1, y: 2, mark: 'hazard' });
  assert.deepEqual(parseAction('extract'), { ok: true, action: 'extract' });
  assert.deepEqual(parseAction('claim_rule wall_echo_inversion'), {
    ok: true,
    action: 'claim_rule',
    ruleId: 'wall_echo_inversion',
  });
});

test('probe and scan produce structured observations without exposing the answer', () => {
  const game = new EchoGridGame({ seed: 48129 });
  const probe = game.step('probe 1 0');
  const scan = game.step('scan row 0');
  const state = game.state();

  assert.equal(probe.outcome.type, 'probe');
  assert.equal(scan.outcome.type, 'scan');
  assert.equal(state.turn.current, 2);
  assert.equal(state.resources.energy, 174);
  assert.equal(state.answer, undefined);
  assert.equal(state.score_breakdown.total, state.score);
  assert.equal(state.metrics.visible_cells, 2);
  assert.ok(Array.isArray(state.agent.adjacent));
  assert.equal(typeof state.action_hints.next_action, 'string');
  assert.ok(Array.isArray(state.action_hints.preferred));
  assert.ok(Array.isArray(state.action_hints.safe_recommended));
  assert.ok(Array.isArray(state.action_hints.avoid_repeating));
  assert.ok(Array.isArray(state.observations.recent));
  assert.ok(state.observations.recent.length >= 2);
});

test('state exposes repeat-avoidance action hints without hidden information', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  game.step('move S');
  const state = game.state();

  assert.deepEqual(state.agent.position, [0, 1]);
  assert.ok(state.action_hints.safe_recommended.includes('move N'));
  assert.ok(state.action_hints.avoid_repeating.includes('move N'));
  assert.equal(state.action_hints.preferred.includes('move N'), false);
  assert.equal(state.action_hints.next_action, state.action_hints.preferred[0]);
});

test('next action names the first preferred movement hint', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  const state = game.state();

  assert.ok(state.action_hints.safe_recommended.includes('move S'));
  assert.ok(state.action_hints.safe_recommended.includes('probe 1 0'));
  assert.equal(state.action_hints.preferred[0], 'move S');
  assert.equal(state.action_hints.next_action, 'move S');
});

test('invalid actions are penalized and preserve a parseable state', () => {
  const game = new EchoGridGame({ seed: 48129 });
  const event = game.step('jump north');
  const state = game.state();

  assert.equal(event.outcome.ok, false);
  assert.equal(event.outcome.type, 'invalid');
  assert.equal(state.turn.current, 1);
  assert.ok(state.score < 300);
  assert.equal(Array.isArray(state.map.legend), true);
});
