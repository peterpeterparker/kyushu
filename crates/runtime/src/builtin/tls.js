// node:tls stub implementation
// All functions throw errors as TLS is not supported in WASM environment

import net from 'node:net';

function notSupported() {
    return new Error('tls is not supported in WebAssembly environment');
}

export class SecureContext {
    constructor() {
        throw notSupported();
    }
}

export function TLSSocket() {
    throw notSupported();
}

// Keep the same inheritance shape as Node.js:
// TLSSocket -> net.Socket so prototype accessors (e.g. bytesWritten) work.
Object.setPrototypeOf(TLSSocket.prototype, net.Socket.prototype);
Object.setPrototypeOf(TLSSocket, net.Socket);

export class Server {
    constructor() {
        throw notSupported();
    }
}

export function connect() {
    throw notSupported();
}

export function createServer() {
    throw notSupported();
}

export function createSecureContext() {
    throw notSupported();
}

export function checkServerIdentity() {
    throw notSupported();
}

export function getCiphers() {
    return [];
}

export const rootCertificates = [];

export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_ECDH_CURVE = 'auto';

export default {
    SecureContext,
    TLSSocket,
    Server,
    connect,
    createServer,
    createSecureContext,
    checkServerIdentity,
    getCiphers,
    rootCertificates,
    DEFAULT_MIN_VERSION,
    DEFAULT_MAX_VERSION,
    DEFAULT_ECDH_CURVE,
};
