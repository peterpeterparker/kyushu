// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// deno-lint-ignore-file

import { AbortError, ERR_INVALID_ARG_TYPE } from "__wasm_rquickjs_builtin/internal/errors";
import { isNodeStream, isWebStream } from "__wasm_rquickjs_builtin/internal/streams/utils";
import eos from "__wasm_rquickjs_builtin/internal/streams/end-of-stream";

// This method is inlined here for readable-stream
// It also does not allow for signal to not exist on the stream
// https://github.com/nodejs/node/pull/36061#discussion_r533718029
const validateAbortSignal = (signal, name) => {
    if (
        typeof signal !== "object" ||
        !("aborted" in signal)
    ) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
    }
};

function addAbortSignal(signal, stream) {
    validateAbortSignal(signal, "signal");
    if (!isNodeStream(stream) && !isWebStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
    }
    return addAbortSignalNoValidate(signal, stream);
}
function addAbortSignalNoValidate(signal, stream) {
    if (typeof signal !== "object" || !("aborted" in signal)) {
        return stream;
    }
    const onAbort = isNodeStream(stream)
        ? () => {
            stream.destroy(new AbortError(undefined, { cause: signal.reason }));
        }
        : () => {
            const controller = stream._readableStreamController || stream._writableStreamController;
            if (controller && typeof controller.error === 'function') {
                controller.error(new AbortError(undefined, { cause: signal.reason }));
            }
        };
    if (signal.aborted) {
        onAbort();
    } else {
        signal.addEventListener("abort", onAbort);
        eos(stream, () => signal.removeEventListener("abort", onAbort));
    }
    return stream;
}

export default { addAbortSignal, addAbortSignalNoValidate };
export { addAbortSignal, addAbortSignalNoValidate };