//! Legacy Microsoft Works import for Hearth Suite.
//!
//! Imports legacy `.wps` (word processor), `.wks` (spreadsheet), and `.wdb`
//! (database) files into the shared Hearth Suite document model, with graceful
//! degradation and a clear [`ImportReport`].
//!
//! Works formats are proprietary and only partially documented, so this crate
//! takes a best-effort approach: it parses the OLE2 container of newer files
//! via [`cfb`], then recovers readable text (Latin-1 or UTF-16LE) from the
//! payload. Full-fidelity conversion via a native `libwps` backend is a future,
//! optional enhancement; the portable path here never fails and always reports
//! what it could not convert (`AC-LEG-1`, `AC-LEG-2`).
//!
//! ```no_run
//! use hearth_legacy_import::import_path;
//! use std::path::Path;
//!
//! let import = import_path(Path::new("notes.wps"))?;
//! println!("recovered {} blocks", import.report.recovered_blocks);
//! # Ok::<(), std::io::Error>(())
//! ```

mod extract;
mod import;
mod report;

pub use import::{decode_bytes, detect_format, import_bytes, import_path, Decoded};
pub use report::{Container, Encoding, Import, ImportReport, LegacyFormat};
