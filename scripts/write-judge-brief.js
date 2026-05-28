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
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'JUDGE_BRIEF.md'));
  const replayHtml = resolvePath(cwd, options['replay-html'] || path.join(path.dirname(source), 'replay.html'));
  const dashboardHtml = options['dashboard-html'] ? resolvePath(cwd, options['dashboard-html']) : null;
  const arenaHtml = options['arena-html'] ? resolvePath(cwd, options['arena-html']) : null;
  const leaderboardFile = options.leaderboard ? resolvePath(cwd, options.leaderboard) : null;
  const comparisonFile = options.comparison ? resolvePath(cwd, options.comparison) : null;

  const events = readJsonl(source);
  const comparisonText = comparisonFile ? readOptionalText(comparisonFile) : '';
  const markdown = buildJudgeBrief(events, {
    cwd,
    source,
    outFile,
    replayHtml,
    dashboardHtml,
    arenaHtml,
    leaderboardFile,
    comparisonFile,
    comparisonText,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, markdown, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildJudgeBrief(events, options = {}) {
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
  const score = finalState.score_breakdown || {};
  const ruleClaim = finalState.rules?.claim || null;
  const sourcePath = displayPath(options.source || 'unknown', options.cwd);
  const outPath = displayPath(options.outFile || 'logs/showcase/JUDGE_BRIEF.md', options.cwd);
  const replayPath = displayPath(options.replayHtml || 'logs/showcase/replay.html', options.cwd);
  const dashboardPath = options.dashboardHtml ? displayPath(options.dashboardHtml, options.cwd) : null;
  const arenaPath = options.arenaHtml ? displayPath(options.arenaHtml, options.cwd) : null;
  const leaderboardPath = options.leaderboardFile ? displayPath(options.leaderboardFile, options.cwd) : null;
  const comparisonPath = options.comparisonFile ? displayPath(options.comparisonFile, options.cwd) : null;
  const penalties = sum([
    score.damage_penalty,
    score.false_mark_penalty,
    score.invalid_action_penalty,
    score.wasted_action_penalty,
  ]);
  const keyEvents = collectKeyEvents(actionEvents);
  const riskNotes = collectRiskNotes(actionEvents, terminal, metrics);
  const hiddenRule = terminal.hidden_rule || ruleClaim?.id || 'unknown';
  const result = terminal.status || 'incomplete';
  const reason = terminal.reason || 'not_terminal';

  return [
    '# EchoGrid Judge Brief',
    '',
    `Generated from \`${sourcePath}\`.`,
    '',
    '## Open First',
    '',
    `1. \`${outPath}\` - this one-page handoff.`,
    ...(dashboardPath ? [`2. \`${dashboardPath}\` - presentation dashboard with map, route, score, and evidence links.`] : []),
    ...(arenaPath ? [`${2 + (dashboardPath ? 1 : 0)}. \`${arenaPath}\` - side-by-side agent arena for strategy comparison.`] : []),
    ...(leaderboardPath ? [`${2 + (dashboardPath ? 1 : 0) + (arenaPath ? 1 : 0)}. \`${leaderboardPath}\` - ranked tournament-style result table.`] : []),
    `${2 + (dashboardPath ? 1 : 0) + (arenaPath ? 1 : 0) + (leaderboardPath ? 1 : 0)}. \`${replayPath}\` - self-contained visual replay with board states, key events, and score curve.`,
    `${3 + (dashboardPath ? 1 : 0) + (arenaPath ? 1 : 0) + (leaderboardPath ? 1 : 0)}. \`${sourcePath}\` - raw JSONL audit log for every state, action, and outcome.`,
    '',
    '## Result Snapshot',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Seed | ${mdCell(finalState.seed || start?.state?.seed || 'unknown')} |`,
    `| Agent | ${mdCell(start?.agent || start?.runner || 'unknown')} |`,
    `| Result | ${mdCell(`${result.toUpperCase()} / ${reason}`)} |`,
    `| Score | ${mdCell(terminal.score ?? finalState.score ?? 0)} |`,
    `| Turns | ${mdCell(`${finalState.turn?.current ?? 'unknown'} / ${finalState.turn?.limit ?? 'unknown'}`)} |`,
    `| Artifacts | ${mdCell(`${objective.artifacts_collected ?? 0} / ${objective.artifacts_required ?? 0}`)} |`,
    `| Resources | ${mdCell(`energy=${resources.energy ?? 'unknown'}, integrity=${resources.integrity ?? 'unknown'}`)} |`,
    `| Hidden rule | ${mdCell(hiddenRule)} |`,
    `| Rule claim | ${mdCell(formatRuleClaim(ruleClaim))} |`,
    '',
    '## What This Proves',
    '',
    '- The demo is deterministic from a seed and can be replayed from JSONL.',
    '- The agent acts only through the public state/action protocol.',
    '- The showcase path demonstrates rule inference, artifact routing, exit extraction, scoring, and auditability.',
    '- The generated dashboard and HTML replay make the behavior inspectable without a server or external assets.',
    '',
    '## 90-Second Judge Script',
    '',
    '1. Run `npm run demo:full` from the repository root.',
    `2. Open ${dashboardPath ? `\`${dashboardPath}\` for the one-page dashboard, then ` : ''}${leaderboardPath ? `\`${leaderboardPath}\` for the ranked result, then ` : ''}${arenaPath ? `\`${arenaPath}\` to compare bundled agents, then ` : ''}\`${replayPath}\` and use the Key Events buttons.`,
    '3. Jump to the rule signal and rule claim, then the artifact events and final exit extraction.',
    '4. Check the score curve and battle report to connect strategy quality to score.',
    '5. Compare random, baseline, and rule-aware agents to verify the game rewards structured planning.',
    '',
    '## Key Events',
    '',
    ...(keyEvents.length ? keyEvents : ['- No major milestones recorded.']),
    '',
    '## Score Breakdown',
    '',
    `- Mission: ${score.mission_value ?? 0}`,
    `- Artifacts: ${score.artifact_value ?? 0}`,
    `- Map certainty: ${score.map_certainty_bonus ?? 0}`,
    `- Rule discovery: ${score.rule_discovery_bonus ?? 0}`,
    `- Unused energy: ${score.unused_energy_bonus ?? 0}`,
    `- Integrity: ${score.integrity_bonus ?? 0}`,
    `- Penalties: ${penalties}`,
    '',
    '## Audit Notes',
    '',
    `- Visible cells at finish: ${metrics.visible_cells ?? 0}`,
    `- Damage events: ${metrics.damage_events ?? 0}`,
    `- Invalid actions: ${metrics.invalid_actions ?? 0}`,
    `- Wasted actions: ${metrics.wasted_actions ?? 0}`,
    ...riskNotes,
    '',
    '## Agent Comparison',
    '',
    ...(options.comparisonText
      ? [
          comparisonPath ? `Captured from \`${comparisonPath}\`.` : 'Captured from the demo run.',
          '',
          '```text',
          trimForFence(options.comparisonText),
          '```',
        ]
      : [
          'Run `npm run compare` to regenerate the random vs baseline vs rule-aware table.',
        ]),
    '',
  ].join('\n');
}

function collectKeyEvents(actionEvents) {
  const events = [];
  for (const entry of actionEvents) {
    const outcome = entry.event?.outcome || {};
    const turn = entry.event?.turn ?? '?';
    if (outcome.type === 'scan' && outcome.observation?.rule_signal) {
      events.push(`- Turn ${turn}: rule signal observed (${outcome.observation.rule_signal}).`);
    }
    if (outcome.type === 'claim_rule') {
      const accepted = outcome.observation?.accepted ? 'accepted' : 'rejected';
      const rationale = outcome.observation?.rationale ? ` Rationale: ${outcome.observation.rationale}.` : '';
      events.push(`- Turn ${turn}: rule claim ${accepted} (${outcome.observation?.rule_id || 'unknown'}).${rationale}`);
    }
    if (outcome.type === 'extract_artifact') {
      const coord = formatCoord(outcome.observation?.coord);
      const total = outcome.observation?.artifacts_collected ?? '?';
      events.push(`- Turn ${turn}: artifact extracted at ${coord}; total=${total}.`);
    }
    if (outcome.type === 'extract_exit') {
      events.push(`- Turn ${turn}: exit extraction completed the objective.`);
    }
    if (outcome.ok === false) {
      events.push(`- Turn ${turn}: failed action "${entry.command}" (${outcome.message || outcome.type || 'unknown'}).`);
    }
  }
  return events.slice(0, 12);
}

function collectRiskNotes(actionEvents, terminal, metrics) {
  const notes = [];
  if ((terminal.status || 'incomplete') !== 'success') {
    notes.push(`- Terminal risk: ${terminal.status || 'unknown'} / ${terminal.reason || 'not_terminal'}.`);
  }
  if ((metrics.damage_events ?? 0) === 0 && (metrics.invalid_actions ?? 0) === 0 && (metrics.wasted_actions ?? 0) === 0) {
    notes.push('- No damage, invalid actions, or wasted actions recorded in the showcase log.');
    return notes;
  }
  for (const entry of actionEvents) {
    const outcome = entry.event?.outcome || {};
    const turn = entry.event?.turn ?? '?';
    if (outcome.type === 'move' && outcome.observations?.some((item) => item.type === 'damage')) {
      notes.push(`- Turn ${turn}: hazard contact reduced integrity.`);
    }
    if (outcome.type === 'invalid' || outcome.ok === false) {
      notes.push(`- Turn ${turn}: invalid or failed action "${entry.command}".`);
    }
    if (outcome.repeated) {
      notes.push(`- Turn ${turn}: repeated probe at ${formatCoord(outcome.coord)}.`);
    }
  }
  return notes.slice(0, 8);
}

function formatRuleClaim(ruleClaim) {
  if (!ruleClaim) return 'none';
  const status = ruleClaim.correct ? 'accepted' : 'rejected';
  return `${ruleClaim.id || 'unknown'} (${status}, turn ${ruleClaim.turn ?? '?'})`;
}

function formatCoord(coord) {
  return Array.isArray(coord) ? `(${coord.join(',')})` : '(unknown)';
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

function readOptionalText(file) {
  if (!file || !fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
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

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function trimForFence(value) {
  return String(value || '').trim().replace(/```/g, "'''");
}

function usage() {
  return `Usage:
  node ./scripts/write-judge-brief.js <log.jsonl> [--out JUDGE_BRIEF.md] [--replay-html replay.html] [--dashboard-html mission-control.html] [--arena-html arena.html] [--leaderboard leaderboard.md] [--comparison agent-comparison.txt]

Creates a judge-facing Markdown brief from an EchoGrid JSONL log.`;
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
  buildJudgeBrief,
};
