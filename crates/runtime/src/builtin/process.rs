// Native functions for the process implementation
#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::Ctx;
    use std::collections::HashMap;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::Instant;

    #[rquickjs::function]
    pub fn memory_usage(ctx: Ctx<'_>) -> Vec<i64> {
        let rt = unsafe { rquickjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr()) };
        let mut stats = std::mem::MaybeUninit::uninit();
        unsafe { rquickjs::qjs::JS_ComputeMemoryUsage(rt, stats.as_mut_ptr()) };
        let stats = unsafe { stats.assume_init() };
        vec![
            stats.malloc_size,
            stats.memory_used_size,
            stats.obj_size,
            stats.binary_object_size,
        ]
    }

    #[rquickjs::function]
    pub fn write_stdout(data: String) {
        let _ = std::io::stdout().write_all(data.as_bytes());
        let _ = std::io::stdout().flush();
    }

    #[rquickjs::function]
    pub fn write_stderr(data: String) {
        let _ = std::io::stderr().write_all(data.as_bytes());
        let _ = std::io::stderr().flush();
    }

    #[rquickjs::function]
    pub fn get_args() -> Vec<String> {
        std::env::args().collect()
    }

    #[rquickjs::function]
    pub fn get_env() -> HashMap<String, String> {
        std::env::vars().collect()
    }

    #[rquickjs::function]
    pub fn get_cwd() -> String {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .to_string_lossy()
            .into_owned()
    }

    #[rquickjs::function]
    pub fn chdir(path: String) -> Option<String> {
        match std::env::set_current_dir(path) {
            Ok(()) => None,
            Err(error) => Some(
                match error.kind() {
                    std::io::ErrorKind::NotFound => "ENOENT",
                    std::io::ErrorKind::PermissionDenied => "EACCES",
                    _ => "EINVAL",
                }
                .to_string(),
            ),
        }
    }

    #[rquickjs::function]
    pub fn hrtime_ns() -> u64 {
        use std::sync::OnceLock;
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        let origin = ORIGIN.get_or_init(Instant::now);
        origin.elapsed().as_nanos() as u64
    }
}

// JS functions for the process implementation
pub const PROCESS_JS: &str = include_str!("process.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:process'; export { default } from 'node:process';"#;

pub const WIRE_JS: &str = r#"
        import __wasm_rquickjs_process from 'node:process';
        globalThis.process = __wasm_rquickjs_process;
    "#;
