//! Recovery entropy/content key never leave the OS store. The new backup code is
//! deliberately returned once after explicit creation for the Human to save.
use super::*;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use hkdf::Hkdf;
use sha2::Sha256;

const NETWORKS: [&str; 4] = ["localnet", "devnet", "testnet", "mainnet"];
const ONBOARDING_MAGIC: &[u8; 4] = b"FMO1";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPublic {
    pub format: u8,
    pub network: String,
    pub device: DevicePublic,
    pub recovery: DevicePublic,
    pub encrypted_backup: String,
    pub encrypted_device_keys: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCreated {
    pub public: OnboardingPublic,
    pub recovery_code: String,
}
impl DeviceVault {
    pub(super) fn onboarding_entry(&self, profile: &str) -> Result<keyring::Entry> {
        validate_profile(profile)?;
        if self.service == "org.fractalmind.app.device.test" && !profile.starts_with("test-") {
            return Err(VaultError::InvalidProfile);
        }
        keyring::Entry::new(&self.service, &format!("onboarding-v1-{profile}"))
            .map_err(|_| VaultError::StorageUnavailable)
    }
    fn load_onboarding(&self, profile: &str, network: &str) -> Result<Zeroizing<Vec<u8>>> {
        let index = network_index(network)?;
        let bytes = Zeroizing::new(self.onboarding_entry(profile)?.get_secret().map_err(
            |e| match e {
                keyring::Error::NoEntry => VaultError::NotInitialized,
                _ => VaultError::StorageUnavailable,
            },
        )?);
        if bytes.len() != 69 || &bytes[..4] != ONBOARDING_MAGIC {
            return Err(VaultError::InvalidStoredKey);
        }
        if bytes[4] != index {
            return Err(VaultError::InvalidRecovery);
        }
        Ok(bytes)
    }
    pub fn create_onboarding(&self, profile: &str, network: &str) -> Result<OnboardingCreated> {
        let index = network_index(network)?;
        validate_profile(profile)?;
        // Creation and recovery must never mix credentials in the same native
        // profile, including two processes racing before the vault write.
        let _workflow_lock = self.recovery_lock(profile)?;
        match self.recovery_entry(profile)?.get_secret() {
            Ok(bytes) => {
                let _secret = Zeroizing::new(bytes);
                return Err(VaultError::AlreadyInitialized);
            }
            Err(keyring::Error::NoEntry) => (),
            Err(_) => return Err(VaultError::StorageUnavailable),
        }
        // Explicit device initialization; a malformed or locked key is never replaced.
        self.initialize(profile)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.locks.join(format!("onboarding-v1-{profile}.lock")))
            .map_err(|_| VaultError::LockUnavailable)?;
        lock.try_lock_exclusive()
            .map_err(|_| VaultError::LockUnavailable)?;
        match self.onboarding_entry(profile)?.get_secret() {
            Ok(bytes) => {
                let _stored = Zeroizing::new(bytes);
                return Err(VaultError::AlreadyInitialized);
            }
            Err(keyring::Error::NoEntry) => (),
            Err(_) => return Err(VaultError::StorageUnavailable),
        }
        let mut stored = Zeroizing::new(vec![0u8; 69]);
        stored[..4].copy_from_slice(ONBOARDING_MAGIC);
        stored[4] = index;
        OsRng
            .try_fill_bytes(&mut stored[5..])
            .map_err(|_| VaultError::StorageUnavailable)?;
        // Build both encrypted envelopes before storing/returning the one-shot code.
        let public = self.onboarding_output(profile, network, &stored)?;
        self.onboarding_entry(profile)?
            .set_secret(&stored)
            .map_err(|_| VaultError::StorageUnavailable)?;
        if *self.load_onboarding(profile, network)? != *stored {
            return Err(VaultError::InvalidStoredKey);
        }
        Ok(OnboardingCreated {
            public,
            recovery_code: recovery_code(network, &stored),
        })
    }
    /// Shows the setup's recovery code again. The App offers this only while
    /// the Human is not yet on chain, so an interrupted setup does not lose
    /// the one code; it requires the unlocked device session.
    pub fn reveal_onboarding_code(&self, profile: &str, network: &str) -> Result<String> {
        self.load(profile)?;
        Ok(recovery_code(
            network,
            &self.load_onboarding(profile, network)?,
        ))
    }
    pub fn onboarding_public(&self, profile: &str, network: &str) -> Result<OnboardingPublic> {
        self.onboarding_output(profile, network, &self.load_onboarding(profile, network)?)
    }
    fn onboarding_output(
        &self,
        profile: &str,
        network: &str,
        stored: &[u8],
    ) -> Result<OnboardingPublic> {
        let recovery_keys = derived_keys(&stored[5..37])?;
        let recovery = public(profile, &recovery_keys)?;
        let device = self.public(profile)?;
        let key = Zeroizing::new(hex::encode(&stored[37..69]));
        let keyring = Zeroizing::new(
            format!(
                "{{\"format\":1,\"contentKey\":\"{}\",\"historicalKeys\":{{\"1\":\"{}\"}}}}",
                key.as_str(),
                key.as_str()
            )
            .into_bytes(),
        );
        Ok(OnboardingPublic {
            format: 1,
            network: network.into(),
            encrypted_backup: STANDARD.encode(wrap(
                &keyring,
                &decode_public(&recovery.encryption_public_key)?,
                &format!(
                    "fractalmind.recovery-backup.v1:{network}:{}",
                    recovery.address
                ),
            )?),
            encrypted_device_keys: STANDARD.encode(wrap(
                &keyring,
                &decode_public(&device.encryption_public_key)?,
                &format!("fractalmind.device-keys.v1:{network}:{}", device.address),
            )?),
            device,
            recovery,
        })
    }
    pub fn sign_onboarding_transaction(
        &self,
        profile: &str,
        network: &str,
        encoded: &str,
    ) -> Result<SignedBytes> {
        let stored = self.load_onboarding(profile, network)?;
        sign_transaction_keys(&derived_keys(&stored[5..37])?, profile, encoded)
    }
}
/// The one recovery code for a setup: network, recovery entropy and checksum.
fn recovery_code(network: &str, stored: &[u8]) -> String {
    let prefix = Zeroizing::new(format!("FM1:{network}:{}", hex::encode(&stored[5..37])));
    let checksum = hex::encode(Sha256::digest(prefix.as_bytes()));
    format!("{}:{}", prefix.as_str(), &checksum[..8])
}
pub(super) fn network_index(network: &str) -> Result<u8> {
    NETWORKS
        .iter()
        .position(|n| *n == network)
        .map(|n| n as u8)
        .ok_or(VaultError::InvalidRecovery)
}
pub(super) fn derived_keys(entropy: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if entropy.len() != 32 {
        return Err(VaultError::InvalidRecovery);
    }
    let mut keys = Zeroizing::new(vec![0u8; 68]);
    keys[..4].copy_from_slice(MAGIC);
    let hk = Hkdf::<Sha256>::new(Some(b"fractalmind.recovery.v1"), entropy);
    hk.expand(b"signing", &mut keys[4..36])
        .map_err(|_| VaultError::InvalidRecovery)?;
    hk.expand(b"encryption", &mut keys[36..68])
        .map_err(|_| VaultError::InvalidRecovery)?;
    Ok(keys)
}
pub(super) fn decode_public(value: &str) -> Result<[u8; 32]> {
    STANDARD
        .decode(value)
        .map_err(|_| VaultError::InvalidEnvelope)?
        .try_into()
        .map_err(|_| VaultError::InvalidEnvelope)
}
pub(super) fn wrap(plaintext: &[u8], recipient: &[u8; 32], context: &str) -> Result<Vec<u8>> {
    if plaintext.len() > 65536 || context.is_empty() || context.len() > 1024 {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut entropy = Zeroizing::new([0u8; 32]);
    OsRng
        .try_fill_bytes(entropy.as_mut())
        .map_err(|_| VaultError::StorageUnavailable)?;
    let secret = StaticSecret::from(*entropy);
    let ephemeral_public = PublicKey::from(&secret);
    let shared = secret.diffie_hellman(&PublicKey::from(*recipient));
    if !shared.was_contributory() {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut salt = [0u8; 32];
    let mut nonce = [0u8; 12];
    OsRng
        .try_fill_bytes(&mut salt)
        .map_err(|_| VaultError::StorageUnavailable)?;
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|_| VaultError::StorageUnavailable)?;
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes())
        .expand(
            format!("fractalmind.key-wrap.v1:{context}").as_bytes(),
            key.as_mut(),
        )
        .map_err(|_| VaultError::InvalidEnvelope)?;
    let cipher =
        Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| VaultError::InvalidEnvelope)?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| VaultError::InvalidEnvelope)?;
    let mut result = b"FMW1".to_vec();
    result.extend_from_slice(ephemeral_public.as_bytes());
    result.extend_from_slice(&salt);
    result.extend_from_slice(b"FME1");
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&encrypted);
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_code_is_checksummed_and_stable() {
        let mut stored = vec![0u8; 69];
        stored[5..37].copy_from_slice(&[0xab; 32]);
        let code = recovery_code("localnet", &stored);
        let parts: Vec<_> = code.split(':').collect();
        assert_eq!(parts.len(), 4);
        assert_eq!((parts[0], parts[1]), ("FM1", "localnet"));
        assert_eq!(parts[2], "ab".repeat(32));
        let prefix = format!("FM1:localnet:{}", parts[2]);
        assert_eq!(
            parts[3],
            &hex::encode(Sha256::digest(prefix.as_bytes()))[..8]
        );
        assert_eq!(recovery_code("localnet", &stored), code);
        assert_ne!(recovery_code("devnet", &stored), code);
    }
    #[test]
    fn revealing_the_code_needs_an_unlocked_session() {
        let vault = DeviceVault::new("org.fractalmind.app.device.test", std::path::PathBuf::new());
        assert_eq!(
            vault.reveal_onboarding_code("test-a", "localnet"),
            Err(VaultError::Locked)
        );
    }
    #[test]
    fn recovery_domains_are_network_bounded_and_reproducible() {
        let entropy = [7u8; 32];
        assert_eq!(
            *derived_keys(&entropy).unwrap(),
            *derived_keys(&entropy).unwrap()
        );
        assert_ne!(
            &derived_keys(&entropy).unwrap()[4..36],
            &derived_keys(&entropy).unwrap()[36..68]
        );
        assert!(network_index("localnet").is_ok());
        assert!(network_index("elsewhere").is_err());
    }
    #[test]
    fn key_wrap_rejects_low_order_keys_and_is_randomized() {
        assert!(wrap(b"keyring", &[0; 32], "context").is_err());
        let secret = StaticSecret::from([9u8; 32]);
        let recipient = PublicKey::from(&secret);
        let a = wrap(b"keyring", recipient.as_bytes(), "context").unwrap();
        let b = wrap(b"keyring", recipient.as_bytes(), "context").unwrap();
        assert_ne!(a, b);
        assert_eq!(&a[..4], b"FMW1");
        assert_eq!(&a[68..72], b"FME1");
        let shared =
            secret.diffie_hellman(&PublicKey::from(<[u8; 32]>::try_from(&a[4..36]).unwrap()));
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(Some(&a[36..68]), shared.as_bytes())
            .expand(b"fractalmind.key-wrap.v1:context", &mut key)
            .unwrap();
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        assert_eq!(
            cipher
                .decrypt(
                    Nonce::from_slice(&a[72..84]),
                    Payload {
                        msg: &a[84..],
                        aad: b"context"
                    }
                )
                .unwrap(),
            b"keyring"
        );
        assert!(cipher
            .decrypt(
                Nonce::from_slice(&a[72..84]),
                Payload {
                    msg: &a[84..],
                    aad: b"wrong"
                }
            )
            .is_err());
        let mut corrupt = a.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(cipher
            .decrypt(
                Nonce::from_slice(&corrupt[72..84]),
                Payload {
                    msg: &corrupt[84..],
                    aad: b"context"
                }
            )
            .is_err());
    }
}
