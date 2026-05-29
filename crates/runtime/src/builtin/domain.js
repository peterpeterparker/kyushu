// node:domain - full implementation with EventEmitter integration
//
// _stack semantics match Node.js:
//   - _stack contains the entered domains themselves
//   - enter() pushes `this` onto _stack, sets active = this
//   - exit() finds `this` in _stack, pops it and everything above it
//   - If `this` is not in _stack, exit() is a no-op
//   - Error handlers run outside their domain (stack is unwound before handler)
//
import EventEmitter from 'node:events';

export const _stack = [];
export let active = null;

function updateActive() {
    active = _stack.length > 0 ? _stack[_stack.length - 1] : null;
    if (globalThis.process) {
        // Node.js sets process.domain to undefined when no domain is active
        // (after domain module has been loaded), not null.
        globalThis.process.domain = active || undefined;
    }
}

function decorateError(err, props) {
    if (err != null && (typeof err === 'object' || typeof err === 'function')) {
        try {
            for (const key in props) {
                if (key === 'domain') {
                    Object.defineProperty(err, 'domain', {
                        value: props[key],
                        writable: true,
                        enumerable: false,
                        configurable: true,
                    });
                } else {
                    err[key] = props[key];
                }
            }
        } catch (e) { /* frozen object */ }
    }
}

const _origEmit = EventEmitter.prototype.emit;
const _patched = Symbol('domain.patched');

// Monkey-patch EventEmitter.prototype.emit to route unhandled 'error' events
// through the emitter's domain (if set).
if (!EventEmitter.prototype[_patched]) {
    EventEmitter.prototype.emit = function emit(event, ...args) {
        if (
            event === 'error' &&
            typeof this.listenerCount === 'function' &&
            this.listenerCount('error') === 0 &&
            this.domain &&
            this.domain !== this &&
            typeof this.domain.emit === 'function' &&
            !this.domain._disposed
        ) {
            let err = args[0];
            if (!err) {
                err = new Error('Unhandled error.');
            }
            const theDomain = this.domain;
            decorateError(err, {
                domain: theDomain,
                domainEmitter: this,
                domainThrown: false,
            });
            // Error handlers run outside their domain's context.
            // Unwind the stack to the state before theDomain was entered,
            // then restore after the handler.
            const savedStack = _stack.slice();
            const savedActive = active;
            // Remove theDomain and everything above it from the stack
            const idx = _stack.lastIndexOf(theDomain);
            _stack.length = idx >= 0 ? idx : 0;
            updateActive();
            try {
                theDomain.emit('error', err);
            } finally {
                _stack.length = 0;
                for (let i = 0; i < savedStack.length; i++) {
                    _stack.push(savedStack[i]);
                }
                active = savedActive;
                if (globalThis.process) {
                    globalThis.process.domain = active || undefined;
                }
            }
            return false;
        }
        return _origEmit.apply(this, [event].concat(args));
    };
    EventEmitter.prototype[_patched] = true;
}

// Install implicit domain binding hook on EventEmitter constructor.
// When a new EventEmitter is created while a domain is active, it is
// automatically added to that domain.
EventEmitter._domainInit = function(emitter) {
    if (active && !(emitter instanceof Domain)) {
        active.add(emitter);
    }
};

// Patch setTimeout/setInterval to auto-bind callbacks to the active domain.
const _origSetTimeout = globalThis.setTimeout;
const _origSetInterval = globalThis.setInterval;

if (_origSetTimeout) {
    globalThis.setTimeout = function domainSetTimeout(callback, delay, ...rest) {
        if (active && typeof callback === 'function') {
            callback = active.bind(callback);
        }
        return _origSetTimeout.call(globalThis, callback, delay, ...rest);
    };
}

if (_origSetInterval) {
    globalThis.setInterval = function domainSetInterval(callback, delay, ...rest) {
        if (active && typeof callback === 'function') {
            callback = active.bind(callback);
        }
        return _origSetInterval.call(globalThis, callback, delay, ...rest);
    };
}

