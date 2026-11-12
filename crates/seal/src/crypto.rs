//! Cryptographic primitives for Seal.
//!
//! Every primitive is provided by a vetted, open, audited library, nothing is
//! hand-rolled (`AC-SEC-6`):
//!
//! - **Key establishment**: hybrid X25519 ([`x25519_dalek`]) + ML-KEM-768
//!   (FIPS 203, [`ml_kem`]), combined through HKDF-SHA256.
//! - **Signatures**: ML-DSA-65 (FIPS 204, [`ml_dsa`]); SLH-DSA / SHAKE-128f
//!   (FIPS 205, [`slh_dsa`]) as an archival option.
//! - **Bulk content**: AES-256-GCM ([`aes_gcm`]).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key as AesKey, Nonce};
use hkdf::Hkdf;
use ml_kem::kem::Decapsulate;
use ml_kem::ml_kem_768::{
    Ciphertext as KemCt, DecapsulationKey as KemDk, EncapsulationKey as KemEk,
};
use ml_kem::{Key as KemKey, KeyExport, Seed, B32};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

// ML-DSA's traits come from `signature` 2.x (re-exported by `ml_dsa`); SLH-DSA's
// come from `signature` 3.x (re-exported by `slh_dsa`). Importing each scheme's
// traits anonymously lets method resolution pick the right one per key type.
use ml_dsa::{
    Generate as _, Keypair as _, MlDsa65, SignatureEncoding as _, Signer as _, SigningKey,
    Verifier as _, VerifyingKey,
};
use slh_dsa::Shake128f;

use crate::error::{Error, Result};

/// AES-256-GCM nonce length.
const AES_NONCE_LEN: usize = 12;

/// An OS-backed CSPRNG implementing `rand_core` 0.10's traits, for the few APIs
/// (SLH-DSA key generation) that require an explicit RNG.
struct OsRng;

impl rand_core::TryRng for OsRng {
    type Error = core::convert::Infallible;

    fn try_next_u32(&mut self) -> std::result::Result<u32, Self::Error> {
        let mut b = [0u8; 4];
        self.try_fill_bytes(&mut b)?;
        Ok(u32::from_le_bytes(b))
    }

    fn try_next_u64(&mut self) -> std::result::Result<u64, Self::Error> {
        let mut b = [0u8; 8];
        self.try_fill_bytes(&mut b)?;
        Ok(u64::from_le_bytes(b))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> std::result::Result<(), Self::Error> {
        getrandom::fill(dst).expect("operating-system CSPRNG is available");
        Ok(())
    }
}

impl rand_core::TryCryptoRng for OsRng {}

// ---- randomness -------------------------------------------------------------

/// Fill an `N`-byte array from the operating-system CSPRNG.
pub(crate) fn random_array<const N: usize>() -> Result<[u8; N]> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| Error::Crypto(format!("rng failure: {e}")))?;
    Ok(buf)
}

fn to_array32(bytes: &[u8]) -> Result<[u8; 32]> {
    bytes
        .try_into()
        .map_err(|_| Error::Crypto("expected 32-byte value".to_owned()))
}

// ---- AES-256-GCM ------------------------------------------------------------

/// Encrypt `plaintext` under a 256-bit key, returning `nonce || ciphertext`.
pub(crate) fn aead_seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
    let nonce_bytes = random_array::<AES_NONCE_LEN>()?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| Error::Crypto(format!("aead encrypt: {e}")))?;
    let mut out = Vec::with_capacity(AES_NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a `nonce || ciphertext` blob; fails on tampering or wrong key.
pub(crate) fn aead_open(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < AES_NONCE_LEN {
        return Err(Error::Crypto("aead blob too short".to_owned()));
    }
    let (nonce, ciphertext) = blob.split_at(AES_NONCE_LEN);
    let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| Error::Crypto("aead authentication failed".to_owned()))
}

// ---- HKDF -------------------------------------------------------------------

/// Derive a 256-bit key-encryption key from the two hybrid shared secrets.
///
/// Combining both secrets means the result stays secret if *either* the
/// classical (X25519) or the post-quantum (ML-KEM) secret alone is later
/// compromised (`AC-SEC-1`).
pub(crate) fn derive_kek(x25519_ss: &[u8; 32], mlkem_ss: &[u8; 32]) -> [u8; 32] {
    let mut ikm = [0u8; 64];
    ikm[..32].copy_from_slice(x25519_ss);
    ikm[32..].copy_from_slice(mlkem_ss);
    let hk = Hkdf::<Sha256>::new(Some(b"hearth-seal-hybrid-v1"), &ikm);
    let mut kek = [0u8; 32];
    hk.expand(b"content-key-wrap", &mut kek)
        .expect("32-byte HKDF-SHA256 output is always valid");
    kek
}

