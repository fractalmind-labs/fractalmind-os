use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
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
const BACKUP_DIR: &str = "current.backup";
const LAUNCH_AGENT_FILE: &str = "Library/LaunchAgents/ai.fractalmind.host.plist";
const TRUSTED_SOURCE_REPO: &str = "fractalmind-ai/fractalmind-envd";
const BUNDLED_VERSION: &str = "pr77-46d03eb-darwin-arm64";
const BUNDLED_PLATFORM: &str = "darwin-arm64";
const BUNDLED_SOURCE_SHA: &str = "46d03eb9aa3f02cde7b82a9bc1829661b7e498d7";
const BUNDLED_ENVD_SHA256: &str =
    "69567766184162e6966ab624c61c725634b5bd87a3996454ed351ac2558168b0";
const BUNDLED_DESKTOP_SHA256: &str =
    "da4b6ec8040475766909b72be4452a78615990e0ce849cdb43d6d3066975721b";
const RETAINED_MARKER: &str = ".installer-retained";
const BUNDLED_MANIFEST_JSON: &str =
    include_str!("../bundled-sidecars/fractalmind-host-pr77-darwin-arm64/manifest.json");
const BUNDLED_ENVD_BYTES: &[u8] =
    include_bytes!("../bundled-sidecars/fractalmind-host-pr77-darwin-arm64/envd");
