#!/usr/bin/env node
'use strict';

const recover = process.env.ECHOGRID_LLM_RECOVER_REASONING_ACTION === '1';

if (recover) {
  process.stderr.write(`ECHOGRID_AGENT_DIAG ${JSON.stringify({
    model: 'fake-empty-final',
    fallback_mode: 'none',
    local_policy_enabled: false,
    recover_reasoning_action: true,
    fallback: false,
    action: 'wait',
    recovered_from_reasoning: true,
    finish_reason: 'length',
    empty_final_content: true,
  })}\n`);
  console.log('wait');
  process.exit(0);
}

process.stderr.write(`ECHOGRID_AGENT_DIAG ${JSON.stringify({
  model: 'fake-empty-final',
  fallback_mode: 'none',
  local_policy_enabled: false,
  recover_reasoning_action: false,
  fallback: false,
  model_error: true,
  abort_evaluation: true,
  abort_reason: 'model_empty_model_action',
  reason: 'empty_model_action',
  finish_reason: 'length',
  reasoning_preview: 'The best action is wait.',
})}\n`);
console.log('__model_unavailable__ empty_model_action');
