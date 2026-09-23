import { inspect, format } from "__wasm_rquickjs_builtin/internal/util/inspect";

// ---------------------------------------------------------------------------
// V8-compatible CallSite objects
// ---------------------------------------------------------------------------
// Many npm packages (depd, source-map-support, etc.) rely on V8's structured
// stack trace API: Error.captureStackTrace, Error.prepareStackTrace, and
// CallSite objects with methods like getFileName(), getLineNumber(), etc.
//
// QuickJS produces plain string stack traces. We parse them into CallSite
// objects so that libraries consuming the V8 API work correctly.
// ---------------------------------------------------------------------------

const _callSiteWithFnPattern = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const _callSiteNoFnPattern = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;

function _makeCallSite(functionName, fileName, lineNumber, columnNumber) {
    return {
        getThis() { return undefined; },
        getTypeName() { return null; },
        getFunction() { return undefined; },
        getFunctionName() { return functionName || null; },
        getMethodName() { return null; },
        getFileName() { return fileName || null; },
        getLineNumber() { return lineNumber | 0; },
        getColumnNumber() { return columnNumber | 0; },
        getEvalOrigin() { return undefined; },
        isToplevel() { return true; },
        isEval() { return false; },
        isNative() { return false; },
        isConstructor() { return false; },
        isAsync() { return false; },
        isPromiseAll() { return false; },
        getPromiseIndex() { return null; },
        getScriptNameOrSourceURL() { return fileName || null; },
        toString() {
            const name = functionName || '<anonymous>';
            if (fileName) {
                return `${name} (${fileName}:${lineNumber}:${columnNumber})`;
            }
            return name;
        },
    };
}

function _parseStackStringToCallSites(stackString) {
    if (typeof stackString !== 'string') return [];
    const lines = stackString.split('\n');
    const sites = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m = line.match(_callSiteWithFnPattern);
        if (m) {
            sites.push(_makeCallSite(m[1], m[2], parseInt(m[3], 10), parseInt(m[4], 10)));
            continue;
        }
        m = line.match(_callSiteNoFnPattern);
        if (m) {
            sites.push(_makeCallSite(null, m[1], parseInt(m[2], 10), parseInt(m[3], 10)));
        }
    }
    return sites;
}

// Helper to create property descriptors immune to Object.prototype pollution.
// Some libraries (e.g., test-assert-fail.js) set Object.prototype.get which
// would leak into plain object descriptors and cause "Cannot both specify
// accessors and a value or writable attribute" errors.
function _dataDesc(value) {
    const d = Object.create(null);
    d.value = value;
    d.writable = true;
    d.configurable = true;
    d.enumerable = false;
    return d;
}

// Normalize `Error.prototype.stack` so deleting an instance stack works like
// Node (i.e. `delete err.stack` makes subsequent `err.stack` reads undefined).
const nativeErrorStackDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, "stack");
const NativeError = Error;
const nativeErrorToString = Error.prototype.toString;
const materializedErrorStacks = new WeakSet();

function materializeOwnStack(errorInstance) {
    if (!errorInstance || (typeof errorInstance !== "object" && typeof errorInstance !== "function")) {
        return;
    }

    const own = Object.getOwnPropertyDescriptor(errorInstance, "stack");
    if (own && Object.prototype.hasOwnProperty.call(own, "value") && own.configurable === true) {
        materializedErrorStacks.add(errorInstance);
        return;
    }

    let stackValue;
    try {
        if (own && typeof own.get === "function") {
            stackValue = own.get.call(errorInstance);
        } else if (nativeErrorStackDescriptor && typeof nativeErrorStackDescriptor.get === "function") {
            stackValue = nativeErrorStackDescriptor.get.call(errorInstance);
        } else if (nativeErrorStackDescriptor && Object.prototype.hasOwnProperty.call(nativeErrorStackDescriptor, "value")) {
            stackValue = nativeErrorStackDescriptor.value;
        }
    } catch {
        stackValue = undefined;
    }

    if (stackValue === undefined || stackValue === "") {
        try {
            stackValue = nativeErrorToString.call(errorInstance);
        } catch {
            stackValue = undefined;
        }
    }

    try {
        Object.defineProperty(errorInstance, "stack", _dataDesc(stackValue));
        materializedErrorStacks.add(errorInstance);
    } catch {
        // Best effort only.
    }
}

