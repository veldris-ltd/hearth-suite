//! Parser robustness ("fuzzing", `AC-QA-3`).
//!
//! Legacy Works files are untrusted, often-corrupt binary input. The importer
//! must degrade gracefully, recovering what it can, and must never panic on
//! arbitrary bytes. This property test hammers it with random input; the deeper
//! coverage-guided fuzzing lives in `fuzz/` (cargo-fuzz, run in CI).

use hearth_legacy_import::{import_bytes, LegacyFormat};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn import_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..4096)) {
        for format in [LegacyFormat::Wps, LegacyFormat::Wks, LegacyFormat::Wdb] {
            // Returns an Import report (possibly empty/flagged), never panics.
            let _ = import_bytes(&bytes, format);
        }
    }
}
