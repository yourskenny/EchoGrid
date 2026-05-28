#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const REQUIRED_FILES = [
  'README.md',
  'START_HERE.html',
  'SUBMISSION_AUDIT.md',
  'SUBMISSION_CHECKLIST.md',
  'SUBMISSION_MANIFEST.json',
  'SUBMISSION_ONE_PAGER.md',
  'SUBMISSION_STRATEGY_AUDIT.md',
  'showcase/9001.jsonl',
  'showcase/MANIFEST.json',
  'showcase/index.html',
  'showcase/mission-control.html',
  'showcase/SCORECARD.md',
  'showcase/JUDGE_BRIEF.md',
  'showcase/leaderboard.md',
  'showcase/arena.html',
  'showcase/replay.html',
  'showcase/agent-comparison.json',
  'showcase/agent-comparison.txt',
  'showcase/screenshots/visual-smoke.json',
  'benchmarks/public/agent-comparison.json',
  'benchmarks/public/arena.html',
  'benchmarks/public/leaderboard.md',
  'benchmarks/adversarial/agent-comparison.json',
  'benchmarks/adversarial/arena.html',
  'benchmarks/adversarial/leaderboard.md',
  'benchmarks/rules/agent-comparison.json',
  'benchmarks/rules/arena.html',
  'benchmarks/rules/leaderboard.md',
  'source/README.md',
  'source/docs/agent-authoring.md',
  'source/docs/competition-demo.md',
  'source/docs/competition-rules.md',
  'source/docs/protocol-reference.md',
  'source/docs/scoring.md',
  'source/docs/seed-sets.md',
  'source/schemas/state.schema.json',
  'source/schemas/event.schema.json',
  'source/schemas/summary.schema.json',
];

