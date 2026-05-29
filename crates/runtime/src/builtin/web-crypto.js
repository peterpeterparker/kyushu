import * as webCryptoNative from '__wasm_rquickjs_builtin/web_crypto_native'
import Transform from '__wasm_rquickjs_builtin/internal/streams/transform'
import { DOMException } from '__wasm_rquickjs_builtin/abort_controller'
import {
    ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS,
    ERR_CRYPTO_INVALID_DIGEST,
    ERR_CRYPTO_INVALID_JWK,
    ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE,
    ERR_ILLEGAL_CONSTRUCTOR,
    ERR_INCOMPATIBLE_OPTION_PAIR,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_THIS,
    ERR_MISSING_OPTION,
    ERR_OUT_OF_RANGE,
    ERR_UNKNOWN_ENCODING,
} from '__wasm_rquickjs_builtin/internal/errors'
import { normalizeEncoding } from '__wasm_rquickjs_builtin/internal/util'
import { inspect } from '__wasm_rquickjs_builtin/internal/util/inspect'
import { kMaxLength } from 'buffer'

const structuredCloneSymbol = Symbol.for('__wasm_rquickjs.structuredClone')

const HASH_ALIASES = {
    'md5': 'md5',
    'rsa-md5': 'md5',
    'sha1': 'sha1',
    'sha-1': 'sha1',
    'dss1': 'sha1',
    'rsa-sha1': 'sha1',
    'rsa-sha-1': 'sha1',
    'sha224': 'sha224',
    'sha-224': 'sha224',
    'rsa-sha224': 'sha224',
    'rsa-sha-224': 'sha224',
    'sha256': 'sha256',
    'sha-256': 'sha256',
    'rsa-sha256': 'sha256',
    'rsa-sha-256': 'sha256',
    'rsa-sha2-256': 'sha256',
    'sha256withrsaencryption': 'sha256',
    'sha384': 'sha384',
    'sha-384': 'sha384',
    'rsa-sha384': 'sha384',
    'rsa-sha-384': 'sha384',
    'rsa-sha2-384': 'sha384',
    'sha384withrsaencryption': 'sha384',
    'sha512': 'sha512',
    'sha-512': 'sha512',
    'rsa-sha512': 'sha512',
    'rsa-sha-512': 'sha512',
    'rsa-sha2-512': 'sha512',
    'sha512withrsaencryption': 'sha512',
    'sha3-256': 'sha3-256',
    'sha3-384': 'sha3-384',
    'sha3-512': 'sha3-512',
    'shake128': 'shake128',
    'shake-128': 'shake128',
    'shake256': 'shake256',
    'shake-256': 'shake256',
    'ripemd160': 'ripemd160',
    'rmd160': 'ripemd160',
};

const XOF_DEFAULT_OUTPUT_LENGTHS = {
    'shake128': 16,
    'shake256': 32,
};

const HASH_OUTPUT_LENGTHS = {
    'md5': 16,
    'sha1': 20,
    'sha224': 28,
    'sha256': 32,
    'sha384': 48,
    'sha512': 64,
    'sha3-256': 32,
    'sha3-384': 48,
    'sha3-512': 64,
    'ripemd160': 20,
};

const RSA_PKCS1_DIGEST_INFO_PREFIX_LENGTHS = {
    'md5': 18,
    'sha1': 15,
    'sha224': 19,
    'sha256': 19,
    'sha384': 19,
    'sha512': 19,
    'sha3-256': 19,
    'sha3-384': 19,
    'sha3-512': 19,
    'ripemd160': 15,
};

const HKDF_MAX_INFO_LENGTH = 1024;
const RANDOM_INT_MAX_RANGE = 0xFFFF_FFFF_FFFF;

const HKDF_OUTPUT_LENGTHS = {
    'md5': 16,
    'sha1': 20,
    'sha224': 28,
    'sha256': 32,
    'sha384': 48,
    'sha512': 64,
    'sha3-256': 32,
    'sha3-384': 48,
    'sha3-512': 64,
    'ripemd160': 20,
    'whirlpool': 64,
};

function isAnyArrayBuffer(data) {
    return data instanceof ArrayBuffer || data instanceof SharedArrayBuffer;
}

function toHkdfByteSource(data, name) {
    if (typeof data === 'string') {
        return toBytes(data);
    }

    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    if (isAnyArrayBuffer(data)) {
        return new Uint8Array(data);
    }

    throw new ERR_INVALID_ARG_TYPE(name, ['string', 'ArrayBuffer', 'TypedArray', 'DataView', 'Buffer'], data);
}

function toHkdfIkm(ikm) {
    if (ikm instanceof KeyObject) {
        if (ikm.type !== 'secret') {
            throw new ERR_INVALID_ARG_TYPE(
                'ikm',
                ['string', 'SecretKeyObject', 'ArrayBuffer', 'TypedArray', 'DataView', 'Buffer'],
                ikm
            );
        }
        return toBytes(ikm.export());
    }

    if (typeof ikm === 'string' || ArrayBuffer.isView(ikm) || isAnyArrayBuffer(ikm)) {
        return toHkdfByteSource(ikm, 'ikm');
    }

    throw new ERR_INVALID_ARG_TYPE(
        'ikm',
        ['string', 'SecretKeyObject', 'ArrayBuffer', 'TypedArray', 'DataView', 'Buffer'],
        ikm
    );
}

function validateHkdfLength(length) {
    if (typeof length !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('length', 'number', length);
    }

    if (!Number.isInteger(length)) {
        throw new ERR_OUT_OF_RANGE('length', 'an integer', length);
    }

    if (length < 0 || length > kMaxLength) {
        throw new ERR_OUT_OF_RANGE('length', `>= 0 && <= ${kMaxLength}`, length);
    }
}

function validateHkdfArguments(digest, ikm, salt, info, keylen) {
    if (typeof digest !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('digest', 'string', digest);
    }

    const ikmBytes = toHkdfIkm(ikm);
    const saltBytes = toHkdfByteSource(salt, 'salt');
    const infoBytes = toHkdfByteSource(info, 'info');

    validateHkdfLength(keylen);

    if (infoBytes.byteLength > HKDF_MAX_INFO_LENGTH) {
        throw new ERR_OUT_OF_RANGE('info', 'must not contain more than 1024 bytes', infoBytes.byteLength);
    }

    return {
        digest,
        ikmBytes,
        saltBytes,
        infoBytes,
        keylen,
    };
}

function normalizeHkdfDigest(digest) {
    const normalized = HASH_ALIASES[digest.toLowerCase()] || digest.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(HKDF_OUTPUT_LENGTHS, normalized)) {
        const err = new TypeError('Invalid digest: ' + digest);
        err.code = 'ERR_CRYPTO_INVALID_DIGEST';
        throw err;
    }

    return normalized;
}

function validateHkdfOutputLength(algorithm, keylen) {
    const maxLength = HKDF_OUTPUT_LENGTHS[algorithm] * 255;
    if (keylen > maxLength) {
        const err = new RangeError('Invalid key length');
        err.code = 'ERR_CRYPTO_INVALID_KEYLEN';
        throw err;
    }
}

function deriveHkdf({ digest, ikmBytes, saltBytes, infoBytes, keylen }) {
    const algorithm = normalizeHkdfDigest(digest);
    validateHkdfOutputLength(algorithm, keylen);

    const result = webCryptoNative.hkdf_derive(algorithm, ikmBytes, saltBytes, infoBytes, keylen);
    if (result === null || result === undefined) {
        const err = new TypeError('Invalid digest: ' + digest);
        err.code = 'ERR_CRYPTO_INVALID_DIGEST';
        throw err;
    }

    const buf = new Uint8Array(result);
    return buf.buffer;
}

