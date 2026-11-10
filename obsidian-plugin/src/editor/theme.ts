import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Overleaf-inspired Dark Highlight Style.
 * Deep neutral background, calm syntax tones, crisp legibility for long-form mathematical writing.
 */
export const overleafDarkHighlight = HighlightStyle.define([
  // LaTeX commands (\documentclass, \input, \section, \textbf, \emph, etc.)
  { tag: tags.keyword, color: "#569cd6", fontWeight: "500" },
  // LaTeX environments (\begin, \end, environment names)
  { tag: tags.atom, color: "#4ec9b0", fontWeight: "500" },
  // Comments (% ...)
  { tag: tags.comment, color: "#6a9955", fontStyle: "italic" },
  // Math delimiters ($, $$, \[, \])
  { tag: tags.special(tags.string), color: "#c586c0", fontWeight: "500" },
  // Math mode symbols / content
  { tag: tags.string, color: "#9cdcfe" },
  // Numbers, dimensions (11pt, 0.5em, 2)
  { tag: tags.number, color: "#b5cea8" },
  // Curly braces and brackets ({, }, [, ])
  { tag: tags.bracket, color: "#ffd700" },
  // Variable / macro identifiers
  { tag: tags.variableName, color: "#9cdcfe" },
  // Definitions / labels / citations
  { tag: tags.definition(tags.variableName), color: "#ce9178" },
  { tag: tags.meta, color: "#569cd6" }
]);

/**
 * Overleaf-inspired Light Highlight Style.
 */
export const overleafLightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#0000ff", fontWeight: "500" },
  { tag: tags.atom, color: "#008080", fontWeight: "500" },
  { tag: tags.comment, color: "#008000", fontStyle: "italic" },
  { tag: tags.special(tags.string), color: "#a31515", fontWeight: "500" },
  { tag: tags.string, color: "#001080" },
  { tag: tags.number, color: "#098658" },
  { tag: tags.bracket, color: "#000000" },
  { tag: tags.variableName, color: "#001080" },
  { tag: tags.definition(tags.variableName), color: "#a31515" },
  { tag: tags.meta, color: "#0000ff" }
]);

/**
 * CodeMirror 6 Editor Theme for Overleaf-style editing experience.
 * Explicitly styles:
 * - Line-number gutter (subtle, dark, unobtrusive)
 * - Selection background (high contrast, perfectly readable text)
 * - Active line (restrained, low-contrast)
 * - Search panel and autocomplete tooltip
 */
export const overleafEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 14px)",
    fontFamily: "var(--font-monospace, monospace)",
    backgroundColor: "var(--background-primary, #1e1e1e)",
    color: "#d4d4d4"
  },
  ".cm-content": {
    caretColor: "#aeafad",
    fontFamily: "inherit",
    padding: "8px 0"
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#aeafad",
    borderLeftWidth: "2px"
  },
  // Selection: readable high contrast in dark and light modes
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(38, 79, 120, 0.65) !important"
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgba(60, 100, 140, 0.4) !important",
    borderRadius: "2px"
  },
  // Active line: very subtle, restrained
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.035) !important"
  },
  // Line number gutter: blend naturally into the editor background
  ".cm-gutters": {
    backgroundColor: "var(--background-primary, #1e1e1e) !important",
    color: "#6e7681 !important",
    borderRight: "1px solid rgba(255, 255, 255, 0.06) !important"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 255, 255, 0.035) !important",
    color: "#c6cdd5 !important",
    fontWeight: "600"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 14px",
    minWidth: "32px",
    color: "inherit"
  },
  // Matching bracket
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    outline: "1px solid rgba(255, 255, 255, 0.3)",
    color: "inherit !important"
  },
  // Autocomplete popup
  ".cm-tooltip-autocomplete": {
    backgroundColor: "var(--background-secondary, #25282a) !important",
    border: "1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.12)) !important",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    fontSize: "0.9em",
    padding: "4px"
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "4px 8px",
    borderRadius: "4px"
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--background-modifier-hover, rgba(56, 114, 180, 0.4)) !important",
    color: "var(--text-normal, #ffffff) !important"
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-monospace, monospace)",
    fontWeight: "500"
  },
  ".cm-completionDetail": {
    fontStyle: "italic",
    opacity: 0.7,
    marginLeft: "8px",
    fontSize: "0.85em"
  },
  // Search panel (Cmd+F)
  ".cm-panel.cm-search": {
    backgroundColor: "var(--background-secondary, #25282a)",
    borderBottom: "1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.1))",
    padding: "6px 12px",
    color: "var(--text-normal, #d4d4d4)"
  },
  ".cm-panel.cm-search input": {
    backgroundColor: "var(--background-primary, #1e1e1e)",
    color: "var(--text-normal, #d4d4d4)",
    border: "1px solid var(--background-modifier-border, rgba(255, 255, 255, 0.15))",
    borderRadius: "4px",
    padding: "3px 6px"
  },
  ".cm-panel.cm-search button": {
    borderRadius: "4px",
    margin: "0 2px"
  }
});

/**
 * Light theme overrides when Obsidian is in light mode.
 */
export const overleafLightEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#222222"
  },
  ".cm-content": {
    caretColor: "#000000"
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#000000"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(180, 215, 255, 0.6) !important"
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgba(180, 215, 255, 0.35) !important"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(0, 0, 0, 0.03) !important"
  },
  ".cm-gutters": {
    backgroundColor: "#fafafa !important",
    color: "#999999 !important",
    borderRight: "1px solid rgba(0, 0, 0, 0.08) !important"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(0, 0, 0, 0.03) !important",
    color: "#333333 !important"
  }
}, { dark: false });

export function getOverleafThemeExtensions(isDark = true): Extension[] {
  return [
    overleafEditorTheme,
    syntaxHighlighting(isDark ? overleafDarkHighlight : overleafLightHighlight)
  ];
}
