use anyhow::Result;
use wasmtime::Store;
use wasmtime_wizer::Wizer;

use crate::config::BuildConfig;
use crate::javascript::bundle;
use crate::worker::context::WorkerContext;
use crate::worker::linker::WorkerLinker;
use crate::worker::version::WorkerVersion;

/// Pre-built worker Wasm template, compiled from the kyushu-worker crate.
/// `kyu build` embeds the developer's JS bundle into this template via Wizer
/// pre-initialization, producing a self-contained worker.wasm.
#[cfg(not(feature = "local-worker"))]
static WORKER_TEMPLATE: &[u8] = include_bytes!("../resources/kyushu_worker.wasm");

#[cfg(all(feature = "local-worker", not(debug_assertions)))]
static WORKER_TEMPLATE: &[u8] =
    include_bytes!("../../target/wasm32-wasip2/release/kyushu_worker.wasm");

#[cfg(all(feature = "local-worker", debug_assertions))]
static WORKER_TEMPLATE: &[u8] =
    include_bytes!("../../target/wasm32-wasip2/debug/kyushu_worker.wasm");

pub async fn build(config: &BuildConfig) -> Result<()> {
    WorkerVersion::new()
        .with_bytes(WORKER_TEMPLATE)
        .print()
        .await?;

    bundle_js(config).await?;

    Ok(())
}

async fn bundle_js(config: &BuildConfig) -> Result<()> {
    let entry = &config.entry;
    let outdir = &config.outdir;
    let worker_wasm = format!("{}/__kyushu_worker.wasm", outdir);

    std::fs::create_dir_all(outdir)?;

    // Bundle the developer's JS/TS entry point into a single ESM file
    // using Rolldown. The output is captured in memory.
    println!("Bundling {}...", entry);

    let bundle_str = bundle(entry).await?;

    // Step 2: pre-initialize the worker Wasm template with the JS bundle using Wizer.
    //
    // Wizer instantiates the worker, calls `wizer-initialize` which reads the bundle
    // via a custom host import (`kyushu:worker/bundle#get-bundle`), stores it in a
    // static OnceLock, then snapshots the Wasm memory state.
    //
    // We use a custom host import instead of WASI filesystem or env vars to avoid
    // polluting the Wizer snapshot with build-time WASI state (preopened dirs, env vars)
    // which would override the runtime state provided by `kyu run`.
    println!("Pre-initializing worker Wasm...");

    let (engine, linker) = WorkerLinker::new()?
        .with_logging()?
        .with_http()?
        .with_bundle(bundle_str)?
        .build();

    // Empty WASI context — no preopened dirs or env vars to snapshot.
    let mut store = Store::new(&engine, WorkerContext::new().build());

    let initialized = Wizer::new()
        .keep_init_func(true)
        .init_func("wizer-initialize")
        .run_component(
            &mut store,
            WORKER_TEMPLATE,
            async move |store, component| linker.instantiate_async(store, component).await,
        )
        .await?;

    std::fs::write(&worker_wasm, &initialized)?;

    println!("Worker Wasm written to {}", worker_wasm);

    Ok(())
}
