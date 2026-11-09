import { App, Modal, Notice, Setting } from "obsidian";
import type LatexReferencesPlugin from "../main";
import {
  approveSnapshot,
  unpublishSnapshot,
  getSnapshot,
  REFERENCE_STATUS,
  type CalloutEnvironment,
  type ReferenceStatus
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
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("latex-ref-approval-modal");

    const targetId = this.target.id || "";
    const snapshot = getSnapshot(this.plugin.referencesManifest, targetId);
    const status: ReferenceStatus = (snapshot?.status as ReferenceStatus) || REFERENCE_STATUS.UNAPPROVED;

    contentEl.createEl("h2", { text: snapshot ? "Manage Reference Snapshot" : "Approve Reference Snapshot" });

    // Status Banner displaying the 5 lifecycle states
    const statusBanner = contentEl.createDiv({ cls: "latex-ref-status-banner" });
    switch (status) {
      case REFERENCE_STATUS.PUBLISHED:
        statusBanner.createSpan({ cls: "latex-ref-status-approved", text: "✓ Successfully Published (Live on Web)" });
        break;
      case REFERENCE_STATUS.AWAITING_DEPLOY:
        statusBanner.createSpan({ cls: "latex-ref-status-pending", text: "⏳ Awaiting Deployment (Vercel Build Pending)" });
        break;
      case REFERENCE_STATUS.APPROVED_LOCAL:
        statusBanner.createSpan({ cls: "latex-ref-status-local", text: "📄 Approved Locally (Ready to Deploy)" });
        break;
      case REFERENCE_STATUS.DEPLOY_FAILED:
        statusBanner.createSpan({ cls: "latex-ref-status-failed", text: "✖ Publication Verification Failed" });
        break;
      case REFERENCE_STATUS.UNAPPROVED:
      default:
        statusBanner.createSpan({ cls: "latex-ref-status-draft", text: "⚠ Draft / Unpublished" });
        break;
    }

    const infoList = contentEl.createEl("div", { cls: "latex-ref-info-box" });
    infoList.createDiv({ text: `Title: ${this.target.title}` });
    infoList.createDiv({ text: `Type: ${this.target.type}` });
    infoList.createDiv({ text: `ID: ^${targetId || "(none)"}` });
    infoList.createDiv({ text: `Source: ${this.target.filePath}` });
    if (snapshot?.url) {
      const urlRow = infoList.createDiv();
      urlRow.createSpan({ text: "URL: " });
      urlRow.createEl("a", { text: snapshot.url, href: snapshot.url });
    }
    if (snapshot?.publishedAt) {
      infoList.createDiv({ text: `Published At: ${new Date(snapshot.publishedAt).toLocaleString()}` });
    }
    if (snapshot?.verificationError) {
      const errRow = infoList.createDiv({ cls: "latex-ref-error-row" });
      errRow.createSpan({ text: `Error: ${snapshot.verificationError}` });
    }

    contentEl.createEl("h4", { text: "Callout Snapshot Preview" });
    const previewBox = contentEl.createEl("pre", { cls: "latex-ref-body-preview" });
    previewBox.setText(this.target.body || "");

    contentEl.createEl("p", {
      cls: "latex-ref-approval-desc",
      text: "Unlisted reference pages are publicly accessible to anyone with their URL under /latex-references/<id>/, but excluded from site search, navigation, and graphs."
    });

    // Action Controls
    const actionsSetting = new Setting(contentEl);

    // 1. Approve / Update Snapshot Locally
    actionsSetting.addButton((btn) =>
      btn
        .setButtonText(snapshot ? "Update Snapshot" : "Approve Locally")
        .setCta()
        .onClick(async () => {
          try {
            const res = approveSnapshot(this.plugin.referencesManifest, this.target, {
              baseUrl: this.plugin.settings.baseUrl,
              status: REFERENCE_STATUS.APPROVED_LOCAL
            });
            this.plugin.referencesManifest = res.manifest;
            await this.plugin.saveManifest();
            new Notice(`Approved reference: ${targetId} locally.`);
            this.render();
            if (this.onComplete) this.onComplete();
          } catch (e) {
            new Notice(`Error approving reference: ${e instanceof Error ? e.message : String(e)}`, 8000);
          }
        })
    );

    // 2. Deploy to Digital Garden (Git commit & push)
    if (snapshot) {
      actionsSetting.addButton((btn) =>
        btn
          .setButtonText("Push to Digital Garden")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Pushing…");
            new Notice("Committing and pushing manifest to Digital Garden repo…");
            const res = await this.plugin.deployManifestToDigitalGarden(
              `feat(references): approve mathematical snapshot ^${targetId}`
            );
            btn.setDisabled(false);
            btn.setButtonText("Push to Digital Garden");
            if (res.ok) {
              new Notice("Changes pushed! Vercel build initiated.", 5000);
              this.render();
            } else {
              new Notice(`Deploy failed: ${res.message}`, 8000);
            }
          })
      );

      // 3. Verify Live Status
      actionsSetting.addButton((btn) =>
        btn
          .setButtonText("Verify Live URL")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Checking…");
            new Notice(`Verifying live status at ${snapshot.url}…`);
            const res = await this.plugin.checkReferenceLiveStatus(targetId);
            btn.setDisabled(false);
            btn.setButtonText("Verify Live URL");
            if (res.live) {
              new Notice(`Reference is LIVE on Digital Garden!`, 5000);
            } else {
              new Notice(res.message, 6000);
            }
            this.render();
          })
      );

      // 4. Unpublish / Remove
      actionsSetting.addExtraButton((btn) => {
        btn
          .setIcon("trash")
          .setTooltip("Unpublish reference")
          .onClick(async () => {
            if (!targetId) return;
            const res = unpublishSnapshot(this.plugin.referencesManifest, targetId);
            this.plugin.referencesManifest = res.manifest;
            await this.plugin.saveManifest();
            new Notice(`Unpublished reference: ${targetId}`);
            this.close();
            if (this.onComplete) this.onComplete();
          });
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
