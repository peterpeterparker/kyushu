/*!
 * The buffer module from node.js.
 * Based on https://github.com/feross/buffer (MIT license).
 */

'use strict'

import * as base64 from "base64-js"
import * as ieee754 from "ieee754"
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_ENCODING, ERR_BUFFER_OUT_OF_BOUNDS, ERR_INVALID_ARG_VALUE, ERR_INVALID_THIS, ERR_STRING_TOO_LONG } from "__wasm_rquickjs_builtin/internal/errors"
import { Blob as _BlobImport, File as _FileImport } from "__wasm_rquickjs_builtin/http_blob"
import { inspect as utilInspect } from "__wasm_rquickjs_builtin/internal/util/inspect"
import { ALL_PROPERTIES, ONLY_ENUMERABLE, getOwnNonIndexProperties } from "__wasm_rquickjs_builtin/internal/binding/util"
import { utf8_decode as nativeUtf8Decode } from '__wasm_rquickjs_builtin/string_decoder_native'

const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom')

let _inspectMaxBytes = 50
export const INSPECT_MAX_BYTES = 50

const K_MAX_LENGTH = 0x7fffffff
export const kMaxLength = K_MAX_LENGTH
const K_UNTRANSFERABLE_ARRAYBUFFER = Symbol.for('__wasm_rquickjs.untransferable')

let allocationPool
let allocationPoolOffset = 0

/**
 * Not used internally, but exported to maintain api compatability
 * Uses 32-bit implementation value from Node defined in String:kMaxLength
 *
 * @see https://github.com/nodejs/node/blob/main/deps/v8/include/v8-primitive.h#L126
 * @see https://github.com/nodejs/node/blob/main/src/node_buffer.cc#L1298
 * @see https://github.com/nodejs/node/blob/main/lib/buffer.js#L142
 */
const K_STRING_MAX_LENGTH = (1 << 28) - 16
export const kStringMaxLength = K_STRING_MAX_LENGTH

export const constants = {
    MAX_LENGTH: K_MAX_LENGTH,
    MAX_STRING_LENGTH: K_STRING_MAX_LENGTH
}

const REPEAT_LIMIT_GUARD_MARKER = '__wasm_rquickjs_repeat_limit_guard'

function installRepeatLimitGuard (maxStringLength) {
    const repeatDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'repeat')
    if (!repeatDescriptor || typeof repeatDescriptor.value !== 'function') {
        return
    }

    const currentRepeat = repeatDescriptor.value
    if (currentRepeat[REPEAT_LIMIT_GUARD_MARKER] === true) {
        return
    }

    const repeatWithLimit = function repeat (count) {
        const input = String(this)
        const numericCount = Number(count)

        if (input.length > 0 && Number.isFinite(numericCount) && numericCount > 0) {
            const integerCount = Math.floor(numericCount)
            if (integerCount > Math.floor(maxStringLength / input.length)) {
                throw new RangeError('Invalid string length')
            }
        }

        return currentRepeat.call(this, count)
    }

    repeatWithLimit[REPEAT_LIMIT_GUARD_MARKER] = true

    Object.defineProperty(String.prototype, 'repeat', {
        configurable: repeatDescriptor.configurable,
        enumerable: repeatDescriptor.enumerable,
        writable: repeatDescriptor.writable,
        value: repeatWithLimit
    })
}

installRepeatLimitGuard(K_STRING_MAX_LENGTH)

Buffer.TYPED_ARRAY_SUPPORT = true

Object.defineProperty(Buffer.prototype, 'parent', {
    enumerable: true,
    get: function () {
        if (!Buffer.isBuffer(this)) return undefined
        return this.buffer
    }
})

Object.defineProperty(Buffer.prototype, 'offset', {
    enumerable: true,
    get: function () {
        if (!Buffer.isBuffer(this)) return undefined
        return this.byteOffset
    }
})

function createBuffer (length) {
    if (length > K_MAX_LENGTH) {
        throw new ERR_OUT_OF_RANGE('size', '>= 0 and <= ' + K_MAX_LENGTH, length)
    }
    // Return an augmented `Uint8Array` instance
    const buf = new Uint8Array(length)
    Object.setPrototypeOf(buf, Buffer.prototype)
    return buf
}

function markArrayBufferAsUntransferable (arrayBuffer) {
    if (arrayBuffer == null || (typeof arrayBuffer !== 'object' && typeof arrayBuffer !== 'function')) {
        return
    }

    try {
        Object.defineProperty(arrayBuffer, K_UNTRANSFERABLE_ARRAYBUFFER, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        })
    } catch {
        // Ignore non-extensible buffers.
    }
}

function alignPoolOffset () {
    if ((allocationPoolOffset & 0x7) !== 0) {
        allocationPoolOffset = (allocationPoolOffset + 7) & ~0x7
    }
}

function createAllocationPool () {
    const size = Buffer.poolSize > 0 ? Buffer.poolSize >>> 0 : 8192
    allocationPool = new Uint8Array(size)
    allocationPoolOffset = 0
    markArrayBufferAsUntransferable(allocationPool.buffer)
}

function allocFromPool (size) {
    if (size <= 0) {
        return createBuffer(0)
    }

    if (allocationPool === undefined || allocationPoolOffset + size > allocationPool.length) {
        createAllocationPool()
    }

    const start = allocationPoolOffset
    allocationPoolOffset += size
    alignPoolOffset()

    const buf = allocationPool.subarray(start, start + size)
    Object.setPrototypeOf(buf, Buffer.prototype)
    return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

export function Buffer (arg, encodingOrOffset, length) {
    if (!globalThis.__wasm_rquickjs_buffer_dep0005_warned) {
        globalThis.__wasm_rquickjs_buffer_dep0005_warned = true
        if (typeof globalThis.process !== 'undefined' && typeof globalThis.process.emitWarning === 'function') {
            globalThis.process.emitWarning(
                'Buffer() is deprecated due to security and usability issues. ' +
                'Please use the Buffer.alloc(), Buffer.allocUnsafe(), or ' +
                'Buffer.from() methods instead.',
                'DeprecationWarning',
                'DEP0005'
            )
        }
    }
    // Common case.
    if (typeof arg === 'number') {
        if (typeof encodingOrOffset === 'string') {
            throw new ERR_INVALID_ARG_TYPE('string', 'string', arg)
        }
        return allocUnsafe(arg)
    }
    return from(arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192

function from (value, encodingOrOffset, length) {
    if (typeof value === 'string') {
        return fromString(value, encodingOrOffset)
    }

    if (ArrayBuffer.isView(value)) {
        return fromArrayView(value)
    }

    if (value == null) {
        throw new ERR_INVALID_ARG_TYPE(
            'first argument',
            ['string', 'Buffer', 'ArrayBuffer', 'Array', 'Array-like Object'],
            value
        )
    }

    if (isInstance(value, ArrayBuffer) ||
        (value && isInstance(value.buffer, ArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length)
    }

    if (isInstance(value, SharedArrayBuffer) ||
        (value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length)
    }

    if (typeof value !== 'object') {
        throw new ERR_INVALID_ARG_TYPE(
            'first argument',
            ['string', 'Buffer', 'ArrayBuffer', 'Array', 'Array-like Object'],
            value
        )
    }

    const valueOf = value.valueOf && value.valueOf()
    if (valueOf != null && valueOf !== value) {
        if (typeof valueOf === 'string') {
            return fromString(valueOf, encodingOrOffset)
        }
        if (ArrayBuffer.isView(valueOf)) {
            return fromArrayView(valueOf)
        }
        if (isInstance(valueOf, ArrayBuffer) ||
            (valueOf && isInstance(valueOf.buffer, ArrayBuffer))) {
            return fromArrayBuffer(valueOf, encodingOrOffset, length)
        }
        if (typeof valueOf === 'number') {
            throw new ERR_INVALID_ARG_TYPE(
                'first argument',
                ['string', 'Buffer', 'ArrayBuffer', 'Array', 'Array-like Object'],
                value
            )
        }
    }

    const b = fromObject(value)
    if (b) return b

    if (Symbol.toPrimitive != null &&
        typeof value[Symbol.toPrimitive] === 'function') {
        const primitive = value[Symbol.toPrimitive]('string')
        if (typeof primitive === 'string') {
            return fromString(primitive, encodingOrOffset)
        }
    }

    throw new ERR_INVALID_ARG_TYPE(
        'first argument',
        ['string', 'Buffer', 'ArrayBuffer', 'Array', 'Array-like Object'],
        value
    )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
    return from(value, encodingOrOffset, length)
}

Object.setPrototypeOf(Buffer.prototype, Uint8Array.prototype)
Object.setPrototypeOf(Buffer, Uint8Array)

function assertSize (size) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size)
    } else if (size < 0 || size > K_MAX_LENGTH || size !== size) { // size !== size catches NaN
        throw new ERR_OUT_OF_RANGE('size', '>= 0 and <= ' + K_MAX_LENGTH, size)
    }
}

function alloc (size, fill, encoding) {
    assertSize(size)
    if (size <= 0) {
        return createBuffer(size)
    }
    if (fill !== undefined) {
        if (encoding !== undefined && typeof encoding !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('encoding', 'string', encoding)
        }
        // Only pay attention to encoding if it's a string. This
        // prevents accidentally sending in a number that would
        // be interpreted as a start offset.
        return typeof encoding === 'string'
            ? createBuffer(size).fill(fill, encoding)
            : createBuffer(size).fill(fill)
    }
    return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
    return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
    assertSize(size)
    return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
    return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
    return allocUnsafe(size)
}

function isTypedArray (value) {
    return (value instanceof Int8Array) ||
        (value instanceof Uint8Array) ||
        (value instanceof Uint8ClampedArray) ||
        (value instanceof Int16Array) ||
        (value instanceof Uint16Array) ||
        (value instanceof Int32Array) ||
        (value instanceof Uint32Array) ||
        (value instanceof Float32Array) ||
        (value instanceof Float64Array) ||
        (value instanceof BigInt64Array) ||
        (value instanceof BigUint64Array)
}

function validateInteger (value, name, min, max) {
    if (min === undefined) min = Number.MIN_SAFE_INTEGER
    if (max === undefined) max = Number.MAX_SAFE_INTEGER
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(name, 'number', value)
    }
    if (!Number.isInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, 'an integer', value)
    }
    if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, '>= ' + min + ' && <= ' + max, value)
    }
}

