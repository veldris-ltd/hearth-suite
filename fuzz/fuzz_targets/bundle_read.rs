#![no_main]
//! Fuzz the Bundle container parser against arbitrary bytes (must never panic).

use std::io::Cursor;

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = hearth_bundle::Bundle::read(Cursor::new(data));
});
