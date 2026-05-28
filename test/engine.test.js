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
  assert.equal(typeof state.action_hints.goal.source, 'string');
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
  assert.ok(state.action_hints.preferred.includes('move N'));
  assert.equal(state.action_hints.next_action, state.action_hints.preferred[0]);
});

test('next action names the first preferred movement hint', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  const state = game.state();

  assert.ok(state.action_hints.safe_recommended.includes('move S'));
  assert.ok(state.action_hints.safe_recommended.includes('probe 1 0'));
  assert.equal(state.action_hints.goal.source, 'trace');
  assert.equal(state.action_hints.goal.trace, 'south-biased');
  assert.equal(state.action_hints.preferred[0], 'move S');
  assert.equal(state.action_hints.next_action, 'move S');
});

test('preferred actions follow public trace before exit completion', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  game.step('probe 1 0');
  game.step('move S');
  game.step('probe 0 2');
  game.step('probe 1 1');
  game.step('move S');
  game.step('probe 0 3');
  game.step('probe 1 2');
  game.step('move E');
  game.step('probe 1 1');
  const state = game.state();

  assert.deepEqual(state.agent.position, [1, 2]);
  assert.equal(state.action_hints.goal.source, 'trace');
  assert.equal(state.action_hints.goal.trace, 'east-biased');
  assert.ok(state.action_hints.preferred.includes('move N'));
  assert.equal(state.action_hints.next_action, 'probe 2 2');
});

test('preferred actions target the public exit after artifacts are collected', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  game.step('probe 0 1');
  game.step('probe 1 0');
  game.step('move S');
  game.step('probe 0 2');
  game.step('probe 1 1');
  game.step('move S');
  game.step('probe 0 3');
  game.step('probe 1 2');
  game.step('move E');
  game.step('probe 1 3');
  game.step('move S');
  game.step('probe 1 4');
  game.step('move S');
  game.step('probe 1 5');
  game.step('move S');
  game.step('probe 1 6');
  game.step('probe 2 5');
  game.step('move E');
  game.collected.add('test-artifact');
  const state = game.state();

  assert.deepEqual(state.agent.position, [2, 5]);
  assert.equal(state.action_hints.goal.source, 'exit');
  assert.equal(state.action_hints.next_action, 'probe 2 6');
});

test('preferred actions search around public high heat before trace', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'micro' });
  for (const action of [
    'probe 0 1',
    'move S',
    'probe 0 2',
    'move S',
    'probe 0 3',
    'probe 1 2',
    'move E',
    'probe 2 2',
    'move E',
    'probe 3 2',
    'probe 2 1',
    'probe 2 3',
    'move S',
    'probe 3 3',
    'move E',
    'probe 4 3',
    'probe 3 4',
    'move S',
    'probe 4 4',
    'probe 3 5',
    'probe 2 4',
    'move W',
    'probe 2 5',
    'move S',
    'probe 1 5',
    'move W',
    'probe 1 6',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [1, 5]);
  assert.equal(state.action_hints.goal.source, 'heat');
  assert.deepEqual(state.action_hints.goal.heat_coord, [1, 6]);
  assert.deepEqual(state.action_hints.goal.coord, [0, 6]);
  assert.equal(state.action_hints.next_action, 'probe 0 5');
});

