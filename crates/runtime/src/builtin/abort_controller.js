// DOMException implementation for AbortError
const DOM_EXCEPTION_CODES = {
    'IndexSizeError': 1,
    'HierarchyRequestError': 3,
    'WrongDocumentError': 4,
    'InvalidCharacterError': 5,
    'NoModificationAllowedError': 7,
    'NotFoundError': 8,
    'NotSupportedError': 9,
    'InvalidStateError': 11,
    'SyntaxError': 12,
    'InvalidModificationError': 13,
    'NamespaceError': 14,
    'InvalidAccessError': 15,
    'TypeMismatchError': 17,
    'SecurityError': 18,
    'NetworkError': 19,
    'AbortError': 20,
    'URLMismatchError': 21,
    'QuotaExceededError': 22,
    'TimeoutError': 23,
    'DataCloneError': 25,
};

class DOMException extends Error {
    constructor(message = '', name = 'Error') {
        super(message);
        this.name = name;
        this.code = DOM_EXCEPTION_CODES[name] || 0;
    }
}

// We need access to the Event _eventTrusted WeakMap to mark events as trusted.
// Import the _eventTrusted symbol from events module.
import { _eventTrusted } from 'node:events';

// Use a Symbol for private state instead of WeakMap.
// QuickJS's WeakMap implementation prevents keys from being garbage collected,
// so we store signal/controller state as non-enumerable Symbol properties.
const _signalState = Symbol('AbortSignal.state');
const INTERNAL_TOKEN = Symbol('AbortSignal.internal');

// Strong reference set: keeps timeout signals alive as long as they have
// active event listeners. Signals without listeners are released during gc()
// so they can be collected.
const timeoutSignalStrongRefs = new Set();

function getSignalState(signal) {
    const state = signal[_signalState];
    if (!state) {
        throw new TypeError('Illegal invocation');
    }
    return state;
}

function setupTimeoutTimer(weakSignal, milliseconds) {
    const timeoutId = setTimeout(() => {
        const s = weakSignal.deref();
        if (s) {
            timeoutSignalStrongRefs.delete(s);
            abortSignal(s, new DOMException('The operation timed out.', 'TimeoutError'));
        }
    }, milliseconds);
    timeoutId.unref();
}

// Called before native GC runs. Releases timeout signals that have no active
// listeners so QuickJS's reference-counting GC can collect them.
function _preGcCleanup() {
    for (const signal of timeoutSignalStrongRefs) {
        const hasListeners = Object.values(signal._listeners).some(arr => arr.length > 0);
        if (!hasListeners) {
            timeoutSignalStrongRefs.delete(signal);
        }
    }
}

// Export for use by the gc wiring
globalThis.__wasm_rquickjs_pre_gc = _preGcCleanup;

// Abort a signal: mark as aborted, set reason, dispatch trusted abort event.
function abortSignal(signal, reason) {
    const state = signal[_signalState];
    if (!state || state.aborted) return;
    state.aborted = true;
    state.reason = reason;
    const event = new Event('abort');
    _eventTrusted.set(event, true);
    signal.dispatchEvent(event);
}

// AbortSignal implementation
class AbortSignal {
    constructor(token) {
        if (token !== INTERNAL_TOKEN) {
            const err = new TypeError('Illegal constructor');
            err.code = 'ERR_ILLEGAL_CONSTRUCTOR';
            throw err;
        }
        this._listeners = Object.create(null);
        Object.defineProperty(this, _signalState, {
            value: {
                aborted: false,
                reason: undefined,
                onabort: null,
            },
            writable: false,
            enumerable: false,
            configurable: false,
        });
    }

    get aborted() {
        return getSignalState(this).aborted;
    }

    get reason() {
        return getSignalState(this).reason;
    }

    get onabort() {
        return getSignalState(this).onabort;
    }

    set onabort(handler) {
        getSignalState(this).onabort = handler;
    }

    static abort(reason) {
        const signal = new AbortSignal(INTERNAL_TOKEN);
        const state = signal[_signalState];
        state.aborted = true;
        state.reason = reason !== undefined
            ? reason
            : new DOMException('This operation was aborted', 'AbortError');
        return signal;
    }

