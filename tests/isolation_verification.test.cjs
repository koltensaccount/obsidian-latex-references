'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const core = require('../reference-core/src/index.js');
const LATEX_PACKAGE = path.resolve(__dirname, '../latex/gardenref.sty');
const TEST_DIR = '/tmp/latex-ref-isolation-test';

test('Independence 1: Markdown Callout Links tests continue running 100% autonomously', () => {
  const calloutLinksDir = '/Users/koltenbendickson/Developer/callout-links';
  assert.ok(fs.existsSync(calloutLinksDir), 'Callout Links repository exists');

  // Clear NODE_TEST_CONTEXT so child node --test doesn't skip
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  const testOutput = execFileSync('npm', ['test'], {
    cwd: calloutLinksDir,
    encoding: 'utf8',
    env: childEnv
  });
  assert.match(testOutput, /pass 35/, 'Callout links original 35 tests must pass without modification');
});

test('Independence 2: Moving or renaming source Markdown note preserves stable published identity', () => {
  const initialNote = `
> [!theorem] Unique Factorization
> Every integer $n > 1$ can be factored uniquely into primes.
^thm-unique-factorization
`;
  const initialEnvs = core.scanEnvironments(initialNote, 'Original/OldPath/Theory.md');
  assert.equal(initialEnvs[0].id, 'thm-unique-factorization');

  // Approved locally first -> safe withholding from PDF links before verification
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: mLocal, snapshot: s1 } = core.approveSnapshot(manifest, initialEnvs[0]);
  assert.equal(s1.url, 'https://obsidian.koltensserver.com/latex-references/thm-unique-factorization/');
  assert.doesNotMatch(core.exportGardenrefsTex(mLocal), /\\declaregardenref\{thm-unique-factorization\}/);

  // Verified live -> Published
  const { manifest: m1 } = core.updateReferenceStatus(mLocal, 'thm-unique-factorization', core.REFERENCE_STATUS.PUBLISHED);

  // Note moves to a new folder and filename
  const movedNote = initialNote; // identical content in new file
  const movedEnvs = core.scanEnvironments(movedNote, 'Archive/NewPath/RenamedTheory.md');
  assert.equal(movedEnvs[0].id, 'thm-unique-factorization');

  // URL remains identical
  const s2Url = core.normalizeUrl(m1.baseUrl, movedEnvs[0].id);
  assert.equal(s2Url, s1.url, 'Published URL must not change when source file moves or renames');

  // TeX definition continues resolving to the exact same URL
  const texDef = core.exportGardenrefsTex(m1);
  assert.match(texDef, /\\declaregardenref\{thm-unique-factorization\}\{https:\/\/obsidian\.koltensserver\.com\/latex-references\/thm-unique-factorization\/\}/);
});

test('Independence 3: LaTeX compilation works standalone without Obsidian or Callout Links running', () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  fs.copyFileSync(LATEX_PACKAGE, path.join(TEST_DIR, 'gardenref.sty'));

  // Create standalone gardenrefs.tex
  fs.writeFileSync(path.join(TEST_DIR, 'gardenrefs.tex'), '\\declaregardenref{thm-pythagoras}{https://obsidian.koltensserver.com/latex-references/thm-pythagoras/}\n', 'utf8');

  // Create minimal document
  const doc = `
\\pdfcompresslevel=0
\\pdfobjcompresslevel=0
\\documentclass{article}
\\usepackage{gardenref}
\\begin{document}
According to \\gardenref{thm-pythagoras}{Pythagorean Theorem}, $a^2 + b^2 = c^2$.
\\end{document}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'doc.tex'), doc, 'utf8');

  // Compile with pdflatex in an isolated subshell with no Obsidian environment
  execFileSync('/Library/TeX/texbin/pdflatex', ['-interaction=nonstopmode', 'doc.tex'], {
    cwd: TEST_DIR,
    encoding: 'utf8',
    env: { PATH: '/Library/TeX/texbin:/usr/bin:/bin' }
  });

  const pdfContent = fs.readFileSync(path.join(TEST_DIR, 'doc.pdf'), 'utf8');
  assert.match(pdfContent, /https:\/\/obsidian\.koltensserver\.com\/latex-references\/thm-pythagoras\//);

  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test('Independence 4: Safe handling of missing targets, stale entries, and failed compilation', () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  fs.copyFileSync(LATEX_PACKAGE, path.join(TEST_DIR, 'gardenref.sty'));

  // Document with missing/unpublished reference
  const doc = `
\\documentclass{article}
\\usepackage{gardenref}
\\begin{document}
This refers to \\gardenref{def-completely-missing}{phantom concept}.
\\end{document}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'missing.tex'), doc, 'utf8');

  const output = execFileSync('/Library/TeX/texbin/pdflatex', ['-interaction=nonstopmode', 'missing.tex'], {
    cwd: TEST_DIR,
    encoding: 'utf8',
    env: { PATH: '/Library/TeX/texbin:/usr/bin:/bin' }
  });

  // Verify compiler issued a warning (TeX wraps terminal log at 79 cols)
  assert.match(output, /Reference target 'def-completely-missing' is/);

  // Document with intentional syntax error to test error detection
  const brokenDoc = `
\\documentclass{article}
\\begin{document}
This is broken \\undefinedcommandhere
\\end{document}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'broken.tex'), brokenDoc, 'utf8');

  let failed = false;
  try {
    execFileSync('/Library/TeX/texbin/pdflatex', ['-interaction=nonstopmode', '-file-line-error', 'broken.tex'], {
      cwd: TEST_DIR,
      encoding: 'utf8',
      env: { PATH: '/Library/TeX/texbin:/usr/bin:/bin' }
    });
  } catch (err) {
    failed = true;
    const stdout = err.stdout || '';
    const diagnostics = core.parseDiagnostics(stdout);
    const errorDiag = diagnostics.find(d => d.severity === 'error');
    assert.ok(errorDiag, 'Diagnostics must capture error');
    assert.equal(errorDiag.line, 4, 'Must identify line 4 as error location');
  }
  assert.ok(failed, 'Broken document must fail compilation gracefully');

  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test('Independence 5: Collision detection between different notes sharing identical candidate or block IDs', () => {
  const note1 = `
