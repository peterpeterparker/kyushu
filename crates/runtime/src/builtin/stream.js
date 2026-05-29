// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import { addAbortSignal, addAbortSignalNoValidate } from "__wasm_rquickjs_builtin/internal/streams/add-abort-signal";
import { destroyer } from "__wasm_rquickjs_builtin/internal/streams/destroy";
import { isDisturbed, isErrored, isNodeStream, isWritable } from "__wasm_rquickjs_builtin/internal/streams/utils";
import { isUint8Array } from "__wasm_rquickjs_builtin/internal/util/types";
import { pipeline } from "__wasm_rquickjs_builtin/internal/streams/pipeline";
import { promisify } from "__wasm_rquickjs_builtin/internal/util";
import { Stream } from "__wasm_rquickjs_builtin/internal/streams/legacy";
import compose from "__wasm_rquickjs_builtin/internal/streams/compose";
import Duplex from "__wasm_rquickjs_builtin/internal/streams/duplex";
import eos from "__wasm_rquickjs_builtin/internal/streams/end-of-stream";
import PassThrough from "__wasm_rquickjs_builtin/internal/streams/passthrough";
import promises from "node:stream/promises";
import Readable from "__wasm_rquickjs_builtin/internal/streams/readable";
import Transform from "__wasm_rquickjs_builtin/internal/streams/transform";
import Writable from "__wasm_rquickjs_builtin/internal/streams/writable";
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from "__wasm_rquickjs_builtin/internal/streams/state";
import { validateObject, validateAbortSignal } from "__wasm_rquickjs_builtin/internal/validators";
import { ERR_INVALID_ARG_VALUE } from "__wasm_rquickjs_builtin/internal/errors";
import { Buffer } from "buffer";
import { nextTick } from "node:process";

const { custom: customPromisify } = promisify;

function _uint8ArrayToBuffer(chunk) {
    return Buffer.from(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength,
    );
}

// Create wrapper functions to allow adding properties to imported functions
function pipelineWrapper(...args) {
    return pipeline(...args);
}
Object.defineProperty(pipelineWrapper, customPromisify, {
    configurable: true,
    enumerable: true,
    get() {
        return promises.pipeline;
    },
});

function finishedWrapper(...args) {
    return eos(...args);
}
Object.defineProperty(finishedWrapper, customPromisify, {
    configurable: true,
    enumerable: true,
    get() {
        return promises.finished;
    },
});

Stream.isDisturbed = isDisturbed;
Stream.Readable = Readable;
Stream.Writable = Writable;
Stream.Duplex = Duplex;
Stream.Transform = Transform;
Stream.PassThrough = PassThrough;
Stream.pipeline = pipelineWrapper;
Stream.addAbortSignal = addAbortSignal;
Stream.finished = finishedWrapper;
Stream.destroy = destroyer;
Stream.compose = compose;
Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;
Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;

// Set Readable.prototype.compose here to avoid circular dependency
// (compose.js → pipeline.js → passthrough.js → transform.js → readable.js)
Readable.prototype.compose = function composeMethod(stream, options) {
    if (options != null) {
        validateObject(options, 'options');
    }
    if (options?.signal != null) {
        validateAbortSignal(options.signal, 'options.signal');
    }

    if (isNodeStream(stream) && !isWritable(stream)) {
        throw new ERR_INVALID_ARG_VALUE('stream', stream, 'must be writable');
    }

    const composedStream = compose(this, stream);

    if (options?.signal) {
        addAbortSignalNoValidate(options.signal, composedStream);
    }

    return composedStream;
};

// duplexPair implementation
const kCallback = Symbol('Callback');

class DuplexSide extends Duplex {
    #otherSide = null;

    constructor(options) {
        super(options);
        this[kCallback] = null;
    }

    _initOtherSide(otherSide) {
        this.#otherSide = otherSide;
    }

    _read() {
        const callback = this[kCallback];
        if (callback) {
            this[kCallback] = null;
            callback();
        }
    }

    _write(chunk, _encoding, callback) {
        if (chunk.length === 0) {
            nextTick(callback);
        } else {
            this.#otherSide.push(chunk);
            this.#otherSide[kCallback] = callback;
        }
    }

    _final(callback) {
        this.#otherSide.on('end', callback);
        this.#otherSide.push(null);
    }
}

function duplexPair(options) {
    const side0 = new DuplexSide(options);
    const side1 = new DuplexSide(options);
    side0._initOtherSide(side1);
    side1._initOtherSide(side0);
    return [side0, side1];
}

Stream.duplexPair = duplexPair;

Object.defineProperty(Stream, "promises", {
    configurable: true,
    enumerable: true,
    get() {
        return promises;
    },
});

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;
Stream._isUint8Array = isUint8Array;
Stream._uint8ArrayToBuffer = _uint8ArrayToBuffer;

export default Stream;
export {
    _uint8ArrayToBuffer,
    addAbortSignal,
    compose,
    destroyer as destroy,
    getDefaultHighWaterMark,
    setDefaultHighWaterMark,
    Duplex,
    duplexPair,
    finishedWrapper as finished,
    isDisturbed,
    isErrored,
    isUint8Array as _isUint8Array,
    PassThrough,
    pipelineWrapper as pipeline,
    Readable,
    Stream,
    Transform,
    Writable,
};