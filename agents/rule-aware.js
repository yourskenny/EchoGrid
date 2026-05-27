#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const input = fs.readFileSync(0, 'utf8').trim();
const state = JSON.parse(input || '{}');

if (!state.rules.claim) {
  if (state.turn.current === 0) {
    console.log('scan sector C');
    process.exit(0);
  }

  const sectorCSignal = [...state.observations.recent]
    .reverse()
    .find((item) => item.type === 'scan' && item.kind === 'sector' && item.value === 'C');
  if (sectorCSignal?.rule_signal === 'sector_c_exactly_two_unstable') {
    console.log('claim_rule sector_c_two_unstable');
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
