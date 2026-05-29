pub const MODULE_JS: &str = include_str!("module.js");

// Re-export for aliases
pub const REEXPORT_JS: &str =
    r#"export * from 'node:module'; export { default } from 'node:module';"#;

pub const WIRE_JS: &str = r#"
        import { require } from 'node:module';
        globalThis.require = require;
    "#;
