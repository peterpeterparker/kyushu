use futures_concurrency::future::Join;
use rquickjs::function::{Args, Constructor};
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, Ctx, Error, Filter, FromJs, Function, Module,
    Object, Persistent, Promise, String as JsString, Value, async_with,
};
use rquickjs::{CaughtError, prelude::*};
use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::AtomicUsize;
use wstd::runtime::block_on;

use super::runtime_services::{
    OwnedJsRuntime, RuntimeServices, initialize_builtin_wiring, run_process_turn_checkpoint,
};

pub const RESOURCE_TABLE_NAME: &str = "__wasm_rquickjs_resources";
pub const RESOURCE_ID_KEY: &str = "__wasm_rquickjs_resource_id";
pub const DISPOSE_SYMBOL: &str = "__wasm_rquickjs_symbol_dispose";

pub struct JsState {
    pub rt: AsyncRuntime,
    pub ctx: AsyncContext,
    pub exported_function_cache: RefCell<HashMap<&'static [&'static str], CachedExportedFunction>>,
    pub variant_case_tag_cache: RefCell<HashMap<&'static str, Persistent<JsString<'static>>>>,
    pub last_resource_id: AtomicUsize,
    pub resource_drop_queue_tx: futures::channel::mpsc::UnboundedSender<usize>,
    pub resource_drop_queue_rx: RefCell<Option<futures::channel::mpsc::UnboundedReceiver<usize>>>,
    pub gc_pending: std::sync::atomic::AtomicBool,
}

pub struct CachedExportedFunction {
    function: Persistent<Function<'static>>,
    parent: Persistent<Object<'static>>,
    parameter_count: usize,
}

/// Tracks which initialization phase the runtime is in.
/// Used to support Wizer pre-initialization and guard against re-entrant
/// `get_js_state()` calls during module evaluation (e.g. from `setTimeout`
/// callbacks that fire during init).
#[repr(u8)]
#[derive(Clone, Copy)]
enum InitPhase {
    /// No initialization has been performed yet.
    Uninitialized = 0,
    /// `STATE` is published but JS evaluation is still in progress.
    /// Re-entrant `get_js_state()` calls return the existing state without
    /// re-running initialization.
    Initializing = 1,
    /// Fully initialized including user module evaluation.
    FullyInitialized = 2,
    /// Wizer pre-initialized: JS state is snapshotted but runtime env (argv, env vars)
    /// needs to be refreshed from the actual host environment on first access.
    WizerPreInitialized = 3,
}

