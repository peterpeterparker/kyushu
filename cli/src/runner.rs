use crate::config::{RunConfig, WorkerConfig};
use crate::server;
use crate::worker::{WorkerContext, WorkerLinker, WorkerState, WorkerVersion};
use anyhow::Result;
use std::sync::Arc;
use wasmtime::Store;
use wasmtime::component::Component;
use wasmtime_wasi_http::p2::WasiHttpView;
use wasmtime_wasi_http::p2::bindings::ProxyPre;
use wasmtime_wasi_http::p2::bindings::http::types::Scheme;
use wasmtime_wasi_http::p2::body::HyperOutgoingBody;

pub async fn run(run_config: &RunConfig, worker_config: &WorkerConfig) -> Result<()> {
    let wasm_path = run_config.wasm();
    let port = run_config.port();

    println!("Loading {}...", wasm_path);

    WorkerVersion::new().with_file(&wasm_path)?.print().await?;

    let (engine, linker) = WorkerLinker::new()?
        .with_logging()?
        .with_http()?
        .with_bundle_stub()?
        .build();

    let component = Component::from_file(&engine, wasm_path)?;
    let pre = Arc::new(ProxyPre::new(linker.instantiate_pre(&component)?)?);

    let callback = |(pre, config): (Arc<ProxyPre<WorkerState>>, WorkerConfig), req| async move {
        handle_request(pre, config, req).await
    };

    server::serve(port, (pre, worker_config.clone()), callback).await?;

    Ok(())
}

async fn handle_request(
    pre: Arc<ProxyPre<WorkerState>>,
    config: WorkerConfig,
    req: hyper::Request<hyper::body::Incoming>,
) -> Result<hyper::Response<HyperOutgoingBody>> {
    let mut store = Store::new(
        pre.engine(),
        WorkerContext::new()
            .inherit_stdio()
            .with_mounts(config.mounts.as_ref())?
            .with_envs(config.env.as_ref())
            .build(),
    );

    let proxy = pre.instantiate_async(&mut store).await?;

    server::dispatch(proxy, store, req).await
}
