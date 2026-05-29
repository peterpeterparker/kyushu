// node:http server implementation
import { Server as NetServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import Readable from '__wasm_rquickjs_builtin/internal/streams/readable';
import { ERR_HTTP_BODY_NOT_ALLOWED, ERR_HTTP_CONTENT_LENGTH_MISMATCH, ERR_HTTP_HEADERS_SENT, ERR_HTTP_SOCKET_ASSIGNED, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from '__wasm_rquickjs_builtin/internal/errors';
// STATUS_CODES is duplicated here to avoid circular dependency with node:http
const STATUS_CODES = {
    100: 'Continue', 101: 'Switching Protocols', 102: 'Processing', 103: 'Early Hints',
    200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information',
    204: 'No Content', 205: 'Reset Content', 206: 'Partial Content', 207: 'Multi-Status',
    208: 'Already Reported', 226: 'IM Used',
    300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other',
    304: 'Not Modified', 305: 'Use Proxy', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable',
    407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
    411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large',
    414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable',
    417: 'Expectation Failed', 418: "I'm a Teapot", 421: 'Misdirected Request',
    422: 'Unprocessable Entity', 423: 'Locked', 424: 'Failed Dependency', 425: 'Too Early',
    426: 'Upgrade Required', 428: 'Precondition Required', 429: 'Too Many Requests',
    431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
    503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates', 507: 'Insufficient Storage', 508: 'Loop Detected',
    510: 'Not Extended', 511: 'Network Authentication Required',
};

// ===== Parser States =====

const HEADERS = 0;
const BODY_CONTENT_LENGTH = 1;
const BODY_CHUNKED = 2;
const IDLE = 3;
const AWAITING_RESPONSE = 4;

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');

// ===== Header helpers =====

const COMMA_JOIN_HEADERS = new Set([
    'accept', 'accept-charset', 'accept-encoding', 'accept-language',
    'accept-ranges', 'access-control-allow-headers',
    'access-control-allow-methods', 'access-control-allow-origin',
    'access-control-expose-headers', 'allow', 'cache-control',
    'content-encoding', 'content-language', 'if-match', 'if-none-match',
    'link', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'vary', 'via',
    'warning',
]);

const COOKIE_HEADER = 'cookie';
const SET_COOKIE_HEADER = 'set-cookie';
const INVALID_HEADER_CHAR_REGEX = /[^\t\x20-\x7e\x80-\xff]/;

const SERVER_NO_DUPLICATE_HEADERS = new Set([
    'age', 'authorization', 'content-length', 'content-type', 'etag',
    'expires', 'from', 'host', 'if-modified-since', 'if-unmodified-since',
    'last-modified', 'location', 'max-forwards', 'proxy-authorization',
    'referer', 'retry-after', 'server', 'user-agent',
]);

function parseHeaders(rawPairs, joinDuplicateHeaders) {
    const headers = {};
    const headersDistinct = {};
    const rawHeaders = [];

    for (let i = 0; i < rawPairs.length; i += 2) {
        const name = rawPairs[i];
        const value = rawPairs[i + 1];
        rawHeaders.push(name, value);
        const lower = name.toLowerCase();

        if (!headersDistinct[lower]) {
            headersDistinct[lower] = [];
        }
        headersDistinct[lower].push(value);

        if (lower === SET_COOKIE_HEADER) {
            if (Array.isArray(headers[lower])) {
                headers[lower].push(value);
            } else if (headers[lower] !== undefined) {
                headers[lower] = [headers[lower], value];
            } else {
                headers[lower] = [value];
            }
        } else if (lower === COOKIE_HEADER) {
            if (headers[lower] !== undefined) {
                headers[lower] += '; ' + value;
            } else {
                headers[lower] = value;
            }
        } else if (joinDuplicateHeaders) {
            if (headers[lower] !== undefined) {
                headers[lower] += ', ' + value;
            } else {
                headers[lower] = value;
            }
        } else {
            if (SERVER_NO_DUPLICATE_HEADERS.has(lower)) {
                if (headers[lower] === undefined) {
                    headers[lower] = value;
                }
            } else if (headers[lower] !== undefined) {
                headers[lower] += ', ' + value;
            } else {
                headers[lower] = value;
            }
        }
    }

    return { headers, headersDistinct, rawHeaders };
}

// ===== ServerIncomingMessage (extends Readable) =====

function ServerIncomingMessage(socket, method, url, httpVersion, rawHeaderPairs, joinDuplicateHeaders) {
    if (!(this instanceof ServerIncomingMessage)) {
        return new ServerIncomingMessage(socket, method, url, httpVersion, rawHeaderPairs, joinDuplicateHeaders);
    }

    Readable.call(this, {});

    this.socket = socket;
    this.connection = socket;
    this.method = method;
    this.url = url;
    this.httpVersion = httpVersion;

    const parts = httpVersion.split('.');
    this.httpVersionMajor = parseInt(parts[0], 10) || 1;
    this.httpVersionMinor = parseInt(parts[1], 10) || 1;

    const parsed = parseHeaders(rawHeaderPairs, !!joinDuplicateHeaders);
    this.headers = parsed.headers;
    this.headersDistinct = parsed.headersDistinct;
    this.rawHeaders = parsed.rawHeaders;

    this.complete = false;
    this.aborted = false;
    this.trailers = {};
    this.trailersDistinct = {};
    this._timeout = null;
}

Object.setPrototypeOf(ServerIncomingMessage.prototype, Readable.prototype);
Object.setPrototypeOf(ServerIncomingMessage, Readable);

ServerIncomingMessage.prototype._read = function _read() {
    // no-op: parser pushes data via this.push()
};

ServerIncomingMessage.prototype.setTimeout = function setTimeout(ms, cb) {
    this._timeout = ms;
    if (cb) this.once('timeout', cb);
    return this;
};

// ===== Status code validation =====

function _validateStatusCode(statusCode) {
    if (statusCode === undefined) {
        const err = new RangeError('Invalid status code: undefined');
        err.code = 'ERR_HTTP_INVALID_STATUS_CODE';
        throw err;
    }
    if (typeof statusCode === 'string') {
        // Try parsing as integer
        const parsed = parseInt(statusCode, 10);
        if (isNaN(parsed) || String(parsed) !== statusCode || parsed < 100 || parsed > 999) {
            const err = new RangeError('Invalid status code: ' + statusCode);
            err.code = 'ERR_HTTP_INVALID_STATUS_CODE';
            throw err;
        }
        return parsed;
    }
    if (typeof statusCode !== 'number' || !Number.isFinite(statusCode) || statusCode < 100 || statusCode > 999 || statusCode !== (statusCode | 0)) {
        const code = typeof statusCode === 'number' ? String(statusCode) :
            (typeof statusCode === 'object' && statusCode !== null) ? (Array.isArray(statusCode) ? '[]' : '{}') :
            String(statusCode);
        const err = new RangeError('Invalid status code: ' + code);
        err.code = 'ERR_HTTP_INVALID_STATUS_CODE';
        throw err;
    }
    return statusCode;
}

function _validateStatusMessage(statusMessage) {
    const message = String(statusMessage);
    if (INVALID_HEADER_CHAR_REGEX.test(message)) {
        const err = new TypeError('Invalid character in statusMessage');
        err.code = 'ERR_INVALID_CHAR';
        throw err;
    }
    return message;
}

// ===== ServerResponse =====

function ServerResponse(req, options) {
    if (!(this instanceof ServerResponse)) return new ServerResponse(req, options);
    EventEmitter.call(this);

    this.req = req;
    this.socket = req.socket;
    this.connection = req.socket;
    this.statusCode = 200;
    this.statusMessage = undefined;
    this.sendDate = true;
    this.headersSent = false;
    this.finished = false;
    this._writableEnded = false;
    this._headers = {};
    this._headerNames = {};
    this._chunked = false;
    this._hasBody = true;
    this._keepAlive = false;
    this._keepAliveTimeout = 5000;
    this._keepAliveMaxRequests = 0;
    this._sentContentLength = false;
    this._headersSentWire = false;
    this._rejectNonStandardBodyWrites = !!(options && options.rejectNonStandardBodyWrites);

    // Properties needed by stream.finished / end-of-stream detection
    this._sent100 = false;
    this._closed = false;
    this._destroyed = false;
    this._errored = undefined;
    this._defaultKeepAlive = false;
    this._removedConnection = false;
    this._removedContLen = false;
    this._removedTE = false;
    this._outputSize = 0;

    // strictContentLength enforcement
    this.strictContentLength = false;
    this._bytesWritten = 0;

    // OutgoingMessage-compatible properties
    this.writable = true;
}

Object.setPrototypeOf(ServerResponse.prototype, EventEmitter.prototype);
Object.setPrototypeOf(ServerResponse, EventEmitter);

ServerResponse.prototype.assignSocket = function assignSocket(socket) {
    if (this.socket) {
        throw new ERR_HTTP_SOCKET_ASSIGNED();
    }
    this.socket = socket;
    this.connection = socket;
    socket._httpMessage = this;
};

ServerResponse.prototype.detachSocket = function detachSocket(socket) {
    if (socket._httpMessage === this) {
        socket._httpMessage = null;
    }
    this.socket = null;
    this.connection = null;
};

Object.defineProperty(ServerResponse.prototype, 'writableEnded', {
    get() { return this._writableEnded; },
});

Object.defineProperty(ServerResponse.prototype, 'writableFinished', {
    get() { return this.finished; },
});

Object.defineProperty(ServerResponse.prototype, 'closed', {
    get() { return this._closed; },
});

Object.defineProperty(ServerResponse.prototype, 'destroyed', {
    get() { return this._destroyed; },
    set(value) { this._destroyed = value; },
});

Object.defineProperty(ServerResponse.prototype, 'errored', {
    get() { return this._errored; },
});

Object.defineProperty(ServerResponse.prototype, 'writableCorked', {
    get() { return this.socket ? this.socket.writableCorked : 0; },
});

Object.defineProperty(ServerResponse.prototype, 'writableObjectMode', {
    get() { return false; },
});

Object.defineProperty(ServerResponse.prototype, 'writableHighWaterMark', {
    get() { return this.socket ? this.socket.writableHighWaterMark : 16 * 1024; },
});

Object.defineProperty(ServerResponse.prototype, 'writableLength', {
    get() { return this._outputSize; },
});

ServerResponse.prototype._implicitHeader = function _implicitHeader() {
    this.writeHead(this.statusCode);
};

ServerResponse.prototype.setHeader = function setHeader(name, value) {
    if (this._headersSentWire) {
        throw new ERR_HTTP_HEADERS_SENT('set');
    }
    if (typeof name !== 'string' || !/^[\x21-\x7e]+$/.test(name)) {
        const err = new TypeError(`Header name must be a valid HTTP token ["${String(name)}"]`);
        err.code = 'ERR_INVALID_HTTP_TOKEN';
        throw err;
    }
    if (value === undefined) {
        const err = new TypeError(`Invalid value "${value}" for header "${name}"`);
        err.code = 'ERR_HTTP_INVALID_HEADER_VALUE';
        throw err;
    }
    if (INVALID_HEADER_CHAR_REGEX.test(value)) {
        const err = new TypeError(`Invalid character in header content ["${name}"]`);
        err.code = 'ERR_INVALID_CHAR';
        throw err;
    }
    const lower = name.toLowerCase();
    this._headers[lower] = value;
    this._headerNames[lower] = name;
    return this;
};

ServerResponse.prototype.getHeader = function getHeader(name) {
    return this._headers[name.toLowerCase()];
};

ServerResponse.prototype.hasHeader = function hasHeader(name) {
    return name.toLowerCase() in this._headers;
};

ServerResponse.prototype.removeHeader = function removeHeader(name) {
    if (this._headersSentWire) {
        throw new ERR_HTTP_HEADERS_SENT('remove');
    }
    const lower = name.toLowerCase();
    if (lower === 'date') {
        // Match Node.js behavior: removing Date disables automatic Date generation.
        this.sendDate = false;
    }
    delete this._headers[lower];
    delete this._headerNames[lower];
};

ServerResponse.prototype.setHeaders = function setHeaders(headers) {
    if (this.headersSent) {
        throw new ERR_HTTP_HEADERS_SENT('set');
    }
    if (!(headers instanceof globalThis.Headers) && !(headers instanceof Map)) {
        throw new ERR_INVALID_ARG_TYPE('headers', ['Headers', 'Map'], headers);
    }

    if (headers instanceof globalThis.Headers) {
        for (const [key, value] of headers) {
            if (key.toLowerCase() === 'set-cookie') {
                const cookies = typeof headers.getSetCookie === 'function'
                    ? headers.getSetCookie()
                    : value.split(', ');
                if (cookies.length > 0) {
                    this.setHeader(key, cookies);
                }
            } else {
                this.setHeader(key, value);
            }
        }
    } else {
        for (const [key, value] of headers) {
            this.setHeader(key, value);
        }
    }

    return this;
};

ServerResponse.prototype.getHeaders = function getHeaders() {
    const result = {};
    for (const lower of Object.keys(this._headers)) {
        result[lower] = this._headers[lower];
    }
    return result;
};

ServerResponse.prototype.getHeaderNames = function getHeaderNames() {
    return Object.keys(this._headers);
};

ServerResponse.prototype.getRawHeaderNames = function getRawHeaderNames() {
    return Object.keys(this._headerNames).map(k => this._headerNames[k]);
};

ServerResponse.prototype.writeHead = function writeHead(statusCode, statusMessage, headers) {
    if (this.headersSent) {
        throw new ERR_HTTP_HEADERS_SENT('render');
    }

    if (typeof statusMessage === 'object' && statusMessage !== null) {
        headers = statusMessage;
        statusMessage = undefined;
    }

    // Validate status code
    statusCode = _validateStatusCode(statusCode);

    this.statusCode = statusCode;
    if (statusMessage !== undefined) {
        this.statusMessage = _validateStatusMessage(statusMessage);
    } else if (this.statusMessage === undefined) {
        this.statusMessage = STATUS_CODES[statusCode] || 'unknown';
    } else {
        this.statusMessage = _validateStatusMessage(this.statusMessage);
    }

    if (headers) {
        if (Array.isArray(headers)) {
            // Support both flat [k, v, k, v] and nested [[k, v], [k, v]] formats
            if (headers.length > 0 && Array.isArray(headers[0])) {
                for (let i = 0; i < headers.length; i++) {
                    const name = headers[i][0];
                    const value = headers[i][1];
                    const lower = name.toLowerCase();
                    // For duplicate headers (e.g., set-cookie), accumulate into array
                    if (lower in this._headers) {
                        const existing = this._headers[lower];
                        if (Array.isArray(existing)) {
                            existing.push(value);
                        } else {
                            this._headers[lower] = [existing, value];
                        }
                    } else {
                        this._headers[lower] = value;
                        this._headerNames[lower] = name;
                    }
                }
            } else {
                if (headers.length % 2 !== 0) {
                    const err = new TypeError(
                        'The argument \'headers\' is invalid. Received ' + JSON.stringify(headers)
                    );
                    err.code = 'ERR_INVALID_ARG_VALUE';
                    throw err;
                }

                // Match Node.js writeHead(array) semantics:
                // 1) remove existing values for names present in the array,
                // 2) append array values in order while preserving duplicates.
                for (let i = 0; i < headers.length; i += 2) {
                    this.removeHeader(headers[i]);
                }

                for (let i = 0; i < headers.length; i += 2) {
                    const name = headers[i];
                    const value = headers[i + 1];
                    const lower = String(name).toLowerCase();

                    if (lower in this._headers) {
                        const existing = this._headers[lower];
                        const merged = Array.isArray(existing)
                            ? [...existing, value]
                            : [existing, value];
                        this.setHeader(name, merged);
                    } else {
                        this.setHeader(name, value);
                    }
                }
            }
        } else {
            for (const name of Object.keys(headers)) {
                this.setHeader(name, headers[name]);
            }
        }
    }

    this.headersSent = true;
    return this;
};

ServerResponse.prototype._buildHeaderString = function _buildHeaderString() {
    if (this._headersSentWire) return '';
    this._headersSentWire = true;
    this.headersSent = true;

    const statusMessage = _validateStatusMessage(
        this.statusMessage || STATUS_CODES[this.statusCode] || 'Unknown',
    );
    // Node.js always responds with HTTP/1.1 regardless of request version
    let head = 'HTTP/1.1 ' + this.statusCode + ' ' + statusMessage + '\r\n';
    // Use request HTTP version for chunked encoding decision
    const requestHttpVersion = this.req.httpVersion || '1.1';

    const code = this.statusCode;
    const isHeadRequest = this.req.method === 'HEAD';
    const isNoBodyStatus = code === 204 || code === 304 || (code >= 100 && code < 200);
    this._hasBody = !(isNoBodyStatus || isHeadRequest);

    if (this.sendDate && !this.hasHeader('date')) {
        head += 'Date: ' + (new Date()).toUTCString() + '\r\n';
    }

    let addImplicitTE = false;
    if (isNoBodyStatus) {
        // 1xx, 204, 304: no Transfer-Encoding or Content-Length
        if (this.hasHeader('transfer-encoding')) {
            const te = String(this.getHeader('transfer-encoding')).toLowerCase();
            this._chunked = te === 'chunked';
        }
    } else if (this.hasHeader('content-length')) {
        this._sentContentLength = true;
        // User set Content-Length explicitly: don't add chunked
        if (this.hasHeader('transfer-encoding')) {
            const te = String(this.getHeader('transfer-encoding')).toLowerCase();
            this._chunked = te === 'chunked';
        }
    } else if (this.hasHeader('transfer-encoding')) {
        const te = String(this.getHeader('transfer-encoding')).toLowerCase();
        this._chunked = te === 'chunked';
    } else if (!isHeadRequest) {
        // Neither Content-Length nor Transfer-Encoding set, body expected
        if (requestHttpVersion === '1.1') {
            this._chunked = true;
            addImplicitTE = true;
        }
    }

    // User headers first (matches Node.js ordering)
    for (const lower of Object.keys(this._headers)) {
        const name = this._headerNames[lower] || lower;
        const value = this._headers[lower];
        if (Array.isArray(value)) {
            for (const v of value) {
                head += name + ': ' + v + '\r\n';
            }
        } else {
            head += name + ': ' + value + '\r\n';
        }
    }

    // Implicit Transfer-Encoding (after user headers)
    if (addImplicitTE) {
        head += 'Transfer-Encoding: chunked\r\n';
    }

    // Implicit Connection header (after user headers)
    const userConnection = this.getHeader('connection');
    const userConnectionTokens = typeof userConnection === 'string'
        ? userConnection.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        : [];
    const userSaysClose = userConnectionTokens.includes('close');
    const userSaysKeepAlive = userConnectionTokens.includes('keep-alive');
    const canKeepAlive = !!this._keepAlive;
    // The user may narrow a keep-alive response to close, but must not widen
    // a close response to keep-alive: header semantics must match the actual
    // socket lifecycle decided elsewhere (maxRequestsPerSocket, server.close()).
    const effectiveKeepAlive = userConnection === undefined
        ? canKeepAlive
        : (canKeepAlive && userSaysKeepAlive && !userSaysClose);

    if (userConnection === undefined) {
        head += 'Connection: ' + (effectiveKeepAlive ? 'keep-alive' : 'close') + '\r\n';
    }

    if (effectiveKeepAlive && this.getHeader('keep-alive') === undefined) {
        const timeoutMs = typeof this._keepAliveTimeout === 'number' && this._keepAliveTimeout >= 0
            ? this._keepAliveTimeout
            : 5000;
        const timeoutSeconds = Math.trunc(timeoutMs / 1000);
        head += 'Keep-Alive: timeout=' + timeoutSeconds;
        if (this._keepAliveMaxRequests > 0) {
            head += ', max=' + this._keepAliveMaxRequests;
        }
        head += '\r\n';
    }

    head += '\r\n';
    return head;
};

ServerResponse.prototype._sendHeaders = function _sendHeaders() {
    const head = this._buildHeaderString();
    if (head) {
        this.socket.write(Buffer.from(head));
    }
};

ServerResponse.prototype.write = function write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
        cb = encoding;
        encoding = undefined;
    }

    if (this._destroyed || this._closed) {
        if (typeof cb === 'function') cb();
        return false;
    }

    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        throw new ERR_INVALID_ARG_TYPE('first argument',
            ['string', 'Buffer', 'Uint8Array'], chunk);
    }

    if (!this._headersSentWire) {
        this._sendHeaders();
    }

    if (!this._hasBody) {
        if (this._rejectNonStandardBodyWrites) {
            throw new ERR_HTTP_BODY_NOT_ALLOWED();
        }
        if (typeof cb === 'function') cb();
        return true;
    }

    if (typeof chunk === 'string') {
        chunk = Buffer.from(chunk, encoding || 'utf8');
    } else if (!(chunk instanceof Buffer)) {
        chunk = Buffer.from(chunk);
    }

    if (chunk.length === 0) {
        if (typeof cb === 'function') cb();
        return true;
    }

    if (this.strictContentLength && !this._chunked && this.hasHeader('content-length')) {
        const contentLength = parseInt(this.getHeader('content-length'), 10);
        if (this._bytesWritten + chunk.length > contentLength) {
            throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(this._bytesWritten + chunk.length, contentLength);
        }
    }
    this._bytesWritten += chunk.length;

    if (this._chunked) {
        const hex = chunk.length.toString(16);
        this.socket.write(Buffer.from(hex + '\r\n'));
        this.socket.write(chunk);
        this.socket.write(CRLF);
    } else {
        this.socket.write(chunk);
    }

    this._outputSize += chunk.length;
    if (typeof cb === 'function') cb();
    return this._outputSize < (16 * 1024);
};

