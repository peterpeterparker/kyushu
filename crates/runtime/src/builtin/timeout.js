import * as timeoutNative from '__wasm_rquickjs_builtin/timeout_native'
import { _captureContext, _restoreContext } from 'node:async_hooks'

class Timeout {
    constructor(id, callback, delay, args, isInterval) {
        this._id = id;
        this._destroyed = false;
        this._refed = true;
        this._callback = callback;
        this._delay = delay;
        this._args = args;
        this._isInterval = isInterval;
        this.__idleTimeout = delay;
        this.__onTimeout = callback;
        this._repeat = isInterval ? delay : null;
    }

    get _idleTimeout() {
        return this.__idleTimeout;
    }

    set _idleTimeout(value) {
        this.__idleTimeout = value;
        if (value === -1) {
            this.close();
        }
    }

    get _onTimeout() {
        return this.__onTimeout;
    }

    set _onTimeout(value) {
        this.__onTimeout = value;
        if (value === null) {
            this.close();
        }
    }

    ref() {
        this._refed = true;
        timeoutNative.ref_schedule(this._id);
        return this;
    }

    unref() {
        this._refed = false;
        timeoutNative.unref_schedule(this._id);
        return this;
    }

    hasRef() {
        return this._refed && !this._destroyed;
    }

    refresh() {
        if (!this._destroyed) {
            timeoutNative.clear_schedule(this._id);
            const bound = this._bound || this._callback.bind(this);
            this._bound = bound;
            this._id = timeoutNative.schedule(bound, this._delay, this._isInterval, this._args);
        }
        return this;
    }

    close() {
        if (!this._destroyed) {
            this._destroyed = true;
            timeoutNative.clear_schedule(this._id);
        }
        return this;
    }

    [Symbol.toPrimitive]() {
        return this._id;
    }

    [Symbol.dispose]() {
        this.close();
    }
}

function validateCallback(callback) {
    if (typeof callback !== 'function') {
        const err = new TypeError('The "callback" argument must be of type function. Received ' + (callback === null ? 'null' : typeof callback));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

const TIMEOUT_MAX = 2 ** 31 - 1;

function normalizeTimerDelay(time) {
    const delay = +time;
    if (delay > TIMEOUT_MAX) {
        if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
            process.emitWarning(`${time} does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.`, 'TimeoutOverflowWarning');
        }
        return 1;
    }
    if (!(delay >= 1)) {
        return 0;
    }
    return Math.trunc(delay);
}

function scheduleTimeout(callback, time, args, isInterval) {
    const snapshot = _captureContext();
    const wrapped = function(...a) {
        const currentId = this._id;
        try {
            // Drain pending nextTick callbacks before executing timer callbacks,
            // matching Node.js's guarantee that process.nextTick always fires
            // before timers (setTimeout/setImmediate).
            if (globalThis.__wasm_rquickjs_drainNextTick) {
                globalThis.__wasm_rquickjs_drainNextTick();
            }
            return _restoreContext(snapshot, callback, this, a);
        } catch (e) {
            if (globalThis.__wasm_rquickjs_handleUncaughtError) {
                globalThis.__wasm_rquickjs_handleUncaughtError(e);
            } else if (typeof console !== 'undefined') {
                console.error(e);
            }
        } finally {
            // Support converting setTimeout to interval via _repeat
            if (!this._destroyed && this._id === currentId && !isInterval && this._repeat > 0) {
                const nextId = timeoutNative.schedule(this._bound, this._repeat, false, args);
                this._id = nextId;
                if (!this._refed) {
                    timeoutNative.unref_schedule(nextId);
                }
            }
        }
    };
    const timeout = new Timeout(0, wrapped, time, args, isInterval);
    const bound = wrapped.bind(timeout);
    const id = timeoutNative.schedule(bound, time, isInterval, args);
    timeout._id = id;
    timeout._bound = bound;
    return timeout;
}

export function setTimeout(callback, time, ...args) {
    validateCallback(callback);
    return scheduleTimeout(callback, normalizeTimerDelay(time), args, false);
}

export function setInterval(callback, time, ...args) {
    validateCallback(callback);
    return scheduleTimeout(callback, normalizeTimerDelay(time), args, true);
}

export function setImmediate(callback, ...args) {
    validateCallback(callback);
    return scheduleTimeout(callback, 0, args, false);
}

export function clearTimeout(id) {
    if (id == null) return;
    if (id instanceof Timeout) {
        id.close();
        return;
    }
    if (typeof id === 'number' || typeof id === 'string') {
        const numId = +id;
        if (numId >= 0 && Number.isFinite(numId)) {
            timeoutNative.clear_schedule(numId);
        }
    }
}

export const clearInterval = clearTimeout;
export const clearImmediate = clearTimeout;

export function getRefTimerCount() {
    return timeoutNative.ref_timer_count();
}
