#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    #[rquickjs::function]
    pub fn arch() -> &'static str {
        "wasi"
    }

    #[rquickjs::function]
    pub fn available_parallelism() -> u16 {
        1
    }

    #[rquickjs::function]
    pub fn endianness() -> &'static str {
        "LE"
    }

    #[rquickjs::function]
    pub fn platform() -> &'static str {
        "wasm"
    }

    #[rquickjs::function]
    pub fn release() -> &'static str {
        "0.2.3"
    }

    #[rquickjs::function]
    pub fn type_() -> &'static str {
        "wasm-rquickjs"
    }

    #[rquickjs::function]
    pub fn hostname() -> &'static str {
        "localhost"
    }

    #[rquickjs::function]
    pub fn homedir() -> &'static str {
        "/"
    }

    #[rquickjs::function]
    pub fn machine() -> &'static str {
        "wasm-rquickjs"
    }

    #[rquickjs::function]
    pub fn uptime() -> f64 {
        let now_ns = wasip2::clocks::monotonic_clock::now();
        (now_ns as f64) / 1_000_000_000.0
    }

    #[rquickjs::function]
    pub fn version() -> &'static str {
        "0.2.3"
    }
}

pub const OS_JS: &str = include_str!("os.js");

pub const REEXPORT_JS: &str = r#"export * from 'node:os'; export { default } from 'node:os';"#;
