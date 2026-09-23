//! WASI Preview 3 `fetch`/HTTP native bridge.
//!
//! This is the Preview 3 counterpart of [`super::http`] (`builtin/http.rs`). It exposes the
//! *exact same* native class contract (`HttpRequest`, its body writer, and `HttpResponse`) so
//! that the shared JavaScript implementation in `builtin/http.js` can be reused verbatim on both
//! generation targets. The only difference is the transport: the Preview 2 file drives requests
//! through `golem-wasi-http` (which depends on `wstd`/`wasip2` pollables), whereas this file uses
//! the `wasip3` crate's `wasi:http/client` binding (`wasip3::http::client::send`) and Component
//! Model async `stream<u8>`/`future` bodies. No `wstd`, `wasip2`, or Preview 2 pollables are used.
//!
//! ## Scope (Phase 3)
//!
//! Buffered requests and responses are fully supported: `GET`/`HEAD` plus buffered request
//! bodies (string / `ArrayBuffer` / `Uint8Array` / `URLSearchParams` / `Blob` / `FormData`,
//! the latter two are converted to `ArrayBuffer` by `http.js` before reaching native code),
//! redirect following/error/manual policies, credentials filtering, referrer policy, and
//! response consumption via `text()`, `arrayBuffer()`, and `body`/`stream()`. Response bodies
//! are read to completion eagerly after the response head arrives, so streaming is served from
//! the buffered bytes.
//!
//! Streaming *request* bodies (a `ReadableStream` passed as the fetch body) are also supported.
//! `http.js` drives them through the split native contract (`initSend` / `initRequestBody` /
//! `sendRequest` / `receiveResponse` plus the body writer's `writeRequestBodyChunk` /
//! `finishBody`). On Preview 3 this maps onto a Component Model `stream<u8>` request body: the
//! outgoing `wasi:http/client.send` future and the JS-driven chunk writes make progress
//! concurrently on the shared async executor, so the request body is uploaded incrementally
//! instead of being buffered. Redirects for streaming bodies are resolved by the shared JS loop,
//! one native request/response attempt at a time.

use http::{HeaderName, HeaderValue, StatusCode, Version};
use rquickjs::convert::Coerced;
use rquickjs::prelude::List;
use rquickjs::{ArrayBuffer, Ctx, Exception, FromJs, IntoJs, JsLifetime, TypedArray, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use url::Url;
use wasip3::http::types::{ErrorCode, Fields, Method, Request, Response, Scheme, Trailers};
use wasip3::wit_bindgen::{FutureWriter, StreamWriter};

/// Boxed, pinned `wasi:http/client.send` future. It owns the outgoing [`Request`] (including the
/// request body stream reader) and resolves once the response head is available.
type SendFuture = Pin<Box<dyn Future<Output = Result<Response, ErrorCode>>>>;

/// Writer half of the request body trailers future. Dropping it resolves the trailers to the
/// default `Ok(None)` (no trailers).
type TrailersWriter = FutureWriter<Result<Option<Trailers>, ErrorCode>>;

/// Native module exposed to JavaScript as `__wasm_rquickjs_builtin/http_native`.
#[rquickjs::module]
pub mod native_module {
    pub use super::HttpRequest;
    pub use super::HttpResponse;
}

// ---------------------------------------------------------------------------
// Transport-agnostic fetch enums (mirrors the Preview 2 `builtin/http.rs`).
// ---------------------------------------------------------------------------

/// Request mode - defines the cross-origin behavior
#[derive(Debug, Clone, Copy, PartialEq, Eq, rquickjs::class::Trace, rquickjs::JsLifetime)]
pub enum RequestMode {
    Cors,
    NoCors,
    SameOrigin,
    Navigate,
}

impl RequestMode {
    fn as_str(&self) -> &'static str {
        match self {
            RequestMode::Cors => "cors",
            RequestMode::NoCors => "no-cors",
            RequestMode::SameOrigin => "same-origin",
            RequestMode::Navigate => "navigate",
        }
    }

    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "cors" => Ok(RequestMode::Cors),
            "no-cors" => Ok(RequestMode::NoCors),
            "same-origin" => Ok(RequestMode::SameOrigin),
            "navigate" => Ok(RequestMode::Navigate),
            _ => Err(format!("Unknown request mode: {s}")),
        }
    }
}

impl<'js> FromJs<'js> for RequestMode {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let s = String::from_js(ctx, value)?;
        RequestMode::from_str(&s).map_err(|e| Exception::throw_message(ctx, &e))
    }
}

impl<'js> IntoJs<'js> for RequestMode {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        self.as_str().into_js(ctx)
    }
}

/// Referrer policy - controls how the referer header is sent
#[derive(Debug, Clone, Copy, PartialEq, Eq, rquickjs::class::Trace, rquickjs::JsLifetime)]
pub enum ReferrerPolicy {
    NoReferrer,
    NoReferrerWhenDowngrade,
    SameOrigin,
    Origin,
    OriginWhenCrossOrigin,
    StrictOrigin,
    StrictOriginWhenCrossOrigin,
    UnsafeUrl,
}

impl ReferrerPolicy {
    fn as_str(&self) -> &'static str {
        match self {
            ReferrerPolicy::NoReferrer => "no-referrer",
            ReferrerPolicy::NoReferrerWhenDowngrade => "no-referrer-when-downgrade",
            ReferrerPolicy::SameOrigin => "same-origin",
            ReferrerPolicy::Origin => "origin",
            ReferrerPolicy::OriginWhenCrossOrigin => "origin-when-cross-origin",
            ReferrerPolicy::StrictOrigin => "strict-origin",
            ReferrerPolicy::StrictOriginWhenCrossOrigin => "strict-origin-when-cross-origin",
            ReferrerPolicy::UnsafeUrl => "unsafe-url",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "no-referrer" => ReferrerPolicy::NoReferrer,
            "no-referrer-when-downgrade" => ReferrerPolicy::NoReferrerWhenDowngrade,
            "same-origin" => ReferrerPolicy::SameOrigin,
            "origin" => ReferrerPolicy::Origin,
            "origin-when-cross-origin" => ReferrerPolicy::OriginWhenCrossOrigin,
            "strict-origin" => ReferrerPolicy::StrictOrigin,
            "strict-origin-when-cross-origin" | "" => ReferrerPolicy::StrictOriginWhenCrossOrigin,
            "unsafe-url" => ReferrerPolicy::UnsafeUrl,
            _ => ReferrerPolicy::StrictOriginWhenCrossOrigin,
        }
    }
}

