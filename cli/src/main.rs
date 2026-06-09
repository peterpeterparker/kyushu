use anyhow::Result;
use clap::Parser;

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

fn read_config<T: for<'de> serde::Deserialize<'de> + Default>(
    config_path: Option<&str>,
) -> Result<T> {
    let Some(config_path) = config_path else {
        return Ok(T::default());
    };

    if !std::path::Path::new(config_path).exists() {
        return Ok(T::default());
    }

    let contents = std::fs::read_to_string(config_path)?;
    if contents.trim().is_empty() {
        eprintln!("Warning: {} is empty, using defaults.", config_path);
        return Ok(T::default());
    }

    Ok(toml::from_str(&contents)?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli {
        Cli::Run {
            config: config_path,
        } => {
            runner::run(read_config(config_path.as_deref())?).await?;
        }
        Cli::Build {
            config: config_path,
        } => {
            builder::build(&read_config(config_path.as_deref())?).await?;
        }
        Cli::Dev {
            config: config_path,
        } => {
            dev::dev(read_config(config_path.as_deref())?).await?;
        }
    }

    Ok(())
}
