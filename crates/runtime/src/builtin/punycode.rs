// node:punycode — deprecated Punycode encoding/decoding (RFC 3492)
pub const PUNYCODE_JS: &str = include_str!("punycode.js");

pub const REEXPORT_JS: &str =
    r#"export * from 'node:punycode'; export { default } from 'node:punycode';"#;
