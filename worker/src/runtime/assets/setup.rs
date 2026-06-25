use crate::bindings::kyushu::worker::bundle::{get_asset_bytes, get_assets};
use crate::runtime::assets::state::{ASSETS, AssetEntry};

pub fn load_assets() {
    let Some(assets) = get_assets() else { return };

    let loaded = assets
        .iter()
        .map(|asset| {
            let bytes = get_asset_bytes(&asset.path)
                .unwrap_or_else(|| panic!("Failed to get bytes for asset '{}'", asset.path));

            AssetEntry {
                path: asset.path.clone(),
                bytes,
                mime_type: asset.mime_type.clone(),
            }
        })
        .collect();

    ASSETS.set(loaded).expect("ASSETS already initialized");
}
