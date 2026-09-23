// node:http implementation
import { NodeHttpClientRequest } from '__wasm_rquickjs_builtin/node_http_native';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import Readable from '__wasm_rquickjs_builtin/internal/streams/readable';

import { channel } from 'node:diagnostics_channel';
import { kOutHeaders } from '__wasm_rquickjs_builtin/internal/http';
import {
    AbortError,
    ERR_HTTP_HEADERS_SENT,
    ERR_HTTP_INVALID_HEADER_VALUE,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_HTTP_TOKEN,
    ERR_METHOD_NOT_IMPLEMENTED,
    ERR_OUT_OF_RANGE,
    ERR_STREAM_CANNOT_PIPE,
    ERR_STREAM_DESTROYED,
    ERR_UNESCAPED_CHARACTERS,
} from '__wasm_rquickjs_builtin/internal/errors';

const onClientRequestCreated = channel('http.client.request.created');
const onClientRequestStart = channel('http.client.request.start');
const onClientRequestError = channel('http.client.request.error');
const onClientResponseFinish = channel('http.client.response.finish');

// ===== Static Data =====

export const METHODS = [
    'ACL', 'BIND', 'CHECKOUT', 'CONNECT', 'COPY', 'DELETE', 'GET', 'HEAD',
    'LINK', 'LOCK', 'M-SEARCH', 'MERGE', 'MKACTIVITY', 'MKCALENDAR', 'MKCOL',
    'MOVE', 'NOTIFY', 'OPTIONS', 'PATCH', 'POST', 'PROPFIND', 'PROPPATCH',
    'PURGE', 'PUT', 'QUERY', 'REBIND', 'REPORT', 'SEARCH', 'SOURCE', 'SUBSCRIBE',
    'TRACE', 'UNBIND', 'UNLINK', 'UNLOCK', 'UNSUBSCRIBE',
];

export const STATUS_CODES = {
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing',
    103: 'Early Hints',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status',
    208: 'Already Reported',
    226: 'IM Used',
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a Teapot",
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required',
};

export const maxHeaderSize = 16384;

// ===== Validation =====

const INVALID_HEADER_CHAR_REGEX = /[^\t\x20-\x7e\x80-\xff]/;
const INVALID_HEADER_NAME_REGEX = /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/;
const HTTP_TOKEN_REGEX = /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;

function isValidHttpToken(value) {
    return typeof value === 'string' && HTTP_TOKEN_REGEX.test(value);
}

export function validateHeaderName(name, label = 'Header name') {
    if (typeof name !== 'string' || name.length === 0) {
        throw new ERR_INVALID_HTTP_TOKEN(label, name);
    }
    if (INVALID_HEADER_NAME_REGEX.test(name)) {
        throw new ERR_INVALID_HTTP_TOKEN(label, name);
    }
}

export function validateHeaderValue(name, value) {
    if (value === undefined) {
        throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
    }
    if (INVALID_HEADER_CHAR_REGEX.test(value)) {
        const err = new TypeError('Invalid character in header content ["' + name + '"]');
        err.code = 'ERR_INVALID_CHAR';
        throw err;
    }
}

function validateHostOption(options, propertyName) {
    const value = options[propertyName];
    if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new ERR_INVALID_ARG_TYPE(
            `options.${propertyName}`,
            ['string', 'undefined', 'null'],
            value
        );
    }
}

function isClassBorrowConflictError(error) {
    const message = error && error.message ? String(error.message) : '';
    return message.includes("can't borrow a value as it is already borrowed");
}

function _parseNativeHttpError(error) {
    const msg = error && error.message ? error.message : (typeof error === 'string' ? error : '');
    if (!msg) return error;
    try {
        const parsed = JSON.parse(msg);
        if (parsed && parsed.code) {
            const err = new Error(parsed.message || `${parsed.syscall} ${parsed.code}`);
            err.code = parsed.code;
            if (parsed.syscall) err.syscall = parsed.syscall;
            return err;
        }
    } catch (_) {
        // not JSON, return as-is
    }
    return error;
}

// ===== FakeAgentSocket =====

class FakeAgentSocket extends EventEmitter {
    constructor() {
        super();
        this._isFakeAgentSocket = true;
        this.destroyed = false;
        this.writable = true;
        this.readable = true;
        this.timeout = undefined;
        this._timeoutTimer = null;
        this.connecting = false;
        this.remoteAddress = undefined;
        this.remotePort = undefined;
        this.localAddress = undefined;
        this.localPort = undefined;
        this.writableLength = 0;
    }

    destroy() {
        if (this.destroyed) return this;
        this.destroyed = true;
        this.writable = false;
        this.readable = false;
        this._clearTimeoutTimer();
        process.nextTick(() => {
            this.emit('close');
        });
        return this;
    }

    setTimeout(ms, cb) {
        this._clearTimeoutTimer();
        if (typeof ms !== 'number') ms = 0;
        this.timeout = ms;
        if (typeof cb === 'function') this.once('timeout', cb);
        if (ms > 0) {
            this._timeoutTimer = setTimeout(() => {
                this._timeoutTimer = null;
                this.emit('timeout');
            }, ms);
        }
        return this;
    }

    _clearTimeoutTimer() {
        if (this._timeoutTimer !== null) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }
    }

    setNoDelay() { return this; }
    setKeepAlive() { return this; }
    ref() { return this; }
    unref() { return this; }
}

// ===== Agent =====

export class Agent extends EventEmitter {
    constructor(options = {}) {
        super();

        // Validate maxTotalSockets
        if (options.maxTotalSockets !== undefined && options.maxTotalSockets !== null) {
            if (typeof options.maxTotalSockets !== 'number') {
                throw new ERR_INVALID_ARG_TYPE('maxTotalSockets', 'number', options.maxTotalSockets);
            }
            if (options.maxTotalSockets <= 0 || Number.isNaN(options.maxTotalSockets)) {
                throw new ERR_OUT_OF_RANGE('maxTotalSockets', '> 0', options.maxTotalSockets);
            }
        }

        // Validate scheduling
        const scheduling = options.scheduling || 'lifo';
        if (scheduling !== 'fifo' && scheduling !== 'lifo') {
            const err = new TypeError(
                `The argument 'scheduling' must be one of: 'fifo', 'lifo'. Received '${scheduling}'`
            );
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }

        this.keepAlive = options.keepAlive || false;
        this.keepAliveMsecs = options.keepAliveMsecs || 1000;
        this.maxSockets = options.maxSockets || Infinity;
        this.maxTotalSockets = options.maxTotalSockets || Infinity;
        this.maxFreeSockets = options.maxFreeSockets || 256;
        this.timeout = options.timeout;
        this.scheduling = scheduling;
        this.freeSockets = {};
        this.requests = {};
        this.sockets = {};
        this._activeRequestCount = {};
        this._requestQueue = {};
    }

    get totalSocketCount() {
        let n = 0;
        for (const key of Object.keys(this.sockets)) {
            n += this.sockets[key].length;
        }
        for (const key of Object.keys(this.freeSockets)) {
            n += this.freeSockets[key].length;
        }
        return n;
    }

    destroy() {
        for (const key of Object.keys(this.sockets)) {
            const list = this.sockets[key];
            for (const socket of list) {
                if (socket && typeof socket.destroy === 'function') {
                    socket.destroy();
                }
            }
        }
        for (const key of Object.keys(this.freeSockets)) {
            const list = this.freeSockets[key];
            for (const socket of list) {
                if (socket && typeof socket.destroy === 'function') {
                    socket.destroy();
                }
            }
        }
        this.sockets = {};
        this.freeSockets = {};
        this.requests = {};
        this._activeRequestCount = {};
        this._requestQueue = {};
    }

    _getTotalActiveCount() {
        let total = 0;
        for (const key of Object.keys(this._activeRequestCount)) {
            total += this._activeRequestCount[key];
        }
        return total;
    }

    _canRunRequest(key) {
        const perKey = this._activeRequestCount[key] || 0;
        const total = this._getTotalActiveCount();
        return (perKey < this.maxSockets || !Number.isFinite(this.maxSockets)) &&
               (total < this.maxTotalSockets || !Number.isFinite(this.maxTotalSockets));
    }

