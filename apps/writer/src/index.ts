/**
 * Hearth Suite Writer, block-based word processor (P2.3).
 */

import "../styles/writer.css";

export { Writer } from "./editor";
export type { WriterOptions } from "./editor";
export { MailingsDialog } from "./mailings";
export type { MergeSource, MailingsOptions } from "./mailings";
export {
  STYLES,
  EXPORT_FORMATS,
  emptyDocument,
  toPlainText,
  fillPlaceholders,
  composeFromData,
  mergeFields,
  formatAddress,
  ENVELOPE_SIZES,
  LABEL_SHEETS,
  paginateLabels,
  buildAskRequest,
  sealStatusText,
  toOdfModel,
} from "./core.mjs";
export type {
  WriterDocument,
  Block,
  Span,
  AskRequest,
  MergeRecord,
  EnvelopeSize,
  LabelSheet,
} from "./core.mjs";
