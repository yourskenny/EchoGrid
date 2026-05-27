#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { decideAction } = require('./baseline-policy');

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  try {
    const state = JSON.parse(text);
    console.log(decideAction(state));
  } catch (error) {
    process.stderr.write(`ECHOGRID_AGENT_DIAG ${JSON.stringify({ error: error.message, fallback: true })}\n`);
    console.log('wait');
  }
});
