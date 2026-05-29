// cluster module - JavaScript-only stub (no native functions needed)
pub const CLUSTER_JS: &str = include_str!("cluster.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:cluster'; export { default } from 'node:cluster';"#;
