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
  type ReferencesManifest
} from "../../reference-core/src/index";

export default class LatexReferencesPlugin extends Plugin {
  settings: LatexReferencesSettings = DEFAULT_SETTINGS;
  manifest: ReferencesManifest = createEmptyManifest();
  vaultIndexer!: VaultCalloutIndexer;

  private compiling = new Set<string>();
  private lastCompiledSource = new Map<string, string>();
  private pdfLeaf: WorkspaceLeaf | null = null;
  private latestPdfPath: string | null = null;
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadManifest();

    this.vaultIndexer = new VaultCalloutIndexer(this.app);

    this.registerView(LATEX_VIEW_TYPE, (leaf) => new LatexEditorView(leaf, this));
    this.registerView(PDF_VIEW_TYPE, (leaf) => new LatexPdfView(leaf));
    this.registerExtensions(["tex", "sty", "cls"], LATEX_VIEW_TYPE);

    this.addSettingTab(new LatexReferencesSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.setStatus("LaTeX ready");

    this.addRibbonIcon("sigma", "Compile active LaTeX document", () => void this.compileActive());

    this.addCommand({
      id: "compile-active-latex",
      name: "Compile active LaTeX document",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(LatexEditorView);
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
        const view = this.app.workspace.getActiveViewOfType(LatexEditorView);
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
      this.manifest = data.referencesManifest;
    } else {
      this.manifest = createEmptyManifest(this.settings.baseUrl);
    }
  }

  async saveManifest(): Promise<void> {
    await this.persistData();
    await this.syncManifestToDigitalGarden();
  }

  private async persistData(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      referencesManifest: this.manifest
    });
  }

  async syncManifestToDigitalGarden(): Promise<void> {
    const repoPath = this.settings.digitalGardenRepoPath;
    if (!repoPath) return;

    const manifestRelative = this.settings.gardenManifestRelativePath || "src/site/_data/latexReferences.json";
    const targetFile = path.resolve(repoPath, manifestRelative);

    try {
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, JSON.stringify(this.manifest, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not sync manifest to Digital Garden repository:", e);
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
    const view = this.app.workspace.getActiveViewOfType(LatexEditorView);
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

    const texContent = exportGardenrefsTex(this.manifest);
    const fullPath = adapter.getFullPath(file.path);

    try {
      const result = await compileLatex(fullPath, this.settings, texContent);
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

    const relativePdf = adapter.getRelativePath(result.pdfPath);
    this.latestPdfPath = relativePdf;

    if (this.settings.openPdfAfterCompile) {
      await this.showPdfPreview(relativePdf);
    }
  }

  async togglePdfPreview(sourceView?: LatexEditorView): Promise<void> {
    if (this.pdfLeaf) {
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
    const resourceUrl = this.app.vault.adapter.getResourcePath(relativePdfPath);
    if (!resourceUrl) return;

    if (!this.pdfLeaf || !this.pdfLeaf.view) {
      this.pdfLeaf = this.app.workspace.getLeaf("split", "vertical");
      await this.pdfLeaf.setViewState({ type: PDF_VIEW_TYPE, active: false });
    }

    if (this.pdfLeaf.view instanceof LatexPdfView) {
      this.pdfLeaf.view.show(resourceUrl);
    }
  }
}
