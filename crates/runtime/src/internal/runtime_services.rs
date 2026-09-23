use futures::future::AbortHandle;
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, Function, JsLifetime, Module, Value, async_with,
};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::AtomicUsize;

/// Mutable services owned by one QuickJS runtime.
///
/// These live in rquickjs runtime userdata rather than the component-global
/// `JsState`, so additional runtimes can use built-ins without reaching into
/// the main component runtime.
pub(crate) struct RuntimeServices {
    pub(crate) timers: TimerServices,
    pub(crate) node_package_deprecation_warnings: RefCell<HashSet<String>>,
    pub(crate) package_json_cache: super::module_loading::PackageJsonCache,
    pub(crate) process: ProcessServices,
    pub(crate) fs: RefCell<FsServices>,
    output: RefCell<Rc<dyn RuntimeOutputSink>>,
    pub(crate) execution_jobs: RefCell<HashMap<usize, Rc<crate::builtin::execution::ExecutionJob>>>,
    pub(crate) next_execution_job_id: Cell<usize>,
    pub(crate) execution_enabled: Cell<bool>,
}

impl Default for RuntimeServices {
    fn default() -> Self {
        Self {
            timers: TimerServices::default(),
            node_package_deprecation_warnings: RefCell::default(),
            package_json_cache: Default::default(),
            process: ProcessServices::default(),
            fs: RefCell::new(FsServices::default()),
            output: RefCell::new(Rc::new(ComponentOutputSink)),
            execution_jobs: RefCell::default(),
            next_execution_job_id: Cell::new(1),
            execution_enabled: Cell::new(true),
        }
    }
}

pub(crate) struct FsServices {
    pub(crate) files: HashMap<i32, std::fs::File>,
    pub(crate) next_fd: i32,
    pub(crate) path_mode_overrides: HashMap<String, u32>,
    pub(crate) fd_mode_overrides: HashMap<i32, u32>,
    pub(crate) fd_paths: HashMap<i32, String>,
}

impl Default for FsServices {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            next_fd: 10,
            path_mode_overrides: HashMap::new(),
            fd_mode_overrides: HashMap::new(),
            fd_paths: HashMap::new(),
        }
    }
}

impl FsServices {
    pub(crate) fn insert_file(&mut self, file: std::fs::File) -> i32 {
        let fd = self.next_fd;
        self.next_fd += 1;
        self.files.insert(fd, file);
        fd
    }
}

#[derive(Default)]
pub(crate) struct ProcessServices {
    isolated: RefCell<Option<IsolatedProcessState>>,
}

struct IsolatedProcessState {
    argv: Vec<String>,
    env: HashMap<String, String>,
    cwd: PathBuf,
}

impl ProcessServices {
    pub(crate) fn configure(
        &self,
        argv: Vec<String>,
        env: HashMap<String, String>,
        cwd: PathBuf,
    ) -> std::io::Result<()> {
        let cwd = normalize_absolute_path(&cwd)?;
        if !cwd.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "process cwd is not a directory",
            ));
        }
        *self.isolated.borrow_mut() = Some(IsolatedProcessState { argv, env, cwd });
        Ok(())
    }

    pub(crate) fn args(&self) -> Vec<String> {
        self.isolated
            .borrow()
            .as_ref()
            .map(|state| state.argv.clone())
            .unwrap_or_else(|| std::env::args().collect())
    }

    pub(crate) fn env(&self) -> HashMap<String, String> {
        self.isolated
            .borrow()
            .as_ref()
            .map(|state| state.env.clone())
            .unwrap_or_else(|| std::env::vars().collect())
    }

    pub(crate) fn cwd(&self) -> PathBuf {
        self.isolated
            .borrow()
            .as_ref()
            .map(|state| state.cwd.clone())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")))
    }

    /// Resolve a guest path without mutating the component-wide process cwd.
    ///
    /// Owned runtimes can execute concurrently, so relative filesystem paths
    /// must be anchored in this runtime's process state rather than delegated
    /// to `std::fs` (which would use shared ambient state).
    pub(crate) fn resolve_path(&self, path: &Path) -> std::io::Result<PathBuf> {
        let anchored = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.cwd().join(path)
        };
        normalize_absolute_path(&anchored)
    }

    pub(crate) fn chdir(&self, path: &Path) -> std::io::Result<()> {
        let mut isolated = self.isolated.borrow_mut();
        let Some(state) = isolated.as_mut() else {
            return std::env::set_current_dir(path);
        };
        let resolved = if path.is_absolute() {
            normalize_absolute_path(path)?
        } else {
            normalize_absolute_path(&state.cwd.join(path))?
        };
        if !resolved.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "cwd is not a directory",
            ));
        }
        state.cwd = resolved;
        Ok(())
    }
}

