use rquickjs::qjs;
use rquickjs::{CaughtError, Persistent, Value};
use std::ptr::NonNull;

#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::{Ctx, Value};

    /// Evaluate `code` in a brand-new QuickJS context that shares the same
    /// runtime (and therefore the same object heap). Sandbox properties are
    /// copied to the new context's global object before evaluation, and the
    /// result is returned as a value in the *calling* context.
    #[rquickjs::function]
    pub fn eval_in_new_context<'js>(
        ctx: Ctx<'js>,
        code: String,
        sandbox_keys: Vec<String>,
        sandbox_values: Vec<Value<'js>>,
    ) -> rquickjs::Result<Value<'js>> {
        super::eval_in_new_context_impl(ctx, &code, &sandbox_keys, &sandbox_values)
    }

    /// Evaluate JavaScript code with a specified filename.
    /// This ensures that `import()` inside the eval'd code uses the given
    /// filename as the module referrer for resolution.
    #[rquickjs::function]
    pub fn eval_with_filename<'js>(
        ctx: Ctx<'js>,
        code: String,
        filename: String,
    ) -> rquickjs::Result<Value<'js>> {
        super::eval_with_filename_impl(ctx, &code, &filename)
    }

    /// Load an ES module by filename and return its namespace object.
    /// This implements `require()` of ES modules (Node.js --experimental-require-module).
    /// The module goes through the normal ESM resolver/loader chain.
    #[rquickjs::function]
    pub fn require_esm<'js>(ctx: Ctx<'js>, filename: String) -> rquickjs::Result<Value<'js>> {
        super::require_esm_impl(ctx, &filename)
    }
}

fn eval_in_new_context_impl<'js>(
    caller_ctx: rquickjs::Ctx<'js>,
    code: &str,
    sandbox_keys: &[String],
    sandbox_values: &[rquickjs::Value<'js>],
) -> rquickjs::Result<rquickjs::Value<'js>> {
    // Save sandbox values as Persistent so they can be restored in the new context.
    let persistent_values: Vec<Persistent<Value<'static>>> = sandbox_values
        .iter()
        .map(|v| Persistent::save(&caller_ctx, v.clone()))
        .collect();

    // --- Minimal unsafe boundary: create a new JSContext on the same runtime ---
    // This is the only part that cannot be done with safe rquickjs APIs, because
    // we are inside a callback where the runtime lock is already held.
    let new_ctx: rquickjs::Ctx<'js> = unsafe {
        let rt = qjs::JS_GetRuntime(caller_ctx.as_raw().as_ptr());
        let raw_ctx = qjs::JS_NewContext(rt);
        let nn = NonNull::new(raw_ctx).ok_or(rquickjs::Error::Unknown)?;
        // Ctx::from_raw dups the context; we must free our original reference.
        let ctx = rquickjs::Ctx::from_raw(nn);
        qjs::JS_FreeContext(raw_ctx);
        ctx
    };

    // --- Everything below uses safe rquickjs APIs ---

    // Restore sandbox values into the new context's global object
    let new_global = new_ctx.globals();
    for (key, pval) in sandbox_keys.iter().zip(persistent_values) {
        let restored: Value<'js> = pval
            .restore(&new_ctx)
            .map_err(|_| rquickjs::Error::Unknown)?;
        new_global.set(key.as_str(), restored)?;
    }

    // Evaluate the code in the new context
    let eval_result: Result<Value<'js>, _> = new_ctx.eval(code);

    match eval_result {
        Ok(result) => {
            // Save the result as Persistent, then restore in the caller's context
            let persistent_result = Persistent::save(&new_ctx, result);
            let caller_result: Value<'js> = persistent_result
                .restore(&caller_ctx)
                .map_err(|_| rquickjs::Error::Unknown)?;
            Ok(caller_result)
        }
        Err(err) => {
            // Catch the exception from the new context and re-throw in the caller
            let caught = CaughtError::catch(&new_ctx, Err::<(), _>(err));
            if let Err(CaughtError::Exception(exc)) = caught {
                let msg: String = exc
                    .message()
                    .unwrap_or_else(|| "Error in vm.runInNewContext".to_string());
                let name: String = exc
                    .get::<_, rquickjs::String>("name")
                    .ok()
                    .and_then(|s| s.to_string().ok())
                    .unwrap_or_else(|| "Error".to_string());

                // Re-throw in the caller's context
                let err_code = format!(
                    "(() => {{ throw new {}({}) }})()",
                    name,
                    serde_json_mini_quote(&msg),
                );
                let _: Result<Value<'js>, _> = caller_ctx.eval(err_code);
                Err(rquickjs::Error::Exception)
            } else if let Err(CaughtError::Value(val)) = caught {
                // Non-Error throw (e.g. `throw "string"`)
                let persistent_val = Persistent::save(&new_ctx, val);
                if let Ok(restored) = persistent_val.restore(&caller_ctx) {
                    caller_ctx.throw(restored);
                }
                Err(rquickjs::Error::Exception)
            } else {
                Err(rquickjs::Error::Unknown)
            }
        }
    }
}

