//! Local store for Hearth Suite.
//!
//! An embedded SQLite database holds Records (tables, fields, rows) and
//! structured metadata for the data model in diagram `05_er`; an encrypted file
//! [`vault`] holds document content. The store is fully functional offline with
//! zero configuration (`AC-STO-1`): opening a path creates and migrates the
//! database and vault in place.
//!
//! Document content is encrypted at rest under a key derived from the user
//! identity (`AC-STO-2`); the metadata database never stores document bodies
//! (`AC-DATA-1`). A portable [`Store::export_backup`] / [`Store::restore_backup`]
//! pair provides backup and restore (`AC-STO-4`).
//!
//! Implemented for P1.3.

pub mod error;
pub mod models;
pub mod vault;

mod schema;
mod store;

pub use error::{Error, Result};
pub use store::Store;
pub use vault::{IdentityCipher, VaultCipher};
