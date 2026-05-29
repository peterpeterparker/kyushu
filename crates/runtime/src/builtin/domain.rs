// domain module - JavaScript-only implementation (no native functions needed)
pub const DOMAIN_JS: &str = include_str!("domain.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:domain'; export { default } from 'node:domain';"#;
