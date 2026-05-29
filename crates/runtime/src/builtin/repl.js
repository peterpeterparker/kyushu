// node:repl stub implementation
// REPL is not possible in WASM environment

const NOT_SUPPORTED_ERROR = 'repl is not supported in WebAssembly environment';

export function start(options) {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export class REPLServer {
    constructor() {
        throw new Error(NOT_SUPPORTED_ERROR);
    }
}

export class Recoverable {
    constructor(err) {
        this.err = err;
    }
}

export const REPL_MODE_SLOPPY = Symbol('repl-sloppy');
export const REPL_MODE_STRICT = Symbol('repl-strict');
export const builtinModules = [];

export default {
    start,
    REPLServer,
    Recoverable,
    REPL_MODE_SLOPPY,
    REPL_MODE_STRICT,
    builtinModules,
};
