'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/index.js');

test('indexes mathematical callouts and extracts titles, types, folds, and bodies', () => {
  const markdown = `
# Lecture Notes

> [!definition] Group
> A set $G$ together with a binary operation $*$ satisfying:
> 1. Associativity
> 2. Identity
> 3. Inverses
^def-group

> [!theorem]+ Lagrange's Theorem
> If $H$ is a subgroup of a finite group $G$, then $|H|$ divides $|G|$.

> [!note] Ordinary Note
> This should not be indexed as a mathematical environment.
`;

  const envs = core.scanEnvironments(markdown, 'Notes/Algebra.md');
  assert.equal(envs.length, 2);

  assert.equal(envs[0].type, 'definition');
  assert.equal(envs[0].title, 'Group');
  assert.equal(envs[0].id, 'def-group');
  assert.match(envs[0].body, /Associativity/);

  assert.equal(envs[1].type, 'theorem');
  assert.equal(envs[1].title, "Lagrange's Theorem");
  assert.equal(envs[1].fold, '+');
  assert.equal(envs[1].id, null);
  assert.match(envs[1].body, /divides \$\|G\|\$/);
});

test('recognizes all 10 mathematical environment types', () => {
  const types = [
    'definition', 'formula', 'theorem', 'proposition', 'lemma',
    'corollary', 'remark', 'axiom', 'conjecture', 'notation'
  ];
  for (const t of types) {
    const text = `> [!${t}] Sample Title\n> Sample body text.`;
    const envs = core.scanEnvironments(text);
    assert.equal(envs.length, 1);
    assert.equal(envs[0].type, t);
    assert.equal(envs[0].title, 'Sample Title');
  }
});

test('slugifies LaTeX math and special characters cleanly in candidate IDs', () => {
  assert.equal(core.slugify('Group Homomorphism'), 'group-homomorphism');
  assert.equal(core.slugify('First Isomorphism Theorem ($G/\\ker\\varphi \\cong \\text{im}\\varphi$)'), 'first-isomorphism-theorem-g-im');
  assert.equal(core.slugify('Bézout\'s Identity'), 'bezout-s-identity');
});

test('uniqueId avoids existing IDs in text and reserved list', () => {
  const text = `
> [!definition] Homomorphism
> Text
^def-homomorphism

> [!definition] Homomorphism
> Second one
`;
  const envs = core.scanEnvironments(text);
  assert.equal(envs[0].id, 'def-homomorphism');

  const newId = core.uniqueId(envs[1], text, ['def-homomorphism']);
  assert.equal(newId, 'def-homomorphism-2');
});

test('ensureBlockId adds block ID surgically without modifying surrounding text', () => {
  const text = `Before content\n\n> [!theorem] Fermat's Little Theorem\n> $a^p \\equiv a \\pmod p$.\n\nAfter content`;
  const envs = core.scanEnvironments(text);
  assert.equal(envs[0].id, null);

  const res = core.ensureBlockId(text, envs[0]);
  assert.match(res.id, /^thm-fermat-s-little-theorem/);
  assert.match(res.text, new RegExp(`\\^${res.id}`));
  assert.match(res.text, /^Before content/);
  assert.match(res.text, /After content$/);

  // Idempotent when already present
  const res2 = core.ensureBlockId(res.text, { ...envs[0], id: res.id });
  assert.equal(res2.id, res.id);
  assert.equal(res2.text, res.text);
  assert.equal(res2.insertionOffset, null);
});

test('buildLatexRefCommand creates valid \\gardenref command and sanitizes special characters', () => {
  const cmd = core.buildLatexRefCommand('def-group-homomorphism', 'homomorphism');
  assert.equal(cmd, '\\gardenref{def-group-homomorphism}{homomorphism}');

  const cmdWithMath = core.buildLatexRefCommand('def-group-homomorphism', '$\\varphi$ is a homomorphism');
  assert.equal(cmdWithMath, '\\gardenref{def-group-homomorphism}{$\\varphi$ is a homomorphism}');

  // Escaping unescaped % and #
  const cmdWithPercent = core.buildLatexRefCommand('def-group-homomorphism', '50% accuracy on problem #1');
  assert.equal(cmdWithPercent, '\\gardenref{def-group-homomorphism}{50\\% accuracy on problem \\#1}');

  // Idempotent escaping when already escaped
  const cmdAlreadyEscaped = core.buildLatexRefCommand('def-group-homomorphism', '50\\% and \\#1');
  assert.equal(cmdAlreadyEscaped, '\\gardenref{def-group-homomorphism}{50\\% and \\#1}');

  // Multi-line selection trimmed
  const cmdMultiline = core.buildLatexRefCommand('def-group-homomorphism', '  homomorphism\n  mapping  ');
  assert.equal(cmdMultiline, '\\gardenref{def-group-homomorphism}{homomorphism mapping}');
});

