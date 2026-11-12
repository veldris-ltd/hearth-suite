//! Bundle parser robustness ("fuzzing", `AC-SEC-11` / `AC-QA-3`).
//!
//! A Bundle is a zip container wrapping a manifest and parts, untrusted input
//! when received from elsewhere. `Bundle::read` must reject malformed archives
//! with an error, never panic or read out of bounds. This property test feeds it
//! random bytes; coverage-guided fuzzing of the same entry point lives in
//! `fuzz/` (cargo-fuzz, run in CI).

use std::io::Cursor;

use hearth_bundle::Bundle;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn bundle_read_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..8192)) {
        // Must return Ok/Err for any input, never panic.
        let _ = Bundle::read(Cursor::new(bytes));
    }
}
