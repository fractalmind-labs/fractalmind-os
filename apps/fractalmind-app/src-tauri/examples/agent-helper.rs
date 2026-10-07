//! Acceptance helper for #67: runs the App's native Agent creation with an
//! explicit assets folder. `agent-helper <assets> create '<spec json>'` or
//! `agent-helper <assets> launchers|catalog`. The Agent it creates is real.
use fractalmind_app_lib::agents::{create, launchers, Assets, Spec};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let assets = Assets::new(PathBuf::from(&args[1]));
    let home = PathBuf::from(std::env::var("HOME").expect("HOME"));
    let out = match args[2].as_str() {
        "launchers" => serde_json::to_string_pretty(&launchers(&home)).unwrap(),
        "catalog" => serde_json::to_string_pretty(&assets.catalog().unwrap()).unwrap(),
        "create" => {
            let spec: Spec = serde_json::from_str(&args[3]).expect("spec");
            match create(&assets, &home, &spec) {
                Ok(c) => serde_json::to_string_pretty(&c).unwrap(),
                Err(e) => format!("{{\"error\": {}}}", serde_json::to_string(&e).unwrap()),
            }
        }
        other => panic!("unknown command {other}"),
    };
    println!("{out}");
}
