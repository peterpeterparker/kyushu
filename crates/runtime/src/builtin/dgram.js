import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import dns from 'node:dns';
import process from 'node:process';
import { create_socket } from '__wasm_rquickjs_builtin/dgram_native';
import {
    ERR_INVALID_ARG_TYPE,
    ERR_SOCKET_BAD_PORT,
    ERR_BUFFER_OUT_OF_BOUNDS,
} from '__wasm_rquickjs_builtin/internal/errors';

const BIND_STATE_UNBOUND = 0;
const BIND_STATE_BINDING = 1;
const BIND_STATE_BOUND = 2;

const CONNECT_STATE_DISCONNECTED = 0;
const CONNECT_STATE_CONNECTING = 1;
const CONNECT_STATE_CONNECTED = 2;

const errnoMap = {
    ENOSYS: -38,
    EBADF: -9,
    EINVAL: -22,
    EADDRINUSE: -48,
    EADDRNOTAVAIL: -49,
    EACCES: -13,
    EHOSTUNREACH: -65,
    ECONNREFUSED: -61,
    EMSGSIZE: -40,
    EMFILE: -24,
    EIO: -5,
};

function makeError(code, message, name) {
    const err = new (name === 'TypeError' ? TypeError : Error)(message);
    err.code = code;
    return err;
}

