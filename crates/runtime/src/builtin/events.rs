// JS functions for the unified node:events module (EventEmitter + Event/EventTarget/CustomEvent)
pub const EVENTS_JS: &str = include_str!("events.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:events'; export { default } from 'node:events';"#;

// JS code wiring Event, EventTarget, and CustomEvent into the global context
pub const WIRE_JS: &str = r#"
        import { Event, EventTarget, CustomEvent } from 'node:events';
        globalThis.Event = Event;
        globalThis.EventTarget = EventTarget;
        globalThis.CustomEvent = CustomEvent;
    "#;
