#[allow(warnings)]
mod bindings;
mod handler;
mod types;

use bindings::exports::wasi::http::incoming_handler::Guest as HttpGuest;
use bindings::wasi::http::types::{IncomingRequest, ResponseOutparam};

struct Worker;

const TYPES_BUNDLE: &str = include_str!("../../packages/types/dist/index.mjs");

impl bindings::Guest for Worker {
    fn wizer_initialize() {
        // Register @kyushu/types as builtin modules before wizer_initialize()
        // so they are wired into the QuickJS resolver and loader alongside the polyfill's
        // own modules, making them importable from the worker's fetch handler.
        kyushu_runtime::add_additional_module(
            "@kyushu/types",
            Box::new(|| TYPES_BUNDLE.to_string()),
        );

        eprintln!("WHAT?");

        // Register the developer bundle as the export module before wizer_initialize().
        // The bundle is loaded as globalThis.userModule at Wizer time, meaning the module
        // is evaluated once and its state persists across requests. This allows declaring
        // module-level variables (e.g. a response cache) that survive between requests,
        // rather than re-importing the bundle on every request.
        let bundle = bindings::kyushu::worker::bundle::get_bundle();
        kyushu_runtime::set_export_module(Box::new(move || bundle.clone()));

        // Must be called after registering modules and before the first request is served.
        //
        // The polyfill's async runtime (QuickJS + wstd executor) must be fully initialized
        // at Wizer time so that get_js_state() returns a ready state at runtime. Without
        // this, any code that calls get_js_state() lazily — including built-ins like
        // setTimeout — would trigger a nested block_on panic:
        //
        // thread '<unnamed>' (1) panicked at /Users/daviddalbusco/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wstd-0.6.5/src/runtime/block_on.rs:17:9:
        // cannot wstd::runtime::block_on inside an existing block_on!
        // note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
        // Error serving 127.0.0.1:64443: hyper::Error(User(Service), handler did not send a response)
        //
        // By initializing here, INIT_PHASE is snapshotted as WizerPreInitialized and
        // async_exported_function() becomes the single block_on entry point per request.
        kyushu_runtime::internal::wizer_initialize();
    }

    fn get_version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

impl HttpGuest for Worker {
    fn handle(request: IncomingRequest, response_out: ResponseOutparam) {
        handler::handle(request, response_out);
    }
}

bindings::export!(Worker with_types_in bindings);
