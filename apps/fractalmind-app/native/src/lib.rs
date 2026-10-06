//! Device-local private keys only. Human, grants and all persistent product
//! state remain on Sui. This crate never exports private keys or uses a secret
//! file fallback. Signing is not authorization or fee approval on its own.

use base64::{engine::general_purpose::STANDARD, Engine};
use blake2::{digest::consts::U32, Blake2b, Digest};
use ed25519_dalek::{Signer, SigningKey};
use fs2::FileExt;
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime},
};
use sui_sdk_types::{Transaction, TransactionKind};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

mod command_results;
mod keyrings;
mod node_command;
mod onboarding;
mod pairing;
mod records;
mod recovery;
mod storage;
pub use onboarding::{OnboardingCreated, OnboardingPublic};
pub use records::RecordRequest;
pub use recovery::{RecoveryImported, RecoveryPrepared, RecoveryPublic};
use storage as keyring;

pub const DEVICE_SERVICE: &str = "org.fractalmind.app.device";
/// Default idle time before an unlocked session is dropped.
pub const DEFAULT_IDLE_TIMEOUT_MS: u64 = 15 * 60 * 1000;
pub const MIN_IDLE_TIMEOUT_MS: u64 = 60 * 1000;
pub const MAX_IDLE_TIMEOUT_MS: u64 = 4 * 60 * 60 * 1000;
const MAGIC: &[u8; 4] = b"FMD1";
const MAX_TRANSACTION: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    InvalidProfile,
    AlreadyInitialized,
    InvalidRecovery,
    InvalidEnvelope,
    NotInitialized,
    StorageUnavailable,
    InvalidStoredKey,
    LockUnavailable,
    InvalidTransaction,
    WrongSender,
    WrongGasOwner,
    UnsupportedTransaction,
    InvalidProof,
    InvalidNodeCommand,
    /// No unlocked session: unlock reads the OS store once, then operations
    /// use the in-memory session until it is locked or idles out.
    Locked,
    InvalidTimeout,
}
impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}
impl std::error::Error for VaultError {}
type Result<T> = std::result::Result<T, VaultError>;

#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevicePublic {
    pub format: u8,
    pub profile: String,
    pub address: String,
    pub signing_public_key: String,
    pub encryption_public_key: String,
}
/// Whether a profile has an unlocked session. Never contains key material.
#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub profile: String,
    pub unlocked: bool,
    pub idle_timeout_ms: u64,
    pub remaining_ms: u64,
}
/// Device keys held in native memory after one OS-store read. Zeroized when
/// dropped (lock, idle timeout, replacement or process exit).
struct Session {
    keys: Zeroizing<Vec<u8>>,
    used: Instant,
    used_wall: SystemTime,
}
impl Session {
    fn new(keys: Zeroizing<Vec<u8>>) -> Self {
        Self {
            keys,
            used: Instant::now(),
            used_wall: SystemTime::now(),
        }
    }
    fn touch(&mut self) {
        self.used = Instant::now();
        self.used_wall = SystemTime::now();
    }
    /// The monotonic clock may pause while the machine sleeps, so the larger of
    /// monotonic and wall-clock idle time counts. A wall clock moved backwards
    /// is treated as expired rather than extending the session.
    fn idle(&self) -> Duration {
        match SystemTime::now().duration_since(self.used_wall) {
            Ok(wall) => self.used.elapsed().max(wall),
            Err(_) => Duration::MAX,
        }
    }
}
#[derive(Serialize)]
pub struct SignedBytes {
    pub bytes: String,
    pub signature: String,
}

