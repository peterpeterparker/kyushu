// inspector module - JavaScript-only stub (no native functions needed)
pub const INSPECTOR_JS: &str = include_str!("inspector.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:inspector'; export { default } from 'node:inspector';"#;
