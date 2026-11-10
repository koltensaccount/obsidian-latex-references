'use strict';

const fs = require('fs');
const path = require('path');

let markdownLib = null;

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, body: text };
  const raw = match[1].trim();
  let data = {};
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      data = JSON.parse(raw);
    } catch (_) {}
  } else {
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        data[key] = val;
      }
    }
  }
  return { data, body: text.slice(match[0].length) };
}

function resolveSourceAttribution(ref, notesDir) {
  const relPath = ref.sourceFile || ref.filePath;
  if (!relPath) return null;
  const fullPath = path.resolve(notesDir, relPath);
  if (!fullPath.startsWith(path.resolve(notesDir))) return null;
  if (!fs.existsSync(fullPath)) return null;

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const { data } = parseFrontmatter(content);
    if (data['dg-publish'] === false) return null;

    const title = data.title || path.basename(relPath, path.extname(relPath));
    let permalink = data.permalink;
    if (!permalink) {
      permalink = '/notes/' + encodeURIComponent(path.basename(relPath, path.extname(relPath)));
    }
    const hasAnchor = ref.id && content.includes(ref.id);
    const url = hasAnchor ? `${permalink.replace(/\/+$/, '')}/#${ref.id}` : permalink;

    return { title, url };
  } catch (_) {
    return null;
  }
}

module.exports = {
  setupMarkdown(md, context) {
    markdownLib = md;
  },

  setupEleventy(eleventyConfig, context) {
    const pluginDir = context.pluginDir || __dirname;
    const manifestPath = process.env.LATEX_REFERENCES_MANIFEST_PATH || (context.settings && context.settings.manifestPath) || 'src/site/_data/latexReferences.json';
    const notesDir = path.resolve('src/site/notes');
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
        const sourceAttribution = resolveSourceAttribution(ref, notesDir);
        const virtualName = `latex-ref-${ref.id}.njk`;
        eleventyConfig.addTemplate(virtualName, templateContent, {
          permalink: `/latex-references/${ref.id}/index.html`,
          eleventyExcludeFromCollections: true,
          title: `${ref.title} (${ref.type}) — LaTeX Reference`,
          ref,
          sourceAttribution,
          layout: null
        });
      }
    } catch (e) {
      console.warn(`[latex-references] Error loading manifest from ${manifestPath}:`, e.message);
    }
  }
};
