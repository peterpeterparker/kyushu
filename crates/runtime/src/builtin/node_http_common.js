// node:_http_common implementation
// Provides HTTPParser for parsing raw HTTP request/response messages,
// and the methods array mapping parser method IDs to HTTP method strings.

import { Buffer } from 'node:buffer';

// HTTP methods array matching llhttp order (used by Node.js internally)
const methods = [
    'DELETE', 'GET', 'HEAD', 'POST', 'PUT', 'CONNECT', 'OPTIONS', 'TRACE',
    'COPY', 'LOCK', 'MKCOL', 'MOVE', 'PROPFIND', 'PROPPATCH', 'SEARCH',
    'UNLOCK', 'BIND', 'REBIND', 'UNBIND', 'ACL', 'REPORT', 'MKACTIVITY',
    'CHECKOUT', 'MERGE', 'M-SEARCH', 'NOTIFY', 'SUBSCRIBE', 'UNSUBSCRIBE',
    'PATCH', 'PURGE', 'MKCALENDAR', 'LINK', 'UNLINK', 'SOURCE', 'PRI',
    'DESCRIBE', 'FLUSH', 'QUERY',
];

const methodMap = Object.create(null);
for (let i = 0; i < methods.length; i++) {
    methodMap[methods[i]] = i;
}

// Callback slot constants
const kOnHeaders = 1;
const kOnHeadersComplete = 2;
const kOnBody = 3;
const kOnMessageComplete = 4;
const kOnExecute = 5;
const kOnTimeout = 6;

// Parser type constants
const REQUEST = 1;
const RESPONSE = 2;

// Internal parser states
const S_NONE = 0;
const S_FIRST_LINE = 1;
const S_HEADER = 2;
const S_BODY = 3;
const S_CHUNK_SIZE = 4;
const S_CHUNK_DATA = 5;
const S_CHUNK_CRLF = 6;
const S_CHUNK_TRAILER = 7;
const S_COMPLETE = 8;

class HTTPParser {
    static REQUEST = REQUEST;
    static RESPONSE = RESPONSE;
    static kOnHeaders = kOnHeaders;
    static kOnHeadersComplete = kOnHeadersComplete;
    static kOnBody = kOnBody;
    static kOnMessageComplete = kOnMessageComplete;
    static kOnExecute = kOnExecute;
    static kOnTimeout = kOnTimeout;

    constructor() {
        this._type = null;
        this._state = S_NONE;
        this._lineBuffer = '';
        this._headers = [];
        this._url = '';
        this._method = undefined;
        this._versionMajor = 0;
        this._versionMinor = 0;
        this._statusCode = undefined;
        this._statusMessage = undefined;
        this._contentLength = -1;
        this._isChunked = false;
        this._bodyBytesRead = 0;
        this._chunkSize = 0;
        this._chunkBytesRead = 0;
        this._upgrade = false;
        this._shouldKeepAlive = true;
        this._trailingHeaders = [];
    }

    initialize(type, options) {
        this._type = type;
        this._state = S_FIRST_LINE;
        this._lineBuffer = '';
        this._headers = [];
        this._url = '';
        this._method = undefined;
        this._versionMajor = 0;
        this._versionMinor = 0;
        this._statusCode = undefined;
        this._statusMessage = undefined;
        this._contentLength = -1;
        this._isChunked = false;
        this._bodyBytesRead = 0;
        this._chunkSize = 0;
        this._chunkBytesRead = 0;
        this._upgrade = false;
        this._shouldKeepAlive = true;
        this._trailingHeaders = [];
    }

