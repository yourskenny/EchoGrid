'use strict';

const { generateWorld } = require('./generator');
const { HIDDEN_RULES, isKnownRule } = require('./rules');
const {
  DIRECTIONS,
  allCells,
  cellsInSector,
  inBounds,
  isNearWall,
  keyOf,
  manhattan,
  neighbors8,
  sectorOf,
} = require('./grid');

class EchoGridGame {
  constructor(options = {}) {
    this.world = generateWorld(options);
    this.turn = 0;
    this.energy = this.world.config.energy;
    this.integrity = this.world.config.integrity;
    this.position = [...this.world.start];
    this.visible = new Set();
    this.marks = new Map();
    this.collected = new Set();
    this.recentObservations = [];
    this.events = [];
    this.claimedRule = null;
    this.terminal = null;
    this.penalties = {
      damage: 0,
      invalid: 0,
      wasted: 0,
      falseMarks: 0,
    };
    this.revealCell(this.position[0], this.position[1], 'initial');
  }

  step(commandLine) {
    if (this.terminal) {
      return this.recordAction(commandLine, {
        ok: false,
        type: 'terminal',
        message: 'Game is already terminal.',
      });
    }

    const parsed = parseAction(commandLine);
    if (!parsed.ok) {
      this.consumeTurn();
      this.penalties.invalid += 1;
      this.checkTerminal();
      return this.recordAction(commandLine, parsed);
    }

    let outcome;
    switch (parsed.action) {
      case 'move':
        outcome = this.move(parsed.direction);
        break;
      case 'probe':
        outcome = this.probe(parsed.x, parsed.y);
        break;
      case 'scan':
        outcome = this.scan(parsed.kind, parsed.value);
        break;
      case 'mark':
        outcome = this.mark(parsed.x, parsed.y, parsed.mark);
        break;
      case 'wait':
        outcome = this.wait();
        break;
      case 'extract':
        outcome = this.extract();
        break;
      case 'claim_rule':
        outcome = this.claimRule(parsed.ruleId);
        break;
      default:
        outcome = {
          ok: false,
          type: 'invalid',
          message: `Unsupported action: ${parsed.action}`,
        };
        this.penalties.invalid += 1;
        this.consumeTurn();
    }

    this.checkTerminal();
    return this.recordAction(commandLine, outcome);
  }

  move(direction) {
    const delta = DIRECTIONS[direction];
    if (!delta) return this.invalid(`Unknown move direction: ${direction}`);
    const target = [this.position[0] + delta[0], this.position[1] + delta[1]];
    if (!inBounds(this.world.size, target[0], target[1])) return this.invalid('Move target is outside the grid.');
    const targetCell = this.cellAt(target[0], target[1]);
    if (targetCell.terrain === 'wall') return this.invalid('Move target is a wall.');

    this.spend('move');
    this.position = target;
    const terrain = this.revealCell(target[0], target[1], 'move');
    const observations = [this.observe(target[0], target[1], 'move')];
    if (terrain === 'hazard') {
      this.integrity -= 1;
      this.penalties.damage += 1;
      observations.push({
        type: 'damage',
        coord: target,
        integrity: this.integrity,
        message: 'Hazard contact reduced integrity.',
      });
    }
    this.addObservations(observations);
    return {
      ok: true,
      type: 'move',
      direction,
      coord: target,
      terrain,
      observations,
    };
  }

  probe(x, y) {
    if (!inBounds(this.world.size, x, y)) return this.invalid('Probe target is outside the grid.');
    this.spend('probe');
    const wasVisible = this.visible.has(keyOf(x, y));
    if (wasVisible) this.penalties.wasted += 1;
    const terrain = this.revealCell(x, y, 'probe');
    const observation = this.observe(x, y, 'probe');
    this.addObservations([observation]);
    return {
      ok: true,
      type: 'probe',
      coord: [x, y],
      terrain,
      repeated: wasVisible,
      observation,
    };
  }

  scan(kind, value) {
    if (!['row', 'col', 'sector'].includes(kind)) return this.invalid(`Unsupported scan kind: ${kind}`);
    if ((kind === 'row' || kind === 'col') && !Number.isInteger(value)) return this.invalid('Row/col scan needs an integer index.');
    if ((kind === 'row' || kind === 'col') && (value < 0 || value >= this.world.size)) {
      return this.invalid('Scan index is outside the grid.');
    }
    if (kind === 'sector' && !cellsInSector(this.world.size, value).length) return this.invalid('Unknown sector.');

    this.spend('scan');
    const cells = scanCells(this.world.size, kind, value);
    const counts = countCells(this.world, cells);
    const observation = {
      type: 'scan',
      kind,
      value,
      hazard_count: counts.hazards,
      wall_count: counts.walls,
      artifact_heat: band(counts.artifacts),
      echo_unstable_count: counts.unstableEcho,
    };
    if (this.world.hiddenRule.id === 'row_count_disclosure' && kind === 'row' && value === this.world.rowDisclosure) {
      observation.rule_signal = 'fixed_row_count_disclosure';
      observation.disclosed_hazard_count = counts.hazards;
      observation.confidence = 1;
    }
    if (this.world.hiddenRule.id === 'sector_c_two_unstable' && kind === 'sector' && value === 'C') {
      observation.rule_signal = 'sector_c_exactly_two_unstable';
      observation.echo_unstable_count = 2;
      observation.confidence = 1;
    }
    this.addObservations([observation]);
    return {
      ok: true,
      type: 'scan',
      observation,
    };
  }

