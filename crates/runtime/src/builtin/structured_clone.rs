// JS functions for the structuredClone implementation
// Based on @ungap/structured-clone v1.3.0
pub const STRUCTURED_CLONE_JS: &str = include_str!("structured_clone.js");

// JS code wiring the structuredClone function into the global context
pub const WIRE_JS: &str = r#"
        import __wasm_rquickjs_structured_clone from '__wasm_rquickjs_builtin/structured_clone';
        globalThis.structuredClone = __wasm_rquickjs_structured_clone;
    "#;
