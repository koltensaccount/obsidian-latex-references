'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const core = require('../reference-core/src/index.js');

const HOMEWORK_ORIGINAL_DIR = '/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/School/Fall 2026/Introduction to Modern Algebra/LaTeX';
const VAULT_CHEAT_SHEET = '/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/School/Fall 2026/Introduction to Modern Algebra/Notebooks/MATH4281 Exam 1 Cheat Sheet.md';
const GARDEN_REPO_DIR = '/Users/koltenbendickson/Developer/my-digital-garden';
const LATEX_DIR = path.resolve(__dirname, '../latex');

const TEST_WORK_DIR = '/tmp/latex-ref-e2e-test';
const TEST_MANIFEST_FILE = path.join(TEST_WORK_DIR, 'isolated_test_manifest.json');

test('End-to-End Prototype: Isolated Real Homework + Automatic Setup + Isolated Garden Build + PDF Hyperlinks', async () => {
  // 1. Setup isolated test workspace
  if (fs.existsSync(TEST_WORK_DIR)) {
    fs.rmSync(TEST_WORK_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORK_DIR, { recursive: true });

  // Copy homework files into isolated workspace (DO NOT modify originals)
  const files = fs.readdirSync(HOMEWORK_ORIGINAL_DIR);
  for (const f of files) {
    if (f.startsWith('.') || f.endsWith('.pdf')) continue;
    const src = path.join(HOMEWORK_ORIGINAL_DIR, f);
    const dest = path.join(TEST_WORK_DIR, f);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // Verify gardenref.sty is NOT in the test folder (automatic setup must resolve via TEXINPUTS)
  assert.equal(fs.existsSync(path.join(TEST_WORK_DIR, 'gardenref.sty')), false, 'gardenref.sty must not be manually copied into homework');

  // 2. Scan real vault note to find Group Homomorphism definition
  assert.ok(fs.existsSync(VAULT_CHEAT_SHEET), 'Vault cheat sheet must exist');
  const noteText = fs.readFileSync(VAULT_CHEAT_SHEET, 'utf8');
  const envs = core.scanEnvironments(noteText, 'MATH4281 Exam 1 Cheat Sheet.md');
  const homoEnv = envs.find(e => e.title.toLowerCase().includes('homomorphism') || (e.id && e.id.includes('homomorphism')));
  assert.ok(homoEnv, 'Must find Group Homomorphism definition in vault cheat sheet');
  assert.equal(homoEnv.id, 'def-group-homomorphism');

  // 3. Edit test copy of MATH4281_HW4.tex without adding \usepackage{gardenref}
  const hw4Path = path.join(TEST_WORK_DIR, 'MATH4281_HW4.tex');
  let hw4Content = fs.readFileSync(hw4Path, 'utf8');

  // Ensure NO manual \usepackage{gardenref} is added
  assert.equal(hw4Content.includes('\\usepackage{gardenref}'), false);

  // Replace "kernel of a homomorphism." with \gardenref{def-group-homomorphism}{homomorphism}
  assert.ok(hw4Content.includes('kernel of a homomorphism.'), 'HW4 must contain original phrase');
  const refCmd = core.buildLatexRefCommand('def-group-homomorphism', 'homomorphism');
  hw4Content = hw4Content.replace('kernel of a homomorphism.', `kernel of a ${refCmd}.`);

  // Also insert an unpublished reference to test safe fallback without failing compilation
  const unpubCmd = core.buildLatexRefCommand('def-unpublished-concept', 'draft concept');
  hw4Content = hw4Content.replace('Let $G$ be a finite nontrivial group.', `Let $G$ be a finite nontrivial group with ${unpubCmd}.`);

  fs.writeFileSync(hw4Path, hw4Content, 'utf8');

  // 4. Manifest lifecycle: Approve def-group-homomorphism into isolated manifest
  let manifest = core.createEmptyManifest('https://obsidian.koltensserver.com');
  const { manifest: approvedManifest, snapshot } = core.approveSnapshot(manifest, homoEnv, {
    baseUrl: 'https://obsidian.koltensserver.com',
    status: core.REFERENCE_STATUS.APPROVED_LOCAL
  });
  assert.equal(core.isApproved(approvedManifest, 'def-group-homomorphism'), true);
  assert.equal(core.isApproved(approvedManifest, 'def-unpublished-concept'), false);
  assert.equal(snapshot.status, 'approved_local');

  // 5. Generate gardenrefs.tex in isolated workspace
  const gardenrefsTex = core.exportGardenrefsTex(approvedManifest);
  fs.writeFileSync(path.join(TEST_WORK_DIR, 'gardenrefs.tex'), gardenrefsTex, 'utf8');

  // 6. Test Digital Garden Eleventy build with ISOLATED manifest override
  // Ensure real src/site/_data/latexReferences.json is NOT modified!
  const realManifestPath = path.join(GARDEN_REPO_DIR, 'src/site/_data/latexReferences.json');
  const realManifestBefore = fs.existsSync(realManifestPath) ? fs.readFileSync(realManifestPath, 'utf8') : null;

  fs.writeFileSync(TEST_MANIFEST_FILE, JSON.stringify(approvedManifest, null, 2), 'utf8');

  execFileSync('npx', ['@11ty/eleventy'], {
    cwd: GARDEN_REPO_DIR,
    stdio: 'pipe',
    env: {
      ...process.env,
      LATEX_REFERENCES_MANIFEST_PATH: TEST_MANIFEST_FILE,
      PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH}`
    }
  });

  // Verify isolation: real manifest in repo was NOT touched
  const realManifestAfter = fs.existsSync(realManifestPath) ? fs.readFileSync(realManifestPath, 'utf8') : null;
  assert.equal(realManifestBefore, realManifestAfter, 'Real Digital Garden manifest must not be modified by tests');

  // Verify Eleventy output was generated
  const generatedHtmlPath = path.join(GARDEN_REPO_DIR, 'dist/latex-references/def-group-homomorphism/index.html');
  assert.ok(fs.existsSync(generatedHtmlPath), 'Digital Garden must generate reference page');
  const htmlContent = fs.readFileSync(generatedHtmlPath, 'utf8');
  assert.match(htmlContent, /Group Homomorphism/);
  assert.match(htmlContent, /def-group-homomorphism/);

  // 7. Compile real homework document with latexmk using AUTOMATIC package setup
  const buildDir = path.join(TEST_WORK_DIR, '.latex-build', 'MATH4281_HW4');
  fs.mkdirSync(buildDir, { recursive: true });

  const latexmkOutput = execFileSync('/Library/TeX/texbin/latexmk', [
    '-pdf',
    '-interaction=nonstopmode',
    '-file-line-error',
    '-synctex=1',
    '--jobname=MATH4281_HW4',
    '-usepretex=\\pdfcompresslevel=0\\pdfobjcompresslevel=0\\RequirePackage{etoolbox}\\AtEndPreamble{\\RequirePackage{gardenref}}',
    `-outdir=${buildDir}`,
    'MATH4281_HW4.tex'
  ], {
    cwd: TEST_WORK_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH}`,
      TEXINPUTS: `.:${LATEX_DIR}//:`
    }
  });

  const builtPdf = path.join(buildDir, 'MATH4281_HW4.pdf');
  assert.ok(fs.existsSync(builtPdf), 'latexmk must produce compiled PDF');

  // Copy to destination (as plugin does)
  const finalPdf = path.join(TEST_WORK_DIR, 'MATH4281_HW4.pdf');
  fs.copyFileSync(builtPdf, finalPdf);

  // 8. Verify PDF contents and URI link
  const pdfContent = fs.readFileSync(finalPdf, 'utf8');
  assert.match(pdfContent, /https:\/\/obsidian\.koltensserver\.com\/latex-references\/def-group-homomorphism\//, 'PDF must contain clickable URI for def-group-homomorphism');
  assert.doesNotMatch(pdfContent, /latex-references\/def-unpublished-concept/, 'PDF must NOT create link for unpublished concept');

  // 9. Clean up isolated test dir
  fs.rmSync(TEST_WORK_DIR, { recursive: true, force: true });
});
