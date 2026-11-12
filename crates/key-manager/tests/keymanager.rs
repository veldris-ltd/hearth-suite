//! Key-manager tests (`AC-SEC-7..9`, `AC-UX-SEAL-1`).

use hearth_key_manager::{
    create, restore, rotate, ContactCard, Device, PairingCode, RecoveryPhrase,
};
use hearth_seal::{seal, unseal, Identity};

const PASS: &[u8] = b"correct horse battery staple";

/// P2-CL4: the app derives its identity directly from a 32-byte seed
/// (`Identity::from_seed`), and the recovery phrase encodes exactly that seed.
/// So a phrase shown on one device, re-entered on a fresh device, reconstructs
/// the identical identity (same public key). This is the seam the FFI exposes as
/// `recovery_phrase()` / `open_from_phrase()`.
#[test]
fn phrase_round_trips_the_app_seed_and_reconstructs_identity() {
    let seed: [u8; 32] = [
        7, 9, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
        101, 103, 107, 109, 113, 127, 131, 137, 139,
    ];

    let phrase = RecoveryPhrase::from_seed(&seed).unwrap();
    assert_eq!(phrase.word_count(), 24);

    // Parsing the displayed words back recovers the exact seed.
    let reparsed = RecoveryPhrase::parse(phrase.as_str()).unwrap();
    assert_eq!(reparsed.to_seed().unwrap(), seed);

    // And the identity rebuilt on a "fresh device" matches byte for byte.
    let original = Identity::from_seed(&seed).unwrap();
    let restored = Identity::from_seed(&reparsed.to_seed().unwrap()).unwrap();
    assert_eq!(restored.id(), original.id());
    assert_eq!(restored.public().to_bytes(), original.public().to_bytes());

    // A tampered phrase fails its checksum rather than yielding a wrong seed.
    assert!(RecoveryPhrase::parse("hello world not a real mnemonic phrase").is_err());
}

/// AC-SEC-7: restoring from the recovery phrase on a clean install recovers the
/// identity and access to its sealed Bundles.
#[test]
fn recovery_phrase_round_trip_recovers_sealed_access() {
    let (original, encrypted, phrase) = create(PASS).unwrap();
    assert_eq!(phrase.word_count(), 24);

    // A sender seals a Bundle to the original identity's public key.
    let sender = create(PASS).unwrap().0;
    let sealed = seal(
        b"manifest",
        b"private contents",
        &[original.public()],
        sender.identity(),
    )
    .unwrap();

    // On a "clean install", restore from the phrase alone (new passphrase).
    let (restored, _) = restore(&phrase, b"a-new-device-passphrase").unwrap();

    // Same identity, same public key.
    assert_eq!(restored.id(), original.id());
    assert_eq!(restored.public().to_bytes(), encrypted.public_key);

    // And it can unseal the Bundle that was sealed to the original.
    assert_eq!(
        unseal(&sealed, restored.identity()).unwrap(),
        b"private contents"
    );
}

/// AC-SEC-8: the master seed is encrypted at rest and never stored in plaintext.
#[test]
fn private_key_is_protected_at_rest() {
    let (_unlocked, encrypted, phrase) = create(PASS).unwrap();

    // The master seed is the BIP-39 entropy of the phrase; it must not appear
    // anywhere in the encrypted keystore blob.
    let master = bip39::Mnemonic::parse(phrase.as_str())
        .unwrap()
        .to_entropy();
    assert!(
        !encrypted
            .sealed_seed
            .windows(master.len())
            .any(|w| w == master.as_slice()),
        "master seed leaked into the keystore"
    );

    // Unlock fails with the wrong passphrase and succeeds with the right one.
    assert!(hearth_key_manager::unlock(&encrypted, b"wrong passphrase").is_err());
    let reopened = hearth_key_manager::unlock(&encrypted, PASS).unwrap();
    assert_eq!(reopened.id(), encrypted.id);
}

/// AC-SEC-9 / AC-UX-SEAL-1: two users with no cloud exchange contact cards and
/// seal to each other, no key directory, no key handling.
#[test]
fn key_exchange_without_directory() {
    let alice = create(PASS).unwrap().0;
    let bob = create(PASS).unwrap().0;

    // Alice shares her contact card (e.g. as a QR code / copied text).
    let card_text = ContactCard::from_public(&alice.public()).to_hex();

    // Bob scans/pastes it and seals a Bundle for Alice, the only input is the
    // recipient card; no key material is handled by Bob.
    let alice_public = ContactCard::from_hex(&card_text)
        .unwrap()
        .public_identity()
        .unwrap();
    let sealed = seal(b"m", b"for alice only", &[alice_public], bob.identity()).unwrap();

    assert_eq!(
        unseal(&sealed, alice.identity()).unwrap(),
        b"for alice only"
    );
    // A different identity cannot unseal it.
    assert!(unseal(&sealed, bob.identity()).is_err());
}

/// Key rotation: a new epoch yields a fresh public key, old Bundles still open
/// with the old epoch, and every epoch remains recoverable from the phrase.
#[test]
fn key_rotation() {
    let (epoch0, _enc0, phrase) = create(PASS).unwrap();
    let sender = create(PASS).unwrap().0;

    let sealed_old = seal(
        b"m",
        b"old-era secret",
        &[epoch0.public()],
        sender.identity(),
    )
    .unwrap();

    // Rotate to the next epoch.
    let (epoch1, _enc1) = rotate(&epoch0, &phrase, PASS).unwrap();
    assert_eq!(epoch1.epoch(), 1);
    assert_ne!(epoch1.public().to_bytes(), epoch0.public().to_bytes());

    let sealed_new = seal(
        b"m",
        b"new-era secret",
        &[epoch1.public()],
        sender.identity(),
    )
    .unwrap();

    // Each epoch opens its own era; the new epoch cannot open the old Bundle.
    assert_eq!(
        unseal(&sealed_old, epoch0.identity()).unwrap(),
        b"old-era secret"
    );
    assert_eq!(
        unseal(&sealed_new, epoch1.identity()).unwrap(),
        b"new-era secret"
    );
    assert!(unseal(&sealed_old, epoch1.identity()).is_err());

    // The phrase regenerates epoch 0, and rotating it reproduces epoch 1.
    let (restored0, _) = restore(&phrase, PASS).unwrap();
    assert_eq!(restored0.id(), epoch0.id());
    let (restored1, _) = rotate(&restored0, &phrase, PASS).unwrap();
    assert_eq!(restored1.id(), epoch1.id());
}

/// Device pairing produces a DEVICE record under the identity.
#[test]
fn device_pairing() {
    let identity = create(PASS).unwrap().0;

    let code = PairingCode::generate().unwrap();
    assert!(code.matches(&code.display()));
    assert!(!code.matches("00000000"));

    let device = code
        .accept(&code.display(), identity.id(), "android")
        .unwrap();
    assert_eq!(device.identity_id, uuid::Uuid::from_bytes(identity.id()));
    assert_eq!(device.platform, "android");
    assert!(code.accept("deadbeef", identity.id(), "android").is_err());

    // A device can also be paired directly.
    let direct = Device::pair(identity.id(), "windows");
    assert_eq!(direct.identity_id, uuid::Uuid::from_bytes(identity.id()));
}
