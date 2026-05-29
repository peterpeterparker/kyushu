// Shared helpers used by both fs.js and fs_promises.js.
// This module must NOT import from 'node:fs' to avoid circular dependencies.

export function getInternalFsBinding() {
    return globalThis.__wasm_rquickjs_internal_fs_binding ||
        (globalThis.__wasm_rquickjs_internal_fs_binding = {});
}

export function describeType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return 'function ' + (value.name || '');
    if (typeof value === 'object') {
        if (value.constructor && value.constructor.name) {
            return 'an instance of ' + value.constructor.name;
        }
        return value + '';
    }
    if (typeof value === 'string') return "type string ('" + value + "')";
    return 'type ' + typeof value + ' (' + String(value) + ')';
}

export function getSystemErrorDescription(message) {
    if (typeof message !== 'string' || message.length === 0) {
        return 'unknown error';
    }
    const parsedMessage = /^\s*[A-Z0-9_]+:\s*([^,]+),/.exec(message);
    if (parsedMessage && parsedMessage[1]) {
        return parsedMessage[1];
    }
    return message;
}

export function createSystemError(errObj) {
    if (!errObj) return null;
    let msg = typeof errObj.message === 'string' ? errObj.message : 'unknown error';
    if (errObj.code && errObj.syscall) {
        msg = errObj.code + ': ' + getSystemErrorDescription(errObj.message) + ', ' + errObj.syscall;
        if (errObj.path !== undefined) msg += " '" + errObj.path + "'";
        if (errObj.dest !== undefined) msg += " -> '" + errObj.dest + "'";
    }
    const err = new Error(msg);
    err.code = errObj.code;
    err.errno = errObj.errno;
    err.syscall = errObj.syscall;
    if (errObj.path !== undefined) err.path = errObj.path;
    if (errObj.dest !== undefined) err.dest = errObj.dest;
    return err;
}

export function validateInteger(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be an integer. Received ${String(value)}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (min !== undefined && max !== undefined && (value < min || value > max)) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be >= ${min} && <= ${max}. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (min !== undefined && value < min) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be >= ${min}. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (max !== undefined && value > max) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be <= ${max}. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
}

export function validateMode(mode, name, def) {
    mode = mode ?? def;
    if (typeof mode === 'string') {
        if (!/^[0-7]+$/.test(mode)) {
            const err = new TypeError(`The argument '${name}' must be a 32-bit unsigned integer or an octal string. Received '${mode}'`);
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        return parseInt(mode, 8);
    }
    if (typeof mode !== 'number') {
        const err = new TypeError(`The "${name}" argument must be of type number. Received ${describeType(mode)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    validateInteger(mode, name, 0, 4294967295);
    return mode;
}

export function parseMkdirOptions(options, mkdirModeMask) {
    let recursive = false;
    let mode = 0o777;

    if (typeof options === 'number' || typeof options === 'string') {
        mode = options;
    } else if (options && typeof options === 'object') {
        if (options.recursive !== undefined) {
            recursive = options.recursive;
            if (typeof recursive !== 'boolean') {
                const err = new TypeError(
                    'The "options.recursive" property must be of type boolean. Received ' +
                    describeType(recursive)
                );
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
        if (options.mode !== undefined) {
            mode = options.mode;
        }
    }

    return {
        recursive,
        mode: validateMode(mode, 'mode', 0o777) & mkdirModeMask,
    };
}

export function formatEmptyBufferValue(buffer) {
    const ctorName = buffer && buffer.constructor && buffer.constructor.name ? buffer.constructor.name : 'Uint8Array';
    return `${ctorName}(0) []`;
}

export function throwEmptyReadBufferError(buffer) {
    const err = new TypeError(`The argument 'buffer' is empty and cannot be written. Received ${formatEmptyBufferValue(buffer)}`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
}

export function validateUid(id, name) {
    if (typeof id !== 'number') {
        const err = new TypeError(`The "${name}" argument must be of type number. Received ${describeType(id)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    validateInteger(id, name, -1, 4294967295);
}

export function validateFlush(flush) {
    if (flush !== undefined && flush !== null && typeof flush !== 'boolean') {
        const err = new TypeError('The "flush" argument must be of type boolean. Received ' + describeType(flush));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

export function validateAbortSignal(signal, name = 'options.signal') {
    if (signal !== undefined && (signal === null || typeof signal !== 'object' || !('aborted' in signal))) {
        const err = new TypeError(`The "${name}" argument must be an instance of AbortSignal. Received ${describeType(signal)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

export function validateAppendFileData(data) {
    if (typeof data === 'string' || ArrayBuffer.isView(data)) {
        return;
    }

    const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ' + describeType(data));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

export function validateMkdtempPrefix(prefix, getBufferFn, validatePathFn) {
    if (prefix instanceof Uint8Array) {
        if (prefix.includes(0)) {
            const err = new TypeError(`The argument 'prefix' must be a string, Uint8Array, or URL without null bytes. Received ${describeType(prefix)}`);
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        return;
    }
    validatePathFn(prefix, 'prefix');
}

export function makeAbortError() {
    const e = new DOMException('The operation was aborted', 'AbortError');
    e.name = 'AbortError';
    return e;
}