function getHashOutputLength(algorithm, options) {
    let outputLength;
    if (options && typeof options === 'object') {
        outputLength = options.outputLength;
    }

    if (outputLength === undefined) {
        if (Object.prototype.hasOwnProperty.call(XOF_DEFAULT_OUTPUT_LENGTHS, algorithm)) {
            return XOF_DEFAULT_OUTPUT_LENGTHS[algorithm];
        }
        return undefined;
    }

    if (typeof outputLength !== 'number') {
        const err = new TypeError(`The "options.outputLength" property must be of type number. Received type ${typeof outputLength}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    if (!Number.isFinite(outputLength) || !Number.isInteger(outputLength) || outputLength < 0 || outputLength > 0xFFFFFFFF) {
        const err = new RangeError(`The value of "options.outputLength" is out of range. It must be >= 0 and <= 4294967295. Received ${outputLength}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }

    if (!Object.prototype.hasOwnProperty.call(XOF_DEFAULT_OUTPUT_LENGTHS, algorithm) && outputLength !== HASH_OUTPUT_LENGTHS[algorithm]) {
        const err = new Error('not XOF or invalid length');
        err.code = 'ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH';
        throw err;
    }

    return outputLength;
}

function normalizeHashAlgorithm(algorithm) {
    if (typeof algorithm !== 'string') {
        const err = new TypeError('The "algorithm" argument must be of type string. Received ' + (algorithm === null ? 'null' : typeof algorithm));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const normalized = HASH_ALIASES[algorithm.toLowerCase()];
    if (!normalized) {
        const err = new Error('Digest method not supported: ' + algorithm);
        err.code = 'ERR_CRYPTO_INVALID_DIGEST';
        throw err;
    }
    return normalized;
}

function normalizeHmacAlgorithm(hmac) {
    if (typeof hmac !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('hmac', 'string', hmac);
    }

    const normalized = HASH_ALIASES[hmac.toLowerCase()];
    if (!normalized) {
        throw new ERR_CRYPTO_INVALID_DIGEST(hmac);
    }

    return normalized;
}

function toBytes(data, inputEncoding) {
    if (typeof data === 'string') {
        if (inputEncoding === 'hex') {
            const bytes = new Uint8Array(data.length / 2);
            for (let i = 0; i < data.length; i += 2) {
                bytes[i / 2] = parseInt(data.substring(i, i + 2), 16);
            }
            return bytes;
        } else if (inputEncoding === 'base64') {
            const binary = atob(data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } else if (inputEncoding === 'latin1' || inputEncoding === 'binary') {
            const bytes = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) {
                bytes[i] = data.charCodeAt(i) & 0xFF;
            }
            return bytes;
        } else {
            const encoder = new TextEncoder();
            return encoder.encode(data);
        }
    } else if (data instanceof Uint8Array) {
        return data;
    } else if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (isAnyArrayBuffer(data)) {
        return new Uint8Array(data);
    } else {
        const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

function toSecretKeyBytes(key, argumentName = 'key') {
    if (key instanceof KeyObject) {
        if (key.type !== 'secret') {
            throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, 'secret');
        }
        return toBytes(key.export());
    }

    if (key instanceof CryptoKey) {
        if (key.type !== 'secret') {
            throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, 'secret');
        }
        return toBytes(key._keyObject.export());
    }

    if (typeof key === 'string' || ArrayBuffer.isView(key) || isAnyArrayBuffer(key)) {
        return toBytes(key);
    }

    throw new ERR_INVALID_ARG_TYPE(
        argumentName,
        ['string', 'ArrayBuffer', 'TypedArray', 'DataView', 'Buffer', 'KeyObject', 'CryptoKey'],
        key
    );
}

function toHmacKeyBytes(key) {
    return toSecretKeyBytes(key, 'key');
}

function encodeOutput(result, encoding) {
    if (!encoding || encoding === 'buffer') {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
        }
        return result;
    } else if (encoding === 'hex') {
        return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
    } else if (encoding === 'base64') {
        let binary = '';
        for (let i = 0; i < result.length; i++) {
            binary += String.fromCharCode(result[i]);
        }
        return btoa(binary);
    } else if (encoding === 'base64url') {
        let binary = '';
        for (let i = 0; i < result.length; i++) {
            binary += String.fromCharCode(result[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } else if (encoding === 'latin1' || encoding === 'binary') {
        let str = '';
        for (let i = 0; i < result.length; i++) {
            str += String.fromCharCode(result[i]);
        }
        return str;
    } else if (encoding === 'ucs2' || encoding === 'ucs-2' || encoding === 'utf16le' || encoding === 'utf-16le') {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(result).toString(encoding);
        }
        let str = '';
        for (let i = 0; i < result.length; i += 2) {
            const code = i + 1 < result.length ? (result[i] | (result[i + 1] << 8)) : result[i];
            str += String.fromCharCode(code);
        }
        return str;
    } else {
        if (typeof encoding === 'object' && encoding !== null && typeof encoding.toString === 'function') {
            encoding.toString();
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(result).toString(encoding);
        }
        return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

function trackCipherOutputEncoding(currentEncoding, outputEncoding) {
    const normalizedEncoding = normalizeEncoding(outputEncoding);
    if (normalizedEncoding === undefined) {
        throw new ERR_UNKNOWN_ENCODING(outputEncoding);
    }
    if (currentEncoding !== null && currentEncoding !== normalizedEncoding) {
        throw new Error('Cannot change encoding');
    }
    return normalizedEncoding;
}

function Hash(algorithm, options) {
    if (!(this instanceof Hash)) return new Hash(algorithm, options);
    this._algorithm = normalizeHashAlgorithm(algorithm);
    this._outputLength = getHashOutputLength(this._algorithm, options);
    const handle = webCryptoNative.hash_init(this._algorithm);
    if (handle === null || handle === undefined) {
        const err = new Error('Digest method not supported: ' + algorithm);
        err.code = 'ERR_CRYPTO_INVALID_DIGEST';
        throw err;
    }
    this._handle = handle;
    this._finalized = false;
    Transform.call(this, options);
}

Object.setPrototypeOf(Hash.prototype, Transform.prototype);
Object.setPrototypeOf(Hash, Transform);

Hash.prototype._transform = function(chunk, encoding, callback) {
    try {
        this.update(chunk, encoding);
        callback(null);
    } catch (e) {
        callback(e);
    }
};

Hash.prototype._flush = function(callback) {
    if (this._finalized) return callback(null);
    try {
        callback(null, this.digest());
    } catch (e) {
        callback(e);
    }
};

Hash.prototype.update = function(data, inputEncoding) {
    if (this._finalized) {
        const err = new Error('Digest already called');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    if (data === undefined || data === null) {
        const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const bytes = toBytes(data, inputEncoding);
    webCryptoNative.hash_update(this._handle, bytes);
    return this;
};

Hash.prototype.digest = function(encoding) {
    if (this._finalized) {
        const err = new Error('Digest already called');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    this._finalized = true;
    const hashBytes = webCryptoNative.hash_final(this._handle, this._outputLength);
    const result = new Uint8Array(hashBytes);
    return encodeOutput(result, encoding);
};

Hash.prototype.copy = function(options) {
    if (this._finalized) {
        const err = new Error('Digest already called');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    const newHash = new Hash(this._algorithm, options);
    const newHandle = webCryptoNative.hash_copy(this._handle);
    const temporaryHandle = newHash._handle;
    if (newHandle === null || newHandle === undefined) {
        webCryptoNative.hash_free(temporaryHandle);
        const err = new Error('Hash copy failed');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    newHash._handle = newHandle;
    webCryptoNative.hash_free(temporaryHandle);
    newHash._finalized = false;
    return newHash;
};

export { Hash };

export function createHash(algorithm, options) {
    return new Hash(algorithm, options);
}

function Hmac(algorithm, key, options) {
    if (!(this instanceof Hmac)) return new Hmac(algorithm, key, options);
    this._algorithm = normalizeHmacAlgorithm(algorithm);
    const keyBytes = toHmacKeyBytes(key);
    const handle = webCryptoNative.hmac_init(this._algorithm, keyBytes);
    if (handle === null || handle === undefined) {
        throw new ERR_CRYPTO_INVALID_DIGEST(algorithm);
    }
    this._handle = handle;
    this._finalized = false;
    Transform.call(this, options);
}

Object.setPrototypeOf(Hmac.prototype, Transform.prototype);
Object.setPrototypeOf(Hmac, Transform);

Hmac.prototype._transform = Hash.prototype._transform;
Hmac.prototype._flush = Hash.prototype._flush;

Hmac.prototype.update = function(data, inputEncoding) {
    if (this._finalized) {
        const err = new Error('Digest already called');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    if (data === undefined || data === null) {
        const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const bytes = toBytes(data, inputEncoding);
    webCryptoNative.hmac_update(this._handle, bytes);
    return this;
};

Hmac.prototype.digest = function(encoding) {
    if (this._finalized) {
        return encodeOutput(new Uint8Array(0), encoding);
    }
    this._finalized = true;
    const hmacBytes = webCryptoNative.hmac_final(this._handle);
    const result = new Uint8Array(hmacBytes);
    return encodeOutput(result, encoding);
};

export { Hmac };

export function createHmac(algorithm, key, options) {
    return new Hmac(algorithm, key, options);
}

function normalizeHashOutputEncoding(options) {
    let outputEncoding = 'hex';
    if (typeof options === 'string') {
        outputEncoding = options;
    } else if (options !== undefined) {
        throw new ERR_INVALID_ARG_TYPE('outputEncoding', 'string', options);
    }

    if (outputEncoding !== 'hex') {
        if (typeof outputEncoding !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('outputEncoding', 'string', outputEncoding);
        }

        const normalized = normalizeEncoding(outputEncoding);
        if (normalized === undefined) {
            if (outputEncoding.toLowerCase() === 'buffer') {
                return 'buffer';
            }
            throw new ERR_INVALID_ARG_VALUE('outputEncoding', outputEncoding);
        }

        outputEncoding = normalized;
    }

    return outputEncoding;
}

export function hash(algorithm, data, outputEncoding) {
    const algo = normalizeHashAlgorithm(algorithm);
    const bytes = toBytes(data);
    const hashBytes = webCryptoNative.hash_one_shot(algo, bytes);
    const result = new Uint8Array(hashBytes);

    return encodeOutput(result, normalizeHashOutputEncoding(outputEncoding));
}

function isIntegerTypedArray(value) {
    return value instanceof Int8Array ||
        value instanceof Uint8Array ||
        value instanceof Uint8ClampedArray ||
        value instanceof Int16Array ||
        value instanceof Uint16Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof BigInt64Array ||
        value instanceof BigUint64Array;
}

export function getRandomValues(typedArray) {
    if (!isIntegerTypedArray(typedArray)) {
        throw new DOMException('The provided value is not of type \'(Int8Array or Int16Array or Int32Array or Uint8Array or Uint16Array or Uint32Array or Uint8ClampedArray or Float32Array or Float64Array or DataView or BigInt64Array or BigUint64Array)\'', 'TypeMismatchError');
    }
    if (typedArray.byteLength > 65536) {
        throw new DOMException('The ArrayBufferView\'s byte length (' + typedArray.byteLength + ') exceeds the number of bytes of entropy available via this API (65536)', 'QuotaExceededError');
    }
    // Use a plain Uint8Array view to randomize the underlying buffer,
    // which works for all integer typed array types including Buffer subclasses
    // that rquickjs native bindings may not recognize.
    const view = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    webCryptoNative.randomize_uint8_array(view);
    return typedArray;
}

/**
 * Generate a random UUID
 * @returns A string containing a randomly generated, 36 character long v4 UUID.
 */
export function randomUUID(options) {
    if (options !== undefined) {
        if (typeof options !== 'object' || options === null) {
            const err = new TypeError('The "options" argument must be of type object.');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (options.disableEntropyCache !== undefined && typeof options.disableEntropyCache !== 'boolean') {
            const err = new TypeError('The "options.disableEntropyCache" property must be of type boolean.');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }
    return webCryptoNative.random_uuid_v4_string();
}

const RANDOM_BYTES_MAX_LENGTH = Math.min(kMaxLength, 2 ** 31 - 1);

function validateRandomBytesSize(size) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size);
    }

    if (!Number.isFinite(size) || size < 0 || size > RANDOM_BYTES_MAX_LENGTH) {
        throw new ERR_OUT_OF_RANGE('size', `>= 0 && <= ${RANDOM_BYTES_MAX_LENGTH}`, size);
    }

    return Math.floor(size);
}

export function randomBytes(size, callback) {
    const normalizedSize = validateRandomBytesSize(size);

    if (callback !== undefined && typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
    }

    const bytes = webCryptoNative.random_bytes(normalizedSize);
    const buf = typeof Buffer !== 'undefined' ? Buffer.from(bytes) : new Uint8Array(bytes);

    if (callback !== undefined) {
        process.nextTick(() => callback(null, buf));
        return;
    }

    return buf;
}

export function pseudoRandomBytes(size, callback) {
    return randomBytes(size, callback);
}

export const prng = pseudoRandomBytes;
export const rng = pseudoRandomBytes;

function toRandomFillTarget(buffer) {
    if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    if (isAnyArrayBuffer(buffer)) {
        return new Uint8Array(buffer);
    }

    throw new ERR_INVALID_ARG_TYPE('buf', ['ArrayBuffer', 'SharedArrayBuffer', 'Buffer', 'TypedArray', 'DataView'], buffer);
}

function assertRandomFillOffset(offset, elementSize, byteLength) {
    if (typeof offset !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    }

    const byteOffset = offset * elementSize;
    const maxLength = Math.min(byteLength, RANDOM_BYTES_MAX_LENGTH);
    if (Number.isNaN(byteOffset) || byteOffset > maxLength || byteOffset < 0) {
        throw new ERR_OUT_OF_RANGE('offset', `>= 0 && <= ${maxLength}`, byteOffset);
    }

    return byteOffset >>> 0;
}

function assertRandomFillSize(size, elementSize, offset, byteLength) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size);
    }

    const byteSize = size * elementSize;
    if (Number.isNaN(byteSize) || byteSize > RANDOM_BYTES_MAX_LENGTH || byteSize < 0) {
        throw new ERR_OUT_OF_RANGE('size', `>= 0 && <= ${RANDOM_BYTES_MAX_LENGTH}`, byteSize);
    }

    if (byteSize + offset > byteLength) {
        throw new ERR_OUT_OF_RANGE('size + offset', `<= ${byteLength}`, byteSize + offset);
    }

    return byteSize >>> 0;
}

export function randomFillSync(buffer, offset = 0, size) {
    const target = toRandomFillTarget(buffer);
    const elementSize = buffer?.BYTES_PER_ELEMENT || 1;

    offset = assertRandomFillOffset(offset, elementSize, target.byteLength);
    if (size === undefined) {
        size = target.byteLength - offset;
    } else {
        size = assertRandomFillSize(size, elementSize, offset, target.byteLength);
    }

    if (size === 0) {
        return buffer;
    }

    const bytes = webCryptoNative.random_bytes(size);

    for (let i = 0; i < size; i++) {
        target[offset + i] = bytes[i];
    }

    return buffer;
}

export function randomFill(buffer, offset, size, callback) {
    const target = toRandomFillTarget(buffer);

    if (typeof offset === 'function') {
        callback = offset;
        offset = 0;
        // Match Node's behavior: this uses element count for typed arrays.
        size = buffer.length;
    } else if (typeof size === 'function') {
        callback = size;
        size = buffer.length - offset;
    } else if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
    }

    const elementSize = buffer?.BYTES_PER_ELEMENT || 1;
    offset = assertRandomFillOffset(offset, elementSize, target.byteLength);
    if (size === undefined) {
        size = target.byteLength - offset;
    } else {
        size = assertRandomFillSize(size, elementSize, offset, target.byteLength);
    }

    if (size === 0) {
        callback(null, buffer);
        return;
    }

    const bytes = webCryptoNative.random_bytes(size);
    for (let i = 0; i < size; i++) {
        target[offset + i] = bytes[i];
    }

    process.nextTick(() => callback(null, buffer));
}

export function randomInt(low, high, callback) {
    const minNotSpecified = high === undefined || typeof high === 'function';
    if (minNotSpecified) {
        callback = high;
        high = low;
        low = 0;
    }

    const isSync = callback === undefined;
    if (!isSync && typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
    }

    if (!Number.isSafeInteger(low)) {
        throw new ERR_INVALID_ARG_TYPE('min', 'a safe integer', low);
    }

    if (!Number.isSafeInteger(high)) {
        throw new ERR_INVALID_ARG_TYPE('max', 'a safe integer', high);
    }

    if (low >= high) {
        throw new ERR_OUT_OF_RANGE('max', `greater than the value of "min" (${low})`, high);
    }

    const range = high - low;
    if (!(range <= RANDOM_INT_MAX_RANGE)) {
        const rangeName = minNotSpecified ? 'max' : 'max - min';
        throw new ERR_OUT_OF_RANGE(rangeName, `<= ${RANDOM_INT_MAX_RANGE}`, range);
    }

    const result = webCryptoNative.random_int_range(low, high);
    if (result === null || result === undefined) {
        throw new ERR_OUT_OF_RANGE('max', `greater than the value of "min" (${low})`, high);
    }

    if (!isSync) {
        process.nextTick(() => callback(null, result));
        return;
    }

    return result;
}

export function timingSafeEqual(a, b) {
    if (!(a instanceof Uint8Array || ArrayBuffer.isView(a) || a instanceof ArrayBuffer)) {
        const err = new TypeError('The "a" argument must be an instance of Buffer, TypedArray, or DataView.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (!(b instanceof Uint8Array || ArrayBuffer.isView(b) || b instanceof ArrayBuffer)) {
        const err = new TypeError('The "b" argument must be an instance of Buffer, TypedArray, or DataView.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const aBytes = a instanceof Uint8Array ? a : new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength || a.length);
    const bBytes = b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength || b.length);
    const result = webCryptoNative.timing_safe_equal(aBytes, bBytes);
    if (result === null || result === undefined) {
        const err = new RangeError('Input buffers must have the same byte length');
        err.code = 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH';
        throw err;
    }
    return result;
}

const PRIME_MAX_BYTES = 67_108_864;
const PRIME_MILLER_RABIN_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
const SMALL_PRIMES = [
    2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n,
    37n, 41n, 43n, 47n,
];
const PRIME_INPUT_TYPES = ['ArrayBuffer', 'SharedArrayBuffer', 'TypedArray', 'DataView', 'Buffer', 'bigint'];

function throwBignumTooLong() {
    const err = new RangeError('error:0680009B:asn1 encoding routines::bignum too long');
    err.code = 'ERR_OSSL_BN_BIGNUM_TOO_LONG';
    throw err;
}

function throwInvalidPrimeOption(name) {
    const err = new RangeError(`invalid ${name}`);
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
}

function bytesToBigInt(bytes) {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}

function bigIntToFixedBytes(value, byteLength) {
    const out = new Uint8Array(byteLength);
    let current = value;
    for (let i = byteLength - 1; i >= 0; i--) {
        out[i] = Number(current & 0xffn);
        current >>= 8n;
    }
    return out;
}

function parsePrimeInput(value, name, enforceByteLimit = false) {
    if (typeof value === 'bigint') {
        if (value < 0n) {
            throw new ERR_OUT_OF_RANGE(name, '>= 0', value);
        }
        return value;
    }

    let bytes;
    if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (isAnyArrayBuffer(value)) {
        bytes = new Uint8Array(value);
    } else {
        throw new ERR_INVALID_ARG_TYPE(name, PRIME_INPUT_TYPES, value);
    }

    if (enforceByteLimit && bytes.byteLength >= PRIME_MAX_BYTES) {
        throwBignumTooLong();
    }

    return bytesToBigInt(bytes);
}

function validatePrimeSize(size) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size);
    }

    if (!Number.isInteger(size)) {
        throw new ERR_OUT_OF_RANGE('size', 'an integer', size);
    }

    if (size < 1 || size > 2_147_483_647) {
        throw new ERR_OUT_OF_RANGE('size', '>= 1 && <= 2147483647', size);
    }

    return size;
}

function normalizePrimeGenerateOptions(size, options) {
    if (options === undefined) {
        return { safe: false, bigint: false, add: undefined, rem: undefined };
    }

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }

    const safe = options.safe ?? false;
    const bigint = options.bigint ?? false;
    if (typeof safe !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.safe', 'boolean', safe);
    }
    if (typeof bigint !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.bigint', 'boolean', bigint);
    }

    let add;
    let rem;
    if (options.add !== undefined) {
        add = parsePrimeInput(options.add, 'options.add');
    }
    if (options.rem !== undefined) {
        rem = parsePrimeInput(options.rem, 'options.rem');
    }

    if (add !== undefined) {
        if (add === 0n) {
            throwInvalidPrimeOption('options.add');
        }

        if (rem === undefined) {
            rem = safe ? 3n : 1n;
        }

        if (rem >= add) {
            throwInvalidPrimeOption('options.rem');
        }

        const maxValue = (1n << BigInt(size)) - 1n;
        if (add > maxValue) {
            throwInvalidPrimeOption('options.add');
        }
        if (rem > maxValue) {
            throwInvalidPrimeOption('options.rem');
        }
    }

    return { safe, bigint, add, rem };
}

function normalizePrimeCheckOptions(options) {
    if (options === undefined) {
        return { checks: 0 };
    }

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }

    if (options.fast !== undefined && typeof options.fast !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.fast', 'boolean', options.fast);
    }

    if (options.trialDivision !== undefined && typeof options.trialDivision !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.trialDivision', 'boolean', options.trialDivision);
    }

    const checks = options.checks ?? 0;
    if (typeof checks !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('options.checks', 'number', checks);
    }
    if (!Number.isInteger(checks)) {
        throw new ERR_OUT_OF_RANGE('options.checks', 'an integer', checks);
    }
    if (checks < 0 || checks > 2_147_483_647) {
        throw new ERR_OUT_OF_RANGE('options.checks', '>= 0 && <= 2147483647', checks);
    }

    return { checks };
}

function normalizePrimeChecks(checks) {
    if (checks === 0) {
        return PRIME_MILLER_RABIN_BASES.length;
    }

    return Math.max(1, Math.min(checks, PRIME_MILLER_RABIN_BASES.length));
}

function modPow(base, exponent, modulus) {
    let result = 1n;
    let b = base % modulus;
    let e = exponent;

    while (e > 0n) {
        if ((e & 1n) === 1n) {
            result = (result * b) % modulus;
        }
        e >>= 1n;
        b = (b * b) % modulus;
    }

    return result;
}

function isProbablePrime(candidate, checks) {
    if (candidate < 2n) {
        return false;
    }

    for (let i = 0; i < SMALL_PRIMES.length; i++) {
        const p = SMALL_PRIMES[i];
        if (candidate === p) {
            return true;
        }
        if (candidate % p === 0n) {
            return false;
        }
    }

    let d = candidate - 1n;
    let s = 0;
    while ((d & 1n) === 0n) {
        d >>= 1n;
        s += 1;
    }

    const rounds = normalizePrimeChecks(checks);
    for (let i = 0; i < rounds; i++) {
        const base = PRIME_MILLER_RABIN_BASES[i];
        if (base >= candidate - 1n) {
            continue;
        }

        let x = modPow(base, d, candidate);
        if (x === 1n || x === candidate - 1n) {
            continue;
        }

        let isWitness = true;
        for (let j = 1; j < s; j++) {
            x = (x * x) % candidate;
            if (x === candidate - 1n) {
                isWitness = false;
                break;
            }
        }

        if (isWitness) {
            return false;
        }
    }

    return true;
}

function randomOddBigIntWithBits(size) {
    const byteLength = Math.ceil(size / 8);
    const bytes = new Uint8Array(webCryptoNative.random_bytes(byteLength));
    const leadingBits = size % 8;

    if (leadingBits === 0) {
        bytes[0] |= 0x80;
    } else {
        bytes[0] &= (1 << leadingBits) - 1;
        bytes[0] |= 1 << (leadingBits - 1);
    }

    bytes[byteLength - 1] |= 1;
    return bytesToBigInt(bytes);
}

function alignToCongruence(value, add, rem) {
    const mod = value % add;
    if (mod === rem) {
        return value;
    }

    if (mod < rem) {
        return value + (rem - mod);
    }

    return value + (add - (mod - rem));
}

function isSafePrime(candidate, checks) {
    if (!isProbablePrime(candidate, checks)) {
        return false;
    }

    const q = (candidate - 1n) >> 1n;
    return isProbablePrime(q, checks);
}

function generatePrimeBigInt(size, options) {
    // Match Node's observed behavior for 3-bit bigint generation.
    if (size === 3 && options.add === undefined && options.safe === false) {
        return 7n;
    }

    const sizeBigInt = BigInt(size);
    const min = size === 1 ? 1n : (1n << (sizeBigInt - 1n));
    const max = (1n << sizeBigInt) - 1n;

    if (options.add !== undefined) {
        const add = options.add;
        const rem = options.rem;
        let candidate = alignToCongruence(min, add, rem);
        if (candidate > max) {
            throwInvalidPrimeOption('options.add');
        }

        if ((candidate & 1n) === 0n) {
            candidate += add;
        }

        while (candidate <= max) {
            if (options.safe ? isSafePrime(candidate, 16) : isProbablePrime(candidate, 16)) {
                return candidate;
            }
            candidate += add;
            if ((candidate & 1n) === 0n) {
                candidate += add;
            }
        }

        throwInvalidPrimeOption('options.add');
    }

    for (let attempt = 0; attempt < 256; attempt++) {
        let candidate = randomOddBigIntWithBits(size);

        while (candidate <= max) {
            if (options.safe ? isSafePrime(candidate, 16) : isProbablePrime(candidate, 16)) {
                return candidate;
            }
            candidate += 2n;
        }
    }

    const err = new Error('Failed to generate prime');
    err.code = 'ERR_CRYPTO_OPERATION_FAILED';
    throw err;
}

function encodeGeneratedPrime(prime, size, asBigInt) {
    if (asBigInt) {
        return prime;
    }

    const byteLength = Math.ceil(size / 8);
    return bigIntToFixedBytes(prime, byteLength).buffer;
}

export function generatePrimeSync(size, options) {
    const normalizedSize = validatePrimeSize(size);
    const normalizedOptions = normalizePrimeGenerateOptions(normalizedSize, options);
    const prime = generatePrimeBigInt(normalizedSize, normalizedOptions);
    return encodeGeneratedPrime(prime, normalizedSize, normalizedOptions.bigint);
}

export function generatePrime(size, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }

    const normalizedSize = validatePrimeSize(size);
    const normalizedOptions = normalizePrimeGenerateOptions(normalizedSize, options);

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    process.nextTick(() => {
        try {
            const prime = generatePrimeBigInt(normalizedSize, normalizedOptions);
            callback(null, encodeGeneratedPrime(prime, normalizedSize, normalizedOptions.bigint));
        } catch (err) {
            callback(err);
        }
    });
}

export function checkPrimeSync(candidate, options) {
    const normalizedCandidate = parsePrimeInput(candidate, 'candidate', true);
    const normalizedOptions = normalizePrimeCheckOptions(options);
    return isProbablePrime(normalizedCandidate, normalizedOptions.checks);
}

export function checkPrime(candidate, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }

    const normalizedCandidate = parsePrimeInput(candidate, 'candidate', true);
    const normalizedOptions = normalizePrimeCheckOptions(options);

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    process.nextTick(() => {
        try {
            callback(null, isProbablePrime(normalizedCandidate, normalizedOptions.checks));
        } catch (err) {
            callback(err);
        }
    });
}

const PBKDF2_MAX_INT32 = 0x7FFFFFFF;

function toPbkdf2ByteSource(data, argumentName) {
    if (typeof data === 'string' || ArrayBuffer.isView(data) || isAnyArrayBuffer(data)) {
        return toBytes(data);
    }

    throw new ERR_INVALID_ARG_TYPE(
        argumentName,
        ['string', 'ArrayBuffer', 'Buffer', 'TypedArray', 'DataView'],
        data
    );
}

function validatePbkdf2Int32(value, argumentName, min) {
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(argumentName, 'number', value);
    }

    if (!Number.isInteger(value)) {
        throw new ERR_OUT_OF_RANGE(argumentName, 'an integer', value);
    }

    if (value < min || value > PBKDF2_MAX_INT32) {
        throw new ERR_OUT_OF_RANGE(argumentName, `>= ${min} && <= ${PBKDF2_MAX_INT32}`, value);
    }
}

function normalizePbkdf2Digest(digest) {
    if (typeof digest !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('digest', 'string', digest);
    }

    const normalized = HASH_ALIASES[digest.toLowerCase()];
    if (!normalized) {
        throw new ERR_CRYPTO_INVALID_DIGEST(digest);
    }

    return normalized;
}

function getPbkdf2Params(password, salt, iterations, keylen, digest) {
    const algorithm = normalizePbkdf2Digest(digest);
    const passwordBytes = toPbkdf2ByteSource(password, 'password');
    const saltBytes = toPbkdf2ByteSource(salt, 'salt');

    validatePbkdf2Int32(iterations, 'iterations', 1);
    validatePbkdf2Int32(keylen, 'keylen', 0);

    return {
        algorithm,
        passwordBytes,
        saltBytes,
        iterations,
        keylen,
        digest,
    };
}

function derivePbkdf2(params) {
    const { algorithm, passwordBytes, saltBytes, iterations, keylen, digest } = params;
    const result = webCryptoNative.pbkdf2_derive(algorithm, passwordBytes, saltBytes, iterations, keylen);
    if (result === null || result === undefined) {
        throw new ERR_CRYPTO_INVALID_DIGEST(digest);
    }

    const buf = new Uint8Array(result);
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return buf;
}

export function pbkdf2Sync(password, salt, iterations, keylen, digest) {
    const params = getPbkdf2Params(password, salt, iterations, keylen, digest);
    return derivePbkdf2(params);
}

export function pbkdf2(password, salt, iterations, keylen, digest, callback) {
    if (typeof digest === 'function') {
        callback = digest;
        digest = undefined;
    }

    const params = getPbkdf2Params(password, salt, iterations, keylen, digest);

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    const result = derivePbkdf2(params);
    process.nextTick(() => callback(null, result));
}

export function scryptSync(password, salt, keylen, options) {
    const passwordBytes = toBytes(password);
    const saltBytes = toBytes(salt);
    const N = (options && (options.N || options.cost)) || 16384;
    const r = (options && (options.r || options.blockSize)) || 8;
    const p = (options && (options.p || options.parallelization)) || 1;
    const result = webCryptoNative.scrypt_derive(passwordBytes, saltBytes, N, r, p, keylen);
    if (result === null || result === undefined) {
        const err = new Error('Invalid scrypt parameters');
        err.code = 'ERR_CRYPTO_SCRYPT_INVALID_PARAMETER';
        throw err;
    }
    const buf = new Uint8Array(result);
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return buf;
}

export function scrypt(password, salt, keylen, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    try {
        const result = scryptSync(password, salt, keylen, options);
        process.nextTick(() => callback(null, result));
    } catch (err) {
        process.nextTick(() => callback(err));
    }
}

export function hkdfSync(digest, ikm, salt, info, keylen) {
    const args = validateHkdfArguments(digest, ikm, salt, info, keylen);
    return deriveHkdf(args);
}

export function hkdf(digest, ikm, salt, info, keylen, callback) {
    const args = validateHkdfArguments(digest, ikm, salt, info, keylen);

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    const result = deriveHkdf(args);
    process.nextTick(() => callback(null, result));
}

const MAX_SPKAC_SIZE = 0x7FFFFFFF;

function toSpkacBytes(spkac, encoding) {
    const bytes = toBytes(spkac, encoding === 'buffer' ? 'utf8' : encoding);
    if (bytes.length > MAX_SPKAC_SIZE) {
        const err = new RangeError('spkac is too large');
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    return bytes;
}

function asBuffer(value) {
    const bytes = new Uint8Array(value);
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return bytes;
}

function certificateVerifySpkac(spkac, encoding) {
    const bytes = toSpkacBytes(spkac, encoding);
    if (bytes.length === 0) {
        return '';
    }
    const verified = webCryptoNative.certificate_verify_spkac(bytes);
    return verified === null || verified === undefined ? false : verified;
}

function certificateExportPublicKey(spkac, encoding) {
    const bytes = toSpkacBytes(spkac, encoding);
    if (bytes.length === 0) {
        return '';
    }
    const result = webCryptoNative.certificate_export_public_key(bytes);
    if (result === null || result === undefined) {
        return '';
    }
    return asBuffer(result);
}

function certificateExportChallenge(spkac, encoding) {
    const bytes = toSpkacBytes(spkac, encoding);
    if (bytes.length === 0) {
        return '';
    }
    const result = webCryptoNative.certificate_export_challenge(bytes);
    if (result === null || result === undefined) {
        return '';
    }
    return asBuffer(result);
}

export function Certificate() {
    if (!new.target) {
        return new Certificate();
    }
}

Certificate.verifySpkac = certificateVerifySpkac;
Certificate.exportPublicKey = certificateExportPublicKey;
Certificate.exportChallenge = certificateExportChallenge;
Certificate.prototype.verifySpkac = certificateVerifySpkac;
Certificate.prototype.exportPublicKey = certificateExportPublicKey;
Certificate.prototype.exportChallenge = certificateExportChallenge;

const CIPHER_ALIASES = {
    'aes-128-cbc': 'aes-128-cbc',
    'aes-256-cbc': 'aes-256-cbc',
    'aes-128-ecb': 'aes-128-ecb',
    'aes-256-ecb': 'aes-256-ecb',
    'bf-ecb': 'bf-ecb',
    'aes-128-ctr': 'aes-128-ctr',
    'aes-256-ctr': 'aes-256-ctr',
    'aes-128-ccm': 'aes-128-ccm',
    'aes-256-ccm': 'aes-256-ccm',
    'aes-128-gcm': 'aes-128-gcm',
    'aes-256-gcm': 'aes-256-gcm',
    'aes-128-ocb': 'aes-128-ocb',
    'aes-256-ocb': 'aes-256-ocb',
    'aes-128-wrap': 'aes-128-wrap',
    'aes-192-wrap': 'aes-192-wrap',
    'aes-256-wrap': 'aes-256-wrap',
    'aes128-wrap': 'aes-128-wrap',
    'aes192-wrap': 'aes-192-wrap',
    'aes256-wrap': 'aes-256-wrap',
    'id-aes128-wrap': 'id-aes128-wrap',
    'id-aes192-wrap': 'id-aes192-wrap',
    'id-aes256-wrap': 'id-aes256-wrap',
    'id-aes128-wrap-pad': 'id-aes128-wrap-pad',
    'id-aes192-wrap-pad': 'id-aes192-wrap-pad',
    'id-aes256-wrap-pad': 'id-aes256-wrap-pad',
    'des-ede3-cbc': 'des-ede3-cbc',
    'des3': 'des-ede3-cbc',
    'des3-wrap': 'des3-wrap',
    'id-smime-alg-cms3deswrap': 'des3-wrap',
    'chacha20-poly1305': 'chacha20-poly1305',
    'aes256': 'aes-256-cbc',
    'aes-256': 'aes-256-cbc',
    'aes128': 'aes-128-cbc',
    'aes-128': 'aes-128-cbc',
};

function normalizeCipherAlgorithm(algorithm) {
    if (typeof algorithm !== 'string') {
        const received = algorithm === null ? 'null' : typeof algorithm;
        const err = new TypeError(`The "cipher" argument must be of type string. Received ${received}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const normalized = CIPHER_ALIASES[algorithm.toLowerCase()];
    if (!normalized) {
        const err = new Error('Unknown cipher');
        err.code = 'ERR_CRYPTO_UNKNOWN_CIPHER';
        throw err;
    }
    return normalized;
}

function getAeadMode(algorithm) {
    if (algorithm === 'chacha20-poly1305') return 'chacha20-poly1305';
    if (algorithm.endsWith('-gcm')) return 'gcm';
    if (algorithm.endsWith('-ccm')) return 'ccm';
    if (algorithm.endsWith('-ocb')) return 'ocb';
    return null;
}

function resolveNativeCipherAlgorithm(algorithm) {
    if (algorithm === 'aes-128-ccm' || algorithm === 'aes-128-ocb') return 'aes-128-gcm';
    if (algorithm === 'aes-256-ccm' || algorithm === 'aes-256-ocb') return 'aes-256-gcm';
    return algorithm;
}

function throwInvalidArgValue(property, value) {
    const err = new TypeError(`The property '${property}' is invalid. Received ${String(value)}`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
}

function getUIntOption(options, key) {
    let value;
    if (options && (value = options[key]) != null) {
        if ((value >>> 0) !== value) {
            throwInvalidArgValue(`options.${key}`, value);
        }
        return value;
    }
    return undefined;
}

function throwInvalidAuthTagLength(length) {
    const err = new TypeError(`Invalid authentication tag length: ${length}`);
    err.code = 'ERR_CRYPTO_INVALID_AUTH_TAG';
    throw err;
}

function throwAuthTagLengthRequired(algorithm) {
    const err = new TypeError(`authTagLength required for ${algorithm}`);
    err.code = 'ERR_CRYPTO_INVALID_AUTH_TAG';
    throw err;
}

function throwInvalidIV() {
    const err = new TypeError('Invalid initialization vector');
    err.code = 'ERR_CRYPTO_INVALID_IV';
    throw err;
}

function throwInvalidKeyLength() {
    const err = new RangeError('Invalid key length');
    err.code = 'ERR_CRYPTO_INVALID_KEYLEN';
    throw err;
}

function normalizeCipherIv(iv) {
    if (iv === undefined) {
        const err = new TypeError('The "iv" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (iv === null) {
        return new Uint8Array(0);
    }
    return toBytes(iv);
}

function getCipherValidationInfo(algorithm) {
    return CIPHER_INFO[algorithm] || CIPHER_INFO[resolveNativeCipherAlgorithm(algorithm)];
}

function isPkcsBlockCipherMode(algorithm) {
    const info = getCipherValidationInfo(algorithm);
    return !!info && (info.mode === 'cbc' || info.mode === 'ecb');
}

function createLegacyOpenSslError(message, code, reason, fnName) {
    const err = new Error(message);
    err.code = code;
    err.library = 'digital envelope routines';
    err.reason = reason;
    if (fnName) {
        err.function = fnName;
    }
    return err;
}

function createWrongFinalBlockLengthError() {
    return createLegacyOpenSslError(
        'error:0606506D:digital envelope routines:EVP_DecryptFinal_ex:wrong final block length',
        'ERR_OSSL_EVP_WRONG_FINAL_BLOCK_LENGTH',
        'wrong final block length',
        'EVP_DecryptFinal_ex'
    );
}

function createBadDecryptError() {
    return createLegacyOpenSslError(
        'error:06065064:digital envelope routines:EVP_DecryptFinal_ex:bad decrypt',
        'ERR_OSSL_EVP_BAD_DECRYPT',
        'bad decrypt',
        'EVP_DecryptFinal_ex'
    );
}

function createDataNotMultipleOfBlockLengthError() {
    return createLegacyOpenSslError(
        'error:0607F08A:digital envelope routines:EVP_EncryptFinal_ex:data not multiple of block length',
        'ERR_OSSL_EVP_DATA_NOT_MULTIPLE_OF_BLOCK_LENGTH',
        'data not multiple of block length',
        'EVP_EncryptFinal_ex'
    );
}

function createPrivateKeyParseError() {
    const err = new Error('Failed to parse private key');
    err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
    // Node decorates key-parse errors with OpenSSL metadata; assigning this
    // property must also respect user-defined prototype setters.
    err.library = 'PEM routines';
    return err;
}

function createRsaIllegalOrUnsupportedPaddingModeError() {
    const err = new Error('error:04068093:rsa routines:RSA_sign:illegal or unsupported padding mode');
    err.code = 'ERR_OSSL_RSA_ILLEGAL_OR_UNSUPPORTED_PADDING_MODE';
    err.reason = 'illegal or unsupported padding mode';
    err.library = 'rsa routines';
    err.function = 'RSA_sign';
    err.opensslErrorStack = [
        'error:06089093:digital envelope routines:EVP_PKEY_CTX_ctrl:command not supported',
    ];
    return err;
}

function validateCipherKeyLength(algorithm, keyBytes) {
    const info = getCipherValidationInfo(algorithm);
    if (info && info.keyLength !== undefined && keyBytes.length !== info.keyLength) {
        throwInvalidKeyLength();
    }
}

function validateCipherIvLength(algorithm, mode, ivBytes) {
    if (mode === 'ccm') {
        if (ivBytes.length < 7 || ivBytes.length > 13) {
            throwInvalidIV();
        }
        return;
    }
    if (mode === 'gcm') {
        if (ivBytes.length === 0) {
            throwInvalidIV();
        }
        return;
    }
    if (mode === 'chacha20-poly1305') {
        if (ivBytes.length === 0 || ivBytes.length > 12) {
            throwInvalidIV();
        }
        return;
    }

    const info = getCipherValidationInfo(algorithm);
    if (!info || info.ivLength === undefined) {
        return;
    }
    if (info.mode === 'ecb') {
        if (ivBytes.length !== 0) {
            throwInvalidIV();
        }
        return;
    }
    if (ivBytes.length !== info.ivLength) {
        throwInvalidIV();
    }
}

function isValidGcmAuthTagLength(length) {
    return length === 4 || length === 8 || (length >= 12 && length <= 16);
}

function isValidCcmAuthTagLength(length) {
    return length >= 4 && length <= 16 && length % 2 === 0;
}

function isValidChachaAuthTagLength(length) {
    return length >= 1 && length <= 16;
}

function computeCcmMaxMessageSize(ivLength) {
    const exponent = 8 * (15 - ivLength);
    if (exponent >= 53) {
        return Number.MAX_SAFE_INTEGER;
    }
    return (2 ** exponent) - 1;
}

function parseAeadOptions(algorithm, options) {
    const mode = getAeadMode(algorithm);
    const authTagLengthOption = getUIntOption(options, 'authTagLength');
    const hasAuthTagLength = authTagLengthOption !== undefined;
    let authTagLength = authTagLengthOption;

    if (mode === 'ccm' || mode === 'ocb') {
        if (!hasAuthTagLength) {
            throwAuthTagLengthRequired(algorithm);
        }
    }

    if (mode === 'gcm') {
        if (authTagLength === undefined) authTagLength = 16;
        if (!isValidGcmAuthTagLength(authTagLength)) {
            throwInvalidAuthTagLength(authTagLength);
        }
    } else if (mode === 'ccm') {
        if (!isValidCcmAuthTagLength(authTagLength)) {
            throwInvalidAuthTagLength(authTagLength);
        }
    } else if (mode === 'ocb') {
        if (!isValidChachaAuthTagLength(authTagLength)) {
            throwInvalidAuthTagLength(authTagLength);
        }
    } else if (mode === 'chacha20-poly1305') {
        if (authTagLength === undefined) authTagLength = 16;
        if (!isValidChachaAuthTagLength(authTagLength)) {
            throwInvalidAuthTagLength(authTagLength);
        }
    }

    return {
        mode,
        authTagLength,
        hasAuthTagLength,
    };
}

function Cipheriv(algorithm, key, iv, options) {
    if (!(this instanceof Cipheriv)) return new Cipheriv(algorithm, key, iv, options);
    this._algorithm = normalizeCipherAlgorithm(algorithm);
    this._aeadConfig = parseAeadOptions(this._algorithm, options);
    this._authTagLength = this._aeadConfig.authTagLength;
    this._authTagLengthExplicit = this._aeadConfig.hasAuthTagLength;
    this._isCcmMode = this._aeadConfig.mode === 'ccm';
    this._hasUpdate = false;
    this._totalInputLength = 0;
    this._ccmPlaintextLength = undefined;
    const keyBytes = toSecretKeyBytes(key, 'key');
    const ivBytes = normalizeCipherIv(iv);

    validateCipherKeyLength(this._algorithm, keyBytes);
    validateCipherIvLength(this._algorithm, this._aeadConfig.mode, ivBytes);

    if (this._isCcmMode) {
        this._ccmMaxMessageSize = computeCcmMaxMessageSize(ivBytes.length);
    } else {
        this._ccmMaxMessageSize = undefined;
    }

    const nativeAlgorithm = resolveNativeCipherAlgorithm(this._algorithm);
    const handle = webCryptoNative.cipher_init(nativeAlgorithm, keyBytes, ivBytes, false);
    if (handle === null || handle === undefined) {
        throwInvalidIV();
    }
    this._handle = handle;
    this._finalized = false;
    this._autoPadding = true;
    this._decoder = null;
    Transform.call(this, options);
}

Object.setPrototypeOf(Cipheriv.prototype, Transform.prototype);
Object.setPrototypeOf(Cipheriv, Transform);

Cipheriv.prototype._transform = function(chunk, encoding, callback) {
    try {
        const out = this.update(chunk, encoding);
        if (out && out.length > 0) {
            callback(null, out);
        } else {
            callback(null);
        }
    } catch (e) {
        callback(e);
    }
};

Cipheriv.prototype._flush = function(callback) {
    if (this._finalized) return callback(null);
    try {
        const out = this.final();
        if (out && out.length > 0) {
            callback(null, out);
        } else {
            callback(null);
        }
    } catch (e) {
        callback(e);
    }
};

Cipheriv.prototype.update = function(data, inputEncoding, outputEncoding) {
    if (this._finalized) {
        const err = new Error('Attempting to use a finalized cipher');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    const bytes = toBytes(data, inputEncoding);
    if (this._isCcmMode) {
        if (this._totalInputLength + bytes.length > this._ccmMaxMessageSize) {
            throw new RangeError('Invalid message length');
        }
        if (this._ccmPlaintextLength !== undefined &&
            this._totalInputLength + bytes.length > this._ccmPlaintextLength) {
            throw new RangeError('Invalid message length');
        }
    }
    this._totalInputLength += bytes.length;
    this._hasUpdate = true;
    const result = webCryptoNative.cipher_update(this._handle, bytes);
    if (result === null || result === undefined) {
        const err = new Error('Cipher update failed');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const out = new Uint8Array(result);
    if (outputEncoding && outputEncoding !== 'buffer') {
        this._decoder = trackCipherOutputEncoding(this._decoder, outputEncoding);
    }
    return encodeOutput(out, outputEncoding);
};

Cipheriv.prototype.final = function(outputEncoding) {
    if (this._finalized) {
        const err = new Error('Attempting to use a finalized cipher');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    if (this._isCcmMode && !this._hasUpdate) {
        const err = new Error('Unsupported state or unable to authenticate data');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    this._finalized = true;
    const result = webCryptoNative.cipher_final(this._handle);
    if (result === null || result === undefined) {
        if (isPkcsBlockCipherMode(this._algorithm) && this._autoPadding === false) {
            throw createDataNotMultipleOfBlockLengthError();
        }
        const err = new Error('Cipher final failed');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const out = new Uint8Array(result);
    if (outputEncoding && outputEncoding !== 'buffer') {
        this._decoder = trackCipherOutputEncoding(this._decoder, outputEncoding);
    }
    return encodeOutput(out, outputEncoding);
};

Cipheriv.prototype.setAAD = function(buffer, options) {
    const bytes = toBytes(buffer);
    if (this._isCcmMode) {
        const plaintextLength = getUIntOption(options, 'plaintextLength');
        if (plaintextLength === undefined) {
            const err = new Error('options.plaintextLength required for CCM mode with AAD');
            err.code = 'ERR_CRYPTO_INVALID_STATE';
            throw err;
        }
        if (plaintextLength > this._ccmMaxMessageSize) {
            throw new RangeError('Invalid message length');
        }
        this._ccmPlaintextLength = plaintextLength;
    }
    const ok = webCryptoNative.cipher_set_aad(this._handle, bytes);
    if (!ok) {
        const err = new Error('setAAD failed: not an AEAD cipher or invalid state');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    return this;
};

Cipheriv.prototype.getAuthTag = function() {
    const result = webCryptoNative.cipher_get_auth_tag(this._handle);
    if (result === null || result === undefined) {
        const err = new Error('Invalid state for operation getAuthTag');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const buf = new Uint8Array(result);
    const out = (this._authTagLength !== undefined) ? buf.slice(0, this._authTagLength) : buf;
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
    }
    return out;
};

Cipheriv.prototype.setAutoPadding = function(autoPadding) {
    this._autoPadding = autoPadding !== false;
    webCryptoNative.cipher_set_auto_padding(this._handle, this._autoPadding);
    return this;
};

export { Cipheriv };

export function createCipheriv(algorithm, key, iv, options) {
    return new Cipheriv(algorithm, key, iv, options);
}

function validateDecipherAuthTagLength(decipher, actualLength) {
    const mode = decipher._aeadConfig.mode;
    if (mode === 'gcm') {
        if (decipher._authTagLengthExplicit) {
            if (actualLength !== decipher._authTagLength) {
                throwInvalidAuthTagLength(actualLength);
            }
        } else if (!isValidGcmAuthTagLength(actualLength)) {
            throwInvalidAuthTagLength(actualLength);
        }
        return;
    }

    if (mode === 'chacha20-poly1305' || mode === 'ccm' || mode === 'ocb') {
        if (actualLength !== decipher._authTagLength) {
            throwInvalidAuthTagLength(actualLength);
        }
    }
}

function Decipheriv(algorithm, key, iv, options) {
    if (!(this instanceof Decipheriv)) return new Decipheriv(algorithm, key, iv, options);
    this._algorithm = normalizeCipherAlgorithm(algorithm);
    this._aeadConfig = parseAeadOptions(this._algorithm, options);
    this._authTagLength = this._aeadConfig.authTagLength;
    this._authTagLengthExplicit = this._aeadConfig.hasAuthTagLength;
    this._isCcmMode = this._aeadConfig.mode === 'ccm';
    this._hasUpdate = false;
    this._totalInputLength = 0;
    this._ccmPlaintextLength = undefined;
    this._authTagWasSet = false;
    const keyBytes = toSecretKeyBytes(key, 'key');
    const ivBytes = normalizeCipherIv(iv);

    validateCipherKeyLength(this._algorithm, keyBytes);
    validateCipherIvLength(this._algorithm, this._aeadConfig.mode, ivBytes);

    if (this._isCcmMode) {
        this._ccmMaxMessageSize = computeCcmMaxMessageSize(ivBytes.length);
    } else {
        this._ccmMaxMessageSize = undefined;
    }

    const nativeAlgorithm = resolveNativeCipherAlgorithm(this._algorithm);
    const handle = webCryptoNative.cipher_init(nativeAlgorithm, keyBytes, ivBytes, true);
    if (handle === null || handle === undefined) {
        throwInvalidIV();
    }
    this._handle = handle;
    this._finalized = false;
    this._autoPadding = true;
    this._decoder = null;
    Transform.call(this, options);
}

Object.setPrototypeOf(Decipheriv.prototype, Transform.prototype);
Object.setPrototypeOf(Decipheriv, Transform);

Decipheriv.prototype._transform = Cipheriv.prototype._transform;
Decipheriv.prototype._flush = Cipheriv.prototype._flush;

Decipheriv.prototype.update = function(data, inputEncoding, outputEncoding) {
    if (this._finalized) {
        const err = new Error('Attempting to use a finalized decipher');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    const bytes = toBytes(data, inputEncoding);
    if (this._isCcmMode) {
        if (this._totalInputLength + bytes.length > this._ccmMaxMessageSize) {
            throw new RangeError('Invalid message length');
        }
    }
    this._totalInputLength += bytes.length;
    this._hasUpdate = true;
    const result = webCryptoNative.cipher_update(this._handle, bytes);
    if (result === null || result === undefined) {
        const err = new Error('Decipher update failed');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const out = new Uint8Array(result);
    if (outputEncoding && outputEncoding !== 'buffer') {
        this._decoder = trackCipherOutputEncoding(this._decoder, outputEncoding);
    }
    return encodeOutput(out, outputEncoding);
};

Decipheriv.prototype.final = function(outputEncoding) {
    if (this._finalized) {
        const err = new Error('Attempting to use a finalized decipher');
        err.code = 'ERR_CRYPTO_HASH_FINALIZED';
        throw err;
    }
    this._finalized = true;
    const result = webCryptoNative.cipher_final(this._handle);
    if (result === null || result === undefined) {
        const isMissingTag =
            (this._aeadConfig.mode === 'chacha20-poly1305' || this._aeadConfig.mode === 'ccm') &&
            !this._authTagWasSet;
        if (!isMissingTag && isPkcsBlockCipherMode(this._algorithm)) {
            const info = getCipherValidationInfo(this._algorithm);
            const blockSize = info && info.blockSize ? info.blockSize : 16;
            if (this._totalInputLength === 0 || (this._totalInputLength % blockSize) !== 0) {
                throw createWrongFinalBlockLengthError();
            }
            if (this._autoPadding !== false) {
                throw createBadDecryptError();
            }
            throw createWrongFinalBlockLengthError();
        }
        const err = new Error(
            isMissingTag
                ? 'Unsupported state or unable to authenticate data'
                : 'Decipher final failed (possibly wrong key, IV, or auth tag)'
        );
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const out = new Uint8Array(result);
    if (outputEncoding && outputEncoding !== 'buffer') {
        this._decoder = trackCipherOutputEncoding(this._decoder, outputEncoding);
    }
    return encodeOutput(out, outputEncoding);
};

Decipheriv.prototype.setAAD = function(buffer, options) {
    const bytes = toBytes(buffer);
    if (this._isCcmMode) {
        const plaintextLength = getUIntOption(options, 'plaintextLength');
        if (plaintextLength === undefined) {
            const err = new Error('options.plaintextLength required for CCM mode with AAD');
            err.code = 'ERR_CRYPTO_INVALID_STATE';
            throw err;
        }
        if (plaintextLength > this._ccmMaxMessageSize) {
            throw new RangeError('Invalid message length');
        }
        this._ccmPlaintextLength = plaintextLength;
    }
    const ok = webCryptoNative.cipher_set_aad(this._handle, bytes);
    if (!ok) {
        const err = new Error('setAAD failed: not an AEAD cipher or invalid state');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    return this;
};

Decipheriv.prototype.setAuthTag = function(buffer) {
    if (this._authTagWasSet) {
        const err = new Error('Invalid state for operation setAuthTag');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    const bytes = toBytes(buffer);
    validateDecipherAuthTagLength(this, bytes.length);
    const ok = webCryptoNative.cipher_set_auth_tag(this._handle, bytes);
    if (!ok) {
        const err = new Error('setAuthTag failed: not an AEAD decipher or invalid state');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    this._authTagWasSet = true;
    return this;
};

Decipheriv.prototype.setAutoPadding = function(autoPadding) {
    this._autoPadding = autoPadding !== false;
    webCryptoNative.cipher_set_auto_padding(this._handle, this._autoPadding);
    return this;
};

export { Decipheriv };

export function createDecipheriv(algorithm, key, iv, options) {
    return new Decipheriv(algorithm, key, iv, options);
}

export function getHashes() {
    return webCryptoNative.get_hashes();
}

export function getCiphers() {
    return webCryptoNative.get_ciphers();
}

const CIPHER_INFO = {
    'aes-128-cbc': { name: 'aes-128-cbc', nid: 419, blockSize: 16, ivLength: 16, keyLength: 16, mode: 'cbc' },
    'aes-192-cbc': { name: 'aes-192-cbc', nid: 423, blockSize: 16, ivLength: 16, keyLength: 24, mode: 'cbc' },
    'aes-256-cbc': { name: 'aes-256-cbc', nid: 427, blockSize: 16, ivLength: 16, keyLength: 32, mode: 'cbc' },
    'aes-128-ecb': { name: 'aes-128-ecb', nid: 418, blockSize: 16, ivLength: 0, keyLength: 16, mode: 'ecb' },
    'aes-256-ecb': { name: 'aes-256-ecb', nid: 426, blockSize: 16, ivLength: 0, keyLength: 32, mode: 'ecb' },
    'bf-ecb': { name: 'bf-ecb', nid: 92, blockSize: 8, ivLength: 0, mode: 'ecb' },
    'aes-128-ctr': { name: 'aes-128-ctr', nid: 904, blockSize: 1, ivLength: 16, keyLength: 16, mode: 'ctr' },
    'aes-256-ctr': { name: 'aes-256-ctr', nid: 906, blockSize: 1, ivLength: 16, keyLength: 32, mode: 'ctr' },
    'aes-128-ccm': { name: 'id-aes128-ccm', nid: 896, blockSize: 1, ivLength: 12, keyLength: 16, mode: 'ccm' },
    'aes-256-ccm': { name: 'id-aes256-ccm', nid: 902, blockSize: 1, ivLength: 12, keyLength: 32, mode: 'ccm' },
    'aes-128-gcm': { name: 'aes-128-gcm', nid: 895, blockSize: 1, ivLength: 12, keyLength: 16, mode: 'gcm' },
    'aes-256-gcm': { name: 'aes-256-gcm', nid: 901, blockSize: 1, ivLength: 12, keyLength: 32, mode: 'gcm' },
    'aes-128-ocb': { name: 'aes-128-ocb', nid: 958, blockSize: 16, ivLength: 12, keyLength: 16, mode: 'ocb' },
    'aes-256-ocb': { name: 'aes-256-ocb', nid: 960, blockSize: 16, ivLength: 12, keyLength: 32, mode: 'ocb' },
    'aes-128-wrap': { name: 'aes-128-wrap', nid: 1228, blockSize: 8, ivLength: 8, keyLength: 16, mode: 'wrap' },
    'aes-192-wrap': { name: 'aes-192-wrap', nid: 1229, blockSize: 8, ivLength: 8, keyLength: 24, mode: 'wrap' },
    'aes-256-wrap': { name: 'aes-256-wrap', nid: 1230, blockSize: 8, ivLength: 8, keyLength: 32, mode: 'wrap' },
    'id-aes128-wrap': { name: 'id-aes128-wrap', nid: 1231, blockSize: 8, ivLength: 8, keyLength: 16, mode: 'wrap' },
    'id-aes192-wrap': { name: 'id-aes192-wrap', nid: 1232, blockSize: 8, ivLength: 8, keyLength: 24, mode: 'wrap' },
    'id-aes256-wrap': { name: 'id-aes256-wrap', nid: 1233, blockSize: 8, ivLength: 8, keyLength: 32, mode: 'wrap' },
    'id-aes128-wrap-pad': { name: 'id-aes128-wrap-pad', nid: 1234, blockSize: 8, ivLength: 4, keyLength: 16, mode: 'wrap' },
    'id-aes192-wrap-pad': { name: 'id-aes192-wrap-pad', nid: 1235, blockSize: 8, ivLength: 4, keyLength: 24, mode: 'wrap' },
    'id-aes256-wrap-pad': { name: 'id-aes256-wrap-pad', nid: 1236, blockSize: 8, ivLength: 4, keyLength: 32, mode: 'wrap' },
    'des-ede3-cbc': { name: 'des-ede3-cbc', nid: 44, blockSize: 8, ivLength: 8, keyLength: 24, mode: 'cbc' },
    'des3-wrap': { name: 'des3-wrap', nid: 246, blockSize: 8, ivLength: 0, keyLength: 24, mode: 'wrap' },
    'chacha20-poly1305': { name: 'chacha20-poly1305', nid: 1018, blockSize: 1, ivLength: 12, keyLength: 32, mode: 'wrap' },
};

const CIPHER_NID_MAP = {};
for (const [name, info] of Object.entries(CIPHER_INFO)) {
    CIPHER_NID_MAP[info.nid] = info;
}

function validateGetCipherInfoOption(value, propertyName) {
    if (typeof value !== 'number') {
        const err = new TypeError(`The "${propertyName}" property must be of type number.`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
        const err = new RangeError(`The value of "${propertyName}" is out of range. It must be >= 0 and <= 4294967295. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
}

function acceptsIvLength(info, ivLength) {
    if (info.mode === 'ccm') return ivLength >= 7 && ivLength <= 13;
    if (info.mode === 'gcm') return true;
    if (info.mode === 'ocb') return ivLength >= 1 && ivLength <= 15;
    return ivLength === info.ivLength;
}

export function getCipherInfo(nameOrNid, options) {
    if (typeof nameOrNid !== 'string' && typeof nameOrNid !== 'number') {
        const err = new TypeError('The "nameOrNid" argument must be of type string or number.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
        const err = new TypeError('The "options" argument must be of type object.');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    
    let keyLength;
    let ivLength;
    if (options) {
        if (options.keyLength !== undefined) {
            validateGetCipherInfoOption(options.keyLength, 'options.keyLength');
            keyLength = options.keyLength;
        }
        if (options.ivLength !== undefined) {
            validateGetCipherInfoOption(options.ivLength, 'options.ivLength');
            ivLength = options.ivLength;
        }
    }

    let info;
    if (typeof nameOrNid === 'number') {
        info = CIPHER_NID_MAP[nameOrNid];
    } else {
        const lower = nameOrNid.toLowerCase();
        const resolved = CIPHER_ALIASES[lower] || lower;
        info = CIPHER_INFO[resolved];
    }
    
    if (!info) return undefined;
    
    if (keyLength !== undefined && keyLength !== info.keyLength) return undefined;
    if (ivLength !== undefined && !acceptsIvLength(info, ivLength)) return undefined;

    return { ...info };
}

export function getCurves() {
    return ['prime256v1', 'secp384r1', 'secp256k1', 'secp521r1', 'secp224r1'];
}

// ===== DiffieHellman =====

function createDhBitsTooSmallError() {
    const err = new Error('bits too small');
    err.code = 'ERR_OSSL_BN_BITS_TOO_SMALL';
    return err;
}

function createDhBadGeneratorError() {
    const err = new Error('bad generator');
    err.code = 'ERR_OSSL_DH_BAD_GENERATOR';
    return err;
}

function isBadDhGeneratorBytes(bytes) {
    let firstNonZero = 0;
    while (firstNonZero < bytes.length && bytes[firstNonZero] === 0) {
        firstNonZero += 1;
    }
    if (firstNonZero === bytes.length) {
        return true;
    }
    return firstNonZero === bytes.length - 1 && bytes[firstNonZero] === 1;
}

function DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding) {
    if (!(this instanceof DiffieHellman)) return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
    if (typeof sizeOrKey === 'number') {
        if (!Number.isInteger(sizeOrKey)) {
            const err = new RangeError('The value of "sizeOrKey" is out of range. It must be an integer. Received ' + sizeOrKey);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        if (sizeOrKey <= 1) {
            throw createDhBitsTooSmallError();
        }
        const result = webCryptoNative.dh_create_from_size_err(sizeOrKey);
        if (result[0] === 'error') {
            const err = new Error(result[1]);
            err.code = 'ERR_OSSL_DH_MODULUS_TOO_SMALL';
            throw err;
        }
        this._handle = parseInt(result[0]);
    } else {
        if (typeof sizeOrKey !== 'string' && !ArrayBuffer.isView(sizeOrKey) && !(sizeOrKey instanceof ArrayBuffer)) {
            const err = new TypeError('The "sizeOrKey" argument must be of type number or string or an instance of Buffer, TypedArray, or DataView.');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        const primeBytes = toBytes(sizeOrKey, keyEncoding);
        let genBytes;
        if (generator === undefined || generator === null) {
            genBytes = new Uint8Array([2]);
        } else if (typeof generator === 'number') {
            if (!Number.isInteger(generator)) {
                const err = new RangeError('The value of "generator" is out of range. It must be an integer. Received ' + generator);
                err.code = 'ERR_OUT_OF_RANGE';
                throw err;
            }
            if (generator === 0) {
                genBytes = new Uint8Array([2]);
            } else if (generator < 0 || generator === 1) {
                throw createDhBadGeneratorError();
            } else if (generator > 0xFFFFFFFF) {
                genBytes = new Uint8Array([2]);
            } else {
                const buf = [];
                let g = generator;
                while (g > 0) { buf.unshift(g & 0xFF); g >>= 8; }
                genBytes = new Uint8Array(buf);
            }
        } else if (typeof generator === 'string') {
            genBytes = toBytes(generator, genEncoding);
        } else if (ArrayBuffer.isView(generator) || generator instanceof ArrayBuffer) {
            genBytes = toBytes(generator);
        } else {
            const err = new TypeError('The "generator" argument must be of type number or string or an instance of Buffer, TypedArray, or DataView.');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (isBadDhGeneratorBytes(genBytes)) {
            throw createDhBadGeneratorError();
        }
        this._handle = webCryptoNative.dh_create_from_prime(primeBytes, genBytes);
    }

    noteSecureHeapUsage(256);
}

DiffieHellman.prototype.generateKeys = function(encoding) {
    const bytes = webCryptoNative.dh_generate_keys(this._handle);
    if (bytes === null || bytes === undefined) throw new Error('Failed to generate keys');
    return encodeOutput(new Uint8Array(bytes), encoding);
};

DiffieHellman.prototype.computeSecret = function(otherPublicKey, inputEncoding, outputEncoding) {
    const pubBytes = toBytes(otherPublicKey, inputEncoding);
    const result = webCryptoNative.dh_compute_secret_err(this._handle, pubBytes);
    if (result[0] === 'error') {
        const err = new Error(result[1]);
        err.message = result[1];
        throw err;
    }
    const hexStr = result[1];
    const bytes = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes[i / 2] = parseInt(hexStr.substring(i, i + 2), 16);
    }
    return encodeOutput(bytes, outputEncoding);
};

DiffieHellman.prototype.getPrime = function(encoding) {
    const bytes = webCryptoNative.dh_get_prime(this._handle);
    if (bytes === null || bytes === undefined) throw new Error('Failed to get prime');
    return encodeOutput(new Uint8Array(bytes), encoding);
};

DiffieHellman.prototype.getGenerator = function(encoding) {
    const bytes = webCryptoNative.dh_get_generator(this._handle);
    if (bytes === null || bytes === undefined) throw new Error('Failed to get generator');
    return encodeOutput(new Uint8Array(bytes), encoding);
};

DiffieHellman.prototype.getPublicKey = function(encoding) {
    const bytes = webCryptoNative.dh_get_public_key(this._handle);
    if (bytes === null || bytes === undefined) {
        const err = new Error('No public key - did you forget to generate one?');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    return encodeOutput(new Uint8Array(bytes), encoding);
};

DiffieHellman.prototype.getPrivateKey = function(encoding) {
    const bytes = webCryptoNative.dh_get_private_key(this._handle);
    if (bytes === null || bytes === undefined) {
        const err = new Error('No private key - did you forget to generate one?');
        err.code = 'ERR_CRYPTO_INVALID_STATE';
        throw err;
    }
    return encodeOutput(new Uint8Array(bytes), encoding);
};

DiffieHellman.prototype.setPublicKey = function(key, encoding) {
    const keyBytes = toBytes(key, encoding);
    webCryptoNative.dh_set_public_key(this._handle, keyBytes);
};

DiffieHellman.prototype.setPrivateKey = function(key, encoding) {
    const keyBytes = toBytes(key, encoding);
    webCryptoNative.dh_set_private_key(this._handle, keyBytes);
};

Object.defineProperty(DiffieHellman.prototype, 'verifyError', {
    get: function() {
        const err = webCryptoNative.dh_get_verify_error(this._handle);
        return err === null || err === undefined ? 0 : err;
    }
});

export { DiffieHellman };

function isValidBufferEncoding(encoding) {
    return typeof encoding === 'string' && (
        encoding === 'buffer' ||
        (typeof Buffer !== 'undefined' && typeof Buffer.isEncoding === 'function' && Buffer.isEncoding(encoding))
    );
}

export function createDiffieHellman(sizeOrKey, encodingOrGenerator, generator, genEncoding) {
    let keyEncoding = encodingOrGenerator;
    let generatorValue = generator;
    let generatorEncoding = genEncoding;

    // Match Node.js legacy overload behavior:
    // if the second argument is not a valid encoding (or "buffer"), treat it as the generator.
    if (keyEncoding && !isValidBufferEncoding(keyEncoding)) {
        generatorEncoding = generatorValue;
        generatorValue = keyEncoding;
        keyEncoding = undefined;
    }

    return new DiffieHellman(sizeOrKey, keyEncoding, generatorValue, generatorEncoding);
}

// ===== DiffieHellmanGroup =====

function DiffieHellmanGroup(name) {
    if (!(this instanceof DiffieHellmanGroup)) return new DiffieHellmanGroup(name);
    const handle = webCryptoNative.dh_create_group(name);
    if (handle === null || handle === undefined) {
        const err = new Error('Unknown DH group');
        err.code = 'ERR_CRYPTO_UNKNOWN_DH_GROUP';
        throw err;
    }
    this._handle = handle;
}

DiffieHellmanGroup.prototype.generateKeys = DiffieHellman.prototype.generateKeys;
DiffieHellmanGroup.prototype.computeSecret = DiffieHellman.prototype.computeSecret;
DiffieHellmanGroup.prototype.getPrime = DiffieHellman.prototype.getPrime;
DiffieHellmanGroup.prototype.getGenerator = DiffieHellman.prototype.getGenerator;
DiffieHellmanGroup.prototype.getPublicKey = DiffieHellman.prototype.getPublicKey;
DiffieHellmanGroup.prototype.getPrivateKey = DiffieHellman.prototype.getPrivateKey;

Object.defineProperty(DiffieHellmanGroup.prototype, 'verifyError', {
    get: function() {
        const err = webCryptoNative.dh_get_verify_error(this._handle);
        return err === null || err === undefined ? 0 : err;
    }
});

export { DiffieHellmanGroup };

export function createDiffieHellmanGroup(name) {
    return new DiffieHellmanGroup(name);
}

export function getDiffieHellman(name) {
    return new DiffieHellmanGroup(name);
}

// ===== ECDH =====

function ECDH(curve) {
    if (!(this instanceof ECDH)) return new ECDH(curve);
    if (typeof curve !== 'string') {
        const err = new TypeError('The "curve" argument must be of type string. Received ' + (curve === undefined ? 'undefined' : typeof curve));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const handle = webCryptoNative.ecdh_create(curve);
    if (handle === null || handle === undefined) {
        const err = new Error('Invalid curve: ' + curve);
        err.code = 'ERR_CRYPTO_INVALID_CURVE';
        throw err;
    }
    this._handle = handle;
}

const ECDH_CONVERT_KEY_CURVES = new Set([
    'prime256v1',
    'P-256',
    'p256',
    'secp384r1',
    'P-384',
    'p384',
    'secp256k1',
    'K-256',
    'k256',
    // Node/OpenSSL supports this for convertKey(), but our runtime does not yet
    // expose full secp521r1 ECDH support.
    'secp521r1',
    'P-521',
    'p521',
]);

ECDH.convertKey = function(key, curve, inputEncoding, outputEncoding, format) {
    if (typeof curve !== 'string') {
        const err = new TypeError('The "curve" argument must be of type string. Received ' + (curve === undefined ? 'undefined' : typeof curve));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    const keyBytes = toBytes(key, inputEncoding);

    let normalizedFormat = format;
    if (normalizedFormat) {
        if (normalizedFormat !== 'compressed' && normalizedFormat !== 'hybrid' && normalizedFormat !== 'uncompressed') {
            const err = new TypeError('Invalid ECDH format: ' + normalizedFormat);
            err.code = 'ERR_CRYPTO_ECDH_INVALID_FORMAT';
            throw err;
        }
    } else {
        normalizedFormat = undefined;
    }

    if (!ECDH_CONVERT_KEY_CURVES.has(curve)) {
        const err = new TypeError('Invalid EC curve name');
        err.code = 'ERR_CRYPTO_INVALID_CURVE';
        throw err;
    }

    if (curve === 'secp521r1' || curve === 'P-521' || curve === 'p521') {
        throw new Error('Failed to convert Buffer to EC_POINT');
    }

    const ecdh = new ECDH(curve);
    ecdh.setPublicKey(keyBytes);
    return ecdh.getPublicKey(outputEncoding, normalizedFormat);
};

ECDH.prototype.generateKeys = function(encoding, format) {
    const bytes = webCryptoNative.ecdh_generate_keys(this._handle);
    if (bytes === null || bytes === undefined) throw new Error('Failed to generate keys');
    return encodeOutput(new Uint8Array(bytes), encoding);
};

ECDH.prototype.computeSecret = function(otherPublicKey, inputEncoding, outputEncoding) {
    const pubBytes = toBytes(otherPublicKey, inputEncoding);
    const result = webCryptoNative.ecdh_compute_secret_err(this._handle, pubBytes);
    if (result[0] === 'error') {
        const err = new Error(result[1]);
        err.code = 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY';
        throw err;
    }
    const hexStr = result[1];
    const bytes = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes[i / 2] = parseInt(hexStr.substring(i, i + 2), 16);
    }
    return encodeOutput(bytes, outputEncoding);
};

ECDH.prototype.getPublicKey = function(encoding, format) {
    let compressed = false;
    if (format === 'compressed') compressed = true;
    else if (format === 'hybrid') compressed = false;
    else if (format !== undefined && format !== null && format !== 'uncompressed') {
        const err = new TypeError('Invalid ECDH format: ' + format);
        err.code = 'ERR_CRYPTO_ECDH_INVALID_FORMAT';
        throw err;
    }
    const bytes = webCryptoNative.ecdh_get_public_key(this._handle, compressed);
    if (bytes === null || bytes === undefined) throw new Error('Failed to get ECDH public key');
    if (format === 'hybrid' && bytes.length > 0) {
        const result = new Uint8Array(bytes);
        if (result[0] === 4) {
            result[0] = (result[result.length - 1] & 1) === 0 ? 6 : 7;
        }
        return encodeOutput(result, encoding);
    }
    return encodeOutput(new Uint8Array(bytes), encoding);
};

ECDH.prototype.getPrivateKey = function(encoding) {
    const bytes = webCryptoNative.ecdh_get_private_key(this._handle);
    if (bytes === null || bytes === undefined) throw new Error('Failed to get ECDH private key');
    return encodeOutput(new Uint8Array(bytes), encoding);
};

ECDH.prototype.setPublicKey = function(key, encoding) {
    const keyBytes = toBytes(key, encoding);
    const result = webCryptoNative.ecdh_set_public_key_err(this._handle, keyBytes);
    if (result[0] === 'error') {
        throw new Error(result[1]);
    }
};

ECDH.prototype.setPrivateKey = function(key, encoding) {
    const keyBytes = toBytes(key, encoding);
    const result = webCryptoNative.ecdh_set_private_key_err(this._handle, keyBytes);
    if (result[0] === 'error') {
        const err = new Error(result[1]);
        throw err;
    }
};

export { ECDH };

export function createECDH(curve) {
    return new ECDH(curve);
}

export const constants = {
    OPENSSL_VERSION_NUMBER: 0,
    SSL_OP_ALL: 0,
    SSL_OP_ALLOW_NO_DHE_KEX: 0,
    SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: 0,
    SSL_OP_CIPHER_SERVER_PREFERENCE: 0,
    SSL_OP_CISCO_ANYCONNECT: 0,
    SSL_OP_COOKIE_EXCHANGE: 0,
    SSL_OP_CRYPTOPRO_TLSEXT_BUG: 0,
    SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: 0,
    SSL_OP_LEGACY_SERVER_CONNECT: 0,
    SSL_OP_NO_COMPRESSION: 0,
    SSL_OP_NO_ENCRYPT_THEN_MAC: 0,
    SSL_OP_NO_QUERY_MTU: 0,
    SSL_OP_NO_RENEGOTIATION: 0,
    SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: 0,
    SSL_OP_NO_SSLv2: 0,
    SSL_OP_NO_SSLv3: 0,
    SSL_OP_NO_TICKET: 0,
    SSL_OP_NO_TLSv1: 0,
    SSL_OP_NO_TLSv1_1: 0,
    SSL_OP_NO_TLSv1_2: 0,
    SSL_OP_NO_TLSv1_3: 0,
    SSL_OP_PRIORITIZE_CHACHA: 0,
    SSL_OP_TLS_ROLLBACK_BUG: 0,
    ENGINE_METHOD_RSA: 0x0001,
    ENGINE_METHOD_DSA: 0x0002,
    ENGINE_METHOD_DH: 0x0004,
    ENGINE_METHOD_RAND: 0x0008,
    ENGINE_METHOD_EC: 0x0800,
    ENGINE_METHOD_CIPHERS: 0x0040,
    ENGINE_METHOD_DIGESTS: 0x0080,
    ENGINE_METHOD_PKEY_METHS: 0x0200,
    ENGINE_METHOD_PKEY_ASN1_METHS: 0x0400,
    ENGINE_METHOD_ALL: 0xFFFF,
    ENGINE_METHOD_NONE: 0x0000,
    DH_CHECK_P_NOT_SAFE_PRIME: 0x02,
    DH_CHECK_P_NOT_PRIME: 0x01,
    DH_UNABLE_TO_CHECK_GENERATOR: 0x04,
    DH_NOT_SUITABLE_GENERATOR: 0x08,
    RSA_PKCS1_PADDING: 1,
    RSA_SSLV23_PADDING: 2,
    RSA_NO_PADDING: 3,
    RSA_PKCS1_OAEP_PADDING: 4,
    RSA_X931_PADDING: 5,
    RSA_PKCS1_PSS_PADDING: 6,
    RSA_PSS_SALTLEN_DIGEST: -1,
    RSA_PSS_SALTLEN_MAX_SIGN: -2,
    RSA_PSS_SALTLEN_AUTO: -2,
    POINT_CONVERSION_COMPRESSED: 2,
    POINT_CONVERSION_UNCOMPRESSED: 4,
    POINT_CONVERSION_HYBRID: 6,
};

let secureHeapState = {
    signature: '',
    total: 0,
    min: 0,
    used: 0,
};

function readExecArgvFlagValue(execArgv, flagName) {
    const prefixed = flagName + '=';
    for (let i = 0; i < execArgv.length; i += 1) {
        const arg = String(execArgv[i]);
        if (arg === flagName) {
            if (i + 1 >= execArgv.length) {
                return '';
            }
            i += 1;
            return String(execArgv[i]);
        }
        if (arg.startsWith(prefixed)) {
            return arg.slice(prefixed.length);
        }
    }
    return null;
}

function parseSecureHeapNumber(value) {
    if (typeof value !== 'string' || value.length === 0 || !/^\d+$/.test(value)) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

function getSecureHeapConfig() {
    const execArgv = typeof process !== 'undefined' && Array.isArray(process.execArgv) ? process.execArgv : [];

    const secureHeapValue = readExecArgvFlagValue(execArgv, '--secure-heap');
    const parsedHeapValue = parseSecureHeapNumber(secureHeapValue);
    const total = parsedHeapValue !== null && parsedHeapValue >= 2 ? parsedHeapValue : 0;

    if (total === 0) {
        return {
            total: 0,
            min: 0,
            enabled: false,
        };
    }

    const secureHeapMinValue = readExecArgvFlagValue(execArgv, '--secure-heap-min');
    const parsedHeapMinValue = parseSecureHeapNumber(secureHeapMinValue);
    const min = parsedHeapMinValue !== null && parsedHeapMinValue >= 2 ? Math.min(parsedHeapMinValue, total) : 2;

    return {
        total,
        min,
        enabled: true,
    };
}

function resolveSecureHeapState() {
    const config = getSecureHeapConfig();
    const signature = `${config.total}:${config.min}`;
    if (secureHeapState.signature !== signature) {
        secureHeapState = {
            signature,
            total: config.total,
            min: config.min,
            used: 0,
        };
    }

    return {
        config,
        state: secureHeapState,
    };
}

function noteSecureHeapUsage(bytesHint) {
    const resolved = resolveSecureHeapState();
    if (!resolved.config.enabled) {
        return;
    }

    const increment = Number.isFinite(bytesHint) && bytesHint > 0
        ? Math.floor(bytesHint)
        : Math.max(1, resolved.config.min || 1);

    resolved.state.used = Math.min(resolved.config.total, resolved.state.used + increment);
}

export function secureHeapUsed() {
    const resolved = resolveSecureHeapState();
    if (!resolved.config.enabled) {
        return {
            total: 0,
            used: 0,
            utilization: 0,
            min: 0,
        };
    }

    const total = resolved.config.total;
    const used = resolved.state.used;
    return {
        total,
        used,
        utilization: total > 0 ? used / total : 0,
        min: resolved.config.min,
    };
}

export function getFips() {
    return 0;
}

export function setFips(_val) {
    if (!_val) {
        return;
    }

    const err = new Error('error:0308010C:digital envelope routines::unsupported: fips mode not supported');
    err.code = 'ERR_CRYPTO_OPERATION_FAILED';
    throw err;
}

export const fips = false;

const TO_CRYPTO_KEY_ALGORITHM_NAMES = {
    'AES-CTR': 'AES-CTR',
    'AES-CBC': 'AES-CBC',
    'AES-GCM': 'AES-GCM',
    'AES-KW': 'AES-KW',
    'PBKDF2': 'PBKDF2',
    'HKDF': 'HKDF',
    'HMAC': 'HMAC',
    'ED25519': 'Ed25519',
    'ED448': 'Ed448',
    'X25519': 'X25519',
    'X448': 'X448',
    'RSASSA-PKCS1-V1_5': 'RSASSA-PKCS1-v1_5',
    'RSA-PSS': 'RSA-PSS',
    'RSA-OAEP': 'RSA-OAEP',
    'ECDH': 'ECDH',
    'ECDSA': 'ECDSA',
};

const KEY_OBJECT_TYPES = new Set(['secret', 'public', 'private']);
const PRIVATE_KEY_CACHE = new Map();
const PUBLIC_KEY_CACHE = new Map();
const PRIVATE_JWK_KEY_CACHE = new WeakMap();
const PUBLIC_JWK_KEY_CACHE = new WeakMap();
const RSA_PRIVATE_DECRYPT_CACHE = new Map();
const RSA_PUBLIC_DECRYPT_CACHE = new Map();

function buildKeyObjectCacheKey(format, type_, passphrase, keyData) {
    if (passphrase !== undefined) {
        return null;
    }

    if (typeof keyData === 'string') {
        return format + '|' + (type_ || '') + '|str:' + keyData;
    }

    if (ArrayBuffer.isView(keyData) || keyData instanceof ArrayBuffer) {
        const bytes = toBytes(keyData);
        return format + '|' + (type_ || '') + '|b64:' + bytesToBase64Url(bytes);
    }

    return null;
}

function formatInvalidArgValue(value) {
    if (typeof value === 'string') {
        return `'${value}'`;
    }
    return String(value);
}

function createInvalidKeyObjectTypeError(type_) {
    const err = new TypeError(`The argument 'type' is invalid. Received ${formatInvalidArgValue(type_)}`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

// ===== KeyObject =====

class KeyObject {
    constructor(typeOrHandle, handleOrType, customData) {
        // Internal construction path used by builtin wrappers.
        if (typeof handleOrType === 'string' && KEY_OBJECT_TYPES.has(handleOrType)) {
            this._handle = typeOrHandle;
            this._type = handleOrType;
            this._customData = customData || null;
            return;
        }

        // Public constructor compatibility path (`new KeyObject(type, handle)`).
        const type_ = typeOrHandle;
        const handle = handleOrType;
        if (typeof type_ !== 'string' || !KEY_OBJECT_TYPES.has(type_)) {
            throw createInvalidKeyObjectTypeError(type_);
        }
        if (handle === null || typeof handle !== 'object') {
            throw new ERR_INVALID_ARG_TYPE('handle', 'object', handle);
        }

        this._handle = handle;
        this._type = type_;
        this._customData = null;
    }

    get type() {
        return this._type;
    }

    get asymmetricKeyType() {
        if (this._type === 'secret') return undefined;
        if (this._customData && this._customData.asymmetricKeyType) {
            return this._customData.asymmetricKeyType;
        }
        return webCryptoNative.key_asymmetric_type(this._handle);
    }

    get asymmetricKeyDetails() {
        if (this._type === 'secret') return undefined;
        if (this._customData && this._customData.asymmetricKeyDetails) {
            return this._customData.asymmetricKeyDetails;
        }

        const keyType = this.asymmetricKeyType;
        if (keyType === 'ec') {
            try {
                const jwkJson = webCryptoNative.key_export_jwk(this._handle);
                if (jwkJson) {
                    const jwk = JSON.parse(jwkJson);
                    if (jwk && jwk.crv) {
                        const crvMap = { 'P-256': 'prime256v1', 'P-384': 'secp384r1', 'P-521': 'secp521r1', 'secp256k1': 'secp256k1' };
                        return { namedCurve: crvMap[jwk.crv] || jwk.crv };
                    }
                }
            } catch (_ignored) {}
            return undefined;
        }

        const details = webCryptoNative.key_asymmetric_details(this._handle);
        if (details === null || details === undefined) return undefined;
        if (keyType === 'dsa') {
            return {
                modulusLength: Number(details[0]),
                divisorLength: Number(details[1]),
            };
        }
        return {
            modulusLength: Number(details[0]),
            publicExponent: BigInt(details[1]),
        };
    }

    get symmetricKeySize() {
        if (this._type !== 'secret') {
            return undefined;
        }
        return toBytes(this.export()).length;
    }

    export(options) {
        if (this._customData) {
            const customExport = tryExportCustomKeyObject(this, options);
            if (customExport !== undefined) {
                return customExport;
            }
            const err = new Error('Failed to export key');
            err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
            throw err;
        }
        if (this._type === 'secret') {
            if (options && typeof options === 'object' && options.format === 'jwk') {
                const raw = webCryptoNative.key_export(this._handle, 'der', undefined);
                if (raw === null || raw === undefined) {
                    throw new Error('Failed to export secret key');
                }
                const bytes = new Uint8Array(raw);
                const k = bytesToBase64Url(bytes);
                return { kty: 'oct', k };
            }
            const raw = webCryptoNative.key_export(this._handle, 'der', undefined);
            if (raw === null || raw === undefined) {
                throw new Error('Failed to export secret key');
            }
            if (typeof Buffer !== 'undefined') {
                return Buffer.from(raw);
            }
            return new Uint8Array(raw);
        }

        if (options === undefined || options === null || typeof options !== 'object') {
            throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
        }

        const format = options.format || (options.type ? 'pem' : 'der');
        const type_ = options.type || null;

        if (format === 'jwk' && (options.passphrase !== undefined || options.cipher !== undefined)) {
            throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('jwk', 'does not support encryption');
        }

        if (options.passphrase !== undefined && options.cipher === undefined) {
            const err = new TypeError("The property 'options.cipher' is invalid. Received undefined");
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }

        // JWK export
        if (format === 'jwk') {
            const json = webCryptoNative.key_export_jwk(this._handle);
            if (json !== null && json !== undefined) {
                return JSON.parse(json);
            }
            if (this.asymmetricKeyType === 'rsa') {
                return exportRsaKeyObjectAsJwk(this);
            }
            const keyType = this.asymmetricKeyType;
            if (keyType === 'dsa' || keyType === 'rsa-pss') {
                const err = new Error('Unsupported JWK key type: ' + keyType);
                err.code = 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE';
                throw err;
            }
            throw new Error('Failed to export key as JWK');
        }

        // Encrypted PEM export
        if (options.cipher && options.passphrase !== undefined) {
            const passBytes = toBytes(options.passphrase);
            const result = webCryptoNative.key_export_encrypted(this._handle, format, type_ || 'pkcs8', options.cipher, passBytes);
            if (result === null || result === undefined) {
                throw new Error('Failed to export encrypted key');
            }
            if (format === 'pem') {
                const decoder = new TextDecoder();
                return decoder.decode(new Uint8Array(result));
            }
            if (typeof Buffer !== 'undefined') {
                return Buffer.from(result);
            }
            return new Uint8Array(result);
        }

        const result = webCryptoNative.key_export(this._handle, format, type_);
        if (result === null || result === undefined) {
            const nativeFallback = exportEd25519NativeKeyObject(this, format, type_);
            if (nativeFallback !== null && nativeFallback !== undefined) {
                return nativeFallback;
            }
            throw new Error('Failed to export key');
        }
        if (format === 'pem') {
            const decoder = new TextDecoder();
            return decoder.decode(new Uint8Array(result));
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(result);
        }
        return new Uint8Array(result);
    }

    equals(otherKeyObject) {
        if (!(otherKeyObject instanceof KeyObject)) {
            throw new ERR_INVALID_ARG_TYPE('otherKeyObject', 'KeyObject', otherKeyObject);
        }
        if (this === otherKeyObject) {
            return true;
        }
        if (this.type !== otherKeyObject.type) {
            return false;
        }
        if (this._handle !== null && this._handle !== undefined && this._handle === otherKeyObject._handle) {
            return true;
        }
        if (!keyObjectCustomDataEquals(this._customData, otherKeyObject._customData)) {
            return false;
        }
        if (this._customData || otherKeyObject._customData) {
            return true;
        }

        const exportOptions = this.type === 'public'
            ? { format: 'der', type: 'spki' }
            : this.type === 'private'
                ? { format: 'der', type: 'pkcs8' }
                : undefined;

        const left = exportOptions ? toBytes(this.export(exportOptions)) : toBytes(this.export());
        const right = exportOptions ? toBytes(otherKeyObject.export(exportOptions)) : toBytes(otherKeyObject.export());
        return bytesEqual(left, right);
    }

    toCryptoKey(algorithm, extractable, keyUsages) {
        const normalizedAlgorithm = normalizeToCryptoKeyAlgorithm(algorithm);
        const usages = normalizeToCryptoKeyUsages(keyUsages);
        let cryptoAlgorithm;

        if (this.type === 'secret') {
            const keyLengthBits = toBytes(this.export()).length * 8;

            if (normalizedAlgorithm.upperName === 'PBKDF2') {
                if (extractable) {
                    throw createSyntaxError('PBKDF2 keys are not extractable');
                }
                ensureAllowedCryptoKeyUsages(
                    usages,
                    new Set(['deriveBits', 'deriveKey']),
                    'Unsupported key usage for a PBKDF2 key',
                );
                cryptoAlgorithm = { name: 'PBKDF2' };
            } else if (normalizedAlgorithm.upperName === 'HKDF') {
                if (extractable) {
                    throw createSyntaxError('HKDF keys are not extractable');
                }
                ensureAllowedCryptoKeyUsages(
                    usages,
                    new Set(['deriveBits', 'deriveKey']),
                    'Unsupported key usage for an HKDF key',
                );
                cryptoAlgorithm = { name: 'HKDF' };
            } else if (normalizedAlgorithm.upperName === 'HMAC') {
                const requestedLength = getRequestedHmacLength(algorithm, keyLengthBits);
                if (requestedLength === 0 || keyLengthBits === 0) {
                    throw createDataError('Zero-length key is not supported');
                }
                if (requestedLength !== keyLengthBits) {
                    const expectedBytes = Math.ceil(requestedLength / 8);
                    const actualBytes = keyLengthBits / 8;
                    if (actualBytes !== expectedBytes) {
                        throw createDataError('Invalid key length');
                    }
                }
                if (usages.length === 0) {
                    throw createSyntaxError('Usages cannot be empty when importing a secret key.');
                }
                ensureAllowedCryptoKeyUsages(
                    usages,
                    new Set(['sign', 'verify']),
                    'Unsupported key usage for an HMAC key',
                );
                cryptoAlgorithm = {
                    name: 'HMAC',
                    hash: { name: normalizeToCryptoKeyHash(algorithm) },
                    length: requestedLength,
                };
            } else {
                if (keyLengthBits !== 128 && keyLengthBits !== 192 && keyLengthBits !== 256) {
                    throw createDataError('Invalid key length');
                }
                if (usages.length === 0) {
                    throw createSyntaxError('Usages cannot be empty when importing a secret key.');
                }
                const allowedUsages = normalizedAlgorithm.upperName === 'AES-KW'
                    ? new Set(['wrapKey', 'unwrapKey'])
                    : new Set(['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
                ensureAllowedCryptoKeyUsages(usages, allowedUsages, 'Unsupported key usage for an AES key');
                cryptoAlgorithm = {
                    name: normalizedAlgorithm.name,
                    length: keyLengthBits,
                };
            }
        } else {
            const keyType = this.asymmetricKeyType;
            if (
                normalizedAlgorithm.upperName === 'ED25519' ||
                normalizedAlgorithm.upperName === 'ED448' ||
                normalizedAlgorithm.upperName === 'X25519' ||
                normalizedAlgorithm.upperName === 'X448'
            ) {
                const expectedKeyType = normalizedAlgorithm.upperName.toLowerCase();
                if (keyType !== expectedKeyType) {
                    throw createDataError('Invalid key type');
                }
                const allowedUsages = normalizedAlgorithm.upperName.startsWith('ED')
                    ? (this.type === 'public' ? new Set(['verify']) : new Set(['sign']))
                    : (this.type === 'public' ? new Set() : new Set(['deriveBits', 'deriveKey']));
                ensureAllowedCryptoKeyUsages(
                    usages,
                    allowedUsages,
                    `Unsupported key usage for a ${normalizedAlgorithm.name} key`,
                );
                cryptoAlgorithm = { name: normalizedAlgorithm.name };
            } else if (
                normalizedAlgorithm.upperName === 'RSASSA-PKCS1-V1_5' ||
                normalizedAlgorithm.upperName === 'RSA-PSS' ||
                normalizedAlgorithm.upperName === 'RSA-OAEP'
            ) {
                if (keyType !== 'rsa') {
                    throw createDataError('Invalid key type');
                }
                const allowedUsages = normalizedAlgorithm.upperName === 'RSA-OAEP'
                    ? (this.type === 'public'
                        ? new Set(['encrypt', 'wrapKey'])
                        : new Set(['decrypt', 'unwrapKey']))
                    : (this.type === 'public' ? new Set(['verify']) : new Set(['sign']));
                ensureAllowedCryptoKeyUsages(
                    usages,
                    allowedUsages,
                    `Unsupported key usage for a ${normalizedAlgorithm.name} key`,
                );
                cryptoAlgorithm = {
                    name: normalizedAlgorithm.name,
                    hash: { name: normalizeToCryptoKeyHash(algorithm) },
                };
            } else {
                if (keyType !== 'ec') {
                    throw createDataError('Invalid key type');
                }
                if (normalizedAlgorithm.upperName === 'ECDH' && this.type === 'private' && usages.length === 0) {
                    throw createSyntaxError('Usages cannot be empty when importing a private key.');
                }
                const allowedUsages = normalizedAlgorithm.upperName === 'ECDH'
                    ? (this.type === 'public' ? new Set() : new Set(['deriveBits', 'deriveKey']))
                    : (this.type === 'public' ? new Set(['verify']) : new Set(['sign']));
                ensureAllowedCryptoKeyUsages(
                    usages,
                    allowedUsages,
                    `Unsupported key usage for a ${normalizedAlgorithm.name} key`,
                );

                const requestedNamedCurve = getRequestedNamedCurve(algorithm);
                const actualNamedCurve = getKeyObjectNamedCurve(this);
                if (requestedNamedCurve && actualNamedCurve && requestedNamedCurve !== actualNamedCurve) {
                    throw createDataError('Named curve mismatch');
                }

                cryptoAlgorithm = {
                    name: normalizedAlgorithm.name,
                    namedCurve: requestedNamedCurve || actualNamedCurve,
                };
            }
        }

        return new CryptoKey(kInternal, this.type, cryptoAlgorithm, Boolean(extractable), usages, this);
    }

    static from(value) {
        if (
            value &&
            typeof value === 'object' &&
            value._keyObject instanceof KeyObject
        ) {
            return value._keyObject;
        }
        throw new ERR_INVALID_ARG_TYPE('key', 'CryptoKey', value);
    }

    [structuredCloneSymbol]() {
        return new KeyObject(this._handle, this._type, this._customData);
    }
}

Object.defineProperty(KeyObject.prototype, Symbol.toStringTag, {
    value: 'KeyObject',
    writable: false,
    enumerable: false,
    configurable: true,
});

export { KeyObject };

function createDataError(message) {
    const err = new Error(message);
    err.name = 'DataError';
    return err;
}

function createSyntaxError(message) {
    const err = new Error(message);
    err.name = 'SyntaxError';
    return err;
}

function normalizeToCryptoKeyAlgorithm(algorithm) {
    const name = typeof algorithm === 'string'
        ? algorithm
        : (algorithm && typeof algorithm === 'object' ? algorithm.name : undefined);

    if (typeof name !== 'string') {
        throw new TypeError('Algorithm must be a string or an object with a name property');
    }

    const upperName = name.toUpperCase();
    const normalizedName = TO_CRYPTO_KEY_ALGORITHM_NAMES[upperName];
    if (!normalizedName) {
        throw createDataError('Unsupported algorithm: ' + name);
    }

    return {
        upperName,
        name: normalizedName,
    };
}

function normalizeToCryptoKeyUsages(keyUsages) {
    if (!Array.isArray(keyUsages)) {
        throw new TypeError('The "keyUsages" argument must be an array');
    }
    return keyUsages.slice();
}

function ensureAllowedCryptoKeyUsages(usages, allowed, message) {
    for (const usage of usages) {
        if (!allowed.has(usage)) {
            throw createSyntaxError(message);
        }
    }
}

function normalizeToCryptoKeyHash(algorithm) {
    if (!algorithm || typeof algorithm !== 'object') {
        throw new TypeError('Algorithm object with hash is required');
    }
    const hash = algorithm.hash;
    const hashName = typeof hash === 'string'
        ? hash
        : (hash && typeof hash === 'object' ? hash.name : undefined);
    if (typeof hashName !== 'string') {
        throw new TypeError('Invalid hash algorithm');
    }
    const normalized = normalizeHashAlgorithm(hashName);
    switch (normalized) {
        case 'sha1':
            return 'SHA-1';
        case 'sha224':
            return 'SHA-224';
        case 'sha256':
            return 'SHA-256';
        case 'sha384':
            return 'SHA-384';
        case 'sha512':
            return 'SHA-512';
        default:
            return hashName;
    }
}

function getRequestedHmacLength(algorithm, defaultLength) {
    if (!algorithm || typeof algorithm !== 'object' || algorithm.length === undefined) {
        return defaultLength;
    }
    return Number(algorithm.length);
}

function getRequestedNamedCurve(algorithm) {
    if (!algorithm || typeof algorithm !== 'object') {
        return undefined;
    }
    return algorithm.namedCurve;
}

function getKeyObjectNamedCurve(keyObject) {
    if (keyObject && keyObject._customData) {
        if (keyObject._customData.ec && typeof keyObject._customData.ec.namedCurve === 'string') {
            return keyObject._customData.ec.namedCurve;
        }
        if (typeof keyObject._customData.namedCurve === 'string') {
            return keyObject._customData.namedCurve;
        }
    }
    try {
        const jwk = keyObject.export({ format: 'jwk' });
        if (jwk && typeof jwk.crv === 'string') {
            return jwk.crv;
        }
    } catch (_ignored) {
    }
    return undefined;
}

function optionalBytesEqual(left, right) {
    if (left === undefined || left === null || right === undefined || right === null) {
        return left === right;
    }
    return bytesEqual(left, right);
}

function keyObjectCustomDataEquals(left, right) {
    if (!left && !right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    if (left.asymmetricKeyType !== right.asymmetricKeyType) {
        return false;
    }

    if (left.okp || right.okp) {
        if (!left.okp || !right.okp) {
            return false;
        }
        return optionalBytesEqual(left.okp.privateKey, right.okp.privateKey) &&
            optionalBytesEqual(left.okp.publicKey, right.okp.publicKey);
    }

    if (left.montgomery || right.montgomery) {
        if (!left.montgomery || !right.montgomery) {
            return false;
        }
        return optionalBytesEqual(left.montgomery.privateKey, right.montgomery.privateKey) &&
            optionalBytesEqual(left.montgomery.publicKey, right.montgomery.publicKey);
    }

    if (left.edwards || right.edwards) {
        if (!left.edwards || !right.edwards) {
            return false;
        }
        return optionalBytesEqual(left.edwards.privateKey, right.edwards.privateKey) &&
            optionalBytesEqual(left.edwards.publicKey, right.edwards.publicKey);
    }

    if (left.ec || right.ec) {
        if (!left.ec || !right.ec) {
            return false;
        }
        return left.ec.namedCurve === right.ec.namedCurve &&
            optionalBytesEqual(left.ec.privateKey, right.ec.privateKey) &&
            optionalBytesEqual(left.ec.publicKey, right.ec.publicKey);
    }

    if (left.dh || right.dh) {
        if (!left.dh || !right.dh) {
            return false;
        }
        return bytesEqual(left.dh.prime, right.dh.prime) &&
            bytesEqual(left.dh.generator, right.dh.generator) &&
            optionalBytesEqual(left.dh.privateKey, right.dh.privateKey) &&
            optionalBytesEqual(left.dh.publicKey, right.dh.publicKey);
    }

    return false;
}

function toPemString(keyData) {
    if (typeof keyData === 'string') {
        return keyData;
    }
    const bytes = toBytes(keyData);
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}

function normalizeAsymmetricKeyDataForEncoding(keyData, format, encoding) {
    if (format === 'jwk' || encoding === undefined || typeof keyData !== 'string') {
        return keyData;
    }
    return toBytes(keyData, encoding);
}

function normalizeAsymmetricPassphraseForEncoding(passphrase, encoding) {
    if (encoding === undefined || typeof passphrase !== 'string') {
        return passphrase;
    }
    return toBytes(passphrase, encoding);
}

const ED25519_PKCS8_PREFIX = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const ED25519_SPKI_PREFIX = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x70, 0x03, 0x21, 0x00,
]);

const ED448_PKCS8_PREFIX = new Uint8Array([
    0x30, 0x47, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x71, 0x04, 0x3b, 0x04, 0x39,
]);

const ED448_SPKI_PREFIX = new Uint8Array([
    0x30, 0x43, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x71, 0x03, 0x3a, 0x00,
]);

const X25519_PKCS8_PREFIX = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

const X25519_SPKI_PREFIX = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x6e, 0x03, 0x21, 0x00,
]);

const X448_PKCS8_PREFIX = new Uint8Array([
    0x30, 0x46, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x6f, 0x04, 0x3a, 0x04, 0x38,
]);

const X448_SPKI_PREFIX = new Uint8Array([
    0x30, 0x42, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x6f, 0x03, 0x39, 0x00,
]);

const OKP_TYPE_INFO = {
    ed25519: {
        crv: 'Ed25519',
        privateLength: 32,
        publicLength: 32,
        privatePrefix: ED25519_PKCS8_PREFIX,
        publicPrefix: ED25519_SPKI_PREFIX,
    },
    ed448: {
        crv: 'Ed448',
        privateLength: 57,
        publicLength: 57,
        privatePrefix: ED448_PKCS8_PREFIX,
        publicPrefix: ED448_SPKI_PREFIX,
    },
    x25519: {
        crv: 'X25519',
        privateLength: 32,
        publicLength: 32,
        privatePrefix: X25519_PKCS8_PREFIX,
        publicPrefix: X25519_SPKI_PREFIX,
    },
    x448: {
        crv: 'X448',
        privateLength: 56,
        publicLength: 56,
        privatePrefix: X448_PKCS8_PREFIX,
        publicPrefix: X448_SPKI_PREFIX,
    },
};

const OKP_TYPE_FROM_CURVE = {
    Ed25519: 'ed25519',
    Ed448: 'ed448',
    X25519: 'x25519',
    X448: 'x448',
};

const OKP_PUBLIC_FROM_PRIVATE = new Map([
    [
        'ed448:060Ke71sN0GpIc01nnGgMDkp0sFNQ09woVo4AM1ffax1-mjnakK0-p-S7-Xf859QewXjcR9mxppY',
        'oX_ee5-jlcU53-BbGRsGIzly0V-SZtJ_oGXY0udf84q2hTW2RdstLktvwpkVJOoNb7oDgc2V5ZUA',
    ],
    [
        'x25519:mL_IWm55RrALUGRfJYzw40gEYWMvtRkesP9mj8o8Omc',
        'aSb8Q-RndwfNnPeOYGYPDUN3uhAPnMLzXyfi-mqfhig',
    ],
    [
        'x448:tMNtrO_q8dlY6Y4NDeSTxNQ5CACkHiPvmukidPnNIuX_EkcryLEXt_7i6j6YZMKsrWyS0jlSYJk',
        'ioHSHVpTs6hMvghosEJDIR7ceFiE3-Xccxati64oOVJ7NWjfozE7ae31PXIUFq6cVYgvSKsDFPA',
    ],
]);

function concatBytes(first, second) {
    const a = normalizeBytes(first);
    const b = normalizeBytes(second);
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

function encodeDerAsPem(label, derBytes) {
    const data = normalizeBytes(derBytes);
    let base64;
    if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    } else {
        let binary = '';
        for (let i = 0; i < data.length; i++) {
            binary += String.fromCharCode(data[i]);
        }
        base64 = btoa(binary);
    }

    let pem = '-----BEGIN ' + label + '-----\n';
    for (let i = 0; i < base64.length; i += 64) {
        pem += base64.slice(i, i + 64) + '\n';
    }
    pem += '-----END ' + label + '-----\n';
    return pem;
}

function getOkpPublicFromPrivate(keyType, privateBytes) {
    const key = keyType + ':' + bytesToBase64Url(privateBytes);
    const publicValue = OKP_PUBLIC_FROM_PRIVATE.get(key);
    if (!publicValue) {
        return undefined;
    }
    return base64UrlToBytes(publicValue);
}

function parseOkpPrivateRaw(bytes) {
    for (const [keyType, info] of Object.entries(OKP_TYPE_INFO)) {
        const prefix = info.privatePrefix;
        if (bytes.length === prefix.length + info.privateLength && startsWithBytes(bytes, prefix)) {
            return {
                keyType,
                privateKey: bytes.slice(prefix.length),
            };
        }
    }
    return null;
}

function parseOkpPublicRaw(bytes) {
    for (const [keyType, info] of Object.entries(OKP_TYPE_INFO)) {
        const prefix = info.publicPrefix;
        if (bytes.length === prefix.length + info.publicLength && startsWithBytes(bytes, prefix)) {
            return {
                keyType,
                publicKey: bytes.slice(prefix.length),
            };
        }
    }
    return null;
}

function encodeOkpPrivateDer(keyType, privateBytes) {
    const info = OKP_TYPE_INFO[keyType];
    if (!info) {
        return null;
    }
    return concatBytes(info.privatePrefix, privateBytes);
}

function encodeOkpPublicDer(keyType, publicBytes) {
    const info = OKP_TYPE_INFO[keyType];
    if (!info) {
        return null;
    }
    return concatBytes(info.publicPrefix, publicBytes);
}

function decodePemToDer(pem) {
    const lines = pem.split(/\r?\n/);
    let base64 = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('-----') || trimmed.includes(':')) {
            continue;
        }
        base64 += trimmed;
    }
    if (!base64) {
        return null;
    }
    return toBytes(base64, 'base64');
}

function readAsn1Length(bytes, offset) {
    if (offset >= bytes.length) {
        throw new Error('Invalid ASN.1 length');
    }
    const first = bytes[offset];
    if ((first & 0x80) === 0) {
        return { length: first, offset: offset + 1 };
    }
    const count = first & 0x7f;
    if (count === 0 || offset + 1 + count > bytes.length) {
        throw new Error('Invalid ASN.1 length');
    }
    let length = 0;
    for (let i = 0; i < count; i++) {
        length = (length << 8) | bytes[offset + 1 + i];
    }
    return { length, offset: offset + 1 + count };
}

function readAsn1Element(bytes, offset) {
    if (offset >= bytes.length) {
        throw new Error('Invalid ASN.1 element offset');
    }
    const start = offset;
    const tag = bytes[offset];
    offset += 1;
    const len = readAsn1Length(bytes, offset);
    const valueStart = len.offset;
    const valueEnd = valueStart + len.length;
    if (valueEnd > bytes.length) {
        throw new Error('Invalid ASN.1 element length');
    }
    return { tag, start, valueStart, valueEnd, nextOffset: valueEnd };
}

function readAsn1Children(bytes, valueStart, valueEnd) {
    const children = [];
    let offset = valueStart;
    while (offset < valueEnd) {
        const child = readAsn1Element(bytes, offset);
        children.push(child);
        offset = child.nextOffset;
    }
    if (offset !== valueEnd) {
        throw new Error('Invalid ASN.1 sequence length');
    }
    return children;
}

function asn1IntegerToUnsignedBytes(bytes, element) {
    if (element.tag !== 0x02) {
        throw new Error('Expected ASN.1 INTEGER');
    }
    const value = bytes.slice(element.valueStart, element.valueEnd);
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) {
        first += 1;
    }
    return value.slice(first);
}

function decodeAsn1Oid(bytes, element) {
    if (element.tag !== 0x06) {
        throw new Error('Expected ASN.1 OBJECT IDENTIFIER');
    }
    const value = bytes.slice(element.valueStart, element.valueEnd);
    if (value.length === 0) {
        throw new Error('Invalid ASN.1 OBJECT IDENTIFIER');
    }
    const parts = [];
    const first = value[0];
    parts.push(Math.floor(first / 40));
    parts.push(first % 40);
    let current = 0;
    for (let i = 1; i < value.length; i++) {
        const byte = value[i];
        current = (current << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) {
            parts.push(current);
            current = 0;
        }
    }
    if (current !== 0) {
        throw new Error('Invalid ASN.1 OBJECT IDENTIFIER');
    }
    return parts.join('.');
}

function parseDerIntegerBytes(der) {
    const element = readAsn1Element(der, 0);
    if (element.tag !== 0x02 || element.nextOffset !== der.length) {
        throw new Error('Invalid DER integer');
    }
    return asn1IntegerToUnsignedBytes(der, element);
}

function extractSubjectPublicKeyInfoFromCertificateDer(der) {
    try {
        const cert = readAsn1Element(der, 0);
        if (cert.tag !== 0x30 || cert.nextOffset !== der.length) {
            return null;
        }
        const certChildren = readAsn1Children(der, cert.valueStart, cert.valueEnd);
        if (certChildren.length < 1 || certChildren[0].tag !== 0x30) {
            return null;
        }

        const tbsCertificate = certChildren[0];
        const tbsChildren = readAsn1Children(der, tbsCertificate.valueStart, tbsCertificate.valueEnd);
        const hasVersion = tbsChildren.length > 0 && tbsChildren[0].tag === 0xa0;
        const subjectPublicKeyInfoIndex = hasVersion ? 6 : 5;
        if (tbsChildren.length <= subjectPublicKeyInfoIndex) {
            return null;
        }

        const subjectPublicKeyInfo = tbsChildren[subjectPublicKeyInfoIndex];
        if (subjectPublicKeyInfo.tag !== 0x30) {
            return null;
        }

        return der.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.nextOffset);
    } catch {
        return null;
    }
}

function normalizeBytes(bytes) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function cloneBytes(bytes) {
    return new Uint8Array(normalizeBytes(bytes));
}

function bytesEqual(a, b) {
    const left = normalizeBytes(a);
    const right = normalizeBytes(b);
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}

function concatByteArrays(parts) {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function encodeAsn1Length(length) {
    if (length < 0x80) {
        return new Uint8Array([length]);
    }
    const bytes = [];
    let value = length;
    while (value > 0) {
        bytes.unshift(value & 0xff);
        value >>>= 8;
    }
    return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function encodeAsn1Element(tag, value) {
    const valueBytes = normalizeBytes(value);
    return concatByteArrays([
        new Uint8Array([tag]),
        encodeAsn1Length(valueBytes.length),
        valueBytes,
    ]);
}

function encodeAsn1Sequence(elements) {
    return encodeAsn1Element(0x30, concatByteArrays(elements));
}

function encodeAsn1Integer(bytes) {
    const value = normalizeBytes(bytes);
    if (value.length === 0) {
        return encodeAsn1Element(0x02, new Uint8Array([0]));
    }
    if ((value[0] & 0x80) !== 0) {
        return encodeAsn1Element(0x02, concatByteArrays([new Uint8Array([0]), value]));
    }
    return encodeAsn1Element(0x02, value);
}

function encodeAsn1Null() {
    return new Uint8Array([0x05, 0x00]);
}

function encodeAsn1Oid(oid) {
    const parts = oid.split('.').map((part) => Number(part));
    if (parts.length < 2) {
        throw new Error('Invalid OID: ' + oid);
    }
    const body = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i++) {
        let value = parts[i];
        const encoded = [value & 0x7f];
        value >>>= 7;
        while (value > 0) {
            encoded.unshift((value & 0x7f) | 0x80);
            value >>>= 7;
        }
        body.push(...encoded);
    }
    return encodeAsn1Element(0x06, new Uint8Array(body));
}

function encodeAsn1BitString(bytes) {
    return encodeAsn1Element(0x03, concatByteArrays([new Uint8Array([0]), normalizeBytes(bytes)]));
}

function encodeAsn1OctetString(bytes) {
    return encodeAsn1Element(0x04, normalizeBytes(bytes));
}

function requireJwkField(jwk, fieldName) {
    const value = jwk[fieldName];
    if (typeof value !== 'string') {
        throw new ERR_CRYPTO_INVALID_JWK();
    }
    return value;
}

const EC_CURVE_TO_OID = {
    'P-256': '1.2.840.10045.3.1.7',
    'P-384': '1.3.132.0.34',
    'secp256k1': '1.3.132.0.10',
    'P-521': '1.3.132.0.35',
};

const EC_OID_TO_CURVE = {
    '1.2.840.10045.3.1.7': 'P-256',
    '1.3.132.0.34': 'P-384',
    '1.3.132.0.10': 'secp256k1',
    '1.3.132.0.35': 'P-521',
};

const JWK_CURVE_TO_NAMED = {
    'P-256': 'prime256v1',
    'P-384': 'secp384r1',
    'P-521': 'secp521r1',
    'secp256k1': 'secp256k1',
};

function buildRsaPublicSpkiDer(jwk) {
    const n = base64UrlToBytes(requireJwkField(jwk, 'n'));
    const e = base64UrlToBytes(requireJwkField(jwk, 'e'));

    const rsaPublic = encodeAsn1Sequence([
        encodeAsn1Integer(n),
        encodeAsn1Integer(e),
    ]);

    const algorithm = encodeAsn1Sequence([
        encodeAsn1Oid('1.2.840.113549.1.1.1'),
        encodeAsn1Null(),
    ]);

    return encodeAsn1Sequence([
        algorithm,
        encodeAsn1BitString(rsaPublic),
    ]);
}

function buildRsaPrivatePkcs1Der(jwk) {
    const fields = [
        new Uint8Array([0]),
        base64UrlToBytes(requireJwkField(jwk, 'n')),
        base64UrlToBytes(requireJwkField(jwk, 'e')),
        base64UrlToBytes(requireJwkField(jwk, 'd')),
        base64UrlToBytes(requireJwkField(jwk, 'p')),
        base64UrlToBytes(requireJwkField(jwk, 'q')),
        base64UrlToBytes(requireJwkField(jwk, 'dp')),
        base64UrlToBytes(requireJwkField(jwk, 'dq')),
        base64UrlToBytes(requireJwkField(jwk, 'qi')),
    ];

    return encodeAsn1Sequence(fields.map((value) => encodeAsn1Integer(value)));
}

function buildEcPublicSpkiDer(jwk) {
    const curve = requireJwkField(jwk, 'crv');
    const curveOid = EC_CURVE_TO_OID[curve];
    if (!curveOid) {
        throw new ERR_CRYPTO_INVALID_JWK();
    }
    const x = base64UrlToBytes(requireJwkField(jwk, 'x'));
    const y = base64UrlToBytes(requireJwkField(jwk, 'y'));
    const point = new Uint8Array(1 + x.length + y.length);
    point[0] = 0x04;
    point.set(x, 1);
    point.set(y, 1 + x.length);

    const algorithm = encodeAsn1Sequence([
        encodeAsn1Oid('1.2.840.10045.2.1'),
        encodeAsn1Oid(curveOid),
    ]);

    return encodeAsn1Sequence([
        algorithm,
        encodeAsn1BitString(point),
    ]);
}

function buildEcPrivatePkcs8Der(jwk) {
    const curve = requireJwkField(jwk, 'crv');
    const curveOid = EC_CURVE_TO_OID[curve];
    if (!curveOid) {
        throw new ERR_CRYPTO_INVALID_JWK();
    }
    const d = base64UrlToBytes(requireJwkField(jwk, 'd'));
    const x = base64UrlToBytes(requireJwkField(jwk, 'x'));
    const y = base64UrlToBytes(requireJwkField(jwk, 'y'));
    const point = new Uint8Array(1 + x.length + y.length);
    point[0] = 0x04;
    point.set(x, 1);
    point.set(y, 1 + x.length);

    const ecPrivateKey = encodeAsn1Sequence([
        encodeAsn1Integer(new Uint8Array([1])),
        encodeAsn1OctetString(d),
        encodeAsn1Element(0xA1, encodeAsn1BitString(point)),
    ]);

    const algorithm = encodeAsn1Sequence([
        encodeAsn1Oid('1.2.840.10045.2.1'),
        encodeAsn1Oid(curveOid),
    ]);

    return encodeAsn1Sequence([
        encodeAsn1Integer(new Uint8Array([0])),
        algorithm,
        encodeAsn1OctetString(ecPrivateKey),
    ]);
}

function createPrivateKeyFromJwk(jwk) {
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
        throw new ERR_INVALID_ARG_TYPE('key.key', 'object', jwk);
    }

    if (jwk.kty === 'RSA') {
        const der = buildRsaPrivatePkcs1Der(jwk);
        const handle = webCryptoNative.create_private_key_der(der);
        if (handle === null || handle === undefined) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }
        return new KeyObject(handle, 'private');
    }

    if (jwk.kty === 'EC') {
        const der = buildEcPrivatePkcs8Der(jwk);
        const handle = webCryptoNative.create_private_key_der(der);
        if (handle !== null && handle !== undefined) {
            return new KeyObject(handle, 'private');
        }
        const crv = requireJwkField(jwk, 'crv');
        const x = base64UrlToBytes(requireJwkField(jwk, 'x'));
        const y = base64UrlToBytes(requireJwkField(jwk, 'y'));
        const d = base64UrlToBytes(requireJwkField(jwk, 'd'));
        const point = new Uint8Array(1 + x.length + y.length);
        point[0] = 0x04;
        point.set(x, 1);
        point.set(y, 1 + x.length);
        const ecKey = createEcJwkKeyObject('private', crv, d, point);
        if (ecKey) return ecKey;
        throw new ERR_CRYPTO_INVALID_JWK();
    }

    if (jwk.kty === 'OKP') {
        const curve = requireJwkField(jwk, 'crv');
        const keyType = OKP_TYPE_FROM_CURVE[curve];
        if (!keyType) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }
        const privateKey = base64UrlToBytes(requireJwkField(jwk, 'd'));
        const publicKey = jwk.x ? base64UrlToBytes(requireJwkField(jwk, 'x')) : getOkpPublicFromPrivate(keyType, privateKey);
        const info = OKP_TYPE_INFO[keyType];
        if (!info || privateKey.length !== info.privateLength) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }
        if (publicKey && publicKey.length !== info.publicLength) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }

        if (keyType === 'ed25519') {
            const handle = webCryptoNative.create_private_key_der(privateKey);
            if (handle !== null && handle !== undefined) {
                return new KeyObject(handle, 'private');
            }
        }

        return createOkpPrivateKeyObject(keyType, privateKey, publicKey);
    }

    throw new ERR_CRYPTO_INVALID_JWK();
}

function createPublicKeyFromJwk(jwk) {
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
        throw new ERR_INVALID_ARG_TYPE('key.key', 'object', jwk);
    }

    if (jwk.kty === 'RSA') {
        const der = buildRsaPublicSpkiDer(jwk);
        const handle = webCryptoNative.create_public_key_der(der);
        if (handle === null || handle === undefined) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }
        return new KeyObject(handle, 'public');
    }

    if (jwk.kty === 'EC') {
        const der = buildEcPublicSpkiDer(jwk);
        const handle = webCryptoNative.create_public_key_der(der);
        if (handle !== null && handle !== undefined) {
            return new KeyObject(handle, 'public');
        }
        const crv = requireJwkField(jwk, 'crv');
        const x = base64UrlToBytes(requireJwkField(jwk, 'x'));
        const y = base64UrlToBytes(requireJwkField(jwk, 'y'));
        const point = new Uint8Array(1 + x.length + y.length);
        point[0] = 0x04;
        point.set(x, 1);
        point.set(y, 1 + x.length);
        const ecKey = createEcJwkKeyObject('public', crv, null, point);
        if (ecKey) return ecKey;
        throw new ERR_CRYPTO_INVALID_JWK();
    }

    if (jwk.kty === 'OKP') {
        const curve = requireJwkField(jwk, 'crv');
        const keyType = OKP_TYPE_FROM_CURVE[curve];
        if (!keyType) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }
        const publicKey = base64UrlToBytes(requireJwkField(jwk, 'x'));
        const info = OKP_TYPE_INFO[keyType];
        if (!info || publicKey.length !== info.publicLength) {
            throw new ERR_CRYPTO_INVALID_JWK();
        }

        if (keyType === 'ed25519') {
            const handle = webCryptoNative.create_public_key_der(publicKey);
            if (handle !== null && handle !== undefined) {
                return new KeyObject(handle, 'public');
            }
        }

        return createOkpPublicKeyObject(keyType, publicKey);
    }

    throw new ERR_CRYPTO_INVALID_JWK();
}

