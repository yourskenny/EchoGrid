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
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'SCORECARD.md'));
  const comparisonFile = options['comparison-json']
    ? resolvePath(cwd, options['comparison-json'])
    : path.join(path.dirname(source), 'agent-comparison.json');
  const events = readJsonl(source);
  const comparison = fs.existsSync(comparisonFile)
    ? JSON.parse(fs.readFileSync(comparisonFile, 'utf8'))
    : null;

  const markdown = buildDemoScorecard(events, {
    cwd,
    source,
    comparisonFile,
    comparison,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, markdown, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildDemoScorecard(events, options = {}) {
  const start = events.find((event) => event.type === 'start');
  const actionEvents = events.filter((event) => event.type === 'action');
  const finalState = [...events].reverse().find((event) => event.state)?.state || start?.state || {};
  const terminal = finalState.turn?.terminal || {
    status: 'incomplete',
    reason: 'not_terminal',
    score: finalState.score || 0,
  };
  const objective = finalState.objective || {};
  const resources = finalState.resources || {};
  const metrics = finalState.metrics || {};
  const ruleClaim = finalState.rules?.claim || extractRuleClaim(actionEvents);
  const comparison = options.comparison || {};
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  const random = rows.find((row) => row.agent === './agents/random.js');
  const baseline = rows.find((row) => row.agent === './agents/baseline.js');
  const ruleAware = rows.find((row) => row.agent === './agents/rule-aware.js');
  const gates = [
    gate(
      'Mission completion',
      terminal.status === 'success' && terminal.reason === 'objective_complete',
      `${terminal.status || 'unknown'} / ${terminal.reason || 'unknown'}`,
      'The showcase run must finish the objective through the public action protocol.',
    ),
    gate(
      'Artifact routing',
      objective.artifacts_collected === objective.artifacts_required && Number(objective.artifacts_required || 0) > 0,
      `${objective.artifacts_collected ?? 0}/${objective.artifacts_required ?? 0}`,
      'The agent must collect all required artifacts before exit extraction.',
    ),
    gate(
      'Hidden-rule inference',
      Boolean(ruleClaim?.correct && ruleClaim?.rationale),
      ruleClaim ? `${ruleClaim.id || 'unknown'}; rationale=${ruleClaim.rationale ? 'present' : 'missing'}` : 'none',
      'The run should show an accepted rule claim with auditable public reasoning text.',
    ),
    gate(
      'Resource discipline',
      (metrics.damage_events ?? 0) === 0 && (metrics.invalid_actions ?? 0) === 0 && (metrics.wasted_actions ?? 0) === 0,
      `damage=${metrics.damage_events ?? 0}, invalid=${metrics.invalid_actions ?? 0}, wasted=${metrics.wasted_actions ?? 0}`,
      'The showcase should avoid damage, invalid commands, and wasted duplicate claims/actions.',
    ),
    gate(
      'Score bar',
      Number(terminal.score ?? finalState.score ?? 0) >= 950,
      String(terminal.score ?? finalState.score ?? 0),
      'The judge-facing route should clear the high-score demo threshold.',
    ),
    gate(
      'Agent separation',
      Boolean(random && baseline && ruleAware &&
        random.successes === 0 &&
        baseline.successes === baseline.seeds &&
        ruleAware.successes === ruleAware.seeds &&
        ruleAware.average_score > baseline.average_score),
      comparisonSummary(random, baseline, ruleAware),
      'The bundled comparison should prove that structured strategy beats both random and baseline behavior.',
    ),
  ];
  const passCount = gates.filter((item) => item.passed).length;
  const artifactEvents = actionEvents.filter((entry) => entry.event?.outcome?.type === 'extract_artifact');
  const exitEvent = actionEvents.find((entry) => entry.event?.outcome?.type === 'extract_exit');

  return [
    '# EchoGrid Demo Scorecard',
    '',
    `Generated from \`${displayPath(options.source || 'unknown', options.cwd)}\`.`,
    ...(options.comparisonFile ? [`Comparison source: \`${displayPath(options.comparisonFile, options.cwd)}\`.`] : []),
    '',
    '## Verdict',
    '',
    `Capability gates passed: ${passCount}/${gates.length}.`,
    '',
    '| Gate | Status | Evidence | Why It Matters |',
    '| --- | --- | --- | --- |',
    ...gates.map((item) =>
      `| ${md(item.name)} | ${item.passed ? 'PASS' : 'CHECK'} | ${md(item.evidence)} | ${md(item.reason)} |`,
    ),
    '',
    '## Showcase Metrics',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Seed | ${md(finalState.seed || start?.state?.seed || 'unknown')} |`,
    `| Agent | ${md(start?.agent || start?.runner || 'unknown')} |`,
    `| Result | ${md(`${terminal.status || 'unknown'} / ${terminal.reason || 'unknown'}`)} |`,
    `| Score | ${md(terminal.score ?? finalState.score ?? 0)} |`,
    `| Turns | ${md(`${finalState.turn?.current ?? 'unknown'} / ${finalState.turn?.limit ?? 'unknown'}`)} |`,
    `| Resources | ${md(`energy=${resources.energy ?? 'unknown'}, integrity=${resources.integrity ?? 'unknown'}`)} |`,
    `| Visible cells | ${md(metrics.visible_cells ?? 0)} |`,
    `| Artifacts | ${md(`${objective.artifacts_collected ?? 0}/${objective.artifacts_required ?? 0}`)} |`,
    '',
    '## Capability Evidence',
    '',
    `- Rule signal events: ${actionEvents.filter((entry) => entry.event?.outcome?.observation?.rule_signal).length}`,
    `- Accepted rule claim: ${ruleClaim?.correct ? 'yes' : 'no'}`,
    `- Artifact extraction turns: ${artifactEvents.map((entry) => entry.event?.turn ?? '?').join(', ') || 'none'}`,
    `- Exit extraction turn: ${exitEvent?.event?.turn ?? 'none'}`,
    `- Comparison seed file: ${comparison.seed_file || 'unknown'}`,
    '',
    '## Comparison Snapshot',
    '',
    rows.length ? comparisonTable(rows) : 'No comparison rows found.',
    '',
  ].join('\n');
}

function gate(name, passed, evidence, reason) {
  return { name, passed: Boolean(passed), evidence, reason };
}

function comparisonSummary(random, baseline, ruleAware) {
  if (!random || !baseline || !ruleAware) return 'missing comparison rows';
  return `random success=${random.successes}/${random.seeds}; baseline avg=${baseline.average_score}; rule-aware avg=${ruleAware.average_score}`;
}

function comparisonTable(rows) {
  return [
    '| Agent | Success | Avg Score | Avg Turns | Best | Worst |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) =>
      `| \`${md(row.agent)}\` | ${md(`${row.successes}/${row.seeds}`)} | ${md(row.average_score)} | ${md(row.average_turns)} | ${md(row.best_score)} | ${md(row.worst_score)} |`,
    ),
  ].join('\n');
}

function extractRuleClaim(actionEvents) {
  const claim = actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule')?.event?.outcome?.observation;
  if (!claim) return null;
  return {
    id: claim.rule_id || 'unknown',
    correct: Boolean(claim.accepted),
    rationale: claim.rationale || undefined,
  };
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

function md(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
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
  node ./scripts/write-demo-scorecard.js <log.jsonl> [--out SCORECARD.md] [--comparison-json agent-comparison.json]

Creates a capability scorecard for the EchoGrid judge package.`;
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
  buildDemoScorecard,
};
