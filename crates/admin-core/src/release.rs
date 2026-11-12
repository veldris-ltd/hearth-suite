//! Release management: sign, publish, and promote channels (AC-ADMIN-5).
//!
//! The cryptographic verification reuses [`hearth_release`], the same code the
//! client uses to verify updates, so an operator can only promote a build the
//! client would itself accept. A release reaches `Stable` only by being signed,
//! verified against the trusted roots, and promoted from `Beta`.

use serde::{Deserialize, Serialize};

use hearth_release::{ReleaseMetadata, TrustedRoots};

use crate::error::{Error, Result};

/// A release distribution channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// Pre-release / testing channel.
    Beta,
    /// General-availability channel.
    Stable,
}

/// A release as tracked by the panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseRecord {
    /// The signed metadata version.
    pub version: u32,
    /// The channel the release currently occupies.
    pub channel: Channel,
}

/// Publish a release to the beta channel.
///
/// The metadata must verify against the trusted roots first (signature + the
/// internal hash/length checks of `hearth-release`).
///
/// # Errors
/// Returns [`Error::Release`] if the metadata is not validly signed.
pub fn publish_beta(metadata: &ReleaseMetadata, roots: &TrustedRoots) -> Result<ReleaseRecord> {
    let verified = metadata.verify(roots)?;
    Ok(ReleaseRecord {
        version: verified.version(),
        channel: Channel::Beta,
    })
}

/// Promote a beta release to stable.
///
/// Re-verifies the signed metadata, requires the record to currently be in
/// `Beta`, and requires the metadata version to match the record.
///
/// # Errors
/// Returns [`Error::InvalidPromotion`] if the record is not in beta or the
/// version disagrees, or [`Error::Release`] if the metadata does not verify.
pub fn promote_to_stable(
    record: &ReleaseRecord,
    metadata: &ReleaseMetadata,
    roots: &TrustedRoots,
) -> Result<ReleaseRecord> {
    if record.channel != Channel::Beta {
        return Err(Error::InvalidPromotion(
            "only beta releases may be promoted".to_owned(),
        ));
    }
    let verified = metadata.verify(roots)?;
    if verified.version() != record.version {
        return Err(Error::InvalidPromotion(
            "metadata version does not match the release".to_owned(),
        ));
    }
    Ok(ReleaseRecord {
        version: record.version,
        channel: Channel::Stable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hearth_release::{sign_targets, SignedTargets};
    use hearth_seal::ReleaseSigningKey;

    fn signed(version: u32) -> (ReleaseMetadata, TrustedRoots) {
        let key = ReleaseSigningKey::from_seed(&[5u8; 32]).unwrap();
        let targets = SignedTargets::new(version).with_target("Hearth.AppImage", b"bytes");
        let metadata = sign_targets(targets, "root-2026", &key).unwrap();
        let roots = TrustedRoots::new().with_key("root-2026", key.verifying_key());
        (metadata, roots)
    }

    #[test]
    fn publish_then_promote() {
        let (metadata, roots) = signed(7);
        let beta = publish_beta(&metadata, &roots).unwrap();
        assert_eq!(beta.channel, Channel::Beta);
        assert_eq!(beta.version, 7);

        let stable = promote_to_stable(&beta, &metadata, &roots).unwrap();
        assert_eq!(stable.channel, Channel::Stable);
    }

    #[test]
    fn cannot_publish_unverified() {
        let (metadata, _roots) = signed(7);
        // Empty roots → nothing verifies.
        let empty = TrustedRoots::new();
        assert!(matches!(
            publish_beta(&metadata, &empty),
            Err(Error::Release(_))
        ));
    }

    #[test]
    fn cannot_promote_a_stable_release_again() {
        let (metadata, roots) = signed(7);
        let stable = ReleaseRecord {
            version: 7,
            channel: Channel::Stable,
        };
        assert!(matches!(
            promote_to_stable(&stable, &metadata, &roots),
            Err(Error::InvalidPromotion(_))
        ));
    }

    #[test]
    fn cannot_promote_with_mismatched_version() {
        let (metadata, roots) = signed(7);
        let beta = ReleaseRecord {
            version: 6,
            channel: Channel::Beta,
        };
        assert!(matches!(
            promote_to_stable(&beta, &metadata, &roots),
            Err(Error::InvalidPromotion(_))
        ));
    }
}
