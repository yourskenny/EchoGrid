'use strict';

const { createRng } = require('./rng');
const { selectHiddenRule } = require('./rules');
const {
  allCells,
  cellsInSector,
  createEmptyGrid,
  keyOf,
  manhattan,
  neighbors8,
  shortestPath,
} = require('./grid');

const DEFAULT_CONFIG = {
  size: 8,
  energy: 180,
  integrity: 3,
  turnLimit: 130,
  wallCount: 8,
  hazardCount: 10,
  artifactCount: 4,
  artifactsRequired: 3,
  costs: {
    move: 1,
    probe: 2,
    scan: 4,
    mark: 0,
    wait: 1,
    extract: 1,
    claim_rule: 1,
  },
};

function generateWorld(options = {}) {
  const seed = options.seed ?? 48129;
  const size = Number(options.size || DEFAULT_CONFIG.size);
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    size,
    costs: {
      ...DEFAULT_CONFIG.costs,
      ...(options.costs || {}),
    },
  };
  const rng = createRng(seed);
  const hiddenRule = selectHiddenRule(rng);
  const start = [0, 0];
  const exit = [size - 1, size - 1];

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const grid = createEmptyGrid(size);
    grid[start[1]][start[0]].terrain = 'start';
    grid[exit[1]][exit[0]].terrain = 'exit';

    placeWalls({ rng, grid, size, start, exit, count: config.wallCount });
    const artifacts = placeArtifacts({
      rng,
      grid,
      size,
      start,
      exit,
      count: config.artifactCount,
    });
    if (artifacts.length < config.artifactCount) continue;

    const hazards = placeHazards({
      rng,
      grid,
      size,
      start,
      exit,
      artifacts,
      count: config.hazardCount,
      hiddenRule,
      artifactsRequired: config.artifactsRequired,
    });

    if (hazards.length < Math.max(6, config.hazardCount - 2)) continue;
    if (!isWorldSolvable({ grid, size, start, exit, artifacts, artifactsRequired: config.artifactsRequired })) continue;

    const rowDisclosure = rng.int(size);
    const unstableEchoCells = buildUnstableEchoCells({ rng, grid, size, hiddenRule });

    return {
      seed: String(seed),
      mode: options.mode || 'mvp',
      size,
      start,
      exit,
      grid,
      hiddenRule,
      rowDisclosure,
      unstableEchoCells,
      config,
    };
  }

  throw new Error(`Unable to generate a solvable EchoGrid world for seed ${seed}`);
}

function placeWalls({ rng, grid, size, start, exit, count }) {
  let placed = 0;
  const candidates = rng.shuffle(allCells(size)).filter(([x, y]) => {
    if (sameCell([x, y], start) || sameCell([x, y], exit)) return false;
    if (manhattan([x, y], start) <= 1 || manhattan([x, y], exit) <= 1) return false;
    return true;
  });

  for (const [x, y] of candidates) {
    if (placed >= count) break;
    const cell = grid[y][x];
    const previous = cell.terrain;
    cell.terrain = 'wall';
    const path = shortestPath({
      size,
      grid,
      start,
      goals: [exit],
      passable: (candidate) => candidate.terrain !== 'wall',
    });
    if (path) {
      placed += 1;
    } else {
      cell.terrain = previous;
    }
  }
}

function placeArtifacts({ rng, grid, size, start, exit, count }) {
  const artifacts = [];
  const candidates = rng.shuffle(allCells(size)).filter(([x, y]) => {
    const terrain = grid[y][x].terrain;
    if (terrain !== 'empty') return false;
    if (manhattan([x, y], start) < 3) return false;
    if (manhattan([x, y], exit) < 2) return false;
    return true;
  });

  for (const [x, y] of candidates) {
    if (artifacts.length >= count) break;
    const path = shortestPath({
      size,
      grid,
      start,
      goals: [[x, y]],
      passable: (cell) => cell.terrain !== 'wall',
    });
    if (!path) continue;
    grid[y][x].terrain = 'artifact';
    artifacts.push([x, y]);
  }

  return artifacts;
}

function placeHazards({ rng, grid, size, start, exit, artifacts, count, hiddenRule, artifactsRequired }) {
  const hazards = [];
  const artifactKeys = new Set(artifacts.map(([x, y]) => keyOf(x, y)));
  const artifactNeighborKeys = new Set();
  for (const [x, y] of artifacts) {
    for (const [nx, ny] of neighbors8(size, x, y)) {
      artifactNeighborKeys.add(keyOf(nx, ny));
    }
  }

  const candidates = rng.shuffle(allCells(size)).filter(([x, y]) => {
    const key = keyOf(x, y);
    if (grid[y][x].terrain !== 'empty') return false;
    if (manhattan([x, y], start) <= 1) return false;
    if (artifactKeys.has(key)) return false;
    if (hiddenRule.id === 'exit_radius_safe' && manhattan([x, y], exit) <= 1) return false;
    if (hiddenRule.id === 'artifact_suppression' && artifactNeighborKeys.has(key)) return false;
    return true;
  });

  for (const [x, y] of candidates) {
    if (hazards.length >= count) break;
    const previous = grid[y][x].terrain;
    grid[y][x].terrain = 'hazard';
    if (isWorldSolvable({ grid, size, start, exit, artifacts, artifactsRequired })) {
      hazards.push([x, y]);
    } else {
      grid[y][x].terrain = previous;
    }
  }
  return hazards;
}

function buildUnstableEchoCells({ rng, grid, size, hiddenRule }) {
  const unstable = new Set();
  if (hiddenRule.id !== 'sector_c_two_unstable') return unstable;
  const candidates = rng.shuffle(cellsInSector(size, 'C')).filter(([x, y]) => grid[y][x].terrain !== 'wall');
  for (const [x, y] of candidates.slice(0, 2)) {
    unstable.add(keyOf(x, y));
  }
  return unstable;
}

function isWorldSolvable({ grid, size, start, exit, artifacts, artifactsRequired }) {
  const safePassable = (cell) => cell.terrain !== 'wall' && cell.terrain !== 'hazard';
  const exitPath = shortestPath({ size, grid, start, goals: [exit], passable: safePassable });
  if (!exitPath) return false;

  let reachableArtifacts = 0;
  for (const artifact of artifacts) {
    const path = shortestPath({ size, grid, start, goals: [artifact], passable: safePassable });
    if (path) reachableArtifacts += 1;
  }
  return reachableArtifacts >= artifactsRequired;
}

function sameCell(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

module.exports = {
  DEFAULT_CONFIG,
  generateWorld,
};
