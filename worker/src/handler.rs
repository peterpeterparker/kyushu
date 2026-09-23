use crate::bindings::wasi::http::types::{ErrorCode, Fields, Method, Request, Response, Trailers};
use crate::bindings::{wit_future, wit_stream};
use crate::types::{Body, HttpMethod, JsRequest, JsResponse};
use rquickjs::{CatchResultExt, IntoJs, Module};
use wit_bindgen::rt::async_support::spawn_local;

pub async fn handle(request: Request) -> Result<Response, ErrorCode> {
    let js_request = extract_request(request).await;

    let JsResponse {
        status,
        body,
        headers,
    } = run_js(js_request).await.unwrap_or_else(|e| JsResponse {
        status: 500,
        body: Some(Body::Text(format!("Error: {e}"))),
        headers: vec![],
    });

    let fields = Fields::new();
    for (k, v) in &headers {
        fields.append(k, v.as_bytes()).ok();
    }

    // Dropping the trailers writer resolves the future to its default value: no trailers.
    let (trailers_tx, trailers_rx) =
        wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));

    let (contents, body_tx) = match body {
        Some(_) => {
            let (body_tx, body_rx) = wit_stream::new::<u8>();
            (Some(body_rx), Some(body_tx))
        }
        None => (None, None),
    };

    // The returned future resolves to the result of the response transmission. There is
    // nothing to do with it, so it is dropped.
    let (resp, _transmit) = Response::new(fields, contents, trailers_rx);
    resp.set_status_code(status)
        .map_err(|_| ErrorCode::InternalError(Some(format!("Invalid status code {status}"))))?;

    // Streams are unbuffered: a write only completes once the host reads it, and the host only
    // starts reading after `handle` returned the response. Writing the body inline would
    // therefore deadlock, so it is written by a task that continues after the export returns.
    match (body, body_tx) {
        (Some(body), Some(mut body_tx)) => {
            spawn_local(async move {
                // Remaining bytes are only returned if the host dropped the reader.
                let _remaining = body_tx.write_all(body.into_bytes()).await;
                drop(body_tx);
                drop(trailers_tx);
            });
        }
        _ => drop(trailers_tx),
    }

    Ok(resp)
}

fn method_to_string(method: Method) -> String {
    match method {
        Method::Get => "GET".to_string(),
        Method::Post => "POST".to_string(),
        Method::Put => "PUT".to_string(),
        Method::Delete => "DELETE".to_string(),
        Method::Patch => "PATCH".to_string(),
        Method::Head => "HEAD".to_string(),
        Method::Options => "OPTIONS".to_string(),
        Method::Connect => "CONNECT".to_string(),
        Method::Trace => "TRACE".to_string(),
        Method::Other(s) => s,
    }
}

async fn extract_request(request: Request) -> JsRequest {
    let method = HttpMethod::from(method_to_string(request.get_method()).as_str());
    let path = request
        .get_path_with_query()
        .unwrap_or_else(|| "/".to_string());
    let url = format!("http://localhost{path}");

    let headers: Vec<(String, String)> = request
        .get_headers()
        .copy_all()
        .into_iter()
        .filter_map(|(k, v)| String::from_utf8(v).ok().map(|v| (k, v)))
        .collect();

    let headers = if headers.is_empty() {
        None
    } else {
        Some(headers)
    };

    // `res` communicates a request processing error back to the host. We never report one:
    // dropping the writer resolves it to its default value, `Ok(())`.
    let (res_tx, res_rx) = wit_future::new(|| Ok::<(), ErrorCode>(()));
    let (body_rx, _trailers) = Request::consume_body(request, res_rx);
    let bytes = body_rx.collect().await;
    drop(res_tx);

    let body = if bytes.is_empty() {
        None
    } else {
        match String::from_utf8(bytes) {
            Ok(s) => Some(Body::Text(s)),
            Err(e) => Some(Body::Bytes(e.into_bytes())),
        }
    };

    JsRequest {
        method,
        url,
        headers,
        body,
    }
}

async fn run_js(request: JsRequest) -> Result<JsResponse, String> {
    // The runtime was pre-initialized by Wizer (or by kyu-initialize in dev mode). This
    // refreshes the process state (env, argv) on the first request and returns the shared state.
    let js_state = kyushu_runtime::internal::ensure_initialized().await;

    let result = js_state
        .ctx
        .async_with(async |ctx| {
            let js_req = request.into_js(&ctx).map_err(|e| e.to_string())?;
            ctx.globals()
                .set("jsRequest", js_req)
                .map_err(|e| e.to_string())?;

            let promise = Module::evaluate(
                ctx.clone(),
                "@kyushu/handler",
                r#"
            import app from "@kyushu/app";
            import { handleRequest } from "@kyushu/worker";

            const resp = await handleRequest({ app, request: jsRequest });

            globalThis.jsResult = {
                status: resp.status ?? 200,
                body: resp.body ?? null,
                headers: resp.headers ?? {}
            };
        "#,
            )
            .catch(&ctx)
            .map_err(|e| e.to_string())?;

            promise
                .into_future::<()>()
                .await
                .catch(&ctx)
                .map_err(|e| e.to_string())?;

            let resp: JsResponse = ctx.globals().get("jsResult").map_err(|e| e.to_string())?;
            Ok::<JsResponse, String>(resp)
        })
        .await?;

    js_state.rt.idle().await;
    Ok(result)
}
