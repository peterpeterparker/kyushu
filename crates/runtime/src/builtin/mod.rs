use std::fmt::Write;

mod abort_controller;
mod assert;
mod async_hooks;
mod base64;
mod buffer;
mod child_process;
mod cluster;
mod console;
mod constants;
mod dgram;
mod diagnostics_channel;
mod dns;
mod domain;
mod encoding;
mod formdata_node;
mod fs;
mod gc;

#[cfg(feature = "fetch")]
mod http;

#[cfg(not(feature = "fetch"))]
mod http_disabled;
#[cfg(not(feature = "fetch"))]
mod http {
    pub use super::http_disabled::*;
}

mod events;
mod http2;
mod https;
mod ieee754;
mod inspector;
mod internal;
mod internal_binding_util;
mod intl;
mod module;
mod net;
mod socket_helpers;

#[cfg(feature = "node-http")]
mod node_http;

#[cfg(not(feature = "node-http"))]
mod node_http_disabled;
#[cfg(not(feature = "node-http"))]
mod node_http {
    pub use super::node_http_disabled::*;
}

mod node_test;
mod os;
mod path;
mod perf_hooks;
mod process;
mod punycode;
mod querystring;
mod readline;
mod repl;
mod stream;
mod string_decoder;
mod structured_clone;
mod timeout;
mod timers;
mod tls;
mod trace_events;
mod tty;
mod url;
mod util;
mod v8;
mod vm;
#[cfg(feature = "crypto")]
mod web_crypto;

#[cfg(not(feature = "crypto"))]
mod web_crypto_lite;
#[cfg(not(feature = "crypto"))]
mod web_crypto {
    pub use super::web_crypto_lite::*;
}

#[cfg(feature = "golem")]
mod websocket;
mod webstreams;
mod worker_threads;

#[cfg(feature = "zlib")]
mod zlib;

#[cfg(not(feature = "zlib"))]
mod zlib_disabled;
#[cfg(not(feature = "zlib"))]
mod zlib {
    pub use super::zlib_disabled::*;
}

#[cfg(feature = "sqlite")]
mod sqlite;

#[cfg(not(feature = "sqlite"))]
mod sqlite_disabled;
#[cfg(not(feature = "sqlite"))]
mod sqlite {
    pub use super::sqlite_disabled::*;
}

