//! Platform I/O commands (M1 — desktop).
//!
//! Invoked from `src/platform/tauri.ts` via `invoke()`. All file I/O happens
//! here in Rust — never through a broad Tauri fs scope — so the capabilities
//! (`capabilities/*.json`) stay minimal: dialog open/save/message + opener only.
//!
//! Mobile (`content://` on Android, security-scoped `file://` on iOS) is NOT
//! implemented in M1; URI-looking results are routed to `mobile_fs` so the seam
//! already exists for M5.

use std::fs;
use std::path::Path;
use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{
    DialogExt, FilePath, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;

use crate::mobile_fs;

/// Result of picking and reading a document (serde camelCase, matches `tauri.ts`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub content: String,
    pub name: String,
    pub path: String,
}

/// Result of picking and reading an import-candidate file as raw bytes (serde
/// camelCase, matches `tauri.ts`). `bytes` serializes as a JSON number array —
/// the same Uint8Array boundary pattern as `write_image`, in reverse: the TS
/// side rehydrates it with `new Uint8Array(bytes)`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBytesResult {
    pub bytes: Vec<u8>,
    pub name: String,
}

/// "Markdown" + "All files" filters shared by the Open and Save dialogs.
/// Static slices so they satisfy `add_filter`'s `&[&str]` parameter on every
/// tauri-plugin-dialog 2.x signature without a Vec→slice coercion.
fn markdown_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("Markdown", &["md", "markdown"]), ("All files", &["*"])]
}

/// "HTML" + "All files" filters for the Export-HTML save dialog (same static-slice
/// constraint as `markdown_filters`). Round-9 unified export keeps this for the
/// 'html' exportKind / legacy `html: true` path.
fn html_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("HTML", &["html", "htm"]), ("All files", &["*"])]
}

/// Round-9 unified export filters for the txt/docx/rtf exportKinds (same
/// static-slice `add_filter` constraint as `markdown_filters`).
fn txt_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("Text", &["txt"]), ("All files", &["*"])]
}

fn docx_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("Word", &["docx"]), ("All files", &["*"])]
}

fn rtf_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("RTF", &["rtf"]), ("All files", &["*"])]
}

/// "Import" filters for the import picker: a combined "Importable Files" entry
/// first (so it is the dialog default), then Markdown/text, HTML, PDF, Word,
/// RTF, plus All files (same static-slice `add_filter` constraint as the others).
fn import_filters() -> [(&'static str, &'static [&'static str]); 7] {
    [
        (
            "Importable Files",
            &["md", "markdown", "txt", "html", "htm", "pdf", "docx", "rtf"],
        ),
        ("Markdown", &["md", "markdown", "txt"]),
        ("HTML", &["html", "htm"]),
        ("PDF", &["pdf"]),
        ("Word", &["docx"]),
        ("RTF", &["rtf"]),
        ("All files", &["*"]),
    ]
}

/// True if the string looks like a `scheme://...` URI (Android `content://`,
/// iOS `file://`) rather than a plain desktop path. Guards `write_file`.
fn looks_like_uri(s: &str) -> bool {
    let s = s.trim();
    s.starts_with("content://") || s.starts_with("file://")
}

// ---------------------------------------------------------------------------
// Open / Save / Read / Write
// ---------------------------------------------------------------------------

/// `pick_and_read(app)` — native "Open" dialog, then read the chosen file.
///
/// Returns `None` when the user cancels; `Some(OpenResult)` otherwise. Desktop
/// (`FilePath::Path`) reads via `std::fs`; mobile (`FilePath::Url`) delegates to
/// `mobile_fs` (which errors for M1).
#[tauri::command]
pub fn pick_and_read(app: AppHandle) -> Result<Option<OpenResult>, String> {
    let mut dialog = app.dialog().file();
    for (name, exts) in markdown_filters() {
        dialog = dialog.add_filter(name, exts);
    }

    match dialog.blocking_pick_file() {
        // Cancelled.
        None => Ok(None),
        // Desktop: real path on disk.
        Some(FilePath::Path(p)) => {
            let content =
                fs::read_to_string(&p).map_err(|e| format!("read {}: {e}", p.display()))?;
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "untitled.md".to_string());
            Ok(Some(OpenResult {
                content,
                name,
                path: p.to_string_lossy().into_owned(),
            }))
        }
        // Mobile: content:// or file:// URI — route through the mobile seam.
        Some(FilePath::Url(u)) => {
            let url = u.to_string();
            let content = mobile_fs::read_uri(&app, &url)?;
            let name = u
                .path_segments()
                .and_then(|mut segs| segs.next_back())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "untitled.md".to_string());
            Ok(Some(OpenResult {
                content,
                name,
                path: url,
            }))
        }
    }
}

