/**
 * Writer document export (AC-WRITER-4).
 *
 * Turns the Writer ODF model into a real, openable file the user can save:
 *  - PDF   → the OS print dialog (print-to-PDF), full fidelity from our renderer.
 *  - ODF   → a genuine zip-packaged OpenDocument (`.odt`).
 *  - Word  → a genuine zip-packaged OOXML document (`.docx`).
 *
 * The `.odt`/`.docx` packaging is done in-process by `office-docs.mjs` (built on
 * the tiny STORED-method zip writer in `office-zip.mjs`, zero deps); both
 * formats carry headings, bold, italic, underline, strike, super/subscript and
 * hyperlinks.
 */

import { buildDocx, buildOdt, escapeXml } from "./office-docs.mjs";
import type { ExportModel, ExportSpan } from "./office-docs.mjs";

export interface WriterExportPayload {
  format: string;
  model: ExportModel;
}

/** A filename-safe document title, derived from the first heading. */
function titleOf(model: ExportModel): string {
  const head = model.blocks?.find((b) => b.kind === "heading");
  const text = (head?.spans ?? [])
    .map((s) => s.text ?? "")
    .join("")
    .trim();
  return (
    (text || "Document")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .trim()
      .slice(0, 80) || "Document"
  );
}

/** Render a span list to canonical inline HTML, preserving every mark. */
function spansToHtml(spans: ExportSpan[] = []): string {
  return spans
    .map((sp) => {
      let t = escapeXml(sp.text ?? "");
      if (sp.bold) t = `<b>${t}</b>`;
      if (sp.italic) t = `<i>${t}</i>`;
      if (sp.underline) t = `<u>${t}</u>`;
      if (sp.strike) t = `<s>${t}</s>`;
      if (sp.sup) t = `<sup>${t}</sup>`;
      if (sp.sub) t = `<sub>${t}</sub>`;
      if (sp.href) t = `<a href="${escapeXml(sp.href)}">${t}</a>`;
      return t;
    })
    .join("");
}

/** A self-contained HTML document (Word opens it natively as `.doc`). */
function modelToHtml(model: ExportModel, title: string): string {
  const body = (model.blocks ?? [])
    .map((b) => {
      const inner = spansToHtml(b.spans);
      if (b.kind === "heading") {
        const lvl = Math.min(6, Math.max(1, b.level ?? 1));
        return `<h${lvl}>${inner}</h${lvl}>`;
      }
      return `<p>${inner || "&nbsp;"}</p>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title></head><body>${body}</body></html>`;
}

/** Trigger a browser download of `content` (text or bytes) as `filename`. */
function download(content: string | Uint8Array, mime: string, filename: string): void {
  const blob = new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export a Writer document. PDF prints; ODF and Word download a real, openable
 * file. The host can later override the binary formats via the odf-io FFI.
 */
export function exportWriterDocument(
  payload: WriterExportPayload,
  onError?: (message: string) => void,
): void {
  try {
    const title = titleOf(payload.model);
    switch (payload.format) {
      case "pdf":
        if (typeof window !== "undefined" && typeof window.print === "function") {
          window.print();
        }
        return;
      case "odf":
        download(
          buildOdt(payload.model),
          "application/vnd.oasis.opendocument.text",
          `${title}.odt`,
        );
        return;
      case "docx":
        download(
          buildDocx(payload.model),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          `${title}.docx`,
        );
        return;
      default:
        download(modelToHtml(payload.model, title), "text/html", `${title}.html`);
        return;
    }
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
  }
}