const BUNDLED_DESKTOP_BYTES: &[u8] =
    include_bytes!("../bundled-sidecars/fractalmind-host-pr77-darwin-arm64/envd-desktop");

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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperManifest {
    schema_version: u32,
    version: String,
    platform: String,
    source_repo: String,
    source_sha: String,
    source_ref: String,
    build_toolchain: String,
    build_commands: Vec<String>,
    envd_sha256: String,
    envd_desktop_sha256: String,
    repeat_build_verified: bool,
    historical_deployed_desktop_sha256: String,
    rollback_identity: String,
    #[serde(default)]
    excluded_default_sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperTrustMarker {
    schema_version: u32,
    retained_by: String,
    version: String,
    source_sha: String,
    envd_sha256: String,
    envd_desktop_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelperRole {
    Current,
    InstallerRetainedRollback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeEvidence {
    start: String,
    desktop_health: Check,
    orphan_ffmpeg: Check,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeProbe {
    Skip,
    Real,
    Pass(&'static str),
    Fail(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstallDeps {
    os: &'static str,
    arch: &'static str,
    fail_replacement_after_backup: bool,
    update_probe: RuntimeProbe,
    rollback_probe: RuntimeProbe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstallOutcome {
    updated: bool,
    evidence: Option<RuntimeEvidence>,
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_status() -> HostStatus {
    host_status_for_home(home_dir())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn host_install() -> HostOperationResult {
    host_install_for_home(home_dir(), true)
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
    host_rollback_for_home(home_dir(), true)
}

pub fn host_install_for_home(
    home: Option<PathBuf>,
    start_after_install: bool,
) -> HostOperationResult {
    let probe = if start_after_install {
        RuntimeProbe::Real
    } else {
        RuntimeProbe::Skip
    };
    host_install_for_home_with_deps(
        home,
        InstallDeps {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            fail_replacement_after_backup: false,
            update_probe: probe.clone(),
            rollback_probe: probe,
        },
    )
}

fn host_install_for_home_with_deps(
    home: Option<PathBuf>,
    deps: InstallDeps,
) -> HostOperationResult {
    let manifest = match bundled_helper_manifest() {
        Ok(manifest) => manifest,
        Err(err) => {
            return fail_result(
                "helper_bundle_invalid",
                &format!("Bundled envd/envd-desktop helper verification failed: {err}"),
            );
        }
    };
    if let Err(err) = bundled_helper_supported_on(deps.os, deps.arch) {
        return fail_result("helper_bundle_unsupported", &err);
    }
    let paths = expected_paths(home);
    match install_bundled_helper(&paths, &manifest, &deps) {
        Ok(outcome) => {
            let evidence = outcome
                .evidence
                .map(|e| format!(" {}", format_runtime_evidence(&e)))
                .unwrap_or_default();
            HostOperationResult {
                success: true,
                code: if outcome.updated { "updated" } else { "installed" }.to_string(),
                message: format!(
                    "FractalMind Host helper {} is installed with verified envd/envd-desktop SHA256 material.{evidence}",
                    manifest.version
                ),
            }
        }
        Err(err) => fail_result("install_failed", &err),
    }
}

pub fn host_rollback_for_home(
    home: Option<PathBuf>,
    start_after_rollback: bool,
) -> HostOperationResult {
    let probe = if start_after_rollback {
        RuntimeProbe::Real
    } else {
        RuntimeProbe::Skip
    };
    host_rollback_for_home_with_probe(home, probe)
}

fn host_rollback_for_home_with_probe(
    home: Option<PathBuf>,
    probe: RuntimeProbe,
) -> HostOperationResult {
    let paths = expected_paths(home);
    match restore_rollback_helper(&paths, false, &probe) {
        Ok((version, evidence)) => {
            let evidence = evidence
                .map(|e| format!(" {}", format_runtime_evidence(&e)))
                .unwrap_or_default();
            HostOperationResult {
                success: true,
                code: "rolled_back".to_string(),
                message: format!(
                    "FractalMind Host helper rolled back to verified version {version}.{evidence}"
                ),
            }
        }
        Err(err) => fail_result("rollback_failed", &err),
    }
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
    helper_source_status_for_platform(std::env::consts::OS, std::env::consts::ARCH)
}

fn helper_source_status_for_platform(os: &str, arch: &str) -> Check {
    let manifest = match bundled_helper_manifest() {
        Ok(manifest) => manifest,
        Err(err) => {
            return Check {
                state: CheckState::Fail,
                message:
                    "Bundled helper manifest or artifact verification failed; install is fail-closed."
                        .to_string(),
                detail: Some(err),
            };
        }
    };
    if let Err(err) = bundled_helper_supported_on(os, arch) {
        return Check {
            state: CheckState::Unsupported,
            message: "Bundled helper source is only available for macOS arm64.".to_string(),
            detail: Some(err),
        };
    }
    Check {
        state: CheckState::Pass,
        message: format!(
            "Bundled envd/envd-desktop helper source {} verified against SHA256 manifest.",
            manifest.version
        ),
        detail: Some(format!(
            "{}@{}; envd={}; envd-desktop={}",
            manifest.source_repo,
            manifest.source_sha,
            manifest.envd_sha256,
            manifest.envd_desktop_sha256
        )),
    }
}

fn bundled_helper_supported_on(os: &str, arch: &str) -> Result<(), String> {
    if BUNDLED_PLATFORM != "darwin-arm64" {
        return Err(format!(
            "bundled helper platform {BUNDLED_PLATFORM} is not supported by this build"
        ));
    }
    if os != "macos" {
        return Err(format!(
            "bundled helper platform {BUNDLED_PLATFORM} cannot run on {os}/{arch}"
        ));
    }
    if arch != "aarch64" {
        return Err(format!(
            "bundled helper platform {BUNDLED_PLATFORM} cannot run on macOS {arch}"
        ));
    }
    Ok(())
}

fn bundled_helper_manifest() -> Result<HelperManifest, String> {
    parse_and_verify_bundled_helper(
        BUNDLED_MANIFEST_JSON,
        BUNDLED_ENVD_BYTES,
        BUNDLED_DESKTOP_BYTES,
    )
}

fn parse_and_verify_bundled_helper(
    manifest_raw: &str,
    envd: &[u8],
    desktop: &[u8],
) -> Result<HelperManifest, String> {
    let manifest: HelperManifest =
        serde_json::from_str(manifest_raw).map_err(|err| format!("manifest.json: {err}"))?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "manifest schemaVersion {} is not supported",
            manifest.schema_version
        ));
    }
    if manifest.version != BUNDLED_VERSION {
        return Err(format!(
            "manifest version {} != expected {}",
            manifest.version, BUNDLED_VERSION
        ));
    }
    if manifest.platform != BUNDLED_PLATFORM {
        return Err(format!(
            "manifest platform {} != expected {}",
            manifest.platform, BUNDLED_PLATFORM
        ));
    }
    if manifest.source_sha != BUNDLED_SOURCE_SHA {
        return Err(format!(
            "manifest sourceSha {} != expected {}",
            manifest.source_sha, BUNDLED_SOURCE_SHA
        ));
    }
    validate_manifest_policy(&manifest)?;
    if sha256_bytes(envd) != manifest.envd_sha256 {
        return Err("envd bytes do not match manifest SHA256".to_string());
    }
    if sha256_bytes(desktop) != manifest.envd_desktop_sha256 {
        return Err("envd-desktop bytes do not match manifest SHA256".to_string());
    }
    Ok(manifest)
}

fn validate_manifest_policy(manifest: &HelperManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "manifest schemaVersion {} is not supported",
            manifest.schema_version
        ));
    }
    if manifest.platform != BUNDLED_PLATFORM {
        return Err(format!(
            "manifest platform {} is not trusted by this bundle",
            manifest.platform
        ));
    }
    if manifest.source_repo != TRUSTED_SOURCE_REPO {
        return Err(format!(
            "manifest sourceRepo {} is not trusted",
            manifest.source_repo
        ));
    }
    if manifest.source_sha != BUNDLED_SOURCE_SHA {
        return Err(format!(
            "manifest sourceSha {} is not trusted",
            manifest.source_sha
        ));
    }
    if !manifest.repeat_build_verified {
        return Err("manifest repeatBuildVerified must be true".to_string());
    }
    Ok(())
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
    let manifest = match verify_helper_dir(helper_dir, HelperRole::Current) {
        Ok(manifest) => manifest,
        Err(err) => {
            return Check {
                state: CheckState::Fail,
                message: "Installed helper material is missing, invalid, or untrusted.".to_string(),
                detail: Some(err),
            };
        }
    };
    Check {
        state: CheckState::Pass,
        message: format!(
            "Host helper installed at version {} with trusted marker and matching SHA256.",
            manifest.version
        ),
        detail: Some(paths.helper_dir.clone()),
    }
}

fn install_bundled_helper(
    paths: &HostPaths,
    manifest: &HelperManifest,
    deps: &InstallDeps,
) -> Result<InstallOutcome, String> {
    let app_support = Path::new(&paths.app_support_dir);
    let current_dir = Path::new(&paths.helper_dir);
    let rollback_dir = Path::new(&paths.rollback_dir);
    let temp_dir = app_support.join("current.installing");
    let backup_dir = app_support.join(BACKUP_DIR);
    fs::create_dir_all(app_support).map_err(|err| format!("{}: {err}", app_support.display()))?;

    let update = current_dir.exists();
    if update {
        let installed = verify_helper_dir(current_dir, HelperRole::Current)?;
        if installed.version == manifest.version
            && installed.envd_sha256 == manifest.envd_sha256
            && installed.envd_desktop_sha256 == manifest.envd_desktop_sha256
        {
            write_launch_agent(paths)?;
            host_restart_preflight(paths).map_err(|result| result.message)?;
            let evidence = run_runtime_probe(paths, &deps.update_probe)?;
            return Ok(InstallOutcome {
                updated: false,
                evidence,
            });
        }
        retain_rollback(current_dir, rollback_dir, app_support)?;
    }

    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|err| format!("remove {}: {err}", temp_dir.display()))?;
    }
    write_helper_dir(
        &temp_dir,
        manifest,
        BUNDLED_ENVD_BYTES,
        BUNDLED_DESKTOP_BYTES,
    )?;
    verify_helper_dir(&temp_dir, HelperRole::Current)?;

    replace_dir_with_backup(
        current_dir,
        &temp_dir,
        &backup_dir,
        deps.fail_replacement_after_backup,
    )?;
    write_launch_agent(paths)?;
    host_restart_preflight(paths).map_err(|result| result.message)?;
    match run_runtime_probe(paths, &deps.update_probe) {
        Ok(evidence) => Ok(InstallOutcome {
            updated: update,
            evidence,
        }),
        Err(err) if update => {
            let rollback = restore_rollback_helper(paths, false, &deps.rollback_probe);
            match rollback {
                Ok((version, evidence)) => {
                    let evidence = evidence
                        .map(|e| format!(" {}", format_runtime_evidence(&e)))
                        .unwrap_or_else(|| " rollback readback skipped in this test path.".to_string());
                    Err(format!(
                        "post-update validation failed ({err}); restored retained helper {version}.{evidence}"
                    ))
                }
                Err(rollback_err) => Err(format!(
                    "post-update validation failed ({err}); automatic rollback failed: {rollback_err}"
                )),
            }
        }
        Err(err) => Err(format!("post-install validation failed: {err}")),
    }
}

fn restore_rollback_helper(
    paths: &HostPaths,
    fail_replacement_after_backup: bool,
    probe: &RuntimeProbe,
) -> Result<(String, Option<RuntimeEvidence>), String> {
    let current_dir = Path::new(&paths.helper_dir);
    let rollback_dir = Path::new(&paths.rollback_dir);
    if !rollback_dir.exists() {
        return Err(
            "No retained rollback helper exists. Install/update must retain one before rollback can run."
                .to_string(),
        );
    }
    let rollback_manifest = verify_helper_dir(rollback_dir, HelperRole::InstallerRetainedRollback)?;
    let app_support = Path::new(&paths.app_support_dir);
    let temp_dir = app_support.join("current.rollback");
    let backup_dir = app_support.join(BACKUP_DIR);
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|err| format!("remove {}: {err}", temp_dir.display()))?;
    }
    copy_dir(rollback_dir, &temp_dir)?;
    verify_helper_dir(&temp_dir, HelperRole::Current)?;
    replace_dir_with_backup(
        current_dir,
        &temp_dir,
        &backup_dir,
        fail_replacement_after_backup,
    )?;
    write_launch_agent(paths)?;
    host_restart_preflight(paths).map_err(|result| result.message)?;
    let evidence = run_runtime_probe(paths, probe)?;
    Ok((rollback_manifest.version, evidence))
}