/// Derive an `N`-byte subkey from a 32-byte master seed and a domain label.
///
/// Used to derive each algorithm's key material from a single identity seed, so
/// the whole identity is reconstructible from one recovery phrase.
pub(crate) fn derive_subkey<const N: usize>(master: &[u8; 32], info: &[u8]) -> [u8; N] {
    let hk = Hkdf::<Sha256>::new(Some(b"hearth-identity-v1"), master);
    let mut out = [0u8; N];
    hk.expand(info, &mut out)
        .expect("HKDF output length is within bounds");
    out
}

// ---- X25519 -----------------------------------------------------------------

pub(crate) fn x25519_public(secret: &StaticSecret) -> [u8; 32] {
    PublicKey::from(secret).to_bytes()
}

pub(crate) fn x25519_dh(secret: &StaticSecret, peer_public: &[u8; 32]) -> [u8; 32] {
    let peer = PublicKey::from(*peer_public);
    *secret.diffie_hellman(&peer).as_bytes()
}

// ---- ML-KEM-768 -------------------------------------------------------------

/// Deterministically derive an ML-KEM keypair from a 64-byte seed.
pub(crate) fn kem_keypair_from_seed(seed: &[u8; 64]) -> Result<(KemDk, KemEk)> {
    let seed =
        Seed::try_from(&seed[..]).map_err(|_| Error::InvalidKey("ml-kem seed".to_owned()))?;
    let dk = KemDk::from_seed(seed);
    let ek = dk.encapsulation_key().clone();
    Ok((dk, ek))
}

pub(crate) fn kem_ek_to_bytes(ek: &KemEk) -> Vec<u8> {
    ek.to_bytes().as_slice().to_vec()
}

pub(crate) fn kem_ek_from_bytes(bytes: &[u8]) -> Result<KemEk> {
    let key =
        KemKey::<KemEk>::try_from(bytes).map_err(|_| Error::InvalidKey("ml-kem ek".to_owned()))?;
    KemEk::new(&key).map_err(|_| Error::InvalidKey("ml-kem ek".to_owned()))
}

/// Encapsulate to `ek`, returning `(ciphertext_bytes, shared_secret)`.
pub(crate) fn kem_encapsulate(ek: &KemEk) -> Result<(Vec<u8>, [u8; 32])> {
    let m = random_array::<32>()?;
    let m = B32::try_from(&m[..]).map_err(|_| Error::Crypto("ml-kem message".to_owned()))?;
    let (ct, ss) = ek.encapsulate_deterministic(&m);
    Ok((ct.as_slice().to_vec(), to_array32(ss.as_slice())?))
}

/// Decapsulate `ciphertext_bytes` with `dk`, returning the shared secret.
pub(crate) fn kem_decapsulate(dk: &KemDk, ciphertext: &[u8]) -> Result<[u8; 32]> {
    let ct = KemCt::try_from(ciphertext).map_err(|_| Error::InvalidKey("ml-kem ct".to_owned()))?;
    let ss = dk.decapsulate(&ct);
    to_array32(ss.as_slice())
}

// ---- ML-DSA-65 (FIPS 204) ---------------------------------------------------

pub(crate) fn mldsa_generate() -> SigningKey<MlDsa65> {
    SigningKey::<MlDsa65>::generate()
}

/// Deterministically derive an ML-DSA signing key from a 32-byte seed (FIPS 204
/// `KeyGen_internal`).
pub(crate) fn mldsa_keypair_from_seed(seed: &[u8; 32]) -> Result<SigningKey<MlDsa65>> {
    use ml_dsa::KeyInit;
    let key = ml_dsa::common::Key::<SigningKey<MlDsa65>>::try_from(&seed[..])
        .map_err(|_| Error::InvalidKey("ml-dsa seed".to_owned()))?;
    Ok(<SigningKey<MlDsa65> as KeyInit>::new(&key))
}

pub(crate) fn mldsa_verifying_key(sk: &SigningKey<MlDsa65>) -> VerifyingKey<MlDsa65> {
    sk.verifying_key()
}

pub(crate) fn mldsa_vk_to_bytes(vk: &VerifyingKey<MlDsa65>) -> Vec<u8> {
    use ml_dsa::KeyExport;
    vk.to_bytes().as_slice().to_vec()
}

