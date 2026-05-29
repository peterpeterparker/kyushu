// node:readline stub implementation

const NOT_SUPPORTED = new Error('node:readline is not yet supported in WebAssembly environment');

export function createInterface() {
    throw NOT_SUPPORTED;
}

export class Interface {
    constructor() {
        throw NOT_SUPPORTED;
    }
}

export function clearLine(stream, dir, callback) {
    if (typeof callback === 'function') callback();
}

export function clearScreenDown(stream, callback) {
    if (typeof callback === 'function') callback();
}

export function cursorTo(stream, x, y, callback) {
    if (typeof callback === 'function') callback();
}

export function moveCursor(stream, dx, dy, callback) {
    if (typeof callback === 'function') callback();
}

export function emitKeypressEvents() {
    // no-op
}

export default {
    createInterface,
    Interface,
    clearLine,
    clearScreenDown,
    cursorTo,
    moveCursor,
    emitKeypressEvents,
};