ServerResponse.prototype.end = function end(data, encoding, cb) {
    if (typeof data === 'function') {
        cb = data;
        data = undefined;
        encoding = undefined;
    } else if (typeof encoding === 'function') {
        cb = encoding;
        encoding = undefined;
    }

    if (data !== undefined && data !== null) {
        if (typeof data !== 'string' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
            throw new ERR_INVALID_ARG_TYPE('first argument',
                ['string', 'Buffer', 'Uint8Array'], data);
        }
    }

    if (this._writableEnded || this._destroyed || this._closed) {
        if (typeof cb === 'function') cb();
        return this;
    }

    if (this.strictContentLength && !this._chunked && this.hasHeader('content-length')) {
        const contentLength = parseInt(this.getHeader('content-length'), 10);
        let totalBytes = this._bytesWritten;
        if (data !== undefined && data !== null) {
            if (typeof data === 'string') {
                totalBytes += Buffer.byteLength(data, encoding || 'utf8');
            } else {
                totalBytes += data.length;
            }
        }
        if (totalBytes !== contentLength) {
            throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(totalBytes, contentLength);
        }
    }

    this._writableEnded = true;

    if (!this._headersSentWire) {
        if (data && !this.headersSent && !this.hasHeader('content-length') && !this.hasHeader('transfer-encoding')) {
            // writeHead() was NOT called and full body is known at end-time:
            // set Content-Length and combine headers + body into a single write.
            const body = typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : Buffer.from(data);
            this.setHeader('Content-Length', body.length);
            const head = this._buildHeaderString();
            if (this._hasBody && head) {
                const headerBuf = Buffer.from(head);
                const combined = Buffer.concat([headerBuf, body]);
                this.socket.write(combined);
            } else if (head) {
                this.socket.write(Buffer.from(head));
            }
            data = null; // already written
        } else {
            // writeHead() was called or explicit CL/TE set: send headers separately,
            // letting chunked encoding handle the body (matches Node.js behavior).
            if (!data && !this.hasHeader('content-length') && !this.hasHeader('transfer-encoding')) {
                this.setHeader('Content-Length', 0);
            }
            this._sendHeaders();
        }
    }

    if (data) {
        this.write(data, encoding);
    }

    if (this._chunked && this._hasBody) {
        this.socket.write(Buffer.from('0\r\n\r\n'));
    }

    // Write empty chunk to signal end of response (matches Node.js behavior)
    if (this.socket && !this._chunked) {
        this.socket.write(Buffer.alloc(0));
    }

    // Uncork the socket to flush any buffered writes (matches Node.js behavior)
    if (this.socket && typeof this.socket.uncork === 'function') {
        this.socket.uncork();
    }

    this.finished = true;

    if (typeof cb === 'function') cb();

    this.emit('finish');

    return this;
};

