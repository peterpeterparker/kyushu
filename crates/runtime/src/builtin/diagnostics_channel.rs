// JS implementation of node:diagnostics_channel
pub const DIAGNOSTICS_CHANNEL_JS: &str = include_str!("diagnostics_channel.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:diagnostics_channel'; export { default } from 'node:diagnostics_channel';"#;

#[cfg(feature = "golem")]
pub const DIAGNOSTICS_CHANNEL_GOLEM_JS: &str = include_str!("diagnostics_channel_golem.js");

#[cfg(feature = "golem")]
pub const GOLEM_WIRE_JS: &str = r#"
    {
        const { subscribe } = await import('node:diagnostics_channel');
        const { _installGolemTracing } = await import('__wasm_rquickjs_builtin/diagnostics_channel_golem');

        const TRACING_CHANNEL_CREATED = Symbol.for('wasm-rquickjs.internal.tracing_channel.created');
        subscribe(TRACING_CHANNEL_CREATED, ({ key }) => {
            _installGolemTracing(key);
        });

        _installGolemTracing('http.client');
    }
"#;

#[cfg(feature = "golem")]
pub use golem_context::js_native_module;

#[cfg(feature = "golem")]
pub mod golem_context {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use ::golem_context::{AttributeValue, Span, context};

    thread_local! {
        static SPANS: RefCell<HashMap<u32, Span>> = RefCell::new(HashMap::new());
        static NEXT_HANDLE: RefCell<u32> = RefCell::new(1);
    }

    #[rquickjs::module]
    pub mod native_module {
        #[rquickjs::function]
        pub fn start_span(name: String) -> u32 {
            let span = super::context::start_span(&name);
            super::NEXT_HANDLE.with(|next| {
                let mut next = next.borrow_mut();
                let handle = *next;
                *next += 1;
                super::SPANS.with(|spans| {
                    spans.borrow_mut().insert(handle, span);
                });
                handle
            })
        }

        #[rquickjs::function]
        pub fn set_span_attribute(handle: u32, key: String, value: String) {
            super::SPANS.with(|spans| {
                if let Some(span) = spans.borrow().get(&handle) {
                    span.set_attribute(&key, &super::AttributeValue::String(value));
                }
            });
        }

        #[rquickjs::function]
        pub fn finish_span(handle: u32) {
            super::SPANS.with(|spans| {
                if let Some(span) = spans.borrow_mut().remove(&handle) {
                    span.finish();
                }
            });
        }
    }
}
