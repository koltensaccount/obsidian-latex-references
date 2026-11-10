import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FileSystemAdapter, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { compileLatex } from "./compiler/compiler";
import { LATEX_VIEW_TYPE, LatexEditorView } from "./editor/latex-view";
import { PDF_VIEW_TYPE, LatexPdfView } from "./editor/pdf-view";
import { ReferencePickerModal } from "./references/picker";
import { VaultCalloutIndexer } from "./references/vault-indexer";
import { DEFAULT_SETTINGS, LatexReferencesSettingTab } from "./settings/settings";
import type { CompileResult, LatexReferencesSettings } from "./types";
import {
  createEmptyManifest,
  exportGardenrefsTex,
  updateReferenceStatus,
  getSnapshot,
  verifyLiveReference,
  REFERENCE_STATUS,
  type ReferencesManifest
} from "../../reference-core/src/index";

export default class LatexReferencesPlugin extends Plugin {
  settings: LatexReferencesSettings = DEFAULT_SETTINGS;
  referencesManifest: ReferencesManifest = createEmptyManifest();
  vaultIndexer!: VaultCalloutIndexer;

  private compiling = new Set<string>();
  private lastCompiledSource = new Map<string, string>();
  private pdfLeaf: WorkspaceLeaf | null = null;
  private latestPdfPath: string | null = null;
  private statusEl: HTMLElement | null = null;

  getActiveLatexView(): LatexEditorView | null {
    const leaf = this.app.workspace.activeLeaf;
    if (leaf?.view && leaf.view.getViewType() === LATEX_VIEW_TYPE) {
      return leaf.view as LatexEditorView;
    }
    return this.app.workspace.getActiveViewOfType(LatexEditorView);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadManifest();

    this.vaultIndexer = new VaultCalloutIndexer(this.app);

    try {
      this.registerView(LATEX_VIEW_TYPE, (leaf) => new LatexEditorView(leaf, this));
    } catch (e) {
      // View type already registered
    }
    try {
      this.registerView(PDF_VIEW_TYPE, (leaf) => new LatexPdfView(leaf));
    } catch (e) {
      // View type already registered
    }
    try {
      this.registerExtensions(["tex", "sty", "cls"], LATEX_VIEW_TYPE);
    } catch (e) {
      // Extensions already registered
    }

    this.addSettingTab(new LatexReferencesSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.setStatus("LaTeX ready");

    this.addRibbonIcon("sigma", "Compile active LaTeX document", () => void this.compileActive());

    this.addCommand({
      id: "compile-active-latex",
      name: "Compile active LaTeX document",
      hotkeys: [
        { modifiers: ["Mod"], key: "s" },
        { modifiers: ["Mod"], key: "Enter" }
      ],
      checkCallback: (checking) => {
        const view = this.getActiveLatexView();
        if (!view) return false;
        if (!checking) void this.compileView(view);
        return true;
      }
    });

    this.addCommand({
      id: "toggle-pdf-preview",
      name: "Toggle PDF preview",
      callback: () => void this.togglePdfPreview()
    });

    this.addCommand({
      id: "insert-latex-reference",
      name: "Insert LaTeX callout reference",
      checkCallback: (checking) => {
        const view = this.getActiveLatexView();
        if (!view || !view.editor) return false;
        if (!checking) this.triggerReferencePicker(view, view.editor);
        return true;
      }
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.vaultIndexer.updateFileIndex(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.vaultIndexer.removeFile(file.path);
        }
      })
    );
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
    if (data && data.referencesManifest) {
      this.referencesManifest = data.referencesManifest;
    } else {
      this.referencesManifest = createEmptyManifest(this.settings.baseUrl);
    }
  }

