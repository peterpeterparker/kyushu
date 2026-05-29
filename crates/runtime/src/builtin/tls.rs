// tls module - JavaScript-only stub (no native functions needed)
pub const TLS_JS: &str = include_str!("tls.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:tls'; export { default } from 'node:tls';"#;