test('manifest 5-state publishing lifecycle, status labels, and strict live-link safety', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const item = {
    id: 'def-group-homomorphism',
    type: 'definition',
    title: 'Group Homomorphism',
    body: 'A map $\\varphi: G \\to G\'$ is a homomorphism.',
    filePath: 'School/MATH4281.md'
  };

  // 0. Unpublished state
  assert.equal(core.getReferenceStatus(manifest, item.id), core.REFERENCE_STATUS.UNAPPROVED);
  assert.equal(core.getStatusLabel(core.REFERENCE_STATUS.UNAPPROVED), 'Unpublished');
  assert.equal(core.isPublished(manifest, item.id), false);

  // 1. Initial local approval -> NOT published & excluded from gardenrefs.tex (no 404 PDF links!)
  const { manifest: m1, snapshot: s1 } = core.approveSnapshot(manifest, item);
  assert.equal(s1.status, core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(s1.publishedAt, null);
  assert.equal(core.getReferenceStatus(m1, item.id), core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(core.getStatusLabel(core.getReferenceStatus(m1, item.id)), 'Approved locally');
  assert.equal(core.isApproved(m1, item.id), true);
  assert.equal(core.isPublished(m1, item.id), false);
  assert.equal(core.canRenderLiveLink(s1), false);
  assert.doesNotMatch(core.exportGardenrefsTex(m1), /\\declaregardenref\{def-group-homomorphism\}/);

  // 2. Transition to awaiting deployment -> still NOT published & still excluded until verified
  const { manifest: m2, snapshot: s2 } = core.updateReferenceStatus(m1, item.id, core.REFERENCE_STATUS.AWAITING_DEPLOY);
  assert.equal(s2.status, core.REFERENCE_STATUS.AWAITING_DEPLOY);
  assert.equal(core.getStatusLabel(s2.status), 'Deploying');
  assert.equal(core.isPublished(m2, item.id), false);
  assert.equal(core.canRenderLiveLink(s2), false);
  assert.doesNotMatch(core.exportGardenrefsTex(m2), /\\declaregardenref\{def-group-homomorphism\}/);

  // 3. Deployment failure -> Failed status & excluded from PDF links
  const { manifest: m3, snapshot: s3 } = core.updateReferenceStatus(m2, item.id, core.REFERENCE_STATUS.DEPLOY_FAILED, {
    httpStatus: 404,
    kind: 'not_found',
    verificationError: 'HTTP 404 Not Found'
  });
  assert.equal(s3.status, core.REFERENCE_STATUS.DEPLOY_FAILED);
  assert.equal(core.getStatusLabel(s3.status), 'Failed');
  assert.equal(s3.verificationError, 'HTTP 404 Not Found');
  assert.equal(s3.liveUrlReachable, false);
  assert.equal(core.canRenderLiveLink(s3), false);

  // 4. Successful publication -> Published status & emitted in gardenrefs.tex
  const { manifest: m4, snapshot: s4 } = core.updateReferenceStatus(m3, item.id, core.REFERENCE_STATUS.PUBLISHED, {
    publishedAt: new Date().toISOString()
  });
  assert.equal(s4.status, core.REFERENCE_STATUS.PUBLISHED);
  assert.equal(core.getStatusLabel(s4.status), 'Published');
  assert.equal(s4.verifiedContentHash, s4.contentHash);
  assert.equal(s4.liveUrlReachable, true);
  assert.equal(core.isPublished(m4, item.id), true);
  assert.equal(core.canRenderLiveLink(s4), true);
  assert.match(core.exportGardenrefsTex(m4), /\\declaregardenref\{def-group-homomorphism\}/);
});

test('updating a published snapshot invalidates stale Published label while preserving existing live PDF link', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const item = {
    id: 'def-isomorphism',
    type: 'definition',
    title: 'Isomorphism',
    body: 'A bijective homomorphism.',
    filePath: 'School/MATH4281 Exam 1 Cheat Sheet.md'
  };

  const { manifest: m1 } = core.approveSnapshot(manifest, item, { status: core.REFERENCE_STATUS.PUBLISHED });
  assert.equal(core.isPublished(m1, item.id), true);
  const v1Hash = m1.references[item.id].contentHash;

  // User edits definition and clicks Update Snapshot
  const updatedItem = { ...item, body: 'A bijective group homomorphism $\\varphi: G \\to G\'$.' };
  const { manifest: m2, snapshot: s2 } = core.approveSnapshot(m1, updatedItem);

  // Status immediately reverts to Approved locally (never shows stale Published!)
  assert.equal(core.getReferenceStatus(m2, item.id), core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(core.isPublished(m2, item.id), false);
  assert.equal(s2.verifiedContentHash, v1Hash);
  assert.notEqual(s2.contentHash, v1Hash);

  // Previous verified URL remains safe to link while update awaits deploy
  assert.equal(core.canRenderLiveLink(s2), true);
  assert.match(core.exportGardenrefsTex(m2), /\\declaregardenref\{def-isomorphism\}/);

  // Edge case: manually loaded snapshot where status was 'published' but verifiedContentHash mismatches contentHash
  const tampered = {
    ...m2,
    references: {
      [item.id]: {
        ...s2,
        status: core.REFERENCE_STATUS.PUBLISHED
      }
    }
  };
  assert.equal(core.getReferenceStatus(tampered, item.id), core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(core.isPublished(tampered, item.id), false);

  // Edge case: snapshot with missing status never defaults to Published
  const missingStatus = {
    ...m1,
    references: {
      [item.id]: {
        id: item.id,
        type: 'definition',
        title: 'Isomorphism',
        body: 'Body',
        url: 'https://obsidian.koltensserver.com/latex-references/def-isomorphism/',
        contentHash: 'abc123'
      }
    }
  };
  assert.equal(core.getReferenceStatus(missingStatus, item.id), core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(core.isPublished(missingStatus, item.id), false);
  assert.equal(core.canRenderLiveLink(missingStatus.references[item.id]), false);
});

test('stable identity collision detection vs renamed/moved note handling', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const itemA = {
    id: 'def-normal',
    type: 'definition',
    title: 'Normal Subgroup',
    body: 'A subgroup $N$ is normal in $G$ if $gNg^{-1} = N$.',
    filePath: 'Algebra/Groups.md'
  };

  const { manifest: m1, snapshot: s1 } = core.approveSnapshot(manifest, itemA);
  assert.equal(s1.title, 'Normal Subgroup');

  // Renamed or moved file with same definition: Allowed and updates sourceFile
  const itemMoved = {
    id: 'def-normal',
    type: 'definition',
    title: 'Normal Subgroup',
    body: 'A subgroup $N$ is normal in $G$ if $gNg^{-1} = N$.',
    filePath: 'Modern Algebra/Advanced/Groups.md'
  };
  const { manifest: mMoved, snapshot: sMoved } = core.approveSnapshot(m1, itemMoved);
  assert.equal(sMoved.sourceFile, 'Modern Algebra/Advanced/Groups.md');
  assert.equal(sMoved.approvedAt, s1.approvedAt); // Preserves original approval timestamp

  // Accidental collision from completely different note and definition: Rejects silent overwrite
  const itemCollision = {
    id: 'def-normal',
    type: 'definition',
    title: 'Normal Topological Space',
    body: 'A topological space $X$ is normal if disjoint closed sets can be separated.',
    filePath: 'Topology/Spaces.md'
  };

  assert.throws(() => {
    core.approveSnapshot(m1, itemCollision);
  }, /Reference ID collision/);

  // Frozen snapshot preservation: original snapshot remains intact despite attempted collision
  const preserved = core.getSnapshot(m1, 'def-normal');
  assert.equal(preserved.title, 'Normal Subgroup');
  assert.equal(preserved.sourceFile, 'Algebra/Groups.md');
});

test('manifest lifecycle: approve, publish, drift detection, exportDigitalGardenManifest, and unpublish', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  assert.equal(core.isApproved(manifest, 'def-test'), false);
  assert.equal(core.isPublished(manifest, 'def-test'), false);

  const item = {
    id: 'def-group-homomorphism',
    type: 'definition',
    title: 'Group Homomorphism',
    body: 'A map $\\varphi: G \\to G\'$ is a homomorphism if $\\varphi(ab) = \\varphi(a)\\varphi(b)$.',
    filePath: 'School/MATH4281.md'
  };

  const { manifest: m1, snapshot } = core.approveSnapshot(manifest, item);
  assert.equal(core.isApproved(m1, 'def-group-homomorphism'), true);
  assert.equal(core.isPublished(m1, 'def-group-homomorphism'), false);
  assert.equal(snapshot.url, 'https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/');
  assert.ok(snapshot.contentHash);

  // Drift detection
  assert.equal(core.detectDrift(snapshot, item), false);
  const modifiedItem = { ...item, body: 'A modified definition body.' };
  assert.equal(core.detectDrift(snapshot, modifiedItem), true);

  // Export clean Digital Garden manifest (strips client polling fields)
  const dgManifest = core.exportDigitalGardenManifest(m1);
  assert.equal(dgManifest.references['def-group-homomorphism'].contentHash, snapshot.contentHash);
  assert.equal('status' in dgManifest.references['def-group-homomorphism'], false);
  assert.equal('lastVerifiedAt' in dgManifest.references['def-group-homomorphism'], false);

  // Export to TeX before vs after verification
  assert.doesNotMatch(core.exportGardenrefsTex(m1), /\\declaregardenref\{def-group-homomorphism\}/);

  const { manifest: mPub } = core.updateReferenceStatus(m1, 'def-group-homomorphism', core.REFERENCE_STATUS.PUBLISHED);
  const texDef = core.exportGardenrefsTex(mPub);
  assert.match(texDef, /\\declaregardenref\{def-group-homomorphism\}\{https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-group-homomorphism\/\}/);

  // Unpublish
  const { manifest: m2, removed } = core.unpublishSnapshot(mPub, 'def-group-homomorphism');
  assert.equal(removed, true);
  assert.equal(core.isApproved(m2, 'def-group-homomorphism'), false);
  assert.equal(core.isPublished(m2, 'def-group-homomorphism'), false);
});

test('verifyLiveReference checks HTTP 404, soft-404, id mismatch, stale hash, title escaping, and valid live match', async () => {
  const url = 'https://obsidian.koltensserver.com/latex-references/def-isomorphism/';

  // 1. HTTP 404
  const r404 = await core.verifyLiveReference(url, {
    id: 'def-isomorphism',
    title: 'Isomorphism',
    contentHash: 'c316dd7ec539ead1',
    fetchImpl: async (reqUrl) => {
      assert.match(reqUrl, /\?_verify=\d+/);
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
    }
  });
  assert.equal(r404.ok, false);
  assert.equal(r404.status, 404);
  assert.equal(r404.kind, 'not_found');

  // 2. Soft 404 (HTTP 200 rendering dg-not-found-page)
  const rSoft404 = await core.verifyLiveReference(url, {
    id: 'def-isomorphism',
    title: 'Isomorphism',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><title>Page not found</title><body class="dg-not-found-page">Page not found</body></html>'
    })
  });
  assert.equal(rSoft404.ok, false);
  assert.equal(rSoft404.kind, 'not_found');

  // 3. Stale snapshot hash while Vercel builds update
  const rStale = await core.verifyLiveReference(url, {
    id: 'def-isomorphism',
    title: 'Isomorphism',
    contentHash: 'newhash123456789',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<main class="latex-ref-card" data-reference-id="def-isomorphism" data-content-hash="oldhash123456789"><div class="callout-title-inner">Isomorphism</div></main>'
    })
  });
  assert.equal(rStale.ok, false);
  assert.equal(rStale.kind, 'stale_content');

  // 4. HTML-escaped title & matching hash
  const rValid = await core.verifyLiveReference(url, {
    id: 'def-abel',
    title: "Lagrange's Theorem & Order",
    contentHash: 'abc123def4567890',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<main class="latex-ref-card" id="ref-def-abel" data-reference-id="def-abel" data-content-hash="abc123def4567890"><div class="callout-title-inner">Lagrange&#39;s Theorem &amp; Order</div></main>'
    })
  });
  assert.equal(rValid.ok, true);
  assert.equal(rValid.kind, 'verified');
  assert.equal(rValid.contentHash, 'abc123def4567890');

  // 5. Network failure (offline)
  const rNet = await core.verifyLiveReference(url, {
    id: 'def-isomorphism',
    fetchImpl: async () => {
      throw new Error('fetch failed');
    }
  });
  assert.equal(rNet.ok, false);
  assert.equal(rNet.status, 0);
  assert.equal(rNet.kind, 'network_error');
});