Buffer.copyBytesFrom = function copyBytesFrom (view, offset, length) {
    if (!isTypedArray(view)) {
        throw new ERR_INVALID_ARG_TYPE('view', ['TypedArray'], view)
    }

    const viewLength = view.length
    if (viewLength === 0) {
        return createBuffer(0)
    }

    if (offset !== undefined || length !== undefined) {
        if (offset !== undefined) {
            validateInteger(offset, 'offset', 0)
            if (offset >= viewLength) return createBuffer(0)
        } else {
            offset = 0
        }
        let end
        if (length !== undefined) {
            validateInteger(length, 'length', 0)
            end = offset + length
        } else {
            end = viewLength
        }

        view = view.slice(offset, end)
    }

    return fromArrayLike(new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength
    ))
}

function fromString (string, encoding) {
    if (typeof encoding !== 'string' || encoding === '') {
        encoding = 'utf8'
    }

    if (!Buffer.isEncoding(encoding)) {
        throw new ERR_UNKNOWN_ENCODING(encoding)
    }

    const length = byteLength(string, encoding) | 0
    let buf = length <= (Buffer.poolSize >>> 1)
        ? allocFromPool(length)
        : createBuffer(length)

    const actual = buf.write(string, encoding)

    if (actual !== length) {
        // Writing a hex string, for example, that contains invalid characters will
        // cause everything after the first invalid character to be ignored. (e.g.
        // 'abxxcd' will be treated as 'ab')
        buf = buf.slice(0, actual)
    }

    return buf
}

function fromArrayLike (array) {
    const length = array.length < 0 ? 0 : checked(array.length) | 0
    const buf = createBuffer(length)
    for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255
    }
    return buf
}

function fromArrayView (arrayView) {
    if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView)
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength)
    }
    return fromArrayLike(arrayView)
}

function getArrayBufferByteLength (array) {
    try {
        return array.byteLength
    } catch {
        return undefined
    }
}

function fromArrayBuffer (array, byteOffset, length) {
    let source = array
    let byteLength = getArrayBufferByteLength(source)

    if (typeof byteLength !== 'number' &&
        source != null &&
        (isInstance(source.buffer, ArrayBuffer) ||
                isInstance(source.buffer, SharedArrayBuffer))) {
        source = source.buffer
        byteLength = getArrayBufferByteLength(source)
    }

    if (typeof byteLength !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(
            'first argument',
            ['string', 'Buffer', 'ArrayBuffer', 'Array', 'Array-like Object'],
            array
        )
    }

    if (byteOffset < 0 || byteLength < byteOffset) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('offset')
    }

    if (byteLength < byteOffset + (length || 0)) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('length')
    }

    let buf
    if (byteOffset === undefined && length === undefined) {
        buf = new Uint8Array(source)
    } else if (length === undefined) {
        buf = new Uint8Array(source, byteOffset)
    } else {
        buf = new Uint8Array(source, byteOffset, length)
    }

    // Return an augmented `Uint8Array` instance
    Object.setPrototypeOf(buf, Buffer.prototype)

    return buf
}

function fromObject (obj) {
    if (Buffer.isBuffer(obj)) {
        // Note: Probably not necessary anymore.
        const len = checked(obj.length) | 0
        const buf = createBuffer(len)

        if (buf.length === 0) {
            return buf
        }

        obj.copy(buf, 0, 0, len)
        return buf
    }

    if (obj.length !== undefined) {
        if (typeof obj.length !== 'number' || Number.isNaN(obj.length)) {
            return createBuffer(0)
        }
        return fromArrayLike(obj)
    }

    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data)
    }
}

function checked (length) {
    // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
    // length is NaN (which is otherwise coerced to zero.)
    if (length >= K_MAX_LENGTH) {
        throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
            'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
    }
    return length | 0
}

export function SlowBuffer (length) {
    if (typeof length !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', length)
    }
    if (length < 0 || length !== length) { // NaN check
        throw new ERR_OUT_OF_RANGE('size', '>= 0 and <= ' + K_MAX_LENGTH, length)
    }
    return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
    return b != null && b._isBuffer === true &&
        b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
    if (!isInstance(a, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('buf1', ['Buffer', 'Uint8Array'], a)
    }
    if (!isInstance(b, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('buf2', ['Buffer', 'Uint8Array'], b)
    }

    if (a === b) return 0

    let x = a.length
    let y = b.length

    for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
            x = a[i]
            y = b[i]
            break
        }
    }

    if (x < y) return -1
    if (y < x) return 1
    return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
    switch (String(encoding).toLowerCase()) {
        case 'hex':
        case 'utf8':
        case 'utf-8':
        case 'ascii':
        case 'latin1':
        case 'binary':
        case 'base64':
        case 'base64url':
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
            return true
        default:
            return false
    }
}

Buffer.concat = function concat (list, length) {
    if (!Array.isArray(list)) {
        throw new ERR_INVALID_ARG_TYPE('list', 'Array', list)
    }

    if (list.length === 0) {
        return Buffer.alloc(0)
    }

    let i
    for (i = 0; i < list.length; ++i) {
        if (!isInstance(list[i], Uint8Array)) {
            throw new ERR_INVALID_ARG_TYPE('list[' + i + ']', ['Buffer', 'Uint8Array'], list[i])
        }
    }

    if (length === undefined) {
        length = 0
        for (i = 0; i < list.length; ++i) {
            length += list[i].length
        }
    }

    const buffer = Buffer.allocUnsafe(length)
    let pos = 0
    for (i = 0; i < list.length; ++i) {
        const buf = list[i]
        if (pos + buf.length > buffer.length) {
            buffer.set(buf.subarray(0, buffer.length - pos), pos)
            break
        }
        buffer.set(buf, pos)
        pos += buf.length
    }
    return buffer
}

