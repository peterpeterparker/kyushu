use crate::worker::WorkerState;
use anyhow::Result;
use bytes::Bytes;
use http_body::{Body, Frame, SizeHint};
use http_body_util::BodyExt;
use http_body_util::combinators::UnsyncBoxBody;
use hyper::server::conn::http1;
use hyper::{Request, Response, body::Incoming};
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use wasmtime::Store;
use wasmtime_wasi_http::io::TokioIo;
use wasmtime_wasi_http::p3::bindings::Service;
use wasmtime_wasi_http::p3::bindings::http::types::ErrorCode;

/// Body of the responses returned to hyper.
pub type ResponseBody = UnsyncBoxBody<Bytes, anyhow::Error>;

/// Binds a TCP listener on the given port and serves incoming HTTP/1.1 connections.
/// Each connection is handled in a spawned task using the provided handler function.
/// The state is cloned for each connection.
pub async fn serve<F, Fut, S>(port: u16, state: S, handler: F) -> Result<()>
where
    F: Fn(S, Request<Incoming>) -> Fut + Send + Sync + Clone + 'static,
    Fut: Future<Output = Result<Response<ResponseBody>>> + Send + 'static,
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

/// Dispatches an HTTP request to an already-initialized Wasm service instance.
///
/// The `wasi:http/handler#handle` export is called within the store's concurrent event loop.
/// The response body is a stream produced by the guest, which only makes progress while that
/// event loop runs. Therefore the loop is kept alive, in a spawned task, until hyper has
/// consumed or dropped the body.
pub async fn dispatch(
    service: Service,
    mut store: Store<WorkerState>,
    req: Request<Incoming>,
) -> Result<Response<ResponseBody>> {
    let req = req.map(|body| body.map_err(ErrorCode::from_hyper_request_error));
    let (req, req_io) = wasmtime_wasi_http::p3::Request::from_http(req);

    let (tx, rx) = oneshot::channel::<Result<Response<ResponseBody>>>();

    tokio::task::spawn(async move {
        let result = store
            .run_concurrent(async move |accessor| {
                let response = match service.handle(accessor, req).await {
                    Ok(Ok(response)) => response,
                    Ok(Err(code)) => {
                        let _ = tx.send(Err(anyhow::anyhow!("handler error: {code:?}")));
                        return;
                    }
                    Err(e) => {
                        let _ = tx.send(Err(anyhow::anyhow!("handler trapped: {e:?}")));
                        return;
                    }
                };

                let response = match accessor.with(|store| response.into_http(store, req_io)) {
                    Ok(response) => response,
                    Err(e) => {
                        let _ = tx.send(Err(anyhow::anyhow!("invalid response: {e:?}")));
                        return;
                    }
                };

                let (done_tx, done_rx) = oneshot::channel::<()>();

                let response = response.map(|body| {
                    NotifyOnDrop {
                        body: body.map_err(|e| anyhow::anyhow!("{e:?}")).boxed_unsync(),
                        _done: done_tx,
                    }
                    .boxed_unsync()
                });

                if tx.send(Ok(response)).is_err() {
                    return;
                }

                // Resolves (with an error) once hyper drops the body.
                let _ = done_rx.await;
            })
            .await;

        if let Err(e) = result {
            eprintln!("Error running worker: {e:?}");
        }
    });

    match rx.await {
        Ok(result) => result,
        Err(_) => anyhow::bail!("handler did not send a response"),
    }
}

/// Wraps a response body and drops `_done` together with it, notifying the
/// dispatcher that the body is no longer read.
struct NotifyOnDrop {
    body: ResponseBody,
    _done: oneshot::Sender<()>,
}

impl Body for NotifyOnDrop {
    type Data = Bytes;
    type Error = anyhow::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        Pin::new(&mut self.body).poll_frame(cx)
    }

    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.body.size_hint()
    }
}
