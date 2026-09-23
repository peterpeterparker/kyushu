//! Minimal WASI Preview 3 runtime spine for the generated rquickjs component.
//!
//! Unlike the Preview 2 skeleton this module does NOT depend on `wstd`, `wasip2`,
//! pollables, or `block_on`. Exported WIT functions are generated as `async fn`s
//! that `.await` directly on the component-model async executor, and the single
//! shared `rquickjs::AsyncRuntime` is created once via an async init-once guard
//! (`ensure_initialized`) that is safe under concurrent exported calls.

use futures::future::{AbortHandle, Abortable};
use rquickjs::function::{Args, Constructor, IntoArgs, This};
use rquickjs::promise::Promised;
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, CaughtError, Ctx, Error, Filter, FromJs, Function,
    IntoJs, Module, Object, Persistent, Promise, String as JsString, Value, async_with,
};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::atomic::AtomicUsize;
use std::task::{Context as TaskContext, Poll};
use wit_bindgen_p3::rt::async_support::{
    FutureReader, FutureWriter, StreamReader, StreamWriter, spawn_local,
};

use super::runtime_services::{
    OwnedJsRuntime, RuntimeServices, initialize_builtin_wiring, initialize_dispose_symbols,
};

/// Global key under which the `Symbol.dispose` value is published. Resource classes generated
/// for imported WIT resources read this global to wire `[Symbol.dispose]` onto their prototype,
/// so it must match the constant the Preview 2 path uses (`internal/p2.rs`).
pub const DISPOSE_SYMBOL: &str = "__wasm_rquickjs_symbol_dispose";

/// Global object holding live *exported* resource instances, keyed by the stringified
/// monotonic resource id. Generated exported-resource code stores each constructed JS instance
/// here so the host-facing resource handle (which only carries the numeric id) can be mapped back
/// to the JS object. Mirrors the Preview 2 path (`internal/p2.rs`).
pub const RESOURCE_TABLE_NAME: &str = "__wasm_rquickjs_resources";
/// Property name written onto an exported resource's JS instance to remember its resource id.
/// Mirrors the Preview 2 path (`internal/p2.rs`).
pub const RESOURCE_ID_KEY: &str = "__wasm_rquickjs_resource_id";

/// All Rust-side runtime state for the component. A single instance lives in
/// `STATE` and is shared across all (possibly concurrent) exported calls.
pub struct JsState {
    pub rt: AsyncRuntime,
    pub ctx: AsyncContext,
    pub exported_function_cache: RefCell<HashMap<&'static [&'static str], CachedExportedFunction>>,
    pub variant_case_tag_cache: RefCell<HashMap<&'static str, Persistent<JsString<'static>>>>,
    /// Monotonic id allocator for exported resource instances (starts at 1; 0 is never used).
    pub last_resource_id: AtomicUsize,
    /// Ids of exported resource instances whose host handle has been dropped. Populated
    /// synchronously from the resource's `Drop` (which cannot `.await`) and drained at the start
    /// of the next JS entry point, where the corresponding entry is removed from the JS resource
    /// table. See [`enqueue_drop_js_resource`] / [`drain_pending_resource_drops`].
    pub pending_resource_drops: RefCell<Vec<usize>>,
    /// Present only during synchronous `FromJs` conversion of an exported function result.
    /// Nested future/stream wrappers register writer tasks here so the enclosing export can keep
    /// its scheduler driver alive until every writer reaches EOF or observes a dropped reader.
    export_result_writer_group: RefCell<Option<Rc<ExportResultWriterGroup>>>,
}

pub struct CachedExportedFunction {
    function: Persistent<Function<'static>>,
    parent: Persistent<Object<'static>>,
    parameter_count: usize,
}

impl JsState {
    /// Create the runtime, context, resolvers and loaders. Does NOT evaluate any
    /// JavaScript, so it is safe to publish to `STATE` before `finish_init`.
    async fn new_base() -> Self {
        let OwnedJsRuntime { rt, ctx } = OwnedJsRuntime::new().await;

        Self {
            rt,
            ctx,
            exported_function_cache: RefCell::new(HashMap::new()),
            variant_case_tag_cache: RefCell::new(HashMap::new()),
            last_resource_id: AtomicUsize::new(1),
            pending_resource_drops: RefCell::new(Vec::new()),
            export_result_writer_group: RefCell::new(None),
        }
    }

    /// Phase 2a: initialize engine builtins — dispose symbols and builtin wiring.
    /// Must run before user module code so bundled CJS-in-ESM shims see
    /// `globalThis.require`, `Buffer`, `process`, timers, and related globals.
    async fn init_engine(&self) {
        initialize_dispose_symbols(&self.ctx)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        async_with!(self.ctx => |ctx| {
            // Table holding live exported resource instances (see `RESOURCE_TABLE_NAME`). Must exist
            // before any exported resource is constructed or any resource handle is lowered to JS.
            ctx.globals()
                .set(RESOURCE_TABLE_NAME, Object::new(ctx.clone()).expect("Failed to create the resource table object"))
                .expect("Failed to initialize the exported resource table");

            // Helpers used by the generated `future<T>`/`stream<T>` bridges. `make_async_iterable`
            // turns a Rust-provided `pull()` (returning a promise of `{ value, done }`) into a JS
            // async-iterable; `get_async_iterator` normalizes any (async or sync) iterable passed
            // from JS into an async iterator whose `next()` always returns a promise.
            Module::evaluate(
                ctx.clone(),
                "__wasm_rquickjs_async_values",
                r#"
                globalThis.__wasm_rquickjs_make_async_iterable = function (pull) {
                    return {
                        [Symbol.asyncIterator]() {
                            return { next() { return pull(); } };
                        },
                    };
                };
                globalThis.__wasm_rquickjs_get_async_iterator = function (iterable) {
                    if (iterable != null && typeof iterable[Symbol.asyncIterator] === 'function') {
                        return iterable[Symbol.asyncIterator]();
                    }
                    if (iterable != null && typeof iterable[Symbol.iterator] === 'function') {
                        const it = iterable[Symbol.iterator]();
                        return { next() { return Promise.resolve(it.next()); } };
                    }
                    throw new TypeError('value provided for a component stream<T> is not (async) iterable');
                };
                // Drives a JS (async/sync) iterable `source` into a component stream, calling the
                // native `writeOne(item)` for each item and awaiting the promise it returns before
                // pulling the next one (backpressure). `writeOne` resolves to `false` when the
                // component reader hung up, which stops iteration. Runs as ordinary QuickJS jobs so
                // it never becomes a competing async runtime driver.
                globalThis.__wasm_rquickjs_drive_stream_param = async function (source, writeOne) {
                    const value = await source;
                    const iterator = globalThis.__wasm_rquickjs_get_async_iterator(value);
                    while (true) {
                        const result = await iterator.next();
                        if (result == null || typeof result !== 'object') {
                            throw new TypeError('stream iterator next() did not resolve to an object');
                        }
                        if (result.done) {
                            return;
                        }
                        // A sync iterable normalized into an async iterator can still yield
                        // promise-valued items; `for await` awaits each value, so do the same.
                        const keepGoing = await writeOne(await result.value);
                        if (!keepGoing) {
                            return;
                        }
                    }
                };
                "#,
            )
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to evaluate async-value helpers:\n{}", format_caught_error(e)))
            .finish::<()>()
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to finish async-value helpers:\n{}", format_caught_error(e)));

        })
        .await;
        initialize_builtin_wiring(&self.ctx)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        // Use the sentinel-backed drain (not a plain `idle()`): a user module may schedule an
        // unref'd timer at top level (e.g. `setInterval(...).unref()`), which would keep a plain
        // `idle()` from ever returning. Mirrors the Preview 2 init path.
        drain_and_idle(self).await;
    }

