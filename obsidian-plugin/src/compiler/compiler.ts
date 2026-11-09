import { execFile, type ExecFileException } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDiagnostics } from "./diagnostics";
import type { CompileResult, LatexReferencesSettings } from "../types";

const MAX_LOG_BYTES = 4 * 1024 * 1024;

interface ExecOutput {
  stdout: string;
  stderr: string;
}

interface CompilerError extends Error {
  code?: string | number | null;
  stdout?: string;
  stderr?: string;
}

export async function compileLatex(
  absoluteTexPath: string,
  settings: LatexReferencesSettings,
  gardenrefsTexContent?: string,
  pluginDir?: string
): Promise<CompileResult> {
  const startedAt = Date.now();
  const workingDirectory = path.dirname(absoluteTexPath);
  const fileName = path.basename(absoluteTexPath);
  const baseName = path.parse(fileName).name;
  const buildDirectory = path.join(workingDirectory, ".latex-build", baseName);
  const builtPdfPath = path.join(buildDirectory, `${baseName}.pdf`);
  const pdfPath = path.join(workingDirectory, `${baseName}.pdf`);

  await mkdir(buildDirectory, { recursive: true });

  // If gardenrefs definitions are provided, write gardenrefs.tex in working dir
  if (gardenrefsTexContent) {
    try {
      await writeFile(path.join(workingDirectory, "gardenrefs.tex"), gardenrefsTexContent, "utf8");
    } catch (e) {
      console.warn("Could not write gardenrefs.tex:", e);
    }
  }

  // Construct TEXINPUTS so LaTeX finds gardenref.sty automatically across the vault
  const candidateDirs: string[] = [
    ".",
    pluginDir ? `${pluginDir}//` : "",
    pluginDir ? `${path.join(pluginDir, "latex")}//` : "",
    "/Users/koltenbendickson/Developer/obsidian-latex-references/latex//",
    "/Users/koltenbendickson/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Vault/.obsidian/plugins/obsidian-latex-references//"
  ].filter(Boolean);

  const texInputs = `${candidateDirs.join(":")}:`;

  const executable = settings.latexmkPath || "/Library/TeX/texbin/latexmk";
  const args = [
    "-pdf",
    "-interaction=nonstopmode",
    "-file-line-error",
    "-synctex=1",
    `--jobname=${baseName}`,
    "-usepretex=\\RequirePackage{etoolbox}\\AtEndPreamble{\\RequirePackage{gardenref}}",
    `-outdir=${buildDirectory}`,
    fileName
  ];

  try {
    const { stdout, stderr } = await runCompiler(executable, args, workingDirectory, texInputs);
    await copyFile(builtPdfPath, pdfPath);
    const log = `${stdout}\n${stderr}`.trim();
    return {
      ok: true,
      engine: "latexmk",
      pdfPath,
      log,
      diagnostics: parseDiagnostics(log),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return failureResult(pdfPath, error, startedAt);
  }
}

function failureResult(
  pdfPath: string,
  error: unknown,
  startedAt: number
): CompileResult {
  const stdout = getErrorText(error, "stdout");
  const stderr = getErrorText(error, "stderr");
  const message = error instanceof Error ? error.message : String(error ?? "Unknown compiler error");
  const log = [stdout, stderr, message].filter(Boolean).join("\n");
  const diagnostics = parseDiagnostics(log);
  if (diagnostics.length === 0) {
    diagnostics.push({ file: "", line: null, severity: "error", message });
  }
  return { ok: false, engine: "latexmk", pdfPath, log, diagnostics, durationMs: Date.now() - startedAt };
}

function getErrorText(error: unknown, key: "stdout" | "stderr"): string {
  if (!isCompilerError(error)) return "";
  return error[key] ?? "";
}

function isCompilerError(error: unknown): error is CompilerError {
  return error instanceof Error;
}

function runCompiler(
  executable: string,
  args: string[],
  workingDirectory: string,
  texInputs: string
): Promise<ExecOutput> {
  return new Promise((resolve, reject: (reason: CompilerError) => void) => {
    execFile(executable, args, {
      cwd: workingDirectory,
      encoding: "utf8",
      maxBuffer: MAX_LOG_BYTES,
      timeout: 120_000,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:/usr/local/bin:${process.env.PATH || ""}`,
        TEXINPUTS: texInputs
      }
    }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      if (error) {
        const compilerError: CompilerError = Object.assign(error, { stdout, stderr });
        reject(compilerError);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
