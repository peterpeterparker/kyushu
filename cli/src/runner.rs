use crate::config::RunnerConfig;
use crate::worker::context::WorkerContext;
use crate::worker::linker::WorkerLinker;
use crate::worker::state::WorkerState;
use crate::worker::version::WorkerVersion;
use anyhow::Result;
use hyper::server::conn::http1;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use wasmtime::Store;
use wasmtime::component::Component;
use wasmtime_wasi_http::io::TokioIo;
use wasmtime_wasi_http::p2::WasiHttpView;
use wasmtime_wasi_http::p2::bindings::ProxyPre;
use wasmtime_wasi_http::p2::bindings::http::types::Scheme;
use wasmtime_wasi_http::p2::body::HyperOutgoingBody;

pub async fn run(config: RunnerConfig) -> Result<()> {
    let wasm_path = &config.worker.wasm;
    let port = config.worker.port.unwrap_or(5987);

    println!("Loading {}...", wasm_path);

    WorkerVersion::new().with_file(&wasm_path)?.print().await?;

    let (engine, linker) = WorkerLinker::new()?
        .with_logging()?
        .with_http()?
        .with_bundle_stub()?
        .build();

    let component = Component::from_file(&engine, wasm_path)?;
    let pre = Arc::new(ProxyPre::new(linker.instantiate_pre(&component)?)?);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    println!("Listening on http://0.0.0.0:{}", port);

    loop {
        let (stream, addr) = listener.accept().await?;
        let pre = pre.clone();
        let config = config.clone();

        tokio::spawn(async move {
            if let Err(e) = http1::Builder::new()
                .keep_alive(true)
                .serve_connection(
                    TokioIo::new(stream),
                    hyper::service::service_fn(move |req| {
                        let pre = pre.clone();
                        let config = config.clone();
                        async move { handle_request(pre, config, req).await }
                    }),
                )
                .await
            {
                eprintln!("Error serving {addr}: {e:?}");
            }
        });
    }
}

async fn handle_request(
    pre: Arc<ProxyPre<WorkerState>>,
    config: RunnerConfig,
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

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let req = store
        .data_mut()
        .http()
        .new_incoming_request(Scheme::Http, req)?;
    let out = store.data_mut().http().new_response_outparam(sender)?;

    tokio::task::spawn(async move {
        let proxy = pre.instantiate_async(&mut store).await?;
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
