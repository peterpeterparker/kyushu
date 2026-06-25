use crate::assets::load_assets;
use crate::config::{AssetsConfig, InputConfig, OutputConfig};
use crate::javascript::bundle;
use crate::worker::{WORKER_TEMPLATE, WorkerAssets, WorkerContext, WorkerLinker, WorkerVersion};
use anyhow::Result;
use wasmtime::Store;
use wasmtime_wizer::Wizer;

pub async fn build(
    input_config: &InputConfig,
    output_config: &OutputConfig,
    assets_config: Option<&AssetsConfig>,
) -> Result<()> {
    WorkerVersion::new()
        .with_bytes(WORKER_TEMPLATE)
        .print()
        .await?;

    bundle_js(input_config, output_config, assets_config).await?;

    Ok(())
}

async fn bundle_js(
    input_config: &InputConfig,
    output_config: &OutputConfig,
    assets_config: Option<&AssetsConfig>,
) -> Result<()> {
    let src = input_config.src();
    let outdir = output_config.dir();
    let worker_wasm = output_config.worker_wasm();

    std::fs::create_dir_all(outdir)?;

    // Bundle the developer's JS/TS src point into a single ESM file
    // using Rolldown. The output is captured in memory.
    println!("Bundling {}...", src);

    let bundle_str = bundle(src).await?;

    // Load the static assets if a related source directory is provided.
    let _assets = assets_config
        .map(|config| {
            println!("Loading assets from {}...", config.dir());
            load_assets(config.dir()).map(WorkerAssets::from)
        })
        .transpose()?;

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
