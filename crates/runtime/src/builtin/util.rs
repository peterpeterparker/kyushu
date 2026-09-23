// JS functions for the node:util implementation
pub const UTIL_JS: &str = include_str!("util.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:util'; export { default } from 'node:util';"#;
