// Web platform Event, EventTarget, and CustomEvent implementations

const _eventTrusted = new WeakMap();
let _currentPassiveListener = false;

class Event {
    constructor(type, eventInitDict = {}) {
        if (arguments.length === 0) {
            throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.");
        }
        this.type = String(type);
        this.bubbles = !!eventInitDict.bubbles;
        this.cancelable = !!eventInitDict.cancelable;
        this.composed = !!eventInitDict.composed;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
        this.eventPhase = 0;
        this.timeStamp = Date.now();
        _eventTrusted.set(this, false);
        this._stopPropagation = false;
        this._stopImmediatePropagation = false;
    }

    get isTrusted() {
        return _eventTrusted.get(this) || false;
    }

    composedPath() {
        return this.target ? [this.target] : [];
    }

    preventDefault() {
        if (this.cancelable && !_currentPassiveListener) {
            this.defaultPrevented = true;
        }
    }

    stopPropagation() {
        this._stopPropagation = true;
    }

    stopImmediatePropagation() {
        this._stopImmediatePropagation = true;
        this._stopPropagation = true;
    }
}

Object.defineProperties(Event, {
    NONE: { value: 0, writable: false, configurable: false, enumerable: true },
    CAPTURING_PHASE: { value: 1, writable: false, configurable: false, enumerable: true },
    AT_TARGET: { value: 2, writable: false, configurable: false, enumerable: true },
    BUBBLING_PHASE: { value: 3, writable: false, configurable: false, enumerable: true },
});

Object.defineProperties(Event.prototype, {
    NONE: { value: 0 },
    CAPTURING_PHASE: { value: 1 },
    AT_TARGET: { value: 2 },
    BUBBLING_PHASE: { value: 3 },
});

class EventTarget {
    constructor() {
        this._listeners = Object.create(null);
    }

    addEventListener(type, listener, options) {
        const opts = options != null && typeof options === 'object' ? options : null;
        const capture = typeof options === 'boolean' ? options : !!(opts && opts.capture);
        const once = !!(opts && opts.once);
        const passive = !!(opts && opts.passive);
        const signal = opts ? opts.signal : undefined;

        if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || !('aborted' in signal))) {
            throw new TypeError("Failed to execute 'addEventListener': member signal is not of type AbortSignal.");
        }

        if (listener == null) return;

        if (signal && signal.aborted) return;

        if (!this._listeners[type]) {
            this._listeners[type] = [];
        }

        // No duplicates (same listener + same capture)
        for (const entry of this._listeners[type]) {
            if (entry.listener === listener && entry.capture === capture) return;
        }

        const entry = { listener, capture, once, passive, abortHandler: null, removed: false };
        this._listeners[type].push(entry);

        if (signal) {
            entry.abortHandler = () => {
                this.removeEventListener(type, listener, { capture });
            };
            signal.addEventListener('abort', entry.abortHandler, { once: true });
            entry.signal = signal;
        }
    }

    removeEventListener(type, listener, options) {
        if (!this._listeners[type]) return;

        const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
        const entries = this._listeners[type];
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.listener === listener && entry.capture === capture) {
                entry.removed = true;
                if (entry.signal && entry.abortHandler) {
                    entry.signal.removeEventListener('abort', entry.abortHandler);
                }
                entries.splice(i, 1);
            }
        }
    }

    dispatchEvent(event) {
        if (!(event instanceof Event)) {
            throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.");
        }

        event.target = this;
        event.currentTarget = this;

        const list = this._listeners[event.type];
        if (list) {
            const handlers = list.slice();
            for (const entry of handlers) {
                if (event._stopImmediatePropagation) break;
                if (entry.removed) continue;
                if (entry.once) {
                    this.removeEventListener(event.type, entry.listener, { capture: entry.capture });
                }
                const previousPassiveListener = _currentPassiveListener;
                try {
                    _currentPassiveListener = entry.passive;
                    if (typeof entry.listener === 'function') {
                        entry.listener.call(this, event);
                    } else if (entry.listener && typeof entry.listener.handleEvent === 'function') {
                        entry.listener.handleEvent(event);
                    }
                } catch (e) {
                    // Swallow errors in event listeners
                } finally {
                    _currentPassiveListener = previousPassiveListener;
                }
            }
        }

        return !event.defaultPrevented;
    }
}

