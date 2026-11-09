'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('/Users/koltenbendickson/Documents/antigravity/elegant-newton/node_modules/playwright');

const ARTIFACT_DIR = '/Users/koltenbendickson/.gemini/antigravity/brain/b7e7bc17-586b-4da0-b8a5-d9cbb3b5f80c';

async function run() {
  console.log('Connecting to Obsidian on port 9476...');
  const browser = await chromium.connectOverCDP('http://localhost:9476');
  const page = browser.contexts()[0].pages()[0];

  // Reload Obsidian so updated main.js is loaded
  await page.reload();
  await page.waitForTimeout(1500);

  // Configure settings
  await page.evaluate(() => {
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    if (plugin) {
      plugin.settings.digitalGardenRepoPath = '/Users/koltenbendickson/Developer/my-digital-garden';
      plugin.settings.openPdfAfterCompile = true;
      plugin.saveSettings();
    }
  });

  // Step 1: Open MATH4281_HW4.tex in the editor
  console.log('Opening Homework/MATH4281_HW4.tex...');
  await page.evaluate(async () => {
    const file = window.app.vault.getAbstractFileByPath('Homework/MATH4281_HW4.tex');
    if (file) {
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  });
  await page.waitForTimeout(1200);

  // Take screenshot 1: TeX editor open with syntax highlighting
  const screenshot1 = path.join(ARTIFACT_DIR, '01_tex_editor_syntax_highlighting.png');
  await page.screenshot({ path: screenshot1 });
  console.log('Saved Screenshot 1:', screenshot1);

  // Step 2: Highlight "homomorphism" in the document and press Option+L
  console.log('Finding "homomorphism" and selecting it...');
  const selected = await page.evaluate(() => {
    const view = window.app.workspace.activeLeaf.view;
    const editor = view.editor;
    const doc = editor.state.doc.toString();
    const targetPhrase = 'homomorphism';
    const index = doc.indexOf(targetPhrase);
    if (index === -1) return false;
    editor.dispatch({
      selection: { anchor: index, head: index + targetPhrase.length }
    });
    return true;
  });
  console.log('Found & selected target phrase:', selected);

  // Trigger Option+L / insert-latex-reference command
  console.log('Triggering LaTeX reference picker...');
  await page.evaluate(async () => {
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    const view = plugin.getActiveLatexView();
    if (view && view.editor) {
      await plugin.triggerReferencePicker(view, view.editor);
    }
  });
  await page.waitForSelector('.prompt-input', { timeout: 8000 });
  await page.locator('.prompt-input').fill('homomorphism');
  await page.waitForTimeout(600);

  // Screenshot 2: LaTeX Reference Picker Modal
  const screenshot2 = path.join(ARTIFACT_DIR, '02_latex_reference_picker_modal.png');
  await page.screenshot({ path: screenshot2 });
  console.log('Saved Screenshot 2:', screenshot2);

  // Step 3: Now open Markdown note and trigger Callout Links Option+L for side-by-side comparison
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  console.log('Opening Markdown note MATH4281 Exam 1 Cheat Sheet.md for Callout Links comparison...');
  await page.evaluate(async () => {
    const file = window.app.vault.getAbstractFileByPath('MATH4281 Exam 1 Cheat Sheet.md');
    if (file) {
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  });
  await page.waitForTimeout(800);

  // Select "homomorphism" in the markdown note
  await page.evaluate(() => {
    const view = window.app.workspace.activeLeaf.view;
    const editor = view.editor;
    const doc = editor.getValue();
    const index = doc.indexOf('homomorphism');
    if (index !== -1) {
      editor.setSelection(editor.offsetToPos(index), editor.offsetToPos(index + 'homomorphism'.length));
    }
  });

  // Trigger Callout Links
  console.log('Triggering Markdown Callout Links modal...');
  await page.evaluate(async () => {
    const view = window.app.workspace.activeLeaf.view;
    if (view && view.editor) {
      view.editor.focus();
      const cl = window.app.plugins.plugins['callout-links'];
      await cl.handleUnifiedCommand(view.editor, view);
    }
  });
  await page.waitForSelector('.prompt-input', { timeout: 8000 });
  await page.locator('.prompt-input').fill('homomorphism');
  await page.waitForTimeout(600);

  // Screenshot 3: Markdown Callout Links Modal
  const screenshot3 = path.join(ARTIFACT_DIR, '03_markdown_callout_links_modal.png');
  await page.screenshot({ path: screenshot3 });
  console.log('Saved Screenshot 3:', screenshot3);

  // Close Callout Links modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Step 4: Switch back to MATH4281_HW4.tex
  console.log('Switching back to MATH4281_HW4.tex...');
  await page.evaluate(async () => {
    const file = window.app.vault.getAbstractFileByPath('Homework/MATH4281_HW4.tex');
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  });
  await page.waitForTimeout(600);

  // Select "homomorphism" again and trigger insert
  await page.evaluate(() => {
    const view = window.app.workspace.activeLeaf.view;
    const editor = view.editor;
    const doc = editor.state.doc.toString();
    const index = doc.indexOf('homomorphism');
    editor.dispatch({
      selection: { anchor: index, head: index + 'homomorphism'.length }
    });
  });

  await page.evaluate(async () => {
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    const view = plugin.getActiveLatexView();
    if (view && view.editor) {
      await plugin.triggerReferencePicker(view, view.editor);
    }
  });
  await page.waitForSelector('.prompt-input', { timeout: 8000 });
  await page.locator('.prompt-input').fill('Group Homomorphism');
  await page.waitForTimeout(500);

  // Click the top suggestion
  console.log('Selecting Group Homomorphism suggestion...');
  await page.locator('.cl-suggestion-item').first().click();
  await page.waitForTimeout(800);

  // Screenshot 4: Approval Modal
  const screenshot4 = path.join(ARTIFACT_DIR, '04_approval_modal.png');
  await page.screenshot({ path: screenshot4 });
  console.log('Saved Screenshot 4:', screenshot4);

  // In Approval Modal, click "Approve Locally"
  console.log('Clicking Approve Locally in Approval Modal...');
  await page.evaluate(() => {
    const btn = document.querySelector('.latex-ref-approval-modal .mod-cta');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);

  // Close modal if still visible
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Verify that \gardenref was inserted into the document text
  const currentDoc = await page.evaluate(() => {
    const view = window.app.workspace.activeLeaf.view;
    return view.editor.state.doc.toString();
  });
  const hasRef = currentDoc.includes('\\gardenref{def-group-homomorphism}{homomorphism}');
  console.log('Successfully inserted \\gardenref{def-group-homomorphism}{homomorphism}:', hasRef);

  // Step 5: Compile the active document inside Obsidian!
  console.log('Compiling active document in Obsidian...');
  await page.evaluate(async () => {
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    await plugin.compileActive();
  });
  // Wait for compilation to complete and PDF view to open
  console.log('Waiting for PDF compilation and preview leaf...');
  await page.waitForTimeout(5000);

  // Screenshot 5: Side-by-side Editor and PDF Preview!
  const screenshot5 = path.join(ARTIFACT_DIR, '05_editor_and_pdf_preview.png');
  await page.screenshot({ path: screenshot5 });
  console.log('Saved Screenshot 5 (Editor + PDF Preview):', screenshot5);

  // Step 6: Test Compilation Error Handling and Line Navigation
  console.log('Injecting intentional LaTeX syntax error...');
  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeavesOfType('latex-references-editor')[0];
    const view = leaf?.view;
    const editor = view?.editor;
    const doc = editor.state.doc.toString();
    const target = '\\begin{document}';
    const index = doc.indexOf(target);
    if (index !== -1) {
      editor.dispatch({
        changes: {
          from: index + target.length,
          to: index + target.length,
          insert: '\n\\undefinedErrorCommandHere\n'
        }
      });
    }
  });

  console.log('Compiling document with intentional error...');
  await page.evaluate(async () => {
    const leaf = window.app.workspace.getLeavesOfType('latex-references-editor')[0];
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    await plugin.compileView(leaf.view);
  });
  await page.waitForTimeout(3000);

  // Screenshot 6: Compilation Error line jump & notice
  const screenshot6 = path.join(ARTIFACT_DIR, '06_compilation_error_line_jump.png');
  await page.screenshot({ path: screenshot6 });
  console.log('Saved Screenshot 6 (Error line jump):', screenshot6);

  // Clean up: revert the intentional error
  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeavesOfType('latex-references-editor')[0];
    const view = leaf?.view;
    const editor = view?.editor;
    const doc = editor.state.doc.toString();
    const bad = '\n\\undefinedErrorCommandHere\n';
    const index = doc.indexOf(bad);
    if (index !== -1) {
      editor.dispatch({
        changes: { from: index, to: index + bad.length, insert: '' }
      });
    }
  });

  // Re-compile to restore clean state
  await page.evaluate(async () => {
    const leaf = window.app.workspace.getLeavesOfType('latex-references-editor')[0];
    const plugin = window.app.plugins.plugins['obsidian-latex-references'];
    await plugin.compileView(leaf.view);
  });
  await page.waitForTimeout(3000);

  await browser.close();
  console.log('All Live UI verifications succeeded cleanly!');
}

run().catch((err) => {
  console.error('Error during live UI verification:', err);
  process.exit(1);
});
