use anyhow::Result;
use clap::Parser;

mod builder;
mod config;
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
        #[arg(default_value = "kyushu.run.toml")]
        config: String,
    },
    /// Build the worker Wasm from JS/TS source
    Build {
        #[arg(default_value = "kyushu.build.toml")]
        config: String,
    },
}

fn read_config<T: for<'de> serde::Deserialize<'de>>(config_path: &str) -> Result<T> {
    let contents = std::fs::read_to_string(config_path)
        .map_err(|_| anyhow::anyhow!("Config file not found: {}", config_path))?;
    Ok(toml::from_str(&contents)?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli {
        Cli::Run {
            config: config_path,
        } => {
            runner::run(read_config(&config_path)?).await?;
        }
        Cli::Build {
            config: config_path,
        } => {
            builder::build(&read_config(&config_path)?).await?;
        }
    }

    Ok(())
}