test('parses real vault excerpt: MATH4281 Exam 1 Cheat Sheet Group Homomorphism', () => {
  const realExcerpt = `
# 2. Homomorphisms and Isomorphisms

## Group Homomorphism Definition

> [!definition] Group Homomorphism
> A map
> 
> $$
> \\varphi:G\\to G'
> $$
> 
> between groups $(G,\\cdot)$ and $(G',\\ast)$ is a **homomorphism** if
> 
> $$
> \\varphi(ab)
> =
> \\varphi(a)\\ast\\varphi(b)
> $$
> 
> for all $a,b\\in G$.

^def-group-homomorphism

---
`;

  const envs = core.scanEnvironments(realExcerpt, 'School/Fall 2026/Introduction to Modern Algebra/Notebooks/MATH4281 Exam 1 Cheat Sheet.md');
  assert.equal(envs.length, 1);
  assert.equal(envs[0].type, 'definition');
  assert.equal(envs[0].title, 'Group Homomorphism');
  assert.equal(envs[0].id, 'def-group-homomorphism');
  assert.match(envs[0].body, /\\varphi:G\\to G'/);
});

test('parseLatexReferences handles prose, multiple refs per line, multiline args, nested braces, math, and escapes', () => {
  const tex = String.raw`
A ring \gardenref{def-isomorphism}{isomorphism} preserves operations.
Multiple on one line: \gardenref{def-group}{groups} and \gardenref{def-homomorphism}{$\varphi: G \to G'$ and \emph{nested \textbf{braces}}}.
Escaped braces and trailing backslash: \gardenref{def-set}{set $\{a, b\}$ with 50\% and end\\}.
Multiline argument:
\gardenref{thm-lagrange}{
  Lagrange's Theorem with % comment containing unbalanced { brace
  math $H \le G$
}
Adjacent commands: \gardenref{def-a}{alpha}\gardenref{def-b}{beta}.
`;

  const refs = core.parseLatexReferences(tex);
  assert.equal(refs.length, 7);

  assert.equal(refs[0].id, 'def-isomorphism');
  assert.equal(refs[0].displayText, 'isomorphism');
  assert.equal(refs[0].raw, String.raw`\gardenref{def-isomorphism}{isomorphism}`);
  assert.equal(tex.slice(refs[0].from, refs[0].to), refs[0].raw);

  assert.equal(refs[1].id, 'def-group');
  assert.equal(refs[1].displayText, 'groups');

  assert.equal(refs[2].id, 'def-homomorphism');
  assert.equal(refs[2].displayText, String.raw`$\varphi: G \to G'$ and \emph{nested \textbf{braces}}`);

  assert.equal(refs[3].id, 'def-set');
  assert.equal(refs[3].displayText, String.raw`set $\{a, b\}$ with 50\% and end\\`);
  assert.equal(tex.slice(refs[3].from, refs[3].to), refs[3].raw);

  assert.equal(refs[4].id, 'thm-lagrange');
  assert.match(refs[4].displayText, /Lagrange's Theorem/);
  assert.match(refs[4].displayText, /math \$H \\le G\$/);

  assert.equal(refs[5].id, 'def-a');
  assert.equal(refs[5].displayText, 'alpha');

  assert.equal(refs[6].id, 'def-b');
  assert.equal(refs[6].displayText, 'beta');
  assert.equal(refs[5].to, refs[6].from);
});

test('parseLatexReferences ignores commented, escaped, incomplete, and prefix-colliding commands', () => {
  const tex = String.raw`
% \gardenref{def-commented}{should ignore}
Escaped line break then literal text: \\gardenref{def-escaped}{ignore}
Double backslash then real command: \\\gardenref{def-real}{match me}
Different macro name: \gardenrefs{def-other}{ignore}
Incomplete first arg: \gardenref{def-incomplete
Incomplete second arg: \gardenref{def-onlyone}{unclosed
Escaped percent still parses command: 50\% \gardenref{def-after-percent}{valid}
`;

  const refs = core.parseLatexReferences(tex);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].id, 'def-real');
  assert.equal(refs[0].displayText, 'match me');
  assert.equal(refs[1].id, 'def-after-percent');
  assert.equal(refs[1].displayText, 'valid');
});

