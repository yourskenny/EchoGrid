#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const options = parseArgs(process.argv.slice(2));
const seeds = options.seeds || './seeds/demo.txt';
const agents = options.agents || [
  './agents/random.js',
  './agents/baseline.js',
  './agents/rule-aware.js',
];

const rows = [];
for (const agent of agents) {
  const result = spawnSync(
    process.execPath,
    ['./bin/echogrid.js', 'evaluate', '--agent', agent, '--seeds', seeds, '--json', '--timeout', '2000'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  const output = JSON.parse(result.stdout);
  rows.push({
    agent,
    ...output.aggregate,
    best_score: Math.max(...output.results.map((item) => item.score)),
    worst_score: Math.min(...output.results.map((item) => item.score)),
    results: output.results,
  });
}

const comparison = {
  seed_file: seeds,
  agents,
  rows,
};

printTable(rows);
if (options['json-out']) writeFile(options['json-out'], `${JSON.stringify(comparison, null, 2)}\n`);
if (options['html-out']) writeFile(options['html-out'], renderArenaHtml(comparison));

function printTable(rowsToPrint) {
  const columns = [
    ['agent', 'Agent'],
    ['success_rate', 'Success'],
    ['average_score', 'Avg Score'],
    ['average_turns', 'Avg Turns'],
    ['best_score', 'Best'],
    ['worst_score', 'Worst'],
  ];
  const rendered = rowsToPrint.map((row) =>
    Object.fromEntries(columns.map(([key]) => [key, String(row[key])])),
  );
  const widths = Object.fromEntries(
    columns.map(([key, label]) => [
      key,
      Math.max(label.length, ...rendered.map((row) => row[key].length)),
    ]),
  );

  process.stdout.write('ECHO GRID AGENT COMPARISON\n');
  process.stdout.write(`Seeds: ${seeds}\n\n`);
  process.stdout.write(columns.map(([key, label]) => label.padEnd(widths[key])).join('  '));
  process.stdout.write('\n');
  process.stdout.write(columns.map(([key]) => '-'.repeat(widths[key])).join('  '));
  process.stdout.write('\n');
  for (const row of rendered) {
    process.stdout.write(columns.map(([key]) => row[key].padEnd(widths[key])).join('  '));
    process.stdout.write('\n');
  }
}

function renderArenaHtml(comparisonData) {
  const rowsToRender = comparisonData.rows;
  const baseline = rowsToRender.find((row) => row.agent.includes('baseline.js')) || rowsToRender[0];
  const seedIds = unique(rowsToRender.flatMap((row) => row.results.map((result) => result.seed)));
  const bestAverage = Math.max(1, ...rowsToRender.map((row) => row.average_score));
  const bestSuccess = Math.max(0, ...rowsToRender.map((row) => row.success_rate));
  const leader = [...rowsToRender].sort((a, b) => b.average_score - a.average_score)[0];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EchoGrid Arena</title>
<style>
:root {
  --ink: #1d2528;
  --muted: #657173;
  --bg: #f7f7f4;
  --panel: #ffffff;
  --line: #d9dedb;
  --accent: #1f7a8c;
  --good: #2e7d32;
  --warn: #b86b00;
  --bad: #a83b3b;
  --base: #4d5f73;
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
  padding: 22px 0 30px;
}
header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: end;
  border-bottom: 1px solid var(--line);
  padding-bottom: 14px;
}
h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
.subtle { margin: 4px 0 0; color: var(--muted); }
.stamp { color: var(--muted); font-size: 12px; text-align: right; }
.summary {
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
  padding: 12px;
  min-height: 78px;
}
.metric span { display: block; color: var(--muted); font-size: 12px; }
.metric strong { display: block; margin-top: 6px; font-size: 22px; }
.grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 12px;
}
.panel { padding: 14px; min-width: 0; }
.panel h2 { margin: 0 0 10px; font-size: 15px; }
.agentBars { display: grid; gap: 12px; }
.agentBar { display: grid; grid-template-columns: 150px 1fr 72px; gap: 10px; align-items: center; }
.agentName { overflow-wrap: anywhere; font-weight: 650; }
.barTrack { height: 18px; background: #edf0ee; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.barFill { height: 100%; background: var(--accent); }
.scoreText { text-align: right; font-variant-numeric: tabular-nums; }
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
.status { font-weight: 700; }
.status.success { color: var(--good); }
.status.failure { color: var(--bad); }
.delta.positive { color: var(--good); }
.delta.negative { color: var(--bad); }
.delta.neutral { color: var(--muted); }
.matrix { overflow-x: auto; }
.seedCell strong { display: block; }
.seedCell span { display: block; color: var(--muted); font-size: 12px; }
.agentCell { min-width: 148px; }
.leader { border-color: #b7d6dd; box-shadow: inset 0 0 0 1px #b7d6dd; }
.footnote { color: var(--muted); font-size: 12px; margin: 10px 0 0; }
@media (max-width: 860px) {
  main { width: min(100vw - 20px, 1180px); }
  header { grid-template-columns: 1fr; }
  .stamp { text-align: left; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid { grid-template-columns: 1fr; }
  .agentBar { grid-template-columns: 1fr; }
  .scoreText { text-align: left; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>EchoGrid Arena</h1>
      <p class="subtle">Agent comparison across ${escapeHtml(comparisonData.seed_file)}.</p>
    </div>
    <div class="stamp">Self-contained artifact from <code>scripts/compare.js</code></div>
  </header>

  <section class="summary" aria-label="Comparison summary">
    <div class="metric"><span>Leader</span><strong>${escapeHtml(shortAgent(leader.agent))}</strong></div>
    <div class="metric"><span>Leader Avg Score</span><strong>${escapeHtml(leader.average_score)}</strong></div>
    <div class="metric"><span>Seeds</span><strong>${escapeHtml(seedIds.length)}</strong></div>
    <div class="metric"><span>Agents</span><strong>${escapeHtml(rowsToRender.length)}</strong></div>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Average Score</h2>
      <div class="agentBars">
        ${rowsToRender.map((row) => scoreBar(row, bestAverage, leader.agent)).join('\n')}
      </div>
    </div>
    <div class="panel">
      <h2>Aggregate Table</h2>
      ${aggregateTable(rowsToRender, bestSuccess)}
    </div>
  </section>

  <section class="panel" style="margin-top:12px">
    <h2>Per-Seed Matrix</h2>
    <div class="matrix">
      ${seedMatrix(seedIds, rowsToRender, baseline)}
    </div>
    <p class="footnote">Delta values compare each score with ${escapeHtml(shortAgent(baseline.agent))} on the same seed.</p>
  </section>
</main>
<script>
const comparison = ${JSON.stringify(comparisonData)};
</script>
</body>
</html>`;
}

function scoreBar(row, bestAverage, leaderAgent) {
  const width = Math.max(2, Math.round((row.average_score / bestAverage) * 100));
  const leaderClass = row.agent === leaderAgent ? ' leader' : '';
  return `<div class="agentBar${leaderClass}">
  <div class="agentName">${escapeHtml(shortAgent(row.agent))}</div>
  <div class="barTrack"><div class="barFill" style="width:${width}%"></div></div>
  <div class="scoreText">${escapeHtml(row.average_score)}</div>
</div>`;
}

function aggregateTable(rowsToRender, bestSuccess) {
  return `<table>
  <thead><tr><th>Agent</th><th class="right">Success</th><th class="right">Avg Score</th><th class="right">Avg Turns</th><th class="right">Best</th><th class="right">Worst</th></tr></thead>
  <tbody>
    ${rowsToRender.map((row) => {
      const successClass = bestSuccess > 0 && row.success_rate >= bestSuccess ? 'positive' : row.success_rate > 0 ? 'neutral' : 'negative';
      return `<tr>
        <td>${escapeHtml(row.agent)}</td>
        <td class="right delta ${successClass}">${escapeHtml(row.success_rate)}</td>
        <td class="right">${escapeHtml(row.average_score)}</td>
        <td class="right">${escapeHtml(row.average_turns)}</td>
        <td class="right">${escapeHtml(row.best_score)}</td>
        <td class="right">${escapeHtml(row.worst_score)}</td>
      </tr>`;
    }).join('\n')}
  </tbody>
</table>`;
}

function seedMatrix(seedIds, rowsToRender, baseline) {
  return `<table>
  <thead>
    <tr>
      <th>Seed</th>
      ${rowsToRender.map((row) => `<th>${escapeHtml(shortAgent(row.agent))}</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${seedIds.map((seed) => {
      const baselineScore = baseline.results.find((item) => item.seed === seed)?.score ?? 0;
      return `<tr>
        <td class="seedCell"><strong>${escapeHtml(seed)}</strong><span>baseline ${escapeHtml(baselineScore)}</span></td>
        ${rowsToRender.map((row) => seedResultCell(row.results.find((item) => item.seed === seed), baselineScore)).join('')}
      </tr>`;
    }).join('\n')}
  </tbody>
</table>`;
}

function seedResultCell(result, baselineScore) {
  if (!result) return '<td class="agentCell">missing</td>';
  const delta = result.score - baselineScore;
  const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  const status = result.status === 'success' ? 'success' : 'failure';
  return `<td class="agentCell">
    <div><span class="status ${status}">${escapeHtml(result.status)}</span> / ${escapeHtml(result.reason)}</div>
    <div>score ${escapeHtml(result.score)} <span class="delta ${deltaClass}">(${formatDelta(delta)})</span></div>
    <div>turns ${escapeHtml(result.turns)}, artifacts ${escapeHtml(result.artifacts_collected)}/${escapeHtml(result.artifacts_required)}</div>
  </td>`;
}

function formatDelta(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function writeFile(file, content) {
  const outFile = path.isAbsolute(file) ? file : path.resolve(root, file);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, 'utf8');
}

function unique(values) {
  return [...new Set(values)];
}

function shortAgent(agent) {
  return path.basename(agent, path.extname(agent));
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

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--seeds') {
      parsed.seeds = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--agents') {
      parsed.agents = argv[i + 1].split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (argv[i] === '--json-out') {
      parsed['json-out'] = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--html-out') {
      parsed['html-out'] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}
