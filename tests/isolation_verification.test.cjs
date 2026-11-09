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

  // Approved in manifest
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: m1, snapshot: s1 } = core.approveSnapshot(manifest, initialEnvs[0]);
  assert.equal(s1.url, 'https://obsidian.koltensserver.com/latex-references/thm-unique-factorization/');

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
