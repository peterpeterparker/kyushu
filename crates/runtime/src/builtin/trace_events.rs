// trace_events module - JavaScript-only partial implementation
pub const TRACE_EVENTS_JS: &str = include_str!("trace_events.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:trace_events'; export { default } from 'node:trace_events';"#;
