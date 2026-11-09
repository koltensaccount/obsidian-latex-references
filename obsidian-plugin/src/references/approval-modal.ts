import { App, Modal, Notice, Setting } from "obsidian";
import type LatexReferencesPlugin from "../main";
import {
  approveSnapshot,
  unpublishSnapshot,
  isApproved,
  type CalloutEnvironment
} from "../../../reference-core/src/index";

export class ApprovalModal extends Modal {
  private plugin: LatexReferencesPlugin;
  private target: CalloutEnvironment;
  private onComplete?: () => void;

  constructor(app: App, plugin: LatexReferencesPlugin, target: CalloutEnvironment, onComplete?: () => void) {
    super(app);
    this.plugin = plugin;
    this.target = target;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("latex-ref-approval-modal");

    const approved = isApproved(this.plugin.manifest, this.target.id || "");

    contentEl.createEl("h2", { text: approved ? "Manage Reference Snapshot" : "Approve Reference Snapshot" });

    const statusPill = contentEl.createDiv({ cls: "latex-ref-status-banner" });
    if (approved) {
      statusPill.createSpan({ cls: "latex-ref-status-approved", text: "✓ Approved & Published" });
    } else {
      statusPill.createSpan({ cls: "latex-ref-status-draft", text: "⚠ Draft / Unpublished" });
    }

    const infoList = contentEl.createEl("div", { cls: "latex-ref-info-box" });
    infoList.createDiv({ text: `Title: ${this.target.title}` });
    infoList.createDiv({ text: `Type: ${this.target.type}` });
    infoList.createDiv({ text: `ID: ^${this.target.id || "(none)"}` });
    infoList.createDiv({ text: `Source: ${this.target.filePath}` });

    contentEl.createEl("h4", { text: "Callout Snapshot Preview" });
    const previewBox = contentEl.createEl("pre", { cls: "latex-ref-body-preview" });
    previewBox.setText(this.target.body || "");

    contentEl.createEl("p", {
      cls: "latex-ref-approval-desc",
      text: "Unlisted reference pages are publicly accessible to anyone with their URL under /latex-references/<id>/, but excluded from site search, navigation, and graphs."
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(approved ? "Update Snapshot" : "Approve & Publish Snapshot")
          .setCta()
          .onClick(async () => {
            try {
              const res = approveSnapshot(this.plugin.manifest, this.target, {
                baseUrl: this.plugin.settings.baseUrl
              });
              this.plugin.manifest = res.manifest;
              await this.plugin.saveManifest();
              new Notice(`Approved reference: ${this.target.id}`);
              this.close();
              if (this.onComplete) this.onComplete();
            } catch (e) {
              new Notice(`Error approving reference: ${e instanceof Error ? e.message : String(e)}`);
            }
          })
      )
      .addExtraButton((btn) => {
        if (!approved) return;
        btn
          .setIcon("trash")
          .setTooltip("Unpublish reference")
          .onClick(async () => {
            if (!this.target.id) return;
            const res = unpublishSnapshot(this.plugin.manifest, this.target.id);
            this.plugin.manifest = res.manifest;
            await this.plugin.saveManifest();
            new Notice(`Unpublished reference: ${this.target.id}`);
            this.close();
            if (this.onComplete) this.onComplete();
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