function makeSyscallError(syscall, code) {
    const err = new Error(`${syscall} ${code}`);
    err.code = code;
    err.syscall = syscall;
    err.errno = errnoMap[code] || 0;
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

function isBufferType(v) {
    return typeof v === 'string' || Buffer.isBuffer(v) || ArrayBuffer.isView(v);
}

function toBuffer(v) {
    if (typeof v === 'string') return Buffer.from(v);
    if (Buffer.isBuffer(v)) return v;
    if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return Buffer.from(v);
}

const nextTick = process.nextTick;

function Socket(type, listener) {
    EventEmitter.call(this);

    let options;
    if (typeof type === 'object' && type !== null) {
        options = type;
        type = options.type;
    } else {
        options = {};
    }

    if (type !== 'udp4' && type !== 'udp6') {
        throw makeError('ERR_SOCKET_BAD_TYPE', 'Bad socket type specified. Valid types are: udp4, udp6', 'TypeError');
    }

    const family = type === 'udp4' ? 4 : 6;
    this._handle = create_socket(family);
    this._type = type;
    this._bindState = BIND_STATE_UNBOUND;
    this._connectState = CONNECT_STATE_DISCONNECTED;
    this._receiving = false;
    this._recvToken = 0;
    this._queue = null;

    if (options.recvBufferSize !== undefined) {
        if (typeof options.recvBufferSize !== 'number') {
            throw new ERR_INVALID_ARG_TYPE('options.recvBufferSize', 'number', options.recvBufferSize);
        }
    }
    if (options.sendBufferSize !== undefined) {
        if (typeof options.sendBufferSize !== 'number') {
            throw new ERR_INVALID_ARG_TYPE('options.sendBufferSize', 'number', options.sendBufferSize);
        }
    }

    this._recvBufferSize = options.recvBufferSize;
    this._sendBufferSize = options.sendBufferSize;

    if (typeof listener === 'function') {
        this.on('message', listener);
    }
}

Object.setPrototypeOf(Socket.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Socket, EventEmitter);

Object.defineProperty(Socket.prototype, 'type', {
    get() {
        return this._type;
    },
    configurable: true,
    enumerable: true,
});

Socket.prototype.bind = function bind(port_, address_, callback_) {
    this._healthCheck();

    let port, address, callback;

    if (typeof port_ === 'function') {
        callback = port_;
        port = 0;
        address = undefined;
    } else if (typeof port_ === 'object' && port_ !== null && !Array.isArray(port_)) {
        // bind(options, callback)
        const opts = port_;
        callback = address_;
        port = opts.port || 0;
        address = opts.address;

        if (opts.fd != null) {
            throw makeSyscallError('bind', 'ENOSYS');
        }
    } else {
        port = port_ || 0;
        if (typeof address_ === 'function') {
            callback = address_;
            address = undefined;
        } else {
            address = address_;
            callback = callback_;
        }
    }

    if (this._bindState !== BIND_STATE_UNBOUND) {
        throw makeError('ERR_SOCKET_ALREADY_BOUND', 'Socket is already bound');
    }

    this._bindState = BIND_STATE_BINDING;

    if (typeof callback === 'function') {
        this.once('listening', callback);
    }

    if (!address) {
        address = this._type === 'udp4' ? '0.0.0.0' : '::';
    }

    this._doBind(address, port);

    return this;
};

Socket.prototype._doBind = function _doBind(address, port) {
    (async () => {
        try {
            if (!this._handle) return;
            let bindAddress = address;
            if (bindAddress && !isIPAddress(bindAddress)) {
                const family = this._type === 'udp4' ? 4 : 6;
                bindAddress = await new Promise((resolve, reject) => {
                    dns.lookup(bindAddress, family, (err, resolved) => {
                        if (err) reject(err);
                        else resolve(resolved);
                    });
                });
            }
            await this._handle.bind(bindAddress, port);
            if (!this._handle) return;

            if (this._recvBufferSize !== undefined) {
                this._handle.set_recv_buffer_size(this._recvBufferSize);
            }
            if (this._sendBufferSize !== undefined) {
                this._handle.set_send_buffer_size(this._sendBufferSize);
            }

            this._bindState = BIND_STATE_BOUND;
            this._startReceiving();
            this.emit('listening');

            this._flushQueue();
        } catch (e) {
            this._bindState = BIND_STATE_UNBOUND;
            this._queue = null;
            if (this.listenerCount('error') > 0) {
                const err = parseNativeError(e);
                err.message = `${err.syscall || 'bind'} ${err.code} ${address}`;
                err.address = address;
                this.emit('error', err);
            }
        }
    })();
};

Socket.prototype._flushQueue = function _flushQueue() {
    if (this._queue) {
        const queue = this._queue;
        this._queue = null;
        for (const fn of queue) {
            fn();
        }
    }
};

Socket.prototype._enqueue = function _enqueue(fn) {
    if (!this._queue) {
        this._queue = [];
    }
    this._queue.push(fn);
};

Socket.prototype._healthCheck = function _healthCheck() {
    if (!this._handle) {
        throw makeError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
    }
};

Socket.prototype.send = function send(buffer, offset, length, port, address, callback) {
    this._healthCheck();

    let list;

    if (typeof buffer === 'string') {
        list = [Buffer.from(buffer)];
    } else if (Array.isArray(buffer)) {
        // Array of buffers
        for (let i = 0; i < buffer.length; i++) {
            if (!isBufferType(buffer[i])) {
                throw new ERR_INVALID_ARG_TYPE(
                    'buffer list arguments',
                    ['Buffer', 'TypedArray', 'DataView', 'string'],
                    buffer
                );
            }
        }
        list = buffer.map(toBuffer);
    } else if (isBufferType(buffer)) {
        list = [toBuffer(buffer)];
    } else {
        throw new ERR_INVALID_ARG_TYPE(
            'buffer',
            ['Buffer', 'TypedArray', 'DataView', 'string'],
            buffer
        );
    }

    // Parse arguments: send(msg, port, addr, cb) or send(msg, offset, length, port, addr, cb)
    if (typeof offset === 'number' && typeof length === 'number') {
        // send(msg, offset, length, port[, address][, callback])
        // offset and length apply to the first buffer only (when not an array)
        if (!Array.isArray(buffer)) {
            const buf = list[0];
            if (offset < 0 || offset >= buf.length) {
                throw new ERR_BUFFER_OUT_OF_BOUNDS('offset');
            }
            if (length < 0 || offset + length > buf.length) {
                throw new ERR_BUFFER_OUT_OF_BOUNDS('length');
            }
            list = [buf.slice(offset, offset + length)];
        }
        // port, address, callback are the remaining args
    } else {
        // send(msg, port[, address][, callback])
        callback = address;
        address = port;
        port = offset;
        offset = undefined;
        length = undefined;
    }

    if (typeof address === 'function') {
        callback = address;
        address = undefined;
    }

    if (this._connectState === CONNECT_STATE_CONNECTED) {
        if (port !== undefined || address !== undefined) {
            throw makeError('ERR_SOCKET_DGRAM_IS_CONNECTED', 'Already connected');
        }
    } else {
        if (port == null) {
            throw new ERR_SOCKET_BAD_PORT('Port', port, false);
        }
        if (typeof port === 'boolean') {
            throw new ERR_SOCKET_BAD_PORT('Port', port, false);
        }
        port = +port;
        if (port !== port || port < 1 || port > 65535 || port !== (port | 0)) {
            throw new ERR_SOCKET_BAD_PORT('Port', port, false);
        }
    }

    // Combine buffers
    const data = list.length === 1 ? list[0] : Buffer.concat(list);

    const doSend = () => {
        const sendAddr = address || null;
        const sendPort = port || 0;

        const performSend = (resolvedAddr) => {
            (async () => {
                try {
                    const bytesSent = await this._handle.send(
                        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                        resolvedAddr || null,
                        resolvedAddr ? sendPort : null
                    );
                    if (typeof callback === 'function') {
                        nextTick(callback, null, bytesSent);
                    }
                } catch (e) {
                    const err = parseNativeError(e);
                    if (typeof callback === 'function') {
                        nextTick(callback, err);
                    } else {
                        this.emit('error', err);
                    }
                }
            })();
        };

        if (this._connectState === CONNECT_STATE_CONNECTED) {
            // Send to connected address — pass null so native uses connected remote
            performSend(null);
        } else if (sendAddr && !isIPAddress(sendAddr)) {
            // DNS resolve
            const family = this._type === 'udp4' ? 4 : 6;
            dns.lookup(sendAddr, family, (err, resolved) => {
                if (err) {
                    if (typeof callback === 'function') {
                        nextTick(callback, err);
                    } else {
                        this.emit('error', err);
                    }
                    return;
                }
                performSend(resolved);
            });
        } else {
            performSend(sendAddr || (this._type === 'udp4' ? '127.0.0.1' : '::1'));
        }
    };

    if (this._bindState === BIND_STATE_UNBOUND) {
        this._bindState = BIND_STATE_BINDING;
        const bindAddr = this._type === 'udp4' ? '0.0.0.0' : '::';
        this._enqueue(doSend);
        this._doBind(bindAddr, 0);
    } else if (this._bindState === BIND_STATE_BINDING) {
        this._enqueue(doSend);
    } else {
        doSend();
    }

    return this;
};

Socket.prototype.sendto = function sendto(buffer, offset, length, port, address, callback) {
    if (typeof offset !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('offset', 'number', offset);
    }
    if (typeof length !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('length', 'number', length);
    }
    if (typeof port !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('port', 'number', port);
    }
    if (typeof address !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('address', 'string', address);
    }
    this.send(buffer, offset, length, port, address, callback);
};

function isIPAddress(addr) {
    // Simple check for IP address vs hostname
    if (!addr || typeof addr !== 'string') return false;
    // IPv4
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)) return true;
    // IPv6
    if (addr.indexOf(':') !== -1) return true;
    return false;
}

