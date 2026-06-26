use anyhow::Result;
use std::path::Path;

#[derive(Clone)]
pub struct Asset {
    pub src_path: String,
    pub base: String,
}

impl Asset {
    pub fn from_path(base: &str, abs_path: &Path) -> Self {
        Self {
            src_path: abs_path.to_string_lossy().into_owned(),
            base: base.to_string(),
        }
    }

    pub fn path(&self) -> String {
        let rel = Path::new(&self.src_path)
            .strip_prefix(&self.base)
            .unwrap_or(Path::new(&self.src_path));
        format!("/{}", rel.to_string_lossy().replace('\\', "/"))
    }

    pub fn mime_type(&self) -> Option<String> {
        mime_guess::from_path(&self.src_path)
            .first()
            .map(|m| m.to_string())
    }

    pub fn bytes(&self) -> Result<Vec<u8>> {
        Ok(std::fs::read(&self.src_path)?)
    }

    pub fn last_modified(&self) -> Option<u64> {
        std::fs::metadata(&self.src_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
    }
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
    fn test_from_path_normalizes_path() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.path(), "/index.html");
    }

    #[test]
    fn test_from_path_nested() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("app.js");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.path(), "/assets/app.js");
    }

    #[test]
    fn test_mime_type_html() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "text/html");
    }

    #[test]
    fn test_mime_type_js() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("app.js");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "text/javascript");
    }

    #[test]
    fn test_mime_type_png() {
        let dir = setup_dir();
        let abs = dir.path().join("assets").join("logo.png");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.mime_type().unwrap(), "image/png");
    }

    #[test]
    fn test_mime_type_none_for_no_extension() {
        let asset = Asset {
            src_path: "/tmp/file_without_extension".to_string(),
            base: "/tmp".to_string(),
        };
        assert!(asset.mime_type().is_none());
    }

    #[test]
    fn test_bytes() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert_eq!(asset.bytes().unwrap(), b"<html></html>");
    }

    #[test]
    fn test_bytes_nonexistent() {
        let asset = Asset {
            src_path: "/nonexistent/file.html".to_string(),
            base: "/nonexistent".to_string(),
        };
        assert!(asset.bytes().is_err());
    }

    #[test]
    fn test_last_modified() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        assert!(asset.last_modified().is_some());
        assert!(asset.last_modified().unwrap() > 0);
    }

    #[test]
    fn test_last_modified_nonexistent() {
        let asset = Asset {
            src_path: "/nonexistent/file.html".to_string(),
            base: "/nonexistent".to_string(),
        };
        assert!(asset.last_modified().is_none());
    }

    #[test]
    fn test_clone() {
        let dir = setup_dir();
        let abs = dir.path().join("index.html");
        let asset = Asset::from_path(dir.path().to_str().unwrap(), &abs);
        let cloned = asset.clone();
        assert_eq!(cloned.src_path, asset.src_path);
        assert_eq!(cloned.base, asset.base);
    }
}
