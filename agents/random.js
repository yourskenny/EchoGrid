#!/usr/bin/env node
'use strict';

const fs = require('fs');

const state = JSON.parse(fs.readFileSync(0, 'utf8').trim() || '{}');
const rng = createRng(`${state.seed}:${state.turn.current}`);
const size = state.map.size;
const position = state.agent.position;
const known = new Map(state.map.cells.map((cell) => [key(cell.coord), cell]));
const current = known.get(key(position));

if (current && current.terrain === 'artifact') {
  console.log('extract');
  process.exit(0);
}

if (
  current &&
  current.terrain === 'exit' &&
  state.objective.artifacts_collected >= state.objective.artifacts_required
) {
  console.log('extract');
  process.exit(0);
}

const actions = [];
for (const coord of neighbors4(position)) {
  const cell = known.get(key(coord));
  if (!cell || !cell.visible) {
    actions.push(`probe ${coord[0]} ${coord[1]}`);
  } else if (cell.terrain === 'empty' || cell.terrain === 'artifact' || cell.terrain === 'exit') {
    actions.push(moveTo(position, coord));
  }
}

if (rng.next() < 0.35) actions.push(`scan row ${rng.int(size)}`);
if (rng.next() < 0.35) actions.push(`scan col ${rng.int(size)}`);
if (rng.next() < 0.25) actions.push(`scan sector ${['A', 'B', 'C', 'D'][rng.int(4)]}`);
actions.push('wait');

console.log(actions[rng.int(actions.length)]);

function neighbors4(coord) {
  const [x, y] = coord;
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

function key(coord) {
  return `${coord[0]},${coord[1]}`;
}

function createRng(seed) {
  let stateValue = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    stateValue ^= seed.charCodeAt(i);
    stateValue = Math.imul(stateValue, 16777619);
  }
  return {
    next() {
      stateValue = (stateValue + 0x6d2b79f5) >>> 0;
      let t = stateValue;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive) {
      return Math.floor(this.next() * maxExclusive);
    },
  };
}