/// An OS store is explicit: disabled/locked/unavailable stores fail closed.
/// The service and cache directory are native host configuration, not IPC args.
pub struct DeviceVault {
    service: String,
    locks: PathBuf,
    sessions: Mutex<HashMap<String, Session>>,
    idle_timeout_ms: AtomicU64,
}
impl DeviceVault {
    pub fn new(service: &str, locks: PathBuf) -> Self {
        Self {
            service: service.into(),
            locks,
            sessions: Mutex::new(HashMap::new()),
            idle_timeout_ms: AtomicU64::new(DEFAULT_IDLE_TIMEOUT_MS),
        }
    }
    fn sessions(&self) -> MutexGuard<'_, HashMap<String, Session>> {
        // A panic while holding the map cannot leave keys usable in a broken
        // state: recover the guard and drop every session.
        self.sessions.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            guard.clear();
            guard
        })
    }
    fn idle_timeout(&self) -> Duration {
        Duration::from_millis(self.idle_timeout_ms.load(Ordering::Relaxed))
    }
    fn start_session(&self, profile: &str, keys: Zeroizing<Vec<u8>>) {
        self.sessions().insert(profile.into(), Session::new(keys));
    }
    /// Reads the OS credential store once and keeps the device keys in native
    /// memory. This is the only path that reads device keys for normal use.
    pub fn unlock(&self, profile: &str) -> Result<DevicePublic> {
        let keys = self.read_stored(profile)?;
        let public = public(profile, &keys)?;
        self.start_session(profile, keys);
        Ok(public)
    }
    /// Drops one profile's session, or every session when `profile` is None.
    pub fn lock(&self, profile: Option<&str>) -> Result<()> {
        match profile {
            Some(profile) => {
                validate_profile(profile)?;
                self.sessions().remove(profile);
            }
            None => self.sessions().clear(),
        }
        Ok(())
    }
    /// Reports the session without reading the OS store or extending it.
    pub fn session_status(&self, profile: &str) -> Result<SessionStatus> {
        validate_profile(profile)?;
        let timeout = self.idle_timeout();
        let mut sessions = self.sessions();
        let remaining = match sessions.get(profile) {
            Some(session) => timeout.checked_sub(session.idle()).filter(|d| !d.is_zero()),
            None => None,
        };
        if remaining.is_none() {
            sessions.remove(profile);
        }
        Ok(SessionStatus {
            profile: profile.into(),
            unlocked: remaining.is_some(),
            idle_timeout_ms: timeout.as_millis() as u64,
            remaining_ms: remaining.map_or(0, |d| d.as_millis() as u64),
        })
    }
    /// Records user activity so an attended session does not idle out.
    pub fn touch(&self, profile: &str) -> Result<SessionStatus> {
        validate_profile(profile)?;
        {
            let timeout = self.idle_timeout();
            let mut sessions = self.sessions();
            match sessions.get_mut(profile) {
                Some(session) if session.idle() < timeout => session.touch(),
                Some(_) => {
                    sessions.remove(profile);
                    return Err(VaultError::Locked);
                }
                None => return Err(VaultError::Locked),
            }
        }
        self.session_status(profile)
    }
    pub fn set_idle_timeout(&self, ms: u64) -> Result<u64> {
        if !(MIN_IDLE_TIMEOUT_MS..=MAX_IDLE_TIMEOUT_MS).contains(&ms) {
            return Err(VaultError::InvalidTimeout);
        }
        self.idle_timeout_ms.store(ms, Ordering::Relaxed);
        Ok(ms)
    }
    fn entry(&self, profile: &str) -> Result<keyring::Entry> {
        validate_profile(profile)?;
        if self.service == "org.fractalmind.app.device.test" && !profile.starts_with("test-") {
            return Err(VaultError::InvalidProfile);
        }
        keyring::Entry::new(&self.service, &format!("device-v1-{profile}"))
            .map_err(|_| VaultError::StorageUnavailable)
    }
    /// Device keys from the unlocked session. Never falls back to the OS store:
    /// a locked or idle session stays locked until `unlock`.
    fn load(&self, profile: &str) -> Result<Zeroizing<Vec<u8>>> {
        validate_profile(profile)?;
        let timeout = self.idle_timeout();
        let mut sessions = self.sessions();
        match sessions.get_mut(profile) {
            Some(session) if session.idle() < timeout => {
                session.touch();
                Ok(session.keys.clone())
            }
            Some(_) => {
                sessions.remove(profile);
                Err(VaultError::Locked)
            }
            None => Err(VaultError::Locked),
        }
    }
    /// One read of the OS credential store (unlock and integrity readbacks).
    fn read_stored(&self, profile: &str) -> Result<Zeroizing<Vec<u8>>> {
        let bytes = Zeroizing::new(self.entry(profile)?.get_secret().map_err(
            |error| match error {
                keyring::Error::NoEntry => VaultError::NotInitialized,
                _ => VaultError::StorageUnavailable,
            },
        )?);
        validate_keys(&bytes)?;
        Ok(bytes)
    }
    pub fn public(&self, profile: &str) -> Result<DevicePublic> {
        public(profile, &self.load(profile)?)
    }
    pub fn initialize(&self, profile: &str) -> Result<DevicePublic> {
        validate_profile(profile)?;
        fs::create_dir_all(&self.locks).map_err(|_| VaultError::LockUnavailable)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.locks.join(format!("device-v1-{profile}.lock")))
            .map_err(|_| VaultError::LockUnavailable)?;
        // The file contains no keys or product state. The OS releases its lock
        // on a process crash. Callers may explicitly retry a busy initializer.
        lock.try_lock_exclusive()
            .map_err(|_| VaultError::LockUnavailable)?;
        match self.read_stored(profile) {
            Ok(keys) => {
                let public = public(profile, &keys)?;
                self.start_session(profile, keys);
                return Ok(public);
            }
            Err(VaultError::NotInitialized) => (),
            Err(error) => return Err(error),
        }
        let mut keys = Zeroizing::new(vec![0u8; 68]);
        keys[..4].copy_from_slice(MAGIC);
        OsRng
            .try_fill_bytes(&mut keys[4..])
            .map_err(|_| VaultError::StorageUnavailable)?;
        self.entry(profile)?
            .set_secret(&keys)
            .map_err(|_| VaultError::StorageUnavailable)?;
        let readback = self.read_stored(profile)?;
        if *keys != *readback {
            return Err(VaultError::InvalidStoredKey);
        }
        let public = public(profile, &readback)?;
        self.start_session(profile, readback);
        Ok(public)
    }
    pub fn sign_transaction(&self, profile: &str, encoded: &str) -> Result<SignedBytes> {
        sign_transaction_keys(&self.load(profile)?, profile, encoded)
    }
    /// Only the bounded FractalMind possession challenge is supported. This is
    /// not a general wallet personal-message signing endpoint.
    pub fn prove_device(&self, profile: &str, challenge: &str, now_ms: u64) -> Result<SignedBytes> {
        validate_proof(challenge, now_ms)?;
        let payload =
            bcs::to_bytes(&challenge.as_bytes().to_vec()).map_err(|_| VaultError::InvalidProof)?;
        let mut hasher = Blake2b::<U32>::new();
        hasher.update([3, 0, 0]);
        hasher.update(payload);
        Ok(SignedBytes {
            bytes: STANDARD.encode(challenge.as_bytes()),
            signature: sign(&self.load(profile)?, &hasher.finalize())?,
        })
    }
    /// Native integration fixtures use a separate service and test-* profile.
    /// This is deliberately not a WebView command.
    pub fn remove_test_profile(&self, profile: &str) -> Result<()> {
        if self.service != "org.fractalmind.app.device.test" || !profile.starts_with("test-") {
            return Err(VaultError::InvalidProfile);
        }
        for entry in [
            self.entry(profile)?,
            self.onboarding_entry(profile)?,
            self.recovery_entry(profile)?,
        ] {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => (),
                Err(_) => return Err(VaultError::StorageUnavailable),
            }
        }
        Ok(())
    }
}
fn sign_transaction_keys(keys: &[u8], profile: &str, encoded: &str) -> Result<SignedBytes> {
    if encoded.len() > (MAX_TRANSACTION + 2) / 3 * 4 {
        return Err(VaultError::InvalidTransaction);
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| VaultError::InvalidTransaction)?;
    if bytes.is_empty() || bytes.len() > MAX_TRANSACTION || STANDARD.encode(&bytes) != encoded {
        return Err(VaultError::InvalidTransaction);
    }
    let transaction: Transaction =
        bcs::from_bytes(&bytes).map_err(|_| VaultError::InvalidTransaction)?;
    if bcs::to_bytes(&transaction).map_err(|_| VaultError::InvalidTransaction)? != bytes {
        return Err(VaultError::InvalidTransaction);
    }
    if !matches!(
        transaction.kind,
        TransactionKind::ProgrammableTransaction(_)
    ) {
        return Err(VaultError::UnsupportedTransaction);
    }
    let address = public(profile, keys)?.address;
    if transaction.sender.to_string() != address {
        return Err(VaultError::WrongSender);
    }
    if transaction.gas_payment.owner.to_string() != address {
        return Err(VaultError::WrongGasOwner);
    }
    Ok(SignedBytes {
        bytes: encoded.into(),
        signature: sign(keys, &transaction.signing_digest())?,
    })
}
fn validate_profile(profile: &str) -> Result<()> {
    if profile.is_empty()
        || profile.len() > 64
        || !profile.as_bytes()[0].is_ascii_alphanumeric()
        || !profile
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(VaultError::InvalidProfile);
    }
    Ok(())
}
fn validate_keys(bytes: &[u8]) -> Result<()> {
    if bytes.len() != 68 || &bytes[..4] != MAGIC {
        return Err(VaultError::InvalidStoredKey);
    }
    Ok(())
}
fn signing_key(bytes: &[u8]) -> Result<SigningKey> {
    validate_keys(bytes)?;
    let seed = Zeroizing::new(
        <[u8; 32]>::try_from(&bytes[4..36]).map_err(|_| VaultError::InvalidStoredKey)?,
    );
    Ok(SigningKey::from_bytes(&seed))
}
fn public(profile: &str, bytes: &[u8]) -> Result<DevicePublic> {
    let signing = signing_key(bytes)?.verifying_key().to_bytes();
    let secret = StaticSecret::from(
        <[u8; 32]>::try_from(&bytes[36..68]).map_err(|_| VaultError::InvalidStoredKey)?,
    );
    let encryption = PublicKey::from(&secret);
    let mut hash = Blake2b::<U32>::new();
    hash.update([0]);
    hash.update(signing);
    Ok(DevicePublic {
        format: 1,
        profile: profile.into(),
        address: format!("0x{}", hex::encode(hash.finalize())),
        signing_public_key: STANDARD.encode(signing),
        encryption_public_key: STANDARD.encode(encryption.as_bytes()),
    })
}
fn sign(bytes: &[u8], digest: &[u8]) -> Result<String> {
    let key = signing_key(bytes)?;
    let mut signature = Vec::with_capacity(97);
    signature.push(0);
    signature.extend_from_slice(&key.sign(digest).to_bytes());
    signature.extend_from_slice(&key.verifying_key().to_bytes());
    Ok(STANDARD.encode(signature))
}
fn validate_proof(challenge: &str, now_ms: u64) -> Result<()> {
    if challenge.len() > 512 {
        return Err(VaultError::InvalidProof);
    }
    let parts: Vec<_> = challenge.split(':').collect();
    let valid_id = |s: &str| {
        s.len() == 66
            && s.starts_with("0x")
            && s[2..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    };
    if parts.len() != 7
        || parts[0] != "FM-DEVICE-PROOF"
        || parts[1] != "1"
        || parts[2].is_empty()
        || parts[2].len() > 64
        || !parts[2].bytes().all(|b| b.is_ascii_alphanumeric())
        || !valid_id(parts[3])
        || !valid_id(parts[4])
        || parts[5].len() != 32
        || !parts[5]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(VaultError::InvalidProof);
    }
    let expires: u64 = parts[6].parse().map_err(|_| VaultError::InvalidProof)?;
    if expires.to_string() != parts[6] {
        return Err(VaultError::InvalidProof);
    }
    if expires <= now_ms || expires - now_ms > 120_000 {
        return Err(VaultError::InvalidProof);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_vault_never_accepts_production_profile_names() {
        let vault = DeviceVault::new("org.fractalmind.app.device.test", PathBuf::new());
        assert!(matches!(
            vault.entry("primary"),
            Err(VaultError::InvalidProfile)
        ));
        assert!(matches!(
            vault.onboarding_entry("primary"),
            Err(VaultError::InvalidProfile)
        ));
    }
    fn test_keys() -> Zeroizing<Vec<u8>> {
        let mut keys = Zeroizing::new(vec![7u8; 68]);
        keys[..4].copy_from_slice(MAGIC);
        keys
    }
    fn test_vault() -> DeviceVault {
        DeviceVault::new("org.fractalmind.app.device.test", PathBuf::new())
    }
    #[test]
    fn operations_are_locked_until_a_session_starts() {
        let vault = test_vault();
        assert_eq!(vault.load("test-a").err(), Some(VaultError::Locked));
        assert_eq!(vault.public("test-a").err(), Some(VaultError::Locked));
        assert_eq!(vault.touch("test-a").err(), Some(VaultError::Locked));
        assert!(!vault.session_status("test-a").unwrap().unlocked);
        vault.start_session("test-a", test_keys());
        assert_eq!(*vault.load("test-a").unwrap(), *test_keys());
        assert!(vault.public("test-a").is_ok());
        // Sessions are per profile.
        assert_eq!(vault.load("test-b").err(), Some(VaultError::Locked));
    }
    #[test]
    fn lock_drops_one_or_every_session() {
        let vault = test_vault();
        vault.start_session("test-a", test_keys());
        vault.start_session("test-b", test_keys());
        vault.lock(Some("test-a")).unwrap();
        assert_eq!(vault.load("test-a").err(), Some(VaultError::Locked));
        assert!(vault.load("test-b").is_ok());
        vault.lock(None).unwrap();
        assert_eq!(vault.load("test-b").err(), Some(VaultError::Locked));
        assert!(vault.sessions().is_empty());
        assert_eq!(vault.lock(Some("../x")), Err(VaultError::InvalidProfile));
    }
    #[test]
    fn idle_sessions_expire_and_are_removed() {
        let vault = test_vault();
        vault.idle_timeout_ms.store(20, Ordering::Relaxed);
        vault.start_session("test-a", test_keys());
        assert!(vault.load("test-a").is_ok());
        std::thread::sleep(Duration::from_millis(40));
        assert!(!vault.session_status("test-a").unwrap().unlocked);
        assert_eq!(vault.load("test-a").err(), Some(VaultError::Locked));
        assert!(vault.sessions().is_empty());
    }
    #[test]
    fn sleep_and_clock_changes_do_not_extend_a_session() {
        let vault = test_vault();
        vault.start_session("test-a", test_keys());
        // Monotonic time may pause during sleep; wall-clock idle still counts.
        vault.sessions().get_mut("test-a").unwrap().used_wall =
            SystemTime::now() - Duration::from_millis(DEFAULT_IDLE_TIMEOUT_MS + 1);
        assert_eq!(vault.load("test-a").err(), Some(VaultError::Locked));
        // A wall clock moved backwards expires the session.
        vault.start_session("test-a", test_keys());
        vault.sessions().get_mut("test-a").unwrap().used_wall =
            SystemTime::now() + Duration::from_secs(3600);
        assert_eq!(vault.touch("test-a").err(), Some(VaultError::Locked));
    }
    #[test]
    fn status_does_not_extend_and_touch_does() {
        let vault = test_vault();
        vault.start_session("test-a", test_keys());
        vault.sessions().get_mut("test-a").unwrap().used_wall =
            SystemTime::now() - Duration::from_secs(60);
        let before = vault.session_status("test-a").unwrap();
        assert!(before.unlocked && before.remaining_ms <= DEFAULT_IDLE_TIMEOUT_MS - 59_000);
        let after = vault.touch("test-a").unwrap();
        assert!(after.remaining_ms > before.remaining_ms);
    }
    #[test]
    fn idle_timeout_is_bounded() {
        let vault = test_vault();
        assert_eq!(vault.set_idle_timeout(0), Err(VaultError::InvalidTimeout));
        assert_eq!(
            vault.set_idle_timeout(MAX_IDLE_TIMEOUT_MS + 1),
            Err(VaultError::InvalidTimeout)
        );
        assert_eq!(vault.set_idle_timeout(5 * 60 * 1000), Ok(5 * 60 * 1000));
        assert_eq!(
            vault.session_status("test-a").unwrap().idle_timeout_ms,
            5 * 60 * 1000
        );
    }
    #[test]
    fn profiles_are_bounded_native_accounts() {
        for profile in ["", "../key", "key/path", "space key", "-first"] {
            assert_eq!(validate_profile(profile), Err(VaultError::InvalidProfile));
        }
        assert!(validate_profile("primary-1").is_ok());
    }
    #[test]
    fn malformed_keys_are_not_replaced() {
        assert_eq!(validate_keys(&[0; 68]), Err(VaultError::InvalidStoredKey));
        assert_eq!(validate_keys(b"FMD1"), Err(VaultError::InvalidStoredKey));
    }
    #[test]
    fn proofs_are_scoped_and_expire() {
        let proof = format!(
            "FM-DEVICE-PROOF:1:localChain:{}:{}:{}:120001",
            "0x".to_owned() + &"1".repeat(64),
            "0x".to_owned() + &"2".repeat(64),
            "3".repeat(32)
        );
        assert!(validate_proof(&proof, 1).is_ok());
        assert_eq!(validate_proof(&proof, 0), Err(VaultError::InvalidProof));
        assert_eq!(
            validate_proof(&proof, 120001),
            Err(VaultError::InvalidProof)
        );
        assert_eq!(
            validate_proof("please-sign-a-wallet-login", 1),
            Err(VaultError::InvalidProof)
        );
    }
}
