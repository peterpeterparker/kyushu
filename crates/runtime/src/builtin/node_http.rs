use rquickjs::class::Trace;
use rquickjs::prelude::List;
use rquickjs::{Ctx, Exception, JsLifetime, TypedArray};
use wasip2::http::outgoing_handler;
use wasip2::http::types as wasi_http;
use wasip2::io::streams::{InputStream, OutputStream, StreamError};
use wstd::runtime::AsyncPollable;

#[rquickjs::module]
pub mod native_module {
    pub use super::NodeHttpClientRequest;
    pub use super::NodeHttpIncomingResponse;
}

enum ResponseBodyState {
    WasiNative {
        incoming_response: wasi_http::IncomingResponse,
    },
    Stream {
        stream: InputStream,
        body: wasi_http::IncomingBody,
        incoming_response: wasi_http::IncomingResponse,
    },
    Consumed,
}

pub(crate) struct RawResponse {
    status: u16,
    headers: Vec<Vec<String>>,
    incoming_response: wasi_http::IncomingResponse,
}

enum RequestState {
    Created {
        buffered_body: Vec<u8>,
    },
    Started {
        body: wasi_http::OutgoingBody,
        stream: OutputStream,
        future_response: wasi_http::FutureIncomingResponse,
    },
    /// Transient state while an async write or finish is in progress.
    /// Prevents re-entrant calls from seeing Aborted incorrectly.
    Writing,
    BodyFinished {
        future_response: wasi_http::FutureIncomingResponse,
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
            state: RequestState::Created {
                buffered_body: Vec::new(),
            },
            aborted: false,
        }
    }

    pub async fn start<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }
        if !matches!(self.state, RequestState::Created { .. }) {
            return Ok(());
        }

        // Build the outgoing request BEFORE taking ownership of state,
        // so that errors leave the buffered body intact.
        let parsed_url: url::Url = self
            .url
            .parse()
            .map_err(|_| Exception::throw_message(&ctx, "failed to parse url"))?;

        let scheme = match parsed_url.scheme() {
            "http" => wasi_http::Scheme::Http,
            "https" => wasi_http::Scheme::Https,
            other => wasi_http::Scheme::Other(other.to_string()),
        };

        let header_entries: Vec<(String, Vec<u8>)> = self
            .headers
            .iter()
            .map(|(name, value)| (name.clone(), value.as_bytes().to_vec()))
            .collect();

        let fields = wasi_http::Fields::from_list(&header_entries)
            .map_err(|_| Exception::throw_message(&ctx, "failed to create request headers"))?;

        let outgoing_request = wasi_http::OutgoingRequest::new(fields);

        let wasi_method = match self.method.as_str() {
            "GET" => wasi_http::Method::Get,
            "POST" => wasi_http::Method::Post,
            "PUT" => wasi_http::Method::Put,
            "DELETE" => wasi_http::Method::Delete,
            "HEAD" => wasi_http::Method::Head,
            "OPTIONS" => wasi_http::Method::Options,
            "CONNECT" => wasi_http::Method::Connect,
            "PATCH" => wasi_http::Method::Patch,
            "TRACE" => wasi_http::Method::Trace,
            other => wasi_http::Method::Other(other.to_string()),
        };

        outgoing_request
            .set_method(&wasi_method)
            .map_err(|_| Exception::throw_message(&ctx, "failed to set method"))?;

        let path_with_query = match parsed_url.query() {
            Some(query) => format!("{}?{}", parsed_url.path(), query),
            None => parsed_url.path().to_string(),
        };
        outgoing_request
            .set_path_with_query(Some(&path_with_query))
            .map_err(|_| Exception::throw_message(&ctx, "failed to set path"))?;
        outgoing_request
            .set_scheme(Some(&scheme))
            .map_err(|_| Exception::throw_message(&ctx, "failed to set scheme"))?;
        outgoing_request
            .set_authority(Some(parsed_url.authority()))
            .map_err(|_| Exception::throw_message(&ctx, "failed to set authority"))?;

        let body = outgoing_request
            .body()
            .map_err(|_| Exception::throw_message(&ctx, "failed to get request body"))?;
        let stream = body
            .write()
            .map_err(|_| Exception::throw_message(&ctx, "failed to get body stream"))?;

        let future_response = outgoing_handler::handle(outgoing_request, None).map_err(|err| {
            Exception::throw_message(&ctx, &format!("HTTP request failed: {err:?}"))
        })?;

        // Now take the buffered body — all fallible construction succeeded.
        let buffered_body = if let RequestState::Created { buffered_body } = std::mem::replace(
            &mut self.state,
            RequestState::Started {
                body,
                stream,
                future_response,
            },
        ) {
            buffered_body
        } else {
            unreachable!("checked Created above")
        };

        // Flush any data that was buffered via sync write() before start().
        if !buffered_body.is_empty()
            && let RequestState::Started { stream: ref s, .. } = self.state
        {
            write_all_to_stream(&ctx, s, &buffered_body).await?;
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

        match &mut self.state {
            RequestState::Created { buffered_body } => {
                buffered_body.extend_from_slice(bytes);
                Ok(())
            }
            _ => Err(Exception::throw_message(
                &ctx,
                "Cannot write after request has been started",
            )),
        }
    }

    pub fn write_string<'js>(&mut self, ctx: Ctx<'js>, data: String) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        match &mut self.state {
            RequestState::Created { buffered_body } => {
                buffered_body.extend_from_slice(data.as_bytes());
                Ok(())
            }
            _ => Err(Exception::throw_message(
                &ctx,
                "Cannot write after request has been started",
            )),
        }
    }

    pub async fn write_stream<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: TypedArray<'js, u8>,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }
        self.ensure_started(&ctx).await?;

        let bytes = chunk.as_bytes().ok_or_else(|| {
            Exception::throw_message(&ctx, "the Uint8Array passed to write is detached")
        })?;

        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        if let RequestState::Started {
            body,
            stream,
            future_response,
        } = taken
        {
            let result = write_all_to_stream(&ctx, &stream, bytes).await;
            self.state = RequestState::Started {
                body,
                stream,
                future_response,
            };
            result
        } else {
            self.state = taken;
            Err(Exception::throw_message(
                &ctx,
                "Cannot write after request body has been finished",
            ))
        }
    }

    pub async fn write_string_stream<'js>(
        &mut self,
        ctx: Ctx<'js>,
        data: String,
    ) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }
        self.ensure_started(&ctx).await?;

        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        if let RequestState::Started {
            body,
            stream,
            future_response,
        } = taken
        {
            let result = write_all_to_stream(&ctx, &stream, data.as_bytes()).await;
            self.state = RequestState::Started {
                body,
                stream,
                future_response,
            };
            result
        } else {
            self.state = taken;
            Err(Exception::throw_message(
                &ctx,
                "Cannot write after request body has been finished",
            ))
        }
    }

    pub fn set_header<'js>(
        &mut self,
        ctx: Ctx<'js>,
        name: String,
        value: String,
    ) -> rquickjs::Result<()> {
        if !matches!(self.state, RequestState::Created { .. }) {
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
        if !matches!(self.state, RequestState::Created { .. }) {
            return Err(Exception::throw_message(
                &ctx,
                "Cannot set headers after request has been sent",
            ));
        }
        self.headers.push((name, value));
        Ok(())
    }

    pub fn remove_header<'js>(&mut self, ctx: Ctx<'js>, name: String) -> rquickjs::Result<()> {
        if !matches!(self.state, RequestState::Created { .. }) {
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
        self.ensure_started(&ctx).await?;

        if let Some(chunk) = chunk {
            let bytes = chunk.as_bytes().ok_or_else(|| {
                Exception::throw_message(&ctx, "the Uint8Array passed to finish is detached")
            })?;
            let taken = std::mem::replace(&mut self.state, RequestState::Writing);
            if let RequestState::Started {
                body,
                stream,
                future_response,
            } = taken
            {
                let result = write_all_to_stream(&ctx, &stream, bytes).await;
                if result.is_err() {
                    self.state = RequestState::Started {
                        body,
                        stream,
                        future_response,
                    };
                    return result;
                }
                self.state = RequestState::Started {
                    body,
                    stream,
                    future_response,
                };
            } else {
                self.state = taken;
                return Err(Exception::throw_message(
                    &ctx,
                    "Cannot finish: request not in started state",
                ));
            }
        }

        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        if let RequestState::Started {
            body,
            stream,
            future_response,
        } = taken
        {
            drop(stream);
            wasi_http::OutgoingBody::finish(body, None)
                .map_err(|_| Exception::throw_message(&ctx, "failed to finish request body"))?;
            self.state = RequestState::BodyFinished { future_response };
            Ok(())
        } else {
            self.state = taken;
            Err(Exception::throw_message(
                &ctx,
                "Cannot finish: request not in started state",
            ))
        }
    }

    pub async fn wait_for_response<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        if self.aborted {
            return Err(Exception::throw_message(&ctx, "Request has been aborted"));
        }

        let taken = std::mem::replace(&mut self.state, RequestState::Writing);
        if let RequestState::BodyFinished { future_response } = taken {
            let incoming_response = get_incoming_response(&ctx, &future_response).await?;

            let status = incoming_response.status();
            let response_fields = incoming_response.headers();
            let raw_entries = response_fields.entries();
            let headers: Vec<Vec<String>> = raw_entries
                .into_iter()
                .map(|(name, value)| {
                    vec![
                        name,
                        String::from_utf8(value)
                            .unwrap_or_else(|_| "Invalid header value".to_string()),
                    ]
                })
                .collect();

            self.state = RequestState::ResponseReady(RawResponse {
                status,
                headers,
                incoming_response,
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
    async fn ensure_started<'js>(&mut self, ctx: &Ctx<'js>) -> rquickjs::Result<()> {
        if matches!(self.state, RequestState::Created { .. }) {
            self.start(ctx.clone()).await
        } else {
            Ok(())
        }
    }
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
            body_state: ResponseBodyState::WasiNative {
                incoming_response: raw.incoming_response,
            },
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
        let state = std::mem::replace(&mut self.body_state, ResponseBodyState::Consumed);
        match state {
            ResponseBodyState::WasiNative { incoming_response } => {
                drop(incoming_response);
            }
            ResponseBodyState::Stream {
                stream,
                body,
                incoming_response,
            } => {
                drop(stream);
                drop(body);
                drop(incoming_response);
            }
            ResponseBodyState::Consumed => {}
        }
    }

    pub async fn read_body_chunk<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<List<(Option<TypedArray<'js, u8>>, bool)>> {
        let state = std::mem::replace(&mut self.body_state, ResponseBodyState::Consumed);

        match state {
            ResponseBodyState::WasiNative { incoming_response } => {
                let incoming_body = incoming_response.consume().map_err(|_| {
                    Exception::throw_message(&ctx, "failed to consume response body")
                })?;
                let stream = incoming_body
                    .stream()
                    .map_err(|_| Exception::throw_message(&ctx, "failed to get body stream"))?;
                self.body_state = ResponseBodyState::Stream {
                    stream,
                    body: incoming_body,
                    incoming_response,
                };
                self.read_from_stream(ctx).await
            }
            ResponseBodyState::Stream {
                stream,
                body,
                incoming_response,
            } => {
                self.body_state = ResponseBodyState::Stream {
                    stream,
                    body,
                    incoming_response,
                };
                self.read_from_stream(ctx).await
            }
            ResponseBodyState::Consumed => Ok(List((None, true))),
        }
    }
}

impl NodeHttpIncomingResponse {
    async fn read_from_stream<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<List<(Option<TypedArray<'js, u8>>, bool)>> {
        let state = std::mem::replace(&mut self.body_state, ResponseBodyState::Consumed);

        if let ResponseBodyState::Stream {
            stream,
            body,
            incoming_response,
        } = state
        {
            const CHUNK_SIZE: u64 = 4096;
            loop {
                match stream.read(CHUNK_SIZE) {
                    Ok(chunk) if !chunk.is_empty() => {
                        let js_array = TypedArray::new_copy(ctx.clone(), chunk).map_err(|_| {
                            Exception::throw_message(
                                &ctx,
                                "Failed to create TypedArray from response body chunk",
                            )
                        })?;
                        self.body_state = ResponseBodyState::Stream {
                            stream,
                            body,
                            incoming_response,
                        };
                        return Ok(List((Some(js_array), false)));
                    }
                    Ok(_) => {
                        let pollable = stream.subscribe();
                        AsyncPollable::new(pollable).wait_for().await;
                    }
                    Err(StreamError::Closed) => {
                        drop(stream);
                        drop(body);
                        drop(incoming_response);
                        return Ok(List((None, true)));
                    }
                    Err(StreamError::LastOperationFailed(err)) => {
                        let debug_message = err.to_debug_string();
                        if debug_message.to_ascii_lowercase().contains("would") {
                            let pollable = stream.subscribe();
                            AsyncPollable::new(pollable).wait_for().await;
                            continue;
                        }

                        return Err(Exception::throw_message(
                            &ctx,
                            &format!("Failed to read response body: {debug_message}"),
                        ));
                    }
                }
            }
        } else {
            Ok(List((None, true)))
        }
    }
}

fn http_error_to_node_code(err: &wasi_http::ErrorCode) -> &'static str {
    match err {
        wasi_http::ErrorCode::ConnectionTerminated => "ECONNRESET",
        wasi_http::ErrorCode::ConnectionReadTimeout => "ETIMEDOUT",
        wasi_http::ErrorCode::ConnectionWriteTimeout => "ETIMEDOUT",
        wasi_http::ErrorCode::ConnectionTimeout => "ETIMEDOUT",
        wasi_http::ErrorCode::HttpResponseTimeout => "ETIMEDOUT",
        wasi_http::ErrorCode::ConnectionRefused => "ECONNREFUSED",
        wasi_http::ErrorCode::DnsTimeout => "ENOTFOUND",
        wasi_http::ErrorCode::DnsError(e) => {
            if e.rcode.as_deref() == Some("NXDOMAIN") || e.info_code == Some(3) {
                "ENOTFOUND"
            } else {
                "EAI_FAIL"
            }
        }
        wasi_http::ErrorCode::DestinationNotFound => "ENOTFOUND",
        wasi_http::ErrorCode::DestinationUnavailable => "ECONNREFUSED",
        wasi_http::ErrorCode::HttpResponseIncomplete => "ECONNRESET",
        wasi_http::ErrorCode::HttpProtocolError => "ECONNRESET",
        wasi_http::ErrorCode::InternalError(_) => "ECONNRESET",
        _ => "EIO",
    }
}