const SCREENSHOT_FILES = [
  'arena-desktop.png',
  'arena-mobile.png',
  'index-desktop.png',
  'index-mobile.png',
  'mission-control-desktop.png',
  'mission-control-mobile.png',
  'replay-desktop.png',
  'replay-mobile.png',
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bundleDir = resolvePath(options._[0] || './dist/submission/echogrid-submission');
  const zipFile = resolvePath(options.zip || `${bundleDir}.zip`);
  const errors = [];

  if (!fs.existsSync(bundleDir)) errors.push(`missing bundle directory: ${displayPath(bundleDir)}`);
  if (!fs.existsSync(zipFile)) errors.push(`missing bundle archive: ${displayPath(zipFile)}`);
  if (errors.length === 0) {
    verifyRequiredFiles(bundleDir, errors);
    const manifest = readJson(path.join(bundleDir, 'SUBMISSION_MANIFEST.json'), errors);
    if (manifest) {
      verifySourceCommit(manifest, errors, options);
      verifyManifest(bundleDir, manifest, errors);
      verifyBundleStory(manifest, errors);
      verifyShowcaseSourceCommit(bundleDir, manifest, errors);
    }
    verifyVisualSmoke(bundleDir, errors);
    verifyAuditReport(bundleDir, errors);
    verifyOnePager(bundleDir, errors);
    verifyStrategyAudit(bundleDir, errors);
    verifyStartHere(bundleDir, errors);
    verifySourceProtocolPackage(bundleDir, errors);
    verifyLocalHtmlLinks(bundleDir, errors);
    verifyZipArchive(bundleDir, zipFile, errors);
  }

  if (errors.length > 0) {
    process.stderr.write('SUBMISSION BUNDLE CHECK FAILED\n');
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('SUBMISSION BUNDLE CHECK PASSED\n');
  process.stdout.write(`Bundle: ${displayPath(bundleDir)}\n`);
  process.stdout.write(`Archive: ${displayPath(zipFile)}\n`);
}

function verifyRequiredFiles(bundleDir, errors) {
  for (const relative of REQUIRED_FILES) {
    const file = path.join(bundleDir, relative);
    if (!fs.existsSync(file)) {
      errors.push(`missing required file: ${relative}`);
      continue;
    }
    if (fs.statSync(file).size === 0) errors.push(`empty required file: ${relative}`);
  }
  for (const name of SCREENSHOT_FILES) {
    const relative = `showcase/screenshots/${name}`;
    const file = path.join(bundleDir, relative);
    if (!fs.existsSync(file)) {
      errors.push(`missing visual smoke screenshot: ${relative}`);
      continue;
    }
    const buffer = fs.readFileSync(file);
    if (buffer.length < 16) errors.push(`visual smoke screenshot too small: ${relative}`);
    if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') errors.push(`visual smoke screenshot is not a PNG: ${relative}`);
  }
}

function verifySourceCommit(manifest, errors, options = {}) {
  if (options['skip-source-commit-check']) return;
  const manifestCommit = manifest.source?.commit;
  if (!manifestCommit) {
    errors.push('manifest source commit missing');
    return;
  }
  const head = gitValue(['rev-parse', 'HEAD']);
  if (!head) {
    errors.push('could not read current git HEAD for source commit check');
    return;
  }
  if (manifestCommit !== head) {
    const manifestShort = manifest.source?.commit_short || manifestCommit.slice(0, 7);
    errors.push(`manifest source commit ${manifestShort} does not match current HEAD ${head.slice(0, 7)}`);
  }
}

function verifyShowcaseSourceCommit(bundleDir, manifest, errors) {
  const showcaseManifest = readJson(path.join(bundleDir, 'showcase', 'MANIFEST.json'), errors);
  if (!showcaseManifest) return;
  const sourceCommit = manifest.source?.commit;
  const showcaseCommit = showcaseManifest.git_commit;
  if (!sourceCommit) {
    errors.push('manifest source commit missing before showcase source check');
    return;
  }
  if (!showcaseCommit) {
    errors.push('showcase manifest git_commit missing');
    return;
  }
  if (showcaseCommit !== sourceCommit) {
    const showcaseShort = showcaseManifest.git_commit_short || showcaseCommit.slice(0, 7);
    const sourceShort = manifest.source?.commit_short || sourceCommit.slice(0, 7);
    errors.push(`showcase manifest source commit ${showcaseShort} does not match bundle source commit ${sourceShort}`);
  }
}

function verifyManifest(bundleDir, manifest, errors) {
  if (manifest.schema !== 'echogrid.submission_bundle.v1') {
    errors.push(`manifest schema mismatch: ${manifest.schema || 'missing'}`);
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) errors.push('manifest has no file inventory');
  const seen = new Set();
  for (const item of files) {
    if (!item.path) {
      errors.push('manifest file entry missing path');
      continue;
    }
    const normalized = normalizeZipPath(item.path);
    if (seen.has(normalized)) errors.push(`manifest has duplicate file entry: ${normalized}`);
    seen.add(normalized);
    const file = path.join(bundleDir, normalized);
    if (!fs.existsSync(file)) {
      errors.push(`manifest file not found: ${normalized}`);
      continue;
    }
    const buffer = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (item.size !== buffer.length) errors.push(`manifest size mismatch for ${normalized}: ${item.size} vs ${buffer.length}`);
    if (item.sha256 !== hash) errors.push(`manifest sha256 mismatch for ${normalized}`);
  }

  const diskFiles = listFiles(bundleDir)
    .map((file) => normalizeZipPath(path.relative(bundleDir, file)))
    .filter((relative) => relative !== 'SUBMISSION_MANIFEST.json');
  for (const relative of diskFiles) {
    if (!seen.has(relative)) errors.push(`manifest missing disk file: ${relative}`);
  }
}

function verifyBundleStory(manifest, errors) {
  const showcase = manifest.showcase || {};
  if (showcase.result !== 'success') errors.push(`showcase result expected success, got ${showcase.result || 'missing'}`);
  if (showcase.reason !== 'objective_complete') errors.push(`showcase reason expected objective_complete, got ${showcase.reason || 'missing'}`);
  if ((showcase.score ?? 0) < 950) errors.push(`showcase score below submission bar: ${showcase.score ?? 0}`);
  if (showcase.artifacts !== '3/3') errors.push(`showcase artifacts expected 3/3, got ${showcase.artifacts || 'missing'}`);
  if (showcase.rule_claim?.correct !== true) errors.push('showcase missing accepted rule claim');
  if ((showcase.metrics?.damage_events ?? 1) !== 0) errors.push('showcase recorded damage events');
  if ((showcase.metrics?.invalid_actions ?? 1) !== 0) errors.push('showcase recorded invalid actions');

  const publicBenchmark = manifest.benchmarks?.public;
  const adversarial = manifest.benchmarks?.adversarial;
  const rules = manifest.benchmarks?.rules;
  verifyPublicBenchmark(publicBenchmark, errors);
  verifyBenchmark('adversarial', adversarial, './agents/rule-aware.js', errors);
  verifyBenchmark('rules', rules, './agents/rule-aware.js', errors);
  const ruleExplorer = (rules?.rows || []).find((row) => row.agent === './agents/rule-explorer.js');
  const rulesBaseline = (rules?.rows || []).find((row) => row.agent === './agents/baseline.js');
  if (!ruleExplorer) errors.push('rules benchmark missing rule-explorer row');
  if (ruleExplorer && rulesBaseline && !(ruleExplorer.average_score > rulesBaseline.average_score)) {
    errors.push('rules benchmark expected rule-explorer average score above baseline');
  }
}

function verifyPublicBenchmark(benchmark, errors) {
  if (!benchmark) {
    errors.push('public benchmark missing from manifest');
    return;
  }
  if (benchmark.leader?.agent !== './agents/rule-aware.js') {
    errors.push(`public leader expected ./agents/rule-aware.js, got ${benchmark.leader?.agent || 'missing'}`);
  }
  const random = (benchmark.rows || []).find((row) => row.agent === './agents/random.js');
  const baseline = (benchmark.rows || []).find((row) => row.agent === './agents/baseline.js');
  const ruleAware = (benchmark.rows || []).find((row) => row.agent === './agents/rule-aware.js');
  if (!random) errors.push('public benchmark missing random row');
  if (!baseline) errors.push('public benchmark missing baseline row');
  if (!ruleAware) errors.push('public benchmark missing rule-aware row');
  if (random && random.success_rate !== 0) errors.push(`public random success rate expected 0, got ${random.success_rate}`);
  if (baseline && baseline.success_rate !== 1) errors.push(`public baseline success rate expected 1, got ${baseline.success_rate}`);
  if (ruleAware && ruleAware.success_rate !== 1) errors.push(`public rule-aware success rate expected 1, got ${ruleAware.success_rate}`);
  if (baseline && ruleAware && !(ruleAware.average_score > baseline.average_score)) {
    errors.push('public rule-aware average score is not above baseline');
  }
}

function verifyBenchmark(label, benchmark, expectedLeader, errors) {
  if (!benchmark) {
    errors.push(`${label} benchmark missing from manifest`);
    return;
  }
  if (benchmark.leader?.agent !== expectedLeader) {
    errors.push(`${label} leader expected ${expectedLeader}, got ${benchmark.leader?.agent || 'missing'}`);
  }
  const baseline = (benchmark.rows || []).find((row) => row.agent === './agents/baseline.js');
  const ruleAware = (benchmark.rows || []).find((row) => row.agent === './agents/rule-aware.js');
  if (!baseline) errors.push(`${label} benchmark missing baseline row`);
  if (!ruleAware) errors.push(`${label} benchmark missing rule-aware row`);
  if (baseline && baseline.success_rate !== 1) errors.push(`${label} baseline success rate expected 1, got ${baseline.success_rate}`);
  if (ruleAware && ruleAware.success_rate !== 1) errors.push(`${label} rule-aware success rate expected 1, got ${ruleAware.success_rate}`);
  if (baseline && ruleAware && !(ruleAware.average_score > baseline.average_score)) {
    errors.push(`${label} rule-aware average score is not above baseline`);
  }
}

function verifyVisualSmoke(bundleDir, errors) {
  const report = readJson(path.join(bundleDir, 'showcase', 'screenshots', 'visual-smoke.json'), errors);
  if (!report) return;
  if (report.schema !== 'echogrid.visual_smoke.v1') errors.push(`visual smoke schema mismatch: ${report.schema || 'missing'}`);
  const screenshots = Array.isArray(report.screenshots) ? report.screenshots : [];
  if (screenshots.length !== 8) errors.push(`visual smoke expected 8 screenshots, got ${screenshots.length}`);
  const expected = new Set(SCREENSHOT_FILES);
  for (const item of screenshots) {
    const expectedName = `${String(item.page || '').replace(/\.html$/, '')}-${item.viewport}.png`;
    if (!expected.has(expectedName)) errors.push(`visual smoke has unexpected screenshot entry: ${expectedName}`);
    if (!Number.isFinite(item.width) || !Number.isFinite(item.height)) errors.push(`visual smoke entry missing dimensions: ${expectedName}`);
    if ((item.unique_colors ?? 0) < 24) errors.push(`visual smoke entry has too few colors: ${expectedName}`);
  }
}

function verifyAuditReport(bundleDir, errors) {
  const file = path.join(bundleDir, 'SUBMISSION_AUDIT.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of [
    'EchoGrid Submission Audit',
    'Verification Matrix',
    'Showcase artifact verifier',
    'Source consistency',
    'Hidden-rule inference',
    'Visual smoke artifacts',
    'Public benchmark',
    'Adversarial benchmark',
    'Rule-signal benchmark',
    'Strategy audit',
    'Bundle inventory',
    'PASS',
  ]) {
    if (!text.includes(needle)) errors.push(`SUBMISSION_AUDIT.md missing "${needle}"`);
  }
}

