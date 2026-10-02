#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fractalmind_device_vault::{
    DevicePublic, DeviceVault, OnboardingCreated, OnboardingPublic, RecoveryImported,
    RecoveryPrepared, RecoveryPublic, SignedBytes, DEVICE_SERVICE,
};
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn local_origin(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    ) || cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(4189)
}
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || !local_origin(&window.url().map_err(|_| "NativeOriginUnavailable")?)
    {
        return Err("NativeOriginDenied".into());
    }
    Ok(())
}
#[tauri::command]
async fn fm_device_public(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
) -> Result<DevicePublic, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || vault.public(&profile).map_err(|e| e.to_string()))
        .await
        .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_initialize(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
) -> Result<DevicePublic, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault.initialize(&profile).map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_sign_transaction(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    bytes: String,
) -> Result<SignedBytes, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .sign_transaction(&profile, &bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_prove(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    challenge: String,
) -> Result<SignedBytes, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "NativeClockUnavailable".to_string())?
            .as_millis()
            .try_into()
            .map_err(|_| "NativeClockUnavailable".to_string())?;
        vault
            .prove_device(&profile, &challenge, now)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_onboarding_create(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
) -> Result<OnboardingCreated, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .create_onboarding(&profile, &network)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_onboarding_public(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
) -> Result<OnboardingPublic, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .onboarding_public(&profile, &network)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_onboarding_sign_transaction(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
    bytes: String,
) -> Result<SignedBytes, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .sign_onboarding_transaction(&profile, &network, &bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_decrypt_record(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    record: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .decrypt_record(&profile, &record)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_encrypt_record(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    record: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .encrypt_record(&profile, &record)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_recovery_import(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
    code: String,
) -> Result<RecoveryImported, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let code = zeroize::Zeroizing::new(code);
        vault
            .import_recovery(&profile, &network, &code)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_recovery_imported_public(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
) -> Result<RecoveryImported, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .recovery_imported_public(&profile, &network)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_recovery_prepare(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
    source: String,
) -> Result<RecoveryPrepared, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .prepare_recovery(&profile, &network, &source)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_recovery_prepared_public(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
) -> Result<RecoveryPublic, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .recovery_prepared_public(&profile, &network)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_recovery_sign_transaction(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
    phase: String,
    bytes: String,
) -> Result<SignedBytes, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .sign_recovery_transaction(&profile, &network, &phase, &bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let cache = app.path().app_cache_dir()?.join("device-locks-v1");
            // Debug-only, isolated native UI acceptance. Never access production
            // credentials in fixtures, and never enable this in release builds.
            let test_mode = cfg!(debug_assertions)
                && std::env::var("FM_NATIVE_ACCEPTANCE").as_deref() == Ok("isolated");
            let service = if test_mode {
                "org.fractalmind.app.device.test"
            } else {
                DEVICE_SERVICE
            };
            app.manage(Arc::new(DeviceVault::new(service, cache)));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(if test_mode {
                    "FractalMind · isolated local acceptance"
                } else {
                    "FractalMind"
                })
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 600.0)
                .on_navigation(local_origin)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fm_device_public,
            fm_device_initialize,
            fm_device_sign_transaction,
            fm_device_prove,
            fm_onboarding_create,
            fm_onboarding_public,
            fm_onboarding_sign_transaction,
            fm_device_decrypt_record,
            fm_device_encrypt_record,
            fm_recovery_import,
            fm_recovery_imported_public,
            fm_recovery_prepare,
            fm_recovery_prepared_public,
            fm_recovery_sign_transaction
        ])
        .run(tauri::generate_context!())
        .expect("FractalMind App runtime failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_app_origins_can_use_native_commands() {
        assert!(local_origin(
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(local_origin(
            &"http://tauri.localhost/index.html".parse().unwrap()
        ));
        for url in [
            "https://example.com",
            "tauri://other",
            "http://127.0.0.1:4190",
            "https://tauri.localhost.evil.test",
            "tauri://user@localhost/",
        ] {
            assert!(!local_origin(&url.parse().unwrap()));
        }
    }
}