test('findLatexReferenceAtPosition and findLatexReferenceForSelection resolve cursor/partial selection accurately', () => {
  const tex = String.raw`Before \gardenref{def-isomorphism}{$\varphi$ iso} after`;
  const refs = core.parseLatexReferences(tex);
  assert.equal(refs.length, 1);
  const r = refs[0];

  // Cursor inside ID arg or display-text arg
  assert.equal(core.findLatexReferenceAtPosition(refs, r.idInnerFrom + 2)?.id, 'def-isomorphism');
  assert.equal(core.findLatexReferenceAtPosition(refs, r.textInnerFrom + 1)?.id, 'def-isomorphism');
  assert.equal(core.findLatexReferenceAtPosition(refs, r.from)?.id, 'def-isomorphism');

  // Strict exclusive end vs inclusive end
  assert.equal(core.findLatexReferenceAtPosition(refs, r.to, false), null);
  assert.equal(core.findLatexReferenceAtPosition(refs, r.to, true)?.id, 'def-isomorphism');
  assert.equal(core.findLatexReferenceAtPosition(refs, r.to + 1, true), null);
  assert.equal(core.findLatexReferenceAtPosition(refs, r.from - 1, true), null);

  // Partial selection inside second argument or whole command resolves ref
  assert.equal(core.findLatexReferenceForSelection(refs, r.textInnerFrom, r.textInnerFrom + 5)?.id, 'def-isomorphism');
  assert.equal(core.findLatexReferenceForSelection(refs, r.from, r.to)?.id, 'def-isomorphism');

  // Selection spanning outside command does not false-match
  assert.equal(core.findLatexReferenceForSelection(refs, 0, r.textInnerTo), null);
});

