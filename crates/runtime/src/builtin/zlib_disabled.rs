#[rquickjs::module]
pub mod native_module {}

pub const ZLIB_JS: &str = r#"
const msg = 'node:zlib is not available (zlib feature is not enabled)';
function notAvailable() { throw new Error(msg); }
export const deflateSync = notAvailable;
export const inflateSync = notAvailable;
export const deflateRawSync = notAvailable;
export const inflateRawSync = notAvailable;
export const gzipSync = notAvailable;
export const gunzipSync = notAvailable;
export const unzipSync = notAvailable;
export const brotliCompressSync = notAvailable;
export const brotliDecompressSync = notAvailable;
export const createDeflate = notAvailable;
export const createInflate = notAvailable;
export const createDeflateRaw = notAvailable;
export const createInflateRaw = notAvailable;
export const createGzip = notAvailable;
export const createGunzip = notAvailable;
export const createUnzip = notAvailable;
export const createBrotliCompress = notAvailable;
export const createBrotliDecompress = notAvailable;
export const crc32 = notAvailable;
export const constants = {};
export default { deflateSync, inflateSync, deflateRawSync, inflateRawSync, gzipSync, gunzipSync, unzipSync, brotliCompressSync, brotliDecompressSync, createDeflate, createInflate, createDeflateRaw, createInflateRaw, createGzip, createGunzip, createUnzip, createBrotliCompress, createBrotliDecompress, crc32, constants };
"#;

pub const REEXPORT_JS: &str = r#"export * from 'node:zlib'; export { default } from 'node:zlib';"#;
