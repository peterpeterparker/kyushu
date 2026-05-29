// async_hooks module - JavaScript-only implementation (no native functions needed)
pub const ASYNC_HOOKS_JS: &str = include_str!("async_hooks.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:async_hooks'; export { default } from 'node:async_hooks';"#;