impl JsState {
    /// Phase 1: Create the runtime, context, resolvers, loaders, and all Rust-side
    /// state. Does NOT evaluate any JavaScript — safe to publish to `STATE` before
    /// JS module initialization runs.
    async fn new_base() -> Self {
        let OwnedJsRuntime { rt, ctx } = OwnedJsRuntime::new().await;

        async_with!(ctx => |ctx| {
            let global = ctx.globals();

            global.set(RESOURCE_TABLE_NAME, Object::new(ctx.clone()))
                .expect("Failed to initialize resource table");
        })
        .await;

        let (resource_drop_queue_tx, resource_drop_queue_rx) = futures::channel::mpsc::unbounded();

        let last_resource_id = AtomicUsize::new(1);
        Self {
            rt,
            ctx,
            exported_function_cache: RefCell::new(HashMap::new()),
            variant_case_tag_cache: RefCell::new(HashMap::new()),
            last_resource_id,
            resource_drop_queue_tx,
            resource_drop_queue_rx: RefCell::new(Some(resource_drop_queue_rx)),
            gc_pending: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Phase 2a: Initialize engine builtins — dispose symbols and builtin wiring.
    /// This can be pre-initialized by Wizer without user module code.
    async fn init_engine(&self) {
        // In latest version of rquickjs Symbol.dispose are supported
        // initialize_dispose_symbols(&self.ctx)
        //     .await
        //     .unwrap_or_else(|error| panic!("{error}"));
        // self.rt.idle().await;

        initialize_builtin_wiring(&self.ctx)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        drain_and_idle(self).await;
    }

    /// Phase 2b: Import and evaluate the user module.
    /// Must be called after init_engine().
    async fn init_user_module(&self) {
        async_with!(self.ctx => |ctx| {
            // Import the user module (now globalThis.require is available)
            Module::evaluate(
                ctx.clone(),
                "__wasm_rquickjs_init_entry",
                format!(r#"
                import * as userModule from '{}';
                globalThis.userModule = userModule;
                "#, crate::JS_EXPORT_MODULE_NAME),
            )
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to evaluate module initialization:\n{}", format_caught_error(e)))
            .finish::<()>()
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to finish module initialization:\n{}", format_caught_error(e)));

            for (name, _) in crate::JS_ADDITIONAL_MODULES.iter() {
              Module::import(&ctx, name.to_string())
                 .catch(&ctx)
                 .unwrap_or_else(|e| panic!("Failed to import user module {name}:\n{}", format_caught_error(e)))
                 .finish::<()>()
                 .catch(&ctx)
                 .unwrap_or_else(|e| panic!("Failed to finish importing user module {name}:\n{}", format_caught_error(e)));
            }

            for f in crate::JS_ADDITIONAL_FUNCTIONS.iter() {
                f(&ctx).expect("Failed to run init function");
            }
        })
            .await;
        drain_and_idle(self).await;
    }

    /// Phase 2: Evaluate all JavaScript — dispose symbols, builtin wiring, user
    /// module import. Must be called after `STATE` is published so that any
    /// re-entrant `get_js_state()` calls (e.g. from `setTimeout` during module
    /// init) find the already-published state instead of recursing.
    async fn finish_init(&self) {
        self.init_engine().await;
        self.init_user_module().await;
    }

    /// Refresh `process.argv` and `process.env` from the actual WASI host
    /// environment. Called after a Wizer snapshot is restored so that
    /// snapshotted (empty) values are replaced with the real runtime values.
    /// Mutates objects in-place so ESM bindings remain valid.
    async fn refresh_process_env(state: &JsState) {
        let argv = wasip2::cli::environment::get_arguments();
        let env_vars: std::collections::HashMap<String, String> =
            wasip2::cli::environment::get_environment()
                .into_iter()
                .collect();

        async_with!(state.ctx => |ctx| {
            let globals = ctx.globals();
            if let Ok(process) = globals.get::<_, rquickjs::Object>("process") {
                // Refresh argv in-place so existing references stay valid
                if let Ok(existing_argv) = process.get::<_, rquickjs::Array>("argv") {
                    let _ = existing_argv.as_object().set("length", 0u32);
                    for (i, arg) in argv.iter().enumerate() {
                        let _ = existing_argv.set(i, arg.as_str());
                    }
                }
                let _ = process.set(
                    "argv0",
                    argv.first().map(|s| s.as_str()).unwrap_or(""),
                );

                // Refresh env via JS eval to trigger Proxy traps
                if let Ok(new_env) = rquickjs::Object::new(ctx.clone()) {
                    for (key, value) in &env_vars {
                        let _ = new_env.set(key.as_str(), value.as_str());
                    }
                    let _ = globals.set("__wasm_rquickjs_new_env", new_env);
                    let _ = ctx.eval::<(), &str>(
                        "(() => { \
                            const e = globalThis.__wasm_rquickjs_new_env; \
                            for (const k of Object.keys(process.env)) delete process.env[k]; \
                            for (const [k,v] of Object.entries(e)) process.env[k] = v; \
                            delete globalThis.__wasm_rquickjs_new_env; \
                        })()",
                    );
                }
            }
        })
        .await;
    }
}

/// Runs GC if it was requested from JS (deferred to avoid re-entrancy issues).
async fn run_pending_gc(js_state: &JsState) {
    if js_state
        .gc_pending
        .swap(false, std::sync::atomic::Ordering::Relaxed)
    {
        async_with!(js_state.ctx => |ctx| {
            ctx.run_gc();
        })
        .await;
    }
}

async fn run_turn_checkpoint(js_state: &JsState) -> bool {
    async_with!(js_state.ctx => |ctx| {
        run_process_turn_checkpoint(&ctx).unwrap_or_else(|error| {
            panic!("failed to run process turn checkpoint: {error}")
        })
    })
    .await
}

/// Spawns a sentinel task that waits for all ref'd timers to complete,
/// then aborts remaining unref'd timers so that `idle()` can return.
async fn drain_and_idle(js_state: &JsState) {
    run_pending_gc(js_state).await;
    let mut drove_runtime = false;
    loop {
        let checkpoint_did_work = run_turn_checkpoint(js_state).await;
        if drove_runtime && !checkpoint_did_work {
            return;
        }
        drove_runtime = true;

        let has_unrefed_timers = async_with!(js_state.ctx => |ctx| {
            !ctx.userdata::<RuntimeServices>()
                .expect("runtime services not initialized")
                .timers
                .unrefed_timers
                .borrow()
                .is_empty()
        })
        .await;
        if has_unrefed_timers {
            // Spawn a sentinel that polls until only unref'd timers remain, then aborts them.
            async_with!(js_state.ctx => |ctx| {
                let task_ctx = ctx.clone();
                ctx.spawn(async move {
                    loop {
                        wstd::task::sleep(wstd::time::Duration::from_millis(1)).await;
                        let services = task_ctx
                            .userdata::<RuntimeServices>()
                            .expect("runtime services not initialized");
                        let abort_count = services.timers.abort_handles.borrow().len();
                        let unref_count = services.timers.unrefed_timers.borrow().len();
                        // When the only remaining abort handles are for unref'd timers,
                        // abort them all (the sentinel itself is not tracked in abort_handles).
                        if abort_count > 0 && abort_count == unref_count {
                            services.timers.abort_unrefed();
                            break;
                        }
                        if unref_count == 0 {
                            break;
                        }
                    }
                });
            })
            .await;
        }
        js_state.rt.idle().await;
    }
}

static mut STATE: Option<JsState> = None;
static mut INIT_PHASE: InitPhase = InitPhase::Uninitialized;

/// True while `wizer_initialize` is running. Used by built-in modules to avoid
/// std::fs / std::env operations during Wizer pre-init: those would trigger
/// wasi-libc's lazy preopen-cache population with the empty wizer environment,
/// and the broken cache would then be snapshotted into the pre-initialized
/// component, breaking filesystem access at runtime. See issue #91.
static WIZER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[inline]
pub fn is_wizer_active() -> bool {
    WIZER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
}

#[allow(static_mut_refs)]
pub fn get_js_state() -> &'static JsState {
    unsafe {
        match INIT_PHASE {
            InitPhase::Uninitialized => {
                // Phase 1: Create the runtime and all Rust-side state (no JS evaluation).
                STATE = Some(block_on(JsState::new_base()));
                // Mark as Initializing so re-entrant get_js_state() calls (e.g.
                // from setTimeout callbacks during module init) return the existing
                // state instead of re-running initialization.
                INIT_PHASE = InitPhase::Initializing;
                // Phase 2: Evaluate JS modules.
                block_on(STATE.as_ref().unwrap().finish_init());
                INIT_PHASE = InitPhase::FullyInitialized;
            }
            InitPhase::WizerPreInitialized => {
                // Wizer snapshot restored — refresh argv/env from the real host.
                let state = STATE.as_ref().unwrap();
                block_on(JsState::refresh_process_env(state));
                INIT_PHASE = InitPhase::FullyInitialized;
            }
            InitPhase::Initializing | InitPhase::FullyInitialized => {
                // Already initialized or in progress — return existing state.
            }
        }
        STATE.as_ref().unwrap()
    }
}

pub fn async_exported_function<F: Future>(future: F) -> F::Output {
    let js_state = get_js_state();

    block_on(async move {
        use futures::StreamExt;

        if let Some(mut resource_drop_queue_rx) = js_state.resource_drop_queue_rx.take() {
            let resource_dropper = async move {
                while let Some(resource_id) = resource_drop_queue_rx.next().await {
                    if resource_id > 0 {
                        drop_js_resource(resource_id).await;
                    } else {
                        break;
                    }
                }
                resource_drop_queue_rx
            };

            // Finish resource dropper
            js_state
                .resource_drop_queue_tx
                .unbounded_send(0)
                .expect("Failed to enqueue resource dropper stop signal");
            let (result, resource_drop_queue_rx) = (future, resource_dropper).join().await;
            js_state
                .resource_drop_queue_rx
                .replace(Some(resource_drop_queue_rx));

            result
        } else {
            // This case will never happen because block_on does not allow reentry
            unreachable!()
        }
    })
}

pub async fn call_js_export<A, R>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
) -> R
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
{
    call_js_export_internal(wit_package, function_path, args, |a| a, |_, _| None).await
}

pub async fn call_js_export_returning_result<A, R, E>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
) -> crate::wrappers::JsResult<R, E>
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    E: for<'js> FromJs<'js> + 'static,
{
    call_js_export_internal(
        wit_package,
        function_path,
        args,
        |a| crate::wrappers::JsResult(Ok(a)),
        |ctx, value| {
            FromJs::from_js(ctx, value.clone())
                .ok()
                .map(|e| crate::wrappers::JsResult(Err(e)))
        },
    )
    .await
}