function byteLength (string, encoding) {
    if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength
    }
    if (isInstance(string, SharedArrayBuffer)) {
        return string.byteLength
    }
    if (typeof string !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('string', ['string', 'Buffer', 'ArrayBuffer'], string)
    }

    const len = string.length
    const mustMatch = (arguments.length > 2 && arguments[2] === true)
    if (!mustMatch && len === 0) return 0

    // Use a for loop to avoid recursion
    let loweredCase = false
    for (;;) {
        switch (encoding) {
            case 'ascii':
            case 'latin1':
            case 'binary':
                return len
            case 'utf8':
            case 'utf-8':
                return utf8ToBytes(string).length
            case 'ucs2':
            case 'ucs-2':
            case 'utf16le':
            case 'utf-16le':
                return len * 2
            case 'hex':
                return len >>> 1
            case 'base64':
                return base64ToBytes(string).length
            case 'base64url':
                return base64ToBytes(base64UrlToBase64(string)).length
            default:
                if (loweredCase) {
                    return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
                }
                encoding = ('' + encoding).toLowerCase()
                loweredCase = true
        }
    }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
    let loweredCase = false

    // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
    // property of a typed array.

    // This behaves neither like String nor Uint8Array in that we set start/end
    // to their upper/lower bounds if the value passed is out of range.
    // undefined is handled specially as per ECMA-262 6th Edition,
    // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
    if (start === undefined || start < 0) {
        start = 0
    }
    // Return early if start > this.length. Done here to prevent potential uint32
    // coercion fail below.
    if (start > this.length) {
        return ''
    }

    if (end === undefined || end > this.length) {
        end = this.length
    }

    if (end <= 0) {
        return ''
    }

    // Force coercion to uint32. This will also coerce falsey/NaN values to 0.
    end >>>= 0
    start >>>= 0

    if (end <= start) {
        return ''
    }

    if (typeof encoding === 'number' || encoding === null) {
        throw new ERR_UNKNOWN_ENCODING(encoding)
    }

    if (!encoding) encoding = 'utf8'

    while (true) {
        switch (encoding) {
            case 'hex':
                return hexSlice(this, start, end)

            case 'utf8':
            case 'utf-8':
                return utf8Slice(this, start, end)

            case 'ascii':
                return asciiSlice(this, start, end)

            case 'latin1':
            case 'binary':
                return latin1Slice(this, start, end)

            case 'base64':
                return base64Slice(this, start, end)

            case 'base64url':
                return base64urlSlice(this, start, end)

            case 'ucs2':
            case 'ucs-2':
            case 'utf16le':
            case 'utf-16le':
                return utf16leSlice(this, start, end)

            default:
                if (loweredCase) throw new ERR_UNKNOWN_ENCODING(encoding)
                encoding = (encoding + '').toLowerCase()
                loweredCase = true
        }
    }
}

Buffer.prototype._isBuffer = true

function swap (b, n, m) {
    const i = b[n]
    b[n] = b[m]
    b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
    const len = this.length
    if (len % 2 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 16-bits')
    }
    for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1)
    }
    return this
}

Buffer.prototype.swap32 = function swap32 () {
    const len = this.length
    if (len % 4 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 32-bits')
    }
    for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3)
        swap(this, i + 1, i + 2)
    }
    return this
}

Buffer.prototype.swap64 = function swap64 () {
    const len = this.length
    if (len % 8 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 64-bits')
    }
    for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7)
        swap(this, i + 1, i + 6)
        swap(this, i + 2, i + 5)
        swap(this, i + 3, i + 4)
    }
    return this
}

Buffer.prototype.toString = function toString () {
    const length = this.length
    if (length === 0) return ''
    if (arguments.length === 0) return utf8Slice(this, 0, length)
    return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
    if (!isInstance(b, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('otherBuffer', ['Buffer', 'Uint8Array'], b)
    }
    if (this === b) return true
    return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect (_recurseTimes, ctx) {
    let str = ''
    const max = _inspectMaxBytes
    const actualMax = Math.min(max, this.length)
    str = this.toString('hex', 0, actualMax).replace(/(.{2})/g, '$1 ').trim()
    const remaining = this.length - max
    if (remaining > 0) str += ' ... ' + remaining + ' more byte' + (remaining > 1 ? 's' : '')

    if (ctx) {
        const filter = ctx.showHidden ? ALL_PROPERTIES : ONLY_ENUMERABLE
        const extraProperties = { __proto__: null }
        let hasExtraProperties = false
        const keys = getOwnNonIndexProperties(this, filter)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            extraProperties[key] = this[key]
            hasExtraProperties = true
        }

        if (hasExtraProperties) {
            if (this.length !== 0) {
                str += ', '
            }

            str += utilInspect(extraProperties, {
                ...ctx,
                breakLength: Infinity,
                compact: true
            }).slice(27, -2)
        }
    }

    let constructorName = 'Buffer'
    try {
        const { constructor } = this
        if (typeof constructor === 'function' && Object.prototype.hasOwnProperty.call(constructor, 'name')) {
            constructorName = constructor.name
        }
    } catch {
        // Keep the default constructor name.
    }

    return '<' + constructorName + ' ' + str + '>'
}
Buffer.prototype[customInspectSymbol] = Buffer.prototype.inspect

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
    if (!isInstance(target, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('target', ['Buffer', 'Uint8Array'], target)
    }

    if (start === undefined) {
        start = 0
    } else if (typeof start !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('targetStart', 'number', start)
    }

    if (end === undefined) {
        end = target ? target.length : 0
    } else if (typeof end !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('targetEnd', 'number', end)
    }

    if (thisStart === undefined) {
        thisStart = 0
    } else if (typeof thisStart !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('sourceStart', 'number', thisStart)
    }

    if (thisEnd === undefined) {
        thisEnd = this.length
    } else if (typeof thisEnd !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('sourceEnd', 'number', thisEnd)
    }

    if (start < 0) {
        throw new ERR_OUT_OF_RANGE('targetStart', '>= 0', start)
    }
    if (end < 0 || end > target.length) {
        throw new ERR_OUT_OF_RANGE('targetEnd', '>= 0 and <= ' + target.length, end)
    }
    if (thisStart < 0) {
        throw new ERR_OUT_OF_RANGE('sourceStart', '>= 0', thisStart)
    }
    if (thisEnd < 0 || thisEnd > this.length) {
        throw new ERR_OUT_OF_RANGE('sourceEnd', '>= 0 and <= ' + this.length, thisEnd)
    }

    if (start >= end || start >= target.length) {
        if (thisStart >= thisEnd) return 0
        return 1
    }
    if (thisStart >= thisEnd || thisStart >= this.length) {
        return -1
    }

    start >>>= 0
    end >>>= 0
    thisStart >>>= 0
    thisEnd >>>= 0

    if (this === target) return 0

    let x = thisEnd - thisStart
    let y = end - start
    const len = Math.min(x, y)

    for (let i = 0; i < len; ++i) {
        if (this[thisStart + i] !== target[start + i]) {
            x = this[thisStart + i]
            y = target[start + i]
            break
        }
    }

    if (x < y) return -1
    if (y < x) return 1
    return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array) && !ArrayBuffer.isView(buffer)) {
        throw new ERR_INVALID_ARG_TYPE('buffer', ['Buffer', 'TypedArray', 'DataView'], buffer)
    }
    // Empty buffer means no match
    if (buffer.length === 0) return -1

    // Normalize byteOffset
    if (typeof byteOffset === 'string') {
        encoding = byteOffset
        byteOffset = 0
    } else if (byteOffset > 0x7fffffff) {
        byteOffset = 0x7fffffff
    } else if (byteOffset < -0x80000000) {
        byteOffset = -0x80000000
    }
    byteOffset = +byteOffset // Coerce to Number.
    if (Number.isNaN(byteOffset)) {
        // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
        byteOffset = dir ? 0 : buffer.length
    }

    // Normalize byteOffset: negative offsets start from the end of the buffer
    if (byteOffset < 0) byteOffset = buffer.length + byteOffset

    // Normalize val early to detect empty needles before clamping byteOffset
    if (typeof val === 'string') {
        val = Buffer.from(val, encoding)
    } else if (val instanceof Uint8Array && !Buffer.isBuffer(val)) {
        val = Buffer.from(val)
    }

    // Handle empty needle/val
    if (Buffer.isBuffer(val) && val.length === 0) {
        if (byteOffset < 0) {
            if (dir) return 0
            else return -1
        }
        return Math.min(byteOffset, buffer.length)
    }

    if (byteOffset >= buffer.length) {
        if (dir) return -1
        else byteOffset = buffer.length - 1
    } else if (byteOffset < 0) {
        if (dir) byteOffset = 0
        else return -1
    }

    // Finally, search either indexOf (if dir is true) or lastIndexOf
    if (Buffer.isBuffer(val)) {
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
    } else if (typeof val === 'number') {
        val = val & 0xFF // Search for a byte value [0-255]
        if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
        } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
        }
    }

    throw new ERR_INVALID_ARG_TYPE('value', ['number', 'string', 'Buffer', 'Uint8Array'], val)
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
    let indexSize = 1
    let arrLength = arr.length
    let valLength = val.length

    if (encoding !== undefined) {
        encoding = String(encoding).toLowerCase()
        if (encoding === 'ucs2' || encoding === 'ucs-2' ||
            encoding === 'utf16le' || encoding === 'utf-16le') {
            if (arr.length < 2 || val.length < 2) {
                return -1
            }
            indexSize = 2
            arrLength = Math.floor(arrLength / 2)
            valLength = Math.floor(valLength / 2)
            byteOffset = Math.floor(byteOffset / 2)
        }
    }

    function read (buf, i) {
        if (indexSize === 1) {
            return buf[i]
        } else {
            return buf.readUInt16BE(i * indexSize)
        }
    }

    let i
    if (dir) {
        let foundIndex = -1
        for (i = byteOffset; i < arrLength; i++) {
            if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
                if (foundIndex === -1) foundIndex = i
                if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
            } else {
                if (foundIndex !== -1) i -= i - foundIndex
                foundIndex = -1
            }
        }
    } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
        for (i = byteOffset; i >= 0; i--) {
            let found = true
            for (let j = 0; j < valLength; j++) {
                if (read(arr, i + j) !== read(val, j)) {
                    found = false
                    break
                }
            }
            if (found) return i
        }
    }

    return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
    return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
    offset = Number(offset) || 0
    const remaining = buf.length - offset
    if (!length) {
        length = remaining
    } else {
        length = Number(length)
        if (length > remaining) {
            length = remaining
        }
    }

    const strLen = string.length

    if (length > (strLen >>> 1)) {
        length = strLen >>> 1
    }

    for (let i = 0; i < length; ++i) {
        const a = string.charCodeAt(i * 2 + 0)
        const b = string.charCodeAt(i * 2 + 1)
        const hi = hexCharValueTable[a & 0x7f]
        const lo = hexCharValueTable[b & 0x7f]

        if ((a | b | hi | lo) & ~0x7f) {
            return i
        }

        buf[offset + i] = (hi << 4) | lo
    }

    return length
}