ServerResponse.prototype.flushHeaders = function flushHeaders() {
    if (!this._headersSentWire) {
        this._sendHeaders();
    }
};

ServerResponse.prototype._writeRaw = function _writeRaw(data, encoding, callback) {
    if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
    }

    if (!this.socket || this.socket.destroyed) {
        if (typeof callback === 'function') {
            callback(new Error('Socket is closed'));
        }
        return false;
    }

    let chunk;
    if (typeof data === 'string') {
        chunk = Buffer.from(data, encoding || 'latin1');
    } else if (data instanceof Buffer) {
        chunk = data;
    } else if (data instanceof Uint8Array) {
        chunk = Buffer.from(data);
    } else {
        chunk = Buffer.from(String(data), encoding || 'latin1');
    }

    if (typeof callback === 'function') {
        return this.socket.write(chunk, callback);
    }
    return this.socket.write(chunk);
};

ServerResponse.prototype.writeContinue = function writeContinue() {
    this.socket.write(Buffer.from('HTTP/1.1 100 Continue\r\n\r\n'));
};

ServerResponse.prototype.writeProcessing = function writeProcessing() {
    this.socket.write(Buffer.from('HTTP/1.1 102 Processing\r\n\r\n'));
};

const LINK_HEADER_REGEX = /^<[^>]*>(\s*;\s*[^;]+)*$/;

