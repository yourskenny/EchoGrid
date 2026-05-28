#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const input = options._[0];
  if (!input) throw new Error(usage());

  const cwd = process.cwd();
  const source = resolvePath(cwd, input);
  const outFile = resolvePath(cwd, options.out || path.join(path.dirname(source), 'MANIFEST.json'));
  const artifactPaths = {
    log: source,
    index: resolvePath(cwd, options.index || path.join(path.dirname(source), 'index.html')),
    brief: resolvePath(cwd, options.brief || path.join(path.dirname(source), 'JUDGE_BRIEF.md')),
    leaderboard: resolvePath(cwd, options.leaderboard || path.join(path.dirname(source), 'leaderboard.md')),
    arena: resolvePath(cwd, options['arena-html'] || path.join(path.dirname(source), 'arena.html')),
    replay: resolvePath(cwd, options['replay-html'] || path.join(path.dirname(source), 'replay.html')),
    comparison: resolvePath(cwd, options['comparison-json'] || path.join(path.dirname(source), 'agent-comparison.json')),
    comparison_text: resolvePath(cwd, options.comparison || path.join(path.dirname(source), 'agent-comparison.txt')),
  };

  const events = readJsonl(source);
  const comparison = fs.existsSync(artifactPaths.comparison)
    ? JSON.parse(fs.readFileSync(artifactPaths.comparison, 'utf8'))
    : null;
  const manifest = buildDemoManifest(events, {
    cwd,
    outFile,
    artifactPaths,
    comparison,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${outFile}\n`);
}

function buildDemoManifest(events, options = {}) {
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
  const ruleClaim = finalState.rules?.claim || extractRuleClaim(actionEvents);
  const comparison = options.comparison || {};
  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];

  return {
    schema: 'echogrid.demo_manifest.v1',
    generated_at: new Date().toISOString(),
    generator: 'scripts/write-demo-manifest.js',
    git_commit: gitValue(['rev-parse', 'HEAD']),
    git_commit_short: gitValue(['rev-parse', '--short', 'HEAD']),
    node: process.version,
    commands: {
      generate: 'npm run demo:full',
      verify: 'npm run demo:check',
      ci: 'npm run demo:ci',
    },
    showcase: {
      seed: finalState.seed || start?.state?.seed || 'unknown',
      agent: start?.agent || start?.runner || 'unknown',
      result: terminal.status || 'incomplete',
      reason: terminal.reason || 'not_terminal',
      score: terminal.score ?? finalState.score ?? 0,
      turns: finalState.turn?.current ?? null,
      turn_limit: finalState.turn?.limit ?? null,
      artifacts_collected: objective.artifacts_collected ?? 0,
      artifacts_required: objective.artifacts_required ?? 0,
      resources: {
        energy: resources.energy ?? null,
        integrity: resources.integrity ?? null,
      },
      hidden_rule: terminal.hidden_rule || ruleClaim?.id || 'unknown',
      rule_claim: ruleClaim,
      metrics: {
        visible_cells: metrics.visible_cells ?? 0,
        damage_events: metrics.damage_events ?? 0,
        invalid_actions: metrics.invalid_actions ?? 0,
        wasted_actions: metrics.wasted_actions ?? 0,
      },
    },
    comparison: {
      seed_file: comparison.seed_file || null,
      agents: rows.map((row) => ({
        agent: row.agent,
        seeds: row.seeds,
        successes: row.successes,
        success_rate: row.success_rate,
        average_score: row.average_score,
        average_turns: row.average_turns,
        best_score: row.best_score,
        worst_score: row.worst_score,
      })),
      rankings: Array.isArray(comparison.rankings) ? comparison.rankings : rankRows(rows),
    },
    artifacts: artifactEntries(options.artifactPaths || {}, options.cwd || process.cwd()),
  };
}

function artifactEntries(paths, cwd) {
  return Object.entries(paths)
    .filter(([, file]) => file)
    .map(([name, file]) => {
      if (!fs.existsSync(file)) {
        return {
          name,
          path: displayPath(file, cwd),
          exists: false,
          size: 0,
          sha256: null,
        };
      }
      const buffer = fs.readFileSync(file);
      return {
        name,
        path: displayPath(file, cwd),
        exists: true,
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      };
    });
}

function extractRuleClaim(actionEvents) {
  const claim = actionEvents.find((entry) => entry.event?.outcome?.type === 'claim_rule')?.event?.outcome?.observation;
  if (!claim) return null;
  return {
    id: claim.rule_id || 'unknown',
    correct: Boolean(claim.accepted),
    rationale: claim.rationale || undefined,
  };
}

function rankRows(rows) {
  return [...rows]
    .sort((a, b) => (b.success_rate - a.success_rate) ||
      (b.average_score - a.average_score) ||
      (a.average_turns - b.average_turns) ||
      String(a.agent).localeCompare(String(b.agent)))
    .map((row, index) => ({
      rank: index + 1,
      agent: row.agent,
      success_rate: row.success_rate,
      average_score: row.average_score,
      average_turns: row.average_turns,
      best_score: row.best_score,
      worst_score: row.worst_score,
    }));
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

function gitValue(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
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

function usage() {
  return `Usage:
  node ./scripts/write-demo-manifest.js <log.jsonl> [--out MANIFEST.json] [--index index.html] [--brief JUDGE_BRIEF.md] [--replay-html replay.html] [--arena-html arena.html] [--leaderboard leaderboard.md] [--comparison-json agent-comparison.json] [--comparison agent-comparison.txt]

Creates a hash manifest for the EchoGrid judge package.`;
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
  buildDemoManifest,
};
