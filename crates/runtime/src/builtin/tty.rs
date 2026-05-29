// tty module - JavaScript-only stub (no native functions needed)
pub const TTY_JS: &str = include_str!("tty.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:tty'; export { default } from 'node:tty';"#;