test('artifact route hint opens a frontier when trace search stalls in a loop', () => {
  const game = new EchoGridGame({ seed: 314159, mode: 'mvp' });
  for (const action of [
    'probe 1 0',
    'move E',
    'probe 2 0',
    'move E',
    'probe 3 0',
    'move E',
    'probe 4 0',
    'move E',
    'probe 5 0',
    'move E',
    'extract',
    'probe 5 1',
    'move S',
    'probe 5 2',
    'move S',
    'probe 5 3',
    'move S',
    'extract',
    'probe 5 4',
    'probe 6 3',
    'probe 4 3',
    'move N',
    'probe 6 2',
    'move E',
    'probe 6 1',
    'move N',
    'move W',
    'move N',
    'move W',
    'probe 4 1',
    'move S',
    'probe 4 2',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
    'move S',
    'move E',
    'move S',
    'move N',
    'move N',
    'move N',
    'move W',
    'move S',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [4, 1]);
  assert.equal(state.objective.artifacts_collected, 2);
  assert.equal(state.action_hints.goal.source, 'trace');
  assert.equal(state.action_hints.next_action, 'probe 3 1');
  assertArtifactHintPolicyExtractsNextArtifact(game, 20);
});

test('artifact route hint opens a frontier when heat search stalls in a loop', () => {
  const game = new EchoGridGame({ seed: 271828, mode: 'mvp' });
  for (const action of [
    'probe 0 1',
    'move S',
    'probe 0 2',
    'move S',
    'probe 0 3',
    'move S',
    'probe 0 4',
    'probe 1 3',
    'move N',
    'probe 1 2',
    'move E',
    'probe 1 1',
    'move N',
    'move W',
    'move N',
    'probe 1 0',
    'move E',
    'probe 2 0',
    'move E',
    'probe 2 1',
    'move S',
    'move W',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
    'move W',
    'move S',
    'move N',
    'move N',
    'move N',
    'move E',
    'move S',
    'move S',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [1, 2]);
  assert.equal(state.objective.artifacts_collected, 0);
  assert.equal(state.action_hints.goal.source, 'heat');
  assert.equal(state.action_hints.next_action, 'probe 2 2');
  assertArtifactHintPolicyExtractsNextArtifact(game, 90);
});

test('exit route hint escapes recent loops after artifacts are collected', () => {
  const game = new EchoGridGame({ seed: 1024, mode: 'mvp' });
  for (const action of [
    'probe 1 0',
    'move E',
    'probe 2 0',
    'move E',
    'probe 2 1',
    'move S',
    'probe 3 1',
    'move E',
    'extract',
    'probe 4 1',
    'move E',
    'extract',
    'probe 4 2',
    'move S',
    'probe 3 2',
    'move W',
    'extract',
    'probe 3 3',
    'move S',
    'probe 3 4',
    'move S',
    'probe 3 5',
    'move S',
    'probe 3 6',
    'probe 4 5',
    'probe 2 5',
    'move W',
    'probe 2 6',
    'probe 2 4',
    'move N',
    'move E',
    'move S',
    'move W',
    'move N',
    'move E',
    'move S',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [3, 5]);
  assert.equal(state.action_hints.goal.source, 'exit');
  assert.ok(state.action_hints.avoid_repeating.includes('move W'));
  assert.ok(state.action_hints.avoid_repeating.includes('move N'));
  assert.equal(state.action_hints.next_action, 'move N');
  assertExitHintPolicyCompletes(game);
});

test('artifact route hint escapes a two-cell trace oscillation', () => {
  const game = new EchoGridGame({ seed: 9001, mode: 'mvp' });
  for (const action of [
    'probe 0 1',
    'move S',
    'probe 1 1',
    'move E',
    'probe 1 2',
    'move S',
    'probe 2 2',
    'probe 1 3',
    'move S',
    'probe 2 3',
    'move E',
    'probe 3 3',
    'move E',
    'extract',
    'probe 4 3',
    'move E',
    'extract',
    'probe 4 4',
    'probe 5 3',
    'move E',
    'probe 5 4',
    'probe 6 3',
    'move E',
    'probe 6 4',
    'move S',
    'probe 6 5',
    'move S',
    'probe 5 5',
    'probe 6 6',
    'move N',
    'probe 7 4',
    'move S',
    'probe 7 5',
    'move N',
    'move S',
    'move N',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [6, 4]);
  assert.equal(state.objective.artifacts_collected, 2);
  assert.equal(state.action_hints.goal.source, 'trace');
  assert.equal(state.action_hints.next_action, 'move N');
  assertArtifactHintPolicyExtractsNextArtifact(game, 60);
});

test('exit route hint can route around blocked public approaches', () => {
  const game = new EchoGridGame({ seed: 7331, mode: 'mvp' });
  for (const action of [
    'probe 1 0',
    'move E',
    'probe 1 1',
    'move S',
    'probe 2 1',
    'move E',
    'extract',
    'probe 3 1',
    'move E',
    'probe 3 0',
    'probe 4 1',
    'move E',
    'probe 4 0',
    'move N',
    'extract',
    'probe 5 0',
    'move E',
    'probe 5 1',
    'move S',
    'probe 6 1',
    'move E',
    'extract',
    'probe 6 2',
    'move S',
    'probe 6 3',
    'probe 7 2',
    'probe 5 2',
    'move W',
    'probe 5 3',
    'move N',
    'move E',
    'move S',
    'move W',
    'move N',
    'move E',
    'move S',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [6, 2]);
  assert.equal(state.action_hints.goal.source, 'exit');
  assert.ok(state.action_hints.avoid_repeating.includes('move W'));
  assert.ok(state.action_hints.avoid_repeating.includes('move N'));
  assert.ok(['move N', 'move W'].includes(state.action_hints.next_action));
  assertExitHintPolicyCompletes(game);
});

test('exit route hint follows an optimistic route after a blocked exit approach', () => {
  const game = new EchoGridGame({ seed: 424242, mode: 'mvp' });
  for (const action of [
    'probe 0 1',
    'move S',
    'probe 0 2',
    'move S',
    'probe 1 2',
    'move E',
    'probe 1 3',
    'probe 2 2',
    'probe 1 1',
    'move N',
    'probe 2 1',
    'move E',
    'probe 2 0',
    'probe 3 1',
    'move E',
    'probe 3 2',
    'move S',
    'probe 3 3',
    'move S',
    'probe 2 3',
    'move W',
    'extract',
    'probe 2 4',
    'move S',
    'extract',
    'probe 1 4',
    'move W',
    'extract',
  ]) {
    game.step(action);
  }
  const state = game.state();

  assert.deepEqual(state.agent.position, [1, 4]);
  assert.equal(state.objective.artifacts_collected, 3);
  assert.equal(state.action_hints.goal.source, 'exit');
  assert.equal(state.action_hints.next_action, 'probe 1 5');
  assertExitHintPolicyCompletes(game);
});

function assertExitHintPolicyCompletes(game) {
  const seen = new Set();
  for (let i = 0; i < 80; i += 1) {
    const state = game.state();
    const action = state.action_hints.next_action;
    const signature = `${state.agent.position.join(',')}|${action}|${state.map.rows.join('/')}`;
    assert.equal(seen.has(signature), false, `exit route hint looped at ${signature}`);
    seen.add(signature);
    assert.ok(action, 'exit route hint should keep suggesting actions');
    const event = game.step(action);
    if (event.outcome.type === 'extract_exit') return;
  }
  assert.fail('exit route hint policy did not complete within 80 turns');
}

function assertArtifactHintPolicyExtractsNextArtifact(game, maxTurns) {
  const initialArtifacts = game.state().objective.artifacts_collected;
  const seen = new Set();
  for (let i = 0; i < maxTurns; i += 1) {
    const state = game.state();
    const action = state.action_hints.next_action;
    const signature = `${state.agent.position.join(',')}|${action}|${state.map.rows.join('/')}`;
    assert.equal(seen.has(signature), false, `artifact route hint looped at ${signature}`);
    seen.add(signature);
    assert.ok(action, 'artifact route hint should keep suggesting actions');
    const event = game.step(action);
    if (event.outcome.type === 'extract_artifact') {
      assert.equal(game.state().objective.artifacts_collected, initialArtifacts + 1);
      return;
    }
  }
  assert.fail(`artifact route hint policy did not extract another artifact within ${maxTurns} turns`);
}

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
