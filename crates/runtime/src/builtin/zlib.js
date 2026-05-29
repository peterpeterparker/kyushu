// node:zlib implementation
import { Transform } from 'node:stream';
import { Buffer } from 'node:buffer';
import bufferModule from 'node:buffer';
import {
  zlib_compress_sync,
  zlib_decompress_sync,
  brotli_compress_sync as _brotli_compress_sync,
  brotli_decompress_sync as _brotli_decompress_sync,
  crc32_compute,
  zlib_stream_new,
  zlib_stream_push,
  zlib_stream_params,
  zlib_stream_reset,
  zlib_stream_close,
  brotli_stream_new,
  brotli_stream_push,
  brotli_stream_pull,
  brotli_stream_close,
} from '__wasm_rquickjs_builtin/zlib_native';

// Capture buffer.kMaxLength at require('zlib') time, matching Node.js CJS behavior
let _capturedKMaxLength = null;
const _DEFAULT_KMAXLENGTH = 0x7fffffff;

export function _captureKMaxLength() {
  if (_capturedKMaxLength === null) {
    _capturedKMaxLength = bufferModule.kMaxLength;
  }
}

function _getKMaxLength() {
  return _capturedKMaxLength !== null ? _capturedKMaxLength : _DEFAULT_KMAXLENGTH;
}

// ===== Constants =====

const Z_NO_FLUSH = 0;
const Z_PARTIAL_FLUSH = 1;
const Z_SYNC_FLUSH = 2;
const Z_FULL_FLUSH = 3;
const Z_FINISH = 4;
const Z_BLOCK = 5;

const Z_OK = 0;
const Z_STREAM_END = 1;
const Z_NEED_DICT = 2;
const Z_ERRNO = -1;
const Z_STREAM_ERROR = -2;
const Z_DATA_ERROR = -3;
const Z_MEM_ERROR = -4;
const Z_BUF_ERROR = -5;
const Z_VERSION_ERROR = -6;

const Z_NO_COMPRESSION = 0;
const Z_BEST_SPEED = 1;
const Z_BEST_COMPRESSION = 9;
const Z_DEFAULT_COMPRESSION = -1;

const Z_FILTERED = 1;
const Z_HUFFMAN_ONLY = 2;
const Z_RLE = 3;
const Z_FIXED = 4;
const Z_DEFAULT_STRATEGY = 0;

const Z_MIN_CHUNK = 64;
const Z_MAX_CHUNK = Infinity;
const Z_DEFAULT_CHUNK = 16 * 1024;
const Z_MIN_WINDOWBITS = 8;
const Z_MAX_WINDOWBITS = 15;
const Z_DEFAULT_WINDOWBITS = 15;
const Z_MIN_LEVEL = -1;
const Z_MAX_LEVEL = 9;
const Z_DEFAULT_LEVEL = Z_DEFAULT_COMPRESSION;
const Z_MIN_MEMLEVEL = 1;
const Z_MAX_MEMLEVEL = 9;
const Z_DEFAULT_MEMLEVEL = 8;

const DEFLATE = 1;
const INFLATE = 2;
const GZIP = 3;
const GUNZIP = 4;
const DEFLATERAW = 5;
const INFLATERAW = 6;
const UNZIP = 7;
const BROTLI_DECODE = 8;
const BROTLI_ENCODE = 9;

const BROTLI_OPERATION_PROCESS = 0;
const BROTLI_OPERATION_FLUSH = 1;
const BROTLI_OPERATION_FINISH = 2;
const BROTLI_OPERATION_EMIT_METADATA = 3;

const BROTLI_PARAM_MODE = 0;
const BROTLI_MODE_GENERIC = 0;
const BROTLI_MODE_TEXT = 1;
const BROTLI_MODE_FONT = 2;
const BROTLI_DEFAULT_MODE = 0;
const BROTLI_PARAM_QUALITY = 1;
const BROTLI_MIN_QUALITY = 0;
const BROTLI_MAX_QUALITY = 11;
const BROTLI_DEFAULT_QUALITY = 11;
const BROTLI_PARAM_LGWIN = 2;
const BROTLI_MIN_WINDOW_BITS = 10;
const BROTLI_MAX_WINDOW_BITS = 24;
const BROTLI_LARGE_MAX_WINDOW_BITS = 30;
const BROTLI_DEFAULT_WINDOW = 22;
const BROTLI_PARAM_LGBLOCK = 3;
const BROTLI_MIN_INPUT_BLOCK_BITS = 16;
const BROTLI_MAX_INPUT_BLOCK_BITS = 24;
const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING = 4;
const BROTLI_PARAM_SIZE_HINT = 5;
const BROTLI_PARAM_LARGE_WINDOW = 6;
const BROTLI_PARAM_NPOSTFIX = 7;
const BROTLI_PARAM_NDIRECT = 8;

const BROTLI_DECODER_RESULT_ERROR = 0;
const BROTLI_DECODER_RESULT_SUCCESS = 1;
const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT = 2;
const BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT = 3;

const BROTLI_DECODER_NO_ERROR = 0;
const BROTLI_DECODER_SUCCESS = 1;
const BROTLI_DECODER_NEEDS_MORE_INPUT = 2;
const BROTLI_DECODER_NEEDS_MORE_OUTPUT = 3;

