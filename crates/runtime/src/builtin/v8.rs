// A wasm32 component can address at most 2^32 bytes of linear memory. This is
// an effective component-wide ceiling, not a reservation or per-runtime quota.
const WASM32_LINEAR_MEMORY_CEILING_BYTES: i64 = 1_i64 << 32;

#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use super::WASM32_LINEAR_MEMORY_CEILING_BYTES;

    #[rquickjs::function]
    pub fn heap_size_limit() -> i64 {
        WASM32_LINEAR_MEMORY_CEILING_BYTES
    }
}

pub const V8_JS: &str = include_str!("v8.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:v8'; export { default } from 'node:v8';"#;