function utf8Write (buf, string, offset, length) {
    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
    return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function base64Write (buf, string, offset, length) {
    return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

function normalizeInternalWriteOffset (buf, offset) {
    if (offset === undefined) {
        return 0
    }

    const offsetNumber = Number(offset)
    if (!Number.isFinite(offsetNumber)) {
        if (Number.isNaN(offsetNumber)) {
            return 0
        }
        throw new ERR_BUFFER_OUT_OF_BOUNDS('offset')
    }

    if (offsetNumber < 0) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('offset')
    }

    const normalizedOffset = Math.floor(offsetNumber)
    if (normalizedOffset > buf.length) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('offset')
    }

    return normalizedOffset
}

function normalizeInternalWriteLength (length, remaining) {
    if (length === undefined) {
        return remaining
    }

    const lengthNumber = Number(length)
    if (!Number.isFinite(lengthNumber)) {
        if (Number.isNaN(lengthNumber)) {
            return 0
        }
        throw new ERR_BUFFER_OUT_OF_BOUNDS('length')
    }

    if (lengthNumber < 0) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('length')
    }

    const normalizedLength = Math.floor(lengthNumber)
    if (normalizedLength > remaining) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS('length')
    }

    return normalizedLength
}

function writeWithBounds (writer, buf, string, offset, length) {
    offset = normalizeInternalWriteOffset(buf, offset)
    const remaining = buf.length - offset
    length = normalizeInternalWriteLength(length, remaining)
    return writer(buf, string, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
    // Buffer#write(string)
    if (offset === undefined) {
        encoding = 'utf8'
        length = this.length
        offset = 0
        // Buffer#write(string, encoding)
    } else if (length === undefined && typeof offset === 'string') {
        encoding = offset
        length = this.length
        offset = 0
        // Buffer#write(string, offset[, length][, encoding])
    } else if (typeof offset === 'number') {
        const originalOffset = offset
        if (!Number.isFinite(offset)) {
            throw new ERR_OUT_OF_RANGE('offset', '>= 0 && <= ' + this.length, originalOffset)
        }
        offset = offset >>> 0
        if (offset < 0 || offset > this.length) {
            throw new ERR_OUT_OF_RANGE('offset', '>= 0 && <= ' + this.length, originalOffset)
        }
        if (isFinite(length)) {
            length = length >>> 0
            if (encoding === undefined) encoding = 'utf8'
        } else {
            encoding = length
            length = undefined
        }
    } else {
        throw new ERR_INVALID_ARG_TYPE('offset', 'number', offset)
    }

    const remaining = this.length - offset
    if (length === undefined || length > remaining) length = remaining

    if (!encoding) encoding = 'utf8'

    let loweredCase = false
    for (;;) {
        switch (encoding) {
            case 'hex':
                return hexWrite(this, string, offset, length)

            case 'utf8':
            case 'utf-8':
                return utf8Write(this, string, offset, length)

            case 'ascii':
            case 'latin1':
            case 'binary':
                return asciiWrite(this, string, offset, length)

            case 'base64':
                // Warning: maxLength not taken into account in base64Write
                return base64Write(this, string, offset, length)

            case 'base64url':
                return base64Write(this, string, offset, length)

            case 'ucs2':
            case 'ucs-2':
            case 'utf16le':
            case 'utf-16le':
                return ucs2Write(this, string, offset, length)

            default:
                if (loweredCase) throw new ERR_UNKNOWN_ENCODING(encoding)
                encoding = ('' + encoding).toLowerCase()
                loweredCase = true
        }
    }
}

Buffer.prototype.utf8Write = function utf8Write_ (string, offset, length) {
    return writeWithBounds(utf8Write, this, string, offset, length)
}

Buffer.prototype.asciiWrite = function asciiWrite_ (string, offset, length) {
    return writeWithBounds(asciiWrite, this, string, offset, length)
}

Buffer.prototype.latin1Write = function latin1Write (string, offset, length) {
    return writeWithBounds(asciiWrite, this, string, offset, length)
}

Buffer.prototype.base64Write = function base64Write_ (string, offset, length) {
    return base64Write(this, string, offset, length)
}

Buffer.prototype.hexWrite = function hexWrite_ (string, offset, length) {
    return hexWrite(this, string, offset, length)
}

Buffer.prototype.ucs2Write = function ucs2Write_ (string, offset, length) {
    return ucs2Write(this, string, offset, length)
}

Buffer.prototype.toJSON = function toJSON () {
    return {
        type: 'Buffer',
        data: Array.prototype.slice.call(this, 0)
    }
}

function base64Slice (buf, start, end) {
    if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf)
    } else {
        return base64.fromByteArray(buf.slice(start, end))
    }
}

function utf8Slice (buf, start, end) {
    end = Math.min(buf.length, end)
    if (end - start > K_STRING_MAX_LENGTH) {
        throw new ERR_STRING_TOO_LONG(K_STRING_MAX_LENGTH)
    }
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    return nativeUtf8Decode(u8, start, end)
}

const MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
    const len = codePoints.length
    if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
    }

    // Decode in chunks to avoid "call stack size exceeded".
    let res = ''
    let i = 0
    while (i < len) {
        res += String.fromCharCode.apply(
            String,
            codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        )
    }
    return res
}

function asciiSlice (buf, start, end) {
    let ret = ''
    end = Math.min(buf.length, end)

    for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 0x7F)
    }
    return ret
}

function latin1Slice (buf, start, end) {
    let ret = ''
    end = Math.min(buf.length, end)

    for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i])
    }
    return ret
}

function hexSlice (buf, start, end) {
    const len = buf.length

    if (!start || start < 0) start = 0
    if (!end || end < 0 || end > len) end = len

    let out = ''
    for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]]
    }
    return out
}

function utf16leSlice (buf, start, end) {
    const bytes = buf.slice(start, end)
    let res = ''
    // If bytes.length is odd, the last 8 bits must be ignored (same as node.js)
    for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
    }
    return res
}

