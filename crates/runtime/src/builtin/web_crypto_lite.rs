use rand::RngCore;
use rquickjs::TypedArray;
use std::slice;

fn randomize_typed_array<V>(array: TypedArray<V>) {
    if let Some(raw) = array.as_raw() {
        let slice = unsafe { slice::from_raw_parts_mut(raw.ptr.as_ptr(), raw.len) };
        rand::rng().fill_bytes(slice);
    }
}

#[rquickjs::module(rename_vars = "camelCase")]
pub mod native_module {
    use rquickjs::TypedArray;

    #[rquickjs::function]
    pub fn random_uuid_v4_string() -> String {
        let uuid = uuid::Uuid::new_v4();
        uuid.to_string()
    }

    #[rquickjs::function]
    pub fn random_bytes(len: u32) -> Vec<u8> {
        use rand::RngCore;
        let mut buf = vec![0u8; len as usize];
        rand::rng().fill_bytes(&mut buf);
        buf
    }

    #[rquickjs::function]
    pub fn random_int_range(min: f64, max: f64) -> Option<f64> {
        use rand::RngCore;
        let min_i = min as i64;
        let max_i = max as i64;
        if min_i >= max_i {
            return None;
        }
        let range = (max_i - min_i) as u64;
        let mut buf = [0u8; 8];
        rand::rng().fill_bytes(&mut buf);
        let random_val = u64::from_le_bytes(buf);
        let result = min_i + (random_val % range) as i64;
        Some(result as f64)
    }

    #[rquickjs::function]
    pub fn randomize_int8_array(array: TypedArray<'_, i8>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_uint8_array(array: TypedArray<'_, u8>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_uint8_clamped_array(array: TypedArray<'_, u8>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_int16_array(array: TypedArray<'_, i16>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_uint16_array(array: TypedArray<'_, u16>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_int32_array(array: TypedArray<'_, i32>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_uint32_array(array: TypedArray<'_, u32>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_bigint64_array(array: TypedArray<'_, i64>) {
        super::randomize_typed_array(array);
    }

    #[rquickjs::function]
    pub fn randomize_biguint64_array(array: TypedArray<'_, u64>) {
        super::randomize_typed_array(array);
    }
}

pub const WEB_CRYPTO_JS: &str = r#"
import {
  randomUuidV4String,
  randomBytes,
  randomIntRange,
  randomizeInt8Array,
  randomizeUint8Array,
  randomizeUint8ClampedArray,
  randomizeInt16Array,
  randomizeUint16Array,
  randomizeInt32Array,
  randomizeUint32Array,
  randomizeBigint64Array,
  randomizeBiguint64Array,
} from '__wasm_rquickjs_builtin/web_crypto_native';

function getRandomValues(array) {
  if (!(array instanceof ArrayBuffer) && !ArrayBuffer.isView(array)) {
    throw new TypeError('The argument must be a TypedArray');
  }
  if (array instanceof Float32Array || array instanceof Float64Array) {
    throw new DOMException('Float typed arrays are not supported', 'TypeMismatchError');
  }
  if (array.byteLength > 65536) {
    throw new DOMException('The ArrayBufferView byte length exceeds the limit (65536)', 'QuotaExceededError');
  }
  if (array instanceof Int8Array) randomizeInt8Array(array);
  else if (array instanceof Uint8ClampedArray) randomizeUint8ClampedArray(array);
  else if (array instanceof Uint8Array) randomizeUint8Array(array);
  else if (array instanceof Int16Array) randomizeInt16Array(array);
  else if (array instanceof Uint16Array) randomizeUint16Array(array);
  else if (array instanceof Int32Array) randomizeInt32Array(array);
  else if (array instanceof Uint32Array) randomizeUint32Array(array);
  else if (typeof BigInt64Array !== 'undefined' && array instanceof BigInt64Array) randomizeBigint64Array(array);
  else if (typeof BigUint64Array !== 'undefined' && array instanceof BigUint64Array) randomizeBiguint64Array(array);
  return array;
}

function randomUUID() {
  return randomUuidV4String();
}

export { getRandomValues, randomUUID };
export default { getRandomValues, randomUUID };
"#;

pub const REEXPORT_JS: &str = r#"
const msg = 'node:crypto is not available (crypto feature is not enabled)';
function notAvailable() { throw new Error(msg); }
export const createHash = notAvailable;
export const createHmac = notAvailable;
export const createCipheriv = notAvailable;
export const createDecipheriv = notAvailable;
export const createSign = notAvailable;
export const createVerify = notAvailable;
export const createDiffieHellman = notAvailable;
export const createDiffieHellmanGroup = notAvailable;
export const createECDH = notAvailable;
export const getDiffieHellman = notAvailable;
export const pbkdf2 = notAvailable;
export const pbkdf2Sync = notAvailable;
export const scrypt = notAvailable;
export const scryptSync = notAvailable;
export const hkdf = notAvailable;
export const hkdfSync = notAvailable;
export const randomBytes = notAvailable;
export const randomInt = notAvailable;
export const randomFillSync = notAvailable;
export const randomFill = notAvailable;
export const randomUUID = notAvailable;
export const generateKey = notAvailable;
export const generateKeySync = notAvailable;
export const generateKeyPair = notAvailable;
export const generateKeyPairSync = notAvailable;
export const getHashes = notAvailable;
export const getCiphers = notAvailable;
export const getCurves = notAvailable;
export const timingSafeEqual = notAvailable;
export const constants = {};
export default { createHash, createHmac, createCipheriv, createDecipheriv, createSign, createVerify, createDiffieHellman, createDiffieHellmanGroup, createECDH, getDiffieHellman, pbkdf2, pbkdf2Sync, scrypt, scryptSync, hkdf, hkdfSync, randomBytes, randomInt, randomFillSync, randomFill, randomUUID, generateKey, generateKeySync, generateKeyPair, generateKeyPairSync, getHashes, getCiphers, getCurves, timingSafeEqual, constants };
"#;

pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_web_crypto from '__wasm_rquickjs_builtin/web_crypto';
        globalThis.crypto = __wasm_rquickjs_web_crypto;
    "#;
