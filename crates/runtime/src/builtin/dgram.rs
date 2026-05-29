use std::cell::RefCell;

use rquickjs::class::Trace;
use rquickjs::prelude::List;
use rquickjs::{Ctx, Exception, JsLifetime};
use wasip2::sockets::instance_network::instance_network;
use wasip2::sockets::network::{ErrorCode, IpAddressFamily, IpSocketAddress};
use wasip2::sockets::udp::{
    IncomingDatagramStream, OutgoingDatagram, OutgoingDatagramStream, UdpSocket,
};
use wasip2::sockets::udp_create_socket::create_udp_socket;
use wstd::runtime::AsyncPollable;

use super::socket_helpers::{
    error_code_to_errno, ip_address_to_string, ip_socket_address, ip_socket_address_family,
    ip_socket_address_port, parse_ip_address, throw_socket_error,
};

#[rquickjs::module]
pub mod native_module {
    pub use super::DgramSocket;

    #[rquickjs::function]
    pub fn create_socket(ctx: rquickjs::Ctx<'_>, family: u32) -> rquickjs::Result<DgramSocket> {
        super::create_socket_impl(&ctx, family)
    }
}

fn create_socket_impl(ctx: &Ctx<'_>, family: u32) -> rquickjs::Result<DgramSocket> {
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

    let socket = create_udp_socket(ip_family).map_err(|e| {
        throw_socket_error(
            ctx,
            error_code_to_errno(e),
            "socket",
            &format!("Failed to create UDP socket: {e:?}"),
        )
    })?;

    Ok(DgramSocket {
        inner: RefCell::new(DgramInner {
            socket: Some(socket),
            incoming: None,
            outgoing: None,
            bound: false,
            connected: false,
            closed: false,
            generation: 0,
        }),
    })
}

struct DgramInner {
    socket: Option<UdpSocket>,
    incoming: Option<IncomingDatagramStream>,
    outgoing: Option<OutgoingDatagramStream>,
    bound: bool,
    connected: bool,
    closed: bool,
    generation: u64,
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class]
pub struct DgramSocket {
    #[qjs(skip_trace)]
    inner: RefCell<DgramInner>,
}

#[rquickjs::methods]
impl DgramSocket {
    #[qjs(constructor)]
    pub fn new(ctx: Ctx<'_>) -> rquickjs::Result<Self> {
        Err(Exception::throw_message(
            &ctx,
            "DgramSocket cannot be constructed directly, use create_socket()",
        ))
    }