    /// Phase 2b: import and evaluate the user module. Must run after
    /// `init_engine()`.
    async fn init_user_module(&self) {
        async_with!(self.ctx => |ctx| {
            Module::evaluate(
                ctx.clone(),
                "__wasm_rquickjs_init_entry",
                format!(
                    r#"
                    import * as userModule from '{}';
                    globalThis.userModule = userModule;
                    "#,
                    crate::JS_EXPORT_MODULE_NAME
                ),
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
        // Use the sentinel-backed drain (not a plain `idle()`): a user module may schedule an
        // unref'd timer at top level (e.g. `setInterval(...).unref()`), which would keep a plain
        // `idle()` from ever returning. Mirrors the Preview 2 init path.
        drain_and_idle(self).await;
    }

    /// Evaluate all JavaScript — dispose symbols, builtin wiring, user module
    /// import. Must run after `STATE` is published so re-entrant
    /// `get_js_state()` calls (for example timers scheduled during module init)
    /// find the already-published state instead of recursing.
    async fn finish_init(&self) {
        self.init_engine().await;
        self.init_user_module().await;
    }

    /// Refresh host-derived process state after restoring a Wizer snapshot.
    async fn refresh_process_env(state: &JsState) {
        let argv = wasip3::cli::environment::get_arguments();
        let env_vars: std::collections::HashMap<String, String> =
            wasip3::cli::environment::get_environment()
                .into_iter()
                .collect();

        async_with!(state.ctx => |ctx| {
            let globals = ctx.globals();
            if globals.get::<_, rquickjs::Object>("process").is_ok() {
                let new_argv = rquickjs::Array::new(ctx.clone())
                    .expect("failed to create process.argv for Wizer restoration");
                for (i, arg) in argv.iter().enumerate() {
                    new_argv
                        .set(i, arg.as_str())
                        .expect("failed to populate process.argv for Wizer restoration");
                }

                let new_env = rquickjs::Object::new(ctx.clone())
                    .expect("failed to create process.env for Wizer restoration");
                for (key, value) in &env_vars {
                    new_env
                        .set(key.as_str(), value.as_str())
                        .expect("failed to populate process.env for Wizer restoration");
                }

                let refresh_process = ctx
                    .eval::<rquickjs::Function, &str>(
                        "((argv, env) => process[Symbol.for(\
                            '__wasm_rquickjs_refresh_process_state'\
                        )](argv, env))",
                    )
                    .expect("failed to load the Wizer process-state refresh hook");
                assert!(
                    refresh_process
                        .call::<_, bool>((new_argv, new_env))
                        .unwrap_or(false),
                    "failed to restore process state after Wizer pre-initialization"
                );
            }
        })
        .await;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InitState {
    NotStarted,
    InProgress,
    WizerPreInitialized,
    Done,
}

static mut STATE: Option<JsState> = None;
static mut INIT: InitState = InitState::NotStarted;

/// True while `wizer_initialize` is running. Builtins use this to avoid snapshotting
/// wasi-libc caches populated from Wizer's empty filesystem and environment.
static WIZER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Cooperative yield: returns `Pending` exactly once (re-waking immediately) so
/// that another concurrent task can make progress. Used to wait for an in-flight
/// initialization without busy-spinning the host.
struct YieldNow(bool);

impl Future for YieldNow {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<()> {
        if self.0 {
            Poll::Ready(())
        } else {
            self.0 = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

/// Async init-once for the shared runtime. Safe under concurrent exported calls:
/// the component is single-threaded and cooperatively scheduled, so the
/// `NotStarted -> InProgress` transition happens atomically between await points;
/// concurrent callers observe `InProgress` and yield until initialization is
/// `Done`.
#[allow(static_mut_refs)]
pub async fn ensure_initialized() -> &'static JsState {
    loop {
        match unsafe { INIT } {
            InitState::NotStarted => {
                unsafe {
                    INIT = InitState::InProgress;
                }
                let state = JsState::new_base().await;
                unsafe {
                    STATE = Some(state);
                }
                // Borrow the published state to evaluate JS. No `&mut STATE` is
                // taken across this await, so concurrent yielding callers are safe.
                unsafe { STATE.as_ref().unwrap() }.finish_init().await;
                unsafe {
                    INIT = InitState::Done;
                }
                return unsafe { STATE.as_ref().unwrap() };
            }
            InitState::InProgress => {
                YieldNow(false).await;
            }
            InitState::WizerPreInitialized => {
                unsafe {
                    INIT = InitState::InProgress;
                }
                let state = unsafe { STATE.as_ref().unwrap() };
                JsState::refresh_process_env(state).await;
                unsafe {
                    INIT = InitState::Done;
                }
                return state;
            }
            InitState::Done => {
                return unsafe { STATE.as_ref().unwrap() };
            }
        }
    }
}

#[inline]
pub fn is_wizer_active() -> bool {
    WIZER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Returns the already-initialized shared state. Only valid to call after
/// `ensure_initialized().await` has completed (i.e. from within an exported call).
#[allow(static_mut_refs)]
pub fn get_js_state() -> &'static JsState {
    unsafe {
        STATE
            .as_ref()
            .expect("JsState accessed before initialization; this is a bug in the generated code")
    }
}

struct ExportResultWriterGroup {
    active_writers: Cell<usize>,
    drive_guard: RefCell<Option<DriveGuard>>,
}

impl ExportResultWriterGroup {
    fn new() -> Self {
        Self {
            active_writers: Cell::new(0),
            drive_guard: RefCell::new(None),
        }
    }

    fn register_writer(self: &Rc<Self>) -> ExportResultWriterGuard {
        self.active_writers.set(
            self.active_writers
                .get()
                .checked_add(1)
                .expect("export-result writer count overflowed"),
        );
        ExportResultWriterGuard {
            group: self.clone(),
        }
    }

    fn has_writers(&self) -> bool {
        self.active_writers.get() != 0
    }

    fn keep_driver_until_writers_finish(&self, drive_guard: DriveGuard) {
        if self.has_writers() {
            let previous = self.drive_guard.borrow_mut().replace(drive_guard);
            assert!(
                previous.is_none(),
                "an export-result writer group already owns a scheduler driver"
            );
        }
    }
}

struct ExportResultWriterGuard {
    group: Rc<ExportResultWriterGroup>,
}

impl Drop for ExportResultWriterGuard {
    fn drop(&mut self) {
        let active_writers = self.group.active_writers.get();
        debug_assert!(active_writers > 0);
        let active_writers = active_writers - 1;
        self.group.active_writers.set(active_writers);
        let drive_guard = if active_writers == 0 {
            self.group.drive_guard.borrow_mut().take()
        } else {
            None
        };
        drop(drive_guard);
    }
}

/// Restores the ambient export-result writer group even when `FromJs` panics.
struct ExportResultConversionGuard {
    state: &'static JsState,
    previous_group: Option<Rc<ExportResultWriterGroup>>,
    group: Rc<ExportResultWriterGroup>,
}

impl ExportResultConversionGuard {
    fn new() -> Self {
        Self::with_group(Rc::new(ExportResultWriterGroup::new()))
    }

    fn with_group(group: Rc<ExportResultWriterGroup>) -> Self {
        let state = get_js_state();
        let previous_group = state
            .export_result_writer_group
            .borrow_mut()
            .replace(group.clone());
        Self {
            state,
            previous_group,
            group,
        }
    }

    fn writer_group(&self) -> Option<Rc<ExportResultWriterGroup>> {
        self.group.has_writers().then(|| self.group.clone())
    }
}

impl Drop for ExportResultConversionGuard {
    fn drop(&mut self) {
        *self.state.export_result_writer_group.borrow_mut() = self.previous_group.take();
    }
}

fn with_export_result_conversion<T>(
    f: impl FnOnce() -> T,
) -> (T, Option<Rc<ExportResultWriterGroup>>) {
    let guard = ExportResultConversionGuard::new();
    let result = f();
    let writer_group = guard.writer_group();
    drop(guard);
    (result, writer_group)
}

fn from_js_export_result<'js, R>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
) -> (rquickjs::Result<R>, Option<Rc<ExportResultWriterGroup>>)
where
    R: FromJs<'js>,
{
    with_export_result_conversion(|| R::from_js(ctx, value))
}

fn current_export_result_writer_group() -> Option<Rc<ExportResultWriterGroup>> {
    get_js_state().export_result_writer_group.borrow().clone()
}

fn with_export_result_writer_group<T>(
    group: Rc<ExportResultWriterGroup>,
    f: impl FnOnce() -> T,
) -> T {
    let guard = ExportResultConversionGuard::with_group(group);
    let result = f();
    drop(guard);
    result
}

/// RAII guard that keeps a persistent rquickjs scheduler driver (`AsyncRuntime::drive`) running on
/// the component-model async executor for the lifetime of an exported call.
///
/// The rquickjs scheduler (which holds `Promised` / `Ctx::spawn` tasks such as the `future<T>` /
/// `stream<T>` bridges and stream backpressure acknowledgements) is only advanced while some
/// `async_with!` (`WithFuture`) or the `DriveFuture` returned by `drive()` is actively polled. An
/// exported call parks inside `async_with!` awaiting the JS result promise; while parked it stops
/// driving the scheduler, so any scheduler task a JS job spawns after that point (typically a
/// `future<T>` / `stream<T>` produced or consumed by an imported async function) would never be
/// polled again — a cross-executor lost wakeup.
///
/// `DriveFuture` avoids this: it registers its waker with the runtime's spawner on every poll and
/// is re-woken whenever anything is spawned, so keeping one alive for the whole exported call means
/// the scheduler always makes progress. It is spawned as an independent wit-bindgen task (confined
/// to the current call's `FutureState`) and aborted when the guard is dropped so the call's task
/// set can drain once the export body — and any writer tasks it started — have finished.
struct DriveGuard(AbortHandle);

impl Drop for DriveGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Spawns the persistent scheduler driver described on [`DriveGuard`] and returns the guard that
/// aborts it on drop. Must be called from within an exported call's async context (so the spawned
/// driver is polled within that call's `FutureState`).
fn spawn_drive_guard(rt: &AsyncRuntime) -> DriveGuard {
    let (handle, registration) = AbortHandle::new_pair();
    let drive = rt.drive();
    spawn_local(async move {
        // `Abortable` resolves to `Err(Aborted)` once the guard is dropped; the driver itself never
        // completes on its own while the runtime is alive.
        let _ = Abortable::new(drive, registration).await;
    });
    DriveGuard(handle)
}

/// Drains the JavaScript event loop before an exported call returns.
///
/// After the export produces its result (a direct value or an awaited Promise) the P3 wrapper would
/// otherwise return immediately and drop its [`DriveGuard`], so any work the export merely
/// *scheduled* — `setTimeout`/`setInterval`/`setImmediate` callbacks, `queueMicrotask`/Promise jobs,
/// `future<T>`/`stream<T>` writer tasks — would never run. This mirrors the Preview 2 `drain_and_idle`:
/// it waits for all *ref'd* timers to finish, then aborts any remaining *unref'd* timers (Node's
/// event loop exits once only unref'd timers are left) so [`AsyncRuntime::idle`] can complete.
///
/// `idle()` drives the runtime on its own (exactly as the plain `idle()` calls during
/// `finish_init` do), so this is also used during initialization where no `DriveGuard` exists. In
/// an exported call the caller's `DriveGuard` is additionally kept alive across this call, so any
/// scheduler task started by the parked JS promise (`future<T>`/`stream<T>` writers) keeps being
/// polled too.
async fn drain_and_idle(js_state: &JsState) {
    let has_unrefed_timers = async_with!(js_state.ctx => |ctx| {
        !ctx.userdata::<RuntimeServices>()
            .expect("runtime services not initialized")
            .timers
            .unrefed_timers
            .borrow()
            .is_empty()
    })
    .await;
    if !has_unrefed_timers {
        js_state.rt.idle().await;
        return;
    }
    // Spawn a sentinel that polls until only unref'd timers remain, then aborts them so `idle()`
    // can return. The sentinel is itself a spawned job (not tracked in `abort_handles`), so it does
    // not perturb the `abort_count == unref_count` comparison below.
    async_with!(js_state.ctx => |ctx| {
        let task_ctx = ctx.clone();
        ctx.spawn(async move {
            loop {
                // 1ms poll interval (`wait_for` takes nanoseconds).
                wasip3::clocks::monotonic_clock::wait_for(1_000_000).await;
                let services = task_ctx
                    .userdata::<RuntimeServices>()
                    .expect("runtime services not initialized");
                let abort_count = services.timers.abort_handles.borrow().len();
                let unref_count = services.timers.unrefed_timers.borrow().len();
                // Once the only remaining timers are unref'd, abort them so the loop can drain.
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
    js_state.rt.idle().await;
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
    call_js_export_internal(wit_package, function_path, args, |a| a, |_, _| None, true).await
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
        true,
    )
    .await
}

/// Synchronous variant of [`call_js_export`], used for a *synchronous* exported resource static
/// method. It is driven to completion by [`run_sync`] (`block_on`) from a synchronous Guest trait
/// method, so it must never suspend: if the JavaScript static returns a `Promise`, it traps with
/// an actionable message instead of awaiting it (which could deadlock the whole instance). Declare
/// the static as `async func` in WIT to get the awaiting behavior.
pub async fn call_js_export_sync<A, R>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
) -> R
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
{
    call_js_export_internal(wit_package, function_path, args, |a| a, |_, _| None, false).await
}

/// Synchronous, `result`-returning variant of [`call_js_export_returning_result`] for a
/// synchronous exported resource static method. See [`call_js_export_sync`] for the promise rule.
pub async fn call_js_export_sync_returning_result<A, R, E>(
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
        false,
    )
    .await
}

async fn call_js_export_internal<A, R, FR, TME>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
    allow_async: bool,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = ensure_initialized().await;
    // Keep the rquickjs scheduler driven for the whole call so `future<T>` / `stream<T>` bridges
    // (which live as scheduler tasks) make progress even while this call is parked awaiting the JS
    // result promise. Dropped (aborted) when this call returns.
    //
    // The synchronous path (`allow_async == false`, used for synchronous exported resource statics
    // driven by `block_on`) never awaits a JS promise and never spawns scheduler tasks, so it must
    // NOT create a `DriveGuard`: a never-completing `rt.drive()` task spawned inside a `block_on`
    // would prevent it from returning.
    let mut drive_guard = allow_async.then(|| spawn_drive_guard(&js_state.rt));

    let (result, export_result_writer_group) = async_with!(js_state.ctx => |ctx| {
        drain_pending_resource_drops(&ctx);

        let (user_function, parent) =
            get_cached_js_export(js_state, &ctx, wit_package, function_path, args.num_args());

        let result: Result<Value, Error> = call_with_this(ctx.clone(), user_function, parent, args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                let (mapped, export_result_writer_group) =
                    with_export_result_conversion(|| try_map_exception(&ctx, &exception));
                if let Some(result) = mapped {
                    (result, export_result_writer_group)
                } else {
                    panic!("Exception during call of {fun}:\n{exception}", fun = function_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic!("Error during call of {fun}:\n{e:?}", fun = function_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    if !allow_async {
                        panic!(
                            "The synchronous exported function {fun} returned a Promise. Synchronous \
                             exported functions must return a value directly on the WASI Preview 3 \
                             path; declare it as `async func` in WIT to return a Promise.",
                            fun = function_path.join(".")
                        );
                    }
                    let promise: Promise = value.into_promise().unwrap();
                    let promise_future = promise.into_future::<Value>();

                    match promise_future.await {
                        Ok(value) => {
                            let (result, export_result_writer_group) =
                                from_js_export_result::<R>(&ctx, value);
                            (
                                map_result(result.unwrap_or_else(|err| panic!("Unexpected result value for exported function {path}: {err}", path = function_path.join(".")))),
                                export_result_writer_group,
                            )
                        }
                        Err(e) => match e {
                            Error::Exception => {
                                let exception = ctx.catch();
                                let (mapped, export_result_writer_group) =
                                    with_export_result_conversion(|| try_map_exception(&ctx, &exception));
                                if let Some(result) = mapped {
                                    (result, export_result_writer_group)
                                } else {
                                    panic!("Exception during awaiting call result for {function_path}:\n{exception}", function_path = function_path.join("."), exception = format_js_exception(&exception))
                                }
                            }
                            _ => panic!("Error during awaiting call result for {function_path}:\n{e:?}", function_path = function_path.join(".")),
                        },
                    }
                } else {
                    let (result, export_result_writer_group) =
                        from_js_export_result::<R>(&ctx, value);
                    (
                        map_result(result.unwrap_or_else(|err| panic!("Unexpected result value for exported function {path}: {err}", path = function_path.join(".")))),
                        export_result_writer_group,
                    )
                }
            }
        }
    })
    .await;

    // Run any timers / spawned jobs the export merely scheduled before returning (see
    // `drain_and_idle`). The `DriveGuard` above is still alive here, so the scheduler keeps being
    // polled while the drain waits.
    if let Some(writer_group) = export_result_writer_group {
        writer_group.keep_driver_until_writers_finish(
            drive_guard
                .take()
                .expect("an export-result writer requires an asynchronous scheduler driver"),
        );
    } else if allow_async {
        drain_and_idle(js_state).await;
    }
    result
}

// ---------------------------------------------------------------------------
// Exported WIT resources.
//
// In the component model a resource constructor and its *synchronous* methods/statics are lowered
// as synchronous core-wasm exports (they are NOT wrapped in `start_task`), so the generated Guest
// trait methods for them are ordinary `fn`s. They still need to enter the shared async QuickJS
// runtime, which is only reachable through `async_with!` (an `async` operation). The generated sync
// methods therefore drive the corresponding `async fn` helper below to completion with
// [`run_sync`] (`wit_bindgen`'s self-contained `block_on`). To keep `block_on` from ever blocking
// the whole component instance, the synchronous helpers never spawn a scheduler driver and never
// await a JS promise — a sync-declared op whose JavaScript returns a `Promise` traps with an
// actionable message telling the author to declare it `async func`.
//
// `async` WIT resource methods/statics are generated as `async fn`s that `.await` the async
// helpers directly (with a `DriveGuard`), exactly like freestanding async exports.
// ---------------------------------------------------------------------------

/// Drives `future` to completion synchronously using `wit-bindgen`'s self-contained `block_on`
/// (its own `FutureState`, no component-model context-local storage). Used by generated
/// synchronous exported-resource Guest methods (constructor, sync method, sync static), which
/// cannot be `async fn` but must call into the async QuickJS runtime.
pub fn run_sync<T: 'static>(future: impl Future<Output = T>) -> T {
    wit_bindgen_p3::rt::async_support::block_on(future)
}

/// Fully initializes the P3 QuickJS runtime and leaves it quiescent for Wizer to snapshot.
#[allow(static_mut_refs)]
pub async fn wizer_initialize() {
    WIZER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);

    unsafe {
        INIT = InitState::InProgress;
    }

    let state = JsState::new_base().await;
    unsafe {
        STATE = Some(state);
    }
    let state = unsafe { STATE.as_ref().unwrap() };
    state.finish_init().await;
    drain_and_idle(state).await;
    async_with!(state.ctx => |ctx| {
        ctx.run_gc();
        ctx.run_gc();
    })
    .await;
    drain_and_idle(state).await;

    let timers_empty = async_with!(state.ctx => |ctx| {
        ctx.userdata::<RuntimeServices>()
            .expect("runtime services not initialized")
            .timers
            .is_empty()
    })
    .await;
    assert!(timers_empty, "pending timers/tasks at snapshot time");

    unsafe {
        INIT = InitState::WizerPreInitialized;
    }

    WIZER_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
}

/// Allocates the next monotonic exported-resource id. Ids start at 1 and are never reused, so a
/// queued drop can never delete a newer instance that happens to share a recycled id.
pub fn get_free_resource_id() -> usize {
    get_js_state()
        .last_resource_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Records that an exported resource instance's host handle has been dropped. Called from the
/// generated resource's synchronous `Drop`, which cannot `.await`; the JS-side removal happens
/// later in [`drain_pending_resource_drops`] at the next JS entry point.
pub fn enqueue_drop_js_resource(resource_id: usize) {
    get_js_state()
        .pending_resource_drops
        .borrow_mut()
        .push(resource_id);
}

/// Removes any exported resource instances whose host handle has been dropped from the JS resource
/// table, allowing them to be garbage-collected. Called at the start of every JS entry point while
/// the QuickJS context is held. The pending list is swapped out under a short borrow so no
/// `RefCell` borrow is held across the (synchronous) JS table mutations, and removing an id that is
/// no longer present is treated as a harmless no-op.
fn drain_pending_resource_drops(ctx: &Ctx<'_>) {
    let ids = {
        let mut pending = get_js_state().pending_resource_drops.borrow_mut();
        if pending.is_empty() {
            return;
        }
        std::mem::take(&mut *pending)
    };

    let resource_table: Object = ctx
        .globals()
        .get(RESOURCE_TABLE_NAME)
        .expect("Failed to get the resource table");
    for id in ids {
        // Idempotent: a stale / already-removed id simply has no entry to delete.
        let _ = resource_table.remove(id.to_string());
    }
}

/// Constructs an exported resource instance by invoking its JavaScript class constructor, stores
/// the instance in the resource table keyed by a fresh id, and returns that id. Constructors are
/// always synchronous in the component model, so this never awaits a promise and never spawns a
/// scheduler driver; it is driven by [`run_sync`] from the generated synchronous constructor.
pub async fn call_js_resource_constructor<A>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    args: A,
) -> usize
where
    A: for<'js> IntoArgs<'js>,
{
    let js_state = ensure_initialized().await;

    async_with!(js_state.ctx => |ctx| {
        drain_pending_resource_drops(&ctx);

        let module: Object = ctx.globals().get("userModule").expect("Failed to get userModule");
        let (constructor_obj, _parent): (Constructor, Object) = get_path(&module, resource_path)
            .unwrap_or_else(|| panic!("{}", dump_cannot_find_export("exported JS resource class", resource_path, &module, wit_package)));
        let constructor = constructor_obj
            .as_constructor()
            .unwrap_or_else(|| panic!("Expected export {path} to be a class with a constructor", path = resource_path.join(".")))
            .clone();

        let parameter_count = constructor_obj
            .get::<&str, usize>("length")
            .unwrap_or_else(|_| panic!("Failed to get parameter count of exported constructor {}", resource_path.join(".")));
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
                panic!("Exception during call of constructor {path}:\n{exception}", path = resource_path.join("."), exception = format_js_exception(&exception));
            }
            Err(e) => {
                panic!("Error during call of constructor {path}: {e:?}", path = resource_path.join("."));
            }
            Ok(resource) => {
                let resource_id = get_free_resource_id();
                resource.set(RESOURCE_ID_KEY, resource_id).expect("Failed to set resource ID");
                let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME).expect("Failed to get the resource table");
                resource_table.set(resource_id.to_string(), resource).expect("Failed to store resource instance");
                resource_id
            }
        }
    })
    .await
}

/// Invokes an `async` method on an exported resource instance and awaits its result. Used by
/// generated `async fn` resource methods.
pub async fn call_js_resource_method<A, R>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    resource_id: usize,
    name: &'static str,
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
        true,
    )
    .await
}

/// `result`-returning variant of [`call_js_resource_method`] for `async` resource methods.
pub async fn call_js_resource_method_returning_result<A, R, E>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    resource_id: usize,
    name: &'static str,
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
        true,
    )
    .await
}