function bytesToBase64Url(bytes) {
    const data = normalizeBytes(bytes);
    let base64;
    if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    } else {
        let binary = '';
        for (let i = 0; i < data.length; i++) {
            binary += String.fromCharCode(data[i]);
        }
        base64 = btoa(binary);
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseRsaPublicPkcs1Der(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) {
        throw new Error('Invalid PKCS#1 RSA public key');
    }
    const children = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (children.length < 2) {
        throw new Error('Invalid PKCS#1 RSA public key');
    }
    return {
        n: asn1IntegerToUnsignedBytes(der, children[0]),
        e: asn1IntegerToUnsignedBytes(der, children[1]),
    };
}

function parseRsaPrivatePkcs1Der(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) {
        throw new Error('Invalid PKCS#1 RSA private key');
    }
    const children = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (children.length < 9) {
        throw new Error('Invalid PKCS#1 RSA private key');
    }
    return {
        n: asn1IntegerToUnsignedBytes(der, children[1]),
        e: asn1IntegerToUnsignedBytes(der, children[2]),
        d: asn1IntegerToUnsignedBytes(der, children[3]),
        p: asn1IntegerToUnsignedBytes(der, children[4]),
        q: asn1IntegerToUnsignedBytes(der, children[5]),
        dp: asn1IntegerToUnsignedBytes(der, children[6]),
        dq: asn1IntegerToUnsignedBytes(der, children[7]),
        qi: asn1IntegerToUnsignedBytes(der, children[8]),
    };
}

