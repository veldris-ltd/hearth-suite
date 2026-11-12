//! `hearth-tuf-sign`: the release-signing tool for the CI `sign` stage (P2-R1).
//!
//! Produces TUF-style **signed** `targets` metadata for a directory of release
//! artifacts, using an ML-DSA-65 role key derived from a 32-byte seed. The output
//! is exactly the document `release-service` (and the desktop client) verify
//! against their pinned roots: producer and verifier share the tested
//! `hearth-release` crate, so they can never drift. No cryptography is
//! implemented here; all signing goes through `hearth-seal` (`AC-SEC-6`).
//!
//! The role seed is read from `HEARTH_RELEASE_ROLE_SEED` (base64 of 32 bytes),
//! kept as a CI secret / in the operator's secret store.
//!
//! ```text
//! hearth-tuf-sign sign --dir <artifact-dir> --version <n> [--keyid <id>] [--out <path>]
//! hearth-tuf-sign pubkey     # print the base64 verifying key to pin as a TUF root
//! ```

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;
use std::slice::Iter;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_release::{sign_targets, SignedTargets};
use hearth_seal::ReleaseSigningKey;

const SEED_ENV: &str = "HEARTH_RELEASE_ROLE_SEED";
const DEFAULT_KEYID: &str = "hearth-release";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("hearth-tuf-sign: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    // nosemgrep: rust.lang.security.args.args -- CLI flag parsing only; argv[0] is never used
    let args: Vec<String> = env::args().collect();
    let key = load_role_key()?;
    match args.get(1).map(String::as_str) {
        Some("pubkey") => {
            // The base64 verifying key to pin in release-service and the client.
            println!("{}", B64.encode(key.verifying_key().to_bytes()));
            Ok(())
        }
        Some("sign") => sign_command(&args[2..], &key),
        other => Err(format!(
            "expected `sign` or `pubkey`, got {other:?}; \
             usage: hearth-tuf-sign sign --dir <dir> --version <n> [--keyid <id>] [--out <path>]"
        )),
    }
}

/// Derive the role signing key from the `HEARTH_RELEASE_ROLE_SEED` env var.
fn load_role_key() -> Result<ReleaseSigningKey, String> {
    let encoded =
        env::var(SEED_ENV).map_err(|_| format!("{SEED_ENV} is not set (base64 of 32 bytes)"))?;
    let bytes = B64
        .decode(encoded.trim())
        .map_err(|e| format!("{SEED_ENV} is not valid base64: {e}"))?;
    let seed: [u8; 32] = bytes.as_slice().try_into().map_err(|_| {
        format!(
            "{SEED_ENV} must decode to exactly 32 bytes (got {})",
            bytes.len()
        )
    })?;
    ReleaseSigningKey::from_seed(&seed).map_err(|e| format!("invalid role seed: {e}"))
}

/// Hash every artifact in `--dir`, sign the resulting `targets` body, and write
/// the signed metadata JSON to `--out` (default `<dir>/targets.json`).
fn sign_command(args: &[String], key: &ReleaseSigningKey) -> Result<(), String> {
    let mut dir: Option<PathBuf> = None;
    let mut version: Option<u32> = None;
    let mut keyid = DEFAULT_KEYID.to_owned();
    let mut out: Option<PathBuf> = None;

    let mut it = args.iter();
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(value_for(flag, &mut it)?)),
            "--version" => {
                version = Some(
                    value_for(flag, &mut it)?
                        .parse()
                        .map_err(|_| "--version must be a non-negative integer".to_owned())?,
                );
            }
            "--keyid" => keyid = value_for(flag, &mut it)?,
            "--out" => out = Some(PathBuf::from(value_for(flag, &mut it)?)),
            other => return Err(format!("unknown flag {other:?}")),
        }
    }

    let dir = dir.ok_or("missing required --dir")?;
    let version = version.ok_or("missing required --version")?;
    let out = out.unwrap_or_else(|| dir.join("targets.json"));

    let mut signed = SignedTargets::new(version);
    let mut count = 0_usize;
    let entries = fs::read_dir(&dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read directory entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_metadata_file(&name) {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        signed = signed.with_target(name, &bytes);
        count += 1;
    }
    if count == 0 {
        return Err(format!("no artifacts to sign in {}", dir.display()));
    }

    let metadata = sign_targets(signed, keyid, key).map_err(|e| e.to_string())?;
    let json = metadata.to_json().map_err(|e| e.to_string())?;
    fs::write(&out, json).map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    eprintln!(
        "hearth-tuf-sign: signed {count} target(s) at version {version} -> {}",
        out.display()
    );
    Ok(())
}

/// Consume the next argument as the value of `flag`.
fn value_for(flag: &str, it: &mut Iter<'_, String>) -> Result<String, String> {
    it.next()
        .cloned()
        .ok_or_else(|| format!("missing value for {flag}"))
}

/// Whether `name` is a metadata/signature sidecar that must not be a target.
fn is_metadata_file(name: &str) -> bool {
    std::path::Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "json" | "sig" | "pem" | "sha256"
            )
        })
}
