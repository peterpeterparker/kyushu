// worker_threads module - JavaScript-only stub (no native functions needed)
pub const WORKER_THREADS_JS: &str = include_str!("worker_threads.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:worker_threads'; export { default } from 'node:worker_threads';"#;

pub const WIRE_JS: &str = r#"
    import __wasm_rquickjs_worker_threads, { MessageChannel as __wasm_rquickjs_MessageChannel, MessagePort as __wasm_rquickjs_MessagePort } from 'node:worker_threads';
    globalThis.worker_threads = __wasm_rquickjs_worker_threads;
    globalThis.MessageChannel = __wasm_rquickjs_MessageChannel;
    globalThis.MessagePort = __wasm_rquickjs_MessagePort;
"#;