  mark(x, y, mark) {
    if (!inBounds(this.world.size, x, y)) return this.invalid('Mark target is outside the grid.');
    this.spend('mark');
    this.marks.set(keyOf(x, y), mark);
    return {
      ok: true,
      type: 'mark',
      coord: [x, y],
      mark,
    };
  }

  wait() {
    this.spend('wait');
    const observation = this.observe(this.position[0], this.position[1], 'wait');
    this.addObservations([observation]);
    return {
      ok: true,
      type: 'wait',
      observation,
    };
  }

  extract() {
    const [x, y] = this.position;
    const cell = this.cellAt(x, y);
    if (
      cell.terrain === 'artifact' &&
      !this.collected.has(keyOf(x, y)) &&
      this.collected.size < this.world.config.artifactsRequired
    ) {
      this.spend('extract');
      this.collected.add(keyOf(x, y));
      const observation = {
        type: 'extract_artifact',
        coord: [x, y],
        artifacts_collected: this.collected.size,
      };
      this.addObservations([observation]);
      return {
        ok: true,
        type: 'extract_artifact',
        observation,
      };
    }
    if (cell.terrain === 'exit') {
      if (this.collected.size < this.world.config.artifactsRequired) {
        return this.invalid(`Exit requires ${this.world.config.artifactsRequired} artifacts.`);
      }
      this.spend('extract');
      this.terminal = {
        status: 'success',
        reason: 'objective_complete',
      };
      return {
        ok: true,
        type: 'extract_exit',
        message: 'Objective complete.',
      };
    }
    return this.invalid('Extract is only valid on an uncollected artifact or the exit.');
  }

  claimRule(ruleId) {
    if (!isKnownRule(ruleId)) return this.invalid(`Unknown rule id: ${ruleId}`);
    this.spend('claim_rule');
    if (this.claimedRule) {
      this.penalties.wasted += 1;
      return {
        ok: false,
        type: 'claim_rule',
        message: 'A hidden rule has already been claimed.',
        claimed_rule: this.claimedRule,
      };
    }
    const correct = ruleId === this.world.hiddenRule.id;
    this.claimedRule = {
      id: ruleId,
      correct,
      turn: this.turn,
    };
    if (!correct) this.penalties.invalid += 1;
    const observation = {
      type: 'rule_claim',
      rule_id: ruleId,
      accepted: correct,
    };
    this.addObservations([observation]);
    return {
      ok: correct,
      type: 'claim_rule',
      observation,
    };
  }

  invalid(message) {
    this.penalties.invalid += 1;
    this.consumeTurn();
    return {
      ok: false,
      type: 'invalid',
      message,
    };
  }

  spend(action) {
    this.energy -= this.world.config.costs[action] ?? 0;
    this.consumeTurn();
  }

  consumeTurn() {
    this.turn += 1;
  }

  checkTerminal() {
    if (this.terminal) return;
    if (this.integrity <= 0) {
      this.terminal = {
        status: 'failure',
        reason: 'integrity_depleted',
      };
      return;
    }
    if (this.energy < 0) {
      this.terminal = {
        status: 'failure',
        reason: 'energy_depleted',
      };
      return;
    }
    if (this.turn >= this.world.config.turnLimit) {
      this.terminal = {
        status: 'failure',
        reason: 'turn_limit',
      };
    }
  }

  revealCell(x, y) {
    const key = keyOf(x, y);
    this.visible.add(key);
    return this.visibleTerrain(x, y);
  }

  visibleTerrain(x, y) {
    const cell = this.cellAt(x, y);
    if (cell.terrain === 'start') return 'empty';
    if (cell.terrain === 'artifact' && this.collected.has(keyOf(x, y))) return 'empty';
    return cell.terrain;
  }

  observe(x, y, source) {
    const terrain = this.visibleTerrain(x, y);
    const mineSignal = neighbors8(this.world.size, x, y).filter(([nx, ny]) => this.cellAt(nx, ny).terrain === 'hazard').length;
    const heat = heatAt(this.world, this.collected, x, y);
    const echo = echoAt(this.world, x, y);
    return {
      type: 'cell',
      source,
      coord: [x, y],
      terrain,
      mine_signal: terrain === 'wall' || terrain === 'hazard' ? null : mineSignal,
      heat,
      echo,
      trace: traceAt(this.world, this.collected, [x, y]),
      noise: echo === 'unstable' ? 0.12 : 0.03,
      sector: sectorOf(x, y),
    };
  }

  addObservations(observations) {
    for (const observation of observations) {
      this.recentObservations.push({
        turn: this.turn,
        ...observation,
      });
    }
    this.recentObservations = this.recentObservations.slice(-12);
  }

  cellAt(x, y) {
    return this.world.grid[y][x];
  }

