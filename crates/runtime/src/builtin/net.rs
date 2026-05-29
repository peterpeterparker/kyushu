use std::cell::RefCell;

use rquickjs::class::Trace;
use rquickjs::prelude::List;
use rquickjs::{Ctx, Exception, JsLifetime};
use wasip2::io::streams::{InputStream, OutputStream, StreamError};
use wasip2::sockets::instance_network::instance_network;
use wasip2::sockets::network::{ErrorCode, IpAddressFamily};
use wasip2::sockets::tcp::ShutdownType;
use wasip2::sockets::tcp_create_socket::create_tcp_socket;
use wstd::runtime::AsyncPollable;

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

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct TcpSocket {
    #[qjs(skip_trace)]
    inner: RefCell<TcpInner>,
}

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

// ── TcpListener (server sockets) ────────────────────────────────────────

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

struct ListenerInner {
    socket: Option<wasip2::sockets::tcp::TcpSocket>,
    listening: bool,
    closed: bool,
    generation: u64,
    waiters: u32,
}

impl ListenerInner {
    fn finalize_close_if_ready(&mut self) {
        if self.closed && self.waiters == 0 {
            self.socket = None;
        }
    }
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct TcpListener {
    #[qjs(skip_trace)]
    inner: RefCell<ListenerInner>,
}

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

pub const NET_JS: &str = include_str!("net.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:net'; export { default } from 'node:net';"#;
