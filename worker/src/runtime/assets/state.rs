use std::sync::OnceLock;

pub struct Asset {
    pub path: String,
    pub bytes: Vec<u8>,
    pub mime_type: Option<String>,
}

impl std::fmt::Debug for Asset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Asset")
            .field("path", &self.path)
            .field("mime_type", &self.mime_type)
            .finish()
    }
}

pub static ASSETS: OnceLock<Vec<Asset>> = OnceLock::new();
