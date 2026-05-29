import { Buffer } from 'node:buffer';

const hexTable = new Array(256);
for (let i = 0; i < 256; ++i) {
    hexTable[i] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
}

const unhexTable = new Int8Array([
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
     0,  1,  2,  3,  4,  5,  6,  7,  8,  9, -1, -1, -1, -1, -1, -1,
    -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
]);

function makeUriError() {
    const err = new URIError('URI malformed');
    err.code = 'ERR_INVALID_URI';
    return err;
}

export function unescapeBuffer(s, decodeSpaces) {
    const chunks = [];
    let lastPos = 0;

    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);

        if (decodeSpaces && c === 0x2B /* + */) {
            if (i > lastPos) chunks.push(Buffer.from(s.slice(lastPos, i), 'utf8'));
            chunks.push(Buffer.from(' ', 'utf8'));
            lastPos = i + 1;
            continue;
        }

        if (c === 0x25 /* % */ && i + 2 < s.length) {
            const hi = s.charCodeAt(i + 1);
            const lo = s.charCodeAt(i + 2);
            const hexHigh = unhexTable[hi];
            const hexLow = unhexTable[lo];
            if (hexHigh >= 0 && hexLow >= 0) {
                if (i > lastPos) chunks.push(Buffer.from(s.slice(lastPos, i), 'utf8'));
                chunks.push(Buffer.from([(hexHigh << 4) | hexLow]));
                i += 2;
                lastPos = i + 1;
            }
        }
    }

    if (lastPos === 0) return Buffer.from(s, 'utf8');
    if (lastPos < s.length) chunks.push(Buffer.from(s.slice(lastPos), 'utf8'));
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

export function unescape(s, decodeSpaces) {
    try {
        return decodeURIComponent(s);
    } catch {
        return QueryString.unescapeBuffer(s, decodeSpaces).toString();
    }
}

export function escape(str) {
    if (typeof str !== 'string') {
        if (typeof str === 'object')
            str = String(str);
        else
            str += '';
    }

    let out = '';
    let lastPos = 0;

    for (let i = 0; i < str.length; ++i) {
        const c = str.charCodeAt(i);

        if (
            (c >= 0x41 && c <= 0x5A) || // A-Z
            (c >= 0x61 && c <= 0x7A) || // a-z
            (c >= 0x30 && c <= 0x39) || // 0-9
            c === 0x2D || // -
            c === 0x2E || // .
            c === 0x5F || // _
            c === 0x7E || // ~
            c === 0x21 || // !
            c === 0x27 || // '
            c === 0x28 || // (
            c === 0x29 || // )
            c === 0x2A    // *
        ) {
            continue;
        }

        if (i > lastPos) {
            out += str.slice(lastPos, i);
        }

        if (c < 0x80) {
            out += hexTable[c];
            lastPos = i + 1;
            continue;
        }

        if (c < 0x800) {
            out += hexTable[0xC0 | (c >> 6)] + hexTable[0x80 | (c & 0x3F)];
            lastPos = i + 1;
            continue;
        }

        if (c >= 0xD800 && c <= 0xDBFF) {
            // High surrogate
            const nextI = i + 1;
            if (nextI >= str.length) {
                throw makeUriError();
            }
            const lo = str.charCodeAt(nextI);
            const codepoint = 0x10000 + ((c & 0x3FF) << 10) + (lo & 0x3FF);
            out +=
                hexTable[0xF0 | (codepoint >> 18)] +
                hexTable[0x80 | ((codepoint >> 12) & 0x3F)] +
                hexTable[0x80 | ((codepoint >> 6) & 0x3F)] +
                hexTable[0x80 | (codepoint & 0x3F)];
            ++i; // skip low surrogate
            lastPos = i + 1;
            continue;
        }

        if (c >= 0xDC00 && c <= 0xDFFF) {
            throw makeUriError();
        }

        out +=
            hexTable[0xE0 | (c >> 12)] +
            hexTable[0x80 | ((c >> 6) & 0x3F)] +
            hexTable[0x80 | (c & 0x3F)];
        lastPos = i + 1;
    }

    if (lastPos === 0) return str;
    if (lastPos < str.length) return out + str.slice(lastPos);
    return out;
}

