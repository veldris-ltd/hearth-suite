//! Ember bridge tests (`AC-AI-1..6`).

use std::sync::Arc;

use futures::executor::block_on;
use hearth_ember_bridge::testing::MockBackend;
use hearth_ember_bridge::{
    select_tier, Context, Corpus, Effort, Ember, HardwareProfile, ModelTier, Task,
};

/// AC-AI-1: the crate links no networking dependencies, so an Ember request
/// has no way to send anything off the device.
#[test]
fn no_network_dependencies() {
    let manifest = include_str!("../Cargo.toml").to_lowercase();
    for forbidden in [
        "reqwest",
        "hyper",
        "ureq",
        "isahc",
        "surf",
        "tonic",
        "tungstenite",
        "curl",
    ] {
        assert!(
            !manifest.contains(forbidden),
            "unexpected network dependency: {forbidden}"
        );
    }
}

/// AC-AI-1 / AC-AI-4: a Writer request runs locally; content reaches only the
/// local backend, and the result is labelled device-local.
#[test]
fn writer_request_is_device_local() {
    let backend = Arc::new(MockBackend::canned("A concise local summary."));
    let ember = Ember::with_tier(backend.clone(), ModelTier::Phi3Mini);

    let context = Context::new("summarise this").with_document("SECRET-DOC-BODY about widgets");
    let generation = ember.run(Task::Summarize, &context, Effort::Balanced);

    assert!(generation.is_device_local());
    let text = block_on(generation.collect_text()).unwrap();
    assert!(text.contains("local summary"));

    // The document body was handed only to the local backend.
    assert!(backend.last_prompt().contains("SECRET-DOC-BODY"));
}

/// AC-AI-2: tiering picks Phi on constrained hardware and Nemotron on capable
/// hardware, and the manual override wins.
#[test]
#[allow(clippy::similar_names)] // parallel `capable_*` profile names are intentional
fn adaptive_model_tiering() {
    let constrained = HardwareProfile {
        ram_mb: 4_000,
        vram_mb: 0,
        has_npu: false,
    };
    let capable_ram = HardwareProfile {
        ram_mb: 32_000,
        vram_mb: 0,
        has_npu: false,
    };
    let capable_gpu = HardwareProfile {
        ram_mb: 8_000,
        vram_mb: 8_000,
        has_npu: false,
    };
    let capable_npu = HardwareProfile {
        ram_mb: 8_000,
        vram_mb: 0,
        has_npu: true,
    };

    assert_eq!(select_tier(&constrained), ModelTier::Phi3Mini);
    assert_eq!(select_tier(&capable_ram), ModelTier::NemotronNano);
    assert_eq!(select_tier(&capable_gpu), ModelTier::NemotronNano);
    assert_eq!(select_tier(&capable_npu), ModelTier::NemotronNano);

    // Manual override is honoured regardless of detected hardware.
    let ember = Ember::with_tier(MockBackend::canned("x"), ModelTier::NemotronNano);
    assert_eq!(ember.model(), ModelTier::NemotronNano);
}

/// AC-AI-3: higher effort yields a deeper (longer) response.
#[test]
fn effort_control_changes_depth() {
    let ember = Ember::with_tier(MockBackend::budget_scaled(), ModelTier::Phi3Mini);
    let ctx = Context::new("write something");

    let fast = block_on(ember.run(Task::Draft, &ctx, Effort::Fast).collect_text()).unwrap();
    let balanced = block_on(
        ember
            .run(Task::Draft, &ctx, Effort::Balanced)
            .collect_text(),
    )
    .unwrap();
    let thorough = block_on(
        ember
            .run(Task::Draft, &ctx, Effort::Thorough)
            .collect_text(),
    )
    .unwrap();

    let count = |s: &str| s.split_whitespace().count();
    assert!(
        count(&fast) < count(&balanced),
        "fast should be shorter than balanced"
    );
    assert!(
        count(&balanced) < count(&thorough),
        "balanced should be shorter than thorough"
    );
}

/// AC-AI-5: a natural-language Sheets request yields a formula and explanation.
#[test]
fn sheets_natural_language_formula() {
    let backend = Arc::new(MockBackend::canned(
        "=SUM(A1:A10)\nExplanation: adds the values in cells A1 through A10.",
    ));
    let ember = Ember::with_tier(backend.clone(), ModelTier::NemotronNano);

    let context = Context::new("total of column A, rows 1 to 10").with_selection("A1:A10");
    let text = block_on(
        ember
            .run(Task::Formula, &context, Effort::Balanced)
            .collect_text(),
    )
    .unwrap();

    assert!(text.contains("=SUM(A1:A10)"));
    assert!(text.to_lowercase().contains("explanation"));
    // The prompt directs the model to produce a formula plus explanation.
    assert!(backend.last_prompt().to_lowercase().contains("formula"));
}

/// AC-AI-6: local RAG retrieves on-device and feeds generation locally.
#[test]
fn local_rag_stays_local() {
    let mut corpus = Corpus::new();
    corpus.add(
        "notes",
        "The project deadline is March and the budget is fixed.",
    );
    corpus.add("recipe", "Combine flour, sugar, and eggs, then bake.");

    // Retrieval runs entirely on-device.
    let hits = corpus.retrieve("when is the project deadline", 1);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "notes");

    let backend = Arc::new(MockBackend::canned("The deadline is in March."));
    let ember = Ember::with_tier(backend.clone(), ModelTier::Phi3Mini);

    let context = Context::new("when is the deadline?").with_retrieved(hits);
    let text = block_on(
        ember
            .run(Task::Query, &context, Effort::Fast)
            .collect_text(),
    )
    .unwrap();

    assert!(text.contains("March"));
    // The retrieved corpus passage was used locally (passed to the local backend).
    assert!(backend.last_prompt().contains("deadline is March"));
}
