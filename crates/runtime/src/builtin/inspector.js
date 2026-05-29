// node:inspector stub implementation
// Most functions are no-ops since there is no debugger in WASM environment.
// Session.post throws because it cannot communicate with a non-existent inspector.

import EventEmitter from 'node:events';

export class Session extends EventEmitter {
    constructor() {
        super();
    }

    connect() {}

    connectToMainThread() {}

    disconnect() {}

    post(method, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = undefined;
        }
        const err = new Error('inspector is not available');
        if (typeof callback === 'function') {
            callback(err);
        } else {
            return Promise.reject(err);
        }
    }
}

export function open(port, host, wait) {}

export function close() {}

export function url() {
    return undefined;
}

export function waitForDebugger() {}

export const console = globalThis.console;

export const Network = {
    requestWillBeSent() {},
    responseReceived() {},
    loadingFinished() {},
    loadingFailed() {},
    dataReceived() {},
};

export default {
    Session,
    open,
    close,
    url,
    waitForDebugger,
    console,
    Network,
};
