//! Versioned organization keys. A scoped ring never falls back to another
//! organization's key; recovery retains history while rotating future writes.
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::Zeroize;

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct OrganizationKeys {
    pub current_version: String,
    pub content_key: String,
    pub historical_keys: BTreeMap<String, String>,
}
impl Drop for OrganizationKeys {
    fn drop(&mut self) {
        self.content_key.zeroize();
        for key in self.historical_keys.values_mut() {
            key.zeroize();
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Legacy {
    format: u8,
    content_key: String,
    historical_keys: BTreeMap<String, String>,
}
impl Drop for Legacy {
    fn drop(&mut self) {
        self.content_key.zeroize();
        for key in self.historical_keys.values_mut() {
            key.zeroize();
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Scoped {
    pub format: u8,
    pub organizations: BTreeMap<String, OrganizationKeys>,
}
enum Ring {
    Legacy(Legacy),
    Scoped(Scoped),
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct OrganizationSource {
    pub organization_id: String,
    pub key_version: String,
    pub rotate: bool,
}
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rotation {
    pub organization_id: String,
    pub old_version: String,
    pub new_version: String,
}
pub(super) fn id(value: &str) -> Result<()> {
    if value.len() != 66
        || !value.starts_with("0x")
        || !value[2..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok(())
}
fn valid_key(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok(())
}
fn history(current: &str, keys: &BTreeMap<String, String>) -> Result<()> {
    valid_key(current)?;
    if keys.is_empty() || keys.len() > 256 {
        return Err(VaultError::InvalidEnvelope);
    }
    for (version, key) in keys {
        super::records::positive(version)?;
        valid_key(key)?;
    }
    Ok(())
}
impl Scoped {
    pub(super) fn validate(&self) -> Result<()> {
        if self.format != 2 || self.organizations.len() > 256 {
            return Err(VaultError::InvalidEnvelope);
        }
        for (organization, keys) in &self.organizations {
            id(organization)?;
            super::records::positive(&keys.current_version)?;
            history(&keys.content_key, &keys.historical_keys)?;
            if keys.historical_keys.get(&keys.current_version) != Some(&keys.content_key) {
                return Err(VaultError::InvalidEnvelope);
            }
        }
        Ok(())
    }
}
fn parse(bytes: &[u8]) -> Result<Ring> {
    if bytes.len() > 65_436 {
        return Err(VaultError::InvalidEnvelope);
    }
    // Read just the format first. Untagged deserialization would buffer a
    // serde value containing secret strings before copying into the ring.
    #[derive(Deserialize)]
    struct Format {
        format: u8,
    }
    let format: Format = serde_json::from_slice(bytes).map_err(|_| VaultError::InvalidEnvelope)?;
    let ring = match format.format {
        1 => Ring::Legacy(serde_json::from_slice(bytes).map_err(|_| VaultError::InvalidEnvelope)?),
        2 => Ring::Scoped(serde_json::from_slice(bytes).map_err(|_| VaultError::InvalidEnvelope)?),
        _ => return Err(VaultError::InvalidEnvelope),
    };
    match &ring {
        Ring::Legacy(legacy) => {
            if legacy.format != 1 {
                return Err(VaultError::InvalidEnvelope);
            }
            history(&legacy.content_key, &legacy.historical_keys)?;
        }
        Ring::Scoped(scoped) => scoped.validate()?,
    }
    Ok(ring)
}
pub(super) fn select(
    bytes: &[u8],
    organization: &str,
    version: &str,
) -> Result<Zeroizing<[u8; 32]>> {
    id(organization)?;
    super::records::positive(version)?;
    let ring = parse(bytes)?;
    let history = match &ring {
        Ring::Legacy(legacy) => &legacy.historical_keys,
        Ring::Scoped(scoped) => {
            &scoped
                .organizations
                .get(organization)
                .ok_or(VaultError::InvalidEnvelope)?
                .historical_keys
        }
    };
    let mut key = Zeroizing::new([0u8; 32]);
    hex::decode_to_slice(
        history.get(version).ok_or(VaultError::InvalidEnvelope)?,
        key.as_mut(),
    )
    .map_err(|_| VaultError::InvalidEnvelope)?;
    Ok(key)
}
pub(super) fn rotate(
    bytes: &[u8],
    sources: &[OrganizationSource],
) -> Result<(Scoped, Vec<Rotation>)> {
    if sources.len() > 256 {
        return Err(VaultError::InvalidEnvelope);
    }
    let ring = parse(bytes)?;
    let mut scoped = Scoped {
        format: 2,
        organizations: match &ring {
            Ring::Scoped(s) => s.organizations.clone(),
            _ => BTreeMap::new(),
        },
    };
    let mut seen = std::collections::BTreeSet::new();
    let mut rotations = Vec::new();
    for source in sources {
        id(&source.organization_id)?;
        let old = super::records::positive(&source.key_version)?;
        if !seen.insert(&source.organization_id) {
            return Err(VaultError::InvalidEnvelope);
        }
        if let Ring::Legacy(legacy) = &ring {
            let current = legacy
                .historical_keys
                .get(&source.key_version)
                .ok_or(VaultError::InvalidEnvelope)?;
            scoped.organizations.insert(
                source.organization_id.clone(),
                OrganizationKeys {
                    current_version: source.key_version.clone(),
                    content_key: current.clone(),
                    historical_keys: legacy.historical_keys.clone(),
                },
            );
        }
        let keys = scoped
            .organizations
            .get_mut(&source.organization_id)
            .ok_or(VaultError::InvalidEnvelope)?;
        // A stale backup must not overwrite a newer chain key version.
        if keys.current_version != source.key_version {
            return Err(VaultError::InvalidEnvelope);
        }
        if source.rotate {
            let next = old
                .checked_add(1)
                .ok_or(VaultError::InvalidEnvelope)?
                .to_string();
            if keys.historical_keys.contains_key(&next) {
                return Err(VaultError::InvalidEnvelope);
            }
            let mut entropy = Zeroizing::new([0u8; 32]);
            OsRng
                .try_fill_bytes(entropy.as_mut())
                .map_err(|_| VaultError::StorageUnavailable)?;
            keys.content_key.zeroize();
            keys.content_key = hex::encode(entropy.as_ref());
            keys.current_version = next.clone();
            keys.historical_keys
                .insert(next.clone(), keys.content_key.clone());
            rotations.push(Rotation {
                organization_id: source.organization_id.clone(),
                old_version: source.key_version.clone(),
                new_version: next,
            });
        }
    }
    scoped.validate()?;
    let encoded =
        Zeroizing::new(serde_json::to_vec(&scoped).map_err(|_| VaultError::InvalidEnvelope)?);
    // The on-chain encrypted backup is bounded to 64 KiB, including FMW1.
    if encoded.len() > 65_436 {
        return Err(VaultError::InvalidEnvelope);
    }
    Ok((scoped, rotations))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn org(n: char) -> String {
        format!("0x{}", n.to_string().repeat(64))
    }
    fn legacy() -> Vec<u8> {
        format!(
            r#"{{"format":1,"contentKey":"{0}","historicalKeys":{{"1":"{0}"}}}}"#,
            "a".repeat(64)
        )
        .into_bytes()
    }
    #[test]
    fn recovery_rotates_owned_organizations_independently_and_retains_history() {
        let sources = [
            OrganizationSource {
                organization_id: org('1'),
                key_version: "1".into(),
                rotate: true,
            },
            OrganizationSource {
                organization_id: org('2'),
                key_version: "1".into(),
                rotate: true,
            },
            OrganizationSource {
                organization_id: org('3'),
                key_version: "1".into(),
                rotate: false,
            },
        ];
        let (scoped, plan) = rotate(&legacy(), &sources).unwrap();
        assert_eq!(plan.len(), 2);
        let encoded = Zeroizing::new(serde_json::to_vec(&scoped).unwrap());
        assert_eq!(*select(&encoded, &org('1'), "1").unwrap(), [0xaa; 32]);
        assert_ne!(
            *select(&encoded, &org('1'), "2").unwrap(),
            *select(&encoded, &org('2'), "2").unwrap()
        );
        assert_eq!(*select(&encoded, &org('3'), "1").unwrap(), [0xaa; 32]);
        assert!(select(&encoded, &org('3'), "2").is_err());
        assert!(select(&encoded, &org('4'), "1").is_err());
        assert!(rotate(&encoded, &sources).is_err());
        let mut newer = sources.clone();
        newer[0].key_version = "2".into();
        newer[1].key_version = "2".into();
        let (again, _) = rotate(&encoded, &newer).unwrap();
        assert_eq!(again.organizations[&org('1')].historical_keys.len(), 3);
        assert_eq!(
            again.organizations[&org('1')].historical_keys["2"],
            scoped.organizations[&org('1')].content_key
        );
    }
    #[test]
    fn malformed_history_duplicate_sources_and_version_overflow_fail_closed() {
        let source = OrganizationSource {
            organization_id: org('1'),
            key_version: "1".into(),
            rotate: true,
        };
        assert!(rotate(&legacy(), &[source.clone(), source]).is_err());
        assert!(select(&legacy(), &org('1'), "2").is_err());
        let malformed = format!(
            r#"{{"format":2,"organizations":{{"{}":{{"currentVersion":"1","contentKey":"{}","historicalKeys":{{"1":"{}"}}}}}}}}"#,
            org('1'),
            "a".repeat(64),
            "b".repeat(64)
        );
        assert!(select(malformed.as_bytes(), &org('1'), "1").is_err());
        let overflow = format!(
            r#"{{"format":1,"contentKey":"{0}","historicalKeys":{{"18446744073709551615":"{0}"}}}}"#,
            "a".repeat(64)
        );
        assert!(rotate(
            overflow.as_bytes(),
            &[OrganizationSource {
                organization_id: org('1'),
                key_version: u64::MAX.to_string(),
                rotate: true
            }]
        )
        .is_err());
    }
}