test('getReferenceStatus rejects published label when publishedAt is missing or liveUrlReachable is false', () => {
  const base = core.createEmptyManifest('https://obsidian.koltensserver.com');
  base.references['def-no-date'] = {
    id: 'def-no-date',
    type: 'definition',
    title: 'Missing Date',
    body: 'Body',
    sourceFile: 'a.md',
    approvedAt: new Date().toISOString(),
    url: 'https://obsidian.koltensserver.com/latex-references/def-no-date/',
    contentHash: 'abc',
    status: core.REFERENCE_STATUS.PUBLISHED,
    publishedAt: null
  };
  assert.equal(core.getReferenceStatus(base, 'def-no-date'), core.REFERENCE_STATUS.APPROVED_LOCAL);

  base.references['def-dead-url'] = {
    id: 'def-dead-url',
    type: 'definition',
    title: 'Dead URL',
    body: 'Body',
    sourceFile: 'a.md',
    approvedAt: new Date().toISOString(),
    url: 'https://obsidian.koltensserver.com/latex-references/def-dead-url/',
    contentHash: 'abc',
    status: core.REFERENCE_STATUS.PUBLISHED,
    publishedAt: new Date().toISOString(),
    liveUrlReachable: false
  };
  assert.equal(core.getReferenceStatus(base, 'def-dead-url'), core.REFERENCE_STATUS.DEPLOY_FAILED);
});
