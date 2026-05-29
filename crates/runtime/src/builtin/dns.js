// node:dns implementation backed by wasi:sockets/ip-name-lookup
import { resolve as native_resolve } from '__wasm_rquickjs_builtin/dns_native';
import { isIP, isIPv4, isIPv6 } from 'node:net';

const NOT_SUPPORTED_ERROR_MSG = 'dns record type queries are not supported in WebAssembly environment';

// Error codes
export const NODATA = 'ENODATA';
export const FORMERR = 'EFORMERR';
export const SERVFAIL = 'ESERVFAIL';
export const NOTFOUND = 'ENOTFOUND';
export const NOTIMP = 'ENOTIMP';
export const REFUSED = 'EREFUSED';
export const BADQUERY = 'EBADQUERY';
export const BADNAME = 'EBADNAME';
export const BADFAMILY = 'EBADFAMILY';
export const BADRESP = 'EBADRESP';
export const CONNREFUSED = 'ECONNREFUSED';
export const TIMEOUT = 'ETIMEOUT';
export const EOF = 'EOF';
export const FILE = 'EFILE';
export const NOMEM = 'ENOMEM';
export const DESTRUCTION = 'EDESTRUCTION';
export const BADSTR = 'EBADSTR';
export const BADFLAGS = 'EBADFLAGS';
export const NONAME = 'ENONAME';
export const BADHINTS = 'EBADHINTS';
export const NOTINITIALIZED = 'ENOTINITIALIZED';
export const LOADIPHLPAPI = 'ELOADIPHLPAPI';
export const ADDRGETNETWORKPARAMS = 'EADDRGETNETWORKPARAMS';
export const CANCELLED = 'ECANCELLED';

// Hint flags
export const ADDRCONFIG = 1024;
export const V4MAPPED = 8;
export const ALL = 16;

let _defaultResultOrder = 'verbatim';
const VALID_RRTYPES = new Set([
    'A', 'AAAA', 'ANY', 'CAA', 'CNAME', 'MX', 'NAPTR', 'NS', 'PTR', 'SOA', 'SRV', 'TXT', 'TLSA',
]);

function makeDnsError(code, hostname, syscall) {
    const msg = syscall
        ? `${syscall} ${code} ${hostname}`
        : `${code} ${hostname}`;
    const err = new Error(msg);
    err.code = code;
    err.hostname = hostname;
    if (syscall) err.syscall = syscall;
    return err;
}

function parseNativeError(e, hostname, syscall) {
    try {
        const parsed = JSON.parse(e.message);
        return makeDnsError(parsed.code || 'ESERVFAIL', parsed.hostname || hostname, syscall);
    } catch (_) {
        return makeDnsError('ESERVFAIL', hostname, syscall);
    }
}