class CustomEvent extends Event {
    constructor(type, eventInitDict = {}) {
        super(type, eventInitDict);
        this.detail = eventInitDict.detail !== undefined ? eventInitDict.detail : null;
    }
}

// Node.js-compatible EventEmitter implementation

'use strict';

function _makeTypeError(name, expected, actual) {
    const display = actual === null ? 'null' : actual === undefined ? 'undefined' : typeof actual;
    const err = new TypeError(`The "${name}" argument must be of type ${expected}. Received ${display}`);
    err.code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

function _makeRangeError(name, range, actual) {
    const err = new RangeError(`The value of "${name}" is out of range. It must be ${range}. Received ${actual}`);
    err.code = 'ERR_OUT_OF_RANGE';
    return err;
}

function _validateListener(listener) {
    if (typeof listener !== 'function') {
        throw _makeTypeError('listener', 'function', listener);
    }
}

function _validateMaxListeners(n, name) {
    if (typeof n !== 'number') {
        throw _makeTypeError(name, 'number', n);
    }
    if (n !== n || n < 0) { // NaN or negative
        throw _makeRangeError(name, '>= 0', n);
    }
}

function _onceWrap(target, type, listener) {
    function wrapper() {
        if (!wrapper.fired) {
            wrapper.fired = true;
            target.removeListener(type, wrapper);
            return listener.apply(target, arguments);
        }
    }
    wrapper.fired = false;
    wrapper.listener = listener;
    return wrapper;
}

function _addCaptureRejection(emitter, promise) {
    promise.then(undefined, function(err) {
        try {
            const rejectionHandler = emitter[EventEmitter.captureRejectionSymbol];
            if (typeof rejectionHandler === 'function') {
                rejectionHandler.call(emitter, err);
            } else {
                const prev = emitter._captureRejections;
                emitter._captureRejections = false;
                emitter.emit('error', err);
                emitter._captureRejections = prev;
            }
        } catch (e) {
            throw e;
        }
    });
}

function EventEmitter(opts) {
    EventEmitter.init.call(this, opts);
}

EventEmitter.init = function init(opts) {
    if (this._events === undefined || this._events === Object.getPrototypeOf(this)._events) {
        this._events = Object.create(null);
        this._eventsCount = 0;
    }
    this._maxListeners = this._maxListeners || undefined;

    if (opts && opts.captureRejections) {
        this._captureRejections = true;
    } else if (this._captureRejections === undefined) {
        this._captureRejections = false;
    }

    // Domain implicit binding
    if (EventEmitter._domainInit) {
        EventEmitter._domainInit(this);
    }
};

EventEmitter._domainInit = null;

let _defaultMaxListeners = 10;
Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() { return _defaultMaxListeners; },
    set: function(n) {
        _validateMaxListeners(n, 'defaultMaxListeners');
        _defaultMaxListeners = n;
    }
});

EventEmitter.errorMonitor = Symbol('events.errorMonitor');
EventEmitter.captureRejections = false;
EventEmitter.captureRejectionSymbol = Symbol('events.captureRejection');

EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
    _validateMaxListeners(n, 'n');
    this._maxListeners = n;
    return this;
};

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
    return this._maxListeners !== undefined ? this._maxListeners : EventEmitter.defaultMaxListeners;
};

