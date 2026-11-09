'use strict';

const crypto = require('crypto');

const REFERENCE_STATUS = Object.freeze({
  UNAPPROVED: 'unapproved',
  APPROVED_LOCAL: 'approved_local',
  AWAITING_DEPLOY: 'awaiting_deploy',
  PUBLISHED: 'published',
  DEPLOY_FAILED: 'deploy_failed'
});

function computeHash(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex').slice(0, 16);
}

function createEmptyManifest(baseUrl = 'https://obsidian.koltensserver.com') {
  return {
    version: 1,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    updatedAt: new Date().toISOString(),
    references: {}
  };
}

function normalizeUrl(baseUrl, id) {
  const cleanBase = (baseUrl || 'https://obsidian.koltensserver.com').replace(/\/+$/, '');
  return `${cleanBase}/latex-references/${id}/`;
}

function approveSnapshot(manifest, item, options = {}) {
  const currentManifest = manifest || createEmptyManifest();
  const id = item.id;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new Error(`Cannot approve item without a valid stable ID: "${id}"`);
  }

  const existing = currentManifest.references ? currentManifest.references[id] : null;
  const currentSourceFile = item.filePath || item.sourceFile || '';
  const currentTitle = item.title || '';
  const body = item.body || '';
  const hash = computeHash(`${item.type}|${currentTitle}|${body}`);

  // Collision detection:
  // If an entry with this ID already exists, prevent two different mathematical definitions from silently overwriting each other
  if (existing) {
    const isSameFile = existing.sourceFile === currentSourceFile;
    const isSameTitle = existing.title === currentTitle;
    const isSameHash = existing.contentHash === hash;

    // Different file, different title, and different hash -> clear conflict
    if (!isSameFile && !isSameTitle && !isSameHash) {
      if (!options.allowOverwrite) {
        throw new Error(
          `Reference ID collision: "${id}" is already published for "${existing.title}" in "${existing.sourceFile}". ` +
          `Cannot overwrite with "${currentTitle}" from "${currentSourceFile}". Use a distinct block ID or resolve the duplicate.`
        );
      }
    }
  }

  const baseUrl = options.baseUrl || currentManifest.baseUrl;
  const url = normalizeUrl(baseUrl, id);

  const snapshot = {
    id,
    type: item.type,
    title: currentTitle,
    body: body.trim(),
    sourceFile: currentSourceFile,
    approvedAt: existing?.approvedAt || options.approvedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url,
    contentHash: hash,
    status: options.status || existing?.status || REFERENCE_STATUS.APPROVED_LOCAL,
    publishedAt: existing?.publishedAt || options.publishedAt || null,
    lastVerifiedAt: existing?.lastVerifiedAt || null,
    verificationError: null
  };

  const updated = {
    ...currentManifest,
    updatedAt: new Date().toISOString(),
    references: {
      ...currentManifest.references,
      [id]: snapshot
    }
  };

  return { manifest: updated, snapshot };
}

function updateReferenceStatus(manifest, id, status, details = {}) {
  if (!manifest || !manifest.references || !manifest.references[id]) {
    throw new Error(`Reference "${id}" not found in manifest.`);
  }

  const current = manifest.references[id];
  const updatedSnapshot = {
    ...current,
    status,
    lastVerifiedAt: details.lastVerifiedAt || new Date().toISOString(),
    publishedAt: status === REFERENCE_STATUS.PUBLISHED ? (details.publishedAt || new Date().toISOString()) : current.publishedAt,
    verificationError: details.verificationError !== undefined ? details.verificationError : current.verificationError
  };

  const updated = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    references: {
      ...manifest.references,
      [id]: updatedSnapshot
    }
  };

  return { manifest: updated, snapshot: updatedSnapshot };
}

function unpublishSnapshot(manifest, id) {
  if (!manifest || !manifest.references || !manifest.references[id]) {
    return { manifest, removed: false };
  }
  const nextReferences = { ...manifest.references };
  delete nextReferences[id];

  const updated = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    references: nextReferences
  };
  return { manifest: updated, removed: true };
}

function isApproved(manifest, id) {
  if (!manifest || !manifest.references) return false;
  return Boolean(manifest.references[id]);
}

function getSnapshot(manifest, id) {
  if (!manifest || !manifest.references) return null;
  return manifest.references[id] || null;
}

function detectDrift(snapshot, currentCallout) {
  if (!snapshot || !currentCallout) return false;
  const currentHash = computeHash(`${currentCallout.type}|${currentCallout.title}|${(currentCallout.body || '').trim()}`);
  return snapshot.contentHash !== currentHash;
}

/**
 * Checks whether a reference URL is publicly reachable and returning the approved content.
 * @param {string} url - The full public URL.
 * @param {string} [expectedTitle] - Optional title snippet to verify in the response body.
 * @param {number} [timeoutMs] - Request timeout.
 * @returns {Promise<{ ok: boolean, status: number, error?: string }>}
 */
async function verifyLiveReference(url, expectedTitle, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Obsidian-LaTeX-References-Verifier/1.0' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const text = await res.text();
    if (expectedTitle && !text.includes(expectedTitle)) {
      return { ok: false, status: res.status, error: `Page returned HTTP 200 but did not contain expected content: "${expectedTitle}"` };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generates TeX macro definitions for offline/standalone compilation.
 * @param {object} manifest - Manifest object.
 * @returns {string} TeX definitions.
 */
function exportGardenrefsTex(manifest) {
  const refs = (manifest && manifest.references) ? Object.values(manifest.references) : [];
  refs.sort((a, b) => a.id.localeCompare(b.id));

  const lines = [
    '% ====================================================================',
    '% Autogenerated by obsidian-latex-references. Do not edit manually.',
    `% Updated: ${(manifest && manifest.updatedAt) || new Date().toISOString()}`,
    '% ====================================================================',
    ''
  ];

  for (const ref of refs) {
    lines.push(`\\declaregardenref{${ref.id}}{${ref.url}}`);
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  REFERENCE_STATUS,
  computeHash,
  createEmptyManifest,
  normalizeUrl,
  approveSnapshot,
  updateReferenceStatus,
  unpublishSnapshot,
  isApproved,
  getSnapshot,
  detectDrift,
  verifyLiveReference,
  exportGardenrefsTex
};
