use serde::Serialize;
use std::process::Command;

pub const SCREEN_RECORDING_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
pub const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Pass,
    Fail,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheck {
    pub state: PermissionState,
    pub label: &'static str,
    pub settings_url: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacosPermissions {
    pub platform: String,
    pub screen_recording: PermissionCheck,
    pub accessibility: PermissionCheck,
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn get_macos_permissions() -> MacosPermissions {
    macos_permissions_for_platform(std::env::consts::OS)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn open_macos_permission_settings(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "screen_recording" => SCREEN_RECORDING_SETTINGS_URL,
        "accessibility" => ACCESSIBILITY_SETTINGS_URL,
        _ => return Err(format!("unknown permission pane: {kind}")),
    };
    open_settings_url(url)
}

pub fn macos_permissions_for_platform(platform: &str) -> MacosPermissions {
    let supported = platform == "macos";
    MacosPermissions {
        platform: platform.to_string(),
        screen_recording: permission_check(
            "Screen Recording",
            SCREEN_RECORDING_SETTINGS_URL,
            supported,
            preflight_screen_recording(),
        ),
        accessibility: permission_check(
            "Accessibility",
            ACCESSIBILITY_SETTINGS_URL,
            supported,
            preflight_accessibility(),
        ),
    }
}

fn permission_check(
    label: &'static str,
    settings_url: &'static str,
    supported: bool,
    granted: Option<bool>,
) -> PermissionCheck {
    if !supported {
        return PermissionCheck {
            state: PermissionState::Unsupported,
            label,
            settings_url,
            message: "Only available in the macOS app bundle.".to_string(),
        };
    }
    match granted {
        Some(true) => PermissionCheck {
            state: PermissionState::Pass,
            label,
            settings_url,
            message: "Permission is currently granted for this app identity.".to_string(),
        },
        Some(false) => PermissionCheck {
            state: PermissionState::Fail,
            label,
            settings_url,
            message: "Permission is not granted. Open System Settings and grant it manually."
                .to_string(),
        },
        None => PermissionCheck {
            state: PermissionState::Unknown,
            label,
            settings_url,
            message: "Native permission probe is unavailable for this build.".to_string(),
        },
    }
}

fn open_settings_url(url: &str) -> Result<(), String> {
    if std::env::consts::OS != "macos" {
        return Err("System Settings deep links can only be opened by the macOS app.".to_string());
    }
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|err| format!("open System Settings: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open System Settings exited with {status}"))
    }
}

#[cfg(target_os = "macos")]
fn preflight_screen_recording() -> Option<bool> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    Some(unsafe { CGPreflightScreenCaptureAccess() })
}

#[cfg(not(target_os = "macos"))]
fn preflight_screen_recording() -> Option<bool> {
    None
}

#[cfg(target_os = "macos")]
fn preflight_accessibility() -> Option<bool> {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    Some(unsafe { AXIsProcessTrusted() })
}

#[cfg(not(target_os = "macos"))]
fn preflight_accessibility() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_macos_permissions_are_explicitly_unsupported() {
        let status = macos_permissions_for_platform("linux");
        assert_eq!(status.screen_recording.state, PermissionState::Unsupported);
        assert_eq!(status.accessibility.state, PermissionState::Unsupported);
        assert_eq!(
            status.screen_recording.settings_url,
            SCREEN_RECORDING_SETTINGS_URL
        );
        assert_eq!(
            status.accessibility.settings_url,
            ACCESSIBILITY_SETTINGS_URL
        );
    }

    #[test]
    fn permission_state_serializes_to_check_state_contract() {
        let granted = permission_check(
            "Screen Recording",
            SCREEN_RECORDING_SETTINGS_URL,
            true,
            Some(true),
        );
        let denied = permission_check(
            "Accessibility",
            ACCESSIBILITY_SETTINGS_URL,
            true,
            Some(false),
        );
        let unknown = permission_check(
            "Screen Recording",
            SCREEN_RECORDING_SETTINGS_URL,
            true,
            None,
        );
        let unsupported = permission_check(
            "Accessibility",
            ACCESSIBILITY_SETTINGS_URL,
            false,
            Some(true),
        );

        assert_eq!(serde_json::to_value(granted).unwrap()["state"], "pass");
        assert_eq!(serde_json::to_value(denied).unwrap()["state"], "fail");
        assert_eq!(serde_json::to_value(unknown).unwrap()["state"], "unknown");
        assert_eq!(
            serde_json::to_value(unsupported).unwrap()["state"],
            "unsupported"
        );
    }
}
