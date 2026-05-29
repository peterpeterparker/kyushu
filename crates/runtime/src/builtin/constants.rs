// node:constants — deprecated module re-exporting os/fs/crypto constants
pub const CONSTANTS_JS: &str = include_str!("constants.js");

pub const REEXPORT_JS: &str =
    r#"export * from 'node:constants'; export { default } from 'node:constants';"#;
