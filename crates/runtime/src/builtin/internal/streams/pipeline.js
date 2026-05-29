// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// deno-lint-ignore-file

import {
    isIterable,
    isNodeStream,
    isReadable,
    isReadableNodeStream,
    isReadableFinished,
    isReadableStream,
    isTransformStream,
    isWebStream,
} from "__wasm_rquickjs_builtin/internal/streams/utils";
import { once } from "__wasm_rquickjs_builtin/internal/util";
import { validateAbortSignal, validateFunction } from "__wasm_rquickjs_builtin/internal/validators";
import {
    AbortError,
    aggregateTwoErrors,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_RETURN_VALUE,
    ERR_MISSING_ARGS,
    ERR_STREAM_DESTROYED,
    ERR_STREAM_PREMATURE_CLOSE,
} from "__wasm_rquickjs_builtin/internal/errors";
import destroyImpl from "__wasm_rquickjs_builtin/internal/streams/destroy";
import Duplex from "__wasm_rquickjs_builtin/internal/streams/duplex";
import eos from "__wasm_rquickjs_builtin/internal/streams/end-of-stream";
import Readable from "__wasm_rquickjs_builtin/internal/streams/readable";
import PassThrough from "__wasm_rquickjs_builtin/internal/streams/passthrough";
import { nextTick } from "node:process";

function destroyer(stream, reading, writing) {
    let finished = false;
    stream.on("close", () => {
        finished = true;
    });

    const cleanup = eos(stream, { readable: reading, writable: writing }, (err) => {
        finished = !err;
    });

    return {
        destroy: (err) => {
            if (finished) return;
            finished = true;
            destroyImpl.destroyer(stream, err);
        },
        cleanup,
    };
}

function popCallback(streams) {
    // Streams should never be an empty array. It should always contain at least
    // a single stream. Therefore optimize for the average case instead of
    // checking for length === 0 as well.
    validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
    return streams.pop();
}

function makeAsyncIterable(val) {
    if (isIterable(val)) {
        return val;
    } else if (isReadableNodeStream(val)) {
        // Legacy streams are not Iterable.
        return fromReadable(val);
    }
    throw new ERR_INVALID_ARG_TYPE(
        "val",
        ["Readable", "Iterable", "AsyncIterable"],
        val,
    );
}

async function* fromReadable(val) {
    yield* Readable.prototype[Symbol.asyncIterator].call(val);
}

async function pumpToWeb(readable, writable, finish, { end }) {
    if (isTransformStream(writable)) {
        writable = writable.writable;
    }
    const writer = writable.getWriter();
    try {
        for await (const chunk of readable) {
            await writer.ready;
            writer.write(chunk).catch(() => {});
        }
        await writer.ready;
        if (end) {
            await writer.close();
        }
        finish();
    } catch (err) {
        try {
            await writer.abort(err);
            finish(err);
        } catch (err2) {
            finish(err2);
        }
    }
}

async function pump(iterable, writable, finish, opts) {
    let error;
    let onresolve = null;

    const resume = (err) => {
        if (err) {
            error = err;
        }

        if (onresolve) {
            const callback = onresolve;
            onresolve = null;
            callback();
        }
    };

    const wait = () =>
        new Promise((resolve, reject) => {
            if (error) {
                reject(error);
            } else {
                onresolve = () => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                };
            }
        });

    writable.on("drain", resume);
    const cleanup = eos(writable, { readable: false }, resume);

    // Explicitly choose sync vs async iteration to avoid relying on
    // the engine's Async-from-Sync iterator wrapper, which may not
    // work correctly in all QuickJS/WASM embeddings.
    const isAsync = typeof iterable?.[Symbol.asyncIterator] === "function";
    const iterator = isAsync
        ? iterable[Symbol.asyncIterator]()
        : iterable[Symbol.iterator]();

    try {
        if (writable.writableNeedDrain) {
            await wait();
        }

        while (true) {
            const { value, done } = isAsync
                ? await iterator.next()
                : iterator.next();
            if (done) break;
            const chunk = (value && typeof value.then === "function")
                ? await value
                : value;
            if (!writable.write(chunk)) {
                await wait();
            }
        }

        if (opts?.end !== false) {
            writable.end();
            await wait();
        }

        finish();
    } catch (err) {
        finish(error !== err ? aggregateTwoErrors(error, err) : err);
    } finally {
        cleanup();
        writable.off("drain", resume);
    }
}

