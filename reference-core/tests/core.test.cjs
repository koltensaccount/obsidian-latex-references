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

test('manifest 5-state publishing lifecycle and status transitions', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const item = {
    id: 'def-group-homomorphism',
    type: 'definition',
    title: 'Group Homomorphism',
    body: 'A map $\\varphi: G \\to G\'$ is a homomorphism.',
    filePath: 'School/MATH4281.md'
  };

  // 1. Initial local approval
  const { manifest: m1, snapshot: s1 } = core.approveSnapshot(manifest, item);
  assert.equal(s1.status, core.REFERENCE_STATUS.APPROVED_LOCAL);
  assert.equal(s1.publishedAt, null);

  // 2. Transition to awaiting deployment (git commit/push in progress)
  const { manifest: m2, snapshot: s2 } = core.updateReferenceStatus(m1, item.id, core.REFERENCE_STATUS.AWAITING_DEPLOY);
  assert.equal(s2.status, core.REFERENCE_STATUS.AWAITING_DEPLOY);

  // 3. Deployment failure
  const { manifest: m3, snapshot: s3 } = core.updateReferenceStatus(m2, item.id, core.REFERENCE_STATUS.DEPLOY_FAILED, {
    verificationError: 'HTTP 404 Not Found'
  });
  assert.equal(s3.status, core.REFERENCE_STATUS.DEPLOY_FAILED);
  assert.equal(s3.verificationError, 'HTTP 404 Not Found');

  // 4. Successful publication
  const { manifest: m4, snapshot: s4 } = core.updateReferenceStatus(m3, item.id, core.REFERENCE_STATUS.PUBLISHED, {
    publishedAt: new Date().toISOString()
  });
  assert.equal(s4.status, core.REFERENCE_STATUS.PUBLISHED);
  assert.ok(s4.publishedAt);
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

test('manifest lifecycle: approve, check, drift detection, and unpublish', () => {
  const manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  assert.equal(core.isApproved(manifest, 'def-test'), false);

  const item = {
    id: 'def-group-homomorphism',
    type: 'definition',
    title: 'Group Homomorphism',
    body: 'A map $\\varphi: G \\to G\'$ is a homomorphism if $\\varphi(ab) = \\varphi(a)\\varphi(b)$.',
    filePath: 'School/MATH4281.md'
  };

  const { manifest: m1, snapshot } = core.approveSnapshot(manifest, item);
  assert.equal(core.isApproved(m1, 'def-group-homomorphism'), true);
  assert.equal(snapshot.url, 'https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/');
  assert.ok(snapshot.contentHash);

  // Drift detection
  assert.equal(core.detectDrift(snapshot, item), false);
  const modifiedItem = { ...item, body: 'A modified definition body.' };
  assert.equal(core.detectDrift(snapshot, modifiedItem), true);

  // Export to TeX
  const texDef = core.exportGardenrefsTex(m1);
  assert.match(texDef, /\\declaregardenref\{def-group-homomorphism\}\{https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-group-homomorphism\/\}/);

  // Unpublish
  const { manifest: m2, removed } = core.unpublishSnapshot(m1, 'def-group-homomorphism');
  assert.equal(removed, true);
  assert.equal(core.isApproved(m2, 'def-group-homomorphism'), false);
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