fn throw_http_error(ctx: &Ctx<'_>, err: &wasi_http::ErrorCode) -> rquickjs::Error {
    let code = http_error_to_node_code(err);
    let message = format!("{err:?}");
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    Exception::throw_message(
        ctx,
        &format!("{{\"code\":\"{code}\",\"syscall\":\"request\",\"message\":\"{escaped}\"}}"),
    )
}

async fn get_incoming_response<'js>(
    ctx: &Ctx<'js>,
    future_response: &wasi_http::FutureIncomingResponse,
) -> rquickjs::Result<wasi_http::IncomingResponse> {
    match future_response.get() {
        Some(Ok(Ok(incoming_response))) => Ok(incoming_response),
        Some(Ok(Err(err))) => Err(throw_http_error(ctx, &err)),
        Some(Err(())) => Err(Exception::throw_message(ctx, "HTTP request failed")),
        None => {
            let pollable = future_response.subscribe();
            AsyncPollable::new(pollable).wait_for().await;
            match future_response.get() {
                Some(Ok(Ok(incoming_response))) => Ok(incoming_response),
                Some(Ok(Err(err))) => Err(throw_http_error(ctx, &err)),
                _ => Err(Exception::throw_message(ctx, "HTTP request failed")),
            }
        }
    }
}

