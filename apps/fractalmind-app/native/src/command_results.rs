//! Host result access is restricted to a single command derivative. Organization
//! and device secrets stay native. The App must check current Sui authorization
//! before and after this primitive; wrapping does not authorize a command.
use super::*;
use hkdf::Hkdf;
use serde::Deserialize;
use sha2::Sha256;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WrapRequest {
    network: String,
    encrypted_keys: String,
    organization_id: String,
    capability_id: String,
    membership_id: String,
    intent_hash: String,
    key_version: String,
    host_address: String,
    host_signing_public_key: String,
    host_encryption_public_key: String,
}
impl WrapRequest {
    fn validate(&self) -> Result<[u8; 32]> {
        if !["localnet", "devnet", "testnet", "mainnet"].contains(&self.network.as_str())
            || self.intent_hash.len() != 64
            || !self
                .intent_hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(VaultError::InvalidEnvelope);
        }
        for value in [
            &self.organization_id,
            &self.capability_id,
            &self.membership_id,
            &self.host_address,
        ] {
            keyrings::id(value)?;
        }
        records::positive(&self.key_version)?;
        let signing: [u8; 32] = records::encoded(&self.host_signing_public_key, 32)?
            .try_into()
            .map_err(|_| VaultError::InvalidEnvelope)?;
        ed25519_dalek::VerifyingKey::from_bytes(&signing)
            .map_err(|_| VaultError::InvalidEnvelope)?;
        let mut hash = Blake2b::<U32>::new();
        hash.update([0u8]);
        hash.update(signing);
        if self.host_address != format!("0x{}", hex::encode(hash.finalize())) {
            return Err(VaultError::InvalidEnvelope);
        }
        let recipient: [u8; 32] = records::encoded(&self.host_encryption_public_key, 32)?
            .try_into()
            .map_err(|_| VaultError::InvalidEnvelope)?;
        // Reject low-order X25519 points before asking the OS for a key.
        if !StaticSecret::from([7u8; 32])
            .diffie_hellman(&PublicKey::from(recipient))
            .was_contributory()
        {
            return Err(VaultError::InvalidEnvelope);
        }
        let encrypted = records::encoded(&self.encrypted_keys, 65536 + 100)?;
        if encrypted.len() < 100 || !encrypted.starts_with(b"FMW1") || &encrypted[68..72] != b"FME1"
        {
            return Err(VaultError::InvalidEnvelope);
        }
        Ok(recipient)
    }
}
impl DeviceVault {
    pub fn wrap_command_result_key(&self, profile: &str, request: &str) -> Result<String> {
        if request.len() > 150_000 {
            return Err(VaultError::InvalidEnvelope);
        }
        let input: WrapRequest =
            serde_json::from_str(request).map_err(|_| VaultError::InvalidEnvelope)?;
        let recipient = input.validate()?;
        Ok(STANDARD.encode(wrap_result(
            &self.load(profile)?,
            profile,
            &input,
            &recipient,
        )?))
    }
}
fn wrap_result(
    keys: &[u8],
    profile: &str,
    input: &WrapRequest,
    recipient: &[u8; 32],
) -> Result<Vec<u8>> {
    validate_keys(keys)?;
    let device = public(profile, keys)?;
    let secret = StaticSecret::from(
        <[u8; 32]>::try_from(&keys[36..68]).map_err(|_| VaultError::InvalidStoredKey)?,
    );
    let body = records::encoded(&input.encrypted_keys, 65536 + 100)?;
    let ring = records::unwrap(
        &body,
        &secret,
        &format!(
            "fractalmind.device-keys.v1:{}:{}",
            input.network, device.address
        ),
    )?;
    let content = keyrings::select(&ring, &input.organization_id, &input.key_version)?;
    let derived = derive_result_key(
        content.as_ref(),
        &input.organization_id,
        &input.intent_hash,
        &input.key_version,
    )?;
    onboarding::wrap(
        derived.as_ref(),
        recipient,
        &format!(
            "fractalmind.command-result-wrap.v1:{}:{}:{}:{}:{}",
            input.organization_id,
            input.capability_id,
            input.membership_id,
            input.intent_hash,
            input.key_version
        ),
    )
}
pub(super) fn derive_result_key(
    content: &[u8],
    organization: &str,
    fingerprint: &str,
    version: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    let domain = "fractalmind.command-result-key.v1";
    let mut derived = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(domain.as_bytes()), content)
        .expand(
            format!("{domain}:{organization}:{fingerprint}:{version}").as_bytes(),
            derived.as_mut(),
        )
        .map_err(|_| VaultError::InvalidEnvelope)?;
    Ok(derived)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Vec<u8>, WrapRequest, StaticSecret) {
        let mut keys = b"FMD1".to_vec();
        keys.extend_from_slice(&[1u8; 64]);
        let device = public("test-result", &keys).unwrap();
        let org = format!("0x{}", "11".repeat(32));
        let ring = format!(
            r#"{{"format":2,"organizations":{{"{org}":{{"currentVersion":"2","contentKey":"{0}","historicalKeys":{{"1":"{1}","2":"{0}"}}}}}}}}"#,
            "aa".repeat(32),
            "bb".repeat(32)
        );
        let encrypted = onboarding::wrap(
            ring.as_bytes(),
            PublicKey::from(&StaticSecret::from([1u8; 32])).as_bytes(),
            &format!("fractalmind.device-keys.v1:localnet:{}", device.address),
        )
        .unwrap();
        let signing = SigningKey::from_bytes(&[8u8; 32])
            .verifying_key()
            .to_bytes();
        let mut hash = Blake2b::<U32>::new();
        hash.update([0u8]);
        hash.update(signing);
        let host = StaticSecret::from([9u8; 32]);
        (
            keys,
            WrapRequest {
                network: "localnet".into(),
                encrypted_keys: STANDARD.encode(encrypted),
                organization_id: org,
                capability_id: format!("0x{}", "22".repeat(32)),
                membership_id: format!("0x{}", "33".repeat(32)),
                intent_hash: "44".repeat(32),
                key_version: "2".into(),
                host_address: format!("0x{}", hex::encode(hash.finalize())),
                host_signing_public_key: STANDARD.encode(signing),
                host_encryption_public_key: STANDARD.encode(PublicKey::from(&host).as_bytes()),
            },
            host,
        )
    }
    #[test]
    fn host_receives_only_scoped_derivative_with_authenticated_wrap_context() {
        let (keys, mut input, host) = fixture();
        let recipient = input.validate().unwrap();
        let a = wrap_result(&keys, "test-result", &input, &recipient).unwrap();
        let b = wrap_result(&keys, "test-result", &input, &recipient).unwrap();
        assert_eq!(a.len(), 132);
        assert_ne!(a, b);
        let context = format!(
            "fractalmind.command-result-wrap.v1:{}:{}:{}:{}:{}",
            input.organization_id,
            input.capability_id,
            input.membership_id,
            input.intent_hash,
            input.key_version
        );
        let plain = records::unwrap(&a, &host, &context).unwrap();
        assert_eq!(
            plain.as_slice(),
            derive_result_key(&[0xaa; 32], &input.organization_id, &input.intent_hash, "2")
                .unwrap()
                .as_ref()
        );
        assert_ne!(plain.as_slice(), &[0xaa; 32]);
        assert!(records::unwrap(&a, &host, &(context.clone() + "0")).is_err());
        assert!(records::unwrap(&a, &StaticSecret::from([10u8; 32]), &context).is_err());
        input.key_version = "1".into();
        assert!(wrap_result(&keys, "test-result", &input, &recipient).is_ok());
        input.key_version = "3".into();
        assert!(wrap_result(&keys, "test-result", &input, &recipient).is_err());
        input.organization_id = format!("0x{}", "55".repeat(32));
        assert!(wrap_result(&keys, "test-result", &input, &recipient).is_err());
    }
    #[test]
    fn invalid_requests_fail_before_os_key_access() {
        let (_, input, _) = fixture();
        let vault = DeviceVault::new("org.fractalmind.app.device.test", PathBuf::new());
        let value = serde_json::json!({
            "network":input.network,"encryptedKeys":input.encrypted_keys,"organizationId":input.organization_id,
            "capabilityId":input.capability_id,"membershipId":input.membership_id,"intentHash":input.intent_hash,
            "keyVersion":input.key_version,"hostAddress":input.host_address,
            "hostSigningPublicKey":input.host_signing_public_key,"hostEncryptionPublicKey":input.host_encryption_public_key,
        });
        for (field, bad) in [
            ("network", "unknown"),
            ("organizationId", "0x1"),
            ("capabilityId", "0x2"),
            ("membershipId", "0x3"),
            ("intentHash", "not-a-hash"),
            ("keyVersion", "01"),
            ("hostAddress", "0x1"),
            ("hostSigningPublicKey", ""),
            (
                "hostEncryptionPublicKey",
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("encryptedKeys", "!"),
        ] {
            let mut bad_value = value.clone();
            bad_value[field] = bad.into();
            assert!(
                matches!(
                    vault.wrap_command_result_key("test-absent", &bad_value.to_string()),
                    Err(VaultError::InvalidEnvelope)
                ),
                "{field}"
            );
        }
        let mut extra = value;
        extra["exportKey"] = true.into();
        assert!(matches!(
            vault.wrap_command_result_key("test-absent", &extra.to_string()),
            Err(VaultError::InvalidEnvelope)
        ));
        assert!(matches!(
            vault.wrap_command_result_key("test-absent", &"x".repeat(150001)),
            Err(VaultError::InvalidEnvelope)
        ));
    }
}
