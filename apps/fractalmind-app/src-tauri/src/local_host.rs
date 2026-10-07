//! This computer as the organization's Host + Coordinator (#64). The App runs
//! its bundled envd as a per-user background service. Only public chain
//! configuration is written to disk; Host keys stay in envd's OS credential
//! store entry, and a one-use invitation reaches envd through stdin only.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use zeroize::Zeroizing;

pub const FIRST_PORT: u16 = 7443;
const PORT_SPAN: u16 = 20;
const NETWORKS: [&str; 4] = ["localnet", "devnet", "testnet", "mainnet"];
/// Gas ceilings in MIST, not charges. The setup transaction funds the Host with
/// enough to cover both, since the Host signs its own join and result receipts.
pub const JOIN_GAS_BUDGET: u64 = 30_000_000;
pub const RESULT_GAS_BUDGET: u64 = 50_000_000;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chain {
    pub network: String,
    pub rpc_url: String,
    pub chain_identifier: String,
    pub package_id: String,
    pub original_package_id: String,
    pub okr_package_id: String,
    pub original_okr_package_id: String,
    pub direct_package_id: String,
    pub original_direct_package_id: String,
    pub registry_id: String,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Organization {
    pub organization_id: String,
    pub binding_id: String,
    pub host_name: String,
    pub port: u16,
}
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recorded {
    pub network: String,
    pub organization_id: String,
    pub binding_id: String,
    pub host_name: String,
    pub port: u16,
    pub endpoint: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub supported: bool,
    pub envd_available: bool,
    pub configured: Option<Recorded>,
    pub service: &'static str,
    pub pid: Option<u32>,
    /// The configured Coordinator port accepts connections on loopback.
    pub listening: bool,
    /// The installed service definition matches this App's (envd build,
    /// paths, environment); false after an App update until reinstalled.
    pub service_current: bool,
    pub config_path: String,
    pub log_path: String,
    pub workspace_path: String,
    pub default_host_name: String,
    pub suggested_port: Option<u16>,
}

fn valid_profile(profile: &str) -> bool {
    let b = profile.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}
fn object_id(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..]
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn chain_identifier(value: &str) -> bool {
    (32..=44).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() && !b"0OIl".contains(&c))
}
fn rpc_url(value: &str) -> bool {
    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && match url.scheme() {
            "https" => url.host_str().is_some(),
            "http" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
            _ => false,
        }
}
fn host_name(value: &str) -> bool {
    let n = value.chars().count();
    (1..=64).contains(&n) && !value.chars().any(char::is_control) && value.trim() == value
}
impl Chain {
    fn validate(&self) -> Result<(), String> {
        let ids = [
            &self.package_id,
            &self.original_package_id,
            &self.okr_package_id,
            &self.original_okr_package_id,
            &self.direct_package_id,
            &self.original_direct_package_id,
            &self.registry_id,
        ];
        if !NETWORKS.contains(&self.network.as_str())
            || !rpc_url(&self.rpc_url)
            || !chain_identifier(&self.chain_identifier)
            || !ids.iter().all(|id| object_id(id))
        {
            return Err("InvalidLocalHostConfig".into());
        }
        Ok(())
    }
}
pub fn endpoint(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}
fn port_allowed(port: u16) -> bool {
    (FIRST_PORT..FIRST_PORT + PORT_SPAN).contains(&port)
}
fn q(value: &str) -> String {
    // JSON strings are valid YAML double-quoted scalars.
    serde_json::to_string(value).expect("string serializes")
}
fn hex_of(value: Option<&serde_json::Value>, len: usize) -> bool {
    value.and_then(|v| v.as_str()).is_some_and(|s| {
        s.len() == len
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}
/// envd's `--init-host` output: this profile's address and 32-byte keys.
fn valid_public(value: &serde_json::Value, profile: &str) -> bool {
    value.get("profile").and_then(|p| p.as_str()) == Some(profile)
        && value
            .get("host_address")
            .and_then(|a| a.as_str())
            .is_some_and(|a| {
                a.starts_with("0x") && hex_of(Some(&serde_json::Value::String(a[2..].into())), 64)
            })
        && hex_of(value.get("signing_public_key"), 64)
        && hex_of(value.get("encryption_public_key"), 64)
}
pub fn key_profile(profile: &str) -> String {
    format!("app-{profile}")
}

/// Before an organization exists, only the key profile is needed (`--init-host`).
pub fn render_keys_config(profile: &str, network: &str) -> String {
    format!(
        "# Generated by the FractalMind App. Public configuration only.\nidentity:\n  key_profile: {}\nsui:\n  network: {}\n",
        q(&key_profile(profile)),
        q(network)
    )
}
pub fn render_config(profile: &str, chain: &Chain, org: &Organization, workspace: &Path) -> String {
    let lines = [
        "# Generated by the FractalMind App for this computer's Host and Coordinator.".to_string(),
        "# Public configuration only: keys stay in the system credential store.".into(),
        "identity:".into(),
        format!("  key_profile: {}", q(&key_profile(profile))),
        format!("  hostname: {}", q(&org.host_name)),
        "roles:".into(),
        "  coordinator: true".into(),
        "  sponsor: false".into(),
        "  relay: false".into(),
        "  stun_server: false".into(),
        "coordinator:".into(),
        format!("  binding_id: {}", q(&org.binding_id)),
        format!("  listen_addr: {}", q(&format!("127.0.0.1:{}", org.port))),
        "sui:".into(),
        "  enabled: true".into(),
        "  host_connection_enabled: true".into(),
        format!("  network: {}", q(&chain.network)),
        format!("  rpc: {}", q(&chain.rpc_url)),
        format!("  chain_identifier: {}", q(&chain.chain_identifier)),
        format!("  protocol_package_id: {}", q(&chain.package_id)),
        format!(
            "  protocol_original_package_id: {}",
            q(&chain.original_package_id)
        ),
        format!("  okr_package_id: {}", q(&chain.okr_package_id)),
        format!(
            "  okr_original_package_id: {}",
            q(&chain.original_okr_package_id)
        ),
        format!("  direct_package_id: {}", q(&chain.direct_package_id)),
        format!(
            "  direct_original_package_id: {}",
            q(&chain.original_direct_package_id)
        ),
        format!("  protocol_registry_id: {}", q(&chain.registry_id)),
        format!("  org_id: {}", q(&org.organization_id)),
        format!("  host_join_gas_budget: {JOIN_GAS_BUDGET}"),
        "runtime:".into(),
        "  enabled: true".into(),
        "  adapter_kind: native-file-agent".into(),
        "  workspaces:".into(),
        format!("    files: {}", q(&workspace.to_string_lossy())),
        format!("  result_gas_budget: {RESULT_GAS_BUDGET}"),
        "  chain_queue: true".into(),
    ];
    lines.join("\n") + "\n"
}

/// Every path this computer's Host uses. Built from the App's directories by
/// the Tauri commands, or explicitly by the acceptance helper.
pub struct Layout {
    pub profile: String,
    pub config: PathBuf,
    pub record: PathBuf,
    /// Host public keys saved on first creation, so the App never needs the
    /// credential store (and its OS prompt) just to know the Host address.
    pub public: PathBuf,
    pub workspace: PathBuf,
    pub log: PathBuf,
    pub label: String,
    /// launchd plist / systemd unit; unused for the Windows task.
    pub service_file: PathBuf,
    pub envd: Option<PathBuf>,
    pub home: PathBuf,
}
impl Layout {
    /// `data` holds the per-profile configuration; `home` the user's home.
    pub fn new(
        profile: &str,
        data: &Path,
        home: &Path,
        config_dir: &Path,
        envd: Option<PathBuf>,
    ) -> Result<Self, String> {
        if !valid_profile(profile) {
            return Err("InvalidProfile".into());
        }
        let root = data.join("local-host").join(profile);
        let label = format!("org.fractalmind.envd.{profile}");
        #[cfg(target_os = "macos")]
        let (log, service_file) = (
            home.join("Library/Logs/FractalMind")
                .join(format!("envd-{profile}.log")),
            home.join("Library/LaunchAgents")
                .join(format!("{label}.plist")),
        );
        #[cfg(not(target_os = "macos"))]
        let (log, service_file) = (
            root.join("envd.log"),
            config_dir
                .join("systemd/user")
                .join(format!("{label}.service")),
        );
        let _ = config_dir;
        Ok(Layout {
            profile: profile.into(),
            config: root.join("sentinel.yaml"),
            record: root.join("local-host.json"),
            public: root.join("host-public.json"),
            workspace: root.join("workspace"),
            log,
            label,
            service_file,
            envd,
            home: home.to_path_buf(),
        })
    }
    fn envd(&self) -> Result<&Path, String> {
        self.envd.as_deref().ok_or_else(|| "EnvdUnavailable".into())
    }
    pub fn record(&self) -> Option<Recorded> {
        serde_json::from_slice(&fs::read(&self.record).ok()?).ok()
    }
    pub fn status(&self, suggested_port: Option<u16>) -> Status {
        let configured = self.record();
        let (service, pid) = if SUPPORTED {
            service::status(self)
        } else {
            ("unsupported", None)
        };
        Status {
            supported: SUPPORTED,
            envd_available: self.envd.is_some(),
            suggested_port: configured.as_ref().map(|r| r.port).or(suggested_port),
            listening: configured.as_ref().is_some_and(|r| {
                std::net::TcpStream::connect_timeout(
                    &std::net::SocketAddr::from(([127, 0, 0, 1], r.port)),
                    Duration::from_millis(300),
                )
                .is_ok()
            }),
            service_current: self.service_current(),
            configured,
            service,
            pid,
            config_path: self.config.to_string_lossy().into(),
            log_path: self.log.to_string_lossy().into(),
            workspace_path: self.workspace.to_string_lossy().into(),
            default_host_name: default_host_name(),
        }
    }
    /// The service file this App would install now.
    pub fn service_definition(&self) -> Option<String> {
        let envd = self.envd.as_deref()?;
        let env = service_env(&self.home, envd);
        #[cfg(target_os = "macos")]
        return Some(launchd_plist(
            &self.label,
            envd,
            &self.config,
            &self.log,
            &env,
        ));
        #[cfg(not(target_os = "macos"))]
        return Some(systemd_unit(envd, &self.config, &self.log, &env));
    }
    fn service_current(&self) -> bool {
        if cfg!(target_os = "windows") {
            return true;
        }
        match (
            self.service_definition(),
            fs::read_to_string(&self.service_file),
        ) {
            (Some(want), Ok(have)) => want == have,
            _ => false,
        }
    }
    /// Creates (or reads) this profile's Host keys through envd. Returns only
    /// public keys and the address.
    pub fn keys(&self, network: &str) -> Result<serde_json::Value, String> {
        if !SUPPORTED {
            return Err("LocalHostUnsupported".into());
        }
        if !NETWORKS.contains(&network) {
            return Err("InvalidLocalHostConfig".into());
        }
        if let Some(r) = self.record() {
            if r.network != network {
                return Err("LocalHostNetworkMismatch".into());
            }
        } else {
            write_private(
                &self.config,
                render_keys_config(&self.profile, network).as_bytes(),
            )?;
        }
        if let Some(public) = self.cached_public() {
            return Ok(public);
        }
        // Only the first time: envd creates (or reads) the keys, which the OS
        // may ask the person to allow. The background service then reads
        // them once per start; the App reads only the saved public part.
        let config = self.config.to_string_lossy().to_string();
        let out = run_envd(
            self.envd()?,
            &["--config", &config, "--init-host"],
            None,
            Duration::from_secs(60),
        )?
        .ok()?;
        let public = last_json(&out)?;
        if !valid_public(&public, &key_profile(&self.profile)) {
            return Err("EnvdOutputInvalid".into());
        }
        write_private(
            &self.public,
            &serde_json::to_vec_pretty(&public).map_err(|_| "LocalHostUnavailable")?,
        )?;
        Ok(public)
    }
    fn cached_public(&self) -> Option<serde_json::Value> {
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&self.public).ok()?).ok()?;
        valid_public(&value, &key_profile(&self.profile)).then_some(value)
    }
    /// Writes the full public configuration once the chain binding exists.
    pub fn configure(
        &self,
        chain: &Chain,
        organization: &Organization,
    ) -> Result<Recorded, String> {
        if !SUPPORTED {
            return Err("LocalHostUnsupported".into());
        }
        chain.validate()?;
        if !object_id(&organization.organization_id)
            || !object_id(&organization.binding_id)
            || !host_name(&organization.host_name)
            || !port_allowed(organization.port)
        {
            return Err("InvalidLocalHostConfig".into());
        }
        let record = Recorded {
            network: chain.network.clone(),
            organization_id: organization.organization_id.clone(),
            binding_id: organization.binding_id.clone(),
            host_name: organization.host_name.clone(),
            port: organization.port,
            endpoint: endpoint(organization.port),
        };
        if let Some(existing) = self.record() {
            if existing.network != record.network
                || existing.organization_id != record.organization_id
            {
                return Err("LocalHostAlreadyConfigured".into());
            }
        }
        fs::create_dir_all(&self.workspace).map_err(|_| "LocalHostUnavailable")?;
        write_private(
            &self.config,
            render_config(&self.profile, chain, organization, &self.workspace).as_bytes(),
        )?;
        write_private(
            &self.record,
            &serde_json::to_vec_pretty(&record).map_err(|_| "LocalHostUnavailable")?,
        )?;
        Ok(record)
    }
    /// Redeems the one-use invitation as this Host. The invitation is written
    /// to envd's stdin and zeroized; envd joins only when the chain plan
    /// matches the configured organization, binding, Host key and loopback
    /// endpoint. Without one, envd reconciles an original attempt only.
    pub fn join(
        &self,
        invitation: Option<Zeroizing<Vec<u8>>>,
        new_attempt: bool,
    ) -> Result<serde_json::Value, String> {
        if self.record().is_none() {
            return Err("LocalHostNotConfigured".into());
        }
        let mut input = Zeroizing::new(Vec::with_capacity(258));
        if let Some(code) = invitation {
            if code.is_empty() || code.len() > 256 || code.contains(&b'\n') {
                return Err("InvalidInvitation".into());
            }
            input.extend_from_slice(&code);
            input.push(b'\n');
        }
        let config = self.config.to_string_lossy().to_string();
        let mut args = vec!["--config", config.as_str(), "--app-join-host"];
        if new_attempt {
            args.push("--new-host-join-attempt");
        }
        let run = run_envd(self.envd()?, &args, Some(input), Duration::from_secs(180))?;
        // envd prints its join result (state, digest) before reporting an
        // error such as a lagging membership read; the result is what counts.
        match last_json(&run.stdout) {
            Ok(result) if result.get("state").is_some() => Ok(result),
            _ => Err(run.ok().err().unwrap_or_else(|| "EnvdOutputInvalid".into())),
        }
    }
    pub fn service(&self, action: &str) -> Result<(), String> {
        if !SUPPORTED {
            return Err("LocalHostUnsupported".into());
        }
        match action {
            "install" | "start" if self.record().is_none() => Err("LocalHostNotConfigured".into()),
            "install" => service::install(self, self.envd()?),
            "start" => service::start(self),
            "stop" => service::stop(self),
            _ => Err("InvalidAction".into()),
        }
    }
    /// Stops and removes the service, deletes the Host keys from the
    /// credential store and the generated configuration. The workspace stays.
    pub fn uninstall(&self) -> Result<(), String> {
        if !SUPPORTED {
            return Err("LocalHostUnsupported".into());
        }
        service::uninstall(self)?;
        if self.config.is_file() {
            let config = self.config.to_string_lossy().to_string();
            run_envd(
                self.envd()?,
                &["--config", &config, "--remove-host-keys"],
                None,
                Duration::from_secs(60),
            )?
            .ok()?;
        }
        for path in [&self.record, &self.config, &self.public] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("LocalHostUnavailable".into()),
            }
        }
        Ok(())
    }
}
/// The bundled sidecar sits next to the App binary.
pub fn bundled_envd() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let path = exe
        .parent()?
        .join(format!("fractalmind-envd{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}
fn layout(app: &AppHandle, profile: &str) -> Result<Layout, String> {
    let path = app.path();
    Layout::new(
        profile,
        &path.app_data_dir().map_err(|_| "LocalHostUnavailable")?,
        &path.home_dir().map_err(|_| "LocalHostUnavailable")?,
        &path.config_dir().map_err(|_| "LocalHostUnavailable")?,
        bundled_envd(),
    )
}
fn write_private(path: &Path, content: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("LocalHostUnavailable")?;
    fs::create_dir_all(dir).map_err(|_| "LocalHostUnavailable")?;
    let tmp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(|_| "LocalHostUnavailable")?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|_| "LocalHostUnavailable")?;
    fs::rename(&tmp, path).map_err(|_| "LocalHostUnavailable".into())
}

/// Runs envd once with bounded output. Stdin, when given, is written then
/// closed; it is the only path for an invitation and is zeroized afterwards.
fn run_envd(
    envd: &Path,
    args: &[&str],
    stdin: Option<Zeroizing<Vec<u8>>>,
    timeout: Duration,
) -> Result<Run, String> {
    let mut child = Command::new(envd)
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "EnvdUnavailable")?;
    if let Some(input) = stdin {
        let mut pipe = child.stdin.take().ok_or("EnvdUnavailable")?;
        pipe.write_all(&input).map_err(|_| "EnvdUnavailable")?;
    }
    let mut stdout = child.stdout.take().ok_or("EnvdUnavailable")?;
    let mut stderr = child.stderr.take().ok_or("EnvdUnavailable")?;
    let out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stdout).take(1 << 20).read_to_end(&mut buf);
        buf
    });
    let err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stderr).take(1 << 16).read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "EnvdUnavailable")? {
            break status;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("EnvdTimeout".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let stdout =
        String::from_utf8(out.join().unwrap_or_default()).map_err(|_| "EnvdOutputInvalid")?;
    let stderr = err.join().unwrap_or_default();
    // envd never prints secrets; keep only its last diagnostic line.
    let text = String::from_utf8_lossy(&stderr);
    let line: String = text
        .lines()
        .last()
        .unwrap_or("")
        .trim()
        .chars()
        .take(300)
        .collect();
    Ok(Run {
        success: status.success(),
        stdout,
        diagnostic: format!("EnvdFailed: {line}"),
    })
}
struct Run {
    success: bool,
    stdout: String,
    diagnostic: String,
}
impl Run {
    fn ok(self) -> Result<String, String> {
        if self.success {
            Ok(self.stdout)
        } else {
            Err(self.diagnostic)
        }
    }
}
fn last_json(output: &str) -> Result<serde_json::Value, String> {
    output
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| "EnvdOutputInvalid".into())
}
fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}
/// Ports already recorded by other profiles stay reserved even while stopped,
/// because the chain binding fixes each profile's endpoint.
pub fn suggest_port(data: &Path, profile: &str) -> Option<u16> {
    let mut taken = Vec::new();
    if let Ok(entries) = fs::read_dir(data.join("local-host")) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy() == profile {
                continue;
            }
            if let Ok(bytes) = fs::read(entry.path().join("local-host.json")) {
                if let Ok(r) = serde_json::from_slice::<Recorded>(&bytes) {
                    taken.push(r.port);
                }
            }
        }
    }
    (FIRST_PORT..FIRST_PORT + PORT_SPAN).find(|p| !taken.contains(p) && port_free(*p))
}
fn default_host_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
    {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && host_name(&name) {
            return name;
        }
    }
    let name = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_default();
    if host_name(&name) {
        name
    } else {
        "This computer".into()
    }
}

