import { URL } from '__wasm_rquickjs_builtin/url_native';
import * as querystring from 'node:querystring';
import { ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS } from '__wasm_rquickjs_builtin/internal/errors';

const __URLSearchParams__ = "__URLSearchParams__";
const __URLSearchParamsURL__ = "__URLSearchParamsURL__";
const __URLSearchParamsUpdating__ = "__URLSearchParamsUpdating__";
const __URLSearchParamsIterator__ = "__URLSearchParamsIterator__";
const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

function makeInvalidThisError(type) {
    const err = new TypeError('Value of "this" must be of type ' + type);
    err.code = 'ERR_INVALID_THIS';
    return err;
}

function makeTupleError() {
    const err = new TypeError('Each query pair must be an iterable [name, value] tuple');
    err.code = 'ERR_INVALID_TUPLE';
    return err;
}

function makeNotIterableError() {
    const err = new TypeError('Query pairs must be iterable');
    err.code = 'ERR_ARG_NOT_ITERABLE';
    return err;
}

function requireSearchParams(value) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, __URLSearchParams__)) {
        throw makeInvalidThisError('URLSearchParams');
    }
    const url = value[__URLSearchParamsURL__];
    if (url && !value[__URLSearchParamsUpdating__]) {
        value[__URLSearchParams__] = parseToPairs(url.search);
    }
    return value[__URLSearchParams__];
}

function requireIterator(value) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, __URLSearchParamsIterator__)) {
        throw makeInvalidThisError('URLSearchParamsIterator');
    }
    return value[__URLSearchParamsIterator__];
}

function toUSVString(value) {
    if (typeof value === 'symbol') {
        throw new TypeError('Cannot convert a Symbol value to a string');
    }
    const string = String(value);
    let out = '';
    for (let i = 0; i < string.length; i++) {
        const c = string.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF) {
            if (i + 1 < string.length) {
                const d = string.charCodeAt(i + 1);
                if (d >= 0xDC00 && d <= 0xDFFF) {
                    out += string[i] + string[i + 1];
                    i++;
                    continue;
                }
            }
            out += '\uFFFD';
        } else if (c >= 0xDC00 && c <= 0xDFFF) {
            out += '\uFFFD';
        } else {
            out += string[i];
        }
    }
    return out;
}

function URLSearchParamsPolyfill(search) {
    if (!(this instanceof URLSearchParamsPolyfill)) {
        throw new TypeError("Class constructor URLSearchParams cannot be invoked without 'new'");
    }

    if (search === undefined || search === null) {
        search = "";
    } else if (search instanceof URLSearchParams || search instanceof URLSearchParamsPolyfill) {
        search = search.toString();
    }

    Object.defineProperty(this, __URLSearchParams__, {
        value: parseToPairs(search),
        writable: true,
        configurable: true,
    });
}

const prototype = URLSearchParamsPolyfill.prototype;

prototype.append = function (name, value) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('name', 'value');
    }
    pairs.push([toUSVString(name), toUSVString(value)]);
    updateLinkedUrl(this);
};

prototype['delete'] = function (name) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 1) {
        throw new ERR_MISSING_ARGS('name');
    }
    const key = toUSVString(name);
    if (arguments.length > 1) {
        const val = toUSVString(arguments[1]);
        this[__URLSearchParams__] = pairs.filter((pair) => pair[0] !== key || pair[1] !== val);
    } else {
        this[__URLSearchParams__] = pairs.filter((pair) => pair[0] !== key);
    }
    updateLinkedUrl(this);
};

prototype.get = function (name) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 1) {
        throw new ERR_MISSING_ARGS('name');
    }
    const key = toUSVString(name);
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === key) return pairs[i][1];
    }
    return null;
};

prototype.getAll = function (name) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 1) {
        throw new ERR_MISSING_ARGS('name');
    }
    const key = toUSVString(name);
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === key) out.push(pairs[i][1]);
    }
    return out;
};

prototype.has = function (name, value) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 1) {
        throw new ERR_MISSING_ARGS('name');
    }
    const key = toUSVString(name);
    const hasValue = value !== undefined;
    const val = hasValue ? toUSVString(value) : undefined;
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === key && (!hasValue || pairs[i][1] === val)) return true;
    }
    return false;
};

prototype.set = function set(name, value) {
    const pairs = requireSearchParams(this);
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('name', 'value');
    }
    const key = toUSVString(name);
    const val = toUSVString(value);
    let found = false;
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === key) {
            if (!found) {
                out.push([key, val]);
                found = true;
            }
        } else {
            out.push(pairs[i]);
        }
    }
    if (!found) out.push([key, val]);
    this[__URLSearchParams__] = out;
    updateLinkedUrl(this);
};

prototype.toString = function () {
    const pairs = requireSearchParams(this);
    const query = [];
    for (let i = 0; i < pairs.length; i++) {
        query.push(encode(pairs[i][0]) + '=' + encode(pairs[i][1]));
    }
    return query.join('&');
};

export const URLSearchParams = URLSearchParamsPolyfill;