fn verify_helper_dir(dir: &Path, role: HelperRole) -> Result<HelperManifest, String> {
    let manifest_path = dir.join("manifest.json");
    let manifest = read_manifest(&manifest_path)?;
    validate_manifest_policy(&manifest)?;
    verify_sha256(&dir.join("envd"), &manifest.envd_sha256)?;
    verify_sha256(&dir.join("envd-desktop"), &manifest.envd_desktop_sha256)?;
    verify_trust_marker(dir, &manifest, role)?;
    Ok(manifest)
}

fn write_helper_dir(
    dir: &Path,
    manifest: &HelperManifest,
    envd: &[u8],
    desktop: &[u8],
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("{}: {err}", dir.display()))?;
    write_private_file(&dir.join("envd"), envd, true)?;
    write_private_file(&dir.join("envd-desktop"), desktop, true)?;
    let manifest_json =
        serde_json::to_vec_pretty(manifest).map_err(|err| format!("manifest json: {err}"))?;
    write_private_file(&dir.join("manifest.json"), &manifest_json, false)?;
    write_trust_marker(dir, manifest)?;
    Ok(())
}

fn write_trust_marker(dir: &Path, manifest: &HelperManifest) -> Result<(), String> {
    let marker = HelperTrustMarker {
        schema_version: 1,
        retained_by: BUNDLE_ID.to_string(),
        version: manifest.version.clone(),
        source_sha: manifest.source_sha.clone(),
        envd_sha256: manifest.envd_sha256.clone(),
        envd_desktop_sha256: manifest.envd_desktop_sha256.clone(),
    };
    let marker_json =
        serde_json::to_vec_pretty(&marker).map_err(|err| format!("trust marker json: {err}"))?;
    write_private_file(&dir.join(RETAINED_MARKER), &marker_json, false)
}