async fn write_all_to_stream<'js>(
    ctx: &Ctx<'js>,
    stream: &OutputStream,
    data: &[u8],
) -> rquickjs::Result<()> {
    if data.is_empty() {
        return Ok(());
    }
    let mut offset = 0;
    while offset < data.len() {
        let remaining = &data[offset..];
        match stream.check_write() {
            Ok(0) => {
                let pollable = stream.subscribe();
                AsyncPollable::new(pollable).wait_for().await;
            }
            Ok(permit) => {
                let to_write = std::cmp::min(permit as usize, remaining.len());
                stream
                    .write(&remaining[..to_write])
                    .map_err(|_| Exception::throw_message(ctx, "failed to write request body"))?;
                offset += to_write;
            }
            Err(_) => {
                return Err(Exception::throw_message(
                    ctx,
                    "failed to write request body",
                ));
            }
        }
    }
    stream
        .flush()
        .map_err(|_| Exception::throw_message(ctx, "failed to flush request body"))?;
    let pollable = stream.subscribe();
    AsyncPollable::new(pollable).wait_for().await;
    Ok(())
}

pub const NODE_HTTP_JS: &str = include_str!("node_http.js");
pub const NODE_HTTP_SERVER_JS: &str = include_str!("node_http_server.js");
pub const HTTP_COMMON_JS: &str = include_str!("node_http_common.js");
pub const HTTP_AGENT_JS: &str = include_str!("node_http_agent.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:http'; export { default } from 'node:http';"#;