Buffer.prototype.slice = function slice (start, end) {
    const len = this.length
    start = ~~start
    end = end === undefined ? len : ~~end

    if (start < 0) {
        start += len
        if (start < 0) start = 0
    } else if (start > len) {
        start = len
    }

    if (end < 0) {
        end += len
        if (end < 0) end = 0
    } else if (end > len) {
        end = len
    }

    if (end < start) end = start

    const newBuf = this.subarray(start, end)
    // Return an augmented `Uint8Array` instance
    Object.setPrototypeOf(newBuf, Buffer.prototype)

    return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
    if (typeof offset !== 'number' || offset !== offset) { // NaN check
        throw new ERR_OUT_OF_RANGE('offset', 'an integer', offset)
    }
    if (offset % 1 !== 0) {
        throw new ERR_OUT_OF_RANGE('offset', 'an integer', offset)
    }
    if (offset < 0 || offset + ext > length) {
        throw new ERR_OUT_OF_RANGE('offset', '>= 0 and <= ' + (length - ext), offset)
    }
}

function _validateOffset (value, name, min, max) {
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(name, 'number', value)
    }
    if (!Number.isInteger(value)) {
        // NaN, Infinity, -Infinity, fractional — all non-integers
        if (Number.isFinite(value) || value !== value) {
            // NaN and fractional: report as "not an integer"
            throw new ERR_OUT_OF_RANGE(name, 'an integer', value)
        }
        // +/-Infinity falls through to range check
    }
    if (max < min) {
        // Buffer is too small for this operation
        throw new ERR_BUFFER_OUT_OF_BOUNDS()
    }
    if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, '>= ' + min + ' and <= ' + max, value)
    }
    return value
}

Buffer.prototype.readUintLE =
    Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength) {
        byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
        offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)

        let val = this[offset]
        let mul = 1
        let i = 0
        while (++i < byteLength && (mul *= 0x100)) {
            val += this[offset + i] * mul
        }

        return val
    }

Buffer.prototype.readUintBE =
    Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength) {
        byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
        offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)

        let val = this[offset + --byteLength]
        let mul = 1
        while (byteLength > 0 && (mul *= 0x100)) {
            val += this[offset + --byteLength] * mul
        }

        return val
    }

Buffer.prototype.readUint8 =
    Buffer.prototype.readUInt8 = function readUInt8 (offset) {
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 1)
        return this[offset]
    }

Buffer.prototype.readUint16LE =
    Buffer.prototype.readUInt16LE = function readUInt16LE (offset) {
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 2)
        return this[offset] | (this[offset + 1] << 8)
    }

Buffer.prototype.readUint16BE =
    Buffer.prototype.readUInt16BE = function readUInt16BE (offset) {
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 2)
        return (this[offset] << 8) | this[offset + 1]
    }

Buffer.prototype.readUint32LE =
    Buffer.prototype.readUInt32LE = function readUInt32LE (offset) {
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 4)

        return ((this[offset]) |
                (this[offset + 1] << 8) |
                (this[offset + 2] << 16)) +
            (this[offset + 3] * 0x1000000)
    }

Buffer.prototype.readUint32BE =
    Buffer.prototype.readUInt32BE = function readUInt32BE (offset) {
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 4)

        return (this[offset] * 0x1000000) +
            ((this[offset + 1] << 16) |
                (this[offset + 2] << 8) |
                this[offset + 3])
    }

Buffer.prototype.readBigUInt64LE = function readBigUInt64LE (offset) {
    offset = offset >>> 0
    validateNumber(offset, 'offset')
    const first = this[offset]
    const last = this[offset + 7]
    if (first === undefined || last === undefined) {
        boundsError(offset, this.length - 8)
    }

    const lo = first +
        this[++offset] * 2 ** 8 +
        this[++offset] * 2 ** 16 +
        this[++offset] * 2 ** 24

    const hi = this[++offset] +
        this[++offset] * 2 ** 8 +
        this[++offset] * 2 ** 16 +
        last * 2 ** 24

    return BigInt(lo) + (BigInt(hi) << BigInt(32))
}

Buffer.prototype.readBigUInt64BE = function readBigUInt64BE (offset) {
    offset = offset >>> 0
    validateNumber(offset, 'offset')
    const first = this[offset]
    const last = this[offset + 7]
    if (first === undefined || last === undefined) {
        boundsError(offset, this.length - 8)
    }

    const hi = first * 2 ** 24 +
        this[++offset] * 2 ** 16 +
        this[++offset] * 2 ** 8 +
        this[++offset]

    const lo = this[++offset] * 2 ** 24 +
        this[++offset] * 2 ** 16 +
        this[++offset] * 2 ** 8 +
        last

    return (BigInt(hi) << BigInt(32)) + BigInt(lo)
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength) {
    byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
    offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)

    let val = this[offset]
    let mul = 1
    let i = 0
    while (++i < byteLength && (mul *= 0x100)) {
        val += this[offset + i] * mul
    }
    mul *= 0x80

    if (val >= mul) val -= Math.pow(2, 8 * byteLength)

    return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength) {
    byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
    offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)

    let i = byteLength
    let mul = 1
    let val = this[offset + --i]
    while (i > 0 && (mul *= 0x100)) {
        val += this[offset + --i] * mul
    }
    mul *= 0x80

    if (val >= mul) val -= Math.pow(2, 8 * byteLength)

    return val
}

Buffer.prototype.readInt8 = function readInt8 (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 1)
    if (!(this[offset] & 0x80)) return (this[offset])
    return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 2)
    const val = this[offset] | (this[offset + 1] << 8)
    return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 2)
    const val = this[offset + 1] | (this[offset] << 8)
    return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)

    return (this[offset]) |
        (this[offset + 1] << 8) |
        (this[offset + 2] << 16) |
        (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)

    return (this[offset] << 24) |
        (this[offset + 1] << 16) |
        (this[offset + 2] << 8) |
        (this[offset + 3])
}

Buffer.prototype.readBigInt64LE = function readBigInt64LE (offset) {
    offset = offset >>> 0
    validateNumber(offset, 'offset')
    const first = this[offset]
    const last = this[offset + 7]
    if (first === undefined || last === undefined) {
        boundsError(offset, this.length - 8)
    }

    const val = this[offset + 4] +
        this[offset + 5] * 2 ** 8 +
        this[offset + 6] * 2 ** 16 +
        (last << 24) // Overflow

    return (BigInt(val) << BigInt(32)) +
        BigInt(first +
            this[++offset] * 2 ** 8 +
            this[++offset] * 2 ** 16 +
            this[++offset] * 2 ** 24)
}

Buffer.prototype.readBigInt64BE = function readBigInt64BE (offset) {
    offset = offset >>> 0
    validateNumber(offset, 'offset')
    const first = this[offset]
    const last = this[offset + 7]
    if (first === undefined || last === undefined) {
        boundsError(offset, this.length - 8)
    }

    const val = (first << 24) + // Overflow
        this[++offset] * 2 ** 16 +
        this[++offset] * 2 ** 8 +
        this[++offset]

    return (BigInt(val) << BigInt(32)) +
        BigInt(this[++offset] * 2 ** 24 +
            this[++offset] * 2 ** 16 +
            this[++offset] * 2 ** 8 +
            last)
}

Buffer.prototype.readFloatLE = function readFloatLE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)
    return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)
    return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 8)
    return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset) {
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 8)
    return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
    if (value > max || value < min) {
        const n = typeof min === 'bigint' ? 'n' : ''
        let range
        if (ext > 4) {
            if (min === 0 || min === BigInt(0)) {
                range = '>= 0' + n + ' and < 2' + n + ' ** ' + (ext * 8) + n
            } else {
                range = '>= -(2' + n + ' ** ' + (ext * 8 - 1) + n + ')' +
                    ' and < 2' + n + ' ** ' + (ext * 8 - 1) + n
            }
        } else {
            if (min === 0 || min === BigInt(0)) {
                range = '>= 0' + n + ' and <= ' + max + n
            } else {
                range = '>= ' + min + n + ' and <= ' + max + n
            }
        }
        throw new ERR_OUT_OF_RANGE('value', range, value)
    }
    if (offset + ext > buf.length) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS()
    }
}