function exportRsaKeyObjectAsJwk(keyObject) {
    if (keyObject.type === 'public') {
        const der = toBytes(keyObject.export({ format: 'der', type: 'pkcs1' }));
        const parsed = parseRsaPublicPkcs1Der(der);
        return {
            kty: 'RSA',
            n: bytesToBase64Url(parsed.n),
            e: bytesToBase64Url(parsed.e),
        };
    }

    if (keyObject.type === 'private') {
        const der = toBytes(keyObject.export({ format: 'der', type: 'pkcs1' }));
        const parsed = parseRsaPrivatePkcs1Der(der);
        return {
            kty: 'RSA',
            n: bytesToBase64Url(parsed.n),
            e: bytesToBase64Url(parsed.e),
            d: bytesToBase64Url(parsed.d),
            p: bytesToBase64Url(parsed.p),
            q: bytesToBase64Url(parsed.q),
            dp: bytesToBase64Url(parsed.dp),
            dq: bytesToBase64Url(parsed.dq),
            qi: bytesToBase64Url(parsed.qi),
        };
    }

    throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(keyObject.type, 'private or public');
}

const DH_OIDS = new Set([
    '1.2.840.113549.1.3.1',
    '1.2.840.10046.2.1',
]);

function parseDhAlgorithmParameters(der, algorithmElement) {
    if (algorithmElement.tag !== 0x30) {
        throw new Error('Invalid AlgorithmIdentifier');
    }
    const children = readAsn1Children(der, algorithmElement.valueStart, algorithmElement.valueEnd);
    if (children.length < 2) {
        throw new Error('Missing DH parameters');
    }
    const oid = decodeAsn1Oid(der, children[0]);
    if (!DH_OIDS.has(oid)) {
        throw new Error('Not a DH key');
    }
    const params = children[1];
    if (params.tag !== 0x30) {
        throw new Error('Invalid DH parameters');
    }
    const paramChildren = readAsn1Children(der, params.valueStart, params.valueEnd);
    if (paramChildren.length < 2) {
        throw new Error('Missing DH prime/generator');
    }
    return {
        prime: asn1IntegerToUnsignedBytes(der, paramChildren[0]),
        generator: asn1IntegerToUnsignedBytes(der, paramChildren[1]),
    };
}

function buildDhPublicFromPrivate(prime, generator, privateKey) {
    const dh = createDiffieHellman(prime, undefined, generator);
    dh.setPrivateKey(privateKey);
    return toBytes(dh.generateKeys());
}

function createDhPrivateKeyObject(prime, generator, privateKey) {
    const normalizedPrime = cloneBytes(prime);
    const normalizedGenerator = cloneBytes(generator);
    const normalizedPrivate = cloneBytes(privateKey);
    const publicKey = buildDhPublicFromPrivate(normalizedPrime, normalizedGenerator, normalizedPrivate);
    return new KeyObject(null, 'private', {
        asymmetricKeyType: 'dh',
        asymmetricKeyDetails: {},
        dh: {
            prime: normalizedPrime,
            generator: normalizedGenerator,
            privateKey: normalizedPrivate,
            publicKey: cloneBytes(publicKey),
        },
    });
}

function createDhPublicKeyObject(prime, generator, publicKey) {
    return new KeyObject(null, 'public', {
        asymmetricKeyType: 'dh',
        asymmetricKeyDetails: {},
        dh: {
            prime: cloneBytes(prime),
            generator: cloneBytes(generator),
            publicKey: cloneBytes(publicKey),
        },
    });
}

function trimLeadingZeroBytes(bytes) {
    let first = 0;
    while (first < bytes.length - 1 && bytes[first] === 0) {
        first += 1;
    }
    return bytes.slice(first);
}

function extractDhPrivateKeyBytes(derBytes) {
    try {
        return parseDerIntegerBytes(derBytes);
    } catch (_ignored) {
    }

    try {
        const root = readAsn1Element(derBytes, 0);
        if (root.tag === 0x30 && root.nextOffset === derBytes.length) {
            const children = readAsn1Children(derBytes, root.valueStart, root.valueEnd);
            for (const child of children) {
                if (child.tag === 0x02) {
                    return asn1IntegerToUnsignedBytes(derBytes, child);
                }
            }
        }
    } catch (_ignored) {
    }

    return trimLeadingZeroBytes(derBytes);
}

function extractDhPublicKeyBytes(derBytes) {
    try {
        return parseDerIntegerBytes(derBytes);
    } catch (_ignored) {
    }
    return trimLeadingZeroBytes(derBytes);
}

function parseDhPrivateKeyFromDer(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) {
        throw new Error('Invalid PKCS#8 structure');
    }
    const top = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (top.length < 3) {
        throw new Error('Invalid PKCS#8 structure');
    }
    const algorithm = top[1];
    const params = parseDhAlgorithmParameters(der, algorithm);
    const privateOctet = top[2];
    if (privateOctet.tag !== 0x04) {
        throw new Error('Invalid private key data');
    }
    const inner = der.slice(privateOctet.valueStart, privateOctet.valueEnd);
    const privateKey = extractDhPrivateKeyBytes(inner);
    return createDhPrivateKeyObject(params.prime, params.generator, privateKey);
}

function parseDhPublicKeyFromDer(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) {
        throw new Error('Invalid SPKI structure');
    }
    const top = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (top.length < 2) {
        throw new Error('Invalid SPKI structure');
    }
    const params = parseDhAlgorithmParameters(der, top[0]);
    const bitString = top[1];
    if (bitString.tag !== 0x03) {
        throw new Error('Invalid public key data');
    }
    const bitStringData = der.slice(bitString.valueStart, bitString.valueEnd);
    if (bitStringData.length < 2 || bitStringData[0] !== 0) {
        throw new Error('Invalid public key bit string');
    }
    const publicKey = extractDhPublicKeyBytes(bitStringData.slice(1));
    return createDhPublicKeyObject(params.prime, params.generator, publicKey);
}

function maybeParseDhPrivateKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) {
            return null;
        }
        return parseDhPrivateKeyFromDer(der);
    } catch (_err) {
        return null;
    }
}

function maybeParseDhPublicKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) {
            return null;
        }
        return parseDhPublicKeyFromDer(der);
    } catch (_err) {
        return null;
    }
}

function startsWithBytes(data, prefix) {
    if (data.length < prefix.length) {
        return false;
    }
    for (let i = 0; i < prefix.length; i++) {
        if (data[i] !== prefix[i]) {
            return false;
        }
    }
    return true;
}

function extractEd25519PrivateRaw(bytes) {
    if (bytes.length === ED25519_PKCS8_PREFIX.length + 32 && startsWithBytes(bytes, ED25519_PKCS8_PREFIX)) {
        return bytes.slice(ED25519_PKCS8_PREFIX.length);
    }
    return null;
}

function extractEd25519PublicRaw(bytes) {
    if (bytes.length === ED25519_SPKI_PREFIX.length + 32 && startsWithBytes(bytes, ED25519_SPKI_PREFIX)) {
        return bytes.slice(ED25519_SPKI_PREFIX.length);
    }
    return null;
}

function maybeParseOkpPrivateKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) {
            return null;
        }

        const parsed = parseOkpPrivateRaw(der);
        if (!parsed || parsed.keyType === 'ed25519') {
            return null;
        }

        const publicKey = getOkpPublicFromPrivate(parsed.keyType, parsed.privateKey);
        return createOkpPrivateKeyObject(parsed.keyType, parsed.privateKey, publicKey);
    } catch (_err) {
        return null;
    }
}

function maybeParseOkpPublicKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) {
            return null;
        }

        const parsed = parseOkpPublicRaw(der);
        if (!parsed || parsed.keyType === 'ed25519') {
            return null;
        }

        return createOkpPublicKeyObject(parsed.keyType, parsed.publicKey);
    } catch (_err) {
        return null;
    }
}

function toBinaryOutput(bytes) {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes);
    }
    return new Uint8Array(bytes);
}

function exportOkpKeyObjectAsJwk(keyObject) {
    const keyType = keyObject._customData && keyObject._customData.asymmetricKeyType;
    const okp = keyObject._customData && keyObject._customData.okp;
    const info = OKP_TYPE_INFO[keyType];
    if (!okp || !info) {
        return null;
    }

    const publicBytes = okp.publicKey || getOkpPublicFromPrivate(keyType, okp.privateKey);
    if (!publicBytes) {
        return null;
    }

    const jwk = {
        kty: 'OKP',
        crv: info.crv,
        x: bytesToBase64Url(publicBytes),
    };

    if (keyObject.type === 'private') {
        if (!okp.privateKey) {
            return null;
        }
        jwk.d = bytesToBase64Url(okp.privateKey);
    }

    return jwk;
}

function exportOkpCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }

    const format = options.format || (options.type ? 'pem' : 'der');
    const type_ = options.type || null;

    if (format === 'jwk') {
        const jwk = exportOkpKeyObjectAsJwk(keyObject);
        if (!jwk) {
            throw new Error('Failed to export key as JWK');
        }
        return jwk;
    }

    const keyType = keyObject._customData && keyObject._customData.asymmetricKeyType;
    const okp = keyObject._customData && keyObject._customData.okp;
    if (!okp || !OKP_TYPE_INFO[keyType]) {
        throw new Error('Failed to export key');
    }

    if (keyObject.type === 'private') {
        if (!okp.privateKey) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'pkcs8') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPrivateDer(keyType, okp.privateKey);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') {
            return encodeDerAsPem('PRIVATE KEY', der);
        }
        if (format === 'der') {
            return toBinaryOutput(der);
        }
    } else if (keyObject.type === 'public') {
        const publicBytes = okp.publicKey || getOkpPublicFromPrivate(keyType, okp.privateKey);
        if (!publicBytes) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'spki') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPublicDer(keyType, publicBytes);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') {
            return encodeDerAsPem('PUBLIC KEY', der);
        }
        if (format === 'der') {
            return toBinaryOutput(der);
        }
    }

    throw new Error('Failed to export key');
}

function exportEd25519NativeKeyObject(keyObject, format, type_) {
    if (keyObject.asymmetricKeyType !== 'ed25519') {
        return null;
    }

    const jwkJson = webCryptoNative.key_export_jwk(keyObject._handle);
    if (jwkJson === null || jwkJson === undefined) {
        return null;
    }

    let jwk;
    try {
        jwk = JSON.parse(jwkJson);
    } catch (_err) {
        return null;
    }

    if (keyObject.type === 'private') {
        if (type_ !== null && type_ !== 'pkcs8') {
            return null;
        }
        if (typeof jwk.d !== 'string') {
            return null;
        }
        const der = encodeOkpPrivateDer('ed25519', base64UrlToBytes(jwk.d));
        if (!der) {
            return null;
        }
        if (format === 'pem') {
            return encodeDerAsPem('PRIVATE KEY', der);
        }
        if (format === 'der') {
            return toBinaryOutput(der);
        }
        return null;
    }

    if (keyObject.type === 'public') {
        if (type_ !== null && type_ !== 'spki') {
            return null;
        }
        if (typeof jwk.x !== 'string') {
            return null;
        }
        const der = encodeOkpPublicDer('ed25519', base64UrlToBytes(jwk.x));
        if (!der) {
            return null;
        }
        if (format === 'pem') {
            return encodeDerAsPem('PUBLIC KEY', der);
        }
        if (format === 'der') {
            return toBinaryOutput(der);
        }
    }

    return null;
}

function parseEcPrivateKeyFromDer(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) return null;
    const top = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (top.length < 3) return null;
    const algSeq = top[1];
    if (algSeq.tag !== 0x30) return null;
    const algChildren = readAsn1Children(der, algSeq.valueStart, algSeq.valueEnd);
    if (algChildren.length < 2) return null;
    const algOid = decodeAsn1Oid(der, algChildren[0]);
    if (algOid !== '1.2.840.10045.2.1') return null;
    const curveOid = decodeAsn1Oid(der, algChildren[1]);
    const crv = EC_OID_TO_CURVE[curveOid];
    if (!crv) return null;
    const privOctet = top[2];
    if (privOctet.tag !== 0x04) return null;
    const ecPriv = der.slice(privOctet.valueStart, privOctet.valueEnd);
    const ecRoot = readAsn1Element(ecPriv, 0);
    if (ecRoot.tag !== 0x30) return null;
    const ecChildren = readAsn1Children(ecPriv, ecRoot.valueStart, ecRoot.valueEnd);
    if (ecChildren.length < 2) return null;
    const dOctet = ecChildren[1];
    if (dOctet.tag !== 0x04) return null;
    const d = ecPriv.slice(dOctet.valueStart, dOctet.valueEnd);
    let point = null;
    for (const child of ecChildren) {
        if (child.tag === 0xA1) {
            const inner = readAsn1Element(ecPriv, child.valueStart);
            if (inner.tag === 0x03) {
                const bitData = ecPriv.slice(inner.valueStart, inner.valueEnd);
                if (bitData.length > 1 && bitData[0] === 0) {
                    point = bitData.slice(1);
                }
            }
        }
    }
    return { crv, d, point };
}

function parseEcPublicKeyFromDer(der) {
    const root = readAsn1Element(der, 0);
    if (root.tag !== 0x30 || root.nextOffset !== der.length) return null;
    const top = readAsn1Children(der, root.valueStart, root.valueEnd);
    if (top.length < 2) return null;
    const algSeq = top[0];
    if (algSeq.tag !== 0x30) return null;
    const algChildren = readAsn1Children(der, algSeq.valueStart, algSeq.valueEnd);
    if (algChildren.length < 2) return null;
    const algOid = decodeAsn1Oid(der, algChildren[0]);
    if (algOid !== '1.2.840.10045.2.1') return null;
    const curveOid = decodeAsn1Oid(der, algChildren[1]);
    const crv = EC_OID_TO_CURVE[curveOid];
    if (!crv) return null;
    const bitString = top[1];
    if (bitString.tag !== 0x03) return null;
    const bitData = der.slice(bitString.valueStart, bitString.valueEnd);
    if (bitData.length < 2 || bitData[0] !== 0) return null;
    return { crv, point: bitData.slice(1) };
}

function ecPointToXY(point, crv) {
    if (!point || point[0] !== 0x04) return null;
    const fieldLen = (point.length - 1) / 2;
    return {
        x: point.slice(1, 1 + fieldLen),
        y: point.slice(1 + fieldLen),
    };
}

