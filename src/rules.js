'use strict';

const HIDDEN_RULES = [
  {
    id: 'artifact_suppression',
    name: 'Artifacts suppress adjacent hazards',
    publicHint: 'Artifact-adjacent sectors may read safer than raw density suggests.',
  },
  {
    id: 'wall_echo_inversion',
    name: 'Echo readings invert near walls',
    publicHint: 'Echo near wall boundaries can disagree with open-space readings.',
  },
  {
    id: 'exit_radius_safe',
    name: 'Exit radius one is guaranteed safe',
    publicHint: 'Exit-adjacent cells are unusually quiet in multiple probes.',
  },
  {
    id: 'sector_c_two_unstable',
    name: 'Sector C contains exactly two unstable cells',
    publicHint: 'Sector C echo totals are more structured than random noise.',
  },
  {
    id: 'row_count_disclosure',
    name: 'One row discloses fixed hazard count through row scan',
    publicHint: 'A row scan may expose a stronger global count than usual.',
  },
];

function selectHiddenRule(rng) {
  return HIDDEN_RULES[rng.int(HIDDEN_RULES.length)];
}

function isKnownRule(ruleId) {
  return HIDDEN_RULES.some((rule) => rule.id === ruleId);
}

module.exports = {
  HIDDEN_RULES,
  isKnownRule,
  selectHiddenRule,
};