    _scheduleRequest(name, execute, req) {
        const maxPerKey = this.maxSockets;
        const maxTotal = this.maxTotalSockets;

        if (!Number.isFinite(maxPerKey) && !Number.isFinite(maxTotal)) {
            return execute();
        }

        const key = name || 'default';

        return new Promise((resolve, reject) => {
            const run = () => {
                this._activeRequestCount[key] = (this._activeRequestCount[key] || 0) + 1;

                Promise.resolve()
                    .then(execute)
                    .then(resolve, reject)
                    .finally(() => {
                        const remaining = (this._activeRequestCount[key] || 1) - 1;
                        if (remaining > 0) {
                            this._activeRequestCount[key] = remaining;
                        } else {
                            delete this._activeRequestCount[key];
                        }

                        this._drainQueues();
                    });
            };

            if (this._canRunRequest(key)) {
                run();
                return;
            }

            if (req) {
                if (!this.requests[key]) {
                    this.requests[key] = [];
                }
                this.requests[key].push(req);
            }

            if (!this._requestQueue[key]) {
                this._requestQueue[key] = [];
            }
            this._requestQueue[key].push(() => {
                if (req && this.requests[key]) {
                    const idx = this.requests[key].indexOf(req);
                    if (idx !== -1) {
                        this.requests[key].splice(idx, 1);
                    }
                    if (this.requests[key].length === 0) {
                        delete this.requests[key];
                    }
                }
                run();
            });
        });
    }

    _drainQueues() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const key of Object.keys(this._requestQueue)) {
                const queue = this._requestQueue[key];
                if (!queue || queue.length === 0) continue;

                if (this._canRunRequest(key)) {
                    const next = queue.shift();
                    if (queue.length === 0) {
                        delete this._requestQueue[key];
                    }
                    next();
                    changed = true;
                }
            }
        }
    }

    addRequest(req, options, port, localAddress) {
        if (typeof options === 'string') {
            options = {
                host: options,
                port,
                localAddress,
            };
        }

        const name = this.getName(options);

        if (!this.sockets[name]) {
            this.sockets[name] = [];
        }

        const freeLen = this.freeSockets[name] ? this.freeSockets[name].length : 0;
        const sockLen = this.sockets[name].length;

        if (freeLen) {
            const socket = this.freeSockets[name].shift();
            if (!this.freeSockets[name].length) {
                delete this.freeSockets[name];
            }
            this.sockets[name].push(socket);
        } else if (sockLen < this.maxSockets) {
            // In our WASM runtime, requests go through wasi:http directly
            // rather than through the agent's connection pool.
        } else {
            if (!this.requests[name]) {
                this.requests[name] = [];
            }
            this.requests[name].push(req);
        }
    }

    getName(options = {}) {
        let name = options.host || 'localhost';
        name += ':';
        if (options.port) name += options.port;
        name += ':';
        if (options.localAddress) name += options.localAddress;
        if (options.socketPath) name += ':' + options.socketPath;
        if (options.family === 4 || options.family === 6) name += ':' + options.family;
        return name;
    }

    _addSocket(name, socket) {
        if (!this.sockets[name]) {
            this.sockets[name] = [];
        }
        this.sockets[name].push(socket);
    }

    _removeSocket(name, socket) {
        const list = this.sockets[name];
        if (list) {
            const idx = list.indexOf(socket);
            if (idx !== -1) {
                list.splice(idx, 1);
            }
            if (list.length === 0) {
                delete this.sockets[name];
            }
        }
    }

    _removeFreeSocket(name, socket) {
        const list = this.freeSockets[name];
        if (list) {
            const idx = list.indexOf(socket);
            if (idx !== -1) {
                list.splice(idx, 1);
            }
            if (list.length === 0) {
                delete this.freeSockets[name];
            }
        }
    }

    keepSocketAlive(socket) {
        socket.setKeepAlive(true, this.keepAliveMsecs);
        socket.unref();
        const agentTimeout = this.timeout || 0;
        if (agentTimeout) {
            socket.setTimeout(agentTimeout);
        }
        return true;
    }

    reuseSocket(socket, req) {
        socket._httpMessage = req;
    }
}

export const globalAgent = new Agent();

// ===== Helpers =====

function parseUrl(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        const err = new TypeError('Invalid URL');
        err.code = 'ERR_INVALID_URL';
        err.input = urlString;
        throw err;
    }
    const options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
    };
    if (parsed.username || parsed.password) {
        options.auth = decodeURIComponent(parsed.username) + ':' + decodeURIComponent(parsed.password);
    }
    return options;
}

function urlToOptions(url) {
    const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        hash: url.hash,
    };
    if (url.username || url.password) {
        options.auth = decodeURIComponent(url.username) + ':' + decodeURIComponent(url.password);
    }
    return options;
}

function normalizeHttpVersion(httpVersion) {
    if (typeof httpVersion === 'string' && /^\d+\.\d+$/.test(httpVersion)) {
        return httpVersion;
    }
    return '1.1';
}

function applyHttpVersion(message, httpVersion) {
    const normalized = normalizeHttpVersion(httpVersion);
    const parts = normalized.split('.');
    message.httpVersion = normalized;
    message.httpVersionMajor = Number(parts[0]) || 1;
    message.httpVersionMinor = Number(parts[1]) || 1;
}

function connectionHeaderTokens(value) {
    if (Array.isArray(value)) {
        const tokens = [];
        for (const entry of value) {
            tokens.push(...connectionHeaderTokens(entry));
        }
        return tokens;
    }
    if (value === undefined || value === null) {
        return [];
    }
    return String(value)
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(token => token.length > 0);
}

function hasConnectionToken(value, token) {
    return connectionHeaderTokens(value).includes(token);
}

function shouldKeepAliveFromResponse(httpVersion, connectionHeader) {
    if (hasConnectionToken(connectionHeader, 'close')) {
        return false;
    }
    if (hasConnectionToken(connectionHeader, 'keep-alive')) {
        return true;
    }
    return normalizeHttpVersion(httpVersion) !== '1.0';
}

function isCookieHeader(name) {
    return typeof name === 'string' && name.toLowerCase() === 'cookie';
}

// ===== Socket Transport HTTP Response Parser =====

function parseChunkedBody(raw) {
    let result = '';
    let pos = 0;

    while (pos < raw.length) {
        const lineEnd = raw.indexOf('\r\n', pos);
        if (lineEnd === -1) break;

        const sizeStr = raw.substring(pos, lineEnd).trim();
        const size = parseInt(sizeStr, 16);
        if (isNaN(size) || size === 0) break;

        pos = lineEnd + 2;
        result += raw.substring(pos, pos + size);
        pos += size + 2;
    }

    return result;
}

function parseRawHttpResponse(raw) {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
        throw new Error('Incomplete HTTP response headers');
    }

    const headerSection = raw.substring(0, headerEnd);
    const bodyRaw = raw.substring(headerEnd + 4);

    const lines = headerSection.split('\r\n');
    const statusLine = lines[0];
    const match = statusLine.match(/^HTTP\/(\d+\.\d+)\s+(\d+)\s*(.*)/);
    if (!match) {
        throw new Error('Invalid HTTP status line');
    }

    const httpVersion = match[1];
    const statusCode = parseInt(match[2], 10);
    const statusMessage = match[3] || '';

    const headers = [];
    let isChunked = false;
    let contentLength = -1;

    for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
            const name = lines[i].substring(0, colonIdx).trim();
            const value = lines[i].substring(colonIdx + 1).trim();
            headers.push([name, value]);
            const lower = name.toLowerCase();
            if (lower === 'transfer-encoding' && value.toLowerCase().includes('chunked')) {
                isChunked = true;
            }
            if (lower === 'content-length') {
                contentLength = parseInt(value, 10);
            }
        }
    }

    let body;
    if (isChunked) {
        body = parseChunkedBody(bodyRaw);
    } else if (contentLength >= 0) {
        body = bodyRaw.substring(0, contentLength);
    } else {
        body = bodyRaw;
    }

    return { httpVersion, statusCode, statusMessage, headers, body };
}