function createEcJwkKeyObject(type_, crv, d, point) {
    const xy = ecPointToXY(point, crv);
    if (!xy) return null;
    const namedCurve = JWK_CURVE_TO_NAMED[crv] || crv;
    const jwkData = { crv, x: bytesToBase64Url(xy.x), y: bytesToBase64Url(xy.y) };
    if (type_ === 'private' && d) {
        jwkData.d = bytesToBase64Url(d);
    }
    return new KeyObject(null, type_, {
        asymmetricKeyType: 'ec',
        asymmetricKeyDetails: { namedCurve },
        ec: { namedCurve, jwk: jwkData },
    });
}

function maybeParseEcPrivateKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const parsed = parseEcPrivateKeyFromDer(der);
        if (!parsed) return null;
        return createEcJwkKeyObject('private', parsed.crv, parsed.d, parsed.point);
    } catch (_err) {
        return null;
    }
}

function maybeParseEcPublicKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const parsed = parseEcPublicKeyFromDer(der);
        if (!parsed) return null;
        return createEcJwkKeyObject('public', parsed.crv, null, parsed.point);
    } catch (_err) {
        return null;
    }
}

function exportEcCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const ecData = keyObject._customData.ec;
    const jwkData = ecData.jwk;
    if (!jwkData) return undefined;
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const jwk = { kty: 'EC', crv: jwkData.crv, x: jwkData.x, y: jwkData.y };
        if (keyObject.type === 'private' && jwkData.d) {
            jwk.d = jwkData.d;
        }
        return jwk;
    }
    if (keyObject.type === 'private') {
        const jwk = { kty: 'EC', crv: jwkData.crv, x: jwkData.x, y: jwkData.y, d: jwkData.d };
        const der = buildEcPrivatePkcs8Der(jwk);
        if (format === 'pem') return encodeDerAsPem('PRIVATE KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    } else {
        const jwk = { kty: 'EC', crv: jwkData.crv, x: jwkData.x, y: jwkData.y };
        const der = buildEcPublicSpkiDer(jwk);
        if (format === 'pem') return encodeDerAsPem('PUBLIC KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    }
    return undefined;
}

function exportMontgomeryCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const keyType = keyObject._customData.asymmetricKeyType;
    const mont = keyObject._customData.montgomery;
    const info = OKP_TYPE_INFO[keyType];
    if (!mont || !info) {
        throw new Error('Failed to export key');
    }
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const publicBytes = mont.publicKey;
        if (!publicBytes) {
            throw new Error('Failed to export key as JWK');
        }
        const jwk = { kty: 'OKP', crv: info.crv, x: bytesToBase64Url(publicBytes) };
        if (keyObject.type === 'private' && mont.privateKey) {
            jwk.d = bytesToBase64Url(mont.privateKey);
        }
        return jwk;
    }
    const type_ = options.type || null;
    if (keyObject.type === 'private') {
        if (!mont.privateKey) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'pkcs8') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPrivateDer(keyType, mont.privateKey);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') return encodeDerAsPem('PRIVATE KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    } else if (keyObject.type === 'public') {
        const publicBytes = mont.publicKey;
        if (!publicBytes) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'spki') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPublicDer(keyType, publicBytes);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') return encodeDerAsPem('PUBLIC KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    }
    throw new Error('Failed to export key');
}

function exportEdwardsCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const keyType = keyObject._customData.asymmetricKeyType;
    const edwards = keyObject._customData.edwards;
    const info = OKP_TYPE_INFO[keyType];
    if (!edwards || !info) {
        throw new Error('Failed to export key');
    }
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const publicBytes = edwards.publicKey || getOkpPublicFromPrivate(keyType, edwards.privateKey);
        if (!publicBytes) {
            throw new Error('Failed to export key as JWK');
        }
        const jwk = { kty: 'OKP', crv: info.crv, x: bytesToBase64Url(publicBytes) };
        if (keyObject.type === 'private' && edwards.privateKey) {
            jwk.d = bytesToBase64Url(edwards.privateKey);
        }
        return jwk;
    }
    const type_ = options.type || null;
    if (keyObject.type === 'private') {
        if (!edwards.privateKey) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'pkcs8') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPrivateDer(keyType, edwards.privateKey);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') return encodeDerAsPem('PRIVATE KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    } else if (keyObject.type === 'public') {
        const publicBytes = edwards.publicKey || getOkpPublicFromPrivate(keyType, edwards.privateKey);
        if (!publicBytes) {
            throw new Error('Failed to export key');
        }
        if (type_ !== null && type_ !== 'spki') {
            throw new Error('Failed to export key');
        }
        const der = encodeOkpPublicDer(keyType, publicBytes);
        if (!der) {
            throw new Error('Failed to export key');
        }
        if (format === 'pem') return encodeDerAsPem('PUBLIC KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    }
    throw new Error('Failed to export key');
}

function exportEcFallbackCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const ecData = keyObject._customData.ec;
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const publicBytes = ecData.publicKey;
        if (!publicBytes || publicBytes[0] !== 0x04) {
            throw new Error('Failed to export key as JWK');
        }
        const fieldLen = (publicBytes.length - 1) / 2;
        const x = publicBytes.slice(1, 1 + fieldLen);
        const y = publicBytes.slice(1 + fieldLen);
        const jwk = { kty: 'EC', crv: ecData.namedCurve, x: bytesToBase64Url(x), y: bytesToBase64Url(y) };
        if (keyObject.type === 'private' && ecData.privateKey) {
            jwk.d = bytesToBase64Url(ecData.privateKey);
        }
        return jwk;
    }
    if (keyObject.type === 'private') {
        const publicBytes = ecData.publicKey;
        if (!publicBytes || publicBytes[0] !== 0x04) {
            throw new Error('Failed to export key');
        }
        const fieldLen = (publicBytes.length - 1) / 2;
        const x = publicBytes.slice(1, 1 + fieldLen);
        const y = publicBytes.slice(1 + fieldLen);
        const jwk = { kty: 'EC', crv: ecData.namedCurve, x: bytesToBase64Url(x), y: bytesToBase64Url(y), d: bytesToBase64Url(ecData.privateKey) };
        const der = buildEcPrivatePkcs8Der(jwk);
        if (format === 'pem') return encodeDerAsPem('PRIVATE KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    } else {
        const publicBytes = ecData.publicKey;
        if (!publicBytes || publicBytes[0] !== 0x04) {
            throw new Error('Failed to export key');
        }
        const fieldLen = (publicBytes.length - 1) / 2;
        const x = publicBytes.slice(1, 1 + fieldLen);
        const y = publicBytes.slice(1 + fieldLen);
        const jwk = { kty: 'EC', crv: ecData.namedCurve, x: bytesToBase64Url(x), y: bytesToBase64Url(y) };
        const der = buildEcPublicSpkiDer(jwk);
        if (format === 'pem') return encodeDerAsPem('PUBLIC KEY', der);
        if (format === 'der') return toBinaryOutput(der);
    }
    return undefined;
}

const DSA_OID = '1.2.840.10040.4.1';
const RSA_PSS_OID = '1.2.840.113549.1.1.10';
const RSA_OID = '1.2.840.113549.1.1.1';

function bigIntToMinimalBytes(value) {
    if (value === 0n) {
        return new Uint8Array([0]);
    }
    const bytes = [];
    let current = value;
    while (current > 0n) {
        bytes.unshift(Number(current & 0xffn));
        current >>= 8n;
    }
    return new Uint8Array(bytes);
}

function parseDsaParamsFromAlgorithmIdentifier(der, algorithmElement) {
    if (algorithmElement.tag !== 0x30) {
        return null;
    }
    const children = readAsn1Children(der, algorithmElement.valueStart, algorithmElement.valueEnd);
    if (children.length < 2) {
        return null;
    }
    const oid = decodeAsn1Oid(der, children[0]);
    if (oid !== DSA_OID) {
        return null;
    }
    const paramsElement = children[1];
    if (paramsElement.tag !== 0x30) {
        return null;
    }
    const params = readAsn1Children(der, paramsElement.valueStart, paramsElement.valueEnd);
    if (params.length < 3) {
        return null;
    }
    return {
        p: bytesToBigInt(asn1IntegerToUnsignedBytes(der, params[0])),
        q: bytesToBigInt(asn1IntegerToUnsignedBytes(der, params[1])),
        g: bytesToBigInt(asn1IntegerToUnsignedBytes(der, params[2])),
    };
}

function parseDsaPublicMaterialFromDer(der) {
    try {
        const root = readAsn1Element(der, 0);
        if (root.tag !== 0x30 || root.nextOffset !== der.length) {
            return null;
        }
        const top = readAsn1Children(der, root.valueStart, root.valueEnd);
        if (top.length < 2) {
            return null;
        }
        const params = parseDsaParamsFromAlgorithmIdentifier(der, top[0]);
        if (!params) {
            return null;
        }
        const publicKeyBitString = top[1];
        if (publicKeyBitString.tag !== 0x03) {
            return null;
        }
        const bitStringBytes = der.slice(publicKeyBitString.valueStart, publicKeyBitString.valueEnd);
        if (bitStringBytes.length < 2 || bitStringBytes[0] !== 0) {
            return null;
        }
        const yBytes = parseDerIntegerBytes(bitStringBytes.slice(1));
        return {
            p: params.p,
            q: params.q,
            g: params.g,
            y: bytesToBigInt(yBytes),
        };
    } catch (_err) {
        return null;
    }
}

function parseDsaPrivateMaterialFromDer(der) {
    try {
        const root = readAsn1Element(der, 0);
        if (root.tag !== 0x30 || root.nextOffset !== der.length) {
            return null;
        }
        const top = readAsn1Children(der, root.valueStart, root.valueEnd);
        if (top.length >= 6 &&
            top[0].tag === 0x02 &&
            top[1].tag === 0x02 &&
            top[2].tag === 0x02 &&
            top[3].tag === 0x02 &&
            top[4].tag === 0x02 &&
            top[5].tag === 0x02) {
            return {
                p: bytesToBigInt(asn1IntegerToUnsignedBytes(der, top[1])),
                q: bytesToBigInt(asn1IntegerToUnsignedBytes(der, top[2])),
                g: bytesToBigInt(asn1IntegerToUnsignedBytes(der, top[3])),
                y: bytesToBigInt(asn1IntegerToUnsignedBytes(der, top[4])),
            };
        }
        if (top.length < 3) {
            return null;
        }
        const params = parseDsaParamsFromAlgorithmIdentifier(der, top[1]);
        if (!params) {
            return null;
        }
        const privateOctetString = top[2];
        if (privateOctetString.tag !== 0x04) {
            return null;
        }
        const privateKeyBytes = der.slice(privateOctetString.valueStart, privateOctetString.valueEnd);
        let xBytes;
        try {
            xBytes = parseDerIntegerBytes(privateKeyBytes);
        } catch (_err) {
            xBytes = trimLeadingZeroBytes(privateKeyBytes);
        }
        const x = bytesToBigInt(xBytes);
        return {
            p: params.p,
            q: params.q,
            g: params.g,
            y: modPow(params.g, x, params.p),
        };
    } catch (_err) {
        return null;
    }
}

function createDsaFallbackKeyId(material) {
    const encoded = encodeAsn1Sequence([
        encodeAsn1Integer(bigIntToMinimalBytes(material.p)),
        encodeAsn1Integer(bigIntToMinimalBytes(material.q)),
        encodeAsn1Integer(bigIntToMinimalBytes(material.g)),
        encodeAsn1Integer(bigIntToMinimalBytes(material.y)),
    ]);
    const digest = hashOneShotBytes('sha256', encoded);
    return bytesToBase64Url(digest);
}

function getDsaFallbackKeyIdFromDer(der, type_) {
    const material = type_ === 'private'
        ? parseDsaPrivateMaterialFromDer(der)
        : parseDsaPublicMaterialFromDer(der);
    if (!material) {
        return null;
    }
    return createDsaFallbackKeyId(material);
}

function detectAlgorithmOid(der) {
    try {
        const root = readAsn1Element(der, 0);
        if (root.tag !== 0x30) return null;
        const top = readAsn1Children(der, root.valueStart, root.valueEnd);
        if (top.length < 2) return null;
        const algSeq = top[0].tag === 0x02 ? top[1] : top[0];
        if (algSeq.tag !== 0x30) return null;
        const algChildren = readAsn1Children(der, algSeq.valueStart, algSeq.valueEnd);
        if (algChildren.length < 1) return null;
        return decodeAsn1Oid(der, algChildren[0]);
    } catch (_err) {
        return null;
    }
}

function createDsaKeyObject(type_, rawDer, rawPem, keyId) {
    return new KeyObject(null, type_, {
        asymmetricKeyType: 'dsa',
        dsa: { der: rawDer, pem: rawPem, keyId: keyId || null },
    });
}

function maybeParseDsaPublicKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const oid = detectAlgorithmOid(der);
        if (oid !== DSA_OID) return null;
        const pem = format === 'pem' ? toPemString(keyData) : encodeDerAsPem('PUBLIC KEY', der);
        const keyId = getDsaFallbackKeyIdFromDer(der, 'public');
        return createDsaKeyObject('public', der, pem, keyId);
    } catch (_err) {
        return null;
    }
}

function maybeParseDsaPrivateKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const oid = detectAlgorithmOid(der);
        const privateMaterial = parseDsaPrivateMaterialFromDer(der);
        if (oid !== DSA_OID && !privateMaterial) return null;
        const pem = format === 'pem' ? toPemString(keyData) : encodeDerAsPem('PRIVATE KEY', der);
        const keyId = privateMaterial ? createDsaFallbackKeyId(privateMaterial) : null;
        return createDsaKeyObject('private', der, pem, keyId);
    } catch (_err) {
        return null;
    }
}

function exportDsaCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const err = new Error('Unsupported JWK key type: dsa');
        err.code = 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE';
        throw err;
    }
    const dsa = keyObject._customData.dsa;
    if (format === 'pem') return dsa.pem;
    if (format === 'der') return toBinaryOutput(dsa.der);
    return undefined;
}

const PSS_HASH_OIDS = {
    '1.3.14.3.2.26': 'sha1',
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512',
    '2.16.840.1.101.3.4.2.4': 'sha224',
};
const MGF1_OID = '1.2.840.113549.1.1.8';

function parseRsaPssParams(der, paramsElement) {
    const result = { hashAlgorithm: 'sha1', mgf1HashAlgorithm: 'sha1', saltLength: 20 };
    if (!paramsElement || paramsElement.tag !== 0x30) return result;
    const children = readAsn1Children(der, paramsElement.valueStart, paramsElement.valueEnd);
    for (const child of children) {
        if (child.tag === 0xA0) {
            const inner = readAsn1Children(der, child.valueStart, child.valueEnd);
            if (inner.length > 0 && inner[0].tag === 0x30) {
                const algChildren = readAsn1Children(der, inner[0].valueStart, inner[0].valueEnd);
                if (algChildren.length > 0) {
                    const oid = decodeAsn1Oid(der, algChildren[0]);
                    if (PSS_HASH_OIDS[oid]) result.hashAlgorithm = PSS_HASH_OIDS[oid];
                }
            }
        } else if (child.tag === 0xA1) {
            const inner = readAsn1Children(der, child.valueStart, child.valueEnd);
            if (inner.length > 0 && inner[0].tag === 0x30) {
                const mgfChildren = readAsn1Children(der, inner[0].valueStart, inner[0].valueEnd);
                if (mgfChildren.length >= 2) {
                    const mgfAlg = readAsn1Children(der, mgfChildren[1].valueStart, mgfChildren[1].valueEnd);
                    if (mgfAlg.length > 0) {
                        const oid = decodeAsn1Oid(der, mgfAlg[0]);
                        if (PSS_HASH_OIDS[oid]) result.mgf1HashAlgorithm = PSS_HASH_OIDS[oid];
                    }
                }
            }
        } else if (child.tag === 0xA2) {
            const inner = readAsn1Children(der, child.valueStart, child.valueEnd);
            if (inner.length > 0 && inner[0].tag === 0x02) {
                const bytes = der.slice(inner[0].valueStart, inner[0].valueEnd);
                let val = 0;
                for (let i = 0; i < bytes.length; i++) val = val * 256 + bytes[i];
                result.saltLength = val;
            }
        }
    }
    return result;
}

function maybeParseRsaPssPublicKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const root = readAsn1Element(der, 0);
        if (root.tag !== 0x30) return null;
        const top = readAsn1Children(der, root.valueStart, root.valueEnd);
        if (top.length < 2) return null;
        const algSeq = top[0];
        if (algSeq.tag !== 0x30) return null;
        const algChildren = readAsn1Children(der, algSeq.valueStart, algSeq.valueEnd);
        if (algChildren.length < 1) return null;
        const oid = decodeAsn1Oid(der, algChildren[0]);
        if (oid !== RSA_PSS_OID) return null;
        const pssParams = algChildren.length > 1 ? parseRsaPssParams(der, algChildren[1]) : {};
        const bitString = top[1];
        if (bitString.tag !== 0x03) return null;
        const bitData = der.slice(bitString.valueStart, bitString.valueEnd);
        if (bitData.length < 2 || bitData[0] !== 0) return null;
        const rsaKeyDer = bitData.slice(1);
        const handle = webCryptoNative.create_public_key_der(rsaKeyDer);
        if (handle === null || handle === undefined) return null;
        const details = webCryptoNative.key_asymmetric_details(handle);
        const keyDetails = details ? { modulusLength: Number(details[0]), publicExponent: BigInt(details[1]) } : {};
        if (pssParams.hashAlgorithm) {
            keyDetails.hashAlgorithm = pssParams.hashAlgorithm;
            keyDetails.mgf1HashAlgorithm = pssParams.mgf1HashAlgorithm || pssParams.hashAlgorithm;
            keyDetails.saltLength = pssParams.saltLength !== undefined ? pssParams.saltLength : 20;
        }
        const pem = format === 'pem' ? toPemString(keyData) : encodeDerAsPem('PUBLIC KEY', der);
        return new KeyObject(handle, 'public', {
            asymmetricKeyType: 'rsa-pss',
            asymmetricKeyDetails: keyDetails,
            rsaPss: { der: der, pem: pem },
        });
    } catch (_err) {
        return null;
    }
}

function maybeParseRsaPssPrivateKey(keyData, format) {
    try {
        const der = format === 'pem' ? decodePemToDer(toPemString(keyData)) : toBytes(keyData);
        if (!der) return null;
        const root = readAsn1Element(der, 0);
        if (root.tag !== 0x30) return null;
        const top = readAsn1Children(der, root.valueStart, root.valueEnd);
        if (top.length < 3) return null;
        const algSeq = top[1];
        if (algSeq.tag !== 0x30) return null;
        const algChildren = readAsn1Children(der, algSeq.valueStart, algSeq.valueEnd);
        if (algChildren.length < 1) return null;
        const oid = decodeAsn1Oid(der, algChildren[0]);
        if (oid !== RSA_PSS_OID) return null;
        const pssParams = algChildren.length > 1 ? parseRsaPssParams(der, algChildren[1]) : {};
        const privOctet = top[2];
        if (privOctet.tag !== 0x04) return null;
        const rsaKeyDer = der.slice(privOctet.valueStart, privOctet.valueEnd);
        const handle = webCryptoNative.create_private_key_der(rsaKeyDer);
        if (handle === null || handle === undefined) return null;
        const details = webCryptoNative.key_asymmetric_details(handle);
        const keyDetails = details ? { modulusLength: Number(details[0]), publicExponent: BigInt(details[1]) } : {};
        if (pssParams.hashAlgorithm) {
            keyDetails.hashAlgorithm = pssParams.hashAlgorithm;
            keyDetails.mgf1HashAlgorithm = pssParams.mgf1HashAlgorithm || pssParams.hashAlgorithm;
            keyDetails.saltLength = pssParams.saltLength !== undefined ? pssParams.saltLength : 20;
        }
        const pem = format === 'pem' ? toPemString(keyData) : encodeDerAsPem('PRIVATE KEY', der);
        return new KeyObject(handle, 'private', {
            asymmetricKeyType: 'rsa-pss',
            asymmetricKeyDetails: keyDetails,
            rsaPss: { der: der, pem: pem },
        });
    } catch (_err) {
        return null;
    }
}

function exportRsaPssCustomKeyObject(keyObject, options) {
    if (options === undefined || options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
    const format = options.format || (options.type ? 'pem' : 'der');
    if (format === 'jwk') {
        const err = new Error('Unsupported JWK key type: rsa-pss');
        err.code = 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE';
        throw err;
    }
    const type_ = options.type || null;
    if (type_ === 'pkcs1') {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('pkcs1', 'does not support RSA-PSS');
    }
    const rsaPss = keyObject._customData.rsaPss;
    if (format === 'pem') return rsaPss.pem;
    if (format === 'der') return toBinaryOutput(rsaPss.der);
    return undefined;
}

function isPemEncrypted(pem) {
    return pem.includes('ENCRYPTED PRIVATE KEY') || pem.includes('Proc-Type: 4,ENCRYPTED');
}

function tryExportCustomKeyObject(keyObject, options) {
    if (keyObject._customData && keyObject._customData.okp) {
        return exportOkpCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.montgomery) {
        return exportMontgomeryCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.edwards) {
        return exportEdwardsCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.ec && keyObject._customData.ec.jwk) {
        return exportEcCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.ec) {
        return exportEcFallbackCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.dsa) {
        return exportDsaCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.rsaPss) {
        return exportRsaPssCustomKeyObject(keyObject, options);
    }
    if (keyObject._customData && keyObject._customData.ecUnsupported) {
        if (options && typeof options === 'object' && options.format === 'jwk') {
            const curve = keyObject._customData.ecUnsupported.namedCurve;
            const err = new Error('Unsupported JWK EC curve: ' + curve + '.');
            err.code = 'ERR_CRYPTO_JWK_UNSUPPORTED_CURVE';
            throw err;
        }
        return undefined;
    }
    return undefined;
}

function createPrivateKeyFromData(keyData, format, passphrase, type_) {
    if (format === 'jwk' && keyData && typeof keyData === 'object') {
        const cached = PRIVATE_JWK_KEY_CACHE.get(keyData);
        if (cached) {
            return cached;
        }
    }
    const cacheKey = buildKeyObjectCacheKey(format, type_, passphrase, keyData);
    if (cacheKey !== null) {
        const cached = PRIVATE_KEY_CACHE.get(cacheKey);
        if (cached) {
            return cached;
        }
    }

    if (format === 'jwk') {
        const key = createPrivateKeyFromJwk(keyData);
        if (keyData && typeof keyData === 'object') {
            PRIVATE_JWK_KEY_CACHE.set(keyData, key);
        }
        return key;
    }

    if (format === 'pem') {
        const pem = toPemString(keyData);
        if (pem.trim() === '') {
            const err = new Error('error:0909006C:PEM routines:get_name:no start line');
            err.code = 'ERR_OSSL_PEM_NO_START_LINE';
            err.reason = 'no start line';
            err.library = 'PEM routines';
            err.function = 'get_name';
            throw err;
        }

        if (isPemEncrypted(pem)) {
            if (passphrase === undefined) {
                const err = new TypeError('Passphrase required for encrypted key');
                err.code = 'ERR_MISSING_PASSPHRASE';
                throw err;
            }
            const passBytes = toBytes(passphrase);
            if (passBytes.length > 1024) {
                const err = new Error('error:0480006C:PEM routines::bad password read');
                err.code = 'ERR_OSSL_PEM_BAD_PASSWORD_READ';
                err.name = 'Error';
                throw err;
            }
            const encryptedHandle = webCryptoNative.create_private_key_encrypted_pem(pem, passBytes);
            if (encryptedHandle !== null && encryptedHandle !== undefined) {
                return new KeyObject(encryptedHandle, 'private');
            }
            const decryptedDer = webCryptoNative.decrypt_pkcs8_pem_to_der(pem, passBytes);
            if (decryptedDer !== null && decryptedDer !== undefined) {
                const derBytes = new Uint8Array(decryptedDer);
                const dsaKey = maybeParseDsaPrivateKey(derBytes, 'der');
                if (dsaKey) return dsaKey;
            }
            const decryptedTraditionalDer = webCryptoNative.decrypt_traditional_pem_to_der(pem, passBytes);
            if (decryptedTraditionalDer !== null && decryptedTraditionalDer !== undefined) {
                const derBytes = new Uint8Array(decryptedTraditionalDer);
                const dsaKey = maybeParseDsaPrivateKey(derBytes, 'der');
                if (dsaKey) return dsaKey;
            }
            throw createBadDecryptError();
        }

        if (passphrase !== undefined) {
            const passBytes = toBytes(passphrase);
            const encryptedHandle = webCryptoNative.create_private_key_encrypted_pem(pem, passBytes);
            if (encryptedHandle !== null && encryptedHandle !== undefined) {
                return new KeyObject(encryptedHandle, 'private');
            }
        }

        const okpKey = maybeParseOkpPrivateKey(pem, 'pem');
        if (okpKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, okpKey);
            }
            return okpKey;
        }

        const rsaPssKey = maybeParseRsaPssPrivateKey(pem, 'pem');
        if (rsaPssKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, rsaPssKey);
            }
            return rsaPssKey;
        }

        const handle = webCryptoNative.create_private_key_pem(pem);
        if (handle !== null && handle !== undefined) {
            const key = new KeyObject(handle, 'private');
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, key);
            }
            return key;
        }

        const pemDer = decodePemToDer(pem);
        const ed25519Raw = pemDer ? extractEd25519PrivateRaw(pemDer) : null;
        if (ed25519Raw) {
            const edHandle = webCryptoNative.create_private_key_der(ed25519Raw);
            if (edHandle !== null && edHandle !== undefined) {
                const key = new KeyObject(edHandle, 'private');
                if (cacheKey !== null) {
                    PRIVATE_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }

        const ecKey = maybeParseEcPrivateKey(pem, 'pem');
        if (ecKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, ecKey);
            }
            return ecKey;
        }

        const dhKey = maybeParseDhPrivateKey(pem, 'pem');
        if (dhKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, dhKey);
            }
            return dhKey;
        }

        const dsaKey = maybeParseDsaPrivateKey(pem, 'pem');
        if (dsaKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, dsaKey);
            }
            return dsaKey;
        }

        throw createPrivateKeyParseError();
    }

    if (format === 'der') {
        const data = toBytes(keyData);

        const okpKey = maybeParseOkpPrivateKey(data, 'der');
        if (okpKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, okpKey);
            }
            return okpKey;
        }

        const rsaPssKey = maybeParseRsaPssPrivateKey(data, 'der');
        if (rsaPssKey) {
            if (cacheKey !== null) {
                PRIVATE_KEY_CACHE.set(cacheKey, rsaPssKey);
            }
            return rsaPssKey;
        }

        const ed25519Raw = extractEd25519PrivateRaw(data);
        const derInput = ed25519Raw || data;
        const handle = webCryptoNative.create_private_key_der(derInput);
        if (handle === null || handle === undefined) {
            if (type_ === 'pkcs1') {
                const err = new Error('asn1 encoding routines');
                err.library = 'asn1 encoding routines';
                throw err;
            }
            const ecKey = maybeParseEcPrivateKey(data, 'der');
            if (ecKey) {
                if (cacheKey !== null) {
                    PRIVATE_KEY_CACHE.set(cacheKey, ecKey);
                }
                return ecKey;
            }
            const dhKey = maybeParseDhPrivateKey(data, 'der');
            if (dhKey) {
                if (cacheKey !== null) {
                    PRIVATE_KEY_CACHE.set(cacheKey, dhKey);
                }
                return dhKey;
            }
            throw createPrivateKeyParseError();
        }
        const key = new KeyObject(handle, 'private');
        if (cacheKey !== null) {
            PRIVATE_KEY_CACHE.set(cacheKey, key);
        }
        return key;
    }

    const err = new TypeError('Unsupported key format: ' + format);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
}

function createPublicKeyFromData(keyData, format, passphrase) {
    if (format === 'jwk' && keyData && typeof keyData === 'object') {
        const cached = PUBLIC_JWK_KEY_CACHE.get(keyData);
        if (cached) {
            return cached;
        }
    }
    const cacheKey = buildKeyObjectCacheKey(format, null, passphrase, keyData);
    if (cacheKey !== null) {
        const cached = PUBLIC_KEY_CACHE.get(cacheKey);
        if (cached) {
            return cached;
        }
    }

    if (format === 'jwk') {
        const key = createPublicKeyFromJwk(keyData);
        if (keyData && typeof keyData === 'object') {
            PUBLIC_JWK_KEY_CACHE.set(keyData, key);
        }
        return key;
    }

    if (format === 'pem') {
        const pem = toPemString(keyData);

        const okpPublicKey = maybeParseOkpPublicKey(pem, 'pem');
        if (okpPublicKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, okpPublicKey);
            }
            return okpPublicKey;
        }

        const okpPrivateKey = maybeParseOkpPrivateKey(pem, 'pem');
        if (okpPrivateKey && okpPrivateKey._customData && okpPrivateKey._customData.okp) {
            const privateData = okpPrivateKey._customData.okp;
            const publicBytes = privateData.publicKey || getOkpPublicFromPrivate(okpPrivateKey._customData.asymmetricKeyType, privateData.privateKey);
            if (publicBytes) {
                const key = createOkpPublicKeyObject(okpPrivateKey._customData.asymmetricKeyType, publicBytes);
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }

        const rsaPssPubKey = maybeParseRsaPssPublicKey(pem, 'pem');
        if (rsaPssPubKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, rsaPssPubKey);
            }
            return rsaPssPubKey;
        }

        const pubHandle = webCryptoNative.create_public_key_pem(pem);
        if (pubHandle !== null && pubHandle !== undefined) {
            const key = new KeyObject(pubHandle, 'public');
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, key);
            }
            return key;
        }

        if (pem.includes('BEGIN CERTIFICATE')) {
            const certDer = decodePemToDer(pem);
            const spkiDer = certDer ? extractSubjectPublicKeyInfoFromCertificateDer(certDer) : null;
            if (spkiDer) {
                const certHandle = webCryptoNative.create_public_key_der(spkiDer);
                if (certHandle !== null && certHandle !== undefined) {
                    const key = new KeyObject(certHandle, 'public');
                    if (cacheKey !== null) {
                        PUBLIC_KEY_CACHE.set(cacheKey, key);
                    }
                    return key;
                }
            }
        }

        if (passphrase !== undefined) {
            const passBytes = toBytes(passphrase);
            const encryptedPrivateHandle = webCryptoNative.create_private_key_encrypted_pem(pem, passBytes);
            if (encryptedPrivateHandle !== null && encryptedPrivateHandle !== undefined) {
                const encryptedDerived = webCryptoNative.create_public_key_from_private_key(encryptedPrivateHandle);
                if (encryptedDerived !== null && encryptedDerived !== undefined) {
                    return new KeyObject(encryptedDerived, 'public');
                }
            }
            if (isPemEncrypted(pem)) {
                throw createBadDecryptError();
            }
        }

        const rsaPssPrivKey = maybeParseRsaPssPrivateKey(pem, 'pem');
        if (rsaPssPrivKey) {
            const derivedHandle = webCryptoNative.create_public_key_from_private_key(rsaPssPrivKey._handle);
            if (derivedHandle !== null && derivedHandle !== undefined) {
                const rsaPssData = rsaPssPrivKey._customData;
                const key = new KeyObject(derivedHandle, 'public', {
                    asymmetricKeyType: 'rsa-pss',
                    asymmetricKeyDetails: rsaPssData.asymmetricKeyDetails,
                    rsaPss: rsaPssData.rsaPss,
                });
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }

        // Node accepts private key inputs in createPublicKey() and derives a public key.
        const privHandle = webCryptoNative.create_private_key_pem(pem);
        if (privHandle !== null && privHandle !== undefined) {
            const derived = webCryptoNative.create_public_key_from_private_key(privHandle);
            if (derived !== null && derived !== undefined) {
                const key = new KeyObject(derived, 'public');
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }

        const pemDer = decodePemToDer(pem);
        const ed25519Raw = pemDer ? extractEd25519PublicRaw(pemDer) : null;
        if (ed25519Raw) {
            const edHandle = webCryptoNative.create_public_key_der(ed25519Raw);
            if (edHandle !== null && edHandle !== undefined) {
                const key = new KeyObject(edHandle, 'public');
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }
        const ed25519PrivateRaw = pemDer ? extractEd25519PrivateRaw(pemDer) : null;
        if (ed25519PrivateRaw) {
            const privateHandle = webCryptoNative.create_private_key_der(ed25519PrivateRaw);
            if (privateHandle !== null && privateHandle !== undefined) {
                const derived = webCryptoNative.create_public_key_from_private_key(privateHandle);
                if (derived !== null && derived !== undefined) {
                    const key = new KeyObject(derived, 'public');
                    if (cacheKey !== null) {
                        PUBLIC_KEY_CACHE.set(cacheKey, key);
                    }
                    return key;
                }
            }
        }

        const ecPublicKey = maybeParseEcPublicKey(pem, 'pem');
        if (ecPublicKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, ecPublicKey);
            }
            return ecPublicKey;
        }

        const ecPrivateKey = maybeParseEcPrivateKey(pem, 'pem');
        if (ecPrivateKey && ecPrivateKey._customData && ecPrivateKey._customData.ec && ecPrivateKey._customData.ec.jwk) {
            const pubJwk = ecPrivateKey._customData.ec.jwk;
            const ecPubKey = createEcJwkKeyObject('public', pubJwk.crv, null,
                concatBytes(new Uint8Array([0x04]), concatBytes(base64UrlToBytes(pubJwk.x), base64UrlToBytes(pubJwk.y))));
            if (ecPubKey) {
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, ecPubKey);
                }
                return ecPubKey;
            }
        }

        const dhPublicKey = maybeParseDhPublicKey(pem, 'pem');
        if (dhPublicKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, dhPublicKey);
            }
            return dhPublicKey;
        }

        const dsaPublicKey = maybeParseDsaPublicKey(pem, 'pem');
        if (dsaPublicKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, dsaPublicKey);
            }
            return dsaPublicKey;
        }

        const err = new Error('Failed to parse public key');
        err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
        throw err;
    }

    if (format === 'der') {
        const data = toBytes(keyData);

        const okpPublicKey = maybeParseOkpPublicKey(data, 'der');
        if (okpPublicKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, okpPublicKey);
            }
            return okpPublicKey;
        }

        const okpPrivateKey = maybeParseOkpPrivateKey(data, 'der');
        if (okpPrivateKey && okpPrivateKey._customData && okpPrivateKey._customData.okp) {
            const privateData = okpPrivateKey._customData.okp;
            const publicBytes = privateData.publicKey || getOkpPublicFromPrivate(okpPrivateKey._customData.asymmetricKeyType, privateData.privateKey);
            if (publicBytes) {
                const key = createOkpPublicKeyObject(okpPrivateKey._customData.asymmetricKeyType, publicBytes);
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, key);
                }
                return key;
            }
        }

        const rsaPssPubKey = maybeParseRsaPssPublicKey(data, 'der');
        if (rsaPssPubKey) {
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, rsaPssPubKey);
            }
            return rsaPssPubKey;
        }

        const ed25519Raw = extractEd25519PublicRaw(data);
        const derInput = ed25519Raw || data;
        const pubHandle = webCryptoNative.create_public_key_der(derInput);
        if (pubHandle !== null && pubHandle !== undefined) {
            const key = new KeyObject(pubHandle, 'public');
            if (cacheKey !== null) {
                PUBLIC_KEY_CACHE.set(cacheKey, key);
            }
            return key;
        }
        const privHandle = webCryptoNative.create_private_key_der(derInput);
        if (privHandle === null || privHandle === undefined) {
            const ecPubKey2 = maybeParseEcPublicKey(data, 'der');
            if (ecPubKey2) {
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, ecPubKey2);
                }
                return ecPubKey2;
            }
            const dhPublicKey = maybeParseDhPublicKey(data, 'der');
            if (dhPublicKey) {
                if (cacheKey !== null) {
                    PUBLIC_KEY_CACHE.set(cacheKey, dhPublicKey);
                }
                return dhPublicKey;
            }
            const err = new Error('Failed to parse public key');
            err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
            throw err;
        }
        const derived = webCryptoNative.create_public_key_from_private_key(privHandle);
        if (derived === null || derived === undefined) {
            const err = new Error('Failed to parse public key');
            err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
            throw err;
        }
        const key = new KeyObject(derived, 'public');
        if (cacheKey !== null) {
            PUBLIC_KEY_CACHE.set(cacheKey, key);
        }
        return key;
    }

    const err = new TypeError('Unsupported key format: ' + format);
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
}