async fn call_js_export_internal<A, R, FR, TME>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = get_js_state();

    let result: FR = async_with!(js_state.ctx => |ctx| {
        let (user_function, parent) =
            get_cached_js_export(js_state, &ctx, wit_package, function_path, args.num_args());

        let result: Result<Value, Error> = call_with_this(ctx.clone(), user_function, parent, args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                if let Some(result) = try_map_exception(&ctx, &exception) {
                    result
                } else {
                    panic! ("Exception during call of {fun}:\n{exception}", fun = function_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic! ("Error during call of {fun}:\n{e:?}", fun = function_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    let promise: Promise = value.into_promise().unwrap();
                    let promise_future = promise.into_future::<R> ();

                    match promise_future.await {
                        Ok(result) => {
                            map_result(result)
                        }
                        Err(e) => {
                            match e {
                                Error::Exception => {
                                    let exception = ctx.catch();
                                    if let Some(result) = try_map_exception(&ctx, &exception) {
                                        result
                                    } else {
                                        panic! ("Exception during awaiting call result for {function_path}:\n{exception}", function_path=function_path.join("."), exception = format_js_exception(&exception))
                                    }
                                }
                                _ => {
                                    panic ! ("Error during awaiting call result for {function_path}:\n{e:?}", function_path=function_path.join("."))
                                }
                            }
                        }
                    }
                }
                else {
                    (map_result)(
                        R::from_js(&ctx, value).unwrap_or_else(|err| panic!("Unexpected result value for exported function {path}: {err}", path=function_path.join(".")))
                    )
                }
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

fn get_cached_js_export<'js>(
    js_state: &JsState,
    ctx: &Ctx<'js>,
    wit_package: &'static str,
    function_path: &'static [&'static str],
    expected_parameter_count: usize,
) -> (Function<'js>, Object<'js>) {
    if let Some((function, parent, parameter_count)) = js_state
        .exported_function_cache
        .borrow()
        .get(function_path)
        .map(|cached| {
            (
                cached.function.clone(),
                cached.parent.clone(),
                cached.parameter_count,
            )
        })
    {
        if parameter_count != expected_parameter_count {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript function got {} parameters (exported function {} in WIT package {})",
                expected_parameter_count,
                parameter_count,
                function_path.join("."),
                wit_package
            );
        }

        let function = function
            .restore(ctx)
            .expect("Failed to restore cached exported JS function");
        let parent = parent
            .restore(ctx)
            .expect("Failed to restore cached exported JS function parent");
        return (function, parent);
    }

    let module: Object = ctx
        .globals()
        .get("userModule")
        .expect("Failed to get userModule");
    let (user_function_obj, parent): (Object, Object) = get_path(&module, function_path)
        .unwrap_or_else(|| {
            panic!(
                "{}",
                dump_cannot_find_export(
                    "exported JS function",
                    function_path,
                    &module,
                    wit_package
                )
            )
        });
    let user_function = user_function_obj
        .as_function()
        .unwrap_or_else(|| {
            panic!(
                "Expected export {} to be a function",
                function_path.join(".")
            )
        })
        .clone();

    let parameter_count = user_function_obj
        .get::<&str, usize>("length")
        .unwrap_or_else(|_| {
            panic!(
                "Failed to get parameter count of exported function {}",
                function_path.join(".")
            )
        });
    if parameter_count != expected_parameter_count {
        panic!(
            "The WIT specification defines {} parameters,\nbut the exported JavaScript function got {} parameters (exported function {} in WIT package {})",
            expected_parameter_count,
            parameter_count,
            function_path.join("."),
            wit_package
        );
    }

    js_state.exported_function_cache.borrow_mut().insert(
        function_path,
        CachedExportedFunction {
            function: Persistent::save(ctx, user_function.clone()),
            parent: Persistent::save(ctx, parent.clone()),
            parameter_count,
        },
    );

    (user_function, parent)
}

pub fn variant_case_tag<'js>(
    ctx: &Ctx<'js>,
    name: &'static str,
) -> rquickjs::Result<JsString<'js>> {
    let js_state = get_js_state();
    if let Some(tag) = js_state.variant_case_tag_cache.borrow().get(name).cloned() {
        return tag.restore(ctx);
    }

    let tag = JsString::from_str(ctx.clone(), name)?;
    js_state
        .variant_case_tag_cache
        .borrow_mut()
        .insert(name, Persistent::save(ctx, tag.clone()));
    Ok(tag)
}

