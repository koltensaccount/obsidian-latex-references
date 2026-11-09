# `latex-references` — Digital Garden Extension

A modular extension for the Digital Garden Eleventy website template that generates standalone, unlisted mathematical reference pages for academic LaTeX homework documents.

## Features

- **Dedicated Namespace**: Pages are hosted at `/latex-references/<stable-id>/`.
- **Full MathJax Rendering**: Mathematical formulas (`$...$` and `$$...$$`) inside definitions and theorems render with high-fidelity SVG/MathML.
- **Privacy & Discovery Isolation**: Reference pages are marked `eleventyExcludeFromCollections: true` with `<meta name="robots" content="noindex, nofollow">`. They are excluded from site search (`dg-search`), folder navigation (`dg-filetree`), and graph views.
- **Snapshot Immutability**: Pages display approved snapshot states, protecting public homework links from unexpected drafts or accidental vault edits.
- **Zero Vault Duplication**: Generated purely from the manifest artifact (`latexReferences.json`), leaving your regular notes and folders untouched.

## Installation into Digital Garden

1. Copy or symlink this folder into your Digital Garden repository:
   ```bash
   cp -r garden-plugin/ <path-to-garden>/src/plugins/latex-references/
   ```
2. Enable the plugin in `<path-to-garden>/src/plugins/plugins.json`:
   ```json
   "latex-references": {
     "enabled": true,
     "order": 90
   }
   ```
3. Run Eleventy build:
   ```bash
   npx @11ty/eleventy
   ```