const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE = -1;
const BROTLI_DECODER_ERROR_FORMAT_RESERVED = -2;
const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE = -3;
const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET = -4;
const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME = -5;
const BROTLI_DECODER_ERROR_FORMAT_CL_SPACE = -6;
const BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE = -7;
const BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT = -8;
const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1 = -9;
const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2 = -10;
const BROTLI_DECODER_ERROR_FORMAT_TRANSFORM = -11;
const BROTLI_DECODER_ERROR_FORMAT_DICTIONARY = -12;
const BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS = -13;
const BROTLI_DECODER_ERROR_FORMAT_PADDING_1 = -14;
const BROTLI_DECODER_ERROR_FORMAT_PADDING_2 = -15;
const BROTLI_DECODER_ERROR_FORMAT_DISTANCE = -16;
const BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET = -19;
const BROTLI_DECODER_ERROR_INVALID_ARGUMENTS = -20;
const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES = -21;
const BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS = -22;
const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP = -25;
const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1 = -26;
const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2 = -27;
const BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES = -30;
const BROTLI_DECODER_ERROR_UNREACHABLE = -31;

const ZLIB_VERNUM = 4816;

export const constants = Object.freeze({
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY,
  Z_MIN_CHUNK,
  Z_MAX_CHUNK,
  Z_DEFAULT_CHUNK,
  Z_MIN_WINDOWBITS,
  Z_MAX_WINDOWBITS,
  Z_DEFAULT_WINDOWBITS,
  Z_MIN_LEVEL,
  Z_MAX_LEVEL,
  Z_DEFAULT_LEVEL,
  Z_MIN_MEMLEVEL,
  Z_MAX_MEMLEVEL,
  Z_DEFAULT_MEMLEVEL,
  ZLIB_VERNUM,
  DEFLATE,
  INFLATE,
  GZIP,
  GUNZIP,
  DEFLATERAW,
  INFLATERAW,
  UNZIP,
  BROTLI_DECODE,
  BROTLI_ENCODE,
  BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA,
  BROTLI_PARAM_MODE,
  BROTLI_MODE_GENERIC,
  BROTLI_MODE_TEXT,
  BROTLI_MODE_FONT,
  BROTLI_DEFAULT_MODE,
  BROTLI_PARAM_QUALITY,
  BROTLI_MIN_QUALITY,
  BROTLI_MAX_QUALITY,
  BROTLI_DEFAULT_QUALITY,
  BROTLI_PARAM_LGWIN,
  BROTLI_MIN_WINDOW_BITS,
  BROTLI_MAX_WINDOW_BITS,
  BROTLI_LARGE_MAX_WINDOW_BITS,
  BROTLI_DEFAULT_WINDOW,
  BROTLI_PARAM_LGBLOCK,
  BROTLI_MIN_INPUT_BLOCK_BITS,
  BROTLI_MAX_INPUT_BLOCK_BITS,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING,
  BROTLI_PARAM_SIZE_HINT,
  BROTLI_PARAM_LARGE_WINDOW,
  BROTLI_PARAM_NPOSTFIX,
  BROTLI_PARAM_NDIRECT,
  BROTLI_DECODER_RESULT_ERROR,
  BROTLI_DECODER_RESULT_SUCCESS,
  BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT,
  BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_NO_ERROR,
  BROTLI_DECODER_SUCCESS,
  BROTLI_DECODER_NEEDS_MORE_INPUT,
  BROTLI_DECODER_NEEDS_MORE_OUTPUT,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_RESERVED,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME,
  BROTLI_DECODER_ERROR_FORMAT_CL_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE,
  BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2,
  BROTLI_DECODER_ERROR_FORMAT_TRANSFORM,
  BROTLI_DECODER_ERROR_FORMAT_DICTIONARY,
  BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_1,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_2,
  BROTLI_DECODER_ERROR_FORMAT_DISTANCE,
  BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET,
  BROTLI_DECODER_ERROR_INVALID_ARGUMENTS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES,
  BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2,
  BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES,
  BROTLI_DECODER_ERROR_UNREACHABLE,
});

export const codes = Object.freeze({
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
});

// ===== Error helpers =====

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeTypeError(code, message) {
  const err = new TypeError(message);
  err.code = code;
  return err;
}

function makeRangeError(code, message) {
  const err = new RangeError(message);
  err.code = code;
  return err;
}

function invalidArgTypeHelper(input) {
  if (input == null) {
    return ' Received ' + input;
  }
  if (typeof input === 'function') {
    return ' Received function ' + (input.name || '');
  }
  if (typeof input === 'object') {
    if (input.constructor && input.constructor.name) {
      return ' Received an instance of ' + input.constructor.name;
    }
    return ' Received an instance of Object';
  }
  let inspected = String(input);
  if (typeof input === 'string') {
    if (inspected.length > 28) {
      inspected = inspected.slice(0, 25) + '...';
    }
    inspected = "'" + inspected + "'";
  }
  return ' Received type ' + typeof input + ' (' + inspected + ')';
}