/// Synchronous variant of [`call_js_resource_method`], used for a *synchronous* exported resource
/// method and driven by [`run_sync`]. It never awaits a JS promise: if the method returns one it
/// traps with an actionable message (declare the method `async func` in WIT).
pub async fn call_js_resource_method_sync<A, R>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    resource_id: usize,
    name: &'static str,
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
        false,
    )
    .await
}

/// Synchronous, `result`-returning variant of [`call_js_resource_method_returning_result`] for a
/// synchronous exported resource method. See [`call_js_resource_method_sync`] for the promise rule.
pub async fn call_js_resource_method_sync_returning_result<A, R, E>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    resource_id: usize,
    name: &'static str,
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
        false,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn call_js_resource_method_internal<A, R, FR, TME>(
    wit_package: &'static str,
    resource_path: &'static [&'static str],
    resource_id: usize,
    name: &'static str,
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
    allow_async: bool,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = ensure_initialized().await;
    // See `call_js_export_internal`: the async path drives the scheduler for the whole call; the
    // synchronous path (driven by `block_on`) must not, so it never returns a `DriveGuard`.
    let mut drive_guard = allow_async.then(|| spawn_drive_guard(&js_state.rt));

    let (result, export_result_writer_group) = async_with!(js_state.ctx => |ctx| {
        drain_pending_resource_drops(&ctx);

        let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
            .expect("Failed to get the resource table");
        let resource_instance: Object = resource_table.get(resource_id.to_string())
            .unwrap_or_else(|_| panic!("Failed to get resource instance with id #{resource_id} of class {}", resource_path.join(".")));

        let method_obj: Object = resource_instance.get(name)
            .unwrap_or_else(|_| panic!("{}", dump_cannot_find_method(name, resource_path, &resource_instance, wit_package)));

        let method = method_obj.as_function()
            .unwrap_or_else(|| panic!("Expected method {name} to be a function in class {}", resource_path.join(".")))
            .clone();

        let parameter_count = method.get::<&str, usize>("length")
            .unwrap_or_else(|_| panic!("Failed to get parameter count of exported method {name} in class {}", resource_path.join(".")));
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
                let (mapped, export_result_writer_group) =
                    with_export_result_conversion(|| try_map_exception(&ctx, &exception));
                if let Some(result) = mapped {
                    (result, export_result_writer_group)
                } else {
                    panic!("Exception during call of method {name} in {path}:\n{exception}", path = resource_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic!("Error during call of method {name} in {path}:\n{e:?}", path = resource_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    if !allow_async {
                        panic!(
                            "The synchronous exported method {name} of {path} returned a Promise. \
                             Synchronous exported resource methods must return a value directly on the \
                             WASI Preview 3 path; declare it as `async func` in WIT to return a Promise.",
                            path = resource_path.join(".")
                        );
                    }
                    let promise: Promise = value.into_promise().unwrap();
                    match promise.into_future::<Value>().await {
                        Ok(value) => {
                            let (result, export_result_writer_group) =
                                from_js_export_result::<R>(&ctx, value);
                            (
                                map_result(result.unwrap_or_else(|err| panic!("Unexpected result value for method {name} in exported class {path}: {err}", path = resource_path.join(".")))),
                                export_result_writer_group,
                            )
                        }
                        Err(Error::Exception) => {
                            let exception = ctx.catch();
                            let (mapped, export_result_writer_group) =
                                with_export_result_conversion(|| try_map_exception(&ctx, &exception));
                            if let Some(result) = mapped {
                                (result, export_result_writer_group)
                            } else {
                                panic!("Exception during awaiting call result of method {name} in {path}:\n{exception}", path = resource_path.join("."), exception = format_js_exception(&exception));
                            }
                        }
                        Err(e) => {
                            panic!("Error during awaiting call result of method {name} in {path}:\n{e:?}", path = resource_path.join("."));
                        }
                    }
                } else {
                    let (result, export_result_writer_group) =
                        from_js_export_result::<R>(&ctx, value);
                    (
                        map_result(result.unwrap_or_else(|err| panic!("Unexpected result value for method {name} in exported class {path}: {err}", path = resource_path.join(".")))),
                        export_result_writer_group,
                    )
                }
            }
        }
    })
    .await;

    // Run any timers / spawned jobs the method merely scheduled before returning (see
    // `drain_and_idle`).
    if let Some(writer_group) = export_result_writer_group {
        writer_group.keep_driver_until_writers_finish(
            drive_guard
                .take()
                .expect("an export-result writer requires an asynchronous scheduler driver"),
        );
    } else if allow_async {
        drain_and_idle(js_state).await;
    }
    result
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
        "\nTry adding a method `{name}() {{ ... }}` to class {path}\n",
        path = resource_path.join(".")
    ));
    panic_message
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
    panic_message
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