function invalidRrtypeError(rrtype) {
    const err = new TypeError(`The argument 'rrtype' is invalid. Received '${rrtype}'`);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

function filterByFamily(results, family) {
    if (family === 0) return results;
    return results.filter(r => r.family === family);
}

function orderResults(results) {
    if (_defaultResultOrder === 'ipv4first') {
        const v4 = results.filter(r => r.family === 4);
        const v6 = results.filter(r => r.family === 6);
        return [...v4, ...v6];
    }
    if (_defaultResultOrder === 'ipv6first') {
        const v6 = results.filter(r => r.family === 6);
        const v4 = results.filter(r => r.family === 4);
        return [...v6, ...v4];
    }
    return results;
}

function normalizeFamily(family) {
    if (family === 'IPv4' || family === 'ipv4') return 4;
    if (family === 'IPv6' || family === 'ipv6') return 6;
    if (family === 4 || family === 6) return family;
    return 0;
}

function parseLookupArgs(optionsOrCallback, callback) {
    let options = {};
    let cb;
    if (typeof optionsOrCallback === 'function') {
        cb = optionsOrCallback;
    } else if (typeof optionsOrCallback === 'number') {
        options = { family: optionsOrCallback };
        cb = callback;
    } else if (typeof optionsOrCallback === 'object' && optionsOrCallback !== null) {
        options = optionsOrCallback;
        cb = callback;
    } else {
        cb = callback;
    }
    return { options, cb };
}

// Callback-style functions
export function lookup(hostname, optionsOrCallback, callback) {
    const { options, cb } = parseLookupArgs(optionsOrCallback, callback);
    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }

    const family = normalizeFamily(options.family || 0);
    const all = !!options.all;

    // If hostname is falsy, return the null-address compatibility result.
    if (!hostname) {
        if (all) {
            queueMicrotask(() => cb(null, [{ address: null, family: 4 }]));
        } else {
            queueMicrotask(() => cb(null, null, 4));
        }
        return;
    }

    if (typeof hostname === 'string' && hostname.toLowerCase() === 'localhost') {
        let results = [
            { address: '127.0.0.1', family: 4 },
            { address: '::1', family: 6 },
        ];
        results = filterByFamily(results, family);
        results = orderResults(results);
        if (all) {
            queueMicrotask(() => cb(null, results));
        } else if (results.length > 0) {
            queueMicrotask(() => cb(null, results[0].address, results[0].family));
        } else {
            queueMicrotask(() => cb(makeDnsError('ENOTFOUND', hostname, 'getaddrinfo')));
        }
        return;
    }

    // If hostname is an IP address, return it directly
    const ipVersion = isIP(hostname);
    if (ipVersion) {
        if (family && family !== ipVersion) {
            queueMicrotask(() => cb(makeDnsError('ENOTFOUND', hostname, 'getaddrinfo')));
            return;
        }
        if (all) {
            queueMicrotask(() => cb(null, [{ address: hostname, family: ipVersion }]));
        } else {
            queueMicrotask(() => cb(null, hostname, ipVersion));
        }
        return;
    }

    (async () => {
        try {
            let results = await native_resolve(hostname);
            results = results.map(r => ({ address: r.address, family: r.family }));
            results = filterByFamily(results, family);
            results = orderResults(results);

            if (results.length === 0) {
                cb(makeDnsError('ENOTFOUND', hostname, 'getaddrinfo'));
                return;
            }

            if (all) {
                cb(null, results);
            } else {
                cb(null, results[0].address, results[0].family);
            }
        } catch (e) {
            cb(parseNativeError(e, hostname, 'getaddrinfo'));
        }
    })();
}

export function resolve(hostname, rrtypeOrCallback, callback) {
    let rrtype = 'A';
    let cb;
    let hasRrtype = false;
    if (typeof rrtypeOrCallback === 'function') {
        cb = rrtypeOrCallback;
    } else {
        hasRrtype = rrtypeOrCallback !== undefined;
        rrtype = hasRrtype ? rrtypeOrCallback : 'A';
        cb = callback;
    }

    if (hasRrtype && !VALID_RRTYPES.has(rrtype)) {
        throw invalidRrtypeError(rrtype);
    }

    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }

    switch (rrtype) {
        case 'A':
            resolve4(hostname, cb);
            break;
        case 'AAAA':
            resolve6(hostname, cb);
            break;
        default:
            queueMicrotask(() => cb(Object.assign(
                new Error(`queryA${rrtype} ${NOT_SUPPORTED_ERROR_MSG}`),
                { code: 'ENOTIMP', hostname }
            )));
            break;
    }
}

function resolveByFamily(hostname, familyFilter, syscall, optionsOrCallback, callback) {
    let options = {};
    let cb;
    if (typeof optionsOrCallback === 'function') {
        cb = optionsOrCallback;
    } else {
        options = optionsOrCallback || {};
        cb = callback;
    }
    if (typeof cb !== 'function') {
        throw new TypeError('callback must be a function');
    }

    (async () => {
        try {
            let results = await native_resolve(hostname);
            results = results.filter(r => r.family === familyFilter);
            if (results.length === 0) {
                cb(makeDnsError('ENODATA', hostname, syscall));
                return;
            }
            if (options.ttl) {
                cb(null, results.map(r => ({ address: r.address, ttl: 0 })));
            } else {
                cb(null, results.map(r => r.address));
            }
        } catch (e) {
            cb(parseNativeError(e, hostname, syscall));
        }
    })();
}

export function resolve4(hostname, optionsOrCallback, callback) {
    resolveByFamily(hostname, 4, 'queryA', optionsOrCallback, callback);
}

export function resolve6(hostname, optionsOrCallback, callback) {
    resolveByFamily(hostname, 6, 'queryAaaa', optionsOrCallback, callback);
}

function unsupportedRecordType(syscall) {
    return function (hostname, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function');
        }
        queueMicrotask(() => callback(Object.assign(
            new Error(`${syscall} ${NOT_SUPPORTED_ERROR_MSG}`),
            { code: 'ENOTIMP', hostname }
        )));
    };
}

