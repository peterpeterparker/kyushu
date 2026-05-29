#[rquickjs::module]
pub mod native_module {}

pub const SQLITE_JS: &str = r#"
const msg = 'node:sqlite is not available (sqlite feature is not enabled)';
class DatabaseSync { constructor() { throw new Error(msg); } }
class StatementSync { constructor() { throw new Error(msg); } }
const constants = {};
export { DatabaseSync, StatementSync, constants };
export default { DatabaseSync, StatementSync, constants };
"#;