Socket.prototype.connect = function connect(port, address, callback) {
    this._healthCheck();

    if (typeof address === 'function') {
        callback = address;
        address = undefined;
    }

    if (port !== undefined && port !== null) {
        port = +port;
    }
    if (port == null || port !== port || port <= 0 || port > 65535 || port !== (port | 0)) {
        throw new ERR_SOCKET_BAD_PORT('Port', port, false);
    }

    if (this._connectState !== CONNECT_STATE_DISCONNECTED) {
        throw makeError('ERR_SOCKET_DGRAM_IS_CONNECTED', 'Already connected');
    }

    this._connectState = CONNECT_STATE_CONNECTING;

    if (!address) {
        address = this._type === 'udp4' ? '127.0.0.1' : '::1';
    }

    if (typeof callback === 'function') {
        this.once('connect', callback);
    }

    const doConnect = (resolvedAddr) => {
        // Increment recv token to cancel the current receive loop
        this._recvToken++;

        (async () => {
            try {
                await this._handle.connect(resolvedAddr, port);
                this._connectState = CONNECT_STATE_CONNECTED;
                this._startReceiving();
                this.emit('connect');
            } catch (e) {
                this._connectState = CONNECT_STATE_DISCONNECTED;
                this.emit('error', parseNativeError(e));
            }
        })();
    };

    const performConnect = (resolvedAddr) => {
        if (this._bindState === BIND_STATE_UNBOUND) {
            this._bindState = BIND_STATE_BINDING;
            const bindAddr = this._type === 'udp4' ? '0.0.0.0' : '::';
            this._enqueue(() => doConnect(resolvedAddr));
            this._doBind(bindAddr, 0);
        } else if (this._bindState === BIND_STATE_BINDING) {
            this._enqueue(() => doConnect(resolvedAddr));
        } else {
            doConnect(resolvedAddr);
        }
    };

    if (!isIPAddress(address)) {
        const family = this._type === 'udp4' ? 4 : 6;
        dns.lookup(address, family, (err, resolved) => {
            if (err) {
                this._connectState = CONNECT_STATE_DISCONNECTED;
                this.emit('error', err);
                return;
            }
            performConnect(resolved);
        });
    } else {
        performConnect(address);
    }

    return this;
};

