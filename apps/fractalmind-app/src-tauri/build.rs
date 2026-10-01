fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "fm_device_public",
            "fm_device_initialize",
            "fm_device_sign_transaction",
            "fm_device_prove",
        ]),
    ))
    .expect("FractalMind App native manifest failed");
}
