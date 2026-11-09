# Troubleshooting & FAQ

### Compiler says: `Reference target '<id>' is unpublished or missing from manifest`
- **Cause**: A `\gardenref{id}{text}` command was inserted, but the definition has not yet been approved for publication in `gardenrefs.tex`.
- **Behavior**: LaTeX safely renders the text as plain prose without a broken hyperlink.
- **Resolution**: Open the document in Obsidian, place cursor on the reference, and approve the snapshot, or recompile via Obsidian to regenerate `gardenrefs.tex`.

### PDF preview does not update
- Click the **Toggle PDF preview** icon in the editor title bar.
- Verify that `latexmk` succeeded without fatal errors.

### Hotkey Option + L does not open picker
- Ensure the `.tex` editor view is focused (the cursor is inside the editor).
- Verify the shortcut `Alt-l` in your macOS system preferences (make sure it is not hijacked by an OS-level shortcut).
- You can also run the command **Insert LaTeX callout reference** from the Obsidian Command Palette (`Cmd + P`).

### How to Roll Back or Uninstall
- **To disable in Obsidian**: Turn off `LaTeX References` under Settings -> Community Plugins. Your Markdown notes and Callout Links remain 100% operational.
- **To remove from Digital Garden**: Delete `src/plugins/latex-references/` and remove its entry from `src/plugins/plugins.json`. Rebuild the site.
- **Previously compiled PDFs**: Remain valid indefinitely.
