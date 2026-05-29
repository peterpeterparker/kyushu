use crate::worker::context::WorkerContext;
use crate::worker::linker::WorkerLinker;
use anyhow::Result;
use wasmtime::Store;

pub struct WorkerVersion {
    wasm: Vec<u8>,
}

impl WorkerVersion {
    pub fn new() -> Self {
        Self { wasm: vec![] }
    }

    pub fn with_file(mut self, path: &str) -> Result<Self> {
        self.wasm = std::fs::read(path)?;
        Ok(self)
    }

    pub fn with_bytes(mut self, bytes: &[u8]) -> Self {
        self.wasm = bytes.to_vec();
        self
    }

    pub async fn get(self) -> Result<String> {
        let (engine, linker) = WorkerLinker::new()?
            .with_logging()?
            .with_http()?
            .with_bundle_stub()?
            .build();

        let component = wasmtime::component::Component::new(&engine, &self.wasm)?;

        let mut store = Store::new(&engine, WorkerContext::new().build());

        let instance = linker.instantiate_async(&mut store, &component).await?;
        let get_version = instance.get_typed_func::<(), (String,)>(&mut store, "get-version")?;
        let (version,) = get_version.call_async(&mut store, ()).await?;

        Ok(version)
    }

    pub async fn print(self) -> Result<()> {
        println!("Worker version: {}", self.get().await?);
        Ok(())
    }
}
