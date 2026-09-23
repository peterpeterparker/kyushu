use rquickjs::{Ctx, Exception};
#[cfg(feature = "p2")]
use wasip2::sockets::network::{
    ErrorCode, IpAddress, IpSocketAddress, Ipv4SocketAddress, Ipv6SocketAddress,
};
#[cfg(feature = "p3")]
use wasip3::sockets::types::{
    ErrorCode, IpAddress, IpSocketAddress, Ipv4SocketAddress, Ipv6SocketAddress,
};

pub fn parse_ip_address(addr: &str) -> Option<IpAddress> {
    use std::net::IpAddr;
    match addr.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let octets = v4.octets();
            Some(IpAddress::Ipv4((
                octets[0], octets[1], octets[2], octets[3],
            )))
        }
        Ok(IpAddr::V6(v6)) => {
            let segs = v6.segments();
            Some(IpAddress::Ipv6((
                segs[0], segs[1], segs[2], segs[3], segs[4], segs[5], segs[6], segs[7],
            )))
        }
        Err(_) => None,
    }
}

pub fn ip_socket_address(ip: IpAddress, port: u16) -> IpSocketAddress {
    match ip {
        IpAddress::Ipv4(addr) => IpSocketAddress::Ipv4(Ipv4SocketAddress {
            port,
            address: addr,
        }),
        IpAddress::Ipv6(addr) => IpSocketAddress::Ipv6(Ipv6SocketAddress {
            port,
            flow_info: 0,
            address: addr,
            scope_id: 0,
        }),
    }
}

pub fn ip_address_to_string(addr: &IpSocketAddress) -> String {
    match addr {
        IpSocketAddress::Ipv4(a) => {
            let (a1, b, c, d) = a.address;
            format!("{a1}.{b}.{c}.{d}")
        }
        IpSocketAddress::Ipv6(a) => {
            let (a1, b, c, d, e, f, g, h) = a.address;
            format!("{a1:x}:{b:x}:{c:x}:{d:x}:{e:x}:{f:x}:{g:x}:{h:x}")
        }
    }
}

pub fn ip_socket_address_port(addr: &IpSocketAddress) -> u16 {
    match addr {
        IpSocketAddress::Ipv4(a) => a.port,
        IpSocketAddress::Ipv6(a) => a.port,
    }
}

pub fn ip_socket_address_family(addr: &IpSocketAddress) -> &str {
    match addr {
        IpSocketAddress::Ipv4(_) => "IPv4",
        IpSocketAddress::Ipv6(_) => "IPv6",
    }
}

#[cfg(feature = "p2")]
pub fn error_code_to_errno(error: ErrorCode) -> &'static str {
    match error {
        ErrorCode::AddressInUse => "EADDRINUSE",
        ErrorCode::AddressNotBindable => "EADDRNOTAVAIL",
        ErrorCode::InvalidArgument => "EINVAL",
        ErrorCode::InvalidState => "EINVAL",
        ErrorCode::AccessDenied => "EACCES",
        ErrorCode::RemoteUnreachable => "EHOSTUNREACH",
        ErrorCode::ConnectionRefused => "ECONNREFUSED",
        ErrorCode::DatagramTooLarge => "EMSGSIZE",
        ErrorCode::NewSocketLimit => "EMFILE",
        ErrorCode::ConnectionReset => "ECONNRESET",
        ErrorCode::ConnectionAborted => "ECONNABORTED",
        ErrorCode::Timeout => "ETIMEDOUT",
        ErrorCode::NotSupported => "ENOSYS",
        ErrorCode::ConcurrencyConflict => "EALREADY",
        ErrorCode::NotInProgress => "EINVAL",
        _ => "EIO",
    }
}

// The Preview 3 `wasi:sockets` `error-code` enum drops several Preview 2 variants
// (`new-socket-limit`, `concurrency-conflict`, `not-in-progress`, `would-block`) because the
// async ABI no longer surfaces them, and adds `connection-broken`. Preview 3 `error-code` is
// also not `Copy`, so this variant borrows the code to leave the caller's value usable for
// diagnostics after the errno mapping.
#[cfg(feature = "p3")]
pub fn error_code_to_errno(error: &ErrorCode) -> &'static str {
    match error {
        ErrorCode::AddressInUse => "EADDRINUSE",
        ErrorCode::AddressNotBindable => "EADDRNOTAVAIL",
        ErrorCode::InvalidArgument => "EINVAL",
        ErrorCode::InvalidState => "EINVAL",
        ErrorCode::AccessDenied => "EACCES",
        ErrorCode::RemoteUnreachable => "EHOSTUNREACH",
        ErrorCode::ConnectionRefused => "ECONNREFUSED",
        ErrorCode::ConnectionBroken => "EPIPE",
        ErrorCode::DatagramTooLarge => "EMSGSIZE",
        ErrorCode::ConnectionReset => "ECONNRESET",
        ErrorCode::ConnectionAborted => "ECONNABORTED",
        ErrorCode::Timeout => "ETIMEDOUT",
        ErrorCode::NotSupported => "ENOSYS",
        ErrorCode::OutOfMemory => "ENOMEM",
        _ => "EIO",
    }
}

pub fn throw_socket_error(
    ctx: &Ctx<'_>,
    code: &str,
    syscall: &str,
    message: &str,
) -> rquickjs::Error {
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    Exception::throw_message(
        ctx,
        &format!("{{\"code\":\"{code}\",\"syscall\":\"{syscall}\",\"message\":\"{escaped}\"}}"),
    )
}