Buffer.prototype.writeUintLE =
    Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength) {
        value = +value
        byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
        offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)
        const maxBytes = Math.pow(2, 8 * byteLength) - 1
        checkInt(this, value, offset, byteLength, maxBytes, 0)

        let mul = 1
        let i = 0
        this[offset] = value & 0xFF
        while (++i < byteLength && (mul *= 0x100)) {
            this[offset + i] = (value / mul) & 0xFF
        }

        return offset + byteLength
    }

Buffer.prototype.writeUintBE =
    Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength) {
        value = +value
        byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
        offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)
        const maxBytes = Math.pow(2, 8 * byteLength) - 1
        checkInt(this, value, offset, byteLength, maxBytes, 0)

        let i = byteLength - 1
        let mul = 1
        this[offset + i] = value & 0xFF
        while (--i >= 0 && (mul *= 0x100)) {
            this[offset + i] = (value / mul) & 0xFF
        }

        return offset + byteLength
    }

Buffer.prototype.writeUint8 =
    Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset) {
        value = +value
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 1)
        checkInt(this, value, offset, 1, 0xff, 0)
        this[offset] = (value & 0xff)
        return offset + 1
    }

Buffer.prototype.writeUint16LE =
    Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset) {
        value = +value
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 2)
        checkInt(this, value, offset, 2, 0xffff, 0)
        this[offset] = (value & 0xff)
        this[offset + 1] = (value >>> 8)
        return offset + 2
    }

Buffer.prototype.writeUint16BE =
    Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset) {
        value = +value
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 2)
        checkInt(this, value, offset, 2, 0xffff, 0)
        this[offset] = (value >>> 8)
        this[offset + 1] = (value & 0xff)
        return offset + 2
    }

Buffer.prototype.writeUint32LE =
    Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset) {
        value = +value
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 4)
        checkInt(this, value, offset, 4, 0xffffffff, 0)
        this[offset + 3] = (value >>> 24)
        this[offset + 2] = (value >>> 16)
        this[offset + 1] = (value >>> 8)
        this[offset] = (value & 0xff)
        return offset + 4
    }

Buffer.prototype.writeUint32BE =
    Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset) {
        value = +value
        if (offset === undefined) offset = 0
        offset = _validateOffset(offset, 'offset', 0, this.length - 4)
        checkInt(this, value, offset, 4, 0xffffffff, 0)
        this[offset] = (value >>> 24)
        this[offset + 1] = (value >>> 16)
        this[offset + 2] = (value >>> 8)
        this[offset + 3] = (value & 0xff)
        return offset + 4
    }

function wrtBigUInt64LE (buf, value, offset, min, max) {
    checkIntBI(value, min, max, buf, offset, 7)

    let lo = Number(value & BigInt(0xffffffff))
    buf[offset++] = lo
    lo = lo >> 8
    buf[offset++] = lo
    lo = lo >> 8
    buf[offset++] = lo
    lo = lo >> 8
    buf[offset++] = lo
    let hi = Number(value >> BigInt(32) & BigInt(0xffffffff))
    buf[offset++] = hi
    hi = hi >> 8
    buf[offset++] = hi
    hi = hi >> 8
    buf[offset++] = hi
    hi = hi >> 8
    buf[offset++] = hi
    return offset
}

function wrtBigUInt64BE (buf, value, offset, min, max) {
    checkIntBI(value, min, max, buf, offset, 7)

    let lo = Number(value & BigInt(0xffffffff))
    buf[offset + 7] = lo
    lo = lo >> 8
    buf[offset + 6] = lo
    lo = lo >> 8
    buf[offset + 5] = lo
    lo = lo >> 8
    buf[offset + 4] = lo
    let hi = Number(value >> BigInt(32) & BigInt(0xffffffff))
    buf[offset + 3] = hi
    hi = hi >> 8
    buf[offset + 2] = hi
    hi = hi >> 8
    buf[offset + 1] = hi
    hi = hi >> 8
    buf[offset] = hi
    return offset + 8
}

Buffer.prototype.writeBigUInt64LE = function writeBigUInt64LE (value, offset = 0) {
    return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt('0xffffffffffffffff'))
}

Buffer.prototype.writeBigUInt64BE = function writeBigUInt64BE (value, offset = 0) {
    return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt('0xffffffffffffffff'))
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength) {
    value = +value
    byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
    offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)
    const limit = Math.pow(2, (8 * byteLength) - 1)
    checkInt(this, value, offset, byteLength, limit - 1, -limit)

    let i = 0
    let mul = 1
    let sub = 0
    this[offset] = value & 0xFF
    while (++i < byteLength && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
            sub = 1
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
    }

    return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength) {
    value = +value
    byteLength = _validateOffset(byteLength, 'byteLength', 1, 6)
    offset = _validateOffset(offset, 'offset', 0, this.length - byteLength)
    const limit = Math.pow(2, (8 * byteLength) - 1)
    checkInt(this, value, offset, byteLength, limit - 1, -limit)

    let i = byteLength - 1
    let mul = 1
    let sub = 0
    this[offset + i] = value & 0xFF
    while (--i >= 0 && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
            sub = 1
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
    }

    return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 1)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
    if (value < 0) value = 0xff + value + 1
    this[offset] = (value & 0xff)
    return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 2)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 2)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
    return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
    return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, this.length - 4)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
    if (value < 0) value = 0xffffffff + value + 1
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
    return offset + 4
}

Buffer.prototype.writeBigInt64LE = function writeBigInt64LE (value, offset = 0) {
    return wrtBigUInt64LE(this, value, offset, -BigInt('0x8000000000000000'), BigInt('0x7fffffffffffffff'))
}

Buffer.prototype.writeBigInt64BE = function writeBigInt64BE (value, offset = 0) {
    return wrtBigUInt64BE(this, value, offset, -BigInt('0x8000000000000000'), BigInt('0x7fffffffffffffff'))
}

// Lowercase Uint aliases for BigUInt64 methods (Node.js compat)
Buffer.prototype.readBigUint64LE = Buffer.prototype.readBigUInt64LE
Buffer.prototype.readBigUint64BE = Buffer.prototype.readBigUInt64BE
Buffer.prototype.writeBigUint64LE = Buffer.prototype.writeBigUInt64LE
Buffer.prototype.writeBigUint64BE = Buffer.prototype.writeBigUInt64BE

function writeFloat (buf, value, offset, littleEndian) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, buf.length - 4)
    ieee754.write(buf, value, offset, littleEndian, 23, 4)
    return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset) {
    return writeFloat(this, value, offset, true)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset) {
    return writeFloat(this, value, offset, false)
}