  recordAction(commandLine, outcome) {
    const event = {
      turn: this.turn,
      command: commandLine,
      outcome,
      score: this.score(),
      terminal: this.terminal,
    };
    this.events.push(event);
    return event;
  }

  state(options = {}) {
    const includeAnswer = Boolean(options.includeAnswer);
    this.penalties.falseMarks = this.countFalseMarks();
    const terminal = this.terminal
      ? {
          ...this.terminal,
          score: this.score(),
          hidden_rule: this.world.hiddenRule.id,
          hidden_rule_name: this.world.hiddenRule.name,
        }
      : null;
    return {
      protocol: 'echogrid.state.v1',
      seed: this.world.seed,
      mode: this.world.mode,
      coordinate_system: 'zero_based',
      turn: {
        current: this.turn,
        limit: this.world.config.turnLimit,
        terminal,
      },
      resources: {
        energy: this.energy,
        integrity: this.integrity,
      },
      objective: {
        text: `retrieve ${this.world.config.artifactsRequired} artifacts and extract at exit`,
        artifacts_required: this.world.config.artifactsRequired,
        artifacts_collected: this.collected.size,
        exit: [...this.world.exit],
      },
      agent: {
        position: [...this.position],
        current_cell: this.publicCell(this.position[0], this.position[1]),
        adjacent: this.adjacentCells(),
      },
      map: this.knownMap(),
      observations: {
        recent: this.recentObservations,
      },
      rules: {
        claim: this.claimedRule,
        catalog: HIDDEN_RULES.map((rule) => ({
          id: rule.id,
          name: rule.name,
        })),
      },
      valid_actions: [
        'move N|S|E|W',
        'probe x y',
        'scan row r',
        'scan col c',
        'scan sector A|B|C|D',
        'mark x y hazard|safe|artifact|entity',
        'extract',
        'wait',
        'claim_rule rule_id',
      ],
      action_hints: this.actionHints(),
      score: this.score(),
      score_breakdown: this.scoreBreakdown(),
      metrics: this.metrics(),
      ...(includeAnswer ? { answer: this.answer() } : {}),
    };
  }

  publicCell(x, y) {
    const key = keyOf(x, y);
    const visible = this.visible.has(key);
    const mark = this.marks.get(key) || null;
    return {
      coord: [x, y],
      visible,
      terrain: visible ? this.visibleTerrain(x, y) : 'unknown',
      mark,
      observation: visible ? this.observe(x, y, 'public_cell') : null,
    };
  }

  adjacentCells() {
    return Object.entries(DIRECTIONS).map(([direction, [dx, dy]]) => {
      const x = this.position[0] + dx;
      const y = this.position[1] + dy;
      if (!inBounds(this.world.size, x, y)) {
        return {
          direction,
          coord: [x, y],
          in_bounds: false,
          recommended_actions: [],
        };
      }
      const cell = this.publicCell(x, y);
      return {
        direction,
        in_bounds: true,
        ...cell,
        recommended_actions: this.recommendedActionsForAdjacent(direction, cell),
      };
    });
  }

  recommendedActionsForAdjacent(direction, cell) {
    if (!cell.visible) return [`probe ${cell.coord[0]} ${cell.coord[1]}`];
    if (cell.terrain === 'wall' || cell.terrain === 'hazard') return [];
    return [`move ${direction}`];
  }

  actionHints() {
    const hints = [];
    const current = this.publicCell(this.position[0], this.position[1]);
    if (current.terrain === 'artifact' && this.collected.size < this.world.config.artifactsRequired) hints.push('extract');
    if (current.terrain === 'exit' && this.collected.size >= this.world.config.artifactsRequired) hints.push('extract');
    const avoidRepeating = this.repeatAvoidanceHints();
    const routeHint = this.routeHintAction(avoidRepeating);
    if (routeHint) hints.push(routeHint);
    for (const adjacent of this.adjacentCells()) {
      for (const action of adjacent.recommended_actions) hints.push(action);
    }
    const deduped = [...new Set(hints)];
    const preferredActions = deduped.sort((a, b) => this.comparePreferredActions(a, b, { avoidRepeating, routeHint }));
    return {
      goal: this.actionHintGoal(),
      next_action: preferredActions[0] || null,
      preferred: preferredActions,
      safe_recommended: deduped,
      avoid_repeating: avoidRepeating,
      warning: 'Prefer these actions unless you have a specific reason to scan, mark, wait, or claim_rule.',
    };
  }

  repeatAvoidanceHints() {
    const recent = this.recentMovePositions();
    return adjacentMoveActions(this.position)
      .filter(({ target }) => recent.some((coord) => sameCoord(coord, target)))
      .map(({ action }) => action);
  }

  recentMovePositions(limit = 6) {
    const result = [];
    for (const event of [...this.events].reverse()) {
      if (event.outcome?.type !== 'move' || !Array.isArray(event.outcome.coord)) continue;
      const delta = DIRECTIONS[event.outcome.direction];
      result.push(event.outcome.coord);
      if (delta) {
        result.push([event.outcome.coord[0] - delta[0], event.outcome.coord[1] - delta[1]]);
      }
      if (result.length >= limit) break;
    }
    return result;
  }