function installErrorStackShimForNonConfigurablePrototype() {
    const ErrorShimPrototype = Object.create(NativeError.prototype);

    Object.defineProperty(ErrorShimPrototype, "stack", {
        configurable: true,
        enumerable: false,
        get() {
            const own = Object.getOwnPropertyDescriptor(this, "stack");
            if (!own) {
                return undefined;
            }
            if (Object.prototype.hasOwnProperty.call(own, "value")) {
                return own.value;
            }
            if (typeof own.get === "function") {
                return own.get.call(this);
            }
            return undefined;
        },
        set(value) {
            Object.defineProperty(this, "stack", _dataDesc(value));
        },
    });

    const ErrorShim = function Error() {
        const ctorTarget = new.target || ErrorShim;
        const errorInstance = Reflect.construct(NativeError, arguments, NativeError);
        materializeOwnStack(errorInstance);

        // Error.prepareStackTrace support (V8 compat).
        // Replace the materialized .stack data property with a lazy getter that
        // checks Error.prepareStackTrace on first access, then materializes the
        // result as a plain data property so subsequent reads have no overhead.
        const rawStack = errorInstance.stack;
        Object.defineProperty(errorInstance, "stack", {
            get() {
                const prepareStackTrace = globalThis.Error && globalThis.Error.prepareStackTrace;
                const result = typeof prepareStackTrace === "function"
                    ? prepareStackTrace(errorInstance, _parseStackStringToCallSites(rawStack))
                    : rawStack;
                Object.defineProperty(errorInstance, "stack", _dataDesc(result));
                return result;
            },
            set(value) {
                Object.defineProperty(errorInstance, "stack", _dataDesc(value));
            },
            configurable: true,
            enumerable: false,
        });

        const targetPrototype = (ctorTarget && ctorTarget.prototype) || ErrorShimPrototype;
        if (Object.getPrototypeOf(errorInstance) !== targetPrototype) {
            Object.setPrototypeOf(errorInstance, targetPrototype);
        }

        return errorInstance;
    };

    Object.setPrototypeOf(ErrorShim, NativeError);
    ErrorShim.prototype = ErrorShimPrototype;
    Object.defineProperty(ErrorShimPrototype, "constructor", {
        value: NativeError,
        writable: true,
        configurable: true,
        enumerable: false,
    });

    Object.defineProperty(ErrorShim, Symbol.hasInstance, {
        value(value) {
            return value instanceof NativeError;
        },
        configurable: true,
    });

    globalThis.Error = ErrorShim;
}

if (nativeErrorStackDescriptor && nativeErrorStackDescriptor.configurable === false) {
    try {
        installErrorStackShimForNonConfigurablePrototype();
    } catch {
        // Keep the runtime default behavior if shimming fails.
    }
} else {
    try {
        Object.defineProperty(Error.prototype, "stack", {
            configurable: true,
            enumerable: false,
            get: function getErrorStack() {
                if (this === Error.prototype) {
                    return undefined;
                }

                const own = Object.getOwnPropertyDescriptor(this, "stack");
                if (own) {
                    if (Object.prototype.hasOwnProperty.call(own, "value")) {
                        return own.value;
                    }
                    if (typeof own.get === "function" && own.get !== getErrorStack) {
                        return own.get.call(this);
                    }
                    return undefined;
                }
                return undefined;
            },
            set(value) {
                Object.defineProperty(this, "stack", _dataDesc(value));
                materializedErrorStacks.add(this);
            },
        });
    } catch {
        // Keep best-effort compatibility if the runtime forbids reconfiguration.
    }
}

// ---------------------------------------------------------------------------
// Global Error.captureStackTrace & Error.stackTraceLimit (V8 compat)
// ---------------------------------------------------------------------------
// QuickJS natively provides Error.captureStackTrace, Error.prepareStackTrace,
// Error.stackTraceLimit, and native CallSite objects. However, the ErrorShim
// above replaces globalThis.Error, which can interfere with the native
// prepareStackTrace getter/setter chain when Error.captureStackTrace is called.
//
// We wrap the native captureStackTrace so that it checks the JS-level
// Error.prepareStackTrace (which may be set on the ErrorShim) and, if set,
// parses the raw stack string into our JS CallSite objects. This ensures
// libraries like depd that set Error.prepareStackTrace and then call
// Error.captureStackTrace get proper CallSite objects.
{
    const nativeCaptureStackTrace = globalThis.Error.captureStackTrace;
    if (typeof nativeCaptureStackTrace === 'function') {
        globalThis.Error.captureStackTrace = function captureStackTrace(targetObject, constructorOpt) {
            // If prepareStackTrace is set at the JS level (e.g., on the ErrorShim),
            // we need to handle it ourselves since the native captureStackTrace
            // may not see it through the ErrorShim prototype chain.
            const currentPrepare = globalThis.Error && globalThis.Error.prepareStackTrace;
            if (typeof currentPrepare === 'function') {
                // Temporarily clear prepareStackTrace so the native implementation
                // produces a raw string stack (not CallSite objects).
                globalThis.Error.prepareStackTrace = undefined;
                try {
                    nativeCaptureStackTrace(targetObject, constructorOpt);
                } finally {
                    globalThis.Error.prepareStackTrace = currentPrepare;
                }

                // Read the raw stack string, parse into CallSites, and install
                // a lazy getter that calls prepareStackTrace on first access.
                const rawStack = targetObject.stack;
                if (typeof rawStack === 'string') {
                    const callSites = _parseStackStringToCallSites(rawStack);
                    Object.defineProperty(targetObject, "stack", {
                        get() {
                            const prepare = globalThis.Error && globalThis.Error.prepareStackTrace;
                            const result = typeof prepare === "function"
                                ? prepare(targetObject, callSites)
                                : rawStack;
                            Object.defineProperty(targetObject, "stack", _dataDesc(result));
                            return result;
                        },
                        set(value) {
                            Object.defineProperty(targetObject, "stack", _dataDesc(value));
                        },
                        configurable: true,
                        enumerable: false,
                    });
                }
            } else {
                // No prepareStackTrace set — just use the native implementation as-is.
                nativeCaptureStackTrace(targetObject, constructorOpt);
            }
        };
    }
}

