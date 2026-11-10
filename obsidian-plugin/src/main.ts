import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, type Events } from "obsidian";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { ManageReferencePickerModal, ReferencePickerModal } from "./references/picker";
import { ApprovalModal } from "./references/approval-modal";
import { VaultCalloutIndexer } from "./references/vault-indexer";
import { DEFAULT_SETTINGS, LatexReferencesSettingTab } from "./settings/settings";
import type { LatexReferencesSettings } from "./types";
import {
  createEmptyManifest,
  exportDigitalGardenManifest,
  exportGardenrefsTex,
  getReferenceStatus,
  getSnapshot,
  isPublished,
  scanEnvironments,
  updateReferenceStatus,
  verifyLiveReference,
  REFERENCE_STATUS,
  type CalloutEnvironment,
  type LiveVerifyResult,
  type ReferenceSnapshot,
  type ReferencesManifest
} from "../../reference-core/src/index";

export type LatexLiveApi = {
  registerTexEditorExtension(extension: Extension): () => void;
};

const POLL_INTERVAL_MS = 8000;
const INITIAL_POLL_DELAY_MS = 5000;
const MAX_POLL_ATTEMPTS = 26; // ~3.5 minutes total

export default class LatexReferencesPlugin extends Plugin {
  settings: LatexReferencesSettings = DEFAULT_SETTINGS;
  referencesManifest: ReferencesManifest = createEmptyManifest();
  vaultIndexer!: VaultCalloutIndexer;

  private statusEl: HTMLElement | null = null;
  private detachLatexLive: () => void = () => {};
  private manifestListeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingActive = false;
  private deployInFlight: Promise<{ ok: boolean; message: string }> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadManifest();

    this.vaultIndexer = new VaultCalloutIndexer(this.app);

    // Ensure gardenref.sty is available globally in TEXMFHOME
    await this.ensureGardenrefPackage();

    // Setup integration with LaTeX Live editor
    this.setupLatexLiveIntegration();

