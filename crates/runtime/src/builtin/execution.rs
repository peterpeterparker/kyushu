#[cfg(feature = "typescript-compiler-profiling")]
use crate::internal::runtime_services::{ExecutionProfile, ExecutionProfileSnapshot};
use crate::internal::runtime_services::{
    OwnedJsRuntime, RuntimeOutputSink, RuntimeServices, normalize_absolute_path,
};

use futures::future::{Either, pending, poll_fn, select};
use futures::task::AtomicWaker;
use rquickjs::{CatchResultExt, Ctx, Function, Module, Promise, Value, async_with};
use serde::Deserialize;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::Poll;
use std::time::{Duration, Instant};

#[path = "execution_timeout.rs"]
mod execution_timeout;
use execution_timeout::ExecutionTimeoutSampler;

const MAX_ACTIVE_JOBS: usize = 8;
const MAX_TIMEOUT_MS: u64 = u64::MAX / 1_000_000;
const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

pub const EXECUTION_JS: &str = include_str!("execution.js");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionOptions {
    entry: Option<String>,
    source: Option<String>,
    language: ExecutionLanguage,
    cwd: String,
    argv: Vec<String>,
    env: HashMap<String, String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    max_bytes: usize,
    overflow: OverflowPolicy,
}

#[derive(Deserialize, Copy, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
enum OverflowPolicy {
    Terminate,
    Truncate,
}

#[derive(Deserialize, Copy, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ExecutionLanguage {
    Javascript,
    Typescript,
}

pub(crate) struct ExecutionJob {
    options: RefCell<Option<ExecutionOptions>>,
    stdout: RefCell<VecDeque<String>>,
    stderr: RefCell<VecDeque<String>>,
    stdout_bytes: Cell<usize>,
    stderr_bytes: Cell<usize>,
    max_bytes: usize,
    overflow: OverflowPolicy,
    cancel: Arc<AtomicBool>,
    overflowed: Arc<AtomicBool>,
    timed_out: Arc<AtomicBool>,
    forgotten: AtomicBool,
    completion: RefCell<Option<Result<String, String>>>,
    event_waker: AtomicWaker,
    control_waker: AtomicWaker,
    #[cfg(feature = "typescript-compiler-profiling")]
    created_at: Instant,
    #[cfg(feature = "typescript-compiler-profiling")]
    profile: RefCell<Option<ExecutionProfileSnapshot>>,
}

impl ExecutionJob {
    fn new(options: ExecutionOptions) -> Self {
        Self {
            max_bytes: options.max_bytes,
            overflow: options.overflow,
            options: RefCell::new(Some(options)),
            stdout: RefCell::default(),
            stderr: RefCell::default(),
            stdout_bytes: Cell::new(0),
            stderr_bytes: Cell::new(0),
            cancel: Arc::new(AtomicBool::new(false)),
            overflowed: Arc::new(AtomicBool::new(false)),
            timed_out: Arc::new(AtomicBool::new(false)),
            forgotten: AtomicBool::new(false),
            completion: RefCell::default(),
            event_waker: AtomicWaker::new(),
            control_waker: AtomicWaker::new(),
            #[cfg(feature = "typescript-compiler-profiling")]
            created_at: Instant::now(),
            #[cfg(feature = "typescript-compiler-profiling")]
            profile: RefCell::default(),
        }
    }

    fn push(&self, stdout: bool, data: &str) {
        let count = if stdout {
            &self.stdout_bytes
        } else {
            &self.stderr_bytes
        };
        let remaining = self.max_bytes.saturating_sub(count.get());
        if data.len() > remaining {
            self.overflowed.store(true, Ordering::Relaxed);
            if self.overflow == OverflowPolicy::Terminate {
                self.cancel.store(true, Ordering::Relaxed);
                self.control_waker.wake();
            }
        }
        let mut accepted = data.len().min(remaining);
        while accepted > 0 && !data.is_char_boundary(accepted) {
            accepted -= 1;
        }
        if accepted == 0 {
            self.event_waker.wake();
            return;
        }
        count.set(count.get() + accepted);
        let chunk = data[..accepted].to_string();
        if stdout {
            self.stdout.borrow_mut().push_back(chunk);
        } else {
            self.stderr.borrow_mut().push_back(chunk);
        }
        self.event_waker.wake();
    }

    fn has_event(&self) -> bool {
        !self.stdout.borrow().is_empty()
            || !self.stderr.borrow().is_empty()
            || self.completion.borrow().is_some()
    }

