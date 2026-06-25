use crate::assets::asset::Asset;
use anyhow::Result;
use std::path::Path;
use walkdir::WalkDir;

pub fn load_assets(dir: &str) -> Result<Vec<Asset>> {
    let base = Path::new(dir);

    if !base.exists() {
        return Err(anyhow::anyhow!(
            "Assets directory '{}' does not exist.",
            dir
        ));
    }

    let assets: Vec<Asset> = WalkDir::new(base)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|file| Asset::from_path(dir, file.path()))
        .collect();

    if assets.is_empty() {
        eprintln!(
            "Warning: assets directory '{}' is empty, is that expected?",
            dir
        );
    }

    Ok(assets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_dir() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("index.html"), b"<html></html>").unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(
            dir.path().join("assets").join("app.js"),
            b"console.log('hi')",
        )
        .unwrap();
        fs::write(dir.path().join("assets").join("logo.png"), b"\x89PNG").unwrap();
        dir
    }

    #[test]
    fn test_asset_from_path_normalizes_path() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.path(), "/index.html");
    }

    #[test]
    fn test_asset_from_path_nested() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("app.js");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.path(), "/assets/app.js");
    }

    #[test]
    fn test_asset_mime_type_html() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "text/html");
    }

    #[test]
    fn test_asset_mime_type_js() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("app.js");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "text/javascript");
    }

    #[test]
    fn test_asset_mime_type_png() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("logo.png");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "image/png");
    }

    #[test]
    fn test_load_assets_count() {
        let dir = setup_dir();
        let assets = load_assets(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(assets.len(), 3);
    }

    #[test]
    fn test_load_assets_paths() {
        let dir = setup_dir();
        let mut paths: Vec<String> = load_assets(dir.path().to_str().unwrap())
            .unwrap()
            .into_iter()
            .map(|a| a.path())
            .collect();
        paths.sort();
        assert_eq!(
            paths,
            vec!["/assets/app.js", "/assets/logo.png", "/index.html"]
        );
    }

    #[test]
    fn test_load_assets_directory_not_found() {
        let result = load_assets("/nonexistent/path");
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("does not exist"));
    }

    #[test]
    fn test_load_assets_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let assets = load_assets(dir.path().to_str().unwrap()).unwrap();
        assert!(assets.is_empty());
    }
}