Socket.prototype.disconnect = function disconnect() {
    this._healthCheck();

    if (this._connectState !== CONNECT_STATE_CONNECTED) {
        throw makeError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
    }

    this._recvToken++;

    try {
        this._handle.disconnect();
    } catch (e) {
        throw parseNativeError(e);
    }

    this._connectState = CONNECT_STATE_DISCONNECTED;

    // Restart receive loop for unconnected mode
    if (this._bindState === BIND_STATE_BOUND) {
        this._startReceiving();
    }
};

Socket.prototype.close = function close(callback) {
    if (!this._handle) {
        throw makeError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
    }

    if (typeof callback === 'function') {
        this.on('close', callback);
    }

    this._recvToken++;
    this._receiving = false;
    this._queue = null;

    this._handle.close();
    this._handle = null;
    this._bindState = BIND_STATE_UNBOUND;
    this._connectState = CONNECT_STATE_DISCONNECTED;

    nextTick(() => {
        this.emit('close');
    });

    return this;
};

Socket.prototype.address = function address() {
    this._healthCheck();

    if (this._bindState !== BIND_STATE_BOUND) {
        throw new Error('getsockname EBADF');
    }

    const [addr, port, family] = this._handle.local_address();
    return { address: addr, family, port };
};

Socket.prototype.remoteAddress = function remoteAddress() {
    this._healthCheck();

    if (this._connectState !== CONNECT_STATE_CONNECTED) {
        throw makeError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
    }

    const [addr, port, family] = this._handle.remote_address();
    return { address: addr, family, port };
};

Socket.prototype.setTTL = function setTTL(ttl) {
    if (typeof ttl !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('ttl', 'number', ttl);
    }
    if (ttl < 1 || ttl > 255) {
        throw new Error('setTTL EINVAL');
    }

    this._healthCheck();
    this._handle.set_ttl(ttl);
    return ttl;
};

Socket.prototype.getRecvBufferSize = function getRecvBufferSize() {
    this._healthCheck();
    return this._handle.get_recv_buffer_size();
};

Socket.prototype.getSendBufferSize = function getSendBufferSize() {
    this._healthCheck();
    return this._handle.get_send_buffer_size();
};

Socket.prototype.setRecvBufferSize = function setRecvBufferSize(size) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size);
    }
    this._healthCheck();
    this._handle.set_recv_buffer_size(size);
    return this;
};

Socket.prototype.setSendBufferSize = function setSendBufferSize(size) {
    if (typeof size !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('size', 'number', size);
    }
    this._healthCheck();
    this._handle.set_send_buffer_size(size);
    return this;
};

Socket.prototype.ref = function ref() {
    return this;
};

Socket.prototype.unref = function unref() {
    return this;
};

Socket.prototype.getSendQueueSize = function getSendQueueSize() {
    return 0;
};

Socket.prototype.getSendQueueCount = function getSendQueueCount() {
    return 0;
};

// ENOSYS methods
const enosysMethods = [
    'setBroadcast',
    'setMulticastTTL',
    'setMulticastLoopback',
    'setMulticastInterface',
    'addMembership',
    'dropMembership',
    'addSourceSpecificMembership',
    'dropSourceSpecificMembership',
];

for (const method of enosysMethods) {
    Socket.prototype[method] = function () {
        throw makeSyscallError(method, 'ENOSYS');
    };
}

// Receive loop
Socket.prototype._startReceiving = function _startReceiving() {
    const token = ++this._recvToken;
    this._receiving = true;

    (async () => {
        while (this._receiving && this._handle && token === this._recvToken) {
            try {
                const result = await this._handle.receive();
                if (token !== this._recvToken) break;
                const [data, addr, port, family] = result;
                const msg = Buffer.from(data);
                const rinfo = {
                    address: addr,
                    family: family === 4 ? 'IPv4' : 'IPv6',
                    port,
                    size: data.length,
                };
                this.emit('message', msg, rinfo);
            } catch (e) {
                if (token !== this._recvToken) break;
                this.emit('error', parseNativeError(e));
                break;
            }
        }
    })();
};

// Symbol.asyncDispose
Socket.prototype[Symbol.asyncDispose] = function () {
    if (!this._handle) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        this.close(() => resolve());
    });
};

export function createSocket(type, listener) {
    return new Socket(type, listener);
}

export { Socket };

export default {
    Socket,
    createSocket,
};