    pub async fn bind(&self, ctx: Ctx<'_>, addr: String, port: u32) -> rquickjs::Result<()> {
        let ip = parse_ip_address(&addr).ok_or_else(|| {
            throw_socket_error(&ctx, "EINVAL", "bind", &format!("Invalid address: {addr}"))
        })?;
        let sock_addr = ip_socket_address(ip, port as u16);

        // Capture generation for checking after await points
        let start_gen = {
            let inner = self.inner.borrow();
            inner.generation
        };

        // start_bind - borrow, call, drop
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
            if inner.bound {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "bind",
                    "Socket is already bound",
                ));
            }
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
                        let inner = self.inner.borrow();
                        let socket = inner.socket.as_ref().ok_or_else(|| {
                            throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
                        })?;
                        socket.subscribe()
                    };
                    AsyncPollable::new(pollable).wait_for().await;
                    {
                        let inner = self.inner.borrow();
                        if inner.closed || inner.generation != start_gen {
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

        // Open unconnected streams
        let (incoming, outgoing) = {
            let inner = self.inner.borrow();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "bind", "Socket was closed or reset")
            })?;
            socket.stream(None).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "bind",
                    &format!("stream failed: {e:?}"),
                )
            })?
        };

        {
            let mut inner = self.inner.borrow_mut();
            inner.incoming = Some(incoming);
            inner.outgoing = Some(outgoing);
            inner.bound = true;
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

        // Auto-bind if not already bound
        let needs_bind = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "connect",
                    "Socket is closed",
                ));
            }
            !inner.bound
        };

        if needs_bind {
            let family = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
                })?;
                socket.address_family()
            };
            let any_addr = match family {
                IpAddressFamily::Ipv4 => "0.0.0.0",
                IpAddressFamily::Ipv6 => "::",
            };
            self.bind(ctx.clone(), any_addr.to_string(), 0).await?;

            // Check generation after await
            {
                let inner = self.inner.borrow();
                if inner.closed {
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "connect",
                        "Socket was closed or reset",
                    ));
                }
            }
        }

        // Drop old streams first (WASI's stream() invalidates previous streams)
        {
            let mut inner = self.inner.borrow_mut();
            inner.incoming = None;
            inner.outgoing = None;
        }

        // Try to create connected streams
        let stream_result = {
            let inner = self.inner.borrow();
            let socket = inner.socket.as_ref().ok_or_else(|| {
                throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
            })?;
            socket.stream(Some(remote_addr))
        };

        match stream_result {
            Ok((incoming, outgoing)) => {
                let mut inner = self.inner.borrow_mut();
                inner.incoming = Some(incoming);
                inner.outgoing = Some(outgoing);
                inner.connected = true;
                inner.generation += 1;
            }
            Err(e) => {
                // On failure, try to restore unconnected streams
                let restore_result = {
                    let inner = self.inner.borrow();
                    let socket = inner.socket.as_ref().ok_or_else(|| {
                        throw_socket_error(&ctx, "EBADF", "connect", "Socket was closed or reset")
                    })?;
                    socket.stream(None)
                };
                if let Ok((incoming, outgoing)) = restore_result {
                    let mut inner = self.inner.borrow_mut();
                    inner.incoming = Some(incoming);
                    inner.outgoing = Some(outgoing);
                }
                return Err(throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "connect",
                    &format!("connect failed: {e:?}"),
                ));
            }
        }

        Ok(())
    }

    pub fn disconnect(&self, ctx: Ctx<'_>) -> rquickjs::Result<()> {
        let mut inner = self.inner.borrow_mut();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "disconnect",
                "Socket is closed",
            ));
        }
        if !inner.connected {
            return Err(throw_socket_error(
                &ctx,
                "ENOTCONN",
                "disconnect",
                "Socket is not connected",
            ));
        }

        // Drop old streams
        inner.incoming = None;
        inner.outgoing = None;

        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "disconnect", "Socket was closed or reset")
        })?;

        // Re-open unconnected streams
        let (incoming, outgoing) = socket.stream(None).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "disconnect",
                &format!("disconnect failed: {e:?}"),
            )
        })?;

        inner.incoming = Some(incoming);
        inner.outgoing = Some(outgoing);
        inner.connected = false;
        inner.generation += 1;

        Ok(())
    }

    pub async fn send(
        &self,
        ctx: Ctx<'_>,
        data: Vec<u8>,
        addr: Option<String>,
        port: Option<u32>,
    ) -> rquickjs::Result<u32> {
        // Build the remote address if provided
        let remote_address = match (addr, port) {
            (Some(a), Some(p)) => {
                let ip = parse_ip_address(&a).ok_or_else(|| {
                    throw_socket_error(&ctx, "EINVAL", "send", &format!("Invalid address: {a}"))
                })?;
                Some(ip_socket_address(ip, p as u16))
            }
            (None, None) => None,
            _ => {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "send",
                    "Both address and port must be provided, or neither",
                ));
            }
        };

        // Auto-bind if not bound
        let needs_bind = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "send",
                    "Socket is closed",
                ));
            }
            !inner.bound
        };

        if needs_bind {
            let family = {
                let inner = self.inner.borrow();
                let socket = inner.socket.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EBADF", "send", "Socket was closed or reset")
                })?;
                socket.address_family()
            };
            let any_addr = match family {
                IpAddressFamily::Ipv4 => "0.0.0.0",
                IpAddressFamily::Ipv6 => "::",
            };
            self.bind(ctx.clone(), any_addr.to_string(), 0).await?;
        }

        // Capture generation for checking after await points
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "send",
                    "Socket was closed or reset",
                ));
            }
            inner.generation
        };

        let datagram = OutgoingDatagram {
            data,
            remote_address,
        };

        // Wait for check_send to indicate we can send
        loop {
            let check_result = {
                let inner = self.inner.borrow();
                let outgoing = inner.outgoing.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EINVAL", "send", "No outgoing stream")
                })?;
                outgoing.check_send().map_err(|e| {
                    throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "send",
                        &format!("check_send failed: {e:?}"),
                    )
                })?
            };

            if check_result > 0 {
                break;
            }

            // Poll outgoing stream
            let pollable = {
                let inner = self.inner.borrow();
                let outgoing = inner.outgoing.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EINVAL", "send", "No outgoing stream")
                })?;
                outgoing.subscribe()
            };
            AsyncPollable::new(pollable).wait_for().await;
            {
                let inner = self.inner.borrow();
                if inner.closed || inner.generation != start_gen {
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "send",
                        "Socket was closed or reset",
                    ));
                }
            }
        }

        // Send the datagram
        let sent = {
            let inner = self.inner.borrow();
            let outgoing = inner
                .outgoing
                .as_ref()
                .ok_or_else(|| throw_socket_error(&ctx, "EINVAL", "send", "No outgoing stream"))?;
            outgoing.send(&[datagram]).map_err(|e| {
                throw_socket_error(
                    &ctx,
                    error_code_to_errno(e),
                    "send",
                    &format!("send failed: {e:?}"),
                )
            })?
        };

        Ok(sent as u32)
    }

    pub async fn receive(
        &self,
        ctx: Ctx<'_>,
    ) -> rquickjs::Result<List<(Vec<u8>, String, u32, u32)>> {
        let start_gen = {
            let inner = self.inner.borrow();
            if inner.closed {
                return Err(throw_socket_error(
                    &ctx,
                    "EBADF",
                    "receive",
                    "Socket is closed",
                ));
            }
            if !inner.bound {
                return Err(throw_socket_error(
                    &ctx,
                    "EINVAL",
                    "receive",
                    "Socket is not bound",
                ));
            }
            inner.generation
        };

        loop {
            // Try to receive
            let result = {
                let inner = self.inner.borrow();
                let incoming = inner.incoming.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EINVAL", "receive", "No incoming stream")
                })?;
                incoming.receive(1).map_err(|e| {
                    throw_socket_error(
                        &ctx,
                        error_code_to_errno(e),
                        "receive",
                        &format!("receive failed: {e:?}"),
                    )
                })?
            };

            if let Some(datagram) = result.into_iter().next() {
                let addr_str = ip_address_to_string(&datagram.remote_address);
                let port = ip_socket_address_port(&datagram.remote_address);
                let family = match &datagram.remote_address {
                    IpSocketAddress::Ipv4(_) => 4u32,
                    IpSocketAddress::Ipv6(_) => 6u32,
                };
                return Ok(List((datagram.data, addr_str, port as u32, family)));
            }

            // No data available, poll and retry
            let pollable = {
                let inner = self.inner.borrow();
                let incoming = inner.incoming.as_ref().ok_or_else(|| {
                    throw_socket_error(&ctx, "EINVAL", "receive", "No incoming stream")
                })?;
                incoming.subscribe()
            };
            AsyncPollable::new(pollable).wait_for().await;
            {
                let inner = self.inner.borrow();
                if inner.closed || inner.generation != start_gen {
                    return Err(throw_socket_error(
                        &ctx,
                        "EBADF",
                        "receive",
                        "Socket was closed or reset",
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

    pub fn set_ttl(&self, ctx: Ctx<'_>, ttl: u32) -> rquickjs::Result<()> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "setTTL",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "setTTL", "Socket was closed or reset")
        })?;
        socket.set_unicast_hop_limit(ttl as u8).map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "setTTL",
                &format!("set_unicast_hop_limit failed: {e:?}"),
            )
        })
    }

    pub fn get_ttl(&self, ctx: Ctx<'_>) -> rquickjs::Result<u32> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "getTTL",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(&ctx, "EBADF", "getTTL", "Socket was closed or reset")
        })?;
        let ttl = socket.unicast_hop_limit().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "getTTL",
                &format!("unicast_hop_limit failed: {e:?}"),
            )
        })?;
        Ok(ttl as u32)
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

    pub fn get_recv_buffer_size(&self, ctx: Ctx<'_>) -> rquickjs::Result<u64> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "getRecvBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "getRecvBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.receive_buffer_size().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "getRecvBufferSize",
                &format!("receive_buffer_size failed: {e:?}"),
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

    pub fn get_send_buffer_size(&self, ctx: Ctx<'_>) -> rquickjs::Result<u64> {
        let inner = self.inner.borrow();
        if inner.closed {
            return Err(throw_socket_error(
                &ctx,
                "EBADF",
                "getSendBufferSize",
                "Socket is closed",
            ));
        }
        let socket = inner.socket.as_ref().ok_or_else(|| {
            throw_socket_error(
                &ctx,
                "EBADF",
                "getSendBufferSize",
                "Socket was closed or reset",
            )
        })?;
        socket.send_buffer_size().map_err(|e| {
            throw_socket_error(
                &ctx,
                error_code_to_errno(e),
                "getSendBufferSize",
                &format!("send_buffer_size failed: {e:?}"),
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
        inner.incoming = None;
        inner.outgoing = None;
        inner.socket.take();
        inner.closed = true;
        inner.generation += 1;
    }
}

pub const DGRAM_JS: &str = include_str!("dgram.js");
pub const REEXPORT_JS: &str =
    r#"export * from 'node:dgram'; export { default } from 'node:dgram';"#;
