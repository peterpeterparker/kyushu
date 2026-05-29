// assert module - JavaScript-only (no native functions needed)
pub const ASSERT_JS: &str = include_str!("assert.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:assert'; export { default } from 'node:assert';"#;

// node:assert/strict - re-exports the strict mode version
pub const ASSERT_STRICT_JS: &str = r#"export { strict as default, strict } from 'node:assert'; export { AssertionError, ok, strictEqual as equal, notStrictEqual as notEqual, deepStrictEqual as deepEqual, notDeepStrictEqual as notDeepEqual, strictEqual, notStrictEqual, deepStrictEqual, notDeepStrictEqual, throws, doesNotThrow, rejects, doesNotReject, ifError, match, doesNotMatch, fail } from 'node:assert';"#;

pub const REEXPORT_STRICT_JS: &str =
    r#"export * from 'node:assert/strict'; export { default } from 'node:assert/strict';"#;
