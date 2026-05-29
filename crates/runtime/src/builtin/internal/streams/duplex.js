
// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// deno-lint-ignore-file

import { createDeferredPromise } from "__wasm_rquickjs_builtin/internal/util";
import { destroyer } from "__wasm_rquickjs_builtin/internal/streams/destroy";
import {
    AbortError,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_RETURN_VALUE,
    ERR_STREAM_PREMATURE_CLOSE,
} from "__wasm_rquickjs_builtin/internal/errors";
import {
    isDuplexNodeStream,
    isDestroyed,
    isIterable,
    isNodeStream,
    isReadable,
    isReadableNodeStream,
    isWritable,
    isWritableEnded,
    isWritableNodeStream,
} from "__wasm_rquickjs_builtin/internal/streams/utils";
import { validateObject, validateBoolean } from "__wasm_rquickjs_builtin/internal/validators";
import { Buffer } from "buffer";
import _from from "__wasm_rquickjs_builtin/internal/streams/from";
import eos from "__wasm_rquickjs_builtin/internal/streams/end-of-stream";
import Readable from "__wasm_rquickjs_builtin/internal/streams/readable";
import Writable from "__wasm_rquickjs_builtin/internal/streams/writable";
import { nextTick } from "node:process";

function Duplex(options) {
    if (!(this instanceof Duplex)) {
        return new Duplex(options);
    }

    // Pre-initialize _events with well-known event slots to preserve
    // property insertion order (matching Node.js v22 behavior).
    if (!this._events) {
        this._events = Object.create(null);
        this._events.close = undefined;
        this._events.error = undefined;
        this._events.prefinish = undefined;
        this._events.finish = undefined;
        this._events.drain = undefined;
        this._events.data = undefined;
        this._events.end = undefined;
        this._events.readable = undefined;
        this._eventsCount = 0;
    }

    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = true;

    if (options) {
        if (options.readable === false) {
            this._readableState.readable = false;
            this._readableState.ended = true;
            this._readableState.endEmitted = true;
        }

        if (options.writable === false) {
            this._writableState.writable = false;
            this._writableState.ending = true;
            this._writableState.ended = true;
            this._writableState.finished = true;
        }

        if (options.allowHalfOpen === false) {
            this.allowHalfOpen = false;
        }
    }
}

Object.setPrototypeOf(Duplex.prototype, Readable.prototype);
Object.setPrototypeOf(Duplex, Readable);

Object.defineProperties(Duplex.prototype, {
    writable: Object.getOwnPropertyDescriptor(Writable.prototype, "writable"),
    writableHighWaterMark: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableHighWaterMark",
    ),
    writableObjectMode: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableObjectMode",
    ),
    writableBuffer: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableBuffer",
    ),
    writableLength: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableLength",
    ),
    writableFinished: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableFinished",
    ),
    writableCorked: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableCorked",
    ),
    writableEnded: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableEnded",
    ),
    writableNeedDrain: Object.getOwnPropertyDescriptor(
        Writable.prototype,
        "writableNeedDrain",
    ),

    destroyed: {
        get() {
            if (
                this._readableState === undefined ||
                this._writableState === undefined
            ) {
                return false;
            }
            return this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
            // Backward compatibility, the user is explicitly
            // managing destroyed.
            if (this._readableState && this._writableState) {
                this._readableState.destroyed = value;
                this._writableState.destroyed = value;
            }
        },
    },
});


{
    // Allow the keys array to be GC'ed.
    for (const method of Object.keys(Writable.prototype)) {
        if (!Duplex.prototype[method]) {
            Duplex.prototype[method] = Writable.prototype[method];
        }
    }
}

// Use the `destroy` method of `Writable`.
// The copying loop above skips it because Readable already defines destroy,
// but Writable's version includes errorBuffer scheduling for pending corked writes.
Duplex.prototype.destroy = Writable.prototype.destroy;


function isReadableStream(object) {
    return object instanceof ReadableStream;
}

function isWritableStream(object) {
    return object instanceof WritableStream;
}

