use tauri::{plugin::TauriPlugin, Runtime, WebviewWindow};

fn valid_projection(content: &str, reviewed: bool) -> bool {
    reviewed
        && content.len() <= 262_144
        && content.starts_with("# FractalMind OKR\n")
        && content.contains("\n```fractalmind-okr-snapshot\n")
        && content.contains("\n```fractalmind-okr-proposal\n")
        && content.ends_with("\n```\n")
}

#[cfg(target_os = "android")]
struct AndroidExport<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("fm-okr-export")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    _api.register_android_plugin("org.fractalmind.desktop", "OkrExportPlugin")?;
                _app.manage(AndroidExport(handle));
            }
            Ok(())
        })
        .build()
}

/// Android's WebView does not save blob downloads. The native picker grants
/// access only to the document explicitly selected for this export. No path,
/// URI, generic filesystem command, or persistent permission is exposed to JS.
#[tauri::command]
pub async fn fm_export_okr(
    window: WebviewWindow,
    content: String,
    reviewed: bool,
) -> Result<bool, String> {
    super::main_window(&window)?;
    let content = zeroize::Zeroizing::new(content);
    if !valid_projection(&content, reviewed) {
        return Err("InvalidOkrExport".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let result: serde_json::Value = window
            .state::<AndroidExport<tauri::Wry>>()
            .0
            .run_mobile_plugin_async(
                "saveOkr",
                serde_json::json!({
                    "content": content.as_str(), "reviewed": reviewed
                }),
            )
            .await
            .map_err(|_| "NativeOkrExportFailed".to_string())?;
        if !matches!(
            result.get("status").and_then(|v| v.as_str()),
            Some("saved" | "cancelled")
        ) {
            return Err("NativeOkrExportFailed".into());
        }
        // Handled includes cancellation. Never fall back to another write.
        return Ok(true);
    }
    #[cfg(not(target_os = "android"))]
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_requires_consent_and_bounded_projection() {
        let valid = "# FractalMind OKR\n\n```fractalmind-okr-snapshot\n{}\n```\n\n```fractalmind-okr-proposal\n{}\n```\n";
        assert!(valid_projection(valid, true));
        assert!(!valid_projection(valid, false));
        assert!(!valid_projection("arbitrary file", true));
        assert!(!valid_projection(
            &format!("{}{}", " ".repeat(262_144), valid),
            true
        ));
    }
}