// Node.js includes the error code in toString() so that regex tests like
// /ERR_INVALID_ARG_TYPE/ can match against String(error).
// We keep message and name clean (for exact-match tests) but add toString().
function addCodeToMessage(err, code) {
    err.code = code;
    const origToString = Error.prototype.toString;
    Object.defineProperty(err, 'toString', {
        value: function() {
            const name = this.name || 'Error';
            const msg = this.message || '';
            if (!msg) return `${name} [${code}]`;
            return `${name} [${code}]: ${msg}`;
        },
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

/**
 * 
 * @template T
 * @param {T} fn 
 * @return {T}
 */
export function hideStackFrames(fn) {
    const hidden = "__node_internal_" + fn.name;
    Object.defineProperty(fn, "name", { value: hidden });

    return fn;
}

export class ERR_HTTP_HEADERS_SENT extends Error {
    constructor(x) {
        super(
            `Cannot ${x} headers after they are sent to the client`,
        );
        addCodeToMessage(this, "ERR_HTTP_HEADERS_SENT");
    }
}

export class ERR_HTTP_SOCKET_ASSIGNED extends Error {
    constructor() {
        super(
            "ServerResponse has an already assigned socket",
        );
        addCodeToMessage(this, "ERR_HTTP_SOCKET_ASSIGNED");
    }
}

export class ERR_HTTP_BODY_NOT_ALLOWED extends Error {
    constructor() {
        super(
            "Adding content for this request method or response status is not allowed.",
        );
        addCodeToMessage(this, "ERR_HTTP_BODY_NOT_ALLOWED");
    }
}

export class ERR_HTTP_CONTENT_LENGTH_MISMATCH extends Error {
    constructor(bodyLength, contentLength) {
        super(
            `Response body's content-length of ${bodyLength} byte(s) does not match the content-length of ${contentLength} byte(s) set in header`,
        );
        addCodeToMessage(this, "ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    }
}

export class ERR_HTTP_INVALID_HEADER_VALUE extends TypeError {
    constructor(x, y) {
        super(
            `Invalid value "${x}" for header "${y}"`,
        );
        addCodeToMessage(this, "ERR_HTTP_INVALID_HEADER_VALUE");
    }
}

export class ERR_HTTP_TRAILER_INVALID extends Error {
    constructor() {
        super(
            `Trailers are invalid with this transfer encoding`,
        );
        addCodeToMessage(this, "ERR_HTTP_TRAILER_INVALID");
    }
}

export class ERR_INVALID_HTTP_TOKEN extends TypeError {
    constructor(x, y) {
        super(`${x} must be a valid HTTP token ["${y}"]`);
        addCodeToMessage(this, "ERR_INVALID_HTTP_TOKEN");
    }
}

export class ERR_UNESCAPED_CHARACTERS extends TypeError {
    constructor(x) {
        super(`${x} contains unescaped characters`);
        addCodeToMessage(this, "ERR_UNESCAPED_CHARACTERS");
    }
}

const classRegExp = /^([A-Z][a-z0-9]*)+$/;

const kTypes = [
    "string",
    "function",
    "number",
    "object",
    "Function",
    "Object",
    "boolean",
    "bigint",
    "symbol",
];

function createInvalidArgType(name, expected) {
    expected = Array.isArray(expected) ? expected : [expected];
    let msg = "The ";
    if (name.endsWith(" argument")) {
        msg += `${name} `;
    } else {
        const type = name.includes(".") ? "property" : "argument";
        msg += `"${name}" ${type} `;
    }
    msg += "must be ";

    const types = [];
    const instances = [];
    const other = [];
    for (const value of expected) {
        if (kTypes.includes(value)) {
            types.push(value.toLocaleLowerCase());
        } else if (classRegExp.test(value)) {
            instances.push(value);
        } else {
            other.push(value);
        }
    }

    if (instances.length > 0) {
        const pos = types.indexOf("object");
        if (pos !== -1) {
            types.splice(pos, 1);
            instances.push("Object");
        }
    }

    if (types.length > 0) {
        if (types.length > 2) {
            const last = types.pop();
            msg += `one of type ${types.join(", ")}, or ${last}`;
        } else if (types.length === 2) {
            msg += `one of type ${types[0]} or ${types[1]}`;
        } else {
            msg += `of type ${types[0]}`;
        }
        if (instances.length > 0 || other.length > 0) {
            msg += " or ";
        }
    }

    if (instances.length > 0) {
        if (instances.length > 2) {
            const last = instances.pop();
            msg += `an instance of ${instances.join(", ")}, or ${last}`;
        } else {
            msg += `an instance of ${instances[0]}`;
            if (instances.length === 2) {
                msg += ` or ${instances[1]}`;
            }
        }
        if (other.length > 0) {
            msg += " or ";
        }
    }

    if (other.length > 0) {
        if (other.length > 2) {
            const last = other.pop();
            msg += `one of ${other.join(", ")}, or ${last}`;
        } else if (other.length === 2) {
            msg += `one of ${other[0]} or ${other[1]}`;
        } else {
            if (other[0].toLowerCase() !== other[0]) {
                msg += "an ";
            }
            msg += `${other[0]}`;
        }
    }

    return msg;
}

function invalidArgTypeHelper(input) {
    if (input == null) {
        return ` Received ${input}`;
    }
    if (typeof input === "function") {
        return ` Received function ${input.name || ""}`;
    }
    if (typeof input === "object") {
        if (input.constructor && input.constructor.name) {
            return ` Received an instance of ${input.constructor.name}`;
        }
        return ` Received ${inspect(input, { depth: -1 })}`;
    }
    let inspected = inspect(input, { colors: false });
    if (inspected.length > 28) {
        inspected = `${inspected.slice(0, 25)}...`;
    }
    return ` Received type ${typeof input} (${inspected})`;
}

/**
 * 
 * @param {string} val 
 * @returns {string}
 */
function addNumericalSeparator(val) {
    let res = "";
    let i = val.length;
    const start = val[0] === "-" ? 1 : 0;
    for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
    }
    return `${val.slice(0, i)}${res}`;
}

export class ERR_OUT_OF_RANGE extends RangeError {
    /**
     * 
     * @param {string} str 
     * @param {string} range 
     * @param {unknown} input 
     * @param {boolean} replaceDefaultBoolean 
     */
    constructor(
        str,
        range,
        input,
        replaceDefaultBoolean = false,
    ) {
        // assert(range, 'Missing "range" argument');
        let msg = replaceDefaultBoolean
            ? str
            : `The value of "${str}" is out of range.`;
        let received;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
            received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
            received = String(input);
            if (input > 2n ** 32n || input < -(2n ** 32n)) {
                received = addNumericalSeparator(received);
            }
            received += "n";
        } else {
            received = inspect(input);
        }
        msg += ` It must be ${range}. Received ${received}`;

        super(msg);
        addCodeToMessage(this, "ERR_OUT_OF_RANGE");
    }
}

export class ERR_INVALID_ARG_TYPE_RANGE extends RangeError {
    constructor(name, expected, actual) {
        const msg = createInvalidArgType(name, expected);

        super(`${msg}.${invalidArgTypeHelper(actual)}`);
        addCodeToMessage(this, "ERR_INVALID_ARG_TYPE");
    }
}

export class ERR_INVALID_ARG_TYPE extends TypeError {
    /**
     * 
     * @param {string} name 
     * @param {string | string[]} expected 
     * @param {unknown} actual 
     */
    constructor(name, expected, actual) {
        const msg = createInvalidArgType(name, expected);

        super(`${msg}.${invalidArgTypeHelper(actual)}`);
        addCodeToMessage(this, "ERR_INVALID_ARG_TYPE");
    }

    static RangeError = ERR_INVALID_ARG_TYPE_RANGE;
}

function inspectValue(value) {
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return inspect(value, { colors: false });
}

export class ERR_INVALID_ARG_VALUE_RANGE extends RangeError {
    constructor(name, value, reason = "is invalid") {
        const type = name.includes(".") ? "property" : "argument";
        const inspected = inspectValue(value);

        super(`The ${type} '${name}' ${reason}. Received ${inspected}`,);

        addCodeToMessage(this, "ERR_INVALID_ARG_VALUE")
    }
}

export class ERR_INVALID_ARG_VALUE extends TypeError {
    constructor(name, value, reason = "is invalid") {
        const type = name.includes(".") ? "property" : "argument";
        const inspected = inspectValue(value);

        super(`The ${type} '${name}' ${reason}. Received ${inspected}`,);

        addCodeToMessage(this, "ERR_INVALID_ARG_VALUE")
    }
}

export class ERR_INVALID_THIS extends TypeError {
    constructor(type) {
        super(`Value of "this" must be of type ${type}`);
        addCodeToMessage(this, "ERR_INVALID_THIS");
    }
}

export class ERR_INVALID_CHAR extends TypeError {
    constructor(name, field) {
        super(field
            ? `Invalid character in ${name}`
            : `Invalid character in ${name} ["${field}"]`,
        );
        addCodeToMessage(this, "ERR_INVALID_CHAR");
    }
}

export class ERR_METHOD_NOT_IMPLEMENTED extends Error {
    constructor(x) {
        super(`The ${x} method is not implemented`);
        addCodeToMessage(this, "ERR_METHOD_NOT_IMPLEMENTED");
    }
}

export class ERR_STREAM_CANNOT_PIPE extends Error {
    constructor() {
        super(`Cannot pipe, not readable`);
        addCodeToMessage(this, "ERR_STREAM_CANNOT_PIPE");
    }
}

export class ERR_STREAM_ALREADY_FINISHED extends Error {
    constructor(x) {
        super(
            `Cannot call ${x} after a stream was finished`,
        );
        addCodeToMessage(this, "ERR_STREAM_ALREADY_FINISHED");
    }
}

export class ERR_STREAM_WRITE_AFTER_END extends Error {
    constructor() {
        super(`write after end`);
        addCodeToMessage(this, "ERR_STREAM_WRITE_AFTER_END");
    }
}

export class ERR_STREAM_NULL_VALUES extends TypeError {
    constructor() {
        super(`May not write null values to stream`);
        addCodeToMessage(this, "ERR_STREAM_NULL_VALUES");
    }
}

export class ERR_STREAM_DESTROYED extends Error {
    constructor(x) {
        super(
            `Cannot call ${x} after a stream was destroyed`,
        );
        addCodeToMessage(this, "ERR_STREAM_DESTROYED");
    }
}

export function aggregateTwoErrors(innerError, outerError) {
    if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors)) {
            // If `outerError` is already an `AggregateError`.
            outerError.errors.push(innerError);
            return outerError;
        }
        // eslint-disable-next-line no-restricted-syntax
        const err = new AggregateError(
            [
                outerError,
                innerError,
            ],
            outerError.message,
        );
        // deno-lint-ignore no-explicit-any
        err.code = outerError.code;
        return err;
    }
    return innerError || outerError;
}

