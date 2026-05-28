'use strict';

function decideAction(state) {
  const size = state.map.size;
  const position = state.agent.position;
  const required = state.objective.artifacts_required;
  const collected = state.objective.artifacts_collected;
  const exit = state.objective.exit;
  const known = new Map();

  for (const cell of state.map.cells) {
    known.set(key(cell.coord), cell);
  }

  const current = known.get(key(position));
  if (current && current.terrain === 'artifact' && collected < required) {
    return 'extract';
  }
  if (current && current.terrain === 'exit' && collected >= required) {
    return 'extract';
  }

  const hintedAction = state.action_hints?.next_action;
  if (typeof hintedAction === 'string' && hintedAction.trim()) {
    return hintedAction;
  }

  const visibleArtifacts = [...known.values()]
    .filter((cell) => cell.visible && cell.terrain === 'artifact')
    .map((cell) => cell.coord);
  if (collected < required) {
    const pathToArtifact = nearestPath(position, visibleArtifacts);
    if (pathToArtifact && pathToArtifact.length > 1) {
      return moveTo(position, pathToArtifact[1]);
    }
  }

  if (collected >= required) {
    const exitCell = known.get(key(exit));
    const pathToExit = exitCell && exitCell.visible ? path(position, exit) : null;
    if (pathToExit && pathToExit.length > 1) {
      return moveTo(position, pathToExit[1]);
    }
    if (neighbors4(position).some((coord) => key(coord) === key(exit))) {
      return moveTo(position, exit);
    }
    const exitUnknown = unknownNeighbors(position).sort((a, b) => manhattan(a, exit) - manhattan(b, exit))[0];
    if (exitUnknown) {
      return `probe ${exitUnknown[0]} ${exitUnknown[1]}`;
    }
    const frontierPath = pathToFrontier();
    if (frontierPath && frontierPath.length > 1) {
      return moveTo(position, frontierPath[1]);
    }
    const exitStep = greedyStepToward(exit);
    if (exitStep) {
      return exitStep;
    }
  }

  const adjacentUnknown = unknownNeighbors(position);
  if (adjacentUnknown.length > 0) {
    const target = chooseProbeTarget(adjacentUnknown);
    return `probe ${target[0]} ${target[1]}`;
  }

  const frontierPath = pathToFrontier();
  if (frontierPath && frontierPath.length > 1) {
    return moveTo(position, frontierPath[1]);
  }

  const remoteUnknown = firstUnknown();
  if (remoteUnknown) {
    return `probe ${remoteUnknown[0]} ${remoteUnknown[1]}`;
  }

  return 'wait';

  function pathToFrontier() {
    const frontiers = [...known.values()]
      .filter((cell) => cell.visible && passable(cell.coord) && unknownNeighbors(cell.coord).length > 0)
      .map((cell) => cell.coord)
      .sort((a, b) => scoreFrontier(a) - scoreFrontier(b));
    let fallback = null;
    const previous = previousPosition();
    for (const frontier of frontiers) {
      const candidate = path(position, frontier);
      if (!candidate) continue;
      if (!fallback) fallback = candidate;
      if (!previous || candidate.length < 2 || key(candidate[1]) !== key(previous)) return candidate;
    }
    return fallback;
  }

  function scoreFrontier(coord) {
    const goal = collected >= required ? exit : traceGoal();
    return manhattan(coord, goal) + manhattan(position, coord) * 0.25;
  }

  function traceGoal() {
    const observation = [...state.observations.recent].reverse().find((item) => item.type === 'cell');
    if (!observation) return exit;
    const [x, y] = position;
    if (observation.trace === 'east-biased') return [Math.min(size - 1, x + 3), y];
    if (observation.trace === 'west-biased') return [Math.max(0, x - 3), y];
    if (observation.trace === 'south-biased') return [x, Math.min(size - 1, y + 3)];
    if (observation.trace === 'north-biased') return [x, Math.max(0, y - 3)];
    return exit;
  }

  function chooseProbeTarget(candidates) {
    const goal = collected >= required ? exit : traceGoal();
    return candidates
      .filter((coord) => {
        const cell = known.get(key(coord));
        return !cell || cell.mark !== 'hazard';
      })
      .sort((a, b) => manhattan(a, goal) - manhattan(b, goal))[0] || candidates[0];
  }

  function greedyStepToward(goal) {
    const candidates = neighbors4(position).sort((a, b) => manhattan(a, goal) - manhattan(b, goal));
    if (candidates.some((coord) => key(coord) === key(goal))) return moveTo(position, goal);

    const unknown = candidates.find((coord) => {
      const cell = known.get(key(coord));
      return !cell || !cell.visible;
    });
    if (unknown) return `probe ${unknown[0]} ${unknown[1]}`;

    const previous = previousPosition();
    const visible =
      candidates.find((coord) => passable(coord) && (!previous || key(coord) !== key(previous))) ||
      candidates.find((coord) => passable(coord));
    if (visible) return moveTo(position, visible);
    return null;
  }

  function previousPosition() {
    const currentKey = key(position);
    for (const observation of [...state.observations.recent].reverse()) {
      if (observation.type !== 'cell') continue;
      if (key(observation.coord) !== currentKey) return observation.coord;
    }
    return null;
  }

  function nearestPath(start, goals) {
    let best = null;
    for (const goal of goals) {
      const candidate = path(start, goal);
      if (!candidate) continue;
      if (!best || candidate.length < best.length) best = candidate;
    }
    return best;
  }

  function path(start, goal) {
    const queue = [start];
    const seen = new Set([key(start)]);
    const parent = new Map();
    while (queue.length > 0) {
      const currentCoord = queue.shift();
      if (key(currentCoord) === key(goal)) return rebuildPath(currentCoord, parent);
      for (const next of neighbors4(currentCoord)) {
        const nextKey = key(next);
        if (seen.has(nextKey) || !passable(next)) continue;
        seen.add(nextKey);
        parent.set(nextKey, key(currentCoord));
        queue.push(next);
      }
    }
    return null;
  }

  function rebuildPath(end, parent) {
    const result = [end];
    let cursor = key(end);
    while (parent.has(cursor)) {
      cursor = parent.get(cursor);
      result.push(cursor.split(',').map(Number));
    }
    return result.reverse();
  }

  function passable(coord) {
    const cell = known.get(key(coord));
    if (!cell || !cell.visible) return false;
    return cell.terrain === 'empty' || cell.terrain === 'artifact' || cell.terrain === 'exit';
  }

  function unknownNeighbors(coord) {
    return neighbors4(coord).filter((candidate) => {
      const cell = known.get(key(candidate));
      return !cell || !cell.visible;
    });
  }

  function firstUnknown() {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const coord = [x, y];
        const cell = known.get(key(coord));
        if (!cell || !cell.visible) return coord;
      }
    }
    return null;
  }

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

  function manhattan(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  }

  function key(coord) {
    return `${coord[0]},${coord[1]}`;
  }
}

module.exports = {
  decideAction,
};
