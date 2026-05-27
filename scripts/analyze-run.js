#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
  process.stderr.write('Usage: node ./scripts/analyze-run.js <run.jsonl>\n');
  process.exit(1);
}

const file = path.resolve(process.cwd(), input);
const events = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const actions = events.filter((event) => event.type === 'action');
const final = [...events].reverse().find((event) => event.state)?.state;

if (!actions.length || !final) {
  process.stderr.write('No action events found.\n');
  process.exit(1);
}

const metrics = analyze(actions, final);
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);

function analyze(actionEvents, finalState) {
  const commands = actionEvents.map((event) => String(event.command));
  const invalid = actionEvents.filter((event) => !event.event.outcome.ok).length;
  const waits = commands.filter((command) => command === 'wait').length;
  const repeatedCommands = countRepeated(commands);
  const oscillations = countOscillations(actionEvents);
  const movement = movementProgress(actionEvents, finalState);
  const diagnostics = summarizeDiagnostics(actionEvents);
  const terminal = finalState.turn?.terminal || {};
  const turns = finalState.turn?.current || actionEvents.length;
  const success = terminal.status === 'success';
  return {
    seed: finalState.seed,
    status: terminal.status || 'unknown',
    reason: terminal.reason || 'unknown',
    score: terminal.score ?? finalState.score,
    turns,
    artifacts: `${finalState.objective?.artifacts_collected ?? 0}/${finalState.objective?.artifacts_required ?? 0}`,
    invalid_actions: invalid,
    wait_actions: waits,
    repeated_commands: repeatedCommands,
    movement_oscillations: oscillations,
    unique_positions: movement.uniquePositions,
    final_distance_to_exit: movement.finalDistanceToExit,
    min_distance_to_exit: movement.minDistanceToExit,
    distance_to_exit_delta: movement.distanceToExitDelta,
    aborted: eventsIncludeAbort(actionEvents, finalState),
    model_actions: diagnostics.modelActions,
    fallback_actions: diagnostics.fallbackActions,
    local_policy_actions: diagnostics.localActions,
    model_error_actions: diagnostics.modelErrors,
    recovered_reasoning_actions: diagnostics.recoveredActions,
    leaderboard: diagnostics.fallbackModes.has('none') ? 'pure' : diagnostics.fallbackModes.size ? 'hybrid' : 'unknown',
    top_diagnostic_reasons: topReasons(diagnostics.reasons),
    quality: {
      success,
      invalid_rate: round(invalid / turns),
      wait_rate: round(waits / turns),
      fallback_rate: round(diagnostics.fallbackActions / turns),
      model_contribution_rate: round(diagnostics.modelActions / turns),
      model_error_rate: round(diagnostics.modelErrors / turns),
      recovered_reasoning_rate: round(diagnostics.recoveredActions / turns),
      oscillation_rate: round(oscillations / turns),
      exploration_rate: round(movement.uniquePositions / turns),
    },
    flags: flags({ success, invalid, waits, turns, diagnostics, oscillations, movement }),
  };
}

function eventsIncludeAbort(actionEvents, finalState) {
  return Boolean(finalState.turn?.terminal?.reason && String(finalState.turn.terminal.reason).startsWith('model_')) &&
    actionEvents.some((event) => event.agent_diagnostic?.abort_evaluation);
}

function countRepeated(commands) {
  let repeated = 0;
  for (let i = 1; i < commands.length; i += 1) {
    if (commands[i] === commands[i - 1]) repeated += 1;
  }
  return repeated;
}

function countOscillations(actionEvents) {
  const positions = actionEvents
    .map((event) => event.state?.agent?.position)
    .filter((position) => Array.isArray(position))
    .map((position) => position.join(','));
  let count = 0;
  for (let i = 2; i < positions.length; i += 1) {
    if (positions[i] === positions[i - 2] && positions[i] !== positions[i - 1]) count += 1;
  }
  return count;
}

function movementProgress(actionEvents, finalState) {
  const positions = actionEvents
    .map((event) => event.state?.agent?.position)
    .filter((position) => Array.isArray(position));
  if (Array.isArray(finalState.agent?.position)) positions.push(finalState.agent.position);
  const exit = finalState.objective?.exit;
  const uniquePositions = new Set(positions.map((position) => position.join(','))).size;
  const distances = Array.isArray(exit) ? positions.map((position) => manhattan(position, exit)) : [];
  return {
    uniquePositions,
    finalDistanceToExit: distances.length ? distances.at(-1) : null,
    minDistanceToExit: distances.length ? Math.min(...distances) : null,
    distanceToExitDelta: distances.length ? distances[0] - distances.at(-1) : null,
  };
}

function summarizeDiagnostics(actionEvents) {
  const reasons = {};
  let modelActions = 0;
  let fallbackActions = 0;
  let localActions = 0;
  let modelErrors = 0;
  let recoveredActions = 0;
  const fallbackModes = new Set();
  for (const event of actionEvents) {
    const diagnostic = event.agent_diagnostic;
    if (!diagnostic) continue;
    if (diagnostic.fallback_mode) fallbackModes.add(diagnostic.fallback_mode);
    if (diagnostic.recovered_from_reasoning) recoveredActions += 1;
    if (diagnostic.model_error) {
      modelErrors += 1;
      const reason = diagnostic.reason || 'model_error';
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else if (diagnostic.local_policy) {
      localActions += 1;
      reasons.local = (reasons.local || 0) + 1;
    } else if (diagnostic.fallback) {
      fallbackActions += 1;
      const reason = diagnostic.reason || diagnostic.fallback_policy || 'fallback';
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else {
      modelActions += 1;
      reasons.model = (reasons.model || 0) + 1;
    }
  }
  return { fallbackActions, localActions, modelActions, modelErrors, recoveredActions, fallbackModes, reasons };
}

function topReasons(reasons) {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function flags({ success, invalid, waits, turns, diagnostics, oscillations, movement }) {
  const result = [];
  if (!success) result.push('not_successful');
  if (invalid > 0) result.push('invalid_actions_present');
  if (waits / turns > 0.25) result.push('high_wait_rate');
  if (diagnostics.fallbackActions / turns > 0.5) result.push('fallback_dominant');
  if (diagnostics.modelActions > 0 && diagnostics.modelActions / turns < 0.1) result.push('low_model_contribution');
  if (oscillations / turns > 0.15) result.push('movement_oscillation');
  if (!success && movement.distanceToExitDelta !== null && movement.distanceToExitDelta <= 0 && turns > 3) {
    result.push('no_exit_progress');
  }
  return result;
}

function round(value) {
  return Number(value.toFixed(3));
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
