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

run('npm test', npmCommand('test'));
run('Compare agents on demo seeds', [process.execPath, './scripts/compare.js', '--seeds', './seeds/demo.txt']);

fs.rmSync(showcaseLogDir, { recursive: true, force: true });
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
process.stdout.write(`\nOpen ${path.relative(root, showcaseReplayHtml).replace(/\\/g, '/')} in a browser for the judge-friendly replay viewer.\n`);

function run(title, command) {
  process.stdout.write(`\n=== ${title} ===\n`);
  const [cmd, ...args] = command;
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    timeout: 240000,
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
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
