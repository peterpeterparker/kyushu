#[rquickjs::module]
pub mod native_module {}

#[allow(dead_code)]
pub const HTTP_JS: &str = "";
pub const FETCH_BLOB_JS: &str = include_str!("fetch-blob-4.0.0.js");
pub const FORMDATA_JS: &str = include_str!("formdata-polyfill-4.0.10.js");

#[allow(dead_code)]
pub const WIRE_JS: &str = "";
