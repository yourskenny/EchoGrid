'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { EchoGridGame } = require('./engine');

async function runCli(argv, io) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout.write(helpText());
    return;
  }
  if (command === 'run') return runGame(rest, io);
  if (command === 'replay') return replay(rest, io);
  if (command === 'report') return report(rest, io);
  if (command === 'evaluate') return evaluate(rest, io);
  if (command === 'inspect') return inspect(rest, io);
  throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
}

async function runGame(argv, io) {
  const options = parseOptions(argv);
  const game = new EchoGridGame({
    seed: options.seed || '48129',
    mode: options.mode || 'mvp',
    size: options.size ? Number(options.size) : undefined,
  });
  const includeAnswer = Boolean(options.answer);
  const pretty = Boolean(options.pretty);
  const log = options.log ? createJsonlLogger(resolvePath(io.cwd, options.log)) : null;

  writeState(io.stdout, game.state({ includeAnswer }), pretty);
  if (log) log.write({ type: 'start', runner: 'script', state: game.state({ includeAnswer }) });

  const commands = options.script
    ? readScript(resolvePath(io.cwd, options.script))
    : readCommands(io.stdin, io.stdout, Boolean(io.stdin.isTTY));

  for await (const command of commands) {
    const line = String(command).trim();
    if (!line || line.startsWith('#')) continue;
    io.stdout.write(`> ${line}\n`);
    const event = game.step(line);
    io.stdout.write(`ACTION ${formatJson(event, pretty)}\n`);
    const state = game.state({ includeAnswer });
    writeState(io.stdout, state, pretty);
    if (log) log.write({ type: 'action', command: line, event, state });
    if (state.turn.terminal) break;
  }

  if (log) log.close();
}

async function replay(argv, io) {
  const options = parseOptions(argv);
  const file = options._[0];
  if (!file) throw new Error('Usage: echogrid replay <log.jsonl> [--states]');
  const lines = fs.readFileSync(resolvePath(io.cwd, file), 'utf8').split(/\r?\n/).filter(Boolean);
  const events = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
  const start = events.find((event) => event.type === 'start');
  if (start) {
    io.stdout.write(`REPLAY seed=${start.state.seed} mode=${start.state.mode}\n`);
  }
  for (const event of events) {
    if (event.type !== 'action') continue;
    const outcome = event.event.outcome;
    io.stdout.write(
      `TURN ${event.event.turn} > ${event.command} :: ${outcome.ok ? 'ok' : 'fail'} ${outcome.type} score=${event.event.score}\n`,
    );
    if (options.states) writeState(io.stdout, event.state, Boolean(options.pretty));
  }
  const lastState = [...events].reverse().find((event) => event.state)?.state;
  if (lastState && lastState.turn.terminal) {
    io.stdout.write(`RESULT ${formatJson(lastState.turn.terminal, Boolean(options.pretty))}\n`);
  }
}

async function report(argv, io) {
  const options = parseOptions(argv);
  const file = options._[0];
  if (!file) throw new Error('Usage: echogrid report <log.jsonl>');
  const events = readJsonl(resolvePath(io.cwd, file));
  io.stdout.write(buildReport(events));
}

