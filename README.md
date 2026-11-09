# Obsidian LaTeX References

> Professional LaTeX homework authoring in Obsidian with clickable mathematical definition publishing to Digital Garden.

`obsidian-latex-references` replaces the need for Overleaf by providing a fast, native `.tex` editing experience in Obsidian, on-demand local compilation with `latexmk`, side-by-side PDF preview, and seamless Option+L (⌥ L) mathematical callout linking.

---

## Key Features

1. **Native LaTeX Authoring**:
   - Open and edit `.tex`, `.sty`, and `.cls` documents directly in Obsidian.
   - CodeMirror 6 syntax highlighting via `stex`, line numbers, and line wrapping.
   - Zero Markdown conversion required.

2. **The Option + L Reference Workflow in LaTeX**:
   - Highlight any math term (e.g. `homomorphism` or `\varphi`).
   - Press **Option + L (⌥ L)** to open the familiar mathematical environment picker.
   - Select definitions, theorems, or lemmas across your vault.
   - Inserts `\gardenref{stable-id}{wording}` preserving selected text.
   - Fully independent of `callout-links` (no shared mutable state or runtime dependencies).

3. **Explicit Digital Garden Publishing**:
   - Approving a reference publishes a standalone snapshot to `/latex-references/<id>/` on your existing Digital Garden website.
   - Preserves high-fidelity MathJax math rendering.
   - Completely unlisted: excluded from website search, filetree, and graph views.
   - Never exposes private notes, surrounding text, or attachments.

4. **Standalone LaTeX Package (`gardenref.sty`)**:
   - Compiles anywhere without Obsidian running.
   - Resolves references to clickable hyperlinks in generated PDFs.
   - Safe fallbacks: unpublished references render as plain text and emit compiler warnings.

5. **Integrated Compilation & Live Preview**:
   - Compiles via local `latexmk` into an isolated `.latex-build/` directory.
   - Displays line-numbered diagnostics with click-to-line navigation.
   - Refreshes side-by-side PDF preview automatically.

---

## Repository Structure

```
obsidian-latex-references/
├── obsidian-plugin/      # Obsidian desktop plugin (CodeMirror 6, picker, compiler UI)
├── reference-core/       # Headless indexing, identity resolution & manifest logic
├── latex/                # gardenref.sty standalone LaTeX package & macros
├── garden-plugin/        # Digital Garden Eleventy extension for unlisted reference pages
├── tests/                # Full test suites (e2e, isolation, homework compatibility)
└── docs/                 # Architecture, usage, and troubleshooting guides
```

---

## Verification & Testing

Run all test suites across the project:

```bash
npm test
```

- **Reference Core Tests**: `node --test reference-core/tests/*.test.cjs`
- **LaTeX Package Verification**: `./latex/tests/run_tests.sh`
- **End-to-End Prototype**: `node --test tests/e2e_prototype.test.cjs`
- **Architectural Isolation**: `node --test tests/isolation_verification.test.cjs`
- **Real Homework Compatibility**: `node --test tests/homework_compatibility.test.cjs` (Verifies all 9 documents: HW1–HW8 + EXAM1_Review)

---

## License

[MIT](LICENSE) © 2026 Kolten Bendickson
