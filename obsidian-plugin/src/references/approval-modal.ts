import { App, Modal, Notice, Setting, MarkdownRenderer } from "obsidian";
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
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("latex-ref-approval-modal");

    const targetId = this.target.id || "";
    const snapshot = getSnapshot(this.plugin.referencesManifest, targetId);
    const status: ReferenceStatus = (snapshot?.status as ReferenceStatus) || REFERENCE_STATUS.UNAPPROVED;
    const formattedType = this.target.type
      ? this.target.type.charAt(0).toUpperCase() + this.target.type.slice(1).toLowerCase()
      : "Callout";

    // 1. Title & Type Hierarchy Header
    const headerEl = contentEl.createDiv({ cls: "latex-ref-modal-header" });
    const titleRow = headerEl.createDiv({ cls: "latex-ref-modal-title-row" });
    titleRow.createEl("h2", { text: this.target.title, cls: "latex-ref-modal-title" });
    titleRow.createSpan({ text: formattedType, cls: `cl-type-badge cl-badge-${this.target.type.toLowerCase()}` });

    // Status pill
    const statusRow = headerEl.createDiv({ cls: "latex-ref-modal-status-row" });
    const statusIndicator = statusRow.createSpan({ cls: `latex-ref-status-indicator is-${status}` });
    switch (status) {
      case REFERENCE_STATUS.PUBLISHED:
        statusIndicator.setText("Live on Digital Garden");
        break;
      case REFERENCE_STATUS.AWAITING_DEPLOY:
        statusIndicator.setText("Awaiting Deployment (Vercel Build Pending)");
        break;
      case REFERENCE_STATUS.APPROVED_LOCAL:
        statusIndicator.setText("Approved Locally (Ready to Deploy)");
        break;
      case REFERENCE_STATUS.DEPLOY_FAILED:
        statusIndicator.setText("Publication Verification Failed");
        break;
      case REFERENCE_STATUS.UNAPPROVED:
      default:
        statusIndicator.setText("Unpublished Draft");
        break;
    }

    // 2. Rendered Callout Preview (Hero Component)
    const previewSection = contentEl.createDiv({ cls: "latex-ref-preview-section" });
    const renderedContainer = previewSection.createDiv({ cls: "latex-ref-rendered-callout" });

    // Format proper markdown callout with unquoted body lines
    const bodyLines = (this.target.body || "")
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const calloutMarkdown = `> [!${this.target.type.toLowerCase()}] ${this.target.title}\n${bodyLines}`;

    try {
      await MarkdownRenderer.render(
        this.app,
        calloutMarkdown,
        renderedContainer,
        this.target.filePath,
        this
      );
    } catch (e) {
      console.error("MarkdownRenderer.render failed:", e);
    }

    // 3. Public Accessibility Note
    const publicNote = contentEl.createDiv({ cls: "latex-ref-public-note" });
    publicNote.createSpan({
      text: "Unlisted reference pages are publicly accessible to anyone with their URL under /latex-references/<id>/, but excluded from site search, navigation, and graphs."
    });

    // 4. Primary Approval Actions
    const actionsEl = contentEl.createDiv({ cls: "latex-ref-actions" });
    const actionsSetting = new Setting(actionsEl);

    // Primary CTA
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
            await this.plugin.syncActiveGardenrefsTex();
            new Notice(`Approved reference: ^${targetId} locally.`);
            void this.render();
            if (this.onComplete) this.onComplete();
          } catch (e) {
            new Notice(`Error approving reference: ${e instanceof Error ? e.message : String(e)}`, 8000);
          }
        })
    );

    // Push to Digital Garden
    if (snapshot) {
      actionsSetting.addButton((btn) =>
        btn
          .setButtonText("Push to Digital Garden")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Pushing…");
            new Notice("Committing and pushing manifest to Digital Garden…");
            const res = await this.plugin.deployManifestToDigitalGarden(
              `feat(references): approve mathematical snapshot ^${targetId}`
            );
            btn.setDisabled(false);
            btn.setButtonText("Push to Digital Garden");
            if (res.ok) {
              new Notice("Changes pushed! Vercel build initiated.", 5000);
              void this.render();
            } else {
              new Notice(`Deploy failed: ${res.message}`, 8000);
            }
          })
      );

      // Verify Live Status
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
            void this.render();
          })
      );

      // View on Web (if published)
      if (status === REFERENCE_STATUS.PUBLISHED && snapshot.url) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("View on Web")
            .onClick(() => {
              window.open(snapshot.url, "_blank");
            })
        );
      }

      // Unpublish button
      actionsSetting.addExtraButton((btn) => {
        btn
          .setIcon("trash")
          .setTooltip("Unpublish reference")
          .onClick(async () => {
            if (!targetId) return;
            const res = unpublishSnapshot(this.plugin.referencesManifest, targetId);
            this.plugin.referencesManifest = res.manifest;
            await this.plugin.saveManifest();
            await this.plugin.syncActiveGardenrefsTex();
            new Notice(`Unpublished reference: ^${targetId}`);
            this.close();
            if (this.onComplete) this.onComplete();
          });
      });
    }

    // 5. Technical Details (Understated <details>)
    const detailsEl = contentEl.createEl("details", { cls: "latex-ref-tech-details" });
    detailsEl.createEl("summary", { text: "Technical Metadata" });

    const techGrid = detailsEl.createDiv({ cls: "latex-ref-tech-grid" });

    const addRow = (label: string, value: string, isCode = false, isLink = false) => {
      const row = techGrid.createDiv({ cls: "latex-ref-tech-row" });
      row.createSpan({ text: label, cls: "latex-ref-tech-label" });
      if (isLink) {
        row.createEl("a", { text: value, href: value, cls: "latex-ref-tech-val" });
      } else if (isCode) {
        row.createEl("code", { text: value, cls: "latex-ref-tech-val" });
      } else {
        row.createSpan({ text: value, cls: "latex-ref-tech-val" });
      }
    };

    addRow("Reference ID", `^${targetId || "(none)"}`, true);
    addRow("Source Note", this.target.filePath);
    addRow("Content Hash", snapshot?.contentHash || "(pending approval)", true);
    if (snapshot?.url) {
      addRow("Public URL", snapshot.url, false, true);
    }
    if (snapshot?.approvedAt) {
      addRow("Approved At", new Date(snapshot.approvedAt).toLocaleString());
    }
    if (snapshot?.publishedAt) {
      addRow("Published At", new Date(snapshot.publishedAt).toLocaleString());
    }
    if (snapshot?.verificationError) {
      addRow("Verification Error", snapshot.verificationError);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
