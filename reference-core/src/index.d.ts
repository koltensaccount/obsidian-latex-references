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

export type ReferenceStatus = 'unapproved' | 'approved_local' | 'awaiting_deploy' | 'published' | 'deploy_failed';

export const REFERENCE_STATUS: {
  readonly UNAPPROVED: 'unapproved';
  readonly APPROVED_LOCAL: 'approved_local';
  readonly AWAITING_DEPLOY: 'awaiting_deploy';
  readonly PUBLISHED: 'published';
  readonly DEPLOY_FAILED: 'deploy_failed';
};

export const STATUS_LABELS: Record<ReferenceStatus, string>;

export interface ReferenceSnapshot {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceFile: string;
  approvedAt: string;
  updatedAt?: string;
  url: string;
  contentHash: string;
  verifiedContentHash?: string | null;
  status?: ReferenceStatus;
  publishedAt?: string | null;
  liveUrlReachable?: boolean;
  lastVerifiedAt?: string | null;
  verificationError?: string | null;
}

export interface ReferencesManifest {
  version: number;
  baseUrl: string;
  updatedAt: string;
  references: Record<string, ReferenceSnapshot>;
}

export interface LiveVerifyResult {
  ok: boolean;
  status: number;
  kind?: 'verified' | 'not_found' | 'http_error' | 'content_mismatch' | 'stale_content' | 'network_error';
  contentHash?: string | null;
  error?: string;
}

export function scanEnvironments(text: string, filePath?: string): CalloutEnvironment[];
export function parseCalloutHeader(line: string): any;
export function unquoteCalloutBody(lines: string[]): string;
export function slugify(text: string): string;
export function generateCandidateId(target: CalloutEnvironment): string;
export function uniqueId(target: CalloutEnvironment, text: string, reservedIds?: string[]): string;
export function findSameEnvironment(text: string, original: CalloutEnvironment): CalloutEnvironment;
export function ensureBlockId(text: string, original: CalloutEnvironment, reservedIds?: string[]): EnsureIdResult;
export function sanitizeLatexRefText(text: string): string;
export function buildLatexRefCommand(id: string, selectedText?: string, macroName?: string): string;
export function computeHash(content: string): string;
export function createEmptyManifest(baseUrl?: string): ReferencesManifest;
export function normalizeUrl(baseUrl: string, id: string): string;
export function getStatusLabel(status: ReferenceStatus): string;
export function approveSnapshot(
  manifest: ReferencesManifest | null,
  item: CalloutEnvironment | any,
  options?: { baseUrl?: string; approvedAt?: string; publishedAt?: string | null; status?: ReferenceStatus; allowOverwrite?: boolean }
): { manifest: ReferencesManifest; snapshot: ReferenceSnapshot };
export function updateReferenceStatus(
  manifest: ReferencesManifest,
  id: string,
  status: ReferenceStatus,
  details?: {
    lastVerifiedAt?: string;
    publishedAt?: string;
    verifiedContentHash?: string | null;
    liveUrlReachable?: boolean;
    httpStatus?: number;
    kind?: string;
    verificationError?: string | null;
  }
): { manifest: ReferencesManifest; snapshot: ReferenceSnapshot };
export function unpublishSnapshot(manifest: ReferencesManifest, id: string): { manifest: ReferencesManifest; removed: boolean };
export function getSnapshot(manifest: ReferencesManifest, id: string): ReferenceSnapshot | null;
export function getReferenceStatus(manifest: ReferencesManifest, id: string): ReferenceStatus;
export function isApproved(manifest: ReferencesManifest, id: string): boolean;
export function isPublished(manifest: ReferencesManifest, id: string): boolean;
export function canRenderLiveLink(snapshot: ReferenceSnapshot | null | undefined): boolean;
export function detectDrift(snapshot: ReferenceSnapshot, currentCallout: CalloutEnvironment): boolean;
export function verifyLiveReference(
  url: string,
  expected?: string | { id?: string; title?: string; contentHash?: string; bustCache?: boolean; fetchImpl?: typeof fetch },
  timeoutMs?: number
): Promise<LiveVerifyResult>;
export function exportDigitalGardenManifest(manifest: ReferencesManifest): ReferencesManifest;
export function exportGardenrefsTex(manifest: ReferencesManifest): string;
export function parseDiagnostics(log: string): Array<{ file: string; line: number | null; severity: "error" | "warning"; message: string }>;
