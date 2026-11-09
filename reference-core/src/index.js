'use strict';

const scanner = require('./scanner');
const identity = require('./identity');
const manifest = require('./manifest');
const diagnostics = require('./diagnostics');

module.exports = {
  ...scanner,
  ...identity,
  ...manifest,
  ...diagnostics
};
