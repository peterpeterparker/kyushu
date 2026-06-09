use crate::builder::WORKER_TEMPLATE;
use crate::config::DevConfig;
use crate::javascript::bundle;
use crate::worker::context::WorkerContext;
use crate::worker::linker::WorkerLinker;
use crate::worker::state::WorkerState;
use anyhow::Result;
use hyper::server::conn::http1;
use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use wasmtime::Store;
use wasmtime::component::{Component, InstancePre};
use wasmtime_wasi_http::io::TokioIo;
use wasmtime_wasi_http::p2::WasiHttpView;
use wasmtime_wasi_http::p2::bindings::ProxyIndices;
use wasmtime_wasi_http::p2::bindings::http::types::Scheme;
use wasmtime_wasi_http::p2::body::HyperOutgoingBody;

pub async fn dev(config: DevConfig) -> Result<()> {
    // TODO: duplicate runner
    let worker = config.worker.clone().unwrap_or_default();
    // TODO: remove build config and wasm path
    let wasm_path = worker.wasm();
    let port = worker.port();

    // TODO: not same as runner - we are not story the proxypre
    let instance_pre = Arc::new(RwLock::new(build_instance_pre(config.entry()).await?));

    // Live reload watcher
    let instance_pre_watcher = instance_pre.clone();
    let config_watcher = config.clone();
    tokio::spawn(async move {
        if let Err(e) = watch(config_watcher, instance_pre_watcher).await {
            eprintln!("Watcher error: {e:?}");
        }
    });

    // TODO: duplicate runner
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    println!("Listening on http://0.0.0.0:{}", port);

    loop {
        let (stream, addr) = listener.accept().await?;
        let instance_pre = instance_pre.clone();
        let config = config.clone();

        tokio::spawn(async move {
            if let Err(e) = http1::Builder::new()
                .keep_alive(true)
                .serve_connection(
                    TokioIo::new(stream),
                    hyper::service::service_fn(move |req| {
                        let instance_pre = instance_pre.clone();
                        let config = config.clone();
                        async move { handle_request(instance_pre, config, req).await }
                    }),
                )
                .await
            {
                eprintln!("Error serving {addr}: {e:?}");
            }
        });
    }
}

async fn build_instance_pre(entry: &str) -> Result<InstancePre<WorkerState>> {
    println!("Bundling {}...", entry);
    let bundle_str = bundle(entry).await?;

    let (engine, linker) = WorkerLinker::new()?
        .with_logging()?
        .with_http()?
        .with_bundle(bundle_str)?
        .build();

    // TODO: refactor extract builder impl and template
    let component = Component::new(&engine, WORKER_TEMPLATE)
        .map_err(|e| anyhow::anyhow!("failed to load worker template: {e:?}"))?;

    linker
        .instantiate_pre(&component)
        .map_err(|e| anyhow::anyhow!("failed to create InstancePre: {e:?}"))
}

async fn watch(
    config: DevConfig,
    instance_pre: Arc<RwLock<InstancePre<WorkerState>>>,
) -> Result<()> {
    let src_dir = Path::new(config.entry())
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
        match build_instance_pre(config.entry()).await {
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
    config: DevConfig,
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

    // Instantiate the worker template and call wizer-initialize with the
    // current bundle before handling the request. This replaces the Wizer
    // snapshot step — the JS runtime is initialized fresh per request in dev.
    let instance = instance_pre
        .instantiate_async(&mut store)
        .await
        .map_err(|e| anyhow::anyhow!("failed to instantiate worker: {e:?}"))?;

    let wizer_initialize = instance
        .get_typed_func::<(), ()>(&mut store, "wizer-initialize")
        .map_err(|e| anyhow::anyhow!("failed to get wizer-initialize export: {e:?}"))?;

    wizer_initialize
        .call_async(&mut store, ())
        .await
        .map_err(|e| anyhow::anyhow!("wizer-initialize failed: {e:?}"))?;

    // Construct a Proxy from the already-initialized instance using ProxyIndices,
    // so handle runs on the same instance that wizer-initialize ran on.
    let proxy = ProxyIndices::new(&instance_pre)
        .map_err(|e| anyhow::anyhow!("failed to create ProxyIndices: {e:?}"))?
        .load(&mut store, &instance)
        .map_err(|e| anyhow::anyhow!("failed to load Proxy from instance: {e:?}"))?;

    // TODO: same as in runner
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let req = store
        .data_mut()
        .http()
        .new_incoming_request(Scheme::Http, req)?;
    let out = store.data_mut().http().new_response_outparam(sender)?;

    tokio::task::spawn(async move {
        proxy
            .wasi_http_incoming_handler()
            .call_handle(&mut store, req, out)
            .await
    });

    match receiver.await {
        Ok(Ok(resp)) => Ok(resp),
        Ok(Err(e)) => anyhow::bail!("handler error: {e:?}"),
        Err(_) => anyhow::bail!("handler did not send a response"),
    }
}