pub fn add_module_resolvers(
    resolver: rquickjs::loader::BuiltinResolver,
) -> rquickjs::loader::BuiltinResolver {
    let resolver = resolver
        .with_module("__wasm_rquickjs_builtin/abort_controller")
        .with_module("__wasm_rquickjs_builtin/base64_native")
        .with_module("__wasm_rquickjs_builtin/console_native")
        .with_module("__wasm_rquickjs_builtin/console")
        .with_module("__wasm_rquickjs_builtin/timeout_native")
        .with_module("__wasm_rquickjs_builtin/timeout")
        .with_module("__wasm_rquickjs_builtin/gc_native")
        .with_module("__wasm_rquickjs_builtin/http_native")
        .with_module("__wasm_rquickjs_builtin/http")
        .with_module("__wasm_rquickjs_builtin/http_blob")
        .with_module("__wasm_rquickjs_builtin/http_form_data")
        .with_module("__wasm_rquickjs_builtin/streams")
        .with_module("__wasm_rquickjs_builtin/webstreams_wrapper")
        .with_module("__wasm_rquickjs_builtin/encoding_native")
        .with_module("__wasm_rquickjs_builtin/encoding")
        .with_module("__wasm_rquickjs_builtin/intl_native")
        .with_module("__wasm_rquickjs_builtin/intl")
        .with_module("node:util")
        .with_module("util")
        .with_module("__wasm_rquickjs_builtin/fs_native")
        .with_module("node:fs")
        .with_module("fs")
        .with_module("node:fs/promises")
        .with_module("fs/promises")
        .with_module("internal/fs/promises")
        .with_module("node:buffer")
        .with_module("buffer")
        .with_module("base64-js")
        .with_module("ieee754")
        .with_module("__wasm_rquickjs_builtin/os_native")
        .with_module("node:os")
        .with_module("os")
        .with_module("node:assert")
        .with_module("assert")
        .with_module("node:assert/strict")
        .with_module("assert/strict")
        .with_module("node:querystring")
        .with_module("querystring")
        .with_module("node:child_process")
        .with_module("child_process")
        .with_module("node:test")
        .with_module("node:module")
        .with_module("module")
        .with_module("__wasm_rquickjs_builtin/process_native")
        .with_module("node:process")
        .with_module("process")
        .with_module("node:path")
        .with_module("path")
        .with_module("node:path/posix")
        .with_module("path/posix")
        .with_module("node:path/win32")
        .with_module("path/win32")
        .with_module("node:punycode")
        .with_module("punycode")
        .with_module("__wasm_rquickjs_builtin/url_native")
        .with_module("__wasm_rquickjs_builtin/url")
        .with_module("node:url")
        .with_module("url")
        .with_module("node:events")
        .with_module("events")
        .with_module("node:stream")
        .with_module("node:stream/promises")
        .with_module("node:stream/consumers")
        .with_module("node:stream/web")
        .with_module("stream")
        .with_module("stream/promises")
        .with_module("stream/consumers")
        .with_module("stream/web")
        .with_module("web-streams-polyfill")
        .with_module("formdata-node")
        .with_module("__wasm_rquickjs_builtin/string_decoder_native")
        .with_module("node:string_decoder")
        .with_module("string_decoder")
        .with_module("node:timers")
        .with_module("timers")
        .with_module("node:timers/promises")
        .with_module("timers/promises")
        .with_module("__wasm_rquickjs_builtin/web_crypto_native")
        .with_module("__wasm_rquickjs_builtin/web_crypto")
        .with_module("node:crypto")
        .with_module("crypto")
        .with_module("__wasm_rquickjs_builtin/vm_native")
        .with_module("__wasm_rquickjs_builtin/vm")
        .with_module("node:vm")
        .with_module("vm")
        .with_module("__wasm_rquickjs_builtin/structured_clone")
        .with_module("node:async_hooks")
        .with_module("async_hooks")
        .with_module("node:cluster")
        .with_module("cluster")
        .with_module("node:constants")
        .with_module("constants")
        .with_module("__wasm_rquickjs_builtin/dgram_native")
        .with_module("node:dgram")
        .with_module("dgram")
        .with_module("node:diagnostics_channel")
        .with_module("diagnostics_channel")
        .with_module("__wasm_rquickjs_builtin/dns_native")
        .with_module("node:dns")
        .with_module("dns")
        .with_module("node:dns/promises")
        .with_module("dns/promises")
        .with_module("node:domain")
        .with_module("domain")
        .with_module("node:http2")
        .with_module("http2")
        .with_module("node:https")
        .with_module("https")
        .with_module("node:inspector")
        .with_module("inspector")
        .with_module("__wasm_rquickjs_builtin/node_http_native")
        .with_module("__wasm_rquickjs_builtin/node_http_server")
        .with_module("node:_http_common")
        .with_module("_http_common")
        .with_module("node:_http_agent")
        .with_module("_http_agent")
        .with_module("node:http")
        .with_module("http")
        .with_module("__wasm_rquickjs_builtin/net_native")
        .with_module("node:net")
        .with_module("net")
        .with_module("node:perf_hooks")
        .with_module("perf_hooks")
        .with_module("node:readline")
        .with_module("readline")
        .with_module("node:readline/promises")
        .with_module("readline/promises")
        .with_module("node:repl")
        .with_module("repl")
        .with_module("node:console")
        .with_module("console")
        .with_module("node:trace_events")
        .with_module("trace_events")
        .with_module("node:tls")
        .with_module("tls")
        .with_module("node:tty")
        .with_module("tty")
        .with_module("node:v8")
        .with_module("v8")
        .with_module("node:worker_threads")
        .with_module("worker_threads")
        .with_module("__wasm_rquickjs_builtin/zlib_native")
        .with_module("node:zlib")
        .with_module("zlib")
        // SQLite - only node:sqlite, no bare "sqlite" (matches Node.js behavior)
        .with_module("__wasm_rquickjs_builtin/sqlite_native")
        .with_module("node:sqlite");

    #[cfg(feature = "golem")]
    let resolver = resolver
        .with_module("__wasm_rquickjs_builtin/diagnostics_channel_native")
        .with_module("__wasm_rquickjs_builtin/diagnostics_channel_golem")
        .with_module("__wasm_rquickjs_builtin/websocket_native")
        .with_module("__wasm_rquickjs_builtin/websocket");

    internal::add_to_resolver(resolver)
}

