// node:http2 stub implementation
// HTTP/2 is not yet supported in WebAssembly environment

function notSupported() {
    throw new Error('http2 is not supported in WebAssembly environment');
}

export function connect() {
    notSupported();
}

export function createServer() {
    notSupported();
}

export function createSecureServer() {
    notSupported();
}

export function getDefaultSettings() {
    notSupported();
}

export function getPackedSettings() {
    notSupported();
}

export function getUnpackedSettings() {
    notSupported();
}

export const sensitiveHeaders = Symbol('nodejs.http2.sensitiveHeaders');

export const constants = {};

export class Http2ServerRequest {
    constructor() {
        notSupported();
    }
}

export class Http2ServerResponse {
    constructor() {
        notSupported();
    }
}

export default {
    connect,
    createServer,
    createSecureServer,
    getDefaultSettings,
    getPackedSettings,
    getUnpackedSettings,
    sensitiveHeaders,
    constants,
    Http2ServerRequest,
    Http2ServerResponse,
};