impl<'js> FromJs<'js> for ReferrerPolicy {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let s = String::from_js(ctx, value)?;
        Ok(ReferrerPolicy::from_str(&s))
    }
}

impl<'js> IntoJs<'js> for ReferrerPolicy {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        self.as_str().into_js(ctx)
    }
}

/// Credentials mode - controls how cookies and auth headers are handled
#[derive(Debug, Clone, Copy, PartialEq, Eq, rquickjs::class::Trace, rquickjs::JsLifetime)]
pub enum CredentialsMode {
    Omit,
    SameOrigin,
    Include,
}

impl CredentialsMode {
    fn as_str(&self) -> &'static str {
        match self {
            CredentialsMode::Omit => "omit",
            CredentialsMode::SameOrigin => "same-origin",
            CredentialsMode::Include => "include",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "omit" => CredentialsMode::Omit,
            "same-origin" => CredentialsMode::SameOrigin,
            "include" => CredentialsMode::Include,
            _ => CredentialsMode::Omit,
        }
    }
}

impl<'js> FromJs<'js> for CredentialsMode {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let s = String::from_js(ctx, value)?;
        Ok(CredentialsMode::from_str(&s))
    }
}

impl<'js> IntoJs<'js> for CredentialsMode {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        self.as_str().into_js(ctx)
    }
}

/// Redirect policy - controls how redirects are handled
#[derive(Debug, Clone, Copy, PartialEq, Eq, rquickjs::class::Trace, rquickjs::JsLifetime)]
pub enum RedirectPolicy {
    Follow,
    Error,
    Manual,
}

impl RedirectPolicy {
    fn as_str(&self) -> &'static str {
        match self {
            RedirectPolicy::Follow => "follow",
            RedirectPolicy::Error => "error",
            RedirectPolicy::Manual => "manual",
        }
    }

    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "follow" => Ok(RedirectPolicy::Follow),
            "error" => Ok(RedirectPolicy::Error),
            "manual" => Ok(RedirectPolicy::Manual),
            _ => Err(format!("Unknown redirect policy: {s}")),
        }
    }
}

impl<'js> FromJs<'js> for RedirectPolicy {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let s = String::from_js(ctx, value)?;
        RedirectPolicy::from_str(&s).map_err(|e| Exception::throw_message(ctx, &e))
    }
}

impl<'js> IntoJs<'js> for RedirectPolicy {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        self.as_str().into_js(ctx)
    }
}

// ---------------------------------------------------------------------------
// HttpRequest
// ---------------------------------------------------------------------------

#[derive(rquickjs::class::Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct HttpRequest {
    method: String,
    url: String,
    #[qjs(skip_trace)]
    headers: Vec<(String, String)>,
    mode: RequestMode,
    referer: String,
    referrer_policy: ReferrerPolicy,
    credentials: CredentialsMode,
    redirect_policy: RedirectPolicy,
    #[qjs(skip_trace)]
    body_bytes: Option<Vec<u8>>,
    /// The outgoing request built by `initSend`, held until `sendRequest` moves it into the
    /// `wasi:http/client.send` future. Only used by the streaming request body path.
    #[qjs(skip_trace)]
    pending_request: Option<Request>,
    /// The request body stream writer created by `initSend`, handed to the body writer returned
    /// by `initRequestBody`. Only used by the streaming request body path.
    #[qjs(skip_trace)]
    body_tx: Option<StreamWriter<u8>>,
    /// The request trailers future writer created by `initSend`, handed to the body writer
    /// returned by `initRequestBody`. Only used by the streaming request body path.
    #[qjs(skip_trace)]
    trailers_tx: Option<TrailersWriter>,
    /// The in-flight `wasi:http/client.send` future created by `sendRequest` and awaited by
    /// `receiveResponse`. Only used by the streaming request body path.
    #[qjs(skip_trace)]
    send_future: Option<SendFuture>,
}

