// Node.js diagnostics_channel implementation

const channels = new Map();

class Channel {
    constructor(name) {
        this._name = name;
        this._subscribers = [];
        this._stores = new Map();
    }

    get name() {
        return this._name;
    }

    get hasSubscribers() {
        return this._subscribers.some(fn => !fn._internal) || this._stores.size > 0;
    }

    get _hasAnySubscribers() {
        return this._subscribers.length > 0 || this._stores.size > 0;
    }

    subscribe(onMessage) {
        if (typeof onMessage !== 'function') {
            const err = new TypeError('The "onMessage" argument must be of type function. Received ' + (onMessage === null ? 'null' : typeof onMessage) + ' [ERR_INVALID_ARG_TYPE]');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        this._subscribers.push(onMessage);
    }

    unsubscribe(onMessage) {
        const index = this._subscribers.indexOf(onMessage);
        if (index === -1) {
            return false;
        }
        this._subscribers.splice(index, 1);
        return true;
    }

    publish(message) {
        for (const onMessage of this._subscribers.slice()) {
            try {
                onMessage(message, this._name);
            } catch (e) {
                queueMicrotask(() => { throw e; });
            }
        }
    }

    bindStore(store, transform) {
        this._stores.set(store, transform);
    }

    unbindStore(store) {
        return this._stores.delete(store);
    }

    runStores(context, fn, thisArg, ...args) {
        let run = () => {
            this.publish(context);
            return fn.apply(thisArg, args);
        };
        for (const [store, transform] of this._stores) {
            const next = run;
            run = () => {
                let value;
                try {
                    value = typeof transform === 'function' ? transform(context) : context;
                } catch (e) {
                    queueMicrotask(() => { throw e; });
                    return next();
                }
                return store.run(value, next);
            };
        }
        return run();
    }
}

function channel(name) {
    if (typeof name !== 'string' && typeof name !== 'symbol') {
        const err = new TypeError('The "name" argument must be of type string or an instance of Symbol. Received ' + (name === null ? 'null' : typeof name) + ' [ERR_INVALID_ARG_TYPE]');
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    let ch = channels.get(name);
    if (ch === undefined) {
        ch = new Channel(name);
        channels.set(name, ch);
    }
    return ch;
}

function subscribe(name, onMessage) {
    return channel(name).subscribe(onMessage);
}

function unsubscribe(name, onMessage) {
    return channel(name).unsubscribe(onMessage);
}

function hasSubscribers(name) {
    return channel(name).hasSubscribers;
}

const TRACE_EVENTS = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'];

const TRACING_CHANNEL_CREATED = Symbol.for('wasm-rquickjs.internal.tracing_channel.created');
const tracingChannelCreatedCh = channel(TRACING_CHANNEL_CREATED);

class TracingChannel {
    constructor(nameOrChannels) {
        if (typeof nameOrChannels === 'string' || typeof nameOrChannels === 'symbol') {
            const name = nameOrChannels;
            const key = String(name);
            this.start = channel(`tracing:${key}:start`);
            this.end = channel(`tracing:${key}:end`);
            this.asyncStart = channel(`tracing:${key}:asyncStart`);
            this.asyncEnd = channel(`tracing:${key}:asyncEnd`);
            this.error = channel(`tracing:${key}:error`);
            tracingChannelCreatedCh.publish({ name, key });
        } else if (nameOrChannels && typeof nameOrChannels === 'object') {
            for (const event of TRACE_EVENTS) {
                if (!(nameOrChannels[event] instanceof Channel)) {
                    const err = new TypeError(`The "nameOrChannels.${event}" property must be an instance of Channel. Received ${nameOrChannels[event] === undefined ? 'undefined' : typeof nameOrChannels[event]} [ERR_INVALID_ARG_TYPE]`);
                    err.code = 'ERR_INVALID_ARG_TYPE';
                    throw err;
                }
                this[event] = nameOrChannels[event];
            }
        } else {
            const err = new TypeError('The "nameOrChannels" argument must be of type string or an instance of TracingChannel or Object. Received ' + (nameOrChannels === null ? 'null' : typeof nameOrChannels) + ' [ERR_INVALID_ARG_TYPE]');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
    }

    subscribe(subscribers) {
        for (const event of TRACE_EVENTS) {
            if (typeof subscribers[event] === 'function') {
                this[event].subscribe(subscribers[event]);
            }
        }
    }

    get hasSubscribers() {
        return TRACE_EVENTS.some(e => this[e].hasSubscribers);
    }

    get _hasAnySubscribers() {
        return TRACE_EVENTS.some(e => this[e]._hasAnySubscribers);
    }

    unsubscribe(subscribers) {
        let allRemoved = true;
        for (const event of TRACE_EVENTS) {
            if (typeof subscribers[event] === 'function') {
                if (!this[event].unsubscribe(subscribers[event])) {
                    allRemoved = false;
                }
            }
        }
        return allRemoved;
    }

    traceSync(fn, context = {}, thisArg, ...args) {
        if (!this._hasAnySubscribers) {
            return fn.apply(thisArg, args);
        }

        const { start, end, error } = this;

        return start.runStores(context, () => {
            try {
                const result = fn.apply(thisArg, args);
                context.result = result;
                return result;
            } catch (err) {
                context.error = err;
                error.publish(context);
                throw err;
            } finally {
                end.publish(context);
            }
        });
    }

    tracePromise(fn, context = {}, thisArg, ...args) {
        if (!this._hasAnySubscribers) {
            return fn.apply(thisArg, args);
        }

        const { start, end, asyncStart, asyncEnd, error } = this;

        return start.runStores(context, () => {
            try {
                const promise = fn.apply(thisArg, args);
                context.__dc_async = true;
                end.publish(context);
                return Promise.resolve(promise).then(
                    (result) => {
                        context.result = result;
                        return asyncStart.runStores(context, () => {
                            try { return result; }
                            finally { asyncEnd.publish(context); }
                        });
                    },
                    (err) => {
                        context.error = err;
                        error.publish(context);
                        return asyncStart.runStores(context, () => {
                            try { throw err; }
                            finally { asyncEnd.publish(context); }
                        });
                    }
                );
            } catch (err) {
                context.error = err;
                error.publish(context);
                end.publish(context);
                throw err;
            }
        });
    }

    traceCallback(fn, position = -1, context = {}, thisArg, ...args) {
        if (!this._hasAnySubscribers) {
            return fn.apply(thisArg, args);
        }

        const { start, end, asyncStart, asyncEnd, error } = this;
        const idx = position < 0 ? args.length + position : position;
        const originalCb = args[idx];

        if (idx >= 0 && idx < args.length && typeof originalCb !== 'function') {
            const err = new TypeError('The "callback" argument must be of type function. Received ' + (originalCb === null ? 'null' : typeof originalCb) + ' [ERR_INVALID_ARG_TYPE]');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (typeof originalCb !== 'function') {
            return start.runStores(context, () => {
                try {
                    return fn.apply(thisArg, args);
                } catch (err) {
                    context.error = err;
                    error.publish(context);
                    throw err;
                } finally {
                    end.publish(context);
                }
            });
        }

        function wrappedCallback(err, ...cbArgs) {
            if (err) {
                context.error = err;
                error.publish(context);
            } else {
                context.result = cbArgs[0];
            }
            return asyncStart.runStores(context, () => {
                try {
                    return originalCb.call(this, err, ...cbArgs);
                } finally {
                    asyncEnd.publish(context);
                }
            });
        }

        args[idx] = wrappedCallback;

        return start.runStores(context, () => {
            try {
                const result = fn.apply(thisArg, args);
                context.__dc_async = true;
                return result;
            } catch (err) {
                context.error = err;
                error.publish(context);
                throw err;
            } finally {
                end.publish(context);
            }
        });
    }
}

function tracingChannel(name) {
    return new TracingChannel(name);
}

const diagnostics_channel = {
    Channel,
    TracingChannel,
    channel,
    hasSubscribers,
    subscribe,
    unsubscribe,
    tracingChannel,
};

export {
    Channel,
    TracingChannel,
    channel,
    hasSubscribers,
    subscribe,
    unsubscribe,
    tracingChannel,
};

export default diagnostics_channel;