export function stringify(obj, sep, eq, options) {
    sep = sep || '&';
    eq = eq || '=';

    let encode = QueryString.escape;

    if (options && typeof options.encodeURIComponent === 'function') {
        encode = options.encodeURIComponent;
    }

    if (obj === null || typeof obj !== 'object') {
        return '';
    }

    const keys = Object.keys(obj);
    const len = keys.length;
    const fields = [];

    for (let i = 0; i < len; ++i) {
        const k = keys[i];
        const v = obj[k];
        let ks = encode(k) + eq;

        if (Array.isArray(v)) {
            if (v.length === 0) continue;
            for (let j = 0; j < v.length; ++j) {
                fields.push(ks + encodeStringifiedPrimitive(v[j], encode));
            }
        } else {
            fields.push(ks + encodeStringifiedPrimitive(v, encode));
        }
    }

    return fields.join(sep);
}

function encodeStringifiedPrimitive(v, encode) {
    if (typeof v === 'string')
        return v.length ? encode(v) : '';
    if (typeof v === 'number' && isFinite(v))
        return encode('' + v);
    if (typeof v === 'bigint')
        return '' + v;
    if (typeof v === 'boolean')
        return v ? 'true' : 'false';
    return '';
}

export function parse(qs, sep, eq, options) {
    const obj = Object.create(null);

    if (typeof qs !== 'string' || qs.length === 0) {
        return obj;
    }

    sep = typeof sep === 'string' ? sep : (sep !== undefined && sep !== null ? '' + sep : '&');
    eq = typeof eq === 'string' ? eq : (eq !== undefined && eq !== null ? '' + eq : '=');

    const sepLen = sep.length;
    const eqLen = eq.length;

    let maxKeys = 1000;
    if (options && typeof options.maxKeys === 'number') {
        maxKeys = options.maxKeys;
    }
    if (!Number.isFinite(maxKeys) || maxKeys <= 0) {
        maxKeys = Infinity;
    }

    let customDecoder = false;
    let decode;
    if (options && typeof options.decodeURIComponent === 'function') {
        decode = options.decodeURIComponent;
        customDecoder = true;
    }

    let pairs = 0;
    let start = 0;

    while (start <= qs.length && pairs < maxKeys) {
        let sepIdx;
        if (sepLen > 0) {
            sepIdx = qs.indexOf(sep, start);
        } else {
            if (start >= qs.length) break;
            sepIdx = start + 1;
            if (sepIdx > qs.length) sepIdx = -1;
        }
        if (sepIdx === -1) sepIdx = qs.length;

        const part = qs.slice(start, sepIdx);
        start = sepIdx + sepLen;

        ++pairs;

        if (part.length === 0 && sepLen > 0) {
            continue;
        }

        let key;
        let value;

        if (eqLen > 0) {
            const eqIdx = part.indexOf(eq);
            if (eqIdx === -1) {
                key = part;
                value = '';
            } else {
                key = part.slice(0, eqIdx);
                value = part.slice(eqIdx + eqLen);
            }
        } else {
            key = '';
            value = part;
        }

        key = decodeField(key, decode, customDecoder);
        value = decodeField(value, decode, customDecoder);

        const existing = obj[key];
        if (existing === undefined) {
            obj[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            obj[key] = [existing, value];
        }
    }

    return obj;
}

function decodeField(s, decode, customDecoder) {
    if (s.indexOf('+') !== -1) {
        s = s.replace(/\+/g, ' ');
    }

    if (!customDecoder) {
        return QueryString.unescape(s, true);
    }
    try {
        return decode(s);
    } catch {
        return QueryString.unescape(s, true);
    }
}

export const decode = parse;
export const encode = stringify;

const QueryString = {
    parse,
    stringify,
    decode: parse,
    encode: stringify,
    escape,
    unescape,
    unescapeBuffer,
};

export default QueryString;
