//! `hearth-bundle`, a CLI test harness to create, open, and round-trip Bundles.
//!
//! This is a developer tool, not the product UI. It signs with an interim
//! demo HMAC key (see [`hearth_bundle::sign`]); real Bundles are signed with
//! post-quantum ML-DSA from the `seal` crate (P1.4).

use std::io::Cursor;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};

use hearth_bundle::manifest::DocType;
use hearth_bundle::sign::{HmacSigner, HmacVerifier};
use hearth_bundle::Bundle;
use hearth_odf_io::model::{Block, Document, Span, TextDocument};
use hearth_odf_io::odf;

/// Demo signing key id (interim; not a real identity).
const DEMO_KEY_ID: &str = "demo";
/// Demo signing key bytes (interim; not a secret).
const DEMO_KEY: &[u8] = b"hearth-demo-signing-key";

type CliResult = Result<(), Box<dyn std::error::Error>>;

/// Create, open, and round-trip Hearth Suite Bundles.
#[derive(Parser)]
#[command(name = "hearth-bundle", about, version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a Bundle containing one sample Writer document.
    Create {
        /// Bundle title.
        #[arg(long, default_value = "Untitled Bundle")]
        title: String,
        /// Output path for the Bundle.
        #[arg(long)]
        out: PathBuf,
    },
    /// Open a Bundle, verify it, and print its manifest.
    Open {
        /// Path to the Bundle to open.
        #[arg(long)]
        file: PathBuf,
    },
    /// Create a Bundle in memory, write and re-read it, and check it survives.
    Roundtrip {
        /// Bundle title.
        #[arg(long, default_value = "Round-trip Bundle")]
        title: String,
    },
}

fn main() -> CliResult {
    match Cli::parse().command {
        Command::Create { title, out } => create(&title, &out),
        Command::Open { file } => open(&file),
        Command::Roundtrip { title } => roundtrip(&title),
    }
}

fn signer() -> HmacSigner {
    HmacSigner::new(DEMO_KEY_ID, DEMO_KEY)
}

fn verifier() -> HmacVerifier {
    HmacVerifier::new(DEMO_KEY_ID, DEMO_KEY)
}

/// A small sample document used by `create` and `roundtrip`.
fn sample_document() -> Result<Vec<u8>, hearth_odf_io::Error> {
    let doc = Document::Text(TextDocument {
        blocks: vec![
            Block::Heading {
                level: 1,
                spans: vec![Span::plain("Welcome to Hearth Suite")],
            },
            Block::Paragraph {
                spans: vec![Span::plain("This document lives inside a Bundle.")],
            },
        ],
    });
    odf::write_document(&doc)
}

fn create(title: &str, out: &Path) -> CliResult {
    let mut bundle = Bundle::new(title);
    bundle.add_document(
        "Welcome",
        DocType::Writer,
        odf::MIME_TEXT,
        sample_document()?,
    );
    bundle.write_to_path(out, &signer())?;
    println!("Created Bundle {} at {}", bundle.manifest.id, out.display());
    Ok(())
}

fn open(file: &Path) -> CliResult {
    let bundle = Bundle::read_from_path(file)?;
    bundle.verify_signatures(&verifier())?;
    let m = &bundle.manifest;
    println!("Bundle {}", m.id);
    println!("  title:   {}", m.title);
    println!("  sealed:  {}", m.sealed);
    println!("  documents: {}", m.documents.len());
    for doc in &m.documents {
        println!(
            "    - {:?} \"{}\" ({} bytes)",
            doc.doc_type, doc.title, doc.size
        );
    }
    println!("Verified: integrity OK, signature OK");
    Ok(())
}

fn roundtrip(title: &str) -> CliResult {
    let original = sample_document()?;

    let mut bundle = Bundle::new(title);
    let doc_id = bundle.add_document("Welcome", DocType::Writer, odf::MIME_TEXT, original.clone());

    let mut buffer = Vec::new();
    bundle.write(Cursor::new(&mut buffer), &signer())?;

    let reopened = Bundle::read(Cursor::new(&buffer))?;
    reopened.verify(&verifier())?;

    let restored = reopened
        .document_bytes(doc_id)
        .ok_or("document missing after round-trip")?;
    if restored != original.as_slice() {
        return Err("document content changed during round-trip".into());
    }

    println!(
        "Round-trip OK: Bundle {} verified, document content identical",
        reopened.manifest.id
    );
    Ok(())
}
