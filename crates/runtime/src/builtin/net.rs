use std::cell::RefCell;

use rquickjs::class::Trace;
use rquickjs::prelude::List;
use rquickjs::{Ctx, Exception, JsLifetime};

#[cfg(feature = "p2")]
use wasip2::io::streams::{InputStream, OutputStream, StreamError};
#[cfg(feature = "p2")]
use wasip2::sockets::instance_network::instance_network;
#[cfg(feature = "p2")]
use wasip2::sockets::network::{ErrorCode, IpAddressFamily};
#[cfg(feature = "p2")]
use wasip2::sockets::tcp::ShutdownType;
#[cfg(feature = "p2")]
use wasip2::sockets::tcp_create_socket::create_tcp_socket;
#[cfg(feature = "p2")]
use wstd::runtime::AsyncPollable;

// ── Preview 3 imports ───────────────────────────────────────────────────
//
// The P3 `wasi:sockets` TCP model is stream-based rather than pollable-based:
//   * `bind`/`listen` are synchronous, `connect` is `async`.
//   * `receive()` hands back a `stream<u8>` reader (call once); reading it maps
//     to Node's incremental `read`.
//   * `send(stream<u8>)` takes the read-end of a stream we own and returns a
//     completion `future` (call once); we keep the writer end and feed it on
//     each Node `write`. The returned future is retained so the operation is
//     not cancelled.
//   * `listen()` returns a `stream<tcp-socket>` of accepted connections.
#[cfg(feature = "p3")]
use futures::channel::oneshot;
#[cfg(feature = "p3")]
use futures::future::Either;
#[cfg(feature = "p3")]
use std::rc::Rc;
#[cfg(feature = "p3")]
use wasip3::sockets::types::{ErrorCode, IpAddressFamily, TcpSocket as WasiTcpSocket};
#[cfg(feature = "p3")]
use wasip3::wit_bindgen::rt::async_support::{
    FutureReader, StreamReader, StreamResult, StreamWriter,
};

use super::socket_helpers::{
    error_code_to_errno, ip_address_to_string, ip_socket_address, ip_socket_address_family,
    ip_socket_address_port, parse_ip_address, throw_socket_error,
};

#[rquickjs::module]
pub mod native_module {
    pub use super::TcpListener;
    pub use super::TcpSocket;

    #[rquickjs::function]
    pub fn create_tcp_socket(
        ctx: rquickjs::Ctx<'_>,
        family: u32,
    ) -> rquickjs::Result<super::TcpSocket> {
        super::create_tcp_socket_impl(&ctx, family)
    }

    #[rquickjs::function]
    pub fn create_tcp_listener(
        ctx: rquickjs::Ctx<'_>,
        family: u32,
    ) -> rquickjs::Result<super::TcpListener> {
        super::create_tcp_listener_impl(&ctx, family)
    }
}

// ── TcpSocket (client and accepted connections) ─────────────────────────

#[cfg(feature = "p2")]
fn create_tcp_socket_impl(ctx: &Ctx<'_>, family: u32) -> rquickjs::Result<TcpSocket> {
    let ip_family = match family {
        4 => IpAddressFamily::Ipv4,
        6 => IpAddressFamily::Ipv6,
        _ => {
            return Err(throw_socket_error(
                ctx,
                "EINVAL",
                "socket",
                &format!("Invalid address family: {family}"),
            ));
        }
    };

    let socket = create_tcp_socket(ip_family).map_err(|e| {
        throw_socket_error(
            ctx,
            error_code_to_errno(e),
            "socket",
            &format!("Failed to create TCP socket: {e:?}"),
        )
    })?;

    Ok(TcpSocket {
        inner: RefCell::new(TcpInner {
            input: None,
            output: None,
            socket: Some(socket),
            connected: false,
            closed: false,
            generation: 0,
            waiters: 0,
        }),
    })
}

#[cfg(feature = "p2")]
struct TcpInner {
    // Drop order matters: streams must be dropped before the socket (WASI child resources).
    input: Option<InputStream>,
    output: Option<OutputStream>,
    socket: Option<wasip2::sockets::tcp::TcpSocket>,
    connected: bool,
    closed: bool,
    generation: u64,
    /// Number of async tasks currently holding a pollable derived from this socket's streams.
    /// Resources must not be dropped while waiters > 0.
    waiters: u32,
}

#[cfg(feature = "p2")]
impl TcpInner {
    /// Drop WASI resources if the socket is closed and no async tasks are holding pollables.
    fn finalize_close_if_ready(&mut self) {
        if self.closed && self.waiters == 0 {
            self.input = None;
            self.output = None;
            self.socket = None;
        }
    }
}

#[cfg(feature = "p3")]
fn create_tcp_socket_impl(ctx: &Ctx<'_>, family: u32) -> rquickjs::Result<TcpSocket> {
    let ip_family = match family {
        4 => IpAddressFamily::Ipv4,
        6 => IpAddressFamily::Ipv6,
        _ => {
            return Err(throw_socket_error(
                ctx,
                "EINVAL",
                "socket",
                &format!("Invalid address family: {family}"),
            ));
        }
    };

    let socket = WasiTcpSocket::create(ip_family).map_err(|e| {
        throw_socket_error(
            ctx,
            error_code_to_errno(&e),
            "socket",
            &format!("Failed to create TCP socket: {e:?}"),
        )
    })?;

    Ok(TcpSocket {
        inner: RefCell::new(TcpInner {
            socket: Some(Rc::new(socket)),
            reader: None,
            writer: None,
            send_future: None,
            recv_future: None,
            read_cancel: None,
            write_cancel: None,
            family: ip_family,
            connected: false,
            closed: false,
        }),
    })
}