pub(crate) fn normalize_absolute_path(path: &Path) -> std::io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path must be absolute",
        ));
    }
    let mut normalized = PathBuf::from("/");
    for component in path.components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::Prefix(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "unsupported path prefix",
                ));
            }
        }
    }
    Ok(normalized)
}

pub(crate) trait RuntimeOutputSink {
    fn write_stdout(&self, data: &str);
    fn write_stderr(&self, data: &str);

    fn is_component_output(&self) -> bool {
        false
    }
}

struct ComponentOutputSink;

impl RuntimeOutputSink for ComponentOutputSink {
    fn write_stdout(&self, data: &str) {
        let _ = std::io::stdout().write_all(data.as_bytes());
        let _ = std::io::stdout().flush();
    }

    fn write_stderr(&self, data: &str) {
        let _ = std::io::stderr().write_all(data.as_bytes());
        let _ = std::io::stderr().flush();
    }

    fn is_component_output(&self) -> bool {
        true
    }
}

impl RuntimeServices {
    pub(crate) fn output_sink(&self) -> Rc<dyn RuntimeOutputSink> {
        self.output.borrow().clone()
    }

    pub(crate) fn set_output_sink(&self, output: Rc<dyn RuntimeOutputSink>) {
        *self.output.borrow_mut() = output;
    }
}

/// A standalone QuickJS runtime with all context-local native services installed.
///
/// It deliberately does not initialize component resource bridges, builtin JS
/// wiring, or the generated component user module. Those are explicit policies
/// layered on top by the main component runtime and by future execution jobs.
pub(crate) struct OwnedJsRuntime {
    pub(crate) rt: AsyncRuntime,
    pub(crate) ctx: AsyncContext,
}

