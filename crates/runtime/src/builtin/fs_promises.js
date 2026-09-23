import * as native from '__wasm_rquickjs_builtin/fs_native';
import {
    aggregateTwoErrors,
    AbortError,
    ERR_FS_FILE_TOO_LARGE,
} from '__wasm_rquickjs_builtin/internal/errors';
import {
    getInternalFsBinding,
    describeType,
    createSystemError,
    validateInteger,
    validateMode,
    parseMkdirOptions as _parseMkdirOptions,
    formatEmptyBufferValue,
    throwEmptyReadBufferError,
    validateUid,
    validateFlush,
    validateAbortSignal,
    validateAppendFileData,
    validateMkdtempPrefix as _validateMkdtempPrefix,
    makeAbortError,
} from '__wasm_rquickjs_builtin/internal/fs/shared';

const MKDIR_MODE_MASK = 0o7777;
const kIoMaxLength = 2 ** 31 - 1;

// Expose fstat on the internal fs binding so tests can monkeypatch it
// (e.g. test-fs-promises-readfile.js replaces fstat to simulate zero-size files).
const _fsBinding = getInternalFsBinding();
if (typeof _fsBinding.fstat !== 'function') {
    _fsBinding.fstat = function fstat(fd) {
        const result = native.fs_fstat(fd);
        if (result.error) throw createSystemError(result.error);
        const s = result.stat;
        return [
            s.dev || 0, s.mode || 0, s.nlink || 0, s.uid || 0,
            s.gid || 0, s.rdev || 0, s.blksize || 0, s.ino || 0,
            s.size || 0,
        ];
    };
}

let _Buffer = null;
function getBuffer() {
    if (!_Buffer) {
        const bufModule = require('node:buffer');
        _Buffer = bufModule.Buffer || bufModule.default?.Buffer;
    }
    return _Buffer;
}

let _Stats = null;
function getStats() {
    if (!_Stats) {
        _Stats = require('node:fs').Stats;
    }
    return _Stats;
}

let _EventEmitter = null;
let _PathModule = null;
function getEventEmitter() {
    if (!_EventEmitter) {
        const events = require('node:events');
        _EventEmitter = events.EventEmitter || events.default;
    }
    return _EventEmitter;
}

function getPathModule() {
    if (!_PathModule) {
        _PathModule = require('node:path');
    }
    return _PathModule;
}

function wrapStat(statObj, options) {
    const S = getStats();
    const s = S ? new S(statObj) : statObj;
    if (options && options.bigint && s._toBigInt) return s._toBigInt();
    return s;
}

// --- Constants (re-export from fs) ---
const F_OK = 0;
const R_OK = 4;
const W_OK = 2;
const X_OK = 1;

// Placeholder; the actual constants object is set by the default export getter below
export let constants = { F_OK, R_OK, W_OK, X_OK };

// --- Helpers ---

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 64;
const O_EXCL = 128;
const O_TRUNC = 512;
const O_APPEND = 1024;
const O_SYNC = 1052672;

function flagsToNumber(flags) {
    if (typeof flags === 'number') {
        validateInteger(flags, 'flags', -2147483648, 2147483647);
        return flags;
    }
    if (typeof flags !== 'string') return O_RDONLY;
    switch (flags) {
        case 'r': return O_RDONLY;
        case 'r+': return O_RDWR;
        case 'rs+': case 'sr+': return O_RDWR | O_SYNC;
        case 'w': return O_WRONLY | O_CREAT | O_TRUNC;
        case 'wx': case 'xw': return O_WRONLY | O_CREAT | O_TRUNC | O_EXCL;
        case 'w+': return O_RDWR | O_CREAT | O_TRUNC;
        case 'wx+': case 'xw+': return O_RDWR | O_CREAT | O_TRUNC | O_EXCL;
        case 'a': return O_WRONLY | O_APPEND | O_CREAT;
        case 'ax': case 'xa': return O_WRONLY | O_APPEND | O_CREAT | O_EXCL;
        case 'a+': return O_RDWR | O_APPEND | O_CREAT;
        case 'ax+': case 'xa+': return O_RDWR | O_APPEND | O_CREAT | O_EXCL;
        case 'as': case 'sa': return O_WRONLY | O_APPEND | O_CREAT | O_SYNC;
        case 'as+': case 'sa+': return O_RDWR | O_APPEND | O_CREAT | O_SYNC;
        default: throw new Error(`Unknown file open flag: ${flags}`);
    }
}

function makeEBADF(syscall) {
    const err = new Error('EBADF: bad file descriptor, ' + syscall);
    err.code = 'EBADF';
    err.errno = -9;
    err.syscall = syscall;
    return err;
}

