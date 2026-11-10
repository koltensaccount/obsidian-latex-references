import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  snippetKeymap
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentWithTab,
  redo,
  selectAll,
  toggleComment,
  undo
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  StreamLanguage
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap
} from "@codemirror/search";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from "@codemirror/view";
import { TextFileView, WorkspaceLeaf } from "obsidian";
import type LatexReferencesPlugin from "../main";
import { LatexProjectAutocompleteProvider } from "./autocomplete";
import { getOverleafThemeExtensions } from "./theme";

export const LATEX_VIEW_TYPE = "latex-references-editor";

export class LatexEditorView extends TextFileView {
  public editor: EditorView | null = null;
  private loadedText = "";
  private saveTimer: number | null = null;
  private autocompleteProvider: LatexProjectAutocompleteProvider;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LatexReferencesPlugin) {
    super(leaf);
    this.autocompleteProvider = new LatexProjectAutocompleteProvider(this.app);
  }

  getViewType(): string {
    return LATEX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "LaTeX";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("latex-references-editor-view");

    // 1. Scope integration for Obsidian-level hotkey delegation
    this.registerScopeHotkeys();

    // 2. Build CodeMirror state with full Overleaf conveniences
    const state = this.buildEditorState(this.loadedText);

    this.editor = new EditorView({
      parent: this.contentEl,
      state
    });

    this.addAction("play", "Compile LaTeX document (⌘S / ⌘Enter)", () => void this.plugin.compileView(this));
    this.addAction("panel-right-open", "Toggle PDF preview", () => void this.plugin.togglePdfPreview(this));
  }

  private registerScopeHotkeys(): void {
    // Undo / Redo
    this.scope.register(["Mod"], "z", (evt) => {
      evt.preventDefault();
      if (this.editor) undo(this.editor);
      return false;
    });
    this.scope.register(["Mod", "Shift"], "z", (evt) => {
      evt.preventDefault();
      if (this.editor) redo(this.editor);
      return false;
    });

    // Save & Compile (Cmd+S)
    this.scope.register(["Mod"], "s", (evt) => {
      evt.preventDefault();
      void this.plugin.compileView(this);
      return false;
    });

    // Compile (Cmd+Enter)
    this.scope.register(["Mod"], "Enter", (evt) => {
      evt.preventDefault();
      void this.plugin.compileView(this);
      return false;
    });

    // Select All (Cmd+A)
    this.scope.register(["Mod"], "a", (evt) => {
      evt.preventDefault();
      if (this.editor) selectAll(this.editor);
      return false;
    });

    // Find (Cmd+F)
    this.scope.register(["Mod"], "f", (evt) => {
      evt.preventDefault();
      if (this.editor) openSearchPanel(this.editor);
      return false;
    });

    // Toggle Comment (Cmd+/)
    this.scope.register(["Mod"], "/", (evt) => {
      evt.preventDefault();
      if (this.editor) toggleComment(this.editor);
      return false;
    });
  }

  private buildEditorState(doc: string): EditorState {
    const docPath = this.file?.path ?? "";
    const isDark = document.body.classList.contains("theme-dark");

    const customKeymap = Prec.highest(
      keymap.of([
        // Standard Editing & History
        { key: "Mod-z", run: undo, preventDefault: true },
        { key: "Mod-Shift-z", run: redo, preventDefault: true },
        { key: "Mod-y", run: redo, preventDefault: true },

        // Compilation Shortcuts
        {
          key: "Mod-s",
          run: () => {
            void this.plugin.compileView(this);
            return true;
          },
          preventDefault: true
        },
        {
          key: "Mod-Enter",
          run: () => {
            void this.plugin.compileView(this);
            return true;
          },
          preventDefault: true
        },

        // Select All & Find
        { key: "Mod-a", run: selectAll, preventDefault: true },
        { key: "Mod-f", run: openSearchPanel, preventDefault: true },
        { key: "Mod-/", run: toggleComment, preventDefault: true },

        // Snippet Placeholder & Indentation Navigation
        {
          key: "Tab",
          run: (view) => {
            if (hasNextSnippetField(view.state)) {
              return nextSnippetField(view);
            }
            return indentWithTab(view);
          }
        },
        {
          key: "Shift-Tab",
          run: (view) => {
            if (hasPrevSnippetField(view.state)) {
              return prevSnippetField(view);
            }
            return indentLess(view);
          }
        },

        // Callout References Picker
        {
          key: "Alt-l",
          mac: "Alt-l",
          run: (view) => {
            this.plugin.triggerReferencePicker(this, view);
            return true;
          }
        },

        // Standard Fallbacks
        ...snippetKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...foldKeymap
      ])
    );

    const extensions: Extension[] = [
      // Gutters & Line Numbers
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),

      // Selection & Cursor
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      highlightSpecialChars(),
      highlightSelectionMatches(),

      // History & Undo Tracking
      history(),

      // Delimiters & Typing Behavior
      bracketMatching(),
      indentOnInput(),
      closeBrackets({ brackets: ["(", "[", "{", "'", '"', "$"] }),

      // LaTeX Syntax & Mode
      StreamLanguage.define(stex),
      EditorState.languageData.of(() => [{ commentTokens: { line: "%" } }]),

      // Search & Autocomplete
      search({ top: true }),
      autocompletion({
        override: [this.autocompleteProvider.getCompletionSource(docPath)],
        defaultKeymap: false, // handled by customKeymap above
        icons: true
      }),

      // Overleaf Themes (Scoped to this view)
      ...getOverleafThemeExtensions(isDark),

      // Keymaps
      customKeymap,

      // View Layout & Change Listener
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        this.scheduleSave();
      })
    ];

    return EditorState.create({
      doc,
      extensions
    });
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    await this.save();
    this.editor?.destroy();
    this.editor = null;
  }

  getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.loadedText;
  }

  setViewData(data: string, clear: boolean): void {
    this.loadedText = data;
    if (!this.editor) return;

    const current = this.editor.state.doc.toString();
    // CRUCIAL: Do not reset editor state or destroy undo history if text has not changed (e.g. after save)
    if (current === data) return;

    if (clear) {
      // Re-create editor state only when switching to a completely new file
      this.editor.setState(this.buildEditorState(data));
    } else {
      // Incremental dispatch that preserves history stack
      this.editor.dispatch({
        changes: { from: 0, to: current.length, insert: data },
        userEvent: "set"
      });
    }
  }

  clear(): void {
    this.loadedText = "";
    if (this.editor) {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: "" }
      });
    }
  }

  focusLine(line: number): void {
    if (!this.editor || line < 1 || line > this.editor.state.doc.lines) return;
    const target = this.editor.state.doc.line(line);
    this.editor.dispatch({
      selection: { anchor: target.from },
      scrollIntoView: true
    });
    this.editor.focus();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.save().then(() => {
        if (this.plugin.settings.compileOnSave) {
          void this.plugin.compileView(this, true);
        }
      });
    }, this.plugin.settings.compileDebounceMs);
  }
}
