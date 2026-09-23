// JS functions for the node:util implementation
pub const UTIL_JS: &str = include_str!("util.js");

// Re-export for aliases
pub const BARE_UTIL_REEXPORT_JS: &str =
    r#"export * from 'node:util'; export { default } from 'node:util';"#;
pub const UTIL_TYPES_JS: &str = r#"
import { types as _types } from 'node:util';

export default _types;
export const isAnyArrayBuffer = _types.isAnyArrayBuffer;
export const isArgumentsObject = _types.isArgumentsObject;
export const isArrayBuffer = _types.isArrayBuffer;
export const isArrayBufferView = _types.isArrayBufferView;
export const isAsyncFunction = _types.isAsyncFunction;
export const isBigInt64Array = _types.isBigInt64Array;
export const isBigIntObject = _types.isBigIntObject;
export const isBigUint64Array = _types.isBigUint64Array;
export const isBooleanObject = _types.isBooleanObject;
export const isBoxedPrimitive = _types.isBoxedPrimitive;
export const isCryptoKey = _types.isCryptoKey;
export const isDataView = _types.isDataView;
export const isDate = _types.isDate;
export const isExternal = _types.isExternal;
export const isFloat32Array = _types.isFloat32Array;
export const isFloat64Array = _types.isFloat64Array;
export const isGeneratorFunction = _types.isGeneratorFunction;
export const isGeneratorObject = _types.isGeneratorObject;
export const isInt8Array = _types.isInt8Array;
export const isInt16Array = _types.isInt16Array;
export const isInt32Array = _types.isInt32Array;
export const isKeyObject = _types.isKeyObject;
export const isMap = _types.isMap;
export const isMapIterator = _types.isMapIterator;
export const isModuleNamespaceObject = _types.isModuleNamespaceObject;
export const isNativeError = _types.isNativeError;
export const isNumberObject = _types.isNumberObject;
export const isPromise = _types.isPromise;
export const isProxy = _types.isProxy;
export const isRegExp = _types.isRegExp;
export const isSet = _types.isSet;
export const isSetIterator = _types.isSetIterator;
export const isSharedArrayBuffer = _types.isSharedArrayBuffer;
export const isStringObject = _types.isStringObject;
export const isSymbolObject = _types.isSymbolObject;
export const isTypedArray = _types.isTypedArray;
export const isUint8Array = _types.isUint8Array;
export const isUint8ClampedArray = _types.isUint8ClampedArray;
export const isUint16Array = _types.isUint16Array;
export const isUint32Array = _types.isUint32Array;
export const isWeakMap = _types.isWeakMap;
export const isWeakSet = _types.isWeakSet;
"#;