> [!definition] Normal Subgroup
> A subgroup $N$ of $G$ is normal if $gNg^{-1} = N$.
^def-normal
`;
  const note2 = `
> [!definition] Normal Topological Space
> A topological space $X$ is normal if disjoint closed subsets can be separated.
^def-normal
`;

  const env1 = core.scanEnvironments(note1, 'Algebra/Groups.md')[0];
  const env2 = core.scanEnvironments(note2, 'Topology/Spaces.md')[0];

  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: m1 } = core.approveSnapshot(manifest, env1);
  assert.equal(core.isApproved(m1, 'def-normal'), true);

  // Attempting to silently overwrite with env2 from a different note must fail with collision error
  assert.throws(() => {
    core.approveSnapshot(m1, env2);
  }, /Reference ID collision/);

  // When candidate IDs match, uniqueId disambiguates against reserved IDs
  const envDuplicateTitle = { type: 'definition', title: 'Normal', rawTitle: 'Normal' };
  const reserved = ['def-normal'];
  const safeId = core.uniqueId(envDuplicateTitle, '', reserved);
  assert.equal(safeId, 'def-normal-2');
});

test('Independence 6: Edited definitions detect drift while preserving frozen snapshots for compiled PDFs', () => {
  const initialNote = `
> [!definition] Ring Homomorphism
> A map $f: R \\to S$ preserving ring operations.
^def-ring-homomorphism
`;
  const env = core.scanEnvironments(initialNote, 'Rings/Homomorphisms.md')[0];
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: m1, snapshot: s1 } = core.approveSnapshot(manifest, env);

  // User later edits the definition in the vault
  const editedNote = `