#[rquickjs::methods(rename_all = "camelCase")]
impl HttpRequest {
    #[qjs(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new<'js>(
        ctx: Ctx<'js>,
        url: Coerced<String>,
        method: String,
        headers: HashMap<String, String>,
        version: String,
        mode: RequestMode,
        referer: String,
        referrer_policy: ReferrerPolicy,
        credentials: CredentialsMode,
        redirect_policy: RedirectPolicy,
    ) -> rquickjs::Result<Self> {
        let url = url.0;
        // Validate the URL eagerly so bad inputs fail like the Preview 2 path.
        Url::parse(&url).map_err(|_| Exception::throw_message(&ctx, "failed to parse url"))?;
        // Validate the method token like the Preview 2 native constructor, rejecting invalid
        // syntax (e.g. a method containing a space) with `failed to parse method`.
        validate_method(&ctx, &method)?;
        // Validate the requested HTTP version. `wasi:http` does not let us pin the wire version,
        // but the shared native contract still rejects unsupported versions like the Preview 2
        // path does, so invalid input fails identically on both targets.
        validate_http_version(&ctx, &version)?;
        // Validate header names/values up front (matching the Preview 2 native contract) so that
        // malformed headers are rejected instead of being silently dropped when building the
        // `wasi:http` fields later.
        for (name, value) in &headers {
            validate_header(&ctx, name, value)?;
        }

        Ok(HttpRequest {
            url,
            // Preserve the method spelling as given (matching the Preview 2 native contract, which
            // keeps extension-method case). The public `fetch`/`Request`/`XMLHttpRequest` APIs in
            // `http.js` already upper-case standard methods before reaching native code.
            method,
            headers: headers.into_iter().collect(),
            mode,
            referer,
            referrer_policy,
            credentials,
            redirect_policy,
            body_bytes: None,
            pending_request: None,
            body_tx: None,
            trailers_tx: None,
            send_future: None,
        })
    }

    pub fn array_buffer_body(&mut self, body: ArrayBuffer<'_>) {
        self.body_bytes = Some(body.as_bytes().map(|b| b.to_vec()).unwrap_or_default());
    }

    pub fn string_body(&mut self, body: String) {
        self.body_bytes = Some(body.into_bytes());
    }

    pub fn uint8_array_body(&mut self, body: TypedArray<'_, u8>) {
        self.body_bytes = Some(body.as_bytes().map(|b| b.to_vec()).unwrap_or_default());
    }

    pub fn add_header<'js>(
        &mut self,
        ctx: Ctx<'js>,
        name: String,
        value: String,
    ) -> rquickjs::Result<()> {
        validate_header(&ctx, &name, &value)?;
        // The Preview 2 path stores request headers in a `HashMap<HeaderName, HeaderValue>`, so
        // adding a header replaces any existing entry with the same (case-insensitive) name. Mirror
        // that here: `http.js` relies on it when it sets `Content-Type` for `URLSearchParams`
        // bodies after the constructor headers have already been applied.
        set_header(&mut self.headers, &name, &value);
        Ok(())
    }

    #[qjs(get)]
    pub fn mode(&self) -> RequestMode {
        self.mode
    }

    #[qjs(get)]
    pub fn referer(&self) -> String {
        self.referer.clone()
    }

    #[qjs(get, rename = "referrerPolicy")]
    pub fn referrer_policy(&self) -> ReferrerPolicy {
        self.referrer_policy
    }

    #[qjs(get)]
    pub fn credentials(&self) -> CredentialsMode {
        self.credentials
    }

    #[qjs(get)]
    pub fn url(&self) -> String {
        self.url.clone()
    }

    #[qjs(get)]
    pub fn redirect(&self) -> RedirectPolicy {
        self.redirect_policy
    }

    /// Streaming request bodies, step 1: build the outgoing request with a Component Model
    /// `stream<u8>` body and stage the stream/trailers writers for `initRequestBody`.
    ///
    /// This mirrors the header handling of a single `send_once` attempt (credentials filtering and
    /// referrer policy applied to a per-attempt header list). Redirects are resolved by the shared
    /// JS loop, which creates a fresh `HttpRequest` per attempt, so this method only sets up one
    /// request.
    pub fn init_send<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        // Validate mode constraints before sending, mirroring the buffered `simple_send` path so
        // that the public `fetch` contract (e.g. rejecting `no-cors` with an unsafe method) does
        // not depend on whether the request body is buffered or a `ReadableStream`.
        self.validate_request_mode(&ctx)?;

        let url = Url::parse(&self.url)
            .map_err(|_| Exception::throw_message(&ctx, "failed to parse url"))?;

        let mut headers = self.headers.clone();
        apply_credentials_filtering(&mut headers, self.credentials);
        if let Some(referer_value) =
            apply_referrer_policy(self.referrer_policy, &self.referer, &url)
        {
            set_header(&mut headers, "referer", &referer_value);
        }

        let fields = build_fields(&headers);
        let (body_tx, body_rx) = wasip3::wit_stream::new();
        let (trailers_tx, trailers_rx) =
            wasip3::wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));
        // `_transmit` resolves to the request body transmission result; the shared JS contract
        // surfaces upload failures through the body writer (`writeRequestBodyChunk`), so it is
        // dropped here exactly like the buffered `send_once` path.
        let (request, _transmit) = Request::new(fields, Some(body_rx), trailers_rx, None);

        let method = parse_method(&self.method);
        let scheme = parse_scheme(url.scheme());
        let authority = url_authority(&url);
        let path_with_query = url_path_with_query(&url);
        apply_request_targets(
            &ctx,
            &request,
            &method,
            scheme.as_ref(),
            authority.as_deref(),
            &path_with_query,
        )?;

        self.pending_request = Some(request);
        self.body_tx = Some(body_tx);
        self.trailers_tx = Some(trailers_tx);
        Ok(())
    }

    /// Streaming request bodies, step 2: hand the staged stream/trailers writers to a body writer
    /// object that JS pushes chunks into.
    pub fn init_request_body<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<WrappedRequestBodyWriter> {
        match (self.body_tx.take(), self.trailers_tx.take()) {
            (Some(body_tx), Some(trailers_tx)) => Ok(WrappedRequestBodyWriter {
                body_tx: Some(body_tx),
                trailers_tx: Some(trailers_tx),
            }),
            _ => Err(Exception::throw_message(
                &ctx,
                "HTTP request has not been initialized for sending",
            )),
        }
    }

    /// Streaming request bodies, step 3: start the outgoing request. The returned future owns the
    /// request (with its body stream reader) and is awaited later by `receiveResponse`; the body
    /// chunk writes and this future make progress concurrently on the shared async executor.
    pub fn send_request<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<()> {
        let Some(request) = self.pending_request.take() else {
            return Err(Exception::throw_message(
                &ctx,
                "HTTP request has not been initialized for sending",
            ));
        };
        self.send_future = Some(Box::pin(wasip3::http::client::send(request)));
        Ok(())
    }

    /// Streaming request bodies, step 4: await the response head, then read the response body only
    /// when it is actually visible to JS.
    ///
    /// The shared JS streaming loop (`streamingRequest` in `http.js`) resolves redirects one native
    /// attempt at a time and never consumes the body of a followed redirect, a rejected redirect, or
    /// a manual-redirect (opaque) response. Mirror the buffered [`Self::simple_send`] path: inspect
    /// the response head first and, for a response whose body JS will discard, drop it without
    /// reading so a large / slow / never-ending discarded body cannot stall the redirect loop. Only
    /// the final visible response body is read; a body that failed mid-transfer is recorded and
    /// surfaced when JS actually consumes it.
    pub async fn receive_response<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<HttpResponse> {
        let Some(send_future) = self.send_future.take() else {
            return Err(Exception::throw_message(
                &ctx,
                "HTTP request has not been initialized for sending",
            ));
        };

        let response = send_future
            .await
            .map_err(|e| Exception::throw_message(&ctx, &format!("HTTP request failed: {e:?}")))?;

        let status = response.get_status_code();
        let resp_headers = fields_to_pairs(&response.get_headers());

        // Decide whether the shared JS loop will discard this response's body before it is ever
        // exposed to user code. This matches the branches in `streamingRequest`:
        //   * `redirect: "follow"` with a *followable* `Location` header -> the loop follows the
        //     redirect and starts a fresh attempt (body discarded). Without a `Location` header, or
        //     with a `Location` that does not resolve to a valid URL, the loop instead returns this
        //     response as final (mirroring the buffered `simple_send` fallback), so its body must be
        //     kept.
        //   * `redirect: "error"` -> the loop throws unconditionally (body discarded).
        //   * `redirect: "manual"` -> the loop returns an opaque response whose body is never
        //     surfaced (body discarded).
        let is_redirection = (300..400).contains(&status);
        let is_supported_redirection =
            is_redirection && status != 304 && status != 305 && status != 306;
        if is_supported_redirection {
            let will_discard_body = match self.redirect_policy {
                RedirectPolicy::Error | RedirectPolicy::Manual => true,
                RedirectPolicy::Follow => resp_headers
                    .iter()
                    .find(|h| h[0].eq_ignore_ascii_case("location"))
                    .is_some_and(|h| location_is_followable(&self.url, &h[1])),
            };
            if will_discard_body {
                // The redirect body is discarded by fetch semantics; drop the response without
                // reading its body so a large / slow / never-ending redirect body cannot delay or
                // hang the followed request.
                drop(response);
                return Ok(HttpResponse::from_parts(status, resp_headers, Vec::new()));
            }
        }

        // `no-cors` responses never surface their body/status/headers to JS. Mirror the buffered
        // `simple_send` path: drop the body without reading and return an opaque response, so the
        // public `fetch` contract does not depend on whether the request body is a `ReadableStream`.
        if self.mode == RequestMode::NoCors {
            drop(response);
            let mut opaque = HttpResponse::from_parts(status, resp_headers, Vec::new());
            opaque.make_opaque();
            return Ok(opaque);
        }

        // Final visible response: read the body fully. A body that failed mid-transfer must reject
        // the fetch immediately (matching the buffered `simple_send` path) instead of surfacing
        // partial bytes or deferring the error to `text()`/`arrayBuffer()`. Because discarded
        // redirect / opaque bodies were already dropped above, reaching here means the body is
        // genuinely visible to JS, so it is safe to fail `fetch()` eagerly.
        let (body, body_error) = consume_response_body(response).await;
        if let Some(err) = body_error {
            return Err(Exception::throw_message(&ctx, &err));
        }
        Ok(HttpResponse::from_parts(status, resp_headers, body))
    }

    /// Buffered send with redirect handling. Only the final visible response body is read; the
    /// bodies of followed redirects, rejected redirects, and opaque responses are discarded without
    /// reading, so a large or never-ending discarded body cannot stall the fetch.
    pub async fn simple_send<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<HttpResponse> {
        // Validate mode constraints (mirrors the Preview 2 path). The streaming request-body path
        // performs the same validation in `init_send`.
        self.validate_request_mode(&ctx)?;

        let max_redirects = 20;
        let mut current_redirects = 0;

        // Mutable per-attempt state.
        let mut current_url = Url::parse(&self.url)
            .map_err(|_| Exception::throw_message(&ctx, "failed to parse url"))?;
        let mut current_method = self.method.clone();
        let mut current_headers = self.headers.clone();
        let mut current_body = self.body_bytes.clone();

        loop {
            // Build the per-request header list: user headers + credentials filtering + referer.
            let mut headers = current_headers.clone();
            apply_credentials_filtering(&mut headers, self.credentials);
            if let Some(referer_value) =
                apply_referrer_policy(self.referrer_policy, &self.referer, &current_url)
            {
                set_header(&mut headers, "referer", &referer_value);
            }

            let response = send_once(
                &ctx,
                &current_url,
                &current_method,
                &headers,
                current_body.clone(),
            )
            .await?;

            // Inspect the response head before deciding whether the body is visible to JS.
            let status = response.get_status_code();
            let resp_headers = fields_to_pairs(&response.get_headers());

            let is_redirection = (300..400).contains(&status);
            let is_supported_redirection =
                is_redirection && status != 304 && status != 305 && status != 306;

            if self.redirect_policy == RedirectPolicy::Follow && is_supported_redirection {
                if current_redirects >= max_redirects {
                    // Drop without reading the body: the redirect body is never surfaced.
                    drop(response);
                    return Err(Exception::throw_message(
                        &ctx,
                        "Maximum number of redirects exceeded",
                    ));
                }

                if let Some(location) = resp_headers
                    .iter()
                    .find(|h| h[0].eq_ignore_ascii_case("location"))
                    .map(|h| h[1].clone())
                {
                    match Url::parse(&location).or_else(|_| current_url.join(&location)) {
                        Ok(new_url) => {
                            // The redirect response body is discarded by fetch semantics; drop the
                            // response without reading its body so a large / slow / never-ending
                            // redirect body cannot delay or hang the followed request.
                            drop(response);
                            let mut drop_body = false;
                            if status == 303
                                || ((status == 301 || status == 302)
                                    && current_method.eq_ignore_ascii_case("POST"))
                            {
                                current_method = "GET".to_string();
                                drop_body = true;
                            }
                            if drop_body {
                                current_body = None;
                                remove_header(&mut current_headers, "content-type");
                                remove_header(&mut current_headers, "content-length");
                                remove_header(&mut current_headers, "transfer-encoding");
                            }
                            current_url = new_url;
                            current_redirects += 1;
                            continue;
                        }
                        Err(_) => {
                            // Failed to parse the location; fall through and return the redirect.
                        }
                    }
                }
            } else if self.redirect_policy == RedirectPolicy::Error && is_supported_redirection {
                // The rejected redirect's body is never surfaced; drop it without reading.
                drop(response);
                return Err(Exception::throw_message(&ctx, "Unexpected redirect"));
            }

            // Reflect the final URL back to JS (`http.js` reads `request.url`).
            self.url = current_url.to_string();

            // Opaque responses never surface their body to JS, so drop it without reading: a
            // body-transfer error is not observable and reading a large body would be wasteful.
            // A `redirect: "manual"` redirect becomes an *opaque-redirect* response (`type` =
            // `opaqueredirect`), whereas a `no-cors` response becomes a plain `opaque` response.
            let is_manual_redirect =
                self.redirect_policy == RedirectPolicy::Manual && is_supported_redirection;
            let is_no_cors = self.mode == RequestMode::NoCors;
            if is_manual_redirect || is_no_cors {
                drop(response);
                let mut opaque = HttpResponse::from_parts(status, resp_headers, Vec::new());
                opaque.redirected = current_redirects > 0;
                if is_manual_redirect {
                    opaque.make_opaque_redirect();
                } else {
                    opaque.make_opaque();
                }
                return Ok(opaque);
            }

            // Non-opaque final response: read the body fully. A body that failed mid-transfer must
            // reject the fetch instead of surfacing partial bytes.
            let (body, body_error) = consume_response_body(response).await;
            if let Some(err) = body_error {
                return Err(Exception::throw_message(&ctx, &err));
            }
            let mut response = HttpResponse::from_parts(status, resp_headers, body);
            response.redirected = current_redirects > 0;
            return Ok(response);
        }
    }
}

