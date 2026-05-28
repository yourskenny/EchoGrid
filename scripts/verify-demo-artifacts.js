#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

function main(argv = process.argv.slice(2)) {
  const showcaseDir = resolvePath(argv[0] || './logs/showcase');
  const files = {
    log: path.join(showcaseDir, '9001.jsonl'),
    manifest: path.join(showcaseDir, 'MANIFEST.json'),
    index: path.join(showcaseDir, 'index.html'),
    dashboard: path.join(showcaseDir, 'mission-control.html'),
    scorecard: path.join(showcaseDir, 'SCORECARD.md'),
    replay: path.join(showcaseDir, 'replay.html'),
    arena: path.join(showcaseDir, 'arena.html'),
    brief: path.join(showcaseDir, 'JUDGE_BRIEF.md'),
    comparison: path.join(showcaseDir, 'agent-comparison.json'),
    comparisonText: path.join(showcaseDir, 'agent-comparison.txt'),
    leaderboard: path.join(showcaseDir, 'leaderboard.md'),
  };
  const errors = [];

  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) {
      errors.push(`missing ${name}: ${displayPath(file)}`);
      continue;
    }
    const size = fs.statSync(file).size;
    if (size === 0) errors.push(`empty ${name}: ${displayPath(file)}`);
  }

  if (errors.length === 0) {
    verifyShowcaseLog(files.log, errors);
    verifyComparison(files.comparison, errors);
    verifyText(files.replay, [
      'EchoGrid Replay',
      'Score Curve',
      'Key Events',
      'const frames = ',
      'const milestones = ',
      'objective complete',
    ], errors);
    verifyText(files.index, [
      'EchoGrid Demo Index',
      '90-Second Runbook',
      'Leaderboard Snapshot',
      'Audit Gates',
      'const demoSummary = ',
      'MANIFEST.json',
      'mission-control.html',
      'SCORECARD.md',
      'JUDGE_BRIEF.md',
      'replay.html',
      'arena.html',
      'sector C scan showed exactly two unstable echoes',
    ], errors);
    verifyText(files.dashboard, [
      'EchoGrid Mission Control',
      'Judge Briefing',
      'id="briefNext"',
      'data-brief-index',
      'Final Public Map',
      'Mission Timeline',
      'Route Playback',
      'Score Construction',
      'Agent Tournament',
      'Strategy Edge',
      'Average score edge',
      'Accepted rule claims',
      'Random agent failures',
      'deltaWrap',
      'Evidence Links',
      'const missionControl = ',
      'id="routeSlider"',
      'initRoutePlayback',
      'class="jumpButton"',
      'data-route-index',
      'sector C scan showed exactly two unstable echoes',
      'data-coord="7,7"',
    ], errors);
    verifyText(files.scorecard, [
      'EchoGrid Demo Scorecard',
      'Capability gates passed: 6/6',
      'Mission completion',
      'Hidden-rule inference',
      'Agent separation',
      'PASS',
      'rule-aware avg=929.5',
    ], errors);
    verifyText(files.arena, [
      'EchoGrid Arena',
      'Average Score',
      'Aggregate Table',
      'Per-Seed Matrix',
      'const comparison = ',
      './agents/rule-aware.js',
    ], errors);
    verifyText(files.brief, [
      'EchoGrid Judge Brief',
      '90-Second Judge Script',
      'SUCCESS / objective_complete',
      'logs/showcase/arena.html',
      'logs/showcase/replay.html',
      'ECHO GRID AGENT COMPARISON',
    ], errors);
    verifyText(files.comparisonText, [
      'ECHO GRID AGENT COMPARISON',
      './agents/random.js',
      './agents/baseline.js',
      './agents/rule-aware.js',
    ], errors);
    verifyText(files.leaderboard, [
      'EchoGrid Leaderboard',
      'Ranked by success rate',
      'Per-Seed Winners',
      './agents/rule-aware.js',
    ], errors);
    verifyManifest(files.manifest, files, errors);
  }

  if (errors.length > 0) {
    process.stderr.write('DEMO ARTIFACT CHECK FAILED\n');
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('DEMO ARTIFACT CHECK PASSED\n');
  for (const file of Object.values(files)) {
    process.stdout.write(`- ${displayPath(file)}\n`);
  }
}

function verifyShowcaseLog(file, errors) {
  let events;
  try {
    events = readJsonl(file);
  } catch (error) {
    errors.push(error.message);
    return;
  }

  const finalState = [...events].reverse().find((event) => event.state)?.state;
  const terminal = finalState?.turn?.terminal || {};
  const actionEvents = events.filter((event) => event.type === 'action');
  const artifactEvents = actionEvents.filter((entry) => entry.event?.outcome?.type === 'extract_artifact');
  const exitEvent = actionEvents.find((entry) => entry.event?.outcome?.type === 'extract_exit');
  const ruleClaim = actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule');
  const ruleSignal = actionEvents.find((entry) => entry.event?.outcome?.observation?.rule_signal);

  if (!finalState) errors.push('showcase log has no final state');
  if (finalState?.seed !== '9001') errors.push(`showcase seed expected 9001, got ${finalState?.seed || 'unknown'}`);
  if (terminal.status !== 'success') errors.push(`showcase terminal status expected success, got ${terminal.status || 'unknown'}`);
  if (terminal.reason !== 'objective_complete') errors.push(`showcase reason expected objective_complete, got ${terminal.reason || 'unknown'}`);
  if ((terminal.score ?? finalState?.score ?? 0) < 950) errors.push(`showcase score below expected demo bar: ${terminal.score ?? finalState?.score ?? 0}`);
  if (terminal.hidden_rule !== 'sector_c_two_unstable') errors.push(`showcase hidden rule expected sector_c_two_unstable, got ${terminal.hidden_rule || 'unknown'}`);
  if (finalState?.objective?.artifacts_collected !== finalState?.objective?.artifacts_required) errors.push('showcase did not collect all artifacts');
  if (artifactEvents.length !== 3) errors.push(`showcase expected 3 artifact extraction events, got ${artifactEvents.length}`);
  if (!exitEvent) errors.push('showcase missing exit extraction event');
  if (!ruleSignal) errors.push('showcase missing rule signal event');
  if (!ruleClaim?.event?.outcome?.observation?.accepted) errors.push('showcase missing accepted rule claim');
  if (!ruleClaim?.event?.outcome?.observation?.rationale) errors.push('showcase rule claim missing audited rationale');
  if ((finalState?.metrics?.damage_events ?? 0) !== 0) errors.push('showcase recorded damage events');
  if ((finalState?.metrics?.invalid_actions ?? 0) !== 0) errors.push('showcase recorded invalid actions');
  if ((finalState?.metrics?.wasted_actions ?? 0) !== 0) errors.push('showcase recorded wasted actions');
}

