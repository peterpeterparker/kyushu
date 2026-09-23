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
    kyushu_runtime::internal::run_sync(kyushu_runtime::internal::wizer_initialize());
}