  routeHintAction(avoidActions = []) {
    const goal = this.actionHintGoal();
    const known = new Map(this.knownCells().map((cell) => [keyOf(cell.coord[0], cell.coord[1]), cell]));
    if (goal.source !== 'exit') {
      if (!this.artifactSearchStalled()) return null;
      const probe = this.stalledSearchProbe(goal.coord, known, avoidActions);
      if (probe) return `probe ${probe[0]} ${probe[1]}`;
      const frontier = this.publicFrontierRoute(goal.coord, known, avoidActions, { preferAdjacentProbe: true });
      if (frontier) {
        if (frontier.path.length <= 1) return `probe ${frontier.probe[0]} ${frontier.probe[1]}`;
        return actionFromPathOrFrontier(this.position, frontier.path);
      }
      return null;
    }

    const exitKey = keyOf(this.world.exit[0], this.world.exit[1]);
    const exitCell = known.get(exitKey);
    if (exitCell && passablePublicCell(exitCell)) {
      const directPath = this.publicPathTo([this.world.exit], known, new Set());
      const action = actionFromPathOrFrontier(this.position, directPath);
      if (action) return action;
    }

    const optimisticExit = this.optimisticExitRoute(known, avoidActions);
    if (optimisticExit) return optimisticExit;

    const frontier = this.publicFrontierRoute(this.world.exit, known, avoidActions);
    if (frontier) {
      if (frontier.path.length <= 1) return `probe ${frontier.probe[0]} ${frontier.probe[1]}`;
      return actionFromPathOrFrontier(this.position, frontier.path);
    }

    return null;
  }

  optimisticExitRoute(known, avoidActions = []) {
    const path = this.publicOptimisticPathTo(this.world.exit, known, avoidActions);
    if (!path || path.length < 2) return null;
    const next = path[1];
    const cell = known.get(keyOf(next[0], next[1]));
    if (!cell || !cell.visible) return `probe ${next[0]} ${next[1]}`;
    if (passablePublicCell(cell)) return moveFromTo(this.position, next);
    return null;
  }

  artifactSearchStalled(limit = 14) {
    if (this.collected.size >= this.world.config.artifactsRequired) return false;
    const positions = [];
    for (const event of [...this.events].reverse()) {
      if (event.outcome?.type !== 'move' || !Array.isArray(event.outcome.coord)) continue;
      positions.push(event.outcome.coord);
      if (positions.length >= limit) break;
    }
    if (positions.length < 8) return false;

    const unique = new Set(positions.map(([x, y]) => keyOf(x, y))).size;
    const currentVisits = positions.filter((coord) => sameCoord(coord, this.position)).length;
    const [last, previous, beforePrevious] = positions;
    const oscillating = last && previous && beforePrevious && sameCoord(last, beforePrevious);
    return currentVisits >= 3 || unique <= Math.ceil(positions.length * 0.45) || oscillating;
  }

  stalledSearchProbe(goal, known, avoidActions = []) {
    const avoidTargets = new Set(
      avoidActions
        .map((action) => actionTarget(action, this.position))
        .filter(Boolean)
        .map(([x, y]) => keyOf(x, y)),
    );
    return this.publicUnknownNeighbors(this.position, known)
      .sort((a, b) => {
        const avoid = Number(avoidTargets.has(keyOf(a[0], a[1]))) - Number(avoidTargets.has(keyOf(b[0], b[1])));
        if (avoid !== 0) return avoid;
        return manhattan(a, goal) - manhattan(b, goal);
      })
      [0] || null;
  }

  publicFrontierRoute(goal, known, avoidActions = [], options = {}) {
    const avoidTargets = new Set(
      avoidActions
        .map((action) => actionTarget(action, this.position))
        .filter(Boolean)
        .map(([x, y]) => keyOf(x, y)),
    );
    const queue = [this.position];
    const startKey = keyOf(this.position[0], this.position[1]);
    const seen = new Set([startKey]);
    const parent = new Map();
    const candidates = [];

    while (queue.length > 0) {
      const current = queue.shift();
      const path = rebuildPublicPath(current, parent);
      for (const probe of this.publicUnknownNeighbors(current, known)) {
        candidates.push({
          path,
          probe,
          score: frontierRouteScore(path, probe, goal, avoidTargets, options),
        });
      }
      for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
        const next = [current[0] + dx, current[1] + dy];
        const nextKey = keyOf(next[0], next[1]);
        if (seen.has(nextKey)) continue;
        const cell = known.get(nextKey);
        if (!cell || !passablePublicCell(cell)) continue;
        seen.add(nextKey);
        parent.set(nextKey, keyOf(current[0], current[1]));
        queue.push(next);
      }
    }

