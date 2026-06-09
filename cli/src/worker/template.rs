/// Pre-built worker Wasm template, compiled from the kyushu-worker crate.
/// `kyu build` embeds the developer's JS bundle into this template via Wizer
/// pre-initialization, producing a self-contained worker.wasm.
#[cfg(not(feature = "local-worker"))]
pub static WORKER_TEMPLATE: &[u8] = include_bytes!("../../resources/kyushu_worker.wasm");

#[cfg(all(feature = "local-worker", not(debug_assertions)))]
pub static WORKER_TEMPLATE: &[u8] =
    include_bytes!("../../../target/wasm32-wasip2/release/kyushu_worker.wasm");

#[cfg(all(feature = "local-worker", debug_assertions))]
pub static WORKER_TEMPLATE: &[u8] =
    include_bytes!("../../../target/wasm32-wasip2/debug/kyushu_worker.wasm");