/// P3 socket state. Unlike P2, there are no pollables: reads/writes borrow the
/// stream reader/writer out of the `RefCell` for the duration of an `await`
/// (sequential per the Node stream state machine), while a cloned `Rc` keeps the
/// underlying socket resource alive even if `close()` races with an in-flight op.
#[cfg(feature = "p3")]
struct TcpInner {
    socket: Option<Rc<WasiTcpSocket>>,
    /// Receive-side stream from `receive()`; `None` once EOF is reached or the
    /// read side is shut down.
    reader: Option<StreamReader<u8>>,
    /// Write-side of the stream handed to `send()`; `None` once the write side is
    /// shut down (SHUT_WR) or the socket is closed.
    writer: Option<StreamWriter<u8>>,
    /// Retained completion futures for the one-shot `send()`/`receive()` calls so
    /// the operations are not cancelled while their streams are in use.
    send_future: Option<FutureReader<Result<(), ErrorCode>>>,
    recv_future: Option<FutureReader<Result<(), ErrorCode>>>,
    /// Wakes the in-flight `read()` / `write()` (if any) when the socket is
    /// closed or the corresponding side is shut down. Without this, a pending
    /// `StreamReader::read` would pin the socket resource (via its cloned `Rc`)
    /// and the JS event loop alive until the *peer* closes the connection.
    read_cancel: Option<oneshot::Sender<()>>,
    write_cancel: Option<oneshot::Sender<()>>,
    family: IpAddressFamily,
    connected: bool,
    closed: bool,
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct TcpSocket {
    #[qjs(skip_trace)]
    inner: RefCell<TcpInner>,
}

#[cfg(feature = "p2")]
#[rquickjs::methods]
impl TcpSocket {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "TcpSocket cannot be constructed directly, use create_tcp_socket()",
        ))
    }

    pub async fn bind(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "bind",
                    "Socket is closed",
                ));
            }
            inner.generation
        };

        // start_bind
        {
            let inner = self.inner.borrow();
            let network = instance_network();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
            })?;
            socket.start_bind(&network, sock_addr).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "bind",
                    &format!("bind failed: {e:?}"),
                )
            })?;
        }

        // Poll until finish_bind succeeds
        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                })?;
                socket.finish_bind()
            };
            match result {
                Ok(()) => break,
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                        })?;
                        let pollable = socket.subscribe();
                        inner.waiters += 1;
                        pollable
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "bind",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "bind",
                        &format!("bind failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub async fn connect(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EINVAL",
                "connect",
                &format!("Invalid address: {addr}"),
            )
        })?;
        let remote_addr = ip_socket_address(ip, port as u16);

        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "connect",
                    "Socket is closed",
                ));
            }
            if inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "EISCONN",
                    "connect",
                    "Socket is already connected",
                ));
            }
            inner.generation
        };

        // start_connect (auto-binds if unbound)
        {
            let inner = self.inner.borrow();
            let network = instance_network();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
            })?;
            socket.start_connect(&network, remote_addr).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "connect",
                    &format!("connect failed: {e:?}"),
                )
            })?;
        }

        // Poll until finish_connect succeeds
        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
                })?;
                socket.finish_connect()
            };
            match result {
                Ok((input, output)) => {
                    let mut inner = self.inner.borrow_mut();
                    inner.input = Some(input);
                    inner.output = Some(output);
                    inner.connected = true;
                    break;
                }
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(
                                &ctx,
                                "EBADF",
                                "connect",
                                "Socket was closed or reset",
                            )
                        })?;
                        let p = socket.subscribe();
                        inner.waiters += 1;
                        p
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "connect",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                Err(e) => {
                    // On connect failure, the WASI socket enters closed state.
                    // Mark our state accordingly.
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.closed = true;
                        inner.socket = None;
                        inner.input = None;
                        inner.output = None;
                        inner.generation += 1;
                    }
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "connect",
                        &format!("connect failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub async fn read(&self, ctx: Ctx<'_>, len: u64) -> rquickjs::Result<Option<Vec<u8>>> {
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "read",
                    "Socket is closed",
                ));
            }
            if !inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "ENOTCONN",
                    "read",
                    "Socket is not connected",
                ));
            }
            inner.generation
        };

        loop {
            let result = {
                let inner = self.inner.borrow();
                let input = inner
                    .input
                    .as_ref()
                    .ok_or_else(|| throw_socket_error(&ctx, "EBADF", "read", "No input stream"))?;
                input.read(len)
            };

            match result {
                Ok(data) if !data.is_empty() => return Ok(Some(data)),
                Ok(_) => {
                    // Empty read = no data yet (connection still open).
                    // Poll the input stream and retry.
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let input = inner.input.as_ref().ok_or_else(|| {
                            throw_socket_error(&ctx, "EBADF", "read", "No input stream")
                        })?;
                        let p = input.subscribe();
                        inner.waiters += 1;
                        p
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    // pollable is dropped here (AsyncPollable consumed by wait_for)
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "read",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                // Err(Closed) = EOF / peer sent FIN
                Err(StreamError::Closed) => return Ok(None),
                Err(StreamError::LastOperationFailed(e)) => {
                    return Err(throw_socket_error(
                        &ctx,
                        "EIO",
                        "read",
                        &format!("read failed: {e:?}"),
                    ));
                }
            }
        }
    }

    pub async fn write(&self, ctx: Ctx<'_>, data: Vec<u8>) -> rquickjs::Result<u32> {
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "write",
                    "Socket is closed",
                ));
            }
            if !inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "ENOTCONN",
                    "write",
                    "Socket is not connected",
                ));
            }
            inner.generation
        };

        let total = data.len();
        let mut offset = 0;

        while offset < total {
            // Wait for write capacity
            let permit = loop {
                let check = {
                    let inner = self.inner.borrow();
                    let output = inner.output.as_ref().ok_or_else(|| {
                        throw_socket_error(&ctx, "EBADF", "write", "No output stream")
                    })?;
                    output.check_write().map_err(|e| match e {
                        StreamError::Closed => {
                            throw_socket_error(&ctx, "EPIPE", "write", "Stream closed")
                        }
                        StreamError::LastOperationFailed(e) => throw_socket_error(
                            &ctx,
                            "EIO",
                            "write",
                            &format!("check_write failed: {e:?}"),
                        ),
                    })?
                };

                if check > 0 {
                    break check;
                }

                // No capacity — poll and retry
                let pollable = {
                    let mut inner = self.inner.borrow_mut();
                    let output = inner.output.as_ref().ok_or_else(|| {
                        throw_socket_error(&ctx, "EBADF", "write", "No output stream")
                    })?;
                    let p = output.subscribe();
                    inner.waiters += 1;
                    p
                };
                AsyncPollable::new(pollable).wait_for().await;
                {
                    let mut inner = self.inner.borrow_mut();
                    inner.waiters -= 1;
                    if inner.closed || inner.generation != start_gen {
                        inner.finalize_close_if_ready();
                        return Err(throw_socket_error(
                            &ctx,
                            "EBADF",
                            "write",
                            "Socket was closed or reset",
                        ));
                    }
                }
            };

            let end = std::cmp::min(offset + permit as usize, total);
            {
                let inner = self.inner.borrow();
                let output = inner.output.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "write", "No output stream")
                })?;
                output.write(&data[offset..end]).map_err(|e| match e {
                    StreamError::Closed => {
                        throw_socket_error(&ctx, "EPIPE", "write", "Stream closed")
                    }
                    StreamError::LastOperationFailed(e) => {
                        throw_socket_error(&ctx, "EIO", "write", &format!("write failed: {e:?}"))
                    }
                })?;
            };
            offset = end;
        }

        Ok(total as u32)
    }

    pub fn shutdown(&self, ctx: Ctx<'_>, how: u32) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "shutdown",
                "Socket is closed",
            ));
        }
        if !inner.connected {
            return Err(throw_socket_error(
                &ctx,
                "ENOTCONN",
                "shutdown",
                "Socket is not connected",
            ));
        }
        let shutdown_type = match how {
            0 => ShutdownType::Receive,
            1 => ShutdownType::Send,
            2 => ShutdownType::Both,
            _ => {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "shutdown",
                    &format!("Invalid shutdown type: {how}"),
                ));
            }
        };
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "shutdown", "Socket was closed or reset")
        })?;
        socket.shutdown(shutdown_type).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "shutdown",
                &format!("shutdown failed: {e:?}"),
            )
        })
    }

    pub fn local_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "address",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "address", "Socket was closed or reset")
        })?;
        let addr = socket.local_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "address",
                &format!("local_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn remote_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "remoteAddress",
                "Socket is closed",
            ));
        }
        if !inner.connected {
            return Err(throw_socket_error(
                &ctx,
                "ENOTCONN",
                "remoteAddress",
                "Socket is not connected",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "remoteAddress", "Socket was closed or reset")
        })?;
        let addr = socket.remote_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "remoteAddress",
                &format!("remote_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn set_keep_alive(&self, ctx: Ctx<'_>, enable: bool, idle_ms: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setKeepAlive",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "setKeepAlive", "Socket was closed or reset")
        })?;
        socket.set_keep_alive_enabled(enable).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "setKeepAlive",
                &format!("set_keep_alive_enabled failed: {e:?}"),
            )
        })?;
        if enable && idle_ms > 0 {
            let nanos = idle_ms * 1_000_000;
            socket.set_keep_alive_idle_time(nanos).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "setKeepAlive",
                    &format!("set_keep_alive_idle_time failed: {e:?}"),
                )
            })?;
        }
        Ok(())
    }

    pub fn set_no_delay(&self, _ctx: Ctx<'_>, _enable: bool) -> rquickjs::Result<()> {
        // WASI TCP does not expose TCP_NODELAY — silent no-op
        Ok(())
    }

    pub fn set_recv_buffer_size(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setRecvBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "setRecvBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.set_receive_buffer_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "setRecvBufferSize",
                &format!("set_receive_buffer_size failed: {e:?}"),
            )
        })
    }

    pub fn set_send_buffer_size(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setSendBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "setSendBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.set_send_buffer_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "setSendBufferSize",
                &format!("set_send_buffer_size failed: {e:?}"),
            )
        })
    }

    pub fn address_family(&self) -> u32 {
        let inner = self.inner.borrow();
        match inner.socket.as_ref().map(|s| s.address_family()) {
            Some(IpAddressFamily::Ipv4) | None => 4,
            Some(IpAddressFamily::Ipv6) => 6,
        }
    }

    pub fn close(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return;
        }
        inner.closed = true;
        inner.generation += 1;
        // Shut down the socket to signal EOF to any pending read/accept pollables.
        if let Some(ref socket) = inner.socket {
            let _ = socket.shutdown(ShutdownType::Both);
        }
        // Only drop resources immediately if no async tasks are waiting on pollables.
        // Otherwise, let the last waiter finalize the drop (see finalize_close_if_ready).
        if inner.waiters == 0 {
            inner.input = None;
            inner.output = None;
            inner.socket = None;
        }
    }

    pub fn force_close(&self) {
        let mut inner = self.inner.borrow_mut();
        inner.closed = true;
        inner.generation += 1;
        // Drop all resources immediately, even if waiters are active.
        // The waiters will see closed=true and exit gracefully.
        inner.input = None;
        inner.output = None;
        inner.socket = None;
    }
}