async function evaluate(argv, io) {
  const options = parseOptions(argv);
  if (!options.agent) throw new Error('Usage: echogrid evaluate --agent <agent.js> (--seeds <file>|--seed <seed>)');
  const seeds = options.seeds
    ? fs.readFileSync(resolvePath(io.cwd, options.seeds), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [String(options.seed || '48129')];
  const agentPath = resolvePath(io.cwd, options.agent);
  const logDir = options['log-dir'] ? resolvePath(io.cwd, options['log-dir']) : null;
  if (logDir) fs.mkdirSync(logDir, { recursive: true });

  const results = [];
  for (const seed of seeds) {
    const game = new EchoGridGame({ seed, mode: options.mode || 'mvp' });
    const log = logDir ? createJsonlLogger(path.join(logDir, `${sanitize(seed)}.jsonl`)) : null;
    if (log) {
      log.write({
        type: 'start',
        runner: 'evaluate',
        agent: path.relative(io.cwd, agentPath).replace(/\\/g, '/'),
        state: game.state(),
      });
    }

    while (!game.state().turn.terminal) {
      const state = game.state();
      const command = await runAgent(agentPath, state, {
        cwd: io.cwd,
        timeoutMs: Number(options.timeout || 2000),
      });
      const event = game.step(command);
      const nextState = game.state();
      if (log) log.write({ type: 'action', command: displayCommand(command), agent_diagnostic: command.diagnostic || null, event, state: nextState });
      if (nextState.turn.terminal) break;
    }

    if (log) log.close();
    const finalState = game.state({ includeAnswer: Boolean(options.answer) });
    const result = summarizeResult(finalState);
    results.push(result);
    if (!options.json) {
      io.stdout.write(
        `SEED ${result.seed} ${result.status}/${result.reason} score=${result.score} turns=${result.turns} artifacts=${result.artifacts_collected}/${result.artifacts_required}\n`,
      );
    }
  }

  const aggregate = aggregateResults(results);
  if (options.json) {
    io.stdout.write(`${JSON.stringify({ aggregate, results }, null, 2)}\n`);
  } else {
    io.stdout.write(`SUMMARY ${formatJson(aggregate, true)}\n`);
  }
}

async function inspect(argv, io) {
  const options = parseOptions(argv);
  const game = new EchoGridGame({
    seed: options.seed || '48129',
    mode: options.mode || 'mvp',
    size: options.size ? Number(options.size) : undefined,
  });
  writeState(io.stdout, game.state({ includeAnswer: true }), true);
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      options[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function writeState(stdout, state, pretty) {
  stdout.write(`STATE ${formatJson(state, pretty)}\n`);
}

function formatJson(value, pretty) {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function readScript(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
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

function readCommands(stdin, stdout, interactive) {
  if (!interactive) {
    return readPipedCommands(stdin);
  }
  return readInteractiveCommands(stdin, stdout);
}

async function* readPipedCommands(stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString('utf8');
  for (const line of content.split(/\r?\n/)) yield line;
}

async function* readInteractiveCommands(stdin, stdout) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: '> ',
  });
  rl.prompt();
  for await (const line of rl) {
    yield line;
    rl.prompt();
  }
}

async function runAgent(agentPath, state, options) {
  const { command, args } = commandForAgent(agentPath);
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(`${JSON.stringify(state)}\n`);

  const exit = await waitForChild(child, options.timeoutMs);
  if (exit.timedOut) return actionWithDiagnostic('__agent_timeout__', { timed_out: true });
  if (exit.code !== 0) {
    return actionWithDiagnostic(`__agent_error__ ${JSON.stringify(stderr.trim()).slice(0, 120)}`, {
      exit_code: exit.code,
      stderr: truncate(stderr),
    });
  }
  const commandLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  const diagnostic = parseAgentDiagnostic(stderr);
  return actionWithDiagnostic(commandLine || '__agent_empty__', diagnostic);
}

function actionWithDiagnostic(command, diagnostic) {
  const boxed = new String(command);
  boxed.diagnostic = diagnostic || null;
  return boxed;
}

function displayCommand(command) {
  return String(command);
}

function parseAgentDiagnostic(stderr) {
  const line = String(stderr || '').split(/\r?\n/).find((item) => item.startsWith('ECHOGRID_AGENT_DIAG '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('ECHOGRID_AGENT_DIAG '.length));
  } catch {
    return { diagnostic_parse_error: truncate(line) };
  }
}

function truncate(value, limit = 500) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function waitForChild(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ timedOut: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code });
    });
  });
}

function commandForAgent(agentPath) {
  const ext = path.extname(agentPath).toLowerCase();
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    return { command: process.execPath, args: [agentPath] };
  }
  if (ext === '.py') {
    return { command: 'python', args: [agentPath] };
  }
  return { command: agentPath, args: [] };
}

function createJsonlLogger(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', 'utf8');
  return {
    write(event) {
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    },
    close() {
      // Synchronous logger keeps demo scripts deterministic.
    },
  };
}

