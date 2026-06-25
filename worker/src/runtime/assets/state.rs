use std::sync::OnceLock;

pub struct AssetEntry {
    pub path: String,
    pub bytes: Vec<u8>,
    pub mime_type: Option<String>,
}

impl std::fmt::Debug for AssetEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssetEntry")
            .field("path", &self.path)
            .field("mime_type", &self.mime_type)
            .finish()
    }
}

pub static ASSETS: OnceLock<Vec<AssetEntry>> = OnceLock::new();
