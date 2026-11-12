/**
 * Hearth Suite legacy import, translate decoded Microsoft Works files into Hearth Suite's
 * native models, with an honest fidelity report (AC-WKS-G3, AC-LEG-1/2).
 *
 * The binary decode is libwps (native, via the FFI); this package is the pure
 * translation + degradation-report layer. `.wps` → Writer, `.wks` → Sheets
 * (charts re-created, not rasterised), `.wdb` → Records (filters and report
 * definitions translated where decodable, faithfully reported where not).
 */

export {
  SEVERITIES,
  LEGACY_FORMATS,
  translateWps,
  translateWks,
  translateWdb,
  importLegacy,
  summarizeReport,
  formatImportReport,
} from "./legacy.mjs";
export type {
  Severity,
  ReportItem,
  ImportReport,
  WpsIr,
  WksIr,
  WdbIr,
  WpsResult,
  WksResult,
  WdbResult,
  LegacyResult,
  LegacyFormat,
  LegacyWriterDoc,
  LegacyFieldDef,
  LegacyFilterSet,
  LegacyReportSpec,
} from "./legacy.mjs";
