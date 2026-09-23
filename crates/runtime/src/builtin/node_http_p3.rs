//! WASI Preview 3 `node:http` client native bridge.
//!
//! This is the Preview 3 counterpart of [`super::node_http`](node_http.rs). It exposes the *exact
//! same* native class contract (`NodeHttpClientRequest` and `NodeHttpIncomingResponse`) so that the
//! shared JavaScript implementation in `node_http.js` / `node_http_server.js` can be reused verbatim
//! on both generation targets. The only difference is the transport: the Preview 2 file drives
//! requests through `wasip2::http::outgoing_handler` (which depends on `wstd`/`wasip2` pollables),
//! whereas this file uses the `wasip3` crate's `wasi:http/client` binding
//! (`wasip3::http::client::send`) and Component Model async `stream<u8>` / `future` bodies. No
//! `wstd`, `wasip2`, or Preview 2 pollables are used.
//!
//! Per the project's `node:http` transport rule, every client request goes through `wasi:http`;
//! there is no `node:net` loopback fallback. The `node:http` *server* is built on `node:net`
//! (which is itself ported to Preview 3), so it works on this path unchanged.
//!
//! ## Request lifecycle
//!
//! `node_http.js` drives a client request as: create → `start()` → `writeStream()`* → `finish()` →
//! `waitForResponse()` → `getResponse()`, then reads the response body incrementally via
//! `NodeHttpIncomingResponse::readBodyChunk()`.
//!
//! The request body is **buffered** across the `write*` calls and sent once the body is finished.
//! The outgoing `wasi:http/client.send` subtask and the request-body upload are then driven
//! **concurrently** via [`futures::future::join`] (mirroring the buffered `send_once` path in the
//! Preview 3 `fetch` transport). This concurrency is required: the `send` subtask only drains the
//! request body `stream<u8>` while it is being polled, so writing body chunks while the send future
//! sits unpolled would deadlock the shared async executor. The response body is still streamed
//! chunk-by-chunk (not read to completion eagerly).

use rquickjs::class::Trace;
use rquickjs::prelude::List;
use rquickjs::{Ctx, Exception, JsLifetime, TypedArray};
use std::future::Future;
use std::pin::Pin;
use url::Url;
use wasip3::http::types::{ErrorCode, Fields, Method, Request, Response, Scheme, Trailers};
use wasip3::wit_bindgen::rt::async_support::{FutureReader, StreamReader, StreamResult};

/// Boxed, pinned future that drives a `wasi:http/client.send` and the request-body upload
/// concurrently, resolving once the response head is available.
type SendFuture = Pin<Box<dyn Future<Output = Result<Response, ErrorCode>>>>;

/// Reader half of the response body result future. Resolves once the response body stream is
/// closed, reporting whether the body was received successfully.
type BodyResultReader = FutureReader<Result<Option<Trailers>, ErrorCode>>;

#[rquickjs::module]
pub mod native_module {
    pub use super::NodeHttpClientRequest;
    pub use super::NodeHttpIncomingResponse;
}

pub(crate) struct RawResponse {
    status: u16,
    headers: Vec<Vec<String>>,
    response: Response,
}

enum RequestState {
    /// Accumulating request headers and body. The body is buffered here across `write*` calls.
    Building {
        body: Vec<u8>,
    },
    /// Transient state while an async write/finish is in progress. Prevents re-entrant calls from
    /// seeing `Aborted` incorrectly.
    Writing,
    /// The request body is finished; the joined send+upload future is in flight.
    Sending {
        send_future: SendFuture,
    },
    ResponseReady(RawResponse),
    Consumed,
    Aborted,
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct NodeHttpClientRequest {
    method: String,
    url: String,
    #[qjs(skip_trace)]
    headers: Vec<(String, String)>,
    #[qjs(skip_trace)]
    state: RequestState,
    aborted: bool,
}

impl Default for NodeHttpClientRequest {
    fn default() -> Self {
        Self::new("GET".to_string(), "http://localhost".to_string())
    }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl NodeHttpClientRequest {
    #[qjs(constructor)]
    pub fn new(method: String, url: String) -> Self {
        NodeHttpClientRequest {
            method,
            url,
            headers: Vec::new(),
            state: RequestState::Building { body: Vec::new() },
            aborted: false,
        }
    }

    pub async fn start<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }
        // The request body is buffered until `finish`, so `start` only validates the URL eagerly
        // (matching the Preview 2 path, which fails a malformed URL when the request starts).
        if matches!(self.state, RequestState::Building { .. }) {
            Url::parse(&self.url)
                .map_err(|_| Exception::throw_message(&ctx, "failed to parse url"))?;
        }
        Ok(())
    }

