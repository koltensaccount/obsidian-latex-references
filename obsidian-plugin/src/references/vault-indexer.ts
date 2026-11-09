import { App, TFile } from "obsidian";
import { scanEnvironments, type CalloutEnvironment } from "../../../reference-core/src/index";

export class VaultCalloutIndexer {
  private app: App;
  private environments = new Map<string, CalloutEnvironment[]>();
  private indexReady = false;

  constructor(app: App) {
    this.app = app;
  }

  async buildInitialIndex(): Promise<void> {
    try {
      const files = this.app.vault.getMarkdownFiles();
      await Promise.all(files.map((file) => this.updateFileIndex(file)));
      this.indexReady = true;
    } catch (e) {
      console.error("LaTeX References: error building callout index", e);
    }
  }

  async updateFileIndex(file: TFile): Promise<CalloutEnvironment[]> {
    try {
      const text = await this.app.vault.cachedRead(file);
      const items = scanEnvironments(text, file.path);
      this.environments.set(file.path, items);
      return items;
    } catch (e) {
      return [];
    }
  }

  removeFile(filePath: string): void {
    this.environments.delete(filePath);
  }

  async getEnvironments(): Promise<CalloutEnvironment[]> {
    if (!this.indexReady || this.environments.size === 0) {
      await this.buildInitialIndex();
    }
    return Array.from(this.environments.values()).flat();
  }

  getAllReservedIds(): string[] {
    const ids: string[] = [];
    for (const items of this.environments.values()) {
      for (const item of items) {
        if (item.id) ids.push(item.id);
      }
    }
    return ids;
  }
}