Duplex.fromWeb = function (pair, options) {
    return newStreamDuplexFromReadableWritablePair(pair, options);
};

Duplex.toWeb = function (duplex, options) {
    return newReadableWritablePairFromDuplex(duplex, options);
};

class Duplexify extends Duplex {
    constructor(options) {
        super(options);

        // https://github.com/nodejs/node/pull/34385

        if (options?.readable === false) {
            this._readableState.readable = false;
            this._readableState.ended = true;
            this._readableState.endEmitted = true;
        }

        if (options?.writable === false) {
            this._writableState.writable = false;
            this._writableState.ending = true;
            this._writableState.ended = true;
            this._writableState.finished = true;
        }
    }
}


function duplexify(body, name) {
    if (isDuplexNodeStream(body)) {
        return body;
    }

    if (isReadableNodeStream(body)) {
        return _duplexify({ readable: body });
    }

    if (isWritableNodeStream(body)) {
        return _duplexify({ writable: body });
    }

    if (isNodeStream(body)) {
        return _duplexify({ writable: false, readable: false });
    }

    if (isReadableStream(body)) {
        return _duplexify({ readable: Readable.fromWeb(body) });
    }

    if (isWritableStream(body)) {
        return _duplexify({ writable: Writable.fromWeb(body) });
    }

    if (typeof body === "function") {
        const { value, write, final, destroy } = fromAsyncGen(body);

        if (isIterable(value)) {
            return _from(Duplexify, value, {
                // TODO (ronag): highWaterMark?
                objectMode: true,
                write,
                final,
                destroy,
            });
        }

        const then = value?.then;
        if (typeof then === "function") {
            let d;

            const promise = then.call(
                value,
                (val) => {
                    if (val != null) {
                        throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
                    }
                },
                (err) => {
                    destroyer(d, err);
                },
            );

            return d = new Duplexify({
                // TODO (ronag): highWaterMark?
                objectMode: true,
                readable: false,
                write,
                final(cb) {
                    final(async () => {
                        try {
                            await promise;
                            nextTick(cb, null);
                        } catch (err) {
                            nextTick(cb, err);
                        }
                    });
                },
                destroy,
            });
        }

        throw new ERR_INVALID_RETURN_VALUE(
            "Iterable, AsyncIterable or AsyncFunction",
            name,
            value,
        );
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return duplexify(body.arrayBuffer());
    }

    if (isIterable(body)) {
        return _from(Duplexify, body, {
            // TODO (ronag): highWaterMark?
            objectMode: true,
            writable: false,
        });
    }

    if (
        isReadableStream(body?.readable) &&
        isWritableStream(body?.writable)
    ) {
        return Duplex.fromWeb(body);
    }

    if (
        typeof body?.writable === "object" ||
        typeof body?.readable === "object"
    ) {
        const readable = body?.readable
            ? isReadableNodeStream(body?.readable)
                ? body?.readable
                : duplexify(body.readable)
            : undefined;

        const writable = body?.writable
            ? isWritableNodeStream(body?.writable)
                ? body?.writable
                : duplexify(body.writable)
            : undefined;

        return _duplexify({ readable, writable });
    }

    const then = body?.then;
    if (typeof then === "function") {
        let d;

        then.call(
            body,
            (val) => {
                if (val != null) {
                    d.push(val);
                }
                d.push(null);
            },
            (err) => {
                destroyer(d, err);
            },
        );

        return d = new Duplexify({
            objectMode: true,
            writable: false,
            read() { },
        });
    }

    throw new ERR_INVALID_ARG_TYPE(
        name,
        [
            "Blob",
            "Stream",
            "Iterable",
            "AsyncIterable",
            "Function",
            "{ readable, writable } pair",
            "Promise",
        ],
        body,
    );
}