pub(crate) fn mldsa_vk_from_bytes(bytes: &[u8]) -> Result<VerifyingKey<MlDsa65>> {
    use ml_dsa::KeyInit;
    let key = ml_dsa::common::Key::<VerifyingKey<MlDsa65>>::try_from(bytes)
        .map_err(|_| Error::InvalidKey("ml-dsa vk".to_owned()))?;
    Ok(<VerifyingKey<MlDsa65> as KeyInit>::new(&key))
}

pub(crate) fn mldsa_sign(sk: &SigningKey<MlDsa65>, message: &[u8]) -> Vec<u8> {
    sk.sign(message).to_bytes().as_slice().to_vec()
}

pub(crate) fn mldsa_verify(vk: &VerifyingKey<MlDsa65>, message: &[u8], signature: &[u8]) -> bool {
    match ml_dsa::Signature::<MlDsa65>::try_from(signature) {
        Ok(sig) => vk.verify(message, &sig).is_ok(),
        Err(_) => false,
    }
}

// ---- SLH-DSA / SHAKE-128f (FIPS 205), archival option ----------------------

pub(crate) fn slhdsa_generate() -> slh_dsa::SigningKey<Shake128f> {
    let mut rng = OsRng;
    slh_dsa::SigningKey::<Shake128f>::new(&mut rng)
}

pub(crate) fn slhdsa_verifying_key(
    sk: &slh_dsa::SigningKey<Shake128f>,
) -> slh_dsa::VerifyingKey<Shake128f> {
    sk.verifying_key()
}

pub(crate) fn slhdsa_sign(sk: &slh_dsa::SigningKey<Shake128f>, message: &[u8]) -> Vec<u8> {
    sk.sign(message).to_bytes().as_slice().to_vec()
}

