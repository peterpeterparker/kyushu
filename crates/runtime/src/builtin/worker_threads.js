// node:worker_threads compatibility shim for single-threaded WASM runtimes.
//
// This runtime does not support real worker threads: there is no separate
// JavaScript context or thread of execution. The `Worker` class below is an
// inert API stub — it validates some constructor / postMessage inputs, but it
// does NOT execute worker code, deliver messages, or simulate worker
// lifecycle events.
//
// Tests or applications that require real worker execution / isolation are
// intentionally unsupported here and should be classified in node_compat as
// `known-gap` or `wasi-impossible`, depending on whether the behavior is
// fundamentally unavailable in this environment.

import { _emitInit } from 'node:async_hooks';

const NOT_SUPPORTED_ERROR = 'worker_threads is not supported in WebAssembly environment';
const UNTRANSFERABLE_SYMBOL = Symbol.for('__wasm_rquickjs.untransferable');
const FILE_HANDLE_IN_USE_SYMBOL = Symbol.for('__wasm_rquickjs.filehandleInUse');

function createDataCloneError(message) {
    return new DOMException(message, 'DataCloneError');
}

function createTargetContextUnavailableError() {
    const error = new Error('Message target context unavailable');
    error.code = 'ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE';
    return error;
}

function createClosedMessagePortError() {
    const error = new Error('MessagePort was closed');
    error.code = 'ERR_CLOSED_MESSAGE_PORT';
    return error;
}