    pub fn write<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: TypedArray<'js, u8>,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        let bytes = chunk.as_bytes().ok_or_else(|| {
            Exception::throw_message(&ctx, "the Uint8Array passed to write is detached")
        })?;

        self.append_body(&ctx, bytes)
    }

    pub fn write_string<'js>(&mut self, ctx: Ctx<'js>, data: String) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        self.append_body(&ctx, data.as_bytes())
    }

    pub async fn write_stream<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: TypedArray<'js, u8>,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        let bytes = chunk.as_bytes().ok_or_else(|| {
            Exception::throw_message(&ctx, "the Uint8Array passed to write is detached")
        })?;

        self.append_body(&ctx, bytes)
    }

    pub async fn write_string_stream<'js>(
        &mut self,
        ctx: Ctx<'js>,
        data: String,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        self.append_body(&ctx, data.as_bytes())
    }

    pub fn set_header<'js>(
        &mut self,
        ctx: Ctx<'js>,
        name: String,
        value: String,
    ) -> rquickjs::Result<()> {
        if !matches!(self.state, RequestState::Building { .. }) {
            return Err(Exception::throw_message(
                &ctx,
                "Cannot set headers after request has been sent",
            ));
        }
        let lower = name.to_ascii_lowercase();
        self.headers
            .retain(|(n, _)| n.to_ascii_lowercase() != lower);
        self.headers.push((name, value));
        Ok(())
    }

    pub fn append_header<'js>(
        &mut self,
        ctx: Ctx<'js>,
        name: String,
        value: String,
    ) -> rquickjs::Result<()> {
        if !matches!(self.state, RequestState::Building { .. }) {
            return Err(Exception::throw_message(
                &ctx,
                "Cannot set headers after request has been sent",
            ));
        }
        self.headers.push((name, value));
        Ok(())
    }

    pub fn remove_header<'js>(&mut self, ctx: Ctx<'js>, name: String) -> rquickjs::Result<()> {
        if !matches!(self.state, RequestState::Building { .. }) {
            return Err(Exception::throw_message(
                &ctx,
                "Cannot remove headers after request has been sent",
            ));
        }
        let lower = name.to_ascii_lowercase();
        self.headers
            .retain(|(n, _)| n.to_ascii_lowercase() != lower);
        Ok(())
    }

    pub async fn finish<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: Option<TypedArray<'js, u8>>,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        if let Some(chunk) = chunk {
            let bytes = chunk.as_bytes().ok_or_else(|| {
                Exception::throw_message(&ctx, "the Uint8Array passed to finish is detached")
            })?;
            self.append_body(&ctx, bytes)?;
        }

        // Take the buffered body and build the outgoing request. The send subtask and the body
        // upload are driven concurrently by the joined future so the request body stream is drained
        // while `send` is in flight.
        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        let RequestState::Building { body } = taken else {
            self.state = taken;
            return Err(Exception::throw_message(
                &ctx,
                "Cannot finish: request has already been sent",
            ));
        };

        let parsed_url = match Url::parse(&self.url) {
            Ok(url) => url,
            Err(_) => {
                self.state = RequestState::Aborted;
                self.aborted = true;
                return Err(Exception::throw_message(&ctx, "failed to parse url"));
            }
        };

        let fields = build_fields(&self.headers);
        let (mut body_tx, body_rx) = wasip3::wit_stream::new();
        let (trailers_tx, trailers_rx) =
            wasip3::wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));
        // `_transmit` resolves to the request body transmission result; upload failures surface as
        // a rejected `send`, so it is dropped here.
        let (request, _transmit) = Request::new(fields, Some(body_rx), trailers_rx, None);

        let method = parse_method(&self.method);
        let scheme = parse_scheme(parsed_url.scheme());
        let authority = url_authority(&parsed_url);
        let path_with_query = url_path_with_query(&parsed_url);
        apply_request_targets(
            &ctx,
            &request,
            &method,
            scheme.as_ref(),
            authority.as_deref(),
            &path_with_query,
        )?;

        let send_future: SendFuture = Box::pin(async move {
            let write_fut = async move {
                // `write_all` returns any bytes it could not deliver; dropping the writer closes
                // the request body stream and dropping the trailers writer resolves it to the
                // default `Ok(None)` (no trailers).
                let _remaining = body_tx.write_all(body).await;
                drop(body_tx);
                drop(trailers_tx);
            };
            let (send_result, ()) =
                futures::future::join(wasip3::http::client::send(request), write_fut).await;
            send_result
        });

        self.state = RequestState::Sending { send_future };
        Ok(())
    }

    pub async fn wait_for_response<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        if let RequestState::Sending { send_future } = taken {
            let response = send_future
                .await
                .map_err(|err| throw_http_error(&ctx, &err))?;

            let status = response.get_status_code();
            let headers = fields_to_pairs(&response.get_headers());

            self.state = RequestState::ResponseReady(RawResponse {
                status,
                headers,
                response,
            });
            Ok(())
        } else {
            self.state = taken;
            Err(Exception::throw_message(
                &ctx,
                "Cannot wait for response: request body not finished",
            ))
        }
    }

    pub async fn end<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: Option<TypedArray<'js, u8>>,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        self.finish(ctx.clone(), chunk).await?;
        self.wait_for_response(ctx).await?;
        Ok(())
    }

    pub fn get_response<'js>(&mut self, _ctx: Ctx<'js>) -> Option<NodeHttpIncomingResponse> {
        if self.aborted {
            return None;
        }

        let taken = std::mem::replace(&mut self.state, RequestState::Consumed);
        if let RequestState::ResponseReady(raw) = taken {
            Some(NodeHttpIncomingResponse::from_raw_response(raw))
        } else {
            self.state = taken;
            None
        }
    }

    pub fn abort(&mut self) {
        self.aborted = true;
        self.state = RequestState::Aborted;
    }
}