    execute(buffer, offset, length) {
        if (!(this instanceof HTTPParser)) {
            throw new TypeError('execute must be called on an HTTPParser');
        }

        let i = offset;
        const end = offset + length;

        while (i < end) {
            switch (this._state) {
                case S_FIRST_LINE:
                case S_HEADER:
                case S_CHUNK_SIZE:
                case S_CHUNK_TRAILER: {
                    const byte = buffer[i++];
                    if (byte === 0x0a) {
                        // Check for \r\n line ending
                        if (this._lineBuffer.length > 0 &&
                            this._lineBuffer.charCodeAt(this._lineBuffer.length - 1) === 0x0d) {
                            const line = this._lineBuffer.slice(0, -1);
                            this._lineBuffer = '';
                            this._processLine(line);
                        } else {
                            // Bare \n
                            const line = this._lineBuffer;
                            this._lineBuffer = '';
                            this._processLine(line);
                        }
                    } else {
                        this._lineBuffer += String.fromCharCode(byte);
                    }
                    break;
                }

                case S_BODY: {
                    const remaining = this._contentLength - this._bodyBytesRead;
                    const available = end - i;
                    const toRead = Math.min(remaining, available);

                    const bodyChunk = Buffer.from(buffer.subarray(i, i + toRead));
                    i += toRead;
                    this._bodyBytesRead += toRead;

                    if (this[kOnBody]) {
                        this[kOnBody](bodyChunk);
                    }

                    if (this._bodyBytesRead >= this._contentLength) {
                        this._state = S_COMPLETE;
                        if (this[kOnMessageComplete]) {
                            this[kOnMessageComplete]();
                        }
                    }
                    break;
                }

                case S_CHUNK_DATA: {
                    const remaining = this._chunkSize - this._chunkBytesRead;
                    const available = end - i;
                    const toRead = Math.min(remaining, available);

                    const bodyChunk = Buffer.from(buffer.subarray(i, i + toRead));
                    i += toRead;
                    this._chunkBytesRead += toRead;

                    if (this[kOnBody]) {
                        this[kOnBody](bodyChunk);
                    }

                    if (this._chunkBytesRead >= this._chunkSize) {
                        this._state = S_CHUNK_CRLF;
                    }
                    break;
                }

                case S_CHUNK_CRLF: {
                    const byte = buffer[i++];
                    if (byte === 0x0a) {
                        this._state = S_CHUNK_SIZE;
                        this._lineBuffer = '';
                    }
                    // skip \r silently
                    break;
                }

                case S_COMPLETE:
                case S_NONE:
                default:
                    i = end;
                    break;
            }
        }

        return length;
    }

    finish() {
        // No-op: signals no more data will come
    }

    _processLine(line) {
        switch (this._state) {
            case S_FIRST_LINE:
                if (this._type === REQUEST) {
                    this._parseRequestLine(line);
                } else {
                    this._parseStatusLine(line);
                }
                this._state = S_HEADER;
                break;

            case S_HEADER:
                if (line === '') {
                    this._onHeadersComplete();
                } else {
                    this._parseHeaderLine(line);
                }
                break;

            case S_CHUNK_SIZE:
                this._parseChunkSize(line);
                break;

            case S_CHUNK_TRAILER:
                if (line === '') {
                    if (this._trailingHeaders.length > 0 && this[kOnHeaders]) {
                        this[kOnHeaders](this._trailingHeaders, '');
                    }
                    this._state = S_COMPLETE;
                    if (this[kOnMessageComplete]) {
                        this[kOnMessageComplete]();
                    }
                } else {
                    const colonIdx = line.indexOf(':');
                    if (colonIdx > 0) {
                        const name = line.slice(0, colonIdx);
                        const value = line.slice(colonIdx + 1).trim();
                        this._trailingHeaders.push(name, value);
                    }
                }
                break;
        }
    }

    _parseRequestLine(line) {
        const firstSpace = line.indexOf(' ');
        const lastSpace = line.lastIndexOf(' ');
        if (firstSpace < 0 || lastSpace <= firstSpace) return;

        const methodStr = line.slice(0, firstSpace);
        this._url = line.slice(firstSpace + 1, lastSpace);
        const version = line.slice(lastSpace + 1);

        this._method = methodMap[methodStr] !== undefined ? methodMap[methodStr] : -1;

        const vMatch = version.match(/HTTP\/(\d+)\.(\d+)/);
        if (vMatch) {
            this._versionMajor = parseInt(vMatch[1], 10);
            this._versionMinor = parseInt(vMatch[2], 10);
        }
    }

