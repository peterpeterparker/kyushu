// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
//
// Adapted from Node.js. Copyright Joyent, Inc. and other Node contributors.
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

const _toString = Object.prototype.toString;
const _getPrototypeOf = Object.getPrototypeOf;

const _isObjectLike = (value) =>
    value !== null && typeof value === "object";

const _isFunctionLike = (value) =>
    value !== null && typeof value === "function";

const _isPrototypeInChain = (value, prototype) => {
    if (!_isObjectLike(value) || prototype === null) {
        return false;
    }

    let current = _getPrototypeOf(value);
    while (current !== null) {
        if (current === prototype) {
            return true;
        }
        current = _getPrototypeOf(current);
    }

    return false;
};

const _mapIteratorPrototype = (() => {
    if (typeof Map !== "function") {
        return null;
    }
    return _getPrototypeOf(new Map().keys());
})();

const _setIteratorPrototype = (() => {
    if (typeof Set !== "function") {
        return null;
    }
    return _getPrototypeOf(new Set().values());
})();

export function isAnyArrayBuffer(value) {
    return (
        _isObjectLike(value) &&
        (_toString.call(value) === "[object ArrayBuffer]" ||
            _toString.call(value) === "[object SharedArrayBuffer]")
    );
}

export function isArgumentsObject(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Arguments]";
}

export function isArrayBuffer(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object ArrayBuffer]"
    );
}

export function isAsyncFunction(value) {
    return (
        _isFunctionLike(value) && _toString.call(value) === "[object AsyncFunction]"
    );
}

export function isBooleanObject(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        return typeof Boolean.prototype.valueOf.call(value) === "boolean";
    } catch {
        return false;
    }
}

export function isBoxedPrimitive(value) {
    return (
        isBooleanObject(value) ||
        isStringObject(value) ||
        isNumberObject(value) ||
        isSymbolObject(value) ||
        isBigIntObject(value)
    );
}

export function isDataView(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object DataView]";
}

export function isDate(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Date]";
}

export function isGeneratorFunction(value) {
    return (
        _isFunctionLike(value) &&
        _toString.call(value) === "[object GeneratorFunction]"
    );
}

export function isGeneratorObject(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Generator]";
}

export function isMap(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        // `Object.prototype.toString` alone is too permissive for QuickJS and
        // matches objects inheriting from `Map.prototype`.
        Map.prototype.has.call(value, undefined);
        return true;
    } catch {
        return false;
    }
}

export function isMapIterator(value) {
    return (
        _isObjectLike(value) &&
        (
            _isPrototypeInChain(value, _mapIteratorPrototype) ||
            _toString.call(value) === "[object Map Iterator]"
        )
    );
}

export function isModuleNamespaceObject(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Module]";
}

export function isNativeError(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Error]";
}

export function isNumberObject(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        return typeof Number.prototype.valueOf.call(value) === "number";
    } catch {
        return false;
    }
}

export function isBigIntObject(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        return typeof BigInt.prototype.valueOf.call(value) === "bigint";
    } catch {
        return false;
    }
}

export function isPromise(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Promise]";
}

export function isRegExp(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object RegExp]";
}

export function isSet(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        // Mirror `isMap` semantics for Set objects as well.
        Set.prototype.has.call(value, undefined);
        return true;
    } catch {
        return false;
    }
}

export function isSetIterator(value) {
    return (
        _isObjectLike(value) &&
        (
            _isPrototypeInChain(value, _setIteratorPrototype) ||
            _toString.call(value) === "[object Set Iterator]"
        )
    );
}

export function isSharedArrayBuffer(value) {
    return (
        _isObjectLike(value) &&
        _toString.call(value) === "[object SharedArrayBuffer]"
    );
}

export function isStringObject(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        return typeof String.prototype.valueOf.call(value) === "string";
    } catch {
        return false;
    }
}

export function isSymbolObject(value) {
    if (!_isObjectLike(value)) {
        return false;
    }
    try {
        return typeof Symbol.prototype.valueOf.call(value) === "symbol";
    } catch {
        return false;
    }
}

export function isWeakMap(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object WeakMap]";
}

export function isWeakSet(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object WeakSet]";
}

export function isArrayBufferView(value) {
    return ArrayBuffer.isView(value);
}

export function isBigInt64Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object BigInt64Array]"
    );
}

export function isBigUint64Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object BigUint64Array]"
    );
}

export function isFloat32Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Float32Array]"
    );
}

export function isFloat64Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Float64Array]"
    );
}

export function isInt8Array(value) {
    return _isObjectLike(value) && _toString.call(value) === "[object Int8Array]";
}

export function isInt16Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Int16Array]"
    );
}

export function isInt32Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Int32Array]"
    );
}

// Adapted from Lodash
export function isTypedArray(value) {
    /** Used to match `toStringTag` values of typed arrays. */
    const reTypedTag =
        /^\[object (?:Float(?:32|64)|(?:Int|Uint)(?:8|16|32)|Uint8Clamped|Big(?:Uint|Int)64)Array\]$/;
    return _isObjectLike(value) && reTypedTag.test(_toString.call(value));
}

export function isUint8Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Uint8Array]"
    );
}

export function isUint8ClampedArray(value) {
    return (
        _isObjectLike(value) &&
        _toString.call(value) === "[object Uint8ClampedArray]"
    );
}

export function isUint16Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Uint16Array]"
    );
}

export function isUint32Array(value) {
    return (
        _isObjectLike(value) && _toString.call(value) === "[object Uint32Array]"
    );
}