    return candidates.sort((a, b) => a.score - b.score)[0] || null;
  }

  publicPathTo(goals, known, avoidTargets = new Set()) {
    const goalKeys = new Set(goals.map(([x, y]) => keyOf(x, y)));
    const startKey = keyOf(this.position[0], this.position[1]);
    const queue = [this.position];
    const seen = new Set([startKey]);
    const parent = new Map();

    while (queue.length > 0) {
      const current = queue.shift();
      const currentKey = keyOf(current[0], current[1]);
      if (goalKeys.has(currentKey)) return rebuildPublicPath(current, parent);
      for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
        const next = [current[0] + dx, current[1] + dy];
        const nextKey = keyOf(next[0], next[1]);
        if (seen.has(nextKey)) continue;
        if (avoidTargets.has(nextKey) && !goalKeys.has(nextKey)) continue;
        const cell = known.get(nextKey);
        if (!cell || !passablePublicCell(cell)) continue;
        seen.add(nextKey);
        parent.set(nextKey, currentKey);
        queue.push(next);
      }
    }
    return null;
  }

  publicOptimisticPathTo(goal, known, avoidActions = []) {
    const avoidTargets = new Set(
      avoidActions
        .map((action) => actionTarget(action, this.position))
        .filter(Boolean)
        .map(([x, y]) => keyOf(x, y)),
    );
    const goalKey = keyOf(goal[0], goal[1]);
    const startKey = keyOf(this.position[0], this.position[1]);
    const queue = [this.position];
    const seen = new Set([startKey]);
    const parent = new Map();

    while (queue.length > 0) {
      const current = queue.shift();
      const currentKey = keyOf(current[0], current[1]);
      if (currentKey === goalKey) return rebuildPublicPath(current, parent);
      const nextSteps = Object.values(DIRECTIONS)
        .map(([dx, dy]) => [current[0] + dx, current[1] + dy])
        .filter(([x, y]) => inBounds(this.world.size, x, y))
        .sort((a, b) => {
          const avoid = Number(avoidTargets.has(keyOf(a[0], a[1]))) - Number(avoidTargets.has(keyOf(b[0], b[1])));
          if (avoid !== 0) return avoid;
          return manhattan(a, goal) - manhattan(b, goal);
        });
      for (const next of nextSteps) {
        const nextKey = keyOf(next[0], next[1]);
        if (seen.has(nextKey)) continue;
        const cell = known.get(nextKey);
        if (cell?.visible && !passablePublicCell(cell)) continue;
        seen.add(nextKey);
        parent.set(nextKey, currentKey);
        queue.push(next);
      }
    }
    return null;
  }

  publicUnknownNeighbors(coord, known) {
    const result = [];
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const next = [coord[0] + dx, coord[1] + dy];
      if (!inBounds(this.world.size, next[0], next[1])) continue;
      const cell = known.get(keyOf(next[0], next[1]));
      if (!cell || !cell.visible) result.push(next);
    }
    return result;
  }

  comparePreferredActions(a, b, context = {}) {
    if (a === 'extract' || b === 'extract') return actionPriority(a) - actionPriority(b);
    if (context.routeHint) {
      if (a === context.routeHint && b !== context.routeHint) return -1;
      if (b === context.routeHint && a !== context.routeHint) return 1;
    }
    const goalInfo = this.actionHintGoal();
    const goal = goalInfo.coord;
    const aProgress = this.publicGoalProgressRank(a, goal);
    const bProgress = this.publicGoalProgressRank(b, goal);
    if (goalInfo.source === 'exit') {
      const repeatPenalty = repeatPenaltyFor(a, context.avoidRepeating) - repeatPenaltyFor(b, context.avoidRepeating);
      if (repeatPenalty !== 0) return repeatPenalty;
    }
    const progress = aProgress - bProgress;
    if (progress !== 0) return progress;
    if (goalInfo.source !== 'exit') {
      const axis = this.publicGoalAxisDistance(a, goalInfo) - this.publicGoalAxisDistance(b, goalInfo);
      if (axis !== 0) return axis;
      if (aProgress > 0) {
        const exploration = nonExitExplorationPriority(a) - nonExitExplorationPriority(b);
        if (exploration !== 0) return exploration;
      }
      const repeatPenalty = repeatPenaltyFor(a, context.avoidRepeating) - repeatPenaltyFor(b, context.avoidRepeating);
      if (repeatPenalty !== 0) return repeatPenalty;
    }
    if (goalInfo.source === 'exit') {
      const exploration = 0;
      if (exploration !== 0) return exploration;
    }
    const priority = actionPriority(a) - actionPriority(b);
    if (priority !== 0) return priority;
    return this.publicGoalDistance(a, goal) - this.publicGoalDistance(b, goal);
  }

  publicGoalAxisDistance(action, goalInfo) {
    const target = actionTarget(action, this.position);
    if (!target) return Number.POSITIVE_INFINITY;
    const axis = traceAxis(goalInfo.trace) || dominantAxis(this.position, goalInfo.coord);
    if (axis === 'x') return Math.abs(target[0] - goalInfo.coord[0]);
    return Math.abs(target[1] - goalInfo.coord[1]);
  }

  publicGoalProgressRank(action, goal) {
    if (action === 'extract') return 0;
    const targetDistance = this.publicGoalDistance(action, goal);
    if (!Number.isFinite(targetDistance)) return 3;
    const currentDistance = manhattan(this.position, goal);
    if (targetDistance < currentDistance) return 0;
    if (targetDistance === currentDistance) return 1;
    return 2;
  }

  publicGoalDistance(action, goal) {
    const target = actionTarget(action, this.position);
    if (!target) return Number.POSITIVE_INFINITY;
    return manhattan(target, goal);
  }

  publicHintGoal() {
    return this.actionHintGoal().coord;
  }

  actionHintGoal() {
    if (this.collected.size >= this.world.config.artifactsRequired) {
      return {
        source: 'exit',
        coord: [...this.world.exit],
        reason: 'required artifacts are collected; route to exit',
      };
    }
    const heatGoal = this.publicHeatGoal();
    if (heatGoal) return heatGoal;
    const trace = this.publicCell(this.position[0], this.position[1]).observation?.trace;
    if (!trace || trace === 'local') {
      return {
        source: 'exit',
        coord: [...this.world.exit],
        reason: 'no public artifact trace is available',
      };
    }
    return {
      source: 'trace',
      trace,
      coord: traceGoal(this.world.size, this.position, trace, this.world.exit),
      reason: 'artifacts remain; follow the public trace signal before routing to exit',
    };
  }

  publicHeatGoal() {
    const candidates = this.knownCells()
      .filter((cell) => cell.visible && cell.observation?.heat === 'high')
      .sort((a, b) => manhattan(this.position, a.coord) - manhattan(this.position, b.coord));
    const hot = candidates[0];
    if (!hot) return null;
    const trace = hot.observation?.trace;
    return {
      source: 'heat',
      heat: 'high',
      trace,
      heat_coord: [...hot.coord],
      coord: traceGoal(this.world.size, hot.coord, trace, hot.coord),
      reason: 'artifacts remain; search from public high heat toward its trace signal',
    };
  }

  knownCells() {
    return [...this.visible].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return this.publicCell(x, y);
    });
  }

  previousPosition() {
    for (const event of [...this.events].reverse()) {
      if (event.outcome?.type !== 'move') continue;
      const direction = event.outcome.direction;
      const delta = DIRECTIONS[direction];
      const coord = event.outcome.coord;
      if (!delta || !Array.isArray(coord)) continue;
      return [coord[0] - delta[0], coord[1] - delta[1]];
    }
    return null;
  }

  knownMap() {
    const rows = [];
    const cells = [];
    for (let y = 0; y < this.world.size; y += 1) {
      let row = '';
      for (let x = 0; x < this.world.size; x += 1) {
        const key = keyOf(x, y);
        const visible = this.visible.has(key);
        const mark = this.marks.get(key) || null;
        const char = this.charForCell(x, y, visible, mark);
        row += char;
        if (visible || mark) {
          cells.push({
            coord: [x, y],
            visible,
            terrain: visible ? this.visibleTerrain(x, y) : 'unknown',
            mark,
            observation: visible ? this.observe(x, y, 'known_map') : null,
          });
        }
      }
      rows.push(row);
    }
    return {
      size: this.world.size,
      legend: [
        { symbol: '?', meaning: 'unknown' },
        { symbol: '.', meaning: 'safe' },
        { symbol: '#', meaning: 'wall' },
        { symbol: '!', meaning: 'hazard' },
        { symbol: 'A', meaning: 'artifact' },
        { symbol: 'E', meaning: 'exit' },
        { symbol: '@', meaning: 'agent' },
        { symbol: 'h', meaning: 'marked_hazard' },
        { symbol: 's', meaning: 'marked_safe' },
        { symbol: 'a', meaning: 'marked_artifact' },
        { symbol: 'e', meaning: 'marked_entity' },
      ],
      rows,
      cells,
    };
  }

  charForCell(x, y, visible, mark) {
    if (this.position[0] === x && this.position[1] === y) return '@';
    if (!visible) {
      if (mark === 'hazard') return 'h';
      if (mark === 'safe') return 's';
      if (mark === 'artifact') return 'a';
      if (mark === 'entity') return 'e';
      return '?';
    }
    const terrain = this.visibleTerrain(x, y);
    if (terrain === 'wall') return '#';
    if (terrain === 'hazard') return '!';
    if (terrain === 'artifact') return 'A';
    if (terrain === 'exit') return 'E';
    return '.';
  }

  score() {
    return this.scoreBreakdown().total;
  }

  scoreBreakdown() {
    const success = this.terminal && this.terminal.status === 'success';
    const missionValue = success ? 300 : 0;
    const artifactValue = this.collected.size * 100;
    const mapCertainty = this.visible.size * 2 + this.countCorrectMarks() * 4;
    const ruleBonus = this.claimedRule && this.claimedRule.correct ? 120 : 0;
    const unusedEnergy = Math.max(0, this.energy);
    const integrityBonus = this.integrity * 40;
    const damagePenalty = this.penalties.damage * 120;
    const falseMarkPenalty = this.countFalseMarks() * 25;
    const invalidPenalty = this.penalties.invalid * 20;
    const wastedPenalty = this.penalties.wasted * 8;
    const total = Math.round(
      missionValue +
        artifactValue +
        mapCertainty +
        ruleBonus +
        unusedEnergy +
        integrityBonus -
        damagePenalty -
        falseMarkPenalty -
        invalidPenalty -
        wastedPenalty,
    );
    return {
      mission_value: missionValue,
      artifact_value: artifactValue,
      map_certainty_bonus: mapCertainty,
      rule_discovery_bonus: ruleBonus,
      unused_energy_bonus: unusedEnergy,
      integrity_bonus: integrityBonus,
      damage_penalty: -damagePenalty,
      false_mark_penalty: -falseMarkPenalty,
      invalid_action_penalty: -invalidPenalty,
      wasted_action_penalty: -wastedPenalty,
      total,
    };
  }

  metrics() {
    return {
      visible_cells: this.visible.size,
      marked_cells: this.marks.size,
      correct_marks: this.countCorrectMarks(),
      false_marks: this.countFalseMarks(),
      damage_events: this.penalties.damage,
      invalid_actions: this.penalties.invalid,
      wasted_actions: this.penalties.wasted,
    };
  }

  countCorrectMarks() {
    let correct = 0;
    for (const [key, mark] of this.marks) {
      const [x, y] = key.split(',').map(Number);
      if (markMatchesTerrain(mark, this.visibleTerrain(x, y))) correct += 1;
    }
    return correct;
  }

  countFalseMarks() {
    let falseMarks = 0;
    for (const [key, mark] of this.marks) {
      const [x, y] = key.split(',').map(Number);
      if (!markMatchesTerrain(mark, this.visibleTerrain(x, y))) falseMarks += 1;
    }
    return falseMarks;
  }

  answer() {
    return {
      hidden_rule: this.world.hiddenRule.id,
      hidden_rule_name: this.world.hiddenRule.name,
      row_disclosure: this.world.rowDisclosure,
      rows: allCells(this.world.size).reduce((acc, [x, y]) => {
        if (x === 0) acc.push('');
        const terrain = this.cellAt(x, y).terrain;
        acc[acc.length - 1] += terrainChar(terrain);
        return acc;
      }, []),
    };
  }
}