#[cfg(feature = "p3")]
#[rquickjs::methods]
impl TcpSocket {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "TcpSocket cannot be constructed directly, use create_tcp_socket()",
        ))
    }

    // `bind` is synchronous in P3, but the JS contract awaits it, so this stays
    // an `async fn` with no await points.
    pub async fn bind(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "bind",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
        })?;
        socket.bind(sock_addr).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "bind",
                &format!("bind failed: {e:?}"),
            )
        })
    }

    pub async fn connect(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EINVAL",
                "connect",
                &format!("Invalid address: {addr}"),
            )
        })?;
        let remote_addr = ip_socket_address(ip, port as u16);

        let socket = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "connect",
                    "Socket is closed",
                ));
            }
            if inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "EISCONN",
                    "connect",
                    "Socket is already connected",
                ));
            }
            inner.socket.clone().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
            })?
        };

        // `connect` is async in P3; the cloned `Rc` keeps the socket alive across
        // the await even if `close()` runs concurrently.
        if let Err(e) = socket.connect(remote_addr).await {
            let mut inner = self.inner.borrow_mut();
            inner.closed = true;
            inner.connected = false;
            inner.socket = None;
            inner.reader = None;
            inner.writer = None;
            inner.send_future = None;
            inner.recv_future = None;
            return Err(throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "connect",
                &format!("connect failed: {e:?}"),
            ));
        }

        // Wire up the receive stream and the send stream (each may be called only
        // once per socket).
        let (recv_reader, recv_future) = socket.receive();
        let (writer, send_read) = wasip3::wit_stream::new::<u8>();
        let send_future = socket.send(send_read);

        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            // Closed while connecting; drop the freshly created streams.
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "connect",
                "Socket was closed or reset",
            ));
        }
        inner.reader = Some(recv_reader);
        inner.recv_future = Some(recv_future);
        inner.writer = Some(writer);
        inner.send_future = Some(send_future);
        inner.connected = true;
        Ok(())
    }

    pub async fn read(&self, ctx: Ctx<'_>, len: u64) -> rquickjs::Result<Option<Vec<u8>>> {
        let (_keepalive, mut reader, mut cancel_rx) = {
            let mut inner = self.inner.borrow_mut();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "read",
                    "Socket is closed",
                ));
            }
            if !inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "ENOTCONN",
                    "read",
                    "Socket is not connected",
                ));
            }
            match (inner.socket.clone(), inner.reader.take()) {
                (Some(sock), Some(reader)) => {
                    // Register a cancel signal so `close()` / `shutdown(SHUT_RD)`
                    // can wake this read; otherwise the pending stream read would
                    // keep the socket resource and the JS event loop alive until
                    // the peer closes the connection.
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    inner.read_cancel = Some(cancel_tx);
                    (sock, reader, cancel_rx)
                }
                // No reader means the receive side already reached EOF or was shut
                // down: report end-of-stream.
                _ => return Ok(None),
            }
        };

        let cap = if len == 0 { 16384 } else { len as usize };
        loop {
            let (status, buf) = {
                let read_fut = reader.read(Vec::with_capacity(cap));
                futures::pin_mut!(read_fut);
                match futures::future::select(read_fut, &mut cancel_rx).await {
                    Either::Left((result, _)) => result,
                    Either::Right(_) => {
                        // Cancelled by `close()` or `shutdown(SHUT_RD)`. Dropping
                        // the in-flight read future issues `stream.cancel-read`;
                        // dropping the reader and the keepalive `Rc` releases the
                        // socket.
                        return Ok(None);
                    }
                }
            };
            match status {
                StreamResult::Complete(_) if !buf.is_empty() => {
                    let mut inner = self.inner.borrow_mut();
                    inner.read_cancel = None;
                    if !inner.closed {
                        inner.reader = Some(reader);
                    }
                    return Ok(Some(buf));
                }
                // A zero-length completion carries no data and no EOF signal; retry.
                StreamResult::Complete(_) => continue,
                StreamResult::Dropped => {
                    // Peer sent FIN / stream closed. Drop the reader so subsequent
                    // reads observe EOF.
                    let mut inner = self.inner.borrow_mut();
                    inner.read_cancel = None;
                    inner.reader = None;
                    inner.recv_future = None;
                    if buf.is_empty() {
                        return Ok(None);
                    }
                    return Ok(Some(buf));
                }
                StreamResult::Cancelled => {
                    self.inner.borrow_mut().read_cancel = None;
                    return Ok(None);
                }
            }
        }
    }

    pub async fn write(&self, ctx: Ctx<'_>, data: Vec<u8>) -> rquickjs::Result<u32> {
        let total = data.len();
        let (_keepalive, mut writer, mut cancel_rx) = {
            let mut inner = self.inner.borrow_mut();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "write",
                    "Socket is closed",
                ));
            }
            if !inner.connected {
                return Err(throw_socket_error(
                    &ctx,
                    "ENOTCONN",
                    "write",
                    "Socket is not connected",
                ));
            }
            match (inner.socket.clone(), inner.writer.take()) {
                (Some(sock), Some(writer)) => {
                    // Register a cancel signal so `close()` can wake a write that
                    // is blocked on stream capacity (see `read_cancel`).
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    inner.write_cancel = Some(cancel_tx);
                    (sock, writer, cancel_rx)
                }
                // No writer means the write side was shut down (SHUT_WR).
                _ => {
                    return Err(throw_socket_error(
                        &ctx,
                        "EPIPE",
                        "write",
                        "Write after end",
                    ));
                }
            }
        };

        let leftover = {
            let write_fut = writer.write_all(data);
            futures::pin_mut!(write_fut);
            match futures::future::select(write_fut, &mut cancel_rx).await {
                Either::Left((leftover, _)) => leftover,
                Either::Right(_) => {
                    // Cancelled by `close()`. Dropping the in-flight write future
                    // cancels the pending stream write; dropping the writer and
                    // the keepalive `Rc` releases the socket.
                    return Err(throw_socket_error(
                        &ctx,
                        "EPIPE",
                        "write",
                        "Socket is closed",
                    ));
                }
            }
        };
        let mut inner = self.inner.borrow_mut();
        inner.write_cancel = None;
        if !leftover.is_empty() {
            // The peer hung up before all bytes were accepted.
            inner.writer = None;
            inner.send_future = None;
            return Err(throw_socket_error(&ctx, "EPIPE", "write", "Stream closed"));
        }
        if !inner.closed {
            inner.writer = Some(writer);
        }
        Ok(total as u32)
    }

    pub fn shutdown(&self, ctx: Ctx<'_>, how: u32) -> rquickjs::Result<()> {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "shutdown",
                "Socket is closed",
            ));
        }
        if !inner.connected {
            return Err(throw_socket_error(
                &ctx,
                "ENOTCONN",
                "shutdown",
                "Socket is not connected",
            ));
        }
        match how {
            // SHUT_RD: drop the receive stream (discards queued data) and cancel
            // an in-flight read (which owns the taken-out reader).
            0 => {
                inner.reader = None;
                if let Some(tx) = inner.read_cancel.take() {
                    let _ = tx.send(());
                }
            }
            // SHUT_WR: drop the send-stream writer, which closes the stream and
            // makes the host emit a FIN. Keep `send_future` so the host can drain
            // any already-written bytes.
            1 => {
                inner.writer = None;
            }
            2 => {
                inner.reader = None;
                inner.writer = None;
                if let Some(tx) = inner.read_cancel.take() {
                    let _ = tx.send(());
                }
                if let Some(tx) = inner.write_cancel.take() {
                    let _ = tx.send(());
                }
            }
            _ => {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "shutdown",
                    &format!("Invalid shutdown type: {how}"),
                ));
            }
        }
        Ok(())
    }

    pub fn local_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "address",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "address", "Socket was closed or reset")
        })?;
        let addr = socket.get_local_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "address",
                &format!("local_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn remote_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "remoteAddress",
                "Socket is closed",
            ));
        }
        if !inner.connected {
            return Err(throw_socket_error(
                &ctx,
                "ENOTCONN",
                "remoteAddress",
                "Socket is not connected",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "remoteAddress", "Socket was closed or reset")
        })?;
        let addr = socket.get_remote_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "remoteAddress",
                &format!("remote_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn set_keep_alive(&self, ctx: Ctx<'_>, enable: bool, idle_ms: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setKeepAlive",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "setKeepAlive", "Socket was closed or reset")
        })?;
        socket.set_keep_alive_enabled(enable).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "setKeepAlive",
                &format!("set_keep_alive_enabled failed: {e:?}"),
            )
        })?;
        if enable && idle_ms > 0 {
            let nanos = idle_ms * 1_000_000;
            socket.set_keep_alive_idle_time(nanos).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(&e),
                    "setKeepAlive",
                    &format!("set_keep_alive_idle_time failed: {e:?}"),
                )
            })?;
        }
        Ok(())
    }

    pub fn set_no_delay(&self, _ctx: Ctx<'_>, _enable: bool) -> rquickjs::Result<()> {
        // WASI TCP does not expose TCP_NODELAY — silent no-op
        Ok(())
    }

    pub fn set_recv_buffer_size(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setRecvBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "setRecvBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.set_receive_buffer_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "setRecvBufferSize",
                &format!("set_receive_buffer_size failed: {e:?}"),
            )
        })
    }

    pub fn set_send_buffer_size(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setSendBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "setSendBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.set_send_buffer_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "setSendBufferSize",
                &format!("set_send_buffer_size failed: {e:?}"),
            )
        })
    }

    pub fn address_family(&self) -> u32 {
        let inner = self.inner.borrow();
        match inner.family {
            IpAddressFamily::Ipv4 => 4,
            IpAddressFamily::Ipv6 => 6,
        }
    }

    pub fn close(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return;
        }
        inner.closed = true;
        inner.connected = false;
        // Drop the writer first so the send stream closes (FIN) before the socket
        // resource is released. In-flight read/write tasks hold their own reader/
        // writer and a cloned `Rc`; cancel them so they release those handles —
        // otherwise a pending read would pin the socket resource (and the JS
        // event loop) alive until the peer closes the connection.
        if let Some(tx) = inner.read_cancel.take() {
            let _ = tx.send(());
        }
        if let Some(tx) = inner.write_cancel.take() {
            let _ = tx.send(());
        }
        inner.writer = None;
        inner.send_future = None;
        inner.reader = None;
        inner.recv_future = None;
        inner.socket = None;
    }

    pub fn force_close(&self) {
        // On P3 `close()` already tears everything down immediately; in-flight
        // tasks own their taken-out stream handles and are cancelled by `close()`.
        self.close();
    }
}

