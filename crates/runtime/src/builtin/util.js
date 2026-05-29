// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Import Node.js-compatible inspect/format/formatWithOptions from internal implementation
import {
    inspect,
    format,
    formatWithOptions,
    stripVTControlCharacters
} from '__wasm_rquickjs_builtin/internal/util/inspect';
import * as webCryptoNative from '__wasm_rquickjs_builtin/web_crypto_native';
import {
    ERR_INVALID_ARG_TYPE,
    ERR_OUT_OF_RANGE,
    isErrorStackTraceLimitWritable
} from '__wasm_rquickjs_builtin/internal/errors';
import * as internalUtilTypes from '__wasm_rquickjs_builtin/internal/util/types';
import { getProxyDetails as getProxyDetailsNative } from '__wasm_rquickjs_builtin/internal/binding/util';

import { deprecate as _internalDeprecate } from '__wasm_rquickjs_builtin/internal/util';

const _ObjectPrototypeToString = Object.prototype.toString;
const _ObjectGetPrototypeOf = Object.getPrototypeOf;
const _ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const _ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const _ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const _ObjectDefineProperty = Object.defineProperty;
const _ArrayIsArray = Array.isArray;
const _DatePrototypeGetTime = Date.prototype.getTime;

const _TypedArrayToStringTagGetter = (function() {
    const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
    const desc = Object.getOwnPropertyDescriptor(typedArrayProto, Symbol.toStringTag);
    return desc && typeof desc.get === 'function' ? desc.get : null;
})();

const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
export const deprecate = _internalDeprecate;


const debugs = {};
const debugEnvRegex = /^$/;

export const debuglog = function(set) {
    set = set.toUpperCase();
    if (!debugs[set]) {
        if (debugEnvRegex.test(set)) {
            debugs[set] = function() {
                const msg = format.apply(null, arguments);
                console.error('%s: %s', set, msg);
            };
        } else {
            debugs[set] = function() {};
        }
    }
    return debugs[set];
};


export function isArray(ar) {
    return _ArrayIsArray(ar);
}

export function isBoolean(arg) {
    return typeof arg === 'boolean';
}

export function isNull(arg) {
    return arg === null;
}

export function isNullOrUndefined(arg) {
    return arg == null;
}

export function isNumber(arg) {
    return typeof arg === 'number';
}

export function isString(arg) {
    return typeof arg === 'string';
}

export function isSymbol(arg) {
    return typeof arg === 'symbol';
}

export function isUndefined(arg) {
    return arg === void 0;
}

export function isRegExp(re) {
    return isObject(re) && objectToString(re) === '[object RegExp]';
}

export function isObject(arg) {
    return typeof arg === 'object' && arg !== null;
}
export function isDate(d) {
     return isObject(d) && objectToString(d) === '[object Date]';
 }

 export function isMap(m) {
     return isObject(m) && objectToString(m) === '[object Map]';
 }

 export function isSet(s) {
     return isObject(s) && objectToString(s) === '[object Set]';
 }

 export function isWeakMap(wm) {
     return isObject(wm) && objectToString(wm) === '[object WeakMap]';
 }

 export function isWeakSet(ws) {
     return isObject(ws) && objectToString(ws) === '[object WeakSet]';
 }

 export function isError(e) {
     return isObject(e) &&
         (objectToString(e) === '[object Error]' || e instanceof Error);
 }

export function isFunction(arg) {
    return typeof arg === 'function';
}

export function toUSVString(input) {
    return String(input).toWellFormed();
}

export function isPrimitive(arg) {
    return arg === null ||
        typeof arg === 'boolean' ||
        typeof arg === 'number' ||
        typeof arg === 'string' ||
        typeof arg === 'symbol' ||  // ES6 symbol
        typeof arg === 'undefined';
}

export function isBuffer(arg) {
    return arg instanceof Buffer;
}

function objectToString(o) {
    return _ObjectPrototypeToString.call(o);
}


function pad(n) {
    return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
    const d = new Date();
    const time = [pad(d.getHours()),
        pad(d.getMinutes()),
        pad(d.getSeconds())].join(':');
    return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
export const log = function() {
    console.log('%s - %s', timestamp(), format.apply(null, arguments));
};

export const _extend = function(origin, add) {
    // Don't do anything if add isn't an object
    if (!add || !isObject(add)) return origin;

    const keys = Object.keys(add);
    let i = keys.length;
    while (i--) {
        origin[keys[i]] = add[keys[i]];
    }
    return origin;
};

const kCustomPromisifiedSymbol = Symbol.for('nodejs.util.promisify.custom');
const kCustomPromisifyArgsSymbol = Symbol.for('nodejs.util.promisify.customArgs');

export const promisify = function promisify(original) {
    if (typeof original !== 'function')
        throw new ERR_INVALID_ARG_TYPE('original', 'Function', original);

    if (original[kCustomPromisifiedSymbol]) {
        const fn = original[kCustomPromisifiedSymbol];
        if (typeof fn !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('util.promisify.custom', 'Function', fn);
        }
        Object.defineProperty(fn, kCustomPromisifiedSymbol, {
            value: fn, enumerable: false, writable: false, configurable: true
        });
        return fn;
    }

    const argumentNames = original[kCustomPromisifyArgsSymbol];

    function fn() {
        let promiseResolve, promiseReject;
        const promise = new Promise(function (resolve, reject) {
            promiseResolve = resolve;
            promiseReject = reject;
        });

        const args = [];
        for (let i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        args.push(function (err) {
            if (err) {
                promiseReject(err);
            } else if (argumentNames !== undefined && arguments.length > 2) {
                const obj = {};
                for (let j = 0; j < argumentNames.length; j++) {
                    obj[argumentNames[j]] = arguments[j + 1];
                }
                promiseResolve(obj);
            } else {
                promiseResolve(arguments[1]);
            }
        });

        try {
            original.apply(this, args);
        } catch (err) {
            promiseReject(err);
        }

        return promise;
    }

    Object.setPrototypeOf(fn, Object.getPrototypeOf(original));

    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
        value: fn, enumerable: false, writable: false, configurable: true
    });
    return Object.defineProperties(
        fn,
        getOwnPropertyDescriptors(original)
    );
}

promisify.custom = kCustomPromisifiedSymbol

function callbackifyOnRejected(reason, cb) {
    // `!reason` guard inspired by bluebird (Ref: https://goo.gl/t5IS6M).
    // Because `null` is a special error value in callbacks which means "no error
    // occurred", we error-wrap so the callback consumer can distinguish between
    // "the promise rejected with null" or "the promise fulfilled with undefined".
    if (!reason) {
        const newReason = new Error('Promise was rejected with falsy value');
        newReason.code = 'ERR_FALSY_VALUE_REJECTION';
        newReason.reason = reason;
        reason = newReason;

        // Hide callbackify internals from stack traces to match Node behavior.
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(reason, callbackifyOnRejected);
        }
    }
    return cb(reason);
}

export function callbackify(original) {
    if (typeof original !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('original', 'function', original);
    }

    // We DO NOT return the promise as it gives the user a false sense that
    // the promise is actually somehow related to the callback's execution
    // and that the callback throwing will reject the promise.
    function callbackified() {
        const args = [];
        for (let i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }

        const maybeCb = args.pop();
        if (typeof maybeCb !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('last argument', 'function', maybeCb);
        }
        const cb = function() {
            return maybeCb.apply(this, arguments);
        };
        // In true node style we process the callback on `nextTick` with all the
        // implications (stack, `uncaughtException`, `async_hooks`)
        original.apply(this, args)
            .then(function(ret) {
                process.nextTick(cb.bind(this, null, ret));
            }.bind(this), function(rej) {
                process.nextTick(callbackifyOnRejected.bind(null, rej, cb.bind(this)));
            }.bind(this));
    }

    const descriptors = getOwnPropertyDescriptors(original);
    // It is possible to manipulate a function's `length` or `name` property.
    // Guard those updates to match Node.js behavior.
    if (descriptors.length && typeof descriptors.length.value === 'number') {
        descriptors.length.value++;
    }
    if (descriptors.name && typeof descriptors.name.value === 'string') {
        descriptors.name.value += 'Callbackified';
    }
    const propertiesValues = Object.values(descriptors);
    for (let i = 0; i < propertiesValues.length; i++) {
        Object.setPrototypeOf(propertiesValues[i], null);
    }
    Object.defineProperties(callbackified, descriptors);
    return callbackified;
}

