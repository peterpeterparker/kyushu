// JS functions for the AbortController implementation
pub const ABORT_CONTROLLER_JS: &str = include_str!("abort_controller.js");

// JS code wiring the abort_controller module into the global context
pub const WIRE_JS: &str = r#"
        import { AbortController, AbortSignal, DOMException } from '__wasm_rquickjs_builtin/abort_controller';
        globalThis.AbortController = AbortController;
        globalThis.AbortSignal = AbortSignal;
        globalThis.DOMException = DOMException;
    "#;