impl HttpRequest {
    /// Validates the request mode before sending, mirroring the Preview 2 path. Shared by the
    /// buffered [`Self::simple_send`] path and the streaming [`Self::init_send`] path so the public
    /// `fetch` contract is identical regardless of whether the request body is buffered or streamed.
    fn validate_request_mode(&self, ctx: &Ctx<'_>) -> rquickjs::Result<()> {
        if self.mode == RequestMode::NoCors {
            let method_str = self.method.to_uppercase();
            if !matches!(method_str.as_str(), "GET" | "HEAD" | "POST") {
                return Err(Exception::throw_message(
                    ctx,
                    "no-cors mode only allows GET, HEAD, or POST methods",
                ));
            }
        } else if self.mode == RequestMode::Navigate {
            return Err(Exception::throw_message(
                ctx,
                "navigate mode is not supported in WASM context",
            ));
        } else if !matches!(self.mode, RequestMode::Cors | RequestMode::SameOrigin) {
            return Err(Exception::throw_message(
                ctx,
                &format!("Unsupported request mode: {}", self.mode.as_str()),
            ));
        }
        Ok(())
    }
}

/// Performs a single (non-redirecting) request through `wasi:http/client` and returns the response
/// head. The response body is **not** consumed here: the caller reads it with
/// [`consume_response_body`] for a final visible response, or drops the response to discard the
/// body of a followed redirect / opaque response without paying for a large or never-ending body.
async fn send_once(
    ctx: &Ctx<'_>,
    url: &Url,
    method: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
) -> rquickjs::Result<Response> {
    let method = parse_method(method);
    let scheme = parse_scheme(url.scheme());
    let authority = url_authority(url);
    let path_with_query = url_path_with_query(url);

    let response = match body {
        Some(bytes) => {
            let fields = build_fields(headers);
            let (mut body_tx, body_rx) = wasip3::wit_stream::new();
            let (trailers_tx, trailers_rx) =
                wasip3::wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));
            let (request, _transmit) = Request::new(fields, Some(body_rx), trailers_rx, None);
            apply_request_targets(
                ctx,
                &request,
                &method,
                scheme.as_ref(),
                authority.as_deref(),
                &path_with_query,
            )?;

            let write_fut = async move {
                // `write_all` returns the bytes it could not deliver; dropping the writer closes
                // the request body stream, and dropping the trailers writer resolves it to the
                // default `Ok(None)`.
                let _remaining = body_tx.write_all(bytes).await;
                drop(body_tx);
                drop(trailers_tx);
            };
            let send_fut = wasip3::http::client::send(request);
            let (send_result, ()) = futures::future::join(send_fut, write_fut).await;
            send_result
        }
        None => {
            let fields = build_fields(headers);
            let (trailers_tx, trailers_rx) =
                wasip3::wit_future::new(|| Ok::<Option<Trailers>, ErrorCode>(None));
            drop(trailers_tx);
            let (request, _transmit) = Request::new(fields, None, trailers_rx, None);
            apply_request_targets(
                ctx,
                &request,
                &method,
                scheme.as_ref(),
                authority.as_deref(),
                &path_with_query,
            )?;
            wasip3::http::client::send(request).await
        }
    };

    let response = response
        .map_err(|e| Exception::throw_message(ctx, &format!("HTTP request failed: {e:?}")))?;

    Ok(response)
}

