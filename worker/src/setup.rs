use crate::bindings;
use crate::bindings::kyushu::worker::bundle::{Asset, get_assets};

const TYPES_BUNDLE: &str = include_str!("../../packages/types/dist/index.mjs");

pub fn initialize() {
    // Register @kyushu/types and @kyushu/app as builtin modules before wizer_initialize()
    // so they are wired into the QuickJS resolver and loader alongside the polyfill's
    // own modules, making them importable from the worker's fetch handler.
    kyushu_runtime::add_additional_module("@kyushu/types", Box::new(|| TYPES_BUNDLE.to_string()));

    let bundle = bindings::kyushu::worker::bundle::get_bundle();
    kyushu_runtime::add_additional_module("@kyushu/app", Box::new(move || bundle.clone()));

    // Register @kyushu/assets as a builtin module containing the static assets frozen at build time.
    // Always registered the exports `__kyushu_assets__` set to null if no assets are configured.
    add_assets_module();

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

fn add_assets_module() {
    let assets_module = get_assets()
        .map(|assets| generate_assets_module(&assets))
        .unwrap_or_else(|| "export const __kyushu_assets__ = null;".to_string());

    kyushu_runtime::add_additional_module(
        "@kyushu/assets",
        Box::new(move || assets_module.clone()),
    );
}

fn generate_assets_module(assets: &[Asset]) -> String {
    let entries: String = assets
        .iter()
        .map(|asset| {
            let bytes: String = asset
                .bytes
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<String>>()
                .join(",");

            let mime = match &asset.mime_type {
                Some(m) => format!("\"{}\"", m),
                None => "undefined".to_string(),
            };

            format!(
                "\"{}\": {{ bytes: new Uint8Array([{}]), mimeType: {} }}",
                asset.path, bytes, mime
            )
        })
        .collect::<Vec<_>>()
        .join(",\n");

    format!("export const __kyushu_assets__ = {{ {} }};", entries)
}
