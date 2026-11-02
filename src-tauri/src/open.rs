//! OS "open with" / file-association plumbing.
//!
//! Windows and Linux pass the document path in argv; macOS delivers it through
//! `RunEvent::Opened` file URLs. If an instance is already running, the
//! single-instance plugin forwards the second process's argv here instead of
//! letting it open a second window.
//!
//! Paths are buffered in `PendingOpenPaths` because a request can arrive before
//! the webview has registered its event listener. The frontend drains the queue
//! with `take_pending_open_paths`; the `notedown:open-file` event is only a
//! wake-up signal and carries no payload.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// Wake-up signal emitted whenever new paths are buffered. The payload is
/// always `()`; callers must drain via [`take_pending_open_paths`].
pub const OPEN_FILE_EVENT: &str = "notedown:open-file";

const MARKDOWN_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdwn"];

/// Paths requested by the OS that the frontend has not consumed yet.
///
/// Stores `String`s rather than `PathBuf`s because the values cross the IPC
/// boundary as JSON string arrays. The mutex may be poisoned if a thread
/// panicked while holding it; all accessors recover the inner value instead of
/// unwrapping so a single panic cannot permanently break "open with".
#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

impl PendingOpenPaths {
    pub fn new(paths: Vec<String>) -> Self {
        Self(Mutex::new(paths))
    }
}

/// True when `path` is an existing regular file with a markdown extension
/// (case-insensitive).
fn is_markdown_document(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| MARKDOWN_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
}

/// Filter a raw argv list (executable already removed) down to existing
/// markdown documents. Flags and non-files are ignored.
///
/// Relative paths are resolved against `cwd`. That matters on Windows, where
/// the shell's working directory — not the executable's — is what relative
/// arguments refer to.
pub fn paths_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = PathBuf::from(&arg);
            let resolved = if path.is_absolute() { path } else { cwd.join(path) };
            is_markdown_document(&resolved).then(|| resolved.to_string_lossy().into_owned())
        })
        .collect()
}

/// Queue newly requested paths, wake the frontend, and raise the main window.
///
/// The buffer is updated before the event is emitted on purpose: if the webview
/// is still booting, the event is lost but the paths survive until the
/// frontend's startup drain runs.
pub fn queue_and_notify(app: &AppHandle, new_paths: Vec<String>) {
    if new_paths.is_empty() {
        return;
    }
    let state = app.state::<PendingOpenPaths>();
    let mut pending = match state.0.lock() {
        Ok(pending) => pending,
        Err(poisoned) => poisoned.into_inner(),
    };
    pending.extend(new_paths);
    drop(pending);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(err) = app.emit(OPEN_FILE_EVENT, ()) {
        eprintln!("emit {OPEN_FILE_EVENT}: {err}");
    }
}

/// Drain paths buffered since the last call. Called by the frontend on startup
/// and whenever `notedown:open-file` fires.
#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, PendingOpenPaths>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut pending) => std::mem::take(&mut *pending),
        Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
    }
}

/// macOS file-association opens arrive as file:// URLs on `RunEvent::Opened`.
#[cfg(target_os = "macos")]
pub fn paths_from_urls(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_markdown_document(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}
