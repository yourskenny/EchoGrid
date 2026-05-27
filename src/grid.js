'use strict';

const DIRECTIONS = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

const SECTORS = {
  A: { x0: 0, y0: 0, x1: 3, y1: 3 },
  B: { x0: 4, y0: 0, x1: 7, y1: 3 },
  C: { x0: 0, y0: 4, x1: 3, y1: 7 },
  D: { x0: 4, y0: 4, x1: 7, y1: 7 },
};

function keyOf(x, y) {
  return `${x},${y}`;
}

function fromKey(key) {
  return key.split(',').map((part) => Number(part));
}

function inBounds(size, x, y) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function neighbors4(size, x, y) {
  const result = [];
  for (const [dx, dy] of Object.values(DIRECTIONS)) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(size, nx, ny)) result.push([nx, ny]);
  }
  return result;
}

function neighbors8(size, x, y) {
  const result = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(size, nx, ny)) result.push([nx, ny]);
    }
  }
  return result;
}

function allCells(size) {
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}

function isNearWall(size, grid, x, y) {
  if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return true;
  return neighbors4(size, x, y).some(([nx, ny]) => grid[ny][nx].terrain === 'wall');
}

function sectorOf(x, y) {
  for (const [id, box] of Object.entries(SECTORS)) {
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return id;
  }
  return null;
}

function cellsInSector(size, sector) {
  const box = SECTORS[sector];
  if (!box) return [];
  const cells = [];
  for (let y = box.y0; y <= Math.min(box.y1, size - 1); y += 1) {
    for (let x = box.x0; x <= Math.min(box.x1, size - 1); x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}

function shortestPath({ size, grid, start, goals, passable }) {
  const goalKeys = new Set(goals.map(([x, y]) => keyOf(x, y)));
  const startKey = keyOf(start[0], start[1]);
  const queue = [start];
  const seen = new Set([startKey]);
  const parent = new Map();

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const currentKey = keyOf(x, y);
    if (goalKeys.has(currentKey)) {
      const path = [[x, y]];
      let cursor = currentKey;
      while (parent.has(cursor)) {
        const previous = parent.get(cursor);
        path.push(fromKey(previous));
        cursor = previous;
      }
      return path.reverse();
    }
    for (const [nx, ny] of neighbors4(size, x, y)) {
      const nextKey = keyOf(nx, ny);
      if (seen.has(nextKey)) continue;
      if (!passable(grid[ny][nx], nx, ny)) continue;
      seen.add(nextKey);
      parent.set(nextKey, currentKey);
      queue.push([nx, ny]);
    }
  }
  return null;
}

function createEmptyGrid(size) {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      x,
      y,
      terrain: 'empty',
    })),
  );
}

module.exports = {
  DIRECTIONS,
  SECTORS,
  allCells,
  cellsInSector,
  createEmptyGrid,
  inBounds,
  isNearWall,
  keyOf,
  manhattan,
  neighbors4,
  neighbors8,
  sectorOf,
  shortestPath,
};
