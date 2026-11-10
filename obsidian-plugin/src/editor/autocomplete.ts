import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion
} from "@codemirror/autocomplete";
import type { App, TFile } from "obsidian";

/**
 * Standard LaTeX Environments.
 */
const STANDARD_ENVIRONMENTS = [
  // Proofs and Theorems (amsthm)
  { name: "proof", detail: "Proof environment (amsthm)" },
  { name: "theorem", detail: "Theorem environment" },
  { name: "lemma", detail: "Lemma environment" },
  { name: "corollary", detail: "Corollary environment" },
  { name: "proposition", detail: "Proposition environment" },
  { name: "definition", detail: "Definition environment" },
  { name: "example", detail: "Example environment" },
  { name: "remark", detail: "Remark environment" },

  // Math equations (amsmath)
  { name: "align*", detail: "Unnumbered aligned equations" },
  { name: "align", detail: "Numbered aligned equations" },
  { name: "equation*", detail: "Unnumbered displayed equation" },
  { name: "equation", detail: "Numbered displayed equation" },
  { name: "gather*", detail: "Unnumbered gathered equations" },
  { name: "gather", detail: "Numbered gathered equations" },
  { name: "cases", detail: "Piecewise cases environment" },

  // Matrices
  { name: "pmatrix", detail: "Parenthesis matrix ()" },
  { name: "bmatrix", detail: "Bracket matrix []" },
  { name: "vmatrix", detail: "Determinant / vertical bar matrix ||" },
  { name: "matrix", detail: "Plain matrix without delimiters" },

  // Lists and layout
  { name: "enumerate", detail: "Numbered list environment" },
  { name: "itemize", detail: "Bulleted list environment" },
  { name: "description", detail: "Description list environment" },
  { name: "center", detail: "Centered block" },
  { name: "tabular", detail: "Table environment" },
  { name: "figure", detail: "Floating figure" },
  { name: "tikzpicture", detail: "TikZ vector drawing" }
];

/**
 * Standard LaTeX Commands and Math Snippets.
 */
const STANDARD_SNIPPETS: { label: string; template: string; detail: string; boost?: number }[] = [
  // Math Structures
  { label: "\\frac", template: "\\frac{#{1:num}}{#{2:den}}#{0}", detail: "Fraction: \\frac{a}{b}", boost: 95 },
  { label: "\\dfrac", template: "\\dfrac{#{1:num}}{#{2:den}}#{0}", detail: "Display Fraction", boost: 90 },
  { label: "\\sqrt", template: "\\sqrt{#{1}}#{0}", detail: "Square root: \\sqrt{x}", boost: 90 },
  { label: "\\sqrt[]", template: "\\sqrt[#{1:n}]{#{2:x}}#{0}", detail: "n-th root: \\sqrt[n]{x}", boost: 85 },
  { label: "\\sum", template: "\\sum_{#{1:i=1}}^{#{2:n}} #{0}", detail: "Summation: \\sum_{i=1}^n", boost: 90 },
  { label: "\\int", template: "\\int_{#{1:a}}^{#{2:b}} #{0}", detail: "Definite integral: \\int_a^b", boost: 90 },
  { label: "\\iint", template: "\\iint_{#{1:D}} #{0}", detail: "Double integral: \\iint_D", boost: 80 },
  { label: "\\lim", template: "\\lim_{#{1:x \\to \\infty}} #{0}", detail: "Limit: \\lim_{x \\to \\infty}", boost: 88 },
  { label: "\\binom", template: "\\binom{#{1:n}}{#{2:k}}#{0}", detail: "Binomial coefficient: \\binom{n}{k}", boost: 85 },

  // Blackboard bold & fonts
  { label: "\\mathbb", template: "\\mathbb{#{1:R}}#{0}", detail: "Blackboard bold font", boost: 92 },
  { label: "\\mathbf", template: "\\mathbf{#{1}}#{0}", detail: "Bold math font", boost: 88 },
  { label: "\\mathcal", template: "\\mathcal{#{1}}#{0}", detail: "Calligraphic font", boost: 88 },
  { label: "\\mathrm", template: "\\mathrm{#{1}}#{0}", detail: "Roman math font", boost: 82 },
  { label: "\\operatorname", template: "\\operatorname{#{1:name}}#{0}", detail: "Custom operator", boost: 80 },

  // Text formatting
  { label: "\\textbf", template: "\\textbf{#{1}}#{0}", detail: "Bold text", boost: 90 },
  { label: "\\textit", template: "\\textit{#{1}}#{0}", detail: "Italic text", boost: 88 },
  { label: "\\emph", template: "\\emph{#{1}}#{0}", detail: "Emphasized text", boost: 88 },
  { label: "\\text", template: "\\text{#{1}}#{0}", detail: "Normal text in math mode", boost: 90 },
  { label: "\\underline", template: "\\underline{#{1}}#{0}", detail: "Underlined text", boost: 75 },
  { label: "\\overline", template: "\\overline{#{1}}#{0}", detail: "Overlined math expression", boost: 75 }
];