function parseAction(commandLine) {
  const line = String(commandLine || '').trim();
  if (!line) return { ok: false, type: 'invalid', message: 'Empty action.' };
  const parts = line.split(/\s+/);
  const verb = parts[0].toLowerCase();
  if (verb === 'move' && parts.length === 2) {
    return { ok: true, action: 'move', direction: parts[1].toUpperCase() };
  }
  if (verb === 'probe' && parts.length === 3) {
    return parseXY('probe', parts[1], parts[2]);
  }
  if (verb === 'scan' && parts.length === 3) {
    const kind = parts[1].toLowerCase();
    const raw = parts[2].toUpperCase();
    const value = kind === 'sector' ? raw : Number(parts[2]);
    return { ok: true, action: 'scan', kind, value };
  }
  if (verb === 'mark' && parts.length === 4) {
    const parsed = parseXY('mark', parts[1], parts[2]);
    if (!parsed.ok) return parsed;
    const mark = parts[3].toLowerCase();
    if (!['hazard', 'safe', 'artifact', 'entity'].includes(mark)) {
      return { ok: false, type: 'invalid', message: `Unsupported mark: ${mark}` };
    }
    return { ...parsed, mark };
  }
  if (verb === 'wait' && parts.length === 1) return { ok: true, action: 'wait' };
  if (verb === 'extract' && parts.length === 1) return { ok: true, action: 'extract' };
  if (verb === 'claim_rule' && parts.length === 2) return { ok: true, action: 'claim_rule', ruleId: parts[1] };
  return {
    ok: false,
    type: 'invalid',
    message: `Could not parse action: ${line}`,
  };
}

