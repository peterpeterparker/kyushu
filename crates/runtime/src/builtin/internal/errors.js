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

function _isInternalErrorFrame(fileName) {
    return fileName === '__wasm_rquickjs_builtin/internal/errors';
}

function _isInternalErrorStackLine(line) {
    return /^\s*at construct \(native\)\s*$/.test(line);
}

function _remapSourceMappedLocation(fileName, lineNumber, columnNumber) {
    const mapper = globalThis.__wasm_rquickjs_remap_source_mapped_position;
    if (typeof mapper !== 'function') return undefined;
    try {
        return mapper(fileName, lineNumber, columnNumber);
    } catch {
        return undefined;
    }
}

function _remapSourceMappedStack(stackString) {
    if (typeof stackString !== 'string') return stackString;
    if (globalThis.__wasm_rquickjs_suppress_source_map_stack === true) return stackString;
    const lines = stackString.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (_isInternalErrorStackLine(line)) {
            lines.splice(i, 1);
            i -= 1;
            continue;
        }
        let match = line.match(_callSiteWithFnPattern);
        let fileName;
        let lineNumber;
        let columnNumber;
        if (match) {
            fileName = match[2];
            lineNumber = parseInt(match[3], 10);
            columnNumber = parseInt(match[4], 10);
        } else {
            match = line.match(_callSiteNoFnPattern);
            if (!match) continue;
            fileName = match[1];
            lineNumber = parseInt(match[2], 10);
            columnNumber = parseInt(match[3], 10);
        }
        if (_isInternalErrorFrame(fileName)) {
            lines.splice(i, 1);
            i -= 1;
            continue;
        }
        const origin = _remapSourceMappedLocation(fileName, lineNumber, columnNumber);
        if (!origin || typeof origin.fileName !== 'string') continue;
        const location = `${fileName}:${lineNumber}:${columnNumber}`;
        const offset = line.lastIndexOf(location);
        if (offset === -1) continue;
        const mapped = `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`;
        lines[i] = line.slice(0, offset) + mapped + line.slice(offset + location.length);
    }
    return lines.join('\n');
}

function _formatNativeCallSites(error, callSites) {
    if (!Array.isArray(callSites)) return '';
    let header;
    try {
        header = nativeErrorToString.call(error);
    } catch {
        header = 'Error';
    }
    const lines = [header];
    for (const callSite of callSites) {
        let functionName;
        let fileName;
        let lineNumber;
        let columnNumber;
        try {
            functionName = callSite.getFunctionName();
            if (!functionName && typeof callSite.getMethodName === 'function') {
                functionName = callSite.getMethodName();
            }
            fileName = callSite.getFileName();
            lineNumber = callSite.getLineNumber();
            columnNumber = callSite.getColumnNumber();
        } catch {
            continue;
        }
        let text;
        if (fileName) {
            const location = `${fileName}:${lineNumber}:${columnNumber}`;
            text = functionName ? `${functionName} (${location})` : location;
        } else {
            let isNative = false;
            try {
                isNative = callSite.isNative();
            } catch {
                // Use the generic fallback below.
            }
            text = functionName || '<anonymous>';
            if (isNative) text += ' (native)';
        }
        lines.push(`    at ${text}`);
    }
    return lines.join('\n');
}

function _prepareSourceMappedStack(error, callSites) {
    return _remapSourceMappedStack(_formatNativeCallSites(error, callSites));
}

const nativeCallSiteCaptures = new WeakMap();

function _captureNativeCallSites(error, callSites) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
        nativeCallSiteCaptures.set(error, callSites);
    }
    return '';
}

function _takeNativeCallSites(error) {
    const callSites = nativeCallSiteCaptures.get(error);
    if (!callSites) return undefined;
    nativeCallSiteCaptures.delete(error);
    return callSites;
}

Object.defineProperty(globalThis, '__wasm_rquickjs_remap_source_mapped_stack', {
    value: _remapSourceMappedStack,
    writable: false,
    configurable: false,
});

function _callSiteMethod(callSite, name, fallback) {
    if (callSite && typeof callSite[name] === 'function') {
        try {
            return callSite[name]();
        } catch {
            // Use the compatibility fallback below.
        }
    }
    return fallback;
}

function _makeCallSite(functionName, fileName, lineNumber, columnNumber, callSite) {
    return {
        getThis() { return _callSiteMethod(callSite, 'getThis', undefined); },
        getTypeName() { return _callSiteMethod(callSite, 'getTypeName', null); },
        getFunction() { return _callSiteMethod(callSite, 'getFunction', undefined); },
        getFunctionName() { return functionName || null; },
        getMethodName() { return _callSiteMethod(callSite, 'getMethodName', null); },
        getFileName() { return fileName || null; },
        getLineNumber() { return lineNumber | 0; },
        getColumnNumber() { return columnNumber | 0; },
        getEvalOrigin() { return _callSiteMethod(callSite, 'getEvalOrigin', undefined); },
        isToplevel() { return _callSiteMethod(callSite, 'isToplevel', true); },
        isEval() { return _callSiteMethod(callSite, 'isEval', false); },
        isNative() { return _callSiteMethod(callSite, 'isNative', false); },
        isConstructor() { return _callSiteMethod(callSite, 'isConstructor', false); },
        isAsync() { return _callSiteMethod(callSite, 'isAsync', false); },
        isPromiseAll() { return _callSiteMethod(callSite, 'isPromiseAll', false); },
        getPromiseIndex() { return _callSiteMethod(callSite, 'getPromiseIndex', null); },
        getScriptNameOrSourceURL() { return fileName || null; },
        toString() {
            if (fileName) {
                const location = `${fileName}:${lineNumber}:${columnNumber}`;
                return functionName ? `${functionName} (${location})` : location;
            }
            const name = functionName || '<anonymous>';
            if (_callSiteMethod(callSite, 'isNative', false)) {
                return `${name} (native)`;
            }
            return name;
        },
    };
}