/**
 * Standard LaTeX Math Symbols & Greek Letters.
 */
const STANDARD_SYMBOLS: { label: string; detail: string; boost?: number }[] = [
  // Greek letters (lowercase)
  { label: "\\alpha", detail: "Greek letter α", boost: 85 },
  { label: "\\beta", detail: "Greek letter β", boost: 85 },
  { label: "\\gamma", detail: "Greek letter γ", boost: 85 },
  { label: "\\delta", detail: "Greek letter δ", boost: 85 },
  { label: "\\epsilon", detail: "Greek letter ϵ", boost: 80 },
  { label: "\\varepsilon", detail: "Greek letter ε", boost: 85 },
  { label: "\\zeta", detail: "Greek letter ζ", boost: 80 },
  { label: "\\eta", detail: "Greek letter η", boost: 80 },
  { label: "\\theta", detail: "Greek letter θ", boost: 85 },
  { label: "\\vartheta", detail: "Greek letter ϑ", boost: 80 },
  { label: "\\iota", detail: "Greek letter ι", boost: 75 },
  { label: "\\kappa", detail: "Greek letter κ", boost: 80 },
  { label: "\\lambda", detail: "Greek letter λ", boost: 85 },
  { label: "\\mu", detail: "Greek letter μ", boost: 85 },
  { label: "\\nu", detail: "Greek letter ν", boost: 80 },
  { label: "\\xi", detail: "Greek letter ξ", boost: 80 },
  { label: "\\pi", detail: "Greek letter π", boost: 85 },
  { label: "\\rho", detail: "Greek letter ρ", boost: 85 },
  { label: "\\sigma", detail: "Greek letter σ", boost: 85 },
  { label: "\\tau", detail: "Greek letter τ", boost: 85 },
  { label: "\\upsilon", detail: "Greek letter υ", boost: 75 },
  { label: "\\phi", detail: "Greek letter ϕ", boost: 85 },
  { label: "\\varphi", detail: "Greek letter φ", boost: 85 },
  { label: "\\chi", detail: "Greek letter χ", boost: 80 },
  { label: "\\psi", detail: "Greek letter ψ", boost: 80 },
  { label: "\\omega", detail: "Greek letter ω", boost: 85 },

  // Greek letters (uppercase)
  { label: "\\Gamma", detail: "Capital Gamma Γ", boost: 80 },
  { label: "\\Delta", detail: "Capital Delta Δ", boost: 80 },
  { label: "\\Theta", detail: "Capital Theta Θ", boost: 80 },
  { label: "\\Lambda", detail: "Capital Lambda Λ", boost: 80 },
  { label: "\\Xi", detail: "Capital Xi Ξ", boost: 75 },
  { label: "\\Pi", detail: "Capital Pi Π", boost: 75 },
  { label: "\\Sigma", detail: "Capital Sigma Σ", boost: 80 },
  { label: "\\Phi", detail: "Capital Phi Φ", boost: 80 },
  { label: "\\Psi", detail: "Capital Psi Ψ", boost: 75 },
  { label: "\\Omega", detail: "Capital Omega Ω", boost: 80 },

  // Relations and Logic
  { label: "\\implies", detail: "Logical implication ⟹", boost: 85 },
  { label: "\\iff", detail: "If and only if ⟺", boost: 85 },
  { label: "\\to", detail: "Arrow →", boost: 85 },
  { label: "\\longrightarrow", detail: "Long arrow ⟶", boost: 80 },
  { label: "\\mapsto", detail: "Maps to ↦", boost: 85 },
  { label: "\\longmapsto", detail: "Long maps to ⟼", boost: 80 },
  { label: "\\subset", detail: "Strict subset ⊂", boost: 82 },
  { label: "\\subseteq", detail: "Subset or equal ⊆", boost: 85 },
  { label: "\\in", detail: "Element of ∈", boost: 88 },
  { label: "\\notin", detail: "Not element of ∉", boost: 82 },
  { label: "\\cap", detail: "Set intersection ∩", boost: 82 },
  { label: "\\cup", detail: "Set union ∪", boost: 82 },
  { label: "\\setminus", detail: "Set minus \\", boost: 80 },
  { label: "\\emptyset", detail: "Empty set ∅", boost: 80 },
  { label: "\\forall", detail: "Universal quantifier ∀", boost: 82 },
  { label: "\\exists", detail: "Existential quantifier ∃", boost: 82 },
  { label: "\\le", detail: "Less than or equal ≤", boost: 85 },
  { label: "\\ge", detail: "Greater than or equal ≥", boost: 85 },
  { label: "\\ne", detail: "Not equal ≠", boost: 85 },
  { label: "\\approx", detail: "Approximately equal ≈", boost: 80 },
  { label: "\\cong", detail: "Congruent / Isomorphic ≅", boost: 85 },
  { label: "\\equiv", detail: "Equivalent ≡", boost: 85 },
  { label: "\\circ", detail: "Composition operator ∘", boost: 80 },
  { label: "\\times", detail: "Multiplication / Cartesian product ×", boost: 82 },
  { label: "\\infty", detail: "Infinity ∞", boost: 85 }
];

