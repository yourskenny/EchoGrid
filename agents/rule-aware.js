#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const input = fs.readFileSync(0, 'utf8').trim();
const state = JSON.parse(input || '{}');

if (!state.rules?.claim) {
  const experimentAction = ruleExperimentAction(state);
  if (experimentAction) {
    console.log(experimentAction);
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
  const latestSectorC = [...recent].reverse()
    .find((item) => item.type === 'scan' && item.kind === 'sector' && item.value === 'C');
  if (latestSectorC?.rule_signal === 'sector_c_exactly_two_unstable') {
    return 'claim_rule sector_c_two_unstable because sector C scan showed exactly two unstable echoes';
  }

  const disclosedRow = [...recent].reverse()
    .find((item) => item.type === 'scan' && item.kind === 'row' && item.rule_signal === 'fixed_row_count_disclosure');
  if (disclosedRow) {
    return `claim_rule row_count_disclosure because row ${disclosedRow.value} scan disclosed a fixed hazard count of ${disclosedRow.disclosed_hazard_count}`;
  }

  if (!latestSectorC) return Number(inputState.turn?.current || 0) === 0 ? 'scan sector C' : null;

  const size = Number(inputState.map?.size || 0);
  const rowProbe = Math.min(2, Math.max(0, size - 1));
  if (!shouldRunRowProbe(inputState, latestSectorC)) return null;
  const scannedRows = new Set(
    recent
      .filter((item) => item.type === 'scan' && item.kind === 'row' && Number.isInteger(item.value))
      .map((item) => item.value),
  );
  if (!scannedRows.has(rowProbe)) return `scan row ${rowProbe}`;
  return null;
}

function shouldRunRowProbe(inputState, sectorScan) {
  const currentObservation = inputState.agent?.current_cell?.observation;
  return currentObservation?.echo === 'stable' &&
    currentObservation?.trace === 'east-biased' &&
    Number(sectorScan?.hazard_count) >= 5 &&
    Number(sectorScan?.wall_count) >= 3;
}