/// `pick_and_read_bytes(app)` — native "Import" dialog, then read the chosen
/// file as raw bytes (P3 Import; the TS side decodes text formats and hands
/// binary formats to pdfjs/mammoth).
///
/// Returns `None` when the user cancels; `Some(ImportBytesResult)` otherwise.
/// Desktop (`FilePath::Path`) reads via `std::fs`; mobile (`FilePath::Url`)
/// errors like the rest of the M1 seam — `content://`/`file://` import lands
/// in M5 (see `mobile_fs`).
#[tauri::command]
pub fn pick_and_read_bytes(app: AppHandle) -> Result<Option<ImportBytesResult>, String> {
    let mut dialog = app.dialog().file();
    for (name, exts) in import_filters() {
        dialog = dialog.add_filter(name, exts);
    }

    match dialog.blocking_pick_file() {
        // Cancelled.
        None => Ok(None),
        // Desktop: real path on disk.
        Some(FilePath::Path(p)) => {
            let bytes = fs::read(&p).map_err(|e| format!("read {}: {e}", p.display()))?;
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "import".to_string());
            Ok(Some(ImportBytesResult { bytes, name }))
        }
        // Mobile: content:// or file:// URI — the M5 seam (mirrors write_file's
        // URI guard rather than mobile_fs::read_uri, which yields text).
        Some(FilePath::Url(u)) => {
            let url = u.to_string();
            Err(format!(
                "pick_and_read_bytes: '{url}' looks like a URI — Android/iOS content:// and \
                 file:// import lands in M5; desktop is the current test surface."
            ))
        }
    }
}

/// `read_file(path)` — desktop-only: read a file from an absolute path.
/// (Used for "Open recent" / re-open when we already know the path.)
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// `pick_save_path(app, suggested, html, kind)` — native "Save" dialog; returns the
/// chosen path string (desktop) or URI string (mobile). `suggested` (when
/// present) pre-fills the file name in the dialog. Round-9 unified export:
/// `kind` selects txt/html/docx/rtf filters; when `kind` is None, fall back to
/// the legacy `html`-bool behavior (true → HTML filters, else Markdown).
/// `None` when cancelled.
#[tauri::command]
pub fn pick_save_path(
    app: AppHandle,
    suggested: Option<String>,
    html: Option<bool>,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    match kind.as_deref() {
        Some("txt") => {
            for (name, exts) in txt_filters() {
                dialog = dialog.add_filter(name, exts);
            }
        }
        Some("html") => {
            for (name, exts) in html_filters() {
                dialog = dialog.add_filter(name, exts);
            }
        }
        Some("docx") => {
            for (name, exts) in docx_filters() {
                dialog = dialog.add_filter(name, exts);
            }
        }
        Some("rtf") => {
            for (name, exts) in rtf_filters() {
                dialog = dialog.add_filter(name, exts);
            }
        }
        _ => {
            if html.unwrap_or(false) {
                for (name, exts) in html_filters() {
                    dialog = dialog.add_filter(name, exts);
                }
            } else {
                for (name, exts) in markdown_filters() {
                    dialog = dialog.add_filter(name, exts);
                }
            }
        }
    }
    if let Some(name) = suggested {
        if !name.is_empty() {
            dialog = dialog.set_file_name(name);
        }
    }

    Ok(match dialog.blocking_save_file() {
        None => None,
        Some(FilePath::Path(p)) => Some(p.to_string_lossy().into_owned()),
        Some(FilePath::Url(u)) => Some(u.to_string()),
    })
}

