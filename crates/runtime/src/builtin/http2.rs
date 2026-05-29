// http2 module - JavaScript-only stub (no native functions needed)
pub const HTTP2_JS: &str = include_str!("http2.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:http2'; export { default } from 'node:http2';"#;
