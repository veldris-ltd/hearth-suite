export interface ExportSpan {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  href?: string;
}
export interface ExportBlock {
  kind: string;
  level?: number;
  spans?: ExportSpan[];
}
export interface ExportModel {
  blocks?: ExportBlock[];
}

export function escapeXml(s: unknown): string;
export function buildDocx(model: ExportModel): Uint8Array;
export function buildOdt(model: ExportModel): Uint8Array;