// ── TcpListener (server sockets) ────────────────────────────────────────

#[cfg(feature = "p2")]
fn create_tcp_listener_impl(ctx: &Ctx<'_>, family: u32) -> rquickjs::Result<TcpListener> {
    let ip_family = match family {
        4 => IpAddressFamily::Ipv4,
        6 => IpAddressFamily::Ipv6,
        _ => {
            return Err(throw_socket_error(
                ctx,
                "EINVAL",
                "socket",
                &format!("Invalid address family: {family}"),
            ));
        }
    };

    let socket = create_tcp_socket(ip_family).map_err(|e| {
        throw_socket_error(
            ctx,
            error_code_to_errno(e),
            "socket",
            &format!("Failed to create TCP socket: {e:?}"),
        )
    })?;

    Ok(TcpListener {
        inner: RefCell::new(ListenerInner {
            socket: Some(socket),
            listening: false,
            closed: false,
            generation: 0,
            waiters: 0,
        }),
    })
}

#[cfg(feature = "p2")]
struct ListenerInner {
    socket: Option<wasip2::sockets::tcp::TcpSocket>,
    listening: bool,
    closed: bool,
    generation: u64,
    waiters: u32,
}

#[cfg(feature = "p2")]
impl ListenerInner {
    fn finalize_close_if_ready(&mut self) {
        if self.closed && self.waiters == 0 {
            self.socket = None;
        }
    }
}

