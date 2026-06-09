use anyhow::Result;
use clap::Parser;
use config::KyuConfig;

mod builder;
mod config;
mod dev;
mod javascript;
mod runner;
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
            builder::build(
                &config.input.unwrap_or_default(),
                &config.output.unwrap_or_default(),
            )
            .await?;
        }
        Cli::Dev { .. } => {
            dev::dev(
                &config.dev.unwrap_or_default(),
                &config.input.unwrap_or_default(),
                &config.worker.unwrap_or_default(),
            )
            .await?;
        }
    }

    Ok(())
}
