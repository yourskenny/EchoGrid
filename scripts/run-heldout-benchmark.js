#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const seedFile = resolveSeedFile(options);
  const agents = options.agents || [
    './agents/random.js',
    './agents/baseline.js',
    './agents/rule-aware.js',
  ];
  const outDir = resolvePath(options.out || './logs/heldout');
  const timeout = String(options.timeout || 2000);
  const showSeeds = Boolean(options['show-seeds']);
  const seedInfo = readSeedInfo(seedFile);
  const rows = agents.map((agent) => evaluateAgent({ agent, seedFile, timeout, seedInfo, showSeeds }));
  const benchmark = {
    schema: 'echogrid.heldout_benchmark.v1',
    generated_at: new Date().toISOString(),
    seed_file: {
      path: showSeeds ? displayPath(seedFile) : 'redacted',
      sha256: seedInfo.sha256,
      count: seedInfo.seeds.length,
      redacted: !showSeeds,
    },
    agents,
    rows,
    rankings: rankRows(rows),
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeFile(path.join(outDir, 'heldout-results.json'), `${JSON.stringify(benchmark, null, 2)}\n`);
  writeFile(path.join(outDir, 'heldout-leaderboard.md'), renderLeaderboard(benchmark));
  writeFile(path.join(outDir, 'HELDOUT_SUMMARY.md'), renderSummary(benchmark));
  printTable(benchmark.rows);
  process.stdout.write(`\nWrote ${displayPath(path.join(outDir, 'heldout-results.json'))}\n`);
  process.stdout.write(`Wrote ${displayPath(path.join(outDir, 'heldout-leaderboard.md'))}\n`);
  process.stdout.write(`Wrote ${displayPath(path.join(outDir, 'HELDOUT_SUMMARY.md'))}\n`);
}

function evaluateAgent({ agent, seedFile, timeout, seedInfo, showSeeds }) {
  const result = spawnSync(
    process.execPath,
    ['./bin/echogrid.js', 'evaluate', '--agent', agent, '--seeds', seedFile, '--json', '--timeout', timeout],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 240000,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  const output = JSON.parse(result.stdout);
  const redactedResults = output.results.map((item, index) => ({
    ...item,
    seed: showSeeds ? item.seed : seedInfo.aliases[index] || `heldout-${String(index + 1).padStart(3, '0')}`,
  }));
  return {
    agent,
    ...output.aggregate,
    best_score: Math.max(...output.results.map((item) => item.score)),
    worst_score: Math.min(...output.results.map((item) => item.score)),
    results: redactedResults,
  };
}

function readSeedInfo(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const seeds = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!seeds.length) throw new Error(`No seeds found in ${displayPath(file)}`);
  return {
    seeds,
    aliases: seeds.map((_, index) => `heldout-${String(index + 1).padStart(3, '0')}`),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  };
}

function renderSummary(benchmark) {
  const leader = benchmark.rankings[0];
  return [
    '# EchoGrid Held-Out Benchmark Summary',
    '',
    `Generated: ${benchmark.generated_at}`,
    `Seed file: ${benchmark.seed_file.redacted ? 'redacted' : `\`${benchmark.seed_file.path}\``}`,
    `Seed file sha256: \`${benchmark.seed_file.sha256}\``,
    `Seed count: ${benchmark.seed_file.count}`,
    `Leader: \`${leader?.agent || 'unknown'}\``,
    '',
    '## Outputs',
    '',
    '- `heldout-results.json`: machine-readable aggregate and per-seed results.',
    '- `heldout-leaderboard.md`: ranked table and per-seed winners.',
    '- `HELDOUT_SUMMARY.md`: this handoff.',
    '',
    '## Privacy Notes',
    '',
    '- Seed ids are redacted by default in generated outputs.',
    '- Use `--show-seeds` only when seed disclosure is acceptable.',
    '- Per-turn logs are not written by this script, reducing accidental leakage of private seed details.',
    '',
    renderLeaderboard(benchmark),
  ].join('\n');
}

