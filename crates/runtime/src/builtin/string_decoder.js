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

import { Buffer } from 'buffer';
import { normalizeEncoding } from '__wasm_rquickjs_builtin/internal/normalize_encoding';
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_THIS,
  ERR_UNKNOWN_ENCODING,
} from '__wasm_rquickjs_builtin/internal/errors';
import { utf8_decode as nativeUtf8Decode } from '__wasm_rquickjs_builtin/string_decoder_native';

// Sentinel symbol to identify StringDecoder instances
const kDecoder = Symbol('StringDecoder');

function coerceToBuffer(buf) {
  if (Buffer.isBuffer(buf)) return buf;
  if (ArrayBuffer.isView(buf))
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  throw new ERR_INVALID_ARG_TYPE(
    'buf',
    ['Buffer', 'TypedArray', 'DataView'],
    buf
  );
}

function checkThis(self) {
  if (!self || !self[kDecoder])
    throw new ERR_INVALID_THIS('StringDecoder');
}

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte. If an invalid byte is detected, -2 is returned.
function utf8CheckByte(byte) {
  if (byte <= 0x7f) return 0;
  if (byte >> 5 === 0x06) return 2;
  if (byte >> 4 === 0x0e) return 3;
  if (byte >> 3 === 0x1e) return 4;
  return byte >> 6 === 0x02 ? -1 : -2;
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
function utf8CheckIncomplete(self, buf, i) {
  let j = buf.length - 1;
  if (j < i) return 0;
  let nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 1;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 2;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2) nb = 0;
      else self.lastNeed = nb - 3;
    }
    return nb;
  }
  return 0;
}

// Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
// Uses the native V8 DFA to determine exact replacement character count.
function utf8FillLast(buf) {
  const p = this.lastTotal - this.lastNeed;
  // Check how many new bytes from buf are valid continuations
  let consumed = 0;
  while (consumed < this.lastNeed && consumed < buf.length) {
    if ((buf[consumed] & 0xc0) !== 0x80) break;
    consumed++;
  }
  // Did a non-continuation byte break the sequence?
  const broken = consumed < this.lastNeed && consumed < buf.length;
  if (broken) {
    // A non-continuation byte was found — the sequence is invalid.
    // Build a temp buffer with buffered bytes + consumed continuations and
    // decode via the native DFA to get correct replacement char count.
    const totalBytes = p + consumed;
    const tmp = new Uint8Array(totalBytes);
    for (let k = 0; k < p; k++) tmp[k] = this.lastChar[k];
    for (let k = 0; k < consumed; k++) tmp[p + k] = buf[k];
    const r = nativeUtf8Decode(tmp, 0, totalBytes);
    this.lastNeed = consumed;  // write() will use this as 'i' offset into buf
    return r;
  }
  // All expected continuations are present or we ran out of bytes
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return utf8Decode(this.lastChar, 0, this.lastTotal);
  }
  // Not enough bytes yet — buffer what we have and wait for more
  buf.copy(this.lastChar, p, 0, buf.length);
  this.lastNeed -= buf.length;
}

// Decode a UTF-8 buffer slice producing V8-compatible replacement characters.
// Uses the native Rust DFA decoder (ported from V8's utf8-decoder.h) which
// implements the "maximal subpart" rule for U+FFFD emission.
function utf8Decode(buf, start, end) {
  return nativeUtf8Decode(buf, start, end);
}

// Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
// partial character, the character's bytes are buffered until the required
// number of bytes are available.
function utf8Text(buf, i) {
  const total = utf8CheckIncomplete(this, buf, i);
  if (!this.lastNeed) return utf8Decode(buf, i, buf.length);
  this.lastTotal = total;
  const end = buf.length - (total - this.lastNeed);
  buf.copy(this.lastChar, 0, end);
  return utf8Decode(buf, i, end);
}

// For UTF-8, a replacement character is added when ending on a partial
// character.
function utf8End(buf) {
  let r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    r += '\ufffd';
    this.lastNeed = 0;
    this.lastTotal = 0;
  }
  return r;
}

// UTF-16LE typically needs two bytes per character, but even if we have an even
// number of bytes available, we need to check if we end on a leading/high
// surrogate. In that case, we need to wait for the next two bytes in order to
// decode the last character properly.
function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    const r = buf.toString('utf16le', i);
    if (r) {
      const c = r.charCodeAt(r.length - 1);
      if (c >= 0xd800 && c <= 0xdbff) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }
    return r;
  }
  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];
  return buf.toString('utf16le', i, buf.length - 1);
}

// For UTF-16LE we do not explicitly append special replacement characters if we
// end on a partial character, we simply let the decoder handle that.
function utf16End(buf) {
  let r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    const end = this.lastTotal - this.lastNeed;
    r += this.lastChar.toString('utf16le', 0, end);
    this.lastNeed = 0;
    this.lastTotal = 0;
  }
  return r;
}

function base64Text(buf, i) {
  const n = (buf.length - i) % 3;
  if (n === 0) return buf.toString(this.encoding, i);
  this.lastNeed = 3 - n;
  this.lastTotal = 3;
  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }
  return buf.toString(this.encoding, i, buf.length - n);
}

function base64End(buf) {
  let r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    r += this.lastChar.toString(this.encoding, 0, 3 - this.lastNeed);
    this.lastNeed = 0;
    this.lastTotal = 0;
  }
  return r;
}

// Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
function simpleWrite(buf) {
  return buf.toString(this.encoding);
}

function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : '';
}

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
function fillLast(buf) {
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
  this.lastNeed -= buf.length;
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters.
export function StringDecoder(encoding) {
  const enc = normalizeEncoding(encoding);
  if (enc === undefined) {
    throw new ERR_UNKNOWN_ENCODING(encoding);
  }

  this.encoding = enc;
  this[kDecoder] = true;

  let nb;
  switch (enc) {
    case 'utf16le':
      this.text = utf16Text;
      this.end = utf16End;
      this.fillLast = fillLast;
      nb = 4;
      break;
    case 'utf8':
      this.fillLast = utf8FillLast;
      nb = 4;
      break;
    case 'base64':
    case 'base64url':
      this.text = base64Text;
      this.end = base64End;
      this.fillLast = fillLast;
      nb = 3;
      break;
    default:
      this.write = simpleWrite;
      this.end = simpleEnd;
      return;
  }
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = Buffer.alloc(nb);
}

StringDecoder.prototype.write = function write(buf) {
  checkThis(this);
  if (typeof buf === 'string') return buf;
  buf = coerceToBuffer(buf);

  if (buf.length === 0) return '';
  let r;
  let i;
  if (this.lastNeed) {
    r = this.fillLast(buf);
    if (r === undefined) return '';
    i = this.lastNeed;
    this.lastNeed = 0;
  } else {
    i = 0;
  }
  if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
  return r || '';
};

// Returns only complete characters in a Buffer
StringDecoder.prototype.text = utf8Text;

// For UTF-8, a replacement character for each buffered byte of a (partial)
// character.
StringDecoder.prototype.end = utf8End;

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
StringDecoder.prototype.fillLast = utf8FillLast;

export default StringDecoder;
