// Tauri v2 entry point. Lives in the lib so mobile targets can reuse it.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running agent-console");
}
