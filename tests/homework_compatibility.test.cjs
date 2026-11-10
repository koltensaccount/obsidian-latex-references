'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOMEWORK_ORIGINAL_DIR = '/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/School/Fall 2026/Introduction to Modern Algebra/LaTeX';
const TEST_ISOLATED_DIR = '/tmp/latex-homework-compatibility-test';

test('Phase D: Real Homework Compatibility Suite (HW1-HW8, EXAM1_Review)', () => {
  // 1. Snapshot original file hashes to ensure read-only preservation
  const originalFiles = fs.readdirSync(HOMEWORK_ORIGINAL_DIR);
  const originalHashes = new Map();
  const crypto = require('crypto');

  for (const f of originalFiles) {
    const full = path.join(HOMEWORK_ORIGINAL_DIR, f);
    if (fs.statSync(full).isFile() && f.endsWith('.tex')) {
      const content = fs.readFileSync(full);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      originalHashes.set(f, hash);
    }
  }

  // 2. Setup isolated workspace
  if (fs.existsSync(TEST_ISOLATED_DIR)) {
    fs.rmSync(TEST_ISOLATED_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_ISOLATED_DIR, { recursive: true });

  for (const f of originalFiles) {
    if (f.startsWith('.') || f.endsWith('.pdf')) continue;
    const src = path.join(HOMEWORK_ORIGINAL_DIR, f);
    const dest = path.join(TEST_ISOLATED_DIR, f);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // 3. Documents to test
  const documents = [
    'EXAM1_Review.tex',
    'MATH4281_HW1.tex',
    'MATH4281_HW2.tex',
    'MATH4281_HW3.tex',
    'MATH4281_HW4.tex',
    'MATH4281_HW5.tex',
    'MATH4281_HW6.tex',
    'MATH4281_HW7.tex',
    'MATH4281_HW8.tex'
  ];

  const results = [];

  for (const doc of documents) {
    const docPath = path.join(TEST_ISOLATED_DIR, doc);
    assert.ok(fs.existsSync(docPath), `Document ${doc} must exist in test directory`);

    const baseName = path.parse(doc).name;
    const buildDir = path.join(TEST_ISOLATED_DIR, '.latex-build', baseName);
    fs.mkdirSync(buildDir, { recursive: true });

    const startTime = Date.now();
    let ok = true;
    let log = '';

    try {
      log = execFileSync('/Library/TeX/texbin/latexmk', [
        '-pdf',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-synctex=1',
        `-outdir=${buildDir}`,
        doc
      ], {
        cwd: TEST_ISOLATED_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH || ''}`
        },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 180000
      });
    } catch (e) {
      ok = false;
      log = (e.stdout || '') + '\n' + (e.stderr || '');
    }

    const duration = Date.now() - startTime;
    const generatedPdf = path.join(buildDir, `${baseName}.pdf`);
    const pdfExists = fs.existsSync(generatedPdf);
    const pdfSize = pdfExists ? fs.statSync(generatedPdf).size : 0;

    results.push({
      doc,
      ok,
      pdfExists,
      pdfSize,
      duration
    });

    console.log(`Compiled ${doc}: ${ok ? 'SUCCESS' : 'FAILED'} (${duration}ms, ${pdfSize} bytes)`);
    assert.ok(pdfExists, `Compiled PDF for ${doc} must be generated`);
    assert.ok(pdfSize > 1000, `Compiled PDF for ${doc} must have valid non-trivial size`);
  }

  // 4. Verify original files were NOT touched
  for (const [f, expectedHash] of originalHashes.entries()) {
    const full = path.join(HOMEWORK_ORIGINAL_DIR, f);
    const content = fs.readFileSync(full);
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, expectedHash, `Original homework file ${f} must be 100% untouched`);
  }

  // Clean up test workspace
  fs.rmSync(TEST_ISOLATED_DIR, { recursive: true, force: true });
});