function parseXY(action, rawX, rawY) {
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      ok: false,
      type: 'invalid',
      message: `${action} coordinates must be integers.`,
    };
  }
  return { ok: true, action, x, y };
}

function scanCells(size, kind, value) {
  if (kind === 'row') return allCells(size).filter(([, y]) => y === value);
  if (kind === 'col') return allCells(size).filter(([x]) => x === value);
  return cellsInSector(size, value);
}

function countCells(world, cells) {
  let hazards = 0;
  let walls = 0;
  let artifacts = 0;
  let unstableEcho = 0;
  for (const [x, y] of cells) {
    const terrain = world.grid[y][x].terrain;
    if (terrain === 'hazard') hazards += 1;
    if (terrain === 'wall') walls += 1;
    if (terrain === 'artifact') artifacts += 1;
    if (echoAt(world, x, y) === 'unstable') unstableEcho += 1;
  }
  return { hazards, walls, artifacts, unstableEcho };
}

function heatAt(world, collected, x, y) {
  let minDistance = Infinity;
  for (const [ax, ay] of allCells(world.size)) {
    if (world.grid[ay][ax].terrain !== 'artifact') continue;
    if (collected.has(keyOf(ax, ay))) continue;
    minDistance = Math.min(minDistance, manhattan([x, y], [ax, ay]));
  }
  if (minDistance <= 1) return 'high';
  if (minDistance <= 3) return 'low';
  return 'none';
}

