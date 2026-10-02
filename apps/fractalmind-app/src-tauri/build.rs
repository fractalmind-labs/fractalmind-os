fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "fm_device_public",
            "fm_device_initialize",
            "fm_device_sign_transaction",
            "fm_device_prove",
            "fm_onboarding_create",
            "fm_onboarding_public",
            "fm_onboarding_sign_transaction",
            "fm_device_decrypt_record",
            "fm_device_encrypt_record",
            "fm_recovery_import",
            "fm_recovery_imported_public",
            "fm_recovery_prepare",
            "fm_recovery_prepared_public",
            "fm_recovery_sign_transaction",
            "fm_device_wrap_organization_keys",
        ]),
    ))
    .expect("FractalMind App native manifest failed");
}
