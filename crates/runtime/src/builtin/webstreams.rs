// JS functions for the web streams implementation
pub const WEBSTREAMS_JS: &str = include_str!("web-streams-polyfill-4.1.0.js");

// JS wrapper that patches ReadableStream for Node.js compatibility
pub const WEBSTREAMS_WRAPPER_JS: &str = include_str!("webstreams.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from '__wasm_rquickjs_builtin/webstreams_wrapper';
import * as _all from '__wasm_rquickjs_builtin/webstreams_wrapper';
export default _all;"#;

// JS code wiring the web streams module into the global context
pub const WIRE_JS: &str = r#"
        import {
            ByteLengthQueuingStrategy as __ByteLengthQueuingStrategy,
            CountQueuingStrategy as __CountQueuingStrategy,
            ReadableByteStreamController as __ReadableByteStreamController,
            ReadableStream as __ReadableStream,
            ReadableStreamBYOBReader as __ReadableStreamBYOBReader,
            ReadableStreamBYOBRequest as __ReadableStreamBYOBRequest,
            ReadableStreamDefaultController as __ReadableStreamDefaultController,
            ReadableStreamDefaultReader as __ReadableStreamDefaultReader,
            TransformStream as __TransformStream,
            TransformStreamDefaultController as __TransformStreamDefaultController,
            WritableStream as __WritableStream,
            WritableStreamDefaultController as __WritableStreamDefaultController,
            WritableStreamDefaultWriter as __WritableStreamDefaultWriter,
        } from '__wasm_rquickjs_builtin/webstreams_wrapper';
        globalThis.ByteLengthQueuingStrategy = __ByteLengthQueuingStrategy;
        globalThis.CountQueuingStrategy = __CountQueuingStrategy;
        globalThis.ReadableByteStreamController = __ReadableByteStreamController;
        globalThis.ReadableStream = __ReadableStream;
        globalThis.ReadableStreamBYOBReader = __ReadableStreamBYOBReader;
        globalThis.ReadableStreamBYOBRequest = __ReadableStreamBYOBRequest;
        globalThis.ReadableStreamDefaultController = __ReadableStreamDefaultController;
        globalThis.ReadableStreamDefaultReader = __ReadableStreamDefaultReader;
        globalThis.TransformStream = __TransformStream;
        globalThis.TransformStreamDefaultController = __TransformStreamDefaultController;
        globalThis.WritableStream = __WritableStream;
        globalThis.WritableStreamDefaultController = __WritableStreamDefaultController;
        globalThis.WritableStreamDefaultWriter = __WritableStreamDefaultWriter;
    "#;
