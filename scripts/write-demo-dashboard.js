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
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'mission-control.html'));
  const comparisonJson = options['comparison-json']
    ? resolvePath(cwd, options['comparison-json'])
    : path.join(path.dirname(source), 'agent-comparison.json');
  const links = {
    replay: resolvePath(cwd, options['replay-html'] || path.join(path.dirname(source), 'replay.html')),
    arena: resolvePath(cwd, options['arena-html'] || path.join(path.dirname(source), 'arena.html')),
    leaderboard: resolvePath(cwd, options.leaderboard || path.join(path.dirname(source), 'leaderboard.md')),
    scorecard: resolvePath(cwd, options.scorecard || path.join(path.dirname(source), 'SCORECARD.md')),
    brief: resolvePath(cwd, options.brief || path.join(path.dirname(source), 'JUDGE_BRIEF.md')),
    log: source,
  };

  const events = readJsonl(source);
  const comparison = fs.existsSync(comparisonJson)
    ? JSON.parse(fs.readFileSync(comparisonJson, 'utf8'))
    : null;
  const html = buildDemoDashboard(events, {
    cwd,
    source,
    outFile,
    comparison,
    links,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildDemoDashboard(events, options = {}) {
  const start = events.find((event) => event.type === 'start');
  const actionEvents = events.filter((event) => event.type === 'action');
  const finalState = [...events].reverse().find((event) => event.state)?.state || start?.state || {};
  const terminal = finalState.turn?.terminal || {};
  const objective = finalState.objective || {};
  const resources = finalState.resources || {};
  const metrics = finalState.metrics || {};
  const score = finalState.score_breakdown || {};
  const ruleClaim = finalState.rules?.claim || extractRuleClaim(actionEvents);
  const comparison = options.comparison || {};
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  const rankings = Array.isArray(comparison.rankings) ? comparison.rankings : rankRows(rows);
  const leader = rankings[0] || null;
  const baseline = rows.find((row) => row.agent === './agents/baseline.js' || /baseline\.js$/.test(row.agent));
  const ruleAware = rows.find((row) => row.agent === './agents/rule-aware.js' || /rule-aware\.js$/.test(row.agent));
  const scoreGap = baseline && ruleAware
    ? roundNumber(Number(ruleAware.average_score) - Number(baseline.average_score))
    : null;
  const milestones = collectMilestones(actionEvents);
  const route = collectRoute(events);
  const pathCells = new Set(route.map((coord) => coord.join(',')));
  const extractionCells = new Set(collectExtractionCells(actionEvents).map((coord) => coord.join(',')));
  const links = artifactLinks(options.links || {}, options.outFile || process.cwd());
  const mapRows = Array.isArray(finalState.map?.rows) ? finalState.map.rows : [];
  const size = Number(finalState.map?.size || mapRows.length || 0);
  const summary = {
    seed: finalState.seed || start?.state?.seed || 'unknown',
    agent: start?.agent || start?.runner || 'unknown',
    result: terminal.status || 'incomplete',
    reason: terminal.reason || 'not_terminal',
    score: terminal.score ?? finalState.score ?? score.total ?? 0,
    turns: finalState.turn?.current ?? actionEvents.length,
    turn_limit: finalState.turn?.limit ?? 'unknown',
    artifacts: `${objective.artifacts_collected ?? 0}/${objective.artifacts_required ?? 0}`,
    energy: resources.energy ?? 'unknown',
    integrity: resources.integrity ?? 'unknown',
    hidden_rule: terminal.hidden_rule || ruleClaim?.id || 'unknown',
    rule_claim: ruleClaim,
    visible_cells: metrics.visible_cells ?? 0,
    damage_events: metrics.damage_events ?? 0,
    invalid_actions: metrics.invalid_actions ?? 0,
    wasted_actions: metrics.wasted_actions ?? 0,
    leader: leader?.agent || 'unknown',
    score_gap_vs_baseline: scoreGap,
  };
  const actionMix = summarizeActions(actionEvents);
  const data = {
    summary,
    action_mix: actionMix,
    route,
    extraction_cells: [...extractionCells].map((coord) => coord.split(',').map((item) => Number(item))),
    route_length: route.length,
    milestones: milestones.map(({ turn, title, detail }) => ({ turn, title, detail })),
    comparison_seed_file: comparison.seed_file || 'unknown',
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EchoGrid Mission Control</title>
<style>
:root {
  --ink: #202629;
  --muted: #657073;
  --bg: #f6f4ef;
  --panel: #fffdf8;
  --line: #d8d2c5;
  --blue: #256b91;
  --green: #39785a;
  --amber: #b67521;
  --red: #a94942;
  --purple: #665a95;
  --track: #ebe6dc;
  --unknown: #c8c2b8;
  --empty: #deeddf;
  --wall: #343a40;
  --hazard: #c94e45;
  --artifact: #d9a93b;
  --exit: #3478b8;
  --agent: #14181b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input { font: inherit; }
main {
  width: min(1220px, calc(100vw - 28px));
  margin: 0 auto;
  padding: 22px 0 32px;
}
header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: end;
  border-bottom: 1px solid var(--line);
  padding-bottom: 14px;
}
h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
.subtle { margin: 5px 0 0; color: var(--muted); }
.stamp { color: var(--muted); font-size: 12px; text-align: right; }
.hero {
  display: grid;
  grid-template-columns: minmax(320px, 0.98fr) minmax(360px, 1.02fr);
  gap: 14px;
  margin-top: 16px;
}
.panel, .metric, .linkTile {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.panel { min-width: 0; padding: 14px; }
.panel h2 { margin: 0 0 10px; font-size: 15px; }
.statusGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}
.metric { min-height: 76px; padding: 11px; }
.metric span { display: block; color: var(--muted); font-size: 12px; }
.metric strong { display: block; margin-top: 6px; font-size: 22px; overflow-wrap: anywhere; }
.success { color: var(--green); }
.warn { color: var(--amber); }
.boardWrap {
  display: grid;
  grid-template-columns: minmax(260px, 520px) minmax(180px, 1fr);
  gap: 14px;
  align-items: start;
}
.board {
  --size: ${escapeHtml(size || 8)};
  display: grid;
  grid-template-columns: repeat(var(--size), minmax(22px, 1fr));
  gap: 4px;
  width: min(100%, 520px);
  aspect-ratio: 1 / 1;
}
.cell {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(32, 38, 41, 0.16);
  background: var(--unknown);
  color: var(--ink);
  font-weight: 800;
  font-size: 14px;
}
.cell.empty { background: var(--empty); }
.cell.wall { background: var(--wall); color: #fff; }
.cell.hazard { background: var(--hazard); color: #fff; }
.cell.artifact { background: var(--artifact); }
.cell.exit { background: var(--exit); color: #fff; }
.cell.path::after {
  content: "";
  position: absolute;
  inset: 28%;
  border-radius: 999px;
  background: rgba(38, 107, 145, 0.36);
}
.cell.extract::before {
  content: "";
  position: absolute;
  inset: 6px;
  border: 2px solid var(--amber);
}
.cell.agent {
  outline: 3px solid var(--agent);
  outline-offset: -3px;
}
.cell.agent::after { display: none; }
.cell.routeSeen::after {
  content: "";
  position: absolute;
  inset: 23%;
  border-radius: 999px;
  background: rgba(38, 107, 145, 0.68);
}
.cell.routeActive {
  outline: 4px solid var(--blue);
  outline-offset: -4px;
}
.cell.routeActive::after {
  content: "";
  position: absolute;
  inset: 18%;
  border-radius: 999px;
  background: rgba(38, 107, 145, 0.88);
}
.playback {
  display: grid;
  gap: 9px;
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.playbackHeader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.playbackHeader span,
.routeMeta {
  color: var(--muted);
  font-size: 12px;
}
.routeControls {
  display: grid;
  grid-template-columns: auto auto minmax(160px, 1fr);
  gap: 8px;
  align-items: center;
}
.routeControls button {
  min-height: 34px;
  border: 1px solid var(--line);
  background: #fdfaf2;
  color: var(--ink);
  padding: 6px 11px;
  cursor: pointer;
}
.routeControls button:hover { border-color: var(--blue); }
.routeControls input { width: 100%; accent-color: var(--blue); }
.legend, .proofList {
  display: grid;
  gap: 7px;
  color: var(--muted);
}
.legendItem {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
}
.swatch {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(32, 38, 41, 0.18);
}
.swatch.empty { background: var(--empty); }
.swatch.wall { background: var(--wall); }
.swatch.hazard { background: var(--hazard); }
.swatch.artifact { background: var(--artifact); }
.swatch.exit { background: var(--exit); }
.swatch.path { background: radial-gradient(circle, rgba(38, 107, 145, 0.75) 0 40%, transparent 42%), var(--unknown); }
.timeline {
  display: grid;
  gap: 8px;
}
.event {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
}
.event:last-child { border-bottom: 0; padding-bottom: 0; }
.turn { color: var(--muted); font-variant-numeric: tabular-nums; }
.event strong { display: block; }
.event span { display: block; color: var(--muted); overflow-wrap: anywhere; }
.grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 14px;
  margin-top: 14px;
}
.scoreRows, .leaderRows { display: grid; gap: 9px; }
.scoreRow, .leaderRow {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr) 72px;
  gap: 10px;
  align-items: center;
}
.track {
  height: 14px;
  background: var(--track);
  border: 1px solid var(--line);
  overflow: hidden;
}
.fill { height: 100%; background: var(--blue); }
.fill.good { background: var(--green); }
.fill.warn { background: var(--amber); }
.fill.bad { background: var(--red); }
.value { text-align: right; font-variant-numeric: tabular-nums; }
.leaderRow {
  grid-template-columns: 28px minmax(0, 1fr) 80px 84px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
}
.leaderRow:last-child { border-bottom: 0; padding-bottom: 0; }
.rank { color: var(--purple); font-weight: 800; }
.agentName { overflow-wrap: anywhere; font-weight: 700; }
.links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.linkTile {
  min-height: 64px;
  padding: 10px;
  color: var(--ink);
  text-decoration: none;
}
.linkTile:hover { border-color: var(--blue); }
.linkTile strong { display: block; }
.linkTile span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.proofList div {
  border-left: 3px solid var(--blue);
  padding-left: 9px;
}
code {
  background: #eee8dc;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 5px;
}
@media (max-width: 980px) {
  main { width: min(100vw - 20px, 1220px); }
  header, .hero, .grid, .boardWrap { grid-template-columns: 1fr; }
  .stamp { text-align: left; }
  .statusGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .links { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .statusGrid, .links { grid-template-columns: 1fr; }
  .routeControls { grid-template-columns: 1fr 1fr; }
  .routeControls input { grid-column: 1 / -1; }
  .scoreRow, .leaderRow { grid-template-columns: 1fr; }
  .value { text-align: left; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>EchoGrid Mission Control</h1>
      <p class="subtle">Judge-facing dashboard for the showcase run, agent comparison, and audit evidence.</p>
    </div>
    <div class="stamp">Generated from <code>${escapeHtml(displayPath(options.source || 'unknown', options.cwd))}</code></div>
  </header>

  <section class="statusGrid" aria-label="Mission snapshot">
    ${metric('Result', `${summary.result.toUpperCase()} / ${summary.reason}`, summary.result === 'success' ? 'success' : 'warn')}
    ${metric('Score', summary.score)}
    ${metric('Turns', `${summary.turns} / ${summary.turn_limit}`)}
    ${metric('Artifacts', summary.artifacts)}
    ${metric('Rule Claim', ruleClaim ? `${ruleClaim.id} at turn ${ruleClaim.turn ?? '?'}` : 'none')}
    ${metric('Visible Cells', summary.visible_cells)}
    ${metric('Resources', `energy ${summary.energy}, integrity ${summary.integrity}`)}
    ${metric('Agent Edge', scoreGap === null ? 'n/a' : `+${scoreGap} avg score`)}
  </section>

  <section class="hero">
    <div class="panel">
      <h2>Final Public Map</h2>
      <div class="boardWrap">
        ${renderBoard(mapRows, { pathCells, extractionCells })}
        <div class="legend">
          ${legendItem('empty', 'Visible safe cell')}
          ${legendItem('wall', 'Wall')}
          ${legendItem('hazard', 'Hazard')}
          ${legendItem('exit', 'Exit / final agent')}
          ${legendItem('path', 'Visited route')}
          ${legendItem('artifact', 'Artifact extraction')}
        </div>
      </div>
      <div class="playback" aria-label="Route playback">
        <div class="playbackHeader"><strong>Route Playback</strong><span id="routeStep">Step 1 / ${escapeHtml(route.length || 1)}</span></div>
        <div class="routeControls">
          <button id="routePlay" type="button">Play</button>
          <button id="routePause" type="button">Pause</button>
          <input id="routeSlider" type="range" min="0" max="${escapeHtml(Math.max(0, route.length - 1))}" value="0">
        </div>
        <div class="routeMeta">Scrub the public route from the spawn cell to the final exit extraction.</div>
      </div>
    </div>
    <div class="panel">
      <h2>Mission Timeline</h2>
      <div class="timeline">
        ${milestones.map((item) => milestone(item)).join('\n')}
      </div>
    </div>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Score Construction</h2>
      <div class="scoreRows">
        ${scoreRows(score)}
      </div>
    </div>
    <div class="panel">
      <h2>Agent Tournament</h2>
      <div class="leaderRows">
        ${leaderRows(rankings, rows)}
      </div>
    </div>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Audit Proof</h2>
      <div class="proofList">
        <div><strong>No damage path</strong><br>${escapeHtml(summary.damage_events)} damage, ${escapeHtml(summary.invalid_actions)} invalid actions, ${escapeHtml(summary.wasted_actions)} wasted actions.</div>
        <div><strong>Hidden rule inference</strong><br>${escapeHtml(ruleClaim?.rationale || 'No rationale recorded.')}</div>
        <div><strong>Action mix</strong><br>${escapeHtml(actionMix.scan)} scans, ${escapeHtml(actionMix.probe)} probes, ${escapeHtml(actionMix.move)} moves, ${escapeHtml(actionMix.extract)} extracts.</div>
      </div>
    </div>
    <div class="panel">
      <h2>Evidence Links</h2>
      <div class="links">
        ${links.map((item) => linkTile(item)).join('\n')}
      </div>
    </div>
  </section>
</main>
<script>
const missionControl = ${JSON.stringify(data, null, 2)};
(function initRoutePlayback() {
  const route = Array.isArray(missionControl.route) ? missionControl.route : [];
  const slider = document.getElementById('routeSlider');
  const stepLabel = document.getElementById('routeStep');
  const playButton = document.getElementById('routePlay');
  const pauseButton = document.getElementById('routePause');
  let timer = null;

  function cellFor(coord) {
    if (!Array.isArray(coord) || coord.length !== 2) return null;
    return document.querySelector('[data-coord="' + coord[0] + ',' + coord[1] + '"]');
  }

  function render(index) {
    if (!route.length) return;
    const bounded = Math.max(0, Math.min(route.length - 1, Number(index) || 0));
    document.querySelectorAll('.routeSeen,.routeActive').forEach((node) => {
      node.classList.remove('routeSeen', 'routeActive');
    });
    for (let step = 0; step <= bounded; step += 1) {
      const cell = cellFor(route[step]);
      if (cell) cell.classList.add('routeSeen');
    }
    const active = cellFor(route[bounded]);
    if (active) active.classList.add('routeActive');
    if (slider) slider.value = String(bounded);
    if (stepLabel) {
      const coord = route[bounded];
      stepLabel.textContent = 'Step ' + (bounded + 1) + ' / ' + route.length + ' - (' + coord[0] + ',' + coord[1] + ')';
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function play() {
    if (!route.length) return;
    stop();
    let index = Number(slider ? slider.value : 0);
    if (index >= route.length - 1) index = -1;
    timer = setInterval(() => {
      index += 1;
      render(index);
      if (index >= route.length - 1) stop();
    }, 520);
  }

  if (slider) slider.addEventListener('input', () => {
    stop();
    render(slider.value);
  });
  if (playButton) playButton.addEventListener('click', play);
  if (pauseButton) pauseButton.addEventListener('click', stop);
  render(0);
}());
</script>
</body>
</html>`;
}

function renderBoard(rows, context) {
  if (!rows.length) return '<p class="subtle">No map rows found.</p>';
  const cells = [];
  for (let y = 0; y < rows.length; y += 1) {
    const row = String(rows[y]);
    for (let x = 0; x < row.length; x += 1) {
      const symbol = row[x];
      const coord = `${x},${y}`;
      const classes = ['cell', terrainClass(symbol)];
      if (context.pathCells.has(coord)) classes.push('path');
      if (context.extractionCells.has(coord)) classes.push('extract');
      if (symbol === '@') classes.push('agent', 'exit');
      cells.push(`<div class="${classes.join(' ')}" data-coord="${coord}" title="${coord}">${escapeHtml(cellGlyph(symbol))}</div>`);
    }
  }
  return `<div class="board" aria-label="Final public map">${cells.join('\n')}</div>`;
}

function terrainClass(symbol) {
  return {
    '?': 'unknown',
    '.': 'empty',
    '#': 'wall',
    '!': 'hazard',
    A: 'artifact',
    E: 'exit',
    '@': 'agent',
  }[symbol] || 'unknown';
}

function cellGlyph(symbol) {
  return symbol === '.' ? '' : symbol;
}

function legendItem(className, label) {
  return `<div class="legendItem"><span class="swatch ${escapeHtml(className)}"></span><span>${escapeHtml(label)}</span></div>`;
}

function metric(label, value, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong${classAttr}>${escapeHtml(value)}</strong></div>`;
}

function milestone(item) {
  return `<div class="event"><div class="turn">Turn ${escapeHtml(item.turn)}</div><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div></div>`;
}

function scoreRows(score) {
  const entries = [
    ['Mission', score.mission_value ?? 0, 'good'],
    ['Artifacts', score.artifact_value ?? 0, 'good'],
    ['Map certainty', score.map_certainty_bonus ?? 0, ''],
    ['Rule discovery', score.rule_discovery_bonus ?? 0, 'warn'],
    ['Unused energy', score.unused_energy_bonus ?? 0, ''],
    ['Integrity', score.integrity_bonus ?? 0, 'good'],
    ['Penalties', Math.abs((score.damage_penalty ?? 0) + (score.false_mark_penalty ?? 0) + (score.invalid_action_penalty ?? 0) + (score.wasted_action_penalty ?? 0)), 'bad'],
  ];
  const max = Math.max(1, ...entries.map(([, value]) => Number(value) || 0));
  return entries.map(([label, value, tone]) => {
    const width = Math.max(0, Math.min(100, ((Number(value) || 0) / max) * 100));
    return `<div class="scoreRow"><strong>${escapeHtml(label)}</strong><div class="track"><div class="fill ${escapeHtml(tone)}" style="width:${width.toFixed(1)}%"></div></div><div class="value">${escapeHtml(value)}</div></div>`;
  }).join('\n');
}

function leaderRows(rankings, rows) {
  if (!rankings.length) return '<p class="subtle">No comparison data found.</p>';
  const byAgent = new Map(rows.map((row) => [row.agent, row]));
  return rankings.map((ranked) => {
    const row = byAgent.get(ranked.agent) || ranked;
    return `<div class="leaderRow"><div class="rank">${escapeHtml(ranked.rank ?? '?')}</div><div class="agentName">${escapeHtml(row.agent || 'unknown')}</div><div class="value">${formatPercent(row.success_rate)}</div><div class="value">${escapeHtml(row.average_score ?? 'n/a')}</div></div>`;
  }).join('\n');
}

function linkTile(item) {
  return `<a class="linkTile" href="${escapeHtml(item.href)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span></a>`;
}

function artifactLinks(paths, outFile) {
  const labels = [
    ['Replay', paths.replay, 'Turn-by-turn visual trace'],
    ['Arena', paths.arena, 'Agent comparison surface'],
    ['Leaderboard', paths.leaderboard, 'Ranked tournament table'],
    ['Scorecard', paths.scorecard, 'Capability gate evidence'],
    ['Judge Brief', paths.brief, '90-second judge script'],
    ['JSONL Log', paths.log, 'Raw audit trail'],
  ];
  return labels
    .filter(([, file]) => file)
    .map(([label, file, description]) => ({
      label,
      href: relativeHref(outFile, file),
      description,
    }));
}

function collectMilestones(actionEvents) {
  const milestones = [];
  for (const entry of actionEvents) {
    const outcome = entry.event?.outcome || {};
    const turn = entry.event?.turn ?? '?';
    if (outcome.type === 'scan' && outcome.observation?.rule_signal) {
      milestones.push({ turn, title: 'Rule signal found', detail: outcome.observation.rule_signal });
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
        title: 'Artifact secured',
        detail: `artifact ${outcome.observation?.artifacts_collected ?? '?'}`,
      });
    }
    if (outcome.type === 'extract_exit') {
      milestones.push({ turn, title: 'Objective complete', detail: 'agent extracted at the exit' });
    }
  }
  return milestones.slice(0, 8);
}

function collectRoute(events) {
  const route = [];
  for (const entry of events) {
    const coord = entry.state?.agent?.position;
    if (isCoord(coord)) {
      const last = route[route.length - 1];
      if (!last || last[0] !== coord[0] || last[1] !== coord[1]) route.push(coord);
    }
  }
  return route;
}

function collectExtractionCells(actionEvents) {
  return actionEvents
    .filter((entry) => entry.event?.outcome?.type === 'extract_artifact')
    .map((entry) => entry.event?.outcome?.observation?.coord || entry.state?.agent?.position)
    .filter(isCoord);
}

function summarizeActions(actionEvents) {
  const mix = { scan: 0, probe: 0, move: 0, extract: 0, claim_rule: 0, other: 0 };
  for (const entry of actionEvents) {
    const type = entry.event?.outcome?.type || String(entry.command || '').split(/\s+/)[0];
    if (type === 'scan') mix.scan += 1;
    else if (type === 'probe') mix.probe += 1;
    else if (type === 'move') mix.move += 1;
    else if (type === 'extract_artifact' || type === 'extract_exit' || type === 'extract') mix.extract += 1;
    else if (type === 'claim_rule') mix.claim_rule += 1;
    else mix.other += 1;
  }
  return mix;
}

function extractRuleClaim(actionEvents) {
  const entry = actionEvents.find((item) => item.event?.outcome?.type === 'claim_rule');
  const claim = entry?.event?.outcome?.observation;
  if (!claim) return null;
  return {
    id: claim.rule_id || 'unknown',
    correct: Boolean(claim.accepted),
    turn: claim.turn ?? entry?.event?.turn,
    rationale: claim.rationale || undefined,
  };
}

function rankRows(rows) {
  return [...rows]
    .sort((a, b) => (b.success_rate - a.success_rate) ||
      (b.average_score - a.average_score) ||
      (a.average_turns - b.average_turns) ||
      String(a.agent).localeCompare(String(b.agent)))
    .map((row, index) => ({ rank: index + 1, ...row }));
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

function isCoord(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger);
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
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
  node ./scripts/write-demo-dashboard.js <log.jsonl> [--out mission-control.html] [--comparison-json agent-comparison.json] [--replay-html replay.html] [--arena-html arena.html] [--leaderboard leaderboard.md] [--scorecard SCORECARD.md] [--brief JUDGE_BRIEF.md]

Creates a judge-facing mission-control dashboard for the EchoGrid showcase package.`;
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
  buildDemoDashboard,
};
