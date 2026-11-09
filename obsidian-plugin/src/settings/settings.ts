import { App, PluginSettingTab, Setting } from "obsidian";
import type LatexReferencesPlugin from "../main";
import type { LatexReferencesSettings } from "../types";

export const DEFAULT_SETTINGS: LatexReferencesSettings = {
  engine: "latexmk",
  latexmkPath: "/Library/TeX/texbin/latexmk",
  baseUrl: "https://obsidian.koltensserver.com",
  digitalGardenRepoPath: "/Users/koltenbendickson/Developer/my-digital-garden",
  gardenManifestRelativePath: "src/site/_data/latexReferences.json",
  compileOnSave: false,
  compileDebounceMs: 1500,
  openPdfAfterCompile: true,
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

    new Setting(containerEl)
      .setName("LaTeX compiler (latexmk) executable path")
      .setDesc("Absolute path or command name for latexmk.")
      .addText((text) =>
        text
          .setPlaceholder("/Library/TeX/texbin/latexmk")
          .setValue(this.plugin.settings.latexmkPath)
          .onChange(async (value) => {
            this.plugin.settings.latexmkPath = value.trim() || "/Library/TeX/texbin/latexmk";
            await this.plugin.saveSettings();
          })
      );

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
      .setName("Compile on save")
      .setDesc("Automatically recompile the document when changes are saved (debounced).")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.compileOnSave)
          .onChange(async (value) => {
            this.plugin.settings.compileOnSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-compile debounce delay (ms)")
      .setDesc("Milliseconds to wait after typing stops before auto-compiling.")
      .addSlider((slider) =>
        slider
          .setLimits(500, 5000, 250)
          .setValue(this.plugin.settings.compileDebounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.compileDebounceMs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open PDF preview after compile")
      .setDesc("Automatically display side-by-side PDF preview leaf upon successful compile.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPdfAfterCompile)
          .onChange(async (value) => {
            this.plugin.settings.openPdfAfterCompile = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