function writeDouble (buf, value, offset, littleEndian) {
    value = +value
    if (offset === undefined) offset = 0
    offset = _validateOffset(offset, 'offset', 0, buf.length - 8)
    ieee754.write(buf, value, offset, littleEndian, 52, 8)
    return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset) {
    return writeDouble(this, value, offset, true)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset) {
    return writeDouble(this, value, offset, false)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
    if (!isInstance(this, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('source', ['Buffer', 'Uint8Array'], this)
    }
    if (!isInstance(target, Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('target', ['Buffer', 'Uint8Array'], target)
    }
    if (!targetStart) targetStart = 0
    if (!start) start = 0
    if (end === undefined || end === null) end = this.length

    // Fatal error conditions
    if (targetStart < 0) {
        throw new ERR_OUT_OF_RANGE('targetStart', '>= 0', targetStart)
    }
    if (start < 0 || start > this.length) {
        throw new ERR_OUT_OF_RANGE('sourceStart', '>= 0 and <= ' + this.length, start)
    }
    if (end < 0) {
        throw new ERR_OUT_OF_RANGE('sourceEnd', '>= 0', end)
    }

    targetStart = targetStart >>> 0
    start = start >>> 0
    end = end >>> 0

    if (targetStart >= target.length) targetStart = target.length
    if (end > 0 && end < start) end = start

    // Copy 0 bytes; we're done
    if (end === start) return 0
    if (target.length === 0 || this.length === 0) return 0

    // Are we oob?
    if (end > this.length) end = this.length
    if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start
    }

    const len = end - start

    if (this === target) {
        this.copyWithin(targetStart, start, end)
    } else {
        Uint8Array.prototype.set.call(
            target,
            this.subarray(start, end),
            targetStart
        )
    }

    return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
    const length = this.byteLength

    // Guard against length tampering. Node uses internal slots for bounds checks,
    // while JS-visible `length` can be shadowed on the object.
    if (this.length !== length) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS()
    }

    // Handle string cases:
    if (typeof val === 'string') {
        if (typeof start === 'string') {
            encoding = start
            start = 0
            end = length
        } else if (typeof end === 'string') {
            encoding = end
            end = length
        }
        if (encoding !== undefined && typeof encoding !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('encoding', 'string', encoding)
        }
        if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
            throw new ERR_UNKNOWN_ENCODING(encoding)
        }
        if (val.length === 1) {
            const code = val.charCodeAt(0)
            if ((encoding === 'utf8' && code < 128) ||
                encoding === 'latin1') {
                // Fast path: If `val` fits into a single byte, use that numeric value.
                val = code
            }
        }
    } else if (typeof val === 'number') {
        val = val & 255
    } else if (typeof val === 'boolean') {
        val = Number(val)
    }

    if (start === undefined) {
        start = 0
    } else if (typeof start !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('offset', 'number', start)
    }

    if (end === undefined) {
        end = length
    } else if (typeof end !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('end', 'number', end)
    }

    if (start < 0 || length < start) {
        throw new ERR_OUT_OF_RANGE('offset', `>= 0 and <= ${length}`, start)
    }

    if (end < 0 || length < end) {
        throw new ERR_OUT_OF_RANGE('end', `>= 0 and <= ${length}`, end)
    }

    if (end <= start) {
        return this
    }

    start = start >>> 0
    end = end >>> 0

    if (!val) val = 0

    let i
    if (typeof val === 'number') {
        for (i = start; i < end; ++i) {
            this[i] = val
        }
    } else {
        const bytes = isInstance(val, Uint8Array)
            ? val
            : Buffer.from(val, encoding)
        const len = bytes.length
        if (len === 0) {
            if (Array.isArray(val)) {
                for (i = start; i < end; ++i) {
                    this[i] = 0
                }
                return this
            }
            if (typeof val === 'string') {
                throw new ERR_INVALID_ARG_VALUE('value', val)
            }
            throw new ERR_INVALID_ARG_VALUE('value', val)
        }
        for (i = 0; i < end - start; ++i) {
            this[i + start] = bytes[i % len]
        }
    }

    return this
}



// CHECK FUNCTIONS
// ===============

function checkBounds (buf, offset, byteLength) {
    if (typeof offset !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('offset', 'number', offset)
    }
    if (offset < 0 || offset + byteLength > buf.length) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS()
    }
}

function checkIntBI (value, min, max, buf, offset, byteLength) {
    if (value > max || value < min) {
        const n = typeof min === 'bigint' ? 'n' : ''
        let range
        if (byteLength > 3) {
            if (min === 0 || min === BigInt(0)) {
                range = `>= 0${n} and < 2${n} ** ${(byteLength + 1) * 8}${n}`
            } else {
                range = `>= -(2${n} ** ${(byteLength + 1) * 8 - 1}${n}) and < 2 ** ` +
                    `${(byteLength + 1) * 8 - 1}${n}`
            }
        } else {
            range = `>= ${min}${n} and <= ${max}${n}`
        }
        throw new ERR_OUT_OF_RANGE('value', range, value)
    }
    checkBounds(buf, offset, byteLength)
}

function validateNumber (value, name) {
    if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(name, 'number', value)
    }
}

function boundsError (value, length, type) {
    if (Math.floor(value) !== value) {
        validateNumber(value, type)
        throw new ERR_OUT_OF_RANGE(type || 'offset', 'an integer', value)
    }

    if (length < 0) {
        throw new ERR_BUFFER_OUT_OF_BOUNDS()
    }

    throw new ERR_OUT_OF_RANGE(type || 'offset',
        `>= ${type ? 1 : 0} and <= ${length}`,
        value)
}

// HELPER FUNCTIONS
// ================

const INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
    // Node takes equal signs as end of the Base64 encoding
    str = str.split('=')[0]
    // Node strips out invalid characters like \n and \t from the string, base64-js does not
    str = str.trim().replace(INVALID_BASE64_RE, '')
    // Node converts strings with length < 2 to ''
    if (str.length < 2) return ''
    // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
    while (str.length % 4 !== 0) {
        str = str + '='
    }
    return str
}

function base64UrlToBase64 (str) {
    // Replace URL-safe chars with standard base64 chars
    str = str.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding
    const pad = str.length % 4
    if (pad === 2) str += '=='
    else if (pad === 3) str += '='
    return str
}

function base64urlSlice (buf, start, end) {
    const base64str = base64Slice(buf, start, end)
    // Convert to base64url: replace chars and remove padding
    return base64str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function utf8ToBytes (string, units) {
    units = units || Infinity
    let codePoint
    const length = string.length
    let leadSurrogate = null
    const bytes = []

    for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i)

        // is surrogate component
        if (codePoint > 0xD7FF && codePoint < 0xE000) {
            // last char was a lead
            if (!leadSurrogate) {
                // no lead yet
                if (codePoint > 0xDBFF) {
                    // unexpected trail
                    if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                    continue
                } else if (i + 1 === length) {
                    // unpaired lead
                    if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                    continue
                }

                // valid lead
                leadSurrogate = codePoint

                continue
            }

            // 2 leads in a row
            if (codePoint < 0xDC00) {
                if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
                leadSurrogate = codePoint
                continue
            }

            // valid surrogate pair
            codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
        } else if (leadSurrogate) {
            // valid bmp char, but last char was a lead
            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        }

        leadSurrogate = null

        // encode utf8
        if (codePoint < 0x80) {
            if ((units -= 1) < 0) break
            bytes.push(codePoint)
        } else if (codePoint < 0x800) {
            if ((units -= 2) < 0) break
            bytes.push(
                codePoint >> 0x6 | 0xC0,
                codePoint & 0x3F | 0x80
            )
        } else if (codePoint < 0x10000) {
            if ((units -= 3) < 0) break
            bytes.push(
                codePoint >> 0xC | 0xE0,
                codePoint >> 0x6 & 0x3F | 0x80,
                codePoint & 0x3F | 0x80
            )
        } else if (codePoint < 0x110000) {
            if ((units -= 4) < 0) break
            bytes.push(
                codePoint >> 0x12 | 0xF0,
                codePoint >> 0xC & 0x3F | 0x80,
                codePoint >> 0x6 & 0x3F | 0x80,
                codePoint & 0x3F | 0x80
            )
        } else {
            throw new Error('Invalid code point')
        }
    }

    return bytes
}

function asciiToBytes (str) {
    const byteArray = []
    for (let i = 0; i < str.length; ++i) {
        // Node's code seems to be doing this and not & 0x7F..
        byteArray.push(str.charCodeAt(i) & 0xFF)
    }
    return byteArray
}

function utf16leToBytes (str, units) {
    let c, hi, lo
    const byteArray = []
    for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break

        c = str.charCodeAt(i)
        hi = c >> 8
        lo = c % 256
        byteArray.push(lo)
        byteArray.push(hi)
    }

    return byteArray
}

function base64ToBytes (str) {
    return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
    let i
    for (i = 0; i < length; ++i) {
        if ((i + offset >= dst.length) || (i >= src.length)) break
        dst[i + offset] = src[i]
    }
    return i
}

function isInstance (obj, type) {
    return obj instanceof type ||
        (obj != null && obj.constructor != null && obj.constructor.name != null &&
            obj.constructor.name === type.name) ||
        (type === Uint8Array && Buffer.isBuffer(obj))
}

// Create lookup table for `toString('hex')`
// See: https://github.com/feross/buffer/issues/219
const hexSliceLookupTable = (function () {
    const alphabet = '0123456789abcdef'
    const table = new Array(256)
    for (let i = 0; i < 16; ++i) {
        const i16 = i * 16
        for (let j = 0; j < 16; ++j) {
            table[i16 + j] = alphabet[i] + alphabet[j]
        }
    }
    return table
})()

// hex lookup table for Buffer.from(x, 'hex')
/* eslint-disable no-multi-spaces, indent */
const hexCharValueTable = [
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    0,  1,  2,  3,  4,  5,  6,  7,
    8,  9, -1, -1, -1, -1, -1, -1,
    -1, 10, 11, 12, 13, 14, 15, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, 10, 11, 12, 13, 14, 15, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1
]
/* eslint-enable no-multi-spaces, indent */

