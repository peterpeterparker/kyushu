use crate::internal::{format_caught_error, runtime_services::RuntimeServices};
use rquickjs::function::Args;
use rquickjs::{CatchResultExt, Ctx, Persistent, Value};

// Native functions for the timeout implementation
#[rquickjs::module]
pub mod native_module {
    use crate::internal::runtime_services::RuntimeServices;
    use futures::future::abortable;
    use rquickjs::{Ctx, Persistent, Value};
    use std::sync::atomic::Ordering;

    #[rquickjs::function]
    pub fn schedule(
        ctx: Ctx<'_>,
        code_or_fn: Persistent<Value<'static>>,
        delay: u32,
        periodic: bool,
        args: Persistent<Vec<Value<'static>>>,
    ) -> usize {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        let key = services
            .timers
            .last_abort_id
            .fetch_add(1, Ordering::Relaxed);

        let (task, abort_handle) = abortable(super::scheduled_task(
            ctx.clone(),
            code_or_fn,
            delay,
            periodic,
            args,
            key,
        ));
        services
            .timers
            .abort_handles
            .borrow_mut()
            .insert(key, abort_handle);
        drop(services);
        let task_ctx = ctx.clone();
        ctx.spawn(async move {
            let _ = task.await;
            // Clean up after the task completes naturally
            let services = task_ctx
                .userdata::<RuntimeServices>()
                .expect("runtime services not initialized");
            services.timers.abort_handles.borrow_mut().remove(&key);
            services.timers.unrefed_timers.borrow_mut().remove(&key);
        });
        key
    }

    #[rquickjs::function]
    pub fn clear_schedule(ctx: Ctx<'_>, timeout_id: usize) {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        services
            .timers
            .unrefed_timers
            .borrow_mut()
            .remove(&timeout_id);
        let mut abort_handles = services.timers.abort_handles.borrow_mut();
        if let Some(handle) = abort_handles.remove(&timeout_id) {
            handle.abort();
        }
    }

    #[rquickjs::function]
    pub fn unref_schedule(ctx: Ctx<'_>, timeout_id: usize) {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        services
            .timers
            .unrefed_timers
            .borrow_mut()
            .insert(timeout_id);
    }

    #[rquickjs::function]
    pub fn ref_schedule(ctx: Ctx<'_>, timeout_id: usize) {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        services
            .timers
            .unrefed_timers
            .borrow_mut()
            .remove(&timeout_id);
    }

    #[rquickjs::function]
    pub fn ref_timer_count(ctx: Ctx<'_>) -> usize {
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        let total = services.timers.abort_handles.borrow().len();
        let unrefed = services.timers.unrefed_timers.borrow().len();
        total.saturating_sub(unrefed)
    }
}

// JS functions for the timeout implementation
pub const TIMEOUT_JS: &str = include_str!("timeout.js");

// JS code wiring the timeout module into the global context
pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_timeout from '__wasm_rquickjs_builtin/timeout';
        globalThis.setTimeout = __wasm_rquickjs_timeout.setTimeout;
        globalThis.setImmediate = __wasm_rquickjs_timeout.setImmediate;
        globalThis.setInterval = __wasm_rquickjs_timeout.setInterval;
        globalThis.clearTimeout = __wasm_rquickjs_timeout.clearTimeout;
        globalThis.clearInterval = __wasm_rquickjs_timeout.clearInterval;
        globalThis.clearImmediate = __wasm_rquickjs_timeout.clearImmediate;
        globalThis.__wasm_rquickjs_ref_timer_count = __wasm_rquickjs_timeout.getRefTimerCount;
    "#;

async fn scheduled_task(
    ctx: Ctx<'_>,
    code_or_fn: Persistent<Value<'static>>,
    delay: u32,
    periodic: bool,
    args: Persistent<Vec<Value<'static>>>,
    timer_key: usize,
) {
    #[cfg(feature = "p2")]
    let duration = wstd::time::Duration::from_millis(delay as u64);

    #[cfg(feature = "p3")]
    let duration_ns = (delay as u64).saturating_mul(1_000_000);

    loop {
        #[cfg(feature = "p2")]
        wstd::task::sleep(duration).await;

        #[cfg(feature = "p3")]
        wasip3::clocks::monotonic_clock::wait_for(duration_ns).await;

        run_scheduled_task(ctx.clone(), code_or_fn.clone(), args.clone())
            .catch(&ctx)
            .unwrap_or_else(|e| {
                eprintln!(
                    "Timer callback error escaped JS uncaught handler: {}",
                    format_caught_error(e)
                )
            });

        if !periodic {
            break;
        }

        // Check if the timer was cancelled during the callback
        let services = ctx
            .userdata::<RuntimeServices>()
            .expect("runtime services not initialized");
        if !services
            .timers
            .abort_handles
            .borrow()
            .contains_key(&timer_key)
        {
            break;
        }
    }
}

fn run_scheduled_task(
    ctx: Ctx,
    code_or_fn: Persistent<Value<'static>>,
    args: Persistent<Vec<Value<'static>>>,
) -> rquickjs::Result<()> {
    let restored_code_or_fn = code_or_fn.restore(&ctx)?;
    let restored_args = args.restore(&ctx)?;

    let result = if let Some(func) = restored_code_or_fn.as_function() {
        let mut args = Args::new(ctx.clone(), restored_args.len());
        args.push_args(&restored_args)?;
        func.call_arg(args)
    } else if let Some(code) = restored_code_or_fn.as_string() {
        ctx.eval(code.to_string()?)
    } else {
        eprintln!("Unsupported value passed to setTimeout or setInterval: {restored_code_or_fn:?}");
        Ok(())
    };

    result?;

    while ctx.execute_pending_job() {}

    Ok(())
}
