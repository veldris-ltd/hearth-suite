//! The Hearth Suite desktop client (Tauri).
//!
//! Embeds the Rust core ([`hearth_ffi::HearthCore`]) in the app process and
//! renders the web UI in the system webview, small footprint, "runs on
//! anything" (`AC-DESK-2`). The webview talks to the core through one command
//! ([`commands::hearth_invoke`]) that forwards to `hearth_ffi::call_json`, and
//! verified auto-update is handled by [`updater`] (`AC-DESK-3`).

mod backend;
mod commands;
mod state;
mod updater;

use tauri::Manager;

use state::AppState;

/// Build and run the desktop application.
///
/// # Panics
/// Panics if the Tauri runtime cannot start (a fatal, unrecoverable condition).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let state = AppState::initialise().map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::hearth_invoke,
            commands::restore_identity,
            commands::schedule_reminders,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Hearth Suite desktop application");
}