fn verify_trust_marker(
    dir: &Path,
    manifest: &HelperManifest,
    role: HelperRole,
) -> Result<(), String> {
    let marker_path = dir.join(RETAINED_MARKER);
    let raw = fs::read_to_string(&marker_path)
        .map_err(|err| format!("{}: {err}", marker_path.display()))?;
    let marker: HelperTrustMarker =
        serde_json::from_str(&raw).map_err(|err| format!("{}: {err}", marker_path.display()))?;
    if marker.schema_version != 1 {
        return Err(format!(
            "{} schemaVersion {} is not supported",
            marker_path.display(),
            marker.schema_version
        ));
    }
    if marker.retained_by != BUNDLE_ID {
        return Err(format!(
            "{} retainedBy {} is not trusted",
            marker_path.display(),
            marker.retained_by
        ));
    }
    if marker.version != manifest.version
        || marker.source_sha != manifest.source_sha
        || marker.envd_sha256 != manifest.envd_sha256
        || marker.envd_desktop_sha256 != manifest.envd_desktop_sha256
    {
        return Err(format!(
            "{} does not match helper manifest for {role:?}",
            marker_path.display()
        ));
    }
    Ok(())
}

fn retain_rollback(
    current_dir: &Path,
    rollback_dir: &Path,
    app_support: &Path,
) -> Result<(), String> {
    verify_helper_dir(current_dir, HelperRole::Current)?;
    let temp_dir = app_support.join("rollback.retaining");
    let backup_dir = app_support.join("rollback.backup");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|err| format!("remove {}: {err}", temp_dir.display()))?;
    }
    copy_dir(current_dir, &temp_dir)?;
    verify_helper_dir(&temp_dir, HelperRole::InstallerRetainedRollback)?;
    replace_dir_with_backup(rollback_dir, &temp_dir, &backup_dir, false)
}

fn replace_dir_with_backup(
    current_dir: &Path,
    replacement_dir: &Path,
    backup_dir: &Path,
    fail_after_backup: bool,
) -> Result<(), String> {
    if backup_dir.exists() {
        fs::remove_dir_all(backup_dir)
            .map_err(|err| format!("remove {}: {err}", backup_dir.display()))?;
    }
    let had_current = current_dir.exists();
    if had_current {
        fs::rename(current_dir, backup_dir).map_err(|err| {
            format!(
                "backup {} to {}: {err}",
                current_dir.display(),
                backup_dir.display()
            )
        })?;
    }
    if fail_after_backup {
        if had_current {
            restore_backup_dir(current_dir, backup_dir)?;
        }
        return Err("injected replacement failure after verified backup".to_string());
    }
    match fs::rename(replacement_dir, current_dir) {
        Ok(()) => {
            if backup_dir.exists() {
                fs::remove_dir_all(backup_dir)
                    .map_err(|err| format!("remove {}: {err}", backup_dir.display()))?;
            }
            Ok(())
        }
        Err(err) => {
            if had_current {
                restore_backup_dir(current_dir, backup_dir)?;
            }
            Err(format!(
                "replace {} with {}: {err}",
                current_dir.display(),
                replacement_dir.display()
            ))
        }
    }
}

