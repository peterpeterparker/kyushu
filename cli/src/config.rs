use serde::Deserialize;

#[derive(Deserialize, Default, Clone)]
pub struct KyuConfig {
    pub run: Option<RunnerConfig>,
    pub build: Option<BuildConfig>,
}

#[derive(Deserialize, Default, Clone)]
pub struct RunnerConfig {
    pub worker: Option<WorkerConfig>,
    pub mounts: Option<Vec<MountConfig>>,
    pub env: Option<Vec<EnvConfig>>,
}

#[derive(Deserialize, Default, Clone)]
pub struct WorkerConfig {
    pub wasm: Option<String>,
    pub port: Option<u16>,
}

impl WorkerConfig {
    pub fn wasm(&self) -> &str {
        self.wasm
            .as_deref()
            .unwrap_or("worker/__kyushu_worker.wasm")
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(5987)
    }
}

#[derive(Deserialize, Default, Clone)]
pub struct BuildConfig {
    pub entry: Option<String>,
    pub outdir: Option<String>,
    pub outfile: Option<String>,
}

impl BuildConfig {
    pub fn entry(&self) -> &str {
        self.entry.as_deref().unwrap_or("src/index.ts")
    }

    pub fn outdir(&self) -> &str {
        self.outdir.as_deref().unwrap_or("worker")
    }

    pub fn outfile(&self) -> &str {
        self.outfile.as_deref().unwrap_or("__kyushu_worker.wasm")
    }

    pub fn worker_wasm(&self) -> String {
        format!("{}/{}", self.outdir(), self.outfile())
    }
}

#[derive(Deserialize, Clone)]
pub struct MountConfig {
    pub host: String,
    pub guest: String,
    #[serde(default)]
    pub writable: bool,
}

#[derive(Deserialize, Clone)]
pub struct EnvConfig {
    pub key: String,
    pub value: String,
}