function _readHttpResponseFromSocket(socket) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        let headersParsed = false;
        let contentLength = -1;
        let isChunked = false;
        let headerEndPos = -1;
        let parsedResult = null;

        const cleanup = () => {
            socket.removeListener('data', onData);
            socket.removeListener('end', onEnd);
            socket.removeListener('error', onError);
        };

        const tryComplete = () => {
            if (!headersParsed) {
                headerEndPos = buffer.indexOf('\r\n\r\n');
                if (headerEndPos === -1) return false;

                const headerSection = buffer.substring(0, headerEndPos);
                const lines = headerSection.split('\r\n');
                const match = lines[0].match(/^HTTP\/(\d+\.\d+)\s+(\d+)\s*(.*)/);
                if (!match) {
                    cleanup();
                    reject(new Error('Invalid HTTP status line'));
                    return true;
                }

                const headers = [];
                for (let i = 1; i < lines.length; i++) {
                    const colonIdx = lines[i].indexOf(':');
                    if (colonIdx > 0) {
                        const name = lines[i].substring(0, colonIdx).trim();
                        const value = lines[i].substring(colonIdx + 1).trim();
                        headers.push([name, value]);
                        const lower = name.toLowerCase();
                        if (lower === 'transfer-encoding' && value.toLowerCase().includes('chunked')) {
                            isChunked = true;
                        }
                        if (lower === 'content-length') {
                            contentLength = parseInt(value, 10);
                        }
                    }
                }

                parsedResult = {
                    httpVersion: match[1],
                    statusCode: parseInt(match[2], 10),
                    statusMessage: match[3] || '',
                    headers,
                };
                headersParsed = true;
            }

            const bodyData = buffer.substring(headerEndPos + 4);

            if (contentLength === 0) {
                cleanup();
                resolve({ ...parsedResult, body: '' });
                return true;
            }

            if (contentLength > 0) {
                if (bodyData.length >= contentLength) {
                    cleanup();
                    resolve({ ...parsedResult, body: bodyData.substring(0, contentLength) });
                    return true;
                }
                return false;
            }

            if (isChunked) {
                const termIdx = bodyData.indexOf('0\r\n');
                if (termIdx !== -1) {
                    cleanup();
                    resolve({ ...parsedResult, body: parseChunkedBody(bodyData) });
                    return true;
                }
                return false;
            }

            return false;
        };

        const onData = (chunk) => {
            buffer += typeof chunk === 'string' ? chunk : chunk.toString();
            tryComplete();
        };

        const onEnd = () => {
            cleanup();
            if (headersParsed) {
                const bodyData = buffer.substring(headerEndPos + 4);
                resolve({ ...parsedResult, body: isChunked ? parseChunkedBody(bodyData) : bodyData });
            } else {
                reject(new Error('Connection closed before headers received'));
            }
        };

        const onError = (err) => {
            cleanup();
            reject(err);
        };

        socket.on('data', onData);
        socket.on('end', onEnd);
        socket.on('error', onError);

        if (typeof socket.resume === 'function') {
            socket.resume();
        }
    });
}

function _readConnectResponseHeaders(socket) {
    return new Promise((resolve, reject) => {
        let buffer = '';

        const cleanup = () => {
            socket.removeListener('data', onData);
            socket.removeListener('end', onEnd);
            socket.removeListener('error', onError);
        };

        const onData = (chunk) => {
            buffer += typeof chunk === 'string' ? chunk : chunk.toString();
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;

            cleanup();
            const headerSection = buffer.substring(0, headerEnd);
            const lines = headerSection.split('\r\n');
            const match = lines[0].match(/^HTTP\/(\d+\.\d+)\s+(\d+)\s*(.*)/);
            if (!match) {
                reject(new Error('Invalid HTTP status line'));
                return;
            }

            const headers = [];
            for (let i = 1; i < lines.length; i++) {
                const colonIdx = lines[i].indexOf(':');
                if (colonIdx > 0) {
                    headers.push([
                        lines[i].substring(0, colonIdx).trim(),
                        lines[i].substring(colonIdx + 1).trim(),
                    ]);
                }
            }

            resolve({
                httpVersion: match[1],
                statusCode: parseInt(match[2], 10),
                statusMessage: match[3] || '',
                headers,
            });
        };

        const onEnd = () => {
            cleanup();
            reject(new Error('Connection closed before headers received'));
        };

        const onError = (err) => {
            cleanup();
            reject(err);
        };

        socket.on('data', onData);
        socket.on('end', onEnd);
        socket.on('error', onError);
        if (typeof socket.resume === 'function') {
            socket.resume();
        }
    });
}

function expandHeaderValuesForWire(name, value) {
    if (!Array.isArray(value)) {
        return [String(value)];
    }

    const values = value.map(String);
    if (values.length < 2 || !isCookieHeader(name)) {
        return values;
    }

    return [values.join('; ')];
}

function headerValueForNative(name, value) {
    const values = expandHeaderValuesForWire(name, value);
    if (values.length === 0) {
        return '';
    }
    if (values.length === 1) {
        return values[0];
    }
    return values.join(', ');
}

function shouldSkipNativeHeader(name, value) {
    if (typeof name !== 'string') {
        return false;
    }
    const lower = name.toLowerCase();
    if (lower === 'host') {
        // wasi:http controls authority separately from headers and rejects manual Host overrides.
        return true;
    }
    if (lower === 'connection' || lower === 'transfer-encoding') {
        // Transport-level headers are managed by wasi:http and must not be set manually.
        return true;
    }
    if (lower !== 'accept') {
        return false;
    }
    const values = expandHeaderValuesForWire(name, value);
    return values.length === 1 && values[0] === '*/*';
}

function normalizeRawHeaderPairs(headers) {
    const pairs = [];
    if (!Array.isArray(headers)) {
        return pairs;
    }

    if (headers.length === 0) {
        return pairs;
    }

    if (Array.isArray(headers[0])) {
        for (const entry of headers) {
            if (!Array.isArray(entry) || entry.length < 2) {
                continue;
            }
            pairs.push([String(entry[0]), entry[1]]);
        }
        return pairs;
    }

    for (let i = 0; i < headers.length - 1; i += 2) {
        pairs.push([String(headers[i]), headers[i + 1]]);
    }

    return pairs;
}

function mergeCookieHeaderValues(existingValue, nextValue) {
    const merged = [];
    const existingValues = Array.isArray(existingValue) ? existingValue : [existingValue];
    for (const value of existingValues) {
        merged.push(String(value));
    }

    const nextValues = Array.isArray(nextValue) ? nextValue : [nextValue];
    for (const value of nextValues) {
        merged.push(String(value));
    }

    return merged;
}

// ===== IncomingMessage =====

const SET_COOKIE_HEADER = 'set-cookie';
const COOKIE_HEADER = 'cookie';
const NO_DUPLICATE_HEADERS = new Set([
    'age',
    'authorization',
    'content-length',
    'content-type',
    'etag',
    'expires',
    'from',
    'host',
    'if-modified-since',
    'if-unmodified-since',
    'last-modified',
    'location',
    'max-forwards',
    'proxy-authorization',
    'referer',
    'retry-after',
    'server',
    'user-agent',
]);

function normalizeIncomingRawPairs(nativeRes) {
    if (nativeRes && Array.isArray(nativeRes.headers)) {
        return normalizeRawHeaderPairs(nativeRes.headers);
    }

    return [];
}

function parseIncomingHeaders(rawPairs, joinDuplicateHeaders) {
    const rawHeaders = [];
    const headers = {};
    const headersDistinct = {};

    for (const pair of rawPairs) {
        const name = String(pair[0]);
        const lower = name.toLowerCase();
        const values = Array.isArray(pair[1]) ? pair[1] : [pair[1]];

        for (const value of values) {
            const valueString = String(value);
            rawHeaders.push(name, valueString);

            if (!headersDistinct[lower]) {
                headersDistinct[lower] = [];
            }
            headersDistinct[lower].push(valueString);

            if (lower === SET_COOKIE_HEADER) {
                if (Array.isArray(headers[lower])) {
                    headers[lower].push(valueString);
                } else if (headers[lower] !== undefined) {
                    headers[lower] = [headers[lower], valueString];
                } else {
                    headers[lower] = [valueString];
                }
                continue;
            }

            if (lower === COOKIE_HEADER) {
                if (headers[lower] !== undefined) {
                    headers[lower] += '; ' + valueString;
                } else {
                    headers[lower] = valueString;
                }
                continue;
            }

            if (joinDuplicateHeaders) {
                // When joinDuplicateHeaders is true, join ALL duplicates with ', '
                if (headers[lower] !== undefined) {
                    headers[lower] += ', ' + valueString;
                } else {
                    headers[lower] = valueString;
                }
                continue;
            }

            if (NO_DUPLICATE_HEADERS.has(lower)) {
                if (headers[lower] === undefined) {
                    headers[lower] = valueString;
                }
                continue;
            }

            if (headers[lower] !== undefined) {
                headers[lower] += ', ' + valueString;
            } else {
                headers[lower] = valueString;
            }
        }
    }

    return { rawHeaders, headers, headersDistinct };
}

export function IncomingMessage(nativeRes, options) {
    if (!(this instanceof IncomingMessage)) {
        return new IncomingMessage(nativeRes, options);
    }

    Readable.call(this, {});

    const hasNativeResponse = nativeRes !== null &&
        typeof nativeRes === 'object' &&
        typeof nativeRes.status === 'number' &&
        Array.isArray(nativeRes.headers);

    this._nativeRes = hasNativeResponse ? nativeRes : null;
    this.statusCode = hasNativeResponse ? nativeRes.status : null;
    if (hasNativeResponse) {
        if (typeof nativeRes.statusMessage === 'string') {
            this.statusMessage = nativeRes.statusMessage;
        } else {
            this.statusMessage = STATUS_CODES[nativeRes.status] || 'Unknown';
        }
        applyHttpVersion(this, undefined);
    } else {
        this.statusMessage = null;
        this.httpVersion = null;
        this.httpVersionMajor = null;
        this.httpVersionMinor = null;
    }
    this.complete = false;
    this.method = hasNativeResponse ? undefined : null;
    this.url = hasNativeResponse ? undefined : '';
    this.socket = hasNativeResponse ? null : nativeRes;
    this.client = this.socket;
    this.trailers = {};
    this.trailersDistinct = {};
    this.rawTrailers = [];
    this.aborted = false;
    this._consuming = false;
    this._dumped = false;
    this._timeout = null;

    const joinDup = !!(options && options.joinDuplicateHeaders);
    const parsedHeaders = parseIncomingHeaders(
        hasNativeResponse ? normalizeIncomingRawPairs(nativeRes) : [],
        joinDup
    );
    this.rawHeaders = parsedHeaders.rawHeaders;
    this.headers = parsedHeaders.headers;
    this.headersDistinct = parsedHeaders.headersDistinct;
}