pub fn format_js_exception(exc: &Value) -> String {
    try_format_js_error(exc)
        .or_else(|| try_format_tagged_error(exc))
        .unwrap_or_else(|| {
            let formatted_exc = pretty_stringify_or_debug_print(exc);
            if formatted_exc.contains('\n') {
                format!("JavaScript exception:\n{formatted_exc}")
            } else {
                format!("JavaScript exception: {formatted_exc}")
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
            if formatted_val.contains('\n') {
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

    if let Some(str) = val.as_string() {
        return str.to_string().ok();
    }

    let json: Object = val.ctx().globals().get("JSON").ok()?;
    let stringify: Function = json.get("stringify").ok()?;
    let res: Result<String, Error> = stringify.call((val, rquickjs::Undefined, 2));
    res.ok()
}

pub fn format_caught_error(caught: CaughtError) -> String {
    match caught {
        CaughtError::Error(e) => format!("Host error: {e:?}"),
        CaughtError::Exception(exc) => format_js_exception(&exc.into_value()),
        CaughtError::Value(val) => format_js_exception(&val),
    }
}

// ---------------------------------------------------------------------------
// WASI Preview 3 `future<T>` / `stream<T>` bridge helpers.
//
// These support the generated code that maps component-model async values to and from
// JavaScript. A component `future<T>` is exposed to JS as a `Promise<T>` and a `stream<T>`
// as an async-iterable; conversely a JS `Promise`/async-iterable coming from JS is turned
// into a component future/stream. Values that must outlive the current exported/imported
// call (writers driven from JS) use `spawn_local` + `rquickjs::Persistent` so the background
// task keeps running on the component-model async executor after the initiating call returns.
// ---------------------------------------------------------------------------

/// Awaits a JavaScript value, transparently resolving it if it is a promise, and converts the
/// result to `R`. Panics (traps) if the promise rejects or the value cannot be converted, since
/// `future<T>` has no error channel.
async fn resolve_js_value<'js, R>(ctx: &Ctx<'js>, value: Value<'js>) -> R
where
    R: FromJs<'js>,
{
    if value.is_promise() {
        let promise: Promise = value
            .into_promise()
            .expect("value.is_promise() returned true but conversion to Promise failed");
        match promise.into_future::<R>().await {
            Ok(v) => v,
            Err(Error::Exception) => {
                let exception = ctx.catch();
                panic!(
                    "A JavaScript promise backing a component future/stream payload rejected:\n{}",
                    format_js_exception(&exception)
                );
            }
            Err(e) => panic!(
                "Error awaiting a JavaScript promise for a component future/stream payload: {e:?}"
            ),
        }
    } else {
        R::from_js(ctx, value).unwrap_or_else(|e| {
            panic!(
                "Failed to convert a JavaScript value to a component future/stream payload: {e:?}"
            )
        })
    }
}

/// Calls an exported JS function and returns its raw return value (a promise or a plain value)
/// as a `Persistent` handle, without awaiting it. Used by exported functions whose WIT return
/// type is `future<T>`/`stream<T>`: the returned value is resolved later by a background writer
/// task so the component can hand the async value back to the host immediately.
pub async fn call_js_export_raw<A>(
    wit_package: &'static str,
    function_path: &'static [&'static str],
    args: A,
) -> Persistent<Value<'static>>
where
    A: for<'js> IntoArgs<'js>,
{
    let js_state = ensure_initialized().await;
    // See `call_js_export_internal`: keep the rquickjs scheduler driven for the whole call. The
    // returned raw value's writer task (spawned by the caller) self-drives via its own `async_with!`
    // after this returns, so the guard only needs to cover the JS call itself.
    let _drive_guard = spawn_drive_guard(&js_state.rt);

    async_with!(js_state.ctx => |ctx| {
        drain_pending_resource_drops(&ctx);

        let (user_function, parent) =
            get_cached_js_export(js_state, &ctx, wit_package, function_path, args.num_args());

        let result: Result<Value, Error> = call_with_this(ctx.clone(), user_function, parent, args);

        match result {
            Ok(value) => Persistent::save(&ctx, value),
            Err(Error::Exception) => {
                let exception = ctx.catch();
                panic!("Exception during call of {fun}:\n{exception}", fun = function_path.join("."), exception = format_js_exception(&exception));
            }
            Err(e) => {
                panic!("Error during call of {fun}:\n{e:?}", fun = function_path.join("."));
            }
        }
    })
    .await
}

/// The future produced by [`spawn_future_writer`], factored out so it can also be composed with
/// an import call in a single wit-bindgen task (see [`drive_import_with_writers`]) instead of
/// always being spawned as an independent task.
///
/// Resolves a persisted JavaScript value (awaiting it if it is a promise), converts it to the
/// component payload type, and writes it into the component future.
pub async fn future_writer_task<T, R, F>(
    js_value: Persistent<Value<'static>>,
    writer: FutureWriter<T>,
    convert: F,
) where
    T: 'static,
    R: for<'js> FromJs<'js> + 'static,
    F: FnOnce(R) -> T + 'static,
{
    let payload: T = async_with!(get_js_state().ctx => |ctx| {
        let value = js_value
            .restore(&ctx)
            .expect("Failed to restore a persisted future payload value");
        let r: R = resolve_js_value::<R>(&ctx, value).await;
        convert(r)
    })
    .await;
    let _ = writer.write(payload).await;
}

/// Spawns a background task that resolves a persisted JavaScript value (awaiting it if it is a
/// promise), converts it to the component payload type, and writes it into the component future.
pub fn spawn_future_writer<T, R, F>(
    js_value: Persistent<Value<'static>>,
    writer: FutureWriter<T>,
    convert: F,
) where
    T: 'static,
    R: for<'js> FromJs<'js> + 'static,
    F: FnOnce(R) -> T + 'static,
{
    spawn_local(future_writer_task(js_value, writer, convert));
}

/// The future produced by [`spawn_stream_writer`], factored out so it can also be composed with
/// an import call in a single wit-bindgen task (see [`drive_import_with_writers`]) instead of
/// always being spawned as an independent task.
///
/// Drains a persisted JavaScript (async-)iterable one item at a time and writes each item into
/// the component stream. Stops early if the reader hangs up.
pub async fn stream_writer_task<T, R, F>(
    js_value: Persistent<Value<'static>>,
    mut writer: StreamWriter<T>,
    convert: F,
) where
    T: 'static,
    R: for<'js> FromJs<'js> + 'static,
    F: Fn(R) -> T + 'static,
{
    // Obtain a normalized async iterator from the JS value once. The persisted value may be a
    // promise (an `async function` returning the iterable resolves to it), so resolve it first
    // before normalizing it into an async iterator.
    let iterator: Persistent<Object<'static>> = async_with!(get_js_state().ctx => |ctx| {
            let value = js_value
                .restore(&ctx)
                .expect("Failed to restore a persisted stream value");
            let value: Value = resolve_js_value::<Value>(&ctx, value).await;
            let get_iter: Function = ctx
                .globals()
                .get("__wasm_rquickjs_get_async_iterator")
                .expect("async-value helper __wasm_rquickjs_get_async_iterator is missing");
            let iterator: Object = get_iter
                .call((value,))
                .unwrap_or_else(|e| panic!("Failed to obtain an async iterator for a component stream<T>: {e:?}"));
            Persistent::save(&ctx, iterator)
        })
        .await;

    // Borrow the converter so the per-iteration `async_with!` closure copies a `&F` (which is
    // `Copy`) instead of moving the non-`Copy` `convert` out of the enclosing task.
    let convert = &convert;
    loop {
        // Clone the persisted iterator handle per iteration so the `async_with!` closure moves
        // a fresh clone each time rather than the shared handle (which the loop reuses).
        let iterator = iterator.clone();
        let item: Option<T> = async_with!(get_js_state().ctx => |ctx| {
                let iterator = iterator
                    .restore(&ctx)
                    .expect("Failed to restore a persisted stream iterator");
                let next_fn: Function = iterator
                    .get("next")
                    .expect("stream async iterator has no next() method");
                let next_value: Value = next_fn
                    .call((This(iterator.clone()),))
                    .unwrap_or_else(|e| panic!("Failed to call next() on a component stream<T> iterator: {e:?}"));
                let resolved: Value = resolve_js_value::<Value>(&ctx, next_value).await;
                let result_obj: Object = resolved
                    .into_object()
                    .unwrap_or_else(|| panic!("stream iterator next() did not resolve to an object"));
                let done: bool = result_obj.get("done").unwrap_or(false);
                if done {
                    None
                } else {
                    let value: Value = result_obj
                        .get("value")
                        .unwrap_or_else(|e| panic!("Failed to read `value` from a stream iterator result: {e:?}"));
                    // A sync iterable normalized into an async iterator can still yield
                    // promise-valued items; JS `for await` awaits each value (AsyncFromSyncIterator
                    // semantics), so resolve promises before converting to the payload type.
                    let r: R = resolve_js_value::<R>(&ctx, value).await;
                    Some(convert(r))
                }
            })
            .await;

        match item {
            Some(item) => {
                if writer.write_one(item).await.is_some() {
                    // The reader hung up; stop producing further items.
                    break;
                }
            }
            None => {
                break;
            }
        }
    }
}

/// Spawns a background task that drains a persisted JavaScript (async-)iterable one item at a
/// time and writes each item into the component stream. Stops early if the reader hangs up.
pub fn spawn_stream_writer<T, R, F>(
    js_value: Persistent<Value<'static>>,
    writer: StreamWriter<T>,
    convert: F,
) where
    T: 'static,
    R: for<'js> FromJs<'js> + 'static,
    F: Fn(R) -> T + 'static,
{
    spawn_local(stream_writer_task(js_value, writer, convert));
}

/// Whether a settled deferred promise should be fulfilled or rejected, and with what JS value.
///
/// Used by [`settle_import_promise`] to bridge a WIT import result (which may be a `result<_, _>`
/// or an ordinary value) into a JS promise settlement.
pub enum PromiseOutcome<'js> {
    Resolve(Value<'js>),
    Reject(Value<'js>),
}

// ---------------------------------------------------------------------------
// Import-side `future<T>` / `stream<T>` parameter lowering (JS -> component).
//
// A `future<T>` / `stream<T>` parameter is an owned component value that the host may consume
// *during* the import call or store and consume *after* the import returns. The generated bridge
// for an async import that takes such parameters is a synchronous function that returns a deferred
// JS promise and spawns one wit-bindgen task that awaits the import and then settles the promise.
//
// The subtle constraint is the rquickjs runtime's single scheduler waker: while the root exported
// call is parked awaiting its result promise inside `async_with!`, it is the sole registered
// runtime driver. If a background writer task also drives the runtime via `async_with!` (to
// resolve/convert the JS payload) it clobbers that driver waker, and a subsequent async import
// that depends on the writer's output never gets re-polled -> deadlock.
//
// So these lowering helpers strictly separate the two kinds of work:
//   * JS-value resolution + payload conversion runs in JS promise `.then` callbacks / a JS async
//     pump. Those run as ordinary QuickJS jobs, driven by the existing runtime driver (the export
//     call), and never register a competing driver.
//   * The actual component-model write runs in a *pure* wit-bindgen task that only awaits
//     component futures/channels and never touches the QuickJS `Ctx`.
// The converted payloads are handed from the JS side to the pure write task over plain Rust
// channels. This works whether the host consumes the reader during or after the import call.
// ---------------------------------------------------------------------------

/// Lowers a JS value (`value`, a `Promise<T>` or a plain `T`) into a component `future<T>` fed by
/// `writer`. The JS→Rust conversion happens in a promise `.then` callback (or immediately, for a
/// non-promise value); the resolved payload is sent to a pure component-model task that performs
/// `writer.write`. Neither the callback nor the write task ever drives the rquickjs runtime, so
/// this is safe to call while an exported call is parked (e.g. for a stored `future<T>` consumed
/// by a later import).
pub fn future_writer_from_js<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: FutureWriter<T>,
    convert: F,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: FnOnce(R) -> T + 'static,
{
    future_writer_from_js_internal(ctx, value, writer, convert, None)
}

fn future_writer_from_js_in_export<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: FutureWriter<T>,
    convert: F,
    writer_group: Rc<ExportResultWriterGroup>,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: FnOnce(R) -> T + 'static,
{
    future_writer_from_js_internal(ctx, value, writer, convert, Some(writer_group))
}

fn future_writer_from_js_internal<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: FutureWriter<T>,
    convert: F,
    writer_group: Option<Rc<ExportResultWriterGroup>>,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: FnOnce(R) -> T + 'static,
{
    let (tx, rx) = futures::channel::oneshot::channel::<T>();
    let writer_guard = writer_group
        .as_ref()
        .map(ExportResultWriterGroup::register_writer);

    // Pure write task: no `async_with!`, only component-model awaits.
    spawn_local(async move {
        let _writer_guard = writer_guard;
        match rx.await {
            Ok(payload) => {
                // If the host dropped the reader the write fails harmlessly.
                let _ = writer.write(payload).await;
            }
            Err(_) => {
                // The JS promise rejected (or was dropped) without producing a payload. A bare
                // `future<T>` has no error channel, so dropping the writer traps via
                // `async_value_default`, matching the "payload never resolved" contract.
                drop(writer);
            }
        }
    });

    if value.is_promise() {
        let promise = value
            .into_promise()
            .expect("value.is_promise() returned true but conversion to Promise failed");
        // `convert`/`tx` are single-use; a QuickJS callback must be `Fn`, so guard them behind a
        // shared cell that the fulfilled/rejected reactions take from (only one ever fires).
        let slot: Rc<RefCell<Option<(futures::channel::oneshot::Sender<T>, F)>>> =
            Rc::new(RefCell::new(Some((tx, convert))));
        let slot_ok = slot.clone();
        let writer_group_ok = writer_group.clone();
        let on_fulfilled = Function::new(ctx.clone(), move |resolved: Value<'_>| {
            if let Some((tx, convert)) = slot_ok.borrow_mut().take() {
                // Derive the `Ctx` from the value so both share the same `'js` lifetime.
                let cb_ctx = resolved.ctx().clone();
                let converted = || R::from_js(&cb_ctx, resolved);
                let wrapped = match writer_group_ok.clone() {
                    Some(group) => with_export_result_writer_group(group, converted),
                    None => converted(),
                }
                .unwrap_or_else(|e| {
                    panic!(
                        "Failed to convert a JavaScript value to a component future payload: {e:?}"
                    )
                });
                let _ = tx.send(convert(wrapped));
            }
        })?;
        let on_rejected = Function::new(ctx.clone(), move |_reason: Value<'_>| {
            // Drop the sender so the pure write task observes a cancelled payload and traps.
            drop(slot.borrow_mut().take());
        })?;
        let then: Function = promise.get("then")?;
        then.call::<_, ()>((This(promise.clone()), on_fulfilled, on_rejected))?;
    } else {
        let converted = || R::from_js(ctx, value);
        let wrapped = match writer_group {
            Some(group) => with_export_result_writer_group(group, converted),
            None => converted(),
        }?;
        let _ = tx.send(convert(wrapped));
    }
    Ok(())
}