pub fn module_loader() -> (
    rquickjs::loader::ModuleLoader,
    rquickjs::loader::BuiltinLoader,
    rquickjs::loader::BuiltinLoader,
) {
    let native_loader = rquickjs::loader::ModuleLoader::default()
        .with_module(
            "__wasm_rquickjs_builtin/base64_native",
            base64::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/console_native",
            console::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/timeout_native",
            timeout::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/gc_native", gc::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/http_native",
            http::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/encoding_native",
            encoding::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/intl_native",
            intl::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/fs_native", fs::js_native_module)
        .with_module("__wasm_rquickjs_builtin/os_native", os::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/process_native",
            process::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/internal/binding/util_native",
            internal_binding_util::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/url_native", url::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/web_crypto_native",
            web_crypto::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/vm_native", vm::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/zlib_native",
            zlib::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/dgram_native",
            dgram::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/dns_native", dns::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/node_http_native",
            node_http::js_native_module,
        )
        .with_module("__wasm_rquickjs_builtin/net_native", net::js_native_module)
        .with_module(
            "__wasm_rquickjs_builtin/sqlite_native",
            sqlite::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/string_decoder_native",
            string_decoder::js_native_module,
        );

    #[cfg(feature = "golem")]
    let native_loader = native_loader
        .with_module(
            "__wasm_rquickjs_builtin/diagnostics_channel_native",
            diagnostics_channel::js_native_module,
        )
        .with_module(
            "__wasm_rquickjs_builtin/websocket_native",
            websocket::js_native_module,
        );

    let builtin_loader = rquickjs::loader::BuiltinLoader::default()
        .with_module(
            "__wasm_rquickjs_builtin/abort_controller",
            abort_controller::ABORT_CONTROLLER_JS,
        )
        .with_module("__wasm_rquickjs_builtin/console", console::CONSOLE_JS)
        .with_module("__wasm_rquickjs_builtin/timeout", timeout::TIMEOUT_JS)
        .with_module("__wasm_rquickjs_builtin/http_blob", http::FETCH_BLOB_JS)
        .with_module("__wasm_rquickjs_builtin/http_form_data", http::FORMDATA_JS)
        .with_module("__wasm_rquickjs_builtin/http", http::HTTP_JS)
        .with_module("__wasm_rquickjs_builtin/streams", webstreams::WEBSTREAMS_JS)
        .with_module(
            "__wasm_rquickjs_builtin/webstreams_wrapper",
            webstreams::WEBSTREAMS_WRAPPER_JS,
        )
        .with_module("node:stream/web", webstreams::REEXPORT_JS)
        .with_module("stream/web", webstreams::REEXPORT_JS)
        .with_module("web-streams-polyfill", webstreams::REEXPORT_JS)
        .with_module("formdata-node", formdata_node::FORMDATA_NODE_JS)
        .with_module("__wasm_rquickjs_builtin/encoding", encoding::ENCODING_JS)
        .with_module("__wasm_rquickjs_builtin/intl", intl::INTL_JS)
        .with_module("node:util", util::UTIL_JS)
        .with_module("util", util::REEXPORT_JS)
        .with_module("base64-js", base64::BASE64_JS)
        .with_module("ieee754", ieee754::IEEE754_JS)
        .with_module("node:buffer", buffer::BUFFER_JS)
        .with_module("buffer", buffer::REEXPORT_JS)
        .with_module("node:fs", fs::FS_JS)
        .with_module("fs", fs::REEXPORT_JS)
        .with_module("node:fs/promises", fs::FS_PROMISES_JS)
        .with_module("fs/promises", fs::REEXPORT_PROMISES_JS)
        .with_module("internal/fs/promises", fs::REEXPORT_PROMISES_JS)
        .with_module("node:os", os::OS_JS)
        .with_module("os", os::REEXPORT_JS)
        .with_module("node:assert", assert::ASSERT_JS)
        .with_module("assert", assert::REEXPORT_JS)
        .with_module("node:assert/strict", assert::ASSERT_STRICT_JS)
        .with_module("assert/strict", assert::REEXPORT_STRICT_JS)
        .with_module("node:querystring", querystring::QUERYSTRING_JS)
        .with_module("querystring", querystring::REEXPORT_JS)
        .with_module("node:child_process", child_process::CHILD_PROCESS_JS)
        .with_module("child_process", child_process::REEXPORT_JS)
        .with_module("node:test", node_test::TEST_JS)
        .with_module("node:module", module::MODULE_JS)
        .with_module("module", module::REEXPORT_JS)
        .with_module("node:process", process::PROCESS_JS)
        .with_module("process", process::REEXPORT_JS)
        .with_module("node:path", path::PATH_JS)
        .with_module("path", path::REEXPORT_JS)
        .with_module("node:path/posix", path::PATH_POSIX_REEXPORT_JS)
        .with_module("path/posix", path::PATH_POSIX_REEXPORT_JS)
        .with_module("node:path/win32", path::PATH_WIN32_REEXPORT_JS)
        .with_module("path/win32", path::PATH_WIN32_REEXPORT_JS)
        .with_module("node:punycode", punycode::PUNYCODE_JS)
        .with_module("punycode", punycode::REEXPORT_JS)
        .with_module("__wasm_rquickjs_builtin/url", url::URL_JS)
        .with_module("node:url", url::URL_JS)
        .with_module("url", url::REEXPORT_JS)
        .with_module("node:events", events::EVENTS_JS)
        .with_module("events", events::REEXPORT_JS)
        .with_module("node:stream", stream::STREAM_JS)
        .with_module("stream", stream::REEXPORT_JS)
        .with_module("node:stream/promises", stream::STREAM_PROMISES_JS)
        .with_module("stream/promises", stream::REEXPORT_PROMISES_JS)
        .with_module("node:stream/consumers", stream::STREAM_CONSUMERS_JS)
        .with_module("stream/consumers", stream::REEXPORT_CONSUMERS_JS)
        .with_module("node:string_decoder", string_decoder::STRING_DECODER_JS)
        .with_module("string_decoder", string_decoder::REEXPORT_JS)
        .with_module("node:timers", timers::TIMERS_JS)
        .with_module("timers", timers::REEXPORT_JS)
        .with_module("node:timers/promises", timers::TIMERS_PROMISES_JS)
        .with_module("timers/promises", timers::REEXPORT_PROMISES_JS)
        .with_module(
            "__wasm_rquickjs_builtin/web_crypto",
            web_crypto::WEB_CRYPTO_JS,
        )
        .with_module("node:crypto", web_crypto::REEXPORT_JS)
        .with_module("crypto", web_crypto::REEXPORT_JS)
        .with_module("__wasm_rquickjs_builtin/vm", vm::VM_JS)
        .with_module("node:vm", vm::REEXPORT_JS)
        .with_module("vm", vm::REEXPORT_JS)
        .with_module(
            "__wasm_rquickjs_builtin/structured_clone",
            structured_clone::STRUCTURED_CLONE_JS,
        )
        .with_module("node:async_hooks", async_hooks::ASYNC_HOOKS_JS)
        .with_module("async_hooks", async_hooks::REEXPORT_JS)
        .with_module("node:cluster", cluster::CLUSTER_JS)
        .with_module("cluster", cluster::REEXPORT_JS)
        .with_module("node:constants", constants::CONSTANTS_JS)
        .with_module("constants", constants::REEXPORT_JS)
        .with_module("node:dgram", dgram::DGRAM_JS)
        .with_module("dgram", dgram::REEXPORT_JS)
        .with_module(
            "node:diagnostics_channel",
            diagnostics_channel::DIAGNOSTICS_CHANNEL_JS,
        )
        .with_module("diagnostics_channel", diagnostics_channel::REEXPORT_JS)
        .with_module("node:dns", dns::DNS_JS)
        .with_module("dns", dns::REEXPORT_JS)
        .with_module("node:dns/promises", dns::DNS_PROMISES_JS)
        .with_module("dns/promises", dns::REEXPORT_PROMISES_JS)
        .with_module("node:domain", domain::DOMAIN_JS)
        .with_module("domain", domain::REEXPORT_JS)
        .with_module(
            "__wasm_rquickjs_builtin/node_http_server",
            node_http::NODE_HTTP_SERVER_JS,
        )
        .with_module("node:_http_common", node_http::HTTP_COMMON_JS)
        .with_module("_http_common", node_http::HTTP_COMMON_JS)
        .with_module("node:_http_agent", node_http::HTTP_AGENT_JS)
        .with_module("_http_agent", node_http::HTTP_AGENT_JS)
        .with_module("node:http", node_http::NODE_HTTP_JS)
        .with_module("http", node_http::REEXPORT_JS)
        .with_module("node:http2", http2::HTTP2_JS)
        .with_module("http2", http2::REEXPORT_JS)
        .with_module("node:https", https::HTTPS_JS)
        .with_module("https", https::REEXPORT_JS)
        .with_module("node:inspector", inspector::INSPECTOR_JS)
        .with_module("inspector", inspector::REEXPORT_JS)
        .with_module("node:net", net::NET_JS)
        .with_module("net", net::REEXPORT_JS)
        .with_module("node:perf_hooks", perf_hooks::PERF_HOOKS_JS)
        .with_module("perf_hooks", perf_hooks::REEXPORT_JS)
        .with_module("node:readline", readline::READLINE_JS)
        .with_module("readline", readline::REEXPORT_JS)
        .with_module("node:readline/promises", readline::READLINE_PROMISES_JS)
        .with_module("readline/promises", readline::REEXPORT_PROMISES_JS)
        .with_module("node:repl", repl::REPL_JS)
        .with_module("repl", repl::REEXPORT_JS)
        .with_module("node:console", console::CONSOLE_JS)
        .with_module("console", console::REEXPORT_JS)
        .with_module("node:trace_events", trace_events::TRACE_EVENTS_JS)
        .with_module("trace_events", trace_events::REEXPORT_JS)
        .with_module("node:tls", tls::TLS_JS)
        .with_module("tls", tls::REEXPORT_JS)
        .with_module("node:tty", tty::TTY_JS)
        .with_module("tty", tty::REEXPORT_JS)
        .with_module("node:v8", v8::V8_JS)
        .with_module("v8", v8::REEXPORT_JS)
        .with_module("node:worker_threads", worker_threads::WORKER_THREADS_JS)
        .with_module("worker_threads", worker_threads::REEXPORT_JS)
        .with_module("node:zlib", zlib::ZLIB_JS)
        .with_module("zlib", zlib::REEXPORT_JS)
        .with_module("node:sqlite", sqlite::SQLITE_JS);

    #[cfg(feature = "golem")]
    let builtin_loader = builtin_loader
        .with_module(
            "__wasm_rquickjs_builtin/diagnostics_channel_golem",
            diagnostics_channel::DIAGNOSTICS_CHANNEL_GOLEM_JS,
        )
        .with_module("__wasm_rquickjs_builtin/websocket", websocket::WEBSOCKET_JS);

    (native_loader, builtin_loader, internal::module_loader())
}

pub fn wire_builtins() -> String {
    let mut result = String::new();
    writeln!(result, "{}", events::WIRE_JS).unwrap();
    writeln!(result, "{}", abort_controller::WIRE_JS).unwrap();
    writeln!(result, "{}", base64::WIRE_JS).unwrap();
    writeln!(result, "{}", buffer::WIRE_JS).unwrap();
    writeln!(result, "{}", console::WIRE_JS).unwrap();
    writeln!(result, "{}", timeout::WIRE_JS).unwrap();
    writeln!(result, "{}", gc::WIRE_JS).unwrap();
    writeln!(result, "{}", http::WIRE_JS).unwrap();
    writeln!(result, "{}", webstreams::WIRE_JS).unwrap();
    writeln!(result, "{}", encoding::WIRE_JS).unwrap();
    writeln!(result, "{}", intl::WIRE_JS).unwrap();
    writeln!(result, "{}", url::WIRE_JS).unwrap();
    writeln!(result, "{}", web_crypto::WIRE_JS).unwrap();
    writeln!(result, "{}", process::WIRE_JS).unwrap();
    writeln!(result, "{}", structured_clone::WIRE_JS).unwrap();
    writeln!(result, "{}", module::WIRE_JS).unwrap();
    writeln!(result, "{}", worker_threads::WIRE_JS).unwrap();
    writeln!(result, "globalThis.global = globalThis;").unwrap();
    writeln!(result, "globalThis.self = globalThis;").unwrap();
    writeln!(result, "{}", IMPORT_META_RESOLVE_JS).unwrap();
    writeln!(result, "{}", IMPORT_ATTRS_VALIDATE_JS).unwrap();

    #[cfg(feature = "golem")]
    writeln!(result, "{}", diagnostics_channel::GOLEM_WIRE_JS).unwrap();

    #[cfg(feature = "golem")]
    writeln!(result, "{}", websocket::WIRE_JS).unwrap();

    result
}

const IMPORT_META_RESOLVE_JS: &str = r#"globalThis.__wasm_rquickjs_import_meta_resolve = function(baseUrl, specifier) {
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(specifier) || specifier.startsWith('data:')) return specifier;
  if (specifier.startsWith('node:')) return specifier;
  var NODE_BUILTINS = new Set(['fs','path','os','crypto','http','https','url','util','stream','events','buffer','querystring','string_decoder','zlib','assert','module','net','tls','child_process','timers','dns','dgram','cluster','constants','readline','tty','v8','vm','worker_threads','perf_hooks','async_hooks','diagnostics_channel','trace_events','inspector','punycode','console','process','test','sqlite','domain','http2','repl']);
  function normalizePath(p) {
    var parts = p.split('/'); var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.') continue;
      if (parts[i] === '..') { if (out.length > 0) out.pop(); }
      else out.push(parts[i]);
    }
    return '/' + out.join('/');
  }
  if (specifier.startsWith('/')) {
    var path = normalizePath(specifier);
    return baseUrl.startsWith('file://') ? 'file://' + path : path;
  }
  if (specifier.startsWith('.')) {
    var base = baseUrl;
    if (base.startsWith('file://')) base = base.slice(7);
    var dir = base.substring(0, base.lastIndexOf('/') + 1);
    var path = normalizePath(dir + specifier);
    return baseUrl.startsWith('file://') ? 'file://' + path : path;
  }
  if (NODE_BUILTINS.has(specifier)) return 'node:' + specifier;
  throw new Error('Cannot resolve bare specifier "' + specifier + '" from "' + baseUrl + '"');
};"#;