#[cfg(feature = "p3")]
fn create_tcp_listener_impl(ctx: &Ctx<'_>, family: u32) -> rquickjs::Result<TcpListener> {
    let ip_family = match family {
        4 => IpAddressFamily::Ipv4,
        6 => IpAddressFamily::Ipv6,
        _ => {
            return Err(throw_socket_error(
                ctx,
                "EINVAL",
                "socket",
                &format!("Invalid address family: {family}"),
            ));
        }
    };

    let socket = WasiTcpSocket::create(ip_family).map_err(|e| {
        throw_socket_error(
            ctx,
            error_code_to_errno(&e),
            "socket",
            &format!("Failed to create TCP socket: {e:?}"),
        )
    })?;

    Ok(TcpListener {
        inner: RefCell::new(ListenerInner {
            socket: Some(Rc::new(socket)),
            accept_stream: None,
            accept_cancel: None,
            listening: false,
            closed: false,
        }),
    })
}

/// P3 listener state. `listen()` yields a `stream<tcp-socket>` that we read one
/// accepted connection at a time; a cloned `Rc` keeps the listener socket alive
/// across the `accept` await even if `close()` races.
#[cfg(feature = "p3")]
struct ListenerInner {
    socket: Option<Rc<WasiTcpSocket>>,
    accept_stream: Option<StreamReader<WasiTcpSocket>>,
    /// Wakes the in-flight `accept()` (if any) when the listener is closed, so
    /// the pending accept-stream read does not pin the listener socket (via its
    /// cloned `Rc`) and the JS event loop alive.
    accept_cancel: Option<oneshot::Sender<()>>,
    listening: bool,
    closed: bool,
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct TcpListener {
    #[qjs(skip_trace)]
    inner: RefCell<ListenerInner>,
}

#[cfg(feature = "p2")]
#[rquickjs::methods]
impl TcpListener {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "TcpListener cannot be constructed directly, use create_tcp_listener()",
        ))
    }

    pub async fn bind(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "bind",
                    "Socket is closed",
                ));
            }
            inner.generation
        };

        // start_bind
        {
            let inner = self.inner.borrow();
            let network = instance_network();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
            })?;
            socket.start_bind(&network, sock_addr).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "bind",
                    &format!("bind failed: {e:?}"),
                )
            })?;
        }

        // Poll until finish_bind succeeds
        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                })?;
                socket.finish_bind()
            };
            match result {
                Ok(()) => break,
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                        })?;
                        let pollable = socket.subscribe();
                        inner.waiters += 1;
                        pollable
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "bind",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "bind",
                        &format!("bind failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn bind_sync(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "bind",
                    "Socket is closed",
                ));
            }
        }

        {
            let inner = self.inner.borrow();
            let network = instance_network();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
            })?;
            socket.start_bind(&network, sock_addr).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "bind",
                    &format!("bind failed: {e:?}"),
                )
            })?;
        }

        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                })?;
                socket.finish_bind()
            };
            match result {
                Ok(()) => break,
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let inner = self.inner.borrow();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                        })?;
                        socket.subscribe()
                    };
                    wasip2::io::poll::poll(&[&pollable]);
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "bind",
                        &format!("bind failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn listen_sync(&self, ctx: Ctx<'_>) -> rquickjs::Result<()> {
        {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "listen",
                    "Socket is closed",
                ));
            }
            if inner.listening {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "listen",
                    "Socket is already listening",
                ));
            }
        }

        {
            let inner = self.inner.borrow();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "listen", "Socket was closed or reset")
            })?;
            socket.start_listen().map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "listen",
                    &format!("listen failed: {e:?}"),
                )
            })?;
        }

        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "listen", "Socket was closed or reset")
                })?;
                socket.finish_listen()
            };
            match result {
                Ok(()) => {
                    let mut inner = self.inner.borrow_mut();
                    inner.listening = true;
                    break;
                }
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let inner = self.inner.borrow();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(
                                &ctx,
                                "EBADF",
                                "listen",
                                "Socket was closed or reset",
                            )
                        })?;
                        socket.subscribe()
                    };
                    wasip2::io::poll::poll(&[&pollable]);
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "listen",
                        &format!("listen failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn set_backlog(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setBacklog",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "setBacklog", "Socket was closed or reset")
        })?;
        socket.set_listen_backlog_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "setBacklog",
                &format!("set_listen_backlog_size failed: {e:?}"),
            )
        })
    }

    pub async fn listen(&self, ctx: Ctx<'_>) -> rquickjs::Result<()> {
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "listen",
                    "Socket is closed",
                ));
            }
            if inner.listening {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "listen",
                    "Socket is already listening",
                ));
            }
            inner.generation
        };

        // start_listen
        {
            let inner = self.inner.borrow();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "listen", "Socket was closed or reset")
            })?;
            socket.start_listen().map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "listen",
                    &format!("listen failed: {e:?}"),
                )
            })?;
        }

        // Poll until finish_listen succeeds
        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "listen", "Socket was closed or reset")
                })?;
                socket.finish_listen()
            };
            match result {
                Ok(()) => {
                    let mut inner = self.inner.borrow_mut();
                    inner.listening = true;
                    break;
                }
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(
                                &ctx,
                                "EBADF",
                                "listen",
                                "Socket was closed or reset",
                            )
                        })?;
                        let pollable = socket.subscribe();
                        inner.waiters += 1;
                        pollable
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "listen",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "listen",
                        &format!("listen failed: {e:?}"),
                    ));
                }
            }
        }

        Ok(())
    }

    pub async fn accept(
        &self,
        ctx: Ctx<'_>,
    ) -> rquickjs::Result<List<(TcpSocket, String, u32, String)>> {
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "accept",
                    "Socket is closed",
                ));
            }
            if !inner.listening {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "accept",
                    "Socket is not listening",
                ));
            }
            inner.generation
        };

        loop {
            let result = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "accept", "Socket was closed or reset")
                })?;
                socket.accept()
            };

            match result {
                Ok((client_socket, input, output)) => {
                    // Get remote address from client socket
                    let (addr_str, port, family) = match client_socket.remote_address() {
                        Ok(addr) => {
                            let a = ip_address_to_string(&addr);
                            let p = ip_socket_address_port(&addr) as u32;
                            let f = ip_socket_address_family(&addr).to_string();
                            (a, p, f)
                        }
                        Err(_) => ("0.0.0.0".to_string(), 0, "IPv4".to_string()),
                    };

                    let wrapped = TcpSocket {
                        inner: RefCell::new(TcpInner {
                            input: Some(input),
                            output: Some(output),
                            socket: Some(client_socket),
                            connected: true,
                            closed: false,
                            generation: 0,
                            waiters: 0,
                        }),
                    };

                    return Ok(List((wrapped, addr_str, port, family)));
                }
                Err(ErrorCode::WouldBlock) => {
                    let pollable = {
                        let mut inner = self.inner.borrow_mut();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(
                                &ctx,
                                "EBADF",
                                "accept",
                                "Socket was closed or reset",
                            )
                        })?;
                        let pollable = socket.subscribe();
                        inner.waiters += 1;
                        pollable
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let mut inner = self.inner.borrow_mut();
                        inner.waiters -= 1;
                        if inner.closed || inner.generation != start_gen {
                            inner.finalize_close_if_ready();
                            return Err(throw_socket_error(
                                &ctx,
                                "EBADF",
                                "accept",
                                "Socket was closed or reset",
                            ));
                        }
                    }
                }
                Err(ErrorCode::ConnectionAborted) => {
                    // Client disconnected before accept — retry
                    continue;
                }
                Err(e) => {
                    return Err(throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "accept",
                        &format!("accept failed: {e:?}"),
                    ));
                }
            }
        }
    }

    pub fn local_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "address",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "address", "Socket was closed or reset")
        })?;
        let addr = socket.local_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "address",
                &format!("local_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn close(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return;
        }
        if let Some(ref socket) = inner.socket {
            // Explicitly shut down the listener first so dropping the WASI
            // socket resource does not race with pending accept pollers.
            let _ = socket.shutdown(ShutdownType::Both);
        }
        inner.closed = true;
        inner.listening = false;
        inner.generation += 1;
        inner.finalize_close_if_ready();
    }
}

