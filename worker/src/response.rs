use crate::bindings::wasi::http::types::{ErrorCode, Fields, Response, Trailers};
use crate::bindings::{wit_future, wit_stream};
use crate::types::Body;
use wit_bindgen::rt::async_support::spawn_local;

pub fn stream_response(
    status: u16,
    headers: Vec<(String, String)>,
    body: Option<Body>,
) -> Result<Response, ErrorCode> {
    let fields = Fields::new();
    for (k, v) in &headers {
        fields.append(k, v.as_bytes()).ok();
    }

    // We never send trailers. Dropping the sender resolves them to the default: none.
    let (trailers_tx, trailers_rx) =
        wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));

    // The body is streamed: the response gets the reader, the sender is written below.
    let (contents, body_tx) = match body {
        Some(_) => {
            let (body_tx, body_rx) = wit_stream::new::<u8>();
            (Some(body_rx), Some(body_tx))
        }
        None => (None, None),
    };

    let (resp, _transmit) = Response::new(fields, contents, trailers_rx);
    resp.set_status_code(status)
        .map_err(|_| ErrorCode::InternalError(Some(format!("Invalid status code {status}"))))?;

    // The host reads the body only after `handle` returns, so it must be written in a task.
    match (body, body_tx) {
        (Some(body), Some(mut body_tx)) => {
            spawn_local(async move {
                let _remaining = body_tx.write_all(body.into_bytes()).await;
                drop(body_tx);
                drop(trailers_tx);
            });
        }
        _ => drop(trailers_tx),
    }

    Ok(resp)
}