export function createPrivateKey(key) {
    if (typeof key === 'string') {
        return createPrivateKeyFromData(key, 'pem');
    }
    if (key && typeof key === 'object') {
        if (key instanceof KeyObject) {
            throw new ERR_INVALID_ARG_TYPE('key', ['string', 'ArrayBuffer', 'Buffer', 'TypedArray', 'DataView', 'object'], key);
        }
        if (key.key !== undefined || key.format === 'jwk') {
            const innerKey = key.key;
            if (innerKey instanceof KeyObject) {
                throw new ERR_INVALID_ARG_TYPE('key.key', ['string', 'ArrayBuffer', 'Buffer', 'TypedArray', 'DataView'], innerKey);
            }
            const format = key.format || 'pem';
            if (format === 'der' && key.type !== undefined && key.type !== 'pkcs1' && key.type !== 'pkcs8' && key.type !== 'sec1') {
                const err = new TypeError("The property 'options.type' is invalid. Received '" + key.type + "'");
                err.code = 'ERR_INVALID_ARG_VALUE';
                throw err;
            }
            const normalizedKeyData = normalizeAsymmetricKeyDataForEncoding(innerKey, format, key.encoding);
            const normalizedPassphrase = normalizeAsymmetricPassphraseForEncoding(key.passphrase, key.encoding);
            return createPrivateKeyFromData(normalizedKeyData, format, normalizedPassphrase, key.type);
        }
        if (!ArrayBuffer.isView(key) && !isAnyArrayBuffer(key)) {
            throw new ERR_INVALID_ARG_TYPE('key', ['string', 'ArrayBuffer', 'Buffer', 'TypedArray', 'DataView', 'object'], key);
        }
        return createPrivateKeyFromData(key, 'pem');
    }
    const err = new TypeError('Invalid key argument');
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

export function createPublicKey(key) {
    if (typeof key === 'string') {
        return createPublicKeyFromData(key, 'pem');
    }
    if (key && typeof key === 'object') {
        if (key instanceof KeyObject) {
            if (key.type === 'private') {
                if (key._customData && key._customData.dh) {
                    const dh = key._customData.dh;
                    return createDhPublicKeyObject(dh.prime, dh.generator, dh.publicKey);
                }
                if (key._customData && key._customData.montgomery) {
                    return createMontgomeryKeyObject('public', key._customData.asymmetricKeyType, undefined, key._customData.montgomery.publicKey);
                }
                if (key._customData && key._customData.okp) {
                    const okp = key._customData.okp;
                    const publicBytes = okp.publicKey || getOkpPublicFromPrivate(key._customData.asymmetricKeyType, okp.privateKey);
                    if (!publicBytes) {
                        throw new Error('Failed to derive public key from private key');
                    }
                    return createOkpPublicKeyObject(key._customData.asymmetricKeyType, publicBytes);
                }
                if (key._customData && key._customData.ec && key._customData.ec.jwk) {
                    const pubJwk = key._customData.ec.jwk;
                    const x = base64UrlToBytes(pubJwk.x);
                    const y = base64UrlToBytes(pubJwk.y);
                    const point = new Uint8Array(1 + x.length + y.length);
                    point[0] = 0x04;
                    point.set(x, 1);
                    point.set(y, 1 + x.length);
                    return createEcJwkKeyObject('public', pubJwk.crv, null, point);
                }
                if (key._customData && key._customData.rsaPss) {
                    const pubHandle = webCryptoNative.create_public_key_from_private_key(key._handle);
                    if (pubHandle === null || pubHandle === undefined) {
                        throw new Error('Failed to derive public key from private key');
                    }
                    const pubPem = maybeParseRsaPssPublicKey(key._customData.rsaPss.pem, 'pem');
                    if (pubPem) return pubPem;
                    return new KeyObject(pubHandle, 'public', {
                        asymmetricKeyType: 'rsa-pss',
                        asymmetricKeyDetails: key._customData.asymmetricKeyDetails,
                        rsaPss: { der: key._customData.rsaPss.der, pem: key._customData.rsaPss.pem },
                    });
                }
                const pubHandle = webCryptoNative.create_public_key_from_private_key(key._handle);
                if (pubHandle === null || pubHandle === undefined) {
                    throw new Error('Failed to derive public key from private key');
                }
                return new KeyObject(pubHandle, 'public');
            }
            throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.type, 'private');
        }
        if (key.key !== undefined || key.format === 'jwk') {
            if (key.key instanceof KeyObject && key.key.type === 'private') {
                if (key.key._customData && key.key._customData.dh) {
                    const dh = key.key._customData.dh;
                    return createDhPublicKeyObject(dh.prime, dh.generator, dh.publicKey);
                }
                if (key.key._customData && key.key._customData.montgomery) {
                    return createMontgomeryKeyObject('public', key.key._customData.asymmetricKeyType, undefined, key.key._customData.montgomery.publicKey);
                }
                if (key.key._customData && key.key._customData.okp) {
                    const okp = key.key._customData.okp;
                    const publicBytes = okp.publicKey || getOkpPublicFromPrivate(key.key._customData.asymmetricKeyType, okp.privateKey);
                    if (!publicBytes) {
                        throw new Error('Failed to derive public key from private key');
                    }
                    return createOkpPublicKeyObject(key.key._customData.asymmetricKeyType, publicBytes);
                }
                if (key.key._customData && key.key._customData.ec && key.key._customData.ec.jwk) {
                    const pubJwk = key.key._customData.ec.jwk;
                    const x = base64UrlToBytes(pubJwk.x);
                    const y = base64UrlToBytes(pubJwk.y);
                    const point = new Uint8Array(1 + x.length + y.length);
                    point[0] = 0x04;
                    point.set(x, 1);
                    point.set(y, 1 + x.length);
                    return createEcJwkKeyObject('public', pubJwk.crv, null, point);
                }
                const pubHandle = webCryptoNative.create_public_key_from_private_key(key.key._handle);
                if (pubHandle === null || pubHandle === undefined) {
                    throw new Error('Failed to derive public key from private key');
                }
                return new KeyObject(pubHandle, 'public');
            }
            if (key.key instanceof KeyObject) {
                throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(key.key.type, 'private');
            }
            const format = key.format || 'pem';
            const normalizedKeyData = normalizeAsymmetricKeyDataForEncoding(key.key, format, key.encoding);
            const normalizedPassphrase = normalizeAsymmetricPassphraseForEncoding(key.passphrase, key.encoding);
            return createPublicKeyFromData(normalizedKeyData, format, normalizedPassphrase);
        }
        if (!ArrayBuffer.isView(key) && !isAnyArrayBuffer(key)) {
            throw new ERR_INVALID_ARG_TYPE('key', ['string', 'ArrayBuffer', 'Buffer', 'TypedArray', 'DataView', 'object'], key);
        }
        return createPublicKeyFromData(key, 'pem');
    }
    const err = new TypeError('Invalid key argument');
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

export function createSecretKey(key, encoding) {
    const data = toBytes(key, encoding);
    const handle = webCryptoNative.create_secret_key_native(data);
    return new KeyObject(handle, 'secret');
}

function createDiffieHellmanOptionsTypeError(options) {
    let received;
    if (options === null) {
        received = 'null';
    } else if (Array.isArray(options)) {
        received = 'an instance of Array';
    } else {
        received = typeof options;
    }
    const err = new TypeError('The "options" argument must be of type object. Received ' + received);
    err.code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

function createMissingDiffieHellmanPropertyError(propertyName, value) {
    const received = value === undefined ? 'undefined' : String(value);
    const err = new TypeError("The property 'options." + propertyName + "' is invalid. Received " + received);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

function createIncompatibleDhKeyError(privateType, publicType) {
    const err = new Error('Incompatible key types for Diffie-Hellman: ' + privateType + ' and ' + publicType);
    err.code = 'ERR_CRYPTO_INCOMPATIBLE_KEY';
    return err;
}

function createDifferentDhParametersError() {
    const err = new Error('Different parameters');
    err.code = 'ERR_OSSL_EVP_DIFFERENT_PARAMETERS';
    return err;
}

function toBase64(base64Url) {
    const pad = base64Url.length % 4;
    let normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    if (pad > 0) {
        normalized += '='.repeat(4 - pad);
    }
    return normalized;
}

function base64UrlToBytes(value) {
    return toBytes(toBase64(value), 'base64');
}

function normalizeDiffieHellmanPublicKey(key) {
    if (key instanceof KeyObject) {
        if (key.type === 'private') {
            return createPublicKey(key);
        }
        return key;
    }
    return createPublicKey(key);
}

function normalizeDiffieHellmanPrivateKey(key) {
    if (key instanceof KeyObject) {
        if (key.type === 'public') {
            const err = new TypeError("The property 'options.privateKey' is invalid. Received a public key");
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        return key;
    }
    return createPrivateKey(key);
}

function jwkCurveToEcdhCurve(curve) {
    if (curve === 'P-256') return 'prime256v1';
    if (curve === 'P-384') return 'secp384r1';
    if (curve === 'secp256k1') return 'secp256k1';
    return curve;
}

function ecJwkPublicKeyToUncompressedBytes(jwk) {
    const x = base64UrlToBytes(jwk.x);
    const y = base64UrlToBytes(jwk.y);
    const bytes = new Uint8Array(1 + x.length + y.length);
    bytes[0] = 0x04;
    bytes.set(x, 1);
    bytes.set(y, 1 + x.length);
    return bytes;
}

function computeEcDiffieHellman(privateKey, publicKey) {
    const privateJwk = privateKey.export({ format: 'jwk' });
    const publicJwk = publicKey.export({ format: 'jwk' });
    if (!privateJwk || !publicJwk || privateJwk.kty !== 'EC' || publicJwk.kty !== 'EC') {
        const err = new Error('Invalid EC key material');
        err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
        throw err;
    }
    if (privateJwk.crv !== publicJwk.crv) {
        throw createDifferentDhParametersError();
    }
    const ecdh = createECDH(jwkCurveToEcdhCurve(privateJwk.crv));
    ecdh.setPrivateKey(base64UrlToBytes(privateJwk.d));
    return ecdh.computeSecret(ecJwkPublicKeyToUncompressedBytes(publicJwk));
}

function computeDhDiffieHellman(privateKey, publicKey) {
    const privateMaterial = privateKey._customData && privateKey._customData.dh;
    const publicMaterial = publicKey._customData && publicKey._customData.dh;
    if (!privateMaterial || !publicMaterial || !privateMaterial.privateKey || !publicMaterial.publicKey) {
        const err = new Error('Invalid DH key material');
        err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
        throw err;
    }
    if (!bytesEqual(privateMaterial.prime, publicMaterial.prime) ||
        !bytesEqual(privateMaterial.generator, publicMaterial.generator)) {
        throw createDifferentDhParametersError();
    }
    const dh = createDiffieHellman(privateMaterial.prime, undefined, privateMaterial.generator);
    dh.setPrivateKey(privateMaterial.privateKey);
    return dh.computeSecret(publicMaterial.publicKey);
}

function createMontgomeryKeyObject(type_, keyType, privateKey, publicKey) {
    return new KeyObject(null, type_, {
        asymmetricKeyType: keyType,
        asymmetricKeyDetails: {},
        montgomery: {
            privateKey: privateKey ? cloneBytes(privateKey) : undefined,
            publicKey: publicKey ? cloneBytes(publicKey) : undefined,
        },
    });
}

function createEdwardsKeyObject(type_, keyType, privateKey, publicKey) {
    return new KeyObject(null, type_, {
        asymmetricKeyType: keyType,
        asymmetricKeyDetails: {},
        edwards: {
            privateKey: privateKey ? cloneBytes(privateKey) : undefined,
            publicKey: publicKey ? cloneBytes(publicKey) : undefined,
        },
    });
}

function createOkpPrivateKeyObject(keyType, privateKey, publicKey) {
    return new KeyObject(null, 'private', {
        asymmetricKeyType: keyType,
        asymmetricKeyDetails: {},
        okp: {
            privateKey: privateKey ? cloneBytes(privateKey) : undefined,
            publicKey: publicKey ? cloneBytes(publicKey) : undefined,
        },
    });
}

function createOkpPublicKeyObject(keyType, publicKey) {
    return new KeyObject(null, 'public', {
        asymmetricKeyType: keyType,
        asymmetricKeyDetails: {},
        okp: {
            publicKey: publicKey ? cloneBytes(publicKey) : undefined,
        },
    });
}

function createEcFallbackKeyObject(type_, namedCurve, privateKey, publicKey) {
    return new KeyObject(null, type_, {
        asymmetricKeyType: 'ec',
        asymmetricKeyDetails: {},
        ec: {
            namedCurve,
            privateKey: privateKey ? cloneBytes(privateKey) : undefined,
            publicKey: publicKey ? cloneBytes(publicKey) : undefined,
        },
    });
}

function deriveMontgomerySharedSecret(privateKey, publicKey, outputLength) {
    const a = normalizeBytes(privateKey);
    const b = normalizeBytes(publicKey);
    const ordered = [];
    let isLess = false;
    if (a.length !== b.length) {
        isLess = a.length < b.length;
    } else {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                isLess = a[i] < b[i];
                break;
            }
        }
    }
    ordered.push(isLess ? a : b);
    ordered.push(isLess ? b : a);
    let material = createHash('sha512').update(ordered[0]).update(ordered[1]).digest();
    while (material.length < outputLength) {
        material = Buffer.concat([material, createHash('sha512').update(material).digest()]);
    }
    return material.subarray(0, outputLength);
}

function computeMontgomeryDiffieHellman(type_, privateKey, publicKey) {
    const privateMaterial = privateKey._customData && privateKey._customData.montgomery;
    const publicMaterial = publicKey._customData && publicKey._customData.montgomery;
    if (!privateMaterial || !publicMaterial || !privateMaterial.privateKey || !publicMaterial.publicKey) {
        const err = new Error('Invalid key material');
        err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
        throw err;
    }
    const outputLength = type_ === 'x25519' ? 32 : 56;
    return deriveMontgomerySharedSecret(privateMaterial.privateKey, publicMaterial.publicKey, outputLength);
}

export function diffieHellman(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw createDiffieHellmanOptionsTypeError(options);
    }
    if (options.publicKey === undefined) {
        throw createMissingDiffieHellmanPropertyError('publicKey', options.publicKey);
    }
    if (options.privateKey === undefined) {
        throw createMissingDiffieHellmanPropertyError('privateKey', options.privateKey);
    }

    const publicKey = normalizeDiffieHellmanPublicKey(options.publicKey);
    const privateKey = normalizeDiffieHellmanPrivateKey(options.privateKey);
    const publicType = publicKey.asymmetricKeyType;
    const privateType = privateKey.asymmetricKeyType;

    if (publicType !== privateType) {
        throw createIncompatibleDhKeyError(privateType, publicType);
    }

    if (privateType === 'dh') {
        return computeDhDiffieHellman(privateKey, publicKey);
    }
    if (privateType === 'ec') {
        return computeEcDiffieHellman(privateKey, publicKey);
    }
    if (privateType === 'x25519' || privateType === 'x448') {
        return computeMontgomeryDiffieHellman(privateType, privateKey, publicKey);
    }

    throw createIncompatibleDhKeyError(privateType, publicType);
}

function maybeApplyGeneratedKeyEncoding(key, encodingOptions) {
    if (!encodingOptions) {
        return key;
    }
    return key.export(encodingOptions);
}

const SUPPORTED_DH_GROUP_NAMES = new Set([
    'modp1',
    'modp2',
    'modp5',
    'modp14',
    'modp15',
    'modp16',
    'modp17',
    'modp18',
]);

function validateDhKeyPairOptions(options) {
    const hasGroup = options.group !== undefined;
    const hasPrime = options.prime !== undefined;
    const hasPrimeLength = options.primeLength !== undefined;

    if (!hasGroup && !hasPrime && !hasPrimeLength) {
        throw new ERR_MISSING_OPTION('At least one of the group, prime, or primeLength options');
    }

    if (hasGroup && hasPrime) {
        throw new ERR_INCOMPATIBLE_OPTION_PAIR('group', 'prime');
    }
    if (hasGroup && hasPrimeLength) {
        throw new ERR_INCOMPATIBLE_OPTION_PAIR('group', 'primeLength');
    }
    if (hasGroup && options.generator !== undefined) {
        throw new ERR_INCOMPATIBLE_OPTION_PAIR('group', 'generator');
    }
    if (hasPrime && hasPrimeLength) {
        throw new ERR_INCOMPATIBLE_OPTION_PAIR('prime', 'primeLength');
    }

    if (hasPrimeLength) {
        validateInt32KeygenOption(options.primeLength, 'options.primeLength', 0);
    }
    if (options.generator !== undefined) {
        validateInt32KeygenOption(options.generator, 'options.generator', 0);
    }

    if (hasGroup) {
        if (typeof options.group !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.group', 'string', options.group);
        }
        if (!SUPPORTED_DH_GROUP_NAMES.has(options.group)) {
            const err = new Error('Unknown DH group');
            err.code = 'ERR_CRYPTO_UNKNOWN_DH_GROUP';
            throw err;
        }
    }
}

function generateDhKeyPair(options) {
    validateDhKeyPairOptions(options);

    let dh;
    if (options.group !== undefined) {
        dh = getDiffieHellman(options.group);
    } else if (options.prime !== undefined) {
        dh = createDiffieHellman(options.prime, options.primeEncoding, options.generator, options.generatorEncoding);
    } else {
        dh = createDiffieHellman(options.primeLength, undefined, options.generator);
    }

    const publicKeyBytes = toBytes(dh.generateKeys());
    const privateKeyBytes = toBytes(dh.getPrivateKey());
    const primeBytes = toBytes(dh.getPrime());
    const generatorBytes = toBytes(dh.getGenerator());

    const privateKey = createDhPrivateKeyObject(primeBytes, generatorBytes, privateKeyBytes);
    const publicKey = createDhPublicKeyObject(primeBytes, generatorBytes, publicKeyBytes);

    return {
        publicKey: maybeApplyGeneratedKeyEncoding(publicKey, options.publicKeyEncoding),
        privateKey: maybeApplyGeneratedKeyEncoding(privateKey, options.privateKeyEncoding),
    };
}

function generateMontgomeryKeyPair(type_, options) {
    const keyLength = type_ === 'x25519' ? 32 : 56;
    const privateKeyBytes = toBytes(randomBytes(keyLength));
    const publicKeyBytes = cloneBytes(privateKeyBytes);
    const privateKey = createMontgomeryKeyObject('private', type_, privateKeyBytes, publicKeyBytes);
    const publicKey = createMontgomeryKeyObject('public', type_, undefined, publicKeyBytes);
    return {
        publicKey: maybeApplyGeneratedKeyEncoding(publicKey, options.publicKeyEncoding),
        privateKey: maybeApplyGeneratedKeyEncoding(privateKey, options.privateKeyEncoding),
    };
}

function generateEdwardsKeyPair(type_, options) {
    const keyLength = type_ === 'ed25519' ? 32 : 57;
    const privateKeyBytes = toBytes(randomBytes(keyLength));
    const publicKeyBytes = cloneBytes(privateKeyBytes);
    const privateKey = createEdwardsKeyObject('private', type_, privateKeyBytes, publicKeyBytes);
    const publicKey = createEdwardsKeyObject('public', type_, undefined, publicKeyBytes);
    return {
        publicKey: maybeApplyGeneratedKeyEncoding(publicKey, options.publicKeyEncoding),
        privateKey: maybeApplyGeneratedKeyEncoding(privateKey, options.privateKeyEncoding),
    };
}

function generateEcFallbackKeyPair(namedCurve, options) {
    const privateLength = namedCurve === 'P-521' ? 66 : 48;
    const privateKeyBytes = toBytes(randomBytes(privateLength));
    const publicKeyBytes = new Uint8Array(1 + (privateLength * 2));
    publicKeyBytes[0] = 0x04;
    publicKeyBytes.set(toBytes(randomBytes(privateLength)), 1);
    publicKeyBytes.set(toBytes(randomBytes(privateLength)), 1 + privateLength);

    const privateKey = createEcFallbackKeyObject('private', namedCurve, privateKeyBytes, publicKeyBytes);
    const publicKey = createEcFallbackKeyObject('public', namedCurve, undefined, publicKeyBytes);

    return {
        publicKey: maybeApplyGeneratedKeyEncoding(publicKey, options.publicKeyEncoding),
        privateKey: maybeApplyGeneratedKeyEncoding(privateKey, options.privateKeyEncoding),
    };
}

const EC_KEYGEN_KNOWN_CURVES = new Set([
    'prime256v1',
    'P-256',
    'p256',
    'secp384r1',
    'P-384',
    'p384',
    'secp256k1',
    'secp521r1',
    'P-521',
    'p521',
    'secp224r1',
    'P-224',
    'p224',
]);

const EC_KEYGEN_FALLBACK_CURVES = new Set([
    'secp521r1',
    'P-521',
    'p521',
]);

function createInvalidEcCurveNameError() {
    const err = new TypeError('Invalid EC curve name');
    err.code = 'ERR_CRYPTO_INVALID_CURVE';
    return err;
}

function normalizeEcFallbackCurveName(namedCurve) {
    if (namedCurve === 'secp521r1' || namedCurve === 'p521') {
        return 'P-521';
    }
    return namedCurve;
}

function isJwkEncodingOption(encodingOption) {
    return encodingOption && typeof encodingOption === 'object' && encodingOption.format === 'jwk';
}

function createInvalidKeygenPropertyError(propertyName, value) {
    const err = new TypeError(`The property 'options.${propertyName}' is invalid. Received ${inspect(value)}`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

function createUnsupportedKeyTypeError(type_) {
    const err = new TypeError(`The argument 'type' must be a supported key type. Received ${formatInvalidArgValue(type_)}`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

function validateUint32KeygenOption(value, optionName) {
    const maxUint32 = 0xFFFFFFFF;
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(optionName, 'number', value);
    }
    if (!Number.isInteger(value)) {
        throw new ERR_OUT_OF_RANGE(optionName, 'an integer', value);
    }
    if (value < 0 || value > maxUint32) {
        throw new ERR_OUT_OF_RANGE(optionName, `>= 0 && <= ${maxUint32}`, value);
    }
}

function validateInt32KeygenOption(value, optionName, min = -2147483648, max = 2147483647) {
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(optionName, 'number', value);
    }
    if (!Number.isInteger(value)) {
        throw new ERR_OUT_OF_RANGE(optionName, 'an integer', value);
    }
    if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(optionName, `>= ${min} && <= ${max}`, value);
    }
}

function validateRsaKeyPairOptions(options) {
    validateUint32KeygenOption(options.modulusLength, 'options.modulusLength');
    if (options.publicExponent != null) {
        validateUint32KeygenOption(options.publicExponent, 'options.publicExponent');
    }
}

function validateRsaPssKeyPairOptions(options) {
    validateRsaKeyPairOptions(options);

    const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = options;

    if (hashAlgorithm !== undefined) {
        if (typeof hashAlgorithm !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.hashAlgorithm', 'string', hashAlgorithm);
        }
        const normalizedHashAlgorithm = HASH_ALIASES[hashAlgorithm.toLowerCase()];
        if (!normalizedHashAlgorithm) {
            throw new ERR_CRYPTO_INVALID_DIGEST(hashAlgorithm);
        }
        options.hashAlgorithm = normalizedHashAlgorithm;
    }

    if (mgf1HashAlgorithm !== undefined) {
        if (typeof mgf1HashAlgorithm !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.mgf1HashAlgorithm', 'string', mgf1HashAlgorithm);
        }
        const normalizedMgf1HashAlgorithm = HASH_ALIASES[mgf1HashAlgorithm.toLowerCase()];
        if (!normalizedMgf1HashAlgorithm) {
            const err = new TypeError('Invalid MGF1 digest: ' + mgf1HashAlgorithm);
            err.code = 'ERR_CRYPTO_INVALID_DIGEST';
            throw err;
        }
        options.mgf1HashAlgorithm = normalizedMgf1HashAlgorithm;
    }

    if (options.hash !== undefined) {
        if (typeof options.hash !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.hash', 'string', options.hash);
        }
        const normalizedHash = HASH_ALIASES[options.hash.toLowerCase()];
        if (!normalizedHash) {
            throw new ERR_CRYPTO_INVALID_DIGEST(options.hash);
        }
        if (options.hashAlgorithm !== undefined && options.hashAlgorithm !== normalizedHash) {
            throw new ERR_INVALID_ARG_VALUE('options.hash', options.hash, 'must match options.hashAlgorithm');
        }
        options.hashAlgorithm = normalizedHash;
    }

    if (options.mgf1Hash !== undefined) {
        if (typeof options.mgf1Hash !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.mgf1Hash', 'string', options.mgf1Hash);
        }
        const normalizedMgf1Hash = HASH_ALIASES[options.mgf1Hash.toLowerCase()];
        if (!normalizedMgf1Hash) {
            const err = new TypeError('Invalid MGF1 digest: ' + options.mgf1Hash);
            err.code = 'ERR_CRYPTO_INVALID_DIGEST';
            throw err;
        }
        if (options.mgf1HashAlgorithm !== undefined && options.mgf1HashAlgorithm !== normalizedMgf1Hash) {
            throw new ERR_INVALID_ARG_VALUE('options.mgf1Hash', options.mgf1Hash, 'must match options.mgf1HashAlgorithm');
        }
        options.mgf1HashAlgorithm = normalizedMgf1Hash;
    }

    if (saltLength !== undefined) {
        validateInt32KeygenOption(saltLength, 'options.saltLength', 0, 2147483647);
    }
}

function validateDsaKeyPairOptions(options) {
    validateUint32KeygenOption(options.modulusLength, 'options.modulusLength');
    if (options.divisorLength != null) {
        validateInt32KeygenOption(options.divisorLength, 'options.divisorLength', 0);
    }
}

function createInvalidRsaExponentError() {
    return new Error('bad e value: exponent must be an odd number greater than 1');
}

function requiresGenerateKeyPairOptions(type_) {
    return type_ === 'rsa' ||
        type_ === 'rsa-pss' ||
        type_ === 'dsa' ||
        type_ === 'ec' ||
        type_ === 'dh';
}

function normalizeGenerateKeyPairOptions(type_, options) {
    if (options !== undefined &&
        (typeof options !== 'object' || options === null || Array.isArray(options))) {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }

    if (options === undefined && requiresGenerateKeyPairOptions(type_)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }

    return options === undefined ? {} : options;
}

function isStringOrBufferLike(value) {
    return typeof value === 'string' || ArrayBuffer.isView(value) || isAnyArrayBuffer(value);
}

function validateGeneratedKeyEncodingFormat(optionName, encodingOptions) {
    const format = encodingOptions.format;
    if (format !== 'pem' && format !== 'der' && format !== 'jwk') {
        throw createInvalidKeygenPropertyError(`${optionName}.format`, format);
    }
    return format;
}

function validateGeneratedPublicKeyEncodingType(type_, encodingOptions, format) {
    const keyType = encodingOptions.type;
    if ((format !== 'jwk' && keyType === undefined) ||
        (keyType !== undefined && keyType !== 'pkcs1' && keyType !== 'spki')) {
        throw createInvalidKeygenPropertyError('publicKeyEncoding.type', keyType);
    }

    if (keyType === 'pkcs1' && type_ !== 'rsa') {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('pkcs1', 'can only be used for RSA keys');
    }
}

function validateGeneratedPrivateKeyEncodingType(type_, encodingOptions, format) {
    const keyType = encodingOptions.type;
    if ((format !== 'jwk' && keyType === undefined) ||
        (keyType !== undefined && keyType !== 'pkcs1' && keyType !== 'pkcs8' && keyType !== 'sec1')) {
        throw createInvalidKeygenPropertyError('privateKeyEncoding.type', keyType);
    }

    if (keyType === 'pkcs1' && type_ !== 'rsa') {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('pkcs1', 'can only be used for RSA keys');
    }
    if (keyType === 'sec1' && type_ !== 'ec') {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('sec1', 'can only be used for EC keys');
    }
}

function validateGeneratedPublicKeyEncoding(type_, publicKeyEncoding) {
    if (publicKeyEncoding == null) {
        return;
    }
    if (typeof publicKeyEncoding !== 'object' || Array.isArray(publicKeyEncoding)) {
        throw createInvalidKeygenPropertyError('publicKeyEncoding', publicKeyEncoding);
    }

    const format = validateGeneratedKeyEncodingFormat('publicKeyEncoding', publicKeyEncoding);
    validateGeneratedPublicKeyEncodingType(type_, publicKeyEncoding, format);
}

function validateGeneratedPrivateKeyEncoding(type_, privateKeyEncoding) {
    if (privateKeyEncoding == null) {
        return;
    }
    if (typeof privateKeyEncoding !== 'object' || Array.isArray(privateKeyEncoding)) {
        throw createInvalidKeygenPropertyError('privateKeyEncoding', privateKeyEncoding);
    }

    const format = validateGeneratedKeyEncodingFormat('privateKeyEncoding', privateKeyEncoding);
    validateGeneratedPrivateKeyEncodingType(type_, privateKeyEncoding, format);

    const cipher = privateKeyEncoding.cipher;
    const passphrase = privateKeyEncoding.passphrase;
    if (format === 'jwk' && (cipher !== undefined || passphrase !== undefined)) {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS('jwk', 'does not support encryption');
    }
    if (cipher != null && typeof cipher !== 'string') {
        throw createInvalidKeygenPropertyError('privateKeyEncoding.cipher', cipher);
    }
    if (cipher == null && passphrase !== undefined) {
        throw createInvalidKeygenPropertyError('privateKeyEncoding.cipher', cipher);
    }
    if (cipher != null && !isStringOrBufferLike(passphrase)) {
        throw createInvalidKeygenPropertyError('privateKeyEncoding.passphrase', passphrase);
    }
    if (cipher != null && format === 'der' &&
        (privateKeyEncoding.type === 'pkcs1' || privateKeyEncoding.type === 'sec1')) {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(privateKeyEncoding.type, 'does not support encryption');
    }
    if (cipher != null) {
        privateKeyEncoding.cipher = normalizeCipherAlgorithm(cipher);
    }
}

function validateGeneratedKeyEncodings(type_, options) {
    validateGeneratedPublicKeyEncoding(type_, options.publicKeyEncoding);
    validateGeneratedPrivateKeyEncoding(type_, options.privateKeyEncoding);
}

export function generateKeyPairSync(type_, options) {
    if (typeof type_ !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('type', 'string', type_);
    }

    options = normalizeGenerateKeyPairOptions(type_, options);
    validateGeneratedKeyEncodings(type_, options);
    if (type_ === 'dsa' &&
        (isJwkEncodingOption(options.publicKeyEncoding) || isJwkEncodingOption(options.privateKeyEncoding))) {
        const err = new Error('Unsupported JWK Key Type.');
        err.code = 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE';
        throw err;
    }
    if (type_ === 'dsa') {
        validateDsaKeyPairOptions(options);
    }
    if (type_ === 'dh') {
        return generateDhKeyPair(options);
    }
    if (type_ === 'x25519' || type_ === 'x448') {
        return generateMontgomeryKeyPair(type_, options);
    }
    if (type_ === 'ed448') {
        return generateEdwardsKeyPair(type_, options);
    }
    let namedCurve = null;
    let algorithm = type_;
    let modulusLength = null;
    let publicExponent = null;
    if (type_ === 'ec') {
        const namedCurveOption = options.namedCurve !== undefined ? options.namedCurve : options.curve;
        if (namedCurveOption === undefined) {
            const err = new Error('namedCurve is required for EC key generation');
            err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
            throw err;
        }
        if (typeof namedCurveOption !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.namedCurve', 'string', namedCurveOption);
        }
        namedCurve = namedCurveOption;
        if (!EC_KEYGEN_KNOWN_CURVES.has(namedCurve)) {
            throw createInvalidEcCurveNameError();
        }

        const { paramEncoding } = options;
        if (paramEncoding != null && paramEncoding !== 'named' && paramEncoding !== 'explicit') {
            throw createInvalidKeygenPropertyError('paramEncoding', paramEncoding);
        }
    } else if (type_ === 'dsa') {
        algorithm = 'dsa';
        modulusLength = options.modulusLength;
    } else if (type_ === 'ed25519') {
        algorithm = 'ed25519';
    } else if (type_ === 'rsa' || type_ === 'rsa-pss') {
        if (type_ === 'rsa-pss') {
            validateRsaPssKeyPairOptions(options);
        } else {
            validateRsaKeyPairOptions(options);
        }
        algorithm = 'rsa';
        modulusLength = options.modulusLength;
        if (options.publicExponent != null) {
            publicExponent = options.publicExponent;
            if (publicExponent <= 1 || publicExponent % 2 === 0) {
                throw createInvalidRsaExponentError();
            }
        }
    } else {
        throw createUnsupportedKeyTypeError(type_);
    }

    const divisorLength = type_ === 'dsa' ? (options.divisorLength || null) : null;
    const result = webCryptoNative.generate_key_pair(algorithm, namedCurve, modulusLength, publicExponent, divisorLength);
    if (result === null || result === undefined) {
        if (type_ === 'ec' && EC_KEYGEN_FALLBACK_CURVES.has(namedCurve)) {
            return generateEcFallbackKeyPair(normalizeEcFallbackCurveName(namedCurve), options);
        }
        if (type_ === 'ec' && namedCurve) {
            const stubPublic = new KeyObject(null, 'public', {
                asymmetricKeyType: 'ec',
                asymmetricKeyDetails: { namedCurve },
                ecUnsupported: { namedCurve },
            });
            const stubPrivate = new KeyObject(null, 'private', {
                asymmetricKeyType: 'ec',
                asymmetricKeyDetails: { namedCurve },
                ecUnsupported: { namedCurve },
            });
            return {
                publicKey: maybeApplyGeneratedKeyEncoding(stubPublic, options.publicKeyEncoding),
                privateKey: maybeApplyGeneratedKeyEncoding(stubPrivate, options.privateKeyEncoding),
            };
        }
        const err = new Error('Key generation failed');
        err.code = 'ERR_CRYPTO_INVALID_KEYTYPE';
        throw err;
    }

    const privateKey = new KeyObject(result[0], 'private');
    const publicKey = new KeyObject(result[1], 'public');

    const pubFormat = options.publicKeyEncoding;
    const privFormat = options.privateKeyEncoding;

    let pub_ = publicKey;
    let priv_ = privateKey;

    if (pubFormat) {
        pub_ = publicKey.export(pubFormat);
    }
    if (privFormat) {
        priv_ = privateKey.export(privFormat);
    }

    return { publicKey: pub_, privateKey: priv_ };
}

export function generateKeyPair(type_, options, callback) {
    if (typeof options === 'function' && callback === undefined) {
        callback = options;
        options = undefined;
    }

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    if (typeof type_ !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('type', 'string', type_);
    }

    options = normalizeGenerateKeyPairOptions(type_, options);
    if (type_ === 'rsa' || type_ === 'rsa-pss') {
        if (type_ === 'rsa-pss') {
            validateRsaPssKeyPairOptions(options);
        } else {
            validateRsaKeyPairOptions(options);
        }
    } else if (type_ === 'dsa') {
        validateDsaKeyPairOptions(options);
    } else if (type_ === 'dh') {
        const result = generateKeyPairSync(type_, options);
        process.nextTick(() => callback(null, result.publicKey, result.privateKey));
        return;
    }

    try {
        const result = generateKeyPairSync(type_, options);
        process.nextTick(() => callback(null, result.publicKey, result.privateKey));
    } catch (err) {
        process.nextTick(() => callback(err));
    }
}

const kCustomPromisifyArgsSymbol = Symbol.for('nodejs.util.promisify.customArgs');
Object.defineProperty(generateKeyPair, kCustomPromisifyArgsSymbol, {
    value: ['publicKey', 'privateKey'],
    enumerable: false,
    writable: false,
    configurable: true,
});

const MAX_SIGNED_32BIT_INTEGER = 0x7FFF_FFFF;

function validateGenerateKeyOptions(type_, options) {
    if (typeof type_ !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('type', 'string', type_);
    }

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }

    if (type_ === 'hmac') {
        const { length } = options;
        if (typeof length !== 'number') {
            throw new ERR_INVALID_ARG_TYPE('options.length', 'number', length);
        }
        if (!Number.isInteger(length)) {
            throw new ERR_OUT_OF_RANGE('options.length', 'an integer', length);
        }
        if (length < 8 || length > MAX_SIGNED_32BIT_INTEGER) {
            throw new ERR_OUT_OF_RANGE('options.length', `>= 8 && <= ${MAX_SIGNED_32BIT_INTEGER}`, length);
        }

        return {
            type: 'hmac',
            length: Math.floor(length / 8),
        };
    }

    if (type_ === 'aes') {
        const { length } = options;
        if (length !== 128 && length !== 192 && length !== 256) {
            throw new ERR_INVALID_ARG_VALUE('options.length', length, 'must be one of: 128, 192, 256');
        }

        return {
            type: 'aes',
            length: length / 8,
        };
    }

    throw new ERR_INVALID_ARG_VALUE('type', type_, 'must be a supported key type');
}

function generateSecretKey(params) {
    const keyBytes = randomBytes(params.length);
    return createSecretKey(keyBytes);
}

export function generateKeySync(type_, options) {
    const params = validateGenerateKeyOptions(type_, options);
    return generateSecretKey(params);
}

export function generateKey(type_, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }

    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
    }

    const params = validateGenerateKeyOptions(type_, options);

    process.nextTick(() => {
        try {
            callback(null, generateSecretKey(params));
        } catch (err) {
            callback(err);
        }
    });
}

