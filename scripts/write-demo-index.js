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
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'index.html'));
  const artifactPaths = {
    manifest: resolvePath(cwd, options.manifest || path.join(path.dirname(source), 'MANIFEST.json')),
    brief: resolvePath(cwd, options.brief || path.join(path.dirname(source), 'JUDGE_BRIEF.md')),
    leaderboard: resolvePath(cwd, options.leaderboard || path.join(path.dirname(source), 'leaderboard.md')),
    arena: resolvePath(cwd, options['arena-html'] || path.join(path.dirname(source), 'arena.html')),
    replay: resolvePath(cwd, options['replay-html'] || path.join(path.dirname(source), 'replay.html')),
    log: source,
  };
  const comparisonJson = options['comparison-json']
    ? resolvePath(cwd, options['comparison-json'])
    : path.join(path.dirname(source), 'agent-comparison.json');

  const events = readJsonl(source);
  const comparison = fs.existsSync(comparisonJson)
    ? JSON.parse(fs.readFileSync(comparisonJson, 'utf8'))
    : null;
  const html = buildDemoIndex(events, {
    cwd,
    source,
    outFile,
    artifactPaths,
    comparison,
    comparisonJson,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildDemoIndex(events, options = {}) {
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
  const ruleClaim = finalState.rules?.claim || null;
  const comparison = options.comparison || {};
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  const rankings = Array.isArray(comparison.rankings) ? comparison.rankings : rankRows(rows);
  const leader = rankings[0] || rows[0] || null;
  const artifacts = artifactLinks(options.artifactPaths || {}, options.outFile || process.cwd());
  const milestones = collectMilestones(actionEvents);
  const summary = {
    seed: finalState.seed || start?.state?.seed || 'unknown',
    agent: start?.agent || start?.runner || 'unknown',
    result: `${String(terminal.status || 'incomplete').toUpperCase()} / ${terminal.reason || 'not_terminal'}`,
    score: terminal.score ?? finalState.score ?? 0,
    turns: `${finalState.turn?.current ?? 'unknown'} / ${finalState.turn?.limit ?? 'unknown'}`,
    artifacts: `${objective.artifacts_collected ?? 0} / ${objective.artifacts_required ?? 0}`,
    resources: `energy=${resources.energy ?? 'unknown'}, integrity=${resources.integrity ?? 'unknown'}`,
    rule: terminal.hidden_rule || ruleClaim?.id || 'unknown',
    claim: ruleClaim ? `${ruleClaim.id} (${ruleClaim.correct ? 'accepted' : 'rejected'}, turn ${ruleClaim.turn ?? '?'})` : 'none',
  };
  const data = {
    summary,
    metrics,
    artifacts: artifacts.map(({ label, href }) => ({ label, href })),
    comparison_seed_file: comparison.seed_file || 'unknown',
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EchoGrid Demo Index</title>
<style>
:root {
  --ink: #1f292b;
  --muted: #647173;
  --bg: #f8f8f5;
  --panel: #ffffff;
  --line: #d8dfdc;
  --teal: #1d7282;
  --green: #2d7a46;
  --amber: #9b6500;
  --red: #a33c3c;
  --violet: #665b8f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 24px 0 32px;
}
header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: end;
  border-bottom: 1px solid var(--line);
  padding-bottom: 16px;
}
h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
.subtle { margin: 5px 0 0; color: var(--muted); }
.stamp { color: var(--muted); font-size: 12px; text-align: right; }
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.metric, .panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.metric {
  min-height: 82px;
  padding: 12px;
}
.metric span { display: block; color: var(--muted); font-size: 12px; }
.metric strong { display: block; margin-top: 6px; font-size: 22px; overflow-wrap: anywhere; }
.success { color: var(--green); }
.failure { color: var(--red); }
.grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 12px;
}
.panel { min-width: 0; padding: 14px; }
.panel h2 { margin: 0 0 10px; font-size: 15px; }
.links {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.artifact {
  display: block;
  min-height: 56px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  text-decoration: none;
  background: #fbfcfb;
}
.artifact:hover { border-color: var(--teal); }
.artifact strong { display: block; font-size: 13px; }
.artifact span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.steps {
  margin: 0;
  padding-left: 18px;
}
.steps li { margin: 6px 0; }
.timeline {
  display: grid;
  gap: 8px;
}
.event {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
}
.event:last-child { border-bottom: 0; padding-bottom: 0; }
.turn { color: var(--muted); font-variant-numeric: tabular-nums; }
.event strong { display: block; }
.event span { display: block; color: var(--muted); overflow-wrap: anywhere; }
table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
th, td {
  border-bottom: 1px solid var(--line);
  padding: 8px 6px;
  text-align: left;
  vertical-align: top;
}
th { color: var(--muted); font-size: 12px; font-weight: 650; }
.right { text-align: right; }
.rank { color: var(--violet); font-weight: 700; }
.ok { color: var(--green); font-weight: 700; }
.warn { color: var(--amber); font-weight: 700; }
code {
  background: #eef2f1;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 5px;
}
@media (max-width: 900px) {
  main { width: min(100vw - 20px, 1180px); }
  header, .grid { grid-template-columns: 1fr; }
  .stamp { text-align: left; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .links { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .metrics { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>EchoGrid Demo Index</h1>
      <p class="subtle">Single entry point for the judge-facing showcase package.</p>
    </div>
    <div class="stamp">Generated from <code>${escapeHtml(displayPath(options.source || 'unknown', options.cwd))}</code></div>
  </header>

  <section class="metrics" aria-label="Result snapshot">
    ${metric('Result', summary.result, terminal.status === 'success' ? 'success' : 'failure')}
    ${metric('Score', summary.score)}
    ${metric('Turns', summary.turns)}
    ${metric('Artifacts', summary.artifacts)}
    ${metric('Resources', summary.resources)}
    ${metric('Hidden Rule', summary.rule)}
    ${metric('Rule Claim', summary.claim)}
    ${metric('Leader', leader ? shortAgent(leader.agent) : 'unknown')}
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Open Order</h2>
      <div class="links">
        ${artifacts.map((item) => artifactLink(item)).join('\n')}
      </div>
    </div>
    <div class="panel">
      <h2>90-Second Runbook</h2>
      <ol class="steps">
        <li>Run <code>npm run demo:full</code> from the repository root.</li>
        <li>Open this index, then the judge brief for the concise scoring handoff.</li>
        <li>Use the arena and leaderboard to compare random, baseline, and rule-aware agents.</li>
        <li>Open the replay viewer and jump between key events to inspect the action trace.</li>
      </ol>
    </div>
  </section>

  <section class="grid" style="margin-top:12px">
    <div class="panel">
      <h2>Showcase Milestones</h2>
      <div class="timeline">
        ${milestones.length ? milestones.map((item) => milestone(item)).join('\n') : '<div class="event"><div class="turn">n/a</div><div><strong>No milestones recorded</strong><span>Check the JSONL log for raw events.</span></div></div>'}
      </div>
    </div>
    <div class="panel">
      <h2>Leaderboard Snapshot</h2>
      ${leaderboardTable(rankings, rows)}
    </div>
  </section>

  <section class="panel" style="margin-top:12px">
    <h2>Audit Gates</h2>
    <table>
      <thead><tr><th>Gate</th><th class="right">Value</th><th>Status</th></tr></thead>
      <tbody>
        ${auditRow('Damage events', metrics.damage_events ?? 0, (metrics.damage_events ?? 0) === 0)}
        ${auditRow('Invalid actions', metrics.invalid_actions ?? 0, (metrics.invalid_actions ?? 0) === 0)}
        ${auditRow('Wasted actions', metrics.wasted_actions ?? 0, (metrics.wasted_actions ?? 0) === 0)}
        ${auditRow('Artifacts collected', summary.artifacts, objective.artifacts_collected === objective.artifacts_required)}
        ${auditRow('Rule rationale', ruleClaim?.rationale ? 'present' : 'missing', Boolean(ruleClaim?.rationale))}
      </tbody>
    </table>
  </section>
</main>
<script>
const demoSummary = ${JSON.stringify(data, null, 2)};
</script>
</body>
</html>`;
}

function artifactLinks(paths, outFile) {
  const labels = [
    ['Demo Index', outFile, 'This overview page'],
    ['Manifest', paths.manifest, 'Hash-checked artifact inventory'],
    ['Judge Brief', paths.brief, 'One-page scoring handoff'],
    ['Leaderboard', paths.leaderboard, 'Ranked tournament table'],
    ['Arena', paths.arena, 'Side-by-side agent comparison'],
    ['Replay', paths.replay, 'Turn-by-turn visual trace'],
    ['JSONL Log', paths.log, 'Raw audit trail'],
  ];
  return labels
    .filter(([, file]) => file)
    .map(([label, file, description]) => ({
      label,
      href: relativeHref(outFile, file),
      path: displayPath(file),
      description,
    }));
}

function collectMilestones(actionEvents) {
  const milestones = [];
  for (const entry of actionEvents) {
    const outcome = entry.event?.outcome || {};
    const turn = entry.event?.turn ?? '?';
    if (outcome.type === 'scan' && outcome.observation?.rule_signal) {
      milestones.push({
        turn,
        title: 'Rule signal observed',
        detail: outcome.observation.rule_signal,
      });
    }
    if (outcome.type === 'claim_rule') {
      milestones.push({
        turn,
        title: outcome.observation?.accepted ? 'Rule claim accepted' : 'Rule claim rejected',
        detail: outcome.observation?.rationale || outcome.observation?.rule_id || 'no rationale recorded',
      });
    }
    if (outcome.type === 'extract_artifact') {
      milestones.push({
        turn,
        title: 'Artifact extracted',
        detail: `total=${outcome.observation?.artifacts_collected ?? '?'}`,
      });
    }
    if (outcome.type === 'extract_exit') {
      milestones.push({
        turn,
        title: 'Objective complete',
        detail: 'exit extraction completed',
      });
    }
  }
  return milestones.slice(0, 10);
}

function leaderboardTable(rankings, rows) {
  if (!rankings.length) return '<p class="subtle">No comparison data found.</p>';
  const byAgent = new Map(rows.map((row) => [row.agent, row]));
  return `<table>
  <thead><tr><th>Rank</th><th>Agent</th><th class="right">Success</th><th class="right">Avg Score</th><th class="right">Best</th></tr></thead>
  <tbody>
    ${rankings.map((ranked) => {
      const row = byAgent.get(ranked.agent) || ranked;
      return `<tr>
        <td class="rank">${escapeHtml(ranked.rank ?? '?')}</td>
        <td>${escapeHtml(ranked.agent || 'unknown')}</td>
        <td class="right">${formatPercent(row.success_rate)}</td>
        <td class="right">${escapeHtml(row.average_score ?? 'n/a')}</td>
        <td class="right">${escapeHtml(row.best_score ?? 'n/a')}</td>
      </tr>`;
    }).join('\n')}
  </tbody>
</table>`;
}

function metric(label, value, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong${classAttr}>${escapeHtml(value)}</strong></div>`;
}

function artifactLink(item) {
  return `<a class="artifact" href="${escapeHtml(item.href)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)} - ${escapeHtml(item.path)}</span></a>`;
}

function milestone(item) {
  return `<div class="event"><div class="turn">Turn ${escapeHtml(item.turn)}</div><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div></div>`;
}

function auditRow(label, value, passed) {
  return `<tr><td>${escapeHtml(label)}</td><td class="right">${escapeHtml(value)}</td><td class="${passed ? 'ok' : 'warn'}">${passed ? 'pass' : 'check'}</td></tr>`;
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

function rankRows(rows) {
  return [...rows]
    .sort((a, b) => (b.success_rate - a.success_rate) ||
      (b.average_score - a.average_score) ||
      (a.average_turns - b.average_turns) ||
      String(a.agent).localeCompare(String(b.agent)))
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function relativeHref(fromFile, targetFile) {
  const fromDir = path.dirname(path.resolve(String(fromFile)));
  const relative = path.relative(fromDir, path.resolve(String(targetFile))).replace(/\\/g, '/');
  return encodeURI(relative || path.basename(String(targetFile)));
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

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'n/a';
}

function shortAgent(agent) {
  return path.basename(String(agent || 'unknown'), path.extname(String(agent || 'unknown')));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function usage() {
  return `Usage:
  node ./scripts/write-demo-index.js <log.jsonl> [--out index.html] [--manifest MANIFEST.json] [--brief JUDGE_BRIEF.md] [--replay-html replay.html] [--arena-html arena.html] [--leaderboard leaderboard.md] [--comparison-json agent-comparison.json]

Creates a single-entry HTML index for the EchoGrid judge package.`;
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
  buildDemoIndex,
};
