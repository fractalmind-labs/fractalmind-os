//! Imported recovery credentials and the one-shot replacement code stay in the
//! native OS vault. These primitives do not assert chain authority: the caller
//! must validate current RecoveryRecord/organization sources before simulation
//! and submission, and atomically rotate owned organization keys with recovery.
use super::keyrings::{OrganizationSource, Rotation, Scoped};
use super::*;
use serde::Deserialize;
use sha2::Sha256;

const IMPORTED: &[u8; 4] = b"FMR1";
const PREPARED: &[u8; 4] = b"FMR2";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryImported {
    pub format: u8,
    pub network: String,
    pub device: DevicePublic,
    pub recovery: DevicePublic,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPublic {
    pub imported: RecoveryImported,
    pub next_recovery: DevicePublic,
    pub encrypted_backup: String,
    pub encrypted_device_keys: String,
    pub source_fingerprint: String,
    pub rotations: Vec<Rotation>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPrepared {
    pub public: RecoveryPublic,
    pub recovery_code: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    chain_identifier: String,
    registry_id: String,
    human_id: String,
    recovery_record_id: String,
    recovery_version: String,
    backup_version: String,
    generation: String,
    encrypted_backup: String,
    organizations: Vec<OrganizationSource>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PreparedPayload {
    keyring: Scoped,
    rotations: Vec<Rotation>,
}
fn parse_code(code: &str, network: &str) -> Result<Zeroizing<[u8; 32]>> {
    onboarding::network_index(network)?;
    if code.len() > 100 {
        return Err(VaultError::InvalidRecovery);
    }
    let parts: Vec<_> = code.split(':').collect();
    if parts.len() != 4
        || parts[0] != "FM1"
        || parts[1] != network
        || parts[2].len() != 64
        || parts[3].len() != 8
        || !parts[2]
            .bytes()
            .chain(parts[3].bytes())
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(VaultError::InvalidRecovery);
    }
    let prefix_len = code.len() - 9;
    let checksum = hex::encode(Sha256::digest(&code.as_bytes()[..prefix_len]));
    // This is an input checksum, not an authentication tag. Chain authority and
    // authenticated backup decryption are checked separately.
    if &checksum[..8] != parts[3] {
        return Err(VaultError::InvalidRecovery);
    }
    let mut entropy = Zeroizing::new([0u8; 32]);
    hex::decode_to_slice(parts[2], entropy.as_mut()).map_err(|_| VaultError::InvalidRecovery)?;
    Ok(entropy)
}
fn code(entropy: &[u8], network: &str) -> String {
    let prefix = Zeroizing::new(format!("FM1:{network}:{}", hex::encode(entropy)));
    let checksum = hex::encode(Sha256::digest(prefix.as_bytes()));
    format!("{}:{}", prefix.as_str(), &checksum[..8])
}
fn source(request: &str) -> Result<(Source, [u8; 32])> {
    if request.len() > 150_000 {
        return Err(VaultError::InvalidEnvelope);
    }
    let input: Source = serde_json::from_str(request).map_err(|_| VaultError::InvalidEnvelope)?;
    if input.chain_identifier.is_empty()
        || input.chain_identifier.len() > 64
        || !input
            .chain_identifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric())
    {
        return Err(VaultError::InvalidEnvelope);
    }
    for value in [
        &input.registry_id,
        &input.human_id,
        &input.recovery_record_id,
    ] {
        keyrings::id(value)?;
    }
    for value in [&input.recovery_version, &input.backup_version] {
        records::positive(value)?;
    }
    let generation: u64 = input
        .generation
        .parse()
        .map_err(|_| VaultError::InvalidEnvelope)?;
    if generation.to_string() != input.generation || input.organizations.len() > 256 {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut seen = std::collections::BTreeSet::new();
    for organization in &input.organizations {
        keyrings::id(&organization.organization_id)?;
        records::positive(&organization.key_version)?;
        if !seen.insert(&organization.organization_id) {
            return Err(VaultError::InvalidEnvelope);
        }
    }
    let canonical = serde_json::to_vec(&input).map_err(|_| VaultError::InvalidEnvelope)?;
    Ok((input, Sha256::digest(&canonical).into()))
}
fn validate_stored(bytes: &[u8], network: &str) -> Result<()> {
    let index = onboarding::network_index(network)?;
    if bytes.len() < 37
        || bytes.len() > 150_000
        || (bytes.len() != 37 && (!bytes.starts_with(PREPARED) || bytes.len() < 103))
        || (bytes.len() == 37 && !bytes.starts_with(IMPORTED))
    {
        return Err(VaultError::InvalidStoredKey);
    }
    if bytes[4] != index {
        return Err(VaultError::InvalidRecovery);
    }
    if bytes.starts_with(PREPARED) {
        let payload: PreparedPayload =
            serde_json::from_slice(&bytes[101..]).map_err(|_| VaultError::InvalidStoredKey)?;
        payload
            .keyring
            .validate()
            .map_err(|_| VaultError::InvalidStoredKey)?;
        if payload.rotations.len() > 256 {
            return Err(VaultError::InvalidStoredKey);
        }
        let mut seen = std::collections::BTreeSet::new();
        for rotation in &payload.rotations {
            let old = records::positive(&rotation.old_version)
                .map_err(|_| VaultError::InvalidStoredKey)?;
            let next = records::positive(&rotation.new_version)
                .map_err(|_| VaultError::InvalidStoredKey)?;
            if old.checked_add(1) != Some(next)
                || !seen.insert(&rotation.organization_id)
                || payload
                    .keyring
                    .organizations
                    .get(&rotation.organization_id)
                    .map(|keys| &keys.current_version)
                    != Some(&rotation.new_version)
            {
                return Err(VaultError::InvalidStoredKey);
            }
        }
        if public("validation", &onboarding::derived_keys(&bytes[5..37])?)?.address
            == public("validation", &onboarding::derived_keys(&bytes[37..69])?)?.address
        {
            return Err(VaultError::InvalidStoredKey);
        }
    }
    Ok(())
}
impl DeviceVault {
    pub(super) fn recovery_entry(&self, profile: &str) -> Result<keyring::Entry> {
        validate_profile(profile)?;
        if self.service == "org.fractalmind.app.device.test" && !profile.starts_with("test-") {
            return Err(VaultError::InvalidProfile);
        }
        keyring::Entry::new(&self.service, &format!("recovery-v1-{profile}"))
            .map_err(|_| VaultError::StorageUnavailable)
    }
    pub(super) fn recovery_lock(&self, profile: &str) -> Result<std::fs::File> {
        validate_profile(profile)?;
        fs::create_dir_all(&self.locks).map_err(|_| VaultError::LockUnavailable)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.locks.join(format!("recovery-v1-{profile}.lock")))
            .map_err(|_| VaultError::LockUnavailable)?;
        lock.try_lock_exclusive()
            .map_err(|_| VaultError::LockUnavailable)?;
        Ok(lock)
    }
    fn load_recovery(&self, profile: &str, network: &str) -> Result<Zeroizing<Vec<u8>>> {
        let bytes = Zeroizing::new(self.recovery_entry(profile)?.get_secret().map_err(
            |error| match error {
                keyring::Error::NoEntry => VaultError::NotInitialized,
                _ => VaultError::StorageUnavailable,
            },
        )?);
        validate_stored(&bytes, network)?;
        Ok(bytes)
    }
    pub fn import_recovery(
        &self,
        profile: &str,
        network: &str,
        recovery_code: &str,
    ) -> Result<RecoveryImported> {
        let entropy = parse_code(recovery_code, network)?;
        let _lock = self.recovery_lock(profile)?;
        for entry in [
            self.recovery_entry(profile)?,
            self.entry(profile)?,
            self.onboarding_entry(profile)?,
        ] {
            match entry.get_secret() {
                Ok(bytes) => {
                    let _secret = Zeroizing::new(bytes);
                    return Err(VaultError::AlreadyInitialized);
                }
                Err(keyring::Error::NoEntry) => (),
                Err(_) => return Err(VaultError::StorageUnavailable),
            }
        }
        // Fresh device keys: initialize is otherwise idempotent, so reject an
        // existing device before calling it. The device lock also serializes
        // explicit initialization across processes.
        let device_lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.locks.join(format!("device-v1-{profile}.lock")))
            .map_err(|_| VaultError::LockUnavailable)?;
        device_lock
            .try_lock_exclusive()
            .map_err(|_| VaultError::LockUnavailable)?;
        match self.entry(profile)?.get_secret() {
            Ok(bytes) => {
                let _secret = Zeroizing::new(bytes);
                return Err(VaultError::AlreadyInitialized);
            }
            Err(keyring::Error::NoEntry) => (),
            Err(_) => return Err(VaultError::StorageUnavailable),
        }
        let mut device_keys = Zeroizing::new(vec![0u8; 68]);
        device_keys[..4].copy_from_slice(MAGIC);
        OsRng
            .try_fill_bytes(&mut device_keys[4..])
            .map_err(|_| VaultError::StorageUnavailable)?;
        self.entry(profile)?
            .set_secret(&device_keys)
            .map_err(|_| VaultError::StorageUnavailable)?;
        if *self.load(profile)? != *device_keys {
            return Err(VaultError::InvalidStoredKey);
        }
        let mut stored = Zeroizing::new(IMPORTED.to_vec());
        stored.push(onboarding::network_index(network)?);
        stored.extend_from_slice(entropy.as_ref());
        self.recovery_entry(profile)?
            .set_secret(&stored)
            .map_err(|_| VaultError::StorageUnavailable)?;
        if *self.load_recovery(profile, network)? != *stored {
            return Err(VaultError::InvalidStoredKey);
        }
        self.recovery_imported_public(profile, network)
    }
    pub fn recovery_imported_public(
        &self,
        profile: &str,
        network: &str,
    ) -> Result<RecoveryImported> {
        let stored = self.load_recovery(profile, network)?;
        Ok(RecoveryImported {
            format: 1,
            network: network.into(),
            device: self.public(profile)?,
            recovery: public(profile, &onboarding::derived_keys(&stored[5..37])?)?,
        })
    }
    pub fn prepare_recovery(
        &self,
        profile: &str,
        network: &str,
        request: &str,
    ) -> Result<RecoveryPrepared> {
        let (input, fingerprint) = source(request)?;
        let _lock = self.recovery_lock(profile)?;
        let stored = self.load_recovery(profile, network)?;
        if stored.starts_with(PREPARED) {
            return Err(VaultError::AlreadyInitialized);
        }
        let old_keys = onboarding::derived_keys(&stored[5..37])?;
        let old = public(profile, &old_keys)?;
        let secret = StaticSecret::from(
            <[u8; 32]>::try_from(&old_keys[36..68]).map_err(|_| VaultError::InvalidStoredKey)?,
        );
        let plaintext = records::unwrap(
            &records::encoded(&input.encrypted_backup, 65_536)?,
            &secret,
            &format!("fractalmind.recovery-backup.v1:{network}:{}", old.address),
        )?;
        let (keyring, rotations) = keyrings::rotate(&plaintext, &input.organizations)?;
        let payload = Zeroizing::new(
            serde_json::to_vec(&PreparedPayload { keyring, rotations })
                .map_err(|_| VaultError::InvalidEnvelope)?,
        );
        let mut next_entropy = Zeroizing::new([0u8; 32]);
        OsRng
            .try_fill_bytes(next_entropy.as_mut())
            .map_err(|_| VaultError::StorageUnavailable)?;
        let mut prepared = Zeroizing::new(PREPARED.to_vec());
        prepared.push(stored[4]);
        prepared.extend_from_slice(&stored[5..37]);
        prepared.extend_from_slice(next_entropy.as_ref());
        prepared.extend_from_slice(&fingerprint);
        prepared.extend_from_slice(&payload);
        // Cipher construction must succeed before replacing the imported entry.
        let public = self.recovery_output(profile, network, &prepared)?;
        self.recovery_entry(profile)?
            .set_secret(&prepared)
            .map_err(|_| VaultError::StorageUnavailable)?;
        if *self.load_recovery(profile, network)? != *prepared {
            return Err(VaultError::InvalidStoredKey);
        }
        Ok(RecoveryPrepared {
            public,
            recovery_code: code(next_entropy.as_ref(), network),
        })
    }
    pub fn recovery_prepared_public(&self, profile: &str, network: &str) -> Result<RecoveryPublic> {
        self.recovery_output(profile, network, &self.load_recovery(profile, network)?)
    }
    fn recovery_output(
        &self,
        profile: &str,
        network: &str,
        stored: &[u8],
    ) -> Result<RecoveryPublic> {
        validate_stored(stored, network)?;
        if !stored.starts_with(PREPARED) {
            return Err(VaultError::NotInitialized);
        }
        let payload: PreparedPayload =
            serde_json::from_slice(&stored[101..]).map_err(|_| VaultError::InvalidStoredKey)?;
        let keyring = Zeroizing::new(
            serde_json::to_vec(&payload.keyring).map_err(|_| VaultError::InvalidStoredKey)?,
        );
        if keyring.len() > 65_436 {
            return Err(VaultError::InvalidStoredKey);
        }
        let imported = RecoveryImported {
            format: 1,
            network: network.into(),
            device: self.public(profile)?,
            recovery: public(profile, &onboarding::derived_keys(&stored[5..37])?)?,
        };
        let next_recovery = public(profile, &onboarding::derived_keys(&stored[37..69])?)?;
        Ok(RecoveryPublic {
            encrypted_backup: STANDARD.encode(onboarding::wrap(
                &keyring,
                &onboarding::decode_public(&next_recovery.encryption_public_key)?,
                &format!(
                    "fractalmind.recovery-backup.v1:{network}:{}",
                    next_recovery.address
                ),
            )?),
            encrypted_device_keys: STANDARD.encode(onboarding::wrap(
                &keyring,
                &onboarding::decode_public(&imported.device.encryption_public_key)?,
                &format!(
                    "fractalmind.device-keys.v1:{network}:{}",
                    imported.device.address
                ),
            )?),
            imported,
            next_recovery,
            source_fingerprint: hex::encode(&stored[69..101]),
            rotations: payload.rotations,
        })
    }
    pub fn sign_recovery_transaction(
        &self,
        profile: &str,
        network: &str,
        phase: &str,
        encoded: &str,
    ) -> Result<SignedBytes> {
        let stored = self.load_recovery(profile, network)?;
        let entropy = match phase {
            "old" => &stored[5..37],
            "next" if stored.starts_with(PREPARED) => &stored[37..69],
            _ => return Err(VaultError::InvalidRecovery),
        };
        sign_transaction_keys(&onboarding::derived_keys(entropy)?, profile, encoded)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_code_is_exact_network_bound_and_reproduces_public_identity() {
        let entropy = [7u8; 32];
        let value = code(&entropy, "localnet");
        assert_eq!(*parse_code(&value, "localnet").unwrap(), entropy);
        assert_eq!(
            public(
                "a",
                &onboarding::derived_keys(parse_code(&value, "localnet").unwrap().as_ref())
                    .unwrap()
            )
            .unwrap()
            .address,
            public("b", &onboarding::derived_keys(&entropy).unwrap())
                .unwrap()
                .address
        );
        assert!(parse_code(&value, "mainnet").is_err());
        assert!(parse_code(&(value.clone() + " "), "localnet").is_err());
        assert!(parse_code(&value.to_uppercase(), "localnet").is_err());
        let mut changed = value.into_bytes();
        changed[15] = if changed[15] == b'0' { b'1' } else { b'0' };
        assert!(parse_code(std::str::from_utf8(&changed).unwrap(), "localnet").is_err());
    }
    #[test]
    fn malformed_native_recovery_entries_and_unknown_sources_are_rejected() {
        assert!(validate_stored(b"FMR1", "localnet").is_err());
        let mut stored = IMPORTED.to_vec();
        stored.push(0);
        stored.extend_from_slice(&[7; 32]);
        assert!(validate_stored(&stored, "localnet").is_ok());
        assert!(validate_stored(&stored, "mainnet").is_err());
        assert!(source("{}").is_err());
        assert!(source(&"x".repeat(150001)).is_err());
        let vault = DeviceVault::new("org.fractalmind.app.device.test", PathBuf::new());
        assert!(matches!(
            vault.recovery_entry("primary"),
            Err(VaultError::InvalidProfile)
        ));
    }
}
