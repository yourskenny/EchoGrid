#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const options = parseArgsOrExit(process.argv.slice(2));
if (options.help) {
  process.stdout.write(helpText());
  process.exit(0);
}
const models = options.models || ['deepseek-v4-pro', 'deepseek-v4-flash'];
const seeds = options.seeds || './seeds/showcase.txt';
const baseUrl = options.baseUrl || process.env.ECHOGRID_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const apiKey = process.env.ECHOGRID_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const outDir = path.resolve(root, options.outDir || './logs/llm');
const leaderboards = leaderboardModes(options.leaderboard || 'both');

if (!apiKey) {
  process.stderr.write('Missing API key. Set ECHOGRID_LLM_API_KEY or DEEPSEEK_API_KEY.\n');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const summaries = [];

for (const leaderboard of leaderboards) {
  for (const model of models) {
    const logDir = path.join(outDir, leaderboard, sanitize(model));
    fs.rmSync(logDir, { recursive: true, force: true });
    const result = spawnSync(
      process.execPath,
      [
        './bin/echogrid.js',
        'evaluate',
        '--agent',
        './agents/llm-openai-compatible.js',
        '--seeds',
        seeds,
        '--mode',
        options.mode || 'mvp',
        '--json',
        '--timeout',
        String(options.timeout || 45000),
        '--log-dir',
        logDir,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: Number(options.processTimeout || 600000),
        env: {
          ...process.env,
          ECHOGRID_LLM_API_KEY: apiKey,
          ECHOGRID_LLM_BASE_URL: baseUrl,
          ECHOGRID_LLM_MODEL: model,
          ECHOGRID_LLM_TIMEOUT_MS: String(options.requestTimeout || 30000),
          ECHOGRID_LLM_MAX_TOKENS: String(options.maxTokens || 256),
          ECHOGRID_LLM_MAX_MODEL_TURNS: String(options.maxModelTurns || 12),
          ECHOGRID_LLM_FALLBACK_MODE: leaderboard === 'pure' ? 'none' : 'baseline',
          ECHOGRID_LLM_LOCAL_POLICY: leaderboard === 'pure' ? '0' : '1',
          ECHOGRID_LLM_RECOVER_REASONING_ACTION: options.recoverReasoningAction ? '1' : '0',
        },
      },
    );
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exit(result.status || 1);
    }
    const parsed = JSON.parse(result.stdout);
    summaries.push({
      leaderboard,
      model,
      logDir: path.relative(root, logDir).replace(/\\/g, '/'),
      aggregate: parsed.aggregate,
      results: parsed.results,
    });
    process.stdout.write(`${leaderboard}/${model}: ${JSON.stringify(parsed.aggregate)}\n`);
  }
}

const summaryPath = path.join(outDir, 'summary.json');
fs.writeFileSync(summaryPath, JSON.stringify({
  baseUrl,
  seeds,
  mode: options.mode || 'mvp',
  leaderboards,
  generatedAt: new Date().toISOString(),
  summaries,
}, null, 2), 'utf8');

process.stdout.write(`Wrote ${path.relative(root, summaryPath).replace(/\\/g, '/')}\n`);

if (!options.noSummaryTable) {
  const summary = spawnSync(process.execPath, ['./scripts/summarize-llm-logs.js', path.relative(root, outDir)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (summary.status === 0) {
    process.stdout.write('\n');
    process.stdout.write(summary.stdout);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--models') {
      parsed.models = readValue(argv, i, arg).split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--seeds') {
      parsed.seeds = readValue(argv, i, arg);
      i += 1;
    } else if (arg === '--out-dir') {
      parsed.outDir = readValue(argv, i, arg);
      i += 1;
    } else if (arg === '--mode') {
      parsed.mode = readValue(argv, i, arg);
      i += 1;
    } else if (arg === '--base-url') {
      parsed.baseUrl = readValue(argv, i, arg);
      i += 1;
    } else if (arg === '--timeout') {
      parsed.timeout = Number(readValue(argv, i, arg));
      i += 1;
    } else if (arg === '--process-timeout') {
      parsed.processTimeout = Number(readValue(argv, i, arg));
      i += 1;
    } else if (arg === '--request-timeout') {
      parsed.requestTimeout = Number(readValue(argv, i, arg));
      i += 1;
    } else if (arg === '--max-tokens') {
      parsed.maxTokens = Number(readValue(argv, i, arg));
      i += 1;
    } else if (arg === '--max-model-turns') {
      parsed.maxModelTurns = Number(readValue(argv, i, arg));
      i += 1;
    } else if (arg === '--leaderboard') {
      parsed.leaderboard = readValue(argv, i, arg);
      i += 1;
    } else if (arg === '--recover-reasoning-action') {
      parsed.recoverReasoningAction = true;
    } else if (arg === '--no-summary-table') {
      parsed.noSummaryTable = true;
    }
  }
  return parsed;
}

function readValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function leaderboardModes(value) {
  if (value === 'pure') return ['pure'];
  if (value === 'hybrid') return ['hybrid'];
  if (value === 'both') return ['pure', 'hybrid'];
  throw new Error(`Unsupported --leaderboard value: ${value}`);
}

function helpText() {
  return `Usage:
  node ./scripts/run-llm-eval.js [options]

Options:
  --models deepseek-v4-pro,deepseek-v4-flash
  --seeds ./seeds/showcase.txt
  --out-dir ./logs/llm
  --mode mvp|micro
  --base-url https://api.deepseek.com
  --timeout 45000
  --process-timeout 600000
  --request-timeout 30000
  --max-tokens 256
  --max-model-turns 12
  --leaderboard pure|hybrid|both
  --recover-reasoning-action
  --no-summary-table
  --help

Environment:
  ECHOGRID_LLM_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY is required to run evaluations.
  Help output does not require an API key.
`;
}

function parseArgsOrExit(argv) {
  try {
    return parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${helpText()}`);
    process.exit(1);
  }
}
