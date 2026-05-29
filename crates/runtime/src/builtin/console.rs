// Native functions for the console implementation
#[rquickjs::module(rename_vars = "camelCase")]
pub mod native_module {
    #[rquickjs::function]
    pub fn println(line: String) {
        println!("{line}");
    }

    #[rquickjs::function]
    pub fn trace(line: String) {
        log_line(LogLevel::Trace, &line);
    }

    #[rquickjs::function]
    pub fn debug(line: String) {
        log_line(LogLevel::Debug, &line);
    }

    #[rquickjs::function]
    pub fn info(line: String) {
        log_line(LogLevel::Info, &line);
    }

    #[rquickjs::function]
    pub fn warn(line: String) {
        log_line(LogLevel::Warn, &line);
    }

    #[rquickjs::function]
    pub fn error(line: String) {
        log_line(LogLevel::Error, &line);
    }

    enum LogLevel {
        Trace,
        Debug,
        Info,
        Warn,
        Error,
    }

    #[cfg(not(feature = "logging"))]
    fn log_line(level: LogLevel, line: &str) {
        let prefix = match level {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        };
        println!("{prefix}: {line}");
    }

    #[cfg(feature = "logging")]
    fn log_line(level: LogLevel, line: &str) {
        let wasi_level = match level {
            LogLevel::Trace => wasi_logging::Level::Trace,
            LogLevel::Debug => wasi_logging::Level::Debug,
            LogLevel::Info => wasi_logging::Level::Info,
            LogLevel::Warn => wasi_logging::Level::Warn,
            LogLevel::Error => wasi_logging::Level::Error,
        };
        wasi_logging::log(wasi_level, "", line);
    }

    #[rquickjs::function]
    pub fn is_logging_enabled() -> bool {
        cfg!(feature = "logging")
    }

    #[rquickjs::function]
    pub fn timestamp() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or_default()
    }
}

// JS functions for the console implementation
pub const CONSOLE_JS: &str = include_str!("console.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:console'; import { Console } from 'node:console'; const c = globalThis.console; c.Console = Console; export default c;"#;

// JS code wiring the console module into the global context
pub const WIRE_JS: &str = "import { default as __console } from '__wasm_rquickjs_builtin/console'; globalThis.console = __console;";