fn restore_backup_dir(current_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    if current_dir.exists() {
        fs::remove_dir_all(current_dir)
            .map_err(|err| format!("remove failed replacement {}: {err}", current_dir.display()))?;
    }
    fs::rename(backup_dir, current_dir).map_err(|err| {
        format!(
            "restore {} from {}: {err}",
            current_dir.display(),
            backup_dir.display()
        )
    })
}

fn run_runtime_probe(
    paths: &HostPaths,
    probe: &RuntimeProbe,
) -> Result<Option<RuntimeEvidence>, String> {
    match probe {
        RuntimeProbe::Skip => Ok(None),
        RuntimeProbe::Pass(start) => Ok(Some(RuntimeEvidence {
            start: (*start).to_string(),
            desktop_health: Check {
                state: CheckState::Pass,
                message: "Injected desktop health PASS; real macOS readback not claimed."
                    .to_string(),
                detail: None,
            },
            orphan_ffmpeg: Check {
                state: CheckState::Pass,
                message: "Injected orphan ffmpeg=0 PASS; real macOS readback not claimed."
                    .to_string(),
                detail: None,
            },
        })),
        RuntimeProbe::Fail(reason) => Err((*reason).to_string()),
        RuntimeProbe::Real => {
            start_launch_agent(paths).map_err(|result| result.message)?;
            let desktop_health = desktop_health_status();
            let orphan_ffmpeg = orphan_ffmpeg_status();
            if desktop_health.state != CheckState::Pass {
                return Err(format!(
                    "desktop health readback failed: {}",
                    desktop_health.message
                ));
            }
            if orphan_ffmpeg.state != CheckState::Pass {
                return Err(format!(
                    "orphan ffmpeg readback failed: {}",
                    orphan_ffmpeg.message
                ));
            }
            Ok(Some(RuntimeEvidence {
                start: "LaunchAgent start requested through launchctl.".to_string(),
                desktop_health,
                orphan_ffmpeg,
            }))
        }
    }
}

fn format_runtime_evidence(evidence: &RuntimeEvidence) -> String {
    format!(
        "Readback: start={}; desktop_health={:?} {}; orphan_ffmpeg={:?} {}.",
        evidence.start,
        evidence.desktop_health.state,
        evidence.desktop_health.message,
        evidence.orphan_ffmpeg.state,
        evidence.orphan_ffmpeg.message
    )
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|err| format!("{}: {err}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|err| format!("{}: {err}", from.display()))? {
        let entry = entry.map_err(|err| format!("{}: {err}", from.display()))?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let ty = entry
            .file_type()
            .map_err(|err| format!("{}: {err}", source.display()))?;
        if ty.is_dir() {
            copy_dir(&source, &target)?;
        } else if ty.is_file() {
            fs::copy(&source, &target).map_err(|err| {
                format!("copy {} to {}: {err}", source.display(), target.display())
            })?;
            fs::set_permissions(
                &target,
                fs::metadata(&source)
                    .map_err(|err| format!("{}: {err}", source.display()))?
                    .permissions(),
            )
            .map_err(|err| format!("chmod {}: {err}", target.display()))?;
        }
    }
    Ok(())
}

fn write_launch_agent(paths: &HostPaths) -> Result<(), String> {
    let launch_agent_path = Path::new(&paths.launch_agent_path);
    let parent = launch_agent_path
        .parent()
        .ok_or_else(|| format!("{} has no parent", launch_agent_path.display()))?;
    fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    let envd_path = Path::new(&paths.app_support_dir).join(ENVD_BIN);
    let out_path = Path::new(&paths.app_support_dir).join("host.out.log");
    let err_path = Path::new(&paths.app_support_dir).join("host.err.log");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{}</string>
  <key>StandardErrorPath</key>
  <string>{}</string>
</dict>
</plist>
"#,
        LAUNCH_AGENT_LABEL,
        xml_escape(&envd_path.to_string_lossy()),
        xml_escape(&out_path.to_string_lossy()),
        xml_escape(&err_path.to_string_lossy())
    );
    write_private_file(launch_agent_path, plist.as_bytes(), false)
}

