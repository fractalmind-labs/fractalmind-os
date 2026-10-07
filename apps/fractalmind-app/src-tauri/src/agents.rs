//! New Agents (#67). An Agent is a Home directory: a ROM writes its Agent OS
//! files and skills, the root AGENTS.md frontmatter names it and says how to
//! launch it, and agent-manager runs it in tmux as `<namespace>--main`. ROM
//! templates and skills are bundled resources built from this repository.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::local_host::service_path;

const RUNTIME_SKILL: &str = "agent-manager";

#[derive(Deserialize, Clone)]
struct CatalogSkill {
    name: String,
    available: bool,
    #[serde(default)]
    embedded: Option<String>,
    #[serde(default)]
    bundled: Option<String>,
}
#[derive(Deserialize, Clone)]
struct CatalogRom {
    id: String,
    version: String,
    files: Vec<String>,
    #[serde(default)]
    directories: Vec<String>,
    included: Vec<CatalogSkill>,
    optional: Vec<CatalogSkill>,
}
#[derive(Deserialize)]
struct Catalog {
    roms: Vec<CatalogRom>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Profile {
    pub id: String,
    pub model: Option<String>,
}
#[derive(Serialize, Clone, Debug)]
pub struct Launcher {
    pub id: String,
    pub name: String,
    pub bin: String,
    pub profiles: Vec<Profile>,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spec {
    pub name: String,
    pub home: String,
    pub rom_id: String,
    #[serde(default)]
    pub optional_skills: Vec<String>,
    pub launcher: String,
    pub profile_id: String,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub home: String,
    pub session: String,
    pub files: Vec<String>,
    pub skills: Vec<String>,
    pub missing_skills: Vec<String>,
    pub heartbeat: bool,
    pub started: bool,
    pub start_error: Option<String>,
    pub heartbeat_installed: bool,
    pub heartbeat_error: Option<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartOutcome {
    pub heartbeat_installed: bool,
    pub heartbeat_error: Option<String>,
}

pub fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    (2..=31).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !name.ends_with('-')
        && !name.contains("--")
}

/// `~/x` or an absolute path without `..`; never the home folder or `/`.
pub fn resolve_home(user_home: &Path, input: &str) -> Option<PathBuf> {
    let input = input.trim();
    if input.is_empty() || input.len() > 1024 || input.chars().any(char::is_control) {
        return None;
    }
    let path = if input == "~" {
        user_home.to_path_buf()
    } else if let Some(rest) = input.strip_prefix("~/") {
        user_home.join(rest)
    } else {
        PathBuf::from(input)
    };
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        || path == user_home
        || path.parent().is_none()
    {
        return None;
    }
    Some(path)
}

/// new | empty | agent_home | not_empty | invalid
pub fn home_state(path: &Path) -> &'static str {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Some ancestor must exist and be a directory.
            match path.ancestors().skip(1).find(|a| a.exists()) {
                Some(a) if a.is_dir() => "new",
                _ => "invalid",
            }
        }
        Err(_) => "invalid",
        Ok(m) if !m.is_dir() => "not_empty",
        Ok(_) => {
            if path.join("AGENTS.md").exists() {
                return "agent_home";
            }
            match fs::read_dir(path) {
                Ok(entries) => {
                    let visible = entries.flatten().any(|e| e.file_name() != ".DS_Store");
                    if visible {
                        "not_empty"
                    } else {
                        "empty"
                    }
                }
                Err(_) => "invalid",
            }
        }
    }
}

