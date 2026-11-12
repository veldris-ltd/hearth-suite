//! Parser robustness ("fuzzing", `AC-QA-3`).
//!
//! The ODF reader and the `.docx`/`.xlsx` importers consume untrusted files
//! (zip containers wrapping XML). They must return an error on malformed input,
//! never panic. This property test feeds them random bytes; coverage-guided
//! fuzzing lives in `fuzz/` (cargo-fuzz, run in CI).

use hearth_odf_io::{odf, ooxml};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn parsers_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..4096)) {
        let _ = odf::read_document(&bytes);
        let _ = ooxml::import_docx(&bytes);
        let _ = ooxml::import_xlsx(&bytes);
    }
}