function fromAsyncGen(fn) {
    let { promise, resolve } = createDeferredPromise();
    const ac = new AbortController();
    const signal = ac.signal;
    const value = fn(
        async function* () {
            while (true) {
                const _promise = promise;
                promise = null;
                const { chunk, done, cb } = await _promise;
                nextTick(cb);
                if (done) return;
                if (signal.aborted) throw new AbortError();
                ({ promise, resolve } = createDeferredPromise());
                yield chunk;
            }
        }(),
        { signal },
    );

    return {
        value,
        write(chunk, encoding, cb) {
            const _resolve = resolve;
            resolve = null;
            _resolve({ chunk, done: false, cb });
        },
        final(cb) {
            const _resolve = resolve;
            resolve = null;
            _resolve({ done: true, cb });
        },
        destroy(err, cb) {
            ac.abort();
            cb(err);
        },
    };
}


function _duplexify(pair) {
    const r = pair.readable && typeof pair.readable.read !== "function"
        ? Readable.wrap(pair.readable)
        : pair.readable;
    const w = pair.writable;

    let readable = !!isReadable(r);
    let writable = !!isWritable(w);

    let ondrain;
    let onfinish;
    let onreadable;
    let onclose;
    let d;

    function onfinished(err) {
        const cb = onclose;
        onclose = null;

        if (cb) {
            cb(err);
        } else if (err) {
            d.destroy(err);
        } else if (!readable && !writable) {
            d.destroy();
        }
    }

    // TODO(ronag): Avoid double buffering.
    // Implement Writable/Readable/Duplex traits.
    // See, https://github.com/nodejs/node/pull/33515.
    d = new Duplexify({
        // TODO (ronag): highWaterMark?
        readableObjectMode: !!r?.readableObjectMode,
        writableObjectMode: !!w?.writableObjectMode,
        readable,
        writable,
    });

    if (writable) {
        eos(w, (err) => {
            writable = false;
            if (err) {
                destroyer(r, err);
            }
            onfinished(err);
        });

        d._write = function (chunk, encoding, callback) {
            if (w.write(chunk, encoding)) {
                callback();
            } else {
                ondrain = callback;
            }
        };

        d._final = function (callback) {
            w.end();
            onfinish = callback;
        };

        w.on("drain", function () {
            if (ondrain) {
                const cb = ondrain;
                ondrain = null;
                cb();
            }
        });

        w.on("finish", function () {
            if (onfinish) {
                const cb = onfinish;
                onfinish = null;
                cb();
            }
        });
    }

    if (readable) {
        eos(r, (err) => {
            readable = false;
            if (err) {
                destroyer(r, err);
            }
            onfinished(err);
        });

        r.on("readable", function () {
            if (onreadable) {
                const cb = onreadable;
                onreadable = null;
                cb();
            }
        });

        r.on("end", function () {
            d.push(null);
        });

        d._read = function () {
            while (true) {
                const buf = r.read();

                if (buf === null) {
                    onreadable = d._read;
                    return;
                }

                if (!d.push(buf)) {
                    return;
                }
            }
        };
    }

    d._destroy = function (err, callback) {
        if (!err && onclose !== null) {
            err = new AbortError();
        }

        onreadable = null;
        ondrain = null;
        onfinish = null;

        if (onclose === null) {
            callback(err);
        } else {
            onclose = callback;
            destroyer(w, err);
            destroyer(r, err);
        }
    };

    return d;
}


function duplexFrom(body) {
    return duplexify(body, "body");
}

Duplex.from = duplexFrom;


