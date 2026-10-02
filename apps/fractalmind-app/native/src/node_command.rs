//! Domain-restricted raw Ed25519 signing for the existing envd NodeCommand
//! protocol. A signature proves key possession, never current Sui authority.
use super::*;
use serde::{Deserialize, Serialize};

const MAX_COMMAND: usize = 8192;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    organization_id: String,
    node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Capability {
    id: String,
    revocation_version: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Budget {
    asset: String,
    amount: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    domain: String,
    version: String,
    command_id: String,
    signer: String,
    target: Target,
    action: String,
    scope: String,
    capability: Capability,
    nonce: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    budget: Option<Budget>,
    payload_hash: String,
}
fn token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/@+-".contains(&b))
}
fn positive_u64(value: &str) -> bool {
    value
        .parse::<u64>()
        .is_ok_and(|n| n > 0 && n.to_string() == value)
}
fn decode_command(encoded: &str, now: u64) -> Result<(Vec<u8>, Envelope)> {
    let bad = || VaultError::InvalidNodeCommand;
    if encoded.len() > (MAX_COMMAND + 2) / 3 * 4 {
        return Err(bad());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| bad())?;
    if bytes.is_empty() || bytes.len() > MAX_COMMAND || STANDARD.encode(&bytes) != encoded {
        return Err(bad());
    }
    let c: Envelope = serde_json::from_slice(&bytes).map_err(|_| bad())?;
    // Exact field order, omitted optionals, integer and ASCII encoding match
    // the SDK/Go signing domain. No alternate JSON or arbitrary raw bytes.
    if serde_json::to_vec(&c).map_err(|_| bad())? != bytes {
        return Err(bad());
    }
    let read = matches!(
        c.action.as_str(),
        "inventory" | "status" | "monitor" | "logs" | "health" | "availability"
    );
    let control = matches!(
        c.action.as_str(),
        "start" | "stop" | "assign" | "direct.message"
    );
    if c.domain != "fractalmind.node-command.v1"
        || c.version != "1"
        || keyrings::id(&c.signer).is_err()
        || keyrings::id(&c.target.organization_id).is_err()
        || keyrings::id(&c.target.node_id).is_err()
        || keyrings::id(&c.capability.id).is_err()
        || c.target.agent_id.as_ref().is_some_and(|s| !token(s, 128))
        || !token(&c.command_id, 128)
        || !token(&c.nonce, 128)
        || !token(&c.idempotency_key, 128)
        || !(read && c.scope == "observation" || control && c.scope == "control")
        || control && c.target.agent_id.is_none()
        || !positive_u64(&c.capability.revocation_version)
        || c.payload_hash.len() != 64
        || !c
            .payload_hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || c.issued_at_ms == 0
        || c.issued_at_ms > MAX_SAFE_INTEGER
        || c.expires_at_ms > MAX_SAFE_INTEGER
        || c.expires_at_ms <= c.issued_at_ms
        || c.expires_at_ms - c.issued_at_ms > 300_000
        || c.expires_at_ms <= now
        || c.issued_at_ms > now.saturating_add(30_000)
        || c.budget
            .as_ref()
            .is_some_and(|b| !token(&b.asset, 32) || !positive_u64(&b.amount))
    {
        return Err(bad());
    }
    Ok((bytes, c))
}
impl DeviceVault {
    pub fn sign_node_command(
        &self,
        profile: &str,
        encoded: &str,
        now_ms: u64,
    ) -> Result<SignedBytes> {
        // Reject malformed domains before attempting any OS key lookup.
        let (bytes, command) = decode_command(encoded, now_ms)?;
        sign_command_keys(&self.load(profile)?, profile, bytes, command, encoded)
    }
}
fn sign_command_keys(
    keys: &[u8],
    profile: &str,
    bytes: Vec<u8>,
    command: Envelope,
    encoded: &str,
) -> Result<SignedBytes> {
    if public(profile, keys)?.address != command.signer {
        return Err(VaultError::WrongSender);
    }
    let signature = signing_key(keys)?.sign(&bytes).to_bytes();
    Ok(SignedBytes {
        bytes: encoded.into(),
        signature: STANDARD.encode(signature),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;
    const NOW: u64 = 1_700_000_000_000;
    fn keys() -> Vec<u8> {
        let mut k = MAGIC.to_vec();
        k.extend([4; 32]);
        k.extend([5; 32]);
        k
    }
    fn envelope() -> Envelope {
        Envelope {
            domain: "fractalmind.node-command.v1".into(),
            version: "1".into(),
            command_id: "native-fixture".into(),
            signer: public("test-command", &keys()).unwrap().address,
            target: Target {
                organization_id: format!("0x{}", "1".repeat(64)),
                node_id: format!("0x{}", "2".repeat(64)),
                agent_id: Some("native-fixture".into()),
            },
            action: "status".into(),
            scope: "observation".into(),
            capability: Capability {
                id: format!("0x{}", "3".repeat(64)),
                revocation_version: "1".into(),
            },
            nonce: "native-nonce".into(),
            issued_at_ms: NOW,
            expires_at_ms: NOW + 120_000,
            idempotency_key: "native-fixture".into(),
            budget: None,
            payload_hash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a".into(),
        }
    }
    #[test]
    fn actual_signing_is_raw_ed25519_for_exact_sdk_bytes() {
        let encoded = STANDARD.encode(serde_json::to_vec(&envelope()).unwrap());
        let (bytes, c) = decode_command(&encoded, NOW).unwrap();
        let result =
            sign_command_keys(&keys(), "test-command", bytes.clone(), c, &encoded).unwrap();
        let signature =
            ed25519_dalek::Signature::from_slice(&STANDARD.decode(&result.signature).unwrap())
                .unwrap();
        signing_key(&keys())
            .unwrap()
            .verifying_key()
            .verify(&bytes, &signature)
            .unwrap();
        assert_eq!(result.bytes, encoded);
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../testdata/node-command-v1.json")).unwrap();
        assert_eq!(fixture["bytes"], encoded);
        assert_eq!(fixture["signature"], result.signature);
    }
    #[test]
    fn malformed_scopes_domains_ids_budget_and_expiry_never_sign() {
        let mut tests: Vec<Box<dyn Fn(&mut Envelope)>> = vec![
            Box::new(|c| c.domain = "wallet-login".into()),
            Box::new(|c| c.version = "2".into()),
            Box::new(|c| c.action = "shell".into()),
            Box::new(|c| c.scope = "control".into()),
            Box::new(|c| {
                c.action = "assign".into();
                c.scope = "observation".into()
            }),
            Box::new(|c| {
                c.action = "assign".into();
                c.scope = "control".into();
                c.target.agent_id = None
            }),
            Box::new(|c| c.target.node_id = "0x2".into()),
            Box::new(|c| c.signer = "0xA".into()),
            Box::new(|c| c.nonce = "bad nonce".into()),
            Box::new(|c| c.payload_hash = "G".repeat(64)),
            Box::new(|c| c.capability.revocation_version = "01".into()),
            Box::new(|c| c.capability.revocation_version = "18446744073709551616".into()),
            Box::new(|c| c.expires_at_ms = NOW),
            Box::new(|c| c.expires_at_ms = c.issued_at_ms + 300_001),
            Box::new(|c| {
                c.issued_at_ms = NOW + 30_001;
                c.expires_at_ms = NOW + 90_000
            }),
            Box::new(|c| {
                c.budget = Some(Budget {
                    asset: "TOOL_CALLS".into(),
                    amount: "0".into(),
                })
            }),
            Box::new(|c| {
                c.budget = Some(Budget {
                    asset: "TOOL_CALLS".into(),
                    amount: "9007199254740993.0".into(),
                })
            }),
        ];
        for mutate in tests.drain(..) {
            let mut c = envelope();
            mutate(&mut c);
            let encoded = STANDARD.encode(serde_json::to_vec(&c).unwrap());
            assert!(matches!(
                decode_command(&encoded, NOW),
                Err(VaultError::InvalidNodeCommand)
            ));
            // InvalidProfile would be returned if this reached load(). This
            // calls the production method and proves rejection before OS IPC.
            let vault = DeviceVault::new(DEVICE_SERVICE, PathBuf::from("unused"));
            assert!(matches!(
                vault.sign_node_command("../invalid", &encoded, NOW),
                Err(VaultError::InvalidNodeCommand)
            ));
        }
        let mut c = envelope();
        c.action = "assign".into();
        c.scope = "control".into();
        c.budget = Some(Budget {
            asset: "TOOL_CALLS".into(),
            amount: "18446744073709551615".into(),
        });
        assert!(decode_command(&STANDARD.encode(serde_json::to_vec(&c).unwrap()), NOW).is_ok());
    }
    #[test]
    fn foreign_key_and_alternate_json_cannot_obtain_a_signature() {
        let c = envelope();
        let mut pretty = serde_json::to_vec_pretty(&c).unwrap();
        assert!(decode_command(&STANDARD.encode(&pretty), NOW).is_err());
        pretty = b"{\"domain\":\"fractalmind.node-command.v1\",\"extra\":1}".to_vec();
        assert!(decode_command(&STANDARD.encode(pretty), NOW).is_err());
        let mut c = envelope();
        c.signer = format!("0x{}", "f".repeat(64));
        let encoded = STANDARD.encode(serde_json::to_vec(&c).unwrap());
        let (bytes, c) = decode_command(&encoded, NOW).unwrap();
        assert!(matches!(
            sign_command_keys(&keys(), "test-command", bytes, c, &encoded),
            Err(VaultError::WrongSender)
        ));
    }
}