impl NodeHttpClientRequest {
    /// Appends bytes to the buffered request body, erroring if the request has already been sent.
    fn append_body(&mut self, ctx: &Ctx<'_>, bytes: &[u8]) -> rquickjs::Result<()> {
        match &mut self.state {
            RequestState::Building { body } => {
                body.extend_from_slice(bytes);
                Ok(())
            }
            _ => Err(Exception::throw_message(
                ctx,
                "Cannot write after request body has been finished",
            )),
        }
    }
}

enum ResponseBodyState {
    /// Response head received; the body stream has not been consumed yet.
    Unconsumed(Response),
    /// The body stream is being read incrementally.
    Reading {
        reader: StreamReader<u8>,
        result: BodyResultReader,
    },
    /// The body stream reported end-of-stream after a final data chunk; the body result future
    /// still needs to be awaited to surface a mid-transfer error.
    Finishing {
        result: BodyResultReader,
    },
    Consumed,
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct NodeHttpIncomingResponse {
    #[qjs(skip_trace)]
    body_state: ResponseBodyState,
    headers: Vec<Vec<String>>,
    status: u16,
}

impl Default for NodeHttpIncomingResponse {
    fn default() -> Self {
        Self::new()
    }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl NodeHttpIncomingResponse {
    #[qjs(constructor)]
    pub fn new() -> Self {
        NodeHttpIncomingResponse {
            body_state: ResponseBodyState::Consumed,
            headers: Vec::new(),
            status: 0,
        }
    }

    #[qjs(skip)]
    pub(crate) fn from_raw_response(raw: RawResponse) -> Self {
        NodeHttpIncomingResponse {
            body_state: ResponseBodyState::Unconsumed(raw.response),
            headers: raw.headers,
            status: raw.status,
        }
    }

    #[qjs(get)]
    pub fn status(&self) -> u16 {
        self.status
    }

    #[qjs(get)]
    pub fn headers(&self) -> Vec<Vec<String>> {
        self.headers.clone()
    }

    pub fn discard_body(&mut self) {
        // Dropping the response / stream reader / result future discards the body without reading.
        self.body_state = ResponseBodyState::Consumed;
    }

    pub async fn read_body_chunk<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<List<(Option<TypedArray<'js, u8>>, bool)>> {
        let state = std::mem::replace(&mut self.body_state, ResponseBodyState::Consumed);

        match state {
            ResponseBodyState::Unconsumed(response) => {
                // Consume the response body stream. The `res` future signals a handling result to
                // the transport; we always signal success by letting its writer resolve to `Ok(())`.
                let (res_tx, res_rx) = wasip3::wit_future::new(|| Ok::<(), ErrorCode>(()));
                let (reader, result) = Response::consume_body(response, res_rx);
                drop(res_tx);
                self.body_state = ResponseBodyState::Reading { reader, result };
                self.read_from_reader(ctx).await
            }
            ResponseBodyState::Reading { reader, result } => {
                self.body_state = ResponseBodyState::Reading { reader, result };
                self.read_from_reader(ctx).await
            }
            ResponseBodyState::Finishing { result } => {
                let body_error = body_result_error(result).await;
                if let Some(err) = body_error {
                    return Err(Exception::throw_message(&ctx, &err));
                }
                Ok(List((None, true)))
            }
            ResponseBodyState::Consumed => Ok(List((None, true))),
        }
    }
}

impl NodeHttpIncomingResponse {
    async fn read_from_reader<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<List<(Option<TypedArray<'js, u8>>, bool)>> {
        let state = std::mem::replace(&mut self.body_state, ResponseBodyState::Consumed);

        let ResponseBodyState::Reading { mut reader, result } = state else {
            return Ok(List((None, true)));
        };

        const CHUNK_SIZE: usize = 16384;
        loop {
            let (status, buf) = reader.read(Vec::with_capacity(CHUNK_SIZE)).await;
            match status {
                StreamResult::Complete(_) if !buf.is_empty() => {
                    let js_array = TypedArray::new_copy(ctx.clone(), buf).map_err(|_| {
                        Exception::throw_message(
                            &ctx,
                            "Failed to create TypedArray from response body chunk",
                        )
                    })?;
                    self.body_state = ResponseBodyState::Reading { reader, result };
                    return Ok(List((Some(js_array), false)));
                }
                // A zero-length completion carries no data and no EOF signal; retry.
                StreamResult::Complete(_) => continue,
                StreamResult::Dropped => {
                    // Body stream closed. Drop the reader; a final data chunk (if any) is returned
                    // now and the body result future is checked on the next call.
                    drop(reader);
                    if buf.is_empty() {
                        let body_error = body_result_error(result).await;
                        if let Some(err) = body_error {
                            return Err(Exception::throw_message(&ctx, &err));
                        }
                        return Ok(List((None, true)));
                    }
                    let js_array = TypedArray::new_copy(ctx.clone(), buf).map_err(|_| {
                        Exception::throw_message(
                            &ctx,
                            "Failed to create TypedArray from response body chunk",
                        )
                    })?;
                    self.body_state = ResponseBodyState::Finishing { result };
                    return Ok(List((Some(js_array), false)));
                }
                StreamResult::Cancelled => return Ok(List((None, true))),
            }
        }
    }
}

/// Awaits the response body result future, returning an error message if the body failed
/// mid-transfer (e.g. a truncated response).
async fn body_result_error(result: BodyResultReader) -> Option<String> {
    match result.await {
        Ok(_) => None,
        Err(e) => Some(format!("HTTP response body error: {e:?}")),
    }
}

fn http_error_to_node_code(err: &ErrorCode) -> &'static str {
    match err {
        ErrorCode::ConnectionTerminated => "ECONNRESET",
        ErrorCode::ConnectionReadTimeout => "ETIMEDOUT",
        ErrorCode::ConnectionWriteTimeout => "ETIMEDOUT",
        ErrorCode::ConnectionTimeout => "ETIMEDOUT",
        ErrorCode::HttpResponseTimeout => "ETIMEDOUT",
        ErrorCode::ConnectionRefused => "ECONNREFUSED",
        ErrorCode::DnsTimeout => "ENOTFOUND",
        ErrorCode::DnsError(e) => {
            if e.rcode.as_deref() == Some("NXDOMAIN") || e.info_code == Some(3) {
                "ENOTFOUND"
            } else {
                "EAI_FAIL"
            }
        }
        ErrorCode::DestinationNotFound => "ENOTFOUND",
        ErrorCode::DestinationUnavailable => "ECONNREFUSED",
        ErrorCode::HttpResponseIncomplete => "ECONNRESET",
        ErrorCode::HttpProtocolError => "ECONNRESET",
        ErrorCode::InternalError(_) => "ECONNRESET",
        _ => "EIO",
    }
}

fn throw_http_error(ctx: &Ctx<'_>, err: &ErrorCode) -> rquickjs::Error {
    let code = http_error_to_node_code(err);
    let message = format!("{err:?}");
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    Exception::throw_message(
        ctx,
        &format!("{{\"code\":\"{code}\",\"syscall\":\"request\",\"message\":\"{escaped}\"}}"),
    )
}

// ---------------------------------------------------------------------------
// wasip3 request helpers (mirrors the Preview 2 native contract).
// ---------------------------------------------------------------------------

fn parse_method(method: &str) -> Method {
    // Match the standard methods by their canonical (upper-case) spelling only; any other token
    // becomes an extension method with its original case preserved, exactly like the Preview 2 path.
    match method {
        "GET" => Method::Get,
        "HEAD" => Method::Head,
        "POST" => Method::Post,
        "PUT" => Method::Put,
        "DELETE" => Method::Delete,
        "CONNECT" => Method::Connect,
        "OPTIONS" => Method::Options,
        "TRACE" => Method::Trace,
        "PATCH" => Method::Patch,
        other => Method::Other(other.to_string()),
    }
}

fn parse_scheme(scheme: &str) -> Option<Scheme> {
    match scheme {
        "http" => Some(Scheme::Http),
        "https" => Some(Scheme::Https),
        "" => None,
        other => Some(Scheme::Other(other.to_string())),
    }
}

fn url_authority(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

fn url_path_with_query(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{}", url.path(), query),
        None => url.path().to_string(),
    }
}

fn apply_request_targets(
    ctx: &Ctx<'_>,
    request: &Request,
    method: &Method,
    scheme: Option<&Scheme>,
    authority: Option<&str>,
    path_with_query: &str,
) -> rquickjs::Result<()> {
    request
        .set_method(method)
        .map_err(|_| Exception::throw_message(ctx, "failed to set method"))?;
    request
        .set_scheme(scheme)
        .map_err(|_| Exception::throw_message(ctx, "failed to set scheme"))?;
    request
        .set_authority(authority)
        .map_err(|_| Exception::throw_message(ctx, "failed to set authority"))?;
    request
        .set_path_with_query(Some(path_with_query))
        .map_err(|_| Exception::throw_message(ctx, "failed to set path"))?;
    Ok(())
}

/// Builds a `wasi:http` `fields` resource from a header list, skipping the `host` header (which the
/// transport derives from the request authority).
fn build_fields(headers: &[(String, String)]) -> Fields {
    let fields = Fields::new();
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("host") {
            continue;
        }
        // Best effort: ignore headers the host rejects rather than failing the whole request.
        let _ = fields.append(name, value.as_bytes());
    }
    fields
}

/// Hop-by-hop / forbidden headers that the wasmtime Preview 2 host strips from
/// incoming response fields (`remove_forbidden_headers`). The Preview 3 host
/// passes response headers through unfiltered, so we apply the same filter here
/// to keep the two generation targets behaviorally identical.
fn is_forbidden_response_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-connection"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "http2-settings"
    )
}

fn fields_to_pairs(fields: &Fields) -> Vec<Vec<String>> {
    fields
        .copy_all()
        .into_iter()
        .filter(|(name, _)| !is_forbidden_response_header(name))
        .map(|(name, value)| {
            vec![
                name,
                String::from_utf8(value).unwrap_or_else(|_| "Invalid header value".to_string()),
            ]
        })
        .collect()
}

// ---------------------------------------------------------------------------
// JavaScript sources (shared with the Preview 2 path).
// ---------------------------------------------------------------------------

pub const NODE_HTTP_JS: &str = include_str!("node_http.js");
pub const NODE_HTTP_SERVER_JS: &str = include_str!("node_http_server.js");
pub const HTTP_COMMON_JS: &str = include_str!("node_http_common.js");
pub const HTTP_AGENT_JS: &str = include_str!("node_http_agent.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:http'; export { default } from 'node:http';"#;