    _parseStatusLine(line) {
        const firstSpace = line.indexOf(' ');
        if (firstSpace < 0) return;

        const version = line.slice(0, firstSpace);
        const rest = line.slice(firstSpace + 1);
        const secondSpace = rest.indexOf(' ');

        if (secondSpace > -1) {
            this._statusCode = parseInt(rest.slice(0, secondSpace), 10);
            this._statusMessage = rest.slice(secondSpace + 1);
        } else {
            this._statusCode = parseInt(rest, 10);
            this._statusMessage = '';
        }

        const vMatch = version.match(/HTTP\/(\d+)\.(\d+)/);
        if (vMatch) {
            this._versionMajor = parseInt(vMatch[1], 10);
            this._versionMinor = parseInt(vMatch[2], 10);
        }
    }

    _parseHeaderLine(line) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const name = line.slice(0, colonIdx);
            const value = line.slice(colonIdx + 1).trim();
            this._headers.push(name, value);
        }
    }

    _onHeadersComplete() {
        for (let i = 0; i < this._headers.length; i += 2) {
            const name = this._headers[i].toLowerCase();
            const value = this._headers[i + 1];
            if (name === 'content-length') {
                this._contentLength = parseInt(value, 10);
            } else if (name === 'transfer-encoding' && value.toLowerCase().includes('chunked')) {
                this._isChunked = true;
            } else if (name === 'connection') {
                const lower = value.toLowerCase();
                if (lower.includes('keep-alive')) {
                    this._shouldKeepAlive = true;
                } else if (lower.includes('close')) {
                    this._shouldKeepAlive = false;
                }
            } else if (name === 'upgrade') {
                this._upgrade = true;
            }
        }

        if (this._versionMajor === 1 && this._versionMinor === 0) {
            this._shouldKeepAlive = false;
        }

        if (this[kOnHeadersComplete]) {
            this[kOnHeadersComplete](
                this._versionMajor,
                this._versionMinor,
                this._headers,
                this._type === REQUEST ? this._method : undefined,
                this._type === REQUEST ? this._url : undefined,
                this._type === RESPONSE ? this._statusCode : undefined,
                this._type === RESPONSE ? this._statusMessage : undefined,
                this._upgrade,
                this._shouldKeepAlive,
            );
        }

        if (this._isChunked) {
            this._state = S_CHUNK_SIZE;
            this._lineBuffer = '';
        } else if (this._contentLength > 0) {
            this._state = S_BODY;
        } else {
            this._state = S_COMPLETE;
            if (this[kOnMessageComplete]) {
                this[kOnMessageComplete]();
            }
        }
    }

    _parseChunkSize(line) {
        const semiIdx = line.indexOf(';');
        const sizeStr = semiIdx > -1 ? line.slice(0, semiIdx) : line;
        this._chunkSize = parseInt(sizeStr.trim(), 16);
        this._chunkBytesRead = 0;

        if (this._chunkSize === 0) {
            this._state = S_CHUNK_TRAILER;
            this._trailingHeaders = [];
            this._lineBuffer = '';
        } else {
            this._state = S_CHUNK_DATA;
        }
    }
}

// Existing validation exports
const HTTP_TOKEN_REGEX = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const INVALID_HEADER_CHAR_REGEX = /[^\t\x20-\x7e\x80-\xff]/;

export function _checkIsHttpToken(value) {
    return HTTP_TOKEN_REGEX.test(value);
}

export function _checkInvalidHeaderChar(value) {
    return INVALID_HEADER_CHAR_REGEX.test(value);
}

export { HTTPParser, methods };

export default {
    HTTPParser,
    methods,
    _checkIsHttpToken,
    _checkInvalidHeaderChar,
};