// Define searchParams getter on URL.prototype
Object.defineProperty(URL.prototype, "searchParams", {
    get: function getSearchParams() {
        requireURLReceiver(this, 'searchParams', 'get');
        if (!urlSearchParamsCache.has(this)) {
            const params = new URLSearchParams(this.search);
            Object.defineProperty(params, __URLSearchParamsURL__, {
                value: this,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(params, __URLSearchParamsUpdating__, {
                value: false,
                writable: true,
                configurable: true,
            });
            urlSearchParamsCache.set(this, params);
        }
        return urlSearchParamsCache.get(this);
    },
    enumerable: true,
    configurable: true
});

const urlSearchParamsCache = new WeakMap();

function syncSearchParamsFromUrl(url) {
    const params = urlSearchParamsCache.get(url);
    if (params && !params[__URLSearchParamsUpdating__]) {
        params[__URLSearchParams__] = parseToPairs(url.search);
    }
}

function updateLinkedUrl(params) {
    const url = params[__URLSearchParamsURL__];
    if (!url) return;
    if (!Object.prototype.hasOwnProperty.call(params, __URLSearchParamsUpdating__)) {
        Object.defineProperty(params, __URLSearchParamsUpdating__, {
            value: false,
            writable: true,
            configurable: true,
        });
    }
    params[__URLSearchParamsUpdating__] = true;
    try {
        const query = params.toString();
        url.search = query ? '?' + query : '';
    } finally {
        params[__URLSearchParamsUpdating__] = false;
    }
}

// Wrap createObjectURL to validate Blob argument with proper error code
const _origCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = function createObjectURL(obj) {
    if (!obj || typeof obj !== 'object' ||
        (typeof obj.arrayBuffer !== 'function' && typeof obj.stream !== 'function')) {
        throw new ERR_INVALID_ARG_TYPE('object', 'Blob', obj);
    }
    return _origCreateObjectURL.call(this, obj);
};

// Match Node.js behavior: throw ERR_MISSING_ARGS when no URL was passed.
const _origCanParse = URL.canParse;
URL.canParse = function canParse(url, base) {
    if (arguments.length === 0) {
        throw new ERR_MISSING_ARGS('url');
    }
    if (arguments.length > 1) {
        return _origCanParse.call(this, url, base);
    }
    return _origCanParse.call(this, url);
};

const _origRevokeObjectURL = URL.revokeObjectURL;
URL.revokeObjectURL = function revokeObjectURL(url) {
    if (arguments.length === 0) {
        throw new ERR_MISSING_ARGS('url');
    }
    return _origRevokeObjectURL.call(this, url);
};

const USPProto = URLSearchParams.prototype;

USPProto[Symbol.toStringTag] = 'URLSearchParams';

USPProto.forEach = function (callback, thisArg) {
    requireSearchParams(this);
    if (typeof callback !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
    }
    for (let i = 0; i < requireSearchParams(this).length; i++) {
        const pairs = requireSearchParams(this);
        callback.call(thisArg, pairs[i][1], pairs[i][0], this);
    }
};

USPProto.sort = function () {
    const pairs = requireSearchParams(this);
    pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    updateLinkedUrl(this);
};

USPProto.keys = function () {
    requireSearchParams(this);
    return makeIterator(this, 'key');
};

USPProto.values = function () {
    requireSearchParams(this);
    return makeIterator(this, 'value');
};

USPProto.entries = function () {
    requireSearchParams(this);
    return makeIterator(this, 'entry');
};

USPProto[Symbol.iterator] = USPProto.entries;

USPProto[customInspectSymbol] = function inspectURLSearchParams(depth, opts) {
    const pairs = requireSearchParams(this);
    if (depth < 0) return '[Object]';
    if (pairs.length === 0) return 'URLSearchParams {}';
    const entries = pairs.map((pair) => inspectString(pair[0]) + ' => ' + inspectString(pair[1]));
    return formatInspectCollection('URLSearchParams', entries, opts);
};

Object.defineProperty(USPProto, 'size', {
    get: function getSize() {
        return requireSearchParams(this).length;
    }
});

const originalURLSearchParamsMethods = {
    append: USPProto.append,
    delete: USPProto['delete'],
    get: USPProto.get,
    getAll: USPProto.getAll,
    has: USPProto.has,
    set: USPProto.set,
    sort: USPProto.sort,
    entries: USPProto.entries,
    forEach: USPProto.forEach,
    keys: USPProto.keys,
    values: USPProto.values,
    toString: USPProto.toString,
    inspect: USPProto[customInspectSymbol],
};

const urlSearchParamsMethods = {
    append(...args) { return originalURLSearchParamsMethods.append.apply(this, args); },
    ['delete'](...args) { return originalURLSearchParamsMethods.delete.apply(this, args); },
    get(...args) { return originalURLSearchParamsMethods.get.apply(this, args); },
    getAll(...args) { return originalURLSearchParamsMethods.getAll.apply(this, args); },
    has(...args) { return originalURLSearchParamsMethods.has.apply(this, args); },
    set(...args) { return originalURLSearchParamsMethods.set.apply(this, args); },
    sort(...args) { return originalURLSearchParamsMethods.sort.apply(this, args); },
    entries(...args) { return originalURLSearchParamsMethods.entries.apply(this, args); },
    forEach(...args) { return originalURLSearchParamsMethods.forEach.apply(this, args); },
    keys(...args) { return originalURLSearchParamsMethods.keys.apply(this, args); },
    values(...args) { return originalURLSearchParamsMethods.values.apply(this, args); },
    toString(...args) { return originalURLSearchParamsMethods.toString.apply(this, args); },
    [customInspectSymbol](...args) { return originalURLSearchParamsMethods.inspect.apply(this, args); },
};

for (const name of ['append', 'delete', 'get', 'getAll', 'has', 'set', 'sort', 'entries', 'forEach', 'keys', 'values', 'toString']) {
    Object.defineProperty(USPProto, name, {
        value: urlSearchParamsMethods[name],
        writable: true,
        enumerable: true,
        configurable: true,
    });
}
Object.defineProperty(USPProto, Symbol.iterator, {
    value: USPProto.entries,
    writable: true,
    enumerable: false,
    configurable: true,
});
Object.defineProperty(USPProto, customInspectSymbol, {
    value: urlSearchParamsMethods[customInspectSymbol],
    writable: true,
    enumerable: false,
    configurable: true,
});

const ENCODE_REPLACE = {
    '!': '%21',
    "'": '%27',
    '(': '%28',
    ')': '%29',
    '~': '%7E',
    '%20': '+',
    '%00': '\x00'
};

function encode(str) {
    return encodeURIComponent(toUSVString(str)).replace(/[!'\(\)~]|%20|%00/g, function (match) {
        return ENCODE_REPLACE[match];
    });
}

function decode(str) {
    return str
        .replace(/[ +]/g, '%20')
        .replace(/(%[a-f0-9]{2})+/ig, function (match) {
            return decodeURIComponent(match);
        });
}

const URLSearchParamsIteratorPrototype = {};
Object.defineProperty(URLSearchParamsIteratorPrototype, Symbol.toStringTag, {
    value: 'URLSearchParams Iterator',
    writable: false,
    enumerable: false,
    configurable: true,
});

function makeIterator(params, kind) {
    const iterator = {
        next: function next() {
            const state = requireIterator(this);
            const pairs = requireSearchParams(state.params);
            if (state.index >= pairs.length) {
                return {done: true, value: undefined};
            }
            const pair = pairs[state.index++];
            const value = state.kind === 'key' ? pair[0] : state.kind === 'value' ? pair[1] : [pair[0], pair[1]];
            return {done: false, value};
        }
    };
    Object.setPrototypeOf(iterator, URLSearchParamsIteratorPrototype);

    Object.defineProperty(iterator, __URLSearchParamsIterator__, {
        value: { params, kind, index: 0 },
        writable: true,
        configurable: true,
    });

    iterator[Symbol.iterator] = function () {
        return iterator;
    };
    Object.defineProperty(iterator, Symbol.toStringTag, {
        value: 'URLSearchParams Iterator',
        writable: false,
        enumerable: false,
        configurable: true,
    });
    iterator[customInspectSymbol] = function inspectURLSearchParamsIterator(depth, opts) {
        const iteratorState = requireIterator(this);
        if (depth < 0) return '[Object]';
        const pairs = requireSearchParams(iteratorState.params);
        const values = [];
        for (let i = iteratorState.index; i < pairs.length; i++) {
            const pair = pairs[i];
            if (iteratorState.kind === 'key') {
                values.push(inspectString(pair[0]));
            } else if (iteratorState.kind === 'value') {
                values.push(inspectString(pair[1]));
            } else {
                values.push('[ ' + inspectString(pair[0]) + ', ' + inspectString(pair[1]) + ' ]');
            }
        }
        return formatInspectCollection('URLSearchParams Iterator', values, opts);
    };

    return iterator;
}

function inspectString(value) {
    return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function formatInspectCollection(name, entries, opts) {
    if (entries.length === 0) return name + ' {  }';
    if (opts && opts.breakLength === 1) {
        return name + ' {\n  ' + entries.join(',\n  ') + ' }';
    }
    return name + ' { ' + entries.join(', ') + ' }';
}

function parseToPairs(search) {
    const pairs = [];

    if (typeof search === 'symbol') {
        toUSVString(search);
    }

    if (typeof search === "object" || typeof search === 'function') {
        const iterator = search && search[Symbol.iterator];
        if (iterator !== undefined) {
            if (typeof iterator !== 'function') {
                throw makeNotIterableError();
            }
            const iterable = iterator.call(search);
            if (!iterable || typeof iterable.next !== 'function') {
                throw makeNotIterableError();
            }
            let step;
            while (!(step = iterable.next()).done) {
                const item = step.value;
                if (!item || typeof item[Symbol.iterator] !== 'function') {
                    throw makeTupleError();
                }
                const itemIterator = item[Symbol.iterator]();
                const first = itemIterator.next();
                const second = itemIterator.next();
                const third = itemIterator.next();
                if (first.done || second.done || !third.done) {
                    throw makeTupleError();
                }
                pairs.push([toUSVString(first.value), toUSVString(second.value)]);
            }
        } else {
            const symbols = Object.getOwnPropertySymbols(search || {});
            if (symbols.length > 0) {
                toUSVString(symbols[0]);
            }
            const keys = Object.keys(search || {});
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                pairs.push([toUSVString(key), toUSVString(search[key])]);
            }
        }
    } else {
        search = String(search);
        if (search.startsWith("?")) {
            search = search.slice(1);
        }

        for (const value of search.split("&")) {
            const index = value.indexOf('=');
            if (index !== -1) {
                pairs.push([decode(value.slice(0, index)), decode(value.slice(index + 1))]);
            } else if (value) {
                pairs.push([decode(value), '']);
            }
        }
    }

    return pairs;
}

const originalURLDescriptors = {};
for (const name of ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) {
    originalURLDescriptors[name] = Object.getOwnPropertyDescriptor(URL.prototype, name);
}
originalURLDescriptors.searchParams = Object.getOwnPropertyDescriptor(URL.prototype, 'searchParams');
originalURLDescriptors.toString = Object.getOwnPropertyDescriptor(URL.prototype, 'toString');
originalURLDescriptors.toJSON = Object.getOwnPropertyDescriptor(URL.prototype, 'toJSON');

function makeURLReceiverError(property, operation) {
    if (operation === 'method' || (operation === 'get' && (property === 'href' || property === 'search'))) {
        return new TypeError('Receiver must be an instance of class URL');
    }
    return new TypeError('Cannot read private member from an object whose class did not declare it');
}

function requireURLReceiver(receiver, property, operation) {
    if (!(receiver instanceof URL)) {
        throw makeURLReceiverError(property, operation);
    }
}

function getURLProperty(receiver, property) {
    requireURLReceiver(receiver, property, 'get');
    return originalURLDescriptors[property].get.call(receiver);
}

function setURLProperty(receiver, property, value) {
    requireURLReceiver(receiver, property, 'set');
    try {
        return originalURLDescriptors[property].set.call(receiver, value);
    } catch (error) {
        if (error && error.name !== 'TypeError') {
            throw new TypeError(error.message);
        }
        throw error;
    } finally {
        syncSearchParamsFromUrl(receiver);
    }
}

function callURLMethod(receiver, method, args) {
    requireURLReceiver(receiver, method, 'method');
    return originalURLDescriptors[method].value.apply(receiver, args);
}

const urlPrototypeMethods = {
    toString(...args) { return callURLMethod(this, 'toString', args); },
    toJSON(...args) { return callURLMethod(this, 'toJSON', args); },
    [customInspectSymbol]() { return this.href; },
};

const urlAccessors = {
    get href() { return getURLProperty(this, 'href'); },
    set href(value) { setURLProperty(this, 'href', value); },
    get origin() { return getURLProperty(this, 'origin'); },
    get protocol() { return getURLProperty(this, 'protocol'); },
    set protocol(value) { setURLProperty(this, 'protocol', value); },
    get username() { return getURLProperty(this, 'username'); },
    set username(value) { setURLProperty(this, 'username', value); },
    get password() { return getURLProperty(this, 'password'); },
    set password(value) { setURLProperty(this, 'password', value); },
    get host() { return getURLProperty(this, 'host'); },
    set host(value) { setURLProperty(this, 'host', value); },
    get hostname() { return getURLProperty(this, 'hostname'); },
    set hostname(value) { setURLProperty(this, 'hostname', value); },
    get port() { return getURLProperty(this, 'port'); },
    set port(value) { setURLProperty(this, 'port', value); },
    get pathname() { return getURLProperty(this, 'pathname'); },
    set pathname(value) { setURLProperty(this, 'pathname', value); },
    get search() { return getURLProperty(this, 'search'); },
    set search(value) { setURLProperty(this, 'search', value); },
    get searchParams() { return originalURLDescriptors.searchParams.get.call(this); },
    get hash() { return getURLProperty(this, 'hash'); },
    set hash(value) { setURLProperty(this, 'hash', value); },
};

try {
    Object.defineProperty(URL.prototype, 'toString', {
        value: urlPrototypeMethods.toString,
        writable: true,
        enumerable: true,
        configurable: true,
    });
    for (const property of ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'searchParams', 'hash']) {
        const descriptor = Object.getOwnPropertyDescriptor(urlAccessors, property);
        descriptor.enumerable = true;
        descriptor.configurable = true;
        Object.defineProperty(URL.prototype, property, descriptor);
    }
    Object.defineProperty(URL.prototype, 'toJSON', {
        value: urlPrototypeMethods.toJSON,
        writable: true,
        enumerable: true,
        configurable: true,
    });
    Object.defineProperty(URL.prototype, customInspectSymbol, {
        value: urlPrototypeMethods[customInspectSymbol],
        writable: true,
        enumerable: false,
        configurable: true,
    });
} catch (_) {
    // rquickjs currently exposes native class properties as non-configurable.
    // Keep the native descriptors when they cannot be redefined; behavioral
    // compatibility is still provided by the native URL implementation and the
    // JS URLSearchParams wrapper above.
}
try {
    Object.defineProperty(URL.prototype, 'toJSON', {
        value: urlPrototypeMethods.toJSON,
        writable: true,
        enumerable: true,
        configurable: true,
    });
} catch (_) {}
try {
    Object.defineProperty(URL.prototype, customInspectSymbol, {
        value: urlPrototypeMethods[customInspectSymbol],
        writable: true,
        enumerable: false,
        configurable: true,
    });
} catch (_) {}
Object.defineProperty(URL.prototype, Symbol.toStringTag, {
    value: 'URL',
    writable: false,
    enumerable: false,
    configurable: true,
});

// --- node:url module APIs ---

export { URL };

function makeNodeError(code, Type, message) {
    const err = new Type(message);
    err.code = code;
    return err;
}

function makeInvalidUrlError(input) {
    const err = makeNodeError('ERR_INVALID_URL', TypeError, 'Invalid URL');
    err.input = input;
    return err;
}

const FORBIDDEN_HOST_CHARS = /[\0\t\n\r #%/<>?@\\^|]/;
const WARN_INVALID_HOSTNAME_KEY = '__wasm_rquickjs_url_warned_invalid_hostname';

if (globalThis[WARN_INVALID_HOSTNAME_KEY] === undefined) {
    globalThis[WARN_INVALID_HOSTNAME_KEY] = false;
}

function validateHostName(hostname, ipv6Host, input) {
    if (!hostname) {
        return;
    }
    if (FORBIDDEN_HOST_CHARS.test(hostname)) {
        throw makeInvalidUrlError(input);
    }
}

function emitInvalidUrlDeprecation(input) {
    if (globalThis[WARN_INVALID_HOSTNAME_KEY]) {
        return;
    }
    globalThis[WARN_INVALID_HOSTNAME_KEY] = true;

    const warningMessage = `The URL ${input} is invalid. Future versions of Node.js will throw an error.`;

    if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
        process.emitWarning(warningMessage, {
            type: 'DeprecationWarning',
            code: 'DEP0170',
        });
    }

    if (typeof process !== 'undefined' &&
        process.stderr &&
        typeof process.stderr.write === 'function') {
        process.stderr.write(`[DEP0170] DeprecationWarning: ${warningMessage}\n`);
    }
}

const ENCODE_CHARS_RE = /[\x00-\x1F\x20"#%?<>{}|\\^`~\[\]\x7F]/g;

function percentEncode(char) {
    const code = char.charCodeAt(0);
    if (code < 0x10) return '%0' + code.toString(16).toUpperCase();
    return '%' + code.toString(16).toUpperCase();
}

export function fileURLToPath(url, options) {
    const windows = options && options.windows === true;

    if (typeof url === 'string') {
        url = new URL(url);
    } else if (!(url instanceof URL)) {
        throw makeNodeError(
            'ERR_INVALID_ARG_TYPE',
            TypeError,
            'The "url" argument must be of type string or an instance of URL'
        );
    }

    if (url.protocol !== 'file:') {
        throw makeNodeError(
            'ERR_INVALID_URL_SCHEME',
            TypeError,
            'The URL must be of scheme file'
        );
    }

    if (windows) {
        const hostname = url.hostname;
        let pathname = url.pathname;

        if (hostname) {
            pathname = '\\\\' + hostname + pathname.replace(/\//g, '\\');
            return decodeURIComponent(pathname);
        }

        const match = pathname.match(/^\/([A-Za-z])(?:[:|])(\/.*)?$/);
        if (match) {
            const drive = match[1].toUpperCase();
            const rest = match[2] || '\\';
            return drive + ':' + decodeURIComponent(rest).replace(/\//g, '\\');
        }

        return decodeURIComponent(pathname).replace(/\//g, '\\');
    }

    if (url.hostname) {
        throw makeNodeError(
            'ERR_INVALID_FILE_URL_HOST',
            TypeError,
            'File URL host must be "localhost" or empty on the current platform'
        );
    }

    const pathname = url.pathname;
    if (pathname.indexOf('%2F') !== -1 || pathname.indexOf('%2f') !== -1) {
        throw makeNodeError(
            'ERR_INVALID_FILE_URL_PATH',
            TypeError,
            'File URL path must not include encoded / characters'
        );
    }

    return decodeURIComponent(pathname);
}

export function pathToFileURL(path, options) {
    if (typeof path !== 'string') {
        throw makeNodeError(
            'ERR_INVALID_ARG_TYPE',
            TypeError,
            'The "path" argument must be of type string'
        );
    }

    const windows = options && options.windows === true;

    if (windows) {
        let resolved = path.replace(/\\/g, '/');

        const extLocalMatch = resolved.match(/^\/\/\?\/([A-Za-z]:)(\/.*)?$/);
        if (extLocalMatch) {
            const drive = extLocalMatch[1][0].toUpperCase();
            const rest = extLocalMatch[2] || '/';
            return new URL('file:///' + drive + ':' + rest.replace(ENCODE_CHARS_RE, percentEncode));
        }

        const extUncMatch = resolved.match(/^\/\/\?\/UNC\/([^/]+)(\/.*)?$/);
        if (extUncMatch) {
            const host = extUncMatch[1];
            const rest = extUncMatch[2] || '/';
            return new URL('file://' + host + rest.replace(ENCODE_CHARS_RE, percentEncode));
        }

        if (resolved.startsWith('//')) {
            const rest = resolved.slice(2);
            if (rest.startsWith('/') || rest === '') {
                throw makeNodeError(
                    'ERR_INVALID_ARG_VALUE',
                    TypeError,
                    'The argument \'path\' must be a string. Received ' + JSON.stringify(path)
                );
            }
            const slashIdx = rest.indexOf('/');
            if (slashIdx === -1) {
                throw makeNodeError(
                    'ERR_INVALID_ARG_VALUE',
                    TypeError,
                    'The argument \'path\' must be a string. Received ' + JSON.stringify(path)
                );
            }
            const host = rest.slice(0, slashIdx);
            const pathPart = rest.slice(slashIdx);
            return new URL('file://' + host + pathPart.replace(ENCODE_CHARS_RE, percentEncode));
        }

        const driveMatch = resolved.match(/^([A-Za-z]):(\/.*)?$/);
        if (driveMatch) {
            const drive = driveMatch[1].toUpperCase();
            const rest = driveMatch[2] || '/';
            return new URL('file:///' + drive + ':' + rest.replace(ENCODE_CHARS_RE, percentEncode));
        }

        if (!resolved.startsWith('/')) {
            resolved = '/' + resolved;
        }
        return new URL('file://' + resolved.replace(ENCODE_CHARS_RE, percentEncode));
    }

    if (!path.startsWith('/')) {
        path = '/' + path;
    }

    const encoded = path.replace(ENCODE_CHARS_RE, percentEncode);
    return new URL('file://' + encoded);
}

export function urlToHttpOptions(url) {
    const options = {
        protocol: url.protocol,
        hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[')
            ? url.hostname.slice(1, -1)
            : url.hostname,
    };

    if (url.port !== '') {
        options.port = Number(url.port);
    }

    if (url.username || url.password) {
        options.auth = url.password
            ? url.username + ':' + url.password
            : url.username;
    }

    options.pathname = url.pathname;
    options.search = url.search;
    options.hash = url.hash;
    options.href = url.href;
    options.path = (url.pathname || '') + (url.search || '');

    return options;
}

export function format(urlObject, options) {
    if (typeof urlObject === 'string') {
        return formatLegacy(legacyParse(urlObject));
    }

    if (typeof urlObject !== 'object' || urlObject === null) {
        throw makeNodeError(
            'ERR_INVALID_ARG_TYPE',
            TypeError,
            'The "urlObject" argument must be one of type object or string'
        );
    }

    if (urlObject instanceof URL ||
        (typeof urlObject.href === 'string' &&
         typeof urlObject.protocol === 'string' &&
         typeof urlObject.hostname === 'string' &&
         !('slashes' in urlObject))) {
        if (options !== undefined && options !== null && typeof options !== 'object') {
            throw makeNodeError(
                'ERR_INVALID_ARG_TYPE',
                TypeError,
                'The "options" argument must be of type object'
            );
        }

        const opts = options || {};
        const auth = opts.auth !== undefined ? opts.auth : true;
        const fragment = opts.fragment !== undefined ? opts.fragment : true;
        const search = opts.search !== undefined ? opts.search : true;

        let result = urlObject.protocol;

        if (urlObject.host !== undefined && urlObject.host !== '') {
            result += '//';
            if (auth && (urlObject.username || urlObject.password)) {
                result += urlObject.username;
                if (urlObject.password) {
                    result += ':' + urlObject.password;
                }
                result += '@';
            }
            result += urlObject.host;
        } else if (urlObject.protocol === 'file:') {
            result += '//';
        }

        result += urlObject.pathname || '';

        if (search && urlObject.search) {
            result += urlObject.search;
        }

        if (fragment && urlObject.hash) {
            result += urlObject.hash;
        }

        return result;
    }

    return formatLegacy(urlObject);
}

function formatLegacy(urlObject) {
    let result = '';
    const protocol = urlObject.protocol || '';
    let pathname = urlObject.pathname || '';
    let host = '';

    if (urlObject.host) {
        host = urlObject.host;
    } else if (urlObject.hostname) {
        host = urlObject.hostname.indexOf(':') !== -1
            ? '[' + urlObject.hostname + ']'
            : urlObject.hostname;
        if (urlObject.port) {
            host += ':' + urlObject.port;
        }
    }

    if (urlObject.auth) {
        host = urlObject.auth + '@' + host;
    }

    if (protocol) {
        result += protocol;
    }

    if (urlObject.slashes || isSlashedProtocol(protocol)) {
        if (urlObject.slashes || host) {
            if (pathname && pathname.charAt(0) !== '/') {
                pathname = '/' + pathname;
            }
            result += '//';
        } else if (protocol.toLowerCase().startsWith('file')) {
            result += '//';
        }
    }

    result += host;
    result += pathname;

    if (urlObject.search) {
        result += urlObject.search;
    } else if (urlObject.query && typeof urlObject.query === 'object') {
        result += '?' + querystring.stringify(urlObject.query);
    }

    if (urlObject.hash) {
        result += urlObject.hash;
    }

    return result;
}

const SLASHED_PROTOCOLS = {
    'http:': true, 'https:': true, 'ftp:': true, 'gopher:': true, 'file:': true,
    'http': true, 'https': true, 'ftp': true, 'gopher': true, 'file': true,
    'ws:': true, 'wss:': true,
    'ws': true, 'wss': true,
};

const HOSTLESS_PROTOCOLS = {
    'javascript:': true,
    'javascript': true,
};

function isSlashedProtocol(protocol) {
    return typeof protocol === 'string' && SLASHED_PROTOCOLS[protocol.toLowerCase()] === true;
}

export function Url() {
    this.protocol = null;
    this.slashes = null;
    this.auth = null;
    this.host = null;
    this.port = null;
    this.hostname = null;
    this.hash = null;
    this.search = null;
    this.query = null;
    this.pathname = null;
    this.path = null;
    this.href = null;
}

Url.prototype.parse = function parseUrl(urlString, parseQueryString, slashesDenoteHost) {
    const parsed = parse(urlString, parseQueryString, slashesDenoteHost);
    Object.assign(this, parsed);
    return this;
};

Url.prototype.format = function formatUrl() {
    return formatLegacy(this);
};

Url.prototype.resolve = function resolveUrl(relative) {
    return this.resolveObject(relative).format();
};

Url.prototype.resolveObject = function resolveUrlObject(relative) {
    const rel = typeof relative === 'string' ? parse(relative, false, true) : relative;

    const result = new Url();
    Object.assign(result, this);

    // Hash is always overridden, even for empty relatives.
    result.hash = rel.hash;

    if (rel.href === '') {
        result.href = result.format();
        return result;
    }

    if (rel.slashes && !rel.protocol) {
        Object.keys(rel).forEach((key) => {
            if (key !== 'protocol') {
                result[key] = rel[key];
            }
        });

        if (isSlashedProtocol(result.protocol) && result.hostname && !result.pathname) {
            result.path = result.pathname = '/';
        }

        result.href = result.format();
        return result;
    }

    if (rel.protocol && rel.protocol !== result.protocol) {
        if (!isSlashedProtocol(rel.protocol)) {
            Object.assign(result, rel);
            result.href = result.format();
            return result;
        }

        result.protocol = rel.protocol;
        if (!rel.host && !/^file:?$/.test(rel.protocol) && !HOSTLESS_PROTOCOLS[rel.protocol]) {
            const relPath = (rel.pathname || '').split('/');
            while (relPath.length && !(rel.host = relPath.shift()));

            rel.host = rel.host || '';
            rel.hostname = rel.hostname || '';

            if (relPath[0] !== '') {
                relPath.unshift('');
            }
            if (relPath.length < 2) {
                relPath.unshift('');
            }

            result.pathname = relPath.join('/');
        } else {
            result.pathname = rel.pathname;
        }

        result.search = rel.search;
        result.query = rel.query;
        result.host = rel.host || '';
        result.auth = rel.auth;
        result.hostname = rel.hostname || rel.host;
        result.port = rel.port;

        if (result.pathname || result.search) {
            result.path = (result.pathname || '') + (result.search || '');
        }

        result.slashes = result.slashes || rel.slashes;
        result.href = result.format();
        return result;
    }

    const isSourceAbs = result.pathname && result.pathname.charAt(0) === '/';
    const isRelAbs = rel.host || (rel.pathname && rel.pathname.charAt(0) === '/');
    let mustEndAbs = isRelAbs || isSourceAbs || (result.host && rel.pathname);
    const removeAllDots = mustEndAbs;
    let srcPath = (result.pathname && result.pathname.split('/')) || [];
    const relPath = (rel.pathname && rel.pathname.split('/')) || [];
    const noLeadingSlashes = result.protocol && !isSlashedProtocol(result.protocol);

    if (noLeadingSlashes) {
        result.hostname = '';
        result.port = null;

        if (result.host) {
            if (srcPath[0] === '') {
                srcPath[0] = result.host;
            } else {
                srcPath.unshift(result.host);
            }
        }

        result.host = '';

        if (rel.protocol) {
            rel.hostname = null;
            rel.port = null;
            result.auth = null;

            if (rel.host) {
                if (relPath[0] === '') {
                    relPath[0] = rel.host;
                } else {
                    relPath.unshift(rel.host);
                }
            }

            rel.host = null;
        }

        mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
    }

    if (isRelAbs) {
        if (rel.host || rel.host === '') {
            if (result.host !== rel.host) {
                result.auth = null;
            }
            result.host = rel.host;
            result.port = rel.port;
        }

        if (rel.hostname || rel.hostname === '') {
            if (result.hostname !== rel.hostname) {
                result.auth = null;
            }
            result.hostname = rel.hostname;
        }

        result.search = rel.search;
        result.query = rel.query;
        srcPath = relPath;
    } else if (relPath.length) {
        srcPath = srcPath || [];
        srcPath.pop();
        srcPath = srcPath.concat(relPath);
        result.search = rel.search;
        result.query = rel.query;
    } else if (rel.search !== null && rel.search !== undefined) {
        if (noLeadingSlashes) {
            result.hostname = result.host = srcPath.shift();

            const authInHost =
                result.host && result.host.indexOf('@') > 0 ? result.host.split('@') : false;
            if (authInHost) {
                result.auth = authInHost.shift();
                result.host = result.hostname = authInHost.shift();
            }
        }

        result.search = rel.search;
        result.query = rel.query;

        if (result.pathname !== null || result.search !== null) {
            result.path = (result.pathname ? result.pathname : '') +
                (result.search ? result.search : '');
        }

        result.href = result.format();
        return result;
    }

    if (!srcPath.length) {
        result.pathname = null;
        if (result.search) {
            result.path = '/' + result.search;
        } else {
            result.path = null;
        }

        result.href = result.format();
        return result;
    }

    let last = srcPath[srcPath.length - 1];
    const hasTrailingSlash = (
        ((result.host || rel.host || srcPath.length > 1) &&
            (last === '.' || last === '..')) ||
        last === ''
    );

    let up = 0;
    for (let i = srcPath.length - 1; i >= 0; i--) {
        last = srcPath[i];
        if (last === '.') {
            srcPath.splice(i, 1);
        } else if (last === '..') {
            srcPath.splice(i, 1);
            up++;
        } else if (up) {
            srcPath.splice(i, 1);
            up--;
        }
    }

    if (!mustEndAbs && !removeAllDots) {
        while (up--) {
            srcPath.unshift('..');
        }
    }

    if (mustEndAbs && srcPath[0] !== '' && (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
        srcPath.unshift('');
    }

    if (hasTrailingSlash && srcPath.join('/').slice(-1) !== '/') {
        srcPath.push('');
    }

    const isAbsolute = srcPath[0] === '' || (srcPath[0] && srcPath[0].charAt(0) === '/');

    if (noLeadingSlashes) {
        result.hostname = result.host = isAbsolute ? '' : srcPath.length ? srcPath.shift() : '';

        const authInHost = result.host && result.host.indexOf('@') > 0 ?
            result.host.split('@') : false;
        if (authInHost) {
            result.auth = authInHost.shift();
            result.host = result.hostname = authInHost.shift();
        }
    }

    mustEndAbs = mustEndAbs || (result.host && srcPath.length);

    if (mustEndAbs && !isAbsolute) {
        srcPath.unshift('');
    }

    if (!srcPath.length) {
        result.pathname = null;
        result.path = null;
    } else {
        result.pathname = srcPath.join('/');
    }

    if (result.pathname !== null || result.search !== null) {
        result.path = (result.pathname ? result.pathname : '') +
            (result.search ? result.search : '');
    }

    result.auth = rel.auth || result.auth;
    result.slashes = result.slashes || rel.slashes;
    result.href = result.format();
    return result;
};

function legacyParse(urlString, parseState) {
    const u = new Url();
    let shouldWarnInvalidHost = false;

    if (typeof urlString !== 'string') {
        return u;
    }

    let rest = urlString.trim();
    u.href = rest;

    const hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) {
        u.hash = rest.slice(hashIdx);
        rest = rest.slice(0, hashIdx);
    }

    const qIdx = rest.indexOf('?');
    if (qIdx !== -1) {
        u.search = rest.slice(qIdx);
        u.query = rest.slice(qIdx + 1);
        rest = rest.slice(0, qIdx);
    }

    const protoMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9.+\-]*:)/);
    if (protoMatch) {
        u.protocol = protoMatch[1].toLowerCase();
        rest = rest.slice(protoMatch[1].length);
    }

    if (rest.startsWith('//')) {
        u.slashes = true;
        rest = rest.slice(2);

        const authHostPath = rest;
        let pathStart = authHostPath.indexOf('/');
        if (pathStart === -1) pathStart = authHostPath.length;

        const authHost = authHostPath.slice(0, pathStart);
        rest = authHostPath.slice(pathStart);

        const atIdx = authHost.lastIndexOf('@');
        if (atIdx !== -1) {
            u.auth = decodeURIComponent(authHost.slice(0, atIdx));
            const hostPart = authHost.slice(atIdx + 1);
            shouldWarnInvalidHost = parseHostPort(u, hostPart, urlString) || shouldWarnInvalidHost;
        } else {
            shouldWarnInvalidHost = parseHostPort(u, authHost, urlString) || shouldWarnInvalidHost;
        }
    } else if (u.protocol && !isSlashedProtocol(u.protocol) && !HOSTLESS_PROTOCOLS[u.protocol]) {
        let pathStart = rest.indexOf('/');
        if (pathStart === -1) {
            pathStart = rest.length;
        }

        const authHost = rest.slice(0, pathStart);
        rest = rest.slice(pathStart);

        const atIdx = authHost.lastIndexOf('@');
        if (atIdx !== -1) {
            u.auth = decodeURIComponent(authHost.slice(0, atIdx));
            const hostPart = authHost.slice(atIdx + 1);
            shouldWarnInvalidHost = parseHostPort(u, hostPart, urlString) || shouldWarnInvalidHost;
        } else {
            shouldWarnInvalidHost = parseHostPort(u, authHost, urlString) || shouldWarnInvalidHost;
        }
    }

    if (rest) {
        u.pathname = rest;
    } else if (u.slashes && u.protocol && isSlashedProtocol(u.protocol) && u.host !== '') {
        u.pathname = '/';
    }

    if (u.pathname !== null || u.search !== null) {
        u.path = (u.pathname || '') + (u.search || '');
    } else {
        u.path = null;
    }
    u.href = formatLegacy(u);

    if (parseState && shouldWarnInvalidHost) {
        parseState.shouldWarnInvalidHost = true;
    }

    return u;
}

function parseHostPort(u, hostStr, input) {
    if (!hostStr) {
        u.host = '';
        u.hostname = '';
        return false;
    }

    let isIpv6Host = false;
    let shouldWarnInvalidHost = false;
    if (hostStr.startsWith('[')) {
        const bracketEnd = hostStr.indexOf(']');
        if (bracketEnd !== -1) {
            isIpv6Host = true;
            u.hostname = hostStr.slice(1, bracketEnd);
            const remaining = hostStr.slice(bracketEnd + 1);
            if (remaining.startsWith(':')) {
                u.port = remaining.slice(1) || null;
            }
        } else {
            u.hostname = hostStr;
        }
    } else {
        const colonIdx = hostStr.lastIndexOf(':');
        if (colonIdx !== -1) {
            const maybPort = hostStr.slice(colonIdx + 1);
            if (/^\d+$/.test(maybPort)) {
                u.hostname = hostStr.slice(0, colonIdx);
                u.port = maybPort;
            } else {
                u.hostname = hostStr;
                shouldWarnInvalidHost = true;
            }
        } else {
            u.hostname = hostStr;
        }
    }

    validateHostName(u.hostname, isIpv6Host, input);

    u.host = u.hostname;
    if (u.port) {
        u.host += ':' + u.port;
    }

    return shouldWarnInvalidHost;
}

export function parse(urlString, parseQueryString, slashesDenoteHost) {
    if (urlString instanceof Url) {
        return urlString;
    }

    if (typeof urlString !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('url', 'string', urlString);
    }

    const parseState = { shouldWarnInvalidHost: false };
    const u = legacyParse(urlString, parseState);
    let shouldWarnInvalidHost = parseState.shouldWarnInvalidHost;

    if (slashesDenoteHost && !u.protocol) {
        let rest = urlString.trim();
        u.href = rest;

        const hashIdx = rest.indexOf('#');
        if (hashIdx !== -1) {
            u.hash = rest.slice(hashIdx);
            rest = rest.slice(0, hashIdx);
        }

        const qIdx = rest.indexOf('?');
        if (qIdx !== -1) {
            u.search = rest.slice(qIdx);
            u.query = rest.slice(qIdx + 1);
            rest = rest.slice(0, qIdx);
        }

        if (rest.startsWith('//')) {
            u.slashes = true;
            rest = rest.slice(2);
            const pathStart = rest.indexOf('/');
            if (pathStart === -1) {
                shouldWarnInvalidHost = parseHostPort(u, rest, urlString) || shouldWarnInvalidHost;
                rest = '';
            } else {
                shouldWarnInvalidHost = parseHostPort(u, rest.slice(0, pathStart), urlString) || shouldWarnInvalidHost;
                rest = rest.slice(pathStart);
            }
        }

        u.pathname = rest || null;
        if (u.pathname !== null || u.search !== null) {
            u.path = (u.pathname || '') + (u.search || '');
        } else {
            u.path = null;
        }
        u.href = formatLegacy(u);
    }

    if (shouldWarnInvalidHost) {
        emitInvalidUrlDeprecation(urlString);
    }

    if (parseQueryString) {
        const qs = u.query || '';
        const parsed = querystring.parse(qs);
        Object.setPrototypeOf(parsed, null);
        u.query = parsed;
    }

    return u;
}

export function resolve(from, to) {
    return parse(from, false, true).resolve(to);
}

export function resolveObject(source, relative) {
    if (!source) {
        return relative;
    }

    return parse(source, false, true).resolveObject(relative);
}

export function domainToASCII(domain) {
    return domain;
}

export function domainToUnicode(domain) {
    return domain;
}

export default {
    URL,
    URLSearchParams,
    fileURLToPath,
    pathToFileURL,
    urlToHttpOptions,
    format,
    parse,
    resolve,
    resolveObject,
    Url,
    domainToASCII,
    domainToUnicode,
};