function isObjectLike(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function normalizeTransferList(transferListOrOptions) {
    if (transferListOrOptions == null) {
        return [];
    }

    if (Array.isArray(transferListOrOptions)) {
        return transferListOrOptions;
    }

    if (typeof transferListOrOptions === 'object') {
        if (!Object.prototype.hasOwnProperty.call(transferListOrOptions, 'transfer')) {
            return [];
        }
        const transfer = transferListOrOptions.transfer;
        return transfer == null ? [] : [...transfer];
    }

    return [...transferListOrOptions];
}

function ensureTransferListItemsAreTransferable(transferList) {
    for (const transferItem of transferList) {
        if (isObjectLike(transferItem) && transferItem[FILE_HANDLE_IN_USE_SYMBOL] === true) {
            throw createDataCloneError('Cannot transfer FileHandle while in use');
        }

        if (isObjectLike(transferItem) && transferItem[UNTRANSFERABLE_SYMBOL] === true) {
            throw createDataCloneError('Cannot transfer object of unsupported type.');
        }
    }
}

function cloneMessagePayload(value, transferList) {
    const TRANSFERABLE_SIGNAL = Symbol.for('__wasm_rquickjs.transferableAbortSignal');
    const signalMap = new Map();
    const remainingTransfers = [];

    for (const item of transferList) {
        if (item instanceof AbortSignal && item[TRANSFERABLE_SIGNAL] === true) {
            if (item.aborted) {
                signalMap.set(item, AbortSignal.abort(item.reason));
            } else {
                const ac = new AbortController();
                item.addEventListener('abort', () => {
                    ac.abort(item.reason);
                }, { once: true });
                signalMap.set(item, ac.signal);
            }
        } else {
            remainingTransfers.push(item);
        }
    }

    let valueWasTransferableSignal = false;
    if (signalMap.size > 0 && signalMap.has(value)) {
        value = signalMap.get(value);
        valueWasTransferableSignal = true;
    }

    if (remainingTransfers.length === 0) {
        if (valueWasTransferableSignal) {
            return value;
        }
        return structuredClone(value);
    }

    return structuredClone(value, { transfer: remainingTransfers });
}

function createListenerMap() {
    return {
        message: [],
        messageerror: [],
        close: [],
        disconnect: [],
    };
}

function addListener(listeners, event, fn, once) {
    if (typeof fn !== 'function') {
        return;
    }
    if (!Object.prototype.hasOwnProperty.call(listeners, event)) {
        listeners[event] = [];
    }
    listeners[event].push({ fn, once: once === true });
}

function removeListener(listeners, event, fn) {
    const eventListeners = listeners[event];
    if (!eventListeners) {
        return;
    }
    const idx = eventListeners.findIndex((entry) => entry.fn === fn);
    if (idx !== -1) {
        eventListeners.splice(idx, 1);
    }
}

function emitListeners(listeners, event, value) {
    const eventListeners = listeners[event];
    if (!eventListeners || eventListeners.length === 0) {
        return;
    }
    const snapshot = [...eventListeners];
    for (const entry of snapshot) {
        if (entry.once) {
            removeListener(listeners, event, entry.fn);
        }
        entry.fn(value);
    }
}

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;
export const resourceLimits = {};

export class Worker {
    #closed = false;
    #listeners = createListenerMap();

    constructor(filename, options) {
        // Validate transferList eagerly so callers see the same DataCloneError
        // they would on real Node.js, even though no work is dispatched.
        const transferList = normalizeTransferList(options?.transferList);
        ensureTransferListItemsAreTransferable(transferList);

        this.filename = filename;
        // NOTE: We intentionally do NOT execute `filename` inline in the main
        // context. Doing so created a fake worker semantics (shared globals,
        // shared `process`, no real terminate(), broken FileHandle transfer)
        // that silently passed some tests by violating Node.js's isolation
        // contract. Tests that depend on real worker execution are classified
        // as `known-gap` in node_compat config instead.
    }

    on(event, fn) {
        addListener(this.#listeners, event, fn, false);
        return this;
    }

    once(event, fn) {
        addListener(this.#listeners, event, fn, true);
        return this;
    }

    removeListener(event, fn) {
        removeListener(this.#listeners, event, fn);
        return this;
    }

    off(event, fn) {
        return this.removeListener(event, fn);
    }

    postMessage(value, transferListOrOptions) {
        // No worker exists to deliver to. Validate the transfer list shape
        // (so callers see the same TypeError / DataCloneError they would on
        // real Node.js for clearly invalid inputs), but do NOT clone the
        // payload — cloning with `transfer` would detach the caller's
        // ArrayBuffers / disentangle their MessagePorts even though there is
        // no recipient, which would silently consume caller state.
        if (this.#closed) {
            return;
        }
        const transferList = normalizeTransferList(transferListOrOptions);
        ensureTransferListItemsAreTransferable(transferList);
    }

    ref() {}

    unref() {}

    terminate() {
        this.#closed = true;
        return Promise.resolve(0);
    }
}

export class BroadcastChannel {
    constructor() {
        throw new Error(NOT_SUPPORTED_ERROR);
    }
}

export class MessagePort {
    #onmessage = null;
    #onmessageerror = null;
    #closed = false;
    #pendingClose = false;
    #refed = false;
    #queue = [];
    #draining = false;
    #listeners = createListenerMap();

    constructor() {
        _emitInit('MESSAGEPORT', this);
    }

    get onmessage() {
        return this.#onmessage;
    }

    set onmessage(fn) {
        this.#onmessage = typeof fn === 'function' ? fn : null;
    }

    get onmessageerror() {
        return this.#onmessageerror;
    }

    set onmessageerror(fn) {
        this.#onmessageerror = typeof fn === 'function' ? fn : null;
    }

    _enqueueDelivery(value, messageError) {
        // Already-queued messages must still drain after close() per Node docs
        // example (https://nodejs.org/api/worker_threads.html#class-messageport),
        // so we only refuse new deposits once the port is fully closed *or*
        // has been disentangled by close().
        if (this.#closed || this.#pendingClose) {
            return;
        }
        this.#queue.push({ value, messageError: messageError === true });
        if (this.#draining) {
            return;
        }
        this.#draining = true;
        Promise.resolve().then(() => {
            while (this.#queue.length > 0) {
                const { value: queuedValue, messageError: queuedMessageError } = this.#queue.shift();
                if (queuedMessageError) {
                    const error = createTargetContextUnavailableError();
                    emitListeners(this.#listeners, 'messageerror', error);
                    if (typeof this.#onmessageerror === 'function') {
                        this.#onmessageerror({ data: error });
                    }
                    continue;
                }

                emitListeners(this.#listeners, 'message', queuedValue);
                if (typeof this.#onmessage === 'function') {
                    this.#onmessage({ data: queuedValue });
                }
            }
            this.#draining = false;
        });
    }

    postMessage(value, transferListOrOptions) {
        // Once close() has been called the port is disentangled immediately,
        // even though the 'close' event is asynchronous, so no further
        // messages may be queued in either direction.
        if (this.#closed || this.#pendingClose) {
            return;
        }

        const transferList = normalizeTransferList(transferListOrOptions);
        ensureTransferListItemsAreTransferable(transferList);
        const payload = cloneMessagePayload(value, transferList);

        const target = this._target;
        if (target && typeof target._enqueueDelivery === 'function') {
            target._enqueueDelivery(payload, false);
        }
    }

    close(callback) {
        if (typeof callback === 'function') {
            this.once('close', callback);
        }
        if (this.#closed || this.#pendingClose) {
            return;
        }
        // Disentangle synchronously so further postMessage() calls are dropped,
        // but defer the observable #closed flip and the 'close' event emission
        // to a microtask so callers like Node's `hasRef()` semantics still see
        // the port as ref'd between close() and the close event.
        const target = this._target;
        this.#pendingClose = true;
        if (target instanceof MessagePort) {
            target.#pendingClose = true;
        }
        Promise.resolve().then(() => {
            this.#closed = true;
            this._target = null;
            if (target instanceof MessagePort) {
                target.#closed = true;
                target._target = null;
            }
            emitListeners(this.#listeners, 'close');
            if (target instanceof MessagePort) {
                emitListeners(target.#listeners, 'close');
            }
        });
    }

    ref() {
        this.#refed = true;
        return this;
    }

    unref() {
        this.#refed = false;
        return this;
    }

    hasRef() {
        return !this.#closed && (this.#refed || this.#listeners.message.length > 0 || this.#listeners.close.length > 0);
    }

    start() {}

    on(event, fn) {
        addListener(this.#listeners, event, fn, false);
        return this;
    }

    once(event, fn) {
        addListener(this.#listeners, event, fn, true);
        return this;
    }

    removeListener(event, fn) {
        removeListener(this.#listeners, event, fn);
        return this;
    }

    off(event, fn) {
        return this.removeListener(event, fn);
    }

    _isClosed() {
        // Disentangled-but-not-yet-fully-closed counts as closed for transfer
        // operations like moveMessagePortToContext.
        return this.#closed || this.#pendingClose;
    }
}

export class MessageChannel {
    constructor() {
        this.port1 = new MessagePort();
        this.port2 = new MessagePort();
        this.port1._target = this.port2;
        this.port2._target = this.port1;
    }
}

function createContextPortProxy() {
    const port = Object.create(null);
    const listeners = createListenerMap();
    let onmessageerror = null;
    let closed = false;
    let queue = 0;
    let draining = false;

    const drain = () => {
        while (queue > 0) {
            queue -= 1;
            const error = createTargetContextUnavailableError();
            emitListeners(listeners, 'messageerror', error);
            if (typeof onmessageerror === 'function') {
                onmessageerror({ data: error });
            }
        }
        draining = false;
    };

    port.start = function start() {};
    port.ref = function ref() {};
    port.unref = function unref() {};
    port.close = function close(callback) {
        if (typeof callback === 'function') {
            port.once('close', callback);
        }
        if (closed) {
            return;
        }
        closed = true;
        Promise.resolve().then(() => emitListeners(listeners, 'close'));
    };

    port.on = function on(event, fn) {
        addListener(listeners, event, fn, false);
        return port;
    };

    port.once = function once(event, fn) {
        addListener(listeners, event, fn, true);
        return port;
    };

    port.removeListener = function removeListenerFn(event, fn) {
        removeListener(listeners, event, fn);
        return port;
    };

    port.off = port.removeListener;

    Object.defineProperty(port, 'onmessageerror', {
        configurable: true,
        enumerable: true,
        get() {
            return onmessageerror;
        },
        set(fn) {
            onmessageerror = typeof fn === 'function' ? fn : null;
        },
    });

    port._enqueueDelivery = function enqueueDelivery() {
        if (closed) {
            return;
        }
        queue += 1;
        if (draining) {
            return;
        }
        draining = true;
        Promise.resolve().then(drain);
    };

    return port;
}

export function markAsUntransferable(value) {
    if (!isObjectLike(value)) {
        return;
    }

    try {
        Object.defineProperty(value, UNTRANSFERABLE_SYMBOL, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    } catch {
        // Ignore non-extensible values.
    }
}

export function moveMessagePortToContext(port) {
    if (!(port instanceof MessagePort)) {
        throw new TypeError('The "port" argument must be a MessagePort');
    }

    if (port._isClosed()) {
        throw createClosedMessagePortError();
    }

    const movedPort = createContextPortProxy();
    const counterpart = port._target;
    if (counterpart && typeof counterpart === 'object') {
        counterpart._target = movedPort;
    }
    port._target = null;
    return movedPort;
}

export function receiveMessageOnPort() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export function getEnvironmentData() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export function setEnvironmentData() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export default {
    isMainThread,
    parentPort,
    workerData,
    threadId,
    resourceLimits,
    Worker,
    BroadcastChannel,
    MessagePort,
    MessageChannel,
    markAsUntransferable,
    moveMessagePortToContext,
    receiveMessageOnPort,
    getEnvironmentData,
    setEnvironmentData,
};