/// Reads a `wasi:http` response body fully into memory.
///
/// Returns `(body, body_error)`. `body_error` is `Some(message)` when the response body failed
/// mid-transfer (e.g. a truncated response); the caller decides whether to surface it. Only call
/// this for responses whose body is actually visible to JS — a discarded redirect / opaque body
/// should be dropped without reading instead, so a large or never-ending body cannot stall fetch.
async fn consume_response_body(response: Response) -> (Vec<u8>, Option<String>) {
    // Consume the response body stream fully. The `res` future communicates a handling error to
    // the transport; we always signal success by letting its writer resolve to `Ok(())`.
    let (res_tx, res_rx) = wasip3::wit_future::new(|| Ok::<(), ErrorCode>(()));
    let (body_reader, body_result) = Response::consume_body(response, res_rx);
    drop(res_tx);
    let body = body_reader.collect().await;

    // The returned future only resolves after the body stream is closed (which the `collect`
    // above guarantees). Await it to detect a body that failed mid-transfer — e.g. a truncated
    // response. It resolves to `Ok(Option<Trailers>)` on success (trailers are not surfaced to
    // the JS `fetch` API) or `Err(ErrorCode)` when the transport reports the body was not
    // received successfully.
    let body_error = match body_result.await {
        Ok(_) => None,
        Err(e) => Some(format!("HTTP response body error: {e:?}")),
    };

    (body, body_error)
}

// ---------------------------------------------------------------------------
// WrappedRequestBodyWriter (streaming request bodies)
// ---------------------------------------------------------------------------

/// Writer end of a streaming request body. `http.js` obtains one from `HttpRequest.initRequestBody`
/// and pushes chunks into the Component Model `stream<u8>` request body while the outgoing request
/// is in flight.
#[derive(rquickjs::class::Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct WrappedRequestBodyWriter {
    #[qjs(skip_trace)]
    body_tx: Option<StreamWriter<u8>>,
    #[qjs(skip_trace)]
    trailers_tx: Option<TrailersWriter>,
}