function verifyOnePager(bundleDir, errors) {
  const file = path.join(bundleDir, 'SUBMISSION_ONE_PAGER.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of [
    'EchoGrid One-Pager',
    'Why It Is Worth Judging',
    '90-Second Review Path',
    'Competition Verdict',
    'Route Playback',
    'SUBMISSION_AUDIT.md',
    'SUBMISSION_STRATEGY_AUDIT.md',
    'benchmarks/public/leaderboard.md',
    'benchmarkable agents',
    'npm run submission:check',
  ]) {
    if (!text.includes(needle)) errors.push(`SUBMISSION_ONE_PAGER.md missing "${needle}"`);
  }
}

function verifyStrategyAudit(bundleDir, errors) {
  const file = path.join(bundleDir, 'SUBMISSION_STRATEGY_AUDIT.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of [
    'EchoGrid Strategy Audit',
    'What This Proves',
    'Benchmark Edge',
    'Per-Seed Evidence',
    'Public benchmark',
    'Adversarial benchmark',
    'Rule-signal benchmark',
    'row_count_disclosure',
    'sector_c_two_unstable',
    'Rule-aware edge over baseline',
  ]) {
    if (!text.includes(needle)) errors.push(`SUBMISSION_STRATEGY_AUDIT.md missing "${needle}"`);
  }
}