function pipe(src, dst, finish, finishOnlyHandleError, { end }) {
    let ended = false;
    dst.on('close', () => {
        if (!ended) {
            finishOnlyHandleError(new ERR_STREAM_PREMATURE_CLOSE());
        }
    });

    src.pipe(dst, { end: false });

    if (end) {
        function endFn() {
            ended = true;
            dst.end();
        }

        if (isReadableFinished(src)) {
            nextTick(endFn);
        } else {
            src.once('end', endFn);
        }
    } else {
        finish();
    }

    eos(src, { readable: true, writable: false }, (err) => {
        const rState = src._readableState;
        if (
            err &&
            err.code === 'ERR_STREAM_PREMATURE_CLOSE' &&
            (rState && rState.ended && !rState.errored && !rState.errorEmitted)
        ) {
            src
                .once('end', finish)
                .once('error', finish);
        } else {
            finish(err);
        }
    });

    return eos(dst, { readable: false, writable: true }, finish);
}

function pipeline(...streams) {
    const callback = once(popCallback(streams));

    // stream.pipeline(streams, callback)
    if (Array.isArray(streams[0]) && streams.length === 1) {
        streams = streams[0];
    }

    return pipelineImpl(streams, callback);
}

function pipelineImpl(streams, callback, opts) {
    if (streams.length < 2) {
        throw new ERR_MISSING_ARGS("streams");
    }

    const ac = new AbortController();
    const signal = ac.signal;
    const outerSignal = opts?.signal;

    validateAbortSignal(outerSignal, "options.signal");

    function abort() {
        finishImpl(new AbortError());
    }

    outerSignal?.addEventListener("abort", abort);

    let error;
    let value;
    const destroys = [];

    let finishCount = 0;

    function finish(err) {
        finishImpl(err, --finishCount === 0);
    }

    function finishImpl(err, final) {
        if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE")) {
            error = err;
        }

        if (!error && !final) {
            return;
        }

        while (destroys.length) {
            destroys.shift()(error);
        }

        outerSignal?.removeEventListener("abort", abort);
        ac.abort();

        if (final) {
            while (lastStreamCleanup.length) {
                lastStreamCleanup.shift()();
            }
            callback(error, value);
        }
    }

    function finishOnlyHandleError(err) {
        finishImpl(err, false);
    }

    const lastStreamCleanup = [];

    let ret;
    for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        const reading = i < streams.length - 1;
        const writing = i > 0;
        const end = reading || opts?.end !== false;
        const isLastStream = i === streams.length - 1;

        if (isNodeStream(stream)) {
            if (end) {
                const { destroy, cleanup } = destroyer(stream, reading, writing);
                destroys.push(destroy);
                if (isReadable(stream) && isLastStream) {
                    lastStreamCleanup.push(cleanup);
                }
            }

            function onError(err) {
                if (
                    err &&
                    err.name !== 'AbortError' &&
                    err.code !== 'ERR_STREAM_PREMATURE_CLOSE'
                ) {
                    finishOnlyHandleError(err);
                }
            }
            stream.on('error', onError);
            if (isReadable(stream) && isLastStream) {
                lastStreamCleanup.push(() => {
                    stream.removeListener('error', onError);
                });
            }
        }

        if (i === 0) {
            if (typeof stream === "function") {
                ret = stream({ signal });
                if (!isIterable(ret)) {
                    throw new ERR_INVALID_RETURN_VALUE(
                        "Iterable, AsyncIterable or Stream",
                        "source",
                        ret,
                    );
                }
            } else if (isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream)) {
                ret = stream;
            } else {
                ret = Duplex.from(stream);
            }
        } else if (typeof stream === "function") {
            if (isTransformStream(ret)) {
                ret = makeAsyncIterable(ret?.readable);
            } else {
                ret = makeAsyncIterable(ret);
            }
            ret = stream(ret, { signal });

            if (reading) {
                if (!isIterable(ret, true)) {
                    throw new ERR_INVALID_RETURN_VALUE(
                        "AsyncIterable",
                        `transform[${i - 1}]`,
                        ret,
                    );
                }
            } else {
                // If the last argument to pipeline is not a stream
                // we must create a proxy stream so that pipeline(...)
                // always returns a stream which can be further
                // composed through `.pipe(stream)`.

                const pt = new PassThrough({
                    objectMode: true,
                });

                // Handle Promises/A+ spec, `then` could be a getter that throws on
                // second use.
                const then = ret?.then;
                if (typeof then === "function") {
                    finishCount++;
                    then.call(ret, (val) => {
                        value = val;
                        if (val != null) {
                            pt.write(val);
                        }
                        if (end) {
                            pt.end();
                        }
                        nextTick(finish);
                    }, (err) => {
                        pt.destroy(err);
                        nextTick(finish, err);
                    });
                } else if (isIterable(ret, true)) {
                    finishCount++;
                    pump(ret, pt, finish, { end });
                } else if (isReadableStream(ret) || isTransformStream(ret)) {
                    const toRead = ret.readable || ret;
                    finishCount++;
                    pump(toRead, pt, finish, { end });
                } else {
                    throw new ERR_INVALID_RETURN_VALUE(
                        "AsyncIterable or Promise",
                        "destination",
                        ret,
                    );
                }

                ret = pt;

                const { destroy: ptDestroy, cleanup: ptDestroyerCleanup } = destroyer(ret, false, true);
                destroys.push(ptDestroy);
                finishCount++;
                const ptEosCleanup = eos(ret, { readable: false, writable: true }, finish);

                lastStreamCleanup.push(ptDestroyerCleanup);
                lastStreamCleanup.push(ptEosCleanup);
            }
        } else if (isNodeStream(stream)) {
            if (isReadableNodeStream(ret)) {
                finishCount += 2;
                const pipeCleanup = pipe(ret, stream, finish, finishOnlyHandleError, { end });
                if (isReadable(stream) && isLastStream) {
                    lastStreamCleanup.push(pipeCleanup);
                }
            } else if (isTransformStream(ret) || isReadableStream(ret)) {
                const toRead = ret.readable || ret;
                finishCount++;
                pump(toRead, stream, finish, { end });
            } else if (isIterable(ret)) {
                finishCount++;
                pump(ret, stream, finish, { end });
            } else {
                throw new ERR_INVALID_ARG_TYPE(
                    "val",
                    ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
                    ret,
                );
            }
            ret = stream;
        } else if (isWebStream(stream)) {
            if (isReadableNodeStream(ret)) {
                finishCount++;
                pumpToWeb(makeAsyncIterable(ret), stream, finish, { end });
            } else if (isReadableStream(ret) || isIterable(ret)) {
                finishCount++;
                pumpToWeb(ret, stream, finish, { end });
            } else if (isTransformStream(ret)) {
                finishCount++;
                pumpToWeb(ret.readable, stream, finish, { end });
            } else {
                throw new ERR_INVALID_ARG_TYPE(
                    "val",
                    ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
                    ret,
                );
            }
            ret = stream;
        } else {
            ret = Duplex.from(stream);
        }
    }

    if (signal?.aborted || outerSignal?.aborted) {
        nextTick(abort);
    }

    return ret;
}

export default { pipeline, pipelineImpl };
export { pipeline, pipelineImpl };