    // Register capture-phase window keydown listener for instant Option+L (Alt+L)
    const handleKeydown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "l" || event.key === "L" || event.code === "KeyL" || event.key === "¬")
      ) {
        if (this.isLatexContext()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const editorView = this.getActiveTexEditorView();
          if (editorView) {
            void this.triggerReferencePicker(editorView);
          } else {
            new Notice("Focus a LaTeX editor to insert references (Option+L).");
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeydown, { capture: true });
    this.register(() => {
      window.removeEventListener("keydown", handleKeydown, { capture: true });
    });
    this.register(() => {
      this.stopDeploymentPolling();
    });

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
        if (!envs.length) {
          new Notice("No mathematical environments found in vault.");
          return;
        }

        // 1. If cursor is inside/on a \gardenref{id}{...} in an active TeX editor, open that exact reference
        const texView = this.getActiveTexEditorView();
        if (texView && this.isLatexContext()) {
          const refId = this.findGardenrefIdAtCursor(texView);
          if (refId) {
            const matched = envs.find((e) => e.id === refId);
            if (matched) {
              new ApprovalModal(this.app, this, matched).open();
              return;
            }
          }
        }

        // 2. If cursor is inside a mathematical callout in a Markdown note, open that exact callout
        const mdEnv = await this.findCalloutAtMarkdownCursor();
        if (mdEnv) {
          new ApprovalModal(this.app, this, mdEnv).open();
          return;
        }

        // 3. Otherwise open searchable management picker
        new ManageReferencePickerModal(this.app, this, envs).open();
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

    // Keep gardenrefs.tex in sync when opening .tex files so LaTeX Live always compiles safely
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && (file.extension === "tex" || file.extension === "sty") && this.settings.autoExportGardenrefs) {
          void this.syncActiveGardenrefsTex(false);
        }
      })
    );

    // Resume verification polling for any references already in AWAITING_DEPLOY from an earlier push
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoExportGardenrefs) {
        void this.syncActiveGardenrefsTex(false);
      }
      const awaitingIds = Object.keys(this.referencesManifest.references || {}).filter(
        (id) => getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.AWAITING_DEPLOY
      );
      if (awaitingIds.length > 0) {
        this.startDeploymentPolling(awaitingIds, 1500);
      }
    });
  }

  onunload(): void {
    this.stopDeploymentPolling();
    this.detachLatexLive();
    this.manifestListeners.clear();
  }

  onManifestChanged(cb: () => void): () => void {
    this.manifestListeners.add(cb);
    return () => {
      this.manifestListeners.delete(cb);
    };
  }

  notifyManifestChanged(): void {
    for (const cb of Array.from(this.manifestListeners)) {
      try {
        cb();
      } catch (e) {
        console.error("LaTeX References: manifest listener error", e);
      }
    }
  }

  /**
   * Builds the CodeMirror 6 extension that binds Alt+L (Option+L on macOS)
   * to open the mathematical reference picker popup.
   * Uses highest precedence with both keymap and DOM event handler to guarantee instant response.
   */
  createReferenceExtension(): Extension {
    return Prec.highest([
      keymap.of([
        {
          key: "Alt-l",
          mac: "Alt-l",
          run: (view) => {
            void this.triggerReferencePicker(view);
            return true;
          }
        }
      ]),
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (
            event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            (event.key === "l" || event.key === "L" || event.code === "KeyL" || event.key === "¬")
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.triggerReferencePicker(view);
            return true;
          }
          return false;
        }
      })
    ]);
  }

  /**
   * Determines whether the current active context is a LaTeX editing or preview session.
   */
  isLatexContext(): boolean {
    const activeLeaf = this.app.workspace.activeLeaf;
    const viewType = activeLeaf?.view?.getViewType?.();
    if (viewType === "latex-live-editor" || viewType === "latex-live-preview") {
      return true;
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension === "tex") {
      return true;
    }
    const activeEl = document.activeElement;
    if (activeEl?.closest(".latex-live-view, .latex-live-editor, .latex-live-preview")) {
      return true;
    }
    return false;
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
   * or companion editor leaf (e.g. when preview leaf or companion pane is active).
   */
  getActiveTexEditorView(): EditorView | null {
    // 1. Direct active leaf check
    const leaf = this.app.workspace.activeLeaf;
    const view = leaf?.view as any;
    if (view?.editorView instanceof EditorView || view?.editorView?.state) {
      return view.editorView;
    }
    if (view?.editor?.cm instanceof EditorView || view?.editor?.cm?.state) {
      return view.editor.cm;
    }

    // 2. Fall back to companion editor leaf (e.g. when preview leaf or sidebar is focused)
    const activeFile = this.app.workspace.getActiveFile();
    const edLeaves = this.app.workspace.getLeavesOfType("latex-live-editor");
    for (const edLeaf of edLeaves) {
      const edView = edLeaf.view as any;
      if (!activeFile || edView?.file?.path === activeFile.path) {
        if (edView?.editorView instanceof EditorView || edView?.editorView?.state) {
          return edView.editorView;
        }
        if (edView?.editor?.cm instanceof EditorView || edView?.editor?.cm?.state) {
          return edView.editor.cm;
        }
      }
    }
    if (edLeaves.length > 0) {
      const edView = edLeaves[0].view as any;
      if (edView?.editorView instanceof EditorView || edView?.editorView?.state) {
        return edView.editorView;
      }
      if (edView?.editor?.cm instanceof EditorView || edView?.editor?.cm?.state) {
        return edView.editor.cm;
      }
    }

    return null;
  }

  private findGardenrefIdAtCursor(view: EditorView): string | null {
    try {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      const col = head - line.from;
      const regex = /\\gardenref\{([a-zA-Z0-9-]+)\}/g;
      let match: RegExpExecArray | null;
      let fallbackId: string | null = null;
      while ((match = regex.exec(line.text)) !== null) {
        fallbackId = fallbackId || match[1];
        const cmdStart = match.index;
        // Include second braced argument if present on the same line
        const rest = line.text.slice(cmdStart);
        const fullMatch = rest.match(/^\\gardenref\{[a-zA-Z0-9-]+\}\{[^}]*\}/);
        const cmdEnd = cmdStart + (fullMatch ? fullMatch[0].length : match[0].length);
        if (col >= cmdStart && col <= cmdEnd) {
          return match[1];
        }
      }
      return fallbackId;
    } catch (_) {
      return null;
    }
  }

  private async findCalloutAtMarkdownCursor(): Promise<CalloutEnvironment | null> {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView?.file || !mdView.editor) return null;

    const text = mdView.editor.getValue();
    const offset = mdView.editor.posToOffset(mdView.editor.getCursor());
    const envs = scanEnvironments(text, mdView.file.path);
    return envs.find((env) => offset >= env.start && offset <= env.end + 4) || null;
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

  private async writeIfChanged(filePath: string, content: string): Promise<boolean> {
    try {
      const existing = await fs.readFile(filePath, "utf8");
      if (existing === content) return false;
    } catch (_) {}
    await fs.writeFile(filePath, content, "utf8");
    return true;
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
    const updatedLocations: string[] = [];

    // 1. Write in active file's directory if it is a TeX file
    if (activeFile && (activeFile.extension === "tex" || activeFile.extension === "sty")) {
      const activeFullPath = adapter.getFullPath(activeFile.path);
      const activeDir = path.dirname(activeFullPath);
      const targetFile = path.join(activeDir, "gardenrefs.tex");
      await this.writeIfChanged(targetFile, texContent);
      updatedLocations.push(path.basename(activeDir));
    }

    // 2. Also write in the canonical MATH4281 LaTeX folder if present
    const canonicalRelDir = "School/Fall 2026/Introduction to Modern Algebra/LaTeX";
    const canonicalFullDir = path.join(adapter.getBasePath(), canonicalRelDir);
    try {
      const stat = await fs.stat(canonicalFullDir);
      if (stat.isDirectory()) {
        await this.writeIfChanged(path.join(canonicalFullDir, "gardenrefs.tex"), texContent);
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

  private normalizeLoadedManifest(raw: ReferencesManifest, fromDigitalGarden = false): ReferencesManifest {
    const normalizedRefs: Record<string, ReferenceSnapshot> = {};
    const validStatuses = new Set(Object.values(REFERENCE_STATUS));

    for (const [id, ref] of Object.entries(raw.references || {})) {
      if (!ref || !id) continue;
      if (fromDigitalGarden) {
        // Digital Garden JSON holds content snapshots only; do not assume live status without verification
        normalizedRefs[id] = {
          ...ref,
          status: REFERENCE_STATUS.APPROVED_LOCAL,
          publishedAt: null,
          verifiedContentHash: ref.verifiedContentHash || null,
          lastVerifiedAt: ref.lastVerifiedAt || null,
          verificationError: null
        };
      } else {
        const status = ref.status && validStatuses.has(ref.status)
          ? ref.status
          : REFERENCE_STATUS.APPROVED_LOCAL;
        normalizedRefs[id] = {
          ...ref,
          status
        };
      }
    }

    return {
      version: raw.version || 1,
      baseUrl: (raw.baseUrl || this.settings.baseUrl || "https://obsidian.koltensserver.com").replace(/\/+$/, ""),
      updatedAt: raw.updatedAt || new Date().toISOString(),
      references: normalizedRefs
    };
  }

  async loadManifest(): Promise<void> {
    const data = await this.loadData();
    if (data && data.referencesManifest && Object.keys(data.referencesManifest.references || {}).length > 0) {
      this.referencesManifest = this.normalizeLoadedManifest(data.referencesManifest, false);
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
          this.referencesManifest = this.normalizeLoadedManifest(parsed, true);
          await this.persistData();
          return;
        }
      } catch (_) {}
    }

    this.referencesManifest = createEmptyManifest(this.settings.baseUrl);
  }

  async saveManifest(): Promise<void> {
    await this.persistData();
    if (this.settings.autoSyncManifest) {
      await this.syncManifestToDigitalGarden();
    }
    if (this.settings.autoExportGardenrefs) {
      await this.syncActiveGardenrefsTex();
    }
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
      const cleanManifest = exportDigitalGardenManifest(this.referencesManifest);
      const serialized = JSON.stringify(cleanManifest, null, 2) + "\n";
      await this.writeIfChanged(targetFile, serialized);
    } catch (e) {
      console.warn("Could not sync manifest to Digital Garden repository:", e);
    }
  }

  private runGit(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const execEnv = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`
    };
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: repoPath, env: execEnv }, (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message || "").trim();
          reject(Object.assign(new Error(detail), { code: (err as any).code, stdout, stderr }));
          return;
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      });
    });
  }

  private async markTargetsDeployFailed(message: string, targetId?: string): Promise<void> {
    let changed = false;
    for (const id of Object.keys(this.referencesManifest.references)) {
      const status = getReferenceStatus(this.referencesManifest, id);
      const isPending =
        status === REFERENCE_STATUS.APPROVED_LOCAL ||
        status === REFERENCE_STATUS.AWAITING_DEPLOY ||
        status === REFERENCE_STATUS.DEPLOY_FAILED;
      if (id === targetId || isPending) {
        if (id === targetId && status === REFERENCE_STATUS.PUBLISHED) {
          // Do not downgrade an already verified identical snapshot on transient git error
          continue;
        }
        this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.DEPLOY_FAILED, {
          verificationError: message
        }).manifest;
        changed = true;
      }
    }
    if (changed) {
      await this.persistData();
      await this.syncActiveGardenrefsTex();
      this.notifyManifestChanged();
    }
  }

  async deployManifestToDigitalGarden(
    commitMessage = "chore(references): sync published latex reference snapshots",
    targetId?: string
  ): Promise<{ ok: boolean; message: string }> {
    if (this.deployInFlight) {
      return this.deployInFlight;
    }

    const work = this.executeDeployManifestToDigitalGarden(commitMessage, targetId);
    this.deployInFlight = work;
    try {
      return await work;
    } finally {
      this.deployInFlight = null;
    }
  }

  private async executeDeployManifestToDigitalGarden(
    commitMessage: string,
    targetId?: string
  ): Promise<{ ok: boolean; message: string }> {
    const repoPath = this.settings.digitalGardenRepoPath;
    if (!repoPath) {
      return { ok: false, message: "Digital Garden repository path is not configured in settings." };
    }

    const manifestRelative = this.settings.gardenManifestRelativePath || "src/site/_data/latexReferences.json";

    try {
      // 1. Verify Digital Garden repo is on main
      const branchRes = await this.runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const currentBranch = branchRes.stdout.trim();
      if (currentBranch !== "main") {
        const msg = `Digital Garden repo is on branch "${currentBranch}", expected "main". Switch to main before pushing.`;
        await this.markTargetsDeployFailed(msg, targetId);
        return { ok: false, message: msg };
      }

      // 2. Fetch remote main before pushing
      try {
        await this.runGit(repoPath, ["fetch", "origin", "main"]);
      } catch (e) {
        const msg = `Could not reach origin/main (${e instanceof Error ? e.message : String(e)}). Check your internet connection or Git credentials.`;
        await this.markTargetsDeployFailed(msg, targetId);
        return { ok: false, message: msg };
      }

      // 3. Rebase cleanly if behind origin/main
      const behindRes = await this.runGit(repoPath, ["rev-list", "--count", "HEAD..origin/main"]);
      const behindCount = Number.parseInt(behindRes.stdout.trim(), 10) || 0;
      if (behindCount > 0) {
        try {
          await this.runGit(repoPath, ["pull", "--rebase", "--autostash", "origin", "main"]);
        } catch (e) {
          try {
            await this.runGit(repoPath, ["rebase", "--abort"]);
          } catch (_) {}
          const msg = `Failed to pull latest Digital Garden commits cleanly (${e instanceof Error ? e.message : String(e)}).`;
          await this.markTargetsDeployFailed(msg, targetId);
          return { ok: false, message: msg };
        }
      }

      // 4. Write clean Digital Garden manifest & stage it
      await this.syncManifestToDigitalGarden();
      await this.runGit(repoPath, ["add", "--", manifestRelative]);

      // 5. Commit ONLY the manifest file if there are staged changes
      let hasStagedChanges = false;
      try {
        await this.runGit(repoPath, ["diff", "--cached", "--quiet", "--", manifestRelative]);
      } catch (_) {
        hasStagedChanges = true;
      }

      if (hasStagedChanges) {
        await this.runGit(repoPath, ["commit", "-m", commitMessage, "--", manifestRelative]);
      }

      // 6. Push if local main is ahead of origin/main
      const aheadRes = await this.runGit(repoPath, ["rev-list", "--count", "origin/main..HEAD"]);
      const aheadCount = Number.parseInt(aheadRes.stdout.trim(), 10) || 0;
      if (aheadCount > 0) {
        await this.runGit(repoPath, ["push", "origin", "main"]);
      }

      // 7. Mark pending / unverified references as awaiting_deploy and begin automatic live verification polling
      const pendingIds: string[] = [];
      for (const id of Object.keys(this.referencesManifest.references)) {
        const status = getReferenceStatus(this.referencesManifest, id);
        const shouldAwait =
          status === REFERENCE_STATUS.APPROVED_LOCAL ||
          status === REFERENCE_STATUS.DEPLOY_FAILED ||
          status === REFERENCE_STATUS.AWAITING_DEPLOY ||
          (id === targetId && !isPublished(this.referencesManifest, id));

        if (shouldAwait) {
          this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.AWAITING_DEPLOY, {
            verificationError: null
          }).manifest;
          pendingIds.push(id);
        }
      }

      await this.persistData();
      await this.syncActiveGardenrefsTex();
      this.notifyManifestChanged();

      if (pendingIds.length > 0) {
        this.startDeploymentPolling(pendingIds, INITIAL_POLL_DELAY_MS);
      }

      return {
        ok: true,
        message: "Pushed to Digital Garden. Verifying live URLs automatically…"
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.markTargetsDeployFailed(msg, targetId);
      return { ok: false, message: msg };
    }
  }

  private actionableVerificationError(res: LiveVerifyResult, snapshot: ReferenceSnapshot): string {
    if (res.status === 404 || res.kind === "not_found") {
      if (!snapshot.publishedAt) {
        return "Live URL returned HTTP 404 — not deployed to Digital Garden yet. Click Push to Digital Garden to publish.";
      }
      return "Live URL returned HTTP 404. Push to Digital Garden to republish this reference page.";
    }
    if (res.kind === "stale_content") {
      return "Live page still serves an older snapshot while the updated build deploys. Retry verification shortly or push again.";
    }
    if (res.status === 0 || res.kind === "network_error") {
      return `Could not reach ${snapshot.url} (${res.error || "network error"}). Check your internet connection.`;
    }
    return res.error || "Live verification failed.";
  }

  async checkReferenceLiveStatus(
    id: string,
    opts: { isBackgroundPoll?: boolean; isFinalPoll?: boolean } = {}
  ): Promise<{ live: boolean; status: number; message: string }> {
    const snapshot = getSnapshot(this.referencesManifest, id);
    if (!snapshot) {
      return { live: false, status: 0, message: "Reference snapshot not found in manifest." };
    }

    const res = await verifyLiveReference(snapshot.url, {
      id: snapshot.id,
      title: snapshot.title,
      contentHash: snapshot.contentHash,
      bustCache: true
    });

    if (res.ok) {
      this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.PUBLISHED, {
        publishedAt: snapshot.publishedAt || new Date().toISOString(),
        verifiedContentHash: snapshot.contentHash,
        liveUrlReachable: true,
        verificationError: null
      }).manifest;
      await this.persistData();
      await this.syncActiveGardenrefsTex();
      this.notifyManifestChanged();
      return { live: true, status: res.status, message: `Reference is live at ${snapshot.url}` };
    }

    const actionableError = this.actionableVerificationError(res, snapshot);

    // Offline / network error handling: never downgrade an already verified Published reference
    if (res.status === 0 || res.kind === "network_error") {
      if (isPublished(this.referencesManifest, id)) {
        return {
          live: false,
          status: 0,
          message: "Network unreachable while checking live status — keeping verified Published state."
        };
      }
      if (opts.isBackgroundPoll && !opts.isFinalPoll) {
        return { live: false, status: 0, message: actionableError };
      }
      this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.DEPLOY_FAILED, {
        kind: res.kind,
        verificationError: actionableError,
        liveUrlReachable: Boolean(snapshot.publishedAt && snapshot.liveUrlReachable !== false)
      }).manifest;
      await this.persistData();
      await this.syncActiveGardenrefsTex();
      this.notifyManifestChanged();
      return { live: false, status: 0, message: actionableError };
    }

    // During active background deployment polling, keep AWAITING_DEPLOY while Vercel builds unless final attempt
    if (opts.isBackgroundPoll && !opts.isFinalPoll && getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.AWAITING_DEPLOY) {
      return { live: false, status: res.status, message: `Deploying (${actionableError})` };
    }

    this.referencesManifest = updateReferenceStatus(this.referencesManifest, id, REFERENCE_STATUS.DEPLOY_FAILED, {
      httpStatus: res.status,
      kind: res.kind,
      verificationError: actionableError
    }).manifest;
    await this.persistData();
    await this.syncActiveGardenrefsTex();
    this.notifyManifestChanged();
    return { live: false, status: res.status, message: actionableError };
  }

  private stopDeploymentPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollingActive = false;
  }

  private startDeploymentPolling(targetIds: string[], initialDelayMs = INITIAL_POLL_DELAY_MS): void {
    this.stopDeploymentPolling();
    const tracked = new Set(targetIds);
    this.pollingActive = true;
    let attempt = 0;

    const runTick = async () => {
      if (!this.pollingActive) return;
      attempt += 1;

      // Include any current awaiting_deploy entries as well
      for (const id of Object.keys(this.referencesManifest.references || {})) {
        if (getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.AWAITING_DEPLOY) {
          tracked.add(id);
        }
      }

      const pendingIds = Array.from(tracked).filter(
        (id) => getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.AWAITING_DEPLOY
      );

      if (pendingIds.length === 0) {
        this.stopDeploymentPolling();
        return;
      }

      const isFinalPoll = attempt >= MAX_POLL_ATTEMPTS;
      const newlyPublished: string[] = [];
      const timedOutIds: string[] = [];
      let stillPending = false;

      for (const id of pendingIds) {
        const res = await this.checkReferenceLiveStatus(id, {
          isBackgroundPoll: true,
          isFinalPoll
        });
        if (res.live) {
          newlyPublished.push(id);
        } else if (getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.AWAITING_DEPLOY) {
          stillPending = true;
        } else if (isFinalPoll && getReferenceStatus(this.referencesManifest, id) === REFERENCE_STATUS.DEPLOY_FAILED) {
          timedOutIds.push(id);
        }
      }

      if (newlyPublished.length > 0) {
        const labelList = newlyPublished.map((id) => `^${id}`).join(", ");
        new Notice(`Reference${newlyPublished.length > 1 ? "s" : ""} live on Digital Garden: ${labelList}`, 5000);
      }

      if (timedOutIds.length > 0) {
        new Notice(`Deployment verification failed for ${timedOutIds.map((id) => `^${id}`).join(", ")} — open modal for details.`, 7000);
      }

      if (isFinalPoll || !stillPending) {
        this.stopDeploymentPolling();
        return;
      }

      this.pollTimer = setTimeout(() => {
        void runTick();
      }, POLL_INTERVAL_MS);
    };

    this.pollTimer = setTimeout(() => {
      void runTick();
    }, initialDelayMs);
  }
}
