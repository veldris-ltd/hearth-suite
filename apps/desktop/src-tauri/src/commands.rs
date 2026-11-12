//! Tauri commands exposed to the webview.

use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;

/// Dispatch a core request from the webview.
///
/// `request` is a JSON `{ "method": ..., "params": ... }` document; the reply is
/// the `{ "ok": ... } / { "error": ... }` envelope from `hearth_ffi::call_json`
///, the exact same surface the C-ABI and WASM bindings expose. The webview's
/// `HearthClient` transport speaks this protocol.
#[tauri::command]
pub fn hearth_invoke(state: State<'_, AppState>, request: String) -> String {
    match state.core.lock() {
        Ok(mut core) => hearth_ffi::call_json(&mut core, &request),
        Err(_) => r#"{"error":"core lock poisoned"}"#.to_owned(),
    }
}

/// One reminder to schedule: what to show and when (epoch milliseconds).
#[derive(Deserialize)]
pub struct ReminderDto {
    /// Notification title (the event summary).
    pub title: String,
    /// Notification body (when the event starts).
    pub body: String,
    /// When to fire, in milliseconds since the Unix epoch.
    pub at_ms: i64,
}

/// Schedule OS-level reminders for calendar events (seam #11).
///
/// Each future reminder gets a timer that fires a native notification at its
/// trigger time. Calling this again supersedes the previous set (stale timers
/// detect the bumped generation and no-op), so re-saving the calendar cancels
/// reminders that were removed. Past-due reminders are skipped (the in-app
/// banner covers those).
#[tauri::command]
pub fn schedule_reminders(app: AppHandle, state: State<'_, AppState>, reminders: Vec<ReminderDto>) {
    let generation = state.reminder_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let now_ms = now_unix_ms();
    for reminder in reminders {
        let delay_ms = reminder.at_ms.saturating_sub(now_ms);
        if delay_ms <= 0 {
            continue;
        }
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms.unsigned_abs()));
            // Skip if a newer schedule has superseded this timer.
            let current = app
                .state::<AppState>()
                .reminder_generation
                .load(Ordering::SeqCst);
            if current != generation {
                return;
            }
            let _ = app
                .notification()
                .builder()
                .title(reminder.title)
                .body(reminder.body)
                .show();
        });
    }
}

/// Milliseconds since the Unix epoch (0 if the clock is before the epoch).
fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Restore the identity from a recovery phrase during onboarding (seam #7).
///
/// Recovers the master seed, persists it, and reopens the core under the
/// restored identity. Returns `Ok(())` on success, or an error message the
/// onboarding UI surfaces (e.g. an invalid phrase).
///
/// # Errors
/// Returns a message if the phrase is invalid or the store cannot be reopened.
#[tauri::command]
pub fn restore_identity(state: State<'_, AppState>, phrase: String) -> Result<(), String> {
    state.restore_from_phrase(&phrase)
}
