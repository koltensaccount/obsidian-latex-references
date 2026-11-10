# User Guide & Workflow

## 1. Opening and Editing LaTeX in Obsidian

1. Click any `.tex` file in your Obsidian vault file tree (or drag a `.tex` project into your vault).
2. The file opens in the native LaTeX editor view with full LaTeX syntax highlighting, line numbers, and line wrapping.

## 2. Linking Mathematical Definitions (Option + L)

1. Highlight a term or formula (e.g. `homomorphism` or `\varphi`).
2. Press **Option + L (⌥ L)**.
3. The searchable popup appears, displaying mathematical definitions, theorems, lemmas, and propositions across your vault.
4. Search and select the environment.
5. The plugin automatically inserts `\gardenref{def-group-homomorphism}{homomorphism}`.
6. If the definition is not yet approved for public publication, the plugin displays the **Approve Reference Snapshot** modal:
   - Review the title, type, and preview of the callout content.
   - Click **Approve & Publish Snapshot**.
   - The snapshot is saved to your local manifest and synchronized to your Digital Garden repo.

## 2. Managing Existing Links & Removing Links

- **Click any existing `\gardenref{id}{display-text}`** inside the LaTeX Live editor (or place the cursor/selection inside it and run **Manage mathematical reference snapshot**) to open the **Manage Reference Snapshot** modal.
- Inspect live publication status (`Published`, `Approved locally`, `Deploying`, `Failed`, `Unpublished`), push updates, re-verify the live URL, or click **Unpublish Reference** to remove the snapshot from Digital Garden.
- Click **Remove Link** in the **Document Link** row to unwrap `\gardenref{id}{display-text}` back into plain `display-text` in that `.tex` document only (preserving undo history with `Cmd+Z` and leaving Digital Garden and Markdown notes unchanged).

## 3. Compiling and Previewing PDFs

1. Click the **Play** button on the editor header, click the ribbon icon (`sigma`), or run **Compile active LaTeX document** from the command palette.
2. The document compiles locally using `latexmk` into an isolated `.latex-build/` folder.
3. A side-by-side PDF preview leaf automatically opens or refreshes.
4. If an error occurs, the editor immediately jumps to the line number and displays an actionable notice with the error description.

## 4. Standalone Compilation & Overleaf Portability

Your homework documents can be compiled from the terminal, CI/CD, or Overleaf without Obsidian running:

```bash
latexmk -pdf MATH4281_HW4.tex
```

Locally, `gardenref.sty` reads `gardenrefs.tex` and generates clickable hyperlinks to `https://obsidian.koltensserver.com/latex-references/<id>/`.

When sharing or copying a `.tex` file + `preamble/preamble.tex` to **Overleaf** or another computer without `gardenref.sty`, `preamble/preamble.tex` checks `\IfFileExists{gardenref.sty}` and automatically falls back to `\providecommand{\gardenref}[2]{#2}`. Every `\gardenref{id}{display-text}` compiles cleanly as plain text or math with no errors, visible IDs, or warnings.

If you paste only a body snippet into an unrelated Overleaf document without `preamble/preamble.tex`, add one line to that document's preamble:

```latex
\providecommand{\gardenref}[2]{#2}
```