/// Lowers a JS value (`value`, an async/sync iterable or a `Promise` of one) into a component
/// `stream<T>` fed by `writer`. A JS async pump (`__wasm_rquickjs_drive_stream_param`) iterates the
/// source and, for each item, invokes a native `writeOne` callback that converts the item and hands
/// it to a pure component-model task; the callback returns a promise the pump awaits before pulling
/// the next item, preserving backpressure. As with [`future_writer_from_js`], no callback or task
/// drives the rquickjs runtime, so a stored stream consumed after the import returns works too.
pub fn stream_writer_from_js<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: StreamWriter<T>,
    convert: F,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: Fn(R) -> T + 'static,
{
    stream_writer_from_js_internal(ctx, value, writer, convert, None)
}

fn stream_writer_from_js_in_export<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: StreamWriter<T>,
    convert: F,
    writer_group: Rc<ExportResultWriterGroup>,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: Fn(R) -> T + 'static,
{
    stream_writer_from_js_internal(ctx, value, writer, convert, Some(writer_group))
}

fn stream_writer_from_js_internal<'js, T, R, F>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    writer: StreamWriter<T>,
    convert: F,
    writer_group: Option<Rc<ExportResultWriterGroup>>,
) -> rquickjs::Result<()>
where
    T: 'static,
    R: for<'a> FromJs<'a> + 'static,
    F: Fn(R) -> T + 'static,
{
    // Commands from the JS `writeOne` callback to the pure write task. Each item carries a
    // oneshot the task uses to acknowledge whether the stream should keep producing.
    let (cmd_tx, mut cmd_rx) =
        futures::channel::mpsc::unbounded::<(T, futures::channel::oneshot::Sender<bool>)>();
    let writer_guard = writer_group
        .as_ref()
        .map(ExportResultWriterGroup::register_writer);

    // Pure write task: no `async_with!`, only component-model awaits.
    spawn_local(async move {
        let _writer_guard = writer_guard;
        use futures::StreamExt as _;
        let mut writer = writer;
        while let Some((payload, ack)) = cmd_rx.next().await {
            match writer.write_one(payload).await {
                // Item accepted; ask the pump to continue.
                None => {
                    let _ = ack.send(true);
                }
                // The reader hung up; tell the pump to stop and end the stream.
                Some(_returned) => {
                    let _ = ack.send(false);
                    break;
                }
            }
        }
        // Dropping `writer` closes the component stream once the pump has finished (or the reader
        // hung up).
        drop(writer);
    });

    let cmd_tx = Rc::new(cmd_tx);
    let writer_group_for_item = writer_group.clone();
    // Returns a `Promised` (converted to a JS promise by rquickjs) that resolves to whether the
    // pump should keep producing. Returning `Promised` directly (rather than `into_js`-ing it here)
    // avoids tying an explicit `Value<'js>` return to the argument's invariant lifetime.
    let write_one = Function::new(ctx.clone(), move |item: Value<'_>| {
        // Derive the `Ctx` from the item so `from_js` uses the matching `'js` lifetime.
        let cb_ctx = item.ctx().clone();
        let converted = || R::from_js(&cb_ctx, item);
        let wrapped = match writer_group_for_item.clone() {
            Some(group) => with_export_result_writer_group(group, converted),
            None => converted(),
        }
        .unwrap_or_else(|e| {
            panic!("Failed to convert a JavaScript value to a component stream payload: {e:?}")
        });
        let payload = convert(wrapped);
        let (ack_tx, ack_rx) = futures::channel::oneshot::channel::<bool>();
        // If the pure task already exited (reader hung up) the send fails; report "stop".
        let accepted = cmd_tx.unbounded_send((payload, ack_tx)).is_ok();
        Promised(async move {
            if accepted {
                ack_rx.await.unwrap_or(false)
            } else {
                false
            }
        })
    })?;

    let drive: Function = ctx
        .globals()
        .get("__wasm_rquickjs_drive_stream_param")
        .expect("async-value helper __wasm_rquickjs_drive_stream_param is missing");
    // The pump returns a promise; attach a rejection handler so a throwing iterable traps with a
    // clear diagnostic instead of surfacing as an unhandled rejection.
    let pump: Value = drive.call((value, write_one))?;
    if let Some(pump) = pump.as_promise() {
        let on_rejected = Function::new(ctx.clone(), move |reason: Value<'_>| -> () {
            panic!(
                "A JavaScript iterable backing a component stream failed:\n{}",
                format_js_exception(&reason)
            );
        })?;
        let then: Function = pump.get("then")?;
        then.call::<_, ()>((This(pump.clone()), rquickjs::Undefined, on_rejected))?;
    }
    Ok(())
}