pub(crate) fn slhdsa_verify(
    vk: &slh_dsa::VerifyingKey<Shake128f>,
    message: &[u8],
    signature: &[u8],
) -> bool {
    match slh_dsa::Signature::<Shake128f>::try_from(signature) {
        Ok(sig) => vk.verify(message, &sig).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod kat {
    //! Known-answer tests (`AC-SEC-5`).
    //!
    //! Each FIPS primitive is exercised with a fixed seed and pinned outputs, so
    //! any change in behaviour fails CI. The upstream RustCrypto crates also run
    //! the full NIST/ACVP vector suites in their own CI; authoritative ACVP
    //! vector files can be dropped into a `tests/vectors/` harness as they are
    //! published.

    use super::*;
    use sha2::{Digest, Sha256};

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut d = Sha256::new();
        d.update(bytes);
        hex::encode(d.finalize())
    }

    // FIPS 203 (ML-KEM-768): fixed 64-byte keygen seed and 32-byte encaps coins.
    const MLKEM_SEED: [u8; 64] = [0x42; 64];
    const MLKEM_COINS: [u8; 32] = [0x07; 32];
    const MLKEM_EK_SHA256: &str =
        "8cde1b49992415b527e361f52465634978fcc488d6f541c4a1fec97fd14b4661";
    const MLKEM_CT_SHA256: &str =
        "d54ac82b1bb13d88772bfce83cf88deeaef060ef8e18c962f7ca2135a9fc1875";
    const MLKEM_SS_HEX: &str = "7086c0ef2f42dae278e18a1beb1552713341dac0da820821c5b7182e99735544";

    #[test]
    fn mlkem768_known_answer() {
        let (dk, ek) = kem_keypair_from_seed(&MLKEM_SEED).unwrap();
        // Deterministic keygen: the same seed always yields the same key.
        let (_dk2, ek2) = kem_keypair_from_seed(&MLKEM_SEED).unwrap();
        assert_eq!(kem_ek_to_bytes(&ek), kem_ek_to_bytes(&ek2));

        // Deterministic encapsulation against the pinned vector.
        let coins = B32::try_from(&MLKEM_COINS[..]).unwrap();
        let (ct, ss) = ek.encapsulate_deterministic(&coins);
        assert_eq!(sha256_hex(&kem_ek_to_bytes(&ek)), MLKEM_EK_SHA256);
        assert_eq!(sha256_hex(ct.as_slice()), MLKEM_CT_SHA256);
        assert_eq!(hex::encode(ss.as_slice()), MLKEM_SS_HEX);

        // Decapsulation recovers the same shared secret.
        let recovered = kem_decapsulate(&dk, ct.as_slice()).unwrap();
        assert_eq!(hex::encode(recovered), MLKEM_SS_HEX);
    }

    // FIPS 204 (ML-DSA-65): fixed 32-byte keygen seed.
    const MLDSA_SEED: [u8; 32] = [0x9c; 32];
    const MLDSA_VK_SHA256: &str =
        "d9cf74c8cd6ee181076161265c4821897b0815e2925060f661012c8a1dc21178";

    #[test]
    fn mldsa65_known_answer() {
        let sk = mldsa_keypair_from_seed(&MLDSA_SEED).unwrap();
        let sk2 = mldsa_keypair_from_seed(&MLDSA_SEED).unwrap();
        let vk = mldsa_verifying_key(&sk);

        // Deterministic keygen yields the pinned verifying key.
        assert_eq!(
            mldsa_vk_to_bytes(&vk),
            mldsa_vk_to_bytes(&mldsa_verifying_key(&sk2))
        );
        assert_eq!(sha256_hex(&mldsa_vk_to_bytes(&vk)), MLDSA_VK_SHA256);

        // Sign/verify round-trip and a negative (tampered message) case.
        let sig = mldsa_sign(&sk, b"FIPS 204 KAT message");
        assert!(mldsa_verify(&vk, b"FIPS 204 KAT message", &sig));
        assert!(!mldsa_verify(&vk, b"tampered message", &sig));
    }

    #[test]
    fn slhdsa_archival_sign_verify() {
        let sk = slhdsa_generate();
        let vk = slhdsa_verifying_key(&sk);
        let sig = slhdsa_sign(&sk, b"archival message");
        assert!(slhdsa_verify(&vk, b"archival message", &sig));
        assert!(!slhdsa_verify(&vk, b"different message", &sig));
    }

    #[test]
    fn aead_detects_tampering() {
        let key = [0x11u8; 32];
        let mut blob = aead_seal(&key, b"confidential").unwrap();
        assert_eq!(aead_open(&key, &blob).unwrap(), b"confidential");
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(aead_open(&key, &blob).is_err());
    }

    #[test]
    fn hybrid_kek_depends_on_both_secrets() {
        let base = derive_kek(&[1u8; 32], &[2u8; 32]);
        assert_ne!(base, derive_kek(&[9u8; 32], &[2u8; 32])); // classical changed
        assert_ne!(base, derive_kek(&[1u8; 32], &[9u8; 32])); // post-quantum changed
    }

    fn decode_fixed<const N: usize>(hex_str: &str) -> [u8; N] {
        let bytes = hex::decode(hex_str).expect("valid hex in vectors file");
        <[u8; N]>::try_from(&bytes[..]).expect("vector seed has the expected length")
    }

    /// Verify the in-scope implementation against the checked-in vectors file
    /// (`tests/vectors/kat-vectors.json`), the reviewable source of truth for
    /// the crypto audit package (P2-Q3, AC-SEC-12). Any drift fails CI.
    #[test]
    fn kat_vectors_file_matches_implementation() {
        let raw = include_str!("../tests/vectors/kat-vectors.json");
        let vectors: serde_json::Value =
            serde_json::from_str(raw).expect("kat-vectors.json parses");

        // ML-KEM-768 (FIPS 203): deterministic keygen + encapsulation.
        let kem = &vectors["ml_kem_768"];
        let seed = decode_fixed::<64>(kem["keygen_seed_hex"].as_str().unwrap());
        let coins_bytes = hex::decode(kem["encaps_coins_hex"].as_str().unwrap()).unwrap();
        let (dk, ek) = kem_keypair_from_seed(&seed).unwrap();
        assert_eq!(
            sha256_hex(&kem_ek_to_bytes(&ek)),
            kem["ek_sha256"].as_str().unwrap()
        );
        let coins = B32::try_from(&coins_bytes[..]).unwrap();
        let (ct, ss) = ek.encapsulate_deterministic(&coins);
        assert_eq!(
            sha256_hex(ct.as_slice()),
            kem["ct_sha256"].as_str().unwrap()
        );
        assert_eq!(
            hex::encode(ss.as_slice()),
            kem["shared_secret_hex"].as_str().unwrap()
        );
        let recovered = kem_decapsulate(&dk, ct.as_slice()).unwrap();
        assert_eq!(
            hex::encode(recovered),
            kem["shared_secret_hex"].as_str().unwrap()
        );

        // ML-DSA-65 (FIPS 204): deterministic keygen, verifying key pinned.
        let dsa = &vectors["ml_dsa_65"];
        let dsa_seed = decode_fixed::<32>(dsa["keygen_seed_hex"].as_str().unwrap());
        let sk = mldsa_keypair_from_seed(&dsa_seed).unwrap();
        let vk = mldsa_verifying_key(&sk);
        assert_eq!(
            sha256_hex(&mldsa_vk_to_bytes(&vk)),
            dsa["vk_sha256"].as_str().unwrap()
        );
    }
}
