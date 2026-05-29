// JS functions for the buffer implementation
pub const BUFFER_JS: &str = include_str!("buffer.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:buffer'; export { default } from 'node:buffer';"#;

pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_buffer from 'node:buffer';

        globalThis.buffer = __wasm_rquickjs_buffer;
        globalThis.Buffer = __wasm_rquickjs_buffer.Buffer;
        __wasm_rquickjs_buffer.default.atob = globalThis.atob;
        __wasm_rquickjs_buffer.default.btoa = globalThis.btoa;
    "#;