#[cfg(feature = "p3")]
#[rquickjs::methods]
impl TcpListener {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "TcpListener cannot be constructed directly, use create_tcp_listener()",
        ))
    }

    // `bind` is synchronous in P3; kept `async` to match the JS contract.
    pub async fn bind(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        self.bind_sync(ctx, addr, port)
    }

    pub fn bind_sync(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "bind",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
        })?;
        socket.bind(sock_addr).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "bind",
                &format!("bind failed: {e:?}"),
            )
        })
    }

    pub fn listen_sync(&self, ctx: Ctx<'_>) -> rquickjs::Result<()> {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "listen",
                "Socket is closed",
            ));
        }
        if inner.listening {
            return Err(throw_socket_error(
                &ctx,
                "EINVAL",
                "listen",
                "Socket is already listening",
            ));
        }
        let stream = {
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "listen", "Socket was closed or reset")
            })?;
            socket.listen().map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(&e),
                    "listen",
                    &format!("listen failed: {e:?}"),
                )
            })?
        };
        inner.accept_stream = Some(stream);
        inner.listening = true;
        Ok(())
    }

    // `listen` is synchronous in P3; kept `async` to match the JS contract.
    pub async fn listen(&self, ctx: Ctx<'_>) -> rquickjs::Result<()> {
        self.listen_sync(ctx)
    }

    pub fn set_backlog(&self, ctx: Ctx<'_>, size: u64) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setBacklog",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "setBacklog", "Socket was closed or reset")
        })?;
        socket.set_listen_backlog_size(size).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "setBacklog",
                &format!("set_listen_backlog_size failed: {e:?}"),
            )
        })
    }

    pub async fn accept(
        &self,
        ctx: Ctx<'_>,
    ) -> rquickjs::Result<List<(TcpSocket, String, u32, String)>> {
        let (_keepalive, mut stream, mut cancel_rx) = {
            let mut inner = self.inner.borrow_mut();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "accept",
                    "Socket is closed",
                ));
            }
            if !inner.listening {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "accept",
                    "Socket is not listening",
                ));
            }
            match (inner.socket.clone(), inner.accept_stream.take()) {
                (Some(sock), Some(stream)) => {
                    // Register a cancel signal so `close()` can wake this accept;
                    // otherwise the pending accept-stream read would keep the
                    // listener socket resource and the JS event loop alive.
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    inner.accept_cancel = Some(cancel_tx);
                    (sock, stream, cancel_rx)
                }
                _ => {
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "accept",
                        "Socket was closed or reset",
                    ));
                }
            }
        };

        let accepted = {
            let accept_fut = stream.next();
            futures::pin_mut!(accept_fut);
            match futures::future::select(accept_fut, &mut cancel_rx).await {
                Either::Left((accepted, _)) => accepted,
                Either::Right((_, accept_fut)) => {
                    // Cancelled by `close()`. Dropping the in-flight stream read
                    // and the keepalive `Rc` releases the listener socket.
                    drop(accept_fut);
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "accept",
                        "Socket was closed or reset",
                    ));
                }
            }
        };

        let client = {
            let mut inner = self.inner.borrow_mut();
            inner.accept_cancel = None;
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "accept",
                    "Socket was closed or reset",
                ));
            }
            inner.accept_stream = Some(stream);
            match accepted {
                Some(client) => client,
                // The accept stream only ends on fatal errors or listener drop.
                None => {
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "accept",
                        "Listener stopped accepting connections",
                    ));
                }
            }
        };

        let client = Rc::new(client);

        let (addr_str, port, family) = match client.get_remote_address() {
            Ok(addr) => {
                let a = ip_address_to_string(&addr);
                let p = ip_socket_address_port(&addr) as u32;
                let f = ip_socket_address_family(&addr).to_string();
                (a, p, f)
            }
            Err(_) => ("0.0.0.0".to_string(), 0, "IPv4".to_string()),
        };
        let client_family = client.get_address_family();

        // Wire up receive/send streams for the accepted connection (each may be
        // called only once per socket).
        let (recv_reader, recv_future) = client.receive();
        let (writer, send_read) = wasip3::wit_stream::new::<u8>();
        let send_future = client.send(send_read);

        let wrapped = TcpSocket {
            inner: RefCell::new(TcpInner {
                socket: Some(client),
                reader: Some(recv_reader),
                writer: Some(writer),
                send_future: Some(send_future),
                recv_future: Some(recv_future),
                read_cancel: None,
                write_cancel: None,
                family: client_family,
                connected: true,
                closed: false,
            }),
        };

        Ok(List((wrapped, addr_str, port, family)))
    }

    pub fn local_address(&self, ctx: Ctx<'_>) -> rquickjs::Result<List<(String, u32, String)>> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "address",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "address", "Socket was closed or reset")
        })?;
        let addr = socket.get_local_address().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(&e),
                "address",
                &format!("local_address failed: {e:?}"),
            )
        })?;
        let addr_str = ip_address_to_string(&addr);
        let port = ip_socket_address_port(&addr) as u32;
        let family = ip_socket_address_family(&addr).to_string();
        Ok(List((addr_str, port, family)))
    }

    pub fn close(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return;
        }
        inner.closed = true;
        inner.listening = false;
        // Wake an in-flight `accept()` so it releases its taken-out stream and
        // its cloned socket `Rc` (see `accept_cancel`).
        if let Some(tx) = inner.accept_cancel.take() {
            let _ = tx.send(());
        }
        inner.accept_stream = None;
        inner.socket = None;
    }
}

pub const NET_JS: &str = include_str!("net.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:net'; export { default } from 'node:net';"#;