/// Settles a deferred JS promise (created for an async import that lowers JS `future<T>` /
/// `stream<T>` parameters) with the outcome produced by `produce`, then drives the QuickJS job
/// queue so the awaiting JS continuation — and the root export's promise-resolution callback —
/// actually run. Merely calling `resolve`/`reject` and returning is not sufficient: promise
/// reaction jobs are only executed while the QuickJS job queue is pumped.
pub async fn settle_import_promise<P>(
    resolve: Persistent<Function<'static>>,
    reject: Persistent<Function<'static>>,
    produce: P,
) where
    P: for<'js> FnOnce(&Ctx<'js>) -> rquickjs::Result<PromiseOutcome<'js>> + 'static,
{
    async_with!(get_js_state().ctx => |ctx| {
        let resolve = resolve
            .restore(&ctx)
            .expect("Failed to restore a persisted async-import resolve function");
        let reject = reject
            .restore(&ctx)
            .expect("Failed to restore a persisted async-import reject function");
        match produce(&ctx) {
            Ok(PromiseOutcome::Resolve(value)) => {
                resolve
                    .call::<_, ()>((value,))
                    .unwrap_or_else(|e| panic!("Failed to resolve an async import promise: {e:?}"));
            }
            Ok(PromiseOutcome::Reject(error)) => {
                reject
                    .call::<_, ()>((error,))
                    .unwrap_or_else(|e| panic!("Failed to reject an async import promise: {e:?}"));
            }
            Err(e) => panic!("Failed to convert an async import result to JavaScript: {e:?}"),
        }
        // Run the promise reaction jobs enqueued by resolve/reject (and any transitive
        // continuations) so the JS `await` resumes and the root export's promise settles.
        while ctx.execute_pending_job() {}
    })
    .await;
}