Object.setPrototypeOf(IncomingMessage.prototype, Readable.prototype);
Object.setPrototypeOf(IncomingMessage, Readable);

Object.defineProperty(IncomingMessage.prototype, 'connection', {
    get() { return this.socket; },
    set(value) { this.socket = value; },
    configurable: true,
    enumerable: false,
});

IncomingMessage.prototype.setTimeout = function setTimeout(ms, callback) {
    this._timeout = ms;
    if (callback) this.once('timeout', callback);
    return this;
};

IncomingMessage.prototype._read = function _read(n) {
    if (!this._consuming) {
        this._consuming = true;
        void this._pumpBody();
    }
};

IncomingMessage.prototype._pumpBody = async function _pumpBody() {
    if (!this._nativeRes || typeof this._nativeRes.readBodyChunk !== 'function') {
        this.complete = true;
        this.push(null);
        return;
    }

    if (this._hasNoBody()) {
        if (this._nativeRes && typeof this._nativeRes.discardBody === 'function') {
            this._nativeRes.discardBody();
        }
        this.complete = true;
        this.push(null);
        return;
    }

    try {
        while (true) {
            if (this.destroyed) {
                if (this._nativeRes && typeof this._nativeRes.discardBody === 'function') {
                    this._nativeRes.discardBody();
                }
                break;
            }
            const [chunk, done] = await this._nativeRes.readBodyChunk();
            if (this.destroyed) {
                if (this._nativeRes && typeof this._nativeRes.discardBody === 'function') {
                    this._nativeRes.discardBody();
                }
                break;
            }
            if (done || chunk === null) {
                this.complete = true;
                this.push(null);
                break;
            }
            const buf = Buffer.from(chunk);
            if (!this.push(buf)) {
                // Backpressure: wait for _read to be called again
                this._consuming = false;
                return;
            }
        }
    } catch (err) {
        this.destroy(err);
    }
};

IncomingMessage.prototype._destroy = function _destroy(err, cb) {
    if (this._nativeRes && typeof this._nativeRes.discardBody === 'function') {
        this._nativeRes.discardBody();
    }
    cb(err);
};

IncomingMessage.prototype._hasNoBody = function _hasNoBody() {
    if ((this.statusCode >= 100 && this.statusCode < 200) ||
        this.statusCode === 204 ||
        this.statusCode === 304) {
        return true;
    }

    const contentLength = this.headers['content-length'];
    if (contentLength === undefined) {
        return false;
    }

    const parsed = Number(contentLength);
    return Number.isFinite(parsed) && parsed <= 0;
};

function matchKnownFields(field, lowercased) {
    const lower = lowercased ? field : field.toLowerCase();
    switch (lower) {
        // First-wins (single value, no prefix)
        case 'content-type':
        case 'content-length':
        case 'user-agent':
        case 'referer':
        case 'host':
        case 'authorization':
        case 'proxy-authorization':
        case 'if-modified-since':
        case 'if-unmodified-since':
        case 'from':
        case 'location':
        case 'max-forwards':
        case 'retry-after':
        case 'etag':
        case 'last-modified':
        case 'server':
        case 'age':
        case 'expires':
        case 'content-disposition':
            return lower;
        // Set-cookie: array
        case 'set-cookie':
            return '\u0001' + lower;
        // Cookie: semicolon-join
        case 'cookie':
            return '\u0002' + lower;
        // Default: comma-join
        default:
            return '\u0000' + lower;
    }
}

IncomingMessage.prototype._addHeaderLine = function _addHeaderLine(field, value, dest) {
    const match = matchKnownFields(field, false);
    const flag = match.charCodeAt(0);
    let name;

    if (flag <= 2) {
        name = match.substring(1);
    } else {
        name = match;
    }

    if (flag === 0) {
        // \u0000 prefix: comma-join
        if (dest[name] !== undefined) {
            dest[name] += ', ' + value;
        } else {
            dest[name] = value;
        }
    } else if (flag === 1) {
        // \u0001 prefix: set-cookie array
        if (dest[name] !== undefined) {
            if (Array.isArray(dest[name])) {
                dest[name].push(value);
            } else {
                dest[name] = [dest[name], value];
            }
        } else {
            dest[name] = [value];
        }
    } else if (flag === 2) {
        // \u0002 prefix: cookie semicolon-join
        if (dest[name] !== undefined) {
            dest[name] += '; ' + value;
        } else {
            dest[name] = value;
        }
    } else {
        // No prefix: first-wins (single value headers)
        if (dest[name] === undefined) {
            dest[name] = value;
        }
    }
};

// ===== ClientRequest =====

export class OutgoingMessage extends EventEmitter {
    constructor(options = {}) {
        super({ captureRejections: options && options.captureRejections });
        this[kOutHeaders] = null;
        this.outputData = [];
        this.outputSize = 0;
        this.writable = true;
        this.destroyed = false;
        this.finished = false;
        this._writableEnded = false;
        this._writableFinished = false;
        this.headersSent = false;
        this._header = null;
        this._socket = null;
        this._corked = 0;
        this._highWaterMark = Number.isFinite(options && options.highWaterMark)
            ? options.highWaterMark
            : 16 * 1024;
    }

    get socket() {
        return this._socket;
    }

    set socket(value) {
        this._socket = value;
    }

    get connection() {
        return this._socket;
    }

    set connection(value) {
        this._socket = value;
    }

    get writableEnded() {
        return this._writableEnded;
    }

    get writableFinished() {
        return this._writableFinished;
    }

    get writableHighWaterMark() {
        return this._highWaterMark;
    }

    get writableLength() {
        return this.outputSize;
    }

    get writableObjectMode() {
        return false;
    }

    get _headers() {
        return this.getHeaders();
    }

    set _headers(val) {
        if (val == null) {
            this[kOutHeaders] = null;
        } else {
            this[kOutHeaders] = {};
            const keys = Object.keys(val);
            for (let i = 0; i < keys.length; i++) {
                const name = keys[i];
                this[kOutHeaders][name.toLowerCase()] = [name, val[name]];
            }
        }
    }

    get _headerNames() {
        const headers = this[kOutHeaders];
        if (headers === null) return undefined;
        const out = Object.create(null);
        const keys = Object.keys(headers);
        for (let i = 0; i < keys.length; i++) {
            out[keys[i]] = headers[keys[i]][0];
        }
        return out;
    }

