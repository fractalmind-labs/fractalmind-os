//! Only selected organization keys are sealed to the confirmed device.
//! The App checks chain authority before/after this operation; no private
//! keyring, root identity capability or recovery credential is exported.
use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShareRequest {
    network: String,
    organization_id: String,
    key_version: String,
    organization_count: usize,
    encrypted_keys: String,
    recipient_address: String,
    signing_public_key: String,
    encryption_public_key: String,
}
impl DeviceVault {
    pub fn wrap_organization_keys(&self, profile: &str, request: &str) -> Result<String> {
        if request.len() > 150_000 {
            return Err(VaultError::InvalidEnvelope);
        }
        let request: ShareRequest =
            serde_json::from_str(request).map_err(|_| VaultError::InvalidEnvelope)?;
        let keys = self.load(profile)?;
        Ok(STANDARD.encode(wrap_scoped(&keys, profile, &request)?))
    }
}
fn wrap_scoped(keys: &[u8], profile: &str, request: &ShareRequest) -> Result<Vec<u8>> {
    if !["localnet", "devnet", "testnet", "mainnet"].contains(&request.network.as_str()) {
        return Err(VaultError::InvalidEnvelope);
    }
    keyrings::id(&request.organization_id)?;
    keyrings::id(&request.recipient_address)?;
    records::positive(&request.key_version)?;
    let signing = records::encoded(&request.signing_public_key, 32)?;
    if signing.len() != 32 {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut hash = Blake2b::<U32>::new();
    hash.update([0u8]);
    hash.update(&signing);
    if request.recipient_address != format!("0x{}", hex::encode(hash.finalize())) {
        return Err(VaultError::InvalidEnvelope);
    }
    let recipient: [u8; 32] = records::encoded(&request.encryption_public_key, 32)?
        .try_into()
        .map_err(|_| VaultError::InvalidEnvelope)?;
    let device = public(profile, keys)?;
    if device.address == request.recipient_address {
        return Err(VaultError::InvalidEnvelope);
    }
    let secret = StaticSecret::from(
        <[u8; 32]>::try_from(&keys[36..68]).map_err(|_| VaultError::InvalidStoredKey)?,
    );
    let body = records::encoded(&request.encrypted_keys, 65536)?;
    let plain = records::unwrap(
        &body,
        &secret,
        &format!(
            "fractalmind.device-keys.v1:{}:{}",
            request.network, device.address
        ),
    )?;
    let scoped = keyrings::for_organization(
        &plain,
        &request.organization_id,
        &request.key_version,
        request.organization_count,
    )?;
    let selected =
        Zeroizing::new(serde_json::to_vec(&scoped).map_err(|_| VaultError::InvalidEnvelope)?);
    if selected.len() > 65436 {
        return Err(VaultError::InvalidEnvelope);
    }
    let wrapped = onboarding::wrap(
        &selected,
        &recipient,
        &format!(
            "fractalmind.device-keys.v1:{}:{}",
            request.network, request.recipient_address
        ),
    )?;
    if wrapped.len() > 65536 {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok(wrapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shares_only_selected_organization_with_exact_version_and_bound_recipient() {
        let mut keys = b"FMD1".to_vec();
        keys.extend_from_slice(&[1u8; 64]);
        let owner = public("test-share", &keys).unwrap();
        let owner_secret = StaticSecret::from([1u8; 32]);
        let org = format!("0x{}", "11".repeat(32));
        let other = format!("0x{}", "22".repeat(32));
        let ring = format!(
            r#"{{"format":2,"organizations":{{"{org}":{{"currentVersion":"2","contentKey":"{}","historicalKeys":{{"1":"{}","2":"{}"}}}},"{other}":{{"currentVersion":"1","contentKey":"{}","historicalKeys":{{"1":"{}"}}}}}}}}"#,
            "aa".repeat(32),
            "bb".repeat(32),
            "aa".repeat(32),
            "cc".repeat(32),
            "cc".repeat(32)
        );
        let wrapped = onboarding::wrap(
            ring.as_bytes(),
            PublicKey::from(&owner_secret).as_bytes(),
            &format!("fractalmind.device-keys.v1:localnet:{}", owner.address),
        )
        .unwrap();
        let signing = SigningKey::from_bytes(&[8u8; 32])
            .verifying_key()
            .to_bytes();
        let mut hash = Blake2b::<U32>::new();
        hash.update([0u8]);
        hash.update(signing);
        let address = format!("0x{}", hex::encode(hash.finalize()));
        let recipient = StaticSecret::from([7u8; 32]);
        let mut request = ShareRequest {
            network: "localnet".into(),
            organization_id: org.clone(),
            key_version: "2".into(),
            organization_count: 2,
            encrypted_keys: STANDARD.encode(wrapped),
            recipient_address: address.clone(),
            signing_public_key: STANDARD.encode(signing),
            encryption_public_key: STANDARD.encode(PublicKey::from(&recipient).as_bytes()),
        };
        let body = wrap_scoped(&keys, "test-share", &request).unwrap();
        let plain = records::unwrap(
            &body,
            &recipient,
            &format!("fractalmind.device-keys.v1:localnet:{address}"),
        )
        .unwrap();
        assert_eq!(&*keyrings::select(&plain, &org, "1").unwrap(), &[0xbb; 32]);
        assert!(keyrings::select(&plain, &other, "1").is_err());
        request.key_version = "1".into();
        assert!(wrap_scoped(&keys, "test-share", &request).is_err());
        request.key_version = "2".into();
        request.recipient_address = owner.address;
        assert!(wrap_scoped(&keys, "test-share", &request).is_err());
        request.recipient_address = address;
        request.encryption_public_key = STANDARD.encode([0u8; 32]);
        assert!(wrap_scoped(&keys, "test-share", &request).is_err());
        request.network = "unknown".into();
        assert!(wrap_scoped(&keys, "test-share", &request).is_err());
    }
}