> [!definition] Ring Homomorphism
> A map $f: R \\to S$ preserving addition, multiplication, and identity $f(1_R) = 1_S$.
^def-ring-homomorphism
`;
  const editedEnv = core.scanEnvironments(editedNote, 'Rings/Homomorphisms.md')[0];

  // Drift is detected
  const hasDrift = core.detectDrift(s1, editedEnv);
  assert.equal(hasDrift, true, 'Drift must be detected when vault content changes');

  // But existing snapshot in manifest remains completely frozen until explicitly re-approved
  const storedSnapshot = core.getSnapshot(m1, 'def-ring-homomorphism');
  assert.equal(storedSnapshot.body, 'A map $f: R \\to S$ preserving ring operations.');
  assert.equal(storedSnapshot.contentHash, s1.contentHash);
});

test('Independence 7: Deleted targets in vault preserve frozen manifest snapshots and offline TeX compilation', () => {
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const env = {
    id: 'thm-spectral-theorem',
    type: 'theorem',
    title: 'Spectral Theorem',
    body: 'Every symmetric matrix is orthogonally diagonalizable.',
    filePath: 'LinearAlgebra/Spectral.md'
  };
  const { manifest: mLocal } = core.approveSnapshot(manifest, env);
  const { manifest: m1 } = core.updateReferenceStatus(mLocal, 'thm-spectral-theorem', core.REFERENCE_STATUS.PUBLISHED);

  // Target file is deleted from vault (indexer would not find it), but published snapshot preserves offline TeX compilation
  assert.equal(core.isApproved(m1, 'thm-spectral-theorem'), true);
  assert.equal(core.isPublished(m1, 'thm-spectral-theorem'), true);
  const texDef = core.exportGardenrefsTex(m1);
  assert.match(texDef, /\\declaregardenref\{thm-spectral-theorem\}/);
});

test('Independence 8: Overleaf / standalone compilation of real HW8 + preamble works WITH and WITHOUT gardenref.sty', () => {
  const HW_ORIGINAL_DIR = '/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/School/Fall 2026/Introduction to Modern Algebra/LaTeX';
  const PORTABLE_LOCAL_DIR = '/tmp/latex-ref-portable-local-test';
  const PORTABLE_OVERLEAF_DIR = '/tmp/latex-ref-portable-overleaf-test';

  for (const dir of [PORTABLE_LOCAL_DIR, PORTABLE_OVERLEAF_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(HW_ORIGINAL_DIR, 'MATH4281_HW8.tex'), path.join(dir, 'MATH4281_HW8.tex'));
    fs.cpSync(path.join(HW_ORIGINAL_DIR, 'preamble'), path.join(dir, 'preamble'), { recursive: true });
    if (fs.existsSync(path.join(HW_ORIGINAL_DIR, 'figures'))) {
      fs.cpSync(path.join(HW_ORIGINAL_DIR, 'figures'), path.join(dir, 'figures'), { recursive: true });
    }
    let hw8 = fs.readFileSync(path.join(dir, 'MATH4281_HW8.tex'), 'utf8');
    // Prepend uncompressed PDF flags so we can inspect rendered PDF text/links deterministically
    hw8 = '\\pdfcompresslevel=0\\pdfobjcompresslevel=0\n' +
      hw8.replace(
        'An \\emph{automorphism} of a ring $R$ is an isomorphism',
        'An \\emph{automorphism} of a ring $R$ is an \\gardenref{def-isomorphism}{isomorphism} preserving \\gardenref{def-ring-homomorphisms}{$\\varphi: R \\to R$ and \\emph{nested \\textbf{braces}} $\\{a, b\\}$}'
      );
    fs.writeFileSync(path.join(dir, 'MATH4281_HW8.tex'), hw8, 'utf8');
  }

  // Mode A: Local compilation WITH gardenref.sty and gardenrefs.tex -> clickable URI links
  fs.copyFileSync(LATEX_PACKAGE, path.join(PORTABLE_LOCAL_DIR, 'gardenref.sty'));
  fs.writeFileSync(
    path.join(PORTABLE_LOCAL_DIR, 'gardenrefs.tex'),
    '\\declaregardenref{def-isomorphism}{https://obsidian.koltensserver.com/latex-references/def-isomorphism/}\n' +
    '\\declaregardenref{def-ring-homomorphisms}{https://obsidian.koltensserver.com/latex-references/def-ring-homomorphisms/}\n',
    'utf8'
  );
  execFileSync('/Library/TeX/texbin/latexmk', ['-pdf', '-interaction=nonstopmode', 'MATH4281_HW8.tex'], {
    cwd: PORTABLE_LOCAL_DIR,
    encoding: 'utf8',
    env: { PATH: '/Library/TeX/texbin:/usr/local/bin:/usr/bin:/bin' }
  });
  const localPdf = fs.readFileSync(path.join(PORTABLE_LOCAL_DIR, 'MATH4281_HW8.pdf'), 'utf8');
  assert.match(localPdf, /https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-isomorphism\//);
  assert.match(localPdf, /https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-ring-homomorphisms\//);

  // Mode B: Simulated Overleaf compilation WITHOUT gardenref.sty or gardenrefs.tex (and isolated empty TEXMFHOME)
  assert.equal(fs.existsSync(path.join(PORTABLE_OVERLEAF_DIR, 'gardenref.sty')), false);
  assert.equal(fs.existsSync(path.join(PORTABLE_OVERLEAF_DIR, 'gardenrefs.tex')), false);
  execFileSync('/Library/TeX/texbin/latexmk', ['-pdf', '-interaction=nonstopmode', 'MATH4281_HW8.tex'], {
    cwd: PORTABLE_OVERLEAF_DIR,
    encoding: 'utf8',
    env: {
      PATH: '/Library/TeX/texbin:/usr/local/bin:/usr/bin:/bin',
      TEXMFHOME: '/tmp/nonexistent-overleaf-texmf'
    }
  });
  const overleafLog = fs.readFileSync(path.join(PORTABLE_OVERLEAF_DIR, 'MATH4281_HW8.log'), 'utf8');
  assert.doesNotMatch(overleafLog, /Undefined control sequence/i);
  assert.doesNotMatch(overleafLog, /File `gardenref\.sty' not found/i);
  assert.doesNotMatch(overleafLog, /Digital Garden/i);

  const overleafPdf = fs.readFileSync(path.join(PORTABLE_OVERLEAF_DIR, 'MATH4281_HW8.pdf'), 'utf8');
  assert.doesNotMatch(overleafPdf, /def-isomorphism/);
  assert.doesNotMatch(overleafPdf, /def-ring-homomorphisms/);
  assert.doesNotMatch(overleafPdf, /latex-references/);

  // Extract rendered PDF text using Ghostscript txtwrite to verify display text & nested braces intact
  const extractedText = execFileSync('/usr/local/bin/gs', [
    '-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', '-sOutputFile=-',
    path.join(PORTABLE_OVERLEAF_DIR, 'MATH4281_HW8.pdf')
  ], { encoding: 'utf8' });
  assert.match(extractedText, /isomorphism/);
  assert.match(extractedText, /braces/);
  assert.match(extractedText, /\{a,\s*b\}/);

  fs.rmSync(PORTABLE_LOCAL_DIR, { recursive: true, force: true });
  fs.rmSync(PORTABLE_OVERLEAF_DIR, { recursive: true, force: true });
});
