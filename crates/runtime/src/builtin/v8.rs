pub const V8_JS: &str = include_str!("v8.js");
pub const REEXPORT_JS: &str = r#"export * from 'node:v8'; export { default } from 'node:v8';"#;
