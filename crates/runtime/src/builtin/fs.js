import * as native from '__wasm_rquickjs_builtin/fs_native';
import {
    ERR_DIR_CLOSED,
    ERR_DIR_CONCURRENT_OPERATION,
    ERR_FS_FILE_TOO_LARGE,
    ERR_INVALID_ARG_TYPE,
    ERR_OUT_OF_RANGE,
} from '__wasm_rquickjs_builtin/internal/errors';
import {
    getInternalFsBinding,
    describeType,
    getSystemErrorDescription,
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

const kIoMaxLength = 2 ** 31 - 1;

let _Buffer = null;
function getBuffer() {
    if (!_Buffer) {
        const bufModule = require('node:buffer');
        _Buffer = bufModule.Buffer || bufModule.default?.Buffer;
    }
    return _Buffer;
}

let _promises = null;
function getPromises() {
    if (!_promises) {
        _promises = require('node:fs/promises');
    }
    return _promises;
}

let _Readable = null;
let _Writable = null;
let _EventEmitter = null;
let _PathModule = null;
function getStreamClasses() {
    if (!_Readable) {
        const stream = require('node:stream');
        _Readable = stream.Readable;
        _Writable = stream.Writable;
    }
}
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

// --- Constants ---
const F_OK = 0;
const R_OK = 4;
const W_OK = 2;
const X_OK = 1;

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 64;
const O_EXCL = 128;
const O_NOCTTY = 256;
const O_TRUNC = 512;
const O_APPEND = 1024;
const O_DIRECTORY = 65536;
const O_NOATIME = 262144;
const O_NOFOLLOW = 131072;
const O_SYNC = 1052672;
const O_DSYNC = 4096;
const O_NONBLOCK = 2048;

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFIFO = 0o010000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;

const S_IRWXU = 0o700;
const S_IRUSR = 0o400;
const S_IWUSR = 0o200;
const S_IXUSR = 0o100;
const S_IRWXG = 0o070;
const S_IRGRP = 0o040;
const S_IWGRP = 0o020;
const S_IXGRP = 0o010;
const S_IRWXO = 0o007;
const S_IROTH = 0o004;
const S_IWOTH = 0o002;
const S_IXOTH = 0o001;

const COPYFILE_EXCL = 1;
const COPYFILE_FICLONE = 2;
const COPYFILE_FICLONE_FORCE = 4;
const UV_DIRENT_UNKNOWN = 0;
const UV_DIRENT_FILE = 1;
const UV_DIRENT_DIR = 2;
const UV_DIRENT_LINK = 3;
const UV_DIRENT_FIFO = 4;
const UV_DIRENT_SOCKET = 5;
const UV_DIRENT_CHAR = 6;
const UV_DIRENT_BLOCK = 7;
const MAX_COPYFILE_MODE = COPYFILE_EXCL | COPYFILE_FICLONE | COPYFILE_FICLONE_FORCE;
const MKDIR_MODE_MASK = 0o7777;
const HAS_LCHMOD = false;
const FILE_HANDLE_IN_USE_SYMBOL = Symbol.for('__wasm_rquickjs.filehandleInUse');
const FILE_HANDLE_IN_USE_COUNT_SYMBOL = Symbol.for('__wasm_rquickjs.filehandleInUseCount');

export const constants = {
    F_OK, R_OK, W_OK, X_OK,
    O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_NOCTTY,
    O_TRUNC, O_APPEND, O_DIRECTORY, O_NOATIME, O_NOFOLLOW,
    O_SYNC, O_DSYNC, O_NONBLOCK,
    S_IFMT, S_IFREG, S_IFDIR, S_IFCHR, S_IFBLK, S_IFIFO, S_IFLNK, S_IFSOCK,
    S_IRWXU, S_IRUSR, S_IWUSR, S_IXUSR,
    S_IRWXG, S_IRGRP, S_IWGRP, S_IXGRP,
    S_IRWXO, S_IROTH, S_IWOTH, S_IXOTH,
    COPYFILE_EXCL, COPYFILE_FICLONE, COPYFILE_FICLONE_FORCE,
    UV_FS_COPYFILE_EXCL: COPYFILE_EXCL,
    UV_FS_COPYFILE_FICLONE: COPYFILE_FICLONE,
    UV_FS_COPYFILE_FICLONE_FORCE: COPYFILE_FICLONE_FORCE,
    UV_FS_SYMLINK_DIR: 1,
    UV_FS_SYMLINK_JUNCTION: 2,
    UV_DIRENT_UNKNOWN,
    UV_DIRENT_FILE,
    UV_DIRENT_DIR,
    UV_DIRENT_LINK,
    UV_DIRENT_FIFO,
    UV_DIRENT_SOCKET,
    UV_DIRENT_CHAR,
    UV_DIRENT_BLOCK,
};

// --- Helpers ---

function flagsToNumber(flags) {
    if (typeof flags === 'number') {
        validateInteger(flags, 'flags', -2147483648, 2147483647);
        return flags;
    }
    if (typeof flags !== 'string') return O_RDONLY;
    switch (flags) {
        case 'r': return O_RDONLY;
        case 'rs': case 'sr': return O_RDONLY | O_SYNC;
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

function getOptions(options, defaultOptions) {
    if (options === null || options === undefined) return defaultOptions;
    if (typeof options === 'string') return { ...defaultOptions, encoding: options };
    if (typeof options === 'object') return { ...defaultOptions, ...options };
    return defaultOptions;
}

function retainFileHandleForTransfer(fileHandle) {
    if (!fileHandle || typeof fileHandle !== 'object') {
        return;
    }

    const current = Number.isInteger(fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL])
        ? fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL]
        : 0;

    fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL] = current + 1;
    fileHandle[FILE_HANDLE_IN_USE_SYMBOL] = true;
}

function releaseFileHandleForTransfer(fileHandle) {
    if (!fileHandle || typeof fileHandle !== 'object') {
        return;
    }

    const current = Number.isInteger(fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL])
        ? fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL]
        : 0;

    if (current <= 1) {
        fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL] = 0;
        fileHandle[FILE_HANDLE_IN_USE_SYMBOL] = false;
    } else {
        fileHandle[FILE_HANDLE_IN_USE_COUNT_SYMBOL] = current - 1;
    }
}