export const resolveAny = unsupportedRecordType('queryAny');
export const resolveCname = unsupportedRecordType('queryCname');
export const resolveCaa = unsupportedRecordType('queryCaa');
export const resolveMx = unsupportedRecordType('queryMx');
export const resolveNaptr = unsupportedRecordType('queryNaptr');
export const resolveNs = unsupportedRecordType('queryNs');
export const resolvePtr = unsupportedRecordType('queryPtr');
export const resolveSoa = unsupportedRecordType('querySoa');
export const resolveSrv = unsupportedRecordType('querySrv');
export const resolveTxt = unsupportedRecordType('queryTxt');
export const resolveTlsa = unsupportedRecordType('queryTlsa');

export function reverse(ip, callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('callback must be a function');
    }
    if (ip === '127.0.0.1' || ip === '::1') {
        queueMicrotask(() => callback(null, ['localhost']));
        return;
    }
    queueMicrotask(() => callback(Object.assign(
        new Error(`getHostByAddr ${NOT_SUPPORTED_ERROR_MSG}`),
        { code: 'ENOTIMP', hostname: ip }
    )));
}

export function lookupService(address, port, callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('callback must be a function');
    }
    queueMicrotask(() => callback(Object.assign(
        new Error(`getnameinfo ${NOT_SUPPORTED_ERROR_MSG}`),
        { code: 'ENOTIMP' }
    )));
}

let _servers = [];

export function setServers(servers) {
    if (!Array.isArray(servers)) {
        throw new TypeError('servers must be an array');
    }
    _servers = servers.slice();
}

export function getServers() {
    return _servers.slice();
}

export function setDefaultResultOrder(order) {
    if (order !== 'verbatim' && order !== 'ipv4first' && order !== 'ipv6first') {
        throw new TypeError(`invalid order: ${order}`);
    }
    _defaultResultOrder = order;
}

export function getDefaultResultOrder() {
    return _defaultResultOrder;
}

// Resolver class
export class Resolver {
    constructor(options) {
        this._servers = [];
        this._timeout = options?.timeout ?? -1;
        this._tries = options?.tries ?? 4;
    }

    cancel() {
        // No-op: no outstanding queries to cancel in sync WASI model
    }

    getServers() {
        return this._servers.slice();
    }

    setServers(servers) {
        if (!Array.isArray(servers)) {
            throw new TypeError('servers must be an array');
        }
        this._servers = servers.slice();
    }

    setLocalAddress(_ipv4, _ipv6) {
        // No-op: WASI does not support setting source address
    }

    lookup(hostname, options, callback) {
        return lookup(hostname, options, callback);
    }

    resolve(hostname, rrtype, callback) {
        return resolve(hostname, rrtype, callback);
    }

    resolve4(hostname, options, callback) {
        return resolve4(hostname, options, callback);
    }

    resolve6(hostname, options, callback) {
        return resolve6(hostname, options, callback);
    }

    resolveAny(hostname, callback) { return resolveAny(hostname, callback); }
    resolveCname(hostname, callback) { return resolveCname(hostname, callback); }
    resolveCaa(hostname, callback) { return resolveCaa(hostname, callback); }
    resolveMx(hostname, callback) { return resolveMx(hostname, callback); }
    resolveNaptr(hostname, callback) { return resolveNaptr(hostname, callback); }
    resolveNs(hostname, callback) { return resolveNs(hostname, callback); }
    resolvePtr(hostname, callback) { return resolvePtr(hostname, callback); }
    resolveSoa(hostname, callback) { return resolveSoa(hostname, callback); }
    resolveSrv(hostname, callback) { return resolveSrv(hostname, callback); }
    resolveTxt(hostname, callback) { return resolveTxt(hostname, callback); }
    reverse(ip, callback) { return reverse(ip, callback); }
}

function _unsupportedPromise(syscall, hostname) {
    return Promise.reject(Object.assign(
        new Error(`${syscall} ${NOT_SUPPORTED_ERROR_MSG}`),
        { code: 'ENOTIMP', hostname }
    ));
}

