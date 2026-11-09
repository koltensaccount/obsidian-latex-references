export interface CalloutEnvironment {
  type: string;
  rawType: string;
  title: string;
  rawTitle: string;
  fold: string | null;
  id: string | null;
  body: string;
  filePath: string;
  start: number;
  end: number;
  calloutEnd: number;
  idQuotedLine: boolean;
  externalId: boolean;
  raw: string;
}

export interface EnsureIdResult {
  text: string;
  id: string;
  insertionOffset: number | null;
  insertion: string;
  target: CalloutEnvironment;
}

export interface ReferenceSnapshot {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceFile: string;
  approvedAt: string;
  url: string;
  contentHash: string;
}

export interface ReferencesManifest {
  version: number;
  baseUrl: string;
  updatedAt: string;
  references: Record<string, ReferenceSnapshot>;
}

export function scanEnvironments(text: string, filePath?: string): CalloutEnvironment[];
export function parseCalloutHeader(line: string): any;
export function unquoteCalloutBody(lines: string[]): string;
export function slugify(text: string): string;
export function generateCandidateId(target: CalloutEnvironment): string;
export function uniqueId(target: CalloutEnvironment, text: string, reservedIds?: string[]): string;
export function findSameEnvironment(text: string, original: CalloutEnvironment): CalloutEnvironment;
export function ensureBlockId(text: string, original: CalloutEnvironment, reservedIds?: string[]): EnsureIdResult;
export function buildLatexRefCommand(id: string, selectedText?: string, macroName?: string): string;
export function computeHash(content: string): string;
export function createEmptyManifest(baseUrl?: string): ReferencesManifest;
export function normalizeUrl(baseUrl: string, id: string): string;
export function approveSnapshot(
  manifest: ReferencesManifest | null,
  item: CalloutEnvironment | any,
  options?: { baseUrl?: string; approvedAt?: string }
): { manifest: ReferencesManifest; snapshot: ReferenceSnapshot };
export function unpublishSnapshot(manifest: ReferencesManifest, id: string): { manifest: ReferencesManifest; removed: boolean };
export function isApproved(manifest: ReferencesManifest, id: string): boolean;
export function getSnapshot(manifest: ReferencesManifest, id: string): ReferenceSnapshot | null;
export function detectDrift(snapshot: ReferenceSnapshot, currentCallout: CalloutEnvironment): boolean;
export function exportGardenrefsTex(manifest: ReferencesManifest): string;
export function parseDiagnostics(log: string): Array<{ file: string; line: number | null; severity: "error" | "warning"; message: string }>;
