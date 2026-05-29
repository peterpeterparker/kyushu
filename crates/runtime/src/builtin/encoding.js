import * as encodingNative from '__wasm_rquickjs_builtin/encoding_native'
import * as streams from '__wasm_rquickjs_builtin/streams';
import {
    ERR_ENCODING_INVALID_ENCODED_DATA,
    ERR_ENCODING_NOT_SUPPORTED,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_THIS,
    ERR_NO_ICU,
} from '__wasm_rquickjs_builtin/internal/errors';

const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');
const textDecoderState = new WeakMap();
const textDecoderStreamState = new WeakSet();
const textEncoderStreamState = new WeakSet();

function validateOptions(options) {
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }
}

function getTextDecoderState(thisArg) {
    const state = textDecoderState.get(thisArg);
    if (state === undefined) {
        throw new ERR_INVALID_THIS('TextDecoder');
    }
    return state;
}

function normalizeLabel(label) {
    const safeLabel = label === undefined ? 'utf-8' : `${label}`;
    const canonical = encodingNative.canonical_encoding(safeLabel);
    if (canonical === undefined || canonical === null) {
        throw new ERR_ENCODING_NOT_SUPPORTED(safeLabel);
    }
    return canonical;
}

function copyBytes(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
}

function concatBytes(first, second) {
    if (first.length === 0) return copyBytes(second);
    if (second.length === 0) return copyBytes(first);
    const result = new Uint8Array(first.length + second.length);
    result.set(first, 0);
    result.set(second, first.length);
    return result;
}

function trailingUtf8IncompleteLength(bytes) {
    const length = bytes.length;
    if (length === 0) return 0;

    let start = length - 1;
    while (start >= 0 && (bytes[start] & 0xc0) === 0x80 && length - start <= 4) {
        start--;
    }
    if (start < 0) return 0;

    const lead = bytes[start];
    let needed = 0;
    if (lead >= 0xc2 && lead <= 0xdf) needed = 2;
    else if (lead >= 0xe0 && lead <= 0xef) needed = 3;
    else if (lead >= 0xf0 && lead <= 0xf4) needed = 4;
    else return 0;

    const available = length - start;
    if (available >= 2) {
        const second = bytes[start + 1];
        if (lead === 0xe0 && second < 0xa0) return 0;
        if (lead === 0xed && second > 0x9f) return 0;
        if (lead === 0xf0 && second < 0x90) return 0;
        if (lead === 0xf4 && second > 0x8f) return 0;
    }
    return available < needed ? available : 0;
}

function readUtf16CodeUnit(bytes, offset, littleEndian) {
    return littleEndian
        ? bytes[offset] | (bytes[offset + 1] << 8)
        : (bytes[offset] << 8) | bytes[offset + 1];
}

function trailingUtf16IncompleteLength(bytes, littleEndian) {
    let pending = bytes.length % 2;
    const completeLength = bytes.length - pending;
    if (completeLength >= 2) {
        const lastUnit = readUtf16CodeUnit(bytes, completeLength - 2, littleEndian);
        if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
            pending += 2;
        }
    }
    return pending;
}

function trailingIncompleteLength(bytes, encoding) {
    if (encoding === 'utf-8') return trailingUtf8IncompleteLength(bytes);
    if (encoding === 'utf-16le') return trailingUtf16IncompleteLength(bytes, true);
    if (encoding === 'utf-16be') return trailingUtf16IncompleteLength(bytes, false);
    return 0;
}

function toDecodeBytes(input) {
    if (input === undefined) {
        return new Uint8Array(0);
    }
    if (input instanceof ArrayBuffer) {
        try {
            return new Uint8Array(input);
        } catch (_) {
            return new Uint8Array(0);
        }
    }
    if (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer) {
        return new Uint8Array(input);
    }
    if (ArrayBuffer.isView(input)) {
        try {
            if (input.buffer instanceof ArrayBuffer ||
                (typeof SharedArrayBuffer !== 'undefined' && input.buffer instanceof SharedArrayBuffer)) {
                return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
            }
        } catch (_) {
            return new Uint8Array(0);
        }
    }
    throw new ERR_INVALID_ARG_TYPE('input', 'an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView', input);
}

function decodeNative(bytes, state, stream) {
    const [result, error] = encodingNative.decode(bytes, state.encoding, stream, state.fatal, state.ignoreBOMForNextDecode);
    if (error !== undefined) {
        throw new ERR_ENCODING_INVALID_ENCODED_DATA(state.encoding);
    }
    return result;
}

export class TextDecoder {
    constructor(label, options) {
        validateOptions(options);
        const encoding = normalizeLabel(label);
        const fatal = !!options?.fatal;
        if (fatal) {
            throw new ERR_NO_ICU('fatal');
        }

        textDecoderState.set(this, {
            encoding,
            fatal,
            ignoreBOM: !!options?.ignoreBOM,
            ignoreBOMForNextDecode: !!options?.ignoreBOM,
            pending: new Uint8Array(0),
            streaming: false,
        });
    }