function validateNumber(value, name) {
  if (typeof value !== 'number') {
    throw makeTypeError('ERR_INVALID_ARG_TYPE',
      `The "${name}" property must be of type number.` + invalidArgTypeHelper(value));
  }
}

function validateFiniteNumber(value, name) {
  validateNumber(value, name);
  if (!Number.isFinite(value)) {
    throw makeRangeError('ERR_OUT_OF_RANGE',
      `The value of "${name}" is out of range. It must be a finite number. Received ${value}`);
  }
}

function validateRangeInt(value, name, min, max) {
  validateFiniteNumber(value, name);
  if (value < min || value > max) {
    throw makeRangeError('ERR_OUT_OF_RANGE',
      `The value of "${name}" is out of range. It must be >= ${min} and <= ${max}. Received ${value}`);
  }
}

// ===== Buffer normalization =====

function toBuffer(input) {
  if (typeof input === 'string') {
    return Buffer.from(input);
  }
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  throw makeTypeError('ERR_INVALID_ARG_TYPE',
    'The "buffer" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer.' +
    invalidArgTypeHelper(input));
}

function toUint8Array(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (buf instanceof ArrayBuffer) {
    return new Uint8Array(buf);
  }
  return new Uint8Array(Buffer.from(buf));
}

// ===== Validation for zlib options =====

function validateZlibOptions(opts, mode) {
  opts = opts || {};
  const level = (opts.level !== undefined && !Number.isNaN(opts.level)) ? opts.level : Z_DEFAULT_COMPRESSION;
  const windowBits = opts.windowBits !== undefined ? opts.windowBits : Z_DEFAULT_WINDOWBITS;
  const memLevel = opts.memLevel !== undefined ? opts.memLevel : Z_DEFAULT_MEMLEVEL;
  const strategy = (opts.strategy !== undefined && !Number.isNaN(opts.strategy)) ? opts.strategy : Z_DEFAULT_STRATEGY;
  const chunkSize = opts.chunkSize !== undefined ? opts.chunkSize : Z_DEFAULT_CHUNK;
  const flush = opts.flush !== undefined ? opts.flush : Z_NO_FLUSH;
  const finishFlush = opts.finishFlush !== undefined ? opts.finishFlush : Z_FINISH;
  const dictionary = opts.dictionary;
  const info = !!opts.info;
  const maxOutputLength = opts.maxOutputLength;

  if (opts.chunkSize !== undefined) {
    validateNumber(opts.chunkSize, 'options.chunkSize');
    if (!Number.isFinite(opts.chunkSize)) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "options.chunkSize" is out of range. It must be a finite number. Received ${opts.chunkSize}`);
    }
    if (opts.chunkSize < Z_MIN_CHUNK) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "options.chunkSize" is out of range. It must be >= ${Z_MIN_CHUNK}. Received ${opts.chunkSize}`);
    }
  }
  if (opts.windowBits !== undefined) {
    const isDecompression = (mode === INFLATE || mode === GUNZIP || mode === INFLATERAW || mode === UNZIP);
    // windowBits=0 is valid for decompression modes (means "auto-detect from header")
    if (!(isDecompression && opts.windowBits === 0)) {
      const minWB = (mode === GZIP || mode === GUNZIP) ? 9 : Z_MIN_WINDOWBITS;
      validateRangeInt(opts.windowBits, 'options.windowBits', minWB, Z_MAX_WINDOWBITS);
    }
  }
  if (opts.level !== undefined) {
    if (Number.isNaN(opts.level)) {
      // Node.js treats NaN level as Z_DEFAULT_COMPRESSION
    } else {
      validateRangeInt(opts.level, 'options.level', Z_MIN_LEVEL, Z_MAX_LEVEL);
    }
  }
  if (opts.memLevel !== undefined) {
    validateRangeInt(opts.memLevel, 'options.memLevel', Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL);
  }
  if (opts.strategy !== undefined) {
    if (Number.isNaN(opts.strategy)) {
      // Node.js treats NaN strategy as Z_DEFAULT_STRATEGY
    } else {
      validateRangeInt(opts.strategy, 'options.strategy', 0, 4);
    }
  }
  if (opts.flush !== undefined) {
    validateRangeInt(opts.flush, 'options.flush', 0, Z_BLOCK);
  }
  if (opts.finishFlush !== undefined) {
    validateRangeInt(opts.finishFlush, 'options.finishFlush', 0, Z_BLOCK);
  }
  if (dictionary !== undefined && dictionary !== null) {
    if (!Buffer.isBuffer(dictionary) && !ArrayBuffer.isView(dictionary) &&
        !(dictionary instanceof ArrayBuffer)) {
      throw makeTypeError('ERR_INVALID_ARG_TYPE',
        `The "options.dictionary" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer.` +
        invalidArgTypeHelper(dictionary));
    }
  }

  return { level, windowBits, memLevel, strategy, chunkSize, flush, finishFlush, dictionary, info, maxOutputLength };
}