impl Default for WrappedRequestBodyWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl WrappedRequestBodyWriter {
    #[qjs(constructor)]
    pub fn new() -> Self {
        Self {
            body_tx: None,
            trailers_tx: None,
        }
    }

    /// Writes one chunk into the request body stream. Resolves once the chunk has been accepted by
    /// the transport, providing backpressure to the JS `ReadableStream` reader. If the peer has
    /// hung up (e.g. the server closed the upload early), the write reports the undelivered bytes
    /// and this rejects.
    pub async fn write_request_body_chunk<'js>(
        &mut self,
        ctx: Ctx<'js>,
        chunk: TypedArray<'_, u8>,
    ) -> rquickjs::Result<()> {
        let Some(body_tx) = self.body_tx.as_mut() else {
            return Err(Exception::throw_message(
                &ctx,
                "HTTP request body has already been finished",
            ));
        };
        let bytes = chunk
            .as_bytes()
            .ok_or_else(|| {
                Exception::throw_message(
                    &ctx,
                    "the UInt8Array passed to the HTTP request is detached",
                )
            })?
            .to_vec();
        let remaining = body_tx.write_all(bytes).await;
        if !remaining.is_empty() {
            return Err(Exception::throw_message(
                &ctx,
                "Failed to write HTTP request body chunk",
            ));
        }
        Ok(())
    }

    /// Finishes the request body. Dropping the stream writer closes the request body stream and
    /// dropping the trailers writer resolves it to the default `Ok(None)` (no trailers), together
    /// signaling the end of the request body to the transport.
    pub fn finish_body<'js>(&mut self, _ctx: Ctx<'js>) -> rquickjs::Result<()> {
        self.body_tx = None;
        self.trailers_tx = None;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// HttpResponse (buffered)
// ---------------------------------------------------------------------------

enum ResponseBody {
    Bytes(Vec<u8>),
    Consumed,
}

#[derive(rquickjs::class::Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct HttpResponse {
    #[qjs(skip_trace)]
    body: ResponseBody,
    /// A response body that failed mid-transfer (e.g. a truncated response). It is deferred until
    /// the body is consumed so that a discarded response (e.g. an intermediate redirect body) does
    /// not surface a spurious error, matching the buffered path's redirect handling.
    #[qjs(skip_trace)]
    body_error: Option<String>,
    headers: Vec<Vec<String>>,
    status: u16,
    is_opaque: bool,
    /// An opaque response produced by `redirect: "manual"` on a redirect status. Such responses
    /// are opaque *and* must report a `type` of `opaqueredirect` (distinct from a `no-cors`
    /// `opaque` response). Tracked with a dedicated flag rather than reusing `redirected`, so the
    /// public `Response.type` and `Response.redirected` getters stay independently correct.
    is_opaque_redirect: bool,
    redirected: bool,
}

impl Default for HttpResponse {
    fn default() -> Self {
        Self::new()
    }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl HttpResponse {
    #[qjs(constructor)]
    pub fn new() -> Self {
        Self {
            body: ResponseBody::Consumed,
            body_error: None,
            headers: Vec::new(),
            status: 200,
            is_opaque: false,
            is_opaque_redirect: false,
            redirected: false,
        }
    }

    #[qjs(skip)]
    pub fn from_parts(status: u16, headers: Vec<Vec<String>>, body: Vec<u8>) -> Self {
        Self::from_parts_with_error(status, headers, body, None)
    }

    #[qjs(skip)]
    pub fn from_parts_with_error(
        status: u16,
        headers: Vec<Vec<String>>,
        body: Vec<u8>,
        body_error: Option<String>,
    ) -> Self {
        Self {
            body: ResponseBody::Bytes(body),
            body_error,
            headers,
            status,
            is_opaque: false,
            is_opaque_redirect: false,
            redirected: false,
        }
    }

    #[qjs(rename = "makeOpaque")]
    pub fn make_opaque(&mut self) {
        self.is_opaque = true;
        self.headers.clear();
        self.status = 200; // reported as 0 while opaque
        // Opaque responses never surface their body to JS, so a deferred body-transfer error is
        // not observable and must not fail the fetch.
        self.body_error = None;
    }

    /// Turns this response into a `redirect: "manual"` opaque-redirect filtered response. Like
    /// [`make_opaque`], it hides status/headers/body, but it additionally reports a `type` of
    /// `opaqueredirect` (via [`is_opaque_redirect`]) so the public `Response.type` getter can tell
    /// it apart from a `no-cors` `opaque` response.
    #[qjs(rename = "makeOpaqueRedirect")]
    pub fn make_opaque_redirect(&mut self) {
        self.make_opaque();
        self.is_opaque_redirect = true;
    }

    #[qjs(get, rename = "isOpaqueRedirect")]
    pub fn is_opaque_redirect(&self) -> bool {
        self.is_opaque_redirect
    }

    #[qjs(get)]
    pub fn redirected(&self) -> bool {
        self.redirected
    }

    #[qjs(set, rename = "redirected")]
    pub fn set_redirected(&mut self, redirected: bool) {
        self.redirected = redirected;
    }

    #[qjs(get)]
    pub fn headers(&self) -> Vec<Vec<String>> {
        self.headers.clone()
    }

    pub fn add_header(&mut self, name: String, value: String) {
        self.headers.push(vec![name, value]);
    }

    #[qjs(get)]
    pub fn status(&self) -> u16 {
        if self.is_opaque { 0 } else { self.status }
    }

    #[qjs(get)]
    pub fn is_opaque(&self) -> bool {
        self.is_opaque
    }

    #[qjs(get, rename = "statusText")]
    pub fn status_text(&self) -> String {
        // Opaque / opaque-redirect filtered responses expose an empty status message (their status
        // is also reported as 0), matching the Fetch standard.
        if self.is_opaque {
            return String::new();
        }
        StatusCode::from_u16(self.status)
            .ok()
            .and_then(|status| status.canonical_reason())
            .unwrap_or("Unknown status")
            .to_string()
    }

    pub async fn array_buffer<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<ArrayBuffer<'js>> {
        let bytes = self.take_body(&ctx)?;
        let ctx_clone = ctx.clone();
        ArrayBuffer::new(ctx, bytes).map_err(move |_| {
            Exception::throw_message(
                &ctx_clone,
                "failed to create ArrayBuffer from response body",
            )
        })
    }

