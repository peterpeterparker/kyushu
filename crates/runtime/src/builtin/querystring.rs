// querystring module - JavaScript-only (no native functions needed)
pub const QUERYSTRING_JS: &str = include_str!("querystring.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:querystring'; export { default } from 'node:querystring';"#;
