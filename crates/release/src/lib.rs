//! Signed release metadata and update verification for Hearth Suite clients.
//!
//! This crate is the client-side heart of the verified auto-update flow drawn in
//! diagram 06d: the CI/CD pipeline publishes signed metadata + hashes, the
//! client fetches that metadata, then **verifies signature and hash against
//! pinned TUF roots before installing** (`AC-DESK-3`). It is the same code the
//! Release Service (P3.3) uses to *produce* that metadata, so producer and
//! consumer can never drift.
//!
//! The signature primitive is Hearth Suite's post-quantum ML-DSA-65, reached only
//! through [`hearth_seal`], no cryptography is implemented here (`AC-SEC-6`).
//!
//! ```
//! use hearth_release::{sign_targets, SignedTargets, TrustedRoots};
//! use hearth_seal::ReleaseSigningKey;
//!
//! // A release-signing role key (held by CI / the Release Service).
//! let root = ReleaseSigningKey::from_seed(&[1u8; 32])?;
//! let artifact = b"Hearth Suite-1.2.0.AppImage bytes";
//!
//! // Producer side: hash + sign the targets.
//! let signed = SignedTargets::new(2).with_target("Hearth.AppImage", artifact);
//! let metadata = sign_targets(signed, "root-2026", &root)?;
//!
//! // Consumer side: pin the root, verify metadata, then verify the download.
//! let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
//! let verified = metadata.verify(&roots)?;
//! verified.verify_artifact("Hearth.AppImage", artifact)?;     // installs only if this passes
//! assert!(verified.verify_artifact("Hearth.AppImage", b"tampered").is_err());
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod channel;
mod download;
mod error;
mod metadata;
mod roots;

pub use channel::Channel;
pub use download::artifact_name_from_url;
pub use error::{Error, Result};
pub use metadata::{
    sign_targets, target_entry, Hashes, ReleaseMetadata, Signature, SignedTargets, TargetEntry,
    VerifiedTargets,
};
pub use roots::TrustedRoots;

#[cfg(test)]
mod tests {
    use super::*;
    use hearth_seal::ReleaseSigningKey;

    fn key(seed: u8) -> ReleaseSigningKey {
        ReleaseSigningKey::from_seed(&[seed; 32]).unwrap()
    }

    fn sample() -> (ReleaseSigningKey, ReleaseMetadata, &'static [u8]) {
        let artifact: &[u8] = b"hearth-1.0.0-x86_64.AppImage contents";
        let root = key(11);
        let signed = SignedTargets::new(3)
            .with_target("Hearth_1.0.0_amd64.AppImage", artifact)
            .with_target("Hearth_1.0.0_x64.msi", b"windows installer bytes");
        let metadata = sign_targets(signed, "root-2026", &root).unwrap();
        (root, metadata, artifact)
    }

    #[test]
    fn verifies_and_matches_artifact() {
        let (root, metadata, artifact) = sample();
        let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
        let verified = metadata.verify(&roots).unwrap();
        assert_eq!(verified.version(), 3);
        verified
            .verify_artifact("Hearth_1.0.0_amd64.AppImage", artifact)
            .unwrap();
    }

    #[test]
    fn rejects_tampered_artifact() {
        let (root, metadata, _artifact) = sample();
        let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
        let verified = metadata.verify(&roots).unwrap();
        let err = verified
            .verify_artifact("Hearth_1.0.0_amd64.AppImage", b"malware payload")
            .unwrap_err();
        assert!(matches!(
            err,
            Error::HashMismatch(_) | Error::LengthMismatch { .. }
        ));
    }

    #[test]
    fn rejects_unknown_target() {
        let (root, metadata, _) = sample();
        let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
        let verified = metadata.verify(&roots).unwrap();
        assert!(matches!(
            verified.verify_artifact("not-a-target.dmg", b"x"),
            Err(Error::UnknownTarget(_))
        ));
    }

    #[test]
    fn rejects_untrusted_signer() {
        let (_root, metadata, _) = sample();
        // Pin a *different* key under the same id: the signature must not verify.
        let roots = TrustedRoots::new().with_key("root-2026", key(99).verifying_key());
        assert!(matches!(metadata.verify(&roots), Err(Error::Untrusted)));
    }

    #[test]
    fn rejects_unknown_keyid() {
        let (root, metadata, _) = sample();
        let roots = TrustedRoots::new().with_key("some-other-id", root.verifying_key());
        assert!(matches!(metadata.verify(&roots), Err(Error::Untrusted)));
    }

    #[test]
    fn rejects_tampered_metadata() {
        let (root, mut metadata, _) = sample();
        // Flip the version after signing: canonical bytes change, signature fails.
        metadata.signed.version = 4;
        let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
        assert!(matches!(metadata.verify(&roots), Err(Error::Untrusted)));
    }

    #[test]
    fn unsigned_scaffold_metadata_is_rejected() {
        // The shape emitted by ci/tuf/generate-metadata.sh before P3.3 signing:
        // a valid targets body with an empty signatures array.
        let json = r#"{
            "signed": {
                "_type": "targets",
                "spec_version": "1.0.0",
                "version": 1,
                "targets": {
                    "hearth-linux.txt": { "hashes": { "sha256": "abc" }, "length": 3 }
                }
            },
            "signatures": []
        }"#;
        let metadata = ReleaseMetadata::from_json(json).unwrap();
        let roots = TrustedRoots::new().with_key("root-2026", key(11).verifying_key());
        assert!(matches!(metadata.verify(&roots), Err(Error::Untrusted)));
    }

    #[test]
    fn rollback_is_rejected() {
        let (root, metadata, _) = sample();
        let roots = TrustedRoots::new().with_key("root-2026", root.verifying_key());
        let verified = metadata.verify(&roots).unwrap();
        verified.ensure_newer_than(2).unwrap(); // 3 > 2 ok
        assert!(matches!(
            verified.ensure_newer_than(3),
            Err(Error::Rollback { .. })
        ));
    }

    #[test]
    fn metadata_json_round_trip() {
        let (_root, metadata, _) = sample();
        let json = metadata.to_json().unwrap();
        let parsed = ReleaseMetadata::from_json(&json).unwrap();
        assert_eq!(parsed.signed.version, metadata.signed.version);
        assert_eq!(parsed.signatures.len(), 1);
    }
}