EventEmitter.prototype.emit = function emit(type) {
    let events = this._events;
    if (events === undefined) events = Object.create(null);
    const doError = (type === 'error');

    if (doError && events[EventEmitter.errorMonitor] !== undefined) {
        const monitorArgs = [];
        for (let mi = 1; mi < arguments.length; mi++) monitorArgs.push(arguments[mi]);
        const monitors = events[EventEmitter.errorMonitor];
        if (typeof monitors === 'function') {
            monitors.apply(this, monitorArgs);
        } else {
            const monitorsCopy = monitors.slice();
            for (let mj = 0; mj < monitorsCopy.length; mj++) {
                monitorsCopy[mj].apply(this, monitorArgs);
            }
        }
    }

    const handler = events[type];

    if (handler === undefined) {
        if (doError) {
            const er = arguments[1];
            if (er instanceof Error) {
                throw er;
            }
            let stringifiedEr;
            try {
                const util = require('node:util');
                stringifiedEr = util.inspect(er);
            } catch (e) {
                try {
                    stringifiedEr = String(er);
                } catch (e2) {
                    stringifiedEr = '[object Object]';
                }
            }
            const err = new Error('Unhandled error.' + (er !== undefined ? ` (${stringifiedEr})` : ''));
            err.code = 'ERR_UNHANDLED_ERROR';
            err.context = er;
            throw err;
        }
        return false;
    }

    const capture = this._captureRejections || EventEmitter.captureRejections;
    const needCapture = capture && !doError && type !== EventEmitter.errorMonitor;

    let args;
    if (arguments.length > 1) {
        args = new Array(arguments.length - 1);
        for (let ai = 1; ai < arguments.length; ai++) args[ai - 1] = arguments[ai];
    }

    if (typeof handler === 'function') {
        const result = args ? handler.apply(this, args) : handler.call(this);
        if (needCapture && result != null && typeof result.then === 'function') {
            _addCaptureRejection(this, result);
        }
    } else {
        const listeners = handler.slice();
        const len = listeners.length;
        for (let i = 0; i < len; i++) {
            const result = args ? listeners[i].apply(this, args) : listeners[i].call(this);
            if (needCapture && result != null && typeof result.then === 'function') {
                _addCaptureRejection(this, result);
            }
        }
    }

    return true;
};

function _addListener(target, type, listener, prepend) {
    _validateListener(listener);

    let events = target._events;
    if (events === undefined) {
        events = target._events = Object.create(null);
        target._eventsCount = 0;
    }

    let existing = events[type];

    if (events.newListener !== undefined && typeof target.emit === 'function') {
        target.emit('newListener', type, listener.listener ? listener.listener : listener);
        events = target._events;
        existing = events[type];
    }

    if (existing === undefined) {
        events[type] = listener;
        ++target._eventsCount;
    } else {
        if (typeof existing === 'function') {
            existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
            existing.unshift(listener);
        } else {
            existing.push(listener);
        }

        const m = (typeof target.getMaxListeners === 'function')
            ? target.getMaxListeners()
            : (target._maxListeners !== undefined ? target._maxListeners : EventEmitter.defaultMaxListeners);
        if (m > 0 && existing.length > m && !existing.warned) {
            existing.warned = true;
            const ctorName = target.constructor ? target.constructor.name : 'EventEmitter';
            const w = new Error(
                `Possible EventEmitter memory leak detected. ${existing.length} ${String(type)} listeners added to [${ctorName}]. MaxListeners is ${m}. Use emitter.setMaxListeners() to increase limit`
            );
            w.name = 'MaxListenersExceededWarning';
            w.emitter = target;
            w.type = type;
            w.count = existing.length;
            const processObject = globalThis.process;
            if (processObject && typeof processObject.emitWarning === 'function') {
                processObject.emitWarning(w);
            } else if (typeof console !== 'undefined' && console.error) {
                console.error(w);
            }
        }
    }

    return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
    return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener = function prependListener(type, listener) {
    return _addListener(this, type, listener, true);
};

EventEmitter.prototype.once = function once(type, listener) {
    _validateListener(listener);
    this.on(type, _onceWrap(this, type, listener));
    return this;
};

EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
    _validateListener(listener);
    this.prependListener(type, _onceWrap(this, type, listener));
    return this;
};

