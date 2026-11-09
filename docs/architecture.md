# Architecture Specification

## Overview

`obsidian-latex-references` is designed from the ground up for **absolute decoupling and independence**:

1. **Obsidian LaTeX Editor View**:
   - Implemented as an Obsidian `TextFileView` registering `.tex`, `.sty`, and `.cls` file extensions.
   - CodeMirror 6 editor with `stex` syntax highlighting, line wrapping, line numbers, and custom keymap.
   - Local on-demand compilation via `latexmk`.
   - Side-by-side PDF preview using an isolated iframe viewer.

2. **Keyboard Dispatch & Shortcut Coexistence**:
   - When editing Markdown: Obsidian routes `Alt+L` (⌥ L) to `callout-links:insert-callout-reference`.
   - When editing LaTeX: CodeMirror 6's view keymap intercepts `Alt-l` exclusively on the focused `.tex` buffer and invokes the LaTeX reference picker modal.
   - Neither plugin wraps or overrides the other's hotkey handlers; there are zero conflicts and zero double popups.

3. **Stable Identity & Drift Detection**:
   - Math callouts are discovered lazily and cached per file.
   - Stable IDs follow standard conventions (`def-<slug>`, `thm-<slug>`).
   - The manifest retains approved content hashes. If a note is edited in the vault, the published reference remains frozen until the user explicitly approves the updated snapshot.
   - If a source Markdown file is renamed or moved in the vault, the public URL `/latex-references/<id>/` remains identical.

4. **Digital Garden Integration**:
   - Plugs directly into the site's Eleventy build pipeline via `src/plugins/latex-references/`.
   - Generates virtual pages from `src/site/_data/latexReferences.json`.
   - Completely excluded from search index, folder trees, and local graphs.
