#![cfg_attr(not(feature = "tauri-runtime"), allow(dead_code))]

mod host;
mod permissions;

// Tauri v2 entry point. Lives in the lib so mobile targets can reuse it.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use host::{host_install, host_restart, host_rollback, host_status};
    use permissions::{get_macos_permissions, open_macos_permission_settings};

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_macos_permissions,
            open_macos_permission_settings,
            host_status,
            host_install,
            host_restart,
            host_rollback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FractalMind");
}
