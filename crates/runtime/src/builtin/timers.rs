// JS functions for the node:timers implementation
pub const TIMERS_JS: &str = include_str!("timers.js");

// JS functions for the node:timers/promises implementation
pub const TIMERS_PROMISES_JS: &str = include_str!("timers_promises.js");

// Re-exports for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:timers'; export { default } from 'node:timers';"#;
pub const REEXPORT_PROMISES_JS: &str =
    r#"export * from 'node:timers/promises'; export { default } from 'node:timers/promises';"#;