// Promise-based API
export const promises = {
    lookup(hostname, options) {
        return new Promise((resolve, reject) => {
            const opts = typeof options === 'number' ? { family: options } : (options || {});
            lookup(hostname, { ...opts, all: !!opts.all }, (err, addressOrResults, family) => {
                if (err) return reject(err);
                if (opts.all) {
                    resolve(addressOrResults);
                } else {
                    resolve({ address: addressOrResults, family });
                }
            });
        });
    },

    lookupService(address, port) {
        return new Promise((resolve, reject) => {
            lookupService(address, port, (err, hostname, service) => {
                if (err) return reject(err);
                resolve({ hostname, service });
            });
        });
    },

    resolve(hostname, rrtype) {
        if (!VALID_RRTYPES.has(rrtype || 'A')) {
            throw invalidRrtypeError(rrtype);
        }
        return new Promise((res, reject) => {
            resolve(hostname, rrtype || 'A', (err, addresses) => {
                if (err) return reject(err);
                res(addresses);
            });
        });
    },

    resolve4(hostname, options) {
        return new Promise((res, reject) => {
            resolve4(hostname, options || {}, (err, addresses) => {
                if (err) return reject(err);
                res(addresses);
            });
        });
    },

    resolve6(hostname, options) {
        return new Promise((res, reject) => {
            resolve6(hostname, options || {}, (err, addresses) => {
                if (err) return reject(err);
                res(addresses);
            });
        });
    },

    resolveAny(hostname) { return _unsupportedPromise('queryAny', hostname); },
    resolveCname(hostname) { return _unsupportedPromise('queryCname', hostname); },
    resolveCaa(hostname) { return _unsupportedPromise('queryCaa', hostname); },
    resolveMx(hostname) { return _unsupportedPromise('queryMx', hostname); },
    resolveNaptr(hostname) { return _unsupportedPromise('queryNaptr', hostname); },
    resolveNs(hostname) { return _unsupportedPromise('queryNs', hostname); },
    resolvePtr(hostname) { return _unsupportedPromise('queryPtr', hostname); },
    resolveSoa(hostname) { return _unsupportedPromise('querySoa', hostname); },
    resolveSrv(hostname) { return _unsupportedPromise('querySrv', hostname); },
    resolveTxt(hostname) { return _unsupportedPromise('queryTxt', hostname); },

    reverse(ip) {
        return new Promise((resolve, reject) => {
            reverse(ip, (err, domains) => {
                if (err) return reject(err);
                resolve(domains);
            });
        });
    },

    setServers,
    getServers,
    setDefaultResultOrder,
    getDefaultResultOrder,

    Resolver: class PromiseResolver {
        constructor(options) {
            this._servers = [];
            this._timeout = options?.timeout ?? -1;
            this._tries = options?.tries ?? 4;
        }

        cancel() {}

        getServers() { return this._servers.slice(); }
        setServers(servers) {
            if (!Array.isArray(servers)) throw new TypeError('servers must be an array');
            this._servers = servers.slice();
        }
        setLocalAddress(_ipv4, _ipv6) {}

        lookup(hostname, options) { return promises.lookup(hostname, options); }
        resolve(hostname, rrtype) { return promises.resolve(hostname, rrtype); }
        resolve4(hostname, options) { return promises.resolve4(hostname, options); }
        resolve6(hostname, options) { return promises.resolve6(hostname, options); }
        resolveAny(hostname) { return promises.resolveAny(hostname); }
        resolveCname(hostname) { return promises.resolveCname(hostname); }
        resolveCaa(hostname) { return promises.resolveCaa(hostname); }
        resolveMx(hostname) { return promises.resolveMx(hostname); }
        resolveNaptr(hostname) { return promises.resolveNaptr(hostname); }
        resolveNs(hostname) { return promises.resolveNs(hostname); }
        resolvePtr(hostname) { return promises.resolvePtr(hostname); }
        resolveSoa(hostname) { return promises.resolveSoa(hostname); }
        resolveSrv(hostname) { return promises.resolveSrv(hostname); }
        resolveTxt(hostname) { return promises.resolveTxt(hostname); }
        reverse(ip) { return promises.reverse(ip); }
    },
};

export default {
    lookup,
    lookupService,
    resolve,
    resolve4,
    resolve6,
    resolveAny,
    resolveCname,
    resolveCaa,
    resolveMx,
    resolveNaptr,
    resolveNs,
    resolvePtr,
    resolveSoa,
    resolveSrv,
    resolveTxt,
    resolveTlsa,
    reverse,
    setServers,
    getServers,
    setDefaultResultOrder,
    getDefaultResultOrder,
    Resolver,
    promises,
    NODATA,
    FORMERR,
    SERVFAIL,
    NOTFOUND,
    NOTIMP,
    REFUSED,
    BADQUERY,
    BADNAME,
    BADFAMILY,
    BADRESP,
    CONNREFUSED,
    TIMEOUT,
    EOF,
    FILE,
    NOMEM,
    DESTRUCTION,
    BADSTR,
    BADFLAGS,
    NONAME,
    BADHINTS,
    NOTINITIALIZED,
    LOADIPHLPAPI,
    ADDRGETNETWORKPARAMS,
    CANCELLED,
    ADDRCONFIG,
    V4MAPPED,
    ALL,
};