/// `write_file(path, content)` — write UTF-8 content verbatim (CRLF preserved as
/// passed from JS). Desktop only: a URI-looking `path` (mobile) returns a clear
/// error — see `mobile_fs` for the M5 plan.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if looks_like_uri(&path) {
        return Err(format!(
            "write_file: '{path}' looks like a URI — Android/iOS content:// and \
             file:// I/O lands in M5; desktop is the M1 test surface."
        ));
    }
    fs::write(&path, content).map_err(|e| format!("write {path}: {e}"))
}

/// `write_bytes(path, bytes)` — round-9 unified export binary save for .docx.
/// Desktop only: the same URI guard as `write_file` — a URI-looking `path`
/// (mobile) returns a clear error; see `mobile_fs` for the M5 plan.
#[tauri::command]
pub fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if looks_like_uri(&path) {
        return Err(format!(
            "write_bytes: '{path}' looks like a URI — Android/iOS content:// and \
             file:// I/O lands in M5; desktop is the M1 test surface."
        ));
    }
    fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

// ---------------------------------------------------------------------------
// Settings / recents / drafts (JSON files under the app data dir)
// ---------------------------------------------------------------------------

/// Resolve (and document) the app-data directory. Callers create it before writing.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))
}

/// Read a JSON file as a raw string; `None` when the file does not exist.
fn read_json_file(path: &PathBuf) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

/// `read_settings(app)` — the app's `settings.json` (or `None` when absent).
#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_json_file(&app_data_dir(&app)?.join("settings.json"))
}

/// `write_settings(app, json)` — persist `settings.json` (creates the dir).
#[tauri::command]
pub fn write_settings(app: AppHandle, json: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create dir {}: {e}", dir.display()))?;
    fs::write(dir.join("settings.json"), json).map_err(|e| format!("write settings: {e}"))
}

/// `read_recents(app)` — the app's `recents.json` (or `None` when absent).
#[tauri::command]
pub fn read_recents(app: AppHandle) -> Result<Option<String>, String> {
    read_json_file(&app_data_dir(&app)?.join("recents.json"))
}

/// `write_recents(app, json)` — persist `recents.json` (creates the dir).
#[tauri::command]
pub fn write_recents(app: AppHandle, json: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create dir {}: {e}", dir.display()))?;
    fs::write(dir.join("recents.json"), json).map_err(|e| format!("write recents: {e}"))
}

/// Path to the drafts directory (`<app_data>/drafts`).
fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("drafts"))
}

/// Sanitize a draft key for safe use as a filename.
///
/// Replaces the path-hostile characters (`/ \ : * ? " < > |`) with `_`, and
/// collapses empty/`.`/`..` results to `"_"`. SECURITY: a malicious draft key
/// (e.g. `"../../settings"`) can never escape the drafts directory.
fn safe_key(key: &str) -> String {
    let sanitized: String = key
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "_".to_string()
    } else {
        sanitized
    }
}

/// `read_draft(app, key)` — `<app_data>/drafts/<safe_key>.json`, `None` when absent.
#[tauri::command]
pub fn read_draft(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = drafts_dir(&app)?.join(format!("{}.json", safe_key(&key)));
    read_json_file(&path)
}

/// `write_draft(app, key, content)` — create the drafts dir, then write the file.
#[tauri::command]
pub fn write_draft(app: AppHandle, key: String, content: String) -> Result<(), String> {
    let dir = drafts_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create dir {}: {e}", dir.display()))?;
    let path = dir.join(format!("{}.json", safe_key(&key)));
    fs::write(&path, content).map_err(|e| format!("write draft {}: {e}", path.display()))
}

/// `clear_draft(app, key)` — remove the draft if it exists; Ok even when absent.
#[tauri::command]
pub fn clear_draft(app: AppHandle, key: String) -> Result<(), String> {
    let path = drafts_dir(&app)?.join(format!("{}.json", safe_key(&key)));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("clear draft {}: {e}", path.display())),
    }
}

// ---------------------------------------------------------------------------
// Native dialogs / external links
// ---------------------------------------------------------------------------

