mod io;
mod mobile_fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            io::pick_and_read,
            io::read_file,
            io::pick_save_path,
            io::write_file,
            io::read_settings,
            io::write_settings,
            io::read_recents,
            io::write_recents,
            io::read_draft,
            io::write_draft,
            io::clear_draft,
            io::confirm_dialog,
            io::expose_image,
            io::open_external,
            io::write_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
