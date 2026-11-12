//! Seal integration tests (`AC-SEC-1..4`).

use hearth_seal::archival::ArchivalKey;
use hearth_seal::{seal, unseal, verify, Error, Identity};

/// AC-SEC-1/3/4: hybrid key establishment, authenticated content, and
/// recipient-scoped access, A and B can unseal, C cannot.
#[test]
fn seal_unseal_is_recipient_scoped() {
    let sender = Identity::generate().unwrap();
    let alice = Identity::generate().unwrap();
    let bob = Identity::generate().unwrap();
    let carol = Identity::generate().unwrap();

    let content = b"the quarterly figures are confidential";
    let sealed = seal(
        b"manifest-v1",
        content,
        &[alice.public(), bob.public()],
        &sender,
    )
    .unwrap();

    // Recipients recover the content (exercises the full hybrid KEM path).
    assert_eq!(unseal(&sealed, &alice).unwrap(), content);
    assert_eq!(unseal(&sealed, &bob).unwrap(), content);

    // A non-recipient cannot unseal.
    assert!(matches!(unseal(&sealed, &carol), Err(Error::NotRecipient)));
}

/// AC-SEC-2: the manifest signature verifies, and tampering breaks it.
#[test]
fn signature_verifies_and_detects_manifest_tampering() {
    let sender = Identity::generate().unwrap();
    let bob = Identity::generate().unwrap();

    let mut sealed = seal(b"the-real-manifest", b"content", &[bob.public()], &sender).unwrap();
    verify(&sealed, &sender.public()).expect("valid signature must verify");

    // A different signer's key must not verify.
    assert!(verify(&sealed, &bob.public()).is_err());

    // Tampering with the signed manifest fails verification.
    sealed.manifest = b"a-tampered-manifest".to_vec();
    assert!(matches!(
        verify(&sealed, &sender.public()),
        Err(Error::VerificationFailed)
    ));
}

/// AC-SEC-3: AES-256-GCM content decryption fails on tampering.
#[test]
fn content_tampering_fails_unseal() {
    let sender = Identity::generate().unwrap();
    let bob = Identity::generate().unwrap();

    let mut sealed = seal(b"m", b"top secret bytes", &[bob.public()], &sender).unwrap();
    let last = sealed.content.len() - 1;
    sealed.content[last] ^= 0x01;

    assert!(unseal(&sealed, &bob).is_err());
}

/// AC-SEC-4: a recipient cannot unseal another recipient's grant with the wrong
/// key, flipping the wrapped key fails authentication.
#[test]
fn tampered_grant_fails() {
    let sender = Identity::generate().unwrap();
    let bob = Identity::generate().unwrap();

    let mut sealed = seal(b"m", b"secret", &[bob.public()], &sender).unwrap();
    let last = sealed.grants[0].wrapped_content_key.len() - 1;
    sealed.grants[0].wrapped_content_key[last] ^= 0x01;

    assert!(unseal(&sealed, &bob).is_err());
}

/// SLH-DSA is offered as an archival signature option.
#[test]
fn archival_slhdsa_signatures() {
    let key = ArchivalKey::generate();
    let sig = key.sign(b"long-lived archival record");
    assert!(key.public().verify(b"long-lived archival record", &sig));
    assert!(!key.public().verify(b"a different record", &sig));
}