    pub async fn text<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<String> {
        let bytes = self.take_body(&ctx)?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub fn stream<'js>(&mut self, ctx: Ctx<'js>) -> rquickjs::Result<ResponseBodyStream> {
        let bytes = self.take_body(&ctx)?;
        Ok(ResponseBodyStream {
            bytes: Some(bytes),
            position: 0,
        })
    }

    #[qjs(static)]
    pub fn error() -> Self {
        Self {
            body: ResponseBody::Consumed,
            body_error: None,
            headers: Vec::new(),
            status: 500,
            is_opaque: false,
            is_opaque_redirect: false,
            redirected: false,
        }
    }

    #[qjs(static)]
    pub fn redirect(url: Coerced<String>, status: Option<u16>) -> Self {
        // Match the Preview 2 native contract: an out-of-range status falls back to 302 Found.
        let status_code = status
            .and_then(|code| StatusCode::from_u16(code).ok())
            .map(|code| code.as_u16())
            .unwrap_or(302);
        Self {
            body: ResponseBody::Consumed,
            body_error: None,
            headers: vec![vec!["location".to_string(), url.0]],
            status: status_code,
            is_opaque: false,
            is_opaque_redirect: false,
            redirected: false,
        }
    }

    #[qjs(static)]
    pub fn json<'js>(data: ArrayBuffer<'js>, status: u16) -> Self {
        // Match the Preview 2 native contract: an out-of-range status falls back to 200 OK.
        let status = StatusCode::from_u16(status)
            .map(|code| code.as_u16())
            .unwrap_or(200);
        Self {
            body: ResponseBody::Bytes(data.as_bytes().map(|b| b.to_vec()).unwrap_or_default()),
            body_error: None,
            headers: vec![vec![
                "content-type".to_string(),
                "application/json".to_string(),
            ]],
            status,
            is_opaque: false,
            is_opaque_redirect: false,
            redirected: false,
        }
    }

    pub fn clone(&mut self) -> Self {
        let (kept, cloned) = match std::mem::replace(&mut self.body, ResponseBody::Consumed) {
            ResponseBody::Bytes(bytes) => (
                ResponseBody::Bytes(bytes.clone()),
                ResponseBody::Bytes(bytes),
            ),
            ResponseBody::Consumed => (ResponseBody::Consumed, ResponseBody::Consumed),
        };
        self.body = kept;
        Self {
            body: cloned,
            body_error: self.body_error.clone(),
            headers: self.headers.clone(),
            status: self.status,
            is_opaque: self.is_opaque,
            is_opaque_redirect: self.is_opaque_redirect,
            redirected: self.redirected,
        }
    }
}

impl HttpResponse {
    fn take_body(&mut self, ctx: &Ctx<'_>) -> rquickjs::Result<Vec<u8>> {
        match std::mem::replace(&mut self.body, ResponseBody::Consumed) {
            ResponseBody::Bytes(bytes) => {
                // A body that failed mid-transfer must reject when the caller actually consumes it
                // instead of surfacing partial bytes.
                if let Some(err) = self.body_error.take() {
                    return Err(Exception::throw_message(ctx, &err));
                }
                Ok(bytes)
            }
            ResponseBody::Consumed => Err(Exception::throw_message(
                ctx,
                "The response has already been consumed",
            )),
        }
    }
}

/// Response body reader backing `response.body` / `ReadableStream`. Because Preview 3 responses
/// are buffered eagerly, this simply serves the buffered bytes in chunks.
#[derive(Default, rquickjs::class::Trace, JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct ResponseBodyStream {
    #[qjs(skip_trace)]
    bytes: Option<Vec<u8>>,
    position: usize,
}

#[rquickjs::methods(rename_all = "camelCase")]
impl ResponseBodyStream {
    #[qjs(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[qjs(get, rename = "type")]
    pub fn get_typ(&self) -> String {
        "bytes".to_string()
    }

    pub async fn pull<'js>(
        &mut self,
        ctx: Ctx<'js>,
    ) -> rquickjs::Result<List<(Option<TypedArray<'js, u8>>, Option<String>)>> {
        const CHUNK_SIZE: usize = 16384;
        let Some(bytes) = self.bytes.as_ref() else {
            return Ok(List((None, None)));
        };
        if self.position >= bytes.len() {
            return Ok(List((None, None)));
        }
        let end = (self.position + CHUNK_SIZE).min(bytes.len());
        let chunk = &bytes[self.position..end];
        let array = TypedArray::new_copy(ctx.clone(), chunk).map_err(|_| {
            Exception::throw_message(&ctx, "Failed to create TypedArray from response body chunk")
        })?;
        self.position = end;
        Ok(List((Some(array), None)))
    }
}

// ---------------------------------------------------------------------------
// wasip3 helpers
// ---------------------------------------------------------------------------

/// Validates a requested HTTP version string, mirroring the Preview 2 native contract. `wasi:http`
/// cannot pin the wire version, so the parsed value is discarded; only the validation (rejecting
/// unsupported versions) is observable.
fn validate_http_version(ctx: &Ctx<'_>, version: &str) -> rquickjs::Result<()> {
    match version {
        "HTTP/0.9" => Ok(Version::HTTP_09),
        "HTTP/1.0" => Ok(Version::HTTP_10),
        "HTTP/1.1" => Ok(Version::HTTP_11),
        "HTTP/2.0" => Ok(Version::HTTP_2),
        "HTTP/3.0" => Ok(Version::HTTP_3),
        other => Err(Exception::throw_message(
            ctx,
            &format!("Unsupported HTTP version: {other}"),
        )),
    }?;
    Ok(())
}

/// Validates a header name/value pair using the same `http` crate primitives the Preview 2 path
/// relies on (via `golem-wasi-http`), throwing the identical error messages.
fn validate_header(ctx: &Ctx<'_>, name: &str, value: &str) -> rquickjs::Result<()> {
    HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| Exception::throw_message(ctx, "failed to parse header name"))?;
    HeaderValue::from_str(value)
        .map_err(|_| Exception::throw_message(ctx, "failed to parse header value"))?;
    Ok(())
}

