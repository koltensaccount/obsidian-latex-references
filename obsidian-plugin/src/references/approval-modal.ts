import { App, Component, Modal, Notice, Setting, MarkdownRenderer, TFile } from "obsidian";
import type LatexReferencesPlugin from "../main";
import {
  approveSnapshot,
  detectDrift,
  ensureBlockId,
  getReferenceStatus,
  getSnapshot,
  getStatusLabel,
  unpublishSnapshot,
  REFERENCE_STATUS,
  type CalloutEnvironment,
  type ReferenceStatus
} from "../../../reference-core/src/index";

export class ApprovalModal extends Modal {
  private plugin: LatexReferencesPlugin;
  private target: CalloutEnvironment;
  private onComplete?: () => void;
  private unsubscribeManifest: () => void = () => {};
  private renderComponent: Component | null = null;
  private renderVersion = 0;

  constructor(app: App, plugin: LatexReferencesPlugin, target: CalloutEnvironment, onComplete?: () => void) {
    super(app);
    this.plugin = plugin;
    this.target = target;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    this.unsubscribeManifest = this.plugin.onManifestChanged(() => {
      void this.render();
    });
    void this.render();
  }

  onClose(): void {
    this.unsubscribeManifest();
    this.unsubscribeManifest = () => {};
    if (this.renderComponent) {
      this.renderComponent.unload();
      this.renderComponent = null;
    }
    this.contentEl.empty();
  }