function _validateLinkHeaderFormat(value) {
    if (typeof value !== 'string' || !LINK_HEADER_REGEX.test(value)) {
        throw new ERR_INVALID_ARG_VALUE(
            'hints.link', value, 'must have a valid format "<URI>; ...<attributes>"'
        );
    }
    return value;
}

function _validateLinkHeaderValue(value) {
    if (typeof value === 'string') {
        return _validateLinkHeaderFormat(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => _validateLinkHeaderFormat(item)).join(', ');
    }
    throw new ERR_INVALID_ARG_TYPE('hints.link', ['string', 'Array'], value);
}

ServerResponse.prototype.writeEarlyHints = function writeEarlyHints(hints, cb) {
    if (typeof hints !== 'object' || hints === null || Array.isArray(hints)) {
        throw new ERR_INVALID_ARG_TYPE('hints', 'Object', hints);
    }

    let head = 'HTTP/1.1 103 Early Hints\r\n';

    const headers = {};
    const keys = Object.keys(hints);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.toLowerCase() === 'link') {
            const validated = _validateLinkHeaderValue(hints[key]);
            if (validated.length > 0) {
                headers[key] = validated;
            }
        } else {
            headers[key] = hints[key];
        }
    }

    const headerKeys = Object.keys(headers);
    if (headerKeys.length === 0) {
        if (typeof cb === 'function') cb();
        return;
    }

    for (let i = 0; i < headerKeys.length; i++) {
        const key = headerKeys[i];
        head += key + ': ' + headers[key] + '\r\n';
    }
    head += '\r\n';

    if (typeof cb === 'function') {
        this.socket.write(Buffer.from(head), cb);
    } else {
        this.socket.write(Buffer.from(head));
    }
};