function summarizeResult(state) {
  const terminal = state.turn.terminal || { status: 'incomplete', reason: 'not_terminal', score: state.score };
  return {
    seed: state.seed,
    status: terminal.status,
    reason: terminal.reason,
    score: terminal.score ?? state.score,
    turns: state.turn.current,
    energy: state.resources.energy,
    integrity: state.resources.integrity,
    artifacts_collected: state.objective.artifacts_collected,
    artifacts_required: state.objective.artifacts_required,
    rule_claim: state.rules.claim,
    hidden_rule: terminal.hidden_rule,
  };
}

function aggregateResults(results) {
  const count = results.length || 1;
  const successes = results.filter((result) => result.status === 'success').length;
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const totalTurns = results.reduce((sum, result) => sum + result.turns, 0);
  return {
    seeds: results.length,
    successes,
    success_rate: Number((successes / count).toFixed(3)),
    average_score: Number((totalScore / count).toFixed(1)),
    average_turns: Number((totalTurns / count).toFixed(1)),
  };
}

function buildReport(events) {
  const start = events.find((event) => event.type === 'start');
  const actionEvents = events.filter((event) => event.type === 'action');
  const finalState = [...events].reverse().find((event) => event.state)?.state || start?.state;
  const terminal = finalState?.turn?.terminal || { status: 'incomplete', score: finalState?.score || 0 };
  const score = finalState?.score_breakdown || {};
  const metrics = finalState?.metrics || {};
  const objective = finalState?.objective || {};
  const resources = finalState?.resources || {};
  const keyEvents = [];
  const risks = [];
  const diagnostics = {
    modelActions: 0,
    fallbackActions: 0,
    localActions: 0,
    reasons: {},
  };

  for (const entry of actionEvents) {
    const outcome = entry.event.outcome;
    const turn = entry.event.turn;
    collectDiagnostic(diagnostics, entry.agent_diagnostic);
    if (outcome.type === 'extract_artifact') {
      const total = outcome.observation?.artifacts_collected;
      keyEvents.push(`- Turn ${turn}: extracted artifact; total=${total}.`);
    }
    if (outcome.type === 'extract_exit') {
      keyEvents.push(`- Turn ${turn}: extracted at exit and completed objective.`);
    }
    if (outcome.type === 'scan' && outcome.observation?.rule_signal) {
      keyEvents.push(`- Turn ${turn}: observed ${outcome.observation.rule_signal}.`);
    }
    if (outcome.type === 'claim_rule') {
      keyEvents.push(`- Turn ${turn}: claimed hidden rule; accepted=${Boolean(outcome.observation?.accepted)}.`);
    }
    if (outcome.type === 'move' && outcome.observations?.some((item) => item.type === 'damage')) {
      risks.push(`- Turn ${turn}: hazard contact reduced integrity.`);
    }
    if (!outcome.ok && outcome.type === 'invalid') {
      risks.push(`- Turn ${turn}: invalid action "${entry.command}" (${outcome.message}).`);
    }
    if (outcome.repeated) {
      risks.push(`- Turn ${turn}: repeated probe at (${outcome.coord.join(',')}).`);
    }
  }

  if (terminal.status !== 'success') {
    risks.push(`- Terminal status: ${terminal.status || 'unknown'} / ${terminal.reason || 'not_terminal'}.`);
  }

  const hiddenRule = terminal.hidden_rule || finalState?.answer?.hidden_rule || 'unknown';
  const result = terminal.status || 'incomplete';
  const reason = terminal.reason || 'not_terminal';
  return [
    'ECHO GRID BATTLE REPORT',
    `Seed: ${finalState?.seed || start?.state?.seed || 'unknown'}`,
    `Agent: ${start?.agent || start?.runner || 'unknown'}`,
    'Build: echogrid-v0.1-demo',
    `Result: ${result.toUpperCase()} / ${reason}`,
    `Score: ${terminal.score ?? finalState?.score ?? 0}`,
    `Turns: ${finalState?.turn?.current ?? 'unknown'} / ${finalState?.turn?.limit ?? 'unknown'}`,
    `Artifacts: ${objective.artifacts_collected ?? 0} / ${objective.artifacts_required ?? 0}`,
    `Resources: energy=${resources.energy ?? 'unknown'} integrity=${resources.integrity ?? 'unknown'}`,
    `Hidden Rule: ${hiddenRule}`,
    '',
    'SCORE BREAKDOWN',
    `- Mission: ${score.mission_value ?? 0}`,
    `- Artifacts: ${score.artifact_value ?? 0}`,
    `- Map certainty: ${score.map_certainty_bonus ?? 0}`,
    `- Rule discovery: ${score.rule_discovery_bonus ?? 0}`,
    `- Unused energy: ${score.unused_energy_bonus ?? 0}`,
    `- Integrity: ${score.integrity_bonus ?? 0}`,
    `- Penalties: ${(score.damage_penalty ?? 0) + (score.false_mark_penalty ?? 0) + (score.invalid_action_penalty ?? 0) + (score.wasted_action_penalty ?? 0)}`,
    '',
    'AUDIT METRICS',
    `- Visible cells: ${metrics.visible_cells ?? 0}`,
    `- Marks: ${metrics.marked_cells ?? 0} correct=${metrics.correct_marks ?? 0} false=${metrics.false_marks ?? 0}`,
    `- Damage events: ${metrics.damage_events ?? 0}`,
    `- Invalid actions: ${metrics.invalid_actions ?? 0}`,
    `- Wasted actions: ${metrics.wasted_actions ?? 0}`,
    ...(hasDiagnostics(diagnostics)
      ? [
          `- Model actions: ${diagnostics.modelActions}`,
          `- Fallback actions: ${diagnostics.fallbackActions}`,
          `- Local policy actions: ${diagnostics.localActions}`,
          `- Diagnostic reasons: ${formatReasons(diagnostics.reasons)}`,
        ]
      : []),
    '',
    'KEY EVENTS',
    ...(keyEvents.length ? keyEvents.slice(0, 8) : ['- No major milestones recorded.']),
    '',
    'FAILURES OR RISKS',
    ...(risks.length ? risks.slice(0, 8) : ['- No damage or invalid actions recorded.']),
    '',
    'TRANSFERABLE LESSON',
    `- ${lessonForRule(hiddenRule)}`,
    '',
  ].join('\n');
}

