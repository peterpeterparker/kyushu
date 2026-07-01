use serde::Deserialize;

const DEFAULT_PORT: u16 = 5987;
const DEFAULT_OUTPUT_DIR: &str = "worker";
const DEFAULT_OUTPUT_FILE: &str = "__kyushu_worker.wasm";

#[derive(Deserialize, Default, Clone)]
pub struct KyuConfig {
    pub dev: Option<DevConfig>,
    pub run: Option<RunConfig>,
    pub input: Option<InputConfig>,
    pub output: Option<OutputConfig>,
    pub assets: Option<AssetsConfig>,
    pub worker: Option<WorkerConfig>,
    pub scripts: Option<ScriptsConfig>,
}

#[derive(Deserialize, Default, Clone)]
pub struct DevConfig {
    pub port: Option<u16>,
    pub watch: Option<bool>,
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
pub struct AssetsConfig {
    pub dir: String,
    pub precompress: Option<Vec<Compression>>,
}

#[derive(Deserialize, Default, Clone)]
pub struct WorkerConfig {
    pub mounts: Option<Vec<MountConfig>>,
    pub env: Option<Vec<EnvConfig>>,
    pub network: Option<NetworkConfig>,
}

#[derive(Deserialize, Default, Clone)]
pub struct ScriptsConfig {
    pub prebuild: Option<Vec<String>>,
    pub postbuild: Option<Vec<String>>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Compression {
    Brotli,
    Gzip,
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

#[derive(Deserialize, Clone)]
pub struct NetworkConfig {
    #[serde(default)]
    pub ip_name_lookup: bool,
    #[serde(default)]
    pub tcp: bool,
    #[serde(default)]
    pub udp: bool,
}

impl DevConfig {
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(DEFAULT_PORT)
    }

    pub fn watch(&self) -> bool {
        self.watch.unwrap_or(true)
    }
}

impl RunConfig {
    pub fn wasm(&self) -> String {
        self.wasm
            .clone()
            .unwrap_or(format!("{}/{}", DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_FILE))
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(DEFAULT_PORT)
    }
}

impl InputConfig {
    pub fn src(&self) -> &str {
        self.src.as_deref().unwrap_or("src/index.ts")
    }
}

impl OutputConfig {
    pub fn dir(&self) -> &str {
        self.dir.as_deref().unwrap_or(DEFAULT_OUTPUT_DIR)
    }

    pub fn file(&self) -> &str {
        self.file.as_deref().unwrap_or(DEFAULT_OUTPUT_FILE)
    }

    pub fn worker_wasm(&self) -> String {
        format!("{}/{}", self.dir(), self.file())
    }
}

impl AssetsConfig {
    pub fn dir(&self) -> &str {
        &self.dir
    }

    pub fn precompress(&self) -> &[Compression] {
        self.precompress.as_deref().unwrap_or(&[])
    }
}
