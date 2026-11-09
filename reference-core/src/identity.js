'use strict';

const { TYPES, scanEnvironments } = require('./scanner');

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics (é -> e)
    .toLowerCase()
    .replace(/\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)/g, match => match.slice(1))
    .replace(/\\[a-zA-Z]+/g, '') // remove remaining tex commands
    .replace(/[$_^{}\\]/g, '') // remove math syntax
    .replace(/[^a-z0-9]+/g, '-') // collapse non-alphanumeric to hyphen
    .replace(/^-+|-+$/g, '') // trim hyphens
    .slice(0, 50); // reasonable length
}

function generateCandidateId(target) {
  const prefix = TYPES.get(target.type.toLowerCase()) || 'ref';
  const baseSlug = slugify(target.rawTitle || target.title);
  if (!baseSlug) {
    return `${prefix}-env`;
  }
  return `${prefix}-${baseSlug}`;
}

function uniqueId(target, text, reservedIds = []) {
  const candidate = generateCandidateId(target);
  const reserved = new Set((reservedIds || []).filter(Boolean));

  // Check against block IDs in the current text
  const inText = /\^([a-zA-Z0-9-]+)/g;
  let match;
  while ((match = inText.exec(text)) !== null) {
    reserved.add(match[1]);
  }

  if (!reserved.has(candidate)) {
    return candidate;
  }

  let counter = 2;
  while (reserved.has(`${candidate}-${counter}`)) {
    counter++;
  }
  return `${candidate}-${counter}`;
}

function findSameEnvironment(text, original) {
  const scanned = scanEnvironments(text, original.filePath || '');
  if (!scanned.length) {
    throw new Error('No mathematical callouts found in document.');
  }

  // 1. Match by existing ID
  if (original.id) {
    const byId = scanned.find(e => e.id === original.id);
    if (byId) return byId;
  }

  // 2. Match by exact range
  const byRange = scanned.find(e => e.start === original.start && e.end === original.end);
  if (byRange) return byRange;

  // 3. Match by type and title
  const byTypeTitle = scanned.filter(e => e.type === original.type && e.title === original.title);
  if (byTypeTitle.length === 1) return byTypeTitle[0];

  // 4. Closest start offset
  let best = scanned[0];
  let minDiff = Math.abs(best.start - original.start);
  for (let i = 1; i < scanned.length; i++) {
    const diff = Math.abs(scanned[i].start - original.start);
    if (diff < minDiff) {
      minDiff = diff;
      best = scanned[i];
    }
  }
  return best;
}

function ensureBlockId(text, original, reservedIds = []) {
  const current = findSameEnvironment(text, original);
  if (current.id) {
    return {
      text,
      id: current.id,
      insertionOffset: null,
      insertion: '',
      target: current
    };
  }

  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const id = uniqueId(current, text, reservedIds);
  const atLineEnd = current.end > 0 && (text[current.end - 1] === '\n' || text[current.end - 1] === '\r');
  const suffix = text.slice(current.end);
  const insertion = (atLineEnd ? '' : newline) + newline + `^${id}` + newline + (suffix && !suffix.startsWith(newline) ? newline : '');

  const newText = text.slice(0, current.end) + insertion + suffix;
  return {
    text: newText,
    id,
    insertionOffset: current.end,
    insertion,
    target: { ...current, id, end: current.end + insertion.length }
  };
}

function buildLatexRefCommand(id, selectedText, macroName = 'gardenref') {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new Error(`Invalid reference ID: "${id}"`);
  }
  const text = (selectedText !== undefined && selectedText !== null) ? selectedText : id;
  return `\\${macroName}{${id}}{${text}}`;
}

module.exports = {
  slugify,
  generateCandidateId,
  uniqueId,
  findSameEnvironment,
  ensureBlockId,
  buildLatexRefCommand
};
