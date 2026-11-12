//! Identities: the per-user key material used to seal, unseal, and sign.

use ml_dsa::{MlDsa65, SigningKey, VerifyingKey};
use ml_kem::ml_kem_768::{DecapsulationKey as KemDk, EncapsulationKey as KemEk};
use x25519_dalek::StaticSecret;

use crate::crypto;
use crate::error::{Error, Result};

/// A stable 16-byte identity identifier.
pub type IdentityId = [u8; 16];

/// Length of a master identity seed, in bytes.
pub const SEED_LEN: usize = 32;

/// Serialization version byte for [`PublicIdentity`] encodings.
const PUBLIC_FORMAT_V1: u8 = 1;

/// A full identity, holding the secret keys needed to unseal and sign.
///
/// Combines the three key types of the hybrid scheme: an X25519 secret, an
/// ML-KEM-768 decapsulation key, and an ML-DSA-65 signing key.
pub struct Identity {
    pub(crate) id: IdentityId,
    pub(crate) x25519: StaticSecret,
    pub(crate) kem_dk: KemDk,
    pub(crate) kem_ek: KemEk,
    pub(crate) mldsa_sk: SigningKey<MlDsa65>,
}

/// The public half of an [`Identity`]: what a sender needs to seal to a
/// recipient and to verify their signatures.
pub struct PublicIdentity {
    pub(crate) id: IdentityId,
    pub(crate) x25519_pub: [u8; 32],
    pub(crate) kem_ek: KemEk,
    pub(crate) mldsa_vk: VerifyingKey<MlDsa65>,
}

impl Identity {
    /// Generate a fresh random identity.
    ///
    /// # Errors
    /// Returns an error if the system RNG fails or key derivation fails.
    #[allow(clippy::similar_names)] // `kem_dk` / `kem_ek` are the standard KEM key names
    pub fn generate() -> Result<Self> {
        let id = crypto::random_array::<16>()?;
        let x25519 = StaticSecret::from(crypto::random_array::<32>()?);
        let kem_seed = crypto::random_array::<64>()?;
        let (kem_dk, kem_ek) = crypto::kem_keypair_from_seed(&kem_seed)?;
        let mldsa_sk = crypto::mldsa_generate();
        Ok(Self {
            id,
            x25519,
            kem_dk,
            kem_ek,
            mldsa_sk,
        })
    }

    /// Deterministically derive a complete identity from a 32-byte master seed.
    ///
    /// All three keypairs (X25519, ML-KEM, ML-DSA) and the identity id are
    /// derived from the seed via HKDF, so the whole identity is reconstructible
    /// from the seed alone (the basis for recovery phrases in `key-manager`).
    ///
    /// # Errors
    /// Returns an error if key derivation fails.
    #[allow(clippy::similar_names)] // `kem_dk` / `kem_ek` are the standard KEM key names
    pub fn from_seed(master_seed: &[u8; SEED_LEN]) -> Result<Self> {
        let id = crypto::derive_subkey::<16>(master_seed, b"id");
        let x25519 = StaticSecret::from(crypto::derive_subkey::<32>(master_seed, b"x25519"));
        let kem_seed = crypto::derive_subkey::<64>(master_seed, b"ml-kem");
        let (kem_dk, kem_ek) = crypto::kem_keypair_from_seed(&kem_seed)?;
        let mldsa_seed = crypto::derive_subkey::<32>(master_seed, b"ml-dsa");
        let mldsa_sk = crypto::mldsa_keypair_from_seed(&mldsa_seed)?;
        Ok(Self {
            id,
            x25519,
            kem_dk,
            kem_ek,
            mldsa_sk,
        })
    }

    /// This identity's stable identifier.
    pub fn id(&self) -> IdentityId {
        self.id
    }

    /// Derive the public identity that can be shared with senders.
    pub fn public(&self) -> PublicIdentity {
        PublicIdentity {
            id: self.id,
            x25519_pub: crypto::x25519_public(&self.x25519),
            kem_ek: self.kem_ek.clone(),
            mldsa_vk: crypto::mldsa_verifying_key(&self.mldsa_sk),
        }
    }
}

impl PublicIdentity {
    /// This identity's stable identifier.
    pub fn id(&self) -> IdentityId {
        self.id
    }

    /// Serialize the public identity to a portable byte string.
    ///
    /// This is the payload exchanged out-of-band, via QR code, contact card,
    /// or an optional key directory, so two users can seal to each other.
    pub fn to_bytes(&self) -> Vec<u8> {
        let ek = crypto::kem_ek_to_bytes(&self.kem_ek);
        let vk = crypto::mldsa_vk_to_bytes(&self.mldsa_vk);
        let mut out = Vec::with_capacity(1 + 16 + 32 + 4 + ek.len() + 4 + vk.len());
        out.push(PUBLIC_FORMAT_V1);
        out.extend_from_slice(&self.id);
        out.extend_from_slice(&self.x25519_pub);
        out.extend_from_slice(&u32_len(ek.len()).to_le_bytes());
        out.extend_from_slice(&ek);
        out.extend_from_slice(&u32_len(vk.len()).to_le_bytes());
        out.extend_from_slice(&vk);
        out
    }

    /// Parse a public identity produced by [`to_bytes`](Self::to_bytes).
    ///
    /// # Errors
    /// Returns an error if the bytes are truncated, mis-versioned, or contain
    /// invalid key material.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let mut r = Reader::new(bytes);
        if r.u8()? != PUBLIC_FORMAT_V1 {
            return Err(Error::InvalidKey(
                "unsupported public identity version".to_owned(),
            ));
        }
        let id: IdentityId = r
            .take(16)?
            .try_into()
            .map_err(|_| Error::InvalidKey("id".to_owned()))?;
        let x25519_pub: [u8; 32] = r
            .take(32)?
            .try_into()
            .map_err(|_| Error::InvalidKey("x25519".to_owned()))?;
        let ek_len = r.u32()? as usize;
        let kem_ek = crypto::kem_ek_from_bytes(r.take(ek_len)?)?;
        let vk_len = r.u32()? as usize;
        let mldsa_vk = crypto::mldsa_vk_from_bytes(r.take(vk_len)?)?;
        Ok(Self {
            id,
            x25519_pub,
            kem_ek,
            mldsa_vk,
        })
    }
}

fn u32_len(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// A minimal bounds-checked byte reader for [`PublicIdentity::from_bytes`].
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| Error::InvalidKey("overflow".to_owned()))?;
        let slice = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| Error::InvalidKey("truncated public identity".to_owned()))?;
        self.pos = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32> {
        let b: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| Error::InvalidKey("u32".to_owned()))?;
        Ok(u32::from_le_bytes(b))
    }
}
