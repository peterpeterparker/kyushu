use crate::assets::Asset;
use crate::worker::state::WorkerState;
use anyhow::Result;
use std::sync::Arc;
use wasmtime::Engine;
use wasmtime::component::{Linker, LinkerInstance, Resource, ResourceType, Val};
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

    /// Provide the JS bundle and assets via `kyushu:worker/bundle`.
    /// Used during `kyu build`. Wizer calls this to get the JS bundle during pre-initialization.
    pub fn with_bundle(mut self, bundle: String, assets: Option<Vec<Asset>>) -> Result<Self> {
        let mut instance = self.linker.instance("kyushu:worker/bundle")?;

        Self::register_bundle_js(&mut instance, bundle)?;
        Self::register_bundle_assets(&mut instance, assets)?;

        Ok(self)
    }

    fn register_bundle_js(
        instance: &mut LinkerInstance<WorkerState>,
        bundle: String,
    ) -> Result<()> {
        instance.func_new_async("get-bundle", move |_store, _types, _params, results| {
            let bundle = bundle.clone();
            Box::new(async move {
                results[0] = Val::String(bundle.into());
                Ok(())
            })
        })?;

        Ok(())
    }

    fn register_bundle_assets(
        instance: &mut LinkerInstance<WorkerState>,
        assets: Option<Vec<Asset>>,
    ) -> Result<()> {
        let assets = Arc::new(assets);
        let resource_ty = ResourceType::host::<Asset>();

        instance.resource("asset", resource_ty, |mut store, rep| {
            store
                .data_mut()
                .table
                .delete(Resource::<Asset>::new_own(rep))?;
            Ok(())
        })?;

        instance.func_new_async("get-assets", move |mut store, _types, _params, results| {
            let assets = assets.clone();
            Box::new(async move {
                let assets = Arc::try_unwrap(assets).unwrap_or_else(|arc| (*arc).clone());
                let Some(assets) = assets else {
                    results[0] = Val::Option(None);
                    return Ok(());
                };
                let mut handles = Vec::with_capacity(assets.len());
                for asset in assets {
                    let resource = store.data_mut().table.push(asset)?;
                    let resource_any = resource.try_into_resource_any(&mut store)?;
                    handles.push(Val::Resource(resource_any));
                }
                results[0] = Val::Option(Some(Box::new(Val::List(handles))));
                Ok(())
            })
        })?;

        asset_method!(instance, "[method]asset.path", |asset, results| {
            results[0] = Val::String(asset.path().into());
        });

        asset_method!(instance, "[method]asset.mime-type", |asset, results| {
            results[0] = Val::Option(asset.mime_type().map(|m| Box::new(Val::String(m.into()))));
        });

        asset_method!(instance, "[method]asset.bytes", |asset, results| {
            let bytes = asset
                .bytes()
                .map_err(|e| wasmtime::Error::msg(e.to_string()))?;
            results[0] = Val::List(bytes.iter().map(|b| Val::U8(*b)).collect());
        });

        Ok(())
    }

    /// Stub out `kyushu:worker/bundle`.
    /// Used at runtime as the bundle is already frozen in Wasm memory by Wizer.
    pub fn with_bundle_stub(mut self) -> Result<Self> {
        let mut instance = self.linker.instance("kyushu:worker/bundle")?;

        Self::register_bundle_js_stub(&mut instance)?;
        Self::register_bundle_assets_stub(&mut instance)?;

        Ok(self)
    }

    fn register_bundle_js_stub(instance: &mut LinkerInstance<WorkerState>) -> Result<()> {
        instance.func_new_async("get-bundle", |_store, _types, _params, _results| {
            Box::new(async move { Ok(()) })
        })?;

        Ok(())
    }

    fn register_bundle_assets_stub(instance: &mut LinkerInstance<WorkerState>) -> Result<()> {
        let resource_ty = ResourceType::host::<Asset>();

        instance.resource("asset", resource_ty, |_, _| Ok(()))?;

        instance.func_new_async("get-assets", |_store, _types, _params, _results| {
            Box::new(async move { Ok(()) })
        })?;

        instance.func_new_async("[method]asset.path", |_store, _types, _params, _results| {
            Box::new(async move { Ok(()) })
        })?;

        instance.func_new_async(
            "[method]asset.mime-type",
            |_store, _types, _params, _results| Box::new(async move { Ok(()) }),
        )?;

        instance.func_new_async(
            "[method]asset.bytes",
            |_store, _types, _params, _results| Box::new(async move { Ok(()) }),
        )?;

        Ok(())
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
    use crate::assets::Asset;

    fn make_assets() -> Vec<Asset> {
        vec![Asset::from_path(
            "/tmp",
            std::path::Path::new("/tmp/index.html"),
        )]
    }

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
                .with_bundle("console.log('hello')".to_string(), None)
                .is_ok()
        );
    }

    #[test]
    fn test_with_bundle_and_assets() {
        assert!(
            WorkerLinker::new()
                .unwrap()
                .with_bundle("console.log('hello')".to_string(), Some(make_assets()))
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
            .with_bundle("console.log('hello')".to_string(), None)
            .unwrap()
            .with_bundle_stub();
        assert!(result.is_err());
    }
}
