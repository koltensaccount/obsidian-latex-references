export interface LatexReferencesSettings {
  engine: "latexmk";
  latexmkPath: string;
  baseUrl: string;
  digitalGardenRepoPath: string;
  gardenManifestRelativePath: string;
  compileOnSave: boolean;
  compileDebounceMs: number;
  openPdfAfterCompile: boolean;
}

export interface Diagnostic {
  file: string;
  line: number | null;
  severity: "error" | "warning";
  message: string;
}

export interface CompileResult {
  ok: boolean;
  engine: string;
  pdfPath: string;
  log: string;
  diagnostics: Diagnostic[];
  durationMs: number;
}
