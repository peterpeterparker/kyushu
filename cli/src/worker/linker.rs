use crate::worker::state::WorkerState;
use anyhow::Result;
use wasmtime::Engine;
use wasmtime::component::{Linker, Val};
use wasmtime_wasi::p2::add_to_linker_async;
use wasmtime_wasi_http::p2::add_only_http_to_linker_async;

pub struct WorkerLinker {
    engine: Engine,
    linker: Linker<WorkerState>,
}

impl WorkerLinker {
    pub fn new() -> Result<Self> {
        let engine = Engine::default();

        let mut linker: Linker<WorkerState> = Linker::new(&engine);
        add_to_linker_async(&mut linker)?;

        Ok(Self { engine, linker })
    }

    /// Route wasi:logging/logging to println.
    /// Required by the runtime.
    pub fn with_logging(mut self) -> Result<Self> {
        self.linker
            .instance("wasi:logging/logging")?
            .func_new_async("log", |_store, _types, params, _results| {
                Box::new(async move {
                    let level = match params.get(0) {
                        Some(Val::U32(n)) => match n {
                            0 => "TRACE",
                            1 => "DEBUG",
                            2 => "INFO",
                            3 => "WARN",
                            4 => "ERROR",
                            5 => "CRITICAL",
                            _ => "LOG",
                        },
                        _ => "LOG",
                    };
                    let context = match params.get(1) {
                        Some(Val::String(s)) => s.as_str(),
                        _ => "",
                    };
                    let message = match params.get(2) {
                        Some(Val::String(s)) => s.as_str(),
                        _ => "",
                    };
                    eprintln!("[{level}] {context}: {message}");
                    Ok(())
                })
            })?;
        Ok(self)
    }

    /// Provide the JS bundle via `kyushu:worker/bundle#get-bundle`.
    /// Used during `kyu build`. Wizer calls this to get the JS bundle during pre-initialization.
    pub fn with_bundle(mut self, bundle: String) -> Result<Self> {
        self.linker
            .instance("kyushu:worker/bundle")?
            .func_new_async("get-bundle", move |_store, _types, _params, results| {
                let bundle = bundle.clone();
                Box::new(async move {
                    results[0] = Val::String(bundle.into());
                    Ok(())
                })
            })?;
        Ok(self)
    }

    /// Stub out `kyushu:worker/bundle#get-bundle`.
    /// Used at runtime as the bundle is already frozen in Wasm memory by Wizer.
    pub fn with_bundle_stub(mut self) -> Result<Self> {
        self.linker
            .instance("kyushu:worker/bundle")?
            .func_new_async("get-bundle", |_store, _types, _params, _results| {
                Box::new(async move { Ok(()) })
            })?;
        Ok(self)
    }

    /// Register `wasi:http` interfaces required by the worker component.
    ///
    /// Both `wasi:http/types` and `wasi:http/outgoing-handler` are always
    /// registered. The component is built against `wasi:http/proxy` which
    /// unconditionally imports both, even if the worker JS never calls `fetch`.
    pub fn with_http(mut self) -> Result<Self> {
        add_only_http_to_linker_async(&mut self.linker)?;

        Ok(self)
    }

    pub fn build(self) -> (Engine, Linker<WorkerState>) {
        (self.engine, self.linker)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        assert!(WorkerLinker::new().is_ok());
    }

    #[test]
    fn test_with_logging() {
        assert!(WorkerLinker::new().unwrap().with_logging().is_ok());
    }

    #[test]
    fn test_with_bundle() {
        assert!(
            WorkerLinker::new()
                .unwrap()
                .with_bundle("console.log('hello')".to_string())
                .is_ok()
        );
    }

    #[test]
    fn test_with_bundle_stub() {
        assert!(WorkerLinker::new().unwrap().with_bundle_stub().is_ok());
    }

    #[test]
    fn test_with_http() {
        assert!(WorkerLinker::new().unwrap().with_http().is_ok());
    }

    #[test]
    fn test_build() {
        let (_engine, _linker) = WorkerLinker::new()
            .unwrap()
            .with_logging()
            .unwrap()
            .with_bundle_stub()
            .unwrap()
            .with_http()
            .unwrap()
            .build();
    }

    #[test]
    fn test_bundle_and_stub_are_mutually_exclusive() {
        let result = WorkerLinker::new()
            .unwrap()
            .with_bundle("console.log('hello')".to_string())
            .unwrap()
            .with_bundle_stub();
        assert!(result.is_err());
    }
}