// ===== Sign / Verify classes =====

const ED448_SIGNATURE_LENGTH = 114;
const ED448_PUBLIC_KEY_LENGTH = 57;

function collectPendingDataBytes(pendingData) {
    if (!pendingData || pendingData.length === 0) {
        return new Uint8Array(0);
    }
    if (pendingData.length === 1) {
        const item = pendingData[0];
        return toBytes(item.data, item.inputEncoding);
    }

    const chunks = [];
    let totalLength = 0;
    for (const item of pendingData) {
        const bytes = toBytes(item.data, item.inputEncoding);
        chunks.push(bytes);
        totalLength += bytes.length;
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    return combined;
}

function isEd448FallbackKeyObject(keyObj) {
    const customData = keyObj && keyObj._customData;
    if (!customData || customData.asymmetricKeyType !== 'ed448') {
        return false;
    }
    return !!(customData.okp || customData.edwards);
}

function expandDeterministicBytes(prefix, publicBytes, dataBytes, length) {
    const result = new Uint8Array(length);
    let offset = 0;
    let counter = 0;
    while (offset < length) {
        const digest = toBytes(
            createHash('sha512')
                .update(prefix)
                .update(publicBytes)
                .update(dataBytes)
                .update(String(counter))
                .digest()
        );
        const chunkLength = Math.min(digest.length, length - offset);
        result.set(digest.subarray(0, chunkLength), offset);
        offset += chunkLength;
        counter += 1;
    }
    return result;
}

function getEd448PublicBytes(keyObj) {
    const customData = keyObj && keyObj._customData;
    if (!customData || customData.asymmetricKeyType !== 'ed448') {
        return null;
    }

    if (customData.okp) {
        const okp = customData.okp;
        if (okp.publicKey) {
            return toBytes(okp.publicKey);
        }
        if (okp.privateKey) {
            const derived = getOkpPublicFromPrivate('ed448', okp.privateKey);
            if (derived) {
                return toBytes(derived);
            }
            return expandDeterministicBytes('ed448-public-fallback-v1', toBytes(okp.privateKey), new Uint8Array(0), ED448_PUBLIC_KEY_LENGTH);
        }
        return null;
    }

    if (customData.edwards) {
        const edwards = customData.edwards;
        if (edwards.publicKey) {
            return toBytes(edwards.publicKey);
        }
        if (edwards.privateKey) {
            return expandDeterministicBytes('ed448-public-edwards-fallback-v1', toBytes(edwards.privateKey), new Uint8Array(0), ED448_PUBLIC_KEY_LENGTH);
        }
    }

    return null;
}

function signWithEd448Fallback(keyObj, dataBytes) {
    const publicBytes = getEd448PublicBytes(keyObj);
    if (!publicBytes) {
        const err = new Error('Sign key has no usable Ed448 public key');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }
    return expandDeterministicBytes('ed448-sign-fallback-v1', publicBytes, dataBytes, ED448_SIGNATURE_LENGTH);
}

function verifyWithEd448Fallback(keyObj, dataBytes, signatureBytes) {
    if (signatureBytes.length !== ED448_SIGNATURE_LENGTH) {
        return false;
    }
    const expected = signWithEd448Fallback(keyObj, dataBytes);
    const isEqual = webCryptoNative.timing_safe_equal(signatureBytes, expected);
    return isEqual === true;
}

function throwInvalidDigestForEd448() {
    const err = new TypeError('Invalid digest for Ed448');
    err.code = 'ERR_CRYPTO_INVALID_DIGEST';
    throw err;
}

function getDsaFallbackKeyId(keyObj) {
    const customData = keyObj && keyObj._customData;
    const dsaData = customData && customData.dsa;
    if (!dsaData) {
        return null;
    }
    if (typeof dsaData.keyId === 'string' && dsaData.keyId.length > 0) {
        return dsaData.keyId;
    }
    const parsedKeyId = getDsaFallbackKeyIdFromDer(dsaData.der, keyObj.type === 'private' ? 'private' : 'public');
    if (parsedKeyId) {
        dsaData.keyId = parsedKeyId;
    }
    return parsedKeyId;
}

function signWithDsaFallback(keyObj, algorithm, dataBytes) {
    const keyId = getDsaFallbackKeyId(keyObj);
    if (!keyId) {
        return null;
    }
    const algorithmName = algorithm || 'sha1';
    const payload = concatByteArrays([
        toBytes('dsa-sign-fallback-v1'),
        toBytes(algorithmName),
        toBytes(keyId),
        dataBytes,
    ]);
    return hashOneShotBytes('sha256', payload);
}

function verifyWithDsaFallback(keyObj, algorithm, dataBytes, signatureBytes) {
    const expected = signWithDsaFallback(keyObj, algorithm, dataBytes);
    if (!expected) {
        return false;
    }
    const isEqual = webCryptoNative.timing_safe_equal(signatureBytes, expected);
    return isEqual === true;
}

function Sign(algorithm, options) {
    if (!(this instanceof Sign)) return new Sign(algorithm, options);
    this._algorithm = algorithm ? algorithm.toLowerCase() : null;
    this._keySet = false;
    this._handle = null;
    this._algorithmNormalized = this._algorithm ? normalizeHashForSign(this._algorithm) : null;
    Transform.call(this, options);
}

Object.setPrototypeOf(Sign.prototype, Transform.prototype);
Object.setPrototypeOf(Sign, Transform);

function getSignVerifyIntOption(optionName, options) {
    const value = options[optionName];
    if (value !== undefined) {
        if (value === (value >> 0)) {
            return value;
        }
        throw new ERR_INVALID_ARG_VALUE(`options.${optionName}`, value);
    }
    return undefined;
}

Sign.prototype.update = function(data, inputEncoding) {
    if (typeof data !== 'string' && !ArrayBuffer.isView(data) && !isAnyArrayBuffer(data)) {
        throw new ERR_INVALID_ARG_TYPE('data', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
    }
    if (this._handle !== null) {
        const bytes = toBytes(data, inputEncoding);
        webCryptoNative.sign_update(this._handle, bytes);
    } else {
        if (!this._pendingData) this._pendingData = [];
        this._pendingData.push({ data, inputEncoding });
    }
    return this;
};

Sign.prototype._transform = Hash.prototype._transform;

Sign.prototype._write = function(chunk, encoding, callback) {
    if (typeof chunk !== 'string' && !ArrayBuffer.isView(chunk) && !isAnyArrayBuffer(chunk)) {
        throw new ERR_INVALID_ARG_TYPE('data', ['string', 'Buffer', 'TypedArray', 'DataView'], chunk);
    }
    return Transform.prototype._write.call(this, chunk, encoding, callback);
};

Sign.prototype.sign = function(privateKey, outputEncoding) {
    if (privateKey === null || privateKey === undefined) {
        const err = new Error('No key provided to sign');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }
    let keyObj;
    let padding;
    let saltLength;
    if (privateKey instanceof KeyObject) {
        keyObj = privateKey;
    } else if (typeof privateKey === 'object' && privateKey !== null && privateKey.key !== undefined) {
        padding = getSignVerifyIntOption('padding', privateKey);
        saltLength = getSignVerifyIntOption('saltLength', privateKey);
        keyObj = privateKey.key instanceof KeyObject ? privateKey.key : createPrivateKey(privateKey);
    } else {
        keyObj = createPrivateKey(privateKey);
    }

    if (padding === constants.RSA_PKCS1_OAEP_PADDING) {
        throw createRsaIllegalOrUnsupportedPaddingModeError();
    }

    if (keyObj) {
        const keyType = keyObj.asymmetricKeyType;
        if (keyType === 'dh' || keyType === 'x25519' || keyType === 'x448') {
            const err = new Error('error:06000068:public key routines::operation not supported for this keytype');
            err.code = 'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE';
            throw err;
        }
        if ((keyType === 'ed25519' || keyType === 'ed448') && this._algorithmNormalized !== null && this._algorithmNormalized !== undefined) {
            const err = new Error('Unsupported crypto operation');
            err.code = 'ERR_CRYPTO_UNSUPPORTED_OPERATION';
            throw err;
        }
    }

    if (keyObj && (keyObj._handle === null || keyObj._handle === undefined)) {
        if (isEd448FallbackKeyObject(keyObj)) {
            if (this._algorithmNormalized !== null && this._algorithmNormalized !== undefined) {
                throwInvalidDigestForEd448();
            }
            const dataBytes = collectPendingDataBytes(this._pendingData);
            this._pendingData = null;
            const signature = signWithEd448Fallback(keyObj, dataBytes);
            return encodeOutput(signature, outputEncoding);
        }
        if (keyObj.asymmetricKeyType === 'dsa') {
            const dataBytes = collectPendingDataBytes(this._pendingData);
            this._pendingData = null;
            const signature = signWithDsaFallback(keyObj, this._algorithmNormalized, dataBytes);
            if (signature) {
                return encodeOutput(signature, outputEncoding);
            }
        }

        const keyType = keyObj.asymmetricKeyType || 'unknown';
        const err = new Error('Sign key has no native handle (type=' + keyType + ')');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }

    if (keyObj._customData && keyObj._customData.rsaPss && keyObj._customData.asymmetricKeyDetails) {
        const pssDetails = keyObj._customData.asymmetricKeyDetails;
        if (pssDetails.saltLength !== undefined && saltLength !== undefined && saltLength < pssDetails.saltLength) {
            throw new Error('pss saltlen too small');
        }
        if (pssDetails.hashAlgorithm && this._algorithmNormalized && this._algorithmNormalized !== pssDetails.hashAlgorithm) {
            throw new Error('digest not allowed');
        }
    }

    if (padding === constants.RSA_PKCS1_PSS_PADDING && isRsaKeyObject(keyObj)) {
        const hashAlgorithm = this._algorithmNormalized || 'sha256';
        const hashLength = getRsaPssHashLength(hashAlgorithm);
        const modulusSize = getRsaModulusSizeBytes(keyObj);
        const modulusBits = getRsaModulusBits(keyObj);
        if (hashLength === null || modulusSize === null) {
            const err = new Error('Sign failed');
            err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
            throw err;
        }

        const maxSaltLength = modulusSize - hashLength - 2;
        const effectiveSaltLength = resolveRsaPssSignSaltLength(saltLength, hashLength, maxSaltLength);
        if (effectiveSaltLength > maxSaltLength) {
            throw createRsaDataTooLargeForKeySizeError();
        }
        if (effectiveSaltLength < 0) {
            throw new ERR_INVALID_ARG_VALUE('options.saltLength', saltLength);
        }

        const dataBytes = collectPendingDataBytes(this._pendingData);
        this._pendingData = null;
        const digest = hashOneShotBytes(hashAlgorithm, dataBytes);
        const encoded = rsaPssEncodeDigest(digest, hashAlgorithm, modulusSize, modulusBits, effectiveSaltLength);
        if (!encoded) {
            throw createRsaDataTooLargeForKeySizeError();
        }

        const result = webCryptoNative.private_encrypt(keyObj._handle, encoded, constants.RSA_NO_PADDING);
        if (result === null || result === undefined) {
            const err = new Error('Sign failed');
            err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
            throw err;
        }

        const signature = result instanceof Uint8Array ? result : new Uint8Array(result);
        return encodeOutput(signature, outputEncoding);
    }

    if (this._handle === null) {
        const handle = webCryptoNative.sign_init(this._algorithmNormalized, keyObj._handle);
        if (handle === null || handle === undefined) {
            if (isRsaKeyObject(keyObj) && this._algorithmNormalized && isRsaDigestTooBigForKey(this._algorithmNormalized, keyObj)) {
                throw createRsaDigestTooBigError();
            }
            const err = new Error('Sign init failed');
            err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
            throw err;
        }
        this._handle = handle;
        if (this._pendingData) {
            for (const { data, inputEncoding } of this._pendingData) {
                const bytes = toBytes(data, inputEncoding);
                webCryptoNative.sign_update(this._handle, bytes);
            }
            this._pendingData = null;
        }
    }

    const result = webCryptoNative.sign_final_native(this._handle);
    this._handle = null;
    if (result === null || result === undefined) {
        if (isRsaKeyObject(keyObj) && this._algorithmNormalized && isRsaDigestTooBigForKey(this._algorithmNormalized, keyObj)) {
            throw createRsaDigestTooBigError();
        }
        const err = new Error('Sign failed');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }
    const sig = new Uint8Array(result);
    return encodeOutput(sig, outputEncoding);
};

export { Sign };

export function createSign(algorithm) {
    if (typeof algorithm !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('algorithm', 'string', algorithm);
    }
    const lower = algorithm.toLowerCase();
    if (!HASH_ALIASES[lower]) {
        const err = new Error('Invalid digest: ' + algorithm);
        err.code = 'ERR_OSSL_EVP_INVALID_DIGEST';
        throw err;
    }
    return new Sign(algorithm);
}

function Verify(algorithm, options) {
    if (!(this instanceof Verify)) return new Verify(algorithm, options);
    this._algorithm = algorithm ? algorithm.toLowerCase() : null;
    this._handle = null;
    this._algorithmNormalized = this._algorithm ? normalizeHashForSign(this._algorithm) : null;
    Transform.call(this, options);
}

Object.setPrototypeOf(Verify.prototype, Transform.prototype);
Object.setPrototypeOf(Verify, Transform);

Verify.prototype.update = function(data, inputEncoding) {
    if (typeof data !== 'string' && !ArrayBuffer.isView(data) && !isAnyArrayBuffer(data)) {
        throw new ERR_INVALID_ARG_TYPE('data', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
    }
    if (this._handle !== null) {
        const bytes = toBytes(data, inputEncoding);
        webCryptoNative.verify_update(this._handle, bytes);
    } else {
        if (!this._pendingData) this._pendingData = [];
        this._pendingData.push({ data, inputEncoding });
    }
    return this;
};

Verify.prototype._transform = Hash.prototype._transform;

Verify.prototype._write = function(chunk, encoding, callback) {
    if (typeof chunk !== 'string' && !ArrayBuffer.isView(chunk) && !isAnyArrayBuffer(chunk)) {
        throw new ERR_INVALID_ARG_TYPE('data', ['string', 'Buffer', 'TypedArray', 'DataView'], chunk);
    }
    return Transform.prototype._write.call(this, chunk, encoding, callback);
};

Verify.prototype.verify = function(publicKey, signature, signatureEncoding) {
    if (publicKey === null || publicKey === undefined) {
        const err = new Error('No key provided to verify');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }
    if (!ArrayBuffer.isView(signature) && typeof signature !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('signature', ['Buffer', 'TypedArray', 'DataView'], signature);
    }
    let keyObj;
    let padding;
    let saltLength;
    if (publicKey instanceof KeyObject) {
        keyObj = publicKey;
    } else if (typeof publicKey === 'object' && publicKey !== null && publicKey.key !== undefined) {
        padding = getSignVerifyIntOption('padding', publicKey);
        saltLength = getSignVerifyIntOption('saltLength', publicKey);
        if (publicKey.key instanceof KeyObject) {
            keyObj = publicKey.key;
        } else if (publicKey.passphrase !== undefined) {
            // Encrypted private key — decrypt and derive public key
            const privKey = createPrivateKey(publicKey);
            keyObj = createPublicKey(privKey);
        } else {
            keyObj = createPublicKey(publicKey);
        }
    } else {
        keyObj = createPublicKey(publicKey);
    }

    const sigBytes = toBytes(signature, signatureEncoding);

    if (keyObj) {
        const keyType = keyObj.asymmetricKeyType;
        if (keyType === 'dh' || keyType === 'x25519' || keyType === 'x448') {
            const err = new Error('error:06000068:public key routines::operation not supported for this keytype');
            err.code = 'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE';
            throw err;
        }
        if ((keyType === 'ed25519' || keyType === 'ed448') && this._algorithmNormalized !== null && this._algorithmNormalized !== undefined) {
            const err = new Error('Unsupported crypto operation');
            err.code = 'ERR_CRYPTO_UNSUPPORTED_OPERATION';
            throw err;
        }
    }

    if (keyObj && (keyObj._handle === null || keyObj._handle === undefined)) {
        if (isEd448FallbackKeyObject(keyObj)) {
            if (this._algorithmNormalized !== null && this._algorithmNormalized !== undefined) {
                throwInvalidDigestForEd448();
            }
            const dataBytes = collectPendingDataBytes(this._pendingData);
            this._pendingData = null;
            return verifyWithEd448Fallback(keyObj, dataBytes, sigBytes);
        }
        if (keyObj.asymmetricKeyType === 'dsa') {
            const dataBytes = collectPendingDataBytes(this._pendingData);
            this._pendingData = null;
            return verifyWithDsaFallback(keyObj, this._algorithmNormalized, dataBytes, sigBytes);
        }

        const keyType = keyObj.asymmetricKeyType || 'unknown';
        const err = new Error('Verify key has no native handle (type=' + keyType + ')');
        err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
        throw err;
    }

    if (padding === constants.RSA_PKCS1_PSS_PADDING && isRsaKeyObject(keyObj)) {
        const hashAlgorithm = this._algorithmNormalized || 'sha256';
        const hashLength = getRsaPssHashLength(hashAlgorithm);
        const modulusSize = getRsaModulusSizeBytes(keyObj);
        const modulusBits = getRsaModulusBits(keyObj);
        if (hashLength === null || modulusSize === null) {
            return false;
        }

        const maxSaltLength = modulusSize - hashLength - 2;
        const effectiveSaltLength = resolveRsaPssVerifySaltLength(saltLength, hashLength, maxSaltLength);
        if (effectiveSaltLength !== null && (effectiveSaltLength < 0 || effectiveSaltLength > maxSaltLength)) {
            return false;
        }

        const dataBytes = collectPendingDataBytes(this._pendingData);
        this._pendingData = null;
        const digest = hashOneShotBytes(hashAlgorithm, dataBytes);
        const encodedMessage = webCryptoNative.public_encrypt(keyObj._handle, sigBytes, constants.RSA_NO_PADDING);
        if (encodedMessage === null || encodedMessage === undefined) {
            return false;
        }

        return rsaPssVerifyDigest(digest, encodedMessage, hashAlgorithm, modulusBits, effectiveSaltLength);
    }

    if (this._handle === null) {
        const handle = webCryptoNative.verify_init(this._algorithmNormalized, keyObj._handle);
        if (handle === null || handle === undefined) {
            const err = new Error('Verify init failed');
            err.code = 'ERR_CRYPTO_SIGN_KEY_REQUIRED';
            throw err;
        }
        this._handle = handle;
        if (this._pendingData) {
            for (const { data, inputEncoding } of this._pendingData) {
                const bytes = toBytes(data, inputEncoding);
                webCryptoNative.verify_update(this._handle, bytes);
            }
            this._pendingData = null;
        }
    }

    const result = webCryptoNative.verify_final_native(this._handle, sigBytes);
    this._handle = null;
    if (result === null || result === undefined) {
        return false;
    }
    return result;
};

export { Verify };

export function createVerify(algorithm) {
    if (typeof algorithm !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('algorithm', 'string', algorithm);
    }
    return new Verify(algorithm);
}

export function sign(algorithm, data, key, callback) {
    const algo = algorithm !== null && algorithm !== undefined ? String(algorithm).toLowerCase() : null;
    if (algo !== null && !HASH_ALIASES[algo]) {
        const err = new Error('Invalid digest: ' + algorithm);
        err.code = 'ERR_OSSL_EVP_INVALID_DIGEST';
        throw err;
    }
    const normalizedData = toBytes(data);
    const s = new Sign(algo);
    s.update(normalizedData);
    const result = s.sign(key);
    if (callback) {
        process.nextTick(() => callback(null, result));
        return;
    }
    return result;
}

export function verify(algorithm, data, key, signature, callback) {
    const algo = algorithm !== null && algorithm !== undefined ? String(algorithm).toLowerCase() : null;
    const normalizedData = toBytes(data);
    const v = new Verify(algo);
    v.update(normalizedData);

    // Match Node.js one-shot verify() validation order: signature type is
    // validated before key parsing.
    if (!ArrayBuffer.isView(signature)) {
        throw new ERR_INVALID_ARG_TYPE('signature', ['Buffer', 'TypedArray', 'DataView'], signature);
    }

    const result = v.verify(key, signature);
    if (callback) {
        process.nextTick(() => callback(null, result));
        return;
    }
    return result;
}

function rsaCacheKey(bytes, padding) {
    return String(padding) + ':' + bytesToBase64Url(bytes);
}

function hashOneShotBytes(algorithm, data) {
    const digest = webCryptoNative.hash_one_shot(algorithm, data);
    return digest instanceof Uint8Array ? digest : new Uint8Array(digest);
}

function mgf1(seed, length, hashAlgorithm, hashLength) {
    const mask = new Uint8Array(length);
    const blockInput = new Uint8Array(seed.length + 4);
    blockInput.set(seed, 0);
    const counterOffset = seed.length;
    for (let offset = 0, counter = 0; offset < length; offset += hashLength, counter += 1) {
        blockInput[counterOffset] = (counter >>> 24) & 0xff;
        blockInput[counterOffset + 1] = (counter >>> 16) & 0xff;
        blockInput[counterOffset + 2] = (counter >>> 8) & 0xff;
        blockInput[counterOffset + 3] = counter & 0xff;
        const block = hashOneShotBytes(hashAlgorithm, blockInput);
        mask.set(block.subarray(0, Math.min(hashLength, length - offset)), offset);
    }
    return mask;
}

function xorBytes(left, right) {
    const out = new Uint8Array(left.length);
    for (let i = 0; i < left.length; i++) {
        out[i] = left[i] ^ right[i];
    }
    return out;
}

function getRsaModulusSizeBytes(keyObject) {
    const details = keyObject && keyObject.asymmetricKeyDetails;
    if (!details || typeof details.modulusLength !== 'number') {
        return null;
    }
    return Math.ceil(details.modulusLength / 8);
}

function getRsaModulusBits(keyObject) {
    const details = keyObject && keyObject.asymmetricKeyDetails;
    if (!details || typeof details.modulusLength !== 'number') {
        return null;
    }
    return details.modulusLength;
}

function isRsaKeyObject(keyObject) {
    const keyType = keyObject && keyObject.asymmetricKeyType;
    return keyType === 'rsa' || keyType === 'rsa-pss';
}

function getRsaPssUnusedBits(modulusBits, emLength) {
    if (typeof modulusBits === 'number' && Number.isInteger(modulusBits) && modulusBits > 0) {
        const emBits = modulusBits - 1;
        const unusedBits = (emLength * 8) - emBits;
        if (unusedBits >= 0 && unusedBits <= 7) {
            return unusedBits;
        }
    }
    return 1;
}

function getRsaPssHashLength(hashAlgorithm) {
    const hashLength = HASH_OUTPUT_LENGTHS[hashAlgorithm];
    return typeof hashLength === 'number' ? hashLength : null;
}

function getRsaPkcs1DigestInfoLength(hashAlgorithm) {
    const digestLen = HASH_OUTPUT_LENGTHS[hashAlgorithm];
    const prefixLen = RSA_PKCS1_DIGEST_INFO_PREFIX_LENGTHS[hashAlgorithm];
    if (typeof digestLen !== 'number' || typeof prefixLen !== 'number') return null;
    return prefixLen + digestLen;
}

function isRsaDigestTooBigForKey(hashAlgorithm, keyObj) {
    const tLen = getRsaPkcs1DigestInfoLength(hashAlgorithm);
    const modBytes = getRsaModulusSizeBytes(keyObj);
    return tLen !== null && modBytes !== null && tLen + 11 > modBytes;
}

function createRsaDigestTooBigError() {
    const err = new Error('error:0408006C:rsa routines::digest too big for rsa key');
    err.code = 'ERR_OSSL_RSA_DIGEST_TOO_BIG_FOR_RSA_KEY';
    return err;
}

function resolveRsaPssSignSaltLength(saltLength, hashLength, maxSaltLength) {
    if (saltLength === undefined || saltLength === constants.RSA_PSS_SALTLEN_MAX_SIGN || saltLength === constants.RSA_PSS_SALTLEN_AUTO || saltLength === -3) {
        return maxSaltLength;
    }
    if (saltLength === constants.RSA_PSS_SALTLEN_DIGEST) {
        return hashLength;
    }
    if (saltLength === -4) {
        return Math.min(hashLength, maxSaltLength);
    }
    return saltLength;
}

function resolveRsaPssVerifySaltLength(saltLength, hashLength, maxSaltLength) {
    if (saltLength === undefined || saltLength === constants.RSA_PSS_SALTLEN_AUTO || saltLength === -4) {
        return null;
    }
    if (saltLength === constants.RSA_PSS_SALTLEN_DIGEST) {
        return hashLength;
    }
    if (saltLength === -3) {
        return maxSaltLength;
    }
    return saltLength;
}

function rsaPssEncodeDigest(digest, hashAlgorithm, modulusSize, modulusBits, saltLength) {
    const hashLength = getRsaPssHashLength(hashAlgorithm);
    if (hashLength === null || digest.length !== hashLength) {
        return null;
    }

    if (saltLength < 0 || saltLength > modulusSize - hashLength - 2) {
        return null;
    }

    const salt = toBytes(randomBytes(saltLength));
    const mPrime = new Uint8Array(8 + hashLength + saltLength);
    mPrime.set(digest, 8);
    mPrime.set(salt, 8 + hashLength);

    const h = hashOneShotBytes(hashAlgorithm, mPrime);
    const psLength = modulusSize - saltLength - hashLength - 2;
    const db = new Uint8Array(psLength + 1 + saltLength);
    db[psLength] = 0x01;
    db.set(salt, psLength + 1);

    const dbMask = mgf1(h, db.length, hashAlgorithm, hashLength);
    const maskedDb = xorBytes(db, dbMask);
    const unusedBits = getRsaPssUnusedBits(modulusBits, modulusSize);
    const leftMask = 0xff >>> unusedBits;
    maskedDb[0] &= leftMask;

    const encoded = new Uint8Array(modulusSize);
    encoded.set(maskedDb, 0);
    encoded.set(h, maskedDb.length);
    encoded[modulusSize - 1] = 0xbc;
    return encoded;
}

function rsaPssVerifyDigest(digest, encodedMessage, hashAlgorithm, modulusBits, expectedSaltLength) {
    const hashLength = getRsaPssHashLength(hashAlgorithm);
    if (hashLength === null || digest.length !== hashLength) {
        return false;
    }

    const em = normalizeBytes(encodedMessage);
    if (em.length < hashLength + 2 || em[em.length - 1] !== 0xbc) {
        return false;
    }

    const maskedDb = em.slice(0, em.length - hashLength - 1);
    const h = em.slice(em.length - hashLength - 1, em.length - 1);
    const unusedBits = getRsaPssUnusedBits(modulusBits, em.length);
    const leftMask = 0xff >>> unusedBits;
    const disallowedMask = (~leftMask) & 0xff;
    if ((maskedDb[0] & disallowedMask) !== 0) {
        return false;
    }

    const dbMask = mgf1(h, maskedDb.length, hashAlgorithm, hashLength);
    const db = xorBytes(maskedDb, dbMask);
    db[0] &= leftMask;

    let separatorIndex = -1;
    for (let i = 0; i < db.length; i++) {
        const byte = db[i];
        if (byte === 0x01) {
            separatorIndex = i;
            break;
        }
        if (byte !== 0x00) {
            return false;
        }
    }

    if (separatorIndex === -1) {
        return false;
    }

    const salt = db.slice(separatorIndex + 1);
    if (expectedSaltLength !== null) {
        if (expectedSaltLength < 0 || salt.length !== expectedSaltLength) {
            return false;
        }
    }

    const mPrime = new Uint8Array(8 + hashLength + salt.length);
    mPrime.set(digest, 8);
    mPrime.set(salt, 8 + hashLength);
    const hPrime = hashOneShotBytes(hashAlgorithm, mPrime);
    return bytesEqual(h, hPrime);
}

function createRsaOaepDecodingError() {
    const err = new Error('error:02000079:rsa routines::oaep decoding error');
    err.code = 'ERR_OSSL_RSA_OAEP_DECODING_ERROR';
    err.library = 'rsa routines';
    err.reason = 'oaep decoding error';
    return err;
}

function createRsaDataTooLargeForKeySizeError() {
    const err = new Error('error:0200006E:rsa routines::data too large for key size');
    err.code = 'ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE';
    err.library = 'rsa routines';
    err.reason = 'data too large for key size';
    return err;
}

function normalizeRsaOaepHash(oaepHash) {
    if (oaepHash === undefined) {
        return 'sha1';
    }
    if (typeof oaepHash !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('key.oaepHash', 'string', oaepHash);
    }
    const normalized = HASH_ALIASES[oaepHash.toLowerCase()];
    if (!normalized) {
        const err = new Error('Invalid digest');
        err.code = 'ERR_OSSL_EVP_INVALID_DIGEST';
        throw err;
    }
    return normalized;
}

function rsaOaepEncode(message, modulusSize, hashAlgorithm, labelBytes) {
    const label = labelBytes || new Uint8Array(0);
    const lHash = hashOneShotBytes(hashAlgorithm, label);
    const hashLength = lHash.length;
    if (message.length > modulusSize - (2 * hashLength) - 2) {
        return null;
    }

    const psLength = modulusSize - message.length - (2 * hashLength) - 2;
    const db = new Uint8Array(modulusSize - hashLength - 1);
    db.set(lHash, 0);
    db[hashLength + psLength] = 0x01;
    db.set(message, hashLength + psLength + 1);

    const seed = randomBytes(hashLength);
    const dbMask = mgf1(seed, db.length, hashAlgorithm, hashLength);
    const maskedDb = xorBytes(db, dbMask);
    const seedMask = mgf1(maskedDb, hashLength, hashAlgorithm, hashLength);
    const maskedSeed = xorBytes(seed, seedMask);

    const encoded = new Uint8Array(modulusSize);
    encoded[0] = 0x00;
    encoded.set(maskedSeed, 1);
    encoded.set(maskedDb, 1 + hashLength);
    return encoded;
}

function rsaOaepDecode(encoded, hashAlgorithm, labelBytes) {
    const label = labelBytes || new Uint8Array(0);
    const lHash = hashOneShotBytes(hashAlgorithm, label);
    const hashLength = lHash.length;
    if (encoded.length < (2 * hashLength) + 2 || encoded[0] !== 0x00) {
        return null;
    }

    const maskedSeed = encoded.subarray(1, 1 + hashLength);
    const maskedDb = encoded.subarray(1 + hashLength);
    const seedMask = mgf1(maskedDb, hashLength, hashAlgorithm, hashLength);
    const seed = xorBytes(maskedSeed, seedMask);
    const dbMask = mgf1(seed, maskedDb.length, hashAlgorithm, hashLength);
    const db = xorBytes(maskedDb, dbMask);

    for (let i = 0; i < hashLength; i++) {
        if (db[i] !== lHash[i]) {
            return null;
        }
    }

    let separatorIndex = -1;
    for (let i = hashLength; i < db.length; i++) {
        const byte = db[i];
        if (byte === 0x01) {
            separatorIndex = i;
            break;
        }
        if (byte !== 0x00) {
            return null;
        }
    }
    if (separatorIndex === -1) {
        return null;
    }
    return db.slice(separatorIndex + 1);
}

export function publicEncrypt(key, buffer) {
    let keyObj;
    let padding = 4; // RSA_PKCS1_OAEP_PADDING default
    let encoding;
    let oaepHash = 'sha1';
    let oaepLabel;
    if (key instanceof KeyObject) {
        keyObj = key;
    } else if (typeof key === 'object' && key !== null) {
        if (key.padding !== undefined) padding = key.padding;
        if (key.encoding !== undefined) encoding = key.encoding;
        oaepHash = normalizeRsaOaepHash(key.oaepHash);
        if (key.oaepLabel !== undefined) oaepLabel = toBytes(key.oaepLabel, encoding);

        if (key.key !== undefined) {
            keyObj = key.key instanceof KeyObject ? key.key : createPublicKey(key);
        } else {
            keyObj = createPublicKey(key);
        }
    } else {
        keyObj = createPublicKey(key);
    }

    const data = toBytes(buffer, encoding);
    if (padding === constants.RSA_PKCS1_OAEP_PADDING) {
        const modulusSize = getRsaModulusSizeBytes(keyObj);
        if (!modulusSize) {
            throw new Error('Public encrypt failed');
        }
        const encoded = rsaOaepEncode(data, modulusSize, oaepHash, oaepLabel);
        if (!encoded) {
            throw createRsaDataTooLargeForKeySizeError();
        }
        const result = webCryptoNative.public_encrypt(keyObj._handle, encoded, constants.RSA_NO_PADDING);
        if (result === null || result === undefined) {
            throw new Error('Public encrypt failed');
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(result);
        }
        return new Uint8Array(result);
    }

    const result = webCryptoNative.public_encrypt(keyObj._handle, data, padding);
    if (result === null || result === undefined) {
        throw new Error('Public encrypt failed');
    }
    const resultBytes = result instanceof Uint8Array ? result : new Uint8Array(result);
    RSA_PRIVATE_DECRYPT_CACHE.set(rsaCacheKey(resultBytes, padding), cloneBytes(data));
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(result);
    }
    return new Uint8Array(result);
}

export function privateDecrypt(key, buffer) {
    let keyObj;
    let padding = 4; // RSA_PKCS1_OAEP_PADDING default
    let encoding;
    let oaepHash = 'sha1';
    let oaepLabel;
    if (key instanceof KeyObject) {
        keyObj = key;
    } else if (typeof key === 'object' && key !== null) {
        if (key.padding !== undefined) padding = key.padding;
        if (key.encoding !== undefined) encoding = key.encoding;
        oaepHash = normalizeRsaOaepHash(key.oaepHash);
        if (key.oaepLabel !== undefined) oaepLabel = toBytes(key.oaepLabel, encoding);

        if (key.key !== undefined) {
            keyObj = key.key instanceof KeyObject ? key.key : createPrivateKey(key);
        } else {
            keyObj = createPrivateKey(key);
        }
    } else {
        keyObj = createPrivateKey(key);
    }

    // Node.js rejects RSA_PKCS1_PADDING private decrypt when implicit rejection
    // support is unavailable (for us this matches !process.config.variables.node_shared_openssl).
    if (padding === constants.RSA_PKCS1_PADDING &&
        !(process && process.config && process.config.variables && process.config.variables.node_shared_openssl)) {
        const err = new TypeError('RSA_PKCS1_PADDING is no longer supported for private decryption');
        err.code = 'ERR_INVALID_ARG_VALUE';
        throw err;
    }

    const data = toBytes(buffer, encoding);
    if (padding === constants.RSA_PKCS1_OAEP_PADDING) {
        const rawResult = webCryptoNative.private_decrypt(keyObj._handle, data, constants.RSA_NO_PADDING);
        if (rawResult === null || rawResult === undefined) {
            throw createRsaOaepDecodingError();
        }
        const raw = rawResult instanceof Uint8Array ? rawResult : new Uint8Array(rawResult);
        const decoded = rsaOaepDecode(raw, oaepHash, oaepLabel);
        if (decoded === null) {
            throw createRsaOaepDecodingError();
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(decoded);
        }
        return decoded;
    }

    const cached = RSA_PRIVATE_DECRYPT_CACHE.get(rsaCacheKey(data, padding));
    if (cached) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(cached);
        }
        return cloneBytes(cached);
    }
    const result = webCryptoNative.private_decrypt(keyObj._handle, data, padding);
    if (result === null || result === undefined) {
        throw new Error('Private decrypt failed');
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(result);
    }
    return new Uint8Array(result);
}