ServerResponse.prototype.addTrailers = function addTrailers() {
    // stub
};

ServerResponse.prototype.setTimeout = function setTimeout(ms, cb) {
    if (cb) this.once('timeout', cb);
    return this;
};

ServerResponse.prototype.destroy = function destroy(err) {
    if (this._destroyed) return this;
    this._destroyed = true;
    if (err) this._errored = err;
    // If the response was already ended without error, don't forcefully
    // destroy the socket - let it flush pending writes to the client.
    // Forceful destroy (RST) can prevent wasi:http from delivering the response.
    if (this.socket && (err || !this._writableEnded)) {
        this.socket.destroy(err);
    }
    return this;
};

ServerResponse.prototype.cork = function cork() {
    if (this.socket && this.socket.cork) this.socket.cork();
};

ServerResponse.prototype.uncork = function uncork() {
    if (this.socket && this.socket.uncork) this.socket.uncork();
};

// ===== HTTP Parser =====

function createConnectionParser(server, socket) {
    const state = {
        buffer: Buffer.alloc(0),
        state: IDLE,
        socket: socket,
        req: null,
        res: null,
        contentLength: 0,
        bodyReceived: 0,
        chunkState: null,
        readableEnded: false,
        closeAfterResponse: false,
        responseFinished: false,
        shouldKeepAliveAfterResponse: false,
        requestsServed: 0,
        detached: false,
    };

    const keepAlive = computeKeepAlive(null, '1.1');

    // Install a single timeout handler for idle keep-alive connections
    socket.on('timeout', function onIdleTimeout() {
        const handled = server.emit('timeout', socket);
        if (!handled) {
            socket.destroy();
        }
    });

    socket.on('data', function onData(data) {
        if (state.detached) return;

        if (typeof data === 'string') {
            data = Buffer.from(data);
        } else if (!(data instanceof Buffer)) {
            data = Buffer.from(data);
        }

        // Clear idle keep-alive timeout on new data
        socket.setTimeout(0);

        state.buffer = Buffer.concat([state.buffer, data]);
        parseLoop();

        // Track active request inactivity via server.setTimeout().
        // Keep-alive idle timeout remains managed after responses finish.
        if (state.res && !state.responseFinished) {
            socket.setTimeout(server.timeout || 0);
        }
    });

    socket.on('end', function onEnd() {
        if (state.detached) return;

        state.readableEnded = true;

        if (state.req && !state.req.aborted) {
            if (!state.req.complete) {
                state.req.complete = true;
                state.req.push(null);
            }
            if (!state.responseFinished) {
                state.req.aborted = true;
                state.req.emit('aborted');
            }
        }

        if (!server.httpAllowHalfOpen) {
            socket.end();
            return;
        }

        const hasPendingResponse = state.res !== null;
        const hasBufferedRequests = state.buffer.length > 0;
        if (hasPendingResponse || hasBufferedRequests) {
            state.closeAfterResponse = true;
            if (!hasPendingResponse && state.state === IDLE && hasBufferedRequests) {
                parseLoop();
            }
            return;
        }

        socket.end();
    });

    socket.on('error', function onError(err) {
        if (state.detached) return;

        if (state.req && !state.req.aborted) {
            if (!state.req.complete) {
                state.req.complete = true;
                state.req.push(null);
            }
            state.req.aborted = true;
            state.req.emit('aborted');
            state.req.emit('error', err);
        }
    });

    socket.on('close', function onClose() {
        if (state.detached) return;

        if (state.req && !state.req.aborted) {
            if (!state.req.complete) {
                state.req.complete = true;
                state.req.push(null);
            }
            if (!state.responseFinished) {
                state.req.aborted = true;
                state.req.emit('aborted');
            }
        }
        if (state.res) {
            state.res._closed = true;
            state.res.emit('close');
        }
    });

    function maybeFinalizeResponse() {
        if (!state.responseFinished) {
            return false;
        }

        if (state.req && !state.req.complete) {
            return false;
        }

        const shouldKeepAlive = state.shouldKeepAliveAfterResponse;
        const finishedRes = state.res;
        state.responseFinished = false;
        state.shouldKeepAliveAfterResponse = false;
        state.req = null;
        state.res = null;
        state.state = IDLE;

        // Emit 'close' on the response asynchronously, matching Node.js
        // OutgoingMessage behavior where 'close' fires after 'finish'.
        if (finishedRes) {
            process.nextTick(function() {
                finishedRes._closed = true;
                finishedRes.emit('close');
            });
        }

        if (!shouldKeepAlive) {
            socket.end();
            return true;
        }

        if (state.buffer.length > 0) {
            parseLoop();
            return true;
        }

        if (state.readableEnded && state.closeAfterResponse) {
            socket.end();
            return true;
        }

        // Set idle timeout for keep-alive connections
        socket.setTimeout(server.keepAliveTimeout || 5000);
        return true;
    }

    function parseLoop() {
        let progress = true;
        while (progress) {
            progress = false;

            if (state.state === IDLE || state.state === HEADERS) {
                state.state = HEADERS;
                const idx = bufferIndexOf(state.buffer, HEADER_END);
                if (idx === -1) continue;

                const headerBlock = state.buffer.slice(0, idx).toString('utf8');
                state.buffer = state.buffer.slice(idx + 4);

                const parsed = parseRequestHeaders(headerBlock);
                if (!parsed) {
                    server.emit('clientError', new Error('HPE_INVALID_REQUEST'), socket);
                    socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
                    socket.end();
                    return;
                }

                const req = new ServerIncomingMessage(
                    socket,
                    parsed.method,
                    parsed.url,
                    parsed.httpVersion,
                    parsed.rawHeaders,
                    server._joinDuplicateHeaders,
                );

                // CONNECT method: hand the socket to the application
                if (parsed.method === 'CONNECT') {
                    const head = state.buffer.length > 0 ? Buffer.from(state.buffer) : Buffer.alloc(0);
                    state.buffer = Buffer.alloc(0);
                    state.detached = true;
                    state.req = null;
                    state.res = null;
                    req.complete = true;

                    if (server.listenerCount('connect') > 0) {
                        server.emit('connect', req, socket, head);
                    } else {
                        socket.write(Buffer.from('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
                        socket.destroy();
                    }
                    return;
                }

                // Upgrade request: emit 'upgrade' event before host header check
                const connHeader = req.headers.connection;
                const isUpgrade = connHeader && connHeader.toLowerCase().split(',').some(t => t.trim() === 'upgrade');
                if (isUpgrade && server.listenerCount('upgrade') > 0) {
                    const head = state.buffer.length > 0 ? Buffer.from(state.buffer) : Buffer.alloc(0);
                    state.buffer = Buffer.alloc(0);
                    state.detached = true;
                    state.req = null;
                    state.res = null;
                    req.complete = true;
                    server.emit('upgrade', req, socket, head);
                    return;
                }

                // requireHostHeader check (default true for HTTP/1.1)
                if (server._requireHostHeader && parsed.httpVersion === '1.1' && req.headers.host === undefined) {
                    server.emit('clientError', new Error('HPE_MISSING_HOST_HEADER'), socket);
                    socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
                    socket.end();
                    return;
                }

                const connKeepAlive = computeKeepAlive(req.headers.connection, parsed.httpVersion);
                const maxRequestsPerSocket = server.maxRequestsPerSocket == null
                    ? 0
                    : Math.max(0, server.maxRequestsPerSocket | 0);
                const requestNumber = ++state.requestsServed;
                if (maxRequestsPerSocket > 0 && requestNumber > maxRequestsPerSocket) {
                    socket.write(Buffer.from('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
                    socket.end();
                    return;
                }
                const res = new ServerResponse(req, {
                    rejectNonStandardBodyWrites: server._rejectNonStandardBodyWrites,
                });
                res._keepAlive = connKeepAlive && (maxRequestsPerSocket === 0 || requestNumber < maxRequestsPerSocket);
                res._keepAliveTimeout = server.keepAliveTimeout;
                res._keepAliveMaxRequests = maxRequestsPerSocket;

                state.req = req;
                state.res = res;
                state.responseFinished = false;
                state.shouldKeepAliveAfterResponse = false;

                // Set up finish handler for request sequencing
                res.on('finish', function onFinish() {
                    state.responseFinished = true;
                    state.shouldKeepAliveAfterResponse = res._keepAlive && !server._closeRequested;
                    maybeFinalizeResponse();
                });

                const cl = req.headers['content-length'];
                const te = req.headers['transfer-encoding'];
                let requestHasNoBody = false;

                if (te) {
                    if (!_isValidChunkedTE(te)) {
                        server.emit('clientError', new Error('HPE_INVALID_TRANSFER_ENCODING'), socket);
                        socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
                        socket.end();
                        return;
                    }
                    state.state = BODY_CHUNKED;
                    state.chunkState = 'SIZE';
                    state.chunkExtensionSize = 0;
                    state.contentLength = 0;
                } else if (cl !== undefined && cl !== '0') {
                    state.contentLength = parseInt(cl, 10);
                    state.bodyReceived = 0;
                    if (isNaN(state.contentLength) || state.contentLength < 0) {
                        server.emit('clientError', new Error('HPE_INVALID_CONTENT_LENGTH'), socket);
                        socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
                        socket.end();
                        return;
                    }
                    state.state = BODY_CONTENT_LENGTH;
                } else {
                    // No body
                    req.complete = true;
                    requestHasNoBody = true;
                    // Keep parsing pipelined requests even if earlier responses
                    // have not finished yet.
                    state.state = IDLE;
                }

                server.emit('request', req, res);
                if (requestHasNoBody) {
                    // Emit EOF after request handlers had a chance to attach `end` listeners.
                    Promise.resolve().then(function () {
                        req.push(null);
                    });
                }
                progress = true;
                continue;
            }

            if (state.state === BODY_CONTENT_LENGTH) {
                if (state.buffer.length === 0) continue;
                const remaining = state.contentLength - state.bodyReceived;
                const available = Math.min(state.buffer.length, remaining);
                const chunk = state.buffer.slice(0, available);
                state.buffer = state.buffer.slice(available);
                state.bodyReceived += available;
                state.req.push(chunk);

                if (state.bodyReceived >= state.contentLength) {
                    state.req.complete = true;
                    state.req.push(null);
                    state.state = AWAITING_RESPONSE;
                    maybeFinalizeResponse();
                }
                progress = true;
                continue;
            }

            if (state.state === BODY_CHUNKED) {
                const result = parseChunked(state);
                if (result === 'progress') {
                    progress = true;
                } else if (result === 'done') {
                    state.req.complete = true;
                    state.req.push(null);
                    state.state = AWAITING_RESPONSE;
                    maybeFinalizeResponse();
                    progress = true;
                } else if (result === 'error') {
                    server.emit('clientError', new Error('HPE_INVALID_CHUNK'), socket);
                    socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
                    socket.end();
                    return;
                } else if (result === 'extension-limit') {
                    server.emit('clientError', new Error('HPE_CHUNK_EXTENSIONS_OVERFLOW'), socket);
                    socket.write(Buffer.from('HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n'));
                    socket.end();
                    return;
                }
                continue;
            }
        }
    }

    return state;
}

function parseChunked(state) {
    while (true) {
        if (state.chunkState === 'SIZE') {
            const idx = bufferIndexOf(state.buffer, CRLF);
            if (idx === -1) {
                // Early rejection: check if accumulated extension data
                // already exceeds the 16KB limit before CRLF arrives
                let semiPos = -1;
                for (let i = 0; i < state.buffer.length; i++) {
                    if (state.buffer[i] === 0x3b) { // ';'
                        semiPos = i;
                        break;
                    }
                }
                if (semiPos !== -1 && state.buffer.length - semiPos - 1 > 16384) {
                    return 'extension-limit';
                }
                return 'need-data';
            }
            const sizeLine = state.buffer.slice(0, idx).toString('utf8').trim();
            const semicolonIdx = sizeLine.indexOf(';');
            // Check chunk extension size (limit: 16384 bytes, same as Node.js)
            if (semicolonIdx !== -1 && sizeLine.length - semicolonIdx - 1 > 16384) {
                return 'extension-limit';
            }
            const sizeStr = semicolonIdx !== -1 ? sizeLine.substring(0, semicolonIdx) : sizeLine;
            const size = parseInt(sizeStr, 16);
            if (isNaN(size)) return 'error';
            state.buffer = state.buffer.slice(idx + 2);
            if (size === 0) {
                // Consume trailing \r\n after final chunk
                const trailIdx = bufferIndexOf(state.buffer, CRLF);
                if (trailIdx === 0) {
                    state.buffer = state.buffer.slice(2);
                }
                return 'done';
            }
            state.contentLength = size;
            state.bodyReceived = 0;
            state.chunkState = 'DATA';
            continue;
        }

        if (state.chunkState === 'DATA') {
            const remaining = state.contentLength - state.bodyReceived;
            if (state.buffer.length === 0 || remaining === 0) {
                if (remaining === 0) {
                    state.chunkState = 'TRAILER';
                    continue;
                }
                return 'need-data';
            }
            const available = Math.min(state.buffer.length, remaining);
            const chunk = state.buffer.slice(0, available);
            state.buffer = state.buffer.slice(available);
            state.bodyReceived += available;
            state.req.push(chunk);
            if (state.bodyReceived >= state.contentLength) {
                state.chunkState = 'TRAILER';
            }
            return 'progress';
        }

        if (state.chunkState === 'TRAILER') {
            if (state.buffer.length < 2) return 'need-data';
            if (state.buffer[0] === 0x0d && state.buffer[1] === 0x0a) {
                state.buffer = state.buffer.slice(2);
                state.chunkState = 'SIZE';
                continue;
            }
            return 'error';
        }

        return 'need-data';
    }
}

function bufferIndexOf(buf, search) {
    if (buf.length < search.length) return -1;
    outer: for (let i = 0; i <= buf.length - search.length; i++) {
        for (let j = 0; j < search.length; j++) {
            if (buf[i + j] !== search[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function parseRequestHeaders(block) {
    const lines = block.split('\r\n');
    if (lines.length === 0) return null;

    // Be tolerant to extra CRLFs between pipelined requests.
    // Node's parser ignores these blank prefixed lines instead of treating
    // them as malformed request lines.
    let requestLineIndex = 0;
    while (requestLineIndex < lines.length && lines[requestLineIndex] === '') {
        requestLineIndex++;
    }

    if (requestLineIndex >= lines.length) return null;

    const requestLine = lines[requestLineIndex];
    const parts = requestLine.split(' ');
    if (parts.length < 2) return null;

    const method = parts[0];
    const url = parts[1];
    let httpVersion = '1.1';
    if (parts.length >= 3) {
        const versionStr = parts[2];
        if (versionStr.startsWith('HTTP/')) {
            httpVersion = versionStr.substring(5);
        }
    }

    const rawHeaders = [];
    for (let i = requestLineIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const name = line.substring(0, colonIdx);
        // Reject header names with spaces (request smuggling prevention per RFC 7230)
        if (/[^\x21-\x7e]/.test(name) || name.length === 0) {
            return null;
        }
        const value = line.substring(colonIdx + 1).trim();
        rawHeaders.push(name, value);
    }

    return { method, url, httpVersion, rawHeaders };
}

function _isValidChunkedTE(te) {
    if (!te) return false;
    const codings = te.split(',').map(function(v) {
        const trimmed = v.trim();
        const semi = trimmed.indexOf(';');
        return (semi === -1 ? trimmed : trimmed.substring(0, semi)).trim().toLowerCase();
    }).filter(Boolean);
    return codings.length === 1 && codings[0] === 'chunked';
}

function computeKeepAlive(connectionHeader, httpVersion) {
    if (connectionHeader) {
        const tokens = connectionHeader.toLowerCase().split(',').map(t => t.trim());
        if (tokens.includes('close')) return false;
        if (tokens.includes('keep-alive')) return true;
    }
    return httpVersion === '1.1';
}

// ===== HTTP Server (extends net.Server) =====

function Server(options, requestListener) {
    if (!(this instanceof Server)) return new Server(options, requestListener);

    if (typeof options === 'function') {
        requestListener = options;
        options = {};
    } else if (options != null && (typeof options !== 'object' || Array.isArray(options))) {
        let received;
        if (Array.isArray(options)) {
            received = ` Received an instance of Array`;
        } else {
            received = ` Received type ${typeof options} (${String(options)})`;
        }
        const err = new TypeError(
            'The "options" argument must be of type object.' + received
        );
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    options = options || {};

    NetServer.call(this, {
        ...options,
        allowHalfOpen: true,
        noDelay: options.noDelay ?? true,
    });

    this.timeout = 0;
    this.keepAliveTimeout = 5000;
    this.httpAllowHalfOpen = false;
    this.maxHeadersCount = null;
    this.headersTimeout = 60000;
    this.requestTimeout = 300000;
    this.maxRequestsPerSocket = 0;
    this._rejectNonStandardBodyWrites = !!options.rejectNonStandardBodyWrites;
    this._requireHostHeader = options.requireHostHeader !== false;
    this._joinDuplicateHeaders = !!options.joinDuplicateHeaders;

    // Apply timeout options with validation
    if (options.headersTimeout !== undefined) {
        this.headersTimeout = options.headersTimeout;
    }
    if (options.requestTimeout !== undefined) {
        this.requestTimeout = options.requestTimeout;
    }
    // Validate: if both explicitly provided and requestTimeout < headersTimeout, throw.
    // requestTimeout === 0 means "disabled" in Node.js, so skip the comparison.
    if (options.headersTimeout !== undefined && options.requestTimeout !== undefined) {
        if (this.requestTimeout > 0 && this.requestTimeout < this.headersTimeout) {
            const err = new RangeError(
                'The value of "requestTimeout" is out of range. ' +
                'It must be >= headersTimeout (' + this.headersTimeout + '). ' +
                'Received ' + this.requestTimeout
            );
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }
    } else if (options.requestTimeout !== undefined && options.headersTimeout === undefined) {
        // Only requestTimeout provided: clamp headersTimeout down if needed
        if (this.requestTimeout > 0 && this.headersTimeout > this.requestTimeout) {
            this.headersTimeout = this.requestTimeout;
        }
    }

    this._httpConnections = new Set();

    if (requestListener) {
        this.on('request', requestListener);
    }

    const self = this;
    this.on('listening', function () { _registerServer(self); });
    this.on('close', function () { _unregisterServer(self); });
    this.on('connection', function connectionListener(socket) {
        // Force-close idle connections to prevent WASI resource exhaustion.
        // In WASM, each socket consumes limited resources (pollables, streams),
        // and wasi:http clients create new connections per request.
        for (const conn of self._httpConnections) {
            if (conn.state === IDLE && conn.socket && !conn.socket.destroyed) {
                // Use force_close on the native handle to immediately release
                // WASI resources, even if async poll loops hold pollables.
                if (conn.socket._handle && conn.socket._handle.force_close) {
                    conn.socket._handle.force_close();
                }
                conn.socket.destroy();
            }
        }
        const connState = createConnectionParser(self, socket);
        self._httpConnections.add(connState);
        socket.on('close', function () {
            self._httpConnections.delete(connState);
        });
    });
}

Object.setPrototypeOf(Server.prototype, NetServer.prototype);
Object.setPrototypeOf(Server, NetServer);

Server.prototype.setTimeout = function setTimeout(ms, cb) {
    this.timeout = ms;
    if (cb) this.on('timeout', cb);
    return this;
};

Server.prototype.close = function close(cb) {
    this._closeRequested = true;
    const result = NetServer.prototype.close.call(this, cb);
    // Defer idle connection cleanup to allow in-flight response writes
    // to flush. Using end() (graceful) instead of destroy() (abrupt)
    // ensures queued response data reaches the client before shutdown.
    const self = this;
    Promise.resolve().then(function () {
        self.closeIdleConnections();
    });
    return result;
};

Server.prototype.closeAllConnections = function closeAllConnections() {
    for (const conn of this._httpConnections) {
        if (conn.socket && !conn.socket.destroyed) {
            conn.socket.destroy();
        }
    }
    this._httpConnections.clear();
};

Server.prototype.closeIdleConnections = function closeIdleConnections() {
    for (const conn of this._httpConnections) {
        if (conn.state === IDLE && conn.socket && !conn.socket.destroyed) {
            conn.socket.end();
        }
    }
};

// ===== In-process abort signaling =====
// When client and server are in the same WASM component, aborting a WASI HTTP
// request doesn't reliably close the underlying TCP connection. This registry
// allows the client-side abort to directly signal the server-side connections.

const _activeServersByPort = new Map();

function _registerServer(server) {
    const addr = server.address();
    if (addr && typeof addr.port === 'number') {
        _activeServersByPort.set(addr.port, server);
    }
}

function _unregisterServer(server) {
    for (const [port, s] of _activeServersByPort) {
        if (s === server) {
            _activeServersByPort.delete(port);
            break;
        }
    }
}

export function _signalClientAbort(port) {
    const server = _activeServersByPort.get(port);
    if (!server) return;
    for (const conn of server._httpConnections) {
        if (conn.req && !conn.req.aborted && !conn.responseFinished) {
            conn.req.aborted = true;
            conn.req.emit('aborted');
            if (!conn.req.complete) {
                conn.req.complete = true;
                conn.req.push(null);
            }
            if (conn.req.listenerCount('error') > 0) {
                const abortError = new Error('aborted');
                abortError.code = 'ECONNRESET';
                conn.req.emit('error', abortError);
            }
        }
        if (conn.socket && !conn.socket.destroyed) {
            conn.socket.destroy();
        }
    }
}

// ===== createServer =====

export function createServer(options, requestListener) {
    return new Server(options, requestListener);
}

export { Server, ServerResponse, ServerIncomingMessage };
export default { Server, ServerResponse, ServerIncomingMessage, createServer, _signalClientAbort };
