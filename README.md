# Obsidian LaTeX References

> Professional LaTeX homework authoring in Obsidian with clickable mathematical definition publishing to Digital Garden.

`obsidian-latex-references` pairs with the open-source **LaTeX Live** editor to provide an Overleaf-replacement authoring experience in Obsidian: live editing, reliable undo/redo, snippet expansion with LaTeX Suite, high-speed PDF compilation with SyncTeX, and our custom **Option + L (⌥ L)** mathematical callout linking workflow.

---

## Architectural Model

```
┌─────────────────────────────────────────────────────────────┐
│ Obsidian Desktop Environment                                │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │      LaTeX Live       │       │ obsidian-latex-ref    │  │
│  │  (Editor & Compiler)  │       │ (Reference Extension) │  │
│  │                       │       │                       │  │
│  │ • .tex & .sty editing │<──────│ • Option+L Picker     │  │
│  │ • Cmd+Z Undo / Redo   │  via  │ • Vault Math Callouts │  │
│  │ • LaTeX Suite Snippet │  API  │ • Stable Identities   │  │
│  │ • PDF Canvas Preview  │       │ • Snapshot Approvals  │  │
│  │ • SyncTeX navigation  │       │ • gardenrefs.tex Sync │  │
│  └───────────┬───────────┘       └───────────┬───────────┘  │
│              │                               │              │
└──────────────┼───────────────────────────────┼──────────────┘
               ▼                               ▼
       ┌───────────────┐               ┌───────────────┐
       │ Homework PDF  │               │Digital Garden │
       │ (with links)  │               │ (/latex-ref/) │
       └───────────────┘               └───────────────┘
```

1. **LaTeX Live owns LaTeX editing, syntax, autocompletion, snippets, and PDF compilation**:
   - Native CodeMirror 6 editor with full macOS keyboard shortcut fidelity (`Cmd+Z`, `Cmd+Shift+Z`, `Cmd+S`, `Cmd+Enter`).
   - Seamless snippet expansion powered by `obsidian-latex-suite`.
   - Dual-mode editing: clean code source mode and live rendered math mode.
   - Side-by-side native canvas PDF preview with SyncTeX forward/reverse navigation.
   - Fault-tolerant builds: preserves the last successful PDF on syntax errors.

2. **LaTeX References provides the mathematical reference system**:
   - Integrates via LaTeX Live's official `registerTexEditorExtension` API.
   - **Option + L (⌥ L)** opens the searchable mathematical reference picker.
   - Searches definitions, theorems, lemmas, formulas across all course notes.
   - Inserts `\gardenref{stable-id}{selected text}`.
   - Maintains the 5-state publication lifecycle: `Draft` → `Approved Locally` → `Awaiting Deploy` → `Published` / `Deploy Failed`.

3. **Digital Garden publishes approved references**:
   - Approved references are deployed to `https://obsidian.koltensserver.com/latex-references/<id>/`.
   - Unlisted: excluded from website navigation, search index, and graph view.
   - Clickable links in compiled homework PDFs open directly to the published reference snapshot.

4. **Standalone LaTeX Package (`gardenref.sty`)**:
   - Installed globally in `~/Library/texmf/tex/latex/gardenref/gardenref.sty`.
   - Compiles anywhere without Obsidian running (command-line `latexmk`, Overleaf, CI/CD).
   - Resolves references using local `gardenrefs.tex`.
   - Graceful fallback: unpublished references render as plain text and emit compiler warnings.

---

## The Option + L Workflow

1. Open any `.tex` homework file (e.g. `MATH4281_HW8.tex`).
2. Highlight a mathematical term (e.g., `homomorphism`).
3. Press **Option + L (⌥ L)**:
   - Search the definition (e.g. "Group Homomorphism").
   - Hit Enter or click the suggestion.
4. The term becomes `\gardenref{def-group-homomorphism}{homomorphism}`.
5. Save/compile (`Cmd+S` or `Cmd+Enter`):
   - PDF renders immediately with a blue clickable hyperlink.
   - Clicking the link navigates to `https://obsidian.koltensserver.com/latex-references/def-group-homomorphism/`.

---

## Repository Structure

```
obsidian-latex-references/
├── obsidian-plugin/      # Lightweight Obsidian reference extension (26KB bundle)
├── reference-core/       # Pure TypeScript indexing, identity resolution & manifest logic
├── latex/                # gardenref.sty standalone LaTeX package & tests
├── garden-plugin/        # Digital Garden Eleventy templates & data handlers
├── tests/                # Full test suites (e2e, isolation, homework compatibility)
└── docs/                 # Architecture & verification records
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
- **Real Homework Compatibility**: `node --test tests/homework_compatibility.test.cjs` (All 9 documents: HW1–HW8 + EXAM1_Review)

---

## License

[MIT](LICENSE) © 2026 Kolten Bendickson
