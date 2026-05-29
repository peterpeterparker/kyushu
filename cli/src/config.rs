use serde::Deserialize;

#[derive(Deserialize, Default, Clone)]
pub struct RunnerConfig {
    pub worker: WorkerConfig,
    pub mounts: Option<Vec<MountConfig>>,
    pub env: Option<Vec<EnvConfig>>,
}

#[derive(Deserialize, Default, Clone)]
pub struct WorkerConfig {
    pub wasm: String,
    pub port: Option<u16>,
}

#[derive(Deserialize, Default, Clone)]
pub struct BuildConfig {
    pub entry: String,
    pub outdir: String,
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
