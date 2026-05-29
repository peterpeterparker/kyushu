// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// deno-lint-ignore-file

import {
    AbortError,
    ERR_INVALID_ARG_TYPE,
    ERR_STREAM_PREMATURE_CLOSE,
} from "__wasm_rquickjs_builtin/internal/errors";
import {
    isNodeStream,
    isReadableNodeStream,
    isReadableStream,
    isWritableNodeStream,
    isWritableStream,
    isClosed,
    isWritableFinished,
    isReadableFinished,
} from "__wasm_rquickjs_builtin/internal/streams/utils";
import { once } from "__wasm_rquickjs_builtin/internal/util";
import {
    validateAbortSignal,
    validateFunction,
    validateObject,
} from "__wasm_rquickjs_builtin/internal/validators";
import { nextTick } from "node:process";

function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
}

function isServerResponse(stream) {
    return (
        typeof stream._sent100 === "boolean" &&
        typeof stream._removedConnection === "boolean" &&
        typeof stream._removedContLen === "boolean" &&
        typeof stream._removedTE === "boolean" &&
        typeof stream._closed === "boolean"
    );
}


const nop = () => { };


export function eos(stream, options, callback) {
    if (arguments.length === 2) {
        callback = options;
        options = {};
    } else if (options == null) {
        options = {};
    } else {
        validateObject(options, "options");
    }
    validateFunction(callback, "callback");
    validateAbortSignal(options.signal, "options.signal");

    callback = once(callback);

    if (isReadableStream(stream) || isWritableStream(stream)) {
        return eosWeb(stream, options, callback);
    }

    if (!isNodeStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE(
            "stream",
            ["ReadableStream", "WritableStream", "Stream"],
            stream,
        );
    }

    const readable = options.readable ?? isReadableNodeStream(stream);
    const writable = options.writable ?? isWritableNodeStream(stream);

    const wState = stream._writableState;
    const rState = stream._readableState;
    const state = wState || rState;

    const onlegacyfinish = () => {
        if (!stream.writable) onfinish();
    };

    // TODO (ronag): Improve soft detection to include core modules and
    // common ecosystem modules that do properly emit 'close' but fail
    // this generic check.
    let willEmitClose = isServerResponse(stream) || (
        state &&
        state.autoDestroy &&
        state.emitClose &&
        state.closed === false &&
        isReadableNodeStream(stream) === readable &&
        isWritableNodeStream(stream) === writable
    );

    let writableFinished = isWritableFinished(stream, false);
    const onfinish = () => {
        writableFinished = true;
        // Stream should not be destroyed here. If it is that
        // means that user space is doing something differently and
        // we cannot trust willEmitClose.
        if (stream.destroyed) willEmitClose = false;

        if (willEmitClose && (!stream.readable || readable)) return;
        if (!readable || readableFinished) callback.call(stream);
    };

    let readableFinished = isReadableFinished(stream, false);
    const onend = () => {
        readableFinished = true;
        // Stream should not be destroyed here. If it is that
        // means that user space is doing something differently and
        // we cannot trust willEmitClose.
        if (stream.destroyed) willEmitClose = false;

        if (willEmitClose && (!stream.writable || writable)) return;
        if (!writable || writableFinished) callback.call(stream);
    };

    const onerror = (err) => {
        callback.call(stream, err);
    };

    const onclose = () => {
        const errored = (wState && wState.errored) || (rState && rState.errored);
        if (errored && typeof errored !== 'boolean') {
            return callback.call(stream, errored);
        }
        if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
            if (!isReadableFinished(stream, false)) {
                return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
            }
        }
        if (writable && !writableFinished) {
            if (!isWritableFinished(stream, false)) {
                return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
            }
        }
        callback.call(stream);
    };

    const onrequest = () => {
        stream.req.on("finish", onfinish);
    };

    if (isRequest(stream)) {
        stream.on("complete", onfinish);
        if (!willEmitClose) {
            stream.on("abort", onclose);
        }
        if (stream.req) onrequest();
        else stream.on("request", onrequest);
    } else if (writable && !wState) { // legacy streams
        stream.on("end", onlegacyfinish);
        stream.on("close", onlegacyfinish);
    }

    // Not all streams will emit 'close' after 'aborted'.
    if (!willEmitClose && typeof stream.aborted === "boolean") {
        stream.on("aborted", onclose);
    }

    stream.on("end", onend);
    stream.on("finish", onfinish);
    if (options.error !== false) stream.on("error", onerror);
    stream.on("close", onclose);

    let closed = isClosed(stream);

    if (closed) {
        // Route through onclose to detect premature close
        // (e.g., destroyed without emitting 'end').
        nextTick(onclose);
    }

    const cleanup = () => {
        callback = nop;
        stream.removeListener("aborted", onclose);
        stream.removeListener("complete", onfinish);
        stream.removeListener("abort", onclose);
        stream.removeListener("request", onrequest);
        if (stream.req) stream.req.removeListener("finish", onfinish);
        stream.removeListener("end", onlegacyfinish);
        stream.removeListener("close", onlegacyfinish);
        stream.removeListener("finish", onfinish);
        stream.removeListener("end", onend);
        stream.removeListener("error", onerror);
        stream.removeListener("close", onclose);
    };

    if (options.signal && !closed) {
        const abort = () => {
            // Keep it because cleanup removes it.
            const endCallback = callback;
            cleanup();
            endCallback.call(stream, new AbortError());
        };
        if (options.signal.aborted) {
            nextTick(abort);
        } else {
            const originalCallback = callback;
            callback = once((...args) => {
                options.signal.removeEventListener("abort", abort);
                originalCallback.apply(stream, args);
            });
            options.signal.addEventListener("abort", abort);
        }
    }

    return cleanup;
}

function eosWeb(stream, options, callback) {
    let isAborted = false;
    let abort = nop;

    if (options.signal) {
        abort = () => {
            isAborted = true;
            callback.call(stream, new AbortError());
        };
        if (options.signal.aborted) {
            nextTick(abort);
        } else {
            const originalCallback = callback;
            options.signal.addEventListener('abort', abort);
            callback = once((...args) => {
                options.signal.removeEventListener('abort', abort);
                originalCallback.apply(stream, args);
            });
        }
    }

    const resolverFn = (...args) => {
        if (!isAborted) {
            nextTick(() => callback.apply(stream, args));
        }
    };

    const currentState = stream._state;
    if (currentState === 'closed') {
        nextTick(resolverFn);
    } else if (currentState === 'errored') {
        nextTick(() => resolverFn(stream._storedError));
    } else {
        let internalState = currentState;
        Object.defineProperty(stream, '_state', {
            get() { return internalState; },
            set(val) {
                internalState = val;
                if (val === 'closed') {
                    resolverFn();
                } else if (val === 'errored') {
                    nextTick(() => resolverFn(stream._storedError));
                }
            },
            configurable: true,
            enumerable: true,
        });
    }

    return nop;
}

export default eos;
