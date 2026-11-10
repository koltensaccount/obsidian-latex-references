import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FileSystemAdapter, Notice, Plugin, TFile, type Events, type WorkspaceLeaf } from "obsidian";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { ReferencePickerModal } from "./references/picker";
import { ApprovalModal } from "./references/approval-modal";
import { VaultCalloutIndexer } from "./references/vault-indexer";
import { DEFAULT_SETTINGS, LatexReferencesSettingTab } from "./settings/settings";
import type { LatexReferencesSettings } from "./types";
import {
  createEmptyManifest,
  exportGardenrefsTex,
  updateReferenceStatus,
  getSnapshot,
  verifyLiveReference,
  REFERENCE_STATUS,
  type ReferencesManifest
} from "../../reference-core/src/index";

export type LatexLiveApi = {
  registerTexEditorExtension(extension: Extension): () => void;
};

export default class LatexReferencesPlugin extends Plugin {
  settings: LatexReferencesSettings = DEFAULT_SETTINGS;
  referencesManifest: ReferencesManifest = createEmptyManifest();
  vaultIndexer!: VaultCalloutIndexer;

  private statusEl: HTMLElement | null = null;
  private detachLatexLive: () => void = () => {};

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadManifest();

    this.vaultIndexer = new VaultCalloutIndexer(this.app);

    // Ensure gardenref.sty is available globally in TEXMFHOME
    await this.ensureGardenrefPackage();

    // Setup integration with LaTeX Live editor
    this.setupLatexLiveIntegration();

    // Register Obsidian command for mathematical reference insertion (Option+L)
    this.addCommand({
      id: "insert-latex-reference",
      name: "Insert mathematical reference (Option+L)",
      hotkeys: [{ modifiers: ["Alt"], key: "l" }],
      checkCallback: (checking) => {
        const editorView = this.getActiveTexEditorView();
        if (!editorView) return false;
        if (!checking) {
          void this.triggerReferencePicker(editorView);
        }
        return true;
      }
    });

    // Command to sync reference mapping file (gardenrefs.tex)
    this.addCommand({
      id: "sync-gardenrefs-tex",
      name: "Sync reference mapping (gardenrefs.tex)",
      callback: () => void this.syncActiveGardenrefsTex(true)
    });

    // Command to push reference manifest to Digital Garden
    this.addCommand({
      id: "push-manifest-digital-garden",
      name: "Push reference manifest to Digital Garden",
      callback: async () => {
        new Notice("Pushing references to Digital Garden…");
        const res = await this.deployManifestToDigitalGarden();
        if (res.ok) {
          new Notice(res.message);
        } else {
          new Notice(`Deploy failed: ${res.message}`, 8000);
        }
      }
    });

    // Command to manage/approve mathematical reference snapshots
    this.addCommand({
      id: "manage-reference-snapshot",
      name: "Manage mathematical reference snapshot",
      callback: async () => {
        const envs = await this.vaultIndexer.getEnvironments();
        const publishedEnv = envs.find((e) => e.id === "def-group-homomorphism") || envs[0];
        if (publishedEnv) {
          new ApprovalModal(this.app, this, publishedEnv).open();
        } else {
          new Notice("No mathematical environments found in vault.");
        }
      }
    });

    // Settings tab
    this.addSettingTab(new LatexReferencesSettingTab(this.app, this));

    // Status bar item
    this.statusEl = this.addStatusBarItem();
    this.updateStatusBar();

    // Ribbon icon: Quick reference insertion or status check
    this.addRibbonIcon("sigma", "Insert mathematical reference (Option+L)", () => {
      const editorView = this.getActiveTexEditorView();
      if (editorView) {
        void this.triggerReferencePicker(editorView);
      } else {
        new Notice("Focus a LaTeX editor to insert references (Option+L).");
      }
    });