function validateBufferSource (source) {
    if (source instanceof ArrayBuffer || source instanceof SharedArrayBuffer) {
        if (typeof source.detached === 'boolean' && source.detached) {
            const err = new TypeError('Cannot perform operation on a detached ArrayBuffer')
            err.code = 'ERR_INVALID_STATE'
            throw err
        }
        if (source.byteLength === 0 && source.maxByteLength === undefined) {
            // Possibly detached — try to create a view to detect
            try {
                new Uint8Array(source)
            } catch (e) {
                const err = new TypeError('Cannot perform operation on a detached ArrayBuffer')
                err.code = 'ERR_INVALID_STATE'
                throw err
            }
        }
        return new Uint8Array(source)
    }
    if (!ArrayBuffer.isView(source)) {
        const err = new TypeError(
            'The "source" argument must be an instance of SharedArrayBuffer, ArrayBuffer, Buffer, TypedArray, or DataView. Received ' +
            (source === null ? 'null' : typeof source === 'object' ? 'an instance of ' + (source.constructor ? source.constructor.name : 'Object') : 'type ' + typeof source)
        )
        err.code = 'ERR_INVALID_ARG_TYPE'
        throw err
    }
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

// Node.js-compatible Blob wrapper
// Wraps the fetch-blob polyfill with Node.js error codes and API compatibility

const _blobBrand = Symbol('blobBrand')

function _validateBlobThis(self) {
    if (!self || !self[_blobBrand]) {
        throw new ERR_INVALID_THIS('Blob')
    }
}

const _innerKey = Symbol('blobInner')

const _Blob = class Blob {
    constructor(sources = [], options = {}) {
        // Sentinel for _fromInner
        if (sources === _innerKey) {
            this[_innerKey] = options
            Object.defineProperty(this, _blobBrand, { value: true, enumerable: false, writable: false, configurable: false })
            return
        }

        if (sources !== undefined && sources !== null && typeof sources === 'object' && typeof sources[Symbol.iterator] !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('sources', 'a sequence', sources)
        }
        if (sources !== undefined && typeof sources !== 'object') {
            throw new ERR_INVALID_ARG_TYPE('sources', 'a sequence', sources)
        }
        if (options !== undefined && options !== null && typeof options !== 'object' && typeof options !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('options', 'object', options)
        }

        // Validate endings option
        if (options !== null && options !== undefined) {
            const endings = options.endings
            if (endings !== undefined && endings !== 'transparent' && endings !== 'native') {
                throw new ERR_INVALID_ARG_VALUE('options.endings', endings)
            }
        }

        // Node.js lowercases the type per the Blob specification
        let effectiveOptions = options || {}
        const rawType = effectiveOptions.type
        if (rawType !== undefined) {
            const lowered = String(rawType).toLowerCase()
            effectiveOptions = { __proto__: null, type: lowered, endings: effectiveOptions.endings }
        }
        this[_innerKey] = new _BlobImport(sources === undefined ? [] : sources, effectiveOptions)
        Object.defineProperty(this, _blobBrand, { value: true, enumerable: false, writable: false, configurable: false })
    }

    get size() {
        _validateBlobThis(this)
        return this[_innerKey].size
    }

    get type() {
        _validateBlobThis(this)
        return this[_innerKey].type
    }

    async text() {
        _validateBlobThis(this)
        return this[_innerKey].text()
    }

    async arrayBuffer() {
        _validateBlobThis(this)
        return this[_innerKey].arrayBuffer()
    }

    async bytes() {
        _validateBlobThis(this)
        const ab = await this[_innerKey].arrayBuffer()
        return new Uint8Array(ab)
    }

    stream() {
        _validateBlobThis(this)
        return this[_innerKey].stream()
    }

    slice(start, end, type) {
        _validateBlobThis(this)
        const sliced = this[_innerKey].slice(start, end, type)
        return new Blob(_innerKey, sliced)
    }
}

const _inspectCustom = Symbol.for('nodejs.util.inspect.custom')
_Blob.prototype[_inspectCustom] = function(depth, options, inspect) {
    if (depth < 0) return '[Blob]'
    return `Blob { size: ${this.size}, type: '${this.type}' }`
}

Object.defineProperty(_Blob.prototype, Symbol.toStringTag, {
    value: 'Blob',
    writable: false,
    enumerable: false,
    configurable: true,
})

Object.defineProperties(_Blob.prototype, {
    size: { enumerable: true },
    type: { enumerable: true },
    slice: { enumerable: true },
    stream: { enumerable: true },
    text: { enumerable: true },
    arrayBuffer: { enumerable: true },
    bytes: { enumerable: true },
})

export const Blob = _Blob

const _File = class File extends _Blob {
    #name = ''
    #lastModified = 0

    constructor(fileBits, fileName, options = {}) {
        if (arguments.length < 2) {
            throw new TypeError(`Failed to construct 'File': 2 arguments required, but only ${arguments.length} present.`)
        }
        super(fileBits, options)

        if (options === null) options = {}

        const lastModifiedRaw = options.lastModified
        let lastModified
        if (lastModifiedRaw === undefined) {
            lastModified = Date.now()
        } else {
            if (typeof lastModifiedRaw === 'bigint') {
                throw new TypeError('Cannot convert a BigInt value to a number')
            }
            lastModified = +lastModifiedRaw
        }
        if (!Number.isNaN(lastModified)) {
            this.#lastModified = lastModified
        }

        this.#name = String(fileName)
    }

    get name() {
        return this.#name
    }

    get lastModified() {
        return this.#lastModified
    }
}

Object.defineProperty(_File.prototype, Symbol.toStringTag, {
    value: 'File',
    writable: false,
    enumerable: false,
    configurable: true,
})

Object.defineProperties(_File.prototype, {
    name: { enumerable: true },
    lastModified: { enumerable: true },
})

_File.prototype[_inspectCustom] = function(depth, options, inspect) {
    if (depth < 0) return '[File]'
    return `File { size: ${this.size}, type: '${this.type}', name: '${this.name}', lastModified: ${this.lastModified} }`
}

export const File = _File

export function resolveObjectURL(url) {
    if (typeof url !== 'string') return undefined
    const registry = globalThis.__blobURLRegistry
    if (!registry) return undefined
    const blob = registry[url]
    if (blob === undefined || blob === null) return undefined
    return blob
}

export function isAscii (source) {
    const bytes = validateBufferSource(source)
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] > 127) return false
    }
    return true
}

export function isUtf8 (source) {
    const bytes = validateBufferSource(source)
    let i = 0
    while (i < bytes.length) {
        const b = bytes[i]
        if (b <= 0x7F) {
            i++
        } else if ((b & 0xE0) === 0xC0) {
            if (b < 0xC2) return false // overlong
            if (i + 1 >= bytes.length) return false
            if ((bytes[i + 1] & 0xC0) !== 0x80) return false
            i += 2
        } else if ((b & 0xF0) === 0xE0) {
            if (i + 2 >= bytes.length) return false
            const b1 = bytes[i + 1]
            const b2 = bytes[i + 2]
            if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80) return false
            if (b === 0xE0 && b1 < 0xA0) return false // overlong
            if (b === 0xED && b1 >= 0xA0) return false // surrogate
            i += 3
        } else if ((b & 0xF8) === 0xF0) {
            if (b > 0xF4) return false
            if (i + 3 >= bytes.length) return false
            const b1 = bytes[i + 1]
            const b2 = bytes[i + 2]
            const b3 = bytes[i + 3]
            if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80) return false
            if (b === 0xF0 && b1 < 0x90) return false // overlong
            if (b === 0xF4 && b1 >= 0x90) return false // > U+10FFFF
            i += 4
        } else {
            return false
        }
    }
    return true
}

const _defaultExport = {
    get INSPECT_MAX_BYTES() { return _inspectMaxBytes },
    set INSPECT_MAX_BYTES(val) {
        if (typeof val !== 'number') {
            throw new ERR_INVALID_ARG_TYPE('buffer.INSPECT_MAX_BYTES', 'number', val)
        }
        if (val < 0 || val !== val) { // NaN check
            throw new ERR_OUT_OF_RANGE('buffer.INSPECT_MAX_BYTES', '>= 0', val)
        }
        _inspectMaxBytes = val
    },
    kMaxLength,
    kStringMaxLength,
    constants,
    Buffer,
    SlowBuffer,
    Blob,
    File,
    resolveObjectURL,
    isAscii,
    isUtf8
}
export default _defaultExport
