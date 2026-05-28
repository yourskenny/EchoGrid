#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const logs = path.join(root, 'logs');
const showcaseLogDir = path.join(logs, 'showcase');
const showcaseLog = path.join(showcaseLogDir, '9001.jsonl');
const showcaseReplayHtml = path.join(showcaseLogDir, 'replay.html');
const showcaseArenaHtml = path.join(showcaseLogDir, 'arena.html');
const showcaseBrief = path.join(showcaseLogDir, 'JUDGE_BRIEF.md');
const agentComparison = path.join(showcaseLogDir, 'agent-comparison.txt');
const agentComparisonJson = path.join(showcaseLogDir, 'agent-comparison.json');

fs.rmSync(showcaseLogDir, { recursive: true, force: true });
fs.mkdirSync(showcaseLogDir, { recursive: true });
run('npm test', npmCommand('test'));
run(
  'Compare agents on demo seeds',
  [
    process.execPath,
    './scripts/compare.js',
    '--seeds',
    './seeds/demo.txt',
    '--json-out',
    agentComparisonJson,
    '--html-out',
    showcaseArenaHtml,
  ],
  {
    teeFile: agentComparison,
  },
);

run('Run rule-aware showcase seed', [
  process.execPath,
  './bin/echogrid.js',
  'evaluate',
  '--agent',
  './agents/rule-aware.js',
  '--seed',
  '9001',
  '--log-dir',
  './logs/showcase',
]);

run('Showcase battle report', [process.execPath, './bin/echogrid.js', 'report', showcaseLog]);
run('Showcase replay', [process.execPath, './bin/echogrid.js', 'replay', showcaseLog]);
run('Showcase HTML replay viewer', [
  process.execPath,
  './scripts/render-replay-html.js',
  showcaseLog,
  '--out',
  showcaseReplayHtml,
]);
run('Showcase judge brief', [
  process.execPath,
  './scripts/write-judge-brief.js',
  showcaseLog,
  '--out',
  showcaseBrief,
  '--replay-html',
  showcaseReplayHtml,
  '--comparison',
  agentComparison,
  '--arena-html',
  showcaseArenaHtml,
]);
process.stdout.write(`\nOpen ${relativePath(showcaseBrief)} first, then ${relativePath(showcaseArenaHtml)} and ${relativePath(showcaseReplayHtml)} for the judge-friendly viewers.\n`);

function run(title, command, options = {}) {
  process.stdout.write(`\n=== ${title} ===\n`);
  const [cmd, ...args] = command;
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.teeFile ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    timeout: 240000,
  });
  if (options.teeFile) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fs.mkdirSync(path.dirname(options.teeFile), { recursive: true });
    fs.writeFileSync(options.teeFile, `${result.stdout || ''}${result.stderr || ''}`, 'utf8');
  }
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function relativePath(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function npmCommand(scriptName) {
  if (process.env.npm_execpath) {
    return [process.execPath, process.env.npm_execpath, scriptName];
  }
  if (process.platform === 'win32') {
    return ['cmd.exe', '/d', '/s', '/c', `npm ${scriptName}`];
  }
  return ['npm', scriptName];
}
