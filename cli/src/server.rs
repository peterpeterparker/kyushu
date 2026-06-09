use crate::worker::WorkerState;
use anyhow::Result;
use hyper::server::conn::http1;
use hyper::{Request, Response, body::Incoming};
use std::future::Future;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use wasmtime::Store;
use wasmtime_wasi_http::io::TokioIo;
use wasmtime_wasi_http::p2::WasiHttpView;
use wasmtime_wasi_http::p2::bindings::Proxy;
use wasmtime_wasi_http::p2::bindings::http::types::Scheme;

/// Binds a TCP listener on the given port and serves incoming HTTP/1.1 connections.
/// Each connection is handled in a spawned task using the provided handler function.
/// The state is cloned for each connection.
pub async fn serve<F, Fut, S>(port: u16, state: S, handler: F) -> Result<()>
where
    F: Fn(S, Request<Incoming>) -> Fut + Send + Sync + Clone + 'static,
    Fut: Future<Output = Result<Response<wasmtime_wasi_http::p2::body::HyperOutgoingBody>>>
        + Send
        + 'static,
    S: Clone + Send + 'static,
{
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    println!("Listening on http://0.0.0.0:{}", port);

    loop {
        let (stream, addr) = listener.accept().await?;
        let state = state.clone();
        let handler = handler.clone();

        tokio::spawn(async move {
            if let Err(e) = http1::Builder::new()
                .keep_alive(true)
                .serve_connection(
                    TokioIo::new(stream),
                    hyper::service::service_fn(move |req| {
                        let state = state.clone();
                        let handler = handler.clone();
                        async move { handler(state, req).await }
                    }),
                )
                .await
            {
                eprintln!("Error serving {addr}: {e:?}");
            }
        });
    }
}

// Dispatches an HTTP request to an already-initialized Wasm proxy instance.
/// Registers the request and response outparam in the store, spawns the handler,
/// and awaits the response.
pub async fn dispatch(
    proxy: Proxy,
    mut store: Store<WorkerState>,
    req: Request<Incoming>,
) -> Result<Response<wasmtime_wasi_http::p2::body::HyperOutgoingBody>> {
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
