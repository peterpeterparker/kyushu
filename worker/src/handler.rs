use crate::bindings::wasi::http::types::{ErrorCode, Method, Request, Response};
use crate::bindings::wit_future;
use crate::response::stream_response;
use crate::types::{Body, HttpMethod, JsRequest, JsResponse};
use rquickjs::{CatchResultExt, IntoJs, Module};

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

    stream_response(status, headers, body)
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