pub async fn call_js_resource_constructor<A>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    args: A,
) -> usize
where
    A: for<'js> IntoArgs<'js>,
{
    let js_state = get_js_state();

    let result = async_with!(js_state.ctx => |ctx| {
        let module: Object = ctx.globals().get("userModule").expect("Failed to get userModule");
        let (constructor_obj, _parent): (Constructor, Object) = get_path(&module, resource_path).unwrap_or_else(|| panic!("{}", dump_cannot_find_export("exported JS resource class", resource_path, &module, wit_package)));
        let constructor = constructor_obj.as_constructor().unwrap_or_else(|| panic!("Expected export {path} to be a class with a constructor", path = resource_path.join("."))).clone();

        let parameter_count = constructor_obj.get::<&str, usize>("length").unwrap_or_else(|_| panic!("Failed to get parameter count of exported constructor {}", resource_path.join(".")));
        if parameter_count != args.num_args() {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript constructor got {} parameters (exported constructor {} in WIT package {})",
                args.num_args(),
                parameter_count,
                resource_path.join("."),
                wit_package
            );
        }

        let result: Result<Object, Error> = constructor.construct(args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                panic! ("Exception during call of constructor {path}:\n{exception}", path= resource_path.join("."), exception = format_js_exception(&exception));
            }
            Err(e) => {
                panic! ("Error during call of constructor {path}: {e:?}", path= resource_path.join("."));
            }
            Ok(resource) => {
                let resource_id = get_free_resource_id();
                resource.set(RESOURCE_ID_KEY, resource_id)
                    .expect("Failed to set resource ID");
                let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
                    .expect("Failed to get the resource table");
                resource_table
                    .set(resource_id.to_string(), resource)
                    .expect("Failed to store resource instance");

                resource_id
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

pub fn get_free_resource_id() -> usize {
    get_js_state()
        .last_resource_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

pub async fn call_js_resource_method<A, R>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
) -> R
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
{
    call_js_resource_method_internal(
        wit_package,
        resource_path,
        resource_id,
        name,
        args,
        |a| a,
        |_, _| None,
    )
    .await
}

pub async fn call_js_resource_method_returning_result<A, R, E>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
) -> crate::wrappers::JsResult<R, E>
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    E: for<'js> FromJs<'js> + 'static,
{
    call_js_resource_method_internal(
        wit_package,
        resource_path,
        resource_id,
        name,
        args,
        |a| crate::wrappers::JsResult(Ok(a)),
        |ctx, value| {
            FromJs::from_js(ctx, value.clone())
                .ok()
                .map(|e| crate::wrappers::JsResult(Err(e)))
        },
    )
    .await
}

async fn call_js_resource_method_internal<A, R, FR, TME>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = get_js_state();

    let result: FR = async_with!(js_state.ctx => |ctx| {
        let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
            .expect("Failed to get the resource table");
        let resource_instance: Object = resource_table.get(resource_id.to_string())
            .unwrap_or_else(|_| panic!("Failed to get resource instance with id #{resource_id} of class {}", resource_path.join(".")));

        let method_obj: Object = resource_instance.get(name)
            .unwrap_or_else(|_| panic!("{}", dump_cannot_find_method(
                name,
                resource_path,
                &resource_instance,
                wit_package,
            )));

        let method = method_obj.as_function().unwrap_or_else(|| panic!("Expected method {name} to be a function in class {}", resource_path.join("."))).clone();

        let parameter_count = method.get::<&str, usize>("length").unwrap_or_else(|_| panic!("Failed to get parameter count of exported method {name} in class {}", resource_path.join(".")));
        if parameter_count != args.num_args() {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript method got {} parameters (exported method {} of class {} representing a resource defined in WIT package {})",
                args.num_args(),
                parameter_count,
                name,
                resource_path.join("."),
                wit_package
            );
        }

        let result: Result<Value, Error> = call_with_this(ctx.clone(), method, resource_instance, args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                if let Some(result) = try_map_exception(&ctx, &exception) {
                    result
                } else {
                    panic!("Exception during call of method {name} in {path}:\n{exception}", path=resource_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic!("Error during call of method {name} in {path}:\n{e:?}", path=resource_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    let promise: Promise = value.into_promise().unwrap();
                    let promise_future = promise.into_future::<R> ();
                    match promise_future.await {
                        Ok(result) => {
                            map_result(result)
                        }
                        Err(e) => {
                            match e {
                                Error::Exception => {
                                    let exception = ctx.catch();
                                    if let Some(result) = try_map_exception(&ctx, &exception) {
                                        result
                                    } else {
                                        panic!("Exception during awaiting call result of method {name} in {path}:\n{exception:?}", path=resource_path.join("."), exception = format_js_exception(&exception));
                                    }
                                }
                                _ => {
                                    panic!("Error during awaiting call result of method {name} in {path}:\n{e:?}", path=resource_path.join("."));
                                }
                            }
                        }
                    }
                }
                else {
                    map_result(R::from_js(&ctx, value).unwrap_or_else(|err| panic!("Unexpected result value for method {name} in exported class {path}: {err}",
                                path=resource_path.join("."))))
                }
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

pub fn enqueue_drop_js_resource(resource_id: usize) {
    let js_state = get_js_state();
    js_state
        .resource_drop_queue_tx
        .unbounded_send(resource_id)
        .expect("Failed to enqueue resource drop");
}

async fn drop_js_resource(resource_id: usize) {
    let js_state = get_js_state();

    async_with!(js_state.ctx => |ctx| {
        let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
            .expect("Failed to get the resource table");
        if let Err(e) = resource_table.remove(resource_id.to_string()) {
            panic!("Failed to delete resource {resource_id}: {e:?}");
        }
    })
    .await;
    js_state.rt.idle().await;
}

fn call_with_this<'js, A, R>(
    ctx: Ctx<'js>,
    function: Function<'js>,
    this: Object<'js>,
    args: A,
) -> rquickjs::Result<R>
where
    A: IntoArgs<'js>,
    R: FromJs<'js>,
{
    let num = args.num_args();
    let mut accum_args = Args::new(ctx.clone(), num + 1);
    accum_args.this(this)?;
    args.into_args(&mut accum_args)?;
    function.call_arg(accum_args)
}

fn get_path<'js, V: FromJs<'js>>(root: &Object<'js>, path: &[&str]) -> Option<(V, Object<'js>)> {
    let (head, tail) = path.split_first()?;
    if tail.is_empty() {
        root.get(*head).ok().map(|v| (v, root.clone()))
    } else {
        let next: Object<'js> = root.get(*head).ok()?;
        get_path(&next, tail)
    }
}

fn dump_cannot_find_export(
    what: &str,
    path: &[&str],
    module: &Object,
    wit_package: &str,
) -> String {
    let mut panic_message = String::new();
    panic_message.push_str(&format!(
        "Cannot find {what} {} of WIT package {wit_package}",
        path.join(".")
    ));
    panic_message.push_str("\nProvided exports:\n");
    let mut keys: Vec<String> = vec![];
    for key in module.keys().flatten() {
        keys.push(key);
    }
    keys.sort();
    panic_message.push_str(&format!("  {}\n", keys.join(", ")));

    if path.len() == 1 {
        panic_message.push_str(&format!(
            "\nTry adding an export `export const {} = ...`\n",
            path[0]
        ));
    } else if path.len() > 1 {
        let mut current_object = module.clone();
        for i in 0..path.len() {
            match current_object.get::<&str, Object>(path[i]) {
                Ok(child) => {
                    current_object = child;
                }
                Err(_) => {
                    if i == 0 {
                        panic_message.push_str(&format!(
                            "\nTry adding an export `export const {} = {{ ... }}`\n",
                            path[i]
                        ));
                    } else {
                        panic_message.push_str(&format!("\nKeys in {}:\n", path[..i].join(".")));
                        let mut keys: Vec<String> = vec![];
                        for key in current_object.keys().flatten() {
                            keys.push(key);
                        }
                        keys.sort();
                        panic_message.push_str(&format!("  {}\n", keys.join(", ")));

                        panic_message.push_str(&format!(
                            "\nTry adding a field `{}` to {}\n",
                            path[i],
                            path[..i].join(".")
                        ));
                    }
                    break;
                }
            }
        }
    }
    panic_message
}

fn dump_cannot_find_method(
    name: &str,
    resource_path: &[&str],
    class_instance: &Object,
    wit_package: &str,
) -> String {
    let mut panic_message = String::new();
    panic_message.push_str(&format!(
        "Cannot find method {name} in an instance of class {path} of WIT package {wit_package}",
        path = resource_path.join(".")
    ));
    if let Some(prototype) = class_instance.get_prototype() {
        panic_message.push_str("\nKeys in the instance's prototype:\n");
        let mut keys: Vec<String> = vec![];
        for key in prototype
            .own_keys(Filter::new().symbol().string().private())
            .flatten()
        {
            keys.push(key);
        }
        keys.sort();
        panic_message.push_str(&format!("  {}\n", keys.join(", ")));
    }

    panic_message.push_str(&format!(
        "\nTry adding a method `{}() {{ ... }}` to class {path}\n",
        name,
        path = resource_path.join(".")
    ));

    panic_message
}

pub fn format_js_exception(exc: &Value) -> String {
    try_format_js_error(exc)
        .or_else(|| try_format_tagged_error(exc))
        .unwrap_or_else(|| {
            let formatted_exc = pretty_stringify_or_debug_print(exc);
            if formatted_exc.contains("\n") {
                format!("JavaScript exception:\n{formatted_exc}",)
            } else {
                format!("JavaScript exception: {formatted_exc}",)
            }
        })
}

pub fn try_format_js_error(err: &Value) -> Option<String> {
    let error_ctor: Object = err.ctx().globals().get("Error").ok()?;
    let obj = err.as_object()?;

    if !obj.is_instance_of(error_ctor) {
        return None;
    }

    let message: Option<String> = obj.get("message").ok();
    let stack: Option<String> = obj.get("stack").ok();

    match (message, stack) {
        (Some(msg), Some(st)) => Some(format!("JavaScript error: {msg}\nStack:\n{st}")),
        (Some(msg), None) => Some(format!("JavaScript error: {msg}")),
        (None, Some(st)) => Some(format!("JavaScript error: <no message>\nStack:\n{st}")),
        _ => None,
    }
}

pub fn try_format_tagged_error(err: &Value) -> Option<String> {
    let obj = err.as_object()?;
    let tag: Option<String> = obj.get("tag").ok();
    let val: Option<Value> = obj.get("val").ok();
    let val = val.and_then(|v| (!v.is_undefined()).then_some(v));

    match (tag, val) {
        (Some(tag), Some(val)) => {
            let formatted_val = pretty_stringify_or_debug_print(&val);
            if formatted_val.contains("\n") {
                Some(format!("Error: {tag}:\n{formatted_val}"))
            } else {
                Some(format!("Error: {tag}: {formatted_val}"))
            }
        }
        (Some(tag), None) => Some(format!("Error: {tag}")),
        _ => None,
    }
}

fn pretty_stringify_or_debug_print(val: &Value) -> String {
    if let Some(formatted) = try_pretty_stringify(val) {
        formatted
    } else {
        format!("{val:#?}")
    }
}

fn try_pretty_stringify(val: &Value) -> Option<String> {
    if val.is_undefined() {
        return Some("undefined".to_string());
    }

    // Return strings as they are
    if let Some(str) = val.as_string() {
        return str.to_string().ok();
    }

    // For other values try to use JSON.stringify()
    let json: Object = val.ctx().globals().get("JSON").ok()?;
    let stringify: Function = json.get("stringify").ok()?;
    let res: Result<String, Error> = stringify.call((val, rquickjs::Undefined, 2));
    res.ok()
}

pub fn format_caught_error(caught: CaughtError) -> String {
    match caught {
        CaughtError::Error(e) => {
            format!("Host error: {e:?}")
        }
        CaughtError::Exception(exc) => format_js_exception(&exc.into_value()),
        CaughtError::Value(val) => format_js_exception(&val),
    }
}

/// Wizer pre-initialization entry point: full initialization including user module.
/// After Wizer snapshots this state, the runtime is ready to handle exports immediately.
#[allow(static_mut_refs)]
pub fn wizer_initialize() {
    // Mark Wizer pre-init as active so built-in modules avoid touching
    // std::fs / std::env: those would trigger wasi-libc's lazy preopen-cache
    // population with the empty wizer environment, and the broken cache would
    // then be snapshotted into the pre-initialized component (issue #91).
    WIZER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);

    unsafe {
        // Phase 1: Create runtime
        STATE = Some(block_on(JsState::new_base()));

        // Mark as Initializing so re-entrant get_js_state() calls (e.g.
        // from setTimeout callbacks during module init) return the existing
        // state instead of re-running initialization.
        INIT_PHASE = InitPhase::Initializing;

        // Phase 2: Full initialization
        block_on(STATE.as_ref().unwrap().finish_init());

        // Run GC to compact the heap before snapshot
        block_on(async {
            let state = STATE.as_ref().unwrap();
            drain_and_idle(state).await;
            async_with!(state.ctx => |ctx| {
                ctx.run_gc();
                ctx.run_gc();
            })
            .await;
            drain_and_idle(state).await;

            // Verify clean state
            let timers_empty = async_with!(state.ctx => |ctx| {
                ctx.userdata::<RuntimeServices>()
                    .expect("runtime services not initialized")
                    .timers
                    .is_empty()
            })
            .await;
            assert!(timers_empty, "pending timers/tasks at snapshot time");
        });

        INIT_PHASE = InitPhase::WizerPreInitialized;
    }

    WIZER_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
}