function validateOffsetLengthRead(offset, length, bufferLength) {
    if (offset < 0) {
        const err = new RangeError(`The value of "offset" is out of range. It must be >= 0. Received ${offset}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (length < 0) {
        const err = new RangeError(`The value of "length" is out of range. It must be >= 0. Received ${length}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (offset + length > bufferLength) {
        const err = new RangeError(`The value of "length" is out of range. It must be <= ${bufferLength - offset}. Received ${length}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
}

function validateInt32(value, name, min) {
    if (typeof value !== 'number') {
        const err = new TypeError(`The "${name}" argument must be of type number. Received ${describeType(value)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (!Number.isInteger(value)) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be an integer. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (min !== undefined && value < min) {
        const err = new RangeError(`The value of "${name}" is out of range. It must be >= ${min}. Received ${value}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
}

function validateOffsetLengthWrite(offset, length, byteLength) {
    if (offset > byteLength) {
        const err = new RangeError(`The value of "offset" is out of range. It must be <= ${byteLength}. Received ${offset}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
    if (length > byteLength - offset) {
        const err = new RangeError(`The value of "length" is out of range. It must be <= ${byteLength - offset}. Received ${length}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }
}

function validateReadPosition(position, length) {
    if (position === null || position === undefined || position === -1 || position === -1n) {
        return null;
    }

    if (typeof position === 'number') {
        validateInteger(position, 'position', -1, Number.MAX_SAFE_INTEGER);
        return position;
    }

    if (typeof position === 'bigint') {
        const maxPosition = (2n ** 63n) - 1n - BigInt(length);
        if (position < -1n || position > maxPosition) {
            const err = new RangeError(`The value of "position" is out of range. It must be >= -1 && <= ${maxPosition}. Received ${position}n`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        // Keep full precision for large values by forwarding BigInt to the native layer.
        if (position > BigInt(Number.MAX_SAFE_INTEGER)) {
            return position;
        }
        return Number(position);
    }

    const err = new TypeError(`The "position" argument must be of type bigint or integer. Received ${describeType(position)}`);
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function validateFd(fd) {
    if (typeof fd !== 'number') {
        const err = new TypeError(`The "fd" argument must be of type number. Received ${describeType(fd)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    validateInteger(fd, 'fd', 0, 2147483647);
}

function validateBuffer(buffer, name) {
    if (!ArrayBuffer.isView(buffer)) {
        const err = new TypeError(`The "${name || 'buffer'}" argument must be an instance of Buffer, TypedArray, or DataView. Received ${describeType(buffer)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

function validateCallback(cb) {
    if (typeof cb !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'function', cb);
    }
}

function validateOpendirOptions(options) {
    if (options === undefined || options === null || typeof options === 'string') {
        return;
    }
    if (typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }
    if (options.bufferSize === undefined) {
        return;
    }
    const { bufferSize } = options;
    if (typeof bufferSize !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('options.bufferSize', 'number', bufferSize);
    }
    if (!Number.isFinite(bufferSize) || !Number.isInteger(bufferSize) || bufferSize < 1) {
        throw new ERR_OUT_OF_RANGE('options.bufferSize', 'an integer >= 1', bufferSize, true);
    }
}

function parseMkdirOptions(options) {
    return _parseMkdirOptions(options, MKDIR_MODE_MASK);
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

function validateLen(len) {
    if (typeof len !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('len', 'number', len);
    }
    if (!Number.isInteger(len)) {
        throw new ERR_OUT_OF_RANGE('len', 'an integer', len);
    }
}

function validateCopyFileMode(mode) {
    if (mode === undefined || mode === null) {
        return 0;
    }
    if (typeof mode !== 'number') {
        const err = new TypeError(`The "mode" argument must be of type number. Received ${describeType(mode)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    validateInteger(mode, 'mode', 0, MAX_COPYFILE_MODE);
    return mode;
}

function createCopyFileError(code, errno, description, src, dest) {
    const err = new Error(`${code}: ${description}, copyfile '${src}' -> '${dest}'`);
    err.code = code;
    if (errno !== undefined) {
        err.errno = errno;
    }
    err.syscall = 'copyfile';
    err.path = src;
    err.dest = dest;
    return err;
}

function createCopyFileErrorFromNative(errorObj, src, dest) {
    if (!errorObj || !errorObj.code) {
        return createSystemError(errorObj);
    }

    return createCopyFileError(
        errorObj.code,
        errorObj.errno,
        getSystemErrorDescription(errorObj.message),
        src,
        dest,
    );
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
        // Delegate to fileURLToPath for proper validation - it throws
        // ERR_INVALID_URL_SCHEME, ERR_INVALID_FILE_URL_HOST, ERR_INVALID_FILE_URL_PATH
        // matching Node.js behavior.
        const urlModule = require('node:url');
        const converted = urlModule.fileURLToPath(path);
        if (converted.indexOf('\u0000') !== -1) {
            const err = new TypeError(`The argument '${propName || 'path'}' must be a string, Uint8Array, or URL without null bytes. Received ${JSON.stringify(converted)}`);
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
    if (typeof path === 'string') {
        if (path.length > 0 && path.charAt(0) !== '/') {
            return require('path').resolve(path);
        }
        return path;
    }
    if (getBuffer() && path instanceof getBuffer()) return path.toString();
    if (path instanceof Uint8Array) {
        return getBuffer().from(path).toString();
    }
    if (path instanceof URL) {
        if (path.protocol !== 'file:') return path.toString();
        return require('node:url').fileURLToPath(path);
    }
    return String(path);
}

function compareDirectoryEntryNames(left, right) {
    const leftName = typeof left === 'string' ? left : left.name;
    const rightName = typeof right === 'string' ? right : right.name;
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    return 0;
}

function mapNativeDirentTypeToUv(fileType) {
    if (typeof fileType === 'number') {
        return fileType;
    }
    switch (fileType) {
        case 'file': return UV_DIRENT_FILE;
        case 'directory': return UV_DIRENT_DIR;
        case 'symlink': return UV_DIRENT_LINK;
        case 'fifo': return UV_DIRENT_FIFO;
        case 'socket': return UV_DIRENT_SOCKET;
        case 'char': return UV_DIRENT_CHAR;
        case 'block': return UV_DIRENT_BLOCK;
        default: return UV_DIRENT_UNKNOWN;
    }
}

function convertStatToDirentType(stat) {
    if (!stat) return UV_DIRENT_UNKNOWN;
    if (stat.isFile) return UV_DIRENT_FILE;
    if (stat.isDirectory) return UV_DIRENT_DIR;
    if (stat.isSymlink) return UV_DIRENT_LINK;
    return UV_DIRENT_UNKNOWN;
}

function resolveUnknownDirentType(parentPath, name) {
    const fullPath = pathToString(parentPath) + '/' + name;
    const lstatResult = native.fs_lstat(fullPath);
    if (lstatResult.error) {
        return UV_DIRENT_UNKNOWN;
    }
    return convertStatToDirentType(lstatResult.stat);
}

function normalizeDirentType(fileType, parentPath, name) {
    const uvType = mapNativeDirentTypeToUv(fileType);
    if (uvType !== UV_DIRENT_UNKNOWN) {
        return uvType;
    }
    return resolveUnknownDirentType(parentPath, name);
}

function createScandirErrorForNonDirectory(path) {
    const st = native.fs_stat(pathToString(path));
    if (!st.error && st.stat.isFile) {
        const err = new Error(`ENOTDIR: not a directory, scandir '${path}'`);
        err.code = 'ENOTDIR';
        err.errno = -20;
        err.syscall = 'scandir';
        err.path = path;
        return err;
    }
    return null;
}

function readDirViaNativeBinding(path, withFileTypes) {
    const result = native.fs_readdir(pathToString(path), withFileTypes);
    if (result.stackOverflow) {
        throw new RangeError('Maximum call stack size exceeded');
    }
    if (result.error) {
        if (result.error.code === 'EIO') {
            const enotdir = createScandirErrorForNonDirectory(path);
            if (enotdir) {
                throw enotdir;
            }
        }
        throw createSystemError(result.error);
    }

    if (!withFileTypes) {
        return [...result.entries].sort(compareDirectoryEntryNames);
    }

    const sortedEntries = [...result.entries].sort(compareDirectoryEntryNames);
    const names = [];
    const types = [];
    for (const entry of sortedEntries) {
        names.push(entry.name);
        types.push(mapNativeDirentTypeToUv(entry.fileType));
    }
    return [names, types];
}

const internalFsBinding = getInternalFsBinding();
internalFsBinding.readdir = function readdir(path, encoding, withFileTypes, req) {
    const runReaddir = () => readDirViaNativeBinding(path, !!withFileTypes);

    if (req && typeof req === 'object') {
        queueMicrotask(() => {
            try {
                req.oncomplete(null, runReaddir());
            } catch (err) {
                req.oncomplete(err);
            }
        });
        return;
    }

    return runReaddir();
};
// internalFsBinding is already on globalThis via getInternalFsBinding()

// --- Stats class ---

export function Stats(devOrObj, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs) {
    if (!(this instanceof Stats)) {
        return new Stats(devOrObj, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs);
    }
    let statObj;
    if (typeof devOrObj === 'object' && devOrObj !== null) {
        statObj = devOrObj;
    } else {
        statObj = {
            dev: devOrObj || 0, mode: mode || 0, nlink: nlink || 0,
            uid: uid || 0, gid: gid || 0, rdev: rdev || 0,
            blksize: blksize || 0, ino: ino || 0, size: size || 0,
            blocks: blocks || 0,
            atimeMs: atimeMs || 0, mtimeMs: mtimeMs || 0,
            ctimeMs: ctimeMs || 0, birthtimeMs: birthtimeMs || 0,
            isFile: false, isDirectory: false, isSymlink: false
        };
    }
    this.dev = statObj.dev;
    this.ino = statObj.ino;
    this.mode = statObj.mode;
    this.nlink = statObj.nlink;
    this.uid = statObj.uid;
    this.gid = statObj.gid;
    this.rdev = statObj.rdev;
    this.size = statObj.size;
    this.blksize = statObj.blksize;
    this.blocks = statObj.blocks;
    this.atimeMs = statObj.atimeMs;
    this.mtimeMs = statObj.mtimeMs;
    this.ctimeMs = statObj.ctimeMs;
    this.birthtimeMs = statObj.birthtimeMs;
    this.atime = new Date(typeof statObj.atimeMs === 'bigint' ? Number(statObj.atimeMs) : statObj.atimeMs);
    this.mtime = new Date(typeof statObj.mtimeMs === 'bigint' ? Number(statObj.mtimeMs) : statObj.mtimeMs);
    this.ctime = new Date(typeof statObj.ctimeMs === 'bigint' ? Number(statObj.ctimeMs) : statObj.ctimeMs);
    this.birthtime = new Date(typeof statObj.birthtimeMs === 'bigint' ? Number(statObj.birthtimeMs) : statObj.birthtimeMs);
    this._isFile = statObj.isFile;
    this._isDirectory = statObj.isDirectory;
    this._isSymlink = statObj.isSymlink;
}

Stats.prototype._toBigInt = function() {
    const s = new Stats({
        dev: BigInt(this.dev),
        ino: BigInt(this.ino),
        mode: BigInt(this.mode),
        nlink: BigInt(this.nlink),
        uid: BigInt(this.uid),
        gid: BigInt(this.gid),
        rdev: BigInt(this.rdev),
        size: BigInt(this.size),
        blksize: BigInt(this.blksize),
        blocks: BigInt(this.blocks),
        atimeMs: BigInt(Math.trunc(this.atimeMs)),
        mtimeMs: BigInt(Math.trunc(this.mtimeMs)),
        ctimeMs: BigInt(Math.trunc(this.ctimeMs)),
        birthtimeMs: BigInt(Math.trunc(this.birthtimeMs)),
        isFile: this._isFile,
        isDirectory: this._isDirectory,
        isSymlink: this._isSymlink,
    });
    s.atime = this.atime;
    s.mtime = this.mtime;
    s.ctime = this.ctime;
    s.birthtime = this.birthtime;
    s.atimeNs = BigInt(Math.trunc(this.atimeMs)) * 1000000n;
    s.mtimeNs = BigInt(Math.trunc(this.mtimeMs)) * 1000000n;
    s.ctimeNs = BigInt(Math.trunc(this.ctimeMs)) * 1000000n;
    s.birthtimeNs = BigInt(Math.trunc(this.birthtimeMs)) * 1000000n;
    return s;
};

Stats.prototype.isFile = function() { return this._isFile; };
Stats.prototype.isDirectory = function() { return this._isDirectory; };
Stats.prototype.isSymbolicLink = function() { return this._isSymlink; };
Stats.prototype.isBlockDevice = function() { return false; };
Stats.prototype.isCharacterDevice = function() { return false; };
Stats.prototype.isFIFO = function() { return false; };
Stats.prototype.isSocket = function() { return false; };

// --- Dirent class ---

export class Dirent {
    constructor(name, fileType, parentPath) {
        this.name = name;
        this.parentPath = parentPath;
        this.path = parentPath;
        this._fileType = normalizeDirentType(fileType, parentPath, name);
    }

    isFile() { return this._fileType === UV_DIRENT_FILE; }
    isDirectory() { return this._fileType === UV_DIRENT_DIR; }
    isSymbolicLink() { return this._fileType === UV_DIRENT_LINK; }
    isBlockDevice() { return this._fileType === UV_DIRENT_BLOCK; }
    isCharacterDevice() { return this._fileType === UV_DIRENT_CHAR; }
    isFIFO() { return this._fileType === UV_DIRENT_FIFO; }
    isSocket() { return this._fileType === UV_DIRENT_SOCKET; }
}

// --- Dir class ---

export class Dir {
    constructor(path, entries) {
        if (path === undefined) {
            const err = new TypeError('The "path" argument must be of type string. Received undefined');
            err.code = 'ERR_MISSING_ARGS';
            throw err;
        }
        this.path = path;
        this._entries = entries;
        this._index = 0;
        this._closed = false;
        this._pendingAsyncOps = 0;
    }

    _assertNotClosed() {
        if (this._closed) throw new ERR_DIR_CLOSED();
    }

    _assertNoConcurrentAsyncOps() {
        if (this._pendingAsyncOps > 0) throw new ERR_DIR_CONCURRENT_OPERATION();
    }

    _nextEntry() {
        if (this._index >= this._entries.length) return null;
        return this._entries[this._index++];
    }

    readSync() {
        this._assertNoConcurrentAsyncOps();
        this._assertNotClosed();
        return this._nextEntry();
    }

    read(cb) {
        if (cb !== undefined && typeof cb !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('callback', 'function', cb);
        }
        const withPendingOp = (action, onError) => {
            this._pendingAsyncOps += 1;
            queueMicrotask(() => {
                try {
                    this._assertNotClosed();
                    action();
                } catch (err) {
                    onError(err);
                } finally {
                    this._pendingAsyncOps -= 1;
                }
            });
        };

        if (typeof cb === 'function') {
            withPendingOp(() => cb(null, this._nextEntry()), (err) => cb(err));
            return;
        }
        return new Promise((resolve, reject) => {
            withPendingOp(() => resolve(this._nextEntry()), reject);
        });
    }

    closeSync() {
        this._assertNoConcurrentAsyncOps();
        this._assertNotClosed();
        this._closed = true;
    }

    close(cb) {
        if (cb !== undefined && typeof cb !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('callback', 'function', cb);
        }
        const closeInternal = () => {
            this._assertNotClosed();
            this._closed = true;
        };
        if (typeof cb === 'function') {
            this._pendingAsyncOps += 1;
            queueMicrotask(() => {
                try {
                    closeInternal();
                    cb(null);
                } catch (err) {
                    cb(err);
                } finally {
                    this._pendingAsyncOps -= 1;
                }
            });
            return;
        }
        return new Promise((resolve, reject) => {
            this._pendingAsyncOps += 1;
            queueMicrotask(() => {
                try {
                    closeInternal();
                    resolve();
                } catch (err) {
                    reject(err);
                } finally {
                    this._pendingAsyncOps -= 1;
                }
            });
        });
    }

    [Symbol.asyncIterator]() {
        const self = this;
        return {
            async next() {
                const entry = await self.read();
                if (entry !== null) {
                    return { done: false, value: entry };
                }
                if (!self._closed) {
                    await self.close();
                }
                return { done: true, value: undefined };
            },
            async return() {
                if (!self._closed) {
                    try {
                        await self.close();
                    } catch (err) {
                        if (!err || err.code !== 'ERR_DIR_CLOSED') {
                            throw err;
                        }
                    }
                }
                return { done: true, value: undefined };
            }
        };
    }
}

const validEncodings = new Set([
    'utf8', 'utf-8', 'ascii', 'base64', 'hex',
    'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le',
    'base64url',
]);

function validateEncoding(enc, name, allowBuffer) {
    if (enc === null || enc === undefined || enc === '') return;
    if (allowBuffer === true && enc === 'buffer') return;
    if (typeof enc !== 'string') {
        const err = new TypeError(`The "${name || 'encoding'}" argument must be of type string. Received ${describeType(enc)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (!validEncodings.has(enc.toLowerCase().replace('-', ''))) {
        const err = new TypeError(`The argument '${name || 'encoding'}' is invalid. Received '${enc}'`);
        err.code = 'ERR_INVALID_ARG_VALUE';
        throw err;
    }
}

function normalizeEncoding(enc) {
    if (!enc) return enc;
    const lower = enc.toLowerCase().replace('-', '');
    if (lower === 'utf8') return 'utf8';
    if (lower === 'ascii') return 'ascii';
    if (lower === 'hex') return 'hex';
    if (lower === 'base64') return 'base64';
    if (lower === 'base64url') return 'base64url';
    if (lower === 'latin1' || lower === 'binary') return 'latin1';
    if (lower === 'ucs2' || lower === 'utf16le') return 'utf16le';
    return enc;
}

function decodeFileResult(bytes, encoding) {
    return getBuffer().from(bytes).toString(encoding);
}

// --- Sync functions ---

export function readFileSync(path, options) {
    if (typeof path !== 'number') validatePath(path);
    if (typeof options === 'string') {
        options = {encoding: options};
    }
    if (options && options.encoding) validateEncoding(options.encoding, 'encoding');
    const encoding = options && options.encoding && options.encoding !== '' ? normalizeEncoding(options.encoding) : null;

    if (typeof path === 'number') {
        const chunks = [];
        let totalLength = 0;
        const buf = new Uint8Array(8192);
        while (true) {
            const bytesRead = readSync(path, buf, 0, buf.length, null);
            if (bytesRead === 0) break;
            chunks.push(buf.slice(0, bytesRead));
            totalLength += bytesRead;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            result.set(chunk, offset);
            offset += chunk.length;
        }
        if (encoding) {
            return decodeFileResult(result, encoding);
        }
        return getBuffer().from(result);
    }

    const flag = options && options.flag ? options.flag : 'r';
    // Use openSync so readFile errors match Node's syscall/path metadata exactly.
    const fd = openSync(path, flag);
    try {
        const statResult = native.fs_fstat(fd);
        if (!statResult.error) {
            const size = statResult.stat?.size;
            if (typeof size === 'number' && size > kIoMaxLength) {
                throw new ERR_FS_FILE_TOO_LARGE(size);
            }
        }
        const chunks = [];
        let totalLength = 0;
        const buf = new Uint8Array(8192);
        while (true) {
            const bytesRead = readSync(fd, buf, 0, buf.length, null);
            if (bytesRead === 0) break;
            chunks.push(buf.slice(0, bytesRead));
            totalLength += bytesRead;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            result.set(chunk, offset);
            offset += chunk.length;
        }
        if (encoding) {
            return decodeFileResult(result, encoding);
        }
        return getBuffer().from(result);
    } finally {
        closeSync(fd);
    }
}

export function writeFileSync(path, data, options) {
    if (typeof path !== 'number') validatePath(path);
    if (typeof options === 'string') {
        options = {encoding: options};
    }
    if (options && options.encoding) validateEncoding(options.encoding, 'encoding');
    const flush = options ? options.flush : undefined;
    validateFlush(flush);
    const encoding = options && options.encoding && options.encoding !== '' ? normalizeEncoding(options.encoding) : null;
    const flag = options && options.flag !== undefined ? options.flag : 'w';

    if (typeof path === 'number') {
        // fd-based write
        if (typeof data === 'string') {
            const result = native.fs_write_string(path, data, null);
            if (result.error) throw createSystemError(result.error);
        } else {
            const dataArray = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
            const result = native.fs_write_buffer(path, dataArray, 0, dataArray.length, null);
            if (result.error) throw createSystemError(result.error);
        }
    } else {
        // Path-based write: use openSync + writeSync + closeSync through the
        // exports object so that monkey-patching these functions works.
        const fd = _default.openSync(path, flag, options && options.mode !== undefined ? options.mode : 0o666);
        try {
            if (typeof data === 'string') {
                const enc = encoding || 'utf8';
                const buf = getBuffer().from(data, enc);
                _default.writeSync(fd, buf, 0, buf.length);
            } else {
                const dataArray = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
                _default.writeSync(fd, dataArray, 0, dataArray.length);
            }
        } finally {
            _default.closeSync(fd);
        }
    }
    if (flush === true) {
        if (typeof path === 'number') {
            fsyncSync(path);
        } else {
            const fd = openSync(path, 'r');
            try {
                _default.fsyncSync(fd);
            } finally {
                closeSync(fd);
            }
        }
    }
}

export function appendFileSync(path, data, options) {
    if (typeof path === 'number') {
        validateFd(path);
    } else {
        validatePath(path);
    }
    if (typeof options === 'string') {
        options = { encoding: options };
    }
    if (options && options.encoding) validateEncoding(options.encoding, 'encoding');
    validateAppendFileData(data);
    const flush = options ? options.flush : undefined;
    validateFlush(flush);
    // appendFileSync is writeFileSync with flag 'a'
    const mergedOptions = Object.assign({}, options || {}, { flag: (options && options.flag) || 'a', flush: undefined });
    writeFileSync(path, data, mergedOptions);
    if (flush === true) {
        if (typeof path === 'number') {
            fsyncSync(path);
        } else {
            const fd = openSync(path, 'r');
            try {
                _default.fsyncSync(fd);
            } finally {
                closeSync(fd);
            }
        }
    }
}

export function openSync(path, flags, mode) {
    validatePath(path);
    flags = flagsToNumber(flags !== undefined ? flags : 'r');
    mode = validateMode(mode, 'mode', 0o666);
    mode = mode & ~process.umask();
    const fullPath = pathToString(path);
    const result = native.fs_open(fullPath, flags, mode);
    if (result.error) {
        throw createSystemError(result.error);
    }
    if (flags & O_CREAT) {
        _notifyFSWatchers(fullPath, 'rename');
    }
    return result.fd;
}

export function closeSync(fd) {
    validateFd(fd);
    const error = native.fs_close(fd);
    if (error) {
        throw createSystemError(error);
    }
}

export function readSync(fd, buffer, offsetOrOptions, length, position) {
    validateFd(fd);
    const argCount = arguments.length;

    // When second arg is an options object (not a buffer), extract buffer from it
    if (buffer != null && typeof buffer === 'object' && !ArrayBuffer.isView(buffer) && !Array.isArray(buffer) && offsetOrOptions === undefined) {
        const opts = buffer;
        if (opts.buffer == null) {
            validateBuffer(opts, 'buffer');
        }
        buffer = opts.buffer;
        offsetOrOptions = opts;
    }
    let offset = 0;
    if (argCount <= 3) {
        if (offsetOrOptions !== undefined && offsetOrOptions !== null && typeof offsetOrOptions === 'object' && !ArrayBuffer.isView(offsetOrOptions) && !Array.isArray(offsetOrOptions)) {
            offset = offsetOrOptions.offset ?? 0;
            length = offsetOrOptions.length !== undefined ? offsetOrOptions.length : buffer.byteLength - offset;
            position = offsetOrOptions.position !== undefined ? offsetOrOptions.position : null;
        } else if (offsetOrOptions !== undefined && offsetOrOptions !== null) {
            const err = new TypeError(`The "options" argument must be of type object. Received ${describeType(offsetOrOptions)}`);
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        } else {
            offset = 0;
            length = buffer.byteLength;
            position = null;
        }
    } else {
        offset = offsetOrOptions ?? 0;
        length = length !== undefined ? length : buffer.byteLength - offset;
        position = position !== undefined ? position : null;
    }

    validateBuffer(buffer, 'buffer');
    validateInteger(offset, 'offset', 0);
    length |= 0;

    if (length === 0) {
        return 0;
    }

    if (buffer.byteLength === 0) {
        throwEmptyReadBufferError(buffer);
    }

    validateOffsetLengthRead(offset, length, buffer.byteLength);
    position = validateReadPosition(position, length);

    const result = native.fs_read(fd, length, position);
    if (result.error) {
        throw createSystemError(result.error);
    }

    const src = result.buffer;
    const bytesRead = result.bytesRead;
    for (let i = 0; i < bytesRead; i++) {
        buffer[offset + i] = src[i];
    }
    return bytesRead;
}

export function writeSync(fd, bufferOrString, offsetOrPosition, lengthOrEncoding, position) {
    validateFd(fd);

    if (typeof bufferOrString === 'string') {
        const pos = offsetOrPosition !== undefined ? offsetOrPosition : null;
        const result = native.fs_write_string(fd, bufferOrString, pos);
        if (result.error) {
            throw createSystemError(result.error);
        }
        return result.bytesWritten;
    }

    if (!ArrayBuffer.isView(bufferOrString)) {
        const err = new TypeError('The "buffer" argument must be of type string or an instance of Buffer or Uint8Array. Received ' + describeType(bufferOrString));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    let offset, length, pos;

    if (typeof offsetOrPosition === 'object') {
        const opts = offsetOrPosition ?? {};
        offset = opts.offset;
        length = opts.length;
        position = opts.position;

        if (offset == null) {
            offset = 0;
        } else {
            validateInt32(offset, 'offset', 0);
        }

        if (typeof length !== 'number') {
            length = bufferOrString.byteLength - offset;
        }
        validateInt32(length, 'length', 0);

        pos = position !== undefined ? position : null;
    } else {
        offset = offsetOrPosition || 0;
        length = lengthOrEncoding !== undefined ? lengthOrEncoding : bufferOrString.byteLength - offset;
        pos = position !== undefined ? position : null;
    }

    validateOffsetLengthWrite(offset, length, bufferOrString.byteLength);

    const dataArray = new Uint8Array(bufferOrString.buffer || bufferOrString, bufferOrString.byteOffset || 0, bufferOrString.byteLength || bufferOrString.length);
    const result = native.fs_write_buffer(fd, dataArray, offset, length, pos);
    if (result.error) {
        throw createSystemError(result.error);
    }
    return result.bytesWritten;
}

export function ftruncateSync(fd, len) {
    validateFd(fd);
    if (len === undefined) {
        len = 0;
    } else {
        validateLen(len);
    }
    const error = native.fs_ftruncate(fd, len);
    if (error) {
        throw createSystemError(error);
    }
}

export function fsyncSync(fd) {
    validateFd(fd);
    const error = native.fs_fsync(fd);
    if (error) {
        throw createSystemError(error);
    }
}

export function fdatasyncSync(fd) {
    validateFd(fd);
    const error = native.fs_fdatasync(fd);
    if (error) {
        throw createSystemError(error);
    }
}

export function statSync(path, options) {
    validatePath(path);
    const result = native.fs_stat(pathToString(path));
    if (result.error) {
        if (options && options.throwIfNoEntry === false && result.error.code === 'ENOENT') {
            return undefined;
        }
        throw createSystemError(result.error);
    }
    const s = new Stats(result.stat);
    return (options && options.bigint) ? s._toBigInt() : s;
}

export function lstatSync(path, options) {
    validatePath(path);
    const result = native.fs_lstat(pathToString(path));
    if (result.error) {
        if (options && options.throwIfNoEntry === false && result.error.code === 'ENOENT') {
            return undefined;
        }
        throw createSystemError(result.error);
    }
    const s = new Stats(result.stat);
    return (options && options.bigint) ? s._toBigInt() : s;
}

export function fstatSync(fd, options) {
    validateFd(fd);
    const result = native.fs_fstat(fd);
    if (result.error) {
        throw createSystemError(result.error);
    }
    const s = new Stats(result.stat);
    return (options && options.bigint) ? s._toBigInt() : s;
}

function makeStatFsResult(bigint) {
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

export function statfsSync(path, options) {
    validatePath(path);
    const result = native.fs_stat(pathToString(path));
    if (result.error) {
        throw createSystemError(result.error);
    }
    return makeStatFsResult(options && options.bigint);
}

export function readdirSync(path, options) {
    validatePath(path);
    const opts = getOptions(options, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const withFileTypes = opts.withFileTypes || false;
    const recursive = opts.recursive || false;
    const result = internalFsBinding.readdir(pathToString(path), opts.encoding, withFileTypes);
    if (withFileTypes) {
        const names = result[0];
        const types = result[1];
        const dirents = names.map((name, index) => new Dirent(name, types[index], path));
        if (recursive) {
            const all = [];
            for (const dirent of dirents) {
                all.push(dirent);
                if (dirent.isDirectory()) {
                    const subPath = path + '/' + dirent.name;
                    try {
                        const subEntries = readdirSync(subPath, { withFileTypes: true, recursive: true });
                        all.push(...subEntries);
                    } catch {}
                }
            }
            return all;
        }
        return dirents;
    }
    const entries = result;
    if (recursive) {
        const all = [];
        for (const entry of entries) {
            all.push(entry);
            const subPath = path + '/' + entry;
            try {
                const st = native.fs_stat(subPath);
                if (!st.error && st.stat.isDirectory) {
                    const subEntries = readdirSync(subPath, { recursive: true });
                    all.push(...subEntries.map(e => entry + '/' + e));
                }
            } catch {}
        }
        return all;
    }
    if (opts.encoding === 'buffer') {
        return entries.map(e => getBuffer().from(e));
    }
    return entries;
}

export function accessSync(path, mode) {
    validatePath(path);
    mode = mode !== undefined ? mode : F_OK;
    const error = native.fs_access(pathToString(path), mode);
    if (error) {
        throw createSystemError(error);
    }
}

export function existsSync(path) {
    try {
        if (typeof path !== 'string') return false;
        return native.fs_exists(path);
    } catch {
        return false;
    }
}

function realpathSyncImpl(path, options, useNative) {
    validatePath(path);
    const opts = getOptions(options, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const pathString = getPathModule().resolve(pathToString(path));

    if (!useNative) {
        const lstatResult = native.fs_lstat(pathString);
        if (lstatResult.error) {
            throw createSystemError(lstatResult.error);
        }
    }

    const result = native.fs_realpath(pathString);
    if (result.error) {
        throw createSystemError(result.error);
    }
    const encoding = opts.encoding;
    if (encoding === 'buffer') {
        return getBuffer().from(result.result);
    }
    if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
        return getBuffer().from(result.result).toString(encoding);
    }
    return result.result;
}

export function realpathSync(path, options) {
    return realpathSyncImpl(path, options, false);
}

function realpathSyncNative(path, options) {
    return realpathSyncImpl(path, options, true);
}

realpathSync.native = realpathSyncNative;

export function truncateSync(path, len) {
    if (typeof path === 'number') {
        return ftruncateSync(path, len);
    }
    validatePath(path);
    if (len === undefined) {
        len = 0;
    } else {
        validateLen(len);
    }
    const error = native.fs_truncate(path, len);
    if (error) {
        throw createSystemError(error);
    }
}

export function copyFileSync(src, dest, mode) {
    validatePath(src, 'src');
    validatePath(dest, 'dest');
    const copyMode = validateCopyFileMode(mode);
    const srcPath = pathToString(src);
    const destPath = pathToString(dest);

    if ((copyMode & COPYFILE_EXCL) !== 0) {
        // Node checks source existence before COPYFILE_EXCL destination checks.
        if (!existsSync(srcPath)) {
            throw createCopyFileError('ENOENT', -2, 'no such file or directory', srcPath, destPath);
        }
        if (existsSync(destPath)) {
            throw createCopyFileError('EEXIST', -17, 'file already exists', srcPath, destPath);
        }
    }

    const error = native.fs_copy_file(srcPath, destPath);
    if (error) {
        throw createCopyFileErrorFromNative(error, srcPath, destPath);
    }
    _notifyFSWatchers(destPath, 'rename');
}

export function linkSync(existingPath, newPath) {
    validatePath(existingPath, 'existingPath');
    validatePath(newPath, 'newPath');
    const error = native.fs_link(existingPath, newPath);
    if (error) {
        throw createSystemError(error);
    }
}

export function symlinkSync(target, path, type) {
    validatePath(target, 'target');
    validatePath(path, 'path');
    const error = native.fs_symlink(target, path);
    if (error) {
        throw createSystemError(error);
    }
}

export function readlinkSync(path, options) {
    validatePath(path);
    const opts = getOptions(options, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const result = native.fs_readlink(path);
    if (result.error) {
        throw createSystemError(result.error);
    }
    const encoding = opts.encoding;
    if (encoding === 'buffer') {
        return getBuffer().from(result.result);
    }
    return result.result;
}

export function chmodSync(path, mode) {
    validatePath(path);
    mode = validateMode(mode, 'mode', undefined);
    const error = native.fs_chmod(path, mode);
    if (error) {
        throw createSystemError(error);
    }
}

export function fchmodSync(fd, mode) {
    validateFd(fd);
    mode = validateMode(mode, 'mode', undefined);
    const error = native.fs_fchmod(fd, mode);
    if (error) {
        throw createSystemError(error);
    }
}

export function lchmodSync(path, mode) {
    chmodSync(path, mode);
}

export function chownSync(path, uid, gid) {
    validatePath(path);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    const error = native.fs_chown(path, uid, gid);
    if (error) {
        throw createSystemError(error);
    }
}

export function fchownSync(fd, uid, gid) {
    validateFd(fd);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    const error = native.fs_fchown(fd, uid, gid);
    if (error) {
        throw createSystemError(error);
    }
}

export function lchownSync(path, uid, gid) {
    validatePath(path);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    const error = native.fs_lchown(path, uid, gid);
    if (error) {
        throw createSystemError(error);
    }
}

export function utimesSync(path, atime, mtime) {
    validatePath(path);
    const atimeSecs = (atime instanceof Date) ? atime.getTime() / 1000 : Number(atime);
    const mtimeSecs = (mtime instanceof Date) ? mtime.getTime() / 1000 : Number(mtime);
    const error = native.fs_utimes(pathToString(path), atimeSecs, mtimeSecs);
    if (error) {
        throw createSystemError(error);
    }
}

export function futimesSync(fd, atime, mtime) {
    validateFd(fd);
    const atimeSecs = (atime instanceof Date) ? atime.getTime() / 1000 : Number(atime);
    const mtimeSecs = (mtime instanceof Date) ? mtime.getTime() / 1000 : Number(mtime);
    const error = native.fs_futimes(fd, atimeSecs, mtimeSecs);
    if (error) {
        throw createSystemError(error);
    }
}

export function lutimesSync(path, atime, mtime) {
    validatePath(path);
    const atimeSecs = (atime instanceof Date) ? atime.getTime() / 1000 : Number(atime);
    const mtimeSecs = (mtime instanceof Date) ? mtime.getTime() / 1000 : Number(mtime);
    const error = native.fs_lutimes(pathToString(path), atimeSecs, mtimeSecs);
    if (error) {
        throw createSystemError(error);
    }
}

export function unlinkSync(path) {
    validatePath(path);
    const fullPath = pathToString(path);
    const error = native.unlink(fullPath);
    if (error) {
        throw createSystemError(error);
    }
    _notifyFSWatchers(fullPath, 'rename');
}

export function renameSync(oldPath, newPath) {
    validatePath(oldPath, 'oldPath');
    validatePath(newPath, 'newPath');
    const oldPathString = pathToString(oldPath);
    const newPathString = pathToString(newPath);
    const error = native.rename(oldPathString, newPathString);
    if (error) {
        throw createSystemError(error);
    }
    _notifyFSWatchers(oldPathString, 'rename');
    _notifyFSWatchers(newPathString, 'rename');
}

export function mkdirSync(path, options) {
    validatePath(path);
    const { recursive, mode } = parseMkdirOptions(options);
    const pathString = pathToString(path);
    const firstCreatedPath = getFirstCreatedPath(pathString, recursive);

    const error = native.fs_mkdir(pathString, recursive, mode);
    if (error) {
        throw createSystemError(error);
    }
    _notifyFSWatchers(pathString, 'rename');
    if (recursive) return firstCreatedPath;
    return undefined;
}

function _rimrafSync(dirPath) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const entryPath = dirPath + '/' + entry.name;
        if (entry.isDirectory()) {
            _rimrafSync(entryPath);
        } else {
            unlinkSync(entryPath);
        }
    }
    _default.rmdirSync(dirPath);
}

export function rmdirSync(path, options) {
    validatePath(path);
    if (options && options.recursive) {
        path = pathToString(path);
        const st = native.fs_stat(path);
        if (st.error) {
            throw createSystemError(st.error);
        }
        if (!st.stat.isDirectory) {
            const err = new Error(`ENOTDIR: not a directory, rmdir '${path}'`);
            err.code = 'ENOTDIR';
            err.errno = -20;
            err.syscall = 'rmdir';
            err.path = path;
            throw err;
        }
        _rimrafSync(path);
    } else {
        const pathString = pathToString(path);
        const error = native.fs_rmdir(pathString);
        if (error) throw createSystemError(error);
        _notifyFSWatchers(pathString, 'rename');
    }
}

export function rmSync(path, options) {
    validatePath(path);
    path = pathToString(path);
    const recursive = options && options.recursive || false;
    const force = options && options.force || false;
    const error = native.fs_rm(path, recursive, force);
    if (error) {
        throw createSystemError(error);
    }
    _notifyFSWatchers(path, 'rename');
}

export function mkdtempSync(prefix, options) {
    validateMkdtempPrefix(prefix);
    const opts = getOptions(options, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const result = native.fs_mkdtemp(pathToString(prefix));
    if (result.error) {
        throw createSystemError(result.error);
    }
    const encoding = opts.encoding;
    if (encoding === 'buffer') {
        return getBuffer().from(result.result);
    }
    return result.result;
}

export function opendirSync(path, options) {
    validatePath(path);
    validateOpendirOptions(options);
    const recursive = options && options.recursive ? true : false;
    const entries = readdirSync(path, { withFileTypes: true, recursive });
    return new Dir(path, entries);
}

// --- Callback (async) functions ---

export function readFile(path, optionsOrCallback, callback) {
    if (typeof path !== 'number') validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    if (typeof optionsOrCallback === 'string') {
        optionsOrCallback = {encoding: optionsOrCallback};
    }
    const opts = optionsOrCallback || {};
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding');
    const signal = opts.signal;
    if (signal != null && (signal === null || typeof signal !== 'object' || !('aborted' in signal))) {
        throw new ERR_INVALID_ARG_TYPE('options.signal', 'AbortSignal', signal);
    }
    const rawCb = callback;
    validateCallback(rawCb);
    let called = false;
    const cb = function() {
        if (called) return;
        called = true;
        rawCb.apply(this, arguments);
    };
    if (signal && signal.aborted) {
        const e = new DOMException('The operation was aborted', 'AbortError');
        e.name = 'AbortError';
        queueMicrotask(() => cb(e));
        return;
    }
    if (signal) {
        signal.addEventListener('abort', function onAbort() {
            const e = new DOMException('The operation was aborted', 'AbortError');
            e.name = 'AbortError';
            cb(e);
        }, { once: true });
    }
    queueMicrotask(() => {
        if (signal && signal.aborted) {
            const e = new DOMException('The operation was aborted', 'AbortError');
            e.name = 'AbortError';
            cb(e);
            return;
        }
        try {
            const result = readFileSync(path, opts);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function writeFile(path, data, optionsOrCallback, callback) {
    if (typeof path !== 'number') validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    if (typeof optionsOrCallback === 'string') {
        optionsOrCallback = {encoding: optionsOrCallback};
    }
    const opts = optionsOrCallback || {};
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding');
    const flush = opts.flush;
    validateFlush(flush);
    const signal = opts.signal;
    const rawCb = callback;
    validateCallback(rawCb);
    let called = false;
    const cb = function() {
        if (called) return;
        called = true;
        rawCb.apply(this, arguments);
    };
    if (signal && signal.aborted) {
        const e = new DOMException('The operation was aborted', 'AbortError');
        e.name = 'AbortError';
        queueMicrotask(() => cb(e));
        return;
    }
    if (signal) {
        signal.addEventListener('abort', function onAbort() {
            const e = new DOMException('The operation was aborted', 'AbortError');
            e.name = 'AbortError';
            cb(e);
        }, { once: true });
    }
    queueMicrotask(() => {
        if (signal && signal.aborted) {
            const e = new DOMException('The operation was aborted', 'AbortError');
            e.name = 'AbortError';
            cb(e);
            return;
        }
        try {
            const writeOpts = flush !== undefined ? Object.assign({}, opts, { flush: undefined }) : opts;
            writeFileSync(path, data, writeOpts);
            if (flush === true) {
                const fd = openSync(path, 'r');
                _default.fsync(fd, (err) => {
                    closeSync(fd);
                    cb(err || null);
                });
                return;
            }
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function appendFile(path, data, optionsOrCallback, callback) {
    if (typeof path === 'number') {
        validateFd(path);
    } else {
        validatePath(path);
    }
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    if (typeof optionsOrCallback === 'string') {
        optionsOrCallback = {encoding: optionsOrCallback};
    }
    const opts = optionsOrCallback || {};
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding');
    validateAppendFileData(data);
    const flush = opts.flush;
    validateFlush(flush);
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const appendOpts = flush !== undefined ? Object.assign({}, opts, { flush: undefined }) : opts;
            appendFileSync(path, data, appendOpts);
            if (flush === true) {
                if (typeof path === 'number') {
                    _default.fsync(path, (err) => {
                        cb(err || null);
                    });
                } else {
                    const fd = openSync(path, 'r');
                    _default.fsync(fd, (err) => {
                        closeSync(fd);
                        cb(err || null);
                    });
                }
                return;
            }
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function open(path, flagsOrCallback, modeOrCallback, callback) {
    validatePath(path);
    let flags = 'r';
    let mode = 0o666;
    let cb;

    if (typeof flagsOrCallback === 'function') {
        cb = flagsOrCallback;
    } else if (typeof modeOrCallback === 'function') {
        flags = flagsOrCallback;
        cb = modeOrCallback;
    } else {
        flags = flagsOrCallback;
        mode = modeOrCallback;
        cb = callback;
    }

    flags = flagsToNumber(flags !== undefined ? flags : 'r');
    mode = validateMode(mode, 'mode', 0o666);
    mode = mode & ~process.umask();
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = native.fs_open(pathToString(path), flags, mode);
            if (result.error) {
                cb(createSystemError(result.error));
            } else {
                cb(null, result.fd);
            }
        } catch (err) {
            cb(err);
        }
    });
}

export function close(fd, callback) {
    validateFd(fd);
    if (callback !== undefined && typeof callback !== 'function') {
        const err = new TypeError(`The "callback" argument must be of type function. Received ${describeType(callback)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    if (typeof callback !== 'function') {
        callback = function() {};
    }
    const cb = callback;
    queueMicrotask(() => {
        try {
            closeSync(fd);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function read(fd, bufferOrOptions, offsetOrCallback, length, position, callback) {
    validateFd(fd);
    let buffer, offset, cb;

    if (typeof bufferOrOptions === 'function') {
        cb = bufferOrOptions;
        buffer = getBuffer().alloc(16384);
        offset = 0;
        length = buffer.byteLength;
        position = null;
    } else if (typeof offsetOrCallback === 'function') {
        cb = offsetOrCallback;
        if (ArrayBuffer.isView(bufferOrOptions)) {
            buffer = bufferOrOptions;
            offset = 0;
            length = buffer.byteLength;
            position = null;
        } else if (bufferOrOptions != null && typeof bufferOrOptions === 'object' && !ArrayBuffer.isView(bufferOrOptions)) {
            if ('buffer' in bufferOrOptions && bufferOrOptions.buffer != null) {
                buffer = bufferOrOptions.buffer;
            } else if ('buffer' in bufferOrOptions && bufferOrOptions.buffer == null) {
                validateBuffer(bufferOrOptions.buffer, 'buffer');
            } else {
                buffer = getBuffer().alloc(16384);
            }
            offset = bufferOrOptions.offset ?? 0;
            length = bufferOrOptions.length !== undefined ? bufferOrOptions.length : buffer.byteLength - offset;
            position = bufferOrOptions.position !== undefined ? bufferOrOptions.position : null;
        } else {
            buffer = getBuffer().alloc(16384);
            offset = 0;
            length = buffer.byteLength;
            position = null;
        }
    } else if (ArrayBuffer.isView(bufferOrOptions) && offsetOrCallback != null && typeof offsetOrCallback === 'object' && !ArrayBuffer.isView(offsetOrCallback) && !Array.isArray(offsetOrCallback)) {
        buffer = bufferOrOptions;
        offset = offsetOrCallback.offset ?? 0;
        const optLen = offsetOrCallback.length;
        position = offsetOrCallback.position !== undefined ? offsetOrCallback.position : null;
        // The next positional param after options is the callback
        if (typeof length === 'function') {
            cb = length;
        } else if (typeof position === 'function' && callback === undefined) {
            cb = position;
            position = null;
        } else {
            cb = callback;
        }
        length = optLen !== undefined ? optLen : buffer.byteLength - offset;
    } else {
        buffer = bufferOrOptions;
        offset = offsetOrCallback ?? 0;
        if (typeof length === 'function') {
            cb = length;
            length = buffer.byteLength - offset;
            position = null;
        } else if (typeof position === 'function' && callback === undefined) {
            cb = position;
            position = null;
        } else {
            cb = callback;
        }
    }

    validateBuffer(buffer, 'buffer');
    validateCallback(cb);
    validateInteger(offset, 'offset', 0);
    length |= 0;

    if (length === 0) {
        setImmediate(() => {
            cb(null, 0, buffer);
        });
        return;
    }

    if (buffer.byteLength === 0) {
        throwEmptyReadBufferError(buffer);
    }

    validateOffsetLengthRead(offset, length, buffer.byteLength);
    position = validateReadPosition(position, length);

    setImmediate(() => {
        try {
            const bytesRead = readSync(fd, buffer, offset, length, position);
            cb(null, bytesRead, buffer);
        } catch (err) {
            cb(err, 0, buffer);
        }
    });
}

export function write(fd, bufferOrString, offsetOrPosition, lengthOrEncoding, positionOrCallback, callback) {
    validateFd(fd);
    let cb;
    if (typeof bufferOrString === 'string') {
        if (typeof offsetOrPosition === 'function') {
            cb = offsetOrPosition;
            offsetOrPosition = undefined;
        } else if (typeof lengthOrEncoding === 'function') {
            cb = lengthOrEncoding;
            lengthOrEncoding = undefined;
        } else {
            cb = positionOrCallback || callback;
        }
        validateCallback(cb);
        queueMicrotask(() => {
            try {
                const written = writeSync(fd, bufferOrString, offsetOrPosition, lengthOrEncoding);
                cb(null, written, bufferOrString);
            } catch (err) {
                cb(err, 0, bufferOrString);
            }
        });
        return;
    }

    // Buffer write - validate buffer type synchronously
    if (!ArrayBuffer.isView(bufferOrString)) {
        const err = new TypeError('The "buffer" argument must be of type string or an instance of Buffer or Uint8Array. Received ' + describeType(bufferOrString));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    let offset, length, position;

    if (typeof offsetOrPosition === 'function') {
        // fs.write(fd, buffer, callback)
        cb = offsetOrPosition;
        offset = 0;
        length = bufferOrString.byteLength;
        position = null;
    } else if (offsetOrPosition != null && typeof offsetOrPosition === 'object') {
        // fs.write(fd, buffer, options, callback)
        const options = offsetOrPosition;
        cb = typeof lengthOrEncoding === 'function' ? lengthOrEncoding : (positionOrCallback || callback);

        const rawOffset = options.offset;
        if (rawOffset !== undefined && rawOffset !== null) {
            if (typeof rawOffset !== 'number') {
                const err = new TypeError(`The "offset" argument must be of type number. Received ${describeType(rawOffset)}`);
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            offset = rawOffset;
        } else {
            offset = 0;
        }

        const rawLength = options.length;
        if (rawLength !== undefined && rawLength !== null) {
            length = rawLength;
        } else {
            length = bufferOrString.byteLength - offset;
        }

        position = options.position !== undefined ? options.position : null;
    } else if (typeof offsetOrPosition === 'number') {
        // fs.write(fd, buffer, offset[, length[, position]], callback)
        offset = offsetOrPosition;
        if (typeof lengthOrEncoding === 'function') {
            cb = lengthOrEncoding;
            length = bufferOrString.byteLength - (offset || 0);
            position = null;
        } else if (typeof positionOrCallback === 'function') {
            cb = positionOrCallback;
            length = lengthOrEncoding !== undefined ? lengthOrEncoding : bufferOrString.byteLength - (offset || 0);
            position = null;
        } else {
            cb = callback;
            length = lengthOrEncoding !== undefined ? lengthOrEncoding : bufferOrString.byteLength - (offset || 0);
            position = positionOrCallback !== undefined ? positionOrCallback : null;
        }
    } else if (offsetOrPosition === null || offsetOrPosition === undefined) {
        // Null/undefined third arg - use defaults
        if (typeof lengthOrEncoding === 'function') {
            cb = lengthOrEncoding;
        } else if (typeof positionOrCallback === 'function') {
            cb = positionOrCallback;
        } else {
            cb = callback;
        }
        offset = 0;
        length = bufferOrString.byteLength;
        position = null;
    } else {
        // Invalid type for options/offset (boolean, string, symbol, etc.)
        const err = new TypeError(`The "options" argument must be of type object. Received ${describeType(offsetOrPosition)}`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    // Validate offset
    validateInteger(offset, 'offset', 0);
    if (offset > bufferOrString.byteLength) {
        const err = new RangeError(`The value of "offset" is out of range. It must be <= ${bufferOrString.byteLength}. Received ${offset}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }

    // Validate length
    if (typeof length === 'number') {
        if (length < 0) {
            const err = new RangeError(`The value of "length" is out of range. It must be >= 0. Received ${length}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        if (offset + length > bufferOrString.byteLength) {
            const err = new RangeError(`The value of "length" is out of range. It must be <= ${bufferOrString.byteLength - offset}. Received ${length}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
    }

    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const written = writeSync(fd, bufferOrString, offset, length, position);
            cb(null, written, bufferOrString);
        } catch (err) {
            cb(err, 0, bufferOrString);
        }
    });
}

export function stat(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = statSync(path, optionsOrCallback);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function lstat(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = lstatSync(path, optionsOrCallback);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function statfs(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = statfsSync(path, optionsOrCallback);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function fstat(fd, optionsOrCallback, callback) {
    validateFd(fd);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = fstatSync(fd, optionsOrCallback);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function ftruncate(fd, lenOrCallback, callback) {
    validateFd(fd);
    let len = 0;
    let cb;
    if (typeof lenOrCallback === 'function') {
        cb = lenOrCallback;
    } else {
        if (lenOrCallback !== undefined) {
            validateLen(lenOrCallback);
        }
        len = lenOrCallback !== undefined ? lenOrCallback : 0;
        cb = callback;
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            ftruncateSync(fd, len);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function fsync(fd, callback) {
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            fsyncSync(fd);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function fdatasync(fd, callback) {
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            fdatasyncSync(fd);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function readdir(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const opts = getOptions(optionsOrCallback, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const cb = callback;
    validateCallback(cb);
    const withFileTypes = opts.withFileTypes || false;
    const recursive = opts.recursive || false;
    const pathStr = pathToString(path);

    const req = {
        oncomplete: (err, result) => {
            if (err) {
                cb(err);
                return;
            }
            try {
                if (withFileTypes) {
                    const names = result[0];
                    const types = result[1];
                    const dirents = names.map((name, index) => new Dirent(name, types[index], path));
                    if (recursive) {
                        const all = [...dirents];
                        let pending = 0;
                        let finished = false;
                        const tryFinish = () => {
                            if (finished && pending === 0) cb(null, all);
                        };
                        for (const dirent of dirents) {
                            if (dirent.isDirectory()) {
                                pending++;
                                readdir(path + '/' + dirent.name, { withFileTypes: true, recursive: true }, (subErr, subEntries) => {
                                    pending--;
                                    if (!subErr && subEntries) all.push(...subEntries);
                                    tryFinish();
                                });
                            }
                        }
                        finished = true;
                        tryFinish();
                    } else {
                        cb(null, dirents);
                    }
                } else {
                    if (recursive) {
                        const all = [...result];
                        let pending = 0;
                        let finished = false;
                        const tryFinish = () => {
                            if (finished && pending === 0) cb(null, all);
                        };
                        for (const entry of result) {
                            const subPath = path + '/' + entry;
                            try {
                                const st = native.fs_stat(subPath);
                                if (!st.error && st.stat.isDirectory) {
                                    pending++;
                                    readdir(subPath, { recursive: true }, (subErr, subEntries) => {
                                        pending--;
                                        if (!subErr && subEntries) all.push(...subEntries.map(e => entry + '/' + e));
                                        tryFinish();
                                    });
                                }
                            } catch {}
                        }
                        finished = true;
                        tryFinish();
                    } else {
                        if (opts.encoding === 'buffer') {
                            cb(null, result.map(e => getBuffer().from(e)));
                        } else {
                            cb(null, result);
                        }
                    }
                }
            } catch (e) {
                cb(e);
            }
        }
    };
    internalFsBinding.readdir(pathStr, opts.encoding, withFileTypes, req);
}

export function access(path, modeOrCallback, callback) {
    validatePath(path);
    let mode = F_OK;
    let cb;
    if (typeof modeOrCallback === 'function') {
        cb = modeOrCallback;
    } else {
        mode = modeOrCallback;
        cb = callback;
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            accessSync(path, mode);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function exists(path, callback) {
    if (typeof callback !== 'function') {
        throw Object.assign(
            new TypeError(`Callback must be a function. Received ${typeof callback}`),
            { code: 'ERR_INVALID_ARG_TYPE' }
        );
    }
    queueMicrotask(() => {
        callback(existsSync(path));
    });
}

export function realpath(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const opts = getOptions(optionsOrCallback, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const cb = callback;
    validateCallback(cb);
    if (globalThis.__wasm_rquickjs_sync_callbacks) {
        try {
            const result = realpathSync(path, opts);
            cb(null, result);
        } catch (err) {
            if (err && err.__isProcessExit) throw err;
            cb(err);
        }
    } else {
        queueMicrotask(() => {
            try {
                const result = realpathSync(path, opts);
                cb(null, result);
            } catch (err) {
                cb(err);
            }
        });
    }
}

function realpathNative(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const opts = getOptions(optionsOrCallback, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = realpathSyncNative(path, opts);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

realpath.native = realpathNative;

export function truncate(path, lenOrCallback, callback) {
    if (typeof path === 'number') {
        return ftruncate(path, lenOrCallback, callback);
    }
    validatePath(path);
    let len = 0;
    let cb;
    if (typeof lenOrCallback === 'function') {
        cb = lenOrCallback;
    } else {
        if (lenOrCallback !== undefined) {
            validateLen(lenOrCallback);
        }
        len = lenOrCallback !== undefined ? lenOrCallback : 0;
        cb = callback;
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            truncateSync(path, len);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function copyFile(src, dest, modeOrCallback, callback) {
    validatePath(src, 'src');
    validatePath(dest, 'dest');
    let mode = 0;
    let cb;
    if (typeof modeOrCallback === 'function') {
        cb = modeOrCallback;
    } else {
        mode = validateCopyFileMode(modeOrCallback);
        cb = callback;
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            copyFileSync(src, dest, mode);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function link(existingPath, newPath, callback) {
    validatePath(existingPath, 'existingPath');
    validatePath(newPath, 'newPath');
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            linkSync(existingPath, newPath);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function symlink(target, path, typeOrCallback, callback) {
    validatePath(target, 'target');
    validatePath(path, 'path');
    let cb;
    if (typeof typeOrCallback === 'function') {
        cb = typeOrCallback;
    } else {
        cb = callback;
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            symlinkSync(target, path);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function readlink(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const opts = getOptions(optionsOrCallback, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = readlinkSync(path, opts);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function chmod(path, mode, callback) {
    validatePath(path);
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            chmodSync(path, mode);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function fchmod(fd, mode, callback) {
    validateFd(fd);
    mode = validateMode(mode, 'mode', undefined);
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            fchmodSync(fd, mode);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function lchmod(path, mode, callback) {
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            lchmodSync(path, mode);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function chown(path, uid, gid, callback) {
    validatePath(path);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            chownSync(path, uid, gid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function fchown(fd, uid, gid, callback) {
    validateFd(fd);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            fchownSync(fd, uid, gid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function lchown(path, uid, gid, callback) {
    validatePath(path);
    validateUid(uid, 'uid');
    validateUid(gid, 'gid');
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            lchownSync(path, uid, gid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function utimes(path, atime, mtime, callback) {
    validatePath(path);
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            utimesSync(path, atime, mtime);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function futimes(fd, atime, mtime, callback) {
    validateFd(fd);
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            futimesSync(fd, atime, mtime);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function lutimes(path, atime, mtime, callback) {
    validatePath(path);
    validateCallback(callback);
    queueMicrotask(() => {
        try {
            lutimesSync(path, atime, mtime);
            callback(null);
        } catch (err) {
            callback(err);
        }
    });
}

export function unlink(path, callback) {
    validatePath(path);
    validateCallback(callback);
    const error = native.unlink(pathToString(path));
    if (error) {
        queueMicrotask(() => callback(createSystemError(error)));
    } else {
        queueMicrotask(() => callback(null));
    }
}

export function rename(oldPath, newPath, callback) {
    validatePath(oldPath, 'oldPath');
    validatePath(newPath, 'newPath');
    validateCallback(callback);
    const oldPathString = pathToString(oldPath);
    const newPathString = pathToString(newPath);
    const error = native.rename(oldPathString, newPathString);
    if (error) {
        queueMicrotask(() => callback(createSystemError(error)));
    } else {
        queueMicrotask(() => callback(null));
    }
}

export function mkdir(path, optionsOrCallback, callback) {
    validatePath(path);
    let cb;
    let options;

    if (typeof optionsOrCallback === 'function') {
        cb = optionsOrCallback;
    } else {
        options = optionsOrCallback;
        cb = callback;
    }

    validateCallback(cb);
    const { recursive, mode } = parseMkdirOptions(options);
    const pathString = pathToString(path);
    const firstCreatedPath = getFirstCreatedPath(pathString, recursive);

    queueMicrotask(() => {
        const error = native.fs_mkdir(pathString, recursive, mode);
        if (error) {
            cb(createSystemError(error));
        } else {
            cb(null, recursive ? firstCreatedPath : undefined);
        }
    });
}

export function rmdir(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            rmdirSync(path, optionsOrCallback);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function rm(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            rmSync(path, optionsOrCallback);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

export function mkdtemp(prefix, optionsOrCallback, callback) {
    validateMkdtempPrefix(prefix);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const opts = getOptions(optionsOrCallback, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = mkdtempSync(prefix, opts);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

export function opendir(path, optionsOrCallback, callback) {
    validatePath(path);
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    validateOpendirOptions(optionsOrCallback);
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            const result = opendirSync(path, optionsOrCallback);
            cb(null, result);
        } catch (err) {
            cb(err);
        }
    });
}

// --- FSWatcher (polling-based, since WASI has no native inotify/kqueue) ---
// Synchronous notification registry: mutating fs operations notify active watchers
// immediately, so changes that happen and reverse within a single event loop tick
// are still detected (polling alone would miss them).
const _activeWatchers = new Set();

function _notifyFSWatchers(fullPath, eventType) {
    if (_activeWatchers.size === 0) return;
    for (const watcher of _activeWatchers) {
        if (watcher._closed) continue;
        const base = watcher._watchPath;
        if (watcher._isFile) {
            if (fullPath === base) {
                const pathModule = getPathModule();
                watcher.emit('change', eventType, watcher._encodeFilename(pathModule.basename(base)));
            }
        } else if (fullPath.startsWith(base + '/')) {
            const rel = fullPath.slice(base.length + 1);
            if (!watcher._recursive && rel.includes('/')) continue;
            watcher.emit('change', eventType, watcher._encodeFilename(rel));
        }
    }
}

function _scanDir(dir, entries, recursive) {
    const result = native.fs_readdir(dir, false);
    if (result.error || result.stackOverflow) return;
    for (let i = 0; i < result.entries.length; i++) {
        const name = result.entries[i];
        const fullPath = dir + '/' + name;
        const st = native.fs_stat(fullPath);
        if (!st.error) {
            entries.set(fullPath, st.stat.mtimeMs || 0);
            if (recursive && st.stat.isDirectory) {
                _scanDir(fullPath, entries, true);
            }
        } else {
            entries.set(fullPath, 0);
        }
    }
}

function _snapshotDir(dir, recursive) {
    const entries = new Map();
    _scanDir(dir, entries, recursive);
    return entries;
}

export class FSWatcher {
    constructor() {
        this._listeners = {};
        this._timer = null;
        this._closed = false;
        this._watchPath = null;
        this._recursive = false;
        this._isFile = false;
        this._snapshot = null;
        this._fileMtime = null;
    }

    _start(filename, recursive, encoding, isFile) {
        this._watchPath = pathToString(filename);
        this._recursive = recursive;
        this._encoding = encoding || null;
        this._isFile = !!isFile;
        _activeWatchers.add(this);
        if (globalThis.__wasm_rquickjs_active_handles) globalThis.__wasm_rquickjs_active_handles.add(this);

        if (this._isFile) {
            const st = native.fs_stat(this._watchPath);
            this._fileMtime = (!st.error && st.stat.mtimeMs) || 0;
            this._timer = globalThis.setInterval(() => {
                if (this._closed) return;
                const st = native.fs_stat(this._watchPath);
                if (st.error) {
                    this.emit('change', 'rename', this._encodeFilename(getPathModule().basename(this._watchPath)));
                    return;
                }
                const currentMtime = st.stat.mtimeMs || 0;
                if (currentMtime !== this._fileMtime) {
                    this._fileMtime = currentMtime;
                    this.emit('change', 'change', this._encodeFilename(getPathModule().basename(this._watchPath)));
                }
            }, 200);
        } else {
            this._snapshot = _snapshotDir(this._watchPath, this._recursive);
            this._timer = globalThis.setInterval(() => {
                if (this._closed) return;
                const current = _snapshotDir(this._watchPath, this._recursive);
                const base = this._watchPath;
                for (const [entry] of this._snapshot) {
                    if (!current.has(entry)) {
                        const rel = entry.slice(base.length + 1);
                        this.emit('change', 'rename', this._encodeFilename(rel));
                    }
                }
                for (const [entry, mtime] of current) {
                    const oldMtime = this._snapshot.get(entry);
                    if (oldMtime === undefined) {
                        const rel = entry.slice(base.length + 1);
                        this.emit('change', 'rename', this._encodeFilename(rel));
                    } else if (mtime !== oldMtime) {
                        const rel = entry.slice(base.length + 1);
                        this.emit('change', 'change', this._encodeFilename(rel));
                    }
                }
                this._snapshot = current;
            }, 200);
        }
    }

    _encodeFilename(filename) {
        if (filename === null) return null;
        const enc = this._encoding;
        if (!enc || enc === 'utf8' || enc === 'utf-8') return filename;
        if (enc === 'buffer') return Buffer.from(filename, 'utf8');
        return Buffer.from(filename, 'utf8').toString(enc);
    }

    on(event, listener) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(listener);
        return this;
    }
    addListener(event, listener) {
        return this.on(event, listener);
    }
    once(event, listener) {
        const wrapped = (...args) => {
            this.removeListener(event, wrapped);
            listener(...args);
        };
        return this.on(event, wrapped);
    }
    removeListener(event, listener) {
        const list = this._listeners[event];
        if (list) {
            const idx = list.indexOf(listener);
            if (idx !== -1) list.splice(idx, 1);
        }
        return this;
    }
    emit(event, ...args) {
        const listeners = this._listeners[event] ? this._listeners[event].slice() : [];
        for (const l of listeners) l(...args);
    }
    close() {
        if (this._closed) return;
        this._closed = true;
        _activeWatchers.delete(this);
        if (globalThis.__wasm_rquickjs_active_handles) globalThis.__wasm_rquickjs_active_handles.delete(this);
        if (this._timer !== null) {
            globalThis.clearInterval(this._timer);
            this._timer = null;
        }
        this.emit('close');
    }
    ref() {
        if (this._timer && typeof this._timer.ref === 'function') this._timer.ref();
        return this;
    }
    unref() {
        if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
        return this;
    }
}

const _statWatchers = new Map();

function _zeroStat() {
    return new Stats({
        dev: 0, mode: 0, nlink: 0, uid: 0, gid: 0, rdev: 0,
        blksize: 0, ino: 0, size: 0, blocks: 0,
        atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
        isFile: false, isDirectory: false, isSymlink: false,
    });
}

function _tryStat(filename) {
    const result = native.fs_stat(pathToString(filename));
    if (result.error) {
        return _zeroStat();
    }
    return new Stats(result.stat);
}

export class StatWatcher {
    constructor() {
        this._eventListeners = {};
        this._timer = null;
        this._prev = null;
        this._filename = null;
    }

    start(filename, interval) {
        this._filename = filename;
        this._prev = _tryStat(filename);
        if (globalThis.__wasm_rquickjs_active_handles) globalThis.__wasm_rquickjs_active_handles.add(this);
        this._timer = globalThis.setInterval(() => {
            const curr = _tryStat(filename);
            if (curr.mtimeMs !== this._prev.mtimeMs ||
                curr.size !== this._prev.size ||
                curr.ino !== this._prev.ino ||
                curr.nlink !== this._prev.nlink ||
                curr.mode !== this._prev.mode) {
                const prev = this._prev;
                this._prev = curr;
                this.emit('change', curr, prev);
            }
        }, interval);
    }

    on(event, listener) {
        if (!this._eventListeners[event]) this._eventListeners[event] = [];
        this._eventListeners[event].push(listener);
        return this;
    }

    addListener(event, listener) {
        return this.on(event, listener);
    }

    once(event, listener) {
        const wrapped = (...args) => {
            this.removeListener(event, wrapped);
            listener(...args);
        };
        return this.on(event, wrapped);
    }

    removeListener(event, listener) {
        const list = this._eventListeners[event];
        if (list) {
            const idx = list.indexOf(listener);
            if (idx !== -1) list.splice(idx, 1);
        }
        return this;
    }

    emit(event, ...args) {
        const listeners = this._eventListeners[event] ? this._eventListeners[event].slice() : [];
        for (const l of listeners) l(...args);
    }

    listenerCount(eventName) {
        const list = this._eventListeners[eventName];
        return list ? list.length : 0;
    }

    stop() {
        if (this._timer !== null) {
            globalThis.clearInterval(this._timer);
            this._timer = null;
        }
        if (globalThis.__wasm_rquickjs_active_handles) globalThis.__wasm_rquickjs_active_handles.delete(this);
        process.nextTick(() => this.emit('stop'));
    }

    ref() {
        if (this._timer) this._timer.ref();
        return this;
    }

    unref() {
        if (this._timer) this._timer.unref();
        return this;
    }
}

export function watch(filename, optionsOrListener, listener) {
    validatePath(filename, 'filename');
    if (typeof optionsOrListener === 'function') {
        listener = optionsOrListener;
        optionsOrListener = {};
    }
    const opts = getOptions(optionsOrListener, {});
    if (opts.encoding) validateEncoding(opts.encoding, 'encoding', true);
    if (listener !== undefined) validateCallback(listener);
    if (opts.recursive != null && typeof opts.recursive !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.recursive', 'boolean', opts.recursive);
    }

    const resolvedPath = pathToString(filename);
    const statResult = native.fs_stat(resolvedPath);
    if (statResult.error) {
        statResult.error.syscall = 'watch';
        const err = createSystemError(statResult.error);
        err.filename = resolvedPath;
        throw err;
    }

    const isFile = !statResult.stat.isDirectory;
    const watcher = new FSWatcher();
    if (listener) watcher.on('change', listener);
    watcher._start(filename, !!opts.recursive, opts.encoding, isFile);

    if (opts.persistent === false) {
        watcher.unref();
    }

    if (opts.signal) {
        if (opts.signal.aborted) {
            globalThis.queueMicrotask(() => watcher.close());
        } else {
            opts.signal.addEventListener('abort', () => watcher.close(), { once: true });
        }
    }

    return watcher;
}

export function watchFile(filename, optionsOrListener, listener) {
    validatePath(filename, 'filename');
    filename = pathToString(filename);

    if (typeof optionsOrListener === 'function') {
        listener = optionsOrListener;
        optionsOrListener = {};
    }
    if (typeof listener !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('listener', 'Function', listener);
    }

    const options = optionsOrListener || {};
    const interval = options.interval || 5007;

    let watcher = _statWatchers.get(filename);
    if (!watcher) {
        watcher = new StatWatcher();
        watcher.start(filename, interval);
        _statWatchers.set(filename, watcher);
    }
    watcher.addListener('change', listener);
    return watcher;
}

export function unwatchFile(filename, listener) {
    validatePath(filename, 'filename');
    filename = pathToString(filename);
    const watcher = _statWatchers.get(filename);
    if (!watcher) return;

    if (typeof listener === 'function') {
        watcher.removeListener('change', listener);
    } else {
        watcher._eventListeners['change'] = [];
    }

    if (watcher.listenerCount('change') === 0) {
        watcher.stop();
        _statWatchers.delete(filename);
    }
}

// --- ReadStream / WriteStream ---

let _readStreamProtoInited = false;

export function ReadStream(path, options) {
    if (!(this instanceof ReadStream)) return new ReadStream(path, options);

    if (options !== undefined && options !== null && typeof options !== 'object' && typeof options !== 'string') {
        const err = new TypeError('The "options" argument must be of type object or string. Received ' + describeType(options));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    if (typeof options === 'string') options = { encoding: options };
    if (options && options.encoding) validateEncoding(options.encoding, 'encoding');
    const opts = {};
    if (options) {
        for (const k in options) opts[k] = options[k];
    }

    if (!_readStreamProtoInited) {
        getStreamClasses();
        Object.setPrototypeOf(ReadStream.prototype, _Readable.prototype);
        Object.setPrototypeOf(ReadStream, _Readable);
        _readStreamProtoInited = true;
    }

    if (opts.fd != null && typeof opts.fd !== 'number' &&
        !(typeof opts.fd === 'object' && typeof opts.fd.fd === 'number')) {
        const err = new TypeError(
            'The "options.fd" property must be of type number or an instance of FileHandle. Received ' + describeType(opts.fd)
        );
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    this.fd = (opts.fd !== undefined && typeof opts.fd === 'number') ? opts.fd
            : (opts.fd !== undefined && opts.fd !== null && typeof opts.fd === 'object' && typeof opts.fd.fd === 'number') ? opts.fd.fd
            : null;
    this._fileHandle = (opts.fd !== undefined && opts.fd !== null && typeof opts.fd === 'object' && typeof opts.fd.fd === 'number') ? opts.fd : null;

    this.path = (this.fd != null && (path == null || path === undefined)) ? undefined : path;
    this.flags = opts.flags || 'r';
    this.mode = opts.mode || 0o666;

    if (this.path !== undefined) {
        validatePath(this.path);
    }

    if (opts.highWaterMark === undefined) opts.highWaterMark = 64 * 1024;
    opts.autoDestroy = opts.autoClose !== undefined ? opts.autoClose : true;
    opts.emitClose = opts.emitClose !== undefined ? opts.emitClose : true;

    this.start = opts.start;
    this.end = opts.end !== undefined ? opts.end : Infinity;
    this.pos = undefined;

    if (this.start !== undefined) {
        if (typeof this.start !== 'number') {
            const err = new TypeError('The "start" argument must be of type number. Received ' + describeType(this.start));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (!Number.isInteger(this.start) || !Number.isSafeInteger(this.start)) {
            const err = new RangeError(`The value of "start" is out of range. It must be an integer. Received ${this.start}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        if (this.start < 0) {
            const err = new RangeError(`The value of "start" is out of range. It must be >= 0. Received ${this.start}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        this.pos = this.start;
    }

    if (this.end !== Infinity) {
        if (typeof this.end !== 'number') {
            const err = new TypeError('The "end" argument must be of type number. Received ' + describeType(this.end));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (!Number.isInteger(this.end) || !Number.isSafeInteger(this.end)) {
            const err = new RangeError(`The value of "end" is out of range. It must be an integer. Received ${this.end}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
        if (this.end < 0) {
            const err = new RangeError(`The value of "end" is out of range. It must be >= 0. Received ${this.end}`);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
    }

    if (this.start !== undefined && this.start > this.end) {
        const err = new RangeError(`The value of "start" is out of range. It must be <= "end" (here: ${this.end}). Received ${this.start}`);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
    }

    this.bytesRead = 0;
    this._fs = opts.fs || _default;

    if (opts.fs) {
        const fsRequired = ['open', 'close', 'read'];
        for (const fn of fsRequired) {
            if (typeof this._fs[fn] !== 'function') {
                const err = new TypeError(
                    `The "options.fs.${fn}" property must be of type function. Received ${describeType(this._fs[fn])}`
                );
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
    }

    this._fileHandleTransferRef = false;

    if (this._fileHandle && opts.fs) {
        const err = new Error('The FileHandle with fs method is not implemented');
        err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
        err.name = 'Error';
        throw err;
    }

    _Readable.call(this, opts);

    if (this._fileHandle) {
        retainFileHandleForTransfer(this._fileHandle);
        this._fileHandleTransferRef = true;
    }

    // When a FileHandle is passed, listen for its 'close' event so that
    // closing the handle externally also destroys the stream (Node.js compat).
    if (this._fileHandle && typeof this._fileHandle.on === 'function') {
        const self = this;
        this._fileHandle.on('close', function onHandleClose() {
            if (!self.destroyed) self.destroy();
        });
    }
}

ReadStream.prototype._construct = function(callback) {
    if (typeof this.fd === 'number') {
        callback();
        this.emit('open', this.fd);
        this.emit('ready');
        return;
    }
    if (typeof this.open === 'function' && this.open !== _openReadFs) {
        // Backwards compat for monkey patching open().
        // Use an emit shim so errors go through the stream infrastructure
        // (via callback(err)) and are emitted exactly once by emitErrorNT.
        const orgEmit = this.emit;
        const self = this;
        this.emit = function() {
            if (arguments[0] === 'open') {
                self.emit = orgEmit;
                callback();
                orgEmit.apply(self, arguments);
            } else if (arguments[0] === 'error') {
                self.emit = orgEmit;
                callback(arguments[1]);
            } else {
                orgEmit.apply(self, arguments);
            }
        };
        this.open();
        return;
    }
    const self = this;
    this._fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
            callback(err);
        } else {
            self.fd = fd;
            callback();
            self.emit('open', fd);
            self.emit('ready');
        }
    });
};

ReadStream.prototype.open = function() {
    const self = this;
    this._fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
            if (self.autoClose) self.destroy();
            self.emit('error', err);
        } else {
            self.fd = fd;
            self.emit('open', fd);
            self.emit('ready');
        }
    });
};

const _openReadFs = ReadStream.prototype.open;

ReadStream.prototype._read = function(n) {
    if (this.destroyed || this._readableState.errored) return;
    let toRead = n;
    if (this.end !== Infinity) {
        const cur = this.pos !== undefined ? this.pos : this.bytesRead;
        const remaining = this.end - cur + 1;
        if (remaining <= 0) { this.push(null); return; }
        toRead = Math.min(toRead, remaining);
    }
    if (toRead <= 0) { this.push(null); return; }

    const buf = getBuffer().alloc(toRead);
    const self = this;

    if (this._fileHandle) {
        this._fileHandle.read(buf, 0, toRead, this.pos).then(function(result) {
            if (self.destroyed) return;
            const bytesRead = result.bytesRead;
            if (bytesRead > 0) {
                if (self.pos !== undefined) self.pos += bytesRead;
                self.bytesRead += bytesRead;
                self.push(bytesRead !== toRead ? result.buffer.slice(0, bytesRead) : result.buffer);
            } else {
                self.push(null);
            }
        }, function(err) {
            if (self.destroyed) return;
            if (self.autoClose) {
                self.destroy(err);
            } else {
                self.emit('error', err);
            }
        });
        return;
    }

    this._fs.read(this.fd, buf, 0, toRead, this.pos, function(err, bytesRead, buffer) {
        if (self.destroyed) return;
        if (err) {
            if (self.autoClose) {
                self.destroy(err);
            } else {
                self.emit('error', err);
            }
        } else if (bytesRead > 0) {
            if (self.pos !== undefined) self.pos += bytesRead;
            self.bytesRead += bytesRead;
            self.push(bytesRead !== toRead ? buffer.slice(0, bytesRead) : buffer);
        } else {
            self.push(null);
        }
    });
};

ReadStream.prototype._destroy = function(err, cb) {
    if (this.fd === null) { cb(err); return; }
    if (this._fileHandle) {
        if (this._fileHandleTransferRef) {
            releaseFileHandleForTransfer(this._fileHandle);
            this._fileHandleTransferRef = false;
        }

        this.fd = null;
        if (this._fileHandle._closed) {
            cb(err);
        } else {
            this._fileHandle.close().then(() => cb(err), (er) => cb(er || err));
        }
        return;
    }
    const fd = this.fd;
    this.fd = null;
    this._fs.close(fd, function(er) {
        cb(er || err);
    });
};

ReadStream.prototype.close = function(cb) {
    if (typeof cb === 'function') {
        const stream = require('node:stream');
        if (stream.finished) {
            stream.finished(this, cb);
        } else {
            this.once('close', cb);
        }
    }
    this.destroy();
};

Object.defineProperty(ReadStream.prototype, 'autoClose', {
    get() { return this._readableState ? this._readableState.autoDestroy : true; },
    set(val) { if (this._readableState) this._readableState.autoDestroy = val; }
});

Object.defineProperty(ReadStream.prototype, 'pending', {
    get() { return this.fd === null; },
    configurable: true
});

Object.defineProperty(ReadStream.prototype, 'closed', {
    get() { return this._readableState ? this._readableState.closed : false; },
    configurable: true
});

// --- WriteStream ---

let _writeStreamProtoInited = false;

export function WriteStream(path, options) {
    if (!(this instanceof WriteStream)) return new WriteStream(path, options);

    if (options !== undefined && options !== null && typeof options !== 'object' && typeof options !== 'string') {
        const err = new TypeError('The "options" argument must be of type object or string. Received ' + describeType(options));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    if (typeof options === 'string') options = { encoding: options };
    if (options && options.encoding) validateEncoding(options.encoding, 'encoding');
    const opts = {};
    if (options) {
        for (const k in options) opts[k] = options[k];
    }

    if (!_writeStreamProtoInited) {
        getStreamClasses();
        Object.setPrototypeOf(WriteStream.prototype, _Writable.prototype);
        Object.setPrototypeOf(WriteStream, _Writable);
        _writeStreamProtoInited = true;
    }

    if (opts.fd != null && typeof opts.fd !== 'number' &&
        !(typeof opts.fd === 'object' && typeof opts.fd.fd === 'number')) {
        const err = new TypeError(
            'The "options.fd" property must be of type number or an instance of FileHandle. Received ' + describeType(opts.fd)
        );
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }

    this.fd = (opts.fd !== undefined && typeof opts.fd === 'number') ? opts.fd
            : (opts.fd !== undefined && opts.fd !== null && typeof opts.fd === 'object' && typeof opts.fd.fd === 'number') ? opts.fd.fd
            : null;
    this._fileHandle = (opts.fd !== undefined && opts.fd !== null && typeof opts.fd === 'object' && typeof opts.fd.fd === 'number') ? opts.fd : null;
    this.path = (this.fd != null && (path == null || path === undefined)) ? undefined : path;
    this.flags = opts.flags || 'w';
    this.mode = opts.mode || 0o666;

    if (this.path !== undefined) {
        validatePath(this.path);
    }

    opts.autoDestroy = opts.autoClose !== undefined ? opts.autoClose : true;
    opts.emitClose = opts.emitClose !== undefined ? opts.emitClose : true;

    this.start = opts.start;
    this.pos = undefined;

    if (this.start !== undefined) {
        if (typeof this.start !== 'number' || !Number.isInteger(this.start)) {
            const err = new TypeError('The "start" argument must be of type number. Received ' + describeType(this.start));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (this.start < 0 || this.start > Number.MAX_SAFE_INTEGER) {
            throw new ERR_OUT_OF_RANGE('start', `>= 0 && <= ${Number.MAX_SAFE_INTEGER}`, this.start);
        }
        this.pos = this.start;
    }

    this.bytesWritten = 0;
    this._flush = opts.flush === true;
    validateFlush(opts.flush);
    opts.decodeStrings = true;
    this._fs = opts.fs || _default;

    if (opts.fs) {
        const fsRequired = ['open', 'close', 'write'];
        for (const fn of fsRequired) {
            if (typeof this._fs[fn] !== 'function') {
                const err = new TypeError(
                    `The "options.fs.${fn}" property must be of type function. Received ${describeType(this._fs[fn])}`
                );
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
        if (this._fs.writev !== undefined && this._fs.writev !== null && typeof this._fs.writev !== 'function') {
            const err = new TypeError(
                `The "options.fs.writev" property must be of type function. Received ${describeType(this._fs.writev)}`
            );
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }

    this._fileHandleTransferRef = false;

    _Writable.call(this, opts);

    if (this._fileHandle) {
        retainFileHandleForTransfer(this._fileHandle);
        this._fileHandleTransferRef = true;
    }

    if (this._fileHandle && typeof this._fileHandle.on === 'function') {
        const self = this;
        this._fileHandle.on('close', function onHandleClose() {
            if (!self.destroyed) self.destroy();
        });
    }
}

WriteStream.prototype._construct = function(callback) {
    if (typeof this.fd === 'number') {
        callback();
        this.emit('open', this.fd);
        this.emit('ready');
        return;
    }
    if (typeof this.open === 'function' && this.open !== _openWriteFs) {
        const orgEmit = this.emit;
        const self = this;
        this.emit = function() {
            if (arguments[0] === 'open') {
                self.emit = orgEmit;
                callback();
                orgEmit.apply(self, arguments);
            } else if (arguments[0] === 'error') {
                self.emit = orgEmit;
                callback(arguments[1]);
            } else {
                orgEmit.apply(self, arguments);
            }
        };
        this.open();
        return;
    }
    const self = this;
    this._fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
            callback(err);
        } else {
            self.fd = fd;
            callback();
            self.emit('open', fd);
            self.emit('ready');
        }
    });
};

WriteStream.prototype.open = function() {
    const self = this;
    this._fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
            if (self.autoClose) self.destroy();
            self.emit('error', err);
        } else {
            self.fd = fd;
            self.emit('open', fd);
            self.emit('ready');
        }
    });
};

const _openWriteFs = WriteStream.prototype.open;

WriteStream.prototype._write = function(chunk, encoding, cb) {
    const self = this;
    this._fs.write(this.fd, chunk, 0, chunk.length, this.pos, function(err, bytesWritten) {
        if (err) {
            if (self.autoClose) self.destroy();
            cb(err);
            return;
        }
        self.bytesWritten += bytesWritten;
        cb();
    });
    if (this.pos !== undefined) this.pos += chunk.length;
};

WriteStream.prototype._writev = function(data, cb) {
    const buffers = [];
    let size = 0;
    for (let i = 0; i < data.length; i++) {
        buffers.push(data[i].chunk);
        size += data[i].chunk.length;
    }
    const self = this;
    this._fs.writev(this.fd, buffers, this.pos, function(err, bytesWritten) {
        if (err) {
            if (self.autoClose) self.destroy();
            cb(err);
            return;
        }
        self.bytesWritten += bytesWritten;
        cb();
    });
    if (this.pos !== undefined) this.pos += size;
};

WriteStream.prototype._destroy = function(err, cb) {
    if (this.fd === null) { cb(err); return; }
    if (this._fileHandle) {
        if (this._fileHandleTransferRef) {
            releaseFileHandleForTransfer(this._fileHandle);
            this._fileHandleTransferRef = false;
        }

        this.fd = null;
        if (this._fileHandle._closed) {
            cb(err);
        } else {
            this._fileHandle.close().then(() => cb(err), (er) => cb(er || err));
        }
        return;
    }
    const fd = this.fd;
    this.fd = null;
    this._fs.close(fd, function(er) {
        cb(er || err);
    });
};

WriteStream.prototype._final = function(cb) {
    if (this._flush && this.fd !== null) {
        this._fs.fsync(this.fd, function(err) { cb(err); });
    } else {
        cb();
    }
};

WriteStream.prototype.close = function(cb) {
    if (typeof cb === 'function') {
        const stream = require('node:stream');
        if (this.closed) {
            queueMicrotask(cb);
            return;
        }
        if (stream.finished) {
            stream.finished(this, cb);
        } else {
            this.once('close', cb);
        }
    }
    if (!this.autoClose) {
        this.on('finish', this.destroy.bind(this));
    }
    this.end();
};

Object.defineProperty(WriteStream.prototype, 'autoClose', {
    get() { return this._writableState ? this._writableState.autoDestroy : true; },
    set(val) { if (this._writableState) this._writableState.autoDestroy = val; }
});

Object.defineProperty(WriteStream.prototype, 'pending', {
    get() { return this.fd === null; },
    configurable: true
});

Object.defineProperty(WriteStream.prototype, 'closed', {
    get() { return this._writableState ? this._writableState.closed : false; },
    configurable: true
});

export function createReadStream(path, options) {
    return new ReadStream(path, options);
}

export function createWriteStream(path, options) {
    return new WriteStream(path, options);
}

// --- readv/writev stubs ---

export function readv(fd, buffers, positionOrCallback, callback) {
    validateFd(fd);
    let position = null;
    let cb;
    if (typeof positionOrCallback === 'function') {
        cb = positionOrCallback;
    } else {
        position = positionOrCallback;
        cb = callback;
    }
    if (!Array.isArray(buffers)) {
        const err = new TypeError('The "buffers" argument must be an instance of Array. Received ' + describeType(buffers));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    for (const buf of buffers) {
        if (!ArrayBuffer.isView(buf)) {
            const err = new TypeError('The "buffers[n]" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + describeType(buf));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            let totalRead = 0;
            for (const buf of buffers) {
                if (buf.byteLength === 0) continue;
                const bytesRead = readSync(fd, buf, 0, buf.byteLength, position);
                totalRead += bytesRead;
                if (position !== null) position += bytesRead;
                if (bytesRead < buf.byteLength) break;
            }
            cb(null, totalRead, buffers);
        } catch (err) {
            cb(err, 0, buffers);
        }
    });
}

export function writev(fd, buffers, positionOrCallback, callback) {
    validateFd(fd);
    let position = null;
    let cb;
    if (typeof positionOrCallback === 'function') {
        cb = positionOrCallback;
    } else {
        position = positionOrCallback != null ? positionOrCallback : null;
        cb = callback;
    }
    if (!Array.isArray(buffers)) {
        const err = new TypeError('The "buffers" argument must be an instance of Array. Received ' + describeType(buffers));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    for (const buf of buffers) {
        if (!ArrayBuffer.isView(buf)) {
            const err = new TypeError('The "buffers[n]" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + describeType(buf));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            let totalWritten = 0;
            for (const buf of buffers) {
                const written = writeSync(fd, buf, 0, buf.byteLength, position);
                totalWritten += written;
                if (position !== null) position += written;
            }
            cb(null, totalWritten, buffers);
        } catch (err) {
            cb(err, 0, buffers);
        }
    });
}

export function readvSync(fd, buffers, position) {
    validateFd(fd);
    if (!Array.isArray(buffers)) {
        const err = new TypeError('The "buffers" argument must be an instance of Array. Received ' + describeType(buffers));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    for (const buf of buffers) {
        if (!ArrayBuffer.isView(buf)) {
            const err = new TypeError('The "buffers[n]" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + describeType(buf));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }
    let totalRead = 0;
    let pos = position !== undefined ? position : null;
    for (const buf of buffers) {
        if (buf.byteLength === 0) continue;
        const bytesRead = readSync(fd, buf, 0, buf.byteLength, pos);
        totalRead += bytesRead;
        if (pos !== null) pos += bytesRead;
        if (bytesRead < buf.byteLength) break;
    }
    return totalRead;
}

export function writevSync(fd, buffers, position) {
    validateFd(fd);
    if (!Array.isArray(buffers)) {
        const err = new TypeError('The "buffers" argument must be an instance of Array. Received ' + describeType(buffers));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    for (const buf of buffers) {
        if (!ArrayBuffer.isView(buf)) {
            const err = new TypeError('The "buffers[n]" argument must be an instance of Buffer, TypedArray, or DataView. Received ' + describeType(buf));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }
    let totalWritten = 0;
    let pos = position !== undefined ? position : null;
    for (const buf of buffers) {
        const written = writeSync(fd, buf, 0, buf.byteLength, pos);
        totalWritten += written;
        if (pos !== null) pos += written;
    }
    return totalWritten;
}

// --- cp stub ---

export function cpSync(src, dest, options) {
    const recursive = options && options.recursive;
    const srcStat = statSync(src);
    if (srcStat.isDirectory()) {
        mkdirSync(dest, { recursive: true });
        if (recursive) {
            const entries = readdirSync(src, { withFileTypes: true });
            for (const entry of entries) {
                const srcPath = src + '/' + entry.name;
                const destPath = dest + '/' + entry.name;
                if (entry.isDirectory()) {
                    cpSync(srcPath, destPath, options);
                } else {
                    copyFileSync(srcPath, destPath);
                }
            }
        }
    } else {
        copyFileSync(src, dest);
    }
}

export function cp(src, dest, optionsOrCallback, callback) {
    if (typeof optionsOrCallback === 'function') {
        callback = optionsOrCallback;
        optionsOrCallback = {};
    }
    const cb = callback;
    validateCallback(cb);
    queueMicrotask(() => {
        try {
            cpSync(src, dest, optionsOrCallback);
            cb(null);
        } catch (err) {
            cb(err);
        }
    });
}

// --- util.promisify support ---

const kCustomPromisifyArgsSymbol = Symbol.for('nodejs.util.promisify.customArgs');
const kCustomPromisifiedSymbol = Symbol.for('nodejs.util.promisify.custom');

Object.defineProperty(read, kCustomPromisifyArgsSymbol, {
    value: ['bytesRead', 'buffer'], enumerable: false
});
Object.defineProperty(write, kCustomPromisifyArgsSymbol, {
    value: ['bytesWritten', 'buffer'], enumerable: false
});
Object.defineProperty(readv, kCustomPromisifyArgsSymbol, {
    value: ['bytesRead', 'buffers'], enumerable: false
});
Object.defineProperty(writev, kCustomPromisifyArgsSymbol, {
    value: ['bytesWritten', 'buffer'], enumerable: false
});
Object.defineProperty(exists, kCustomPromisifiedSymbol, {
    value: function existsPromisified(path) {
        return new Promise((resolve) => exists(path, resolve));
    }
});

// --- openAsBlob ---

const _kFileBackedBlob = Symbol.for('kFileBackedBlob');

function _createFileBackedStream(readFn, validateFn, chunkSize) {
    let data = null;
    let offset = 0;
    return new globalThis.ReadableStream({
        pull(ctrl) {
            try {
                validateFn();
            } catch (e) {
                ctrl.error(e);
                return;
            }
            if (data === null) {
                data = readFn();
            }
            if (offset >= data.byteLength) {
                ctrl.close();
                return;
            }
            const end = Math.min(offset + chunkSize, data.byteLength);
            ctrl.enqueue(data.slice(offset, end));
            offset = end;
            if (offset >= data.byteLength) {
                ctrl.close();
            }
        }
    });
}

function _createNotReadableError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.', 'NotReadableError');
    }
    const err = new Error('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.');
    err.name = 'NotReadableError';
    return err;
}

class FileBackedBlob {
    constructor(path, size, mtimeMs) {
        this._path = path;
        this._size = size;
        this._mtimeMs = mtimeMs;
        this[_kFileBackedBlob] = true;
    }

    _validate() {
        const st = statSync(this._path);
        if (st.size !== this._size || st.mtimeMs !== this._mtimeMs) {
            throw _createNotReadableError();
        }
    }

    _readData() {
        this._validate();
        return readFileSync(this._path);
    }

    get size() {
        return this._size;
    }

    get type() {
        return '';
    }

    async text() {
        this._validate();
        return readFileSync(this._path, 'utf8');
    }

    async arrayBuffer() {
        const data = this._readData();
        const u8 = (data instanceof Uint8Array) ? data : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    }

    stream() {
        const self = this;
        const CHUNK_SIZE = 65536;
        return _createFileBackedStream(() => {
            const raw = readFileSync(self._path);
            return (raw instanceof Uint8Array) ? raw : new Uint8Array(raw.buffer || raw, raw.byteOffset || 0, raw.byteLength || raw.length);
        }, () => self._validate(), CHUNK_SIZE);
    }

    slice(start, end, type) {
        const size = this._size;
        if (start === undefined) start = 0;
        if (end === undefined) end = size;
        let relativeStart = start < 0 ? Math.max(size + start, 0) : Math.min(start, size);
        let relativeEnd = end < 0 ? Math.max(size + end, 0) : Math.min(end, size);
        const span = Math.max(relativeEnd - relativeStart, 0);
        return new FileBackedBlobSlice(this, relativeStart, span);
    }

    get [Symbol.toStringTag]() {
        return 'Blob';
    }
}

class FileBackedBlobSlice {
    constructor(parent, offset, length) {
        this._parent = parent;
        this._offset = offset;
        this._size = length;
        this[_kFileBackedBlob] = true;
    }

    get size() {
        return this._size;
    }

    get type() {
        return '';
    }

    _readSliceData() {
        const data = readFileSync(this._parent._path);
        const u8 = (data instanceof Uint8Array) ? data : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
        return u8.slice(this._offset, this._offset + this._size);
    }

    _readSlice() {
        this._parent._validate();
        return this._readSliceData();
    }

    async text() {
        const slice = this._readSlice();
        return new TextDecoder().decode(slice);
    }

    async arrayBuffer() {
        const slice = this._readSlice();
        return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
    }

    stream() {
        const self = this;
        return _createFileBackedStream(() => self._readSliceData(), () => self._parent._validate(), 65536);
    }

    slice(start, end, type) {
        const size = this._size;
        if (start === undefined) start = 0;
        if (end === undefined) end = size;
        let relativeStart = start < 0 ? Math.max(size + start, 0) : Math.min(start, size);
        let relativeEnd = end < 0 ? Math.max(size + end, 0) : Math.min(end, size);
        const span = Math.max(relativeEnd - relativeStart, 0);
        return new FileBackedBlobSlice(this._parent, this._offset + relativeStart, span);
    }

    get [Symbol.toStringTag]() {
        return 'Blob';
    }
}

export async function openAsBlob(path, options) {
    validatePath(path);
    const st = statSync(path);
    return new FileBackedBlob(pathToString(path), st.size, st.mtimeMs);
}

// Expose the symbol for structuredClone integration
export { _kFileBackedBlob };

// Named re-export so `import { promises } from 'node:fs'` works.
// We cannot call getPromises() at module evaluation time because `require` is
// not yet available, so we export a proxy object that lazily delegates.
export const promises = new Proxy({}, {
    get(_, prop) { return getPromises()[prop]; },
    set(_, prop, value) { getPromises()[prop] = value; return true; },
    has(_, prop) { return prop in getPromises(); },
    ownKeys() { return Reflect.ownKeys(getPromises()); },
    getOwnPropertyDescriptor(_, prop) { return Object.getOwnPropertyDescriptor(getPromises(), prop); },
});

// --- Internal helpers ---

function _toUnixTimestamp(time, name = 'time') {
    if (typeof time === 'string' && +time == time) {
        return +time;
    }
    if (Number.isFinite(time)) {
        if (time < 0) {
            return Date.now() / 1000;
        }
        return time;
    }
    if (time instanceof Date) {
        return time.getTime() / 1000;
    }
    throw new ERR_INVALID_ARG_TYPE(name, ['Date', 'Time in seconds'], time);
}

// --- Default export ---

const _default = {
    constants,
    Stats,
    Dirent,
    Dir,
    FSWatcher,
    StatWatcher,
    ReadStream,
    WriteStream,
    get promises() { return getPromises(); },
    // Sync functions
    readFileSync,
    writeFileSync,
    appendFileSync,
    openSync,
    closeSync,
    readSync,
    writeSync,
    ftruncateSync,
    fsyncSync,
    fdatasyncSync,
    statSync,
    lstatSync,
    fstatSync,
    statfsSync,
    readdirSync,
    accessSync,
    existsSync,
    realpathSync,
    truncateSync,
    copyFileSync,
    linkSync,
    symlinkSync,
    readlinkSync,
    chmodSync,
    fchmodSync,
    lchmodSync: HAS_LCHMOD ? lchmodSync : undefined,
    chownSync,
    fchownSync,
    lchownSync,
    utimesSync,
    futimesSync,
    lutimesSync,
    unlinkSync,
    renameSync,
    mkdirSync,
    rmdirSync,
    rmSync,
    mkdtempSync,
    opendirSync,
    readvSync,
    writevSync,
    cpSync,
    // Async functions
    readFile,
    writeFile,
    appendFile,
    open,
    close,
    read,
    write,
    stat,
    lstat,
    fstat,
    statfs,
    ftruncate,
    fsync,
    fdatasync,
    readdir,
    access,
    exists,
    realpath,
    truncate,
    copyFile,
    link,
    symlink,
    readlink,
    chmod,
    fchmod,
    lchmod: HAS_LCHMOD ? lchmod : undefined,
    chown,
    fchown,
    lchown,
    utimes,
    futimes,
    lutimes,
    unlink,
    rename,
    mkdir,
    rmdir,
    rm,
    mkdtemp,
    opendir,
    watch,
    watchFile,
    unwatchFile,
    createReadStream,
    createWriteStream,
    readv,
    writev,
    cp,
    openAsBlob,
    _toUnixTimestamp,
};

export default _default;