function echoAt(world, x, y) {
  if (world.hiddenRule.id === 'sector_c_two_unstable' && sectorOf(x, y) === 'C') {
    return world.unstableEchoCells.has(keyOf(x, y)) ? 'unstable' : 'stable';
  }
  const adjacentHazards = neighbors8(world.size, x, y).filter(([nx, ny]) => world.grid[ny][nx].terrain === 'hazard').length;
  let unstable = adjacentHazards >= 2;
  if (world.hiddenRule.id === 'wall_echo_inversion' && isNearWall(world.size, world.grid, x, y)) {
    unstable = !unstable;
  }
  return unstable ? 'unstable' : 'stable';
}

function traceAt(world, collected, from) {
  let target = null;
  let best = Infinity;
  for (const [x, y] of allCells(world.size)) {
    if (world.grid[y][x].terrain !== 'artifact') continue;
    if (collected.has(keyOf(x, y))) continue;
    const distance = manhattan(from, [x, y]);
    if (distance < best) {
      best = distance;
      target = [x, y];
    }
  }
  if (!target) target = world.exit;
  const dx = target[0] - from[0];
  const dy = target[1] - from[1];
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east-biased' : 'west-biased';
  if (dy !== 0) return dy > 0 ? 'south-biased' : 'north-biased';
  return 'local';
}

function band(count) {
  if (count <= 0) return 'none';
  if (count === 1) return 'low';
  return 'high';
}

function actionPriority(action) {
  if (action === 'extract') return 0;
  if (action.startsWith('move ')) return 1;
  if (action.startsWith('probe ')) return 2;
  if (action.startsWith('scan ')) return 3;
  if (action.startsWith('claim_rule ')) return 4;
  if (action === 'wait') return 6;
  return 5;
}

function nonExitExplorationPriority(action) {
  if (action.startsWith('probe ')) return 0;
  if (action.startsWith('move ')) return 1;
  return actionPriority(action);
}

function traceAxis(trace) {
  if (trace === 'east-biased' || trace === 'west-biased') return 'x';
  if (trace === 'north-biased' || trace === 'south-biased') return 'y';
  return null;
}

function dominantAxis(from, to) {
  return Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]) ? 'x' : 'y';
}

function repeatPenaltyFor(action, avoidRepeating = []) {
  return avoidRepeating.includes(action) ? 1 : 0;
}

function actionTarget(action, position) {
  const move = action.match(/^move ([NSEW])$/);
  if (move) {
    const delta = DIRECTIONS[move[1]];
    return [position[0] + delta[0], position[1] + delta[1]];
  }
  const probe = action.match(/^probe (\d+) (\d+)$/);
  if (probe) return [Number(probe[1]), Number(probe[2])];
  return null;
}

function adjacentMoveActions(position) {
  return Object.entries(DIRECTIONS).map(([direction, [dx, dy]]) => ({
    action: `move ${direction}`,
    target: [position[0] + dx, position[1] + dy],
  }));
}

function sameCoord(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function passablePublicCell(cell) {
  return ['empty', 'artifact', 'exit'].includes(cell.terrain);
}

function actionFromPathOrFrontier(position, path) {
  if (!path || path.length < 2) return null;
  return moveFromTo(position, path[1]);
}

function frontierRouteScore(path, probe, goal, avoidTargets = new Set(), options = {}) {
  if (!path?.length) return Number.POSITIVE_INFINITY;
  const firstStep = path[1];
  const avoidPenalty = firstStep && avoidTargets.has(keyOf(firstStep[0], firstStep[1])) ? 0.5 : 0;
  const adjacentBonus = options.preferAdjacentProbe && path.length <= 1 ? -20 : 0;
  return manhattan(probe, goal) * 4 + path.length + avoidPenalty + adjacentBonus;
}

function rebuildPublicPath(end, parent) {
  const result = [end];
  let cursor = keyOf(end[0], end[1]);
  while (parent.has(cursor)) {
    cursor = parent.get(cursor);
    result.push(cursor.split(',').map(Number));
  }
  return result.reverse();
}

function traceGoal(size, position, trace, fallback) {
  const [x, y] = position;
  if (trace === 'east-biased') return [Math.min(size - 1, x + 3), y];
  if (trace === 'west-biased') return [Math.max(0, x - 3), y];
  if (trace === 'south-biased') return [x, Math.min(size - 1, y + 3)];
  if (trace === 'north-biased') return [x, Math.max(0, y - 3)];
  return fallback;
}

function markMatchesTerrain(mark, terrain) {
  if (mark === 'safe') return terrain === 'empty' || terrain === 'exit';
  if (mark === 'hazard') return terrain === 'hazard';
  if (mark === 'artifact') return terrain === 'artifact';
  return false;
}

function moveFromTo(from, to) {
  if (to[0] > from[0]) return 'move E';
  if (to[0] < from[0]) return 'move W';
  if (to[1] > from[1]) return 'move S';
  return 'move N';
}

function terrainChar(terrain) {
  if (terrain === 'wall') return '#';
  if (terrain === 'hazard') return '!';
  if (terrain === 'artifact') return 'A';
  if (terrain === 'exit') return 'E';
  return '.';
}

module.exports = {
  EchoGridGame,
  parseAction,
};
