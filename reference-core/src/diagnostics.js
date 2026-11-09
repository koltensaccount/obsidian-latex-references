'use strict';

const FILE_LINE_ERROR = /^(.+?\.tex):(\d+):\s*(.+)$/;
const WARNING = /(?:LaTeX|Package .+?) Warning:\s*(.+?)(?:\s+on input line (\d+))?\.?$/;

function parseDiagnostics(log) {
  const diagnostics = [];
  const seen = new Set();

  for (const rawLine of (log || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const error = line.match(FILE_LINE_ERROR);
    if (error) {
      pushUnique(diagnostics, seen, {
        file: error[1],
        line: Number(error[2]),
        severity: 'error',
        message: error[3].replace(/^!\s*/, '')
      });
      continue;
    }

    const warning = line.match(WARNING);
    if (warning) {
      pushUnique(diagnostics, seen, {
        file: '',
        line: warning[2] ? Number(warning[2]) : null,
        severity: 'warning',
        message: warning[1]
      });
    }
  }

  return diagnostics;
}

function pushUnique(target, seen, diagnostic) {
  const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.severity}:${diagnostic.message}`;
  if (!seen.has(key)) {
    seen.add(key);
    target.push(diagnostic);
  }
}

module.exports = {
  parseDiagnostics
};
