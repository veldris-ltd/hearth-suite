//! Application state: the one embedded [`HearthCore`] the webview drives.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

use hearth_ffi::HearthCore;
use hearth_key_manager::RecoveryPhrase;

use crate::backend::UnconfiguredBackend;

/// The managed Tauri state.
pub struct AppState {
    /// The embedded core. A `Mutex` because Tauri commands may run on different
    /// threads; the core itself is cheap to call.
    pub core: Mutex<HearthCore>,
    /// Monotonic generation for scheduled reminders. Each `schedule_reminders`
    /// call bumps it so timers spawned by an earlier call become no-ops, which
    /// cancels stale reminders when the calendar is re-saved (seam #11).
    pub reminder_generation: AtomicU64,
}

impl AppState {
    /// Open (or create) the local store and derive the user's identity.
    ///
    /// # Errors
    /// Returns a message if the data directory, identity seed, or store cannot
    /// be set up.
    pub fn initialise() -> Result<Self, String> {
        let dir = hearth_data_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let seed = load_or_create_seed(&dir)?;
        let store_path = dir.join("hearth.store");
        let core = HearthCore::open(&store_path, &seed, Box::new(UnconfiguredBackend))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            core: Mutex::new(core),
            reminder_generation: AtomicU64::new(0),
        })
    }

    /// Restore the identity from a BIP-39 recovery phrase (seam #7).
    ///
    /// Recovers the master seed, persists it as the device seed, reopens the
    /// core under the restored identity, and swaps it into the managed state.
    ///
    /// # Errors
    /// Returns a message if the phrase is invalid or the store cannot be reopened.
    pub fn restore_from_phrase(&self, phrase: &str) -> Result<(), String> {
        let dir = hearth_data_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let store_path = dir.join("hearth.store");
        // Recover the seed first so an invalid phrase changes nothing on disk.
        let restored =
            HearthCore::open_from_phrase(&store_path, phrase, Box::new(UnconfiguredBackend))
                .map_err(|e| e.to_string())?;
        let seed = RecoveryPhrase::parse(phrase)
            .and_then(|p| p.to_seed())
            .map_err(|e| e.to_string())?;
        fs::write(dir.join("identity.seed"), seed).map_err(|e| e.to_string())?;
        let mut core = self
            .core
            .lock()
            .map_err(|_| "core lock poisoned".to_owned())?;
        *core = restored;
        Ok(())
    }
}

/// The per-user Hearth Suite data directory (e.g. `%APPDATA%\Hearth`, `~/.local/share/Hearth`).
fn hearth_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|d| d.join("Hearth"))
        .ok_or_else(|| "could not locate a user data directory".to_owned())
}

/// Load the identity seed, creating a fresh random one on first run.
///
/// TODO(key-manager): replace this with the real unlock flow (recovery phrase /
/// OS keychain) from the `key-manager` crate; the seed must never be stored in
/// the clear in production. This bootstrap keeps the offline scaffold usable.
fn load_or_create_seed(dir: &Path) -> Result<[u8; 32], String> {
    let path = dir.join("identity.seed");
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(seed) = <[u8; 32]>::try_from(bytes.as_slice()) {
            return Ok(seed);
        }
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| e.to_string())?;
    fs::write(&path, seed).map_err(|e| e.to_string())?;
    Ok(seed)
}
