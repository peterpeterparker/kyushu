use crate::bindings::wasi::http::types::{
    Fields, IncomingRequest, Method, OutgoingBody, OutgoingResponse, ResponseOutparam,
};
use crate::types::{Body, HttpMethod, JsRequest, JsResponse};
use rquickjs::{CatchResultExt, IntoJs, Module};

pub fn handle(request: IncomingRequest, response_out: ResponseOutparam) {
    let js_request = extract_request(request);

    let result = kyushu_runtime::internal::async_exported_function(run_js(js_request));

    let JsResponse {
        status,
        body,
        headers,
    } = result.unwrap_or_else(|e| JsResponse {
        status: 500,
        body: Some(Body::Text(format!("Error: {e}"))),
        headers: vec![],
    });

    let fields = Fields::new();
    for (k, v) in &headers {
        fields.append(k, v.as_bytes()).ok();
    }

    let resp = OutgoingResponse::new(fields);
    resp.set_status_code(status)
        .expect("Failed to set status code");

    let body_out = resp.body().expect("Failed to get outgoing body");
    ResponseOutparam::set(response_out, Ok(resp));

    if let Some(body) = body {
        let out = body_out.write().expect("Failed to get body write stream");
        out.blocking_write_and_flush(&body.into_bytes())
            .expect("Failed to write body");
    }

    OutgoingBody::finish(body_out, None).expect("Failed to finish body");
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

fn extract_request(request: IncomingRequest) -> JsRequest {
    let method = HttpMethod::from(method_to_string(request.method()).as_str());
    let path = request.path_with_query().unwrap_or_else(|| "/".to_string());
    let url = format!("http://localhost{path}");

    let headers: Vec<(String, String)> = request
        .headers()
        .entries()
        .into_iter()
        .filter_map(|(k, v)| String::from_utf8(v).ok().map(|v| (k, v)))
        .collect();

    let headers = if headers.is_empty() {
        None
    } else {
        Some(headers)
    };

    let body = request.consume().ok().and_then(|incoming_body| {
        let stream = incoming_body.stream().ok()?;
        let mut bytes = Vec::new();
        loop {
            match stream.blocking_read(4096) {
                Ok(chunk) if chunk.is_empty() => break,
                Ok(chunk) => bytes.extend_from_slice(&chunk),
                Err(_) => break,
            }
        }
        if bytes.is_empty() {
            None
        } else {
            match String::from_utf8(bytes) {
                Ok(s) => Some(Body::Text(s)),
                Err(e) => Some(Body::Bytes(e.into_bytes())),
            }
        }
    });

    JsRequest {
        method,
        url,
        headers,
        body,
    }
}

async fn run_js(request: JsRequest) -> Result<JsResponse, String> {
    let js_state = kyushu_runtime::internal::get_js_state();

    let result = js_state.ctx.async_with(async |ctx| {
        let js_req = request.into_js(&ctx).map_err(|e| e.to_string())?;
        ctx.globals().set("jsArgs", js_req).map_err(|e| e.to_string())?;

        let promise = Module::evaluate(ctx.clone(), "@kyushu/handler", r#"
            import app from "@kyushu/app";
            import { ExportedHandlerSchema, WorkerRequestSchema, WorkerResponseSchema } from "@kyushu/types";

            const handler = ExportedHandlerSchema.parse(app);
            const req = WorkerRequestSchema.parse(jsArgs);

            const response = await handler.fetch(req);

            const resp = WorkerResponseSchema.parse(response);

            globalThis.jsResult = {
                status: resp.status ?? 200,
                body: resp.body ?? null,
                headers: resp.headers ?? {}
            };
        "#)
            .catch(&ctx)
            .map_err(|e| e.to_string())?;

        promise.into_future::<()>().await.catch(&ctx).map_err(|e| e.to_string())?;

        let resp: JsResponse = ctx.globals().get("jsResult").map_err(|e| e.to_string())?;
        Ok::<JsResponse, String>(resp)
    }).await?;

    js_state.rt.idle().await;
    Ok(result)
}
