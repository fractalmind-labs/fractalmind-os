//! Credential entry selection is native and cannot be overridden by IPC.
//! Android binds each service to an explicit named Keystore-backed store;
//! it never uses keyring-core's global default or a sample/mock provider.

#[cfg(not(target_os = "android"))]
pub(super) use ::keyring::{Entry, Error};

#[cfg(target_os = "android")]
pub(super) use android::Entry;
#[cfg(target_os = "android")]
pub(super) use android_keyring_core::Error;

#[cfg(target_os = "android")]
mod android {
    use android_keyring_core::{api::CredentialStoreApi, Result};
    use android_native_keyring_store::Store;
    use std::collections::HashMap;

    pub(crate) struct Entry(android_keyring_core::Entry);

    impl Entry {
        pub(crate) fn new(service: &str, account: &str) -> Result<Self> {
            // Tauri Mobile initializes ndk-context before its App setup.
            // Separate production/test services select separate wrapping keys
            // and encrypted preferences; device/onboarding/recovery accounts
            // retain the same names and payload formats as other platforms.
            let store = Store::new_with_configuration(&HashMap::from([
                ("name", service),
                ("filename", service),
            ]))?;
            Ok(Self(store.build(service, account, None)?))
        }

        pub(crate) fn get_secret(&self) -> Result<Vec<u8>> {
            self.0.get_secret()
        }

        pub(crate) fn set_secret(&self, secret: &[u8]) -> Result<()> {
            self.0.set_secret(secret)
        }

        pub(crate) fn delete_credential(&self) -> Result<()> {
            self.0.delete_credential()
        }
    }
}