function validateBrotliOptions(opts) {
  opts = opts || {};
  const flush = opts.flush !== undefined ? opts.flush : BROTLI_OPERATION_PROCESS;
  const finishFlush = opts.finishFlush !== undefined ? opts.finishFlush : BROTLI_OPERATION_FINISH;
  const chunkSize = opts.chunkSize !== undefined ? opts.chunkSize : Z_DEFAULT_CHUNK;
  const params = opts.params || {};
  const info = !!opts.info;
  const maxOutputLength = opts.maxOutputLength;

  if (opts.flush !== undefined) {
    validateRangeInt(opts.flush, 'options.flush', 0, BROTLI_OPERATION_EMIT_METADATA);
  }
  if (opts.finishFlush !== undefined) {
    validateRangeInt(opts.finishFlush, 'options.finishFlush', 0, BROTLI_OPERATION_EMIT_METADATA);
  }

  // Validate params keys and values
  const validParamKeys = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const key of Object.keys(params)) {
    const numKey = Number(key);
    if (!validParamKeys.has(numKey) || key !== String(numKey)) {
      throw makeRangeError('ERR_BROTLI_INVALID_PARAM',
        `${key} is not a valid Brotli parameter`);
    }
    const val = params[key];
    if (typeof val !== 'number' && typeof val !== 'boolean') {
      throw makeTypeError('ERR_INVALID_ARG_TYPE',
        `The "${key}" property must be of type number. Received type ${typeof val} (${JSON.stringify(val)})`);
    }
  }

  return { flush, finishFlush, chunkSize, params, info, maxOutputLength };
}

function validateBrotliParams(params) {
  // Validate individual param ranges (matching Node.js / C brotli library validation)
  if (params[BROTLI_PARAM_QUALITY] !== undefined) {
    const v = Number(params[BROTLI_PARAM_QUALITY]);
    if (v < BROTLI_MIN_QUALITY || v > BROTLI_MAX_QUALITY) return false;
  }
  if (params[BROTLI_PARAM_LGWIN] !== undefined) {
    const v = Number(params[BROTLI_PARAM_LGWIN]);
    if (v !== 0 && (v < BROTLI_MIN_WINDOW_BITS || v > BROTLI_LARGE_MAX_WINDOW_BITS)) return false;
  }
  if (params[BROTLI_PARAM_MODE] !== undefined) {
    const v = Number(params[BROTLI_PARAM_MODE]);
    if (v < 0 || v > 2) return false;
  }
  if (params[BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING] !== undefined) {
    const v = Number(params[BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]);
    if (v !== 0 && v !== 1) return false;
  }
  if (params[BROTLI_PARAM_LGBLOCK] !== undefined) {
    const v = Number(params[BROTLI_PARAM_LGBLOCK]);
    if (v !== 0 && (v < BROTLI_MIN_INPUT_BLOCK_BITS || v > BROTLI_MAX_INPUT_BLOCK_BITS)) return false;
  }
  return true;
}

function brotliParamsToJson(params) {
  const obj = {};
  if (params[BROTLI_PARAM_QUALITY] !== undefined) obj.quality = Number(params[BROTLI_PARAM_QUALITY]);
  if (params[BROTLI_PARAM_LGWIN] !== undefined) obj.lgwin = Number(params[BROTLI_PARAM_LGWIN]);
  if (params[BROTLI_PARAM_MODE] !== undefined) obj.mode = Number(params[BROTLI_PARAM_MODE]);
  return JSON.stringify(obj);
}

// ===== Zlib stream base class =====

class ZlibBase extends Transform {
  constructor(opts, mode) {
    super(opts);
    this._mode = mode;
    this._opts = opts || {};
    this._handle = null;
    this._isBrotli = false;
    this._closed = false;
    this._bytesWritten = 0;
    this._finishFlush = Z_FINISH;
    this._flushFlag = Z_NO_FLUSH;
    this._pendingFlushes = [];
  }

  get bytesWritten() {
    return this._bytesWritten;
  }

  get bytesRead() {
    return this._bytesWritten;
  }

  close(callback) {
    if (this._closed) {
      if (callback) setTimeout(callback, 0);
      return;
    }
    this._closed = true;
    this._closeHandle();
    if (callback) {
      this.once('close', callback);
    }
    this.destroy();
  }

  _closeHandle() {
    if (this._handle !== null) {
      if (this._isBrotli) {
        brotli_stream_close(this._handle);
      } else {
        zlib_stream_close(this._handle);
      }
      this._handle = null;
    }
  }

  reset() {
    if (this._handle !== null && !this._isBrotli) {
      zlib_stream_reset(this._handle);
      this._bytesWritten = 0;
    }
  }

  flush(kind, callback) {
    if (typeof kind === 'function') {
      callback = kind;
      kind = undefined;
    }
    if (kind === undefined) {
      kind = this._isBrotli ? BROTLI_OPERATION_FLUSH : Z_FULL_FLUSH;
    }
    if (this._closed) {
      if (callback) setTimeout(callback, 0);
      return;
    }

    this._pendingFlushes.push(kind);
    this.write(Buffer.alloc(0), '', () => {
      // Force read to emit anything buffered in readable state
      this.read(0);
      if (callback) callback();
    });
  }