function verifyStartHere(bundleDir, errors) {
  const file = path.join(bundleDir, 'START_HERE.html');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of [
    'EchoGrid Submission',
    'mission-control-desktop.png',
    'Public10',
    '100.0% solved',
    'Public benchmark:',
    '90-Second Path',
    'Why It Holds Up',
    'Mission Control',
    'showcase/mission-control.html',
    'SUBMISSION_ONE_PAGER.md',
    'SUBMISSION_AUDIT.md',
    'SUBMISSION_STRATEGY_AUDIT.md',
    'Agent Authoring',
    'source/docs/agent-authoring.md',
    'State Schema',
    'source/schemas/state.schema.json',
    'Public Leaderboard',
    'benchmarks/public/leaderboard.md',
    'SUBMISSION_MANIFEST.json',
  ]) {
    if (!text.includes(needle)) errors.push(`START_HERE.html missing "${needle}"`);
  }
}

function verifySourceProtocolPackage(bundleDir, errors) {
  const authoring = path.join(bundleDir, 'source', 'docs', 'agent-authoring.md');
  if (fs.existsSync(authoring)) {
    const text = fs.readFileSync(authoring, 'utf8');
    for (const needle of [
      'Minimal JavaScript Agent',
      'schemas/state.schema.json',
      'schemas/event.schema.json',
      'schemas/summary.schema.json',
      'claim_rule rule_id because rationale',
    ]) {
      if (!text.includes(needle)) errors.push(`source/docs/agent-authoring.md missing "${needle}"`);
    }
  }

  for (const relative of [
    'source/schemas/state.schema.json',
    'source/schemas/event.schema.json',
    'source/schemas/summary.schema.json',
  ]) {
    const schema = readJson(path.join(bundleDir, relative), errors);
    if (!schema) continue;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      errors.push(`${relative} has unexpected $schema`);
    }
    if (!String(schema.$id || '').includes('echogrid')) errors.push(`${relative} missing echogrid $id`);
    if (typeof schema.title !== 'string' || !schema.title) errors.push(`${relative} missing title`);
  }
}