    set _headerNames(val) {
        if (val != null && this[kOutHeaders]) {
            const keys = Object.keys(val);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const entry = this[kOutHeaders][key];
                if (entry) {
                    entry[0] = val[key];
                }
            }
        }
    }

    setHeader(name, value) {
        if (this._header) {
            throw new ERR_HTTP_HEADERS_SENT('set');
        }
        validateHeaderName(name);
        validateHeaderValue(name, value);
        if (this[kOutHeaders] === null) {
            this[kOutHeaders] = {};
        }
        this[kOutHeaders][name.toLowerCase()] = [name, value];
        return this;
    }

    getHeader(name) {
        const entry = this[kOutHeaders] && this[kOutHeaders][name.toLowerCase()];
        return entry ? entry[1] : undefined;
    }

    getHeaders() {
        const headers = {};
        if (this[kOutHeaders]) {
            const keys = Object.keys(this[kOutHeaders]);
            for (let i = 0; i < keys.length; i++) {
                const entry = this[kOutHeaders][keys[i]];
                headers[keys[i]] = entry[1];
            }
        }
        return headers;
    }

    getHeaderNames() {
        return this[kOutHeaders] ? Object.keys(this[kOutHeaders]) : [];
    }

    getRawHeaderNames() {
        if (!this[kOutHeaders]) return [];
        const keys = Object.keys(this[kOutHeaders]);
        const names = [];
        for (let i = 0; i < keys.length; i++) {
            names.push(this[kOutHeaders][keys[i]][0]);
        }
        return names;
    }

    removeHeader(name) {
        if (this._header) {
            throw new ERR_HTTP_HEADERS_SENT('remove');
        }
        if (this[kOutHeaders]) {
            delete this[kOutHeaders][name.toLowerCase()];
        }
    }

    hasHeader(name) {
        return this[kOutHeaders] !== null && name.toLowerCase() in this[kOutHeaders];
    }

    _implicitHeader() {
        throw new ERR_METHOD_NOT_IMPLEMENTED('_implicitHeader()');
    }

    addTrailers(headers) {
        const keys = Object.keys(headers);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = String(headers[key]);
            if (!isValidHttpToken(String(key))) {
                throw new ERR_INVALID_HTTP_TOKEN('Trailer name', key);
            }
            if (INVALID_HEADER_CHAR_REGEX.test(value)) {
                const err = new TypeError('Invalid character in trailer content ["' + key + '"]');
                err.code = 'ERR_INVALID_CHAR';
                throw err;
            }
        }
    }

    _renderHeaders() {
        if (this._header) {
            throw new ERR_HTTP_HEADERS_SENT('render');
        }

        const headersMap = this[kOutHeaders];
        const headers = {};

        if (headersMap !== null) {
            for (const key of Object.keys(headersMap)) {
                headers[headersMap[key][0]] = headersMap[key][1];
            }
        }

        return headers;
    }

    _writeToSocket(chunk, encoding, callback) {
        const socket = this._socket;
        if (socket && typeof socket.write === 'function') {
            return socket.write(chunk, encoding, callback);
        }

        const bufferedChunk = typeof chunk === 'string'
            ? Buffer.from(chunk, encoding)
            : Buffer.from(chunk);
        this.outputData.push({ data: bufferedChunk, encoding, callback });
        this.outputSize += bufferedChunk.length;
        if (typeof callback === 'function') {
            callback();
        }
        return this.outputSize < this._highWaterMark;
    }

    write(chunk, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }

        if (this.destroyed) {
            const err = new ERR_STREAM_DESTROYED('write');
            if (typeof callback === 'function') {
                callback(err);
            }
            return false;
        }

        if (!this._header) {
            this._implicitHeader();
        }

        if (chunk === null) {
            const err = new TypeError('May not write null values to stream');
            err.code = 'ERR_STREAM_NULL_VALUES';
            throw err;
        }

        if (chunk === undefined) {
            const err = new TypeError(
                'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received undefined'
            );
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
            const err = new TypeError(
                'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received type ' +
                typeof chunk + ' (' + String(chunk) + ')'
            );
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        return this._writeToSocket(chunk, encoding, callback);
    }

    end(data, encoding, callback) {
        if (typeof data === 'function') {
            callback = data;
            data = undefined;
            encoding = undefined;
        } else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }

        if (!this._header) {
            this._implicitHeader();
        }

        if (data !== undefined && data !== null) {
            this.write(data, encoding);
        }

        this._writeToSocket('', 'latin1', () => {
            this.finished = true;
            this._writableEnded = true;
            this._writableFinished = true;
            this.outputData = [];
            this.outputSize = 0;
            if (typeof callback === 'function') {
                callback();
            }
            this.emit('finish');
        });

        return this;
    }

    setTimeout(msecs, callback) {
        if (callback) {
            this.once('timeout', callback);
        }

        if (this.socket) {
            this.socket.setTimeout(msecs);
        } else {
            this.once('socket', (socket) => {
                socket.setTimeout(msecs);
            });
        }

        return this;
    }

    appendHeader(name, value) {
        if (this._header) {
            throw new ERR_HTTP_HEADERS_SENT('set');
        }
        validateHeaderName(name);
        validateHeaderValue(name, value);
        if (this[kOutHeaders] === null) {
            this[kOutHeaders] = {};
        }
        const key = name.toLowerCase();
        const existing = this[kOutHeaders][key];
        if (existing) {
            const prev = existing[1];
            if (Array.isArray(prev)) {
                prev.push(value);
            } else {
                existing[1] = [prev, value];
            }
        } else {
            this[kOutHeaders][key] = [name, value];
        }
        return this;
    }

    cork() {
        if (!this._corked) this._corked = 0;
        this._corked++;
    }

    uncork() {
        if (!this._corked) return;
        this._corked--;
    }

    get writableCorked() {
        return this._corked || 0;
    }

    flushHeaders() {
        if (!this._header) {
            this._implicitHeader();
        }
    }

    setHeaders(headers) {
        if (headers && typeof headers[Symbol.iterator] === 'function') {
            for (const [key, value] of headers) {
                this.setHeader(key, value);
            }
        } else if (headers && typeof headers === 'object') {
            for (const key of Object.keys(headers)) {
                this.setHeader(key, headers[key]);
            }
        }
        return this;
    }

    pipe() {
        this.emit('error', new ERR_STREAM_CANNOT_PIPE());
    }

    destroy(error) {
        if (this.destroyed) {
            return this;
        }
        this.destroyed = true;
        if (error) {
            this.emit('error', error);
        }
        this.emit('close');
        return this;
    }
}