/// Validates an HTTP method token, mirroring the Preview 2 native constructor which parses the
/// method via the `http` crate and rejects invalid syntax with `failed to parse method`.
fn validate_method(ctx: &Ctx<'_>, method: &str) -> rquickjs::Result<()> {
    http::Method::from_bytes(method.as_bytes())
        .map_err(|_| Exception::throw_message(ctx, "failed to parse method"))?;
    Ok(())
}

fn parse_method(method: &str) -> Method {
    // Match the standard methods by their canonical (upper-case) spelling only, mirroring
    // `http::Method::from_bytes`; any other token becomes an extension method with its original
    // case preserved, exactly like the Preview 2 path.
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

/// Mirrors the JS streaming redirect loop's `new URL(location, base)` decision (and the buffered
/// `simple_send` redirect resolution): a `Location` is followable when it parses as an absolute URL
/// or resolves against the current request URL. Only a followable redirect's body is discarded by
/// the streaming path; an unfollowable `Location` falls through and returns the redirect response as
/// the final visible response, so its body must be kept.
fn location_is_followable(base: &str, location: &str) -> bool {
    if Url::parse(location).is_ok() {
        return true;
    }
    Url::parse(base)
        .ok()
        .and_then(|base_url| base_url.join(location).ok())
        .is_some()
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
        .map_err(|_| Exception::throw_message(ctx, "failed to set request method"))?;
    request
        .set_scheme(scheme)
        .map_err(|_| Exception::throw_message(ctx, "failed to set request scheme"))?;
    request
        .set_authority(authority)
        .map_err(|_| Exception::throw_message(ctx, "failed to set request authority"))?;
    request
        .set_path_with_query(Some(path_with_query))
        .map_err(|_| Exception::throw_message(ctx, "failed to set request path"))?;
    Ok(())
}

/// Builds a `wasi:http` `fields` resource from a header list, skipping headers the transport
/// forbids (e.g. `host`, which is derived from the authority) on a best-effort basis.
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
        .map(|(name, value)| vec![name, String::from_utf8_lossy(&value).to_string()])
        .collect()
}

fn set_header(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    remove_header(headers, name);
    headers.push((name.to_string(), value.to_string()));
}

fn remove_header(headers: &mut Vec<(String, String)>, name: &str) {
    headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
}

/// Applies credentials filtering based on the credentials mode (mirrors the Preview 2 path).
fn apply_credentials_filtering(headers: &mut Vec<(String, String)>, credentials: CredentialsMode) {
    if credentials == CredentialsMode::Omit {
        remove_header(headers, "authorization");
        remove_header(headers, "cookie");
    }
}

/// Determines the referer value to send based on the policy, origin, and destination.
fn apply_referrer_policy(
    policy: ReferrerPolicy,
    referer: &str,
    request_url: &Url,
) -> Option<String> {
    if policy == ReferrerPolicy::NoReferrer || referer.is_empty() || referer == "about:client" {
        return None;
    }

    let referer_url = Url::parse(referer).ok()?;
    let request_origin = extract_origin(request_url);
    let referer_origin = extract_origin(&referer_url);
    let is_same_origin = request_origin == referer_origin;
    let is_downgrade = is_https_to_http(&referer_url, request_url);

    match policy {
        ReferrerPolicy::NoReferrerWhenDowngrade => {
            if is_downgrade {
                None
            } else {
                Some(referer.to_string())
            }
        }
        ReferrerPolicy::Origin => Some(referer_origin),
        ReferrerPolicy::OriginWhenCrossOrigin => {
            if is_same_origin {
                Some(referer.to_string())
            } else {
                Some(referer_origin)
            }
        }
        ReferrerPolicy::SameOrigin => {
            if is_same_origin {
                Some(referer.to_string())
            } else {
                None
            }
        }
        ReferrerPolicy::StrictOrigin => {
            if is_downgrade {
                None
            } else {
                Some(referer_origin)
            }
        }
        ReferrerPolicy::StrictOriginWhenCrossOrigin => {
            if is_downgrade {
                None
            } else if is_same_origin {
                Some(referer.to_string())
            } else {
                Some(referer_origin)
            }
        }
        ReferrerPolicy::UnsafeUrl => Some(referer.to_string()),
        ReferrerPolicy::NoReferrer => None,
    }
}

fn extract_origin(url: &Url) -> String {
    match (url.scheme(), url.host_str()) {
        (scheme, Some(host)) => {
            if let Some(port) = url.port() {
                let default_port = match scheme {
                    "http" => 80,
                    "https" => 443,
                    _ => 0,
                };
                if port != default_port {
                    format!("{scheme}://{host}:{port}")
                } else {
                    format!("{scheme}://{host}")
                }
            } else {
                format!("{scheme}://{host}")
            }
        }
        _ => String::new(),
    }
}

fn is_https_to_http(from_url: &Url, to_url: &Url) -> bool {
    from_url.scheme() == "https" && to_url.scheme() == "http"
}

// ---------------------------------------------------------------------------
// JavaScript sources (shared with the Preview 2 path).
// ---------------------------------------------------------------------------

pub const HTTP_JS: &str = include_str!("http.js");
pub const FETCH_BLOB_JS: &str = include_str!("fetch-blob-4.0.0.js");
pub const FORMDATA_JS: &str = include_str!("formdata-polyfill-4.0.10.js");

pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_http from '__wasm_rquickjs_builtin/http';
        import * as __wasm_rquickjs_http_blob from '__wasm_rquickjs_builtin/http_blob';
        import * as __wasm_rquickjs_http_form_data from '__wasm_rquickjs_builtin/http_form_data';

        globalThis.fetch = __wasm_rquickjs_http.fetch;
        globalThis.Headers = __wasm_rquickjs_http.Headers;
        globalThis.Request = __wasm_rquickjs_http.Request;
        globalThis.Response = __wasm_rquickjs_http.Response;
        globalThis.Blob = __wasm_rquickjs_http_blob.Blob;
        globalThis.File = __wasm_rquickjs_http_blob.File;
        globalThis.FormData = __wasm_rquickjs_http_form_data.FormData;
        globalThis.XMLHttpRequest = __wasm_rquickjs_http.XMLHttpRequest;
    "#;