    static timeout(milliseconds) {
        const signal = new AbortSignal(INTERNAL_TOKEN);
        signal[_signalState].isTimeout = true;
        // Add to strong refs set so the signal survives QuickJS's ref-counting.
        // The pre-GC hook will release it if it has no active listeners.
        timeoutSignalStrongRefs.add(signal);
        setupTimeoutTimer(new WeakRef(signal), milliseconds);
        return signal;
    }

    static any(signals) {
        if (!Array.isArray(signals)) {
            throw new TypeError('signals must be an iterable');
        }
        const signal = new AbortSignal(INTERNAL_TOKEN);
        const state = signal[_signalState];
        for (const s of signals) {
            if (s.aborted) {
                state.aborted = true;
                state.reason = s.reason;
                return signal;
            }
        }
        for (const s of signals) {
            s.addEventListener('abort', function() {
                if (!state.aborted) {
                    state.aborted = true;
                    state.reason = s.reason;
                    signal.dispatchEvent(new Event('abort'));
                }
            }, { once: true });
        }
        return signal;
    }

    throwIfAborted() {
        const state = getSignalState(this);
        if (state.aborted) {
            throw state.reason;
        }
    }

    addEventListener(type, listener, options) {
        if (!listener) return;

        const opts = typeof options === 'object' ? options : { capture: !!options };

        if (type !== 'abort') return;

        if (!this._listeners[type]) {
            this._listeners[type] = [];
        }
        if (!this._listeners[type].find(l => l.listener === listener)) {
            this._listeners[type].push({
                listener,
                capture: opts.capture || false,
                once: opts.once || false,
            });
        }
    }

    removeEventListener(type, listener, options) {
        if (!listener || !this._listeners[type]) return;

        const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
        const index = this._listeners[type].findIndex(l => l.listener === listener && l.capture === capture);
        if (index !== -1) {
            this._listeners[type].splice(index, 1);
        }
    }

    dispatchEvent(event) {
        event.target = this;

        const state = getSignalState(this);

        if (state.onabort && event.type === 'abort') {
            try {
                state.onabort.call(this, event);
            } catch (e) {
                // Ignore errors in onabort handler
            }
        }

        const entries = this._listeners[event.type];
        if (!entries) return !event.defaultPrevented;

        const listenersToCall = [...entries];

        for (const item of listenersToCall) {
            try {
                item.listener.call(this, event);
            } catch (e) {
                // Ignore errors in event listeners
            }

            if (item.once) {
                const index = entries.indexOf(item);
                if (index !== -1) {
                    entries.splice(index, 1);
                }
            }
        }

        return !event.defaultPrevented;
    }
}

const _controllerSignal = Symbol('AbortController.signal');

function validateController(controller) {
    if (!(controller instanceof AbortController) || !(controller[_controllerSignal])) {
        throw new TypeError('Illegal invocation');
    }
}

// AbortController implementation
class AbortController {
    constructor() {
        this[_controllerSignal] = new AbortSignal(INTERNAL_TOKEN);
    }

    get signal() {
        validateController(this);
        return this[_controllerSignal];
    }

    abort(reason) {
        validateController(this);
        abortSignal(
            this[_controllerSignal],
            reason !== undefined
                ? reason
                : new DOMException('The operation was aborted.', 'AbortError'),
        );
    }
}

const customInspect = Symbol.for('nodejs.util.inspect.custom');

AbortSignal.prototype[customInspect] = function(depth, opts) {
    if (depth < 0) return 'AbortSignal';
    const state = this[_signalState];
    if (!state) return 'AbortSignal';
    if (depth === 0) {
        return `[AbortSignal]`;
    }
    return `AbortSignal { aborted: ${state.aborted} }`;
};

AbortController.prototype[customInspect] = function(depth, opts) {
    if (depth !== null && depth < 0) return 'AbortController';
    const signal = this.signal;
    if (!signal) return 'AbortController';
    const nextDepth = depth === null ? null : depth - 1;
    const signalStr = (nextDepth !== null && nextDepth < 0) ? '[AbortSignal]' : signal[customInspect](nextDepth, opts);
    return `AbortController { signal: ${signalStr} }`;
};

Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
});

Object.defineProperty(AbortSignal.prototype, Symbol.toStringTag, {
    value: 'AbortSignal',
    configurable: true,
});

export { AbortController, AbortSignal, DOMException };