export interface ParsedPreamble {
  mtime: number;
  environments: { name: string; detail: string }[];
  commands: { label: string; detail: string; template?: string }[];
}

export class LatexProjectAutocompleteProvider {
  private preambleCache = new Map<string, ParsedPreamble>();

  constructor(private readonly app: App) {}

  /**
   * Parse a preamble file and extract custom commands and environments.
   */
  async getPreambleSymbols(docPath: string): Promise<ParsedPreamble> {
    const preamblePath = this.resolvePreamblePath(docPath);
    if (!preamblePath) {
      return { mtime: 0, environments: [], commands: [] };
    }

    const file = this.app.vault.getAbstractFileByPath(preamblePath);
    if (!file || !(file as TFile).stat) {
      return { mtime: 0, environments: [], commands: [] };
    }

    const tfile = file as TFile;
    const cached = this.preambleCache.get(preamblePath);
    if (cached && cached.mtime === tfile.stat.mtime) {
      return cached;
    }

    try {
      const content = await this.app.vault.read(tfile);
      const parsed = this.extractSymbols(content, tfile.basename);
      parsed.mtime = tfile.stat.mtime;
      this.preambleCache.set(preamblePath, parsed);
      return parsed;
    } catch {
      return { mtime: 0, environments: [], commands: [] };
    }
  }

  private resolvePreamblePath(docPath: string): string | null {
    const dir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
    const candidatePaths = [
      dir ? `${dir}/preamble/preamble.tex` : "preamble/preamble.tex",
      dir ? `${dir}/preamble.tex` : "preamble.tex"
    ];

    for (const p of candidatePaths) {
      if (this.app.vault.getAbstractFileByPath(p)) return p;
    }
    return null;
  }

