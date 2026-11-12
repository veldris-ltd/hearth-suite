//! CRDT sync tests (`AC-SYNC-1..4`).

use hearth_crdt_sync::{
    merge_sealed_delta, seal_delta, Document, KeyedCipher, LocalOp, Op, SyncConfig, Value,
};
use proptest::prelude::*;

fn value_strat() -> impl Strategy<Value = Value> {
    prop_oneof![
        "[a-z]{1,6}".prop_map(Value::Text),
        (-1000.0f64..1000.0).prop_map(Value::Number),
        Just(Value::Null),
    ]
}

// A small key space (`a`, `b`, `c`) so concurrent edits frequently collide.
fn action_strat() -> impl Strategy<Value = (usize, LocalOp)> {
    let op = prop_oneof![
        ("[a-c]", value_strat()).prop_map(|(key, value)| LocalOp::Set { key, value }),
        "[a-c]".prop_map(|key| LocalOp::Remove { key }),
    ];
    (0usize..3, op)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]

    /// AC-SYNC-2: random concurrent op sequences converge to identical state.
    #[test]
    fn replicas_converge(actions in prop::collection::vec(action_strat(), 0..60)) {
        let mut docs: Vec<Document> = (1u64..=3).map(Document::new).collect();

        // Each action edits its replica locally (concurrent, no coordination).
        for (idx, op) in actions {
            docs[idx].apply_local_op(op);
        }

        // Gossip: every replica eventually sees every operation.
        let all: Vec<Op> = docs.iter().flat_map(|d| d.all_ops().to_vec()).collect();
        let delta = Document::encode_delta(&all)?;
        for doc in &mut docs {
            doc.merge_remote_delta(&delta)?;
        }

        // All replicas converge to byte-identical materialized state.
        let reference = docs[0].materialize();
        for doc in &docs[1..] {
            prop_assert_eq!(&reference, &doc.materialize());
        }
    }
}

/// AC-SYNC-2 (explicit): two replicas, concurrent conflicting writes, converge.
#[test]
fn two_replicas_conflict_resolves_deterministically() {
    let mut a = Document::new(1);
    let mut b = Document::new(2);

    let op_a = a.set("title", Value::Text("from-a".to_owned()));
    let op_b = b.set("title", Value::Text("from-b".to_owned()));

    // Exchange the conflicting ops both directions.
    b.merge_remote_delta(&Document::encode_delta(&[op_a]).unwrap())
        .unwrap();
    a.merge_remote_delta(&Document::encode_delta(&[op_b]).unwrap())
        .unwrap();

    assert_eq!(a.materialize(), b.materialize());
    // Higher replica id wins the tie at equal Lamport time.
    assert_eq!(a.get("title"), Some(&Value::Text("from-b".to_owned())));
}

/// AC-SYNC-1: sync is optional and off by default; local editing needs no sync.
#[test]
fn sync_is_off_by_default() {
    assert!(!SyncConfig::default().enabled);

    let mut doc = Document::new(1);
    doc.set("note", Value::Text("entirely local".to_owned()));
    assert_eq!(
        doc.get("note"),
        Some(&Value::Text("entirely local".to_owned()))
    );
}

/// AC-SYNC-3: the relay receives only opaque ciphertext and cannot recover it.
#[test]
fn relay_is_zero_knowledge() {
    let key = [7u8; 32];
    let cipher = KeyedCipher::new(&key);

    let mut author = Document::new(1);
    let op = author.set("secret", Value::Text("PLAINTEXT-MARKER".to_owned()));
    let blob = seal_delta(&cipher, &[op]).unwrap();

    // The relay blob exposes neither the value nor the key name.
    assert!(!contains(&blob, b"PLAINTEXT-MARKER"));
    assert!(!contains(&blob, b"secret"));

    // Without the key, the blob cannot be decrypted.
    let wrong = KeyedCipher::new(&[9u8; 32]);
    let mut eavesdropper = Document::new(2);
    assert!(merge_sealed_delta(&mut eavesdropper, &wrong, &blob).is_err());

    // A holder of the key merges it normally.
    let mut peer = Document::new(3);
    merge_sealed_delta(&mut peer, &cipher, &blob).unwrap();
    assert_eq!(
        peer.get("secret"),
        Some(&Value::Text("PLAINTEXT-MARKER".to_owned()))
    );
}

/// AC-SYNC-4: prior versions are listed and restorable.
#[test]
fn version_history_is_restorable() {
    let mut doc = Document::new(1);

    doc.set("title", Value::Text("draft one".to_owned()));
    let v0 = doc.checkpoint("draft one");
    doc.set("title", Value::Text("draft two".to_owned()));
    doc.set("note", Value::Text("added".to_owned()));
    let v1 = doc.checkpoint("draft two");

    assert_eq!(doc.history().len(), 2);
    assert_eq!(
        doc.version_state(v1).unwrap().get("title"),
        Some(&Value::Text("draft two".to_owned()))
    );

    // Restoring the earlier version brings the live state back.
    assert!(doc.restore(v0));
    assert_eq!(doc.get("title"), Some(&Value::Text("draft one".to_owned())));
    assert_eq!(doc.get("note"), None);
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}
