fn main() {
    // Ensure replacing the bundled app icons triggers a rebuild (tauri-build only
    // tracks tauri.conf.json and capabilities by default).
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    tauri_build::build()
}