export class ERR_SOCKET_BAD_PORT extends RangeError {
    constructor(name, port, allowZero = true) {
        const operator = allowZero ? ">=" : ">";

        super(
            `${name} should be ${operator} 0 and < 65536. Received ${port}.`,
        );
        addCodeToMessage(this, "ERR_SOCKET_BAD_PORT");
    }
}

export class ERR_STREAM_PREMATURE_CLOSE extends Error {
    constructor() {
        super(`Premature close`);
        addCodeToMessage(this, "ERR_STREAM_PREMATURE_CLOSE");
    }
}

export class AbortError extends Error {
    constructor(reason) {
        super("The operation was aborted", reason !== undefined ? { cause: reason } : undefined);
        addCodeToMessage(this, "ABORT_ERR");
        this.name = "AbortError";
    }
}

export class ERR_INVALID_CALLBACK extends TypeError {
    constructor(object) {
        super(
            `Callback must be a function. Received ${JSON.stringify(object)}`,
        );
        addCodeToMessage(this, "ERR_INVALID_CALLBACK");
    }
}

export class ERR_MISSING_ARGS extends TypeError {
    constructor(...args) {
        let msg = "The ";

        const len = args.length;

        const wrap = (a) => `"${a}"`;

        args = args.map((a) =>
            Array.isArray(a) ? a.map(wrap).join(" or ") : wrap(a)
        );

        switch (len) {
            case 1:
                msg += `${args[0]} argument`;
                break;
            case 2:
                msg += `${args[0]} and ${args[1]} arguments`;
                break;
            default:
                msg += args.slice(0, len - 1).join(", ");
                msg += `, and ${args[len - 1]} arguments`;
                break;
        }

        super(`${msg} must be specified`);
        addCodeToMessage(this, "ERR_MISSING_ARGS");
    }
}
export class ERR_MISSING_OPTION extends TypeError {
    constructor(x) {
        super(`${x} is required`);
        addCodeToMessage(this, "ERR_MISSING_OPTION");
    }
}
export class ERR_MULTIPLE_CALLBACK extends Error {
    constructor() {
        super(`Callback called multiple times`);
        addCodeToMessage(this, "ERR_MULTIPLE_CALLBACK");
    }
}

