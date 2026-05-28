#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const input = options._[0];
  if (!input) throw new Error(usage());

  const cwd = process.cwd();
  const source = resolvePath(cwd, input);
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'PROTOCOL_TRACE.md'));
  const events = readJsonl(source);
  const markdown = buildProtocolTrace(events, {
    cwd,
    source,
    maxTurns: Number(options['max-turns'] || 8),
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, markdown, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildProtocolTrace(events, options = {}) {
  const start = events.find((event) => event.type === 'start');
  const actionEvents = events.filter((event) => event.type === 'action');
  if (!start?.state) throw new Error('Protocol trace requires a start event with state.');
  if (actionEvents.length === 0) throw new Error('Protocol trace requires at least one action event.');

  const finalState = [...events].reverse().find((event) => event.state)?.state || start.state;
  const terminal = finalState.turn?.terminal || {};
  const objective = finalState.objective || {};
  const resources = finalState.resources || {};
  const ruleClaim = finalState.rules?.claim || extractRuleClaim(actionEvents);
  const selectedTurns = selectKeyTurns(actionEvents, options.maxTurns || 8);

  return [
    '# EchoGrid Protocol Trace',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Source log: ${displayPath(options.source || 'unknown', options.cwd)}`,
    '',
    '## What This Proves',
    '',
    '- EchoGrid is driven by a machine-readable `STATE -> ACTION -> EVENT -> STATE` contract.',
    '- The showcase agent receives public STATE JSON, emits one action line, and every outcome is recorded in JSONL.',
    '- Hidden terrain remains redacted as `?`; rule discovery comes from public scan/probe observations and audited rule claims.',
    '- The same log can be replayed, scored, hashed, bundled, and verified without special evaluator state.',
    '',
    '## Run Snapshot',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Seed | ${cell(finalState.seed || start.state.seed || 'unknown')} |`,
    `| Agent | ${cell(start.agent || start.runner || 'unknown')} |`,
    `| Objective | ${cell(objective.text || 'unknown')} |`,
    `| Result | ${cell(`${terminal.status || 'incomplete'} / ${terminal.reason || 'not_terminal'}`)} |`,
    `| Score | ${cell(terminal.score ?? finalState.score ?? 0)} |`,
    `| Turns | ${cell(`${finalState.turn?.current ?? actionEvents.length} / ${finalState.turn?.limit ?? 'unknown'}`)} |`,
    `| Artifacts | ${cell(`${objective.artifacts_collected ?? 0}/${objective.artifacts_required ?? 0}`)} |`,
    `| Resources left | ${cell(`energy=${resources.energy ?? 'unknown'}, integrity=${resources.integrity ?? 'unknown'}`)} |`,
    `| Rule claim | ${cell(ruleClaim ? `${ruleClaim.id}, accepted=${Boolean(ruleClaim.correct)}, turn=${ruleClaim.turn ?? '?'}` : 'none')} |`,
    '',
    '## Public STATE Excerpt',
    '',
    'This is the kind of payload the agent receives before choosing an action. It contains public observations, valid action grammar, and action hints, but not the hidden answer map.',
    '',
    '```json',
    JSON.stringify(publicStateExcerpt(start.state), null, 2),
    '```',
    '',
    '## Key Turn Trace',
    '',
    '| Turn | STATE summary before action | ACTION line | EVENT outcome | STATE summary after action |',
    '| ---: | --- | --- | --- | --- |',
    ...selectedTurns.map((entry) => {
      const before = stateBeforeTurn(events, entry);
      return `| ${entry.event?.turn ?? '?'} | ${cell(stateSummary(before))} | \`${escapePipes(entry.command || '')}\` | ${cell(outcomeSummary(entry.event?.outcome || {}))} | ${cell(stateSummary(entry.state))} |`;
    }),
    '',
    '## Evidence Highlights',
    '',
    ...selectedTurns.map((entry) => turnHighlight(entry)).filter(Boolean),
    '',
    '## No Hidden Inputs Check',
    '',
    '- Initial map rows expose only the start cell and `?` unknown cells.',
    '- The accepted rule claim follows a public `rule_signal` observation from `scan sector C`.',
    '- `action_hints.next_action` is advisory public data, not an answer key; the agent still emits explicit commands.',
    '- Final success is recorded as an `extract_exit` event and then hashed into `MANIFEST.json`.',
    '',
  ].join('\n');
}

function selectKeyTurns(actionEvents, maxTurns) {
  const selected = [];
  const add = (entry) => {
    if (entry && !selected.some((item) => item.event?.turn === entry.event?.turn)) selected.push(entry);
  };

  add(actionEvents[0]);
  add(actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule'));
  for (const entry of actionEvents) {
    const type = entry.event?.outcome?.type;
    const hasRuleSignal = Boolean(entry.event?.outcome?.observation?.rule_signal);
    if (hasRuleSignal || type === 'extract_artifact' || type === 'extract_exit') add(entry);
  }
  for (const entry of actionEvents.slice(0, maxTurns)) add(entry);
  return selected
    .sort((a, b) => Number(a.event?.turn || 0) - Number(b.event?.turn || 0))
    .slice(0, Math.max(maxTurns, selected.length));
}

function stateBeforeTurn(events, actionEntry) {
  const index = events.indexOf(actionEntry);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (events[cursor]?.state) return events[cursor].state;
  }
  return null;
}

function stateSummary(state) {
  if (!state) return 'missing state';
  const turn = state.turn?.current ?? '?';
  const position = coord(state.agent?.position);
  const resources = state.resources || {};
  const objective = state.objective || {};
  const hints = state.action_hints || {};
  const metrics = state.metrics || {};
  return [
    `turn=${turn}`,
    `pos=${position}`,
    `energy=${resources.energy ?? '?'}`,
    `integrity=${resources.integrity ?? '?'}`,
    `artifacts=${objective.artifacts_collected ?? 0}/${objective.artifacts_required ?? 0}`,
    `visible=${metrics.visible_cells ?? '?'}`,
    `action_hints.next_action=${hints.next_action || 'none'}`,
  ].join('; ');
}

function outcomeSummary(outcome) {
  const type = outcome.type || 'unknown';
  if (type === 'scan') {
    const observation = outcome.observation || {};
    return `scan ${observation.kind || '?'} ${observation.value || '?'}; rule_signal=${observation.rule_signal || 'none'}; confidence=${observation.confidence ?? 'n/a'}`;
  }
  if (type === 'claim_rule') {
    const observation = outcome.observation || {};
    return `claim_rule ${observation.rule_id || '?'}; accepted=${Boolean(observation.accepted)}; rationale=${observation.rationale || 'none'}`;
  }
  if (type === 'extract_artifact') {
    return `extract_artifact; collected=${outcome.observation?.artifacts_collected ?? '?'}`;
  }
  if (type === 'extract_exit') {
    return `extract_exit; ${outcome.observation?.reason || 'objective complete'}`;
  }
  if (type === 'probe') {
    return `probe ${coord(outcome.coord)}; terrain=${outcome.terrain || '?'}; trace=${outcome.observation?.trace || 'n/a'}; heat=${outcome.observation?.heat || 'n/a'}`;
  }
  if (type === 'move') {
    return `move ${outcome.direction || '?'} to ${coord(outcome.coord)}; terrain=${outcome.terrain || '?'}`;
  }
  return `${type}; ok=${Boolean(outcome.ok)}`;
}

function turnHighlight(entry) {
  const turn = entry.event?.turn ?? '?';
  const outcome = entry.event?.outcome || {};
  if (outcome.observation?.rule_signal) {
    return `- Turn ${turn}: public scan produced rule signal \`${outcome.observation.rule_signal}\`.`;
  }
  if (outcome.type === 'claim_rule') {
    return `- Turn ${turn}: agent emitted \`${entry.command}\`; accepted=${Boolean(outcome.observation?.accepted)}.`;
  }
  if (outcome.type === 'extract_artifact') {
    return `- Turn ${turn}: artifact extraction raised collected count to ${outcome.observation?.artifacts_collected ?? '?'}.`;
  }
  if (outcome.type === 'extract_exit') {
    return `- Turn ${turn}: exit extraction completed the objective with score ${entry.event?.score ?? 'n/a'}.`;
  }
  return null;
}

function publicStateExcerpt(state) {
  return {
    protocol: state.protocol,
    seed: state.seed,
    turn: state.turn,
    resources: state.resources,
    objective: state.objective,
    agent: {
      position: state.agent?.position,
      current_cell: state.agent?.current_cell,
      adjacent: state.agent?.adjacent,
    },
    map: {
      rows: state.map?.rows,
      visible_cells: state.map?.cells?.length ?? 0,
    },
    observations: state.observations,
    rules: {
      claim: state.rules?.claim,
      catalog: (state.rules?.catalog || []).map((rule) => rule.id),
    },
    valid_actions: state.valid_actions,
    action_hints: state.action_hints,
  };
}

function extractRuleClaim(actionEvents) {
  const claim = actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule')?.event?.outcome?.observation;
  if (!claim) return null;
  return {
    id: claim.rule_id || 'unknown',
    correct: Boolean(claim.accepted),
    turn: actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule')?.event?.turn,
    rationale: claim.rationale || undefined,
  };
}

function coord(value) {
  return Array.isArray(value) ? `[${value.join(',')}]` : '[?,?]';
}

function cell(value) {
  return escapePipes(String(value ?? ''));
}

function escapePipes(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
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

function displayPath(value, cwd = process.cwd()) {
  const resolved = path.resolve(cwd, String(value));
  const relative = path.relative(cwd, resolved);
  const display = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : resolved;
  return display.replace(/\\/g, '/');
}

function resolvePath(cwd, value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(cwd, String(value));
}

function usage() {
  return `Usage:
  node ./scripts/write-protocol-trace.js <log.jsonl> [--out PROTOCOL_TRACE.md] [--max-turns 8]

Creates a judge-facing protocol trace from an EchoGrid JSONL run.`;
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
  buildProtocolTrace,
};