function verifyLocalHtmlLinks(bundleDir, errors) {
  const htmlFiles = listFiles(bundleDir).filter((file) => path.extname(file).toLowerCase() === '.html');
  const attributePattern = /\b(href|src)\s*=\s*(["'])(.*?)\2/gi;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const source = normalizeZipPath(path.relative(bundleDir, file));
    const fileDir = path.dirname(file);
    for (const match of html.matchAll(attributePattern)) {
      const attribute = match[1].toLowerCase();
      const value = String(match[3] || '').trim();
      if (!shouldVerifyLocalLink(value)) continue;
      const target = stripLinkFragmentAndQuery(value);
      if (!target) continue;
      const resolved = path.resolve(fileDir, target);
      const relative = path.relative(bundleDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        errors.push(`${source} has ${attribute} outside bundle: ${value}`);
        continue;
      }
      if (!fs.existsSync(resolved)) errors.push(`${source} has broken ${attribute}: ${value}`);
    }
  }
}

function shouldVerifyLocalLink(value) {
  if (!value || value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function stripLinkFragmentAndQuery(value) {
  return value.split('#', 1)[0].split('?', 1)[0];
}

function verifyZipArchive(bundleDir, zipFile, errors) {
  let entries;
  try {
    entries = readZipEntries(zipFile);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  const zipPaths = new Set(entries.map((entry) => entry.path));
  const diskFiles = listFiles(bundleDir).map((file) => normalizeZipPath(path.relative(bundleDir, file)));
  for (const relative of diskFiles) {
    if (!zipPaths.has(relative)) errors.push(`zip missing file: ${relative}`);
  }
  for (const entry of entries) {
    if (!diskFiles.includes(entry.path)) errors.push(`zip has unexpected file: ${entry.path}`);
    if (entry.method !== 0) errors.push(`zip entry is not stored: ${entry.path}`);
    const file = path.join(bundleDir, entry.path);
    if (fs.existsSync(file) && fs.statSync(file).size !== entry.uncompressedSize) {
      errors.push(`zip size mismatch for ${entry.path}`);
    }
  }
}

function readZipEntries(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 22) throw new Error(`zip too small: ${displayPath(file)}`);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) throw new Error(`zip end-of-central-directory not found: ${displayPath(file)}`);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error(`zip central directory is truncated: ${displayPath(file)}`);

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`zip central directory entry ${index + 1} has invalid signature`);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const entryPath = normalizeZipPath(buffer.toString('utf8', nameStart, nameEnd));
    entries.push({ path: entryPath, method, compressedSize, uncompressedSize });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 66000; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON ${displayPath(file)}: ${error.message}`);
    return null;
  }
}

function listFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
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

function normalizeZipPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolvePath(value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(root, String(value));
}

function displayPath(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : file;
}

function gitValue(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

if (require.main === module) {
  main();
}

module.exports = {
  readZipEntries,
  verifyLocalHtmlLinks,
  verifyShowcaseSourceCommit,
  verifySourceCommit,
};