class Domain extends EventEmitter {
    constructor() {
        super();
        this.members = [];
        this._disposed = false;
        this.parent = null;
    }

    run(fn, ...args) {
        if (this._disposed) return;
        let errorCaught = false;
        let caughtErr;
        this.enter();
        try {
            return fn.apply(this, args);
        } catch (err) {
            errorCaught = true;
            caughtErr = err;
        } finally {
            this.exit();
        }
        if (errorCaught) {
            // The error handler runs outside this domain's context
            // (exit() was already called in finally).
            decorateError(caughtErr, {
                domain: this,
                domainThrown: true,
            });
            this.emit('error', caughtErr);
        }
    }

    add(emitter) {
        if (emitter.domain === this) return;
        // Remove from previous domain if any
        if (emitter.domain) {
            emitter.domain.remove(emitter);
        }
        if (this.members.indexOf(emitter) === -1) {
            this.members.push(emitter);
        }
        // Node.js sets emitter.domain as non-enumerable
        Object.defineProperty(emitter, 'domain', {
            value: this,
            writable: true,
            enumerable: false,
            configurable: true,
        });
    }

    remove(emitter) {
        const idx = this.members.indexOf(emitter);
        if (idx !== -1) {
            this.members.splice(idx, 1);
        }
        if (emitter.domain === this) {
            // Keep the property non-enumerable after removal
            Object.defineProperty(emitter, 'domain', {
                value: null,
                writable: true,
                enumerable: false,
                configurable: true,
            });
        }
    }

    bind(callback) {
        const wrapper = (...wrapperArgs) => {
            let errorCaught = false;
            let caughtErr;
            this.enter();
            try {
                return callback.apply(this, wrapperArgs);
            } catch (err) {
                errorCaught = true;
                caughtErr = err;
            } finally {
                this.exit();
            }
            if (errorCaught) {
                decorateError(caughtErr, {
                    domain: this,
                    domainThrown: true,
                });
                this.emit('error', caughtErr);
            }
        };
        wrapper.domain = this;
        return wrapper;
    }

    intercept(callback) {
        const intercepted = (err, ...rest) => {
            if (err) {
                decorateError(err, {
                    domain: this,
                    domainBound: callback,
                    domainThrown: false,
                });
                this.emit('error', err);
                return;
            }
            let errorCaught = false;
            let caughtErr;
            this.enter();
            try {
                return callback.apply(this, rest);
            } catch (e) {
                errorCaught = true;
                caughtErr = e;
            } finally {
                this.exit();
            }
            if (errorCaught) {
                decorateError(caughtErr, {
                    domain: this,
                    domainBound: callback,
                    domainThrown: true,
                });
                this.emit('error', caughtErr);
            }
        };
        intercepted.domain = this;
        return intercepted;
    }

    enter() {
        if (this._disposed) return;
        _stack.push(this);
        active = this;
        if (globalThis.process) {
            globalThis.process.domain = this;
        }
    }

    exit() {
        // Node.js behavior: find this domain in the stack and pop it
        // + everything above. If not found, it's a no-op.
        const idx = _stack.lastIndexOf(this);
        if (idx === -1) return; // not in stack, no-op
        _stack.splice(idx);
        updateActive();
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;

        // Remove all members
        const members = this.members.slice();
        for (let i = 0; i < members.length; i++) {
            this.remove(members[i]);
        }

        // Remove from stack if present
        for (let j = _stack.length - 1; j >= 0; j--) {
            if (_stack[j] === this) {
                _stack.splice(j, 1);
            }
        }
        updateActive();

        this.emit('dispose');
        this.removeAllListeners();
    }
}

function create() {
    return new Domain();
}

function createDomain() {
    return new Domain();
}

export {
    Domain,
    create,
    createDomain,
};

export default {
    Domain,
    create,
    createDomain,
    get active() { return active; },
    _stack,
};
