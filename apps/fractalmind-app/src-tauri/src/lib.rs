use fractalmind_device_vault::{
    DevicePublic, DeviceVault, OnboardingCreated, OnboardingPublic, RecoveryImported,
    RecoveryPrepared, RecoveryPublic, SessionStatus, SignedBytes, DEVICE_SERVICE,
};
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
pub mod agents;
pub mod local_host;
mod okr_export;

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
async fn fm_app_appearance(window: WebviewWindow, theme: String) -> Result<(), String> {
    main_window(&window)?;
    let dark = match theme.as_str() {
        "dark" => true,
        "light" => false,
        _ => return Err("InvalidAppearance".into()),
    };
    #[cfg(target_os = "android")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .with_webview(move |webview| {
                webview.jni_handle().exec(move |env, activity, _| {
                    let result = env
                        .call_method(
                            activity,
                            "fmSetAppearance",
                            "(Z)V",
                            &[jni::objects::JValue::Bool(u8::from(dark))],
                        )
                        .map(|_| ())
                        .map_err(|_| "NativeAppearanceUnavailable".to_string());
                    if result.is_err() {
                        let _ = env.exception_clear();
                    }
                    let _ = sender.send(result);
                });
            })
            .map_err(|_| "NativeAppearanceUnavailable".to_string())?;
        // JNI executes on the UI thread; wait off that thread and bound the wait.
        return tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| "NativeAppearanceUnavailable".to_string())?
        })
        .await
        .map_err(|_| "NativeTaskFailed".to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = dark;
        Ok(())
    }
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
/// Reads the device keys from the OS store once and keeps them in native memory
/// for this session. Returns public material only.
#[tauri::command]
async fn fm_device_unlock(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
) -> Result<DevicePublic, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || vault.unlock(&profile).map_err(|e| e.to_string()))
        .await
        .map_err(|_| "NativeTaskFailed".to_string())?
}
/// Zeroizes one profile's session, or all sessions when no profile is given.
#[tauri::command]
async fn fm_device_lock(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: Option<String>,
) -> Result<(), String> {
    main_window(&window)?;
    vault.lock(profile.as_deref()).map_err(|e| e.to_string())
}
#[tauri::command]
async fn fm_device_session(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
) -> Result<SessionStatus, String> {
    main_window(&window)?;
    vault.session_status(&profile).map_err(|e| e.to_string())
}
#[tauri::command]
async fn fm_device_touch(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
) -> Result<SessionStatus, String> {
    main_window(&window)?;
    vault.touch(&profile).map_err(|e| e.to_string())
}
#[tauri::command]
async fn fm_device_set_idle_timeout(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    ms: String,
) -> Result<u64, String> {
    main_window(&window)?;
    let ms: u64 = ms.parse().map_err(|_| "InvalidTimeout".to_string())?;
    vault.set_idle_timeout(ms).map_err(|e| e.to_string())
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
async fn fm_device_sign_node_command(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    bytes: String,
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
            .sign_node_command(&profile, &bytes, now)
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
/// Shows an unfinished setup's recovery code again (unlocked session only).
#[tauri::command]
async fn fm_onboarding_reveal(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    network: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .reveal_onboarding_code(&profile, &network)
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
#[tauri::command]
async fn fm_device_wrap_organization_keys(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    request: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .wrap_organization_keys(&profile, &request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_wrap_command_result_key(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    request: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .wrap_command_result_key(&profile, &request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[tauri::command]
async fn fm_device_encrypt_command_delivery(
    window: WebviewWindow,
    vault: State<'_, Arc<DeviceVault>>,
    profile: String,
    request: String,
) -> Result<String, String> {
    main_window(&window)?;
    let vault = Arc::clone(vault.inner());
    tauri::async_runtime::spawn_blocking(move || {
        vault
            .encrypt_command_delivery(&profile, &request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "NativeTaskFailed".to_string())?
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(okr_export::init())
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
            app.manage(Arc::new(DeviceVault::new(service, cache.clone())));
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title(if test_mode {
                        "FractalMind · isolated local acceptance"
                    } else {
                        "FractalMind"
                    })
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(360.0, 600.0)
                    .on_navigation(local_origin);
            if test_mode {
                // Acceptance must not read/overwrite the user's public
                // connection cache or transaction journal. Keep this store
                // persistent across restarts to test actual IndexedDB recovery.
                window = window.data_directory(cache.join("isolated-webview"));
                #[cfg(target_os = "macos")]
                {
                    window = window.data_store_identifier(*b"FMAppAcceptance1");
                }
            }
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fm_app_appearance,
            okr_export::fm_export_okr,
            fm_device_public,
            fm_device_unlock,
            fm_device_lock,
            fm_device_session,
            fm_device_touch,
            fm_device_set_idle_timeout,
            fm_device_initialize,
            fm_device_sign_transaction,
            fm_device_sign_node_command,
            fm_device_prove,
            fm_onboarding_create,
            fm_onboarding_public,
            fm_onboarding_reveal,
            fm_onboarding_sign_transaction,
            fm_device_decrypt_record,
            fm_device_encrypt_record,
            fm_recovery_import,
            fm_recovery_imported_public,
            fm_recovery_prepare,
            fm_recovery_prepared_public,
            fm_recovery_sign_transaction,
            fm_device_wrap_organization_keys,
            fm_device_wrap_command_result_key,
            fm_device_encrypt_command_delivery,
            local_host::fm_local_host_status,
            local_host::fm_local_host_keys,
            local_host::fm_local_host_configure,
            local_host::fm_local_host_join,
            local_host::fm_local_host_service,
            local_host::fm_local_host_uninstall,
            local_host::fm_local_host_discover,
            agents::fm_agent_catalog,
            agents::fm_agent_launchers,
            agents::fm_agent_home_check,
            agents::fm_agent_create,
            agents::fm_agent_start,
            agents::fm_agent_deliver_okr,
            agents::fm_agent_send,
            agents::fm_agent_output,
            agents::fm_agent_read_proposal
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
