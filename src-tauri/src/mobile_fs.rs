//! Mobile file I/O seam — documented scaffolding only (M1 does NOT implement mobile).
//!
//! Android/iOS document access differs fundamentally from desktop path-based
//! I/O, so the desktop commands in `io` route URI-looking results (`FilePath::Url`,
//! `content://`/`file://` strings) here. For M1 this module only explains the
//! intended M5 approach and returns clear, descriptive errors. No JNI code, no
//! Android SDK bindings, and no iOS security-scoped code exist in M1.

use tauri::AppHandle;

/// Read the text content of a `content://` (Android) or `file://` (iOS) URI.
///
/// M1: always fails with a descriptive error. The `app` handle is reserved so the
/// M5 implementation can resolve scoped resources without changing the call sites.
pub fn read_uri(app: &AppHandle, url: &str) -> Result<String, String> {
    let _ = app; // reserved for M5 (resolving scoped resources / ContentResolver)
    Err(mobile_not_implemented(url))
}

/// Write text content to a `content://` (Android) or `file://` (iOS) URI.
///
/// M1: always fails with a descriptive error. `content` is accepted and ignored so
/// the M5 implementation can wire straight into the existing `write_file` seam.
/// (`write_file` currently rejects URIs itself, so this is intentionally unused
/// until M5 — keep it, it's the mobile save seam.)
#[allow(dead_code)]
pub fn write_uri(app: &AppHandle, url: &str, content: &str) -> Result<(), String> {
    let _ = app; // reserved for M5
    let _ = content; // reserved for M5
    Err(mobile_not_implemented(url))
}

fn mobile_not_implemented(url: &str) -> String {
    format!(
        "Android/iOS {url} I/O is not implemented yet: content:// and file:// \
         I/O lands in M5; desktop is the M1 test surface."
    )
}

// ---------------------------------------------------------------------------
// Intended M5 implementation notes (planning contract, not code)
// ---------------------------------------------------------------------------
//
// ## Android — `content://` URIs
// Native pickers return a `content://` URI (e.g.
// `content://com.android.externalstorage.documents/document/...`). Rust cannot
// `std::fs::read` a content URI directly — the URI must be resolved through the
// Android `ContentResolver`.
//
// Preferred path: `tauri-plugin-android-fs` — a first-party Tauri plugin whose
// commands are URI-aware and handle open/read/write against content URIs.
// Fallback custom command that:
//   1. `dialog.blocking_pick_file()` / `blocking_save_file()` → `FilePath::Url(content://...)`
//   2. Resolves the URI with the app's `ContentResolver`
//   3. Copies bytes via `ContentResolver.openInputStream` / `openOutputStream`
//   4. For save: write to app cache first, then copy into the target URI
//
// ⚠️ Known upstream bug (tauri-apps/plugins-workspace issue #3356, open): writing
// directly to a URI returned by `dialog.save()` on Android can produce a **0-byte
// file**. That is exactly why save must go through `tauri-plugin-android-fs` or a
// ContentResolver copy workaround instead of a naive `std::fs::write`. This is a
// **required manual QA test** (PLAN.md §7/§18), not an optional nice-to-have.
//
// ## iOS — `file://` + security-scoped resources
// iOS pickers return a `file://` URL that may live outside the app sandbox.
// Reading/writing requires security-scoped resource access:
//   - `FileAccessMode::Scoped` (from `tauri-plugin-fs` / `tauri::path`)
//   - wrap the read/write in `start_accessing()` / `stop_accessing()`
//
// ## Permissions (added in M5)
// The `mobile.json` capability will need fs permissions scoped to `$APP_DATA`
// (drafts/settings) plus whatever the Android/iOS URI plugins require. None are
// added in M1 — desktop (`desktop.json`) is the M1 test surface.
