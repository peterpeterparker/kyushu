// stream/consumers - helper functions that consume a Readable stream
// Based on Node.js lib/stream/consumers.js

import { Buffer } from "buffer";
import { ERR_INVALID_ARG_TYPE } from "__wasm_rquickjs_builtin/internal/errors";

async function blob(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return new Blob(chunks);
}

async function arrayBuffer(stream) {
    const ret = await blob(stream);
    return ret.arrayBuffer();
}

async function buffer(stream) {
    return Buffer.from(await arrayBuffer(stream));
}

async function text(stream) {
    const dec = new TextDecoder();
    let str = '';
    for await (const chunk of stream) {
        if (typeof chunk === 'string') {
            str += chunk;
        } else if (ArrayBuffer.isView(chunk) || chunk instanceof ArrayBuffer) {
            str += dec.decode(chunk, { stream: true });
        } else {
            throw new ERR_INVALID_ARG_TYPE(
                'chunk',
                ['string', 'Buffer', 'TypedArray', 'DataView'],
                chunk
            );
        }
    }
    str += dec.decode(undefined, { stream: false });
    return str;
}

async function json(stream) {
    const str = await text(stream);
    return JSON.parse(str);
}

export default { arrayBuffer, blob, buffer, json, text };
export { arrayBuffer, blob, buffer, json, text };
