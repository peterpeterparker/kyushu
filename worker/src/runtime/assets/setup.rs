use crate::bindings::kyushu::worker::bundle::get_assets;
use crate::runtime::assets::state::{ASSETS, AssetEntry};

pub fn load_assets() {
    let Some(assets) = get_assets() else { return };

    let loaded = assets
        .iter()
        .map(|asset| {
            let bytes = std::fs::read(&asset.src_path)
                .unwrap_or_else(|e| panic!("Failed to read asset '{}': {e}", asset.src_path));

            AssetEntry {
                path: asset.path.clone(),
                bytes,
                mime_type: asset.mime_type.clone(),
            }
        })
        .collect();

    ASSETS.set(loaded).expect("ASSETS already initialized");
}
