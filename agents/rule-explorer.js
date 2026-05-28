#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const input = fs.readFileSync(0, 'utf8').trim();
const state = JSON.parse(input || '{}');

if (!state.rules?.claim) {
  const action = ruleExperimentAction(state);
  if (action) {
    console.log(action);
    process.exit(0);
  }
}

const baseline = path.join(__dirname, 'baseline.js');
const result = spawnSync(process.execPath, [baseline], {
  input: `${JSON.stringify(state)}\n`,
  encoding: 'utf8',
});

if (result.status !== 0) {
  console.log('wait');
} else {
  const line = result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  console.log(line || 'wait');
}

function ruleExperimentAction(inputState) {
  const recent = [...(inputState.observations?.recent || [])];
  const disclosedRow = [...recent].reverse()
    .find((item) => item.type === 'scan' && item.kind === 'row' && item.rule_signal === 'fixed_row_count_disclosure');
  if (disclosedRow) {
    return `claim_rule row_count_disclosure because row ${disclosedRow.value} scan disclosed a fixed hazard count of ${disclosedRow.disclosed_hazard_count}`;
  }

  const scannedRows = new Set(
    recent
      .filter((item) => item.type === 'scan' && item.kind === 'row' && Number.isInteger(item.value))
      .map((item) => item.value),
  );
  const size = Number(inputState.map?.size || 0);
  const rowProbe = Math.min(2, Math.max(0, size - 1));
  for (const row of [rowProbe]) {
    if (!scannedRows.has(row)) return `scan row ${row}`;
  }
  return null;
}
