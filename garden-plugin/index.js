'use strict';

const fs = require('fs');
const path = require('path');

let markdownLib = null;

module.exports = {
  setupMarkdown(md, context) {
    markdownLib = md;
  },

  setupEleventy(eleventyConfig, context) {
    const pluginDir = context.pluginDir || __dirname;
    const manifestPath = (context.settings && context.settings.manifestPath) || 'src/site/_data/latexReferences.json';
    const templatePath = path.join(pluginDir, 'templates/reference-page.njk');

    eleventyConfig.addFilter('renderLatexRefMarkdown', function (content) {
      if (!content) return '';
      if (markdownLib && typeof markdownLib.render === 'function') {
        return markdownLib.render(content);
      }
      return content;
    });

    const fullManifestPath = path.resolve(manifestPath);
    if (!fs.existsSync(fullManifestPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(fullManifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const references = manifest.references ? Object.values(manifest.references) : [];

      if (!fs.existsSync(templatePath)) {
        console.warn(`[latex-references] Template not found at ${templatePath}`);
        return;
      }
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      for (const ref of references) {
        if (!ref.id) continue;
        const virtualName = `latex-ref-${ref.id}.njk`;
        eleventyConfig.addTemplate(virtualName, templateContent, {
          permalink: `/latex-references/${ref.id}/index.html`,
          eleventyExcludeFromCollections: true,
          title: `${ref.title} (${ref.type}) — LaTeX Reference`,
          ref,
          layout: null
        });
      }
    } catch (e) {
      console.warn(`[latex-references] Error loading manifest from ${manifestPath}:`, e.message);
    }
  }
};
