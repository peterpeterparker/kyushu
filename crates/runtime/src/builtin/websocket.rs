use golem_websocket::{Error as WsError, Message, WebsocketConnection};
use rquickjs::class::Trace;
use rquickjs::{Ctx, Exception, JsLifetime};
use std::cell::RefCell;
use wstd::runtime::AsyncPollable;

#[rquickjs::module]
pub mod native_module {
    pub use super::WsConnection;

    #[rquickjs::function]
    pub fn ws_connect(
        ctx: rquickjs::Ctx<'_>,
        url: String,
        protocols: Vec<String>,
    ) -> rquickjs::Result<super::WsConnection> {
        super::ws_connect_impl(&ctx, url, protocols)
    }
}

fn ws_connect_impl(
    ctx: &Ctx<'_>,
    url: String,
    protocols: Vec<String>,
) -> rquickjs::Result<WsConnection> {
    let headers = if protocols.is_empty() {
        None
    } else {
        Some(vec![(
            "Sec-WebSocket-Protocol".to_string(),
            protocols.join(", "),
        )])
    };

    match WebsocketConnection::connect(&url, headers.as_deref()) {
        Ok(conn) => Ok(WsConnection {
            inner: RefCell::new(Some(conn)),
        }),
        Err(e) => Err(Exception::throw_message(
            ctx,
            &format!("WebSocket connection failed: {e:?}"),
        )),
    }
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct WsConnection {
    #[qjs(skip_trace)]
    inner: RefCell<Option<WebsocketConnection>>,
}

#[rquickjs::methods]
impl WsConnection {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "WsConnection cannot be constructed directly, use ws_connect()",
        ))
    }

    pub fn send_text(&self, ctx: Ctx<'_>, data: String) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        let conn = inner
            .as_ref()
            .ok_or_else(|| Exception::throw_message(&ctx, "WebSocket is closed"))?;
        conn.send(&Message::Text(data))
            .map_err(|e| Exception::throw_message(&ctx, &format!("WebSocket send failed: {e:?}")))
    }

    pub fn send_binary(&self, ctx: Ctx<'_>, data: Vec<u8>) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        let conn = inner
            .as_ref()
            .ok_or_else(|| Exception::throw_message(&ctx, "WebSocket is closed"))?;
        conn.send(&Message::Binary(data))
            .map_err(|e| Exception::throw_message(&ctx, &format!("WebSocket send failed: {e:?}")))
    }

    /// Async receive: waits for the next message using WASI pollables
    /// instead of busy-polling with timeouts.
    ///
    /// Returns: [type, data]
    ///   "text"    → data is the string
    ///   "binary"  → data is an ArrayBuffer
    ///   "closed"  → data is { code, reason }
    ///   "error"   → data is an error description string
    pub async fn receive<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Value<'js>> {
        let async_pollable = {
            let inner = self.inner.borrow();
            let conn = inner
                .as_ref()
                .ok_or_else(|| Exception::throw_message(&ctx, "WebSocket is closed"))?;
            AsyncPollable::new(conn.subscribe())
        };
        loop {
            async_pollable.wait_for().await;

            let result = {
                let inner = self.inner.borrow();
                let conn = inner
                    .as_ref()
                    .ok_or_else(|| Exception::throw_message(&ctx, "WebSocket is closed"))?;
                conn.receive()
            };

            match result {
                Ok(Message::Text(text)) => {
                    let arr = rquickjs::Array::new(ctx.clone())?;
                    arr.set(0, "text")?;
                    arr.set(1, text)?;
                    return Ok(arr.into_value());
                }
                Ok(Message::Binary(data)) => {
                    let arr = rquickjs::Array::new(ctx.clone())?;
                    arr.set(0, "binary")?;
                    let ab = rquickjs::ArrayBuffer::new(ctx.clone(), data)?;
                    arr.set(1, ab)?;
                    return Ok(arr.into_value());
                }
                Err(WsError::Closed(info)) => {
                    let arr = rquickjs::Array::new(ctx.clone())?;
                    arr.set(0, "closed")?;
                    let (code, reason) = match info {
                        Some(ci) => (ci.code as i32, ci.reason),
                        None => (1000, String::new()),
                    };
                    let close_obj = rquickjs::Object::new(ctx.clone())?;
                    close_obj.set("code", code)?;
                    close_obj.set("reason", reason)?;
                    arr.set(1, close_obj)?;
                    return Ok(arr.into_value());
                }
                Err(e) => {
                    let arr = rquickjs::Array::new(ctx.clone())?;
                    arr.set(0, "error")?;
                    arr.set(1, format!("{e:?}"))?;
                    return Ok(arr.into_value());
                }
            }
        }
    }

    pub fn close(
        &self,
        ctx: Ctx<'_>,
        code: rquickjs::Value<'_>,
        reason: rquickjs::Value<'_>,
    ) -> rquickjs::Result<()> {
        let mut inner = self.inner.borrow_mut();
        let conn = match inner.take() {
            Some(c) => c,
            None => return Ok(()),
        };

        let code_opt = if code.is_null() || code.is_undefined() {
            None
        } else {
            Some(code.as_int().unwrap_or(1000) as u16)
        };

        let reason_opt = if reason.is_null() || reason.is_undefined() {
            None
        } else {
            reason
                .as_string()
                .map(|s| s.to_string().unwrap_or_default())
        };

        conn.close(code_opt, reason_opt.as_deref())
            .map_err(|e| Exception::throw_message(&ctx, &format!("WebSocket close failed: {e:?}")))
    }
}

pub const WEBSOCKET_JS: &str = include_str!("websocket.js");

pub const WIRE_JS: &str = r#"
    import {
        WebSocket as __WebSocket,
        WebSocketStream as __WebSocketStream,
        MessageEvent as __WsMessageEvent,
        CloseEvent as __WsCloseEvent,
        ErrorEvent as __WsErrorEvent,
    } from '__wasm_rquickjs_builtin/websocket';
    globalThis.WebSocket = __WebSocket;
    globalThis.WebSocketStream = __WebSocketStream;
    globalThis.MessageEvent = __WsMessageEvent;
    globalThis.CloseEvent = __WsCloseEvent;
    globalThis.ErrorEvent = __WsErrorEvent;
"#;