export class ERR_STREAM_PUSH_AFTER_EOF extends Error {
    constructor() {
        super(`stream.push() after EOF`);
        addCodeToMessage(this, "ERR_STREAM_PUSH_AFTER_EOF");
    }
}

export class ERR_STREAM_UNSHIFT_AFTER_END_EVENT extends Error {
    constructor() {
        super(
            `stream.unshift() after end event`,
        );
        addCodeToMessage(this, "ERR_STREAM_UNSHIFT_AFTER_END_EVENT");
    }
}

export class ERR_ENCODING_NOT_SUPPORTED extends RangeError {
    constructor(encoding) {
        super(`The "${encoding}" encoding is not supported`);
        addCodeToMessage(this, "ERR_ENCODING_NOT_SUPPORTED");
    }
}

export class ERR_ENCODING_INVALID_ENCODED_DATA extends TypeError {
    constructor(encoding) {
        super(`The encoded data was not valid for encoding ${encoding}`);
        addCodeToMessage(this, "ERR_ENCODING_INVALID_ENCODED_DATA");
    }
}

export class ERR_NO_ICU extends TypeError {
    constructor(feature) {
        super(`"${feature}" option is not supported on Node.js compiled without ICU`);
        addCodeToMessage(this, "ERR_NO_ICU");
    }
}

export class ERR_UNKNOWN_ENCODING extends TypeError {
    constructor(x) {
        super(format("Unknown encoding: %s", x));
        addCodeToMessage(this, "ERR_UNKNOWN_ENCODING");
    }
}

export class ERR_STRING_TOO_LONG extends Error {
    constructor(maxLength) {
        const maxLengthHex = Number.isFinite(maxLength)
            ? `0x${Math.floor(maxLength).toString(16)}`
            : String(maxLength);
        super(`Cannot create a string longer than ${maxLengthHex} characters`);
        addCodeToMessage(this, "ERR_STRING_TOO_LONG");
    }
}

export class ERR_BUFFER_OUT_OF_BOUNDS extends RangeError {
    constructor(name) {
        if (name) {
            super(`"${name}" is outside of buffer bounds`);
        } else {
            super('Attempt to access memory outside buffer bounds');
        }
        addCodeToMessage(this, "ERR_BUFFER_OUT_OF_BOUNDS");
    }
}

function buildReturnPropertyType(value) {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    if (value && value.constructor && value.constructor.name) {
        return `an instance of ${value.constructor.name}`;
    }
    return `type ${typeof value}`;
}

export class ERR_INVALID_RETURN_VALUE extends TypeError {
    constructor(input, name, value) {
        super(
            `Expected ${input} to be returned from the "${name}" function but got ${buildReturnPropertyType(value)}.`,
        );
        addCodeToMessage(this, "ERR_INVALID_RETURN_VALUE");
    }
}

export class ERR_INCOMPATIBLE_OPTION_PAIR extends TypeError {
    constructor(input, name) {
        super(
            `Option "${input}" cannot be used in combination with option "${name}"`,
        );
        addCodeToMessage(this, "ERR_INCOMPATIBLE_OPTION_PAIR");
    }
}

export const captureStackTrace = hideStackFrames(
    function captureStackTrace(err) {
        // Error.captureStackTrace is only available in V8
        const e = new Error();
        Object.defineProperties(err, {
            stack: {
                configurable: true,
                writable: true,
                get: () => e.stack
            }
        })
        return err;
    },
);