    fn complete(&self, result: Result<String, String>) {
        *self.completion.borrow_mut() = Some(result);
        self.event_waker.wake();
    }
}

impl RuntimeOutputSink for ExecutionJob {
    fn write_stdout(&self, data: &str) {
        self.push(true, data);
    }
    fn write_stderr(&self, data: &str) {
        self.push(false, data);
    }
}

fn execution_control_error(job: &ExecutionJob, deadline: Option<Instant>) -> Option<&'static str> {
    if job.cancel.load(Ordering::Relaxed) {
        return Some("execution job cancelled");
    }
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        job.timed_out.store(true, Ordering::Relaxed);
        return Some("execution job timed out");
    }
    None
}

#[cfg(feature = "typescript-runtime")]
fn transform_typescript_execution_source(
    source: String,
    name: &str,
    source_map: bool,
) -> Result<String, String> {
    crate::internal::typescript::transform(
        source,
        name,
        crate::internal::typescript::runtime_mode(),
        source_map,
        Some(true),
    )
    .map(|output| output.into_code_with_inline_source_map())
    .map_err(|error| error.message)
}

#[cfg(not(feature = "typescript-runtime"))]
fn transform_typescript_execution_source(
    _source: String,
    _name: &str,
    _source_map: bool,
) -> Result<String, String> {
    Err("TypeScript runtime support is not enabled".to_string())
}

#[cfg(feature = "typescript-runtime")]
fn execution_source_maps_enabled(ctx: &Ctx<'_>) -> bool {
    crate::internal::typescript::source_maps_enabled(ctx)
}

#[cfg(not(feature = "typescript-runtime"))]
fn execution_source_maps_enabled(_ctx: &Ctx<'_>) -> bool {
    false
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PollResult {
    stdout: Vec<String>,
    stderr: Vec<String>,
    done: bool,
    value: Option<String>,
    error: Option<String>,
    overflowed: bool,
    #[cfg(feature = "typescript-compiler-profiling")]
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<ExecutionProfileSnapshot>,
}

#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use super::*;

    #[rquickjs::function]
    pub fn create_job(ctx: Ctx<'_>, options_json: String) -> rquickjs::Result<usize> {
        // The public JS wrapper owns option validation and defaults. These
        // checks defend the private native protocol against direct callers.
        let options: ExecutionOptions = serde_json::from_str(&options_json)
            .map_err(|error| rquickjs::Exception::throw_type(&ctx, &error.to_string()))?;
        if options.entry.is_some() == options.source.is_some() {
            return Err(rquickjs::Exception::throw_type(
                &ctx,
                "exactly one of entry or source is required",
            ));
        }
        if options.max_bytes == 0 || options.max_bytes > MAX_OUTPUT_BYTES {
            return Err(rquickjs::Exception::throw_range(
                &ctx,
                "maxBytes is outside the supported range",
            ));
        }
        if options.timeout_ms.is_some_and(|ms| {
            ms == 0
                || ms > MAX_TIMEOUT_MS
                || Instant::now()
                    .checked_add(Duration::from_millis(ms))
                    .is_none()
        }) {
            return Err(rquickjs::Exception::throw_range(
                &ctx,
                "timeoutMs is outside the supported range",
            ));
        }
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        if !services.execution_enabled.get() {
            return Err(rquickjs::Exception::throw_message(
                &ctx,
                "nested execution jobs are not supported",
            ));
        }
        if services.execution_jobs.borrow().len() >= MAX_ACTIVE_JOBS {
            return Err(rquickjs::Exception::throw_range(
                &ctx,
                &format!("execution supports at most {MAX_ACTIVE_JOBS} active jobs per runtime"),
            ));
        }
        let id = services.next_execution_job_id.get();
        services.next_execution_job_id.set(id.wrapping_add(1));
        let job = Rc::new(ExecutionJob::new(options));
        services.execution_jobs.borrow_mut().insert(id, job.clone());
        Ok(id)
    }

    /// Async native callbacks are owned and driven by rquickjs's promise
    /// machinery. Unlike a detached `Ctx::spawn` task, this remains live while
    /// the parent export awaits JavaScript promises on the P2 executor.
    #[rquickjs::function]
    pub async fn start_job(ctx: Ctx<'_>, id: usize) -> rquickjs::Result<()> {
        let job = {
            let services = ctx
                .userdata::<RuntimeServices>()
                .expect("runtime services not initialized");
            let jobs = services.execution_jobs.borrow();
            jobs.get(&id).cloned()
        }
        .ok_or_else(|| rquickjs::Exception::throw_range(&ctx, "unknown execution job"))?;
        let options = job.options.borrow_mut().take().ok_or_else(|| {
            rquickjs::Exception::throw_range(&ctx, "execution job already started")
        })?;
        run_job(options, job).await;
        Ok(())
    }

    #[rquickjs::function]
    pub async fn wait_job_event(ctx: Ctx<'_>, id: usize) -> rquickjs::Result<String> {
        let job = {
            let services = ctx
                .userdata::<RuntimeServices>()
                .expect("runtime services not initialized");
            let jobs = services.execution_jobs.borrow();
            jobs.get(&id).cloned()
        }
        .ok_or_else(|| rquickjs::Exception::throw_range(&ctx, "unknown execution job"))?;
        poll_fn(|cx| {
            if job.has_event() || job.forgotten.load(Ordering::Relaxed) {
                return Poll::Ready(());
            }
            job.event_waker.register(cx.waker());
            if job.has_event() || job.forgotten.load(Ordering::Relaxed) {
                Poll::Ready(())
            } else {
                Poll::Pending
            }
        })
        .await;
        if job.forgotten.load(Ordering::Relaxed) {
            return Err(rquickjs::Exception::throw_range(
                &ctx,
                "unknown execution job",
            ));
        }
        let completion = job.completion.borrow();
        let (done, value, error) = match completion.as_ref() {
            Some(Ok(value)) => (true, Some(value.clone()), None),
            Some(Err(error)) => (true, None, Some(error.clone())),
            None => (false, None, None),
        };
        serde_json::to_string(&PollResult {
            stdout: job.stdout.borrow_mut().drain(..).collect(),
            stderr: job.stderr.borrow_mut().drain(..).collect(),
            done,
            value,
            error,
            overflowed: job.overflowed.load(Ordering::Relaxed),
            #[cfg(feature = "typescript-compiler-profiling")]
            profile: job.profile.borrow_mut().take(),
        })
        .map_err(|error| rquickjs::Exception::throw_message(&ctx, &error.to_string()))
    }

    #[rquickjs::function]
    pub fn cancel_job(ctx: Ctx<'_>, id: usize) -> bool {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        let Some(job) = services.execution_jobs.borrow().get(&id).cloned() else {
            return false;
        };
        job.cancel.store(true, Ordering::Relaxed);
        job.control_waker.wake();
        job.event_waker.wake();
        true
    }

    #[rquickjs::function]
    pub fn forget_job(ctx: Ctx<'_>, id: usize) {
        let job = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized")
            .execution_jobs
            .borrow_mut()
            .remove(&id);
        if let Some(job) = job {
            job.forgotten.store(true, Ordering::Relaxed);
            job.control_waker.wake();
            job.event_waker.wake();
        }
    }
}

