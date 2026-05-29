// node:http stub when http feature is disabled

const NOT_SUPPORTED_ERROR = new Error('node:http requires the "http" feature flag to be enabled');

export const METHODS = [];
export const STATUS_CODES = {};
export const maxHeaderSize = 16384;

export function validateHeaderName() {}
export function validateHeaderValue() {}

export class Agent {
    constructor() { throw NOT_SUPPORTED_ERROR; }
}

export const globalAgent = null;

export class ClientRequest {
    constructor() { throw NOT_SUPPORTED_ERROR; }
}

export class IncomingMessage {
    constructor() { throw NOT_SUPPORTED_ERROR; }
}

export class Server {
    constructor() { throw NOT_SUPPORTED_ERROR; }
}

export class ServerResponse {
    constructor() { throw NOT_SUPPORTED_ERROR; }
}

export function createServer() { throw NOT_SUPPORTED_ERROR; }
export function request() { throw NOT_SUPPORTED_ERROR; }
export function get() { throw NOT_SUPPORTED_ERROR; }

export const WebSocket = globalThis.WebSocket;
export const WebSocketStream = globalThis.WebSocketStream;

export default {
    METHODS, STATUS_CODES, maxHeaderSize,
    validateHeaderName, validateHeaderValue,
    Agent, globalAgent,
    ClientRequest, IncomingMessage,
    Server, ServerResponse,
    createServer, request, get,
    WebSocket, WebSocketStream,
};
