#![no_main]
//! Fuzz the .xlsx importer against arbitrary bytes (must never panic).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = hearth_odf_io::ooxml::import_xlsx(data);
});
