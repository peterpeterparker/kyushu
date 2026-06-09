use crate::config::{DevConfig, InputConfig, WorkerConfig};
use crate::javascript::bundle;
use crate::server;
use crate::worker::{WORKER_TEMPLATE, WorkerContext, WorkerLinker, WorkerState};
use anyhow::Result;
use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use wasmtime::Store;
use wasmtime::component::{Component, InstancePre};
use wasmtime_wasi_http::p2::WasiHttpView;
use wasmtime_wasi_http::p2::bindings::ProxyIndices;
use wasmtime_wasi_http::p2::bindings::http::types::Scheme;
use wasmtime_wasi_http::p2::body::HyperOutgoingBody;

pub async fn dev(
    dev_config: &DevConfig,
    input_config: &InputConfig,
    worker_config: &WorkerConfig,
) -> Result<()> {
    let port = dev_config.port();

    // Unlike the runner which loads a pre-built Wizer snapshot via ProxyPre,
    // dev mode skips Wizer entirely and holds a raw InstancePre. kyu-initialize
    // is called fresh on each request to initialize the JS runtime with the current bundle.
    let instance_pre = Arc::new(RwLock::new(build_instance_pre(input_config).await?));

    // Live reload watcher
    let instance_pre_watcher = instance_pre.clone();
    let config = input_config.clone();
    tokio::spawn(async move {
        if let Err(e) = watch(config, instance_pre_watcher).await {
            eprintln!("Watcher error: {e:?}");
        }
    });

    let callback = |(instance_pre, config): (
        Arc<RwLock<InstancePre<WorkerState>>>,
        WorkerConfig,
    ),
                    req| async move {
        handle_request(instance_pre, config, req).await
    };

    server::serve(port, (instance_pre, worker_config.clone()), callback).await?;

    Ok(())
}

async fn build_instance_pre(input_config: &InputConfig) -> Result<InstancePre<WorkerState>> {
    let src = input_config.src();

    println!("Bundling {}...", src);
    let bundle_str = bundle(src).await?;

    let (engine, linker) = WorkerLinker::new()?
        .with_logging()?
        .with_http()?
        .with_bundle(bundle_str)?
        .build();

    let component = Component::new(&engine, WORKER_TEMPLATE)
        .map_err(|e| anyhow::anyhow!("failed to load worker template: {e:?}"))?;

    linker
        .instantiate_pre(&component)
        .map_err(|e| anyhow::anyhow!("failed to create InstancePre: {e:?}"))
}

async fn watch(
    input_config: InputConfig,
    instance_pre: Arc<RwLock<InstancePre<WorkerState>>>,
) -> Result<()> {
    let src_dir = Path::new(input_config.src())
        .parent()
        .unwrap_or(Path::new("src"))
        .to_path_buf();

    let (tx, mut rx) = tokio::sync::mpsc::channel(1);

    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(200),
        move |result: notify_debouncer_mini::DebounceEventResult| {
            if result.is_ok() {
                let _ = tx.blocking_send(());
            }
        },
    )?;

    debouncer
        .watcher()
        .watch(&src_dir, RecursiveMode::Recursive)?;

    while let Some(()) = rx.recv().await {
        println!("Change detected, reloading...");
        match build_instance_pre(&input_config).await {
            Ok(new_pre) => {
                *instance_pre.write().await = new_pre;
                println!("Worker reloaded.");
            }
            Err(e) => eprintln!("Reload error: {e:?}"),
        }
    }

    Ok(())
}

async fn handle_request(
    instance_pre: Arc<RwLock<InstancePre<WorkerState>>>,
    config: WorkerConfig,
    req: hyper::Request<hyper::body::Incoming>,
) -> Result<hyper::Response<HyperOutgoingBody>> {
    let instance_pre = instance_pre.read().await.clone();

    let mut store = Store::new(
        instance_pre.engine(),
        WorkerContext::new()
            .inherit_stdio()
            .with_mounts(config.mounts.as_ref())?
            .with_envs(config.env.as_ref())
            .build(),
    );

    // Instantiate the worker template and call kyu-initialize with the
    // current bundle before handling the request.
    let instance = instance_pre
        .instantiate_async(&mut store)
        .await
        .map_err(|e| anyhow::anyhow!("failed to instantiate worker: {e:?}"))?;

    let kyu_initialize = instance
        .get_typed_func::<(), ()>(&mut store, "kyu-initialize")
        .map_err(|e| anyhow::anyhow!("failed to get kyu-initialize export: {e:?}"))?;

    kyu_initialize
        .call_async(&mut store, ())
        .await
        .map_err(|e| anyhow::anyhow!("kyu-initialize failed: {e:?}"))?;

    // Construct a Proxy from the already-initialized instance using ProxyIndices,
    // so handle runs on the same instance that kyu-initialize ran on.
    let proxy = ProxyIndices::new(&instance_pre)
        .map_err(|e| anyhow::anyhow!("failed to create ProxyIndices: {e:?}"))?
        .load(&mut store, &instance)
        .map_err(|e| anyhow::anyhow!("failed to load Proxy from instance: {e:?}"))?;

    server::dispatch(proxy, store, req).await
}
