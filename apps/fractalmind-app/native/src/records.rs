//! Authenticated product bodies only. Unwrapped keyrings and content keys never
//! cross the native boundary. Chain authorization is independently checked by
//! the App before/after each operation; this primitive does not assert chain roles.
use super::*;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use hkdf::Hkdf;
use serde::Deserialize;
use sha2::Sha256;
use zeroize::Zeroize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRequest {
    pub network: String,
    pub encrypted_keys: String,
    pub organization_id: String,
    pub kind: u8,
    pub logical_id: String,
    pub revision: String,
    pub key_version: String,
    pub encrypted_body: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WriteRequest {
    network: String,
    encrypted_keys: String,
    organization_id: String,
    kind: u8,
    logical_id: String,
    revision: String,
    key_version: String,
    plaintext: String,
}
impl Drop for WriteRequest {
    fn drop(&mut self) {
        self.plaintext.zeroize();
    }
}
impl DeviceVault {
    pub fn encrypt_record(&self, profile: &str, request: &str) -> Result<String> {
        if request.len() > 200_000 {
            return Err(VaultError::InvalidEnvelope);
        }
        let input: WriteRequest =
            serde_json::from_str(request).map_err(|_| VaultError::InvalidEnvelope)?;
        let header = RecordRequest {
            network: input.network.clone(),
            encrypted_keys: input.encrypted_keys.clone(),
            organization_id: input.organization_id.clone(),
            kind: input.kind,
            logical_id: input.logical_id.clone(),
            revision: input.revision.clone(),
            key_version: input.key_version.clone(),
            encrypted_body: String::new(),
        };
        let plaintext = Zeroizing::new(encoded(&input.plaintext, 65504)?);
        let (key, context) = content_material(&self.load(profile)?, profile, &header)?;
        Ok(STANDARD.encode(seal_body(&plaintext, key.as_ref(), &context)?))
    }
    pub fn decrypt_record(&self, profile: &str, request: &str) -> Result<String> {
        if request.len() > 200_000 {
            return Err(VaultError::InvalidEnvelope);
        }
        let input: RecordRequest =
            serde_json::from_str(request).map_err(|_| VaultError::InvalidEnvelope)?;
        let stored = self.load(profile)?;
        Ok(STANDARD.encode(decrypt(&stored, profile, &input)?.as_slice()))
    }
}
pub(super) fn positive(value: &str) -> Result<u64> {
    let parsed: u64 = value.parse().map_err(|_| VaultError::InvalidEnvelope)?;
    if parsed == 0 || parsed.to_string() != value {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok(parsed)
}
pub(super) fn encoded(value: &str, max: usize) -> Result<Vec<u8>> {
    if value.len() > max.div_ceil(3) * 4 {
        return Err(VaultError::InvalidEnvelope);
    }
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| VaultError::InvalidEnvelope)?;
    if bytes.len() > max || STANDARD.encode(&bytes) != value {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok(bytes)
}
fn content_material(
    keys: &[u8],
    profile: &str,
    input: &RecordRequest,
) -> Result<(Zeroizing<[u8; 32]>, String)> {
    validate_keys(keys)?;
    if !["localnet", "devnet", "testnet", "mainnet"].contains(&input.network.as_str())
        || !(1..=7).contains(&input.kind)
        || input.logical_id.is_empty()
        || input.logical_id.len() > 128
        || input.organization_id.len() != 66
        || !input.organization_id.starts_with("0x")
        || !input.organization_id[2..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(VaultError::InvalidEnvelope);
    }
    positive(&input.revision)?;
    positive(&input.key_version)?;
    let device = public(profile, keys)?;
    let wrapped = encoded(&input.encrypted_keys, 65536 + 100)?;
    let secret = StaticSecret::from(
        <[u8; 32]>::try_from(&keys[36..68]).map_err(|_| VaultError::InvalidStoredKey)?,
    );
    let plaintext = unwrap(
        &wrapped,
        &secret,
        &format!(
            "fractalmind.device-keys.v1:{}:{}",
            input.network, device.address
        ),
    )?;
    let content_key =
        super::keyrings::select(&plaintext, &input.organization_id, &input.key_version)?;
    let context = format!(
        "fractalmind.product-record.v1:{}:{}:{}:{}:{}",
        input.organization_id,
        input.kind,
        serde_json::to_string(&input.logical_id).map_err(|_| VaultError::InvalidEnvelope)?,
        input.revision,
        input.key_version
    );
    Ok((content_key, context))
}
fn decrypt(keys: &[u8], profile: &str, input: &RecordRequest) -> Result<Zeroizing<Vec<u8>>> {
    let (content_key, context) = content_material(keys, profile, input)?;
    let body = encoded(&input.encrypted_body, 65536)?;
    if body.starts_with(b"FME2") {
        if input.kind != 5
            || input.logical_id.len() != 72
            || !input.logical_id.starts_with("command-")
            || !input.logical_id[8..]
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(VaultError::InvalidEnvelope);
        }
        let derived = super::command_results::derive_result_key(
            content_key.as_ref(),
            &input.organization_id,
            &input.logical_id[8..],
            &input.key_version,
        )?;
        open_body(&body, derived.as_ref(), &context, b"FME2")
    } else {
        open_body(&body, content_key.as_ref(), &context, b"FME1")
    }
}
pub(super) fn unwrap(
    body: &[u8],
    secret: &StaticSecret,
    context: &str,
) -> Result<Zeroizing<Vec<u8>>> {
    if body.len() < 100 || body.len() > 65536 + 100 || !body.starts_with(b"FMW1") {
        return Err(VaultError::InvalidEnvelope);
    }
    let shared = secret.diffie_hellman(&PublicKey::from(
        <[u8; 32]>::try_from(&body[4..36]).map_err(|_| VaultError::InvalidEnvelope)?,
    ));
    if !shared.was_contributory() {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(&body[36..68]), shared.as_bytes())
        .expand(
            format!("fractalmind.key-wrap.v1:{context}").as_bytes(),
            key.as_mut(),
        )
        .map_err(|_| VaultError::InvalidEnvelope)?;
    open_body(&body[68..], key.as_ref(), context, b"FME1")
}
pub(super) fn seal_body(plaintext: &[u8], key: &[u8], context: &str) -> Result<Vec<u8>> {
    if plaintext.len() > 65504 || context.is_empty() || context.len() > 1024 {
        return Err(VaultError::InvalidEnvelope);
    }
    let mut nonce = [0u8; 12];
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|_| VaultError::StorageUnavailable)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::InvalidEnvelope)?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| VaultError::InvalidEnvelope)?;
    let mut body = b"FME1".to_vec();
    body.extend_from_slice(&nonce);
    body.extend_from_slice(&encrypted);
    Ok(body)
}
pub(super) fn open_body(
    body: &[u8],
    key: &[u8],
    context: &str,
    magic: &[u8; 4],
) -> Result<Zeroizing<Vec<u8>>> {
    if body.len() < 32
        || body.len() > 65536 + 32
        || &body[..4] != magic
        || context.is_empty()
        || context.len() > 1024
    {
        return Err(VaultError::InvalidEnvelope);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::InvalidEnvelope)?;
    cipher
        .decrypt(
            Nonce::from_slice(&body[4..16]),
            Payload {
                msg: &body[16..],
                aad: context.as_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| VaultError::InvalidEnvelope)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn record_encryption_is_randomized_bounded_and_context_authenticated() {
        let key = [7u8; 32];
        let a = seal_body(b"body", &key, "record:1").unwrap();
        let b = seal_body(b"body", &key, "record:1").unwrap();
        assert_ne!(a, b);
        assert_eq!(&*open_body(&a, &key, "record:1", b"FME1").unwrap(), b"body");
        assert!(open_body(&a, &key, "record:2", b"FME1").is_err());
        assert!(seal_body(&vec![0; 65505], &key, "record:1").is_err());
    }
    #[test]
    fn rejects_noncanonical_versions_and_unbounded_inputs() {
        for value in ["0", "01", "+1", "18446744073709551616"] {
            assert!(positive(value).is_err());
        }
        assert_eq!(positive("18446744073709551615").unwrap(), u64::MAX);
        assert!(encoded("YQ", 10).is_err());
        assert!(open_body(b"FME1", &[0; 32], "context", b"FME1").is_err());
        let vault = DeviceVault::new("org.fractalmind.app.device.test", PathBuf::new());
        assert!(matches!(
            vault.decrypt_record("test-large", &"x".repeat(200001)),
            Err(VaultError::InvalidEnvelope)
        ));
    }
}
