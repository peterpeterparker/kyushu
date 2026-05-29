// node:https stub implementation
// Client methods delegate to node:http since WASI-HTTP handles TLS transparently
// We override the default protocol to 'https:' so URLs are constructed correctly
import * as http from 'node:http';

const NOT_SUPPORTED_MSG = 'https.createServer is not supported in WebAssembly environment';

export const METHODS = http.METHODS;
export const STATUS_CODES = http.STATUS_CODES;
export const Agent = http.Agent;
export const globalAgent = http.globalAgent;
export const IncomingMessage = http.IncomingMessage;
export const ClientRequest = http.ClientRequest;

export function request(url, options, callback) {
    if (typeof url === 'object' && url !== null && !(url instanceof URL)) {
        return http.request({ protocol: 'https:', ...url }, options, callback);
    }
    if (typeof options === 'object' && options !== null) {
        options = { protocol: 'https:', ...options };
    }
    return http.request(url, options, callback);
}

export function get(url, options, callback) {
    const req = request(url, options, callback);
    req.end();
    return req;
}

export function createServer() {
    throw new Error(NOT_SUPPORTED_MSG);
}

export class Server {
    constructor() {
        throw new Error(NOT_SUPPORTED_MSG);
    }
}

export default {
    request,
    get,
    Agent,
    globalAgent,
    IncomingMessage,
    ClientRequest,
    METHODS,
    STATUS_CODES,
    createServer,
    Server,
};
