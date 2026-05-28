#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.input) {
      process.stdout.write(helpText());
      process.exit(options.help ? 0 : 1);
    }
    const events = readJsonl(options.input);
    const html = buildReplayHtml(events, { source: options.input });
    if (options.out) {
      fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
      fs.writeFileSync(options.out, html, 'utf8');
      process.stdout.write(`Wrote ${options.out}\n`);
    } else {
      process.stdout.write(html);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const options = { input: null, out: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--out') {
      options.out = readValue(argv, i, arg);
      i += 1;
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
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

function buildReplayHtml(events, options = {}) {
  const start = events.find((event) => event.type === 'start');
  const actionEvents = events.filter((event) => event.type === 'action');
  const frames = buildFrames(start, actionEvents);
  const finalState = [...events].reverse().find((event) => event.state)?.state || start?.state || {};
  const terminal = finalState.turn?.terminal || {};
  const initialState = start?.state || frames[0]?.state || finalState;
  const metadata = {
    title: 'EchoGrid Replay',
    source: options.source || '',
    seed: finalState.seed || initialState.seed || 'unknown',
    mode: finalState.mode || initialState.mode || 'unknown',
    agent: start?.agent || start?.runner || 'unknown',
    result: terminal.status || 'incomplete',
    reason: terminal.reason || 'not_terminal',
    score: terminal.score ?? finalState.score ?? 0,
    turns: finalState.turn?.current ?? actionEvents.length,
    turnLimit: finalState.turn?.limit ?? initialState.turn?.limit ?? 'unknown',
    artifacts: finalState.objective?.artifacts_collected ?? 0,
    artifactsRequired: finalState.objective?.artifacts_required ?? 0,
    hiddenRule: terminal.hidden_rule || 'unrevealed',
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(metadata.title)} - Seed ${escapeHtml(metadata.seed)}</title>
<style>
:root {
  color-scheme: light;
  --bg: #f7f5f0;
  --ink: #1f2933;
  --muted: #637083;
  --line: #d8d3c8;
  --panel: #ffffff;
  --safe: #dceee5;
  --unknown: #b9c0ca;
  --wall: #2c3440;
  --hazard: #d6604d;
  --artifact: #d9aa39;
  --exit: #4e8fd8;
  --agent: #20242b;
  --mark: #8f63b4;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input { font: inherit; }
.shell { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }
.topbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  background: #fffaf0;
}
.brand h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
.brand p { margin: 2px 0 0; color: var(--muted); }
.summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(82px, auto));
  gap: 8px;
}
.metric {
  min-width: 82px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  background: var(--panel);
}
.metric span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.metric strong { display: block; margin-top: 2px; font-size: 15px; }
.workspace {
  display: grid;
  grid-template-columns: minmax(280px, 42vw) minmax(320px, 1fr);
  min-height: 0;
}
.boardPane {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 14px;
  padding: 18px;
  border-right: 1px solid var(--line);
}
.controls {
  display: grid;
  grid-template-columns: auto auto auto 1fr auto;
  gap: 8px;
  align-items: center;
}
.controls button {
  min-height: 34px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  padding: 6px 10px;
  cursor: pointer;
}
.controls button:hover { background: #f1ede5; }
.controls input { width: 100%; accent-color: var(--exit); }
.frameLabel { color: var(--muted); white-space: nowrap; }
.boardWrap { align-self: start; }
.board {
  display: grid;
  grid-template-columns: repeat(var(--size), minmax(22px, 1fr));
  gap: 4px;
  width: min(100%, 560px);
  aspect-ratio: 1 / 1;
}
.cell {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(31, 41, 51, 0.14);
  background: var(--unknown);
  color: var(--ink);
  font-weight: 700;
  font-size: clamp(12px, 2.3vw, 18px);
}
.cell.empty { background: var(--safe); }
.cell.wall { background: var(--wall); color: #fff; }
.cell.hazard { background: var(--hazard); color: #fff; }
.cell.artifact { background: var(--artifact); color: #1f2933; }
.cell.exit { background: var(--exit); color: #fff; }
.cell.agent { outline: 3px solid var(--agent); outline-offset: -3px; }
.cell.mark { box-shadow: inset 0 0 0 3px var(--mark); }
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 12px;
  color: var(--muted);
}
.legend-item { display: inline-flex; gap: 5px; align-items: center; }
.swatch { width: 14px; height: 14px; display: inline-block; border: 1px solid rgba(31,41,51,0.2); }
.detailPane {
  display: grid;
  grid-template-rows: auto auto 1fr;
  min-width: 0;
  padding: 18px;
  gap: 14px;
}
.now {
  display: grid;
  grid-template-columns: repeat(4, minmax(100px, 1fr));
  gap: 8px;
}
.now div {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 9px;
  min-width: 0;
}
.now span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.now strong { display: block; overflow-wrap: anywhere; }
.timeline {
  overflow: auto;
  border: 1px solid var(--line);
  background: var(--panel);
  min-height: 280px;
}
.timeline table { width: 100%; border-collapse: collapse; }
.timeline th, .timeline td {
  padding: 8px 9px;
  border-bottom: 1px solid #ece7dd;
  text-align: left;
  vertical-align: top;
}
.timeline th { position: sticky; top: 0; background: #fffaf0; z-index: 1; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.timeline tr { cursor: pointer; }
.timeline tr.active { background: #e9f1f9; }
.outcome { color: var(--muted); }
.source { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 820px) {
  .topbar { grid-template-columns: 1fr; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .workspace { grid-template-columns: 1fr; }
  .boardPane { border-right: 0; border-bottom: 1px solid var(--line); }
  .now { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div class="brand">
      <h1>EchoGrid Replay</h1>
      <p>Seed ${escapeHtml(metadata.seed)} - ${escapeHtml(metadata.agent)} - ${escapeHtml(metadata.mode)}</p>
    </div>
    <section class="summary" aria-label="Run summary">
      ${metric('Result', metadata.result)}
      ${metric('Score', metadata.score)}
      ${metric('Turns', `${metadata.turns}/${metadata.turnLimit}`)}
      ${metric('Artifacts', `${metadata.artifacts}/${metadata.artifactsRequired}`)}
      ${metric('Rule', metadata.hiddenRule)}
      ${metric('Reason', metadata.reason)}
    </section>
  </header>
  <main class="workspace">
    <section class="boardPane" aria-label="Board replay">
      <div class="controls">
        <button id="prevBtn" type="button">Prev</button>
        <button id="playBtn" type="button">Play</button>
        <button id="nextBtn" type="button">Next</button>
        <input id="scrubber" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0" aria-label="Replay turn">
        <div class="frameLabel" id="frameLabel"></div>
      </div>
      <div class="boardWrap">
        <div class="board" id="board" style="--size: ${Number(initialState.map?.size || 8)}"></div>
        <div class="legend" aria-label="Legend">
          ${legend('unknown', 'Unknown')}
          ${legend('empty', 'Safe')}
          ${legend('wall', 'Wall')}
          ${legend('hazard', 'Hazard')}
          ${legend('artifact', 'Artifact')}
          ${legend('exit', 'Exit')}
        </div>
      </div>
      <p class="source">Source: ${escapeHtml(metadata.source || 'embedded JSONL')}</p>
    </section>
    <section class="detailPane" aria-label="Turn details">
      <div class="now">
        <div><span>Action</span><strong id="actionText"></strong></div>
        <div><span>Outcome</span><strong id="outcomeText"></strong></div>
        <div><span>Position</span><strong id="positionText"></strong></div>
        <div><span>Score</span><strong id="scoreText"></strong></div>
      </div>
      <div class="timeline">
        <table>
          <thead><tr><th>Turn</th><th>Action</th><th>Outcome</th><th>Score</th></tr></thead>
          <tbody id="timelineRows"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>
<script>
const frames = ${JSON.stringify(frames)};
let index = 0;
let playing = false;
let timer = null;
const board = document.getElementById('board');
const scrubber = document.getElementById('scrubber');
const timelineRows = document.getElementById('timelineRows');
const playBtn = document.getElementById('playBtn');

function terrainClass(ch) {
  if (ch === '.') return 'empty';
  if (ch === '#') return 'wall';
  if (ch === '!') return 'hazard';
  if (ch === 'A') return 'artifact';
  if (ch === 'E') return 'exit';
  if (ch === '@') return 'agent empty';
  if (ch === 'h' || ch === 's' || ch === 'a' || ch === 'e') return 'mark';
  return 'unknown';
}
function cellLabel(ch) {
  if (ch === '.') return '';
  if (ch === '?') return '';
  return ch;
}
function renderBoard(frame) {
  const rows = frame.rows || [];
  board.style.setProperty('--size', String(rows[0]?.length || 8));
  board.innerHTML = '';
  rows.join('').split('').forEach((ch) => {
    const cell = document.createElement('div');
    cell.className = 'cell ' + terrainClass(ch);
    cell.textContent = cellLabel(ch);
    board.appendChild(cell);
  });
}
function renderTimeline() {
  timelineRows.innerHTML = '';
  frames.forEach((frame, i) => {
    const row = document.createElement('tr');
    row.dataset.index = String(i);
    row.innerHTML = '<td>' + frame.turn + '</td><td>' + escapeCell(frame.action) + '</td><td class="outcome">' + escapeCell(frame.outcome) + '</td><td>' + frame.score + '</td>';
    row.addEventListener('click', () => setFrame(i));
    timelineRows.appendChild(row);
  });
}
function escapeCell(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function setFrame(next) {
  index = Math.max(0, Math.min(frames.length - 1, next));
  const frame = frames[index] || {};
  renderBoard(frame);
  scrubber.value = String(index);
  document.getElementById('frameLabel').textContent = (index + 1) + ' / ' + frames.length;
  document.getElementById('actionText').textContent = frame.action || 'start';
  document.getElementById('outcomeText').textContent = frame.outcome || 'ready';
  document.getElementById('positionText').textContent = '[' + (frame.position || []).join(', ') + ']';
  document.getElementById('scoreText').textContent = String(frame.score ?? 0);
  timelineRows.querySelectorAll('tr').forEach((row) => row.classList.toggle('active', Number(row.dataset.index) === index));
  timelineRows.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
}
function step(delta) {
  setFrame(index + delta);
}
function togglePlay() {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  if (timer) clearInterval(timer);
  if (playing) {
    timer = setInterval(() => {
      if (index >= frames.length - 1) {
        togglePlay();
      } else {
        step(1);
      }
    }, 650);
  }
}
document.getElementById('prevBtn').addEventListener('click', () => step(-1));
document.getElementById('nextBtn').addEventListener('click', () => step(1));
playBtn.addEventListener('click', togglePlay);
scrubber.addEventListener('input', (event) => setFrame(Number(event.target.value)));
renderTimeline();
setFrame(0);
</script>
</body>
</html>
`;
}

function buildFrames(start, actionEvents) {
  const frames = [];
  if (start?.state) {
    frames.push(frameFromState({
      state: start.state,
      turn: 0,
      action: 'start',
      outcome: 'initial state',
      score: start.state.score ?? 0,
    }));
  }
  for (const entry of actionEvents) {
    frames.push(frameFromState({
      state: entry.state,
      turn: entry.event?.turn ?? entry.state?.turn?.current ?? frames.length,
      action: entry.command,
      outcome: outcomeLabel(entry.event?.outcome),
      score: entry.event?.score ?? entry.state?.score ?? 0,
    }));
  }
  return frames;
}

function frameFromState({ state, turn, action, outcome, score }) {
  return {
    turn,
    action,
    outcome,
    score,
    position: state?.agent?.position || [],
    rows: state?.map?.rows || [],
  };
}

function outcomeLabel(outcome) {
  if (!outcome) return 'unknown';
  if (outcome.ok === false) return `fail ${outcome.type || 'invalid'}`;
  return outcome.type || 'ok';
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function legend(name, label) {
  return `<span class="legend-item"><span class="swatch cell ${name}"></span>${escapeHtml(label)}</span>`;
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

function helpText() {
  return `Usage:
  node ./scripts/render-replay-html.js <log.jsonl> --out <replay.html>

Creates a self-contained HTML replay viewer from an EchoGrid JSONL log.
`;
}

module.exports = {
  buildReplayHtml,
};
