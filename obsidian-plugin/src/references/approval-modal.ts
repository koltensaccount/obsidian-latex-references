import { App, Component, MarkdownRenderer, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type LatexReferencesPlugin from "../main";
import {
  approveSnapshot,
  detectDrift,
  ensureBlockId,
  getReferenceStatus,
  getSnapshot,
  getStatusLabel,
  normalizeUrl,
  unpublishSnapshot,
  REFERENCE_STATUS,
  type CalloutEnvironment,
  type ParsedLatexReference,
  type ReferenceStatus
} from "../../../reference-core/src/index";

export interface ExistingLinkContext {
  editorView: EditorView;
  ref: ParsedLatexReference;
}

export interface MissingReferenceInfo {
  id: string;
  displayText: string;
  sourceMissingOnly?: boolean;
}

export interface ApprovalModalOptions {
  target?: CalloutEnvironment | null;
  missingRef?: MissingReferenceInfo;
  linkContext?: ExistingLinkContext;
  onComplete?: () => void;
}

function isCalloutEnvironment(val: unknown): val is CalloutEnvironment {
  return Boolean(val && typeof val === "object" && "raw" in val && "calloutEnd" in val);
}

export class ApprovalModal extends Modal {
  private plugin: LatexReferencesPlugin;
  private target: CalloutEnvironment | null;
  private missingRef?: MissingReferenceInfo;
  private linkContext?: ExistingLinkContext;
  private onComplete?: () => void;
  private unsubscribeManifest: () => void = () => {};
  private renderComponent: Component | null = null;
  private renderVersion = 0;
  private isClosed = false;
  private initialVerifyTriggered = false;
  private adHocCheckResult: { live: boolean; status: number; message: string; url: string } | null = null;

  constructor(
    app: App,
    plugin: LatexReferencesPlugin,
    targetOrOptions: CalloutEnvironment | ApprovalModalOptions,
    onComplete?: () => void
  ) {
    super(app);
    this.plugin = plugin;
    if (isCalloutEnvironment(targetOrOptions)) {
      this.target = targetOrOptions;
      this.onComplete = onComplete;
    } else {
      this.target = targetOrOptions.target ?? null;
      this.missingRef = targetOrOptions.missingRef;
      this.linkContext = targetOrOptions.linkContext;
      this.onComplete = targetOrOptions.onComplete ?? onComplete;
    }
  }

  onOpen(): void {
    this.isClosed = false;
    this.unsubscribeManifest = this.plugin.onManifestChanged(() => {
      if (!this.isClosed) {
        void this.render();
      }
    });

    const targetId = this.target?.id || this.missingRef?.id || "";
    if (targetId && !this.initialVerifyTriggered) {
      this.initialVerifyTriggered = true;
      const initialStatus = getReferenceStatus(this.plugin.referencesManifest, targetId);
      if (initialStatus === REFERENCE_STATUS.PUBLISHED || initialStatus === REFERENCE_STATUS.AWAITING_DEPLOY) {
        void this.plugin.checkReferenceLiveStatus(targetId, {
          silentIfUnchanged: true,
          isBackgroundPoll: initialStatus === REFERENCE_STATUS.AWAITING_DEPLOY
        });
      }
    }

    void this.render();
  }

  onClose(): void {
    this.isClosed = true;
    this.unsubscribeManifest();
    this.unsubscribeManifest = () => {};
    if (this.renderComponent) {
      this.renderComponent.unload();
      this.renderComponent = null;
    }
    this.contentEl.empty();

    const editorView = this.linkContext?.editorView;
    if (editorView) {
      requestAnimationFrame(() => {
        if (editorView.dom.isConnected && !document.querySelector(".modal-container")) {
          editorView.focus();
        }
      });
    }
  }

  private async ensureTargetBlockId(): Promise<string> {
    if (!this.target) {
      throw new Error("Source callout not available in vault.");
    }
    if (this.target.id) return this.target.id;

    const file = this.app.vault.getAbstractFileByPath(this.target.filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Source note file not found: ${this.target.filePath}`);
    }

    const reservedIds = this.plugin.vaultIndexer.getAllReservedIds();
    let ensureRes: any;
    await this.app.vault.process(file, (content) => {
      ensureRes = ensureBlockId(content, this.target!, reservedIds);
      return ensureRes.text;
    });

    this.target = ensureRes.target;
    await this.plugin.vaultIndexer.updateFileIndex(file);
    return ensureRes.id;
  }

  private async approveCurrentSnapshot(): Promise<void> {
    if (!this.target || this.missingRef?.sourceMissingOnly) {
      throw new Error("Cannot approve or update snapshot because the source callout was not found in vault notes.");
    }
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

  private removeDocumentLink(): void {
    if (!this.linkContext) return;
    const { editorView, ref } = this.linkContext;
    const currentSlice = editorView.state.doc.sliceString(ref.from, ref.to);
    if (currentSlice !== ref.raw) {
      new Notice("Reference text changed in document since this modal opened. Reopen the reference to remove its link.", 6000);
      return;
    }

    editorView.dispatch({
      changes: {
        from: ref.from,
        to: ref.to,
        insert: ref.displayText
      },
      selection: {
        anchor: ref.from + ref.displayText.length
      },
      userEvent: "delete"
    });

    new Notice("Removed reference link in document (Cmd+Z to undo).", 3500);
    this.close();
    if (this.onComplete) this.onComplete();
  }

  private renderUnpublishButton(setting: Setting, targetId: string): void {
    setting.addButton((btn) => {
      btn
        .setClass("latex-ref-unpublish-btn")
        .setWarning()
        .setTooltip(
          "Global publishing action: remove ^" +
            targetId +
            " snapshot from Digital Garden manifest and PDF links (does not modify .tex files)"
        )
        .onClick(async () => {
          if (!targetId) return;
          const res = unpublishSnapshot(this.plugin.referencesManifest, targetId);
          this.plugin.referencesManifest = res.manifest;
          await this.plugin.saveManifest();
          if (this.missingRef?.sourceMissingOnly) {
            this.target = null;
            this.missingRef = {
              id: targetId,
              displayText: this.linkContext?.ref.displayText ?? targetId,
              sourceMissingOnly: false
            };
          }
          this.plugin.notifyManifestChanged();
          new Notice(`Unpublished reference ^${targetId} from Digital Garden manifest.`);
          if (!this.linkContext) {
            this.close();
          }
          if (this.onComplete) this.onComplete();
        });

      btn.buttonEl.empty();
      const iconSpan = btn.buttonEl.createSpan({ cls: "latex-ref-btn-icon" });
      setIcon(iconSpan, "trash");
      btn.buttonEl.createSpan({ text: "Unpublish Reference" });
    });
  }

  private renderDocumentLinkSection(contentEl: HTMLElement): void {
    if (!this.linkContext) return;
    const { ref } = this.linkContext;

    const docSection = contentEl.createDiv({ cls: "latex-ref-doc-link-section" });
    const infoCol = docSection.createDiv({ cls: "latex-ref-doc-link-info" });
    infoCol.createDiv({ text: "Document Link", cls: "latex-ref-doc-link-title" });

    const singleLineDisplay = ref.displayText.replace(/\s+/g, " ").trim();
    const truncated = singleLineDisplay.length > 64 ? singleLineDisplay.slice(0, 61) + "…" : singleLineDisplay;
    infoCol.createDiv({
      text: `Replaces \\gardenref{${ref.id}}{…} in this .tex buffer with "${truncated}" (leaves Digital Garden & notes untouched).`,
      cls: "latex-ref-doc-link-desc"
    });

    const unlinkSetting = new Setting(docSection);
    unlinkSetting.settingEl.addClass("latex-ref-doc-link-control");
    unlinkSetting.addButton((btn) =>
      btn
        .setButtonText("Remove Link")
        .setClass("latex-ref-unlink-btn")
        .setTooltip("Remove \\gardenref command in this .tex document only (Cmd+Z to undo)")
        .onClick(() => {
          this.removeDocumentLink();
        })
    );
  }

  private async render(): Promise<void> {
    if (this.isClosed) return;
    const currentRender = ++this.renderVersion;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("latex-ref-approval-modal");

    const targetId = this.target?.id || this.missingRef?.id || "";
    const snapshot = getSnapshot(this.plugin.referencesManifest, targetId);
    const status: ReferenceStatus = getReferenceStatus(this.plugin.referencesManifest, targetId);
    const statusLabel = getStatusLabel(status);
    const hasDrift = Boolean(this.target && !this.missingRef?.sourceMissingOnly && snapshot && detectDrift(snapshot, this.target));

    if (!this.target) {
      this.renderMissingTargetModal(contentEl, targetId);
      return;
    }

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

    // 3. Contextual Guidance / Failure Banner / Missing-Source / Drift Warning
    if (this.missingRef?.sourceMissingOnly) {
      const sourceNote = contentEl.createDiv({ cls: "latex-ref-drift-note" });
      sourceNote.createSpan({
        text: `Source note callout ^${targetId} was not found in your vault notes. Showing the frozen snapshot saved in your manifest.`
      });
    }

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

    // 4. Global Approval & Deployment Actions
    const actionsEl = contentEl.createDiv({ cls: "latex-ref-actions" });
    const actionsSetting = new Setting(actionsEl);

    if (status === REFERENCE_STATUS.UNAPPROVED || !snapshot) {
      if (!this.missingRef?.sourceMissingOnly) {
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
      }
      if (targetId) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("Verify Expected URL")
            .onClick(async () => {
              btn.setDisabled(true);
              btn.setButtonText("Checking…");
              try {
                const res = await this.plugin.checkExpectedReferenceUrl(targetId);
                this.adHocCheckResult = res;
                new Notice(res.message, 5000);
              } finally {
                void this.render();
              }
            })
        );
      }
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

      // Secondary View on Web when drifted published
      if (status === REFERENCE_STATUS.PUBLISHED && hasDrift && snapshot.url) {
        actionsSetting.addButton((btn) =>
          btn
            .setButtonText("View on Web")
            .onClick(() => {
              window.open(snapshot.url, "_blank");
            })
        );
      }

      this.renderUnpublishButton(actionsSetting, targetId);
    }

    if (this.adHocCheckResult && !snapshot) {
      const checkBanner = contentEl.createDiv({
        cls: this.adHocCheckResult.live ? "latex-ref-status-guidance" : "latex-ref-error-banner"
      });
      checkBanner.createSpan({ text: this.adHocCheckResult.message });
    }

    // Separate Local Document Link Section (only when opened from an existing \gardenref command)
    this.renderDocumentLinkSection(contentEl);

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
    addRow("Source Note", this.target.filePath || "(not found in vault)");
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
    if (this.linkContext) {
      addRow("Document Command", this.linkContext.ref.raw, true);
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
        this.target.filePath || "",
        renderComp
      );
      if (currentRender !== this.renderVersion) return;
    } catch (e) {
      console.error("MarkdownRenderer.render failed:", e);
    }
  }

  private renderMissingTargetModal(contentEl: HTMLElement, missingId: string): void {
    const displayText = this.missingRef?.displayText ?? this.linkContext?.ref.displayText ?? missingId;
    const expectedUrl = normalizeUrl(this.plugin.settings.baseUrl, missingId);

    const headerEl = contentEl.createDiv({ cls: "latex-ref-modal-header" });
    const titleRow = headerEl.createDiv({ cls: "latex-ref-modal-title-row" });
    titleRow.createEl("h2", { text: `Missing Reference: ^${missingId}`, cls: "latex-ref-modal-title" });
    titleRow.createSpan({ text: "Unknown Target", cls: "cl-type-badge" });

    const statusRow = headerEl.createDiv({ cls: "latex-ref-modal-status-row" });
    statusRow.createSpan({
      cls: `latex-ref-status-indicator is-${REFERENCE_STATUS.UNAPPROVED}`,
      text: getStatusLabel(REFERENCE_STATUS.UNAPPROVED)
    });

    const previewSection = contentEl.createDiv({ cls: "latex-ref-preview-section" });
    const missingBox = previewSection.createDiv({ cls: "latex-ref-missing-target-box" });
    missingBox.createEl("p", {
      text: `No mathematical callout with block ID ^${missingId} was found in your vault Markdown notes, and no approved snapshot exists in the manifest.`
    });
    const textPreview = missingBox.createEl("p", { cls: "latex-ref-missing-display-line" });
    textPreview.createSpan({ text: "Document display text: " });
    textPreview.createEl("code", { text: displayText });
    missingBox.createEl("p", {
      cls: "latex-ref-missing-compile-note",
      text: "LaTeX compilation remains safe: with gardenref.sty this renders as plain text with a compiler warning; without gardenref.sty (such as Overleaf) it renders cleanly as plain text."
    });

    const guidance = contentEl.createDiv({ cls: "latex-ref-status-guidance" });
    guidance.createSpan({
      text: `To fix this link, add ^${missingId} beneath a callout in your notes, re-link the text using Option+L, or click Remove Link below.`
    });

    if (this.adHocCheckResult) {
      const checkBanner = contentEl.createDiv({
        cls: this.adHocCheckResult.live ? "latex-ref-status-guidance" : "latex-ref-error-banner"
      });
      checkBanner.createSpan({ text: this.adHocCheckResult.message });
    }

    const actionsEl = contentEl.createDiv({ cls: "latex-ref-actions" });
    const actionsSetting = new Setting(actionsEl);
    actionsSetting.addButton((btn) =>
      btn
        .setButtonText("Verify Expected URL")
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("Checking…");
          try {
            const res = await this.plugin.checkExpectedReferenceUrl(missingId);
            this.adHocCheckResult = res;
            new Notice(res.message, 5000);
          } finally {
            void this.render();
          }
        })
    );

    this.renderDocumentLinkSection(contentEl);

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
    addRow("Reference ID", `^${missingId}`, true);
    addRow("Status", "Unpublished (missing target)");
    addRow("Source Note", "(not found in vault)");
    addRow("Expected Public URL", expectedUrl, false, true);
    if (this.linkContext) {
      addRow("Document Command", this.linkContext.ref.raw, true);
    }
  }
}
