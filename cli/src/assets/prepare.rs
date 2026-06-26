use crate::assets::compress::precompress_assets;
use crate::assets::{Asset, load_assets};
use crate::config::AssetsConfig;
use anyhow::Result;

pub fn prepare_assets(config: &AssetsConfig) -> Result<Vec<Asset>> {
    let compressions = config.precompress();

    if !compressions.is_empty() {
        println!("Pre-compressing assets in {}...", config.dir());
        precompress_assets(config.dir(), compressions)?;
    }

    println!("Loading assets from {}...", config.dir());
    load_assets(config.dir())
}
