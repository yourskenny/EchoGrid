#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const state = JSON.parse(fs.readFileSync(0, 'utf8').trim() || '{}');
const apiKey = process.env.ECHOGRID_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = (process.env.ECHOGRID_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const model = process.env.ECHOGRID_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const timeoutMs = Number(process.env.ECHOGRID_LLM_TIMEOUT_MS || 30000);
const maxTokens = Number(process.env.ECHOGRID_LLM_MAX_TOKENS || 256);
const maxModelTurns = Number(process.env.ECHOGRID_LLM_MAX_MODEL_TURNS || 12);
const fallbackMode = process.env.ECHOGRID_LLM_FALLBACK_MODE || 'baseline';
const localPolicyEnabled = process.env.ECHOGRID_LLM_LOCAL_POLICY !== '0' && fallbackMode !== 'none';
const recoverReasoningAction = process.env.ECHOGRID_LLM_RECOVER_REASONING_ACTION === '1';

if (!apiKey) {
  fallback('missing_api_key', { source: 'env' });
}

const localAction = localPolicyEnabled ? obviousAction() : null;
if (localAction) {
  emitDiagnostic(baseDiagnostic({ fallback: false, local_policy: true, action: localAction }));
  console.log(localAction);
  process.exit(0);
}

if ((state.turn?.current || 0) >= maxModelTurns) {
  fallback('model_turn_budget_exhausted', { fallback_policy: 'baseline_after_model_budget' });
}

const prompt = [
  'You are playing EchoGrid, a CLI-native inference game for agents.',
  'You receive only the current public STATE JSON. You do not know hidden terrain except through observations.',
  'Return exactly one valid action line and no explanation.',
  '',
  'Valid actions:',
  '- move N|S|E|W',
  '- probe x y',
  '- scan row r',
  '- scan col c',
  '- scan sector A|B|C|D',
  '- mark x y hazard|safe|artifact|entity',
  '- extract',
  '- wait',
  '- claim_rule rule_id',
  '',
  'Priorities:',
  '1. Extract immediately when standing on an artifact.',
  '2. Extract at exit after enough artifacts are collected.',
  '3. Prefer one action from action_hints.safe_recommended.',
  '4. Never move into an adjacent wall or hazard.',
  '5. Avoid actions listed in avoid_actions unless no other safe action exists.',
  '6. Use scans or claim_rule only when directly supported by recent observations.',
  '',
  `STATE SUMMARY:\n${buildStateSummary(state)}`,
].join('\n');

main().catch((error) => fallback('request_error', { message: redact(error.message) }));

async function main() {
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: 'You output exactly one EchoGrid action line in the final answer. No markdown, no prose.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  }, timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    fallback(`http_${response.status}`, { body: redact(body).slice(0, 500) });
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  const finishReason = payload?.choices?.[0]?.finish_reason || null;
  const reasoning = payload?.choices?.[0]?.message?.reasoning_content || '';
  const action = sanitizeAction(content);
  const recoveredAction = action ? null : recoverReasoningAction ? extractActionFromReasoning(reasoning) : null;
  if (recoveredAction) {
    emitDiagnostic(baseDiagnostic({
      fallback: false,
      action: recoveredAction,
      recovered_from_reasoning: true,
      finish_reason: finishReason,
      empty_final_content: !content,
    }));
    console.log(recoveredAction);
    return;
  }
  if (!action) fallback('empty_model_action', {
    content: redact(content).slice(0, 300),
    finish_reason: finishReason,
    reasoning_preview: redact(reasoning).slice(0, 300),
  });
  emitDiagnostic(baseDiagnostic({ fallback: false, action, finish_reason: finishReason }));
  console.log(action);
}

function compactState(input) {
  return {
    protocol: input.protocol,
    seed: input.seed,
    turn: input.turn,
    resources: input.resources,
    objective: input.objective,
    agent: input.agent,
    map: {
      size: input.map?.size,
      rows: input.map?.rows,
      cells: input.map?.cells,
    },
    observations: input.observations,
    rules: input.rules,
    valid_actions: input.valid_actions,
    score: input.score,
    score_breakdown: input.score_breakdown,
    metrics: input.metrics,
  };
}

function buildStateSummary(input) {
  const visibleCells = input.map?.cells || [];
  const position = input.agent?.position || [0, 0];
  const recentObservations = input.observations?.recent || [];
  const lastCell = [...recentObservations]
    .reverse()
    .find((item) => item.type === 'cell' && Array.isArray(item.coord));
  const previousPosition = lastCell && !sameCoord(lastCell.coord, position) ? lastCell.coord : null;
  const avoidActions = previousPosition ? [moveTo(position, previousPosition)] : [];
  const adjacent = adjacentCoords(position, input.map?.size || 0).map((coord) => {
    const cell = visibleCells.find((item) => sameCoord(item.coord, coord));
    return {
      coord,
      known: Boolean(cell?.visible),
      terrain: cell?.visible ? cell.terrain : 'unknown',
      mark: cell?.mark || null,
      signal: cell?.observation ? {
        mine: cell.observation.mine_signal,
        heat: cell.observation.heat,
        echo: cell.observation.echo,
        trace: cell.observation.trace,
      } : null,
    };
  });
  return JSON.stringify({
    seed: input.seed,
    turn: input.turn,
    resources: input.resources,
    objective: input.objective,
    action_hints: input.action_hints,
    avoid_actions: avoidActions,
    position,
    previous_position: previousPosition,
    agent: input.agent,
    rows: input.map?.rows,
    current: visibleCells.find((cell) => sameCoord(cell.coord, position)),
    adjacent,
    recent_observations: recentObservations.slice(-5),
    rule_claim: input.rules?.claim,
    rule_catalog: input.rules?.catalog,
    metrics: input.metrics,
  });
}

function sanitizeAction(content) {
  const line = String(content)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('```'));
  if (!line) return null;
  const cleaned = line.replace(/^["'`]|["'`]$/g, '').trim();
  const match = cleaned.match(/^(move\s+[NSEW]|probe\s+\d+\s+\d+|scan\s+(?:row|col)\s+\d+|scan\s+sector\s+[ABCD]|mark\s+\d+\s+\d+\s+(?:hazard|safe|artifact|entity)|extract|wait|claim_rule\s+[a-z0-9_]+)$/i);
  return match ? match[1].toLowerCase().replace(/^move\s+([nsew])$/i, (_, dir) => `move ${dir.toUpperCase()}`) : null;
}

function extractActionFromReasoning(reasoning) {
  const text = String(reasoning || '');
  if (!text.trim()) return null;
  const matches = [...text.matchAll(/\b(move\s+[NSEW]|probe\s+\d+\s+\d+|scan\s+(?:row|col)\s+\d+|scan\s+sector\s+[ABCD]|mark\s+\d+\s+\d+\s+(?:hazard|safe|artifact|entity)|extract|wait|claim_rule\s+[a-z0-9_]+)\b/gi)];
  if (!matches.length) return null;
  return sanitizeAction(matches.at(-1)[1]);
}

function fallback(reason, detail = {}) {
  if (fallbackMode === 'none') {
    emitDiagnostic(baseDiagnostic({
      fallback: false,
      model_error: true,
      abort_evaluation: true,
      abort_reason: `model_${reason}`,
      reason,
      ...detail,
    }));
    console.log(`__model_unavailable__ ${reason}`);
    process.exit(0);
  }

  const baseline = fallbackMode === 'baseline' ? baselineAction() : null;
  emitDiagnostic(baseDiagnostic({
    fallback: true,
    fallback_policy: baseline ? (detail.fallback_policy || 'baseline') : 'minimal',
    reason,
    ...detail,
  }));
  if (baseline) {
    console.log(baseline);
    process.exit(0);
  }
  const current = state.map?.cells?.find((cell) =>
    cell.coord?.[0] === state.agent?.position?.[0] &&
    cell.coord?.[1] === state.agent?.position?.[1]);
  if (current?.terrain === 'artifact') {
    console.log('extract');
    process.exit(0);
  }
  if (current?.terrain === 'exit' && state.objective?.artifacts_collected >= state.objective?.artifacts_required) {
    console.log('extract');
    process.exit(0);
  }
  const adjacent = adjacentUnknown();
  if (adjacent) {
    console.log(`probe ${adjacent[0]} ${adjacent[1]}`);
    process.exit(0);
  }
  console.log('wait');
  process.exit(0);
}

function baselineAction() {
  const baseline = path.join(__dirname, 'baseline.js');
  const result = spawnSync(process.execPath, [baseline], {
    input: `${JSON.stringify(state)}\n`,
    encoding: 'utf8',
    timeout: 3000,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function obviousAction() {
  const current = currentCell();
  if (current?.terrain === 'artifact') return 'extract';
  if (current?.terrain === 'exit' && state.objective?.artifacts_collected >= state.objective?.artifacts_required) return 'extract';
  return null;
}

function currentCell() {
  return state.map?.cells?.find((cell) =>
    cell.coord?.[0] === state.agent?.position?.[0] &&
    cell.coord?.[1] === state.agent?.position?.[1]);
}

function knownMap() {
  return new Map((state.map?.cells || []).map((cell) => [`${cell.coord[0]},${cell.coord[1]}`, cell]));
}

function emitDiagnostic(diagnostic) {
  process.stderr.write(`ECHOGRID_AGENT_DIAG ${JSON.stringify(diagnostic)}\n`);
}

function baseDiagnostic(extra) {
  return {
    model,
    base_url: baseUrl,
    fallback_mode: fallbackMode,
    local_policy_enabled: localPolicyEnabled,
    recover_reasoning_action: recoverReasoningAction,
    ...extra,
  };
}

function redact(value) {
  return String(value || '').replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***');
}

function adjacentUnknown() {
  const size = state.map?.size || 0;
  const [x, y] = state.agent?.position || [0, 0];
  const known = knownMap();
  return adjacentCoords([x, y], size).find(([nx, ny]) => !known.get(`${nx},${ny}`)?.visible);
}

function adjacentCoords([x, y], size) {
  return [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ].filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < size && ny < size);
}

function moveTo(from, to) {
  if (to[0] > from[0]) return 'move E';
  if (to[0] < from[0]) return 'move W';
  if (to[1] > from[1]) return 'move S';
  return 'move N';
}

function sameCoord(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}
