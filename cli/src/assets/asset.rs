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
}
