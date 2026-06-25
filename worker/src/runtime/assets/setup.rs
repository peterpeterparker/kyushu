use crate::bindings::kyushu::worker::bundle::get_assets;
use crate::runtime::assets::state::{ASSETS, AssetEntry};

pub fn load_assets() {
    let Some(assets) = get_assets() else { return };

    let loaded = assets
        .into_iter()
        .map(|asset| AssetEntry {
            path: asset.path(),
            bytes: asset.bytes(),
            mime_type: asset.mime_type(),
        })
        .collect();

    ASSETS.set(loaded).expect("ASSETS already initialized");
}
