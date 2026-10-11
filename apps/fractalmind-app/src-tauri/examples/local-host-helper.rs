//! Acceptance helper for the local Host (#64): drives the same `Layout` code as
//! the App's native commands, with an explicit data root and envd binary, from
//! JSON lines on stdin. The service and Host keys it creates are real; the
//! caller must uninstall. Never used by the App.
use fractalmind_app_lib::local_host::{suggest_port, Chain, Layout, Organization};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use zeroize::Zeroizing;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(
        args.len(),
        4,
        "usage: local-host-helper <data-root> <envd> <profile>"
    );
    let data = PathBuf::from(&args[1]);
    let home = PathBuf::from(std::env::var("HOME").expect("HOME"));
    let config = home.join(".config");
    let layout = Layout::new(
        &args[3],
        &data,
        &home,
        &config,
        Some(PathBuf::from(&args[2])),
    )
    .expect("layout");
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let request: Value = serde_json::from_str(&line.expect("stdin")).expect("json");
        let arg = |k: &str| request.get(k).cloned().unwrap_or(Value::Null);
        let result: Result<Value, String> = match request["command"].as_str().unwrap_or("") {
            "status" => {
                Ok(serde_json::to_value(layout.status(suggest_port(&data, &args[3]))).unwrap())
            }
            "keys" => layout.keys(arg("network").as_str().unwrap_or("")),
            "configure" => serde_json::from_value::<Chain>(arg("chain"))
                .map_err(|e| e.to_string())
                .and_then(|chain| {
                    let org: Organization =
                        serde_json::from_value(arg("organization")).map_err(|e| e.to_string())?;
                    layout
                        .configure(&chain, &org)
                        .map(|r| serde_json::to_value(r).unwrap())
                }),
            "join" => layout.join(
                arg("invitation")
                    .as_str()
                    .map(|s| Zeroizing::new(s.as_bytes().to_vec())),
                arg("newAttempt").as_bool().unwrap_or(false),
            ),
            "service" => layout
                .service(arg("action").as_str().unwrap_or(""))
                .map(|_| Value::Null),
            "uninstall" => layout.uninstall().map(|_| Value::Null),
            other => Err(format!("unknown command {other}")),
        };
        let response = match result {
            Ok(value) => json!({ "ok": value }),
            Err(e) => json!({ "error": e }),
        };
        writeln!(out, "{response}").unwrap();
        out.flush().unwrap();
    }
}