export function inherits(ctor, superCtor) {
    if (ctor === undefined || ctor === null) {
        const err = new TypeError('The "ctor" argument must be of type function. Received ' + ctor);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (superCtor === undefined || superCtor === null) {
        const err = new TypeError('The "superCtor" argument must be of type function. Received ' + superCtor);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (superCtor.prototype === undefined) {
        const err = new TypeError('The "superCtor.prototype" property must be of type object. Received undefined');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    Object.defineProperty(ctor, 'super_', {
        value: superCtor,
        writable: true,
        configurable: true,
        enumerable: false
    });
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

// Deep strict equality comparison (Node.js util.isDeepStrictEqual semantics)
const _hasOwn = Object.prototype.hasOwnProperty;
function _hasOwnProp(obj, prop) {
    return _hasOwn.call(obj, prop);
}

function _getTypedArrayBrand(v) {
    if (!ArrayBuffer.isView(v) || v instanceof DataView) {
        return '';
    }
    if (_TypedArrayToStringTagGetter) {
        try {
            return _TypedArrayToStringTagGetter.call(v);
        } catch (_) {
            // Fall back to Object.prototype.toString for engines without full support.
        }
    }
    const fallbackTag = Object.prototype.toString.call(v);
    return fallbackTag.slice(8, -1);
}

function _isKeyObjectLike(v) {
    return !!v && typeof v === 'object' &&
        typeof v.export === 'function' &&
        (typeof v.type === 'string' || typeof v._type === 'string') &&
        ('_handle' in v || '_type' in v);
}

function _toBytesForCompare(value) {
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length);
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return null;
}

function _exportKeyForCompare(key, keyType) {
    try {
        return key.export();
    } catch (_) {
        // Some key object implementations require at least one argument.
    }

    try {
        return key.export({});
    } catch (_) {
        // Try a more explicit export signature.
    }

    try {
        return key.export('der');
    } catch (_) {
        const formatType = keyType === 'public' ? 'spki' : 'pkcs8';
        try {
            return key.export('der', formatType, undefined);
        } catch (_) {
            return key.export(key._handle, 'der', undefined);
        }
    }
}

function _isBoxedTag(tag) {
    return tag === '[object Number]' ||
           tag === '[object String]' ||
           tag === '[object Boolean]' ||
           tag === '[object BigInt]' ||
           tag === '[object Symbol]';
}

function _unboxWithTag(val, tag) {
    try {
        if (tag === '[object Number]') return Number.prototype.valueOf.call(val);
        if (tag === '[object String]') return String.prototype.valueOf.call(val);
        if (tag === '[object Boolean]') return Boolean.prototype.valueOf.call(val);
        if (tag === '[object BigInt]') return Object(val).valueOf();
        if (tag === '[object Symbol]') return Symbol.prototype.valueOf.call(val);
    } catch(e) {
        try { return val.valueOf(); } catch(e2) {}
    }
    return val;
}

function _isWeakCollTag(tag) {
    return tag === '[object WeakMap]' || tag === '[object WeakSet]';
}

function _isPromiseLikeTag(tag) {
    return tag === '[object Promise]';
}

function _isArrIdx(key, length) {
    const num = Number(key);
    return Number.isInteger(num) && num >= 0 && num < length;
}

function _getEnumSymbols(obj) {
    const symbols = Object.getOwnPropertySymbols(obj);
    const result = [];
    for (let i = 0; i < symbols.length; i++) {
        const desc = Object.getOwnPropertyDescriptor(obj, symbols[i]);
        if (desc && desc.enumerable) {
            result.push(symbols[i]);
        }
    }
    return result;
}

function _isSingletonRuntimeObject(value) {
    if (value === globalThis) return true;
    return typeof process !== 'undefined' && value === process;
}

// QuickJS does not implement ES2015 Annex B __proto__ in object literals:
// `{ __proto__: null }` creates a regular-prototype object with `__proto__` as
// an own enumerable property, instead of setting the prototype to null.
// This normalization converts such objects to actual null-prototype objects
// (matching V8/Node.js semantics) so that deepStrictEqual comparisons work
// correctly against our runtime objects which use Object.create(null).
function _isQuickJSProtoNullArtifact(obj) {
    if (obj === null || typeof obj !== 'object') return false;
    if (_ArrayIsArray(obj)) return false;
    if (_ObjectPrototypeToString.call(obj) !== '[object Object]') return false;
    if (_ObjectGetPrototypeOf(obj) !== Object.prototype) return false;
    const d = _ObjectGetOwnPropertyDescriptor(obj, '__proto__');
    if (!d || d.get || d.set) return false;
    if (d.value !== null || d.enumerable !== true) return false;
    return true;
}

function _normalizeProtoNullArtifact(obj) {
    if (!_isQuickJSProtoNullArtifact(obj)) return obj;
    const clone = Object.create(null);
    const names = _ObjectGetOwnPropertyNames(obj);
    for (let i = 0; i < names.length; i++) {
        if (names[i] === '__proto__') continue;
        _ObjectDefineProperty(clone, names[i], _ObjectGetOwnPropertyDescriptor(obj, names[i]));
    }
    const syms = _ObjectGetOwnPropertySymbols(obj);
    for (let i = 0; i < syms.length; i++) {
        _ObjectDefineProperty(clone, syms[i], _ObjectGetOwnPropertyDescriptor(obj, syms[i]));
    }
    return clone;
}

function _deepObjEquiv(a, b, strict, memo) {
    if (a === null || a === undefined || b === null || b === undefined)
        return false;

    if (typeof a !== 'object' && typeof b !== 'object') {
        return strict ? Object.is(a, b) : a == b;
    }

    // Normalize QuickJS __proto__: null artifact on both sides
    a = _normalizeProtoNullArtifact(a);
    b = _normalizeProtoNullArtifact(b);

    // Compute tags once to avoid repeated Object.prototype.toString.call (expensive in WASM/QuickJS)
    const aTag = Object.prototype.toString.call(a);
    const bTag = Object.prototype.toString.call(b);
    const aIsErrorLike = (a instanceof Error) || aTag === '[object Error]';
    const bIsErrorLike = (b instanceof Error) || bTag === '[object Error]';

    if (_isWeakCollTag(aTag) || _isWeakCollTag(bTag)) return false;
    if (_isPromiseLikeTag(aTag) || _isPromiseLikeTag(bTag)) return false;

    // Node treats runtime singleton objects (global and process) with identity
    // semantics in deep comparisons; faked copies must not compare equal.
    if (_isSingletonRuntimeObject(a) || _isSingletonRuntimeObject(b)) {
        return a === b;
    }

    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
        return false;

    // Check type tags match - objects of different built-in types are never equal
    if (a instanceof RegExp !== b instanceof RegExp) return false;
    if (a instanceof Date !== b instanceof Date) return false;
    if (a instanceof Map !== b instanceof Map) return false;
    if (a instanceof Set !== b instanceof Set) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (aIsErrorLike !== bIsErrorLike) return false;
    const _aIsArgs = 'length' in a && 'callee' in a && !Array.isArray(a) && !(a instanceof Function);
    const _bIsArgs = 'length' in b && 'callee' in b && !Array.isArray(b) && !(b instanceof Function);
    if (_aIsArgs !== _bIsArgs) return false;
    const aIsView = ArrayBuffer.isView(a) && !(a instanceof DataView);
    const bIsView = ArrayBuffer.isView(b) && !(b instanceof DataView);
    let aTypedBrand = '';
    let bTypedBrand = '';
    if (aIsView || bIsView) {
        if (aIsView !== bIsView) return false;
        aTypedBrand = _getTypedArrayBrand(a);
        bTypedBrand = _getTypedArrayBrand(b);
        if (aTypedBrand !== bTypedBrand) return false;
    }

    const aBoxed = _isBoxedTag(aTag);
    const bBoxed = _isBoxedTag(bTag);
    if (aBoxed || bBoxed) {
        if (!aBoxed || !bBoxed) return false;
        if (aTag !== bTag) return false;
        const aVal = _unboxWithTag(a, aTag);
        const bVal = _unboxWithTag(b, bTag);
        if (aTag === '[object Number]') {
            if (!Object.is(aVal, bVal)) return false;
        } else {
            if (aVal !== bVal) return false;
        }
    }

    const aIsDate = aTag === '[object Date]';
    const bIsDate = bTag === '[object Date]';
    if (aIsDate || bIsDate) {
        if (!aIsDate || !bIsDate) return false;
        let aDateTime;
        let bDateTime;
        try {
            aDateTime = _DatePrototypeGetTime.call(a);
            bDateTime = _DatePrototypeGetTime.call(b);
        } catch (_) {
            return false;
        }
        if (aDateTime !== bDateTime) return false;
        // In strict mode, also check constructor and own properties
        if (strict && a.constructor !== b.constructor) return false;
        const dKeysA = Object.keys(a);
        const dKeysB = Object.keys(b);
        if (dKeysA.length !== dKeysB.length) return false;
        dKeysA.sort();
        dKeysB.sort();
        for (let i = 0; i < dKeysA.length; i++) {
            if (dKeysA[i] !== dKeysB[i]) return false;
            if (!_innerDeep(a[dKeysA[i]], b[dKeysB[i]], strict, memo)) return false;
        }
        return true;
    }

    const hasURLCtor = typeof URL === 'function';
    const aIsURL = aTag === '[object URL]' || (hasURLCtor && a instanceof URL);
    const bIsURL = bTag === '[object URL]' || (hasURLCtor && b instanceof URL);
    if (aIsURL || bIsURL) {
        if (!aIsURL || !bIsURL) return false;
        let aHref;
        let bHref;
        try {
            aHref = String(a);
            bHref = String(b);
        } catch (_) {
            return false;
        }
        if (aHref !== bHref) return false;
        const uKeysA = Object.keys(a);
        const uKeysB = Object.keys(b);
        if (uKeysA.length !== uKeysB.length) return false;
        uKeysA.sort();
        uKeysB.sort();
        for (let i = 0; i < uKeysA.length; i++) {
            if (uKeysA[i] !== uKeysB[i]) return false;
            if (!_innerDeep(a[uKeysA[i]], b[uKeysB[i]], strict, memo)) return false;
        }
        if (strict) {
            const uSymA = _getEnumSymbols(a);
            const uSymB = _getEnumSymbols(b);
            if (uSymA.length !== uSymB.length) return false;
            for (let i = 0; i < uSymA.length; i++) {
                if (uSymB.indexOf(uSymA[i]) === -1) return false;
                if (!_innerDeep(a[uSymA[i]], b[uSymA[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    const aIsKeyObject = _isKeyObjectLike(a);
    const bIsKeyObject = _isKeyObjectLike(b);
    if (aIsKeyObject || bIsKeyObject) {
        if (!aIsKeyObject || !bIsKeyObject) return false;
        const aKeyType = typeof a.type === 'string' ? a.type : a._type;
        const bKeyType = typeof b.type === 'string' ? b.type : b._type;
        if (aKeyType !== bKeyType) return false;

        let aExport;
        let bExport;
        try {
            if (typeof a._handle === 'number' && typeof b._handle === 'number') {
                aExport = webCryptoNative.key_export(a._handle, 'der', undefined);
                bExport = webCryptoNative.key_export(b._handle, 'der', undefined);
            } else {
                aExport = _exportKeyForCompare(a, aKeyType);
                bExport = _exportKeyForCompare(b, bKeyType);
            }
        } catch (e) {
            return false;
        }

        const aExportBytes = _toBytesForCompare(aExport);
        const bExportBytes = _toBytesForCompare(bExport);
        if (aExportBytes && bExportBytes) {
            if (aExportBytes.length !== bExportBytes.length) return false;
            for (let i = 0; i < aExportBytes.length; i++) {
                if (aExportBytes[i] !== bExportBytes[i]) return false;
            }
        } else {
            if (!_innerDeep(aExport, bExport, strict, memo)) return false;
        }

        const keyObjKeysA = Object.keys(a).filter(function(key) { return key !== '_handle'; });
        const keyObjKeysB = Object.keys(b).filter(function(key) { return key !== '_handle'; });
        if (keyObjKeysA.length !== keyObjKeysB.length) return false;
        keyObjKeysA.sort();
        keyObjKeysB.sort();
        for (let i = 0; i < keyObjKeysA.length; i++) {
            if (keyObjKeysA[i] !== keyObjKeysB[i]) return false;
            if (!_innerDeep(a[keyObjKeysA[i]], b[keyObjKeysB[i]], strict, memo)) return false;
        }
        if (strict) {
            const keyObjSymA = _getEnumSymbols(a);
            const keyObjSymB = _getEnumSymbols(b);
            if (keyObjSymA.length !== keyObjSymB.length) return false;
            for (let i = 0; i < keyObjSymA.length; i++) {
                if (keyObjSymB.indexOf(keyObjSymA[i]) === -1) return false;
                if (!_innerDeep(a[keyObjSymA[i]], b[keyObjSymA[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    if (a instanceof RegExp && b instanceof RegExp) {
        let aSource;
        let bSource;
        let aFlags;
        let bFlags;
        let aLastIndex;
        let bLastIndex;
        try {
            aSource = a.source;
            bSource = b.source;
            aFlags = a.flags;
            bFlags = b.flags;
            aLastIndex = a.lastIndex;
            bLastIndex = b.lastIndex;
        } catch (_) {
            return false;
        }
        if (aSource !== bSource || aFlags !== bFlags || aLastIndex !== bLastIndex) return false;
        if (strict && a.constructor !== b.constructor) return false;
        const rKeysA = Object.keys(a);
        const rKeysB = Object.keys(b);
        if (rKeysA.length !== rKeysB.length) return false;
        rKeysA.sort();
        rKeysB.sort();
        for (let i = 0; i < rKeysA.length; i++) {
            if (rKeysA[i] !== rKeysB[i]) return false;
            if (!_innerDeep(a[rKeysA[i]], b[rKeysB[i]], strict, memo)) return false;
        }
        return true;
    }

    if (aIsErrorLike && bIsErrorLike) {
        if (a.message !== b.message || a.name !== b.name) return false;
        const aHasCause = _hasOwnProp(a, 'cause') || 'cause' in a;
        const bHasCause = _hasOwnProp(b, 'cause') || 'cause' in b;
        if (aHasCause !== bHasCause) return false;
        if (aHasCause && !_innerDeep(a.cause, b.cause, strict, memo)) return false;
        const aHasErrors = _hasOwnProp(a, 'errors');
        const bHasErrors = _hasOwnProp(b, 'errors');
        if (aHasErrors !== bHasErrors) return false;
        if (aHasErrors && !_innerDeep(a.errors, b.errors, strict, memo)) return false;
        const eKeysA = Object.keys(a).filter(function(k) {
            return k !== 'cause' && k !== 'errors';
        });
        const eKeysB = Object.keys(b).filter(function(k) {
            return k !== 'cause' && k !== 'errors';
        });
        if (eKeysA.length !== eKeysB.length) return false;
        eKeysA.sort();
        eKeysB.sort();
        for (let i = 0; i < eKeysA.length; i++) {
            if (eKeysA[i] !== eKeysB[i]) return false;
            if (!_innerDeep(a[eKeysA[i]], b[eKeysB[i]], strict, memo)) return false;
        }
        if (strict) {
            const eSymA = _getEnumSymbols(a);
            const eSymB = _getEnumSymbols(b);
            if (eSymA.length !== eSymB.length) return false;
            for (let i = 0; i < eSymA.length; i++) {
                if (eSymB.indexOf(eSymA[i]) === -1) return false;
                if (!_innerDeep(a[eSymA[i]], b[eSymA[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    const aIsAB = a instanceof ArrayBuffer;
    const bIsAB = b instanceof ArrayBuffer;
    const aIsSAB = a instanceof SharedArrayBuffer;
    const bIsSAB = b instanceof SharedArrayBuffer;

    if (aIsAB || bIsAB || aIsSAB || bIsSAB) {
        if (aIsAB !== bIsAB) return false;
        if (aIsSAB !== bIsSAB) return false;
        if (a.byteLength !== b.byteLength) return false;
        const vA = new Uint8Array(a);
        const vB = new Uint8Array(b);
        for (let i = 0; i < vA.length; i++) {
            if (vA[i] !== vB[i]) return false;
        }
        return true;
    }

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        if (a.byteLength !== b.byteLength) return false;
        if (aTypedBrand === '' || bTypedBrand === '') {
            if (strict) {
                if (a.constructor !== b.constructor) return false;
            } else {
                if (aTag !== bTag) return false;
            }
        }
        if (!strict && (a instanceof Float32Array || a instanceof Float64Array)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (a[i] != b[i]) return false;
            }
        } else {
            const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
            const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
            for (let i = 0; i < ua.length; i++) {
                if (ua[i] !== ub[i]) return false;
            }
        }
        const aK = Object.keys(a).filter(function(k) { return !k.match(/^\d+$/); });
        const bK = Object.keys(b).filter(function(k) { return !k.match(/^\d+$/); });
        if (aK.length !== bK.length) return false;
        aK.sort();
        bK.sort();
        for (let i = 0; i < aK.length; i++) {
            if (aK[i] !== bK[i]) return false;
            if (!_innerDeep(a[aK[i]], b[bK[i]], strict, memo)) return false;
        }
        if (strict) {
            const symA = _getEnumSymbols(a);
            const symB = _getEnumSymbols(b);
            if (symA.length !== symB.length) return false;
            for (let i = 0; i < symA.length; i++) {
                if (symB.indexOf(symA[i]) === -1) return false;
                if (!_innerDeep(a[symA[i]], b[symA[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    if (!memo) {
        memo = { a: [], b: [] };
    }
    // Check for cycles: if we've seen this exact pair (a, b), assume equal
    for (let mi = 0; mi < memo.a.length; mi++) {
        if (memo.a[mi] === a && memo.b[mi] === b) {
            return true;
        }
    }
    memo.a.push(a);
    memo.b.push(b);

    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) return false;
        const aEntries = Array.from(a.entries());
        const bEntries = Array.from(b.entries());
        const unmatchedA = [];
        const matchedB = new Array(bEntries.length);
        for (let i = 0; i < aEntries.length; i++) {
            const aKey = aEntries[i][0];
            if (typeof aKey === 'object' && aKey !== null) {
                unmatchedA.push(i);
                continue;
            }
            if (strict) {
                // In strict mode, primitive keys must match via Object.is
                let found = false;
                for (let j = 0; j < bEntries.length; j++) {
                    if (matchedB[j]) continue;
                    if (Object.is(aKey, bEntries[j][0])) {
                        if (!_innerDeep(aEntries[i][1], bEntries[j][1], strict, memo)) return false;
                        matchedB[j] = true;
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
            } else {
                // In loose mode, try Object.is first; if value doesn't match or
                // key not found, defer to the general matching pass
                let found = false;
                for (let j = 0; j < bEntries.length; j++) {
                    if (matchedB[j]) continue;
                    if (Object.is(aKey, bEntries[j][0])) {
                        const valueMemo = { a: memo.a.slice(), b: memo.b.slice() };
                        if (_innerDeep(aEntries[i][1], bEntries[j][1], strict, valueMemo)) {
                            memo.a = valueMemo.a;
                            memo.b = valueMemo.b;
                            matchedB[j] = true;
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) {
                    unmatchedA.push(i);
                }
            }
        }
        for (let i = 0; i < unmatchedA.length; i++) {
            const ai = unmatchedA[i];
            let found = false;
            for (let j = 0; j < bEntries.length; j++) {
                if (matchedB[j]) continue;
                const keyMemo = { a: memo.a.slice(), b: memo.b.slice() };
                if (_innerDeep(aEntries[ai][0], bEntries[j][0], strict, keyMemo)) {
                    const valueMemo = { a: keyMemo.a.slice(), b: keyMemo.b.slice() };
                    if (_innerDeep(aEntries[ai][1], bEntries[j][1], strict, valueMemo)) {
                        memo.a = valueMemo.a;
                        memo.b = valueMemo.b;
                        matchedB[j] = true;
                        found = true;
                        break;
                    }
                }
            }
            if (!found) return false;
        }
        // Check own properties on the Map objects
        const mKeysA = Object.keys(a);
        const mKeysB = Object.keys(b);
        if (mKeysA.length !== mKeysB.length) return false;
        if (mKeysA.length > 0) {
            mKeysA.sort();
            mKeysB.sort();
            for (let i = 0; i < mKeysA.length; i++) {
                if (mKeysA[i] !== mKeysB[i]) return false;
                if (!_innerDeep(a[mKeysA[i]], b[mKeysB[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size) return false;
        const arrA = Array.from(a);
        const arrB = Array.from(b);
        const unmatchedA = [];
        const usedB = new Array(arrB.length);
        for (let i = 0; i < arrA.length; i++) {
            const val = arrA[i];
            if (typeof val !== 'object' || val === null) {
                if (b.has(val)) {
                    // Use Object.is for marking used elements to avoid cross-matching
                    // loosely-equal primitives (e.g., 0 matching false via ==)
                    for (let j = 0; j < arrB.length; j++) {
                        if (!usedB[j] && Object.is(val, arrB[j])) {
                            usedB[j] = true;
                            break;
                        }
                    }
                    continue;
                }
                if (!strict) {
                    unmatchedA.push(i);
                    continue;
                }
                return false;
            }
            unmatchedA.push(i);
        }
        for (let i = 0; i < unmatchedA.length; i++) {
            let found = false;
            for (let j = 0; j < arrB.length; j++) {
                if (usedB[j]) continue;
                if (_innerDeep(arrA[unmatchedA[i]], arrB[j], strict, { a: memo.a.slice(), b: memo.b.slice() })) {
                    usedB[j] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        // Check own properties on the Set objects
        const sKeysA = Object.keys(a);
        const sKeysB = Object.keys(b);
        if (sKeysA.length !== sKeysB.length) return false;
        sKeysA.sort();
        sKeysB.sort();
        for (let i = 0; i < sKeysA.length; i++) {
            if (sKeysA[i] !== sKeysB[i]) return false;
            if (!_innerDeep(a[sKeysA[i]], b[sKeysB[i]], strict, memo)) return false;
        }
        return true;
    }

    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);
    if (isArrayA !== isArrayB) return false;

    if (isArrayA && isArrayB) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            const aHas = _hasOwnProp(a, i);
            const bHas = _hasOwnProp(b, i);
            if (strict && aHas !== bHas) return false;
            if (!_innerDeep(a[i], b[i], strict, memo)) return false;
        }
        const keysA = Object.keys(a).filter(function(k) { return !_isArrIdx(k, a.length); });
        const keysB = Object.keys(b).filter(function(k) { return !_isArrIdx(k, b.length); });
        if (keysA.length !== keysB.length) return false;
        for (let i = 0; i < keysA.length; i++) {
            if (!_hasOwnProp(b, keysA[i])) return false;
            if (!_innerDeep(a[keysA[i]], b[keysA[i]], strict, memo)) return false;
        }
        if (strict) {
            const symA = _getEnumSymbols(a);
            const symB = _getEnumSymbols(b);
            if (symA.length !== symB.length) return false;
            for (let i = 0; i < symA.length; i++) {
                if (symA[i] !== symB[i]) return false;
                if (!_innerDeep(a[symA[i]], b[symA[i]], strict, memo)) return false;
            }
        }
        return true;
    }

    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    ka.sort();
    kb.sort();
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return false;
    }
    for (let i = 0; i < ka.length; i++) {
        if (!_innerDeep(a[ka[i]], b[ka[i]], strict, memo)) return false;
    }
    if (strict) {
        const symA = _getEnumSymbols(a);
        const symB = _getEnumSymbols(b);
        if (symA.length !== symB.length) return false;
        for (let i = 0; i < symA.length; i++) {
            if (symA[i] !== symB[i]) return false;
            if (!_innerDeep(a[symA[i]], b[symA[i]], strict, memo)) return false;
        }
    }
    return true;
}

let _deepCallCount = 0;
function _innerDeep(a, b, strict, memo) {
    _deepCallCount++;
    if (_deepCallCount > 5000) {
        _deepCallCount = 0;
        return false;
    }
    if (Object.is(a, b)) return true;
    if (strict) {
        // Strict mode: both must be objects to proceed to deep comparison
        if (typeof a !== 'object' || typeof b !== 'object' ||
            a === null || b === null) {
            return false;
        }
    } else {
        // Loose mode: if one is a primitive, only allow match if BOTH are primitives
        if (a === null || typeof a !== 'object') {
            return (b === null || typeof b !== 'object') &&
                   (a == b || (a !== a && b !== b));
        }
        if (b === null || typeof b !== 'object') {
            return false;
        }
    }
    return _deepObjEquiv(a, b, strict, memo);
}

export function innerDeepEqual(a, b, strict, memo) {
    _deepCallCount = 0;
    return _innerDeep(a, b, strict, memo);
}

export function isDeepStrictEqual(val1, val2) {
    _deepCallCount = 0;
    return _innerDeep(val1, val2, true, undefined);
}

const _externalValueMarkerSymbol = Symbol.for('wasm-rquickjs.util.types.external');

function _getTypedArrayTag(v) {
    if (_TypedArrayToStringTagGetter === null || !v || typeof v !== 'object') {
        return null;
    }

    try {
        const tag = _TypedArrayToStringTagGetter.call(v);
        return typeof tag === 'string' ? tag : null;
    } catch {
        return null;
    }
}

function _isExternalLike(v) {
    return !!v && typeof v === 'object' && v[_externalValueMarkerSymbol] === true;
}

export const types = {
    isAnyArrayBuffer: internalUtilTypes.isAnyArrayBuffer,
    isArrayBuffer: internalUtilTypes.isArrayBuffer,
    isArrayBufferView: internalUtilTypes.isArrayBufferView,
    isDataView: internalUtilTypes.isDataView,
    isSharedArrayBuffer: internalUtilTypes.isSharedArrayBuffer,
    isTypedArray: function isTypedArray(v) {
        return _getTypedArrayTag(v) !== null;
    },
    isUint8Array: function isUint8Array(v) {
        return _getTypedArrayTag(v) === 'Uint8Array';
    },
    isUint8ClampedArray: function isUint8ClampedArray(v) {
        return _getTypedArrayTag(v) === 'Uint8ClampedArray';
    },
    isUint16Array: function isUint16Array(v) {
        return _getTypedArrayTag(v) === 'Uint16Array';
    },
    isUint32Array: function isUint32Array(v) {
        return _getTypedArrayTag(v) === 'Uint32Array';
    },
    isInt8Array: function isInt8Array(v) {
        return _getTypedArrayTag(v) === 'Int8Array';
    },
    isInt16Array: function isInt16Array(v) {
        return _getTypedArrayTag(v) === 'Int16Array';
    },
    isInt32Array: function isInt32Array(v) {
        return _getTypedArrayTag(v) === 'Int32Array';
    },
    isFloat32Array: function isFloat32Array(v) {
        return _getTypedArrayTag(v) === 'Float32Array';
    },
    isFloat64Array: function isFloat64Array(v) {
        return _getTypedArrayTag(v) === 'Float64Array';
    },
    isBigInt64Array: function isBigInt64Array(v) {
        return _getTypedArrayTag(v) === 'BigInt64Array';
    },
    isBigUint64Array: function isBigUint64Array(v) {
        return _getTypedArrayTag(v) === 'BigUint64Array';
    },
    isFloat16Array: function isFloat16Array(v) {
        return _getTypedArrayTag(v) === 'Float16Array';
    },
    isDate: internalUtilTypes.isDate,
    isRegExp: internalUtilTypes.isRegExp,
    isMap: internalUtilTypes.isMap,
    isSet: internalUtilTypes.isSet,
    isWeakMap: internalUtilTypes.isWeakMap,
    isWeakSet: internalUtilTypes.isWeakSet,
    isPromise: internalUtilTypes.isPromise,
    isNativeError: internalUtilTypes.isNativeError,
    isAsyncFunction: internalUtilTypes.isAsyncFunction,
    isGeneratorFunction: internalUtilTypes.isGeneratorFunction,
    isGeneratorObject: internalUtilTypes.isGeneratorObject,
    isStringObject: internalUtilTypes.isStringObject,
    isNumberObject: internalUtilTypes.isNumberObject,
    isBooleanObject: internalUtilTypes.isBooleanObject,
    isBigIntObject: internalUtilTypes.isBigIntObject,
    isSymbolObject: internalUtilTypes.isSymbolObject,
    isBoxedPrimitive: internalUtilTypes.isBoxedPrimitive,
    isMapIterator: internalUtilTypes.isMapIterator,
    isSetIterator: internalUtilTypes.isSetIterator,
    isArgumentsObject: internalUtilTypes.isArgumentsObject,
    isModuleNamespaceObject: internalUtilTypes.isModuleNamespaceObject,
    isProxy: function isProxy(v) {
        return getProxyDetailsNative(v, false) !== undefined;
    },
    isExternal: function isExternal(v) {
        return _isExternalLike(v);
    },
    isCryptoKey: function isCryptoKey(value) { return typeof globalThis.CryptoKey === 'function' && value instanceof globalThis.CryptoKey; },
    isKeyObject: function isKeyObject() { return false; }
};

const getCallSiteRenameWarning = "The `util.getCallSite` API has been renamed to `util.getCallSites()`.";
let getCallSiteRenameWarned = false;
const callSiteWithFunctionPattern = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const callSiteWithoutFunctionPattern = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;

function _validateGetCallSitesOptions(frameCount, options) {
    if (options === undefined) {
        if (typeof frameCount === 'object') {
            options = frameCount;
            frameCount = 10;
        } else {
            options = {};
        }
    }

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }

    if (options.sourceMap !== undefined && typeof options.sourceMap !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.sourceMap', 'boolean', options.sourceMap);
    }

    if (typeof frameCount !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('frameCount', 'number', frameCount);
    }

    if (Number.isNaN(frameCount) || frameCount < 1 || frameCount > 200) {
        throw new ERR_OUT_OF_RANGE('frameCount', '>= 1 && <= 200', frameCount);
    }

    return Math.trunc(frameCount);
}

function _resolveCallSiteScriptName(scriptName) {
    if (scriptName !== '<input>') {
        return scriptName;
    }

    const evalScriptName = globalThis.__wasm_rquickjs_current_eval_script_name;
    if (typeof evalScriptName === 'string' && evalScriptName.length > 0) {
        return evalScriptName;
    }

    const moduleContext = globalThis.__wasm_rquickjs_current_module;
    if (moduleContext && typeof moduleContext.filename === 'string' && moduleContext.filename.length > 0) {
        return moduleContext.filename;
    }

    return scriptName;
}

function _toCallSiteObject(functionName, scriptName, lineNumber, columnNumber) {
    const callSite = Object.create(null);
    callSite.functionName = functionName;
    callSite.scriptId = '';
    callSite.scriptName = _resolveCallSiteScriptName(scriptName);
    callSite.lineNumber = lineNumber;
    callSite.columnNumber = columnNumber;
    callSite.column = columnNumber;
    return callSite;
}

function _parseCallSite(line) {
    const withFunction = line.match(callSiteWithFunctionPattern);
    if (withFunction !== null) {
        return _toCallSiteObject(
            withFunction[1],
            withFunction[2],
            parseInt(withFunction[3], 10),
            parseInt(withFunction[4], 10),
        );
    }

    const withoutFunction = line.match(callSiteWithoutFunctionPattern);
    if (withoutFunction !== null) {
        return _toCallSiteObject(
            '',
            withoutFunction[1],
            parseInt(withoutFunction[2], 10),
            parseInt(withoutFunction[3], 10),
        );
    }

    return null;
}

function _isInternalUtilCallSite(scriptName) {
    if (typeof scriptName !== 'string' || scriptName.length === 0) {
        return false;
    }

    return scriptName === 'node:util' ||
        scriptName === 'util' ||
        scriptName.indexOf('__wasm_rquickjs_builtin/util.js') !== -1 ||
        scriptName.indexOf('/builtin/util.js') !== -1;
}

function _hasExecArgvFlag(flag) {
    if (typeof process === 'undefined' || !Array.isArray(process.execArgv)) {
        return false;
    }

    const prefixed = flag + '=';
    for (let i = 0; i < process.execArgv.length; i++) {
        const arg = String(process.execArgv[i]);
        if (arg === flag || arg.indexOf(prefixed) === 0) {
            return true;
        }
    }

    return false;
}

function _isSourceMapsEnabledFromExecArgv() {
    if (_hasExecArgvFlag('--no-enable-source-maps')) {
        return false;
    }

    return _hasExecArgvFlag('--enable-source-maps') ||
        _hasExecArgvFlag('--experimental-transform-types');
}

function _getSimpleSourceMapRegistry() {
    const registry = globalThis.__wasm_rquickjs_simple_source_maps;
    if (!registry || typeof registry !== 'object') {
        return null;
    }

    return registry;
}

function _getCjsLineOffsetRegistry() {
    const registry = globalThis.__wasm_rquickjs_cjs_line_offsets;
    if (!registry || typeof registry !== 'object') {
        return null;
    }

    return registry;
}

function _normalizeCallSiteLineNumber(callSite) {
    const registry = _getCjsLineOffsetRegistry();
    if (!registry) {
        return callSite;
    }

    const lineOffset = registry[callSite.scriptName];
    if (typeof lineOffset !== 'number' || !Number.isFinite(lineOffset) || lineOffset <= 0) {
        return callSite;
    }

    if (callSite.lineNumber <= lineOffset) {
        return callSite;
    }

    const normalizedCallSite = Object.create(null);
    normalizedCallSite.functionName = callSite.functionName;
    normalizedCallSite.scriptId = callSite.scriptId;
    normalizedCallSite.scriptName = callSite.scriptName;
    normalizedCallSite.lineNumber = callSite.lineNumber - lineOffset;
    normalizedCallSite.columnNumber = callSite.columnNumber;
    normalizedCallSite.column = callSite.column;
    return normalizedCallSite;
}

function _mapCallSiteWithSimpleSourceMap(callSite) {
    const registry = _getSimpleSourceMapRegistry();
    if (!registry) {
        return callSite;
    }

    const sourceMap = registry[callSite.scriptName];
    if (!sourceMap || !sourceMap.generatedLineToOriginalLine) {
        return callSite;
    }

    const mappedLine = sourceMap.generatedLineToOriginalLine[callSite.lineNumber];
    if (typeof mappedLine !== 'number' || !Number.isFinite(mappedLine)) {
        return callSite;
    }

    const mappedCallSite = Object.create(null);
    mappedCallSite.functionName = callSite.functionName;
    mappedCallSite.scriptId = callSite.scriptId;
    mappedCallSite.scriptName = callSite.scriptName;
    mappedCallSite.lineNumber = mappedLine;
    mappedCallSite.columnNumber = callSite.columnNumber;
    mappedCallSite.column = callSite.column;
    return mappedCallSite;
}

function _captureGetCallSitesStack(skipFn, frameCount) {
    const err = new Error();
    if (typeof Error.captureStackTrace !== 'function') {
        return err && err.stack ? String(err.stack) : '';
    }

    let shouldRestoreStackTraceLimit = false;
    let originalStackTraceLimit;

    try {
        if (typeof isErrorStackTraceLimitWritable === 'function' && isErrorStackTraceLimitWritable()) {
            const requiredStackTraceLimit = Math.max(10, frameCount + 8);
            originalStackTraceLimit = Error.stackTraceLimit;
            if (typeof originalStackTraceLimit !== 'number' ||
                !Number.isFinite(originalStackTraceLimit) ||
                originalStackTraceLimit < requiredStackTraceLimit) {
                Error.stackTraceLimit = requiredStackTraceLimit;
                shouldRestoreStackTraceLimit = true;
            }
        }
    } catch (_) {
        // Ignore stackTraceLimit descriptor quirks and proceed with best effort.
    }

    try {
        Error.captureStackTrace(err, skipFn);
    } finally {
        if (shouldRestoreStackTraceLimit) {
            try {
                Error.stackTraceLimit = originalStackTraceLimit;
            } catch (_) {
                // Keep getCallSites resilient even if stackTraceLimit cannot be restored.
            }
        }
    }

    return err && err.stack ? String(err.stack) : '';
}

export function getCallSites(frameCount = 10, options) {
    let normalizedOptions = options;
    if (normalizedOptions === undefined) {
        if (typeof frameCount === 'object') {
            normalizedOptions = frameCount;
        } else {
            normalizedOptions = {};
        }
    }

    frameCount = _validateGetCallSitesOptions(frameCount, options);
    const shouldMapSourceLocations = normalizedOptions.sourceMap === true ||
        (_isSourceMapsEnabledFromExecArgv() && normalizedOptions.sourceMap !== false);

    const stack = _captureGetCallSitesStack(getCallSites, frameCount);
    const lines = stack.split('\n');
    const callSites = [];

    for (let i = 0; i < lines.length; i++) {
        if (callSites.length >= frameCount) {
            break;
        }

        const line = lines[i];
        let parsedCallSite = _parseCallSite(line);
        if (parsedCallSite === null) {
            continue;
        }

        if (line.indexOf('getCallSites') !== -1 ||
            line.indexOf('getCallSite') !== -1 ||
            _isInternalUtilCallSite(parsedCallSite.scriptName)) {
            continue;
        }

        parsedCallSite = _normalizeCallSiteLineNumber(parsedCallSite);

        if (shouldMapSourceLocations) {
            parsedCallSite = _mapCallSiteWithSimpleSourceMap(parsedCallSite);
        }

        callSites.push(parsedCallSite);
    }

    return callSites;
}

export function getCallSite(frameCount, options) {
    if (!getCallSiteRenameWarned) {
        getCallSiteRenameWarned = true;
        if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
            process.emitWarning(getCallSiteRenameWarning, 'ExperimentalWarning');
        }
    }

    return getCallSites(frameCount, options);
}

const _styleTextFormats = Object.keys(inspect.colors);

function _throwStyleTextInvalidArgValue(name, value, reason) {
    let inspected;
    try {
        inspected = JSON.stringify(value);
    } catch (_) {
        inspected = String(value);
    }

    let message = "The argument '" + name + "' " + reason;
    if (inspected !== undefined) {
        message += '. Received ' + inspected;
    }

    const err = new TypeError(message);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
}

function _isStyleTextFormatValue(format) {
    return format === 'none' || _styleTextFormats.indexOf(format) !== -1;
}

function _normalizeStyleTextFormats(format) {
    if (typeof format === 'string') {
        if (!_isStyleTextFormatValue(format)) {
            _throwStyleTextInvalidArgValue('format', format, 'must be a valid string format');
        }
        return [format];
    }

    if (Array.isArray(format)) {
        for (let i = 0; i < format.length; i++) {
            if (typeof format[i] !== 'string' || !_isStyleTextFormatValue(format[i])) {
                _throwStyleTextInvalidArgValue('format', format, 'must be a valid string format or array of string formats');
            }
        }
        return format;
    }

    _throwStyleTextInvalidArgValue('format', format, 'must be a valid string format or array of string formats');
}

function _replaceStyleTextCloseCode(text, closeSequence, openSequence, keepClose) {
    if (text.indexOf(closeSequence) === -1) {
        return text;
    }

    const replacement = keepClose ? closeSequence + openSequence : openSequence;
    return text.split(closeSequence).join(replacement);
}

function _applyStyleTextFormat(format, text) {
    if (format === 'none') {
        return text;
    }

    const style = inspect.colors[format];
    if (!Array.isArray(style) || style.length < 2) {
        _throwStyleTextInvalidArgValue('format', format, 'must be a valid string format');
    }

    const open = style[0];
    const close = style[1];
    const openSequence = '\u001b[' + open + 'm';
    const closeSequence = '\u001b[' + close + 'm';

    const keepClose = open === 1 || open === 2;
    const processedText = _replaceStyleTextCloseCode(text, closeSequence, openSequence, keepClose);

    return openSequence + processedText + closeSequence;
}

function _parseStyleTextForceColor(value) {
    const normalized = String(value).toLowerCase();
    if (normalized === '' || normalized === 'true' || normalized === '1') {
        return 4;
    }
    if (normalized === '2') {
        return 8;
    }
    if (normalized === '3') {
        return 24;
    }
    return 1;
}

function _shouldStyleTextColorize(stream) {
    if (typeof process === 'undefined' || process.env === undefined || process.env === null) {
        return !!(stream && stream.isTTY);
    }

    const env = process.env;

    if (env.FORCE_COLOR !== undefined) {
        return _parseStyleTextForceColor(env.FORCE_COLOR) > 2;
    }

    if (env.NODE_DISABLE_COLORS !== undefined || env.NO_COLOR !== undefined || env.TERM === 'dumb') {
        return false;
    }

    if (!stream || !stream.isTTY) {
        return false;
    }

    if (typeof stream.getColorDepth === 'function') {
        try {
            return stream.getColorDepth() > 2;
        } catch (_) {
            return false;
        }
    }

    return true;
}

function _isStyleTextStream(stream) {
    if (!stream || (typeof stream !== 'object' && typeof stream !== 'function')) {
        return false;
    }

    return typeof stream.write === 'function' ||
        typeof stream.read === 'function' ||
        typeof stream.pipe === 'function' ||
        typeof stream.on === 'function';
}

export function styleText(format, text, options) {
    if (typeof text !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('text', 'string', text);
    }

    const formats = _normalizeStyleTextFormats(format);
    let stream = typeof process !== 'undefined' ? process.stdout : undefined;
    let validateStream = true;

    if (options !== undefined) {
        if (typeof options !== 'object' || options === null || Array.isArray(options)) {
            throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
        }

        if (options.stream !== undefined) {
            stream = options.stream;
        }

        if (options.validateStream !== undefined) {
            if (typeof options.validateStream !== 'boolean') {
                throw new ERR_INVALID_ARG_TYPE('options.validateStream', 'boolean', options.validateStream);
            }
            validateStream = options.validateStream;
        }
    }

    if (validateStream) {
        if (!_isStyleTextStream(stream)) {
            throw new ERR_INVALID_ARG_TYPE('options.stream', ['ReadableStream', 'WritableStream', 'Stream'], stream);
        }

        if (!_shouldStyleTextColorize(stream)) {
            return text;
        }
    }

    let styledText = text;
    for (let i = formats.length - 1; i >= 0; i--) {
        styledText = _applyStyleTextFormat(formats[i], styledText);
    }

    return styledText;
}

// --- util.parseEnv() ---

function _parseEnvTrimSpaces(input) {
    if (input.length === 0) {
        return '';
    }

    let start = 0;
    let end = input.length;

    while (start < end && input.charAt(start) === ' ') {
        start++;
    }

    while (end > start && input.charAt(end - 1) === ' ') {
        end--;
    }

    return input.slice(start, end);
}

export function parseEnv(content) {
    if (typeof content !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('content', 'string', content);
    }

    const store = {};
    let remaining = _parseEnvTrimSpaces(content.replace(/\r/g, ''));

    while (remaining.length > 0) {
        if (remaining.charAt(0) === '\n' || remaining.charAt(0) === '#') {
            const commentNewline = remaining.indexOf('\n');
            if (commentNewline !== -1) {
                remaining = remaining.slice(commentNewline + 1);
                continue;
            }
        }

        const equalIndex = remaining.indexOf('=');
        if (equalIndex === -1) {
            break;
        }

        let key = _parseEnvTrimSpaces(remaining.slice(0, equalIndex));
        remaining = _parseEnvTrimSpaces(remaining.slice(equalIndex + 1));

        if (key.length === 0) {
            break;
        }

        if (key.slice(0, 7) === 'export ') {
            key = key.slice(7);
        }

        if (remaining.length === 0) {
            store[key] = '';
            break;
        }

        if (remaining.charAt(0) === '"') {
            const doubleQuoteCloseIndex = remaining.indexOf('"', 1);
            if (doubleQuoteCloseIndex !== -1) {
                const doubleQuotedValue = remaining.slice(1, doubleQuoteCloseIndex);
                store[key] = doubleQuotedValue.replace(/\\n/g, '\n');

                const doubleQuoteNewlineIndex = remaining.indexOf('\n', doubleQuoteCloseIndex + 1);
                if (doubleQuoteNewlineIndex !== -1) {
                    remaining = remaining.slice(doubleQuoteNewlineIndex);
                }

                continue;
            }
        }

        const firstChar = remaining.charAt(0);
        if (firstChar === '\'' || firstChar === '"' || firstChar === '`') {
            const quoteCloseIndex = remaining.indexOf(firstChar, 1);
            if (quoteCloseIndex === -1) {
                const unclosedQuoteNewlineIndex = remaining.indexOf('\n');
                if (unclosedQuoteNewlineIndex !== -1) {
                    store[key] = remaining.slice(0, unclosedQuoteNewlineIndex);
                    remaining = remaining.slice(unclosedQuoteNewlineIndex);
                } else {
                    store[key] = remaining;
                    break;
                }
            } else {
                store[key] = remaining.slice(1, quoteCloseIndex);

                const quotedNewlineIndex = remaining.indexOf('\n', quoteCloseIndex + 1);
                if (quotedNewlineIndex !== -1) {
                    remaining = remaining.slice(quotedNewlineIndex);
                } else {
                    break;
                }
            }

            continue;
        }

        const newlineIndex = remaining.indexOf('\n');
        let value;
        if (newlineIndex !== -1) {
            value = remaining.slice(0, newlineIndex);
            const hashIndex = value.indexOf('#');
            if (hashIndex !== -1) {
                value = remaining.slice(0, hashIndex);
            }
            remaining = remaining.slice(newlineIndex);
        } else {
            value = remaining;
            remaining = '';
        }

        store[key] = _parseEnvTrimSpaces(value);
    }

    return store;
}

// --- util.parseArgs() ---

function _makeError(code, message) {
    const err = new TypeError(message);
    err.code = code;
    return err;
}

function _findLongOption(optionName, options) {
    if (options && Object.prototype.hasOwnProperty.call(options, optionName)) {
        return optionName;
    }
    return null;
}

function _findShortOption(shortChar, options) {
    if (!options) return null;
    const keys = Object.keys(options);
    for (let i = 0; i < keys.length; i++) {
        const opt = options[keys[i]];
        if (opt && opt.short === shortChar) {
            return keys[i];
        }
    }
    return null;
}

export function parseArgs(config) {
    if (config === undefined) config = {};
    if (typeof config !== 'object' || config === null) {
        throw _makeError('ERR_INVALID_ARG_TYPE',
            'The "config" argument must be of type object');
    }

    let args = config.args;
    if (args === undefined) {
        args = typeof process !== 'undefined' && process.argv ? process.argv.slice(2) : [];
    }
    if (!Array.isArray(args)) {
        throw _makeError('ERR_INVALID_ARG_TYPE',
            'The "args" argument must be an instance of Array');
    }

    const options = config.options || {};
    const strict = config.strict !== undefined ? config.strict : true;
    let allowPositionals = config.allowPositionals;
    if (allowPositionals === undefined) {
        allowPositionals = !strict;
    }
    const allowNegative = config.allowNegative || false;
    const returnTokens = config.tokens || false;

    // Validate options config
    const optionKeys = Object.keys(options);
    for (let oi = 0; oi < optionKeys.length; oi++) {
        const optName = optionKeys[oi];
        if (optName === '__proto__') {
            throw _makeError('ERR_INVALID_ARG_VALUE',
                "The property 'options.__proto__' is invalid. __proto__ is not allowed");
        }
        const desc = options[optName];
        if (desc.type !== 'string' && desc.type !== 'boolean') {
            throw _makeError('ERR_INVALID_ARG_VALUE',
                "The property 'options." + optName + ".type' is invalid. " +
                "Received '" + desc.type + "'");
        }
        if (desc.short !== undefined) {
            if (typeof desc.short !== 'string' || desc.short.length !== 1) {
                throw _makeError('ERR_INVALID_ARG_VALUE',
                    "The property 'options." + optName + ".short' is invalid. " +
                    "It must be a single character, received '" + desc.short + "'");
            }
        }
    }

    const values = Object.create(null);
    const positionals = [];
    const tokens = [];

    // Apply defaults
    for (let di = 0; di < optionKeys.length; di++) {
        const defName = optionKeys[di];
        const defDesc = options[defName];
        if (defDesc.default !== undefined) {
            values[defName] = defDesc.default;
        } else if (defDesc.multiple) {
            values[defName] = [];
        }
    }

    let seenTerminator = false;
    let index = 0;

    while (index < args.length) {
        const arg = args[index];

        if (seenTerminator) {
            if (strict && !allowPositionals) {
                throw _makeError('ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL',
                    "Unexpected argument '" + arg + "'. This command does not take positional arguments");
            }
            positionals.push(arg);
            if (returnTokens) {
                tokens.push({ kind: 'positional', value: arg, index: index });
            }
            index++;
            continue;
        }

        // Option terminator
        if (arg === '--') {
            seenTerminator = true;
            if (returnTokens) {
                tokens.push({ kind: 'option-terminator', index: index });
            }
            index++;
            continue;
        }

        // Long option
        if (arg.length > 2 && arg.charAt(0) === '-' && arg.charAt(1) === '-') {
            const eqIdx = arg.indexOf('=');
            let longName, inlineValue;
            if (eqIdx !== -1) {
                longName = arg.slice(2, eqIdx);
                inlineValue = arg.slice(eqIdx + 1);
            } else {
                longName = arg.slice(2);
                inlineValue = undefined;
            }

            // Check for --no- negation
            let isNegated = false;
            let resolvedName = _findLongOption(longName, options);
            if (resolvedName === null && allowNegative && longName.slice(0, 3) === 'no-') {
                const positiveName = longName.slice(3);
                const positiveResolved = _findLongOption(positiveName, options);
                if (positiveResolved !== null && options[positiveResolved].type === 'boolean') {
                    isNegated = true;
                    resolvedName = positiveResolved;
                    longName = positiveName;
                }
            }

            if (resolvedName === null) {
                if (strict) {
                    throw _makeError('ERR_PARSE_ARGS_UNKNOWN_OPTION',
                        "Unknown option '--" + longName + "'");
                }
                // In non-strict mode, treat unknown as boolean
                let unknownVal = inlineValue !== undefined ? inlineValue : true;
                if (typeof unknownVal === 'string' && unknownVal === '') unknownVal = '';
                values[longName] = unknownVal;
                if (returnTokens) {
                    tokens.push({
                        kind: 'option', name: longName, rawName: '--' + longName,
                        value: typeof unknownVal === 'boolean' ? undefined : unknownVal,
                        index: index
                    });
                }
                index++;
                continue;
            }

            const optDesc = options[resolvedName];

            if (isNegated) {
                if (inlineValue !== undefined) {
                    if (strict) {
                        throw _makeError('ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
                            "Option '--no-" + resolvedName + "' does not take an argument");
                    }
                }
                _storeOption(values, resolvedName, optDesc, false);
                if (returnTokens) {
                    tokens.push({
                        kind: 'option', name: resolvedName,
                        rawName: '--no-' + resolvedName,
                        value: undefined, index: index
                    });
                }
                index++;
                continue;
            }

            if (optDesc.type === 'boolean') {
                if (inlineValue !== undefined && strict) {
                    throw _makeError('ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
                        "Option '--" + resolvedName +
                        "' does not take an argument");
                }
                _storeOption(values, resolvedName, optDesc, true);
                if (returnTokens) {
                    tokens.push({
                        kind: 'option', name: resolvedName,
                        rawName: '--' + resolvedName,
                        value: undefined, index: index
                    });
                }
            } else {
                // string type
                let strVal;
                if (inlineValue !== undefined) {
                    strVal = inlineValue;
                } else if (index + 1 < args.length) {
                    strVal = args[++index];
                } else {
                    if (strict) {
                        throw _makeError('ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
                            "Option '--" + resolvedName +
                            "' argument missing");
                    }
                    strVal = '';
                }
                _storeOption(values, resolvedName, optDesc, strVal);
                if (returnTokens) {
                    tokens.push({
                        kind: 'option', name: resolvedName,
                        rawName: '--' + resolvedName,
                        value: strVal, index: index
                    });
                }
            }
            index++;
            continue;
        }

        // Short option(s)
        if (arg.length >= 2 && arg.charAt(0) === '-' && arg.charAt(1) !== '-') {
            const shortGroup = arg.slice(1);
            let si = 0;
            while (si < shortGroup.length) {
                const shortChar = shortGroup.charAt(si);
                const shortResolved = _findShortOption(shortChar, options);

                if (shortResolved === null) {
                    if (strict) {
                        throw _makeError('ERR_PARSE_ARGS_UNKNOWN_OPTION',
                            "Unknown option '-" + shortChar + "'");
                    }
                    values[shortChar] = true;
                    if (returnTokens) {
                        tokens.push({
                            kind: 'option', name: shortChar,
                            rawName: '-' + shortChar,
                            value: undefined, index: index
                        });
                    }
                    si++;
                    continue;
                }

                const shortDesc = options[shortResolved];

                if (shortDesc.type === 'boolean') {
                    _storeOption(values, shortResolved, shortDesc, true);
                    if (returnTokens) {
                        tokens.push({
                            kind: 'option', name: shortResolved,
                            rawName: '-' + shortChar,
                            value: undefined, index: index
                        });
                    }
                    si++;
                } else {
                    // string type — rest of group is the value, or next arg
                    let shortVal;
                    if (si + 1 < shortGroup.length) {
                        shortVal = shortGroup.slice(si + 1);
                    } else if (index + 1 < args.length) {
                        shortVal = args[++index];
                    } else {
                        if (strict) {
                            throw _makeError('ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
                                "Option '-" + shortChar +
                                "' argument missing");
                        }
                        shortVal = '';
                    }
                    _storeOption(values, shortResolved, shortDesc, shortVal);
                    if (returnTokens) {
                        tokens.push({
                            kind: 'option', name: shortResolved,
                            rawName: '-' + shortChar,
                            value: shortVal, index: index
                        });
                    }
                    break; // consumed rest of group
                }
            }
            index++;
            continue;
        }

        // Positional
        if (strict && !allowPositionals) {
            throw _makeError('ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL',
                "Unexpected argument '" + arg + "'. This command does not take positional arguments");
        }
        positionals.push(arg);
        if (returnTokens) {
            tokens.push({ kind: 'positional', value: arg, index: index });
        }
        index++;
    }

    const result = { values: values, positionals: positionals };
    if (returnTokens) {
        result.tokens = tokens;
    }
    return result;
}

function _storeOption(values, name, desc, value) {
    if (desc.multiple) {
        if (!Array.isArray(values[name])) {
            values[name] = [];
        }
        values[name].push(value);
    } else {
        values[name] = value;
    }
}

import { TextEncoder as _TextEncoder, TextDecoder as _TextDecoder } from '__wasm_rquickjs_builtin/encoding';
export const TextEncoder = _TextEncoder;
export const TextDecoder = _TextDecoder;

// Track resources registered via util.aborted().  Each entry keeps a strong
// reference (to survive ref-counting) and stores the signal + listener so the
// pre-gc hook can proactively remove the listener when the resource has no
// external references.  This mimics Node.js's kWeakHandler behavior.
const _abortedResources = new Map();

function _preGcAbortedCleanup() {
    for (const [listener, entry] of _abortedResources) {
        // Release the strong reference.  With ref-counting, if no other code
        // holds the resource, the WeakRef becomes dead immediately.
        entry.strong = null;
        if (entry.weak.deref() === undefined) {
            // Resource already freed — remove the abort listener so the
            // promise stays forever-pending (Node.js kWeakHandler semantics).
            entry.signal.removeEventListener('abort', listener);
            _abortedResources.delete(listener);
        }
    }
}

// Chain into the existing pre-gc hook
const _previousPreGc = globalThis.__wasm_rquickjs_pre_gc;
globalThis.__wasm_rquickjs_pre_gc = function () {
    if (typeof _previousPreGc === 'function') {
        _previousPreGc();
    }
    _preGcAbortedCleanup();
};

export function aborted(signal, resource) {
    if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new ERR_INVALID_ARG_TYPE('signal', 'AbortSignal', signal));
    }
    if (resource === null || resource === undefined ||
        (typeof resource !== 'object' && typeof resource !== 'function')) {
        return Promise.reject(new ERR_INVALID_ARG_TYPE('resource', 'Object', resource));
    }
    if (signal.aborted) return Promise.resolve();
    const weakResource = new WeakRef(resource);
    const entry = { strong: resource, weak: weakResource, signal: signal };
    return new Promise(function (resolve) {
        function onAbort() {
            _abortedResources.delete(onAbort);
            resolve();
        }
        signal.addEventListener('abort', onAbort, { once: true });
        _abortedResources.set(onAbort, entry);
    });
}

const TRANSFERABLE_ABORT_SIGNAL = Symbol.for('__wasm_rquickjs.transferableAbortSignal');

export function transferableAbortController() {
    const ac = new AbortController();
    ac.signal[TRANSFERABLE_ABORT_SIGNAL] = true;
    return ac;
}

export function transferableAbortSignal(signal) {
    if (!(signal instanceof AbortSignal)) {
        throw new ERR_INVALID_ARG_TYPE('signal', 'AbortSignal', signal);
    }
    signal[TRANSFERABLE_ABORT_SIGNAL] = true;
    return signal;
}

export { inspect, format, formatWithOptions, stripVTControlCharacters };

export default {
     format,
     formatWithOptions,
     deprecate,
     debuglog,
     inspect,
     styleText,
     isArray,
     isBoolean,
     isNull,
     isNullOrUndefined,
     isNumber,
     isString,
     isSymbol,
     isUndefined,
     isRegExp,
     isObject,
     isDate,
     isMap,
     isSet,
     isWeakMap,
     isWeakSet,
     isError,
     isFunction,
     isPrimitive,
     isBuffer,
     log,
     _extend,
     promisify,
     callbackify,
     inherits,
     isDeepStrictEqual,
     getCallSite,
     getCallSites,
     parseEnv,
     parseArgs,
     toUSVString,
     types,
     TextEncoder,
     TextDecoder,
     stripVTControlCharacters,
     aborted,
     transferableAbortController,
     transferableAbortSignal
     }
