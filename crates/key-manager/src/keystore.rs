//! Identity creation, at-rest protection, recovery, and rotation.

use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

use hearth_seal::{Identity, IdentityId, PublicIdentity, SEED_LEN};

use crate::error::{Error, Result};
use crate::recovery::RecoveryPhrase;

/// Length of the at-rest key-derivation salt.
const SALT_LEN: usize = 16;
/// XChaCha20-Poly1305 nonce length.
const NONCE_LEN: usize = 24;

/// An identity at rest: public material in the clear, the master seed encrypted.
///
/// The master seed (the private key material) is **never** stored in plaintext
/// (`AC-SEC-8`); only `sealed_seed` (nonce + ciphertext) is persisted.
#[derive(Clone)]
pub struct EncryptedIdentity {
    /// Stable identity id.
    pub id: IdentityId,
    /// Rotation epoch this keystore's public key corresponds to.
    pub epoch: u32,
    /// Serialized current public identity (for `IDENTITY.pq_public_key`).
    pub public_key: Vec<u8>,
    /// SHA-256 hex of the recovery phrase (for `IDENTITY.recovery_phrase_hash`).
    pub recovery_phrase_hash: String,
    /// Argon2 salt used to derive the at-rest key.
    pub salt: [u8; SALT_LEN],
    /// The master seed, encrypted at rest (`IDENTITY.pq_private_key_encrypted`).
    pub sealed_seed: Vec<u8>,
}

/// An unlocked identity, ready to seal, unseal, and sign.
pub struct UnlockedIdentity {
    master: [u8; SEED_LEN],
    epoch: u32,
    identity: Identity,
}

impl UnlockedIdentity {
    /// The Seal identity for the current epoch.
    pub fn identity(&self) -> &Identity {
        &self.identity
    }

    /// The public identity to share with senders.
    pub fn public(&self) -> PublicIdentity {
        self.identity.public()
    }

    /// The stable identity id.
    pub fn id(&self) -> IdentityId {
        self.identity.id()
    }

    /// The current rotation epoch.
    pub fn epoch(&self) -> u32 {
        self.epoch
    }
}

/// Create a brand-new identity: returns the unlocked identity, its at-rest
/// keystore, and the recovery phrase to show the user once.
///
/// # Errors
/// Returns an error if the RNG, key derivation, or encryption fails.
pub fn create(passphrase: &[u8]) -> Result<(UnlockedIdentity, EncryptedIdentity, RecoveryPhrase)> {
    let master = random_seed()?;
    let phrase = RecoveryPhrase::from_seed(&master)?;
    let unlocked = unlocked_from_master(master, 0)?;
    let encrypted = encrypt_at_rest(&unlocked, passphrase, &phrase)?;
    Ok((unlocked, encrypted, phrase))
}

/// Unlock a stored identity with its passphrase.
///
/// # Errors
/// Returns [`Error::Unlock`] if the passphrase is wrong or the keystore is
/// corrupt.
pub fn unlock(encrypted: &EncryptedIdentity, passphrase: &[u8]) -> Result<UnlockedIdentity> {
    let key = derive_at_rest_key(passphrase, &encrypted.salt)?;
    let master_bytes = aead_open(&key, &encrypted.sealed_seed).map_err(|_| Error::Unlock)?;
    let master: [u8; SEED_LEN] = master_bytes
        .as_slice()
        .try_into()
        .map_err(|_| Error::Unlock)?;
    unlocked_from_master(master, encrypted.epoch)
}

/// Restore an identity from its recovery phrase on a clean install, re-encrypting
/// it at rest under `passphrase` (`AC-SEC-7`).
///
/// # Errors
/// Returns an error if the phrase is invalid or re-encryption fails.
pub fn restore(
    phrase: &RecoveryPhrase,
    passphrase: &[u8],
) -> Result<(UnlockedIdentity, EncryptedIdentity)> {
    let master = phrase.to_seed()?;
    let unlocked = unlocked_from_master(master, 0)?;
    let encrypted = encrypt_at_rest(&unlocked, passphrase, phrase)?;
    Ok((unlocked, encrypted))
}

/// Rotate to the next key epoch, producing a fresh public key while remaining
/// recoverable from the same phrase.
///
/// # Errors
/// Returns an error if key derivation or re-encryption fails.
pub fn rotate(
    current: &UnlockedIdentity,
    phrase: &RecoveryPhrase,
    passphrase: &[u8],
) -> Result<(UnlockedIdentity, EncryptedIdentity)> {
    let next_epoch = current.epoch.saturating_add(1);
    let unlocked = unlocked_from_master(current.master, next_epoch)?;
    let encrypted = encrypt_at_rest(&unlocked, passphrase, phrase)?;
    Ok((unlocked, encrypted))
}

// ---- internals --------------------------------------------------------------

fn random_seed() -> Result<[u8; SEED_LEN]> {
    let mut seed = [0u8; SEED_LEN];
    getrandom::fill(&mut seed).map_err(|e| Error::Crypto(format!("rng: {e}")))?;
    Ok(seed)
}

/// Derive the identity for a given epoch from the master seed.
fn unlocked_from_master(master: [u8; SEED_LEN], epoch: u32) -> Result<UnlockedIdentity> {
    let hk = Hkdf::<Sha256>::new(Some(b"hearth-keymgr-epoch-v1"), &master);
    let mut epoch_seed = [0u8; SEED_LEN];
    hk.expand(&epoch.to_le_bytes(), &mut epoch_seed)
        .map_err(|_| Error::Crypto("epoch key derivation".to_owned()))?;
    let identity = Identity::from_seed(&epoch_seed)?;
    Ok(UnlockedIdentity {
        master,
        epoch,
        identity,
    })
}

fn encrypt_at_rest(
    unlocked: &UnlockedIdentity,
    passphrase: &[u8],
    phrase: &RecoveryPhrase,
) -> Result<EncryptedIdentity> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|e| Error::Crypto(format!("rng: {e}")))?;
    let key = derive_at_rest_key(passphrase, &salt)?;
    let sealed_seed = aead_seal(&key, &unlocked.master)?;

    let mut hasher = Sha256::new();
    hasher.update(phrase.as_str().as_bytes());

    Ok(EncryptedIdentity {
        id: unlocked.id(),
        epoch: unlocked.epoch,
        public_key: unlocked.public().to_bytes(),
        recovery_phrase_hash: hex::encode(hasher.finalize()),
        salt,
        sealed_seed,
    })
}

/// Derive the 256-bit at-rest key from the passphrase via Argon2id.
fn derive_at_rest_key(passphrase: &[u8], salt: &[u8; SALT_LEN]) -> Result<[u8; 32]> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|e| Error::Crypto(format!("argon2: {e}")))?;
    Ok(key)
}

fn aead_seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher =
        XChaCha20Poly1305::new_from_slice(key).map_err(|e| Error::Crypto(e.to_string()))?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| Error::Crypto(format!("rng: {e}")))?;
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|e| Error::Crypto(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn aead_open(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN {
        return Err(Error::Crypto("sealed seed too short".to_owned()));
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher =
        XChaCha20Poly1305::new_from_slice(key).map_err(|e| Error::Crypto(e.to_string()))?;
    cipher
        .decrypt(XNonce::from_slice(nonce), ciphertext)
        .map_err(|e| Error::Crypto(e.to_string()))
}
