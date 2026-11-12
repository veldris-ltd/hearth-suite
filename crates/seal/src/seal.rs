//! The Seal capability: `seal`, `unseal`, and `verify`.
//!
//! Sealing generates a random per-Bundle content key, encrypts the content with
//! AES-256-GCM, and wraps the content key to each recipient via the hybrid
//! X25519 + ML-KEM KEM (one [`Grant`] per recipient, mapping to a `SEAL_GRANT`
//! row). The manifest is signed with ML-DSA.

use x25519_dalek::StaticSecret;

use crate::crypto;
use crate::error::{Error, Result};
use crate::identity::{Identity, IdentityId, PublicIdentity};

/// Per-Bundle content key length (AES-256).
const CONTENT_KEY_LEN: usize = 32;

/// A wrapped content key for one recipient (a `SEAL_GRANT`).
pub struct Grant {
    /// The recipient this grant is for.
    pub recipient_id: IdentityId,
    /// The sender's ephemeral X25519 public key for this grant.
    pub ephemeral_x25519_public: [u8; 32],
    /// The ML-KEM ciphertext (encapsulated shared secret).
    pub kem_ciphertext: Vec<u8>,
    /// The content key, AEAD-wrapped under the hybrid key-encryption key.
    pub wrapped_content_key: Vec<u8>,
}

/// A sealed Bundle: encrypted content, per-recipient grants, and a signature.
pub struct SealedBundle {
    /// The (signed) manifest bytes, metadata, not content.
    pub manifest: Vec<u8>,
    /// AEAD-encrypted content (`nonce || ciphertext`).
    pub content: Vec<u8>,
    /// One grant per recipient.
    pub grants: Vec<Grant>,
    /// ML-DSA signature over the manifest.
    pub signature: Vec<u8>,
}

/// Seal `content` and `manifest` for the given `recipients`, signed by `signer`.
///
/// # Errors
/// Returns an error if the RNG, key establishment, or AEAD wrapping fails.
pub fn seal(
    manifest: &[u8],
    content: &[u8],
    recipients: &[PublicIdentity],
    signer: &Identity,
) -> Result<SealedBundle> {
    let content_key = crypto::random_array::<CONTENT_KEY_LEN>()?;
    let content_blob = crypto::aead_seal(&content_key, content)?;

    let mut grants = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        // Classical half: ephemeral X25519 Diffie-Hellman.
        let ephemeral = StaticSecret::from(crypto::random_array::<32>()?);
        let ephemeral_public = crypto::x25519_public(&ephemeral);
        let x25519_ss = crypto::x25519_dh(&ephemeral, &recipient.x25519_pub);

        // Post-quantum half: ML-KEM encapsulation.
        let (kem_ciphertext, kem_ss) = crypto::kem_encapsulate(&recipient.kem_ek)?;

        // Hybrid KEK wraps the content key.
        let kek = crypto::derive_kek(&x25519_ss, &kem_ss);
        let wrapped_content_key = crypto::aead_seal(&kek, &content_key)?;

        grants.push(Grant {
            recipient_id: recipient.id(),
            ephemeral_x25519_public: ephemeral_public,
            kem_ciphertext,
            wrapped_content_key,
        });
    }

    let signature = crypto::mldsa_sign(&signer.mldsa_sk, manifest);

    Ok(SealedBundle {
        manifest: manifest.to_vec(),
        content: content_blob,
        grants,
        signature,
    })
}

/// Unseal a Bundle with a recipient's `identity`, returning the content.
///
/// # Errors
/// Returns [`Error::NotRecipient`] if the identity has no grant, or a crypto
/// error if key establishment or decryption fails (wrong key / tampering).
pub fn unseal(sealed: &SealedBundle, identity: &Identity) -> Result<Vec<u8>> {
    let grant = sealed
        .grants
        .iter()
        .find(|g| g.recipient_id == identity.id())
        .ok_or(Error::NotRecipient)?;

    let x25519_ss = crypto::x25519_dh(&identity.x25519, &grant.ephemeral_x25519_public);
    let kem_ss = crypto::kem_decapsulate(&identity.kem_dk, &grant.kem_ciphertext)?;
    let kek = crypto::derive_kek(&x25519_ss, &kem_ss);

    let content_key_bytes = crypto::aead_open(&kek, &grant.wrapped_content_key)?;
    let content_key: [u8; CONTENT_KEY_LEN] = content_key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| Error::Crypto("unexpected content key length".to_owned()))?;

    crypto::aead_open(&content_key, &sealed.content)
}

/// Verify the manifest signature against the signer's public identity.
///
/// # Errors
/// Returns [`Error::VerificationFailed`] if the signature is invalid (wrong key
/// or tampered manifest).
pub fn verify(sealed: &SealedBundle, signer: &PublicIdentity) -> Result<()> {
    if crypto::mldsa_verify(&signer.mldsa_vk, &sealed.manifest, &sealed.signature) {
        Ok(())
    } else {
        Err(Error::VerificationFailed)
    }
}
