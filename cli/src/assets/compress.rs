use crate::config::Compression;
use anyhow::Result;
use brotli::BrotliCompress;
use brotli::enc::BrotliEncoderParams;
use flate2::Compression as GzCompression;
use flate2::write::GzEncoder;
use std::io::Write;
use walkdir::WalkDir;

pub fn precompress_assets(dir: &str, compressions: &[Compression]) -> Result<()> {
    for entry in WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            let path = e.path().to_string_lossy();
            !path.ends_with(".br") && !path.ends_with(".gz")
        })
    {
        let bytes = std::fs::read(entry.path())?;

        for compression in compressions {
            match compression {
                Compression::Brotli => {
                    let compressed = compress_brotli(&bytes)?;
                    std::fs::write(format!("{}.br", entry.path().display()), compressed)?;
                }
                Compression::Gzip => {
                    let compressed = compress_gzip(&bytes)?;
                    std::fs::write(format!("{}.gz", entry.path().display()), compressed)?;
                }
            }
        }
    }

    Ok(())
}

fn compress_brotli(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut output = Vec::new();

    BrotliCompress(
        &mut std::io::Cursor::new(bytes),
        &mut output,
        &BrotliEncoderParams::default(),
    )?;

    Ok(output)
}

fn compress_gzip(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), GzCompression::best());
    encoder.write_all(bytes)?;
    Ok(encoder.finish()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Compression;
    use std::fs;
    use tempfile::TempDir;

    fn setup_dir() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("index.html"), b"<html></html>").unwrap();
        fs::write(dir.path().join("app.js"), b"console.log('hi')").unwrap();
        dir
    }

    #[test]
    fn test_precompress_brotli() {
        let dir = setup_dir();
        precompress_assets(dir.path().to_str().unwrap(), &[Compression::Brotli]).unwrap();
        assert!(dir.path().join("index.html.br").exists());
        assert!(dir.path().join("app.js.br").exists());
    }

    #[test]
    fn test_precompress_gzip() {
        let dir = setup_dir();
        precompress_assets(dir.path().to_str().unwrap(), &[Compression::Gzip]).unwrap();
        assert!(dir.path().join("index.html.gz").exists());
        assert!(dir.path().join("app.js.gz").exists());
    }

    #[test]
    fn test_precompress_both() {
        let dir = setup_dir();
        precompress_assets(
            dir.path().to_str().unwrap(),
            &[Compression::Brotli, Compression::Gzip],
        )
        .unwrap();
        assert!(dir.path().join("index.html.br").exists());
        assert!(dir.path().join("index.html.gz").exists());
        assert!(dir.path().join("app.js.br").exists());
        assert!(dir.path().join("app.js.gz").exists());
    }

    #[test]
    fn test_precompress_overwrites_existing() {
        let dir = setup_dir();
        fs::write(dir.path().join("index.html.br"), b"already compressed").unwrap();
        precompress_assets(dir.path().to_str().unwrap(), &[Compression::Brotli]).unwrap();
        // .br file should be overwritten with freshly compressed content
        let result = fs::read(dir.path().join("index.html.br")).unwrap();
        assert_ne!(result, b"already compressed");
        // should equal freshly compressed content
        let expected = compress_brotli(&b"<html></html>".to_vec()).unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn test_precompress_brotli_content_is_valid() {
        let dir = setup_dir();
        precompress_assets(dir.path().to_str().unwrap(), &[Compression::Brotli]).unwrap();
        let compressed = fs::read(dir.path().join("index.html.br")).unwrap();
        assert!(!compressed.is_empty());
        assert_ne!(compressed, b"<html></html>");
    }

    #[test]
    fn test_precompress_gzip_content_is_valid() {
        let dir = setup_dir();
        precompress_assets(dir.path().to_str().unwrap(), &[Compression::Gzip]).unwrap();
        let compressed = fs::read(dir.path().join("index.html.gz")).unwrap();
        assert!(!compressed.is_empty());
        assert_ne!(compressed, b"<html></html>");
    }

    #[test]
    fn test_precompress_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(precompress_assets(dir.path().to_str().unwrap(), &[Compression::Brotli]).is_ok());
    }

    #[test]
    fn test_precompress_nonexistent_dir() {
        // WalkDir resolves empty. Non exists dir is checked in load_assets
        assert!(precompress_assets("/nonexistent/path", &[Compression::Brotli]).is_ok());
    }
}