// ---- Per-user service definitions (pure, unit tested on every platform) ----

fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
/// Login services start with a minimal PATH; envd and the Agents it observes
/// or starts need tmux, Homebrew and user-local CLIs (codex, claude).
pub fn service_path(home: &Path) -> String {
    let home = home.to_string_lossy();
    format!("{home}/.local/bin:{home}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
}
/// PATH plus a stamp of the envd build, so an App update that ships a new
/// envd makes the installed definition out of date and gets reinstalled.
pub fn service_env(home: &Path, envd: &Path) -> String {
    let stamp = fs::metadata(envd)
        .ok()
        .map(|m| {
            let modified = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{}-{modified}", m.len())
        })
        .unwrap_or_default();
    format!("{}\u{0}{stamp}", service_path(home))
}
pub fn launchd_plist(label: &str, envd: &Path, config: &Path, log: &Path, env: &str) -> String {
    let (path, stamp) = env.split_once('\u{0}').unwrap_or((env, ""));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array><string>{envd}</string><string>--config</string><string>{config}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>{path}</string><key>LANG</key><string>en_US.UTF-8</string><key>FM_ENVD_BUILD</key><string>{stamp}</string></dict>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
        label = xml(label),
        envd = xml(&envd.to_string_lossy()),
        config = xml(&config.to_string_lossy()),
        log = xml(&log.to_string_lossy()),
        path = xml(path),
        stamp = xml(stamp),
    )
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn systemd_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
    )
}
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn systemd_unit(envd: &Path, config: &Path, log: &Path, env: &str) -> String {
    let (path, stamp) = env.split_once('\u{0}').unwrap_or((env, ""));
    format!(
        "[Unit]\nDescription=FractalMind Host and Coordinator\nAfter=network-online.target\n\n[Service]\nEnvironment={} {}\nExecStart={} --config {}\nRestart=always\nRestartSec=10\nStandardOutput=append:{}\nStandardError=append:{}\n\n[Install]\nWantedBy=default.target\n",
        systemd_quote(&format!("PATH={path}")),
        systemd_quote(&format!("FM_ENVD_BUILD={stamp}")),
        systemd_quote(&envd.to_string_lossy()),
        systemd_quote(&config.to_string_lossy()),
        log.to_string_lossy(),
        log.to_string_lossy()
    )
}
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn windows_task_command(envd: &Path, config: &Path) -> String {
    format!(
        "\"{}\" --config \"{}\"",
        envd.to_string_lossy(),
        config.to_string_lossy()
    )
}

