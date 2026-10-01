//! Isolated test transport. Not part of the installed App; no network listener,
//! arbitrary shell execution, secret export or production-profile deletion.
use fractalmind_device_vault::DeviceVault;
use serde::Deserialize;
use std::io::{self, Read};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: String,
    profile: String,
    bytes: Option<String>,
    challenge: Option<String>,
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{}", error);
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().take(1_500_001).read_to_string(&mut input)?;
    if input.len() > 1_500_000 {
        return Err("Test input too large".into());
    }
    let request: Request = serde_json::from_str(&input)?;
    if !request.profile.starts_with("test-") {
        return Err("Only isolated test profiles are allowed".into());
    }
    let vault = DeviceVault::new(
        "org.fractalmind.app.device.test",
        std::env::temp_dir().join("fractalmind-device-vault-test-locks"),
    );
    let output = match request.action.as_str() {
        "initialize" => serde_json::to_value(vault.initialize(&request.profile)?)?,
        "public" => serde_json::to_value(vault.public(&request.profile)?)?,
        "signTransaction" => serde_json::to_value(vault.sign_transaction(
            &request.profile,
            &request.bytes.ok_or("Transaction bytes required")?,
        )?)?,
        "proveDevice" => serde_json::to_value(
            vault.prove_device(
                &request.profile,
                &request.challenge.ok_or("Challenge required")?,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis()
                    .try_into()?,
            )?,
        )?,
        "remove" => {
            vault.remove_test_profile(&request.profile)?;
            serde_json::json!({"removed":true})
        }
        _ => return Err("Unknown test operation".into()),
    };
    println!("{}", output);
    Ok(())
}
