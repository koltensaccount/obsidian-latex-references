'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const core = require('../reference-core/src/index.js');

const HOMEWORK_ORIGINAL_DIR = '/Users/koltenbendickson/Desktop/MATH 4281 Homework';
const VAULT_CHEAT_SHEET = '/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/School/Fall 2026/Introduction to Modern Algebra/Notebooks/MATH4281 Exam 1 Cheat Sheet.md';
const GARDEN_REPO_DIR = '/Users/koltenbendickson/Developer/my-digital-garden';
const LATEX_PACKAGE = path.resolve(__dirname, '../latex/gardenref.sty');

const TEST_WORK_DIR = '/tmp/latex-ref-e2e-test';

test('End-to-End Prototype: Real Homework + Vault Callout + Digital Garden + PDF Hyperlink', async () => {
  // 1. Setup isolated test workspace
  if (fs.existsSync(TEST_WORK_DIR)) {
    fs.rmSync(TEST_WORK_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORK_DIR, { recursive: true });

  // Copy homework files into isolated workspace
  const files = fs.readdirSync(HOMEWORK_ORIGINAL_DIR);
  for (const f of files) {
    const src = path.join(HOMEWORK_ORIGINAL_DIR, f);
    const dest = path.join(TEST_WORK_DIR, f);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // Copy gardenref.sty into isolated workspace
  fs.copyFileSync(LATEX_PACKAGE, path.join(TEST_WORK_DIR, 'gardenref.sty'));

  // 2. Scan real vault note to find Group Homomorphism definition
  assert.ok(fs.existsSync(VAULT_CHEAT_SHEET), 'Vault cheat sheet must exist');
  const noteText = fs.readFileSync(VAULT_CHEAT_SHEET, 'utf8');
  const envs = core.scanEnvironments(noteText, 'MATH4281 Exam 1 Cheat Sheet.md');
  const homoEnv = envs.find(e => e.title.toLowerCase().includes('homomorphism') || (e.id && e.id.includes('homomorphism')));
  assert.ok(homoEnv, 'Must find Group Homomorphism definition in vault cheat sheet');
  assert.equal(homoEnv.id, 'def-group-homomorphism');

  // 3. Simulate editing real homework file MATH4281_HW4.tex
  const hw4Path = path.join(TEST_WORK_DIR, 'MATH4281_HW4.tex');
  let hw4Content = fs.readFileSync(hw4Path, 'utf8');

  // Add \usepackage{gardenref} after preamble input
  hw4Content = hw4Content.replace('\\input{preamble/preamble.tex}', '\\input{preamble/preamble.tex}\n\\usepackage{gardenref}');

  // Replace "kernel of a homomorphism." with "kernel of a \gardenref{def-group-homomorphism}{homomorphism}."
  assert.ok(hw4Content.includes('kernel of a homomorphism.'), 'HW4 must contain original phrase');
  hw4Content = hw4Content.replace('kernel of a homomorphism.', 'kernel of a \\gardenref{def-group-homomorphism}{homomorphism}.');

  // Also add an unpublished reference to test safe fallback
  hw4Content = hw4Content.replace('Let $G$ be a finite nontrivial group.', 'Let $G$ be a finite nontrivial group with \\gardenref{def-unpublished-concept}{some draft concept}.');

  fs.writeFileSync(hw4Path, hw4Content, 'utf8');

  // 4. Manifest lifecycle: Approve def-group-homomorphism
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: approvedManifest, snapshot } = core.approveSnapshot(manifest, homoEnv, {
    baseUrl: 'https://obsidian.koltensserver.com'
  });
  assert.equal(core.isApproved(approvedManifest, 'def-group-homomorphism'), true);
  assert.equal(core.isApproved(approvedManifest, 'def-unpublished-concept'), false);

  // 5. Generate gardenrefs.tex in isolated workspace
  const gardenrefsTex = core.exportGardenrefsTex(approvedManifest);
  fs.writeFileSync(path.join(TEST_WORK_DIR, 'gardenrefs.tex'), gardenrefsTex, 'utf8');

  // 6. Sync manifest to Digital Garden repo
  const gardenDataDir = path.join(GARDEN_REPO_DIR, 'src/site/_data');
  fs.mkdirSync(gardenDataDir, { recursive: true });
  fs.writeFileSync(path.join(gardenDataDir, 'latexReferences.json'), JSON.stringify(approvedManifest, null, 2), 'utf8');

  // 7. Build Eleventy site in Digital Garden
  execFileSync('npx', ['@11ty/eleventy'], {
    cwd: GARDEN_REPO_DIR,
    stdio: 'pipe',
    env: { ...process.env, PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH}` }
  });

  const generatedHtmlPath = path.join(GARDEN_REPO_DIR, 'dist/latex-references/def-group-homomorphism/index.html');
  assert.ok(fs.existsSync(generatedHtmlPath), 'Digital Garden must generate reference page');
  const htmlContent = fs.readFileSync(generatedHtmlPath, 'utf8');
  assert.match(htmlContent, /Group Homomorphism/);
  assert.match(htmlContent, /MathJax/);
  assert.match(htmlContent, /def-group-homomorphism/);

  // 8. Compile real homework document with latexmk
  const buildDir = path.join(TEST_WORK_DIR, '.latex-build', 'MATH4281_HW4');
  fs.mkdirSync(buildDir, { recursive: true });

  const latexmkOutput = execFileSync('/Library/TeX/texbin/latexmk', [
    '-pdf',
    '-interaction=nonstopmode',
    '-file-line-error',
    '-synctex=1',
    `-outdir=${buildDir}`,
    'MATH4281_HW4.tex'
  ], {
    cwd: TEST_WORK_DIR,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH}` }
  });

  const builtPdf = path.join(buildDir, 'MATH4281_HW4.pdf');
  assert.ok(fs.existsSync(builtPdf), 'latexmk must produce compiled PDF');

  // Copy to destination (as plugin does)
  const finalPdf = path.join(TEST_WORK_DIR, 'MATH4281_HW4.pdf');
  fs.copyFileSync(builtPdf, finalPdf);

  // 9. Verify PDF contents and URI link
  // Compile an uncompressed copy to inspect PDF objects directly
  const uncompressedTex = `\\pdfcompresslevel=0\n\\pdfobjcompresslevel=0\n` + hw4Content;
  fs.writeFileSync(path.join(TEST_WORK_DIR, 'HW4_uncompressed.tex'), uncompressedTex, 'utf8');
  execFileSync('/Library/TeX/texbin/pdflatex', ['-interaction=nonstopmode', 'HW4_uncompressed.tex'], {
    cwd: TEST_WORK_DIR,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH}` }
  });

  const uncompressedPdf = fs.readFileSync(path.join(TEST_WORK_DIR, 'HW4_uncompressed.pdf'), 'utf8');
  assert.match(uncompressedPdf, /https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-group-homomorphism\//, 'PDF must contain clickable URI for def-group-homomorphism');
  assert.doesNotMatch(uncompressedPdf, /latex-references\/def-unpublished-concept/, 'PDF must NOT create link for unpublished concept');

  // Clean up isolated test dir
  fs.rmSync(TEST_WORK_DIR, { recursive: true, force: true });
});