  private async ensureTargetBlockId(): Promise<string> {
    if (this.target.id) return this.target.id;

    const file = this.app.vault.getAbstractFileByPath(this.target.filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Source note file not found: ${this.target.filePath}`);
    }

    const reservedIds = this.plugin.vaultIndexer.getAllReservedIds();
    let ensureRes: any;
    await this.app.vault.process(file, (content) => {
      ensureRes = ensureBlockId(content, this.target, reservedIds);
      return ensureRes.text;
    });

    this.target = ensureRes.target;
    await this.plugin.vaultIndexer.updateFileIndex(file);
    return ensureRes.id;
  }

  private async approveCurrentSnapshot(): Promise<void> {
    const targetId = await this.ensureTargetBlockId();
    const res = approveSnapshot(this.plugin.referencesManifest, this.target, {
      baseUrl: this.plugin.settings.baseUrl,
      status: REFERENCE_STATUS.APPROVED_LOCAL
    });
    this.plugin.referencesManifest = res.manifest;
    await this.plugin.saveManifest();
    new Notice(`Approved ^${targetId} locally (not pushed yet).`);
    this.plugin.notifyManifestChanged();
    if (this.onComplete) this.onComplete();
  }

  private async render(): Promise<void> {
    const currentRender = ++this.renderVersion;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("latex-ref-approval-modal");

    const targetId = this.target.id || "";
    const snapshot = getSnapshot(this.plugin.referencesManifest, targetId);
    const status: ReferenceStatus = getReferenceStatus(this.plugin.referencesManifest, targetId);
    const statusLabel = getStatusLabel(status);
    const hasDrift = Boolean(snapshot && detectDrift(snapshot, this.target));
    const formattedType = this.target.type
      ? this.target.type.charAt(0).toUpperCase() + this.target.type.slice(1).toLowerCase()
      : "Callout";

    // 1. Title & Type Hierarchy Header
    const headerEl = contentEl.createDiv({ cls: "latex-ref-modal-header" });
    const titleRow = headerEl.createDiv({ cls: "latex-ref-modal-title-row" });
    titleRow.createEl("h2", { text: this.target.title, cls: "latex-ref-modal-title" });
    titleRow.createSpan({ text: formattedType, cls: `cl-type-badge cl-badge-${this.target.type.toLowerCase()}` });

    // Accurate Status Pill matching picker labels
    const statusRow = headerEl.createDiv({ cls: "latex-ref-modal-status-row" });
    statusRow.createSpan({
      cls: `latex-ref-status-indicator is-${status}`,
      text: statusLabel
    });

    // 2. Rendered Callout Preview (Hero Component)
    const previewSection = contentEl.createDiv({ cls: "latex-ref-preview-section" });
    const renderedContainer = previewSection.createDiv({ cls: "latex-ref-rendered-callout" });

    const bodyLines = (this.target.body || "")
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const calloutMarkdown = `> [!${this.target.type.toLowerCase()}] ${this.target.title}\n${bodyLines}`;

    // 3. Contextual Guidance / Failure Banner / Drift Warning
    if (status === REFERENCE_STATUS.DEPLOY_FAILED) {
      const errBanner = contentEl.createDiv({ cls: "latex-ref-error-banner" });
      errBanner.createSpan({
        text: snapshot?.verificationError || "Live verification failed. Push to Digital Garden or retry verification."
      });
    } else {
      const guidance = contentEl.createDiv({ cls: "latex-ref-status-guidance" });
      let guidanceText = "";
      switch (status) {
        case REFERENCE_STATUS.APPROVED_LOCAL:
          guidanceText = snapshot?.publishedAt
            ? "Updated snapshot approved locally. Push to Digital Garden to update the live page (PDFs keep the previously verified link meanwhile)."
            : "Approved locally only — not pushed to Digital Garden yet. Compiled PDFs render this reference as plain text until pushed and verified live.";
          break;
        case REFERENCE_STATUS.AWAITING_DEPLOY:
          guidanceText = "Pushed to Digital Garden. Checking the live page automatically — PDF hyperlinks activate once verified live.";
          break;
        case REFERENCE_STATUS.PUBLISHED:
          guidanceText = "Verified live on Digital Garden. Compiled PDFs link directly to this reference and work offline.";
          break;
        case REFERENCE_STATUS.UNAPPROVED:
        default:
          guidanceText = "Not approved yet. Approve locally first, then push to Digital Garden to enable clickable PDF links.";
          break;
      }
      guidance.createSpan({ text: guidanceText });
    }

    if (hasDrift) {
      const driftEl = contentEl.createDiv({ cls: "latex-ref-drift-note" });
      driftEl.createSpan({
        text: "Source note edited since this snapshot was saved. Update Snapshot to capture your latest wording."
      });
    }

    const publicNote = contentEl.createDiv({ cls: "latex-ref-public-note" });
    publicNote.createSpan({
      text: "Unlisted under /latex-references/<id>/ — excluded from site search, navigation, and graphs."
    });

    // 4. Contextual Approval & Deployment Actions
    const actionsEl = contentEl.createDiv({ cls: "latex-ref-actions" });
    const actionsSetting = new Setting(actionsEl);

    if (status === REFERENCE_STATUS.UNAPPROVED || !snapshot) {
      actionsSetting.addButton((btn) =>
        btn
          .setButtonText("Approve Locally")
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await this.approveCurrentSnapshot();
            } catch (e) {
              btn.setDisabled(false);
              new Notice(`Error approving reference: ${e instanceof Error ? e.message : String(e)}`, 8000);
            }
          })
      );
    } else {
      if (status === REFERENCE_STATUS.APPROVED_LOCAL) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Push to Digital Garden")
            .setCta()
            .onClick(async () => {
              try {
                btn.setDisabled(true);
                btn.setButtonText("Pushing…");
                new Notice("Committing and pushing manifest to Digital Garden…");
                const res = await this.plugin.deployManifestToDigitalGarden(
                  `feat(references): publish mathematical snapshot ^${targetId}`,
                  targetId
                );
                if (res.ok) {
                  new Notice("Pushed! Checking live URL automatically…", 5000);
                } else {
                  new Notice(`Deploy failed: ${res.message}`, 8000);
                }
              } finally {
                void this.render();
              }
            })
        );
      } else if (status === REFERENCE_STATUS.DEPLOY_FAILED) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Push & Retry")
            .setCta()
            .onClick(async () => {
              try {
                btn.setDisabled(true);
                btn.setButtonText("Pushing…");
                new Notice("Pushing manifest to Digital Garden…");
                const res = await this.plugin.deployManifestToDigitalGarden(
                  `feat(references): retry publishing snapshot ^${targetId}`,
                  targetId
                );
                if (res.ok) {
                  new Notice("Pushed! Verifying live URL automatically…", 5000);
                } else {
                  new Notice(`Deploy failed: ${res.message}`, 8000);
                }
              } finally {
                void this.render();
              }
            })
        );
      } else if (hasDrift && status === REFERENCE_STATUS.PUBLISHED) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Update Snapshot")
            .setCta()
            .onClick(async () => {
              btn.setDisabled(true);
              try {
                await this.approveCurrentSnapshot();
              } catch (e) {
                btn.setDisabled(false);
                new Notice(`Error updating snapshot: ${e instanceof Error ? e.message : String(e)}`, 8000);
              }
            })
        );
      } else if (status === REFERENCE_STATUS.AWAITING_DEPLOY) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Verify Live Now")
            .setCta()
            .onClick(async () => {
              try {
                btn.setDisabled(true);
                btn.setButtonText("Checking…");
                const res = await this.plugin.checkReferenceLiveStatus(targetId);
                if (res.live) {
                  new Notice(`Reference ^${targetId} is live on Digital Garden!`, 5000);
                } else {
                  new Notice(res.message, 6000);
                }
              } finally {
                void this.render();
              }
            })
        );
      } else if (status === REFERENCE_STATUS.PUBLISHED && snapshot.url) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("View on Web")
            .setCta()
            .onClick(() => {
              window.open(snapshot.url, "_blank");
            })
        );
      }

      // Secondary Update Snapshot when drifted (for non-PUBLISHED states)
      if (hasDrift && status !== REFERENCE_STATUS.PUBLISHED) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Update Snapshot")
            .onClick(async () => {
              btn.setDisabled(true);
              try {
                await this.approveCurrentSnapshot();
              } catch (e) {
                btn.setDisabled(false);
                new Notice(`Error updating snapshot: ${e instanceof Error ? e.message : String(e)}`, 8000);
              }
            })
        );
      }

      // Secondary Verify Live URL / Retry Verification
      if (status === REFERENCE_STATUS.APPROVED_LOCAL || status === REFERENCE_STATUS.PUBLISHED || status === REFERENCE_STATUS.DEPLOY_FAILED) {
        const verifyLabel = status === REFERENCE_STATUS.DEPLOY_FAILED ? "Retry Verification" : "Verify Live URL";
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText(verifyLabel)
            .onClick(async () => {
              try {
                btn.setDisabled(true);
                btn.setButtonText("Checking…");
                const res = await this.plugin.checkReferenceLiveStatus(targetId);
                if (res.live) {
                  new Notice(`Reference ^${targetId} is LIVE on Digital Garden!`, 5000);
                } else {
                  new Notice(res.message, 6000);
                }
              } finally {
                void this.render();
              }
            })
        );
      }

      // Secondary View on Web when live or drifted published
      if (status === REFERENCE_STATUS.PUBLISHED && hasDrift && snapshot.url) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("View on Web")
            .onClick(() => {
              window.open(snapshot.url, "_blank");
            })
        );
      }

      // Remove / Unpublish button
      actionsSetting.addExtraButton((btn) => {
        btn
          .setIcon("trash")
          .setTooltip("Unpublish reference")
          .onClick(async () => {
            if (!targetId) return;
            const res = unpublishSnapshot(this.plugin.referencesManifest, targetId);
            this.plugin.referencesManifest = res.manifest;
            await this.plugin.saveManifest();
            this.plugin.notifyManifestChanged();
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

    addRow("Reference ID", `^${targetId || "(pending approval)"}`, true);
    addRow("Status", `${statusLabel} (${status})`);
    addRow("Source Note", this.target.filePath);
    addRow("Content Hash", snapshot?.contentHash || "(pending approval)", true);
    if (snapshot?.verifiedContentHash) {
      addRow("Verified Live Hash", snapshot.verifiedContentHash, true);
    }
    if (snapshot?.url) {
      addRow("Public URL", snapshot.url, false, true);
    }
    if (snapshot?.approvedAt) {
      addRow("Approved At", new Date(snapshot.approvedAt).toLocaleString());
    }
    if (snapshot?.publishedAt) {
      addRow("Published At", new Date(snapshot.publishedAt).toLocaleString());
    }
    if (snapshot?.lastVerifiedAt) {
      addRow("Last Verified At", new Date(snapshot.lastVerifiedAt).toLocaleString());
    }
    if (snapshot?.verificationError) {
      addRow("Verification Error", snapshot.verificationError);
    }

    // Render Markdown callout into preview container asynchronously
    if (this.renderComponent) {
      this.renderComponent.unload();
      this.renderComponent = null;
    }
    const renderComp = new Component();
    renderComp.load();
    this.renderComponent = renderComp;

    try {
      await MarkdownRenderer.render(
        this.app,
        calloutMarkdown,
        renderedContainer,
        this.target.filePath,
        renderComp
      );
      if (currentRender !== this.renderVersion) return;
    } catch (e) {
      console.error("MarkdownRenderer.render failed:", e);
    }
  }
}