#[cfg(target_os = "macos")]
mod service {
    use super::*;
    fn uid() -> Result<String, String> {
        let out = Command::new("/usr/bin/id")
            .arg("-u")
            .output()
            .map_err(|_| "ServiceUnavailable")?;
        let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !uid.is_empty() && uid.bytes().all(|c| c.is_ascii_digit()) {
            Ok(uid)
        } else {
            Err("ServiceUnavailable".into())
        }
    }
    fn launchctl(args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new("/bin/launchctl").args(args).output()
    }
    pub fn status(layout: &Layout) -> (&'static str, Option<u32>) {
        if !layout.service_file.is_file() {
            return ("not_installed", None);
        }
        let Ok(uid) = uid() else {
            return ("unknown", None);
        };
        match launchctl(&["print", &format!("gui/{uid}/{}", layout.label)]) {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                let pid = text
                    .lines()
                    .find_map(|l| l.trim().strip_prefix("pid = "))
                    .and_then(|p| p.trim().parse().ok());
                let running = text.lines().any(|l| l.trim() == "state = running");
                (if running { "running" } else { "starting" }, pid)
            }
            Ok(_) => ("stopped", None),
            Err(_) => ("unknown", None),
        }
    }
    pub fn install(layout: &Layout, envd: &Path) -> Result<(), String> {
        if let Some(dir) = layout.log.parent() {
            fs::create_dir_all(dir).map_err(|_| "ServiceUnavailable")?;
        }
        let content = launchd_plist(
            &layout.label,
            envd,
            &layout.config,
            &layout.log,
            &service_env(&layout.home, envd),
        );
        fs::create_dir_all(layout.service_file.parent().ok_or("ServiceUnavailable")?)
            .map_err(|_| "ServiceUnavailable")?;
        fs::write(&layout.service_file, content).map_err(|_| "ServiceUnavailable")?;
        // Reload so a new binary or configuration takes effect.
        stop(layout)?;
        start(layout)
    }
    pub fn start(layout: &Layout) -> Result<(), String> {
        if !layout.service_file.is_file() {
            return Err("ServiceNotInstalled".into());
        }
        let uid = uid()?;
        let target = format!("gui/{uid}/{}", layout.label);
        let _ = launchctl(&["enable", &target]);
        if launchctl(&["print", &target])
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let _ = launchctl(&["kickstart", &target]);
            return Ok(());
        }
        let out = launchctl(&[
            "bootstrap",
            &format!("gui/{uid}"),
            &layout.service_file.to_string_lossy(),
        ])
        .map_err(|_| "ServiceUnavailable")?;
        if out.status.success() {
            Ok(())
        } else {
            Err("ServiceStartFailed".into())
        }
    }
    /// Stopping also disables, so the service stays off after the next login.
    pub fn stop(layout: &Layout) -> Result<(), String> {
        let uid = uid()?;
        let target = format!("gui/{uid}/{}", layout.label);
        let _ = launchctl(&["bootout", &target]);
        let _ = launchctl(&["disable", &target]);
        // bootout returns while the job may still be shutting down; a start
        // in that window would only kickstart a job that is about to vanish.
        for _ in 0..100 {
            if !launchctl(&["print", &target])
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("ServiceStopTimeout".into())
    }
    pub fn uninstall(layout: &Layout) -> Result<(), String> {
        stop(layout)?;
        match fs::remove_file(&layout.service_file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("ServiceUnavailable".into()),
        }
        // Clear the disabled override so a later setup starts normally.
        let _ = launchctl(&["enable", &format!("gui/{}/{}", uid()?, layout.label)]);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod service {
    use super::*;
    fn systemctl(args: &[&str]) -> Result<bool, String> {
        Command::new("systemctl")
            .arg("--user")
            .args(args)
            .output()
            .map(|o| o.status.success())
            .map_err(|_| "ServiceUnavailable".into())
    }
    fn name(layout: &Layout) -> String {
        format!("{}.service", layout.label)
    }
    pub fn status(layout: &Layout) -> (&'static str, Option<u32>) {
        if !layout.service_file.is_file() {
            return ("not_installed", None);
        }
        match systemctl(&["is-active", "--quiet", &name(layout)]) {
            Ok(true) => ("running", None),
            Ok(false) => ("stopped", None),
            Err(_) => ("unknown", None),
        }
    }
    pub fn install(layout: &Layout, envd: &Path) -> Result<(), String> {
        fs::create_dir_all(layout.service_file.parent().ok_or("ServiceUnavailable")?)
            .map_err(|_| "ServiceUnavailable")?;
        fs::write(
            &layout.service_file,
            systemd_unit(
                envd,
                &layout.config,
                &layout.log,
                &service_env(&layout.home, envd),
            ),
        )
        .map_err(|_| "ServiceUnavailable")?;
        systemctl(&["daemon-reload"])?;
        if systemctl(&["enable", &name(layout)])? && systemctl(&["restart", &name(layout)])? {
            Ok(())
        } else {
            Err("ServiceStartFailed".into())
        }
    }
    pub fn start(layout: &Layout) -> Result<(), String> {
        if systemctl(&["enable", "--now", &name(layout)])? {
            Ok(())
        } else {
            Err("ServiceStartFailed".into())
        }
    }
    pub fn stop(layout: &Layout) -> Result<(), String> {
        systemctl(&["disable", "--now", &name(layout)])?;
        Ok(())
    }
    pub fn uninstall(layout: &Layout) -> Result<(), String> {
        stop(layout)?;
        let _ = fs::remove_file(&layout.service_file);
        systemctl(&["daemon-reload"])?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod service {
    use super::*;
    fn task(layout: &Layout) -> String {
        format!("FractalMind\\{}", layout.label)
    }
    fn schtasks(args: &[&str]) -> Result<std::process::Output, String> {
        Command::new("schtasks")
            .args(args)
            .output()
            .map_err(|_| "ServiceUnavailable".into())
    }
    pub fn status(layout: &Layout) -> (&'static str, Option<u32>) {
        match schtasks(&["/Query", "/TN", &task(layout), "/FO", "CSV", "/NH"]) {
            Ok(o) if o.status.success() => {
                if String::from_utf8_lossy(&o.stdout).contains("\"Running\"") {
                    ("running", None)
                } else {
                    ("stopped", None)
                }
            }
            Ok(_) => ("not_installed", None),
            Err(_) => ("unknown", None),
        }
    }
    pub fn install(layout: &Layout, envd: &Path) -> Result<(), String> {
        let command = windows_task_command(envd, &layout.config);
        let o = schtasks(&[
            "/Create",
            "/TN",
            &task(layout),
            "/TR",
            &command,
            "/SC",
            "ONLOGON",
            "/RL",
            "LIMITED",
            "/F",
        ])?;
        if !o.status.success() {
            return Err("ServiceStartFailed".into());
        }
        start(layout)
    }
    pub fn start(layout: &Layout) -> Result<(), String> {
        let _ = schtasks(&["/Change", "/TN", &task(layout), "/ENABLE"])?;
        if schtasks(&["/Run", "/TN", &task(layout)])?.status.success() {
            Ok(())
        } else {
            Err("ServiceStartFailed".into())
        }
    }
    pub fn stop(layout: &Layout) -> Result<(), String> {
        let _ = schtasks(&["/End", "/TN", &task(layout)])?;
        let _ = schtasks(&["/Change", "/TN", &task(layout), "/DISABLE"])?;
        Ok(())
    }
    pub fn uninstall(layout: &Layout) -> Result<(), String> {
        stop(layout)?;
        let _ = schtasks(&["/Delete", "/TN", &task(layout), "/F"])?;
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod service {
    use super::*;
    pub fn status(_: &Layout) -> (&'static str, Option<u32>) {
        ("unsupported", None)
    }
    pub fn install(_: &Layout, _: &Path) -> Result<(), String> {
        Err("LocalHostUnsupported".into())
    }
    pub fn start(_: &Layout) -> Result<(), String> {
        Err("LocalHostUnsupported".into())
    }
    pub fn stop(_: &Layout) -> Result<(), String> {
        Err("LocalHostUnsupported".into())
    }
    pub fn uninstall(_: &Layout) -> Result<(), String> {
        Err("LocalHostUnsupported".into())
    }
}

const SUPPORTED: bool = cfg!(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "windows"
));

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "NativeTaskFailed".to_string())?
}

#[tauri::command]
pub async fn fm_local_host_status(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
) -> Result<Status, String> {
    super::main_window(&window)?;
    blocking(move || {
        let layout = layout(&app, &profile)?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|_| "LocalHostUnavailable")?;
        let suggested = if SUPPORTED {
            suggest_port(&data, &profile)
        } else {
            None
        };
        Ok(layout.status(suggested))
    })
    .await
}
#[tauri::command]
pub async fn fm_local_host_keys(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
    network: String,
) -> Result<serde_json::Value, String> {
    super::main_window(&window)?;
    blocking(move || layout(&app, &profile)?.keys(&network)).await
}
#[tauri::command]
pub async fn fm_local_host_configure(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
    chain: Chain,
    organization: Organization,
) -> Result<Recorded, String> {
    super::main_window(&window)?;
    blocking(move || layout(&app, &profile)?.configure(&chain, &organization)).await
}
#[tauri::command]
pub async fn fm_local_host_join(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
    invitation: Option<String>,
    new_attempt: bool,
) -> Result<serde_json::Value, String> {
    super::main_window(&window)?;
    let invitation = invitation.map(|i| Zeroizing::new(i.into_bytes()));
    blocking(move || layout(&app, &profile)?.join(invitation, new_attempt)).await
}
#[tauri::command]
pub async fn fm_local_host_service(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
    action: String,
) -> Result<(), String> {
    super::main_window(&window)?;
    blocking(move || layout(&app, &profile)?.service(&action)).await
}
#[tauri::command]
pub async fn fm_local_host_uninstall(
    window: WebviewWindow,
    app: AppHandle,
    profile: String,
) -> Result<(), String> {
    super::main_window(&window)?;
    blocking(move || layout(&app, &profile)?.uninstall()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn chain() -> Chain {
        let id = format!("0x{}", "a".repeat(64));
        Chain {
            network: "testnet".into(),
            rpc_url: "https://fullnode.testnet.sui.io:443".into(),
            chain_identifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD".into(),
            package_id: id.clone(),
            original_package_id: id.clone(),
            okr_package_id: id.clone(),
            original_okr_package_id: id.clone(),
            direct_package_id: id.clone(),
            original_direct_package_id: id.clone(),
            registry_id: id,
        }
    }
    #[test]
    fn inputs_are_strict() {
        assert!(valid_profile("testnet") && valid_profile("primary") && valid_profile("a-1"));
        for bad in ["", "Testnet", "../x", "a b", "-a", &"a".repeat(33)] {
            assert!(!valid_profile(bad), "{bad}");
        }
        assert!(chain().validate().is_ok());
        let mut c = chain();
        c.rpc_url = "http://example.com".into();
        assert!(c.validate().is_err());
        c.rpc_url = "http://127.0.0.1:29000".into();
        assert!(c.validate().is_ok());
        c.package_id = "0xA".into();
        assert!(c.validate().is_err());
        let mut c = chain();
        c.network = "other".into();
        assert!(c.validate().is_err());
        assert!(
            port_allowed(7443) && port_allowed(7462) && !port_allowed(7463) && !port_allowed(80)
        );
        assert!(
            host_name("Owen's MacBook") && !host_name(" x") && !host_name("a\nb") && !host_name("")
        );
    }
    #[test]
    fn config_is_quoted_and_loopback_only() {
        let org = Organization {
            organization_id: format!("0x{}", "b".repeat(64)),
            binding_id: format!("0x{}", "c".repeat(64)),
            host_name: "Mac \"studio\"\\x".into(),
            port: 7444,
        };
        let yaml = render_config("testnet", &chain(), &org, Path::new("/tmp/work space"));
        assert!(yaml.contains("  key_profile: \"app-testnet\"\n"));
        assert!(yaml.contains("  hostname: \"Mac \\\"studio\\\"\\\\x\"\n"));
        assert!(yaml.contains("  listen_addr: \"127.0.0.1:7444\"\n"));
        assert!(yaml.contains("  coordinator: true\n"));
        assert!(yaml.contains(&format!("  binding_id: \"0x{}\"\n", "c".repeat(64))));
        assert!(yaml.contains("    files: \"/tmp/work space\"\n"));
        assert!(yaml.contains(&format!("  host_join_gas_budget: {JOIN_GAS_BUDGET}\n")));
        assert!(!yaml.contains("api_token") && !yaml.contains("keypair_path"));
        assert_eq!(endpoint(7444), "http://127.0.0.1:7444");
        assert!(render_keys_config("primary", "localnet").contains("key_profile: \"app-primary\""));
        // Block structure: sections at column 0, keys at 2, workspace entry at 4.
        let sections = ["identity:", "roles:", "coordinator:", "sui:", "runtime:"];
        for line in yaml.lines().filter(|l| !l.starts_with('#')) {
            let indent = line.len() - line.trim_start().len();
            assert!(
                (indent == 0 && sections.contains(&line))
                    || indent == 2
                    || (indent == 4 && line.starts_with("    files: ")),
                "unexpected YAML line {line:?}"
            );
        }
    }
    #[test]
    fn service_definitions_escape_paths() {
        let p = launchd_plist(
            "org.fractalmind.envd.testnet",
            Path::new("/Applications/FractalMind.app/Contents/MacOS/fractalmind-envd"),
            Path::new("/Users/a&b/cfg.yaml"),
            Path::new("/Users/a/Library/Logs/FractalMind/envd-testnet.log"),
            &service_path(Path::new("/Users/a")),
        );
        assert!(p.contains(
            "<key>PATH</key><string>/Users/a/.local/bin:/Users/a/bin:/opt/homebrew/bin:"
        ));
        assert!(p.contains("<key>LANG</key><string>en_US.UTF-8</string>"));
        assert!(p.contains("<string>/Users/a&amp;b/cfg.yaml</string>"));
        assert!(
            p.contains("<key>RunAtLoad</key><true/>") && p.contains("<key>KeepAlive</key><true/>")
        );
        let u = systemd_unit(
            Path::new("/opt/fm/fractalmind-envd"),
            Path::new("/home/u/100% \"x\"/cfg"),
            Path::new("/home/u/envd.log"),
            "/home/u/.local/bin:/usr/bin",
        );
        assert!(u.contains("Environment=\"PATH=/home/u/.local/bin:/usr/bin\" \"FM_ENVD_BUILD=\"\n"));
        let stamped = launchd_plist(
            "l",
            Path::new("/e"),
            Path::new("/c"),
            Path::new("/l"),
            "/bin\u{0}123-456",
        );
        assert!(
            stamped.contains("<key>PATH</key><string>/bin</string>")
                && stamped.contains("<key>FM_ENVD_BUILD</key><string>123-456</string>")
        );
        assert!(u.contains(
            "ExecStart=\"/opt/fm/fractalmind-envd\" --config \"/home/u/100%% \\\"x\\\"/cfg\"\n"
        ));
        assert!(u.contains("WantedBy=default.target"));
        assert_eq!(
            windows_task_command(
                Path::new("C:\\FM\\fractalmind-envd.exe"),
                Path::new("C:\\Users\\u\\cfg.yaml")
            ),
            "\"C:\\FM\\fractalmind-envd.exe\" --config \"C:\\Users\\u\\cfg.yaml\""
        );
    }
    #[test]
    fn public_keys_are_cached_after_the_first_read() {
        let dir = std::env::temp_dir().join(format!("fm-public-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        // No envd: any attempt to read the credential store would fail.
        let layout = Layout::new("testnet", &dir, &dir, &dir, None).unwrap();
        assert_eq!(layout.keys("testnet"), Err("EnvdUnavailable".to_string()));
        let public = serde_json::json!({
            "format": "1", "profile": "app-testnet",
            "host_address": format!("0x{}", "a".repeat(64)),
            "signing_public_key": "b".repeat(64), "encryption_public_key": "c".repeat(64),
        });
        write_private(&layout.public, public.to_string().as_bytes()).unwrap();
        assert_eq!(layout.keys("testnet").unwrap(), public);
        for bad in [
            serde_json::json!({ "profile": "app-other", "host_address": format!("0x{}", "a".repeat(64)), "signing_public_key": "b".repeat(64), "encryption_public_key": "c".repeat(64) }),
            serde_json::json!({ "profile": "app-testnet", "host_address": "0x12", "signing_public_key": "b".repeat(64), "encryption_public_key": "c".repeat(64) }),
            serde_json::json!({ "profile": "app-testnet", "host_address": format!("0x{}", "a".repeat(64)), "signing_public_key": "B".repeat(64), "encryption_public_key": "c".repeat(64) }),
        ] {
            write_private(&layout.public, bad.to_string().as_bytes()).unwrap();
            assert_eq!(
                layout.keys("testnet"),
                Err("EnvdUnavailable".to_string()),
                "{bad}"
            );
        }
        fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn last_json_line_wins() {
        let out = "{\"phase\":\"preview\"}\nnot json\n{\"state\":\"confirmed\"}\n";
        assert_eq!(last_json(out).unwrap()["state"], "confirmed");
        assert!(last_json("nothing").is_err());
    }
}