export class ClientRequest extends OutgoingMessage {
    constructor(options, callback) {
        super(options);

        if (options.method != null && typeof options.method !== 'string') {
            let received;
            if (typeof options.method === 'symbol') {
                received = ` Received type symbol (${options.method.toString()})`;
            } else if (typeof options.method === 'object') {
                const ctorName = options.method.constructor && options.method.constructor.name;
                received = ctorName ? ` Received an instance of ${ctorName}` : ` Received type object`;
            } else {
                received = ` Received type ${typeof options.method} (${String(options.method)})`;
            }
            const err = new TypeError(
                'The "options.method" property must be of type string.' + received
            );
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        validateHostOption(options, 'hostname');
        validateHostOption(options, 'host');

        if (options.method && !isValidHttpToken(options.method)) {
            throw new ERR_INVALID_HTTP_TOKEN('Method', options.method);
        }

        if (options.timeout !== undefined) {
            if (typeof options.timeout !== 'number') {
                throw new ERR_INVALID_ARG_TYPE('timeout', 'number', options.timeout);
            }
        }

        if (options.path) {
            const path = String(options.path);
            if (INVALID_PATH_REGEX.test(path)) {
                throw new ERR_UNESCAPED_CHARACTERS('Request path');
            }
        }

        this.method = (options.method || 'GET').toUpperCase();
        this.protocol = options.protocol || 'http:';

        if (this.protocol !== 'http:' && this.protocol !== 'https:') {
            const err = new TypeError('Protocol "' + this.protocol + '" not supported. Expected "http:" or "https:"');
            err.code = 'ERR_INVALID_PROTOCOL';
            throw err;
        }

        if (options.insecureHTTPParser !== undefined && typeof options.insecureHTTPParser !== 'boolean') {
            throw new ERR_INVALID_ARG_TYPE(
                'options.insecureHTTPParser',
                'boolean',
                options.insecureHTTPParser,
            );
        }

        // Resolve agent before computing port so agent.defaultPort is available
        if (options.agent === false) {
            this.agent = new Agent();
        } else if (options.agent == null) {
            this.agent = globalAgent;
        } else if (typeof options.agent.addRequest === 'function') {
            this.agent = options.agent;
        } else {
            throw new ERR_INVALID_ARG_TYPE(
                'options.agent',
                ['Agent-like Object', 'undefined', 'false'],
                options.agent,
            );
        }
        this._agentName = null;
        if (this.agent && this.agent !== false && typeof this.agent.getName === 'function') {
            this._agentName = this.agent.getName(options);
        }

        const hostname = options.hostname || options.host || 'localhost';
        const port = options.port;
        const defaultPort = options.defaultPort || (this.agent && this.agent.defaultPort);
        const protocolDefault = this.protocol === 'https:' ? 443 : 80;
        const effectivePort = (port !== undefined && port !== null) ? Number(port) : (defaultPort || protocolDefault);
        this.path = options.path || '/';
        this.hostname = hostname;
        this.port = effectivePort;
        this.host = hostname;

        const hostWithPort = hostname + ':' + effectivePort;
        const url = this.protocol + '//' + hostWithPort + this.path;

        this._rawHeaderPairs = null;
        this._usedWrite = false;
        this._bodyLength = 0;
        this._bodyChunks = [];

        const inputHeaders = options.headers;
        if (Array.isArray(inputHeaders)) {
            this._rawHeaderPairs = normalizeRawHeaderPairs(inputHeaders);
            for (const [name, value] of this._rawHeaderPairs) {
                validateHeaderName(name);
                this._mergeHeader(name, value);
            }
        } else if (inputHeaders && typeof inputHeaders === 'object') {
            for (const name of Object.keys(inputHeaders)) {
                validateHeaderName(name);
                const value = inputHeaders[name];
                if (name.toLowerCase() === 'host' && Array.isArray(value)) {
                    throw new ERR_INVALID_ARG_TYPE('options.headers.host', 'string', value);
                }
                if (this[kOutHeaders] === null) {
                    this[kOutHeaders] = {};
                }
                this[kOutHeaders][name.toLowerCase()] = [name, value];
            }
        }

        // Handle auth from URL or options
        if (options.auth && !(this[kOutHeaders] && 'authorization' in this[kOutHeaders])) {
            if (this[kOutHeaders] === null) {
                this[kOutHeaders] = {};
            }
            this[kOutHeaders]['authorization'] = ['Authorization', 'Basic ' + Buffer.from(options.auth).toString('base64')];
        }

        this.shouldKeepAlive = true;
        this._defaultKeepAlive = true;
        this._last = false;
        this._refreshShouldKeepAlive();

        this._nativeReq = new NodeHttpClientRequest(this.method, url);
        if (this._rawHeaderPairs) {
            // Array headers: preserve duplicates by using appendHeader
            for (const [name, value] of this._rawHeaderPairs) {
                if (shouldSkipNativeHeader(name, value)) {
                    continue;
                }
                this._nativeReq.appendHeader(name, headerValueForNative(name, value));
            }
        } else if (this[kOutHeaders]) {
            for (const key of Object.keys(this[kOutHeaders])) {
                const entry = this[kOutHeaders][key];
                if (shouldSkipNativeHeader(entry[0], entry[1])) {
                    continue;
                }
                this._nativeReq.setHeader(entry[0], headerValueForNative(entry[0], entry[1]));
            }
        }

        this._pendingWrites = [];
        this._bufferedBytes = 0;
        this._needDrain = false;
        this._flushPromise = Promise.resolve();
        this._nativeStarted = false;

        this.aborted = false;
        this.socket = null;
        this.reusedSocket = false;
        this._timeout = null;
        this.timeoutCb = null;
        this._closeEmitted = false;
        this._nativeAbortDeferred = false;
        this._hasCustomLookup = typeof options.lookup === 'function';
        this._response = null;
        this._joinDuplicateHeaders = !!options.joinDuplicateHeaders;

        this._initializeCustomConnection(options);

        if (this.method === 'CONNECT' && !this._useSocketTransport) {
            const connectSocket = _netConnect(this.port, this.hostname);
            this.socket = connectSocket;
            this._useSocketTransport = true;
        }

        if (typeof callback === 'function') {
            this.once('response', callback);
        }

        // AbortSignal support
        if (options.signal != null) {
            const signal = options.signal;
            if (signal.aborted) {
                // Pre-aborted: destroy synchronously (sets destroyed=true),
                // error/close deferred via nextTick so callers can attach listeners.
                this.destroy(new AbortError(signal.reason));
            } else {
                const onAbort = () => {
                    this.destroy(new AbortError(signal.reason));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                this.once('close', () => {
                    signal.removeEventListener('abort', onAbort);
                });
            }
        }

        const requestTimeout = options.timeout !== undefined ? options.timeout
            : (this.agent && this.agent.timeout != null ? this.agent.timeout : undefined);
        if (requestTimeout !== undefined && requestTimeout > 0) {
            this.setTimeout(requestTimeout);
        }

        if (onClientRequestCreated.hasSubscribers) {
            onClientRequestCreated.publish({ request: this });
        }
    }

    _implicitHeader() {
        this._refreshHeaderString();
    }

    _emitCloseOnce() {
        if (this._closeEmitted) {
            return;
        }
        this._closeEmitted = true;
        this.emit('close');
    }

    _emitRequestError(error) {
        const parsed = _parseNativeHttpError(error);
        if (onClientRequestError.hasSubscribers) {
            onClientRequestError.publish({ request: this, error: parsed });
        }
        this.emit('error', parsed);
    }

    _abortNativeRequest() {
        try {
            this._nativeReq.abort();
            this._nativeAbortDeferred = false;
        } catch (error) {
            if (!isClassBorrowConflictError(error)) {
                throw error;
            }
            this._nativeAbortDeferred = true;
        }
    }

    _initializeCustomConnection(options) {
        let createConnection;
        if (typeof options.createConnection === 'function') {
            createConnection = options.createConnection;
        } else if (this.agent && this.agent !== false && typeof this.agent.createConnection === 'function') {
            createConnection = this.agent.createConnection.bind(this.agent);
        }

        if (!createConnection) {
            return;
        }

        let oncreateCalled = false;
        const oncreate = (error, socket) => {
            if (oncreateCalled) {
                return;
            }
            oncreateCalled = true;

            if (error) {
                this._connectionFailed = true;
                process.nextTick(() => {
                    this._emitRequestError(error);
                });
                return;
            }

            if (!socket) {
                return;
            }

            this.socket = socket;
            this._useSocketTransport = true;
            if (typeof socket.once === 'function') {
                socket.once('error', (socketError) => {
                    this._emitRequestError(socketError);
                });
            }
        };

        try {
            const maybeSocket = createConnection(options, oncreate);
            if (maybeSocket) {
                oncreate(null, maybeSocket);
            }
        } catch (error) {
            oncreate(error);
        }
    }

    _mergeHeader(name, value) {
        const lower = String(name).toLowerCase();
        if (this[kOutHeaders] === null) {
            this[kOutHeaders] = {};
        }
        const existing = this[kOutHeaders][lower];

        if (isCookieHeader(name) && existing) {
            this[kOutHeaders][lower] = [
                existing[0],
                mergeCookieHeaderValues(existing[1], value),
            ];
            return;
        }

        this[kOutHeaders][lower] = [String(name), value];
    }

    _refreshHeaderString() {
        let rendered = `${this.method} ${this.path} HTTP/1.1\r\n`;

        if (Array.isArray(this._rawHeaderPairs)) {
            for (const [name, rawValue] of this._rawHeaderPairs) {
                const wireValues = expandHeaderValuesForWire(name, rawValue);
                for (const value of wireValues) {
                    rendered += `${name}: ${value}\r\n`;
                }
            }
        } else if (this[kOutHeaders]) {
            for (const key of Object.keys(this[kOutHeaders])) {
                const entry = this[kOutHeaders][key];
                const wireValues = expandHeaderValuesForWire(entry[0], entry[1]);
                for (const value of wireValues) {
                    rendered += `${entry[0]}: ${value}\r\n`;
                }
            }
        }

        rendered += '\r\n';
        this._header = rendered;
    }

    _computeShouldKeepAliveFromAgent() {
        return this.agent !== false;
    }

    _refreshShouldKeepAlive() {
        this.shouldKeepAlive = this._computeShouldKeepAliveFromAgent();
        this._last = !this.shouldKeepAlive;

        const connectionHeader = this.getHeader('connection');
        if (hasConnectionToken(connectionHeader, 'close')) {
            this.shouldKeepAlive = false;
            this._last = true;
        } else if (hasConnectionToken(connectionHeader, 'keep-alive')) {
            this.shouldKeepAlive = true;
            this._last = false;
        }
    }

    _applyDefaultBodyHeaders() {
        if (this.hasHeader('content-length') || this.hasHeader('transfer-encoding')) {
            return;
        }

        if (this._bodyLength > 0) {
            this.setHeader('Content-Length', String(this._bodyLength));
            return;
        }

        if (this.method !== 'GET' && this.method !== 'HEAD') {
            this.setHeader('Content-Length', '0');
        }
    }

    setHeader(name, value) {
        if (this._nativeStarted || this.headersSent) {
            throw new ERR_HTTP_HEADERS_SENT('set');
        }
        validateHeaderName(name);
        validateHeaderValue(name, value);
        if (this[kOutHeaders] === null) {
            this[kOutHeaders] = {};
        }
        this[kOutHeaders][name.toLowerCase()] = [name, value];
        if (shouldSkipNativeHeader(name, value)) {
            this._nativeReq.removeHeader(name);
        } else {
            this._nativeReq.setHeader(name, headerValueForNative(name, value));
        }
        this._rawHeaderPairs = null;
        this._header = null;
        this._refreshShouldKeepAlive();
        return this;
    }

    removeHeader(name) {
        if (this._nativeStarted || this.headersSent) {
            throw new ERR_HTTP_HEADERS_SENT('remove');
        }
        if (this[kOutHeaders]) {
            delete this[kOutHeaders][name.toLowerCase()];
        }
        this._nativeReq.removeHeader(name);
        this._rawHeaderPairs = null;
        this._header = null;
        this._refreshShouldKeepAlive();
    }

    flushHeaders() {
        if (!this._header) {
            this._refreshHeaderString();
        }
    }

    setTimeout(ms, callback) {
        this._timeout = ms;
        if (callback) this.once('timeout', callback);
        return this;
    }

    clearTimeout(callback) {
        return this.setTimeout(0, callback);
    }

    setNoDelay() {
        return this;
    }

    setSocketKeepAlive() {
        return this;
    }

    write(chunk, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }

        this._usedWrite = true;

        let bodyChunk;
        if (typeof chunk === 'string') {
            bodyChunk = Buffer.from(chunk, encoding || 'utf8');
        } else if (chunk instanceof Uint8Array) {
            bodyChunk = Buffer.from(chunk);
        } else if (Buffer.isBuffer(chunk)) {
            bodyChunk = chunk;
        } else if (chunk != null) {
            bodyChunk = Buffer.from(String(chunk), 'utf8');
        }

        if (bodyChunk && bodyChunk.length > 0) {
            this._bodyLength += bodyChunk.length;
            this._bodyChunks.push(bodyChunk);

            if (!this._useSocketTransport) {
                this._pendingWrites.push({ chunk: bodyChunk, cb: typeof callback === 'function' ? callback : null });
                this._bufferedBytes += bodyChunk.length;
                this._scheduleFlush();
            }
        } else if (typeof callback === 'function') {
            callback();
        }

        if (this._useSocketTransport) {
            if (typeof callback === 'function') callback();
            return this._bodyLength < (16 * 1024);
        }

        const ret = this._bufferedBytes < (16 * 1024);
        if (!ret) this._needDrain = true;
        return ret;
    }

    end(data, encoding, callback) {
        if (typeof data === 'function') {
            callback = data;
            data = undefined;
            encoding = undefined;
        } else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }

        if (this._endPromise) {
            if (typeof callback === 'function') callback();
            return this;
        }

        if (data != null) {
            this.write(data, encoding);
        }

        this._applyDefaultBodyHeaders();

        this._writableEnded = true;
        this._endCallback = callback;
        this._endPromise = this._sendThroughAgent();
        return this;
    }

