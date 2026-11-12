// Type declarations for the pure Writer core (core.mjs).

/** A run of text with character formatting (the full ODF-round-tripped mark set). */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Superscript. */
  sup?: boolean;
  /** Subscript. */
  sub?: boolean;
  /** CSS colour (e.g. "#b4540a" or "rgb(…)"). */
  color?: string;
  /** CSS font-family. */
  font?: string;
  /** CSS font-size (e.g. "12pt"). */
  size?: string;
  /** Hyperlink target; the run renders as an anchor. */
  href?: string;
}

/** A heading block. */
export interface HeadingBlock {
  kind: "heading";
  level: number;
  spans: Span[];
  /** Footnote marker ids whose text falls with this block (for pagination). */
  footnoteRefs?: number[];
}

/** A body paragraph with a live style. */
export interface ParagraphBlock {
  kind: "paragraph";
  style?: string;
  spans: Span[];
  /** Footnote marker ids whose text falls with this block (for pagination). */
  footnoteRefs?: number[];
}

/** A real table: rows of cells, each cell a run of spans. */
export interface TableBlock {
  kind: "table";
  rows: Span[][][];
}

/** An embedded image. */
export interface ImageBlock {
  kind: "image";
  src: string;
  alt?: string;
}

/** An embedded chart object, optionally live-linked to a data source. */
export interface ChartBlock {
  kind: "chart";
  /** The full chart spec (type, title, categories, series, optional source). */
  spec: unknown;
}

export type Block = HeadingBlock | ParagraphBlock | TableBlock | ImageBlock | ChartBlock;

/** A Writer document. */
export interface WriterDocument {
  title: string;
  blocks: Block[];
}

export interface StyleOption {
  id: string;
  label: string;
}

/** An Ember request shape (mirrors the FFI EmberRequest). */
export interface AskRequest {
  task: "query";
  document: string;
  request: string;
  effort: "fast" | "balanced" | "thorough";
}

export const STYLES: StyleOption[];
export const EXPORT_FORMATS: string[];

export function emptyDocument(title?: string): WriterDocument;
export function toPlainText(doc: WriterDocument): string;
export function fillPlaceholders(text: string, record: Record<string, unknown>): string;
export function composeFromData(
  template: WriterDocument,
  records: Array<Record<string, unknown>>,
): WriterDocument[];

/** A row from a merge data source (Records, Sheets, or Contacts). */
export type MergeRecord = Record<string, unknown>;

/** Distinct `{{field}}` names referenced in the document, in order. */
export function mergeFields(doc: WriterDocument): string[];
/** Mailing-address lines for a record, tolerant of source field naming. */
export function formatAddress(record: MergeRecord): string[];

/** A standard envelope size (millimetres). */
export interface EnvelopeSize {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}
export const ENVELOPE_SIZES: EnvelopeSize[];
export function envelopeById(id: string): EnvelopeSize;

/** An Avery-style label-sheet layout (all dimensions in millimetres). */
export interface LabelSheet {
  id: string;
  label: string;
  page: "Letter" | "A4";
  pageWmm: number;
  pageHmm: number;
  across: number;
  down: number;
  labelWmm: number;
  labelHmm: number;
  marginLeftMm: number;
  marginTopMm: number;
  pitchXmm: number;
  pitchYmm: number;
}
export const LABEL_SHEETS: LabelSheet[];
export function labelSheetById(id: string): LabelSheet;
/** Lay records across label sheets; `null` cells are blank. */
export function paginateLabels(
  records: MergeRecord[],
  sheet: LabelSheet,
  opts?: { startAt?: number },
): Array<Array<MergeRecord | null>>;
export function buildAskRequest(
  doc: WriterDocument,
  question: string,
  effort?: "fast" | "balanced" | "thorough",
): AskRequest;
export function sealStatusText(recipientNames: string[], selfLabel?: string): string;
export function toOdfModel(doc: WriterDocument): {
  blocks: Array<{ kind: "heading" | "paragraph"; level?: number; spans: Span[] }>;
};

/** Serialise spans to canonical inline HTML (lossless inverse of spansFromHtml). */
export function spansToHtml(spans: Span[]): string;
/** Parse inline HTML (canonical or browser-emitted) into a normalised span list. */
export function spansFromHtml(html: string): Span[];

/** Live word/character/paragraph counts (AC-WKS-W16). */
export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
}
export function documentStats(doc: WriterDocument): DocumentStats;

/** User-editable autocorrect rules (lowercase key → replacement). */
export const DEFAULT_AUTOCORRECT: Record<string, string>;
export function autoCorrectWord(word: string, rules?: Record<string, string>): string;
export function applyAutoCorrect(text: string, rules?: Record<string, string>): string;

export interface FindOptions {
  caseSensitive?: boolean;
}
/** Replace options: find behaviour plus an optional cap on replacements made. */
export interface ReplaceOptions extends FindOptions {
  /** Replace at most this many matches (e.g. 1 = "Replace" one-at-a-time). */
  limit?: number;
}
export function expandSpecials(pattern: string): string;
export function findMatches(text: string, query: string, opts?: FindOptions): number[];
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  opts?: ReplaceOptions,
): { text: string; count: number };
export function replaceInDoc(
  doc: WriterDocument,
  query: string,
  replacement: string,
  opts?: ReplaceOptions,
): { doc: WriterDocument; count: number };
export function countInDoc(doc: WriterDocument, query: string, opts?: FindOptions): number;

/** Page setup for the print-faithful renderer (AC-WKS-W9, W10). */
export interface PageSetup {
  size?: "A4" | "Letter" | "Legal";
  orientation?: "portrait" | "landscape";
  marginMm?: number;
  fontPt?: number;
}
export interface PageGeometry {
  size: string;
  orientation: string;
  marginMm: number;
  widthMm: number;
  heightMm: number;
  charsPerLine: number;
  linesPerPage: number;
}
export interface PaginateOptions {
  header?: string;
  footer?: string;
  footnotes?: Record<number, string>;
  dateLabel?: string;
}
export interface RenderedPage {
  blocks: Block[];
  footnotes: Array<{ id: number; text: string }>;
  pageNumber: number;
  totalPages: number;
  header: string;
  footer: string;
}
export const PAGE_SIZES: Record<string, { w: number; h: number }>;
export function pageGeometry(setup?: PageSetup): PageGeometry;
export function paginate(
  doc: WriterDocument,
  geometry: PageGeometry,
  opts?: PaginateOptions,
): RenderedPage[];
