#[rquickjs::module]
pub mod native_module {
    use rquickjs::Ctx;

    #[rquickjs::function]
    pub fn gc(ctx: Ctx<'_>) {
        ctx.run_gc();
    }
}

pub const WIRE_JS: &str = r#"
        import { gc as __wasm_rquickjs_gc } from '__wasm_rquickjs_builtin/gc_native';
        globalThis.gc = function gc() {
            if (typeof globalThis.__wasm_rquickjs_pre_gc === 'function') {
                globalThis.__wasm_rquickjs_pre_gc();
            }
            // Defer the actual cycle-detecting GC to run after the current
            // JS execution completes.  QuickJS's JS_RunGC has a known issue
            // where running it while async function generator states are on
            // the call stack can cause use-after-free of closure variables.
            // Observable cleanup (pre_gc hooks) still runs synchronously.
            globalThis.setTimeout(__wasm_rquickjs_gc, 0);
        };
    "#;
