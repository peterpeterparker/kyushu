// JS implementation of the node:path module
pub const PATH_JS: &str = include_str!("path.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:path'; export { default } from 'node:path';"#;

// Subpath re-exports for path/posix and path/win32
pub const PATH_POSIX_REEXPORT_JS: &str =
    r#"export { posix as default } from 'node:path'; export { posix } from 'node:path';"#;
pub const PATH_WIN32_REEXPORT_JS: &str =
    r#"export { win32 as default } from 'node:path'; export { win32 } from 'node:path';"#;
