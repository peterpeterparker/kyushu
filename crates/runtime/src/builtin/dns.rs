use rquickjs::{Ctx, Exception};

#[cfg(feature = "p2")]
use wasip2::sockets::instance_network::instance_network;
#[cfg(feature = "p2")]
use wasip2::sockets::ip_name_lookup::{ResolveAddressStream, resolve_addresses};
#[cfg(feature = "p2")]
use wasip2::sockets::network::{ErrorCode, IpAddress};
#[cfg(feature = "p2")]
use wstd::runtime::AsyncPollable;

#[cfg(feature = "p3")]
use wasip3::sockets::ip_name_lookup::{ErrorCode, resolve_addresses};
#[cfg(feature = "p3")]
use wasip3::sockets::types::IpAddress;

#[rquickjs::module]
pub mod native_module {
    pub use super::DnsResult;

    /// Resolve a hostname to a list of IP addresses.
    /// Returns a list of DnsResult objects with `address` (string) and `family` (4 or 6).
    #[rquickjs::function]
    pub async fn resolve(
        ctx: rquickjs::Ctx<'_>,
        hostname: String,
    ) -> rquickjs::Result<Vec<DnsResult>> {
        super::resolve_impl(&ctx, &hostname).await
    }
}

#[derive(rquickjs::class::Trace, rquickjs::JsLifetime)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct DnsResult {
    address: String,
    family: u32,
}

#[rquickjs::methods]
impl DnsResult {
    #[qjs(constructor)]
    pub fn new(address: String, family: u32) -> Self {
        Self { address, family }
    }

    #[qjs(get)]
    pub fn address(&self) -> &str {
        &self.address
    }

    #[qjs(get)]
    pub fn family(&self) -> u32 {
        self.family
    }
}

fn ip_address_to_string(addr: &IpAddress) -> String {
    match addr {
        IpAddress::Ipv4((a, b, c, d)) => format!("{a}.{b}.{c}.{d}"),
        IpAddress::Ipv6((a, b, c, d, e, f, g, h)) => {
            format!("{a:x}:{b:x}:{c:x}:{d:x}:{e:x}:{f:x}:{g:x}:{h:x}")
        }
    }
}

fn ip_address_family(addr: &IpAddress) -> u32 {
    match addr {
        IpAddress::Ipv4(_) => 4,
        IpAddress::Ipv6(_) => 6,
    }
}

#[cfg(feature = "p2")]
fn error_code_to_js(error: ErrorCode) -> &'static str {
    match error {
        ErrorCode::NameUnresolvable => "ENOTFOUND",
        ErrorCode::TemporaryResolverFailure => "ESERVFAIL",
        ErrorCode::PermanentResolverFailure => "ESERVFAIL",
        ErrorCode::AccessDenied => "EREFUSED",
        ErrorCode::InvalidArgument => "EBADNAME",
        ErrorCode::Timeout => "ETIMEOUT",
        ErrorCode::OutOfMemory => "ENOMEM",
        ErrorCode::NotSupported => "ENOTIMP",
        _ => "ESERVFAIL",
    }
}

// The Preview 3 `wasi:sockets/ip-name-lookup` `error-code` enum only carries the five variants
// below; the async ABI no longer surfaces `timeout`, `out-of-memory` or `not-supported`.
#[cfg(feature = "p3")]
fn error_code_to_js(error: ErrorCode) -> &'static str {
    match error {
        ErrorCode::NameUnresolvable => "ENOTFOUND",
        ErrorCode::TemporaryResolverFailure => "ESERVFAIL",
        ErrorCode::PermanentResolverFailure => "ESERVFAIL",
        ErrorCode::AccessDenied => "EREFUSED",
        ErrorCode::InvalidArgument => "EBADNAME",
        _ => "ESERVFAIL",
    }
}

#[cfg(feature = "p2")]
fn poll_resolve_stream(stream: &ResolveAddressStream) -> Result<Vec<IpAddress>, ErrorCode> {
    let mut addresses = Vec::new();
    loop {
        match stream.resolve_next_address() {
            Ok(Some(addr)) => addresses.push(addr),
            Ok(None) => return Ok(addresses),
            Err(ErrorCode::WouldBlock) => {
                // Not ready yet, need to poll
                return Err(ErrorCode::WouldBlock);
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(feature = "p2")]
async fn resolve_impl(ctx: &Ctx<'_>, hostname: &str) -> rquickjs::Result<Vec<DnsResult>> {
    let network = instance_network();
    let stream = resolve_addresses(&network, hostname).map_err(|e| {
        let code = error_code_to_js(e);
        Exception::throw_message(
            ctx,
            &format!("{{\"code\":\"{code}\",\"hostname\":\"{hostname}\"}}"),
        )
    })?;

    loop {
        match poll_resolve_stream(&stream) {
            Ok(addresses) => {
                return Ok(addresses
                    .iter()
                    .map(|addr| DnsResult {
                        address: ip_address_to_string(addr),
                        family: ip_address_family(addr),
                    })
                    .collect());
            }
            Err(ErrorCode::WouldBlock) => {
                let pollable = stream.subscribe();
                AsyncPollable::new(pollable).wait_for().await;
            }
            Err(e) => {
                let code = error_code_to_js(e);
                return Err(Exception::throw_message(
                    ctx,
                    &format!("{{\"code\":\"{code}\",\"hostname\":\"{hostname}\"}}"),
                ));
            }
        }
    }
}

// On Preview 3 `resolve-addresses` is a single async call returning the full address list, so no
// stream polling is required.
#[cfg(feature = "p3")]
async fn resolve_impl(ctx: &Ctx<'_>, hostname: &str) -> rquickjs::Result<Vec<DnsResult>> {
    match resolve_addresses(hostname.to_string()).await {
        Ok(addresses) => Ok(addresses
            .iter()
            .map(|addr| DnsResult {
                address: ip_address_to_string(addr),
                family: ip_address_family(addr),
            })
            .collect()),
        Err(e) => {
            let code = error_code_to_js(e);
            Err(Exception::throw_message(
                ctx,
                &format!("{{\"code\":\"{code}\",\"hostname\":\"{hostname}\"}}"),
            ))
        }
    }
}

pub const DNS_JS: &str = include_str!("dns.js");
pub const DNS_PROMISES_JS: &str = include_str!("dns_promises.js");

pub const REEXPORT_JS: &str = r#"export * from 'node:dns'; export { default } from 'node:dns';"#;
pub const REEXPORT_PROMISES_JS: &str =
    r#"export * from 'node:dns/promises'; export { default } from 'node:dns/promises';"#;
