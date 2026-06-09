use serde::Deserialize;

#[derive(Deserialize, Default, Clone)]
pub struct KyuConfig {
    pub run: Option<RunConfig>,
    pub input: Option<InputConfig>,
    pub output: Option<OutputConfig>,
    pub worker: Option<WorkerConfig>,
}

#[derive(Deserialize, Default, Clone)]
pub struct RunConfig {
    pub wasm: Option<String>,
    pub port: Option<u16>,
}

#[derive(Deserialize, Default, Clone)]
pub struct InputConfig {
    pub src: Option<String>,
}

#[derive(Deserialize, Default, Clone)]
pub struct OutputConfig {
    pub dir: Option<String>,
    pub file: Option<String>,
}

#[derive(Deserialize, Default, Clone)]
pub struct WorkerConfig {
    pub mounts: Option<Vec<MountConfig>>,
    pub env: Option<Vec<EnvConfig>>,
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

impl RunConfig {
    pub fn wasm(&self) -> &str {
        self.wasm
            .as_deref()
            .unwrap_or("worker/__kyushu_worker.wasm")
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(5987)
    }
}

impl InputConfig {
    pub fn src(&self) -> &str {
        self.src.as_deref().unwrap_or("src/index.ts")
    }
}

impl OutputConfig {
    pub fn dir(&self) -> &str {
        self.dir.as_deref().unwrap_or("worker")
    }

    pub fn file(&self) -> &str {
        self.file.as_deref().unwrap_or("__kyushu_worker.wasm")
    }

    pub fn worker_wasm(&self) -> String {
        format!("{}/{}", self.dir(), self.file())
    }
}
