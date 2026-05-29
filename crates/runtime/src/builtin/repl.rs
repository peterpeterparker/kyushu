// repl module - JavaScript-only stub (no native functions needed)
pub const REPL_JS: &str = include_str!("repl.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:repl'; export { default } from 'node:repl';"#;
