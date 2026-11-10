import { App, PluginSettingTab, Setting } from "obsidian";
import type LatexReferencesPlugin from "../main";
import type { LatexReferencesSettings } from "../types";

export const DEFAULT_SETTINGS: LatexReferencesSettings = {
  baseUrl: "https://obsidian.koltensserver.com",
  digitalGardenRepoPath: "/Users/koltenbendickson/Developer/my-digital-garden",
  gardenManifestRelativePath: "src/site/_data/latexReferences.json",
  autoSyncManifest: true,
  autoExportGardenrefs: true,
};

export class LatexReferencesSettingTab extends PluginSettingTab {
  plugin: LatexReferencesPlugin;

  constructor(app: App, plugin: LatexReferencesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "LaTeX References Settings" });

    containerEl.createEl("p", {
      text: "Manages mathematical reference picking (Option+L), stable reference identities, and publishing to Digital Garden.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("Digital Garden base URL")
      .setDesc("Public base URL for generated LaTeX reference links.")
      .addText((text) =>
        text
          .setPlaceholder("https://obsidian.koltensserver.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value.trim() || "https://obsidian.koltensserver.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Digital Garden repository path")
      .setDesc("Local path to your Digital Garden repo to export approved reference manifests.")
      .addText((text) =>
        text
          .setPlaceholder("/Users/koltenbendickson/Developer/my-digital-garden")
          .setValue(this.plugin.settings.digitalGardenRepoPath)
          .onChange(async (value) => {
            this.plugin.settings.digitalGardenRepoPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Manifest relative path")
      .setDesc("Relative path inside the Digital Garden repo for the reference manifest.")
      .addText((text) =>
        text
          .setPlaceholder("src/site/_data/latexReferences.json")
          .setValue(this.plugin.settings.gardenManifestRelativePath)
          .onChange(async (value) => {
            this.plugin.settings.gardenManifestRelativePath = value.trim() || "src/site/_data/latexReferences.json";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-export gardenrefs.tex")
      .setDesc("Automatically generate and update gardenrefs.tex mapping in the document directory when references change.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoExportGardenrefs)
          .onChange(async (value) => {
            this.plugin.settings.autoExportGardenrefs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync manifest to repository")
      .setDesc("Automatically write updated references manifest to the Digital Garden repository on changes.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncManifest)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncManifest = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
