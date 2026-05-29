// https module - JavaScript-only stub (no native functions needed)
pub const HTTPS_JS: &str = include_str!("https.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:https'; export { default } from 'node:https';"#;
