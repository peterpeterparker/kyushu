// child_process module - JavaScript-only stub (no native functions needed)
pub const CHILD_PROCESS_JS: &str = include_str!("child_process.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:child_process'; export { default } from 'node:child_process';"#;