EventEmitter.prototype.removeListener = function removeListener(type, listener) {
    _validateListener(listener);

    const events = this._events;
    if (events === undefined) return this;

    const list = events[type];
    if (list === undefined) return this;

    if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0) {
            this._events = Object.create(null);
        } else {
            delete events[type];
            if (events.removeListener)
                this.emit('removeListener', type, list.listener || list);
        }
    } else if (typeof list !== 'function') {
        let position = -1;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
                position = i;
                break;
            }
        }

        if (position < 0) return this;

        const originalListener = list[position].listener || list[position];

        if (position === 0) {
            list.shift();
        } else {
            list.splice(position, 1);
        }

        if (list.length === 1) {
            events[type] = list[0];
        }
        if (list.length === 0) {
            delete events[type];
            --this._eventsCount;
        }

        if (events.removeListener !== undefined)
            this.emit('removeListener', type, originalListener);
    }

    return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
    const events = this._events;
    if (events === undefined) return this;

    if (events.removeListener === undefined) {
        if (arguments.length === 0) {
            this._events = Object.create(null);
            this._eventsCount = 0;
        } else if (events[type] !== undefined) {
            if (--this._eventsCount === 0) {
                this._events = Object.create(null);
            } else {
                delete events[type];
            }
        }
        return this;
    }

    if (arguments.length === 0) {
        const allKeys = Object.keys(events).concat(Object.getOwnPropertySymbols(events));
        for (let ki = 0; ki < allKeys.length; ki++) {
            const key = allKeys[ki];
            if (key === 'removeListener') continue;
            this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
    }

    const listeners = events[type];
    if (listeners === undefined) return this;

    if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
    } else {
        for (let i = listeners.length - 1; i >= 0; i--) {
            this.removeListener(type, listeners[i]);
        }
    }

    return this;
};

EventEmitter.prototype.listeners = function listeners(type) {
    const events = this._events;
    if (events === undefined) return [];

    const evlistener = events[type];
    if (evlistener === undefined) return [];

    if (typeof evlistener === 'function')
        return [evlistener.listener || evlistener];

    return evlistener.map(e => e.listener || e);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
    const events = this._events;
    if (events === undefined) return [];

    const evlistener = events[type];
    if (evlistener === undefined) return [];

    if (typeof evlistener === 'function')
        return [evlistener];

    return evlistener.slice();
};

EventEmitter.prototype.listenerCount = function listenerCount(type, listener) {
    const events = this._events;
    if (events === undefined) return 0;

    const evlistener = events[type];
    if (evlistener === undefined) return 0;

    if (typeof evlistener === 'function') {
        if (listener === undefined) return 1;
        return (evlistener === listener || evlistener.listener === listener) ? 1 : 0;
    }

    if (listener === undefined) return evlistener.length;

    let count = 0;
    for (let i = 0; i < evlistener.length; i++) {
        if (evlistener[i] === listener || evlistener[i].listener === listener) count++;
    }
    return count;
};

EventEmitter.prototype.eventNames = function eventNames() {
    if (this._eventsCount === 0) return [];
    return Object.keys(this._events).concat(Object.getOwnPropertySymbols(this._events));
};

// Legacy static listenerCount
EventEmitter.listenerCount = function(emitter, eventName) {
    if (emitter == null || typeof emitter.listenerCount !== 'function') return 0;
    return emitter.listenerCount(eventName);
};

