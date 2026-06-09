use anyhow::Result;
use hyper::server::conn::http1;
use hyper::{Request, Response, body::Incoming};
use std::future::Future;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use wasmtime_wasi_http::io::TokioIo;

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