fn require_esm_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    filename: &str,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    use std::ffi::CString;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_key_str = format!("__wasm_rquickjs_require_esm_{}", id);
    let wrapper_name = format!("<require-esm-{}>", id);

    // Build a file:// URL for the target module so it goes through
    // the FileUrlResolver → ImportMetaLoader chain.
    let file_url = if filename.starts_with("file://") {
        filename.to_string()
    } else if filename.starts_with('/') {
        format!("file://{}", filename)
    } else {
        format!("file:///{}", filename)
    };

    // Escape the URL for use inside a JS string literal
    let escaped_url = file_url
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");

    // Create a wrapper module that imports the target and stores the namespace
    // in a global variable. After evaluation, we read and clean up the global.
    let code = format!(
        "import * as __ns from \"{}\"; globalThis.{} = __ns;\n",
        escaped_url, temp_key_str
    );

    let src = CString::new(code.as_str()).map_err(|_| rquickjs::Error::Unknown)?;
    let fname = CString::new(wrapper_name.as_str()).map_err(|_| rquickjs::Error::Unknown)?;

    let globals = ctx.globals();

    if cached_async_esm_module(&globals, filename, &file_url) {
        return throw_require_async_module(ctx, &globals, filename);
    }

    unsafe {
        let val = qjs::JS_Eval(
            ctx.as_raw().as_ptr(),
            src.as_ptr(),
            code.len() as _,
            fname.as_ptr(),
            qjs::JS_EVAL_TYPE_MODULE as i32,
        );
        if qjs::JS_IsException(val) {
            return Err(rquickjs::Error::Exception);
        }

        // If the module evaluation returned a Promise (TLA), attach a no-op
        // .catch() handler so any rejection is marked as handled and doesn't
        // trigger an unhandledRejection event. We'll report TLA as
        // ERR_REQUIRE_ASYNC_MODULE below instead.
        let tag = qjs::JS_VALUE_GET_TAG(val);
        if tag == qjs::JS_TAG_OBJECT {
            let catch_str = CString::new("catch").unwrap();
            let catch_fn = qjs::JS_GetPropertyStr(ctx.as_raw().as_ptr(), val, catch_str.as_ptr());
            if !qjs::JS_IsUndefined(catch_fn) && !qjs::JS_IsException(catch_fn) {
                // Create a no-op function: function() {}
                let noop_code = CString::new("(function(){})").unwrap();
                let noop_fname = CString::new("<noop>").unwrap();
                let noop_fn = qjs::JS_Eval(
                    ctx.as_raw().as_ptr(),
                    noop_code.as_ptr(),
                    14,
                    noop_fname.as_ptr(),
                    qjs::JS_EVAL_TYPE_GLOBAL as i32,
                );
                if !qjs::JS_IsException(noop_fn) {
                    // Call promise.catch(noop)
                    let result = qjs::JS_Call(
                        ctx.as_raw().as_ptr(),
                        catch_fn,
                        val,
                        1,
                        &noop_fn as *const _ as *mut _,
                    );
                    if !qjs::JS_IsException(result) {
                        qjs::JS_FreeValue(ctx.as_raw().as_ptr(), result);
                    }
                    qjs::JS_FreeValue(ctx.as_raw().as_ptr(), noop_fn);
                }
                qjs::JS_FreeValue(ctx.as_raw().as_ptr(), catch_fn);
            }
        }

        // Free the return value (Promise from module evaluation)
        qjs::JS_FreeValue(ctx.as_raw().as_ptr(), val);
    }

    // Read the namespace from globalThis and clean up
    let ns: Value = globals.get(temp_key_str.as_str())?;

    // Clean up the global property
    globals.remove(temp_key_str.as_str())?;

    if ns.is_undefined() {
        // Module didn't store the namespace — likely has top-level await (TLA)
        // and the module evaluation Promise hasn't resolved synchronously.
        // Throw ERR_REQUIRE_ASYNC_MODULE matching Node.js behavior.
        mark_async_esm_module(&ctx, &globals, filename, &file_url)?;
        throw_require_async_module(ctx, &globals, filename)
    } else {
        Ok(ns)
    }
}