const IMPORT_ATTRS_VALIDATE_JS: &str = r#"
globalThis.__wasm_rquickjs_validate_import_attrs = function(specifier, options) {
  var attrs = null;
  if (options != null && typeof options === 'object') {
    var w = options['with'];
    if (w != null && typeof w === 'object') {
      attrs = w;
    }
  }

  var format = null;
  if (typeof specifier === 'string') {
    if (specifier.startsWith('data:')) {
      var rest = specifier.substring(5);
      var ci = rest.indexOf(',');
      if (ci >= 0) {
        var meta = rest.substring(0, ci).split(';')[0].trim();
        if (meta === 'application/json') format = 'json';
        else if (meta === 'text/javascript' || meta === 'application/javascript') format = 'module';
        else if (meta === 'text/css') format = 'css';
      }
    } else if (specifier.endsWith('.json')) {
      format = 'json';
    } else if (specifier.endsWith('.js') || specifier.endsWith('.mjs') || specifier.endsWith('.cjs')) {
      format = 'module';
    }
  }

  if (attrs) {
    var typeValue;
    var keys = Object.keys(attrs);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] === 'type') typeValue = attrs.type;
    }
    if (typeValue !== undefined) {
      if (typeValue === 'json') {
        if (format === 'module') {
          return Promise.reject(Object.assign(
            new TypeError('Cannot use import attributes to change the type of a JavaScript module'),
            { code: 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE' }
          ));
        }
      } else if (typeValue !== 'css') {
        return Promise.reject(Object.assign(
          new TypeError('Import attribute type "' + typeValue + '" is not supported'),
          { code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' }
        ));
      }
    }
  }

  if (format === 'json') {
    if (!attrs || attrs.type !== 'json') {
      return Promise.reject(Object.assign(
        new TypeError('Module "' + specifier + '" needs an import attribute of "type: json"'),
        { code: 'ERR_IMPORT_ATTRIBUTE_MISSING' }
      ));
    }
  }

  if (attrs) {
    var keys2 = Object.keys(attrs);
    for (var j = 0; j < keys2.length; j++) {
      if (keys2[j] !== 'type') {
        return Promise.reject(Object.assign(
          new TypeError('Import attribute "' + keys2[j] + '" is not supported'),
          { code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' }
        ));
      }
    }
  }

  return false;
};
"#;
