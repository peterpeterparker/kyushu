import {
    TextDecoderStream,
    TextEncoderStream,
} from '__wasm_rquickjs_builtin/encoding';

import {
    ByteLengthQueuingStrategy,
    CountQueuingStrategy,
    ReadableByteStreamController,
    ReadableStream,
    ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    TransformStream,
    TransformStreamDefaultController,
    WritableStream,
    WritableStreamDefaultController,
    WritableStreamDefaultWriter,
} from '__wasm_rquickjs_builtin/streams';

// Patch ReadableStream to throw Node.js-compatible ERR_INVALID_STATE errors
// when the stream is already locked.
function errInvalidState(msg) {
    const e = new TypeError(msg);
    e.code = 'ERR_INVALID_STATE';
    return e;
}

function errInvalidArgValue(msg) {
    const e = new RangeError(msg);
    e.code = 'ERR_INVALID_ARG_VALUE';
    return e;
}

function errArgNotIterable() {
    const e = new TypeError('The "iterable" argument must be an instance of Iterable.');
    e.code = 'ERR_ARG_NOT_ITERABLE';
    return e;
}

const origGetReader = ReadableStream.prototype.getReader;
ReadableStream.prototype.getReader = function getReader(...args) {
    try {
        return origGetReader.apply(this, args);
    } catch (err) {
        if (err instanceof TypeError && err.code === undefined && /locked/i.test(err.message)) {
            throw errInvalidState('Invalid state: ReadableStream is locked');
        }
        throw err;
    }
};

const origValues = ReadableStream.prototype.values;
if (typeof origValues === 'function') {
    ReadableStream.prototype.values = function values(...args) {
        try {
            return origValues.apply(this, args);
        } catch (err) {
            if (err instanceof TypeError && err.code === undefined && /locked/i.test(err.message)) {
                throw errInvalidState('Invalid state: ReadableStream is locked');
            }
            throw err;
        }
    };
}

const symAsyncIterator = Symbol.asyncIterator;
const origAsyncIterator = ReadableStream.prototype[symAsyncIterator];
if (typeof origAsyncIterator === 'function') {
    ReadableStream.prototype[symAsyncIterator] = function(...args) {
        try {
            return origAsyncIterator.apply(this, args);
        } catch (err) {
            if (err instanceof TypeError && err.code === undefined && /locked/i.test(err.message)) {
                throw errInvalidState('Invalid state: ReadableStream is locked');
            }
            throw err;
        }
    };
}

const origByobReaderRead = ReadableStreamBYOBReader.prototype.read;
ReadableStreamBYOBReader.prototype.read = function read(view, ...args) {
    return Promise.resolve(origByobReaderRead.call(this, view, ...args)).catch((err) => {
        if (err instanceof TypeError && err.code === undefined && /zero-length|non-zero|detached/i.test(err.message)) {
            throw errInvalidState('Invalid state: View or Viewed ArrayBuffer is zero-length or detached');
        }
        throw err;
    });
};

const origRespondWithNewView = ReadableStreamBYOBRequest.prototype.respondWithNewView;
ReadableStreamBYOBRequest.prototype.respondWithNewView = function respondWithNewView(view) {
    try {
        return origRespondWithNewView.call(this, view);
    } catch (err) {
        if (err instanceof RangeError && err.code === undefined) {
            throw errInvalidArgValue(err.message);
        }
        if (err instanceof TypeError && err.code === undefined && /detached|invalidated|state|closed|zero-length|non-zero/i.test(err.message)) {
            throw errInvalidState(err.message);
        }
        throw err;
    }
};

ReadableStream.from = function from(iterable) {
    if (iterable == null) {
        throw errArgNotIterable();
    }
    const asyncIteratorFactory = iterable[Symbol.asyncIterator];
    const iteratorFactory = iterable[Symbol.iterator];
    if (typeof asyncIteratorFactory !== 'function' && typeof iteratorFactory !== 'function') {
        throw errArgNotIterable();
    }

    let iterator;
    return new ReadableStream({
        async pull(controller) {
            if (iterator === undefined) {
                iterator = typeof asyncIteratorFactory === 'function'
                    ? asyncIteratorFactory.call(iterable)
                    : iteratorFactory.call(iterable);
            }
            const result = await iterator.next();
            if (result.done) {
                controller.close();
            } else {
                controller.enqueue(result.value);
            }
        },
        async cancel(reason) {
            if (iterator && typeof iterator.return === 'function') {
                await iterator.return(reason);
            }
        },
    });
};

export {
    ByteLengthQueuingStrategy,
    CountQueuingStrategy,
    ReadableByteStreamController,
    ReadableStream,
    ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    TextDecoderStream,
    TextEncoderStream,
    TransformStream,
    TransformStreamDefaultController,
    WritableStream,
    WritableStreamDefaultController,
    WritableStreamDefaultWriter,
};
