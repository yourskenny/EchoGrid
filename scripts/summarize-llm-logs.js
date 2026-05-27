#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const logRoot = path.resolve(root, process.argv[2] || './logs/llm');

if (!fs.existsSync(logRoot)) {
  process.stderr.write(`Log directory not found: ${path.relative(root, logRoot)}\n`);
  process.exit(1);
}

const rows = [];
for (const file of walk(logRoot)) {
  if (!file.endsWith('.jsonl')) continue;
  const relative = path.relative(logRoot, file).replace(/\\/g, '/');
  if (path.basename(file) === 'summary.json') continue;
  const events = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const actions = events.filter((event) => event.type === 'action');
  if (!actions.length) continue;
  const final = actions.at(-1).state;
  const model = actions.find((event) => event.agent_diagnostic?.model)?.agent_diagnostic?.model || relative.split('/')[0];
  const diagnostics = summarizeDiagnostics(actions);
  rows.push({
    model,
    seed: final?.seed || path.basename(file, '.jsonl'),
    status: final?.turn?.terminal?.status || 'unknown',
    reason: final?.turn?.terminal?.reason || 'unknown',
    score: final?.score ?? 0,
    turns: final?.turn?.current ?? actions.length,
    artifacts: `${final?.objective?.artifacts_collected ?? 0}/${final?.objective?.artifacts_required ?? 0}`,
    invalid: actions.filter((event) => !event.event.outcome.ok).length,
    waits: actions.filter((event) => String(event.command) === 'wait').length,
    model_actions: diagnostics.modelActions,
    fallback_actions: diagnostics.fallbackActions,
    local_actions: diagnostics.localActions,
    top_reasons: Object.entries(diagnostics.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, value]) => `${key}:${value}`)
      .join(','),
  });
}

printTable(rows);

function summarizeDiagnostics(actions) {
  const reasons = {};
  let modelActions = 0;
  let fallbackActions = 0;
  let localActions = 0;
  for (const action of actions) {
    const diagnostic = action.agent_diagnostic;
    if (!diagnostic) continue;
    if (diagnostic.local_policy) {
      localActions += 1;
      reasons.local = (reasons.local || 0) + 1;
    } else if (diagnostic.fallback) {
      fallbackActions += 1;
      const key = diagnostic.reason || diagnostic.fallback_policy || 'fallback';
      reasons[key] = (reasons[key] || 0) + 1;
    } else {
      modelActions += 1;
      reasons.model = (reasons.model || 0) + 1;
    }
  }
  return { fallbackActions, localActions, modelActions, reasons };
}

function printTable(items) {
  if (!items.length) {
    process.stdout.write('No LLM log rows found.\n');
    return;
  }
  const columns = [
    ['model', 'Model'],
    ['seed', 'Seed'],
    ['status', 'Status'],
    ['score', 'Score'],
    ['turns', 'Turns'],
    ['artifacts', 'Artifacts'],
    ['invalid', 'Invalid'],
    ['waits', 'Waits'],
    ['model_actions', 'Model'],
    ['fallback_actions', 'Fallback'],
    ['local_actions', 'Local'],
    ['top_reasons', 'Top Reasons'],
  ];
  const widths = Object.fromEntries(
    columns.map(([key, label]) => [key, Math.max(label.length, ...items.map((row) => String(row[key]).length))]),
  );
  process.stdout.write('ECHO GRID LLM LOG SUMMARY\n');
  process.stdout.write(`Source: ${path.relative(root, logRoot).replace(/\\/g, '/')}\n\n`);
  process.stdout.write(columns.map(([key, label]) => label.padEnd(widths[key])).join('  '));
  process.stdout.write('\n');
  process.stdout.write(columns.map(([key]) => '-'.repeat(widths[key])).join('  '));
  process.stdout.write('\n');
  for (const row of items) {
    process.stdout.write(columns.map(([key]) => String(row[key]).padEnd(widths[key])).join('  '));
    process.stdout.write('\n');
  }
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}