    _scheduleFlush() {
        this._flushPromise = this._flushPromise
            .then(() => this._flushLoop())
            .catch((err) => {
                if (!this.destroyed && !this.aborted) {
                    this._emitRequestError(err);
                }
            });
    }

    async _flushLoop() {
        if (this.destroyed || this.aborted) return;

        // Don't start the native request until end() has been called.
        // Starting early would lock headers before _applyDefaultBodyHeaders
        // has a chance to set Content-Length, and can cause Rust borrow
        // conflicts when end() later tries to modify headers.
        if (!this._nativeStarted && !this._writableEnded) {
            return;
        }

        // Start native request on first flush (locks headers)
        if (!this._nativeStarted) {
            await this._nativeReq.start();
            this._nativeStarted = true;
            this.headersSent = true;
        }

        while (this._pendingWrites.length > 0) {
            if (this.destroyed || this.aborted) return;
            const { chunk, cb } = this._pendingWrites.shift();

            await this._nativeReq.writeStream(new Uint8Array(chunk));

            this._bufferedBytes -= chunk.length;
            if (cb) {
                try { cb(null); } catch (_) {}
            }

            if (this._needDrain && this._bufferedBytes < (16 * 1024)) {
                this._needDrain = false;
                this.emit('drain');
            }
        }
    }

    _sendThroughAgent() {
        if (this.agent && this.agent !== false && typeof this.agent._scheduleRequest === 'function') {
            return this.agent._scheduleRequest(this._agentName, () => this._doSend(), this);
        }
        return this._doSend();
    }

    _setupMockSocket() {
        if (this.socket || this._useSocketTransport) {
            return;
        }
        let mockSocket = null;
        const agent = this.agent;
        const name = this._agentName;

        // Try to reuse a free socket from the agent pool
        if (agent && name) {
            const freeList = agent.freeSockets[name];
            if (freeList && freeList.length > 0) {
                const scheduling = agent.scheduling || 'lifo';
                if (scheduling === 'fifo') {
                    for (let i = 0; i < freeList.length; i++) {
                        if (!freeList[i].destroyed) {
                            mockSocket = freeList.splice(i, 1)[0];
                            break;
                        }
                    }
                } else {
                    for (let i = freeList.length - 1; i >= 0; i--) {
                        if (!freeList[i].destroyed) {
                            mockSocket = freeList.splice(i, 1)[0];
                            break;
                        }
                    }
                }
                if (mockSocket) {
                    if (!freeList.length) delete agent.freeSockets[name];
                    this.reusedSocket = true;
                    // Reset socket state for reuse
                    mockSocket._clearTimeoutTimer();
                    mockSocket.timeout = undefined;
                    mockSocket.destroyed = false;
                    mockSocket.writable = true;
                    mockSocket.readable = true;
                    // Remove old free-socket error listener
                    if (mockSocket._freeSocketErrorListener) {
                        mockSocket.removeListener('error', mockSocket._freeSocketErrorListener);
                        mockSocket._freeSocketErrorListener = null;
                    }
                    // Call agent.reuseSocket if available
                    if (typeof agent.reuseSocket === 'function') {
                        agent.reuseSocket(mockSocket, this);
                    }
                }
            }
        }

        if (!mockSocket) {
            mockSocket = new FakeAgentSocket();
            this.reusedSocket = false;

            // Install permanent agent-level listeners (once per socket)
            if (agent && name) {
                // Timeout handler: forward to request, then destroy
                mockSocket.on('timeout', function onAgentTimeout() {
                    const req = mockSocket._httpMessage;
                    if (req) {
                        req.emit('timeout');
                    }
                    mockSocket.destroy();
                });

                // Close handler: remove from agent pools
                mockSocket.on('close', function onAgentClose() {
                    agent._removeSocket(name, mockSocket);
                    agent._removeFreeSocket(name, mockSocket);
                });
            }
        }

        mockSocket._httpMessage = this;
        this.socket = mockSocket;

        // Set up request's timeoutCb (simulating Node's listenSocketTimeout)
        if (!this.timeoutCb) {
            const req = this;
            this.timeoutCb = function emitRequestTimeout() {
                req.emit('timeout');
            };
        }
        mockSocket.once('timeout', this.timeoutCb);

        // Apply timeout value to the socket
        const timeout = this._timeout || (agent && agent.timeout) || 0;
        if (timeout > 0) {
            mockSocket.timeout = timeout;
        }

        if (agent && name) {
            agent._addSocket(name, mockSocket);
        }
        this.emit('socket', mockSocket);
    }

    _cleanupMockSocket() {
        if (this.socket && this.socket._isFakeAgentSocket) {
            const socket = this.socket;
            const agent = this.agent;
            const name = this._agentName;

            // Remove request-specific timeout listener
            if (this.timeoutCb) {
                socket.removeListener('timeout', this.timeoutCb);
            }

            if (agent && name) {
                agent._removeSocket(name, socket);

                if (this.shouldKeepAlive && agent.keepAlive && !socket.destroyed) {
                    // Call keepSocketAlive (may set timeout on the socket)
                    let shouldKeep = true;
                    if (typeof agent.keepSocketAlive === 'function') {
                        shouldKeep = agent.keepSocketAlive(socket);
                    }

                    if (shouldKeep && !socket.destroyed) {
                        socket._httpMessage = null;

                        if (!agent.freeSockets[name]) {
                            agent.freeSockets[name] = [];
                        }
                        if (agent.freeSockets[name].length < agent.maxFreeSockets) {
                            agent.freeSockets[name].push(socket);

                            const onFreeSocketError = () => {
                                agent._removeFreeSocket(name, socket);
                                socket.destroy();
                            };
                            socket.once('error', onFreeSocketError);
                            socket._freeSocketErrorListener = onFreeSocketError;

                            socket.emit('free');
                            agent.emit('free', socket, {
                                host: this.hostname,
                                port: this.port,
                            });
                            return;
                        }
                    }

                    // keepSocketAlive returned false or maxFreeSockets exceeded
                    socket.destroy();
                    return;
                }
            }

            socket.destroy();
        }
    }