function newStreamDuplexFromReadableWritablePair(pair = {}, options = {}) {
    validateObject(pair, 'pair');
    const {
        readable: readableStream,
        writable: writableStream,
    } = pair;

    if (!(readableStream instanceof ReadableStream)) {
        throw new ERR_INVALID_ARG_TYPE(
            'pair.readable',
            'ReadableStream',
            readableStream);
    }
    if (!(writableStream instanceof WritableStream)) {
        throw new ERR_INVALID_ARG_TYPE(
            'pair.writable',
            'WritableStream',
            writableStream);
    }

    validateObject(options, 'options');
    const {
        allowHalfOpen = false,
        objectMode = false,
        encoding,
        decodeStrings = true,
        highWaterMark,
        signal,
    } = options;

    validateBoolean(objectMode, 'options.objectMode');
    if (encoding !== undefined && !Buffer.isEncoding(encoding))
        throw new ERR_INVALID_ARG_VALUE('options.encoding', encoding);

    const writer = writableStream.getWriter();
    const reader = readableStream.getReader();
    let writableClosed = false;
    let readableClosed = false;

    const duplex = new Duplex({
        allowHalfOpen,
        highWaterMark,
        objectMode,
        encoding,
        decodeStrings,
        signal,

        writev(chunks, callback) {
            function done(error) {
                error = error.filter((e) => e);
                try {
                    callback(error.length === 0 ? undefined : error);
                } catch (error) {
                    nextTick(() => destroyer(duplex, error));
                }
            }

            writer.ready.then(
                () => {
                    return Promise.all(
                        chunks.map((data) => writer.write(data.chunk))
                    ).then(
                        () => done([]),
                        (err) => done([err])
                    );
                },
                (err) => done([err]));
        },

        write(chunk, encoding, callback) {
            if (typeof chunk === 'string' && decodeStrings && !objectMode) {
                chunk = Buffer.from(chunk, encoding);
                chunk = new Uint8Array(
                    chunk.buffer,
                    chunk.byteOffset,
                    chunk.byteLength,
                );
            }

            function done(error) {
                try {
                    callback(error);
                } catch (error) {
                    destroyer(duplex, error);
                }
            }

            writer.ready.then(
                () => {
                    return writer.write(chunk).then(done, done);
                },
                done);
        },

        final(callback) {
            function done(error) {
                try {
                    callback(error);
                } catch (error) {
                    nextTick(() => destroyer(duplex, error));
                }
            }

            if (!writableClosed) {
                writer.close().then(done, done);
            }
        },

        read() {
            reader.read().then(
                (chunk) => {
                    if (chunk.done) {
                        duplex.push(null);
                    } else {
                        duplex.push(chunk.value);
                    }
                },
                (error) => destroyer(duplex, error));
        },

        destroy(error, callback) {
            function done() {
                try {
                    callback(error);
                } catch (error) {
                    nextTick(() => { throw error; });
                }
            }

            async function closeWriter() {
                if (!writableClosed)
                    await writer.abort(error);
            }

            async function closeReader() {
                if (!readableClosed)
                    await reader.cancel(error);
            }

            if (!writableClosed || !readableClosed) {
                Promise.all([
                    closeWriter(),
                    closeReader(),
                ]).then(done, done);
                return;
            }

            done();
        },
    });

    writer.closed.then(
        () => {
            writableClosed = true;
            if (!isWritableEnded(duplex))
                destroyer(duplex, new ERR_STREAM_PREMATURE_CLOSE());
        },
        (error) => {
            writableClosed = true;
            readableClosed = true;
            destroyer(duplex, error);
        });

    reader.closed.then(
        () => {
            readableClosed = true;
        },
        (error) => {
            writableClosed = true;
            readableClosed = true;
            destroyer(duplex, error);
        });

    return duplex;
}


function newReadableWritablePairFromDuplex(duplex, options = {}) {
    if (typeof duplex?._writableState !== 'object' ||
        typeof duplex?._readableState !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('duplex', 'stream.Duplex', duplex);
    }

    if (isDestroyed(duplex)) {
        const writable = new WritableStream();
        const readable = new ReadableStream();
        writable.close();
        readable.cancel();
        return { readable, writable };
    }

    const writable =
        isWritable(duplex)
            ? Writable.toWeb(duplex)
            : new WritableStream();

    if (!isWritable(duplex))
        writable.close();

    const readable =
        isReadable(duplex)
            ? Readable.toWeb(duplex)
            : new ReadableStream();

    if (!isReadable(duplex))
        readable.cancel();

    return { writable, readable };
}


export default Duplex;
export { duplexFrom as from, duplexify, newStreamDuplexFromReadableWritablePair as fromWeb, newReadableWritablePairFromDuplex as toWeb };