async fn run_job(options: ExecutionOptions, job: Rc<ExecutionJob>) {
    if job.cancel.load(Ordering::Relaxed) {
        job.complete(Err("execution job cancelled".to_string()));
        return;
    }
    #[cfg(feature = "typescript-compiler-profiling")]
    let profile = {
        let started = Instant::now();
        let profile = Rc::new(ExecutionProfile::new(started));
        profile.set_duration(
            "queueDelay",
            started.saturating_duration_since(job.created_at),
        );
        profile
    };
    #[cfg(feature = "typescript-compiler-profiling")]
    let runtime = OwnedJsRuntime::new_profiled(profile.clone()).await;
    #[cfg(not(feature = "typescript-compiler-profiling"))]
    let runtime = OwnedJsRuntime::new().await;

    macro_rules! mark_profile {
        ($name:literal) => {
            #[cfg(feature = "typescript-compiler-profiling")]
            profile.mark($name);
        };
    }
    macro_rules! complete_job {
        ($result:expr) => {{
            drop(runtime);
            #[cfg(feature = "typescript-compiler-profiling")]
            {
                profile.mark("teardown");
                *job.profile.borrow_mut() = Some(profile.snapshot());
            }
            job.complete($result);
            return;
        }};
    }

    runtime.disable_execution().await;
    let cancelled = job.cancel.clone();
    runtime
        .rt
        .set_interrupt_handler(Some(Box::new(move || cancelled.load(Ordering::Relaxed))))
        .await;
    let cwd = match normalize_absolute_path(Path::new(&options.cwd)) {
        Ok(cwd) => cwd,
        Err(error) => {
            complete_job!(Err(error.to_string()));
        }
    };
    let entry = match options.entry {
        Some(entry) => {
            let entry = PathBuf::from(entry);
            let anchored = if entry.is_absolute() {
                entry
            } else {
                cwd.join(entry)
            };
            match normalize_absolute_path(&anchored) {
                Ok(entry) => Some(entry),
                Err(error) => {
                    complete_job!(Err(error.to_string()));
                }
            }
        }
        None => None,
    };
    let mut argv = options.argv;
    if argv.is_empty() {
        argv.push("wasm-rquickjs-execution".to_string());
        if let Some(entry) = &entry {
            argv.push(entry.to_string_lossy().into_owned());
        }
    }
    if let Err(error) = runtime
        .configure_process(argv, options.env, cwd.clone())
        .await
    {
        complete_job!(Err(error));
    }
    mark_profile!("processConfiguration");
    runtime.set_output_sink(job.clone()).await;
    if let Err(error) = runtime.initialize_node_builtins().await {
        complete_job!(Err(error));
    }
    mark_profile!("builtinInitialization");
    let transport_wiring = async_with!(runtime.ctx => |ctx| {
        Module::evaluate(
            ctx.clone(),
            "__wasm_rquickjs_execution_transport",
            r#"
            import { serializeForTransport } from '__wasm_rquickjs_builtin/structured_clone';
            Object.defineProperty(globalThis, '__wasmRquickjsSerializeExecutionResult', {
                configurable: false,
                enumerable: false,
                writable: false,
                value: value => serializeForTransport(value, { rejectCustom: true }),
            });
            "#,
        )
        .catch(&ctx)
        .map_err(crate::internal::format_caught_error)?
        .finish::<()>()
        .catch(&ctx)
        .map_err(crate::internal::format_caught_error)
    })
    .await;
    if let Err(error) = transport_wiring {
        complete_job!(Err(error));
    }
    mark_profile!("transportWiring");
    if job.cancel.load(Ordering::Relaxed) {
        complete_job!(Err("execution job cancelled".to_string()));
    }

    // The public timeout budget starts when user code begins, after runtime and
    // builtin initialization. The interrupt handler is also needed for tight
    // loops that cannot cooperatively yield to the timer future.
    let timeout = options.timeout_ms.and_then(|ms| {
        let started_at = Instant::now();
        let duration = Duration::from_millis(ms);
        started_at
            .checked_add(duration)
            .map(|deadline| (started_at, deadline, duration))
    });
    let deadline = timeout.map(|(_, deadline, _)| deadline);
    let mut timeout_sampler = timeout.map(|(started_at, deadline, duration)| {
        ExecutionTimeoutSampler::new(started_at, deadline, duration)
    });
    let cancelled = job.cancel.clone();
    let timed_out = job.timed_out.clone();
    runtime
        .rt
        .set_interrupt_handler(Some(Box::new(move || {
            if cancelled.load(Ordering::Relaxed) {
                return true;
            }
            if timeout_sampler
                .as_mut()
                .is_some_and(|sampler| sampler.expired(Instant::now))
            {
                timed_out.store(true, Ordering::Relaxed);
                return true;
            }
            false
        })))
        .await;

    let is_inline = entry.is_none();
    let wrapper_name = cwd.join(if is_inline {
        "__wasm_rquickjs_execution_inline.mjs"
    } else {
        "__wasm_rquickjs_execution_entry.mjs"
    });
    let name = wrapper_name.to_string_lossy().into_owned();
    let mut source = if let Some(entry) = entry {
        let specifier =
            serde_json::to_string(&entry.to_string_lossy()).expect("path string is serializable");
        format!(
            "globalThis.__wasmRquickjsExecutionResult = (async () => {{
               const module = await import({specifier});
               const entrypoint = typeof module.default === 'function' ? module.default : module.run;
               const value = typeof entrypoint === 'function' ? await entrypoint() : module.default;
               return __wasmRquickjsSerializeExecutionResult(value);
             }})();"
        )
    } else {
        format!(
            "globalThis.__wasmRquickjsExecutionResult = (async () => __wasmRquickjsSerializeExecutionResult(await (async () => {{\n{}\n}})()))();",
            options.source.unwrap_or_default()
        )
    };
    let source_maps_enabled = if options.language == ExecutionLanguage::Typescript {
        async_with!(runtime.ctx => |ctx| { execution_source_maps_enabled(&ctx) }).await
    } else {
        false
    };
    mark_profile!("wrapperPreparation");
    if options.language == ExecutionLanguage::Typescript {
        if let Some(error) = execution_control_error(&job, deadline) {
            complete_job!(Err(error.to_string()));
        }
        source = match transform_typescript_execution_source(source, &name, source_maps_enabled) {
            Ok(source) => source,
            Err(error) => {
                complete_job!(Err(error));
            }
        };
        if let Some(error) = execution_control_error(&job, deadline) {
            complete_job!(Err(error.to_string()));
        }
        mark_profile!("typescriptTransform");
    }
    #[cfg(feature = "typescript-compiler-profiling")]
    let execution_profile = profile.clone();
    let result = {
        let execution = async {
            async_with!(runtime.ctx => |ctx| {
                if (options.language == ExecutionLanguage::Typescript || is_inline)
                    && let Ok(register_source_map) = ctx.globals().get::<_, Function>(
                        "__wasm_rquickjs_register_transformed_source_map",
                    )
                {
                    let (line_offset, original_line_offset, force_line_offset) =
                        if options.language == ExecutionLanguage::Typescript && source_maps_enabled {
                            (0, usize::from(is_inline), false)
                        } else if is_inline {
                            (1, 0, true)
                        } else {
                            (0, 0, false)
                        };
                    register_source_map
                        .call::<_, ()>((
                            name.as_str(),
                            source.as_str(),
                            Value::new_null(ctx.clone()),
                            line_offset,
                            original_line_offset,
                            force_line_offset,
                        ))
                        .map_err(|error| {
                            format!("failed to register execution source map: {error:?}")
                        })?;
                }
                Module::evaluate(ctx.clone(), name, source).catch(&ctx)
                    .map_err(|e| crate::internal::format_caught_error(e))?.finish::<()>().catch(&ctx)
                    .map_err(|e| crate::internal::format_caught_error(e))?;
                #[cfg(feature = "typescript-compiler-profiling")]
                execution_profile.mark("initialEvaluation");
                let promise: Promise = ctx.globals().get("__wasmRquickjsExecutionResult")
                    .map_err(|e| format!("execution result unavailable: {e:?}"))?;
                let result = promise
                    .into_future::<String>()
                    .await
                    .catch(&ctx)
                    .map_err(crate::internal::format_caught_error);
                #[cfg(feature = "typescript-compiler-profiling")]
                execution_profile.mark("userAwait");
                result
            })
            .await
        };
        let cancellation = poll_fn(|cx| {
            if job.overflowed.load(Ordering::Relaxed) && job.overflow == OverflowPolicy::Terminate {
                return Poll::Ready(Err("execution output exceeded maxBytes".to_string()));
            }
            if job.cancel.load(Ordering::Relaxed) {
                return Poll::Ready(Err("execution job cancelled".to_string()));
            }
            job.control_waker.register(cx.waker());
            if job.overflowed.load(Ordering::Relaxed) && job.overflow == OverflowPolicy::Terminate {
                Poll::Ready(Err("execution output exceeded maxBytes".to_string()))
            } else if job.cancel.load(Ordering::Relaxed) {
                Poll::Ready(Err("execution job cancelled".to_string()))
            } else {
                Poll::Pending
            }
        });
        let timeout = async {
            match deadline {
                Some(deadline) => {
                    sleep_until_execution_deadline(deadline).await;
                    job.timed_out.store(true, Ordering::Relaxed);
                    Err("execution job timed out".to_string())
                }
                None => pending().await,
            }
        };
        futures::pin_mut!(execution, cancellation, timeout);
        let control = select(cancellation, timeout);
        futures::pin_mut!(control);
        let result = match select(execution, control).await {
            Either::Left((result, _)) => result,
            Either::Right((Either::Left((result, _)), _)) => result,
            Either::Right((Either::Right((result, _)), _)) => result,
        };
        if job.timed_out.load(Ordering::Relaxed) {
            Err("execution job timed out".to_string())
        } else if job.overflowed.load(Ordering::Relaxed)
            && job.overflow == OverflowPolicy::Terminate
        {
            Err("execution output exceeded maxBytes".to_string())
        } else if job.cancel.load(Ordering::Relaxed) {
            Err("execution job cancelled".to_string())
        } else {
            result
        }
    };
    mark_profile!("resultFormatting");
    complete_job!(result);
}

async fn sleep_until_execution_deadline(deadline: Instant) {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return;
        }
        sleep_for_execution_timeout(remaining).await;
    }
}

async fn sleep_for_execution_timeout(duration: Duration) {
    #[cfg(feature = "p2")]
    wstd::task::sleep(duration.into()).await;

    #[cfg(feature = "p3")]
    wasip3::clocks::monotonic_clock::wait_for(duration.as_nanos().min(u64::MAX as u128) as u64)
        .await;
}
