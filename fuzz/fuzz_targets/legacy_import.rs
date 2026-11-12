#![no_main]
//! Fuzz the legacy Works importer against arbitrary bytes (must never panic).

use hearth_legacy_import::{import_bytes, LegacyFormat};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    for format in [LegacyFormat::Wps, LegacyFormat::Wks, LegacyFormat::Wdb] {
        let _ = import_bytes(data, format);
    }
});