fn model_of(file: &Path) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    for line in text.lines().take(400) {
        let t = line.trim();
        if t.starts_with('[') {
            break;
        }
        if let Some(rest) = t.strip_prefix("model") {
            let rest = rest.trim_start();
            if let Some(v) = rest.strip_prefix('=') {
                let v = v.trim().trim_matches('"');
                if !v.is_empty() && v.len() <= 128 && !v.chars().any(char::is_control) {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

fn find_bin(name: &str, user_home: &Path) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in service_path(user_home).split(':') {
        dirs.push(PathBuf::from(d));
    }
    if name == "claude" {
        dirs.push(user_home.join(".claude/local"));
    }
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

/// Launchers installed on this computer and their profiles. For Codex the
/// profile files are `$CODEX_HOME/<id>.config.toml`; only `model` is read.
pub fn launchers(user_home: &Path) -> Vec<Launcher> {
    let mut out = Vec::new();
    if let Some(bin) = find_bin("codex", user_home) {
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home.join(".codex"));
        let mut profiles = vec![Profile {
            id: "default".into(),
            model: model_of(&codex_home.join("config.toml")),
        }];
        if let Ok(entries) = fs::read_dir(&codex_home) {
            let mut named: Vec<Profile> = entries
                .flatten()
                .filter_map(|e| {
                    let file = e.file_name().to_string_lossy().to_string();
                    let id = file.strip_suffix(".config.toml")?.to_string();
                    valid_name(&id).then(|| Profile {
                        model: model_of(&e.path()),
                        id,
                    })
                })
                .collect();
            named.sort_by(|a, b| a.id.cmp(&b.id));
            profiles.extend(named);
        }
        out.push(Launcher {
            id: "codex".into(),
            name: "Codex CLI".into(),
            bin: bin.to_string_lossy().into(),
            profiles,
        });
    }
    if let Some(bin) = find_bin("claude", user_home) {
        out.push(Launcher {
            id: "claude".into(),
            name: "Claude Code".into(),
            bin: bin.to_string_lossy().into(),
            profiles: vec![Profile {
                id: "default".into(),
                model: None,
            }],
        });
    }
    out
}

/// Rewrites the ROM's AGENTS.md frontmatter for this Agent: its namespace,
/// launcher and profile (the profile, not a pinned --model, decides the
/// model), the installed skills and the ROM it came from.
pub fn rewrite_frontmatter(
    text: &str,
    namespace: &str,
    launcher: &str,
    profile: &str,
    skills: &[String],
    rom: (&str, &str),
) -> Result<String, String> {
    let rest = text.strip_prefix("---\n").ok_or("RomAgentsFileInvalid")?;
    let end = rest.find("\n---").ok_or("RomAgentsFileInvalid")?;
    let (head, body) = (&rest[..end], &rest[end + 1..]);
    let replaced = ["namespace", "launcher", "launcher_args", "skills", "rom"];
    let mut kept: Vec<String> = Vec::new();
    let mut old_args: Vec<String> = Vec::new();
    let mut skipping: Option<&str> = None;
    let mut saw_name = false;
    for line in head.lines() {
        let top = !line.starts_with(' ') && !line.starts_with('\t') && !line.is_empty();
        if top {
            skipping = None;
            let key = line.split(':').next().unwrap_or("").trim();
            if launcher == "claude" && key == "launcher_config" {
                skipping = Some("launcher_config");
                continue;
            }
            if replaced.contains(&key) {
                skipping = Some(if key == "launcher_args" {
                    "launcher_args"
                } else {
                    "x"
                });
                if key == "launcher_args" {
                    if let Some(inline) = line.split_once(':').map(|x| x.1.trim()) {
                        if inline.starts_with('[') {
                            old_args.extend(
                                inline
                                    .trim_matches(|c| c == '[' || c == ']')
                                    .split(',')
                                    .map(|a| a.trim().trim_matches('"').to_string())
                                    .filter(|a| !a.is_empty()),
                            );
                        }
                    }
                }
                continue;
            }
            kept.push(line.to_string());
            if key == "name" {
                saw_name = true;
                kept.push(format!("namespace: {namespace}"));
            }
        } else if let Some(k) = skipping {
            if k == "launcher_args" {
                if let Some(a) = line.trim().strip_prefix("- ") {
                    old_args.push(a.trim().trim_matches('"').to_string());
                }
            }
        } else {
            kept.push(line.to_string());
        }
    }
    if !saw_name {
        return Err("RomAgentsFileInvalid".into());
    }
    // Keep the ROM's other launch flags; drop pinned models and profiles.
    let mut args: Vec<String> = Vec::new();
    let mut skip_next = false;
    for a in old_args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if a == "--model" || a == "-m" || a == "--profile" || a == "-p" {
            skip_next = true;
            continue;
        }
        if a.starts_with("--model=") || a.starts_with("--profile=") {
            continue;
        }
        args.push(a);
    }
    if launcher == "claude" {
        args = args
            .into_iter()
            .map(|a| {
                if a == "--dangerously-bypass-approvals-and-sandbox" {
                    "--dangerously-skip-permissions".into()
                } else {
                    a
                }
            })
            .filter(|a| a.starts_with("--dangerously-skip-permissions"))
            .collect();
    } else if profile != "default" {
        args.splice(0..0, ["--profile".to_string(), profile.to_string()]);
    }
    let q = |s: &str| serde_json::to_string(s).expect("string");
    kept.push(format!("launcher: {launcher}"));
    if args.is_empty() {
        kept.push("launcher_args: []".into());
    } else {
        kept.push("launcher_args:".into());
        kept.extend(args.iter().map(|a| format!("  - {}", q(a))));
    }
    kept.push("skills:".into());
    kept.extend(skills.iter().map(|s| format!("  - {s}")));
    kept.push(format!("rom:\n  name: {}\n  version: {}", rom.0, q(rom.1)));
    Ok(format!("---\n{}\n{}", kept.join("\n"), body))
}

pub struct Assets {
    root: PathBuf,
}
impl Assets {
    pub fn new(root: PathBuf) -> Self {
        Assets { root }
    }
    pub fn catalog(&self) -> Result<Value, String> {
        let text =
            fs::read_to_string(self.root.join("catalog.json")).map_err(|_| "AgentAssetsMissing")?;
        serde_json::from_str(&text).map_err(|_| "AgentAssetsMissing".into())
    }
    fn rom(&self, id: &str) -> Result<CatalogRom, String> {
        let catalog: Catalog =
            serde_json::from_value(self.catalog()?).map_err(|_| "AgentAssetsMissing")?;
        catalog
            .roms
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| "UnknownRom".into())
    }
    fn skill_source(&self, rom: &str, s: &CatalogSkill) -> Option<PathBuf> {
        let p = match (&s.bundled, &s.embedded) {
            (Some(b), _) => self.root.join("skills").join(b),
            (None, Some(e)) => self.root.join("roms").join(rom).join("templates").join(e),
            _ => return None,
        };
        p.join("SKILL.md").is_file().then_some(p)
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

fn run(cmd: &mut Command, timeout: Duration) -> Result<(bool, String), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group: a timeout also stops children such as `crontab`.
        cmd.process_group(0);
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "CommandUnavailable")?;
    let mut out = child.stdout.take().ok_or("CommandUnavailable")?;
    let mut err = child.stderr.take().ok_or("CommandUnavailable")?;
    let o = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = (&mut out).take(1 << 16).read_to_end(&mut b);
        b
    });
    let e = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = (&mut err).take(1 << 16).read_to_end(&mut b);
        b
    });
    let started = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|_| "CommandUnavailable")? {
            break s;
        }
        if started.elapsed() > timeout {
            #[cfg(unix)]
            let _ = Command::new("/bin/kill")
                .args(["-KILL", &format!("-{}", child.id())])
                .status();
            let _ = child.kill();
            let _ = child.wait();
            return Err("CommandTimeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let mut text = String::from_utf8_lossy(&o.join().unwrap_or_default()).to_string();
    text.push_str(&String::from_utf8_lossy(&e.join().unwrap_or_default()));
    Ok((status.success(), text))
}
fn last_line(text: &str) -> String {
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(300)
        .collect()
}

fn session_exists(name: &str, user_home: &Path) -> bool {
    let tmux = find_bin("tmux", user_home).unwrap_or_else(|| PathBuf::from("tmux"));
    Command::new(tmux)
        .args(["has-session", "-t", &format!("={name}--main")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Where a Home keeps agent-manager: App-created Homes use `.agents/skills`;
/// existing Homes may keep it under `skills/` or `.claude/skills/`.
fn agent_manager_script(home: &Path) -> Option<PathBuf> {
    [".agents/skills", "skills", ".claude/skills"]
        .iter()
        .map(|dir| home.join(dir).join("agent-manager/scripts/main.py"))
        .find(|p| p.is_file())
}

fn agent_manager(
    home: &Path,
    user_home: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<(bool, String), String> {
    let script = agent_manager_script(home).ok_or("AgentManagerMissing")?;
    let python = find_bin("python3", user_home).ok_or("PythonUnavailable")?;
    run(
        Command::new(python)
            .arg(script)
            .args(args)
            .current_dir(home)
            .env("REPO_ROOT", home)
            .env("PATH", service_path(user_home))
            .env("LANG", "en_US.UTF-8")
            .env_remove("AGENT_MANAGER_NAMESPACE"),
        timeout,
    )
}

/// Starts the Home's main Agent (reusing a running session), then installs
/// its heartbeat into this Home's own crontab block. On macOS, writing the
/// crontab from an app asks the person to allow it, so that step waits long
/// and its failure does not undo a started Agent.
pub fn start(home: &Path, user_home: &Path) -> Result<StartOutcome, String> {
    let (ok, out) = agent_manager(
        home,
        user_home,
        &["start", "main"],
        Duration::from_secs(120),
    )
    .map_err(|e| format!("AgentStartFailed: {e}"))?;
    if !ok {
        return Err(format!("AgentStartFailed: {}", last_line(&out)));
    }
    let heartbeat_error = match agent_manager(
        home,
        user_home,
        &["heartbeat", "sync"],
        Duration::from_secs(300),
    ) {
        Ok((true, _)) => None,
        Ok((false, out)) => Some(format!("HeartbeatSyncFailed: {}", last_line(&out))),
        Err(e) => Some(format!("HeartbeatSyncFailed: {e}")),
    };
    Ok(StartOutcome {
        heartbeat_installed: heartbeat_error.is_none(),
        heartbeat_error,
    })
}

const OKR_HEADER: &str = "# FractalMind OKR";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Delivered {
    /// The file the goal was written to.
    pub path: String,
    /// Whether agent-manager accepted the task for the running Agent.
    pub notified: bool,
    pub notify_error: Option<String>,
}

/// Where the projection goes: the Home's OKR.md, unless that file exists and
/// was not written by FractalMind, in which case it is left untouched.
pub fn okr_target(home: &Path) -> PathBuf {
    let own = home.join("OKR.md");
    let ours = match fs::read_to_string(&own) {
        Err(_) => true,
        Ok(text) => text.starts_with(OKR_HEADER),
    };
    if ours {
        own
    } else {
        home.join(".fractalmind/OKR.md")
    }
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("DeliveryFailed")?;
    fs::create_dir_all(dir).map_err(|_| "DeliveryFailed")?;
    let tmp = dir.join(format!(".OKR.md.{}.tmp", std::process::id()));
    fs::write(&tmp, content).map_err(|_| "DeliveryFailed")?;
    fs::rename(&tmp, path).map_err(|_| {
        let _ = fs::remove_file(&tmp);
        "DeliveryFailed".to_string()
    })
}

/// Delivers an assigned OKR to an agent-manager Agent on this computer (#75):
/// writes the projection into its Home, then hands it the task through
/// agent-manager. A failed notification keeps the written goal.
pub fn deliver_okr(
    home: &Path,
    user_home: &Path,
    agent: &str,
    content: &str,
    task: &str,
) -> Result<Delivered, String> {
    if !(agent == "main" || valid_name(agent))
        || !content.starts_with(OKR_HEADER)
        || content.len() > 262_144
        || task.trim().is_empty()
        || task.len() > 8192
    {
        return Err("InvalidDelivery".into());
    }
    let target = okr_target(home);
    write_atomic(&target, content)?;
    let task_file = home.join(format!(".fractalmind/task-{}.md", std::process::id()));
    // The task names the file actually written.
    write_atomic(&task_file, &task.replace("{OKR_PATH}", &target.to_string_lossy()))?;
    let file = task_file.to_string_lossy().to_string();
    let result = agent_manager(
        home,
        user_home,
        &["assign", agent, "--task-file", &file],
        Duration::from_secs(90),
    );
    let _ = fs::remove_file(&task_file);
    let (notified, notify_error) = match result {
        Ok((true, _)) => (true, None),
        Ok((false, out)) => (false, Some(format!("AssignFailed: {}", last_line(&out)))),
        Err(e) => (false, Some(e)),
    };
    Ok(Delivered {
        path: target.to_string_lossy().into(),
        notified,
        notify_error,
    })
}

pub fn create(assets: &Assets, user_home: &Path, spec: &Spec) -> Result<Created, String> {
    if !valid_name(&spec.name) {
        return Err("InvalidAgentName".into());
    }
    if session_exists(&spec.name, user_home) {
        return Err("AgentNameInUse".into());
    }
    let home = resolve_home(user_home, &spec.home).ok_or("InvalidHome")?;
    let state = home_state(&home);
    if state != "new" && state != "empty" {
        return Err(format!("HomeNotUsable: {state}"));
    }
    let rom = assets.rom(&spec.rom_id)?;
    for s in &spec.optional_skills {
        if !rom.optional.iter().any(|o| &o.name == s) {
            return Err("UnknownSkill".into());
        }
    }
    let launcher = launchers(user_home)
        .into_iter()
        .find(|l| l.id == spec.launcher)
        .ok_or("UnknownLauncher")?;
    if !launcher.profiles.iter().any(|p| p.id == spec.profile_id) {
        return Err("UnknownLauncher".into());
    }
    let templates = assets.root.join("roms").join(&rom.id).join("templates");
    let created_dir = state == "new";
    let result = (|| -> Result<Created, String> {
        fs::create_dir_all(&home).map_err(|_| "HomeNotWritable")?;
        // 1. ROM files (install_boundary only; embedded skills are skills).
        let mut files = Vec::new();
        for d in &rom.directories {
            fs::create_dir_all(home.join(d.trim_end_matches('/')))
                .map_err(|_| "HomeNotWritable")?;
        }
        for f in &rom.files {
            let from = templates.join(f);
            if !from.is_file() {
                continue;
            }
            let to = home.join(f);
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|_| "HomeNotWritable")?;
            }
            fs::copy(&from, &to).map_err(|_| "HomeNotWritable")?;
            files.push(f.clone());
        }
        if !files.iter().any(|f| f == "AGENTS.md") {
            return Err("RomAgentsFileInvalid".into());
        }
        // 2. Skills: the runtime, the ROM's required ones and the chosen optional ones.
        let mut wanted: Vec<CatalogSkill> = Vec::new();
        if !rom.included.iter().any(|s| s.name == RUNTIME_SKILL) {
            wanted.push(CatalogSkill {
                name: RUNTIME_SKILL.into(),
                available: true,
                embedded: None,
                bundled: Some(RUNTIME_SKILL.into()),
            });
        }
        wanted.extend(rom.included.iter().cloned());
        wanted.extend(
            rom.optional
                .iter()
                .filter(|o| spec.optional_skills.contains(&o.name))
                .cloned(),
        );
        let (mut skills, mut missing) = (Vec::new(), Vec::new());
        for s in &wanted {
            match assets.skill_source(&rom.id, s).filter(|_| s.available) {
                Some(src) => {
                    copy_dir(&src, &home.join(".agents/skills").join(&s.name))
                        .map_err(|_| "HomeNotWritable")?;
                    skills.push(s.name.clone());
                }
                None => missing.push(s.name.clone()),
            }
        }
        // 3. AGENTS.md for this Agent.
        let agents = home.join("AGENTS.md");
        let text = fs::read_to_string(&agents).map_err(|_| "RomAgentsFileInvalid")?;
        let rewritten = rewrite_frontmatter(
            &text,
            &spec.name,
            &launcher.id,
            &spec.profile_id,
            &skills,
            (&rom.id, &rom.version),
        )?;
        fs::write(&agents, rewritten).map_err(|_| "HomeNotWritable")?;
        let heartbeat = text.contains("\nheartbeat:");
        // 4. A git root keeps agent-manager's repo detection on this Home.
        if let Some(git) = find_bin("git", user_home) {
            let _ = run(
                Command::new(git).args(["init", "-q"]).current_dir(&home),
                Duration::from_secs(20),
            );
        }
        Ok(Created {
            home: home.to_string_lossy().into(),
            session: format!("{}--main", spec.name),
            files,
            skills,
            missing_skills: missing,
            heartbeat,
            started: false,
            start_error: None,
            heartbeat_installed: false,
            heartbeat_error: None,
        })
    })();
    let mut created = match result {
        Ok(c) => c,
        Err(e) => {
            // Nothing half-written stays behind in a folder we were given empty.
            if created_dir {
                let _ = fs::remove_dir_all(&home);
            } else if let Ok(entries) = fs::read_dir(&home) {
                for entry in entries.flatten() {
                    if entry.file_name() != ".DS_Store" {
                        let p = entry.path();
                        let _ = if p.is_dir() {
                            fs::remove_dir_all(p)
                        } else {
                            fs::remove_file(p)
                        };
                    }
                }
            }
            return Err(e);
        }
    };
    // 5. Start. The files stay if this fails; "start again" retries.
    match start(&home, user_home) {
        Ok(o) => {
            created.started = true;
            created.heartbeat_installed = o.heartbeat_installed;
            created.heartbeat_error = o.heartbeat_error;
        }
        Err(e) => created.start_error = Some(e),
    }
    Ok(created)
}

fn assets(app: &AppHandle) -> Result<Assets, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| "AgentAssetsMissing")?
        .join("agent-assets");
    Ok(Assets::new(root))
}
fn user_home(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|_| "HomeUnavailable".into())
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "NativeTaskFailed".to_string())?
}

