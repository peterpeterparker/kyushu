use anyhow::Result;
use clap::Parser;
use config::KyuConfig;

mod assets;
mod builder;
mod config;
mod dev;
mod javascript;
mod runner;
mod scripts;
mod server;
mod worker;

#[derive(Parser)]
#[command(name = "kyu")]
#[command(about = "A self-hostable Wasm sandbox for JavaScript workers")]
#[command(version)]
enum Cli {
    /// Run a Wasm module and serve it over HTTP
    Run {
        #[arg()]
        config: Option<String>,
    },
    /// Build the worker Wasm from JS/TS source
    Build {
        #[arg()]
        config: Option<String>,
    },
    /// Start a local development server with hot-reload
    Dev {
        #[arg()]
        config: Option<String>,
    },
}

fn read_config(config_path: Option<&str>) -> Result<KyuConfig> {
    let config_path = config_path.or_else(|| {
        std::path::Path::new("kyushu.toml")
            .exists()
            .then_some("kyushu.toml")
    });

    let Some(config_path) = config_path else {
        return Ok(KyuConfig::default());
    };

    if !std::path::Path::new(config_path).exists() {
        return Ok(KyuConfig::default());
    }

    let contents = std::fs::read_to_string(config_path)?;
    if contents.trim().is_empty() {
        eprintln!("Warning: {} is empty, using defaults.", config_path);
        return Ok(KyuConfig::default());
    }

    Ok(toml::from_str(&contents)?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let config_path = match &cli {
        Cli::Run { config } | Cli::Build { config } | Cli::Dev { config } => config.as_deref(),
    };
    let config = read_config(config_path)?;

    match cli {
        Cli::Run { .. } => {
            runner::run(
                &config.run.unwrap_or_default(),
                &config.worker.unwrap_or_default(),
            )
            .await?;
        }
        Cli::Build { .. } => {
            scripts::run_prebuild_scripts(&config.scripts)?;

            builder::build(
                &config.input.unwrap_or_default(),
                &config.output.unwrap_or_default(),
                config.assets.as_ref(),
            )
            .await?;

            scripts::run_postbuild_scripts(&config.scripts)?;
        }
        Cli::Dev { .. } => {
            dev::dev(
                &config.dev.unwrap_or_default(),
                &config.input.unwrap_or_default(),
                config.assets.as_ref(),
                &config.worker.unwrap_or_default(),
            )
            .await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_read_config_no_path_returns_default() {
        let config = read_config(None).unwrap();
        assert!(config.dev.is_none());
    }

    #[test]
    fn test_read_config_explicit_path() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "[dev]\nport = 5678").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        assert_eq!(config.dev.unwrap().port(), 5678);
    }

    #[test]
    fn test_read_config_nonexistent_path_returns_default() {
        let config = read_config(Some("/nonexistent/path.toml")).unwrap();
        assert!(config.dev.is_none());
    }

    #[test]
    fn test_read_config_empty_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        assert!(config.dev.is_none());
    }

    #[test]
    fn test_read_config_valid_dev_section() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "[dev]\nport = 1234\nwatch = false").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        let dev = config.dev.unwrap();
        assert_eq!(dev.port(), 1234);
        assert!(!dev.watch());
    }

    #[test]
    fn test_read_config_valid_input_section() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "[input]\nsrc = \"src/worker.ts\"").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        assert_eq!(config.input.unwrap().src(), "src/worker.ts");
    }

    #[test]
    fn test_read_config_valid_output_section() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "[output]\ndir = \"dist\"\nfile = \"worker.wasm\"").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        let output = config.output.unwrap();
        assert_eq!(output.dir(), "dist");
        assert_eq!(output.file(), "worker.wasm");
    }

    #[test]
    fn test_read_config_valid_assets_section() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "[assets]\ndir = \"public\"").unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        assert_eq!(config.assets.unwrap().dir(), "public");
    }

    #[test]
    fn test_read_config_invalid_toml_returns_error() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(&path, "not valid toml [[[").unwrap();
        assert!(read_config(Some(path.to_str().unwrap())).is_err());
    }

    #[test]
    fn test_read_config_falls_back_to_kyushu_toml() {
        let dir = tempdir().unwrap();
        let original = std::env::current_dir().unwrap();
        std::env::set_current_dir(dir.path()).unwrap();
        fs::write(dir.path().join("kyushu.toml"), "[dev]\nport = 9999").unwrap();
        let config = read_config(None).unwrap();
        std::env::set_current_dir(original).unwrap();
        assert_eq!(config.dev.unwrap().port(), 9999);
    }

    #[test]
    fn test_read_config_no_path_no_kyushu_toml_returns_default() {
        let dir = tempdir().unwrap();
        let original = std::env::current_dir().unwrap();
        std::env::set_current_dir(dir.path()).unwrap();
        let config = read_config(None).unwrap();
        std::env::set_current_dir(original).unwrap();
        assert!(config.dev.is_none());
    }

    #[test]
    fn test_read_config_valid_scripts_section() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom.toml");
        fs::write(
            &path,
            "[scripts]\nprebuild = [\"echo pre\"]\npostbuild = [\"echo post\"]",
        )
        .unwrap();
        let config = read_config(Some(path.to_str().unwrap())).unwrap();
        let scripts = config.scripts.unwrap();
        assert_eq!(scripts.prebuild.unwrap(), vec!["echo pre"]);
        assert_eq!(scripts.postbuild.unwrap(), vec!["echo post"]);
    }
}
