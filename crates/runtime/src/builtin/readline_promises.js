// node:readline/promises stub

const NOT_SUPPORTED = new Error('node:readline/promises is not yet supported in WebAssembly environment');

export function createInterface() {
    throw NOT_SUPPORTED;
}

export class Interface {
    constructor() {
        throw NOT_SUPPORTED;
    }
}

export default { createInterface, Interface };
