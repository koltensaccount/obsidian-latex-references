'use strict';

const scanner = require('./scanner');
const identity = require('./identity');
const manifest = require('./manifest');
const diagnostics = require('./diagnostics');
const latexRefParser = require('./latex-ref-parser');

module.exports = {
  ...scanner,
  ...identity,
  ...manifest,
  ...diagnostics,
  ...latexRefParser
};