const captureLargerStackTrace = hideStackFrames(
    function captureLargerStackTrace(err) {
        captureStackTrace(err);

        return err;
    },
);


/**
 * All error instances in Node have additional methods and properties
 * This export class is meant to be extended by these instances abstracting native JS error instances
 */
export class NodeErrorAbstraction extends Error {
    /**
     * @type {string}
     */
    code;

    /**
     * 
     * @param {string} name 
     * @param {string} code 
     * @param {string} message 
     */
    constructor(name, code, message) {
        super(message);
        this.code = code;
        this.name = name;
    }

    toString() {
        return `${this.name} [${this.code}]: ${this.message}`;
    }
}

const kIsNodeError = Symbol("kIsNodeError");

/**
 * @typedef {Object} NodeSystemErrorCtx
 * @property {string} code
 * @property {string} syscall
 * @property {string} message
 * @property {number} errno
 * @property {string=} path
 * @property {string=} dest
 */

class NodeSystemError extends NodeErrorAbstraction {
    /**
     * 
     * @param {string} key 
     * @param {NodeSystemErrorCtx} context 
     * @param {string} msgPrefix 
     */
    constructor(key, context, msgPrefix) {
        let message = `${msgPrefix}: ${context.syscall} returned ` +
            `${context.code} (${context.message})`;

        if (context.path !== undefined) {
            message += ` ${context.path}`;
        }
        if (context.dest !== undefined) {
            message += ` => ${context.dest}`;
        }

        super("SystemError", key, message);
        // captureLargerStackTrace(this);

        Object.defineProperties(this, {
            [kIsNodeError]: {
                value: true,
                enumerable: false,
                writable: false,
                configurable: true,
            },
            info: {
                value: context,
                enumerable: true,
                configurable: true,
                writable: false,
            },
            errno: {
                get() {
                    return context.errno;
                },
                set: (value) => {
                    context.errno = value;
                },
                enumerable: true,
                configurable: true,
            },
            syscall: {
                get() {
                    return context.syscall;
                },
                set: (value) => {
                    context.syscall = value;
                },
                enumerable: true,
                configurable: true,
            },
        });

        if (context.path !== undefined) {
            Object.defineProperty(this, "path", {
                get() {
                    return context.path;
                },
                set: (value) => {
                    context.path = value;
                },
                enumerable: true,
                configurable: true,
            });
        }

        if (context.dest !== undefined) {
            Object.defineProperty(this, "dest", {
                get() {
                    return context.dest;
                },
                set: (value) => {
                    context.dest = value;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    toString() {
        return `${this.name} [${this.code}]: ${this.message}`;
    }
}

/**
 * 
 * @param {string} key 
 * @param {string} msgPrfix 
 */
function makeSystemErrorWithCode(key, msgPrfix) {
    return class NodeError extends NodeSystemError {
        /**
         * 
         * @param {NodeSystemErrorCtx} ctx 
         */
        constructor(ctx) {
            super(key, ctx, msgPrfix);
        }
    };
}

export const ERR_FS_EISDIR = makeSystemErrorWithCode(
    "ERR_FS_EISDIR",
    "Path is a directory",
);

export const ERR_SYSTEM_ERROR = makeSystemErrorWithCode(
    "ERR_SYSTEM_ERROR",
    "A system error occurred",
);

export const ERR_FS_CP_DIR_TO_NON_DIR = makeSystemErrorWithCode('ERR_FS_CP_DIR_TO_NON_DIR',
    'Cannot overwrite directory with non-directory');
export const ERR_FS_CP_EEXIST = makeSystemErrorWithCode('ERR_FS_CP_EEXIST', 'Target already exists');
export const ERR_FS_CP_EINVAL = makeSystemErrorWithCode('ERR_FS_CP_EINVAL', 'Invalid src or dest');
export const ERR_FS_CP_FIFO_PIPE = makeSystemErrorWithCode('ERR_FS_CP_FIFO_PIPE', 'Cannot copy a FIFO pipe');
export const ERR_FS_CP_NON_DIR_TO_DIR = makeSystemErrorWithCode('ERR_FS_CP_NON_DIR_TO_DIR',
    'Cannot overwrite non-directory with directory');
export const ERR_FS_CP_SOCKET = makeSystemErrorWithCode('ERR_FS_CP_SOCKET', 'Cannot copy a socket file');
export const ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY = makeSystemErrorWithCode('ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY',
    'Cannot overwrite symlink in subdirectory of self');
export const ERR_FS_CP_UNKNOWN = makeSystemErrorWithCode('ERR_FS_CP_UNKNOWN', 'Cannot copy an unknown file type');

/**
 * 
 * @param {number} name 
 * @returns {[string, string]}
 */
function uvErrmapGet(name) {
    return errorMap.get(name);
}

const uvUnmappedError = ["UNKNOWN", "unknown error"];

/**
 * This creates an error compatible with errors produced in the C++
 * function UVException using a context object with data assembled in C++.
 * The goal is to migrate them to ERR_* errors later when compatibility is
 * not a concern.
 */
export const uvException = hideStackFrames(
    /**
     * 
     * @param {NodeSystemErrorCtx} ctx 
     * @returns 
     */
    function uvException(ctx) {
        const { 0: code, 1: uvmsg } = uvErrmapGet(ctx.errno) || uvUnmappedError;

        let message = `${code}: ${ctx.message || uvmsg}, ${ctx.syscall}`;

        let path;
        let dest;

        if (ctx.path) {
            path = ctx.path.toString();
            message += ` '${path}'`;
        }
        if (ctx.dest) {
            dest = ctx.dest.toString();
            message += ` -> '${dest}'`;
        }


        const err = new Error(message);

        for (const prop of Object.keys(ctx)) {
            if (prop === "message" || prop === "path" || prop === "dest") {
                continue;
            }

            err[prop] = ctx[prop];
        }

        err.code = code;

        if (path) {
            err.path = path;
        }

        if (dest) {
            err.dest = dest;
        }

        return captureLargerStackTrace(err);
    }
);

export function isErrorStackTraceLimitWritable() {
    // Do no touch Error.stackTraceLimit as V8 would attempt to install
    // it again during deserialization.
    if (false && import('v8').startupSnapshot.isBuildingSnapshot()) {
        return false;
    }

    const desc = Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit');
    if (desc === undefined) {
        return Object.isExtensible(Error);
    }

    return Object.prototype.hasOwnProperty(desc, 'writable') ?
        desc.writable :
        desc.set !== undefined;
}

export class ERR_UNAVAILABLE_DURING_EXIT extends Error {
    constructor() {
        super(
            "ERR_UNAVAILABLE_DURING_EXIT",
            `Cannot call function in process exit handler`,
        );
    }
}

export class ERR_ASSERT_SNAPSHOT_NOT_SUPPORTED extends TypeError {
    constructor() {
        super(
            "ERR_ASSERT_SNAPSHOT_NOT_SUPPORTED",
            `Snapshot is not supported in this context`,
        );
    }
}

export class ERR_AMBIGUOUS_ARGUMENT extends TypeError {
    constructor(arg, msg) {
        super(
            "ERR_AMBIGUOUS_ARGUMENT",
            `The ${arg} argument is ambiguous. ${msg}`,
        );
    }
}

export class ERR_DIR_CLOSED extends Error {
    constructor() {
        super("Directory handle was closed");
        addCodeToMessage(this, "ERR_DIR_CLOSED");
    }
}

export class ERR_DIR_CONCURRENT_OPERATION extends Error {
    constructor() {
        super(
            "Cannot do synchronous work on directory handle with concurrent asynchronous operations",
        );
        addCodeToMessage(this, "ERR_DIR_CONCURRENT_OPERATION");
    }
}

export class ERR_FS_FILE_TOO_LARGE extends RangeError {
    constructor(x) {
        super(
            `File size (${x}) is greater than 2 GB`,
        );
        addCodeToMessage(this, "ERR_FS_FILE_TOO_LARGE");
    }
}

export class AggregateError extends Error {
    constructor(errs) {
        super();
        this.name = "AggregateError";
        this.code = errs[0].code;
        this.errors = errs;
    }
}

export class ERR_FS_INVALID_SYMLINK_TYPE extends Error {
    constructor(x) {
        super(
            `Symlink type must be one of "dir", "file", or "junction". Received "${x}"`,
        );
        addCodeToMessage(this, "ERR_FS_INVALID_SYMLINK_TYPE");
    }
}

export class ERR_CRYPTO_FIPS_FORCED extends Error {
    constructor() {
        super(
            'Cannot set FIPS mode, it was forced with --force-fips at startup.',
        );
        addCodeToMessage(this, "ERR_CRYPTO_FIPS_FORCED");
    }
}

export class ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH extends RangeError {
    constructor() {
        super(
            'Input buffers must have the same byte length',
        );
        addCodeToMessage(this, "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH");
    }
}

export class ERR_OPERATION_FAILED extends Error {
    constructor(x) {
        super(
            `Operation failed: ${x}`,
        );
        addCodeToMessage(this, "ERR_OPERATION_FAILED");
    }
}

export class ERR_CRYPTO_ENGINE_UNKNOWN extends Error {
    constructor(x) {
        super(
            `Engine "${x}" was not found`,
        );
        addCodeToMessage(this, "ERR_CRYPTO_ENGINE_UNKNOWN");
    }
}

export class ERR_CRYPTO_INVALID_DIGEST extends TypeError {
    constructor(x) {
        super(`Invalid digest: ${x}`);
        addCodeToMessage(this, "ERR_CRYPTO_INVALID_DIGEST");
    }
}

export class ERR_CRYPTO_SCRYPT_INVALID_PARAMETER extends Error {
    constructor() {
        super(`Invalid scrypt parameter`);
        addCodeToMessage(this, "ERR_CRYPTO_SCRYPT_INVALID_PARAMETER");
    }
}

export class ERR_CRYPTO_SCRYPT_NOT_SUPPORTED extends Error {
    constructor() {
        super(`Scrypt algorithm not supported`);
        addCodeToMessage(this, "ERR_CRYPTO_SCRYPT_NOT_SUPPORTED");
    }
}

export class ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS extends Error {
    constructor(a, b) {
        super(`The selected key encoding ${a} ${b}.`);
        addCodeToMessage(this, "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS");
    }
}

export class ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE extends TypeError {
    constructor(t, e) {
        super(`Invalid key object type ${t}, expected ${e}.`);
        addCodeToMessage(this, "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE");
    }
}

export class ERR_CRYPTO_INVALID_JWK extends TypeError {
    constructor() {
        super(`Invalid JWK data`);
        addCodeToMessage(this, "ERR_CRYPTO_INVALID_JWK");
    }
}

export class ERR_ILLEGAL_CONSTRUCTOR extends TypeError {
    constructor() {
        super(`Illegal constructor`);
        addCodeToMessage(this, "ERR_ILLEGAL_CONSTRUCTOR");
    }
}

export class ERR_CRYPTO_INVALID_KEYLEN extends RangeError {
    constructor() {
        super(`Invalid key length`);
        addCodeToMessage(this, "ERR_CRYPTO_INVALID_KEYLEN");
    }
}

export class ERR_CRYPTO_HASH_FINALIZED extends Error {
    constructor() {
        super(`Digest already called`);
        addCodeToMessage(this, "ERR_CRYPTO_HASH_FINALIZED");
    }
}

export class ERR_CRYPTO_HASH_UPDATE_FAILED extends Error {
    constructor() {
        super(`Hash update failed`);
        addCodeToMessage(this, "ERR_CRYPTO_HASH_UPDATE_FAILED");
    }
}

export class ERR_CRYPTO_INVALID_STATE extends Error {
    constructor() {
        super(`Invalid state`);
        addCodeToMessage(this, "ERR_CRYPTO_INVALID_STATE");
    }
}

export class ERR_CRYPTO_UNKNOWN_CIPHER extends Error {
    constructor() {
        super(`Unknown cipher`);
        addCodeToMessage(this, "ERR_CRYPTO_UNKNOWN_CIPHER");
    }
}

export class ERR_IPC_CHANNEL_CLOSED extends Error {
    constructor() {
        super("Channel closed");
        addCodeToMessage(this, "ERR_IPC_CHANNEL_CLOSED");
    }
}

export const codes = Object.freeze({
    ERR_AMBIGUOUS_ARGUMENT,
    ERR_ASSERT_SNAPSHOT_NOT_SUPPORTED,
    ERR_BUFFER_OUT_OF_BOUNDS,
    ERR_CRYPTO_ENGINE_UNKNOWN,
    ERR_CRYPTO_FIPS_FORCED,
    ERR_CRYPTO_HASH_FINALIZED,
    ERR_CRYPTO_HASH_UPDATE_FAILED,
    ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS,
    ERR_CRYPTO_INVALID_DIGEST,
    ERR_CRYPTO_INVALID_JWK,
    ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE,
    ERR_CRYPTO_INVALID_KEYLEN,
    ERR_CRYPTO_INVALID_STATE,
    ERR_CRYPTO_SCRYPT_INVALID_PARAMETER,
    ERR_CRYPTO_SCRYPT_NOT_SUPPORTED,
    ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
    ERR_CRYPTO_UNKNOWN_CIPHER,
    ERR_DIR_CLOSED,
    ERR_DIR_CONCURRENT_OPERATION,
    ERR_ENCODING_INVALID_ENCODED_DATA,
    ERR_ENCODING_NOT_SUPPORTED,
    ERR_FS_CP_DIR_TO_NON_DIR,
    ERR_FS_CP_EEXIST,
    ERR_FS_CP_EINVAL,
    ERR_FS_CP_FIFO_PIPE,
    ERR_FS_CP_NON_DIR_TO_DIR,
    ERR_FS_CP_SOCKET,
    ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY,
    ERR_FS_CP_UNKNOWN,
    ERR_FS_EISDIR,
    ERR_FS_FILE_TOO_LARGE,
    ERR_FS_INVALID_SYMLINK_TYPE,
    ERR_HTTP_BODY_NOT_ALLOWED,
    ERR_HTTP_CONTENT_LENGTH_MISMATCH,
    ERR_HTTP_HEADERS_SENT,
    ERR_HTTP_SOCKET_ASSIGNED,
    ERR_HTTP_INVALID_HEADER_VALUE,
    ERR_HTTP_TRAILER_INVALID,
    ERR_IPC_CHANNEL_CLOSED,
    ERR_ILLEGAL_CONSTRUCTOR,
    ERR_INCOMPATIBLE_OPTION_PAIR,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_TYPE_RANGE,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_ARG_VALUE_RANGE,
    ERR_INVALID_CALLBACK,
    ERR_INVALID_CHAR,
    ERR_INVALID_HTTP_TOKEN,
    ERR_UNESCAPED_CHARACTERS,
    ERR_INVALID_RETURN_VALUE,
    ERR_INVALID_THIS,
    ERR_METHOD_NOT_IMPLEMENTED,
    ERR_MISSING_ARGS,
    ERR_MISSING_OPTION,
    ERR_MULTIPLE_CALLBACK,
    ERR_NO_ICU,
    ERR_OPERATION_FAILED,
    ERR_OUT_OF_RANGE,
    ERR_SOCKET_BAD_PORT,
    ERR_STRING_TOO_LONG,
    ERR_STREAM_ALREADY_FINISHED,
    ERR_STREAM_CANNOT_PIPE,
    ERR_STREAM_DESTROYED,
    ERR_STREAM_NULL_VALUES,
    ERR_STREAM_PREMATURE_CLOSE,
    ERR_STREAM_PUSH_AFTER_EOF,
    ERR_STREAM_UNSHIFT_AFTER_END_EVENT,
    ERR_STREAM_WRITE_AFTER_END,
    ERR_SYSTEM_ERROR,
    ERR_UNAVAILABLE_DURING_EXIT,
    ERR_UNKNOWN_ENCODING,
});