#[tauri::command]
pub async fn fm_agent_catalog(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    super::main_window(&window)?;
    blocking(move || assets(&app)?.catalog()).await
}
#[tauri::command]
pub async fn fm_agent_launchers(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Vec<Launcher>, String> {
    super::main_window(&window)?;
    blocking(move || Ok(launchers(&user_home(&app)?))).await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCheck {
    state: &'static str,
    path: Option<String>,
}
#[tauri::command]
pub async fn fm_agent_home_check(
    window: WebviewWindow,
    app: AppHandle,
    home: String,
) -> Result<HomeCheck, String> {
    super::main_window(&window)?;
    blocking(move || {
        let user = user_home(&app)?;
        Ok(match resolve_home(&user, &home) {
            Some(p) => HomeCheck {
                state: home_state(&p),
                path: Some(p.to_string_lossy().into()),
            },
            None => HomeCheck {
                state: "invalid",
                path: None,
            },
        })
    })
    .await
}
#[tauri::command]
pub async fn fm_agent_create(
    window: WebviewWindow,
    app: AppHandle,
    spec: Spec,
) -> Result<Created, String> {
    super::main_window(&window)?;
    blocking(move || create(&assets(&app)?, &user_home(&app)?, &spec)).await
}
/// Retries starting an Agent this App created, after a failed first start.
#[tauri::command]
pub async fn fm_agent_start(
    window: WebviewWindow,
    app: AppHandle,
    home: String,
) -> Result<StartOutcome, String> {
    super::main_window(&window)?;
    blocking(move || {
        let user = user_home(&app)?;
        let path = resolve_home(&user, &home).ok_or("InvalidHome")?;
        if home_state(&path) != "agent_home" {
            return Err("HomeNotUsable".into());
        }
        start(&path, &user)
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    home: String,
    agent: String,
    content: String,
    task: String,
}
#[tauri::command]
pub async fn fm_agent_deliver_okr(
    window: WebviewWindow,
    app: AppHandle,
    delivery: Delivery,
) -> Result<Delivered, String> {
    super::main_window(&window)?;
    blocking(move || {
        let user = user_home(&app)?;
        let path = resolve_home(&user, &delivery.home).ok_or("InvalidHome")?;
        if home_state(&path) != "agent_home" {
            return Err("HomeNotUsable".into());
        }
        deliver_okr(&path, &user, &delivery.agent, &delivery.content, &delivery.task)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn okr_delivery_never_overwrites_a_persons_own_okr_file() {
        let dir = std::env::temp_dir().join(format!("fm-okr-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // No OKR.md yet, or one FractalMind wrote: deliver there.
        assert_eq!(okr_target(&dir), dir.join("OKR.md"));
        fs::write(dir.join("OKR.md"), "# FractalMind OKR\nold").unwrap();
        assert_eq!(okr_target(&dir), dir.join("OKR.md"));
        // The person's own OKR.md stays; the goal goes beside it.
        fs::write(dir.join("OKR.md"), "# My plans").unwrap();
        assert_eq!(okr_target(&dir), dir.join(".fractalmind/OKR.md"));
        let user = std::env::temp_dir();
        let out = deliver_okr(&dir, &user, "main", "# FractalMind OKR\nnew", "Read OKR.md").unwrap();
        assert_eq!(out.path, dir.join(".fractalmind/OKR.md").to_string_lossy());
        assert_eq!(fs::read_to_string(dir.join("OKR.md")).unwrap(), "# My plans");
        assert_eq!(fs::read_to_string(dir.join(".fractalmind/OKR.md")).unwrap(), "# FractalMind OKR\nnew");
        // Without agent-manager the goal is still written, and that is reported.
        assert!(!out.notified && out.notify_error.as_deref() == Some("AgentManagerMissing"));
        assert!(!dir.join(format!(".fractalmind/task-{}.md", std::process::id())).exists());
        // Only FractalMind projections and plain agent names are delivered.
        assert!(deliver_okr(&dir, &user, "main", "# other", "t").is_err());
        assert!(deliver_okr(&dir, &user, "Bad Name", "# FractalMind OKR", "t").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn names_and_homes_are_strict() {
        assert!(valid_name("writer") && valid_name("research-2"));
        for bad in [
            "",
            "w",
            "Writer",
            "1x",
            "a--b",
            "x-",
            "a_b",
            &"a".repeat(32),
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
        let user = Path::new("/Users/u");
        assert_eq!(
            resolve_home(user, "~/agents/w").unwrap(),
            Path::new("/Users/u/agents/w")
        );
        assert_eq!(resolve_home(user, "/srv/w").unwrap(), Path::new("/srv/w"));
        for bad in ["", "~", "/Users/u", "agents/w", "~/a/../b", "/", "~/a\nb"] {
            assert!(resolve_home(user, bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn home_states() {
        let dir = std::env::temp_dir().join(format!("fm-home-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(home_state(&dir.join("new/child")), "new");
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join(".DS_Store"), "").unwrap();
        assert_eq!(home_state(&empty), "empty");
        let full = dir.join("full");
        fs::create_dir_all(&full).unwrap();
        fs::write(full.join("notes.txt"), "x").unwrap();
        assert_eq!(home_state(&full), "not_empty");
        fs::write(full.join("AGENTS.md"), "---\nname: main\n---\n").unwrap();
        assert_eq!(home_state(&full), "agent_home");
        assert_eq!(home_state(&full.join("notes.txt")), "not_empty");
        fs::remove_dir_all(&dir).unwrap();
    }

    const ROM: &str = "---\nname: main\nrole: supervisor\ndescription: \"main\"\nenabled: true\nworking_directory: ${REPO_ROOT}\nlauncher: codex\nlauncher_args:\n  - --model=gpt-5.5\n  - --dangerously-bypass-approvals-and-sandbox\nlauncher_config:\n  model_reasoning_effort: high\nskills:\n  - agent-manager\n  - notifier\nheartbeat:\n  cron: \"*/5 * * * *\"\n  enabled: true\n---\n\n# Body stays\n";

    #[test]
    fn frontmatter_gets_namespace_profile_skills_and_rom() {
        let out = rewrite_frontmatter(
            ROM,
            "writer",
            "codex",
            "main",
            &["agent-manager".into(), "team-manager".into()],
            ("manager-heavy-core", "0.6.0"),
        )
        .unwrap();
        assert!(out.starts_with("---\nname: main\nnamespace: writer\nrole: supervisor\n"));
        assert!(out.contains("launcher: codex\nlauncher_args:\n  - \"--profile\"\n  - \"main\"\n  - \"--dangerously-bypass-approvals-and-sandbox\"\n"));
        assert!(
            !out.contains("gpt-5.5"),
            "the profile, not a pinned model, decides"
        );
        assert!(out.contains("launcher_config:\n  model_reasoning_effort: high\n"));
        assert!(out.contains("skills:\n  - agent-manager\n  - team-manager\nrom:\n  name: manager-heavy-core\n  version: \"0.6.0\"\n---\n\n# Body stays\n"));
        assert!(out.contains("heartbeat:\n  cron: \"*/5 * * * *\""));
        assert_eq!(out.matches("namespace:").count(), 1);
        let default = rewrite_frontmatter(ROM, "w2", "codex", "default", &[], ("x", "1")).unwrap();
        assert!(
            default
                .contains("launcher_args:\n  - \"--dangerously-bypass-approvals-and-sandbox\"\n")
                && default.contains("skills:\nrom:")
        );
        let claude = rewrite_frontmatter(ROM, "w3", "claude", "default", &[], ("x", "1")).unwrap();
        assert!(claude.contains(
            "launcher: claude\nlauncher_args:\n  - \"--dangerously-skip-permissions\"\n"
        ));
        assert!(!claude.contains("launcher_config") && !claude.contains("model_reasoning_effort"));
        let inline = "---\nname: main\nlauncher: codex\nlauncher_args: [--model=gpt, --dangerously-bypass-approvals-and-sandbox]\n---\n";
        assert!(rewrite_frontmatter(inline, "w4", "codex", "main", &[], ("x", "1")).unwrap().contains("  - \"--profile\"\n  - \"main\"\n  - \"--dangerously-bypass-approvals-and-sandbox\"\n"));
        assert!(
            rewrite_frontmatter("no frontmatter", "w", "codex", "main", &[], ("x", "1")).is_err()
        );
        assert!(rewrite_frontmatter(
            "---\ndescription: x\n---\n",
            "w",
            "codex",
            "main",
            &[],
            ("x", "1")
        )
        .is_err());
    }

    #[test]
    fn codex_profiles_read_only_the_model() {
        let dir = std::env::temp_dir().join(format!("fm-codex-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main.config.toml"), "model_provider = \"x\"\nmodel = \"ornith\"\n[model_providers.x]\nmodel = \"no\"\napi_key = \"secret\"\n").unwrap();
        assert_eq!(
            model_of(&dir.join("main.config.toml")).as_deref(),
            Some("ornith")
        );
        fs::write(
            dir.join("other.config.toml"),
            "[profiles.x]\nmodel = \"no\"\n",
        )
        .unwrap();
        assert_eq!(model_of(&dir.join("other.config.toml")), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
