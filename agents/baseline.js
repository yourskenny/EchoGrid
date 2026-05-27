#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { decideAction } = require('./baseline-policy');

const input = fs.readFileSync(0, 'utf8').trim();
const state = JSON.parse(input || '{}');

console.log(decideAction(state));