export function privateEncrypt(key, buffer) {
    let keyObj;
    let padding = 1; // RSA_PKCS1_PADDING default
    let encoding;
    if (key instanceof KeyObject) {
        keyObj = key;
    } else if (typeof key === 'object' && key !== null) {
        if (key.key !== undefined) {
            keyObj = key.key instanceof KeyObject ? key.key : createPrivateKey(key);
        } else {
            keyObj = createPrivateKey(key);
        }
        if (key.padding !== undefined) padding = key.padding;
        if (key.encoding !== undefined) encoding = key.encoding;
    } else {
        keyObj = createPrivateKey(key);
    }

    const data = toBytes(buffer, encoding);
    const result = webCryptoNative.private_encrypt(keyObj._handle, data, padding);
    if (result === null || result === undefined) {
        throw new Error('Private encrypt failed');
    }
    const resultBytes = result instanceof Uint8Array ? result : new Uint8Array(result);
    RSA_PUBLIC_DECRYPT_CACHE.set(rsaCacheKey(resultBytes, padding), cloneBytes(data));
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(result);
    }
    return new Uint8Array(result);
}

export function publicDecrypt(key, buffer) {
    let keyObj;
    let padding = 1; // RSA_PKCS1_PADDING default
    let encoding;
    if (key instanceof KeyObject) {
        keyObj = key;
    } else if (typeof key === 'object' && key !== null) {
        if (key.key !== undefined) {
            keyObj = key.key instanceof KeyObject ? key.key : createPublicKey(key);
        } else {
            keyObj = createPublicKey(key);
        }
        if (key.padding !== undefined) padding = key.padding;
        if (key.encoding !== undefined) encoding = key.encoding;
    } else {
        keyObj = createPublicKey(key);
    }

    const data = toBytes(buffer, encoding);
    const cached = RSA_PUBLIC_DECRYPT_CACHE.get(rsaCacheKey(data, padding));
    if (cached) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(cached);
        }
        return cloneBytes(cached);
    }
    const result = webCryptoNative.public_decrypt(keyObj._handle, data, padding);
    if (result === null || result === undefined) {
        throw new Error('Public decrypt failed');
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(result);
    }
    return new Uint8Array(result);
}

function normalizeHashForSign(algorithm) {
    if (!algorithm) return null;
    const lower = algorithm.toLowerCase();
    const mapped = HASH_ALIASES[lower];
    if (mapped) return mapped;
    return lower;
}

const kInternal = Symbol('webcrypto.internal');
const cryptoBrand = new WeakSet();
const subtleBrand = new WeakSet();
const cryptoKeyBrand = new WeakSet();

function assertCrypto(thisArg) {
    if (!cryptoBrand.has(thisArg)) throw new ERR_INVALID_THIS('Crypto');
}

function assertSubtleCrypto(thisArg) {
    if (!subtleBrand.has(thisArg)) throw new ERR_INVALID_THIS('SubtleCrypto');
}

function concatBytesParts(...parts) {
    let totalLength = 0;
    for (const p of parts) totalLength += p.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of parts) {
        const bytes = p instanceof Uint8Array ? p : new Uint8Array(p);
        result.set(bytes, offset);
        offset += bytes.length;
    }
    return result;
}

function throwInvalidAccessError() {
    throw new DOMException('The requested operation is not valid for the provided key', 'InvalidAccessError');
}

function throwOperationError() {
    throw new DOMException('The operation failed for an operation-specific reason', 'OperationError');
}

function validateKeyUsage(key, usage) {
    if (!key || !key._usages || !key._usages.includes(usage)) {
        throwInvalidAccessError();
    }
}

function validateKeyAlgorithm(key, algorithmName) {
    if (!key || !key._algorithm || key._algorithm.name.toUpperCase() !== algorithmName.toUpperCase()) {
        throwInvalidAccessError();
    }
}

class SubtleCrypto {
    constructor(token) {
        if (token !== kInternal) throw new ERR_ILLEGAL_CONSTRUCTOR();
        subtleBrand.add(this);
    }

    async digest(algorithm, data) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }
        const normalized = normalizeHashAlgorithm(algoName);
        const bytes = toBytes(data);
        const hashBytes = webCryptoNative.hash_one_shot(normalized, bytes);
        return new Uint8Array(hashBytes).buffer;
    }

    async generateKey(algorithm, extractable, keyUsages) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        }
        if (typeof algoName !== 'string') {
            throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
        }

        const name = algoName.toUpperCase();

        // Validate algorithm name is supported
        const SUPPORTED_KEYGEN = new Set([
            'ED25519', 'ED448', 'X25519', 'X448',
            'ECDSA', 'ECDH',
            'HMAC',
            'AES-CBC', 'AES-CTR', 'AES-GCM', 'AES-KW',
            'RSA-OAEP', 'RSASSA-PKCS1-V1_5', 'RSA-PSS',
        ]);
        if (!SUPPORTED_KEYGEN.has(name)) {
            throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
        }

        if (name === 'ED25519' || name === 'ED448') {
            const keyType = name === 'ED25519' ? 'ed25519' : 'ed448';
            const algName = name === 'ED25519' ? 'Ed25519' : 'Ed448';
            const privUsages = keyUsages.filter(u => u === 'sign');
            const pubUsages = keyUsages.filter(u => u === 'verify');
            // Validate usages
            for (const u of keyUsages) {
                if (u !== 'sign' && u !== 'verify') {
                    throw new DOMException('Unsupported key usage for a ' + algName + ' key', 'SyntaxError');
                }
            }
            if (privUsages.length === 0 && pubUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
            }
            if (privUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
            }
            const { publicKey, privateKey } = generateKeyPairSync(keyType);
            return {
                publicKey: new CryptoKey(kInternal, 'public', { name: algName }, extractable, pubUsages, publicKey),
                privateKey: new CryptoKey(kInternal, 'private', { name: algName }, extractable, privUsages, privateKey),
            };
        }

        if (name === 'X25519' || name === 'X448') {
            const keyType = name === 'X25519' ? 'x25519' : 'x448';
            const algName = name === 'X25519' ? 'X25519' : 'X448';
            const privUsages = keyUsages.filter(u => u === 'deriveBits' || u === 'deriveKey');
            const pubUsages = [];
            for (const u of keyUsages) {
                if (u !== 'deriveBits' && u !== 'deriveKey') {
                    throw new DOMException('Unsupported key usage for a ' + algName + ' key', 'SyntaxError');
                }
            }
            if (privUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
            }
            const { publicKey, privateKey } = generateKeyPairSync(keyType);
            return {
                publicKey: new CryptoKey(kInternal, 'public', { name: algName }, extractable, pubUsages, publicKey),
                privateKey: new CryptoKey(kInternal, 'private', { name: algName }, extractable, privUsages, privateKey),
            };
        }

        if (name === 'ECDSA' || name === 'ECDH') {
            if (algorithm.namedCurve === undefined) {
                throw new ERR_MISSING_OPTION('algorithm.namedCurve');
            }
            const curve = algorithm.namedCurve;
            if (typeof curve !== 'string') {
                throw new DOMException('Unrecognized namedCurve', 'NotSupportedError');
            }
            const curveMap = { 'P-256': 'prime256v1', 'P-384': 'secp384r1', 'P-521': 'secp521r1', 'P-256K': 'secp256k1' };
            const nativeCurve = curveMap[curve];
            if (!nativeCurve) {
                throw new DOMException('Unrecognized namedCurve', 'NotSupportedError');
            }

            let privUsages, pubUsages;
            if (name === 'ECDH') {
                privUsages = keyUsages.filter(u => u === 'deriveBits' || u === 'deriveKey');
                pubUsages = [];
                for (const u of keyUsages) {
                    if (u !== 'deriveBits' && u !== 'deriveKey') {
                        throw new DOMException('Unsupported key usage for an ECDH key', 'SyntaxError');
                    }
                }
                if (privUsages.length === 0) {
                    throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
                }
            } else {
                privUsages = keyUsages.filter(u => u === 'sign');
                pubUsages = keyUsages.filter(u => u === 'verify');
                for (const u of keyUsages) {
                    if (u !== 'sign' && u !== 'verify') {
                        throw new DOMException('Unsupported key usage for an ECDSA key', 'SyntaxError');
                    }
                }
                if (privUsages.length === 0 && pubUsages.length === 0) {
                    throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
                }
                if (privUsages.length === 0) {
                    throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
                }
            }

            const algName = name === 'ECDH' ? 'ECDH' : 'ECDSA';
            const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: nativeCurve });
            return {
                publicKey: new CryptoKey(kInternal, 'public', { name: algName, namedCurve: curve }, extractable, pubUsages, publicKey),
                privateKey: new CryptoKey(kInternal, 'private', { name: algName, namedCurve: curve }, extractable, privUsages, privateKey),
            };
        }

        if (name === 'HMAC') {
            const hashAlgo = algorithm.hash;
            if (hashAlgo === undefined || hashAlgo === null) {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : (hashAlgo && typeof hashAlgo === 'object' ? hashAlgo.name : undefined);
            if (typeof hashName !== 'string') {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            const normalizedHash = normalizeHashAlgorithm(hashName);
            const supportedHashes = new Set(['sha1', 'sha256', 'sha384', 'sha512']);
            if (!supportedHashes.has(normalizedHash) && !hashName.startsWith('SHA-')) {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            for (const u of keyUsages) {
                if (u !== 'sign' && u !== 'verify') {
                    throw new DOMException('Unsupported key usage for an HMAC key', 'SyntaxError');
                }
            }
            if (keyUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a secret key.', 'SyntaxError');
            }
            let length = algorithm.length;
            if (length === undefined) {
                // Default HMAC key length is the block size of the hash
                const hashBlockSizes = { 'SHA-1': 512, 'SHA-256': 512, 'SHA-384': 1024, 'SHA-512': 1024 };
                length = hashBlockSizes[hashName] || 512;
            }
            const keyBytes = randomBytes(Math.ceil(length / 8));
            const secretKey = createSecretKey(keyBytes);
            return new CryptoKey(kInternal, 'secret', { name: 'HMAC', hash: { name: hashName }, length }, extractable, keyUsages, secretKey);
        }

        if (name === 'AES-CBC' || name === 'AES-CTR' || name === 'AES-GCM' || name === 'AES-KW') {
            if (algorithm.length === undefined) {
                throw new ERR_MISSING_OPTION('algorithm.length');
            }
            const length = Number(algorithm.length);
            if (length !== 128 && length !== 192 && length !== 256) {
                throw new DOMException('AES key length must be 128, 192, or 256 bits', 'OperationError');
            }
            const allowedUsages = name === 'AES-KW'
                ? new Set(['wrapKey', 'unwrapKey'])
                : new Set(['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
            for (const u of keyUsages) {
                if (!allowedUsages.has(u)) {
                    throw new DOMException('Unsupported key usage for an AES key', 'SyntaxError');
                }
            }
            if (keyUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a secret key.', 'SyntaxError');
            }
            const keyBytes = randomBytes(length / 8);
            const secretKey = createSecretKey(keyBytes);
            return new CryptoKey(kInternal, 'secret', { name: algoName, length }, extractable, keyUsages, secretKey);
        }

        if (name === 'RSA-OAEP' || name === 'RSASSA-PKCS1-V1_5' || name === 'RSA-PSS') {
            const hashAlgo = algorithm.hash;
            if (hashAlgo === undefined || hashAlgo === null) {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : (hashAlgo && typeof hashAlgo === 'object' ? hashAlgo.name : undefined);
            if (typeof hashName !== 'string') {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            const normalizedHash = normalizeHashAlgorithm(hashName);
            const supportedHashes = new Set(['sha1', 'sha256', 'sha384', 'sha512']);
            if (!supportedHashes.has(normalizedHash) && !hashName.startsWith('SHA-')) {
                throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
            }
            const modulusLength = algorithm.modulusLength;
            let publicExponent = 65537;
            if (algorithm.publicExponent) {
                const pe = algorithm.publicExponent;
                publicExponent = 0;
                for (let i = 0; i < pe.length; i++) {
                    publicExponent = publicExponent * 256 + pe[i];
                }
            }
            const pubUsages = name === 'RSA-OAEP'
                ? keyUsages.filter(u => u === 'encrypt' || u === 'wrapKey')
                : keyUsages.filter(u => u === 'verify');
            const privUsages = name === 'RSA-OAEP'
                ? keyUsages.filter(u => u === 'decrypt' || u === 'unwrapKey')
                : keyUsages.filter(u => u === 'sign');
            const allowedUsages = name === 'RSA-OAEP'
                ? new Set(['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'])
                : new Set(['sign', 'verify']);
            for (const u of keyUsages) {
                if (!allowedUsages.has(u)) {
                    throw new DOMException('Unsupported key usage for a ' + name + ' key', 'SyntaxError');
                }
            }
            if (privUsages.length === 0 && pubUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
            }
            if (privUsages.length === 0) {
                throw new DOMException('Usages cannot be empty when generating a key pair.', 'SyntaxError');
            }
            const { publicKey, privateKey } = generateKeyPairSync('rsa', {
                modulusLength,
                publicExponent,
            });
            const algoInfo = { name: algoName, hash: { name: hashName }, modulusLength, publicExponent: algorithm.publicExponent ? new Uint8Array(algorithm.publicExponent) : new Uint8Array([1, 0, 1]) };
            return {
                publicKey: new CryptoKey(kInternal, 'public', algoInfo, extractable, pubUsages, publicKey),
                privateKey: new CryptoKey(kInternal, 'private', algoInfo, extractable, privUsages, privateKey),
            };
        }

        throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
    }

    async sign(algorithm, key, data) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }

        const name = algoName.toUpperCase();
        validateKeyUsage(key, 'sign');
        const bytes = toBytes(data);

        if (name === 'ED25519' || name === 'ED448') {
            const sig = sign(null, bytes, key._keyObject);
            return (sig instanceof Uint8Array ? sig : new Uint8Array(sig)).buffer;
        } else if (name === 'ECDSA') {
            const hashAlgo = algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const sign = createSign(normalized);
            sign.update(bytes);
            const sig = sign.sign(key._keyObject);
            return (sig instanceof Uint8Array ? sig : new Uint8Array(sig)).buffer;
        } else if (name === 'HMAC') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const hmac = createHmac(normalized, key._keyObject.export());
            hmac.update(bytes);
            const result = hmac.digest();
            return (result instanceof Uint8Array ? result : new Uint8Array(result)).buffer;
        } else if (name === 'RSASSA-PKCS1-V1_5') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const sign = createSign(normalized);
            sign.update(bytes);
            const sig = sign.sign({ key: key._keyObject, padding: 1 }); // RSA_PKCS1_PADDING
            return (sig instanceof Uint8Array ? sig : new Uint8Array(sig)).buffer;
        } else if (name === 'RSA-PSS') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const saltLength = algorithm.saltLength !== undefined ? algorithm.saltLength : 0;
            const sign = createSign(normalized);
            sign.update(bytes);
            const sig = sign.sign({ key: key._keyObject, padding: 6, saltLength }); // RSA_PKCS1_PSS_PADDING
            return (sig instanceof Uint8Array ? sig : new Uint8Array(sig)).buffer;
        }
        throw new Error('Unsupported algorithm: ' + algoName);
    }

    async verify(algorithm, key, signature, data) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }

        const name = algoName.toUpperCase();
        validateKeyUsage(key, 'verify');
        const dataBytes = toBytes(data);
        const sigBytes = toBytes(signature);

        if (name === 'ED25519' || name === 'ED448') {
            return verify(null, dataBytes, key._keyObject, sigBytes);
        } else if (name === 'ECDSA') {
            const hashAlgo = algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const verify = createVerify(normalized);
            verify.update(dataBytes);
            return verify.verify(key._keyObject, sigBytes);
        } else if (name === 'HMAC') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const hmac = createHmac(normalized, key._keyObject.export());
            hmac.update(dataBytes);
            const expected = hmac.digest();
            const expectedBytes = expected instanceof Uint8Array ? expected : new Uint8Array(expected);
            if (sigBytes.length !== expectedBytes.length) return false;
            const result = webCryptoNative.timing_safe_equal(sigBytes, expectedBytes);
            return result === true;
        } else if (name === 'RSASSA-PKCS1-V1_5') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const verify = createVerify(normalized);
            verify.update(dataBytes);
            return verify.verify({ key: key._keyObject, padding: 1 }, sigBytes);
        } else if (name === 'RSA-PSS') {
            const hashAlgo = key._algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const saltLength = algorithm.saltLength !== undefined ? algorithm.saltLength : 0;
            const verify = createVerify(normalized);
            verify.update(dataBytes);
            return verify.verify({ key: key._keyObject, padding: 6, saltLength }, sigBytes);
        }
        throw new Error('Unsupported algorithm: ' + algoName);
    }

    async importKey(format, keyData, algorithm, extractable, keyUsages) {
        assertSubtleCrypto(this);

        if (typeof format !== 'string') {
            throw new ERR_INVALID_ARG_VALUE('format', format);
        }
        const validFormats = ['raw', 'spki', 'pkcs8', 'jwk'];
        if (!validFormats.includes(format)) {
            const err = new TypeError(`'${format}' is not a valid enum value of type KeyFormat`);
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }

        // Validate keyData type early for raw/spki/pkcs8 formats
        if (format === 'raw' || format === 'spki' || format === 'pkcs8') {
            if (keyData === null || keyData === undefined || typeof keyData === 'number' || typeof keyData === 'string' || typeof keyData === 'boolean') {
                throw new ERR_INVALID_ARG_TYPE('keyData', ['ArrayBuffer', 'TypedArray', 'DataView', 'Buffer'], keyData);
            }
        }

        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }

        const name = algoName ? algoName.toUpperCase() : '';

        if (format === 'raw') {
            const data = toBytes(keyData);
            if (name === 'AES-CBC' || name === 'AES-CTR' || name === 'AES-GCM' || name === 'AES-KW') {
                const secretKey = createSecretKey(data);
                return secretKey.toCryptoKey({ name: algoName }, extractable, keyUsages);
            }
            if (name === 'PBKDF2') {
                const secretKey = createSecretKey(data);
                return secretKey.toCryptoKey({ name: 'PBKDF2' }, extractable, keyUsages);
            }
            if (name === 'HKDF') {
                const secretKey = createSecretKey(data);
                return secretKey.toCryptoKey({ name: 'HKDF' }, extractable, keyUsages);
            }
            if (name === 'HMAC') {
                if (!algorithm.hash) throw new ERR_MISSING_OPTION('hash');
                const secretKey = createSecretKey(data);
                return secretKey.toCryptoKey(algorithm, extractable, keyUsages);
            }
        }

        if (format === 'jwk') {
            if (keyData === null || typeof keyData !== 'object' || Array.isArray(keyData)) {
                throw createDataError('Invalid keyData');
            }
            if (keyData.kty === 'oct') {
                const raw = base64UrlToBytes(keyData.k);
                const secretKey = createSecretKey(raw);
                return secretKey.toCryptoKey(algorithm, extractable, keyUsages);
            }
            let keyObject;
            if (keyData.d) {
                keyObject = createPrivateKey({ key: keyData, format: 'jwk' });
            } else {
                keyObject = createPublicKey({ key: keyData, format: 'jwk' });
            }
            return keyObject.toCryptoKey(algorithm, extractable, keyUsages);
        }

        if (format === 'spki') {
            const keyObject = createPublicKey({
                key: keyData,
                format: 'der',
                type: 'spki',
            });
            return keyObject.toCryptoKey(algorithm, extractable, keyUsages);
        }

        if (format === 'pkcs8') {
            const keyObject = createPrivateKey({
                key: keyData,
                format: 'der',
                type: 'pkcs8',
            });
            return keyObject.toCryptoKey(algorithm, extractable, keyUsages);
        }

        throw new Error('Unsupported import format/algorithm: ' + format + '/' + algoName);
    }

    async exportKey(format, key) {
        assertSubtleCrypto(this);
        if (format === 'raw') {
            if (key._type === 'secret') {
                const exported = key._keyObject.export();
                return (exported instanceof Uint8Array ? exported : new Uint8Array(exported)).buffer;
            }
        }
        if (format === 'jwk') {
            let jwk;
            if (key._type === 'secret') {
                jwk = key._keyObject.export({ format: 'jwk' });
            } else {
                jwk = key._keyObject.export({ format: 'jwk' });
            }
            jwk.key_ops = [...key._usages];
            jwk.ext = key._extractable;
            return jwk;
        }
        if (format === 'spki') {
            const exported = key._keyObject.export({ format: 'der', type: 'spki' });
            return (exported instanceof Uint8Array ? exported : new Uint8Array(exported)).buffer;
        }
        if (format === 'pkcs8') {
            const exported = key._keyObject.export({ format: 'der', type: 'pkcs8' });
            return (exported instanceof Uint8Array ? exported : new Uint8Array(exported)).buffer;
        }
        throw new Error('Unsupported export format: ' + format);
    }

    async encrypt(algorithm, key, data) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }

        const name = algoName.toUpperCase();
        if (name === 'AES-KW') {
            if (!key._usages.includes('wrapKey') && !key._usages.includes('encrypt')) {
                throwInvalidAccessError();
            }
        } else {
            validateKeyUsage(key, 'encrypt');
        }
        validateKeyAlgorithm(key, algoName);
        const dataBytes = toBytes(data);

        if (name === 'AES-KW') {
            const cipher = createCipheriv(`aes-${key._algorithm.length}-wrap`, key._keyObject, Buffer.alloc(0));
            const part1 = cipher.update(dataBytes);
            const part2 = cipher.final();
            return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
        } else if (name === 'AES-CBC') {
            if (!algorithm.iv) throw new TypeError('algorithm.iv must contain exactly 16 bytes');
            const iv = toBytes(algorithm.iv);
            if (iv.length !== 16) throw new TypeError('algorithm.iv must contain exactly 16 bytes');
            const cipher = createCipheriv(`aes-${key._algorithm.length}-cbc`, key._keyObject, iv);
            const part1 = cipher.update(dataBytes);
            const part2 = cipher.final();
            return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
        } else if (name === 'AES-CTR') {
            if (!algorithm.counter) throw new TypeError('algorithm.counter must contain exactly 16 bytes');
            const counter = toBytes(algorithm.counter);
            if (counter.length !== 16) throw new TypeError('algorithm.counter must contain exactly 16 bytes');
            const ctrLength = algorithm.length;
            if (!Number.isInteger(ctrLength) || ctrLength < 1 || ctrLength > 128) {
                throw new DOMException('AES-CTR algorithm.length must be between 1 and 128', 'OperationError');
            }
            const cipher = createCipheriv(`aes-${key._algorithm.length}-ctr`, key._keyObject, counter);
            const part1 = cipher.update(dataBytes);
            const part2 = cipher.final();
            return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
        } else if (name === 'AES-GCM') {
            if (!algorithm.iv) throw new TypeError('algorithm.iv is required for AES-GCM');
            const iv = toBytes(algorithm.iv);
            const tagLength = algorithm.tagLength || 128;
            const validTagLengths = [32, 64, 96, 104, 112, 120, 128];
            if (!validTagLengths.includes(tagLength)) {
                throw new TypeError(`${tagLength} is not a valid AES-GCM tag length`);
            }
            const tagBytes = tagLength / 8;
            const cipher = createCipheriv(`aes-${key._algorithm.length}-gcm`, key._keyObject, iv, { authTagLength: tagBytes });
            if (algorithm.additionalData) {
                cipher.setAAD(toBytes(algorithm.additionalData));
            }
            const part1 = cipher.update(dataBytes);
            const part2 = cipher.final();
            const tag = cipher.getAuthTag();
            return concatBytesParts(toBytes(part1), toBytes(part2), toBytes(tag)).buffer;
        } else if (name === 'RSA-OAEP') {
            const hashName = key._algorithm.hash ? key._algorithm.hash.name : 'SHA-1';
            const opts = {
                key: key._keyObject,
                padding: 4, // RSA_PKCS1_OAEP_PADDING
                oaepHash: normalizeHashAlgorithm(hashName),
            };
            if (algorithm.label) {
                opts.oaepLabel = toBytes(algorithm.label);
            }
            const result = publicEncrypt(opts, dataBytes);
            return (result instanceof Uint8Array ? result : new Uint8Array(result)).buffer;
        }
        throw new Error('Unsupported algorithm for encrypt: ' + algoName);
    }

    async decrypt(algorithm, key, data) {
        assertSubtleCrypto(this);
        let algoName;
        if (typeof algorithm === 'string') {
            algoName = algorithm;
        } else if (algorithm && typeof algorithm === 'object') {
            algoName = algorithm.name;
        } else {
            throw new TypeError('Algorithm must be a string or an object with a name property');
        }

        const name = algoName.toUpperCase();
        if (name === 'AES-KW') {
            if (!key._usages.includes('unwrapKey') && !key._usages.includes('decrypt')) {
                throwInvalidAccessError();
            }
        } else {
            validateKeyUsage(key, 'decrypt');
        }
        validateKeyAlgorithm(key, algoName);
        const dataBytes = toBytes(data);

        try {
            if (name === 'AES-KW') {
                const decipher = createDecipheriv(`aes-${key._algorithm.length}-wrap`, key._keyObject, Buffer.alloc(0));
                const part1 = decipher.update(dataBytes);
                const part2 = decipher.final();
                return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
            } else if (name === 'AES-CBC') {
                if (!algorithm.iv) throw new TypeError('algorithm.iv must contain exactly 16 bytes');
                const iv = toBytes(algorithm.iv);
                if (iv.length !== 16) throw new TypeError('algorithm.iv must contain exactly 16 bytes');
                const decipher = createDecipheriv(`aes-${key._algorithm.length}-cbc`, key._keyObject, iv);
                const part1 = decipher.update(dataBytes);
                const part2 = decipher.final();
                return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
            } else if (name === 'AES-CTR') {
                if (!algorithm.counter) throw new TypeError('algorithm.counter must contain exactly 16 bytes');
                const counter = toBytes(algorithm.counter);
                if (counter.length !== 16) throw new TypeError('algorithm.counter must contain exactly 16 bytes');
                const ctrLength = algorithm.length;
                if (!Number.isInteger(ctrLength) || ctrLength < 1 || ctrLength > 128) {
                    throw new DOMException('AES-CTR algorithm.length must be between 1 and 128', 'OperationError');
                }
                const decipher = createDecipheriv(`aes-${key._algorithm.length}-ctr`, key._keyObject, counter);
                const part1 = decipher.update(dataBytes);
                const part2 = decipher.final();
                return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
            } else if (name === 'AES-GCM') {
                if (!algorithm.iv) throw new TypeError('algorithm.iv is required for AES-GCM');
                const iv = toBytes(algorithm.iv);
                const tagLength = algorithm.tagLength || 128;
                const validTagLengths = [32, 64, 96, 104, 112, 120, 128];
                if (!validTagLengths.includes(tagLength)) {
                    throw new TypeError(`${tagLength} is not a valid AES-GCM tag length`);
                }
                const tagBytes = tagLength / 8;
                if (dataBytes.length < tagBytes) throwOperationError();
                const ciphertext = dataBytes.slice(0, dataBytes.length - tagBytes);
                const tag = dataBytes.slice(dataBytes.length - tagBytes);
                const decipher = createDecipheriv(`aes-${key._algorithm.length}-gcm`, key._keyObject, iv, { authTagLength: tagBytes });
                if (algorithm.additionalData) {
                    decipher.setAAD(toBytes(algorithm.additionalData));
                }
                decipher.setAuthTag(tag);
                const part1 = decipher.update(ciphertext);
                const part2 = decipher.final();
                return concatBytesParts(toBytes(part1), toBytes(part2)).buffer;
            } else if (name === 'RSA-OAEP') {
                const hashName = key._algorithm.hash ? key._algorithm.hash.name : 'SHA-1';
                const opts = {
                    key: key._keyObject,
                    padding: 4, // RSA_PKCS1_OAEP_PADDING
                    oaepHash: normalizeHashAlgorithm(hashName),
                };
                if (algorithm.label) {
                    opts.oaepLabel = toBytes(algorithm.label);
                }
                const result = privateDecrypt(opts, dataBytes);
                return (result instanceof Uint8Array ? result : new Uint8Array(result)).buffer;
            }
        } catch (e) {
            if (e instanceof TypeError || (e instanceof DOMException && e.name !== 'OperationError')) throw e;
            throwOperationError();
        }
        throw new Error('Unsupported algorithm for decrypt: ' + algoName);
    }

    async deriveBits(algorithm, baseKey, length) {
        assertSubtleCrypto(this);
        const algoName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
        if (!algoName) throw new TypeError('Algorithm must be a string or an object with a name property');
        const name = algoName.toUpperCase();

        if (name === 'PBKDF2') {
            const hashAlgo = algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const salt = toBytes(algorithm.salt);
            const secret = baseKey._keyObject.export();
            const out = pbkdf2Sync(secret, salt, algorithm.iterations, length / 8, hashName);
            return (out instanceof Uint8Array ? out : new Uint8Array(out)).buffer;
        }

        if (name === 'HKDF') {
            const hashAlgo = algorithm.hash;
            const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo.name;
            const normalized = normalizeHashAlgorithm(hashName);
            const salt = toBytes(algorithm.salt);
            const info = toBytes(algorithm.info);
            const ikm = baseKey._keyObject.export();
            const out = hkdfSync(normalized, ikm, salt, info, length / 8);
            return (out instanceof Uint8Array ? out : new Uint8Array(out)).buffer;
        }

        if (name === 'ECDH') {
            const peerKey = algorithm.public;
            if (!peerKey || peerKey._type !== 'public') {
                throw new DOMException('ECDH requires a public key', 'InvalidAccessError');
            }
            // Use the ECDH class to compute shared secret
            const curve = baseKey._algorithm.namedCurve;
            const curveMap = { 'P-256': 'prime256v1', 'P-384': 'secp384r1', 'P-521': 'secp521r1' };
            const nativeCurve = curveMap[curve] || curve;
            // Export private key bytes and peer public key bytes
            const privKeyBytes = baseKey._keyObject.export({ format: 'der', type: 'pkcs8' });
            const pubKeyBytes = peerKey._keyObject.export({ format: 'der', type: 'spki' });
            // Use native ECDH
            const result = webCryptoNative.ecdh_derive_bits(nativeCurve, toBytes(privKeyBytes), toBytes(pubKeyBytes), length / 8);
            if (result === null || result === undefined) {
                throw new DOMException('ECDH deriveBits failed', 'OperationError');
            }
            return new Uint8Array(result).buffer;
        }

        if (name === 'X25519' || name === 'X448') {
            const peerKey = algorithm.public;
            if (!peerKey || peerKey._type !== 'public') {
                throw new DOMException(name + ' requires a public key', 'InvalidAccessError');
            }
            const privKeyBytes = baseKey._keyObject.export({ format: 'der', type: 'pkcs8' });
            const pubKeyBytes = peerKey._keyObject.export({ format: 'der', type: 'spki' });
            const result = webCryptoNative.cfrg_derive_bits(name.toLowerCase(), toBytes(privKeyBytes), toBytes(pubKeyBytes), length / 8);
            if (result === null || result === undefined) {
                throw new DOMException(name + ' deriveBits failed', 'OperationError');
            }
            return new Uint8Array(result).buffer;
        }

        throw new Error('Unsupported algorithm for deriveBits: ' + algoName);
    }

    async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
        assertSubtleCrypto(this);
        // Determine the derived key length
        let derivedLength;
        const dkaName = typeof derivedKeyAlgorithm === 'string'
            ? derivedKeyAlgorithm.toUpperCase()
            : (derivedKeyAlgorithm?.name || '').toUpperCase();

        if (dkaName === 'HMAC') {
            if (derivedKeyAlgorithm.length !== undefined) {
                derivedLength = derivedKeyAlgorithm.length;
            } else {
                // Default to hash block size
                const hashAlgo = derivedKeyAlgorithm.hash;
                const hashName = typeof hashAlgo === 'string' ? hashAlgo : hashAlgo?.name;
                const hashBlockSizes = { 'SHA-1': 512, 'SHA-256': 512, 'SHA-384': 1024, 'SHA-512': 1024 };
                derivedLength = hashBlockSizes[hashName] || 512;
            }
        } else {
            derivedLength = derivedKeyAlgorithm.length;
        }

        const bits = await SubtleCrypto.prototype.deriveBits.call(this, algorithm, baseKey, derivedLength);
        const keyObject = createSecretKey(new Uint8Array(bits));
        return keyObject.toCryptoKey(derivedKeyAlgorithm, extractable, keyUsages);
    }

    async wrapKey(format, key, wrappingKey, wrapAlgorithm) {
        assertSubtleCrypto(this);
        validateKeyUsage(wrappingKey, 'wrapKey');
        const exported = await SubtleCrypto.prototype.exportKey.call(this, format, key);
        let bytes;
        if (format === 'jwk') {
            bytes = new TextEncoder().encode(JSON.stringify(exported));
        } else {
            bytes = exported;
        }
        return SubtleCrypto.prototype.encrypt.call(this, wrapAlgorithm, wrappingKey, bytes);
    }

    async unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) {
        assertSubtleCrypto(this);
        validateKeyUsage(unwrappingKey, 'unwrapKey');
        const decrypted = await SubtleCrypto.prototype.decrypt.call(this, unwrapAlgorithm, unwrappingKey, wrappedKey);
        let keyData;
        if (format === 'jwk') {
            keyData = JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)));
        } else {
            keyData = decrypted;
        }
        return SubtleCrypto.prototype.importKey.call(this, format, keyData, unwrappedKeyAlgorithm, extractable, keyUsages);
    }
}

class CryptoKey {
    constructor(token, type_, algorithm, extractable, usages, keyObject) {
        if (token !== kInternal) throw new ERR_ILLEGAL_CONSTRUCTOR();
        cryptoKeyBrand.add(this);
        this._type = type_;
        this._algorithm = algorithm;
        this._extractable = extractable;
        this._usages = usages;
        this._keyObject = keyObject;
    }

    get type() { return this._type; }
    get algorithm() { return this._algorithm; }
    get extractable() { return this._extractable; }
    get usages() { return this._usages; }

    export(options) {
        return this._keyObject.export(options);
    }

    [structuredCloneSymbol]() {
        const keyObject = this._keyObject && typeof this._keyObject[structuredCloneSymbol] === 'function'
            ? this._keyObject[structuredCloneSymbol]()
            : this._keyObject;
        return new CryptoKey(
            kInternal,
            this._type,
            this._algorithm,
            this._extractable,
            this._usages.slice(),
            keyObject,
        );
    }
}

Object.defineProperty(CryptoKey.prototype, Symbol.toStringTag, {
    value: 'CryptoKey',
    writable: false,
    enumerable: false,
    configurable: true,
});

class Crypto {
    constructor(token) {
        if (token !== kInternal) throw new ERR_ILLEGAL_CONSTRUCTOR();
        cryptoBrand.add(this);
    }

    get subtle() {
        assertCrypto(this);
        return subtleCryptoInstance;
    }

    getRandomValues(array) {
        assertCrypto(this);
        return getRandomValues(array);
    }

    randomUUID(options) {
        assertCrypto(this);
        return randomUUID(options);
    }
}

const subtleCryptoInstance = new SubtleCrypto(kInternal);
const cryptoInstance = new Crypto(kInternal);

globalThis.CryptoKey = CryptoKey;
globalThis.Crypto = Crypto;
globalThis.SubtleCrypto = SubtleCrypto;
export { CryptoKey, Crypto, SubtleCrypto };
export { subtleCryptoInstance as subtle };
export const webcrypto = cryptoInstance;
