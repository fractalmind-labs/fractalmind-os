//! Isolated test transport. Not part of the installed App; no network listener,
//! arbitrary shell execution, secret export or production-profile deletion.
use fractalmind_device_vault::DeviceVault;
use serde::Deserialize;
use std::io::{self, Read};
use zeroize::Zeroizing;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: String,
    profile: String,
    bytes: Option<String>,
    challenge: Option<String>,
    network: Option<String>,
    record: Option<String>,
    #[serde(default, deserialize_with = "read_code")]
    code: Option<Zeroizing<String>>,
    source: Option<String>,
    phase: Option<String>,
}
fn read_code<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Zeroizing<String>>, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.map(Zeroizing::new))
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{}", error);
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = Zeroizing::new(String::new());
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
        "signNodeCommand" => serde_json::to_value(
            vault.sign_node_command(
                &request.profile,
                &request.bytes.ok_or("Command bytes required")?,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis()
                    .try_into()?,
            )?,
        )?,
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
        "createOnboarding" => serde_json::to_value(vault.create_onboarding(
            &request.profile,
            &request.network.ok_or("Network required")?,
        )?)?,
        "publicOnboarding" => serde_json::to_value(vault.onboarding_public(
            &request.profile,
            &request.network.ok_or("Network required")?,
        )?)?,
        "signOnboarding" => serde_json::to_value(vault.sign_onboarding_transaction(
            &request.profile,
            &request.network.ok_or("Network required")?,
            &request.bytes.ok_or("Bytes required")?,
        )?)?,
        "importRecovery" => serde_json::to_value(vault.import_recovery(
            &request.profile,
            &request.network.ok_or("Network required")?,
            &request.code.ok_or("Code required")?,
        )?)?,
        "publicImportedRecovery" => serde_json::to_value(vault.recovery_imported_public(
            &request.profile,
            &request.network.ok_or("Network required")?,
        )?)?,
        "prepareRecovery" => serde_json::to_value(vault.prepare_recovery(
            &request.profile,
            &request.network.ok_or("Network required")?,
            &request.source.ok_or("Source required")?,
        )?)?,
        "publicPreparedRecovery" => serde_json::to_value(vault.recovery_prepared_public(
            &request.profile,
            &request.network.ok_or("Network required")?,
        )?)?,
        "signRecovery" => serde_json::to_value(vault.sign_recovery_transaction(
            &request.profile,
            &request.network.ok_or("Network required")?,
            &request.phase.ok_or("Phase required")?,
            &request.bytes.ok_or("Bytes required")?,
        )?)?,
        "remove" => {
            vault.remove_test_profile(&request.profile)?;
            serde_json::json!({"removed":true})
        }
        "encryptRecord" => serde_json::to_value(
            vault.encrypt_record(&request.profile, &request.record.ok_or("Record required")?)?,
        )?,
        "wrapOrganizationKeys" => serde_json::to_value(vault.wrap_organization_keys(
            &request.profile,
            &request.record.ok_or("Share request required")?,
        )?)?,
        "wrapCommandResultKey" => serde_json::to_value(vault.wrap_command_result_key(
            &request.profile,
            &request.record.ok_or("Command result request required")?,
        )?)?,
        "encryptCommandDelivery" => serde_json::to_value(vault.encrypt_command_delivery(
            &request.profile,
            &request.record.ok_or("Command delivery request required")?,
        )?)?,
        "decryptRecord" => serde_json::to_value(
            vault.decrypt_record(&request.profile, &request.record.ok_or("Record required")?)?,
        )?,
        _ => return Err("Unknown test operation".into()),
    };
    println!("{}", output);
    Ok(())
}