  async saveManifest(): Promise<void> {
    await this.persistData();
    await this.syncManifestToDigitalGarden();
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

  setStatus(text: string): void {
    if (this.statusEl) {
      this.statusEl.setText(text);
    }
  }

  async triggerReferencePicker(view: LatexEditorView, editorView: EditorView): Promise<void> {
    const items = await this.vaultIndexer.getEnvironments();
    if (!items.length) {
      new Notice("No mathematical callouts found in vault.");
      return;
    }
    new ReferencePickerModal(this.app, this, editorView, items).open();
  }

  async compileActive(): Promise<void> {
    const view = this.getActiveLatexView();
    if (!view) {
      new Notice("Open a .tex document first.");
      return;
    }
    await this.compileView(view);
  }

  async compileView(view: LatexEditorView, quiet = false): Promise<void> {
    await view.save();
    const file = view.file;
    if (!file) return;

    const source = view.getViewData();
    if (quiet && this.lastCompiledSource.get(file.path) === source) {
      this.setStatus("LaTeX up to date");
      return;
    }

    if (this.compiling.has(file.path)) {
      if (!quiet) new Notice(`${file.name} is already compiling...`);
      return;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("LaTeX compilation requires desktop filesystem access.");
      return;
    }

    this.compiling.add(file.path);
    this.setStatus(`Compiling ${file.name}…`);
    if (!quiet) new Notice(`Compiling ${file.name}…`);

    const texContent = exportGardenrefsTex(this.referencesManifest);
    const fullPath = adapter.getFullPath(file.path);
    const pluginDir = path.join(adapter.getBasePath(), ".obsidian/plugins/obsidian-latex-references");

    try {
      const result = await compileLatex(fullPath, this.settings, texContent, pluginDir);
      await this.reportResult(result, view, adapter, quiet);
      if (result.ok) {
        this.lastCompiledSource.set(file.path, source);
      }
    } finally {
      this.compiling.delete(file.path);
    }
  }

  private async reportResult(
    result: CompileResult,
    view: LatexEditorView,
    adapter: FileSystemAdapter,
    quiet: boolean
  ): Promise<void> {
    if (!result.ok) {
      const firstError = result.diagnostics.find((item) => item.severity === "error");
      if (firstError?.line) {
        view.focusLine(firstError.line);
      }
      this.setStatus(`LaTeX error${firstError?.line ? ` (line ${firstError.line})` : ""}`);
      const summary = firstError ? `${firstError.message}${firstError.line ? ` (line ${firstError.line})` : ""}` : "Compilation failed.";
      new Notice(`Compilation error: ${summary}`, 10000);
      return;
    }

    this.setStatus(`Compiled in ${result.durationMs}ms`);
    if (!quiet) new Notice(`Compiled ${path.basename(result.pdfPath)} in ${result.durationMs}ms.`);

    const relativePdf = path.relative(adapter.getBasePath(), result.pdfPath);
    this.latestPdfPath = relativePdf;

    if (this.settings.openPdfAfterCompile) {
      await this.showPdfPreview(relativePdf);
    }
  }

  async togglePdfPreview(sourceView?: LatexEditorView): Promise<void> {
    if (this.pdfLeaf && this.pdfLeaf.parent) {
      this.pdfLeaf.detach();
      this.pdfLeaf = null;
      return;
    }

    if (this.latestPdfPath) {
      await this.showPdfPreview(this.latestPdfPath);
      return;
    }

    const latexView = sourceView ?? this.app.workspace.getActiveViewOfType(LatexEditorView);
    if (latexView) {
      await this.compileView(latexView);
    }
  }

  private async showPdfPreview(relativePdfPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(relativePdfPath);
    if (!(file instanceof TFile)) return;

    if (!this.pdfLeaf || !this.pdfLeaf.parent) {
      const existing = this.app.workspace.getLeavesOfType("pdf").find((l) => {
        const f = (l.view as any)?.file;
        return f?.path === relativePdfPath;
      });
      if (existing) {
        this.pdfLeaf = existing;
      } else {
        this.pdfLeaf = this.app.workspace.getLeaf("split", "vertical");
      }
    }

    await this.pdfLeaf.openFile(file, { active: false });
  }
}
