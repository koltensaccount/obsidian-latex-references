import { App, Notice, SuggestModal, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type LatexReferencesPlugin from "../main";
import {
  ensureBlockId,
  buildLatexRefCommand,
  getReferenceStatus,
  getSnapshot,
  getStatusLabel,
  isPublished,
  REFERENCE_STATUS,
  type CalloutEnvironment,
  type ReferencesManifest
} from "../../../reference-core/src/index";
import { ApprovalModal } from "./approval-modal";

export function filterAndSortEnvironments(items: CalloutEnvironment[], query: string): CalloutEnvironment[] {
  const pieces = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!pieces.length) {
    return items.slice(0, 100);
  }
  const results = items.filter((item) => {
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

export function renderReferenceSuggestionItem(
  manifest: ReferencesManifest,
  item: CalloutEnvironment,
  el: HTMLElement
): void {
  el.empty();
  el.addClass("cl-suggestion-item");

  const topRow = el.createDiv({ cls: "cl-suggestion-header" });
  topRow.createSpan({ text: item.title, cls: "cl-suggestion-title" });

  const formattedType = item.type
    ? item.type.charAt(0).toUpperCase() + item.type.slice(1).toLowerCase()
    : "";
  if (formattedType) {
    topRow.createSpan({ text: formattedType, cls: `cl-type-badge cl-badge-${item.type.toLowerCase()}` });
  }

  const status = getReferenceStatus(manifest, item.id || "");
  topRow.createSpan({
    cls: `cl-pub-status is-${status}`,
    text: getStatusLabel(status)
  });

  const metaRow = el.createDiv({ cls: "cl-suggestion-meta" });
  metaRow.createSpan({ text: item.filePath, cls: "cl-suggestion-path" });

  if (item.body) {
    const firstLine = item.body.split("\n").find((l) => l.trim().length > 0) || "";
    if (firstLine) {
      const preview = firstLine.length > 90 ? firstLine.slice(0, 87) + "…" : firstLine;
      el.createDiv({ text: preview, cls: "cl-suggestion-preview" });
    }
  }
}

export class ReferencePickerModal extends SuggestModal<CalloutEnvironment> {
  private plugin: LatexReferencesPlugin;
  private editorView: EditorView;
  private items: CalloutEnvironment[];
  private initialSelection: { from: number; to: number };
  private selectedText: string;

  constructor(app: App, plugin: LatexReferencesPlugin, editorView: EditorView, items: CalloutEnvironment[]) {
    super(app);
    this.plugin = plugin;
    this.editorView = editorView;
    this.items = items;
    const sel = editorView.state.selection.main;
    this.initialSelection = { from: sel.from, to: sel.to };
    this.selectedText = editorView.state.sliceDoc(sel.from, sel.to);
    this.setPlaceholder("Find a definition, formula, theorem, lemma…");
    this.limit = 100;
  }

  getSuggestions(query: string): CalloutEnvironment[] {
    return filterAndSortEnvironments(this.items, query);
  }

  renderSuggestion(item: CalloutEnvironment, el: HTMLElement): void {
    renderReferenceSuggestionItem(this.plugin.referencesManifest, item, el);
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
      const from = this.initialSelection.from;
      const to = this.initialSelection.to;
      const selectedText = this.selectedText;
      const replacementText = buildLatexRefCommand(targetId, selectedText || item.title);

      this.editorView.dispatch({
        changes: {
          from: from,
          to: to,
          insert: replacementText
        },
        selection: { anchor: from + replacementText.length }
      });
      this.editorView.focus();

      // Ensure gardenrefs.tex is updated immediately with verified-live mappings only
      await this.plugin.syncActiveGardenrefsTex();

      // 3. Check publishing status accurately
      const status = getReferenceStatus(this.plugin.referencesManifest, targetId);
      const snapshot = getSnapshot(this.plugin.referencesManifest, targetId);
      if (isPublished(this.plugin.referencesManifest, targetId)) {
        new Notice(`Linked to live reference: ^${targetId}`);
      } else if (status === REFERENCE_STATUS.APPROVED_LOCAL) {
        if (snapshot?.publishedAt) {
          new Notice(`Linked ^${targetId}. Updated snapshot is approved locally — push to update the live page.`, 5000);
        } else {
          new Notice(`Inserted ^${targetId}. Approved locally only (plain text in PDF until pushed & verified live).`, 6000);
        }
        new ApprovalModal(this.app, this.plugin, finalTarget).open();
      } else if (status === REFERENCE_STATUS.AWAITING_DEPLOY) {
        new Notice(`Inserted ^${targetId}. Deployment in progress — PDF link will activate once live.`, 6000);
        new ApprovalModal(this.app, this.plugin, finalTarget).open();
      } else if (status === REFERENCE_STATUS.DEPLOY_FAILED) {
        new Notice(`Inserted ^${targetId}. Publication check failed — open modal to retry.`, 6000);
        new ApprovalModal(this.app, this.plugin, finalTarget).open();
      } else {
        new Notice(`Inserted reference ^${targetId}. It is currently unpublished.`, 5000);
        new ApprovalModal(this.app, this.plugin, finalTarget).open();
      }
    } catch (e) {
      new Notice(`Error inserting reference: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
  }
}

export class ManageReferencePickerModal extends SuggestModal<CalloutEnvironment> {
  private plugin: LatexReferencesPlugin;
  private items: CalloutEnvironment[];

  constructor(app: App, plugin: LatexReferencesPlugin, items: CalloutEnvironment[]) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.setPlaceholder("Manage snapshot: search definition, theorem, formula…");
    this.limit = 100;
  }

  getSuggestions(query: string): CalloutEnvironment[] {
    return filterAndSortEnvironments(this.items, query);
  }

  renderSuggestion(item: CalloutEnvironment, el: HTMLElement): void {
    renderReferenceSuggestionItem(this.plugin.referencesManifest, item, el);
  }

  onChooseSuggestion(item: CalloutEnvironment): void {
    new ApprovalModal(this.app, this.plugin, item).open();
  }
}
