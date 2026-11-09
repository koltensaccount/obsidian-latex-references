'use strict';

const TYPES = new Map([
  ['definition', 'def'],
  ['formula', 'formula'],
  ['theorem', 'thm'],
  ['proposition', 'prop'],
  ['lemma', 'lem'],
  ['corollary', 'cor'],
  ['remark', 'rem'],
  ['axiom', 'ax'],
  ['conjecture', 'conj'],
  ['notation', 'not'],
]);

const HEADER = /^[ \t]*>[ \t]*\[!([a-zA-Z][\w-]*)\]([+-])?(?:[ \t]+(.*?))?[ \t]*\r?$/;
const QUOTED_LINE = /^[ \t]*>/;
const QUOTED_ID = /^[ \t]*(?:>[ \t]*)+\^([a-zA-Z0-9-]+)[ \t]*\r?$/;
const BLOCK_ID = /^\^([a-zA-Z0-9-]+)\r?$/;
const INLINE_BLOCK_ID = /(?:^|\s)\^([a-zA-Z0-9-]+)[ \t]*\r?$/;

function linesWithOffsets(text) {
  const strings = text.split('\n');
  let offset = 0;
  return strings.map((raw, index) => {
    const line = { raw, start: offset, end: offset + raw.length + (index < strings.length - 1 ? 1 : 0) };
    offset = line.end;
    return line;
  });
}

function parseCalloutHeader(line) {
  const match = HEADER.exec(line);
  if (!match) return null;
  const rawType = match[1];
  const type = rawType.toLowerCase();
  if (!TYPES.has(type)) return null;
  const fold = match[2] || null;
  const rawTitle = (match[3] || '').trim();
  const title = rawTitle || type.charAt(0).toUpperCase() + type.slice(1);
  return { type, rawType, fold, title, rawTitle };
}

function unquoteCalloutBody(lines) {
  return lines.map(line => {
    return line.replace(/^[ \t]*>[ \t]?/, '');
  }).join('\n');
}

/**
 * Scans markdown text and finds all mathematical callouts.
 * @param {string} text - Note contents.
 * @param {string} filePath - Path of note.
 * @returns {Array<object>} Found environments.
 */
function scanEnvironments(text, filePath = '') {
  const lines = linesWithOffsets(text);
  const environments = [];
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const codeFence = /^[ \t]{0,3}(`{3,}|~{3,})(?:.*)$/.exec(lines[i].raw);
    if (fence) {
      if (codeFence && codeFence[1][0] === fence[0] && codeFence[1].length >= fence.length &&
          /^[ \t]*$/.test(lines[i].raw.slice(lines[i].raw.indexOf(codeFence[1]) + codeFence[1].length))) {
        fence = null;
      }
      continue;
    }
    if (codeFence) {
      fence = codeFence[1];
      continue;
    }

    const header = parseCalloutHeader(lines[i].raw);
    if (!header) continue;

    const startLine = i;
    let last = i;
    while (last + 1 < lines.length && QUOTED_LINE.test(lines[last + 1].raw)) {
      if (HEADER.test(lines[last + 1].raw)) {
        break;
      }
      last++;
    }

    const start = lines[startLine].start;
    const end = lines[last].end;

    let detectedId = null;
    let idQuotedLine = false;
    let externalId = false;
    let externalLineIndex = -1;
    const lastQuotedRaw = lines[last].raw.trim();

    // 1. Quoted or inline block ID inside callout
    const inlineMatch = INLINE_BLOCK_ID.exec(lastQuotedRaw);
    if (inlineMatch) {
      detectedId = inlineMatch[1];
      if (QUOTED_ID.test(lines[last].raw)) {
        idQuotedLine = true;
      }
    }

    // 2. Trailing block ID on standalone line (adjacent or after empty lines)
    if (!detectedId) {
      let j = last + 1;
      while (j < lines.length && j <= last + 3 && lines[j].raw.trim() === '') j++;
      if (j < lines.length && j <= last + 4) {
        const blockMatch = BLOCK_ID.exec(lines[j].raw.trim());
        if (blockMatch) {
          detectedId = blockMatch[1];
          externalId = true;
          externalLineIndex = j;
        }
      }
    }

    const endLineForBody = idQuotedLine ? last : last + 1;
    const bodyLines = lines.slice(startLine + 1, endLineForBody).map(l => l.raw);
    let body = unquoteCalloutBody(bodyLines);

    if (detectedId && !externalId) {
      body = body.replace(new RegExp(`(?:\\r?\\n)?(?:>[ \\t]*)?\\^${detectedId}[ \\t]*$`), '').trimEnd();
    }

    const envEnd = externalId ? lines[externalLineIndex].end : end;

    environments.push({
      type: header.type,
      rawType: header.rawType,
      title: header.title,
      rawTitle: header.rawTitle,
      fold: header.fold,
      id: detectedId,
      body,
      filePath,
      start,
      end: envEnd,
      calloutEnd: end,
      idQuotedLine,
      externalId,
      raw: text.slice(start, envEnd)
    });

    if (externalId) {
      i = externalLineIndex;
    } else {
      i = last;
    }
  }

  return environments;
}

module.exports = {
  TYPES,
  HEADER,
  parseCalloutHeader,
  unquoteCalloutBody,
  scanEnvironments,
  linesWithOffsets
};