  private extractSymbols(content: string, sourceName: string): ParsedPreamble {
    const environments: { name: string; detail: string }[] = [];
    const commands: { label: string; detail: string; template?: string }[] = [];

    // 1. Custom environments: \newenvironment{name} and \newtcolorbox{name}
    const envRegex = /\\(?:newenvironment|newtcolorbox|renewenvironment)\{([a-zA-Z0-9*]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = envRegex.exec(content)) !== null) {
      environments.push({
        name: match[1],
        detail: `Custom environment (${sourceName})`
      });
    }

    // 2. Theorem environments: \newtheorem{name}
    const thmRegex = /\\newtheorem\{([a-zA-Z0-9*]+)\}/g;
    while ((match = thmRegex.exec(content)) !== null) {
      environments.push({
        name: match[1],
        detail: `Theorem environment (${sourceName})`
      });
    }

    // 3. Custom commands: \newcommand{\name}[args] or \DeclareMathOperator{\name}
    const cmdRegex = /\\(?:newcommand|renewcommand|DeclareMathOperator)\{\\([a-zA-Z0-9*]+)\}(?:\[(\d+)\])?/g;
    while ((match = cmdRegex.exec(content)) !== null) {
      const name = match[1];
      const numArgs = match[2] ? parseInt(match[2], 10) : 0;
      if (numArgs > 0) {
        let tmpl = `\\${name}`;
        for (let i = 1; i <= numArgs; i++) {
          tmpl += `{#{${i}}}`;
        }
        tmpl += "#{0}";
        commands.push({
          label: `\\${name}`,
          template: tmpl,
          detail: `Custom command (${numArgs} args from ${sourceName})`
        });
      } else {
        commands.push({
          label: `\\${name}`,
          detail: `Custom macro (${sourceName})`
        });
      }
    }

    return { mtime: 0, environments, commands };
  }

  /**
   * CodeMirror 6 Autocomplete Provider Function.
   */
  getCompletionSource(docPath: string) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      // 1. Environment completion: typing \begin or \begin{<env>
      const beginMatch = context.matchBefore(/\\begin\{?([a-zA-Z0-9*]*)$/);
      if (beginMatch) {
        const preamble = await this.getPreambleSymbols(docPath);
        const allEnvs = [...preamble.environments, ...STANDARD_ENVIRONMENTS];

        // Deduplicate environments by name
        const seen = new Set<string>();
        const envCompletions: Completion[] = [];

        for (const env of allEnvs) {
          if (seen.has(env.name)) continue;
          seen.add(env.name);

          // Build snippet: \begin{env}\n\t#{1}\n\end{env}#{0}
          const template = `\\begin{${env.name}}\n\t#{1}\n\\end{${env.name}}#{0}`;
          envCompletions.push(
            snippetCompletion(template, {
              label: `\\begin{${env.name}}`,
              detail: env.detail,
              type: "class",
              boost: 99
            })
          );
        }

        return {
          from: beginMatch.from,
          options: envCompletions,
          validFor: /^\\[a-zA-Z0-9*{}]+$/
        };
      }

      // 2. Command completion: typing any \command
      const cmdMatch = context.matchBefore(/\\[a-zA-Z0-9*]*$/);
      if (!cmdMatch || (cmdMatch.from === cmdMatch.to && !context.explicit)) {
        return null;
      }

      const preamble = await this.getPreambleSymbols(docPath);
      const options: Completion[] = [];

      // Add preamble custom commands (highest boost)
      for (const cmd of preamble.commands) {
        if (cmd.template) {
          options.push(
            snippetCompletion(cmd.template, {
              label: cmd.label,
              detail: cmd.detail,
              type: "function",
              boost: 95
            })
          );
        } else {
          options.push({
            label: cmd.label,
            detail: cmd.detail,
            type: "keyword",
            boost: 95
          });
        }
      }

      // Add standard snippet structures
      for (const snip of STANDARD_SNIPPETS) {
        options.push(
          snippetCompletion(snip.template, {
            label: snip.label,
            detail: snip.detail,
            type: "function",
            boost: snip.boost ?? 90
          })
        );
      }

      // Add standard math symbols & Greek letters
      for (const sym of STANDARD_SYMBOLS) {
        options.push({
          label: sym.label,
          detail: sym.detail,
          type: "constant",
          boost: sym.boost ?? 80
        });
      }

      return {
        from: cmdMatch.from,
        options,
        validFor: /^\\[a-zA-Z0-9*]*$/
      };
    };
  }
}