    // Vault listeners to keep callout index updated
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.vaultIndexer.updateFileIndex(file).then(() => this.updateStatusBar());
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.vaultIndexer.removeFile(file.path);
          this.updateStatusBar();
        }
      })
    );
  }

  onunload(): void {
    this.detachLatexLive();
  }

  /**
   * Builds the CodeMirror 6 extension that binds Alt+L (Option+L on macOS)
   * to open the mathematical reference picker popup.
   * Uses domEventHandlers to reliably intercept Option+L across macOS keyboard layouts.
   */
  createReferenceExtension(): Extension {
    return Prec.high(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.altKey && (event.key === "l" || event.key === "L" || event.code === "KeyL" || event.key === "¬")) {
            event.preventDefault();
            event.stopPropagation();
            void this.triggerReferencePicker(view);
            return true;
          }
          return false;
        }
      })
    );
  }

  /**
   * Connects to LaTeX Live via its documented `registerTexEditorExtension` API.
   * Also listens to the `latex-live:api-ready` workspace event for reload resilience.
   */
  private setupLatexLiveIntegration(): void {
    this.register(() => this.detachLatexLive());

    const attach = (api: unknown) => {
      const fn = (api as Partial<LatexLiveApi> | null)?.registerTexEditorExtension;
      if (typeof fn !== "function") return;
      this.detachLatexLive();
      this.detachLatexLive = fn.call(api, this.createReferenceExtension());
    };

    const plugin = (this.app as any).plugins?.getPlugin("latex-live");
    if (plugin) {
      attach(plugin);
    }
    this.registerEvent((this.app.workspace as Events).on("latex-live:api-ready", attach));
  }

  /**
   * Resolves the active CodeMirror EditorView from either LaTeX Live's TexView
   * or any active editor leaf.
   */
  getActiveTexEditorView(): EditorView | null {
    const leaf = this.app.workspace.activeLeaf;
    const view = leaf?.view as any;
    if (!view) return null;

    if (view.editorView instanceof EditorView || view.editorView?.state) {
      return view.editorView;
    }
    if (view.editor?.cm instanceof EditorView || view.editor?.cm?.state) {
      return view.editor.cm;
    }
    return null;
  }

  /**
   * Opens the searchable reference picker for the given editor view.
   */
  async triggerReferencePicker(editorView: EditorView): Promise<void> {
    const items = await this.vaultIndexer.getEnvironments();
    if (!items.length) {
      new Notice("No mathematical callouts found in vault.");
      return;
    }
    new ReferencePickerModal(this.app, this, editorView, items).open();
  }

  /**
   * Ensures gardenref.sty is installed in the user's standard TeX directory
   * (~/Library/texmf/tex/latex/gardenref/) so any TeX engine finds it automatically.
   */
  async ensureGardenrefPackage(): Promise<void> {
    try {
      const home = process.env.HOME || "";
      if (!home) return;
      const texmfDir = path.join(home, "Library/texmf/tex/latex/gardenref");
      const styDest = path.join(texmfDir, "gardenref.sty");

      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) return;

      const pluginDir = path.join(adapter.getBasePath(), ".obsidian/plugins/obsidian-latex-references");
      const pluginSty = path.join(pluginDir, "gardenref.sty");

      await fs.mkdir(texmfDir, { recursive: true });
      const hasPluginSty = await fs.stat(pluginSty).then(() => true).catch(() => false);
      if (hasPluginSty) {
        await fs.copyFile(pluginSty, styDest);
      }
    } catch (e) {
      console.warn("Could not ensure gardenref.sty in TEXMFHOME:", e);
    }
  }

  /**
   * Exports the latest gardenrefs.tex mapping file into the current document's folder
   * and the canonical LaTeX course folder.
   */
  async syncActiveGardenrefsTex(notify = false): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;

    const texContent = exportGardenrefsTex(this.referencesManifest);
    const activeFile = this.app.workspace.getActiveFile();
    let updatedLocations: string[] = [];

    // 1. Write in active file's directory if it is a TeX file
    if (activeFile && (activeFile.extension === "tex" || activeFile.extension === "sty")) {
      const activeFullPath = adapter.getFullPath(activeFile.path);
      const activeDir = path.dirname(activeFullPath);
      const targetFile = path.join(activeDir, "gardenrefs.tex");
      await fs.writeFile(targetFile, texContent, "utf8");
      updatedLocations.push(path.basename(activeDir));
    }

    // 2. Also write in the canonical MATH4281 LaTeX folder if present
    const canonicalRelDir = "School/Fall 2026/Introduction to Modern Algebra/LaTeX";
    const canonicalFullDir = path.join(adapter.getBasePath(), canonicalRelDir);
    try {
      const stat = await fs.stat(canonicalFullDir);
      if (stat.isDirectory()) {
        await fs.writeFile(path.join(canonicalFullDir, "gardenrefs.tex"), texContent, "utf8");
        if (!updatedLocations.includes("LaTeX")) updatedLocations.push("LaTeX");
      }
    } catch (_) {}

    if (notify) {
      new Notice(`Updated gardenrefs.tex in ${updatedLocations.join(", ") || "vault"}`);
    }
  }

  updateStatusBar(): void {
    if (this.statusEl) {
      if (this.vaultIndexer) {
        void this.vaultIndexer.getEnvironments().then((items) => {
          if (this.statusEl) {
            this.statusEl.setText(`LaTeX References: ${items.length} callouts`);
          }
        });
      } else {
        this.statusEl.setText("LaTeX References ready");
      }
    }
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    if (data && data.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
  }

  async loadManifest(): Promise<void> {
    const data = await this.loadData();
    if (data && data.referencesManifest && Object.keys(data.referencesManifest.references || {}).length > 0) {
      this.referencesManifest = data.referencesManifest;
      return;
    }

    // Fall back to reading existing Digital Garden repository manifest if available
    if (this.settings.digitalGardenRepoPath) {
      const gardenManifestPath = path.resolve(
        this.settings.digitalGardenRepoPath,
        this.settings.gardenManifestRelativePath || "src/site/_data/latexReferences.json"
      );
      try {
        const content = await fs.readFile(gardenManifestPath, "utf8");
        const parsed = JSON.parse(content);
        if (parsed && parsed.references && Object.keys(parsed.references).length > 0) {
          this.referencesManifest = parsed;
          await this.persistData();
          return;
        }
      } catch (_) {}
    }

    this.referencesManifest = createEmptyManifest(this.settings.baseUrl);
  }

  async saveManifest(): Promise<void> {
    await this.persistData();
    await this.syncManifestToDigitalGarden();
    await this.syncActiveGardenrefsTex();
  }

  private async persistData(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      referencesManifest: this.referencesManifest
    });
  }

  async syncManifestToDigitalGarden(): Promise<void> {
    const repoPath = this.settings.digitalGardenRepoPath;
    if (!repoPath) return;

    const manifestRelative = this.settings.gardenManifestRelativePath || "src/site/_data/latexReferences.json";
    const targetFile = path.resolve(repoPath, manifestRelative);

    try {
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, JSON.stringify(this.referencesManifest, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not sync manifest to Digital Garden repository:", e);
    }
  }

  async deployManifestToDigitalGarden(commitMessage = "chore(references): sync published latex reference snapshots"): Promise<{ ok: boolean; message: string }> {
    const repoPath = this.settings.digitalGardenRepoPath;
    if (!repoPath) {
      return { ok: false, message: "Digital Garden repository path is not configured in settings." };
    }

    try {
      await this.syncManifestToDigitalGarden();

      const manifestRelative = this.settings.gardenManifestRelativePath || "src/site/_data/latexReferences.json";
      const gitCmd = `git add "${manifestRelative}" && git commit -m "${commitMessage}" && git push origin main`;

      await new Promise<void>((resolve, reject) => {
        exec(gitCmd, { cwd: repoPath }, (err, stdout, stderr) => {
          if (err) {
            if (stdout.includes("nothing to commit") || stderr.includes("nothing to commit")) {
              resolve();
              return;
            }
            reject(new Error(stderr || stdout || err.message));
            return;
          }
          resolve();
        });
      });

      // Update statuses of approved references to awaiting_deploy
      for (const id of Object.keys(this.referencesManifest.references)) {
        const ref = this.referencesManifest.references[id];
        if (ref.status === REFERENCE_STATUS.APPROVED_LOCAL || ref.status === REFERENCE_STATUS.DEPLOY_FAILED) {
          this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.AWAITING_DEPLOY).manifest;
        }
      }
      await this.persistData();

      return { ok: true, message: "Pushed changes to Digital Garden repository. Vercel build triggered." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async checkReferenceLiveStatus(id: string): Promise<{ live: boolean; status: number; message: string }> {
    const snapshot = getSnapshot(this.referencesManifest, id);
    if (!snapshot) {
      return { live: false, status: 0, message: "Reference snapshot not found in manifest." };
    }

    const res = await verifyLiveReference(snapshot.url, snapshot.title);
    if (res.ok) {
      this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.PUBLISHED, {
        publishedAt: new Date().toISOString()
      }).manifest;
      await this.persistData();
      return { live: true, status: res.status, message: `Reference is live at ${snapshot.url}` };
    } else {
      if (snapshot.status === REFERENCE_STATUS.AWAITING_DEPLOY) {
        return { live: false, status: res.status, message: `Still awaiting deployment (${res.error})` };
      }
      this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.DEPLOY_FAILED, {
        verificationError: res.error
      }).manifest;
      await this.persistData();
      return { live: false, status: res.status, message: `Verification failed: ${res.error}` };
    }
  }
}