fn cached_async_esm_module<'js>(
    globals: &rquickjs::Object<'js>,
    filename: &str,
    file_url: &str,
) -> bool {
    let Ok(registry) = globals.get::<_, rquickjs::Object>("__wasm_rquickjs_async_esm_modules")
    else {
        return false;
    };

    registry.get::<_, bool>(filename).unwrap_or(false)
        || registry.get::<_, bool>(file_url).unwrap_or(false)
}

fn mark_async_esm_module<'js>(
    ctx: &rquickjs::Ctx<'js>,
    globals: &rquickjs::Object<'js>,
    filename: &str,
    file_url: &str,
) -> rquickjs::Result<()> {
    let registry = match globals.get::<_, rquickjs::Value>("__wasm_rquickjs_async_esm_modules") {
        Ok(value) if value.is_object() => value.into_object().unwrap(),
        _ => {
            let object = rquickjs::Object::new(ctx.clone())?;
            globals.set("__wasm_rquickjs_async_esm_modules", object.clone())?;
            object
        }
    };
    registry.set(filename, true)?;
    registry.set(file_url, true)?;
    Ok(())
}

fn throw_require_async_module<'js>(
    ctx: rquickjs::Ctx<'js>,
    globals: &rquickjs::Object<'js>,
    filename: &str,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let error_ctor: rquickjs::Function = globals.get("Error")?;
    let msg = format!(
        "require() cannot be used on an ESM graph with top-level await. Use import() instead. Module: {}",
        filename
    );
    let error_obj: rquickjs::Object = error_ctor.call((&msg,))?;
    error_obj.set("code", "ERR_REQUIRE_ASYNC_MODULE")?;
    Err(ctx.throw(error_obj.into_value()))
}

fn eval_with_filename_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    code: &str,
    filename: &str,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    use std::ffi::CString;

    let src = CString::new(code).map_err(|_| rquickjs::Error::Unknown)?;
    let fname = CString::new(filename).map_err(|_| rquickjs::Error::Unknown)?;
    let temp_key = c"__wasm_rquickjs_eval_tmp";

    unsafe {
        let val = qjs::JS_Eval(
            ctx.as_raw().as_ptr(),
            src.as_ptr(),
            code.len() as _,
            fname.as_ptr(),
            qjs::JS_EVAL_TYPE_GLOBAL as i32,
        );
        if qjs::JS_IsException(val) {
            return Err(rquickjs::Error::Exception);
        }
        let global = qjs::JS_GetGlobalObject(ctx.as_raw().as_ptr());
        qjs::JS_SetPropertyStr(ctx.as_raw().as_ptr(), global, temp_key.as_ptr(), val);
        qjs::JS_FreeValue(ctx.as_raw().as_ptr(), global);
    }
    let globals = ctx.globals();
    let result: Value = globals.get("__wasm_rquickjs_eval_tmp")?;
    globals.remove("__wasm_rquickjs_eval_tmp")?;
    Ok(result)
}

/// Minimal JSON string quoting for error messages.
fn serde_json_mini_quote(s: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < '\x20' => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// JS source for the vm module
pub const VM_JS: &str = include_str!("vm.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from '__wasm_rquickjs_builtin/vm'; export { default } from '__wasm_rquickjs_builtin/vm';"#;
