#!/usr/bin/env node
'use strict';

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
  });
}

printTable(rows);

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

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--seeds') {
      parsed.seeds = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--agents') {
      parsed.agents = argv[i + 1].split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    }
  }
  return parsed;
}