EventEmitter.once = function(emitter, name, options) {
    return new Promise(function(resolve, reject) {
        const signal = options && options.signal;
        if (signal && signal.aborted) {
            reject(signal.reason);
            return;
        }

        let onAbort;

        if (emitter && typeof emitter.addEventListener === 'function') {
            function eventHandler(event) {
                emitter.removeEventListener(name, eventHandler);
                if (onAbort) signal.removeEventListener('abort', onAbort);
                resolve([event]);
            }

            emitter.addEventListener(name, eventHandler, { once: true });

            if (signal) {
                onAbort = function() {
                    emitter.removeEventListener(name, eventHandler);
                    reject(signal.reason);
                };
                signal.addEventListener('abort', onAbort, { once: true });
            }

            return;
        }

        function eventHandler() {
            if (errorHandler) emitter.removeListener('error', errorHandler);
            if (onAbort) signal.removeEventListener('abort', onAbort);
            resolve(Array.prototype.slice.call(arguments));
        }

        let errorHandler;
        if (name !== 'error') {
            errorHandler = function(err) {
                emitter.removeListener(name, eventHandler);
                if (onAbort) signal.removeEventListener('abort', onAbort);
                reject(err);
            };
            emitter.once('error', errorHandler);
        }

        emitter.once(name, eventHandler);

        if (signal) {
            onAbort = function() {
                emitter.removeListener(name, eventHandler);
                if (errorHandler) emitter.removeListener('error', errorHandler);
                reject(signal.reason);
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
};

EventEmitter.on = function(emitter, event, options) {
    const signal = options && options.signal;
    const unconsumedEvents = [];
    let unconsumedPromises = [];
    let done = false;
    let error = null;

    function eventHandler() {
        const args = Array.prototype.slice.call(arguments);
        if (unconsumedPromises.length > 0) {
            unconsumedPromises.shift().resolve(args);
        } else {
            unconsumedEvents.push(args);
        }
    }

    function errorHandler(err) {
        error = err;
        if (unconsumedPromises.length > 0) {
            unconsumedPromises.shift().reject(err);
        }
    }

    function abortHandler() {
        errorHandler(signal.reason);
        cleanup();
    }

    function cleanup() {
        done = true;
        emitter.removeListener(event, eventHandler);
        emitter.removeListener('error', errorHandler);
        if (signal) signal.removeEventListener('abort', abortHandler);
        for (let i = 0; i < unconsumedPromises.length; i++) {
            unconsumedPromises[i].resolve({ value: undefined, done: true });
        }
        unconsumedPromises = [];
    }

    emitter.on(event, eventHandler);
    if (event !== 'error') emitter.on('error', errorHandler);
    if (signal) {
        if (signal.aborted) { abortHandler(); }
        else signal.addEventListener('abort', abortHandler, { once: true });
    }

    const iterator = {
        next: function() {
            if (unconsumedEvents.length > 0) {
                return Promise.resolve({ value: unconsumedEvents.shift(), done: false });
            }
            if (done) return Promise.resolve({ value: undefined, done: true });
            if (error) {
                const err = error;
                error = null;
                return Promise.reject(err);
            }
            return new Promise(function(resolve, reject) {
                unconsumedPromises.push({
                    resolve: function(v) { resolve({ value: v, done: false }); },
                    reject: reject
                });
            });
        },
        return: function() {
            cleanup();
            return Promise.resolve({ value: undefined, done: true });
        },
        throw: function(err) {
            cleanup();
            return Promise.reject(err);
        }
    };
    iterator[Symbol.asyncIterator] = function() { return iterator; };
    return iterator;
};

EventEmitter.getEventListeners = function(emitterOrTarget, eventName) {
    if (typeof emitterOrTarget.listeners === 'function') {
        return emitterOrTarget.listeners(eventName);
    }
    // EventTarget / AbortSignal support
    if (emitterOrTarget._listeners && emitterOrTarget._listeners[eventName]) {
        return emitterOrTarget._listeners[eventName].map(function(e) { return e.listener; });
    }
    return [];
};

EventEmitter.getMaxListeners = function(emitterOrTarget) {
    if (typeof emitterOrTarget.getMaxListeners === 'function') {
        return emitterOrTarget.getMaxListeners();
    }
    if (emitterOrTarget._maxListeners !== undefined) {
        return emitterOrTarget._maxListeners;
    }
    return EventEmitter.defaultMaxListeners;
};

EventEmitter.setMaxListeners = function(n) {
    _validateMaxListeners(n, 'n');
    const targets = [];
    for (let i = 1; i < arguments.length; i++) targets.push(arguments[i]);
    if (targets.length === 0) {
        EventEmitter.defaultMaxListeners = n;
    } else {
        for (let j = 0; j < targets.length; j++) {
            const target = targets[j];
            if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
                throw _makeTypeError('target', 'EventEmitter', target);
            }
            if (typeof target.setMaxListeners === 'function') {
                target.setMaxListeners(n);
            } else {
                target._maxListeners = n;
            }
        }
    }
};

EventEmitter.addAbortListener = function(signal, listener) {
    signal.addEventListener('abort', listener, { once: true });
    return {
        [Symbol.dispose]: function() {
            signal.removeEventListener('abort', listener);
        }
    };
};

EventEmitter.EventEmitter = EventEmitter;

const once = EventEmitter.once;
const on = EventEmitter.on;
const getEventListeners = EventEmitter.getEventListeners;
const getMaxListeners = EventEmitter.getMaxListeners;
const setMaxListeners = EventEmitter.setMaxListeners;
const addAbortListener = EventEmitter.addAbortListener;
const errorMonitor = EventEmitter.errorMonitor;
const captureRejections = EventEmitter.captureRejections;

export {
    EventEmitter,
    Event,
    EventTarget,
    CustomEvent,
    once,
    on,
    getEventListeners,
    getMaxListeners,
    setMaxListeners,
    addAbortListener,
    errorMonitor,
    captureRejections,
    _eventTrusted,
};

export default EventEmitter;