function collectDiagnostic(summary, diagnostic) {
  if (!diagnostic) return;
  if (diagnostic.local_policy) {
    summary.localActions += 1;
    summary.reasons.local = (summary.reasons.local || 0) + 1;
  } else if (diagnostic.fallback) {
    summary.fallbackActions += 1;
    const reason = diagnostic.reason || diagnostic.fallback_policy || 'fallback';
    summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
  } else {
    summary.modelActions += 1;
    summary.reasons.model = (summary.reasons.model || 0) + 1;
  }
}

function hasDiagnostics(summary) {
  return summary.modelActions > 0 || summary.fallbackActions > 0 || summary.localActions > 0;
}

function formatReasons(reasons) {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}:${value}`)
    .join(', ') || 'none';
}

function lessonForRule(ruleId) {
  if (ruleId === 'wall_echo_inversion') return 'Compare boundary echo with interior probes before trusting unstable readings.';
  if (ruleId === 'sector_c_two_unstable') return 'Use sector scans to separate structured echo rules from local hazard noise.';
  if (ruleId === 'exit_radius_safe') return 'When artifacts are secured, exploit exit-radius safety to shorten the final route.';
  if (ruleId === 'artifact_suppression') return 'Probe around artifacts before assuming nearby hazard density follows the global pattern.';
  if (ruleId === 'row_count_disclosure') return 'Scan rows early when local constraints leave multiple hazard placements plausible.';
  return 'Convert local observations into reusable route and risk-control heuristics.';
}

function resolvePath(cwd, value) {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function helpText() {
  return `EchoGrid v0.1

Usage:
  echogrid run --seed 48129 [--script file] [--log file] [--pretty] [--answer]
  echogrid replay <log.jsonl> [--states] [--pretty]
  echogrid report <log.jsonl>
  echogrid evaluate --agent ./agents/baseline.js --seeds ./seeds/public.txt [--log-dir ./logs]
  echogrid inspect --seed 48129

Action protocol:
  move N|S|E|W
  probe x y
  scan row r
  scan col c
  scan sector A|B|C|D
  mark x y hazard|safe|artifact|entity
  extract
  wait
  claim_rule rule_id

Coordinates are zero-based: (0,0) is the northwest corner.
`;
}

module.exports = {
  runCli,
};
