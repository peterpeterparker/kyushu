use crate::bindings;
use crate::runtime as worker_runtime;

const WORKER_BUNDLE: &str = include_str!("../../packages/worker/dist/index.mjs");

pub fn initialize() {
    // Load static assets from the filesystem into memory before wizer_initialize()
    // so they are frozen into the Wasm snapshot and available at runtime without IO.
    //
    // Note: Assets are stored in Rust static memory rather than QuickJS heap to avoid
    // the hostcall fuel exhaustion that occurs when transferring large binary data
    // through the WIT interface during pre-initialization.
    worker_runtime::load_assets();
    kyushu_runtime::add_additional_function(Box::new(|ctx| worker_runtime::init_get_asset(ctx)));

    // Register @kyushu-worker and @kyushu/app as builtin modules before wizer_initialize()
    // so they are wired into the QuickJS resolver and loader alongside the polyfill's
    // own modules, making them importable from the worker's fetch handler.
    kyushu_runtime::add_additional_module("@kyushu/worker", Box::new(|| WORKER_BUNDLE.to_string()));

    let bundle = bindings::kyushu::worker::bundle::get_bundle();
    kyushu_runtime::add_additional_module("@kyushu/app", Box::new(move || bundle.clone()));

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