fn drain_process_turn_queues(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<bool> {
    let mut drained_any = false;
    loop {
        let drained_next_ticks = match ctx
            .globals()
            .get::<_, Function>("__wasm_rquickjs_drainNextTick")
        {
            Ok(drain) => drain.call::<_, usize>(())?,
            Err(_) => 0,
        };
        let mut executed_jobs = 0usize;
        while ctx.execute_pending_job() {
            executed_jobs += 1;
        }
        if drained_next_ticks == 0 && executed_jobs == 0 {
            return Ok(drained_any);
        }
        drained_any = true;
    }
}

/// Runs the private Node-compatible end-of-turn promise rejection checkpoint.
///
/// QuickJS jobs are drained only after `process.nextTick`, and the rejection
/// event is emitted only after both queues stabilize. Work scheduled by the
/// event handlers is then drained before the next host callback is allowed to
/// run. Rejection events and the work they create are processed to a fixpoint,
/// matching Node's `processTicksAndRejections` loop.
pub(crate) fn run_process_turn_checkpoint(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<bool> {
    let checkpoint = ctx
        .globals()
        .get::<_, Function>("__wasm_rquickjs_unhandled_rejection_checkpoint")
        .ok();
    let mut did_work = false;
    loop {
        did_work |= drain_process_turn_queues(ctx)?;
        let emitted = match &checkpoint {
            Some(checkpoint) => checkpoint.call::<_, usize>(())?,
            None => 0,
        };
        if emitted == 0 {
            return Ok(did_work);
        }
        did_work = true;
    }
}

impl OwnedJsRuntime {
    pub(crate) async fn new() -> Self {
        let rt = AsyncRuntime::new().expect("Failed to create AsyncRuntime");
        // QuickJS defines zero as unlimited. The component's shared wasm32
        // linear memory remains the outer bound, so do not impose a smaller
        // per-runtime ceiling on execution jobs.
        rt.set_memory_limit(0).await;
        rt.set_gc_threshold(256 * 1024 * 1024).await;
        let ctx = AsyncContext::full(&rt)
            .await
            .expect("Failed to create AsyncContext");

        async_with!(ctx => |ctx| {
            ctx.store_userdata(RuntimeServices::default())
                .expect("Failed to initialize runtime services");
        })
        .await;

        super::module_loading::initialize_module_loading(&rt, &ctx).await;

        rt.set_host_promise_rejection_tracker(Some(Box::new(
            |ctx, promise, reason, is_handled| {
                if let Ok(handler) = ctx
                    .globals()
                    .get::<_, Function>("__wasm_rquickjs_rejection_tracker")
                {
                    let _ = handler.call::<_, Value>((promise, reason, is_handled));
                }
            },
        )))
        .await;

        Self { rt, ctx }
    }

    /// Install the ordinary Node-compatible global environment without loading
    /// the generated component entry module or any generated WIT bridge state.
    pub(crate) async fn initialize_node_builtins(&self) -> Result<(), String> {
        initialize_dispose_symbols(&self.ctx).await?;
        self.rt.idle().await;
        initialize_builtin_wiring(&self.ctx).await?;
        self.rt.idle().await;
        Ok(())
    }

    pub(crate) async fn configure_process(
        &self,
        argv: Vec<String>,
        env: HashMap<String, String>,
        cwd: PathBuf,
    ) -> Result<(), String> {
        async_with!(self.ctx => |ctx| {
            ctx.userdata::<RuntimeServices>()
                .expect("runtime services not initialized")
                .process
                .configure(argv, env, cwd)
                .map_err(|error| error.to_string())
        })
        .await
    }

    pub(crate) async fn set_output_sink(&self, output: Rc<dyn RuntimeOutputSink>) {
        async_with!(self.ctx => |ctx| {
            ctx.userdata::<RuntimeServices>()
                .expect("runtime services not initialized")
                .set_output_sink(output);
        })
        .await;
    }

    pub(crate) async fn disable_execution(&self) {
        async_with!(self.ctx => |ctx| {
            ctx.userdata::<RuntimeServices>()
                .expect("runtime services not initialized")
                .execution_enabled
                .set(false);
        })
        .await;
    }
}

pub(crate) async fn initialize_dispose_symbols(ctx: &AsyncContext) -> Result<(), String> {
    async_with!(ctx => |ctx| {
        Module::evaluate(
            ctx.clone(),
            "dispose",
            r#"
            const dispose = Symbol.for("dispose");
            globalThis.__wasm_rquickjs_symbol_dispose = dispose;
            Symbol.dispose = dispose;
            const asyncDispose = Symbol.for("asyncDispose");
            Symbol.asyncDispose = asyncDispose;
            "#,
        )
        .catch(&ctx)
        .map_err(|error| {
            format!(
                "Failed to evaluate dispose module initialization:\n{}",
                super::format_caught_error(error)
            )
        })?
        .finish::<()>()
        .catch(&ctx)
        .map_err(|error| {
            format!(
                "Failed to finish dispose module initialization:\n{}",
                super::format_caught_error(error)
            )
        })?;
        Ok::<(), String>(())
    })
    .await
}

pub(crate) async fn initialize_builtin_wiring(ctx: &AsyncContext) -> Result<(), String> {
    async_with!(ctx => |ctx| {
        Module::evaluate(
            ctx.clone(),
            "__wasm_rquickjs_init_wiring",
            crate::builtin::wire_builtins(),
        )
        .catch(&ctx)
        .map_err(|error| {
            format!(
                "Failed to evaluate built-in wiring:\n{}",
                super::format_caught_error(error)
            )
        })?
        .finish::<()>()
        .catch(&ctx)
        .map_err(|error| {
            format!(
                "Failed to finish built-in wiring:\n{}",
                super::format_caught_error(error)
            )
        })?;
        Ok::<(), String>(())
    })
    .await
}

// RuntimeServices contains no JavaScript-lifetime-bound values.
unsafe impl<'js> JsLifetime<'js> for RuntimeServices {
    type Changed<'to> = RuntimeServices;
}

#[derive(Default)]
pub(crate) struct TimerServices {
    pub(crate) abort_handles: RefCell<HashMap<usize, AbortHandle>>,
    pub(crate) last_abort_id: AtomicUsize,
    pub(crate) unrefed_timers: RefCell<HashSet<usize>>,
}

impl TimerServices {
    pub(crate) fn abort_unrefed(&self) {
        let unrefed = self.unrefed_timers.borrow().clone();
        let mut abort_handles = self.abort_handles.borrow_mut();
        let mut unrefed_mut = self.unrefed_timers.borrow_mut();
        for id in &unrefed {
            if let Some(handle) = abort_handles.remove(id) {
                handle.abort();
            }
            unrefed_mut.remove(id);
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.abort_handles.borrow().is_empty() && self.unrefed_timers.borrow().is_empty()
    }
}