function renderLeaderboard(benchmark) {
  const seedIds = unique(benchmark.rows.flatMap((row) => row.results.map((result) => result.seed)));
  return [
    '# EchoGrid Held-Out Leaderboard',
    '',
    `Seed file sha256: \`${benchmark.seed_file.sha256}\``,
    `Seeds: ${benchmark.seed_file.count}${benchmark.seed_file.redacted ? ' (redacted)' : ''}`,
    '',
    '| Rank | Agent | Success | Avg Score | Avg Turns | Best | Worst |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: |',
    ...benchmark.rankings.map((row) =>
      `| ${row.rank} | \`${escapeMarkdown(row.agent)}\` | ${formatPercent(row.success_rate)} | ${row.average_score} | ${row.average_turns} | ${row.best_score} | ${row.worst_score} |`,
    ),
    '',
    '## Per-Seed Winners',
    '',
    '| Seed | Winner | Score | Result |',
    '| --- | --- | ---: | --- |',
    ...seedIds.map((seed) => {
      const winners = seedWinners(seed, benchmark.rows);
      return `| ${escapeMarkdown(seed)} | ${winners.map((winner) => `\`${escapeMarkdown(winner.agent)}\``).join(', ')} | ${winners[0]?.score ?? 'n/a'} | ${escapeMarkdown(winners[0]?.result || 'missing')} |`;
    }),
    '',
  ].join('\n');
}

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
  process.stdout.write('ECHO GRID HELD-OUT BENCHMARK\n\n');
  process.stdout.write(columns.map(([key, label]) => label.padEnd(widths[key])).join('  '));
  process.stdout.write('\n');
  process.stdout.write(columns.map(([key]) => '-'.repeat(widths[key])).join('  '));
  process.stdout.write('\n');
  for (const row of rendered) {
    process.stdout.write(columns.map(([key]) => row[key].padEnd(widths[key])).join('  '));
    process.stdout.write('\n');
  }
}

function rankRows(rowsToRank) {
  const sorted = [...rowsToRank].sort(compareRankingRows);
  let previous = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const rank = previous && compareRankingRows(previous, row) === 0 ? previousRank : index + 1;
    previous = row;
    previousRank = rank;
    return {
      rank,
      agent: row.agent,
      success_rate: row.success_rate,
      average_score: row.average_score,
      average_turns: row.average_turns,
      best_score: row.best_score,
      worst_score: row.worst_score,
    };
  });
}

function compareRankingRows(a, b) {
  return (b.success_rate - a.success_rate) ||
    (b.average_score - a.average_score) ||
    (a.average_turns - b.average_turns) ||
    a.agent.localeCompare(b.agent);
}

function seedWinners(seed, rowsToSearch) {
  const candidates = rowsToSearch
    .map((row) => {
      const result = row.results.find((item) => item.seed === seed);
      return result ? {
        agent: row.agent,
        score: result.score,
        result: `${result.status}/${result.reason}`,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent));
  if (!candidates.length) return [];
  const bestScore = candidates[0].score;
  return candidates.filter((item) => item.score === bestScore);
}

function resolveSeedFile(options) {
  const candidate = options.seeds || process.env.ECHOGRID_HELDOUT_SEEDS;
  if (!candidate) throw new Error(usage());
  const file = resolvePath(candidate);
  if (!fs.existsSync(file)) throw new Error(`Seed file not found: ${displayPath(file)}`);
  return file;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--seeds') {
      parsed.seeds = argv[i + 1];
      i += 1;
    } else if (arg === '--agents') {
      parsed.agents = argv[i + 1].split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--out') {
      parsed.out = argv[i + 1];
      i += 1;
    } else if (arg === '--timeout') {
      parsed.timeout = argv[i + 1];
      i += 1;
    } else if (arg === '--show-seeds') {
      parsed['show-seeds'] = true;
    }
  }
  return parsed;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function resolvePath(value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(root, String(value));
}

function displayPath(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : file;
}

function formatPercent(value) {
  return `${Number(value * 100).toFixed(1)}%`;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

function unique(values) {
  return [...new Set(values)];
}

function usage() {
  return `Usage:
  node ./scripts/run-heldout-benchmark.js --seeds <private-seeds.txt> [--agents a.js,b.js] [--out logs/heldout] [--timeout 2000] [--show-seeds]

If --seeds is omitted, ECHOGRID_HELDOUT_SEEDS is used. Outputs redact seed ids by default.`;
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
  readSeedInfo,
  renderLeaderboard,
};
