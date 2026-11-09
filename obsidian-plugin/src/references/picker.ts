import { App, Notice, SuggestModal, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type LatexReferencesPlugin from "../main";
import {
  ensureBlockId,
  buildLatexRefCommand,
  isApproved,
  type CalloutEnvironment
} from "../../../reference-core/src/index";
import { ApprovalModal } from "./approval-modal";

export class ReferencePickerModal extends SuggestModal<CalloutEnvironment> {
  private plugin: LatexReferencesPlugin;
  private editorView: EditorView;
  private items: CalloutEnvironment[];

  constructor(app: App, plugin: LatexReferencesPlugin, editorView: EditorView, items: CalloutEnvironment[]) {
    super(app);
    this.plugin = plugin;
    this.editorView = editorView;
    this.items = items;
    this.setPlaceholder("Find a definition, formula, theorem, lemma…");
    this.limit = 100;
  }

  getSuggestions(query: string): CalloutEnvironment[] {
    const pieces = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!pieces.length) {
      return this.items.slice(0, 100);
    }
    const results = this.items.filter((item) => {
      const haystack = `${item.title} ${item.type} ${item.filePath} ${item.id || ""} ${item.body || ""}`.toLowerCase();
      return pieces.every((p) => haystack.includes(p));
    });

    const needle = query.toLowerCase().trim();
    return results
      .sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const aRank = aTitle === needle ? 0 : aTitle.startsWith(needle) ? 1 : 2;
        const bRank = bTitle === needle ? 0 : bTitle.startsWith(needle) ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        const titleCmp = aTitle.localeCompare(bTitle);
        if (titleCmp !== 0) return titleCmp;
        return a.filePath.localeCompare(b.filePath);
      })
      .slice(0, 100);
  }

  renderSuggestion(item: CalloutEnvironment, el: HTMLElement): void {
    el.empty();
    el.addClass("cl-suggestion-item");

    const topRow = el.createDiv({ cls: "cl-suggestion-header" });
    topRow.createSpan({ text: item.title, cls: "cl-suggestion-title" });

    const badge = topRow.createSpan({ cls: `cl-type-badge cl-badge-${item.type}` });
    badge.setText(item.type.toUpperCase());

    if (item.fold) {
      const foldBadge = topRow.createSpan({ cls: "cl-fold-badge" });
      foldBadge.setText(item.fold === "+" ? "EXPANDED" : "COLLAPSED");
    }

    if (item.id) {
      topRow.createSpan({ text: `^${item.id}`, cls: "cl-id-badge" });
    }

    const metaRow = el.createDiv({ cls: "cl-suggestion-meta" });
    metaRow.createSpan({ text: item.filePath, cls: "cl-suggestion-path" });

    const published = isApproved(this.plugin.referencesManifest, item.id || "");
    const pubBadge = metaRow.createSpan({
      cls: published ? "latex-ref-badge-pub" : "latex-ref-badge-unpub",
      text: published ? "PUBLISHED" : "UNPUBLISHED"
    });

    if (item.body) {
      const firstLine = item.body.split("\n").find((l) => l.trim().length > 0) || "";
      if (firstLine) {
        const preview = firstLine.length > 90 ? firstLine.slice(0, 87) + "…" : firstLine;
        el.createDiv({ text: preview, cls: "cl-suggestion-preview" });
      }
    }
  }

  async onChooseSuggestion(item: CalloutEnvironment): Promise<void> {
    try {
      let targetId = item.id;
      let finalTarget = item;

      // 1. Ensure block ID exists in the source markdown file
      if (!targetId) {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
          const reservedIds = this.plugin.vaultIndexer.getAllReservedIds();
          let ensureRes: any;
          await this.app.vault.process(file, (content) => {
            ensureRes = ensureBlockId(content, item, reservedIds);
            return ensureRes.text;
          });
          targetId = ensureRes.id;
          finalTarget = ensureRes.target;
          await this.plugin.vaultIndexer.updateFileIndex(file);
        } else {
          throw new Error(`Source note file not found: ${item.filePath}`);
        }
      }

      if (!targetId) {
        throw new Error("Could not determine or create block ID for target.");
      }

      // 2. Insert LaTeX reference command into CodeMirror buffer
      const selection = this.editorView.state.selection.main;
      const selectedText = this.editorView.state.sliceDoc(selection.from, selection.to);
      const replacementText = buildLatexRefCommand(targetId, selectedText || item.title);

      this.editorView.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: replacementText
        },
        selection: { anchor: selection.from + replacementText.length }
      });
      this.editorView.focus();

      // 3. Check publishing status
      const published = isApproved(this.plugin.referencesManifest, targetId);
      if (!published) {
        new Notice(`Inserted reference ^${targetId}. It is currently unpublished.`, 5000);
        // Prompt user to approve snapshot if desired
        new ApprovalModal(this.app, this.plugin, finalTarget).open();
      } else {
        new Notice(`Linked to reference: ^${targetId}`);
      }
    } catch (e) {
      new Notice(`Error inserting reference: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
  }
}