    async _doSend() {
        if (this._useSocketTransport) {
            return this._doSendViaSocket();
        }

        try {
            if (onClientRequestStart.hasSubscribers) {
                onClientRequestStart.publish({ request: this });
            }

            this._refreshHeaderString();

            // Flush pending writes and start the native request.
            // We call _flushLoop() directly instead of chaining via
            // _flushPromise.then() to avoid an extra microtask hop that
            // can cause the wstd reactor to exit prematurely when no WASI
            // pollables are registered yet. We first wait for any in-flight
            // flush from a prior write() to complete.
            await this._flushPromise;
            if (!this._nativeStarted || this._pendingWrites.length > 0) {
                await this._flushLoop();
            }

            if (this.aborted || this.destroyed) {
                this._cleanupMockSocket();
                return;
            }

            this._setupMockSocket();

            // If a custom lookup function was provided, the connection should
            // hang (simulating DNS resolution that never completes in Node.js).
            if (this._hasCustomLookup) {
                return;
            }

            // Finish the request body
            await this._nativeReq.finish(undefined);

            // Emit finish AFTER body is committed
            this._writableFinished = true;
            if (typeof this._endCallback === 'function') {
                const cb = this._endCallback;
                this._endCallback = null;
                cb();
            }
            this.emit('finish');

            if (this.aborted || this.destroyed) {
                this._cleanupMockSocket();
                return;
            }

            // Wait for and process the response
            await this._nativeReq.waitForResponse();

            if (this._nativeAbortDeferred) {
                this._abortNativeRequest();
            }

            if (this.aborted || this.destroyed) {
                this._cleanupMockSocket();
                return;
            }

            const nativeRes = this._nativeReq.getResponse();

            // When createConnection failed, suppress the response event —
            // only the error event (emitted by oncreate) should fire.
            if (this._connectionFailed && nativeRes) {
                if (typeof nativeRes.discardBody === 'function') {
                    nativeRes.discardBody();
                }
            } else if (nativeRes) {
                const res = new IncomingMessage(nativeRes, { joinDuplicateHeaders: this._joinDuplicateHeaders });

                // Link response to the request's mock socket
                if (this.socket) {
                    res.socket = this.socket;
                    res.client = this.socket;
                }

                const responseConnectionHeader = res.headers.connection;

                const responseShouldKeepAlive = shouldKeepAliveFromResponse(
                    res.httpVersion,
                    responseConnectionHeader
                );
                if (this.shouldKeepAlive && !responseShouldKeepAlive) {
                    this.shouldKeepAlive = false;
                    this._last = true;
                }

                if (onClientResponseFinish.hasSubscribers) {
                    onClientResponseFinish.publish({ request: this, response: res });
                }
                this._response = res;
                this.emit('response', res);

                const hasDataListeners = res.listenerCount('data') > 0;
                const hasEndListeners = res.listenerCount('end') > 0;
                const hasReadableListeners = res.listenerCount('readable') > 0;

                if (hasDataListeners || hasEndListeners) {
                    res.resume();
                } else if (hasReadableListeners) {
                    res.read(0);
                } else if (res._nativeRes && typeof res._nativeRes.discardBody === 'function') {
                    res._nativeRes.discardBody();
                    res.complete = true;
                    res.push(null);
                    res.resume();
                }
            }

        } catch (err) {
            if (this.aborted || this.destroyed) {
                this._cleanupMockSocket();
                return;
            }
            this._emitRequestError(err);
        }
        this._cleanupMockSocket();
        this._emitCloseOnce();
    }

    async _doSendViaSocket() {
        try {
            if (onClientRequestStart.hasSubscribers) {
                onClientRequestStart.publish({ request: this });
            }

            if (!this.hasHeader('host')) {
                const hostValue = this.port && this.port !== 80 && this.port !== 443
                    ? this.hostname + ':' + this.port
                    : this.hostname;
                this.setHeader('Host', hostValue);
            }

            this._refreshHeaderString();
            this.headersSent = true;

            const socket = this.socket;

            if (socket && typeof socket.write === 'function') {
                socket.write(this._header);
                for (const chunk of this._bodyChunks) {
                    socket.write(chunk);
                }
            }

            await Promise.resolve();

            this._writableFinished = true;
            if (typeof this._endCallback === 'function') {
                const cb = this._endCallback;
                this._endCallback = null;
                cb();
            }
            this.emit('finish');

            if (this.aborted || this.destroyed) {
                return;
            }

            const isConnect = this.method === 'CONNECT';
            const parsed = isConnect
                ? await _readConnectResponseHeaders(socket)
                : await _readHttpResponseFromSocket(socket);

            if (this.aborted || this.destroyed) {
                return;
            }

            const res = new IncomingMessage(null);
            res.statusCode = parsed.statusCode;
            res.statusMessage = parsed.statusMessage;
            applyHttpVersion(res, parsed.httpVersion);

            const parsedHeaders = parseIncomingHeaders(
                parsed.headers.map(([name, value]) => [name, value])
            );
            res.rawHeaders = parsedHeaders.rawHeaders;
            res.headers = parsedHeaders.headers;
            res.headersDistinct = parsedHeaders.headersDistinct;

            if (isConnect) {
                res.complete = true;
                this.emit('connect', res, socket, Buffer.alloc(0));
            } else {
                res.socket = socket;
                res.client = socket;
                if (socket && typeof socket.readableHighWaterMark === 'number' && res._readableState) {
                    res._readableState.highWaterMark = socket.readableHighWaterMark;
                }

                const responseConnectionHeader = res.headers.connection;
                const responseShouldKeepAlive = shouldKeepAliveFromResponse(
                    res.httpVersion,
                    responseConnectionHeader
                );
                if (this.shouldKeepAlive && !responseShouldKeepAlive) {
                    this.shouldKeepAlive = false;
                    this._last = true;
                }

                if (onClientResponseFinish.hasSubscribers) {
                    onClientResponseFinish.publish({ request: this, response: res });
                }
                this.emit('response', res);

                if (parsed.body.length > 0) {
                    res.push(Buffer.from(parsed.body));
                }
                res.complete = true;
                res.push(null);
            }

        } catch (err) {
            if (this.aborted || this.destroyed) {
                return;
            }
            this._emitRequestError(err);
        }
        this._emitCloseOnce();
    }

    abort() {
        if (this.aborted || this.destroyed) {
            return;
        }

        this.aborted = true;
        this.destroyed = true;
        this._abortNativeRequest();
        if (this._response) {
            this._response.aborted = true;
            this._response.destroyed = true;
            this._response.emit('aborted');
        }
        const targetPort = this.port;
        process.nextTick(() => {
            this.emit('abort');
            this._emitCloseOnce();
            if (targetPort) {
                _signalClientAbort(+targetPort);
            }
        });
    }

    destroy(error) {
        if (this.destroyed) return this;

        this.destroyed = true;

        this._abortNativeRequest();

        if (!error && !this._response) {
            // Request destroyed before receiving a response — emit ECONNRESET
            // matching Node.js behavior for destroyed pending requests.
            error = new Error('socket hang up');
            error.code = 'ECONNRESET';
        }

        // Defer error/close to nextTick so callers can attach listeners
        // after construction (e.g., pre-aborted AbortSignal case).
        if (error) {
            process.nextTick(() => {
                this.emit('error', error);
                this._emitCloseOnce();
            });
        } else {
            process.nextTick(() => {
                this._emitCloseOnce();
            });
        }

        return this;
    }
}

// ===== Server =====

import {
    Server as _Server,
    ServerResponse as _ServerResponse,
    createServer as _createServer,
    _signalClientAbort,
} from '__wasm_rquickjs_builtin/node_http_server';

import { connect as _netConnect } from 'node:net';

export const Server = _Server;
export const ServerResponse = _ServerResponse;
export const createServer = _createServer;

// ===== request / get =====

export function request(url, options, callback) {
    let opts;
    if (typeof url === 'string') {
        opts = { ...parseUrl(url), ...(typeof options === 'object' ? options : {}) };
        if (typeof options === 'function') callback = options;
    } else if (url instanceof URL) {
        // Node.js preserves custom enumerable properties attached to URL objects
        // (for example: `url.headers = {...}`) when building request options.
        opts = {
            ...url,
            ...urlToOptions(url),
            ...(typeof options === 'object' ? options : {}),
        };
        if (typeof options === 'function') callback = options;
    } else {
        opts = url;
        callback = typeof options === 'function' ? options : callback;
    }
    return new ClientRequest(opts, callback);
}

export function get(url, options, callback) {
    const req = request(url, options, callback);
    req.end();
    return req;
}

// ===== WebSocket re-exports (per Node.js convention) =====
// These are lazily read from globalThis because the websocket WIRE_JS init script
// sets them after module evaluation but before any user code runs.
export const WebSocket = globalThis.WebSocket;
export const WebSocketStream = globalThis.WebSocketStream;
export const MessageEvent = globalThis.MessageEvent;
export const CloseEvent = globalThis.CloseEvent;
export const ErrorEvent = globalThis.ErrorEvent;

// ===== Default export =====

const _default = {
    METHODS,
    STATUS_CODES,
    maxHeaderSize,
    validateHeaderName,
    validateHeaderValue,
    Agent,
    globalAgent,
    OutgoingMessage,
    ClientRequest,
    IncomingMessage,
    Server,
    ServerResponse,
    createServer,
    request,
    get,
};
// Add WebSocket properties as lazy getters so they resolve after WIRE_JS runs
Object.defineProperties(_default, {
    WebSocket: { get() { return globalThis.WebSocket; }, enumerable: true },
    WebSocketStream: { get() { return globalThis.WebSocketStream; }, enumerable: true },
    MessageEvent: { get() { return globalThis.MessageEvent; }, enumerable: true },
    CloseEvent: { get() { return globalThis.CloseEvent; }, enumerable: true },
    ErrorEvent: { get() { return globalThis.ErrorEvent; }, enumerable: true },
});
export default _default;