    get encoding() {
        return getTextDecoderState(this).encoding;
    }

    get fatal() {
        return getTextDecoderState(this).fatal;
    }

    get ignoreBOM() {
        return getTextDecoderState(this).ignoreBOM;
    }

    decode(buffer, options) {
        const state = getTextDecoderState(this);
        validateOptions(options);

        let bytes = toDecodeBytes(buffer);
        const stream = !!options?.stream;
        if (state.pending.length !== 0) {
            bytes = concatBytes(state.pending, bytes);
            state.pending = new Uint8Array(0);
        }

        if (stream) {
            const pendingLength = trailingIncompleteLength(bytes, state.encoding);
            if (pendingLength !== 0) {
                state.pending = bytes.slice(bytes.length - pendingLength);
                bytes = bytes.slice(0, bytes.length - pendingLength);
            }
            const result = decodeNative(bytes, state, true);
            if (bytes.length !== 0) {
                state.ignoreBOMForNextDecode = true;
            }
            state.streaming = true;
            return result;
        }

        const result = decodeNative(bytes, state, false);
        state.pending = new Uint8Array(0);
        state.ignoreBOMForNextDecode = state.ignoreBOM;
        state.streaming = false;
        return result;
    }

    [customInspectSymbol](depth, options) {
        const state = getTextDecoderState(this);
        if (depth < 0) {
            return '[TextDecoder]';
        }
        if (options?.showHidden) {
            return `TextDecoder { encoding: '${state.encoding}', fatal: ${state.fatal}, ignoreBOM: ${state.ignoreBOM} }`;
        }
        return `TextDecoder { encoding: '${state.encoding}', fatal: ${state.fatal}, ignoreBOM: ${state.ignoreBOM} }`;
    }
}

Object.defineProperties(TextDecoder.prototype, {
    [Symbol.toStringTag]: {
        value: 'TextDecoder',
        writable: false,
        enumerable: false,
        configurable: true,
    },
});

export class TextEncoder {
    constructor() {
    }

    get encoding() {
        return 'utf-8';
    }

    encode(input = '') {
        return encodingNative.encode(`${input}`);
    }

    encodeInto(string, uint8Array) {
        if (typeof string !== 'string') {
            throw new TypeError('The "src" argument must be of type string. Received type ' + typeof string);
        }
        return encodingNative.encode_into(string, uint8Array);
    }
}

export class TextDecoderStream extends streams.TransformStream {
    constructor(label, options) {
        validateOptions(options);
        const encoding = normalizeLabel(label);
        const fatal = !!options?.fatal;
        if (fatal) {
            throw new ERR_NO_ICU('fatal');
        }

        let decoder;
        super({
            start() {
                decoder = new TextDecoder(encoding, options);
            },
            transform(chunk, ctl) {
                const decoded = decoder.decode(chunk, { stream: true });
                if (decoded !== '') {
                    ctl.enqueue(decoded);
                }
            },
            flush(ctl) {
                const decoded = decoder.decode();
                if (decoded !== '') {
                    ctl.enqueue(decoded);
                }
                decoder = null;
            },
        });

        this._label = encoding;
        this._fatal = fatal;
        this._ignoreBOM = !!options?.ignoreBOM;
        textDecoderStreamState.add(this);
    }

    get encoding() {
        return this._label;
    }

    get fatal() {
        return this._fatal;
    }

    get ignoreBOM() {
        return this._ignoreBOM;
    }

    [customInspectSymbol]() {
        if (!textDecoderStreamState.has(this)) {
            throw new ERR_INVALID_THIS('TextDecoderStream');
        }
        return `TextDecoderStream {\n  encoding: '${this.encoding}',\n  fatal: ${this.fatal},\n  ignoreBOM: ${this.ignoreBOM},\n  readable: ReadableStream { locked: ${this.readable.locked}, state: 'readable', supportsBYOB: false },\n  writable: WritableStream { locked: ${this.writable.locked}, state: 'writable' }\n}`;
    }
}

export class TextEncoderStream extends streams.TransformStream {
    constructor() {
        let encoder;
        super({
            start() {
                encoder = new TextEncoder();
            },
            transform(chunk, ctl) {
                ctl.enqueue(encoder.encode(chunk));
            },
            flush() {
                encoder = null;
            },
        });
        textEncoderStreamState.add(this);
    }

    get encoding() {
        return 'utf-8';
    }

    [customInspectSymbol]() {
        if (!textEncoderStreamState.has(this)) {
            throw new ERR_INVALID_THIS('TextEncoderStream');
        }
        return `TextEncoderStream {\n  encoding: '${this.encoding}',\n  readable: ReadableStream { locked: ${this.readable.locked}, state: 'readable', supportsBYOB: false },\n  writable: WritableStream { locked: ${this.writable.locked}, state: 'writable' }\n}`;
    }
}