  params(level, strategy, callback) {
    // Validate level
    if (typeof level !== 'number') {
      throw makeTypeError('ERR_INVALID_ARG_TYPE',
        `The "level" argument must be of type number.` + invalidArgTypeHelper(level));
    }
    if (!Number.isFinite(level)) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "level" is out of range. It must be a finite number. Received ${level}`);
    }
    if (level < Z_MIN_LEVEL || level > Z_MAX_LEVEL) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "level" is out of range. It must be >= ${Z_MIN_LEVEL} and <= ${Z_MAX_LEVEL}. Received ${level}`);
    }
    // Validate strategy
    if (typeof strategy !== 'number') {
      throw makeTypeError('ERR_INVALID_ARG_TYPE',
        `The "strategy" argument must be of type number.` + invalidArgTypeHelper(strategy));
    }
    if (!Number.isFinite(strategy)) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "strategy" is out of range. It must be a finite number. Received ${strategy}`);
    }
    if (strategy < 0 || strategy > 4) {
      throw makeRangeError('ERR_OUT_OF_RANGE',
        `The value of "strategy" is out of range. It must be >= 0 and <= 4. Received ${strategy}`);
    }
    if (this._level !== level || this._strategy !== strategy) {
      this.flush(Z_SYNC_FLUSH, () => {
        if (this._handle !== null) {
          zlib_stream_params(this._handle, level, strategy);
        }
        this._level = level;
        this._strategy = strategy;
        if (callback) callback();
      });
    } else {
      queueMicrotask(() => { if (callback) callback(); });
    }
  }

  _processChunk(chunk, flushFlag) {
    if (this._handle === null) this._initHandle();
    const buf = toBuffer(chunk);
    const data = toUint8Array(buf);
    this._bytesWritten += data.length;
    if (this._isBrotli) {
      if (data.length > 0) {
        brotli_stream_push(this._handle, data, 0);
      }
      if (flushFlag === BROTLI_OPERATION_FINISH || flushFlag === Z_FINISH) {
        const result = brotli_stream_push(this._handle, new Uint8Array(0), 2);
        return result ? Buffer.from(result) : Buffer.alloc(0);
      }
      return Buffer.alloc(0);
    } else {
      const result = zlib_stream_push(this._handle, data, flushFlag);
      return result ? Buffer.from(result) : Buffer.alloc(0);
    }
  }

  _initHandle() {
    // Subclasses override this
  }

  _transform(chunk, encoding, callback) {
   if (this._handle === null) this._initHandle();

   // Validate input type - throw synchronously so write() throws (matches Node.js behavior)
   if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !ArrayBuffer.isView(chunk) && !(chunk instanceof ArrayBuffer)) {
     throw makeTypeError('ERR_INVALID_ARG_TYPE',
       'The "chunk" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer.' +
       invalidArgTypeHelper(chunk));
   }

   const buf = toBuffer(chunk);
   const data = toUint8Array(buf);
   this._bytesWritten += data.length;

   try {
     let result;
     let flush;
     if (data.length === 0 && this._pendingFlushes.length > 0) {
       flush = this._pendingFlushes.shift();
     } else {
       flush = this._flushFlag;
       if (this._flushFlag !== Z_NO_FLUSH) {
         this._flushFlag = Z_NO_FLUSH;
       }
     }
     if (this._isBrotli) {
       result = brotli_stream_push(this._handle, data, flush);
     } else {
       result = zlib_stream_push(this._handle, data, flush || Z_NO_FLUSH);
     }
     if (result == null) {
       this._closeHandle();
       callback(makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'zlib error'));
       return;
     }
     if (result.length > 0) {
       this.push(Buffer.from(result));
     }
     queueMicrotask(callback);
   } catch (err) {
     callback(err);
   }
  }

  _flush(callback) {
    if (this._handle === null) {
      callback();
      return;
    }

    try {
      let result;
      if (this._isBrotli) {
        result = brotli_stream_push(this._handle, new Uint8Array(0), 2);
      } else {
        result = zlib_stream_push(this._handle, new Uint8Array(0), this._finishFlush);
      }
      if (result == null) {
        this._closeHandle();
        callback(makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'zlib error'));
        return;
      }
      if (result.length > 0) {
        this.push(Buffer.from(result));
      }
      this._closeHandle();
      callback();
    } catch (err) {
      this._closeHandle();
      callback(err);
    }
  }

  _destroy(err, callback) {
    this._closeHandle();
    callback(err);
  }
}

function assertHandle(handle) {
  if (handle === null || handle === undefined) {
    throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Initialization failed');
  }
}

// ===== Zlib classes =====
// Node.js zlib classes can be called with or without `new`.
// ES6 classes can't be called without `new`, so we use a wrapper pattern:
// the actual class does the work, and we export a function wrapper that
// handles both `new Wrapper()` and `Wrapper()` calls.

class _Deflate extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts);
    super(opts, DEFLATE);
    this._level = validated.level;
    this._windowBits = validated.windowBits;
    this._memLevel = validated.memLevel;
    this._strategy = validated.strategy;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
    this._dictionary = validated.dictionary;
  }
  _initHandle() {
    this._handle = zlib_stream_new(0, this._level, this._windowBits, this._memLevel, this._strategy);
    assertHandle(this._handle);
  }
}

class _Inflate extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts, INFLATE);
    super(opts, INFLATE);
    this._windowBits = validated.windowBits;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
    this._dictionary = validated.dictionary;
  }
  _initHandle() {
    this._handle = zlib_stream_new(1, 0, this._windowBits, 0, 0);
    assertHandle(this._handle);
  }
}

class _Gzip extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts, GZIP);
    super(opts, GZIP);
    this._level = validated.level;
    this._windowBits = validated.windowBits;
    this._memLevel = validated.memLevel;
    this._strategy = validated.strategy;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
  }
  _initHandle() {
    this._handle = zlib_stream_new(2, this._level, this._windowBits, this._memLevel, this._strategy);
    assertHandle(this._handle);
  }
}

class _Gunzip extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts, GUNZIP);
    super(opts, GUNZIP);
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
  }
  _initHandle() {
    this._handle = zlib_stream_new(3, 0, 15, 0, 0);
    assertHandle(this._handle);
  }
}

class _DeflateRaw extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts);
    super(opts, DEFLATERAW);
    this._level = validated.level;
    this._windowBits = validated.windowBits;
    this._memLevel = validated.memLevel;
    this._strategy = validated.strategy;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
    this._dictionary = validated.dictionary;
  }
  _initHandle() {
    this._handle = zlib_stream_new(4, this._level, this._windowBits, this._memLevel, this._strategy);
    assertHandle(this._handle);
  }
}

class _InflateRaw extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts, INFLATERAW);
    super(opts, INFLATERAW);
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
    this._dictionary = validated.dictionary;
  }
  _initHandle() {
    this._handle = zlib_stream_new(5, 0, 15, 0, 0);
    assertHandle(this._handle);
  }
}

class _Unzip extends ZlibBase {
  constructor(opts) {
    const validated = validateZlibOptions(opts, UNZIP);
    super(opts, UNZIP);
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : Z_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : Z_NO_FLUSH;
  }
  _initHandle() {
    this._handle = zlib_stream_new(6, 0, 15, 0, 0);
    assertHandle(this._handle);
  }
}

class _BrotliCompress extends ZlibBase {
  constructor(opts) {
    const validated = validateBrotliOptions(opts);
    super(opts, BROTLI_ENCODE);
    this._isBrotli = true;
    this._brotliParams = validated.params;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : BROTLI_OPERATION_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : BROTLI_OPERATION_PROCESS;
    // Eagerly validate params
    if (!validateBrotliParams(this._brotliParams)) {
      throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Initialization failed');
    }
  }
  _initHandle() {
    if (this._handle !== null) return;
    const paramsJson = brotliParamsToJson(this._brotliParams);
    this._handle = brotli_stream_new(0, paramsJson);
    assertHandle(this._handle);
  }
}

class _BrotliDecompress extends ZlibBase {
  constructor(opts) {
    const validated = validateBrotliOptions(opts);
    super(opts, BROTLI_DECODE);
    this._isBrotli = true;
    this._finishFlush = validated.finishFlush !== undefined ? validated.finishFlush : BROTLI_OPERATION_FINISH;
    this._flushFlag = validated.flush !== undefined ? validated.flush : BROTLI_OPERATION_PROCESS;
    this._brotliFlushCb = null;
  }
  _initHandle() {
    this._handle = brotli_stream_new(1, '{}');
    assertHandle(this._handle);
  }
  _flush(callback) {
    if (this._handle === null) {
      callback();
      return;
    }
    try {
      const result = brotli_stream_push(this._handle, new Uint8Array(0), 2);
      if (result == null) {
        this._closeHandle();
        callback(makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'zlib error'));
        return;
      }
      if (result.length > 0) {
        const ok = this.push(Buffer.from(result));
        if (!ok) {
          this._brotliFlushCb = callback;
          return;
        }
      }
      this._drainBrotliStream(callback);
    } catch (err) {
      this._closeHandle();
      callback(err);
    }
  }
  _drainBrotliStream(callback) {
    try {
      while (this._handle !== null) {
        const chunk = brotli_stream_pull(this._handle, Z_DEFAULT_CHUNK);
        if (!chunk || chunk.length === 0) {
          this._closeHandle();
          callback();
          return;
        }
        const ok = this.push(Buffer.from(chunk));
        if (!ok) {
          this._brotliFlushCb = callback;
          return;
        }
      }
      callback();
    } catch (err) {
      this._closeHandle();
      callback(err);
    }
  }
  _read(n) {
    if (this._brotliFlushCb) {
      const cb = this._brotliFlushCb;
      this._brotliFlushCb = null;
      this._drainBrotliStream(cb);
    } else {
      super._read(n);
    }
  }
}

// Wrapper function factory: creates a function that can be called with or
// without `new`, and `instanceof` still works against the wrapper.
// Also supports `Wrapper.call(this, opts)` for prototype inheritance patterns.
function makeZlibWrapper(InternalClass) {
  function Wrapper(opts) {
    if (new.target) {
      // Called with `new Wrapper(opts)` — normal construction
      return new InternalClass(opts);
    }
    // Called without `new` — check for .call(this, opts) inheritance pattern
    if (this != null && this instanceof InternalClass) {
      // Inheritance pattern: Constructor.call(this, opts)
      // Create a proper instance and copy all own properties to this
      const instance = new InternalClass(opts);
      for (const key of Reflect.ownKeys(instance)) {
        Object.defineProperty(this, key,
          Object.getOwnPropertyDescriptor(instance, key));
      }
      return this;
    }
    // Factory-style call without new: DeflateRaw(opts)
    return new InternalClass(opts);
  }
  // Make instanceof work: `new Wrapper() instanceof Wrapper` => true
  Wrapper.prototype = InternalClass.prototype;
  Wrapper.prototype.constructor = Wrapper;
  // Copy static properties
  Object.setPrototypeOf(Wrapper, InternalClass);
  return Wrapper;
}

export const Deflate = makeZlibWrapper(_Deflate);
export const Inflate = makeZlibWrapper(_Inflate);
export const Gzip = makeZlibWrapper(_Gzip);
export const Gunzip = makeZlibWrapper(_Gunzip);
export const DeflateRaw = makeZlibWrapper(_DeflateRaw);
export const InflateRaw = makeZlibWrapper(_InflateRaw);
export const Unzip = makeZlibWrapper(_Unzip);
export const BrotliCompress = makeZlibWrapper(_BrotliCompress);
export const BrotliDecompress = makeZlibWrapper(_BrotliDecompress);

// ===== Factory functions =====

export function createGzip(opts) { return new _Gzip(opts); }
export function createGunzip(opts) { return new _Gunzip(opts); }
export function createDeflate(opts) { return new _Deflate(opts); }
export function createInflate(opts) { return new _Inflate(opts); }
export function createDeflateRaw(opts) { return new _DeflateRaw(opts); }
export function createInflateRaw(opts) { return new _InflateRaw(opts); }
export function createUnzip(opts) { return new _Unzip(opts); }
export function createBrotliCompress(opts) { return new _BrotliCompress(opts); }
export function createBrotliDecompress(opts) { return new _BrotliDecompress(opts); }

// ===== Sync convenience functions =====

function doSyncCompress(data, opts, windowBitsOverride, mode) {
  const validated = validateZlibOptions(opts, mode);
  const buf = toBuffer(data);
  const uint8 = toUint8Array(buf);
  const wb = windowBitsOverride !== undefined ? windowBitsOverride : validated.windowBits;
  const result = zlib_compress_sync(uint8, validated.level, wb);
  if (result == null) {
    throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Compression failed');
  }
  const output = Buffer.from(result);
  if (validated.info) {
    const EngineClass = windowBitsOverride >= 24 ? _Gzip :
                        windowBitsOverride < 0 ? _DeflateRaw : _Deflate;
    return { buffer: output, engine: new EngineClass(opts) };
  }
  return output;
}

function doSyncDecompress(data, opts, windowBitsOverride, mode) {
  const validated = validateZlibOptions(opts, mode);
  const maxLen = validated.maxOutputLength !== undefined ? validated.maxOutputLength : _getKMaxLength();
  const buf = toBuffer(data);
  const uint8 = toUint8Array(buf);
  const wb = windowBitsOverride !== undefined ? windowBitsOverride : validated.windowBits;
  const result = zlib_decompress_sync(uint8, wb);
  if (result == null) {
    throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Decompression failed');
  }
  const output = Buffer.from(result);
  if (output.length > maxLen) {
    throw makeRangeError('ERR_BUFFER_TOO_LARGE',
      `Cannot create a Buffer larger than ${maxLen} bytes`);
  }
  if (validated.info) {
    const EngineClass = windowBitsOverride >= 24 ? _Gunzip :
                        windowBitsOverride < 0 ? _InflateRaw :
                        windowBitsOverride === 0 ? _Unzip : _Inflate;
    return { buffer: output, engine: new EngineClass(opts) };
  }
  return output;
}

export function gzipSync(data, opts) {
  return doSyncCompress(data, opts, 31, GZIP);
}

export function gunzipSync(data, opts) {
  return doSyncDecompress(data, opts, 31, GUNZIP);
}

export function deflateSync(data, opts) {
  return doSyncCompress(data, opts, 15);
}

export function inflateSync(data, opts) {
  return doSyncDecompress(data, opts, 15);
}

export function deflateRawSync(data, opts) {
  return doSyncCompress(data, opts, -15);
}

export function inflateRawSync(data, opts) {
  return doSyncDecompress(data, opts, -15);
}

export function unzipSync(data, opts) {
  return doSyncDecompress(data, opts, 0);
}

export function brotliCompressSync(data, opts) {
  const validated = validateBrotliOptions(opts);
  const buf = toBuffer(data);
  const uint8 = toUint8Array(buf);
  const paramsJson = brotliParamsToJson(validated.params);

  const result = _brotli_compress_sync(uint8, paramsJson);
  if (result == null) {
    throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Initialization failed');
  }
  const output = Buffer.from(result);
  if (validated.info) {
    return { buffer: output, engine: new _BrotliCompress(opts) };
  }
  return output;
}

export function brotliDecompressSync(data, opts) {
  const validated = validateBrotliOptions(opts);
  const maxLen = validated.maxOutputLength !== undefined ? validated.maxOutputLength : _getKMaxLength();
  const buf = toBuffer(data);
  const uint8 = toUint8Array(buf);
  const result = _brotli_decompress_sync(uint8);
  if (result == null) {
    throw makeError('ERR_ZLIB_INITIALIZATION_FAILED', 'Brotli decompression failed');
  }
  const output = Buffer.from(result);
  if (output.length > maxLen) {
    throw makeRangeError('ERR_BUFFER_TOO_LARGE',
      `Cannot create a Buffer larger than ${maxLen} bytes`);
  }
  if (validated.info) {
    return { buffer: output, engine: new _BrotliDecompress(opts) };
  }
  return output;
}

// ===== Async convenience functions =====

function asyncConvenience(syncFn, data, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof callback !== 'function') {
    throw makeTypeError('ERR_INVALID_ARG_TYPE',
      'The "callback" argument must be of type function. Received ' + (callback === undefined ? 'undefined' : typeof callback));
  }
  try {
    const result = syncFn(data, opts);
    setTimeout(() => callback(null, result), 0);
  } catch (err) {
    setTimeout(() => callback(err), 0);
  }
}

export function gzip(data, opts, callback) { asyncConvenience(gzipSync, data, opts, callback); }
export function gunzip(data, opts, callback) { asyncConvenience(gunzipSync, data, opts, callback); }
export function deflate(data, opts, callback) { asyncConvenience(deflateSync, data, opts, callback); }
export function inflate(data, opts, callback) { asyncConvenience(inflateSync, data, opts, callback); }
export function deflateRaw(data, opts, callback) { asyncConvenience(deflateRawSync, data, opts, callback); }
export function inflateRaw(data, opts, callback) { asyncConvenience(inflateRawSync, data, opts, callback); }
export function unzip(data, opts, callback) { asyncConvenience(unzipSync, data, opts, callback); }
export function brotliCompress(data, opts, callback) { asyncConvenience(brotliCompressSync, data, opts, callback); }
export function brotliDecompress(data, opts, callback) { asyncConvenience(brotliDecompressSync, data, opts, callback); }

// ===== CRC32 =====

export function crc32(data, value) {
  if (typeof data !== 'string' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
    throw makeTypeError('ERR_INVALID_ARG_TYPE',
      'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ' +
      (data === null ? 'null' : data === undefined ? 'undefined' : typeof data === 'function' ? 'function ' + (data.name || '') : typeof data === 'object' ? 'an instance of ' + (data.constructor ? data.constructor.name : 'Object') : 'type ' + typeof data + ' (' + data + ')'));
  }
  if (value !== undefined) {
    if (typeof value !== 'number') {
      throw makeTypeError('ERR_INVALID_ARG_TYPE',
        'The "value" argument must be of type number. Received ' +
        (value === null ? 'null' : typeof value === 'function' ? 'function ' + (value.name || '') : typeof value === 'object' ? 'an instance of ' + (value.constructor ? value.constructor.name : 'Object') : 'type ' + typeof value + ' (' + value + ')'));
    }
  }

  const buf = toBuffer(data);
  const uint8 = toUint8Array(buf);
  const initial = (value !== undefined) ? (value >>> 0) : 0;
  // Native returns i32; convert to unsigned u32
  return crc32_compute(uint8, initial) >>> 0;
}

// ===== Default export =====

const _default = {
  crc32,

  // Classes (wrapper functions)
  Deflate,
  Inflate,
  Gzip,
  Gunzip,
  DeflateRaw,
  InflateRaw,
  Unzip,
  BrotliCompress,
  BrotliDecompress,

  // Factory functions
  createGzip,
  createGunzip,
  createDeflate,
  createInflate,
  createDeflateRaw,
  createInflateRaw,
  createUnzip,
  createBrotliCompress,
  createBrotliDecompress,

  // Sync
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  deflateRawSync,
  inflateRawSync,
  unzipSync,
  brotliCompressSync,
  brotliDecompressSync,

  // Async
  gzip,
  gunzip,
  deflate,
  inflate,
  deflateRaw,
  inflateRaw,
  unzip,
  brotliCompress,
  brotliDecompress,

  // Constants (directly accessible like Node.js)
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY,
  Z_DEFAULT_WINDOWBITS,
  Z_MIN_CHUNK,
  Z_MAX_CHUNK,
  Z_DEFAULT_CHUNK,
  Z_MIN_WINDOWBITS,
  Z_MAX_WINDOWBITS,
  Z_MIN_LEVEL,
  Z_MAX_LEVEL,
  Z_DEFAULT_LEVEL,
  Z_MIN_MEMLEVEL,
  Z_MAX_MEMLEVEL,
  Z_DEFAULT_MEMLEVEL,
  DEFLATE,
  INFLATE,
  GZIP,
  GUNZIP,
  DEFLATERAW,
  INFLATERAW,
  UNZIP,
  BROTLI_DECODE,
  BROTLI_ENCODE,
  BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA,
  ZLIB_VERNUM,
};

Object.defineProperty(_default, 'constants', {
  value: constants,
  writable: false,
  configurable: false,
  enumerable: true,
});

Object.defineProperty(_default, 'codes', {
  value: codes,
  writable: false,
  configurable: false,
  enumerable: true,
});

export default _default;
