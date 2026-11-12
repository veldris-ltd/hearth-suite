//! Ember zero-egress test (`AC-QA-3`).
//!
//! Two complementary guarantees:
//!   1. *Static*, the crate links no networking dependency, so there is no code
//!      path that could send anything off the device.
//!   2. *Dynamic*, when Ember runs, the document/selection content reaches only
//!      the local backend, and every result is labelled device-local.

use std::sync::Arc;

use futures::executor::block_on;

use hearth_ember_bridge::testing::MockBackend;
use hearth_ember_bridge::{Context, Effort, Ember, Task};

/// Networking crates that must never appear in the Ember dependency surface.
const FORBIDDEN_DEPS: &[&str] = &[
    "reqwest",
    "hyper",
    "ureq",
    "isahc",
    "surf",
    "tonic",
    "tungstenite",
    "curl",
    "websocket",
    "quinn",
];

#[test]
fn no_network_dependency_in_lockfile() {
    // Scan the workspace lockfile: no networking crate may be present in the
    // graph the Ember bridge participates in.
    let lock = include_str!("../../../Cargo.lock").to_lowercase();
    for needle in FORBIDDEN_DEPS {
        assert!(
            !lock.contains(&format!("name = \"{needle}\"")),
            "networking crate `{needle}` is present in Cargo.lock"
        );
    }
}

#[test]
fn content_reaches_only_the_local_backend() {
    let backend = Arc::new(MockBackend::canned("on-device reply"));
    let ember = Ember::new(Arc::clone(&backend));

    let secret = "CONFIDENTIAL: the merger closes on Friday.";
    let context = Context::new("Summarise this document.").with_document(secret);

    for task in [Task::Draft, Task::Summarize, Task::Rewrite, Task::Query] {
        let generation = ember.run(task, &context, Effort::Balanced);
        // Every generation is device-local, there is no cloud path.
        assert!(generation.is_device_local());
        let _ = block_on(generation.collect_text()).expect("local generation");
    }

    // The only place the content went is the in-process local backend.
    assert!(
        backend.last_prompt().contains(secret),
        "document content must reach the local backend"
    );
}