async function handleFdClose(fileOpPromise, closeFunc) {
    let result;
    let opError;

    try {
        result = await fileOpPromise;
    } catch (error) {
        opError = error;
    }

    try {
        await closeFunc();
    } catch (closeError) {
        if (opError) {
            throw aggregateTwoErrors(closeError, opError);
        }
        throw closeError;
    }

    if (opError) {
        throw opError;
    }

    return result;
}

async function readFileHandle(fileHandle, options) {
    // Node's internal fs/promises wrappers read through the public `fd` getter.
    // This allows tests to instrument FileHandle behavior via prototype overrides.
    fileHandle.fd;
    return fileHandle.readFile(options);
}

async function writeFileHandle(fileHandle, data, options) {
    fileHandle.fd;
    return fileHandle.writeFile(data, options);
}

async function truncateFileHandle(fileHandle, len) {
    const fd = fileHandle.fd;
    const error = native.fs_ftruncate(fd, len);
    if (error) throw createSystemError(error);
}

function parseMkdirOptions(options) {
    return _parseMkdirOptions(options, MKDIR_MODE_MASK);
}

function validatePath(path, propName) {
    if (typeof path === 'string') {
        if (path.indexOf('\u0000') !== -1) {
            const err = new TypeError(`The argument '${propName || 'path'}' must be a string, Uint8Array, or URL without null bytes. Received ${JSON.stringify(path)}`);
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        return;
    }
    if (getBuffer() && path instanceof getBuffer()) return;
    if (path instanceof URL) {
        if (path.protocol !== 'file:') {
            const err = new TypeError('The URL must be of scheme file');
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        const urlStr = path.toString();
        if (urlStr.indexOf('\u0000') !== -1 || urlStr.indexOf('%00') !== -1) {
            const err = new TypeError(`The argument '${propName || 'path'}' must be a string, Uint8Array, or URL without null bytes. Received ${path.toString()}`);
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        return;
    }
    const err = new TypeError(`The "${propName || 'path'}" argument must be of type string or an instance of Buffer or URL. Received ${describeType(path)}`);
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function validateMkdtempPrefix(prefix) {
    return _validateMkdtempPrefix(prefix, getBuffer, validatePath);
}

function pathToString(path) {
    if (typeof path === 'string') return path;
    if (getBuffer() && path instanceof getBuffer()) return path.toString();
    if (path instanceof URL) {
        if (path.protocol !== 'file:') return path.toString();
        return path.pathname;
    }
    return String(path);
}

function pathExists(pathString) {
    const statResult = native.fs_stat(pathString);
    return !statResult.error;
}

function getFirstCreatedPath(pathString, recursive) {
    if (!recursive || pathExists(pathString)) {
        return undefined;
    }

    const pathModule = getPathModule();
    if (!pathModule) {
        return pathString;
    }

    let firstCreatedPath = pathString;
    while (true) {
        const parentPath = pathModule.dirname(firstCreatedPath);
        if (parentPath === firstCreatedPath) {
            break;
        }
        if (pathExists(parentPath)) {
            break;
        }
        firstCreatedPath = parentPath;
    }

    return pathModule.toNamespacedPath(firstCreatedPath);
}

// --- FileHandle class ---

let _protoSetup = false;
function ensureFileHandleProto() {
    if (!_protoSetup) {
        const EE = getEventEmitter();
        if (EE) {
            Object.setPrototypeOf(FileHandle.prototype, EE.prototype);
            _protoSetup = true;
        }
    }
}

export class FileHandle {
    constructor(fd, path) {
        // Ensure prototype chain is set up before constructing
        ensureFileHandleProto();
        // Manually apply EventEmitter constructor
        const EE = getEventEmitter();
        if (EE) EE.call(this);
        this._fd = fd;
        this._path = path;
        this._closed = false;
    }

    get fd() { return this._fd; }

    async appendFile(data, options) {
        if (this._closed) throw makeEBADF('write');
        validateAppendFileData(data);
        if (typeof data === 'string') {
            const pos = null;
            const result = native.fs_write_string(this._fd, data, pos);
            if (result.error) throw createSystemError(result.error);
        } else {
            const dataArray = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
            const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, null);
            if (result.error) throw createSystemError(result.error);
        }
    }

    async chmod(mode) {
        if (this._closed) throw makeEBADF('fchmod');
        const error = native.fs_fchmod(this._fd, mode);
        if (error) throw createSystemError(error);
    }

    async chown(uid, gid) {
        if (this._closed) throw makeEBADF('fchown');
        validateUid(uid, 'uid');
        validateUid(gid, 'gid');
        const error = native.fs_fchown(this._fd, uid, gid);
        if (error) throw createSystemError(error);
    }

    async close() {
        if (this._closed) return;
        this._closed = true;
        const error = native.fs_close(this._fd);
        this._fd = -1;
        if (error) throw createSystemError(error);
        if (this.emit) this.emit('close');
    }

    createReadStream(options) {
        // Lazy import to avoid circular dependency
        const fs = require('node:fs');
        if (options && options.signal !== undefined) {
            if (options.signal === null || typeof options.signal !== 'object' || !('aborted' in options.signal)) {
                const err = new TypeError(`The "options.signal" property must be an instance of AbortSignal. Received ${options.signal === null ? 'null' : typeof options.signal === 'object' ? 'an instance of ' + (options.signal.constructor?.name || 'Object') : typeof options.signal}`);
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
        return fs.createReadStream(this._path, { ...options, fd: this, autoClose: false });
    }

    createWriteStream(options) {
        const fs = require('node:fs');
        return fs.createWriteStream(this._path, { ...options, fd: this, autoClose: false });
    }

    async datasync() {
        if (this._closed) throw makeEBADF('fdatasync');
        const error = native.fs_fdatasync(this._fd);
        if (error) throw createSystemError(error);
    }

    async read(bufferOrOptions, offset, length, position) {
        if (this._closed) throw makeEBADF('read');
        let buffer;
        if (bufferOrOptions === null) {
            // null means use fallback buffer, but respect positional args
            buffer = getBuffer().alloc(16384);
            offset = offset || 0;
            length = length !== undefined && length !== null ? length : buffer.byteLength - offset;
            position = position !== undefined ? position : null;
        } else if (bufferOrOptions === undefined || (typeof bufferOrOptions === 'object' && !ArrayBuffer.isView(bufferOrOptions))) {
            const opts = bufferOrOptions || {};
            buffer = opts.buffer || getBuffer().alloc(16384);
            offset = opts.offset || 0;
            length = opts.length !== undefined && opts.length !== null ? opts.length : buffer.byteLength - offset;
            position = opts.position !== undefined ? opts.position : null;
        } else {
            if (typeof bufferOrOptions !== 'object' && typeof bufferOrOptions !== 'undefined') {
                const err = new TypeError('The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + describeType(bufferOrOptions));
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            buffer = bufferOrOptions;
            if (offset !== undefined && offset !== null && typeof offset === 'object') {
                // fh.read(buffer, options) form
                const opts = offset;
                offset = opts.offset || 0;
                length = opts.length !== undefined && opts.length !== null ? opts.length : buffer.byteLength - offset;
                position = opts.position !== undefined && opts.position !== null ? opts.position : null;
            } else {
                offset = offset || 0;
                length = length !== undefined && length !== null ? length : buffer.byteLength - offset;
                position = position !== undefined ? position : null;
            }
        }

        if (length === 0) {
            return { bytesRead: 0, buffer };
        }

        if (buffer.byteLength === 0) {
            throwEmptyReadBufferError(buffer);
        }

        const result = native.fs_read(this._fd, length, position);
        if (result.error) throw createSystemError(result.error);

        const src = result.buffer;
        const bytesRead = result.bytesRead;
        for (let i = 0; i < bytesRead; i++) {
            buffer[offset + i] = src[i];
        }
        return { bytesRead, buffer };
    }

    async readFile(options) {
        if (this._closed) throw makeEBADF('read');
        const encoding = typeof options === 'string' ? options : (options && options.encoding);
        const signal = typeof options === 'object' && options ? options.signal : undefined;
        validateAbortSignal(signal, 'options.signal');
        if (signal && signal.aborted) {
            throw makeAbortError();
        }
        // Yield before starting to allow abort signals from nextTick to fire
        if (signal) {
            await new Promise(r => setTimeout(r, 0));
            if (signal.aborted) {
                throw makeAbortError();
            }
        }

        const binding = getInternalFsBinding();
        let size;
        if (binding && typeof binding.fstat === 'function') {
            const statData = await binding.fstat(this._fd);
            size = Array.isArray(statData) ? statData[8] : 0;
        } else {
            const statResult = native.fs_fstat(this._fd);
            if (statResult.error) throw createSystemError(statResult.error);
            size = statResult.stat?.size;
        }
        if (typeof size === 'number' && size > kIoMaxLength) {
            throw new ERR_FS_FILE_TOO_LARGE(size);
        }

        // Read all data from file using current fd position (pass null to use OS offset)
        const chunks = [];
        let totalSize = 0;
        while (true) {
            if (signal && signal.aborted) {
                throw makeAbortError();
            }
            const result = native.fs_read(this._fd, 16384, null);
            if (result.error) throw createSystemError(result.error);
            if (result.bytesRead === 0) break;
            const chunk = new Uint8Array(result.buffer.buffer || result.buffer, 0, result.bytesRead);
            chunks.push(chunk);
            totalSize += result.bytesRead;
            // Yield to allow abort signals to fire
            if (signal) {
                await new Promise(r => setTimeout(r, 0));
            } else {
                await Promise.resolve();
            }
        }
        const combined = new Uint8Array(totalSize);
        let cOffset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, cOffset);
            cOffset += chunk.length;
        }

        if (encoding) {
            return getBuffer().from(combined).toString(encoding);
        }
        return getBuffer().from(combined);
    }

    async stat(options) {
        if (!(this instanceof FileHandle)) {
            const err = new Error('handle must be an instance of FileHandle');
            err.code = 'ERR_INTERNAL_ASSERTION';
            throw err;
        }
        if (this._closed) throw makeEBADF('fstat');
        const result = native.fs_fstat(this._fd);
        if (result.error) throw createSystemError(result.error);
        return wrapStat(result.stat, options);
    }

    async sync() {
        if (this._closed) throw makeEBADF('fsync');
        const error = native.fs_fsync(this._fd);
        if (error) throw createSystemError(error);
    }

    async truncate(len) {
        if (this._closed) throw makeEBADF('ftruncate');
        len = len !== undefined ? len : 0;
        const error = native.fs_ftruncate(this._fd, len);
        if (error) throw createSystemError(error);
    }

    async utimes(atime, mtime) {
        if (this._closed) throw makeEBADF('futimes');
        const atimeSecs = (atime instanceof Date) ? atime.getTime() / 1000 : Number(atime);
        const mtimeSecs = (mtime instanceof Date) ? mtime.getTime() / 1000 : Number(mtime);
        const error = native.fs_futimes(this._fd, atimeSecs, mtimeSecs);
        if (error) throw createSystemError(error);
    }

    async write(bufferOrString, offsetOrPosition, lengthOrEncoding, position) {
        if (this._closed) throw makeEBADF('write');
        if (typeof bufferOrString === 'string') {
            const pos = offsetOrPosition !== undefined ? offsetOrPosition : null;
            const enc = lengthOrEncoding || 'utf8';
            if (enc !== 'utf8' && enc !== 'utf-8') {
                // Encode with specified encoding
                if (enc === 'hex' && bufferOrString.length % 2 !== 0) {
                    const err = new Error(`The argument 'encoding' is invalid for data of length ${bufferOrString.length}. Received '${enc}'`);
                    err.code = 'ERR_INVALID_ARG_VALUE';
                    throw err;
                }
                const buf = getBuffer().from(bufferOrString, enc);
                const dataArray = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
                const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, pos);
                if (result.error) throw createSystemError(result.error);
                return { bytesWritten: result.bytesWritten, buffer: bufferOrString };
            }
            const result = native.fs_write_string(this._fd, bufferOrString, pos);
            if (result.error) throw createSystemError(result.error);
            return { bytesWritten: result.bytesWritten, buffer: bufferOrString };
        } else {
            if (!ArrayBuffer.isView(bufferOrString)) {
                const err = new TypeError('The "buffer" argument must be an instance of Buffer or Uint8Array. Received ' + describeType(bufferOrString));
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            let offset, length, pos;
            if (offsetOrPosition !== undefined && offsetOrPosition !== null && typeof offsetOrPosition === 'object') {
                // Options object form: fh.write(buffer, { offset, length, position })
                const opts = offsetOrPosition;
                offset = opts.offset !== undefined && opts.offset !== null ? opts.offset : 0;
                length = opts.length !== undefined && opts.length !== null ? opts.length : bufferOrString.byteLength - offset;
                pos = opts.position !== undefined && opts.position !== null ? opts.position : null;
            } else {
                offset = offsetOrPosition || 0;
                length = lengthOrEncoding !== undefined ? lengthOrEncoding : bufferOrString.byteLength - offset;
                pos = position !== undefined ? position : null;
            }
            // Validate offset
            if (typeof offset !== 'number' || !Number.isInteger(offset)) {
                const err = new TypeError('The "offset" argument must be of type number. Received ' + describeType(offset));
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (offset < 0 || offset > bufferOrString.byteLength) {
                const err = new RangeError(`The value of "offset" is out of range. It must be >= 0 && <= ${bufferOrString.byteLength}. Received ${offset}`);
                err.code = 'ERR_OUT_OF_RANGE';
                throw err;
            }
            // Validate length
            if (typeof length !== 'number' || !Number.isInteger(length)) {
                const err = new TypeError('The "length" argument must be of type number. Received ' + describeType(length));
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (length < 0 || length > bufferOrString.byteLength - offset) {
                const err = new RangeError(`The value of "length" is out of range. It must be >= 0 && <= ${bufferOrString.byteLength - offset}. Received ${length}`);
                err.code = 'ERR_OUT_OF_RANGE';
                throw err;
            }
            const dataArray = new Uint8Array(bufferOrString.buffer || bufferOrString, bufferOrString.byteOffset || 0, bufferOrString.byteLength || bufferOrString.length);
            const result = native.fs_write_buffer(this._fd, dataArray, offset, length, pos);
            if (result.error) throw createSystemError(result.error);
            return { bytesWritten: result.bytesWritten, buffer: bufferOrString };
        }
    }

    async readv(buffers, position) {
        if (this._closed) throw makeEBADF('read');
        let totalRead = 0;
        let pos = position !== undefined && position !== null ? position : null;
        for (const buf of buffers) {
            if (buf.byteLength === 0) continue;
            const result = native.fs_read(this._fd, buf.byteLength, pos);
            if (result.error) throw createSystemError(result.error);
            const bytesRead = result.bytesRead;
            const src = result.buffer;
            for (let i = 0; i < bytesRead; i++) {
                buf[i] = src[i];
            }
            totalRead += bytesRead;
            if (pos !== null) pos += bytesRead;
            if (bytesRead < buf.byteLength) break;
        }
        return { bytesRead: totalRead, buffers };
    }

    async writev(buffers, position) {
        if (this._closed) throw makeEBADF('write');
        let totalWritten = 0;
        let pos = position !== undefined && position !== null ? position : null;
        for (const buf of buffers) {
            if (buf.byteLength === 0) continue;
            const dataArray = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
            const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, pos);
            if (result.error) throw createSystemError(result.error);
            totalWritten += result.bytesWritten;
            if (pos !== null) pos += result.bytesWritten;
        }
        return { bytesWritten: totalWritten, buffers };
    }

    async writeFile(data, options) {
        if (this._closed) throw makeEBADF('write');
        const encoding = typeof options === 'string' ? options : (options && options.encoding) || 'utf8';
        const signal = typeof options === 'object' && options ? options.signal : undefined;
        validateAbortSignal(signal, 'options.signal');
        const flush = typeof options === 'object' && options ? options.flush : undefined;
        if (flush !== undefined && flush !== null) validateFlush(flush);
        if (signal && signal.aborted) {
            throw makeAbortError();
        }

        // Yield to allow pending abort signals (e.g. from process.nextTick) to fire
        if (signal) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (signal.aborted) {
                throw makeAbortError();
            }
        }

        // FileHandle.writeFile writes at the current position (no truncate, no seek to 0)
        if (typeof data === 'string') {
            const buf = getBuffer().from(data, encoding);
            const dataArray = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
            const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, null);
            if (result.error) throw createSystemError(result.error);
        } else if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
            const dataArray = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
            const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, null);
            if (result.error) throw createSystemError(result.error);
        } else if (data != null && typeof data !== 'symbol' && (typeof data[Symbol.asyncIterator] === 'function' || typeof data[Symbol.iterator] === 'function')) {
            for await (const chunk of data) {
                if (signal && signal.aborted) {
                    throw makeAbortError();
                }
                let buf;
                if (typeof chunk === 'string') {
                    buf = getBuffer().from(chunk, encoding);
                } else if (ArrayBuffer.isView(chunk)) {
                    buf = chunk;
                } else {
                    const err = new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ' + describeType(chunk));
                    err.code = 'ERR_INVALID_ARG_TYPE';
                    throw err;
                }
                const dataArray = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
                const result = native.fs_write_buffer(this._fd, dataArray, 0, dataArray.length, null);
                if (result.error) throw createSystemError(result.error);
            }
        } else {
            const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, DataView, or an iterable/async iterable object. Received ' + describeType(data));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (flush) {
            const syncErr = native.fs_fsync(this._fd);
            if (syncErr) throw createSystemError(syncErr);
        }
    }

    [Symbol.asyncDispose]() {
        return this.close();
    }
}

// --- Promise-based fs functions ---

export async function open(path, flags, mode) {
    validatePath(path);
    flags = flagsToNumber(flags !== undefined ? flags : 'r');
    mode = validateMode(mode, 'mode', 0o666);
    mode = mode & ~process.umask();
    const result = native.fs_open(pathToString(path), flags, mode);
    if (result.error) throw createSystemError(result.error);
    return new FileHandle(result.fd, path);
}

export async function readFile(path, options) {
    if (path instanceof FileHandle) {
        return path.readFile(options);
    }

    const signal = typeof options === 'object' && options ? options.signal : undefined;
    validateAbortSignal(signal, 'options.signal');

    const flag = typeof options === 'object' && options && options.flag !== undefined
        ? options.flag
        : 'r';
    const fileHandle = await open(path, flag);
    return handleFdClose(readFileHandle(fileHandle, options), () => fileHandle.close());
}

export async function writeFile(path, data, options) {
    if (path instanceof FileHandle) {
        return path.writeFile(data, options);
    }

    const flush = options && typeof options === 'object' ? options.flush : undefined;
    validateFlush(flush);
    const signal = typeof options === 'object' && options ? options.signal : undefined;
    validateAbortSignal(signal, 'options.signal');
    if (signal && signal.aborted) {
        throw makeAbortError();
    }

    // Validate data type early - reject null, undefined, numbers, booleans, symbols, etc.
    if (data == null || typeof data === 'number' || typeof data === 'boolean' || typeof data === 'bigint' || typeof data === 'symbol' ||
        (typeof data !== 'string' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) &&
        typeof data[Symbol.asyncIterator] !== 'function' && typeof data[Symbol.iterator] !== 'function')) {
        const err = new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, DataView, or an iterable/async iterable object. Received ' + describeType(data));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    const flag = typeof options === 'object' && options && options.flag !== undefined
        ? options.flag
        : 'w';
    const mode = typeof options === 'object' && options && options.mode !== undefined
        ? options.mode
        : undefined;

    const fileHandle = await open(path, flag, mode);
    return handleFdClose(writeFileHandle(fileHandle, data, options), () => fileHandle.close());
}

export async function appendFile(path, data, options) {
    if (path instanceof FileHandle) {
        return path.appendFile(data, options);
    }

    const flush = options && typeof options === 'object' ? options.flush : undefined;
    validateFlush(flush);
    validateAppendFileData(data);

    let error;
    if (typeof data === 'string') {
        error = native.fs_append_file_string(path, data);
    } else {
        const dataArray = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
        error = native.fs_append_file(path, dataArray);
    }
    if (error) throw createSystemError(error);

    if (flush === true) {
        const fs = require('node:fs');
        const fd = fs.openSync(path, 'r');
        try {
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    }
}

export async function unlink(path) {
    const error = native.unlink(path);
    if (error) throw createSystemError(error);
}

export async function rename(oldPath, newPath) {
    const error = native.rename(oldPath, newPath);
    if (error) throw createSystemError(error);
}

export async function mkdir(path, options) {
    const { recursive, mode } = parseMkdirOptions(options);
    const pathString = pathToString(path);
    const firstCreatedPath = getFirstCreatedPath(pathString, recursive);
    const error = native.fs_mkdir(pathString, recursive, mode);
    if (error) throw createSystemError(error);
    if (recursive) return firstCreatedPath;
    return undefined;
}

export async function rmdir(path, options) {
    if (options && options.recursive) {
        const st = native.fs_stat(path);
        if (!st.error && !st.stat.isDirectory) {
            const err = new Error(`ENOTDIR: not a directory, rmdir '${path}'`);
            err.code = 'ENOTDIR';
            err.errno = -20;
            err.syscall = 'rmdir';
            err.path = path;
            throw err;
        }
        const error = native.fs_rm(path, true, false);
        if (error) throw createSystemError(error);
    } else {
        const error = native.fs_rmdir(path);
        if (error) throw createSystemError(error);
    }
}

export async function rm(path, options) {
    const recursive = options && options.recursive || false;
    const force = options && options.force || false;
    const error = native.fs_rm(pathToString(path), recursive, force);
    if (error) throw createSystemError(error);
}

export async function stat(path, options) {
    const result = native.fs_stat(path);
    if (result.error) throw createSystemError(result.error);
    return wrapStat(result.stat, options);
}

export async function lstat(path, options) {
    const result = native.fs_lstat(path);
    if (result.error) throw createSystemError(result.error);
    return wrapStat(result.stat, options);
}

export async function readdir(path, options) {
    const withFileTypes = options && options.withFileTypes || false;
    const recursive = options && options.recursive || false;
    const result = native.fs_readdir(path, withFileTypes);
    if (result.error) throw createSystemError(result.error);
    if (withFileTypes) {
        const sortedEntries = [...result.entries].sort((left, right) => {
            if (left.name < right.name) return -1;
            if (left.name > right.name) return 1;
            return 0;
        });
        const DirentClass = require('node:fs').Dirent;
        const makeDirent = DirentClass
            ? (e, p) => new DirentClass(e.name, e.fileType, p)
            : (e, p) => {
                const kind = e.fileType;
                return {
                    name: e.name,
                    _fileType: kind,
                    parentPath: p,
                    path: p,
                    isFile() { return this._fileType === 'file' || this._fileType === 1; },
                    isDirectory() { return this._fileType === 'directory' || this._fileType === 2; },
                    isSymbolicLink() { return this._fileType === 'symlink' || this._fileType === 3; },
                    isBlockDevice() { return this._fileType === 7; },
                    isCharacterDevice() { return this._fileType === 6; },
                    isFIFO() { return this._fileType === 4; },
                    isSocket() { return this._fileType === 5; },
                };
            };
        const dirents = sortedEntries.map(e => makeDirent(e, path));
        if (recursive) {
            const all = [];
            for (const dirent of dirents) {
                all.push(dirent);
                if (dirent.isDirectory()) {
                    const subPath = path + '/' + dirent.name;
                    try {
                        const subEntries = await readdir(subPath, { withFileTypes: true, recursive: true });
                        all.push(...subEntries);
                    } catch {}
                }
            }
            return all;
        }
        return dirents;
    }
    const entries = [...result.entries].sort((left, right) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    });
    if (recursive) {
        const all = [];
        for (const entry of entries) {
            all.push(entry);
            const subPath = path + '/' + entry;
            try {
                const st = native.fs_stat(subPath);
                if (!st.error && st.stat.isDirectory) {
                    const subEntries = await readdir(subPath, { recursive: true });
                    all.push(...subEntries.map(e => entry + '/' + e));
                }
            } catch {}
        }
        return all;
    }
    return entries;
}

export async function opendir(path, options) {
    return require('node:fs').opendirSync(path, options);
}

export async function access(path, mode) {
    mode = mode !== undefined ? mode : F_OK;
    if (typeof mode !== 'number') {
        const err = new TypeError('The "mode" argument must be of type number. Received ' + describeType(mode));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (mode < 0 || mode > 7) {
        const err = new RangeError(`The value of "mode" is out of range. It must be >= 0 && <= 7. Received ${mode}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    const error = native.fs_access(path, mode);
    if (error) throw createSystemError(error);
}

export async function realpath(path, options) {
    const result = native.fs_realpath(path);
    if (result.error) throw createSystemError(result.error);
    return result.result;
}

export async function truncate(path, len) {
    len = len !== undefined ? len : 0;
    const fileHandle = await open(path, 'r+');
    return handleFdClose(truncateFileHandle(fileHandle, len), () => fileHandle.close());
}

export async function copyFile(src, dest, mode) {
    if (mode !== undefined && typeof mode !== 'number') {
        const err = new TypeError('The "mode" argument must be of type number. Received ' + describeType(mode));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    const error = native.fs_copy_file(src, dest);
    if (error) throw createSystemError(error);
}

export async function link(existingPath, newPath) {
    const error = native.fs_link(existingPath, newPath);
    if (error) throw createSystemError(error);
}

export async function symlink(target, path, type) {
    const error = native.fs_symlink(target, path);
    if (error) throw createSystemError(error);
}

export async function readlink(path, options) {
    const result = native.fs_readlink(path);
    if (result.error) throw createSystemError(result.error);
    return result.result;
}

export async function chmod(path, mode) {
    const error = native.fs_chmod(path, mode);
    if (error) throw createSystemError(error);
}

export async function lchmod(path, mode) {
    return chmod(path, mode);
}

export async function chown(path, uid, gid) {
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    const error = native.fs_chown(path, uid, gid);
    if (error) throw createSystemError(error);
}

export async function lchown(path, uid, gid) {
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    const error = native.fs_lchown(path, uid, gid);
    if (error) throw createSystemError(error);
}

export async function utimes(path, atime, mtime) {
    const atimeSecs = (atime instanceof Date) ? atime.getTime() / 1000 : Number(atime);
    const mtimeSecs = (mtime instanceof Date) ? mtime.getTime() / 1000 : Number(mtime);
    const error = native.fs_utimes(path, atimeSecs, mtimeSecs);
    if (error) throw createSystemError(error);
}

export async function lutimes(path, atime, mtime) {
    return utimes(path, atime, mtime);
}

export async function mkdtemp(prefix, options) {
    validateMkdtempPrefix(prefix);
    const opts = typeof options === 'string' ? { encoding: options } : (options || {});
    const result = native.fs_mkdtemp(pathToString(prefix));
    if (result.error) throw createSystemError(result.error);
    if (opts.encoding === 'buffer') {
        return getBuffer().from(result.result);
    }
    return result.result;
}

export async function cp(src, dest, options) {
    // Simple copy implementation
    const srcResult = native.fs_stat(src);
    if (srcResult.error) throw createSystemError(srcResult.error);

    if (srcResult.stat.isDirectory) {
        const error = native.mkdir(dest, true);
        if (error) throw new Error(error);
        if (options && options.recursive) {
            const dirResult = native.fs_readdir(src, false);
            if (dirResult.error) throw createSystemError(dirResult.error);
            for (const name of dirResult.entries) {
                await cp(src + '/' + name, dest + '/' + name, options);
            }
        }
    } else {
        const error = native.fs_copy_file(src, dest);
        if (error) throw createSystemError(error);
    }
}

export async function* watch(filename, options = {}) {
    validatePath(filename, 'filename');

    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        const err = new TypeError(`The "options" argument must be of type Object. Received ${describeType(options)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    const persistent = options.persistent ?? true;
    if (typeof persistent !== 'boolean') {
        const err = new TypeError(`The "options.persistent" argument must be of type boolean. Received ${describeType(persistent)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    const recursive = options.recursive ?? false;
    if (typeof recursive !== 'boolean') {
        const err = new TypeError(`The "options.recursive" argument must be of type boolean. Received ${describeType(recursive)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    const signal = options.signal;
    validateAbortSignal(signal, 'options.signal');

    const encoding = options.encoding ?? 'utf8';
    if (encoding && !getBuffer().isEncoding(encoding)) {
        const err = new TypeError(`The argument 'encoding' is invalid encoding. Received ${String(encoding)}`);
        err.code = 'ERR_INVALID_ARG_VALUE';
        throw err;
    }

    if (signal?.aborted) {
        throw new AbortError(signal.reason);
    }

    // Use the polling-based FSWatcher from the sync fs module and wrap it
    // as an async iterable.
    const fs = globalThis.require('node:fs');
    const watcher = fs.watch(filename, { recursive, encoding, persistent });

    const queue = [];
    let waiting = null;
    let done = false;
    let closeError = null;

    function finish(err) {
        if (done) return;
        done = true;
        closeError = err || null;
        watcher.close();
        if (waiting) {
            const w = waiting;
            waiting = null;
            if (closeError) w.reject(closeError);
            else w.resolve(null);
        }
    }

    watcher.on('change', (eventType, fn) => {
        const event = { eventType, filename: fn };
        if (waiting) {
            const w = waiting;
            waiting = null;
            w.resolve(event);
        } else {
            queue.push(event);
        }
    });

    watcher.on('error', (err) => finish(err));

    if (signal) {
        signal.addEventListener('abort', () => finish(new AbortError(signal.reason)), { once: true });
    }

    try {
        while (!done) {
            let event;
            if (queue.length > 0) {
                event = queue.shift();
            } else {
                event = await new Promise((resolve, reject) => {
                    if (done) {
                        if (closeError) reject(closeError);
                        else resolve(null);
                        return;
                    }
                    waiting = { resolve, reject };
                });
            }
            if (event === null) break;
            yield event;
        }
    } finally {
        finish();
    }
}

export async function statfs(path, options) {
    const result = native.fs_stat(path);
    if (result.error) throw createSystemError(result.error);
    const bigint = options && options.bigint;
    // Return a statfs-like object with sensible defaults
    if (bigint) {
        return {
            type: BigInt(0),
            bsize: BigInt(4096),
            blocks: BigInt(0),
            bfree: BigInt(0),
            bavail: BigInt(0),
            files: BigInt(0),
            ffree: BigInt(0),
        };
    }
    return {
        type: 0,
        bsize: 4096,
        blocks: 0,
        bfree: 0,
        bavail: 0,
        files: 0,
        ffree: 0,
    };
}

const _defaultExport = {
    FileHandle,
    open,
    readFile,
    writeFile,
    appendFile,
    unlink,
    rename,
    mkdir,
    rmdir,
    rm,
    stat,
    lstat,
    readdir,
    opendir,
    access,
    realpath,
    truncate,
    copyFile,
    link,
    symlink,
    readlink,
    chmod,
    lchmod,
    chown,
    lchown,
    utimes,
    lutimes,
    mkdtemp,
    cp,
    watch,
    statfs,
};

// Use a getter for constants so it lazily resolves to fs.constants (same object reference)
Object.defineProperty(_defaultExport, 'constants', {
    get() {
        try {
            return require('node:fs').constants;
        } catch {}
        return constants;
    },
    enumerable: true,
    configurable: true,
});

export default _defaultExport;