function verifyComparison(file, errors) {
  let comparison;
  try {
    comparison = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`invalid comparison JSON: ${error.message}`);
    return;
  }

  const rows = comparison.rows || [];
  const random = rows.find((row) => row.agent === './agents/random.js');
  const baseline = rows.find((row) => row.agent === './agents/baseline.js');
  const ruleAware = rows.find((row) => row.agent === './agents/rule-aware.js');

  if (comparison.seed_file !== './seeds/demo.txt') errors.push(`comparison seed file expected ./seeds/demo.txt, got ${comparison.seed_file || 'unknown'}`);
  if (rows.length !== 3) errors.push(`comparison expected 3 agents, got ${rows.length}`);
  if (!random) errors.push('comparison missing random agent');
  if (!baseline) errors.push('comparison missing baseline agent');
  if (!ruleAware) errors.push('comparison missing rule-aware agent');
  if (random && random.successes !== 0) errors.push(`random success count expected 0, got ${random.successes}`);
  if (baseline && baseline.successes !== baseline.seeds) errors.push('baseline did not complete every demo seed');
  if (ruleAware && ruleAware.successes !== ruleAware.seeds) errors.push('rule-aware did not complete every demo seed');
  if (baseline && ruleAware && !(ruleAware.average_score > baseline.average_score)) {
    errors.push(`rule-aware average score ${ruleAware.average_score} is not above baseline ${baseline.average_score}`);
  }
}

function verifyManifest(file, files, errors) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`invalid manifest JSON: ${error.message}`);
    return;
  }

  if (manifest.schema !== 'echogrid.demo_manifest.v1') errors.push(`manifest schema mismatch: ${manifest.schema || 'missing'}`);
  if (manifest.showcase?.seed !== '9001') errors.push(`manifest showcase seed expected 9001, got ${manifest.showcase?.seed || 'unknown'}`);
  if (manifest.showcase?.result !== 'success') errors.push(`manifest showcase result expected success, got ${manifest.showcase?.result || 'unknown'}`);
  if (manifest.showcase?.reason !== 'objective_complete') errors.push(`manifest showcase reason expected objective_complete, got ${manifest.showcase?.reason || 'unknown'}`);
  if ((manifest.showcase?.score ?? 0) < 950) errors.push(`manifest showcase score below demo bar: ${manifest.showcase?.score ?? 0}`);
  if (manifest.showcase?.rule_claim?.rationale !== 'sector C scan showed exactly two unstable echoes') errors.push('manifest missing audited rule-claim rationale');
  if (manifest.comparison?.seed_file !== './seeds/demo.txt') errors.push(`manifest comparison seed file expected ./seeds/demo.txt, got ${manifest.comparison?.seed_file || 'unknown'}`);

  const artifacts = manifest.artifacts || [];
  const expectedNames = ['log', 'index', 'dashboard', 'scorecard', 'brief', 'leaderboard', 'arena', 'replay', 'comparison', 'comparison_text'];
  for (const name of expectedNames) {
    const artifact = artifacts.find((item) => item.name === name);
    if (!artifact) {
      errors.push(`manifest missing artifact entry: ${name}`);
      continue;
    }
    if (artifact.exists !== true) errors.push(`manifest artifact marked missing: ${name}`);
    const artifactPath = resolveManifestArtifactPath(artifact.path, files.log);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`manifest artifact path not found: ${artifact.path}`);
      continue;
    }
    const buffer = fs.readFileSync(artifactPath);
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (artifact.size !== buffer.length) errors.push(`manifest size mismatch for ${name}: ${artifact.size} vs ${buffer.length}`);
    if (artifact.sha256 !== actualHash) errors.push(`manifest sha256 mismatch for ${name}`);
  }
}

function verifyText(file, needles, errors) {
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) errors.push(`${displayPath(file)} missing "${needle}"`);
  }
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

function resolvePath(value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(root, String(value));
}

function resolveManifestArtifactPath(value, showcaseLog) {
  const text = String(value || '');
  if (path.isAbsolute(text)) return text;
  const rootRelative = path.resolve(root, text);
  if (fs.existsSync(rootRelative)) return rootRelative;
  return path.resolve(path.dirname(showcaseLog), text);
}

function displayPath(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : file;
}

if (require.main === module) {
  main();
}
