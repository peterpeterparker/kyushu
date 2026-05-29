// perf_hooks module - JavaScript-only implementation (no native functions needed)
pub const PERF_HOOKS_JS: &str = include_str!("perf_hooks.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:perf_hooks'; export { default } from 'node:perf_hooks';"#;