fn start_launch_agent(paths: &HostPaths) -> Result<(), HostOperationResult> {
    if std::env::consts::OS != "macos" {
        return Ok(());
    }
    host_restart_preflight(paths)?;
    let uid = Command::new("id").arg("-u").output().map_err(|_| {
        fail_result(
            "uid_failed",
            "Could not read current macOS uid for launchctl.",
        )
    })?;
    let uid = String::from_utf8_lossy(&uid.stdout).trim().to_string();
    let domain = format!("gui/{uid}");
    let service = format!("{domain}/{LAUNCH_AGENT_LABEL}");
    let _ = Command::new("launchctl")
        .arg("bootout")
        .arg(&service)
        .status();
    let bootstrap = Command::new("launchctl")
        .arg("bootstrap")
        .arg(&domain)
        .arg(&paths.launch_agent_path)
        .status();
    match bootstrap {
        Ok(status) if status.success() => {}
        Ok(status) => {
            return Err(fail_result(
                "start_failed",
                &format!("launchctl bootstrap exited with {status}"),
            ));
        }
        Err(err) => {
            return Err(fail_result(
                "start_failed",
                &format!("launchctl bootstrap failed: {err}"),
            ));
        }
    }
    let kickstart = Command::new("launchctl")
        .arg("kickstart")
        .arg("-k")
        .arg(service)
        .status();
    match kickstart {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(fail_result(
            "start_failed",
            &format!("launchctl kickstart exited with {status}"),
        )),
        Err(err) => Err(fail_result(
            "start_failed",
            &format!("launchctl kickstart failed: {err}"),
        )),
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

fn write_private_file(path: &Path, bytes: &[u8], executable: bool) -> Result<(), String> {
    fs::write(path, bytes).map_err(|err| format!("{}: {err}", path.display()))?;
    set_private_permissions(path, executable)
}

#[cfg(unix)]
fn set_private_permissions(path: &Path, executable: bool) -> Result<(), String> {
    let mode = if executable { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|err| format!("chmod {}: {err}", path.display()))
}

#[cfg(not(unix))]
fn set_private_permissions(path: &Path, _executable: bool) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|err| format!("{}: {err}", path.display()))?
        .permissions();
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions).map_err(|err| format!("chmod {}: {err}", path.display()))
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("{} sha256 {actual} != {expected}", path.display()))
    }
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
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

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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
    fn helper_source_reports_unsupported_on_non_macos() {
        let status = helper_source_status_for_platform("linux", "x86_64");

        assert_eq!(status.state, CheckState::Unsupported);
        assert!(status.message.contains("macOS arm64"));
    }

    #[test]
    fn bundled_helper_source_rejects_manifest_mismatch() {
        let bad_manifest = BUNDLED_MANIFEST_JSON.replace(
            "69567766184162e6966ab624c61c725634b5bd87a3996454ed351ac2558168b0",
            "0000000000000000000000000000000000000000000000000000000000000000",
        );

        let err = parse_and_verify_bundled_helper(
            &bad_manifest,
            BUNDLED_ENVD_BYTES,
            BUNDLED_DESKTOP_BYTES,
        )
        .unwrap_err();

        assert!(err.contains("envd bytes do not match"));
    }

    #[test]
    fn bundled_helper_source_platform_matrix_is_fail_closed() {
        assert!(bundled_helper_supported_on("macos", "aarch64").is_ok());

        for (os, arch) in [
            ("linux", "x86_64"),
            ("linux", "aarch64"),
            ("windows", "x86_64"),
            ("macos", "x86_64"),
            ("freebsd", "aarch64"),
        ] {
            let err = bundled_helper_supported_on(os, arch).unwrap_err();
            assert!(
                err.contains(BUNDLED_PLATFORM),
                "missing platform in error for {os}/{arch}: {err}"
            );
        }

        assert_eq!(
            helper_source_status_for_platform("macos", "aarch64").state,
            CheckState::Pass
        );
        assert_eq!(
            helper_source_status_for_platform("linux", "x86_64").state,
            CheckState::Unsupported
        );
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
    fn install_writes_bundled_helper_and_launch_agent() {
        let home = unique_temp_dir("fractalmind-host-install");
        let paths = expected_paths(Some(home.clone()));

        let result = host_install_supported(Some(home));

        assert!(result.success, "{result:?}");
        assert_eq!(result.code, "installed");
        assert_eq!(helper_installed_status(&paths).state, CheckState::Pass);
        assert_eq!(launch_agent_identity_status(&paths).state, CheckState::Pass);
        let manifest =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        assert_eq!(manifest.version, BUNDLED_VERSION);
        assert_eq!(manifest.source_sha, BUNDLED_SOURCE_SHA);
    }

    #[test]
    fn unsupported_platform_install_rejects_before_filesystem_mutation() {
        for (os, arch) in [("linux", "x86_64"), ("windows", "x86_64")] {
            let home = unique_temp_dir(&format!("fractalmind-host-unsupported-{os}"));
            let paths = expected_paths(Some(home.clone()));

            let result = host_install_for_home_with_deps(
                Some(home),
                InstallDeps {
                    os,
                    arch,
                    fail_replacement_after_backup: false,
                    update_probe: RuntimeProbe::Skip,
                    rollback_probe: RuntimeProbe::Skip,
                },
            );

            assert!(!result.success, "{os}/{arch}: {result:?}");
            assert_eq!(result.code, "helper_bundle_unsupported");
            assert!(!Path::new(&paths.helper_dir).exists(), "{os}/{arch}");
            assert!(!Path::new(&paths.rollback_dir).exists(), "{os}/{arch}");
            assert!(
                !Path::new(&paths.app_support_dir)
                    .join(INSTALLED_MANIFEST)
                    .exists(),
                "{os}/{arch}"
            );
            assert!(
                !Path::new(&paths.helper_dir).join(RETAINED_MARKER).exists(),
                "{os}/{arch}"
            );
            assert!(!Path::new(&paths.launch_agent_path).exists(), "{os}/{arch}");
        }
    }

    #[test]
    fn update_retains_verified_rollback_before_replacing_current() {
        let home = unique_temp_dir("fractalmind-host-update");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write_launch_agent(&paths);

        let result = host_install_supported(Some(home));

        assert!(result.success, "{result:?}");
        assert_eq!(result.code, "updated");
        let current =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        let rollback =
            read_manifest(&Path::new(&paths.rollback_dir).join("manifest.json")).unwrap();
        assert_eq!(current.version, BUNDLED_VERSION);
        assert_eq!(rollback.version, "old-good");
        assert_eq!(
            verify_helper_dir(
                Path::new(&paths.rollback_dir),
                HelperRole::InstallerRetainedRollback,
            )
            .unwrap()
            .version,
            "old-good"
        );
    }

    #[test]
    fn replacement_failure_restores_existing_current_helper() {
        let home = unique_temp_dir("fractalmind-host-replace-fail");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write_launch_agent(&paths);

        let result = host_install_for_home_with_deps(
            Some(home),
            InstallDeps {
                os: "macos",
                arch: "aarch64",
                fail_replacement_after_backup: true,
                update_probe: RuntimeProbe::Skip,
                rollback_probe: RuntimeProbe::Skip,
            },
        );

        assert!(!result.success);
        assert_eq!(result.code, "install_failed");
        assert!(result.message.contains("injected replacement failure"));
        let current =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        assert_eq!(current.version, "old-good");
        assert_eq!(helper_installed_status(&paths).state, CheckState::Pass);
    }

    #[test]
    fn failed_update_readback_restores_retained_helper_and_reports_evidence() {
        let home = unique_temp_dir("fractalmind-host-update-readback-fail");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write_launch_agent(&paths);

        let result = host_install_for_home_with_deps(
            Some(home),
            InstallDeps {
                os: "macos",
                arch: "aarch64",
                fail_replacement_after_backup: false,
                update_probe: RuntimeProbe::Fail("desktop health failed after update"),
                rollback_probe: RuntimeProbe::Pass("rollback launch injected"),
            },
        );

        assert!(!result.success);
        assert_eq!(result.code, "install_failed");
        assert!(result.message.contains("post-update validation failed"));
        assert!(result.message.contains("restored retained helper old-good"));
        assert!(result.message.contains("desktop_health=Pass"));
        assert!(result.message.contains("orphan_ffmpeg=Pass"));
        let current =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        assert_eq!(current.version, "old-good");
        assert_eq!(helper_installed_status(&paths).state, CheckState::Pass);
    }

    #[test]
    fn failed_update_reports_rollback_readback_failure() {
        let home = unique_temp_dir("fractalmind-host-update-rollback-fail");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write_launch_agent(&paths);

        let result = host_install_for_home_with_deps(
            Some(home),
            InstallDeps {
                os: "macos",
                arch: "aarch64",
                fail_replacement_after_backup: false,
                update_probe: RuntimeProbe::Fail("desktop health failed after update"),
                rollback_probe: RuntimeProbe::Fail("rollback health failed"),
            },
        );

        assert!(!result.success);
        assert_eq!(result.code, "install_failed");
        assert!(result.message.contains("automatic rollback failed"));
        assert!(result.message.contains("rollback health failed"));
    }

    #[test]
    fn install_rejects_tampered_existing_helper_before_update() {
        let home = unique_temp_dir("fractalmind-host-update-tampered");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write(
            Path::new(&paths.app_support_dir).join(ENVD_BIN),
            b"tampered",
        )
        .unwrap();

        let result = host_install_supported(Some(home));

        assert!(!result.success);
        assert_eq!(result.code, "install_failed");
        assert!(result.message.contains("sha256"));
    }

    #[test]
    fn helper_verification_rejects_missing_trust_marker() {
        let home = unique_temp_dir("fractalmind-host-marker-missing");
        let paths = expected_paths(Some(home));
        write_test_helper_dir(Path::new(&paths.helper_dir), "test", b"envd", b"desktop");
        fs::remove_file(Path::new(&paths.helper_dir).join(RETAINED_MARKER)).unwrap();

        let status = helper_installed_status(&paths);

        assert_eq!(status.state, CheckState::Fail);
        assert!(status.detail.unwrap().contains(RETAINED_MARKER));
    }

    #[test]
    fn helper_verification_rejects_tampered_manifest_and_binary_pair() {
        let home = unique_temp_dir("fractalmind-host-manifest-binary-tampered");
        let paths = expected_paths(Some(home));
        write_test_helper_dir(Path::new(&paths.helper_dir), "test", b"envd", b"desktop");
        let envd_path = Path::new(&paths.app_support_dir).join(ENVD_BIN);
        let desktop_path = Path::new(&paths.app_support_dir).join(DESKTOP_BIN);
        write(&envd_path, b"replacement-envd").unwrap();
        write(&desktop_path, b"replacement-desktop").unwrap();
        let mut manifest =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        manifest.envd_sha256 = sha256_file(&envd_path).unwrap();
        manifest.envd_desktop_sha256 = sha256_file(&desktop_path).unwrap();
        write(
            Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let status = helper_installed_status(&paths);

        assert_eq!(status.state, CheckState::Fail);
        assert!(status
            .detail
            .unwrap()
            .contains("does not match helper manifest"));
    }

    #[test]
    fn rollback_restores_verified_retained_helper() {
        let home = unique_temp_dir("fractalmind-host-rollback");
        let paths = expected_paths(Some(home.clone()));
        write_test_helper_dir(
            Path::new(&paths.helper_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        assert!(host_install_supported(Some(home.clone())).success);
        write(
            Path::new(&paths.app_support_dir).join(ENVD_BIN),
            b"broken-current",
        )
        .unwrap();

        let result = host_rollback_for_home(Some(home), false);

        assert!(result.success, "{result:?}");
        assert_eq!(result.code, "rolled_back");
        let current =
            read_manifest(&Path::new(&paths.app_support_dir).join(INSTALLED_MANIFEST)).unwrap();
        assert_eq!(current.version, "old-good");
        assert_eq!(helper_installed_status(&paths).state, CheckState::Pass);
    }

    #[test]
    fn rollback_rejects_missing_or_tampered_retained_helper() {
        let home = unique_temp_dir("fractalmind-host-rollback-missing");
        let paths = expected_paths(Some(home.clone()));
        let missing = host_rollback_for_home(Some(home.clone()), false);
        assert!(!missing.success);
        assert_eq!(missing.code, "rollback_failed");

        write_test_helper_dir(
            Path::new(&paths.rollback_dir),
            "old-good",
            b"old-envd",
            b"old-desktop",
        );
        write(
            Path::new(&paths.rollback_dir).join("envd-desktop"),
            b"tampered",
        )
        .unwrap();

        let tampered = host_rollback_for_home(Some(home), false);

        assert!(!tampered.success);
        assert_eq!(tampered.code, "rollback_failed");
        assert!(tampered.message.contains("sha256"));
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
        write_test_helper_dir(Path::new(&paths.helper_dir), "test", b"envd", b"desktop");
    }

    fn host_install_supported(home: Option<PathBuf>) -> HostOperationResult {
        host_install_for_home_with_deps(
            home,
            InstallDeps {
                os: "macos",
                arch: "aarch64",
                fail_replacement_after_backup: false,
                update_probe: RuntimeProbe::Skip,
                rollback_probe: RuntimeProbe::Skip,
            },
        )
    }

    fn write_test_helper_dir(dir: &Path, version: &str, envd: &[u8], desktop: &[u8]) {
        let manifest = test_manifest(version, envd, desktop);
        write_helper_dir(dir, &manifest, envd, desktop).unwrap();
    }

    fn test_manifest(version: &str, envd: &[u8], desktop: &[u8]) -> HelperManifest {
        HelperManifest {
            schema_version: 1,
            version: version.to_string(),
            platform: BUNDLED_PLATFORM.to_string(),
            source_repo: TRUSTED_SOURCE_REPO.to_string(),
            source_sha: BUNDLED_SOURCE_SHA.to_string(),
            source_ref: "test".to_string(),
            build_toolchain: "test".to_string(),
            build_commands: vec!["test".to_string()],
            envd_sha256: sha256_bytes(envd),
            envd_desktop_sha256: sha256_bytes(desktop),
            repeat_build_verified: true,
            historical_deployed_desktop_sha256:
                "a5c1dff7a1b34ef8999cae70c26c8daac3f9113a60396c1f0d32cbd341340f9d".to_string(),
            rollback_identity: "test rollback identity".to_string(),
            excluded_default_sources: Vec::new(),
        }
    }

    fn write_launch_agent(paths: &HostPaths) {
        create_dir_all(Path::new(&paths.launch_agent_path).parent().unwrap()).unwrap();
        super::write_launch_agent(paths).unwrap();
    }
}
