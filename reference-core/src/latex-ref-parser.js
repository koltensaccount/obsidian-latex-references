'use strict';

/**
 * Balanced-brace parser for LaTeX \gardenref{id}{display-text} commands.
 * Designed for accurate CodeMirror range detection, click targeting, and safe unlinking.
 */

function isEscapedAt(text, index) {
  let backslashes = 0;
  let k = index - 1;
  while (k >= 0 && text[k] === '\\') {
    backslashes++;
    k--;
  }
  return (backslashes % 2) === 1;
}

function skipLineComment(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl === -1 ? text.length : nl;
}

function skipWhitespaceAndComments(text, pos) {
  let i = pos;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
    } else if (ch === '%') {
      i = skipLineComment(text, i);
    } else {
      break;
    }
  }
  return i;
}

function readBalancedBraceGroup(text, openBracePos) {
  if (openBracePos >= text.length || text[openBracePos] !== '{') {
    return null;
  }

  let depth = 1;
  let i = openBracePos + 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '%') {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          from: openBracePos,
          to: i + 1,
          innerFrom: openBracePos + 1,
          innerTo: i,
          inner: text.slice(openBracePos + 1, i)
        };
      }
      i++;
      continue;
    }
    i++;
  }

  return null;
}

/**
 * Parses all well-formed \gardenref{id}{display-text} commands in a LaTeX buffer.
 * Handles nested braces, math delimiters, escaped characters (\{, \}, \%, \\),
 * multiline arguments, and ignores commented-out or escaped occurrences.
 *
 * @param {string} text
 * @param {string} [macroName='gardenref']
 * @returns {Array<{
 *   id: string,
 *   rawId: string,
 *   displayText: string,
 *   from: number,
 *   to: number,
 *   idFrom: number,
 *   idTo: number,
 *   idInnerFrom: number,
 *   idInnerTo: number,
 *   textFrom: number,
 *   textTo: number,
 *   textInnerFrom: number,
 *   textInnerTo: number,
 *   raw: string
 * }>}
 */
function parseLatexReferences(text, macroName = 'gardenref') {
  if (typeof text !== 'string' || !text.length) {
    return [];
  }

  const macro = `\\${macroName}`;
  if (!text.includes(macro)) {
    return [];
  }

  const refs = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Skip top-level unescaped TeX line comments
    if (ch === '%' && !isEscapedAt(text, i)) {
      i = skipLineComment(text, i) + 1;
      continue;
    }

    if (ch === '\\' && text.startsWith(macro, i) && !isEscapedAt(text, i)) {
      const afterMacro = i + macro.length;
      const nextChar = afterMacro < text.length ? text[afterMacro] : '';

      // Avoid prefix collisions like \gardenrefs or \gardenrefextra
      if (/[a-zA-Z@]/.test(nextChar)) {
        i = afterMacro;
        continue;
      }

      const arg1Start = skipWhitespaceAndComments(text, afterMacro);
      const arg1 = readBalancedBraceGroup(text, arg1Start);
      if (!arg1) {
        i = afterMacro;
        continue;
      }

      const rawId = arg1.inner;
      const id = rawId.trim();
      if (!id || /[\s{}\\]/.test(id)) {
        i = afterMacro;
        continue;
      }

      const arg2Start = skipWhitespaceAndComments(text, arg1.to);
      const arg2 = readBalancedBraceGroup(text, arg2Start);
      if (!arg2) {
        i = afterMacro;
        continue;
      }

      refs.push({
        id,
        rawId,
        displayText: arg2.inner,
        from: i,
        to: arg2.to,
        idFrom: arg1.from,
        idTo: arg1.to,
        idInnerFrom: arg1.innerFrom,
        idInnerTo: arg1.innerTo,
        textFrom: arg2.from,
        textTo: arg2.to,
        textInnerFrom: arg2.innerFrom,
        textInnerTo: arg2.innerTo,
        raw: text.slice(i, arg2.to)
      });

      i = arg2.to;
      continue;
    }

    i++;
  }

  return refs;
}

/**
 * Finds the parsed reference containing character offset `pos`.
 *
 * @param {string|Array} textOrParsed
 * @param {number} pos
 * @param {boolean} [inclusiveEnd=true]
 */
function findLatexReferenceAtPosition(textOrParsed, pos, inclusiveEnd = true) {
  if (typeof pos !== 'number' || Number.isNaN(pos)) return null;
  const refs = Array.isArray(textOrParsed) ? textOrParsed : parseLatexReferences(textOrParsed);
  for (const ref of refs) {
    if (pos >= ref.from && (inclusiveEnd ? pos <= ref.to : pos < ref.to)) {
      return ref;
    }
    if (ref.from > pos) break;
  }
  return null;
}

/**
 * Resolves a reference strictly enclosing a selection `[from, to]` or cursor (`from === to`).
 *
 * @param {string|Array} textOrParsed
 * @param {number} from
 * @param {number} to
 */
function findLatexReferenceForSelection(textOrParsed, from, to) {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) {
    return findLatexReferenceAtPosition(textOrParsed, start, true);
  }
  const refs = Array.isArray(textOrParsed) ? textOrParsed : parseLatexReferences(textOrParsed);
  for (const ref of refs) {
    if (start >= ref.from && end <= ref.to) {
      return ref;
    }
    if (ref.from > start) break;
  }
  return null;
}

module.exports = {
  readBalancedBraceGroup,
  parseLatexReferences,
  findLatexReferenceAtPosition,
  findLatexReferenceForSelection
};
