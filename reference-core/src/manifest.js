'use strict';

const crypto = require('crypto');

const REFERENCE_STATUS = Object.freeze({
  UNAPPROVED: 'unapproved',
  APPROVED_LOCAL: 'approved_local',
  AWAITING_DEPLOY: 'awaiting_deploy',
  PUBLISHED: 'published',
  DEPLOY_FAILED: 'deploy_failed'
});

const STATUS_LABELS = Object.freeze({
  [REFERENCE_STATUS.UNAPPROVED]: 'Unpublished',
  [REFERENCE_STATUS.APPROVED_LOCAL]: 'Approved locally',
  [REFERENCE_STATUS.AWAITING_DEPLOY]: 'Deploying',
  [REFERENCE_STATUS.PUBLISHED]: 'Published',
  [REFERENCE_STATUS.DEPLOY_FAILED]: 'Failed'
});

function getStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS[REFERENCE_STATUS.UNAPPROVED];
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const hash = computeHash(`${item.type}|${currentTitle}|${body.trim()}`);

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
          `Reference ID collision: "${id}" is already registered for "${existing.title}" in "${existing.sourceFile}". ` +
          `Cannot overwrite with "${currentTitle}" from "${currentSourceFile}". Use a distinct block ID or resolve the duplicate.`
        );
      }
    }
  }

  const baseUrl = options.baseUrl || currentManifest.baseUrl;
  const url = normalizeUrl(baseUrl, id);
  const nextStatus = options.status || REFERENCE_STATUS.APPROVED_LOCAL;

  let verifiedContentHash = existing?.verifiedContentHash || null;
  if (!verifiedContentHash && existing?.status === REFERENCE_STATUS.PUBLISHED) {
    verifiedContentHash = existing.contentHash;
  }
  if (nextStatus === REFERENCE_STATUS.PUBLISHED) {
    verifiedContentHash = hash;
  }

  const liveUrlReachable =
    nextStatus === REFERENCE_STATUS.PUBLISHED
      ? true
      : existing?.status === REFERENCE_STATUS.PUBLISHED
        ? true
        : (existing?.liveUrlReachable ?? Boolean(existing?.publishedAt));

  const publishedAt =
    nextStatus === REFERENCE_STATUS.PUBLISHED
      ? (options.publishedAt || existing?.publishedAt || new Date().toISOString())
      : (existing?.publishedAt || options.publishedAt || null);

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
    verifiedContentHash,
    status: nextStatus,
    publishedAt,
    liveUrlReachable,
    lastVerifiedAt: nextStatus === REFERENCE_STATUS.PUBLISHED ? new Date().toISOString() : (existing?.lastVerifiedAt || null),
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
  const now = new Date().toISOString();

  let publishedAt = current.publishedAt || null;
  let verifiedContentHash = current.verifiedContentHash || null;
  let liveUrlReachable = current.liveUrlReachable;
  let verificationError = details.verificationError !== undefined ? details.verificationError : current.verificationError;

  if (status === REFERENCE_STATUS.PUBLISHED) {
    publishedAt = details.publishedAt || publishedAt || now;
    verifiedContentHash = details.verifiedContentHash || current.contentHash;
    liveUrlReachable = true;
    verificationError = details.verificationError !== undefined ? details.verificationError : null;
  } else if (status === REFERENCE_STATUS.DEPLOY_FAILED) {
    if (details.liveUrlReachable !== undefined) {
      liveUrlReachable = details.liveUrlReachable;
    } else if (!publishedAt || details.httpStatus === 404 || (details.httpStatus && details.httpStatus >= 500) || details.kind === 'not_found' || details.kind === 'content_mismatch') {
      liveUrlReachable = false;
    }
  } else if (status === REFERENCE_STATUS.AWAITING_DEPLOY) {
    if (details.verificationError !== undefined) {
      verificationError = details.verificationError;
    } else {
      verificationError = null;
    }
  }

  const updatedSnapshot = {
    ...current,
    status,
    lastVerifiedAt: details.lastVerifiedAt || now,
    publishedAt,
    verifiedContentHash,
    liveUrlReachable,
    verificationError
  };

  const updated = {
    ...manifest,
    updatedAt: now,
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

function getSnapshot(manifest, id) {
  if (!manifest || !manifest.references || !id) return null;
  return manifest.references[id] || null;
}

function getReferenceStatus(manifest, id) {
  const snapshot = getSnapshot(manifest, id);
  if (!snapshot) return REFERENCE_STATUS.UNAPPROVED;

  const rawStatus = snapshot.status;
  if (!rawStatus || !Object.values(REFERENCE_STATUS).includes(rawStatus)) {
    return REFERENCE_STATUS.APPROVED_LOCAL;
  }

  if (rawStatus === REFERENCE_STATUS.PUBLISHED) {
    if (snapshot.verifiedContentHash && snapshot.contentHash && snapshot.verifiedContentHash !== snapshot.contentHash) {
      return REFERENCE_STATUS.APPROVED_LOCAL;
    }
  }

  return rawStatus;
}

function isApproved(manifest, id) {
  return Boolean(getSnapshot(manifest, id));
}

function isPublished(manifest, id) {
  return getReferenceStatus(manifest, id) === REFERENCE_STATUS.PUBLISHED;
}

function detectDrift(snapshot, currentCallout) {
  if (!snapshot || !currentCallout) return false;
  const currentHash = computeHash(`${currentCallout.type}|${currentCallout.title}|${(currentCallout.body || '').trim()}`);
  return snapshot.contentHash !== currentHash;
}

/**
 * Determines whether a snapshot has a verified-live destination safe to emit as a PDF hyperlink.
 * Newly approved or unverified references return false so compiled PDFs never contain dead 404 links.
 * Previously verified references remain true (preserving offline compilation & pending edits)
 * unless a server verification check found the URL missing/broken (liveUrlReachable === false).
 */
function canRenderLiveLink(snapshot) {
  if (!snapshot || !snapshot.id || !snapshot.url) return false;
  if (snapshot.liveUrlReachable === false) return false;

  const status = snapshot.status;
  if (status === REFERENCE_STATUS.PUBLISHED) {
    if (snapshot.verifiedContentHash && snapshot.contentHash && snapshot.verifiedContentHash !== snapshot.contentHash) {
      return Boolean(snapshot.publishedAt);
    }
    return true;
  }

  if ((status === REFERENCE_STATUS.APPROVED_LOCAL || status === REFERENCE_STATUS.AWAITING_DEPLOY) && snapshot.publishedAt) {
    return true;
  }

  if (status === REFERENCE_STATUS.DEPLOY_FAILED && snapshot.publishedAt && snapshot.liveUrlReachable === true) {
    return true;
  }

  return false;
}

/**
 * Checks whether a reference URL is publicly reachable and returning the approved content.
 * @param {string} url - The full public URL.
 * @param {string|{id?: string, title?: string, contentHash?: string, bustCache?: boolean, fetchImpl?: Function}} [expected]
 * @param {number} [timeoutMs] - Request timeout.
 * @returns {Promise<{ ok: boolean, status: number, kind?: string, contentHash?: string | null, error?: string }>}
 */
async function verifyLiveReference(url, expected, timeoutMs = 8000) {
  const opts = typeof expected === 'string'
    ? { title: expected }
    : (expected || {});
  const fetchFn = opts.fetchImpl || globalThis.fetch;

  let fetchUrl = url;
  if (opts.bustCache !== false) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('_verify', String(Date.now()));
      fetchUrl = parsed.toString();
    } catch (_) {
      fetchUrl = url;
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetchFn(fetchUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          status: 404,
          kind: 'not_found',
          error: 'Live URL returned HTTP 404 (not deployed to Digital Garden yet).'
        };
      }
      return {
        ok: false,
        status: res.status,
        kind: 'http_error',
        error: `Live URL returned HTTP ${res.status} ${res.statusText || ''}`.trim()
      };
    }

    const text = await res.text();

    // Detect soft-404 pages returning HTTP 200
    if (/class=["'][^"']*dg-not-found-page/.test(text) || (/<title>\s*Page not found\s*<\/title>/i.test(text) && !/latex-ref-card/.test(text))) {
      return {
        ok: false,
        status: 404,
        kind: 'not_found',
        error: 'Live URL rendered a 404 page instead of the reference.'
      };
    }

    const refIdMatch = text.match(/data-reference-id=["']?([^"'\s>]+)["']?/i);
    if (opts.id) {
      const hasMatchingAttr = refIdMatch && refIdMatch[1] === opts.id;
      const hasMatchingDomId = text.includes(`id="ref-${opts.id}"`) || text.includes(`id=ref-${opts.id}`);
      if (refIdMatch && refIdMatch[1] !== opts.id) {
        return {
          ok: false,
          status: res.status,
          kind: 'content_mismatch',
          error: `Live URL served reference "${refIdMatch[1]}" instead of "${opts.id}".`
        };
      }
      if (!hasMatchingAttr && !hasMatchingDomId) {
        return {
          ok: false,
          status: res.status,
          kind: 'content_mismatch',
          error: `Live page at ${url} is not the rendered reference card for "${opts.id}".`
        };
      }
    }

    const hashMatch = text.match(/data-content-hash=["']?([a-zA-Z0-9_-]+)["']?/i);
    const liveHash = hashMatch ? hashMatch[1] : null;
    if (opts.contentHash && liveHash && liveHash !== opts.contentHash) {
      return {
        ok: false,
        status: res.status,
        kind: 'stale_content',
        contentHash: liveHash,
        error: 'Live page still serves an older snapshot while the updated build deploys.'
      };
    }

    if (opts.title) {
      const hasTitle = text.includes(opts.title) || text.includes(escapeHtml(opts.title));
      if (!hasTitle) {
        return {
          ok: false,
          status: res.status,
          kind: 'content_mismatch',
          error: `Page returned HTTP 200 but did not contain expected title "${opts.title}".`
        };
      }
    }

    return { ok: true, status: res.status, kind: 'verified', contentHash: liveHash };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      kind: 'network_error',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Generates clean manifest JSON for Digital Garden (content snapshots only, without volatile client polling metadata).
 */
function exportDigitalGardenManifest(manifest) {
  const current = manifest || createEmptyManifest();
  const refs = {};
  for (const [id, ref] of Object.entries(current.references || {})) {
    if (!ref || !ref.id) continue;
    refs[id] = {
      id: ref.id,
      type: ref.type,
      title: ref.title,
      body: ref.body,
      sourceFile: ref.sourceFile,
      approvedAt: ref.approvedAt,
      updatedAt: ref.updatedAt,
      url: ref.url,
      contentHash: ref.contentHash
    };
  }
  return {
    version: current.version || 1,
    baseUrl: current.baseUrl || 'https://obsidian.koltensserver.com',
    updatedAt: current.updatedAt || new Date().toISOString(),
    references: refs
  };
}

/**
 * Generates TeX macro definitions for offline/standalone compilation.
 * Emits only references verified live (or previously verified live while updating),
 * preventing newly approved / pending / failed references from producing dead 404 hyperlinks.
 * @param {object} manifest - Manifest object.
 * @returns {string} TeX definitions.
 */
function exportGardenrefsTex(manifest) {
  const refs = (manifest && manifest.references) ? Object.values(manifest.references) : [];
  const linkableRefs = refs.filter(canRenderLiveLink);
  linkableRefs.sort((a, b) => a.id.localeCompare(b.id));

  const lines = [
    '% ====================================================================',
    '% Autogenerated by obsidian-latex-references. Do not edit manually.',
    '% Only verified-live references are emitted to prevent dead PDF links.',
    `% Updated: ${(manifest && manifest.updatedAt) || new Date().toISOString()}`,
    '% ====================================================================',
    ''
  ];

  for (const ref of linkableRefs) {
    lines.push(`\\declaregardenref{${ref.id}}{${ref.url}}`);
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  REFERENCE_STATUS,
  STATUS_LABELS,
  getStatusLabel,
  computeHash,
  createEmptyManifest,
  normalizeUrl,
  approveSnapshot,
  updateReferenceStatus,
  unpublishSnapshot,
  getSnapshot,
  getReferenceStatus,
  isApproved,
  isPublished,
  canRenderLiveLink,
  detectDrift,
  verifyLiveReference,
  exportDigitalGardenManifest,
  exportGardenrefsTex
};