function _toCompatibleCallSite(callSite) {
    let functionName;
    let fileName;
    let lineNumber;
    let columnNumber;
    try {
        functionName = callSite.getFunctionName();
        if (!functionName && typeof callSite.getMethodName === 'function') {
            functionName = callSite.getMethodName();
        }
        fileName = callSite.getFileName();
        lineNumber = callSite.getLineNumber();
        columnNumber = callSite.getColumnNumber();
    } catch {
        // Return a complete neutral CallSite when the native object is partial.
    }
    return _makeCallSite(
        functionName,
        fileName,
        lineNumber,
        columnNumber,
        callSite,
    );
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

const NativeError = Error;
const nativeErrorToString = NativeError.prototype.toString;
const nativeErrorPrepareStackTraceDescriptor = Object.getOwnPropertyDescriptor(
    NativeError,
    "prepareStackTrace",
);
const nativeErrorCaptureStackTrace = NativeError.captureStackTrace;
const initialPublicPrepareStackTrace = NativeError.prepareStackTrace;
const preparedNativeStacks = new WeakMap();

export function isPreparedNativeStack(error, stack) {
    return error !== null &&
        (typeof error === 'object' || typeof error === 'function') &&
        preparedNativeStacks.get(error) === stack;
}

function _dispatchPrepareStackTrace(error, callSites) {
    if (error && (typeof error === 'object' || typeof error === 'function') &&
        preparedNativeStacks.has(error)) {
        return preparedNativeStacks.get(error);
    }
    const prepare = NativeError.prepareStackTrace;
    const result = typeof prepare === 'function'
        ? prepare(error, callSites.map(_toCompatibleCallSite))
        : _prepareSourceMappedStack(error, callSites);
    if (error && (typeof error === 'object' || typeof error === 'function')) {
        preparedNativeStacks.set(error, result);
    }
    return result;
}

if (nativeErrorPrepareStackTraceDescriptor &&
    typeof nativeErrorPrepareStackTraceDescriptor.set === 'function') {
    // Keep QuickJS's eager native backtrace construction behind a stable hidden
    // dispatcher. The public property remains an ordinary Node-shaped data
    // property, so defineProperty(), delete, seal, and freeze need no proxy
    // synchronization. Explicit captureStackTrace below supplies Node's lazy
    // hook selection; ordinary Error construction retains QuickJS's eager
    // prepare timing.
    Object.defineProperty(NativeError, 'prepareStackTrace', {
        value: initialPublicPrepareStackTrace,
        writable: true,
        configurable: true,
        enumerable: false,
    });
    nativeErrorPrepareStackTraceDescriptor.set.call(
        NativeError,
        _dispatchPrepareStackTrace,
    );
}

Object.defineProperty(globalThis, '__wasm_rquickjs_install_source_map_error_stack_shim', {
    value() {
        // The dispatcher reads the source-map registry dynamically, so enabling
        // source maps later does not replace a public constructor or property.
    },
    writable: false,
    configurable: false,
});

// ---------------------------------------------------------------------------
// Global Error.captureStackTrace & Error.stackTraceLimit (V8 compat)
// ---------------------------------------------------------------------------
// QuickJS invokes prepareStackTrace while captureStackTrace runs. Node defers
// it until the first `.stack` read. Capture the native CallSites with an
// internal hook, then select the public hook lazily and normalize incomplete
// QuickJS CallSites to the V8-compatible shape expected by user code.
{
    if (typeof nativeErrorCaptureStackTrace === 'function' &&
        nativeErrorPrepareStackTraceDescriptor &&
        typeof nativeErrorPrepareStackTraceDescriptor.set === 'function') {
        function captureCallSites(targetObject, constructorOpt) {
            nativeErrorPrepareStackTraceDescriptor.set.call(
                NativeError,
                _captureNativeCallSites,
            );
            try {
                nativeErrorCaptureStackTrace(targetObject, constructorOpt);
                return _takeNativeCallSites(targetObject) ?? [];
            } finally {
                nativeErrorPrepareStackTraceDescriptor.set.call(
                    NativeError,
                    _dispatchPrepareStackTrace,
                );
            }
        }

        globalThis.Error.captureStackTrace = function captureStackTrace(targetObject, constructorOpt) {
            const callSites = captureCallSites(targetObject, constructorOpt)
                .map(_toCompatibleCallSite);
            Object.defineProperty(targetObject, "stack", {
                get() {
                    const prepare = globalThis.Error && globalThis.Error.prepareStackTrace;
                    const result = typeof prepare === "function"
                        ? prepare(targetObject, callSites)
                        : _prepareSourceMappedStack(targetObject, callSites);
                    Object.defineProperty(targetObject, "stack", _dataDesc(result));
                    return result;
                },
                set(value) {
                    Object.defineProperty(targetObject, "stack", _dataDesc(value));
                },
                configurable: true,
                enumerable: false,
            });
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