/// `confirm_dialog(app, message)` — blocking Yes/No warning; `true` for the
/// affirmative reply. Used for unsaved-changes prompts, draft recovery, etc.
#[tauri::command]
pub fn confirm_dialog(app: AppHandle, message: String) -> Result<bool, String> {
    let reply = app
        .dialog()
        .message(message)
        .title("Notedown")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show_with_result();
    Ok(reply == MessageDialogResult::Yes)
}

/// `alert_dialog(app, message)` — blocking native message dialog with a single
/// OK button. The Tauri webview's `window.alert` is a no-op (user-results C9),
/// so the UI routes through this command instead. Mirrors `confirm_dialog`.
#[tauri::command]
pub fn alert_dialog(app: AppHandle, message: String) -> Result<(), String> {
    app.dialog()
        .message(message)
        .title("Notedown")
        .blocking_show();
    Ok(())
}

/// `open_external(app, url)` — open a URL in the default external browser only
/// (never `window.open` into the app). No `javascript:` URLs.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("open external url: {e}"))
}

// ---------------------------------------------------------------------------
// Paste-image: save next to doc + expose to the webview (M4, PLAN §11)
// ---------------------------------------------------------------------------

/// `write_image(app, doc_path, filename, bytes)` — save a pasted image next to the
/// document (PLAN §11). With a doc path, the image lands in the doc's directory;
/// without one (unsaved doc, or a mobile URI doc) the user picks a folder first.
/// Returns the saved absolute path, or None when the folder picker was cancelled.
/// `filename` is sanitized to a bare basename (defense in depth — it originates
/// from imageFileName() in TS but must never traverse directories).
#[tauri::command]
pub fn write_image(
    app: AppHandle,
    doc_path: Option<String>,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let safe: String = filename
        .split(['/', '\\'])
        .next_back()
        .unwrap_or("")
        .to_string();
    if safe.is_empty() || safe == "." || safe == ".." {
        return Err(format!("write_image: invalid filename '{filename}'"));
    }
    let dir = match doc_path {
        Some(p) if !looks_like_uri(&p) => {
            let path = PathBuf::from(&p);
            let parent = path
                .parent()
                .filter(|d| !d.as_os_str().is_empty())
                .ok_or_else(|| format!("write_image: doc path has no directory: {p}"))?;
            parent.to_path_buf()
        }
        _ => match app.dialog().file().blocking_pick_folder() {
            None => return Ok(None),
            Some(FilePath::Path(dir)) => dir,
            Some(FilePath::Url(_)) => {
                return Err("write_image: mobile folder URIs land in M5".to_string())
            }
        },
    };
    fs::create_dir_all(&dir).map_err(|e| format!("create dir {}: {e}", dir.display()))?;
    let target = dir.join(&safe);
    fs::write(&target, bytes).map_err(|e| format!("write image {}: {e}", target.display()))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// `expose_image(abs_path)` — read a local image and return it as a `data:` URL so
/// the webview can render it (paste-image + preview of relative image paths).
/// SVG IS allowed (round-6 A1): an SVG loaded via `<img src="data:...">` runs
/// in the browser's secure-static mode — scripts never execute — and the TS
/// side additionally DOMPurify-sanitizes every SVG before embedding (defense
/// in depth for recipients who might extract the data URL as a document).
/// Mime is derived from the extension. NOTE: data URLs are the M4 choice for
/// simplicity; Tauri's asset protocol is the M5+ option for very large images.
#[tauri::command]
pub fn expose_image(abs_path: String) -> Result<String, String> {
    let mime = match Path::new(&abs_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(e) if e == "png" => "image/png",
        Some(e) if e == "jpg" || e == "jpeg" => "image/jpeg",
        Some(e) if e == "gif" => "image/gif",
        Some(e) if e == "webp" => "image/webp",
        Some(e) if e == "bmp" => "image/bmp",
        Some(e) if e == "svg" => "image/svg+xml",
        _ => return Err(format!("expose_image: unsupported image type: {abs_path}")),
    };
    let bytes = fs::read(&abs_path).map_err(|e| format!("read {}: {e}", abs_path))?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