/// A single async-iterator result (`{ value, done }`) produced from an `Option`.
struct IterResult<V>(Option<V>);

impl<'js, V> IntoJs<'js> for IterResult<V>
where
    V: IntoJs<'js>,
{
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        let obj = Object::new(ctx.clone())?;
        match self.0 {
            Some(v) => {
                obj.set("done", false)?;
                obj.set("value", v)?;
            }
            None => {
                obj.set("done", true)?;
                obj.set("value", rquickjs::Undefined)?;
            }
        }
        Ok(obj.into_value())
    }
}

/// Default value constructor handed to `wit_future::new`/`wit_stream::new` in generated code.
/// The generated writer tasks always write an explicit value before the writer is dropped, so
/// this default is only reached on an abnormal path (the writer was dropped before a value was
/// resolved and written, e.g. the resolving task was cancelled). There is no error channel on a
/// bare `future<T>`/`stream<T>`, so trap with an explicit diagnostic instead of fabricating a
/// value. `fn() -> T` is required by the wit-bindgen helpers; this generic fn satisfies it for
/// any payload type without requiring `T: Default`.
pub fn async_value_default<T>() -> T {
    panic!(
        "a component future/stream writer was dropped before its JavaScript value was resolved \
         and written; this indicates the producing task was cancelled"
    )
}

