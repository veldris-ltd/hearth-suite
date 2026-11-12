//! The Bundle container: a signed (optionally sealed) ZIP holding a manifest,
//! documents, linked data sources, and assets.

use std::collections::BTreeMap;
use std::io::{Read, Seek, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Error, Result};
use crate::manifest::{DocType, DocumentEntry, Manifest, ResourceEntry, Signature};
use crate::sign::{Signer, Verifier};
use crate::{from_hex, to_hex};

/// The container path of the manifest part.
const MANIFEST_PATH: &str = "manifest.json";

/// An in-memory Hearth Suite Bundle: its [`Manifest`] plus the bytes of every part.
#[derive(Debug, Clone)]
pub struct Bundle {
    /// The Bundle manifest.
    pub manifest: Manifest,
    /// Part bytes keyed by container path (excludes the manifest itself).
    parts: BTreeMap<String, Vec<u8>>,
}

impl Bundle {
    /// Create a new, empty Bundle with the given title.
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            manifest: Manifest::new(Uuid::new_v4(), title, now_unix()),
            parts: BTreeMap::new(),
        }
    }

    /// Add a document, returning its new identifier.
    pub fn add_document(
        &mut self,
        title: impl Into<String>,
        doc_type: DocType,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Uuid {
        let id = Uuid::new_v4();
        let bytes = bytes.into();
        let path = format!("documents/{id}");
        self.manifest.documents.push(DocumentEntry {
            id,
            title: title.into(),
            doc_type,
            path: path.clone(),
            media_type: media_type.into(),
            sha256: sha256_hex(&bytes),
            size: bytes.len() as u64,
        });
        self.parts.insert(path, bytes);
        id
    }

    /// Add a linked data source, returning its new identifier.
    pub fn add_data_source(
        &mut self,
        name: impl Into<String>,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Uuid {
        self.add_resource("data", name, media_type, bytes, ResourceKind::Data)
    }

    /// Add an asset, returning its new identifier.
    pub fn add_asset(
        &mut self,
        name: impl Into<String>,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Uuid {
        self.add_resource("assets", name, media_type, bytes, ResourceKind::Asset)
    }

    fn add_resource(
        &mut self,
        dir: &str,
        name: impl Into<String>,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
        kind: ResourceKind,
    ) -> Uuid {
        let id = Uuid::new_v4();
        let bytes = bytes.into();
        let path = format!("{dir}/{id}");
        let entry = ResourceEntry {
            id,
            name: name.into(),
            path: path.clone(),
            media_type: media_type.into(),
            sha256: sha256_hex(&bytes),
            size: bytes.len() as u64,
        };
        match kind {
            ResourceKind::Data => self.manifest.data_sources.push(entry),
            ResourceKind::Asset => self.manifest.assets.push(entry),
        }
        self.parts.insert(path, bytes);
        id
    }

    /// Borrow the stored bytes of a document by id.
    pub fn document_bytes(&self, id: Uuid) -> Option<&[u8]> {
        let entry = self.manifest.documents.iter().find(|d| d.id == id)?;
        self.parts.get(&entry.path).map(Vec::as_slice)
    }

    /// Borrow the stored bytes of any part by its container path.
    pub fn part_bytes(&self, path: &str) -> Option<&[u8]> {
        self.parts.get(path).map(Vec::as_slice)
    }

    /// Sign the manifest and write the Bundle as a ZIP container.
    ///
    /// Updates `updated_at`, recomputes the manifest signature with `signer`,
    /// then writes the manifest and every part.
    ///
    /// # Errors
    /// Returns an error if signing or writing the container fails.
    pub fn write<W: Write + Seek>(&mut self, writer: W, signer: &dyn Signer) -> Result<()> {
        self.manifest.updated_at = now_unix();
        let message = self.manifest.signing_bytes()?;
        self.manifest.signatures = vec![Signature {
            algorithm: signer.algorithm().to_owned(),
            key_id: signer.key_id().to_owned(),
            value: to_hex(&signer.sign(&message)),
        }];

        let manifest_json = serde_json::to_vec_pretty(&self.manifest)?;

        let mut zip = ZipWriter::new(writer);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file(MANIFEST_PATH, opts)?;
        zip.write_all(&manifest_json)?;
        for (path, bytes) in &self.parts {
            zip.start_file(path.as_str(), opts)?;
            zip.write_all(bytes)?;
        }
        zip.finish()?;
        Ok(())
    }

    /// Write the Bundle to a file path.
    ///
    /// # Errors
    /// Returns an error if the file cannot be created or written.
    pub fn write_to_path(&mut self, path: impl AsRef<Path>, signer: &dyn Signer) -> Result<()> {
        let file = std::fs::File::create(path)?;
        self.write(file, signer)
    }

    /// Read a Bundle from a ZIP container and verify part integrity.
    ///
    /// Signature verification is performed separately by
    /// [`verify_signatures`](Self::verify_signatures).
    ///
    /// # Errors
    /// Returns an error if the container is malformed, the manifest is missing
    /// or invalid, a referenced part is missing, or a part fails its hash check.
    pub fn read<R: Read + Seek>(reader: R) -> Result<Self> {
        let mut archive = ZipArchive::new(reader)?;

        let manifest_json = read_named(&mut archive, MANIFEST_PATH)?
            .ok_or_else(|| Error::MissingPart(MANIFEST_PATH.to_owned()))?;
        let manifest: Manifest = serde_json::from_slice(&manifest_json)?;

        let mut parts = BTreeMap::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            if !file.is_file() {
                continue;
            }
            let name = file.name()?.into_owned();
            if name == MANIFEST_PATH {
                continue;
            }
            let mut bytes = Vec::with_capacity(usize::try_from(file.size()).unwrap_or(0));
            file.read_to_end(&mut bytes)?;
            parts.insert(name, bytes);
        }

        let bundle = Self { manifest, parts };
        bundle.verify_integrity()?;
        Ok(bundle)
    }

    /// Read a Bundle from a file path.
    ///
    /// # Errors
    /// Returns an error for the same reasons as [`read`](Self::read), or if the
    /// file cannot be opened.
    pub fn read_from_path(path: impl AsRef<Path>) -> Result<Self> {
        let file = std::fs::File::open(path)?;
        Self::read(file)
    }

    /// Verify that every manifest-referenced part is present and its stored
    /// bytes match the recorded SHA-256 (`AC-BND-2`, content integrity).
    ///
    /// # Errors
    /// Returns [`Error::MissingPart`] or [`Error::Integrity`] on the first
    /// discrepancy.
    pub fn verify_integrity(&self) -> Result<()> {
        let documents = self.manifest.documents.iter().map(|d| (&d.path, &d.sha256));
        let data = self
            .manifest
            .data_sources
            .iter()
            .map(|r| (&r.path, &r.sha256));
        let assets = self.manifest.assets.iter().map(|r| (&r.path, &r.sha256));
        for (path, expected) in documents.chain(data).chain(assets) {
            let bytes = self
                .parts
                .get(path)
                .ok_or_else(|| Error::MissingPart(path.clone()))?;
            let actual = sha256_hex(bytes);
            if &actual != expected {
                return Err(Error::Integrity {
                    path: path.clone(),
                    expected: expected.clone(),
                    actual,
                });
            }
        }
        Ok(())
    }

    /// Verify the manifest signature(s) with `verifier`.
    ///
    /// Succeeds if at least one recorded signature is valid over the manifest's
    /// canonical bytes; any tampering with the manifest invalidates them.
    ///
    /// # Errors
    /// Returns [`Error::Signature`] if no signature is present or none verify.
    pub fn verify_signatures(&self, verifier: &dyn Verifier) -> Result<()> {
        if self.manifest.signatures.is_empty() {
            return Err(Error::Signature("manifest has no signatures".to_owned()));
        }
        let message = self.manifest.signing_bytes()?;
        for sig in &self.manifest.signatures {
            let Some(value) = from_hex(&sig.value) else {
                continue;
            };
            if verifier.verify(&sig.key_id, &sig.algorithm, &message, &value) {
                return Ok(());
            }
        }
        Err(Error::Signature("no valid signature".to_owned()))
    }

    /// Verify both content integrity and manifest signatures.
    ///
    /// # Errors
    /// Returns an error if either check fails.
    pub fn verify(&self, verifier: &dyn Verifier) -> Result<()> {
        self.verify_integrity()?;
        self.verify_signatures(verifier)
    }
}

#[derive(Clone, Copy)]
enum ResourceKind {
    Data,
    Asset,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    to_hex(&hasher.finalize())
}

fn read_named<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str) -> Result<Option<Vec<u8>>> {
    let mut file = match archive.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}
