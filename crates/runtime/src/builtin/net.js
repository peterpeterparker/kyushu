import Duplex from '__wasm_rquickjs_builtin/internal/streams/duplex';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import dns from 'node:dns';
import fs from 'node:fs';
import pathModule from 'node:path';
import { create_tcp_socket, create_tcp_listener } from '__wasm_rquickjs_builtin/net_native';
import {
    AbortError,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_MISSING_ARGS,
    ERR_OUT_OF_RANGE,
    ERR_SOCKET_BAD_PORT,
} from '__wasm_rquickjs_builtin/internal/errors';
import { validateAbortSignal } from '__wasm_rquickjs_builtin/internal/validators';

const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');
const structuredCloneSymbol = Symbol.for('__wasm_rquickjs.structuredClone');

// --- IP address utilities ---

const v4Seg = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
const IPv4Reg = new RegExp(`^${v4Str}$`);

const v6Seg = '(?:[0-9a-fA-F]{1,4})';
const IPv6Reg = new RegExp('^(?:' +
  `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
  `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
  `(?:${v6Seg}:){5}(?::${v4Str}|(?::${v6Seg}){1,2}|:)|` +
  `(?:${v6Seg}:){4}(?:(?::${v6Seg}){0,1}:${v4Str}|(?::${v6Seg}){1,3}|:)|` +
  `(?:${v6Seg}:){3}(?:(?::${v6Seg}){0,2}:${v4Str}|(?::${v6Seg}){1,4}|:)|` +
  `(?:${v6Seg}:){2}(?:(?::${v6Seg}){0,3}:${v4Str}|(?::${v6Seg}){1,5}|:)|` +
  `(?:${v6Seg}:){1}(?:(?::${v6Seg}){0,4}:${v4Str}|(?::${v6Seg}){1,6}|:)|` +
  `(?::(?:(?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
')(?:%[0-9a-zA-Z-.:]{1,})?$');

export function isIPv4(input) {
    return IPv4Reg.test(input);
}

export function isIPv6(input) {
    return IPv6Reg.test(input);
}

export function isIP(input) {
    if (isIPv4(input)) return 4;
    if (isIPv6(input)) return 6;
    return 0;
}

// --- Helpers ---

const errnoMap = {
    ENOSYS: -38,
    EBADF: -9,
    EINVAL: -22,
    EADDRINUSE: -48,
    EADDRNOTAVAIL: -49,
    EACCES: -13,
    EHOSTUNREACH: -65,
    ECONNREFUSED: -61,
    ECONNRESET: -54,
    ECONNABORTED: -53,
    ETIMEDOUT: -60,
    EPIPE: -32,
    ENOTCONN: -57,
    EMFILE: -24,
    EIO: -5,
};

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

function parseNativeError(e) {
    try {
        const parsed = JSON.parse(e.message);
        const err = new Error(parsed.message || `${parsed.syscall} ${parsed.code}`);
        err.code = parsed.code;
        if (parsed.syscall) err.syscall = parsed.syscall;
        if (parsed.code) err.errno = errnoMap[parsed.code] || 0;
        return err;
    } catch (_) {
        return e;
    }
}

function nextTick(fn, ...args) {
    const processObject = globalThis.process;
    if (processObject && typeof processObject.nextTick === 'function') {
        processObject.nextTick(fn, ...args);
        return;
    }
    Promise.resolve().then(() => fn(...args));
}

function deferred(fn) {
    if (typeof globalThis.setImmediate === 'function') {
        globalThis.setImmediate(fn);
    } else {
        nextTick(fn);
    }
}

function createHandleWrap() {
    return {
        setKeepAlive() {},
        set_keep_alive() {},
        set_no_delay() {},
        close() {},
    };
}

function forwardNativeHandle(wrap, handle) {
    wrap.read = handle.read.bind(handle);
    wrap.write = handle.write.bind(handle);
    wrap.shutdown = handle.shutdown.bind(handle);
    wrap.close = handle.close.bind(handle);
    wrap.remote_address = handle.remote_address.bind(handle);
    wrap.local_address = handle.local_address.bind(handle);
    wrap.set_no_delay = handle.set_no_delay.bind(handle);
    wrap.set_keep_alive = handle.set_keep_alive.bind(handle);
}

// IPC path → TCP loopback mapping for in-process Unix socket emulation
const _ipcListeners = {};

function isIPAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)) return true;
    if (addr.indexOf(':') !== -1) return true;
    return false;
}

function ipv4ToNum(ip) {
    const parts = ip.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseIPv4(ip) {
    if (!isIPv4(ip)) return null;
    return BigInt(ipv4ToNum(ip));
}

function parseIPv6(ip) {
    if (!isIPv6(ip)) return null;
    const zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

    let ipv4Tail = null;
    const lastColon = ip.lastIndexOf(':');
    const tail = lastColon === -1 ? ip : ip.slice(lastColon + 1);
    if (tail.includes('.')) {
        ipv4Tail = parseIPv4(tail);
        if (ipv4Tail === null) return null;
        ip = `${ip.slice(0, lastColon)}:${Number((ipv4Tail >> 16n) & 0xffffn).toString(16)}:${Number(ipv4Tail & 0xffffn).toString(16)}`;
    }

    const parts = ip.split('::');
    if (parts.length > 2) return null;

    const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0 || (parts.length === 1 && missing !== 0)) return null;

    const groups = [...left, ...new Array(parts.length === 2 ? missing : 0).fill('0'), ...right];
    if (groups.length !== 8) return null;

    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        value = (value << 16n) + BigInt(parseInt(group, 16));
    }
    return value;
}

function mappedIPv4FromIPv6(value) {
    return (value >> 32n) === 0xffffn ? value & 0xffffffffn : null;
}

function normalizeBlockListFamily(family, allowUndefined = true) {
    if (family === undefined && allowUndefined) return undefined;
    if (typeof family !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('type', 'string', family);
    }
    const lower = family.toLowerCase();
    if (lower === 'ipv4') return 'ipv4';
    if (lower === 'ipv6') return 'ipv6';
    throw new ERR_INVALID_ARG_VALUE('type', family);
}

function familyLabel(family) {
    return family === 'ipv6' ? 'IPv6' : 'IPv4';
}

function normalizeSocketAddressLike(value, name) {
    if (value instanceof SocketAddress || (value && typeof value === 'object' && value.address)) {
        return { address: value.address, family: value.family };
    }
    if (typeof value !== 'string') {
        throw new ERR_INVALID_ARG_TYPE(name, ['string', 'SocketAddress'], value);
    }
    return { address: value, family: undefined };
}

function parseBlockListAddress(address, family) {
    const requestedFamily = normalizeBlockListFamily(family);
    const inferredFamily = requestedFamily || 'ipv4';
    const value = inferredFamily === 'ipv6' ? parseIPv6(address) : parseIPv4(address);
    if (value === null) {
        throw new ERR_INVALID_ARG_VALUE('address', address);
    }

    const mapped4 = inferredFamily === 'ipv6' ? mappedIPv4FromIPv6(value) : null;
    return {
        address,
        family: inferredFamily,
        value,
        mapped4: mapped4 !== null ? mapped4 : (inferredFamily === 'ipv4' ? value : null),
    };
}

function subnetMask(bits, prefix) {
    if (prefix === 0) return 0n;
    return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

function validatePrefix(prefix, family) {
    if (typeof prefix !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('prefix', 'number', prefix);
    }
    const max = family === 'ipv6' ? 128 : 32;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
        throw new ERR_OUT_OF_RANGE('prefix', `>= 0 && <= ${max}`, prefix);
    }
}

// --- Socket (extends Duplex) ---

function Socket(options) {
    if (!(this instanceof Socket)) return new Socket(options);

    if (typeof options === 'number') {
        options = { fd: options };
    }
    options = options || {};
    this._creationOptions = options;

    // Validate the abort signal early (before any stream wiring) so that
    // a bad signal raises the same TypeError Node.js raises on construction.
    if (options.signal !== undefined) {
        validateAbortSignal(options.signal, 'options.signal');
    }

    // Strip Socket-specific options (notably `signal`) before forwarding to
    // Duplex: otherwise Duplex's readable+writable each register their own
    // abort listener on `signal` via addAbortSignalNoValidate, which both
    // inflates the visible listener count (breaking Node-compat for
    // `getEventListeners(signal, 'abort')`) and runs destroy() twice on
    // abort. Socket owns the abort signal lifecycle itself.
    const streamOptions = {
        ...options,
        allowHalfOpen: options.allowHalfOpen !== undefined ? options.allowHalfOpen : false,
        autoDestroy: true,
    };
    delete streamOptions.signal;

    Duplex.call(this, streamOptions);

    this._handle = null;
    this._connectingHandle = null;
    this._reading = false;
    this._readToken = 0;
    this._readInFlight = false;
    this._netPaused = false;
    this._pendingReadChunks = [];
    this._abortSignal = null;
    this._abortHandler = null;
    this.connecting = false;
    this._timeout = null;
    this._timeoutValue = 0;
    this.bytesRead = 0;
    this._bytesDispatched = 0;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.remoteFamily = undefined;
    this.localAddress = undefined;
    this.localPort = undefined;
    this.localFamily = undefined;
    this._family = options.family ?? 4;
    this._hadError = false;

    // Shut down the socket when we're finished with it.
    this.on('end', onReadableStreamEnd);
    this._setupAbortSignal(options.signal);
}

function onReadableStreamEnd() {
    if (!this.allowHalfOpen) {
        this.write = writeAfterFIN;
    }
}

function writeAfterFIN(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
        cb = encoding;
        encoding = null;
    }
    const er = makeError('EPIPE', 'This socket has been ended by the other party');
    if (typeof cb === 'function') {
        nextTick(cb, er);
    }
    this.destroy(er);
    return false;
}

Object.setPrototypeOf(Socket.prototype, Duplex.prototype);
Object.setPrototypeOf(Socket, Duplex);

const _superEmit = EventEmitter.prototype.emit;
Socket.prototype.emit = function emit(event, ...args) {
    if (event === 'close' && args.length === 0) {
        return _superEmit.call(this, 'close', !!this._hadError);
    }
    return _superEmit.call(this, event, ...args);
};

Object.defineProperty(Socket.prototype, 'bufferSize', {
    get() {
        return this.writableLength || 0;
    },
});

Object.defineProperty(Socket.prototype, 'pending', {
    get() {
        return !this._handle || this.connecting;
    },
    configurable: true,
});

Object.defineProperty(Socket.prototype, 'bytesWritten', {
    get() {
        let bytes = this._bytesDispatched;
        if (this._writableState) {
            bytes += this._writableState.length;
        }
        return bytes;
    },
    set(val) {
        this._bytesDispatched = val;
    },
    configurable: true,
});

Object.defineProperty(Socket.prototype, '_connecting', {
    get() {
        return this.connecting;
    },
    set(val) {
        this.connecting = val;
    },
    configurable: true,
});

Object.defineProperty(Socket.prototype, 'readyState', {
    get() {
        if (this.connecting) return 'opening';
        if (this.readable && this.writable) return 'open';
        if (this.readable && !this.writable) return 'readOnly';
        if (!this.readable && this.writable) return 'writeOnly';
        return 'closed';
    },
});

Socket.prototype._clearAbortSignal = function _clearAbortSignal() {
    if (this._abortSignal && this._abortHandler && typeof this._abortSignal.removeEventListener === 'function') {
        try {
            this._abortSignal.removeEventListener('abort', this._abortHandler);
        } catch (_) {}
    }
    this._abortSignal = null;
    this._abortHandler = null;
};

Socket.prototype._setupAbortSignal = function _setupAbortSignal(signal) {
    if (signal === undefined || signal === null) {
        return 'unchanged';
    }
    if (signal === this._abortSignal) {
        return signal.aborted === true ? 'preaborted' : 'unchanged';
    }

    this._clearAbortSignal();

    if (signal.aborted === true) {
        this._abortSignal = signal;
        deferred(() => {
            if (!this.destroyed) {
                this.destroy(new AbortError(signal.reason));
            }
        });
        return 'preaborted';
    }

    if (typeof signal.addEventListener !== 'function') {
        return 'unchanged';
    }

    const onAbort = () => {
        this._clearAbortSignal();
        deferred(() => {
            if (!this.destroyed) {
                this.destroy(new AbortError(signal.reason));
            }
        });
    };

    this._abortSignal = signal;
    this._abortHandler = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    this.once('close', () => this._clearAbortSignal());
    return 'armed';
};

Socket.prototype.connect = function connect(...args) {
    let options, cb;

    if (args.length === 0) {
        throw new ERR_MISSING_ARGS(['options', 'port', 'path']);
    }

    // connect(options[, cb])
    if (typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
        cb = args[1];
    }
    // connect(path[, cb]) — IPC
    else if (typeof args[0] === 'string' && !isFinite(args[0])) {
        options = { path: args[0] };
        cb = args[1];
    }
    // connect(port[, host][, cb])
    else {
        options = { port: args[0] };
        if (typeof args[1] === 'string') {
            options.host = args[1];
            cb = args[2];
        } else {
            cb = args[1];
        }
    }

    if (options.port === undefined && !options.path && !options.host) {
        throw new ERR_MISSING_ARGS(['options', 'port', 'path']);
    }

    const objectModeOptions = this._creationOptions || {};
    if (options.objectMode || objectModeOptions.objectMode) {
        throw new ERR_INVALID_ARG_VALUE('options.objectMode', options.objectMode || objectModeOptions.objectMode, 'is not supported');
    }
    if (options.readableObjectMode || objectModeOptions.readableObjectMode) {
        throw new ERR_INVALID_ARG_VALUE('options.readableObjectMode', options.readableObjectMode || objectModeOptions.readableObjectMode, 'is not supported');
    }
    if (options.writableObjectMode || objectModeOptions.writableObjectMode) {
        throw new ERR_INVALID_ARG_VALUE('options.writableObjectMode', options.writableObjectMode || objectModeOptions.writableObjectMode, 'is not supported');
    }

    // Validate signal shape up-front so a bad signal still raises the same
    // synchronous TypeError Node.js raises (before any abort-handling state
    // changes happen on this Socket).
    if (options.signal !== undefined) {
        validateAbortSignal(options.signal, 'options.signal');
    }

    if (options.host !== undefined && typeof options.host !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('options.host', 'string', options.host);
    }

    if (options.lookup !== undefined && typeof options.lookup !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('options.lookup', 'Function', options.lookup);
    }

    if (options.autoSelectFamily !== undefined && typeof options.autoSelectFamily !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.autoSelectFamily', 'boolean', options.autoSelectFamily);
    }

    if (options.autoSelectFamilyAttemptTimeout !== undefined && options.autoSelectFamilyAttemptTimeout <= 0) {
        throw new ERR_OUT_OF_RANGE('options.autoSelectFamilyAttemptTimeout', '>= 1', options.autoSelectFamilyAttemptTimeout);
    }

    if (options.path !== undefined && typeof options.path !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('options.path', 'string', options.path);
    }

    // Resolve IPC entry (if `path` is given) so subsequent argument validation
    // and abort-signal handling can run against the resolved host/port. Defer
    // the ENOENT early-return until after `_setupAbortSignal()` so that a
    // pre-aborted signal still wins over a missing IPC target.
    let pendingIpcMissingPath = null;
    if (options.path) {
        const ipcEntry = _ipcListeners[options.path];
        if (!ipcEntry) {
            pendingIpcMissingPath = options.path;
        } else {
            options.port = ipcEntry.port;
            options.host = ipcEntry.host;
            delete options.path;
        }
    }

    const port = options.port;
    const host = options.host || options.hostname || 'localhost';
    const autoSelectFamily = options.autoSelectFamily ?? _defaultAutoSelectFamily;
    const family = options.family ?? (autoSelectFamily ? 0 : this._family ?? 4);
    const lookup = options.lookup || dns.lookup;
    const autoSelectFamilyAttemptTimeout = Math.max(
        10,
        options.autoSelectFamilyAttemptTimeout ?? _defaultAutoSelectFamilyAttemptTimeout
    );
    const localAddress = options.localAddress;
    const localPort = options.localPort;

    if (port !== undefined) {
        const p = +port;
        if (p !== p || p < 0 || p > 65535 || p !== (p | 0)) {
            throw new ERR_SOCKET_BAD_PORT('Port', port, false);
        }
    }

    if (localAddress !== undefined) {
        if (typeof localAddress !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('options.localAddress', 'string', localAddress);
        }
        if (!isIPv4(localAddress) && !isIPv6(localAddress)) {
            throw makeTypeError('ERR_INVALID_IP_ADDRESS', `Invalid IP address: ${localAddress}`);
        }
    }

    if (localPort !== undefined) {
        if (typeof localPort !== 'number') {
            throw new ERR_INVALID_ARG_TYPE('options.localPort', 'number', localPort);
        }
        if (localPort !== localPort || localPort < 0 || localPort > 65535 || localPort !== (localPort | 0)) {
            throw new ERR_SOCKET_BAD_PORT('options.localPort', localPort, false);
        }
    }

    // Reset state for reconnection (Node.js allows calling connect() on a
    // destroyed socket to reconnect). Must happen before `_setupAbortSignal()`
    // so a pre-aborted signal can actually schedule a destroy on the freshly
    // reset socket instead of being a silent no-op on `this.destroyed`.
    if (this.destroyed) {
        this._handle = null;
        this._reading = false;
        this._readToken++;
        this._readInFlight = false;
        this._netPaused = false;
        this._pendingReadChunks.length = 0;
        this.destroyed = false;
        this.readable = true;
        this._hadError = false;

        const rState = this._readableState;
        if (rState) {
            rState.destroyed = false;
            rState.reading = false;
            rState.ended = false;
            rState.endEmitted = false;
            rState.closed = false;
            rState.closeEmitted = false;
            rState.errored = null;
            rState.errorEmitted = false;
            rState.dataEmitted = false;
            rState.needReadable = false;
            rState.emittedReadable = false;
            rState.resumeScheduled = false;
            rState.awaitDrainWriters = null;
            rState.multiAwaitDrain = false;
            rState.buffer = new (rState.buffer.constructor)();
            rState.length = 0;
            rState.pipes = [];
        }

        const wState = this._writableState;
        if (wState) {
            wState.ended = false;
            wState.ending = false;
            wState.destroyed = false;
            wState.finished = false;
            wState.errorEmitted = false;
            wState.closed = false;
            wState.closeEmitted = false;
            wState.errored = null;
            wState.finalCalled = false;
            wState.prefinished = false;
            wState.writing = false;
            wState.length = 0;
            wState.needDrain = false;
            wState.writecb = null;
            wState.writelen = 0;
            wState.afterWriteTickInfo = null;
            wState.buffered = [];
            wState.bufferedIndex = 0;
            wState.pendingcb = 0;
            wState.corked = 0;
        }
    }

    // Reset write method if it was overridden (e.g., writeAfterFIN)
    if (this.write !== Socket.prototype.write) {
        this.write = Socket.prototype.write;
    }

    // Wire up the abort signal after all synchronous argument validation has
    // succeeded and after the reconnect reset has run, but before any
    // non-throwing error-scheduling early-return branches (e.g. IPC ENOENT).
    // A pre-aborted signal must therefore win over a missing IPC target.
    if (this._setupAbortSignal(options.signal) === 'preaborted') {
        return this;
    }

    // Deferred IPC ENOENT: only scheduled if signal did not already abort.
    if (pendingIpcMissingPath !== null) {
        const ipcPath = pendingIpcMissingPath;
        this.connecting = true;
        nextTick(() => {
            this.connecting = false;
            const err = makeError('ENOENT', `connect ENOENT ${ipcPath}`);
            this.destroy(err);
        });
        return this;
    }

    // Reset bytes counters for new connection
    this.bytesRead = 0;
    this._bytesDispatched = 0;

    this.connecting = true;
    this.writable = true;

    // Create handle wrapper early so _handle is available synchronously
    // (matches Node.js behavior where _handle = new TCP() at top of connect)
    this._handle = createHandleWrap();

    // Store keepAlive options for processing after connection
    if (options.keepAlive) {
        const msecs = options.keepAliveInitialDelay;
        this._keepAliveOnConnect = true;
        this._keepAliveDelay = msecs === undefined ? 0 : Math.max(~~(msecs / 1000), 0);
    } else {
        this._keepAliveOnConnect = false;
    }

    if (cb) this.once('connect', cb);

    const completeConnection = (handle) => {
        forwardNativeHandle(this._handle, handle);
        this.connecting = false;

        try {
            const [ra, rp, rf] = this._handle.remote_address();
            this.remoteAddress = ra;
            this.remotePort = rp;
            this.remoteFamily = rf;
        } catch (_) {}
        try {
            const [la, lp, lf] = this._handle.local_address();
            this.localAddress = la;
            this.localPort = lp;
            this.localFamily = lf;
        } catch (_) {}

        if (this._keepAliveOnConnect) {
            this._handle.setKeepAlive(true, this._keepAliveDelay);
        }

        this.emit('connect');
        this.emit('ready');

        this.read(0);
    };

    const createConnectError = (ip) => {
        const err = makeError('EADDRNOTAVAIL', `connect EADDRNOTAVAIL ${ip}:${port} - Local (:::0)`);
        err.address = ip;
        err.port = port;
        return err;
    };

    const connectAttempt = (ip, addressFamily, onResult) => {
        if (addressFamily === 6) {
            nextTick(onResult, createConnectError(ip));
            return;
        }

        const handle = create_tcp_socket(addressFamily);
        this._connectingHandle = handle;

        (async () => {
            try {
                if (localAddress !== undefined || localPort !== undefined) {
                    const bindAddr = localAddress || (addressFamily === 4 ? '0.0.0.0' : '::');
                    const bindPort = localPort !== undefined ? localPort : 0;
                    await handle.bind(bindAddr, bindPort);
                }
                await handle.connect(ip, port);
                this._connectingHandle = null;
                onResult(null, handle);
            } catch (e) {
                this._connectingHandle = null;
                const err = parseNativeError(e);
                err.address = ip;
                err.port = port;
                try {
                    handle.close();
                } catch (_) {}
                onResult(err);
            }
        })();
    };

    const doConnect = (ip, addressFamily) => {
        connectAttempt(ip, addressFamily, (err, handle) => {
            if (!this.connecting || this.destroyed) {
                if (handle) {
                    try {
                        handle.close();
                    } catch (_) {}
                }
                return;
            }

            if (err) {
                this.connecting = false;
                this.destroy(err);
                return;
            }

            completeConnection(handle);
        });
    };

    const normalizeLookupEntries = (address, resolvedFamily) => {
        const results = [];
        const pushAddress = (candidate, candidateFamily) => {
            if (typeof candidate !== 'string') return;

            const familyNumber =
                candidateFamily === 4 || candidateFamily === 6
                    ? candidateFamily
                    : isIP(candidate);
            if (familyNumber !== 4 && familyNumber !== 6) return;

            results.push({ address: candidate, family: familyNumber });
        };

        if (Array.isArray(address)) {
            for (const entry of address) {
                if (entry && typeof entry === 'object') {
                    pushAddress(entry.address, entry.family);
                }
            }
        } else {
            pushAddress(address, resolvedFamily);
        }

        return results;
    };

    const interleaveLookupAddresses = (entries) => {
        if (entries.length <= 1) return entries;

        const firstFamily = entries[0].family;
        const preferred = [];
        const alternate = [];

        for (const entry of entries) {
            if (entry.family === firstFamily) {
                preferred.push(entry);
            } else {
                alternate.push(entry);
            }
        }

        const ordered = [];
        const maxLen = Math.max(preferred.length, alternate.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < preferred.length) ordered.push(preferred[i]);
            if (i < alternate.length) ordered.push(alternate[i]);
        }

        return ordered;
    };

    const doAutoSelectConnect = (addresses) => {
        if (addresses.length <= 1) {
            if (addresses.length === 0) {
                this.connecting = false;
                this.destroy(makeError('ENOTFOUND', `lookup ${host} returned no valid address`));
                return;
            }

            doConnect(addresses[0].address, addresses[0].family);
            return;
        }

        this.autoSelectFamilyAttemptedAddresses = [];

        const errors = [];
        let index = 0;
        let attemptTimer = null;
        let activeAttemptId = 0;

        const clearAttemptTimer = () => {
            if (attemptTimer !== null) {
                globalThis.clearTimeout(attemptTimer);
                attemptTimer = null;
            }
        };

        const failWithErrors = () => {
            this.connecting = false;
            if (errors.length === 1) {
                this.destroy(errors[0]);
            } else {
                this.destroy(new AggregateError(errors, 'All connection attempts failed'));
            }
        };

        const tryNext = () => {
            if (!this.connecting || this.destroyed) return;

            if (index >= addresses.length) {
                failWithErrors();
                return;
            }

            const current = addresses[index++];
            const attemptId = ++activeAttemptId;
            this.autoSelectFamilyAttemptedAddresses.push(`${current.address}:${port}`);

            if (index < addresses.length) {
                attemptTimer = globalThis.setTimeout(() => {
                    if (attemptId !== activeAttemptId || !this.connecting || this.destroyed) {
                        return;
                    }

                    attemptTimer = null;

                    const timeoutError = makeError(
                        'ETIMEDOUT',
                        `connect ETIMEDOUT ${current.address}:${port}`
                    );
                    timeoutError.address = current.address;
                    timeoutError.port = port;
                    errors.push(timeoutError);

                    tryNext();
                }, autoSelectFamilyAttemptTimeout);
            }

            connectAttempt(current.address, current.family, (err, handle) => {
                if (!this.connecting || this.destroyed) {
                    if (handle) {
                        try {
                            handle.close();
                        } catch (_) {}
                    }
                    return;
                }

                if (attemptId !== activeAttemptId) {
                    if (handle) {
                        try {
                            handle.close();
                        } catch (_) {}
                    }
                    return;
                }

                clearAttemptTimer();

                if (err) {
                    errors.push(err);
                    tryNext();
                    return;
                }

                completeConnection(handle);
            });
        };

        tryNext();
    };

    const shouldAutoSelectFamily =
        autoSelectFamily === true &&
        family !== 4 &&
        family !== 6 &&
        options.localAddress === undefined;

    const handleLookupResult = (err, address, resolvedFamily) => {
        if (err) {
            this.connecting = false;
            this.emit('lookup', err, address, resolvedFamily, host);
            this.destroy(err);
            return;
        }

        const normalized = normalizeLookupEntries(address, resolvedFamily);
        const first = normalized[0];
        this.emit('lookup', null, first?.address, first?.family, host);

        if (this.destroyed || !this.connecting) {
            return;
        }

        if (shouldAutoSelectFamily) {
            doAutoSelectConnect(interleaveLookupAddresses(normalized));
            return;
        }

        if (!first) {
            this.connecting = false;
            this.destroy(makeError('ENOTFOUND', `lookup ${host} returned no valid address`));
            return;
        }

        doConnect(first.address, first.family);
    };

    if (isIPAddress(host)) {
        const af = isIPv4(host) ? 4 : 6;
        this.emit('lookup', null, host, af, host);
        doConnect(host, af);
    } else {
        lookup(host, { family, all: shouldAutoSelectFamily }, handleLookupResult);
    }

    return this;
};

Socket.prototype._read = function _read(n) {
    if (this.connecting) {
        this.once('connect', () => this._read(n));
        return;
    }
    if (!this._handle || this.destroyed) return;
    if (this._pendingReadChunks.length > 0) {
        this._drainPendingReadChunks();
        if (this._netPaused || this._pendingReadChunks.length > 0) return;
    }
    if (!this._reading) {
        this._reading = true;
    }
    if (!this._readInFlight) {
        this._startPollLoop();
    }
};

Socket.prototype.pause = function pause() {
    this._netPaused = true;
    this._reading = false;
    return Duplex.prototype.pause.call(this);
};

Socket.prototype.resume = function resume() {
    this._netPaused = false;
    const result = Duplex.prototype.resume.call(this);
    this._drainPendingReadChunks();
    if (!this._reading && this._handle && !this.destroyed && !this._netPaused) {
        this.read(0);
    }
    return result;
};

Socket.prototype._drainPendingReadChunks = function _drainPendingReadChunks() {
    while (!this._netPaused && this._pendingReadChunks.length > 0) {
        const chunk = this._pendingReadChunks.shift();
        if (chunk === null || chunk === undefined) {
            this.push(null);
            return;
        }
        const keepGoing = this.push(chunk);
        if (!keepGoing) {
            this._reading = false;
            return;
        }
    }
};

Socket.prototype._startPollLoop = function _startPollLoop() {
    const token = ++this._readToken;
    (async () => {
        while (this._reading && this._handle && token === this._readToken) {
            try {
                this._readInFlight = true;
                const chunk = await this._handle.read(16384);
                this._readInFlight = false;
                if (token !== this._readToken) break;
                if (chunk === null || chunk === undefined) {
                    if (this._netPaused) {
                        this._pendingReadChunks.push(null);
                    } else {
                        this.push(null);
                        this.read(0);
                    }
                    break;
                }
                this.bytesRead += chunk.length;
                this._resetTimeout();
                const buffer = Buffer.from(chunk);
                if (this._netPaused) {
                    this._pendingReadChunks.push(buffer);
                    this._reading = false;
                    break;
                }
                const keepGoing = this.push(buffer);
                if (!keepGoing) {
                    this._reading = false;
                    break;
                }
            } catch (e) {
                this._readInFlight = false;
                if (token !== this._readToken) break;
                this.destroy(parseNativeError(e));
                break;
            }
        }
    })();
};

Socket.prototype._write = function _write(chunk, encoding, callback) {
    if (this.connecting) {
        this.once('connect', () => this._write(chunk, encoding, callback));
        return;
    }
    if (!this._handle) {
        callback(new Error('Socket is closed'));
        return;
    }

    const data = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const byteArray = Array.from(buf);

    (async () => {
        try {
            const written = await this._handle.write(byteArray);
            this._bytesDispatched += written;
            this._resetTimeout();
            callback(null);
        } catch (e) {
            callback(parseNativeError(e));
        }
    })();
};

Socket.prototype._final = function _final(callback) {
    if (this.connecting) {
        this.once('connect', () => this._final(callback));
        return;
    }
    if (!this._handle) {
        callback();
        return;
    }
    try {
        this._handle.shutdown(1); // SHUT_WR
        callback();
    } catch (e) {
        callback(parseNativeError(e));
    }
};

Socket.prototype._destroy = function _destroy(err, callback) {
    this._hadError = !!err;
    this._reading = false;
    this._readToken++;
    this._readInFlight = false;
    this._netPaused = false;
    this._pendingReadChunks.length = 0;
    this._clearAbortSignal();
    this._clearTimeout();
    if (this._connectingHandle) {
        try { this._connectingHandle.close(); } catch (_) {}
        this._connectingHandle = null;
    }
    if (this._handle) {
        this._handle.close();
        this._handle = null;
    }
    this.connecting = false;
    callback(err);
};

Socket.prototype.setTimeout = function setTimeout(timeout, callback) {
    if (typeof timeout !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('msecs', 'number', timeout);
    }
    if (timeout < 0 || !Number.isFinite(timeout)) {
        throw new ERR_OUT_OF_RANGE('msecs', 'a non-negative finite number', timeout);
    }
    if (this.destroyed) return this;
    this._clearTimeout();
    this._timeoutValue = timeout;
    if (timeout === 0) {
        if (callback !== undefined) {
            if (typeof callback !== 'function') {
                throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
            }
            this.removeListener('timeout', callback);
        }
        return this;
    }
    if (callback !== undefined) {
        if (typeof callback !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('callback', 'Function', callback);
        }
        this.once('timeout', callback);
    }
    this._resetTimeout();
    return this;
};

Socket.prototype._resetTimeout = function _resetTimeout() {
    if (this._timeoutValue > 0) {
        this._clearTimeout();
        this._timeout = globalThis.setTimeout(() => {
            this.emit('timeout');
        }, this._timeoutValue);
    }
};

Socket.prototype._clearTimeout = function _clearTimeout() {
    if (this._timeout) {
        globalThis.clearTimeout(this._timeout);
        this._timeout = null;
    }
};

Socket.prototype.setNoDelay = function setNoDelay(noDelay) {
    if (this._handle) this._handle.set_no_delay(noDelay !== false);
    return this;
};

Socket.prototype.setKeepAlive = function setKeepAlive(enable, initialDelay) {
    if (this._handle) {
        this._handle.set_keep_alive(!!enable, (initialDelay || 0));
    }
    return this;
};

Socket.prototype.address = function address() {
    if (!this._handle) return {};
    try {
        const [addr, port, family] = this._handle.local_address();
        return { address: addr, family, port };
    } catch (_) {
        return {};
    }
};

Socket.prototype.resetAndDestroy = function resetAndDestroy() {
    if (this._handle) {
        this._handle.close();
    }
    this.destroy();
    return this;
};

Socket.prototype.destroySoon = function destroySoon() {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once('finish', this.destroy);
};

Socket.prototype.ref = function ref() { return this; };
Socket.prototype.unref = function unref() { return this; };

// --- Server (extends EventEmitter) ---

function Server(options, connectionListener) {
    if (!(this instanceof Server)) return new Server(options, connectionListener);
    EventEmitter.call(this);

    if (typeof options === 'function') {
        connectionListener = options;
        options = {};
    }
    options = options || {};

    this._handle = null;
    this._connections = 0;
    this._accepting = false;
    this._acceptToken = 0;
    this._acceptLoopActive = false;
    this._closeRequested = false;
    this._ipcPath = null;
    this.listening = false;
    this.maxConnections = 0;
    this._pauseOnConnect = options.pauseOnConnect || false;
    this._noDelay = options.noDelay || false;
    this._keepAlive = options.keepAlive || false;
    this._keepAliveInitialDelay = options.keepAliveInitialDelay || 0;
    this.allowHalfOpen = options.allowHalfOpen || false;
    this._unrefed = false;

    if (connectionListener) this.on('connection', connectionListener);
}

Object.setPrototypeOf(Server.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Server, EventEmitter);

Server.prototype.listen = function listen(...args) {
    let options, cb;

    if (args.length === 0) {
        options = {};
    } else if (typeof args[0] === 'function') {
        // listen(cb)
        options = {};
        cb = args[0];
    } else if (typeof args[0] === 'object' && args[0] !== null && !('port' in args[0] === false && typeof args[0] === 'number')) {
        // listen(options[, cb])
        options = args[0];
        cb = args[1];
    } else if (typeof args[0] === 'string' && !isFinite(args[0])) {
        // listen(path[, backlog][, cb]) — IPC
        options = { path: args[0] };
        if (typeof args[1] === 'function') {
            cb = args[1];
        } else {
            if (args[1] !== undefined) options.backlog = args[1];
            cb = args[2];
        }
    } else {
        // listen(port[, host][, backlog][, cb])
        options = { port: args[0] };
        let idx = 1;
        if (typeof args[idx] === 'string') {
            options.host = args[idx++];
        }
        if (typeof args[idx] === 'number') {
            options.backlog = args[idx++];
        }
        // Find callback among remaining args (handles undefined host/backlog)
        while (idx < args.length && typeof args[idx] !== 'function') {
            idx++;
        }
        cb = args[idx];
    }

    // Node gives `port` precedence over `path` when both are present.
    // WASM has no Unix-domain socket support, so emulate IPC via TCP loopback.
    if (options.path && options.port === undefined) {
        this._ipcPath = options.path;
        const ipcPath = options.path;
        const ipcBacklog = options.backlog || 511;

        // Check for EADDRINUSE (path already in use by another server)
        if (_ipcListeners[ipcPath]) {
            nextTick(() => {
                const err = makeError('EADDRINUSE', `listen EADDRINUSE: address already in use ${ipcPath}`);
                err.address = ipcPath;
                err.errno = errnoMap['EADDRINUSE'] || 0;
                err.syscall = 'listen';
                this.emit('error', err);
            });
            return this;
        }

        // Check that the parent directory exists
        try {
            const dir = pathModule.dirname(ipcPath);
            fs.accessSync(dir);
        } catch (_) {
            nextTick(() => {
                const err = makeError('ENOENT', `listen ENOENT: no such file or directory, listen '${ipcPath}'`);
                err.address = ipcPath;
                err.syscall = 'listen';
                this.emit('error', err);
            });
            return this;
        }

        if (cb) this.once('listening', cb);

        const doIpcListen = (ip, family) => {
            try {
                this._handle = create_tcp_listener(family);
                this._handle.bind_sync(ip, 0);
                this._handle.set_backlog(ipcBacklog);
                this._handle.listen_sync();
                this.listening = true;
                this._accepting = true;
                this._closeRequested = false;

                const [, assignedPort] = this._handle.local_address();
                _ipcListeners[ipcPath] = { host: ip, port: assignedPort };

                // Create a placeholder file so fs.statSync works on the path
                try {
                    let mode = 0o600;
                    if (options.readableAll) mode |= 0o044;
                    if (options.writableAll) mode |= 0o022;
                    fs.writeFileSync(ipcPath, '');
                    fs.chmodSync(ipcPath, mode);
                } catch (_) {}

                nextTick(() => { if (!this._closeRequested) this.emit('listening'); });
                this._acceptLoop();
            } catch (e) {
                const err = parseNativeError(e);
                err.address = ipcPath;
                nextTick(() => this.emit('error', err));
            }
        };
        doIpcListen('127.0.0.1', 4);
        return this;
    }

    if (this.listening) {
        throw makeError('ERR_SERVER_ALREADY_LISTEN', 'Server is already listening');
    }

    if (options.fd !== undefined) {
        nextTick(() => {
            const err = makeError('EINVAL', 'listen EINVAL: invalid argument');
            err.errno = errnoMap['EINVAL'] || -22;
            err.code = 'EINVAL';
            err.syscall = 'listen';
            this.emit('error', err);
        });
        return this;
    }

    if (cb) this.once('listening', cb);

    const port = options.port !== undefined ? options.port : 0;
    if (port !== undefined) {
        const p = +port;
        if (p !== p || p < 0 || p > 65535 || p !== (p | 0)) {
            throw new ERR_SOCKET_BAD_PORT('Port', port, true);
        }
    }
    const host = options.host || '0.0.0.0';
    const backlog = options.backlog || 511;

    const doListen = (ip, family) => {
        try {
            this._handle = create_tcp_listener(family);
            this._handle.bind_sync(ip, port);
            this._handle.set_backlog(backlog);
            this._handle.listen_sync();
            this.listening = true;
            this._accepting = true;
            this._closeRequested = false;
            this._connectionKey = (family === 6 ? '6' : '4') + ':' + ip + ':' + port;
            nextTick(() => { if (!this._closeRequested) this.emit('listening'); });
            this._acceptLoop();
        } catch (e) {
            const err = parseNativeError(e);
            err.syscall = 'listen';
            err.address = ip;
            err.port = port;
            nextTick(() => this.emit('error', err));
        }
    };

    if (isIPAddress(host)) {
        doListen(host, isIPv4(host) ? 4 : 6);
    } else if (host === '0.0.0.0' || host === '::') {
        doListen(host, host === '::' ? 6 : 4);
    } else {
        dns.lookup(host, (err, address, family) => {
            if (err) { this.emit('error', err); return; }
            doListen(address, family || 4);
        });
    }

    return this;
};

Server.prototype._closeHandle = function _closeHandle() {
    if (!this._handle) return;
    this._handle.close();
    this._handle = null;
};

Server.prototype._maybeEmitClose = function _maybeEmitClose() {
    if (!this.listening && !this._handle && this._connections === 0) {
        nextTick(() => this.emit('close'));
    }
};

Server.prototype._wakeAcceptLoop = function _wakeAcceptLoop() {
    if (!this._handle) return;

    let addr;
    let port;
    let family;
    try {
        [addr, port, family] = this._handle.local_address();
    } catch (_) {
        return;
    }

    const wakeFamily = family === 'IPv6' ? 6 : 4;
    const wakeAddress =
        addr === '0.0.0.0' ? '127.0.0.1' :
            (addr === '::' ? '::1' : addr);

    (async () => {
        const wakeSocket = create_tcp_socket(wakeFamily);
        try {
            await wakeSocket.connect(wakeAddress, port);
        } catch (_) {
            // Best effort only: this is just to wake a blocked accept call.
        } finally {
            try {
                wakeSocket.close();
            } catch (_) {}
        }
    })();
};

Server.prototype._acceptLoop = function _acceptLoop() {
    const token = ++this._acceptToken;
    this._acceptLoopActive = true;
    (async () => {
        try {
            while (this._accepting && this._handle && token === this._acceptToken) {
                try {
                    const [clientHandle, addr, port, family] = await this._handle.accept();
                    if (token !== this._acceptToken) { clientHandle.close(); break; }

                    if (this.maxConnections && this._connections >= this.maxConnections) {
                        clientHandle.close();
                        this.emit('drop', {
                            localAddress: this._localAddress,
                            localPort: this._localPort,
                            localFamily: this._localFamily,
                            remoteAddress: addr,
                            remotePort: port,
                            remoteFamily: family,
                        });
                        continue;
                    }

                    const socket = new Socket({ allowHalfOpen: this.allowHalfOpen });
                    socket._handle = createHandleWrap();
                    forwardNativeHandle(socket._handle, clientHandle);
                    socket.server = this;
                    socket.connecting = false;
                    socket.readable = true;
                    socket.writable = true;
                    socket.remoteAddress = addr;
                    socket.remotePort = port;
                    socket.remoteFamily = family;
                    try {
                        const [la, lp, lf] = clientHandle.local_address();
                        socket.localAddress = la;
                        socket.localPort = lp;
                        socket.localFamily = lf;
                    } catch (_) {}

                    if (this._noDelay) socket.setNoDelay(true);
                    if (this._keepAlive) socket.setKeepAlive(true, this._keepAliveInitialDelay);
                    if (this._pauseOnConnect) socket.pause();

                    this._connections++;
                    socket.on('close', () => {
                        this._connections--;
                        if (this._unrefed && this._connections === 0 && this.listening) {
                            this.close();
                        }
                        this._maybeEmitClose();
                    });

                    this.emit('connection', socket);

                    if (!this._pauseOnConnect) {
                        socket.read(0);
                    }
                } catch (e) {
                    if (token !== this._acceptToken) break;
                    this.emit('error', parseNativeError(e));
                    break;
                }
            }
        } finally {
            this._acceptLoopActive = false;
            if (this._closeRequested) {
                this._closeHandle();
            }
            this._maybeEmitClose();
        }
    })();
};

Server.prototype.close = function close(cb) {
    if (typeof cb === 'function') {
        if (!this.listening) {
            this.once('close', () => cb(makeError('ERR_SERVER_NOT_RUNNING', 'Server is not running')));
        } else {
            this.once('close', cb);
        }
    }

    this._accepting = false;
    this._acceptToken++;
    this.listening = false;
    if (this._ipcPath) {
        delete _ipcListeners[this._ipcPath];
        try { fs.unlinkSync(this._ipcPath); } catch (_) {}
    }
    this._ipcPath = null;
    this._closeRequested = true;

    if (this._handle) {
        if (this._acceptLoopActive) {
            this._wakeAcceptLoop();
        } else {
            this._closeHandle();
        }
    }

    this._maybeEmitClose();

    return this;
};

Server.prototype.address = function address() {
    if (this._ipcPath && this.listening) return this._ipcPath;
    if (!this._handle || !this.listening) return null;
    try {
        const [addr, port, family] = this._handle.local_address();
        return { address: addr, family, port };
    } catch (_) {
        return null;
    }
};

Server.prototype.getConnections = function getConnections(cb) {
    nextTick(cb, null, this._connections);
    return this;
};

Server.prototype.ref = function ref() {
    this._unrefed = false;
    return this;
};
Server.prototype.unref = function unref() {
    this._unrefed = true;
    return this;
};

Server.prototype[Symbol.asyncDispose] = function () {
    if (!this._handle) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        this.close(() => resolve());
    });
};

// --- BlockList ---

class BlockList {
    constructor(rules) {
        this._rules = rules || [];
    }

    addAddress(address, type) {
        const normalized = normalizeSocketAddressLike(address, 'address');
        const parsed = parseBlockListAddress(normalized.address, type !== undefined ? type : normalized.family);
        this._rules.unshift({
            type: 'address',
            address: parsed.address,
            family: parsed.family,
            value: parsed.value,
            mapped4: parsed.mapped4,
        });
    }

    addRange(start, end, type) {
        const normalizedStart = normalizeSocketAddressLike(start, 'start');
        const normalizedEnd = normalizeSocketAddressLike(end, 'end');
        const familyInput = type !== undefined ? type : (normalizedStart.family !== undefined ? normalizedStart.family : normalizedEnd.family);
        const family = normalizeBlockListFamily(familyInput) ||
            (isIPv6(normalizedStart.address) ? 'ipv6' : 'ipv4');
        const parsedStart = parseBlockListAddress(normalizedStart.address, family);
        const parsedEnd = parseBlockListAddress(normalizedEnd.address, family);
        if (parsedEnd.value < parsedStart.value) {
            throw new ERR_INVALID_ARG_VALUE('end', normalizedEnd.address);
        }
        this._rules.unshift({
            type: 'range',
            start: parsedStart.address,
            end: parsedEnd.address,
            family,
            startValue: parsedStart.value,
            endValue: parsedEnd.value,
            startMapped4: parsedStart.mapped4,
            endMapped4: parsedEnd.mapped4,
        });
    }

    addSubnet(net, prefix, type) {
        const normalized = normalizeSocketAddressLike(net, 'net');
        const family = normalizeBlockListFamily(type !== undefined ? type : normalized.family) ||
            (isIPv6(normalized.address) ? 'ipv6' : 'ipv4');
        const parsed = parseBlockListAddress(normalized.address, family);
        validatePrefix(prefix, family);
        const bits = family === 'ipv6' ? 128 : 32;
        const mask = subnetMask(bits, prefix);
        this._rules.unshift({
            type: 'subnet',
            network: parsed.address,
            prefix,
            family,
            networkValue: parsed.value,
            mapped4: parsed.mapped4,
            mask,
        });
    }

    check(address, type) {
        const normalized = normalizeSocketAddressLike(address, 'address');
        let parsed;
        try {
            parsed = parseBlockListAddress(normalized.address, type !== undefined ? type : normalized.family);
        } catch (err) {
            if (err && err.code === 'ERR_INVALID_ARG_VALUE') {
                return false;
            }
            throw err;
        }
        for (const rule of this._rules) {
            if (rule.family !== parsed.family && (parsed.mapped4 === null || rule.family !== 'ipv4') && (rule.mapped4 === null || parsed.family !== 'ipv4')) {
                continue;
            }
            const candidateValue = rule.family === parsed.family ? parsed.value : parsed.mapped4;
            const ruleAddressValue = rule.family === parsed.family ? rule.value : rule.mapped4;

            if (rule.type === 'address' && ruleAddressValue !== null && candidateValue !== null && ruleAddressValue === candidateValue) return true;
            if (rule.type === 'range') {
                const rangeCandidate = rule.family === parsed.family ? parsed.value : parsed.mapped4;
                const rangeStart = rule.family === parsed.family ? rule.startValue : rule.startMapped4;
                const rangeEnd = rule.family === parsed.family ? rule.endValue : rule.endMapped4;
                if (rangeCandidate !== null && rangeStart !== null && rangeEnd !== null &&
                    rangeCandidate >= rangeStart && rangeCandidate <= rangeEnd) {
                    return true;
                }
            }
            if (rule.type === 'subnet') {
                const subnetCandidate = rule.family === parsed.family ? parsed.value : parsed.mapped4;
                const subnetNetwork = rule.family === parsed.family ? rule.networkValue : rule.mapped4;
                const mask = rule.family === parsed.family ? rule.mask : subnetMask(32, rule.prefix);
                if (subnetCandidate !== null && subnetNetwork !== null &&
                    (subnetCandidate & mask) === (subnetNetwork & mask)) {
                    return true;
                }
            }
        }
        return false;
    }

    get rules() {
        return this._rules.map(r => {
            if (r.type === 'address') return `Address: ${familyLabel(r.family)} ${r.address}`;
            if (r.type === 'range') return `Range: ${familyLabel(r.family)} ${r.start}-${r.end}`;
            if (r.type === 'subnet') return `Subnet: ${familyLabel(r.family)} ${r.network}/${r.prefix}`;
            return '';
        });
    }

    [customInspectSymbol](depth, opts, inspect) {
        if (depth !== null && depth < 0) return '[BlockList]';
        return `BlockList { rules: ${inspect(this.rules, opts)} }`;
    }

    [structuredCloneSymbol]() {
        return new BlockList(this._rules);
    }

    static isBlockList(value) {
        return value instanceof BlockList;
    }
}

// --- SocketAddress ---

class SocketAddress {
    constructor(options = {}) {
        this.address = options.address || '127.0.0.1';
        this.family = options.family || 'ipv4';
        this.port = options.port || 0;
        this.flowlabel = options.flowlabel || 0;
    }

    static parse(input) {
        if (typeof input !== 'string') return undefined;
        const v6Match = input.match(/^\[([^\]]+)\]:(\d+)$/);
        if (v6Match) {
            return new SocketAddress({ address: v6Match[1], family: 'ipv6', port: parseInt(v6Match[2], 10) });
        }
        const v4Match = input.match(/^(.+):(\d+)$/);
        if (v4Match && isIPv4(v4Match[1])) {
            return new SocketAddress({ address: v4Match[1], family: 'ipv4', port: parseInt(v4Match[2], 10) });
        }
        return undefined;
    }
}

// --- Factory functions ---

export function createServer(options, connectionListener) {
    if (options !== undefined && options !== null && typeof options !== 'object' && typeof options !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }
    return new Server(options, connectionListener);
}

export function createConnection(...args) {
    let options = {};
    if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
        options = args[0];
    }
    const socket = new Socket(options);
    return socket.connect(...args);
}

export const connect = createConnection;

// --- Auto-select family stubs ---

let _defaultAutoSelectFamily = false;
let _defaultAutoSelectFamilyAttemptTimeout = 250;

export function getDefaultAutoSelectFamily() { return _defaultAutoSelectFamily; }
export function setDefaultAutoSelectFamily(value) { _defaultAutoSelectFamily = !!value; }
export function getDefaultAutoSelectFamilyAttemptTimeout() { return _defaultAutoSelectFamilyAttemptTimeout; }
export function setDefaultAutoSelectFamilyAttemptTimeout(value) {
    if (value <= 0) {
        throw new ERR_OUT_OF_RANGE('value', '>= 1', value);
    }
    if (value < 10) value = 10;
    _defaultAutoSelectFamilyAttemptTimeout = value;
}

// --- Deprecated ---

let _warnSimultaneousAccepts = true;

export function _setSimultaneousAccepts() {
    if (_warnSimultaneousAccepts) {
        process.emitWarning(
            'net._setSimultaneousAccepts() is deprecated and will be removed.',
            'DeprecationWarning',
            'DEP0121'
        );
        _warnSimultaneousAccepts = false;
    }
}

export const Stream = Socket;

export { Socket, Server, BlockList, SocketAddress };

export default {
    Socket,
    Server,
    Stream: Socket,
    BlockList,
    SocketAddress,
    createServer,
    createConnection,
    connect,
    isIP,
    isIPv4,
    isIPv6,
    getDefaultAutoSelectFamily,
    setDefaultAutoSelectFamily,
    getDefaultAutoSelectFamilyAttemptTimeout,
    setDefaultAutoSelectFamilyAttemptTimeout,
    _setSimultaneousAccepts,
};