/// Builds a JavaScript async-iterable that yields items pulled one at a time from a component
/// stream reader, applying `wrap` to convert each payload to its JS representation.
///
/// Concurrent `next()` calls are serialized through an async mutex so a second pull started
/// before the first resolves waits its turn instead of observing a premature end-of-stream.
pub fn stream_reader_to_js<'js, T, R, F>(
    ctx: &Ctx<'js>,
    reader: StreamReader<T>,
    wrap: F,
) -> rquickjs::Result<Value<'js>>
where
    T: 'static,
    R: for<'a> IntoJs<'a> + 'static,
    F: Fn(T) -> R + Clone + 'static,
{
    let state: Rc<futures::lock::Mutex<StreamReader<T>>> =
        Rc::new(futures::lock::Mutex::new(reader));
    let pull = Function::new(ctx.clone(), move || {
        let state = state.clone();
        let wrap = wrap.clone();
        Promised(async move {
            let item: Option<T> = {
                let mut reader = state.lock().await;
                reader.next().await
            };
            IterResult(item.map(&wrap))
        })
    })?;

    let make: Function = ctx.globals().get("__wasm_rquickjs_make_async_iterable")?;
    let iterable: Value = make.call((pull,))?;
    Ok(iterable)
}

/// Awaits a component future reader and converts its payload to a JS value via `wrap`. Exposed to
/// JavaScript as a `Promise` (through rquickjs' `Promised`).
pub fn future_reader_to_js<'js, T, R, F>(
    ctx: &Ctx<'js>,
    reader: FutureReader<T>,
    wrap: F,
) -> rquickjs::Result<Value<'js>>
where
    T: 'static,
    R: for<'a> IntoJs<'a> + 'static,
    F: FnOnce(T) -> R + 'static,
{
    Promised(async move {
        let payload: T = reader.await;
        wrap(payload)
    })
    .into_js(ctx)
}

/// An `IntoJs` wrapper around a component future reader, so the backing `Promise` is created
/// lazily inside the QuickJS context (where a `Ctx` is available), e.g. when passed as an
/// exported function argument or returned from an imported-function bridge.
pub struct FutureReaderIntoJs<T: 'static, F> {
    reader: FutureReader<T>,
    wrap: F,
}

impl<T: 'static, F> FutureReaderIntoJs<T, F> {
    pub fn new(reader: FutureReader<T>, wrap: F) -> Self {
        Self { reader, wrap }
    }
}

impl<'js, T, R, F> IntoJs<'js> for FutureReaderIntoJs<T, F>
where
    T: 'static,
    R: for<'a> IntoJs<'a> + 'static,
    F: FnOnce(T) -> R + 'static,
{
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        future_reader_to_js(ctx, self.reader, self.wrap)
    }
}

/// An `IntoJs` wrapper around a component stream reader, so that the async-iterable is built
/// lazily inside the QuickJS context (where a `Ctx` is available), e.g. when it is passed as an
/// exported function argument.
pub struct StreamReaderIntoJs<T: 'static, F> {
    reader: StreamReader<T>,
    wrap: F,
}

impl<T: 'static, F> StreamReaderIntoJs<T, F> {
    pub fn new(reader: StreamReader<T>, wrap: F) -> Self {
        Self { reader, wrap }
    }
}

impl<'js, T, R, F> IntoJs<'js> for StreamReaderIntoJs<T, F>
where
    T: 'static,
    R: for<'a> IntoJs<'a> + 'static,
    F: Fn(T) -> R + Clone + 'static,
{
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        stream_reader_to_js(ctx, self.reader, self.wrap)
    }
}

pub trait FuturePayloadBridge: 'static {
    type Component: 'static;
    type Js: for<'js> FromJs<'js> + for<'js> IntoJs<'js> + 'static;

    fn wrap(value: Self::Component) -> Self::Js;
    fn unwrap(value: Self::Js) -> Self::Component;
    fn channel() -> (FutureWriter<Self::Component>, FutureReader<Self::Component>);
}

pub struct FutureReaderWrapper<B: FuturePayloadBridge> {
    reader: FutureReader<B::Component>,
}

impl<B: FuturePayloadBridge> FutureReaderWrapper<B> {
    pub fn new(reader: FutureReader<B::Component>) -> Self {
        Self { reader }
    }

    pub fn into_inner(self) -> FutureReader<B::Component> {
        self.reader
    }
}

impl<'js, B: FuturePayloadBridge> IntoJs<'js> for FutureReaderWrapper<B> {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        FutureReaderIntoJs::new(self.reader, B::wrap).into_js(ctx)
    }
}

impl<'js, B: FuturePayloadBridge> FromJs<'js> for FutureReaderWrapper<B> {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let (writer, reader) = B::channel();
        if let Some(writer_group) = current_export_result_writer_group() {
            future_writer_from_js_in_export(ctx, value, writer, B::unwrap, writer_group)?;
        } else {
            future_writer_from_js(ctx, value, writer, B::unwrap)?;
        }
        Ok(Self { reader })
    }
}

pub trait StreamPayloadBridge: 'static {
    type Component: 'static;
    type Js: for<'js> FromJs<'js> + for<'js> IntoJs<'js> + 'static;

    fn wrap(value: Self::Component) -> Self::Js;
    fn unwrap(value: Self::Js) -> Self::Component;
    fn channel() -> (StreamWriter<Self::Component>, StreamReader<Self::Component>);
}

pub struct StreamReaderWrapper<B: StreamPayloadBridge> {
    reader: StreamReader<B::Component>,
}

impl<B: StreamPayloadBridge> StreamReaderWrapper<B> {
    pub fn new(reader: StreamReader<B::Component>) -> Self {
        Self { reader }
    }

    pub fn into_inner(self) -> StreamReader<B::Component> {
        self.reader
    }
}

impl<'js, B: StreamPayloadBridge> IntoJs<'js> for StreamReaderWrapper<B> {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        StreamReaderIntoJs::new(self.reader, B::wrap).into_js(ctx)
    }
}

impl<'js, B: StreamPayloadBridge> FromJs<'js> for StreamReaderWrapper<B> {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let (writer, reader) = B::channel();
        if let Some(writer_group) = current_export_result_writer_group() {
            stream_writer_from_js_in_export(ctx, value, writer, B::unwrap, writer_group)?;
        } else {
            stream_writer_from_js(ctx, value, writer, B::unwrap)?;
        }
        Ok(Self { reader })
    }
}
