mod io;
mod mobile_fs;
mod open;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths = open::paths_from_args(
        std::env::args_os()
            .skip(1)
            .map(|arg| arg.to_string_lossy().into_owned()),
        &std::env::current_dir().unwrap_or_default(),
    );

    let builder = tauri::Builder::default();

    // Registered first on purpose: a second launch hands its argv to this
    // instance and exits before any other plugin/window work happens.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let paths = open::paths_from_args(argv.into_iter().skip(1), std::path::Path::new(&cwd));
        open::queue_and_notify(app, paths);
    }));

    let app = builder
        .manage(open::PendingOpenPaths::new(startup_paths))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // WebKitGTK's smooth scrolling animates the scroll offset through
            // fractional pixel positions, so text is rasterised off the pixel
            // grid and looks blurry on alternating mouse-wheel steps (reported
            // on Kubuntu 25.10). The setting only affects discrete wheel and
            // keyboard scrolling; touchpad/touch gestures are unaffected.
            // See AGENTS.md Gotchas.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{SettingsExt, WebViewExt};

                for window in _app.webview_windows().values() {
                    let _ = window.with_webview(|webview| {
                        if let Some(settings) = webview.inner().settings() {
                            settings.set_enable_smooth_scrolling(false);
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            io::pick_and_read,
            io::pick_and_read_bytes,
            io::read_file,
            io::pick_save_path,
            io::write_file,
            io::write_bytes,
            io::read_settings,
            io::write_settings,
            io::read_recents,
            io::write_recents,
            io::read_draft,
            io::write_draft,
            io::clear_draft,
            io::confirm_dialog,
            io::alert_dialog,
            io::expose_image,
            io::open_external,
            io::write_image,
            open::take_pending_open_paths
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            open::queue_and_notify(app_handle, open::paths_from_urls(&urls));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
