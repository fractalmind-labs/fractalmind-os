use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

pub const PRODUCT_NAME: &str = "FractalMind";
pub const BUNDLE_ID: &str = "ai.fractalmind.app";
pub const APP_INSTALL_PATH: &str = "/Applications/FractalMind.app";
pub const LAUNCH_AGENT_LABEL: &str = "ai.fractalmind.host";
const HOST_DIR: &str = "Library/Application Support/FractalMind/Host";
const INSTALLED_MANIFEST: &str = "current/manifest.json";
const ENVD_BIN: &str = "current/envd";
const DESKTOP_BIN: &str = "current/envd-desktop";
const ROLLBACK_DIR: &str = "rollback";
const LAUNCH_AGENT_FILE: &str = "Library/LaunchAgents/ai.fractalmind.host.plist";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Pass,
    Fail,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub state: CheckState,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPaths {
    pub app_install_path: String,
    pub app_support_dir: String,
    pub helper_dir: String,
    pub launch_agent_path: String,
    pub rollback_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub product_name: String,
    pub bundle_id: String,
    pub launch_agent_label: String,
    pub paths: HostPaths,
    pub helper_source: Check,
    pub helper_installed: Check,
    pub worker_running: Check,
    pub worker_authenticated: Check,
    pub desktop_health: Check,
    pub media_status: Check,
    pub orphan_ffmpeg: Check,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostOperationResult {
    pub success: bool,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct HelperManifest {
    version: String,
    envd_sha256: String,
    envd_desktop_sha256: String,
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_status() -> HostStatus {
    host_status_for_home(home_dir())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_install() -> HostOperationResult {
    unavailable_install_result()
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_restart() -> HostOperationResult {
    let paths = expected_paths(home_dir());
    if let Err(result) = host_restart_preflight(&paths) {
        return result;
    }
    if std::env::consts::OS != "macos" {
        return unsupported_result("restart", "LaunchAgent restart is only available on macOS.");
    }
    let uid = Command::new("id").arg("-u").output();
    let Ok(uid) = uid else {
        return fail_result(
            "uid_failed",
            "Could not read current macOS uid for launchctl.",
        );
    };
    let uid = String::from_utf8_lossy(&uid.stdout).trim().to_string();
    let service = format!("gui/{uid}/{LAUNCH_AGENT_LABEL}");
    let status = Command::new("launchctl")
        .arg("kickstart")
        .arg("-k")
        .arg(service)
        .status();
    match status {
        Ok(status) if status.success() => HostOperationResult {
            success: true,
            code: "restarted".to_string(),
            message: "Host LaunchAgent restart requested.".to_string(),
        },
        Ok(status) => fail_result("restart_failed", &format!("launchctl exited with {status}")),
        Err(err) => fail_result("restart_failed", &format!("launchctl failed: {err}")),
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_rollback() -> HostOperationResult {
    let paths = expected_paths(home_dir());
    let rollback_dir = Path::new(&paths.rollback_dir);
    if !rollback_dir.exists() {
        return fail_result(
            "rollback_unavailable",
            "No retained rollback helper exists. Install/update must retain one before rollback can run.",
        );
    }
    fail_result(
        "manual_rollback_required",
        "Rollback material exists, but automated replacement is disabled until signed helper assets are bundled.",
    )
}

pub fn host_status_for_home(home: Option<PathBuf>) -> HostStatus {
    let paths = expected_paths(home);
    HostStatus {
        product_name: PRODUCT_NAME.to_string(),
        bundle_id: BUNDLE_ID.to_string(),
        launch_agent_label: LAUNCH_AGENT_LABEL.to_string(),
        helper_source: helper_source_status(),
        helper_installed: helper_installed_status(&paths),
        worker_running: worker_running_status(&paths),
        worker_authenticated: Check {
            state: CheckState::Unknown,
            message: "Requires installed helper telemetry/coordinator readback.".to_string(),
            detail: None,
        },
        desktop_health: desktop_health_status(),
        media_status: Check {
            state: CheckState::Unknown,
            message: "Requires an active viewer and desktop `/status` media counters.".to_string(),
            detail: None,
        },
        orphan_ffmpeg: orphan_ffmpeg_status(),
        paths,
    }
}

pub fn expected_paths(home: Option<PathBuf>) -> HostPaths {
    let home = home.unwrap_or_else(|| PathBuf::from("~"));
    let app_support_dir = home.join(HOST_DIR);
    HostPaths {
        app_install_path: APP_INSTALL_PATH.to_string(),
        app_support_dir: app_support_dir.to_string_lossy().to_string(),
        helper_dir: app_support_dir
            .join("current")
            .to_string_lossy()
            .to_string(),
        launch_agent_path: home.join(LAUNCH_AGENT_FILE).to_string_lossy().to_string(),
        rollback_dir: app_support_dir
            .join(ROLLBACK_DIR)
            .to_string_lossy()
            .to_string(),
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn helper_source_status() -> Check {
    Check {
        state: CheckState::Fail,
        message: "No deterministic bundled helper manifest is present; install is fail-closed."
            .to_string(),
        detail: Some(
            "Expected signed envd/envd-desktop assets with exact SHA256 manifest.".to_string(),
        ),
    }
}

fn helper_installed_status(paths: &HostPaths) -> Check {
    let helper_dir = Path::new(&paths.helper_dir);
    if !helper_dir.exists() {
        return Check {
            state: CheckState::Fail,
            message: "Host helper is not installed.".to_string(),
            detail: Some(paths.helper_dir.clone()),
        };
    }
    let manifest_path = Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST);
    let manifest = match read_manifest(&manifest_path) {
        Ok(manifest) => manifest,
        Err(err) => {
            return Check {
                state: CheckState::Fail,
                message: "Installed helper manifest is missing or invalid.".to_string(),
                detail: Some(err),
            };
        }
    };
    let envd_path = Path::new(&paths.app_support_dir).join(ENVD_BIN);
    let desktop_path = Path::new(&paths.app_support_dir).join(DESKTOP_BIN);
    let envd_ok = verify_sha256(&envd_path, &manifest.envd_sha256);
    let desktop_ok = verify_sha256(&desktop_path, &manifest.envd_desktop_sha256);
    match (envd_ok, desktop_ok) {
        (Ok(()), Ok(())) => Check {
            state: CheckState::Pass,
            message: format!(
                "Host helper installed at version {} with matching SHA256.",
                manifest.version
            ),
            detail: Some(paths.helper_dir.clone()),
        },
        (envd, desktop) => Check {
            state: CheckState::Fail,
            message: "Installed helper checksum verification failed.".to_string(),
            detail: Some(format!("envd={envd:?}; envd-desktop={desktop:?}")),
        },
    }
}

fn host_restart_preflight(paths: &HostPaths) -> Result<(), HostOperationResult> {
    let helper = helper_installed_status(paths);
    if helper.state != CheckState::Pass {
        return Err(fail_result(
            "helper_not_verified",
            "Refusing to restart Host: installed envd/envd-desktop helpers are missing or failed SHA256 verification.",
        ));
    }

    let launch_agent = launch_agent_identity_status(paths);
    if launch_agent.state != CheckState::Pass {
        return Err(fail_result(
            "launch_agent_not_verified",
            "Refusing to restart Host: LaunchAgent identity does not match FractalMind Host.",
        ));
    }

    Ok(())
}

fn launch_agent_identity_status(paths: &HostPaths) -> Check {
    let path = Path::new(&paths.launch_agent_path);
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            return Check {
                state: CheckState::Fail,
                message: "Host LaunchAgent is not installed.".to_string(),
                detail: Some(format!("{}: {err}", path.display())),
            };
        }
    };

    let expected_helper = Path::new(&paths.app_support_dir).join(ENVD_BIN);
    let expected_helper = expected_helper.to_string_lossy();
    if raw.contains(LAUNCH_AGENT_LABEL) && raw.contains(expected_helper.as_ref()) {
        Check {
            state: CheckState::Pass,
            message: "LaunchAgent identity matches FractalMind Host.".to_string(),
            detail: Some(paths.launch_agent_path.clone()),
        }
    } else {
        Check {
            state: CheckState::Fail,
            message: "LaunchAgent identity does not match FractalMind Host.".to_string(),
            detail: Some(paths.launch_agent_path.clone()),
        }
    }
}

fn read_manifest(path: &Path) -> Result<HelperManifest, String> {
    let raw = fs::read_to_string(path).map_err(|err| format!("{}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("{}: {err}", path.display()))
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("{} sha256 {actual} != {expected}", path.display()))
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|err| format!("{}: {err}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn worker_running_status(paths: &HostPaths) -> Check {
    if std::env::consts::OS != "macos" {
        return Check {
            state: CheckState::Unsupported,
            message: "LaunchAgent status is only available on macOS.".to_string(),
            detail: None,
        };
    }
    if !Path::new(&paths.launch_agent_path).exists() {
        return Check {
            state: CheckState::Fail,
            message: "Host LaunchAgent is not installed.".to_string(),
            detail: Some(paths.launch_agent_path.clone()),
        };
    }
    let uid = Command::new("id").arg("-u").output();
    let Ok(uid) = uid else {
        return unknown_check("Could not read current uid for launchctl.");
    };
    let uid = String::from_utf8_lossy(&uid.stdout).trim().to_string();
    let service = format!("gui/{uid}/{LAUNCH_AGENT_LABEL}");
    match Command::new("launchctl")
        .arg("print")
        .arg(&service)
        .output()
    {
        Ok(out) if out.status.success() => Check {
            state: CheckState::Pass,
            message: "Host LaunchAgent is loaded.".to_string(),
            detail: Some(service),
        },
        Ok(out) => Check {
            state: CheckState::Fail,
            message: "Host LaunchAgent is not loaded.".to_string(),
            detail: Some(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        },
        Err(err) => Check {
            state: CheckState::Unknown,
            message: "Could not inspect LaunchAgent.".to_string(),
            detail: Some(err.to_string()),
        },
    }
}

fn desktop_health_status() -> Check {
    match http_get("127.0.0.1:8090", "/healthz") {
        Ok(body) if body.trim() == "ok" => Check {
            state: CheckState::Pass,
            message: "envd-desktop /healthz returned ok.".to_string(),
            detail: None,
        },
        Ok(body) => Check {
            state: CheckState::Fail,
            message: "envd-desktop /healthz returned an unexpected body.".to_string(),
            detail: Some(body),
        },
        Err(err) => Check {
            state: CheckState::Fail,
            message: "envd-desktop /healthz is not reachable.".to_string(),
            detail: Some(err),
        },
    }
}

fn http_get(addr: &str, path: &str) -> Result<String, String> {
    let addr = addr
        .to_socket_addrs()
        .map_err(|err| format!("resolve {addr}: {err}"))?
        .next()
        .ok_or_else(|| format!("resolve {addr}: no address"))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500))
        .map_err(|err| format!("connect {addr}: {err}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(800)))
        .map_err(|err| format!("set read timeout: {err}"))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .map_err(|err| format!("write request: {err}"))?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|err| format!("read response: {err}"))?;
    let Some((head, body)) = raw.split_once("\r\n\r\n") else {
        return Err("malformed HTTP response".to_string());
    };
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return Err(head.lines().next().unwrap_or("HTTP error").to_string());
    }
    Ok(body.to_string())
}

fn orphan_ffmpeg_status() -> Check {
    let out = Command::new("ps")
        .arg("-axo")
        .arg("pid=,ppid=,comm=")
        .output();
    let Ok(out) = out else {
        return unknown_check("Could not inspect process table.");
    };
    if !out.status.success() {
        return unknown_check("Process table inspection failed.");
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let count = text
        .lines()
        .filter(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            parts.len() >= 3 && parts[1] == "1" && parts[2].contains("ffmpeg")
        })
        .count();
    Check {
        state: if count == 0 {
            CheckState::Pass
        } else {
            CheckState::Fail
        },
        message: format!("PPID=1 ffmpeg process count: {count}."),
        detail: None,
    }
}

fn unavailable_install_result() -> HostOperationResult {
    fail_result(
        "helper_bundle_unavailable",
        "No verified helper bundle is available. Install is fail-closed until envd/envd-desktop assets and SHA256 manifest are bundled deterministically.",
    )
}

fn unsupported_result(code: &str, message: &str) -> HostOperationResult {
    HostOperationResult {
        success: false,
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn fail_result(code: &str, message: &str) -> HostOperationResult {
    HostOperationResult {
        success: false,
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn unknown_check(message: &str) -> Check {
    Check {
        state: CheckState::Unknown,
        message: message.to_string(),
        detail: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{create_dir_all, write},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn expected_paths_use_fractalmind_identity() {
        let paths = expected_paths(Some(PathBuf::from("/Users/example")));
        assert_eq!(paths.app_install_path, "/Applications/FractalMind.app");
        assert_eq!(
            paths.app_support_dir,
            "/Users/example/Library/Application Support/FractalMind/Host"
        );
        assert_eq!(
            paths.launch_agent_path,
            "/Users/example/Library/LaunchAgents/ai.fractalmind.host.plist"
        );
    }

    #[test]
    fn status_is_fail_closed_without_bundled_helper_or_install() {
        let home = unique_temp_dir("fractalmind-host-missing");
        let status = host_status_for_home(Some(home));
        assert_eq!(status.product_name, "FractalMind");
        assert_eq!(status.bundle_id, "ai.fractalmind.app");
        assert_eq!(status.helper_source.state, CheckState::Fail);
        assert_eq!(status.helper_installed.state, CheckState::Fail);
    }

    #[test]
    fn installed_helper_requires_exact_checksums() {
        let home = unique_temp_dir("fractalmind-host-installed");
        let paths = expected_paths(Some(home.clone()));
        write_verified_helper(&paths);

        let status = helper_installed_status(&paths);
        assert_eq!(status.state, CheckState::Pass);
    }

    #[test]
    fn restart_preflight_requires_verified_helper_checksum() {
        let home = unique_temp_dir("fractalmind-host-tampered");
        let paths = expected_paths(Some(home));
        write_verified_helper(&paths);
        write_launch_agent(&paths);
        write(
            Path::new(&paths.app_support_dir).join(ENVD_BIN),
            b"tampered",
        )
        .unwrap();

        let result = host_restart_preflight(&paths).unwrap_err();
        assert!(!result.success);
        assert_eq!(result.code, "helper_not_verified");
    }

    #[test]
    fn restart_preflight_requires_expected_launch_agent_identity() {
        let home = unique_temp_dir("fractalmind-host-wrong-plist");
        let paths = expected_paths(Some(home));
        write_verified_helper(&paths);
        create_dir_all(Path::new(&paths.launch_agent_path).parent().unwrap()).unwrap();
        write(
            &paths.launch_agent_path,
            "<plist><string>other.label</string></plist>",
        )
        .unwrap();

        let result = host_restart_preflight(&paths).unwrap_err();
        assert!(!result.success);
        assert_eq!(result.code, "launch_agent_not_verified");
    }

    #[test]
    fn restart_preflight_accepts_verified_helper_and_launch_agent_identity() {
        let home = unique_temp_dir("fractalmind-host-restart-ok");
        let paths = expected_paths(Some(home));
        write_verified_helper(&paths);
        write_launch_agent(&paths);

        assert!(host_restart_preflight(&paths).is_ok());
    }

    #[test]
    fn install_returns_unavailable_without_verified_bundle() {
        let result = host_install();
        assert!(!result.success);
        assert_eq!(result.code, "helper_bundle_unavailable");
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("{prefix}-{stamp}"));
        create_dir_all(&dir).unwrap();
        dir
    }

    fn write_verified_helper(paths: &HostPaths) {
        create_dir_all(&paths.helper_dir).unwrap();
        let envd_path = Path::new(&paths.app_support_dir).join(ENVD_BIN);
        let desktop_path = Path::new(&paths.app_support_dir).join(DESKTOP_BIN);
        write(&envd_path, b"envd").unwrap();
        write(&desktop_path, b"desktop").unwrap();
        let manifest = format!(
            r#"{{
                "version":"test",
                "envd_sha256":"{}",
                "envd_desktop_sha256":"{}"
            }}"#,
            sha256_file(&envd_path).unwrap(),
            sha256_file(&desktop_path).unwrap()
        );
        write(
            Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST),
            manifest,
        )
        .unwrap();
    }

    fn write_launch_agent(paths: &HostPaths) {
        create_dir_all(Path::new(&paths.launch_agent_path).parent().unwrap()).unwrap();
        let envd_path = Path::new(&paths.app_support_dir).join(ENVD_BIN);
        write(
            &paths.launch_agent_path,
            format!(
                "<plist><dict><key>Label</key><string>{}</string><key>ProgramArguments</key><array><string>{}</string></array></dict></plist>",
                LAUNCH_AGENT_LABEL,
                envd_path.display()
            ),
        )
        .unwrap();
    }
}
