import * as pathModule from 'node:path';
import * as pathPosix from 'node:path/posix';
import * as pathWin32 from 'node:path/win32';
import * as fsModule from 'node:fs';
import * as util from 'node:util';
import * as buffer from 'node:buffer';
import * as os from 'node:os';
import * as events from 'node:events';
import * as stream from 'node:stream';
import * as streamPromises from 'node:stream/promises';
import * as streamConsumers from 'node:stream/consumers';
import * as streamWeb from 'node:stream/web';
import * as crypto from 'node:crypto';
import * as child_process from 'node:child_process';
import * as string_decoder from 'node:string_decoder';
import * as processModule from 'node:process';
import * as assert from 'node:assert';
import * as assertStrict from 'node:assert/strict';
import * as fsPromises from 'node:fs/promises';
import * as nodeTest from 'node:test';
import * as querystring from 'node:querystring';
import * as punycode from 'node:punycode';
import * as nodeUrl from 'node:url';
import * as vm from 'node:vm';
import * as timers from 'node:timers';
import * as timersPromises from 'node:timers/promises';
import * as consoleMod from 'node:console';
import * as async_hooks from 'node:async_hooks';
import * as cluster from 'node:cluster';
import * as constants from 'node:constants';
import * as dgram from 'node:dgram';
import * as diagnostics_channel from 'node:diagnostics_channel';
import * as dns from 'node:dns';
import * as dnsPromises from 'node:dns/promises';
import * as domain from 'node:domain';
import * as httpCommon from 'node:_http_common';
import * as httpAgent from 'node:_http_agent';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as https from 'node:https';
import * as net from 'node:net';
import * as perf_hooks from 'node:perf_hooks';
import * as readline from 'node:readline';
import * as readlinePromises from 'node:readline/promises';
import * as repl from 'node:repl';
import * as trace_events from 'node:trace_events';
import * as tls from 'node:tls';
import * as tty from 'node:tty';
import * as v8 from 'node:v8';
import * as worker_threads from 'node:worker_threads';
import * as zlib from 'node:zlib';
import * as sqlite from 'node:sqlite';
import * as internalHttp from '__wasm_rquickjs_builtin/internal/http';
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS } from '__wasm_rquickjs_builtin/internal/errors';
import * as internalErrors from '__wasm_rquickjs_builtin/internal/errors';
import * as internalFsUtils from '__wasm_rquickjs_builtin/internal/fs/utils';
import * as internalUrl from '__wasm_rquickjs_builtin/internal/url';
import * as internalUtil from '__wasm_rquickjs_builtin/internal/util';
import * as internalUtilDebuglog from '__wasm_rquickjs_builtin/internal/util/debuglog';
import * as internalWebstreamsUtil from '__wasm_rquickjs_builtin/internal/webstreams/util';
import * as internalStreamsAddAbortSignal from '__wasm_rquickjs_builtin/internal/streams/add-abort-signal';
import * as internalStreamsState from '__wasm_rquickjs_builtin/internal/streams/state';
import * as internalTestBinding from '__wasm_rquickjs_builtin/internal/test/binding';
import { eval_with_filename as _evalWithFilename, require_esm as _requireEsm } from '__wasm_rquickjs_builtin/vm_native';
import {
    transform_typescript as transformTypeScriptNative,
    transform_typescript_module as transformTypeScriptModuleNative,
    test_observability_enabled as testObservabilityEnabledNative,
} from '__wasm_rquickjs_builtin/typescript_native';

const objectPrototypeHasOwnProperty = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const objectDefineProperty = Object.defineProperty.bind(Object);
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const stringFromCodePoint = String.fromCodePoint.bind(String);
const numberParseInt = Number.parseInt.bind(Number);
const wasmRquickjsModuleGlobalThis = globalThis;
const wasmRquickjsModulePromiseResolve = Promise.resolve.bind(Promise);
const wasmRquickjsModuleEval = eval;

function cjsFacadeHasOwnProperty(value, key) {
    return objectPrototypeHasOwnProperty(value, key);
}

Object.defineProperty(globalThis, '__wasm_rquickjs_cjs_facade_has_own', {
    value: cjsFacadeHasOwnProperty,
    writable: false,
    configurable: false,
});

// CJS require() should return the default export (the "module object") when one
// exists, not the ESM namespace wrapper.  When the default export is a function
// or object, named exports are also attached to it so that both
// `require('mod')()` and `const { namedExport } = require('mod')` work — this
// mirrors Node.js CJS/ESM interop behaviour.
function cjsExport(ns) {
    if (!ns || ns.default === undefined) return ns;
    const def = ns.default;
    if (typeof def === 'function' || (typeof def === 'object' && def !== null)) {
        const keys = Object.keys(ns);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k !== 'default' && !(k in def)) {
                def[k] = ns[k];
            }
        }
    }
    return def;
}

// Precompute cjsExport results once per namespace to avoid redundant calls
const pathCjs = cjsExport(pathModule);
const pathPosixCjs = cjsExport(pathPosix);
const pathWin32Cjs = cjsExport(pathWin32);
const fsCjs = cjsExport(fsModule);
const fsPromisesCjs = cjsExport(fsPromises);
const utilCjs = cjsExport(util);
const bufferCjs = cjsExport(buffer);
const osCjs = cjsExport(os);
const eventsCjs = cjsExport(events);
const streamCjs = cjsExport(stream);
const streamPromisesCjs = cjsExport(streamPromises);
const streamConsumersCjs = cjsExport(streamConsumers);
const streamWebCjs = cjsExport(streamWeb);
const childProcessCjs = cjsExport(child_process);
const stringDecoderCjs = cjsExport(string_decoder);
const processCjs = cjsExport(processModule);
const assertCjs = cjsExport(assert);
const assertStrictCjs = cjsExport(assertStrict);
const nodeTestCjs = cjsExport(nodeTest);
const querystringCjs = cjsExport(querystring);
const punycodeCjs = cjsExport(punycode);
const nodeUrlCjs = cjsExport(nodeUrl);
const vmCjs = cjsExport(vm);
const timersCjs = cjsExport(timers);
const timersPromisesCjs = cjsExport(timersPromises);
const consoleCjs = cjsExport(consoleMod);
const asyncHooksCjs = cjsExport(async_hooks);
const clusterCjs = cjsExport(cluster);
const constantsCjs = cjsExport(constants);
const dgramCjs = cjsExport(dgram);
const diagnosticsChannelCjs = cjsExport(diagnostics_channel);
const moduleRequireTrace = diagnostics_channel.tracingChannel('module.require');
const moduleImportTrace = diagnostics_channel.tracingChannel('module.import');
const dnsCjs = cjsExport(dns);
const dnsPromisesCjs = cjsExport(dnsPromises);
const domainCjs = cjsExport(domain);
const httpCommonCjs = cjsExport(httpCommon);
const httpAgentCjs = cjsExport(httpAgent);
const httpCjs = cjsExport(http);
const http2Cjs = cjsExport(http2);
const httpsCjs = cjsExport(https);
const netCjs = cjsExport(net);
const perfHooksCjs = cjsExport(perf_hooks);
const readlineCjs = cjsExport(readline);
const readlinePromisesCjs = cjsExport(readlinePromises);
const replCjs = cjsExport(repl);
const traceEventsCjs = cjsExport(trace_events);
const tlsCjs = cjsExport(tls);
const ttyCjs = cjsExport(tty);
const v8Cjs = cjsExport(v8);
const workerThreadsCjs = cjsExport(worker_threads);
const zlibCjs = cjsExport(zlib);
const sqliteCjs = cjsExport(sqlite);
const internalHttpCjs = cjsExport(internalHttp);
const internalFsUtilsCjs = cjsExport(internalFsUtils);
const internalUrlCjs = cjsExport(internalUrl);
const internalErrorsCjs = cjsExport(internalErrors);
const internalUtilCjs = cjsExport(internalUtil);
const internalUtilDebuglogCjs = cjsExport(internalUtilDebuglog);
const internalWebstreamsUtilCjs = cjsExport(internalWebstreamsUtil);
const internalStreamsAddAbortSignalCjs = cjsExport(internalStreamsAddAbortSignal);
const internalStreamsStateCjs = cjsExport(internalStreamsState);
const internalTestBindingCjs = cjsExport(internalTestBinding);

const utilTypes = (utilCjs && utilCjs.types) || {};

const cryptoCjs = (() => {
    const out = {};
    const keys = Object.keys(crypto);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        out[key] = crypto[key];
    }

    ['pseudoRandomBytes', 'prng', 'rng'].forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(out, name)) {
            Object.defineProperty(out, name, {
                value: out[name],
                writable: true,
                configurable: true,
                enumerable: false,
            });
        }
    });

    return out;
})();

// Build the builtin module map with both bare and node:-prefixed keys.
// Helper to register a module under both 'name' and 'node:name'.
function registerBuiltin(map, name, value) {
    map[name] = value;
    map['node:' + name] = value;
}

const builtinModuleMap = {};
registerBuiltin(builtinModuleMap, 'path', pathCjs);
registerBuiltin(builtinModuleMap, 'path/posix', pathPosixCjs);
registerBuiltin(builtinModuleMap, 'path/win32', pathWin32Cjs);
registerBuiltin(builtinModuleMap, 'fs', fsCjs);
registerBuiltin(builtinModuleMap, 'fs/promises', fsPromisesCjs);
builtinModuleMap['internal/fs/promises'] = fsPromisesCjs;
registerBuiltin(builtinModuleMap, 'util', utilCjs);
registerBuiltin(builtinModuleMap, 'sys', utilCjs);
registerBuiltin(builtinModuleMap, 'buffer', bufferCjs);
registerBuiltin(builtinModuleMap, 'os', osCjs);
registerBuiltin(builtinModuleMap, 'events', eventsCjs);
registerBuiltin(builtinModuleMap, 'stream', streamCjs);
registerBuiltin(builtinModuleMap, 'stream/promises', streamPromisesCjs);
registerBuiltin(builtinModuleMap, 'stream/consumers', streamConsumersCjs);
registerBuiltin(builtinModuleMap, 'stream/web', streamWebCjs);
registerBuiltin(builtinModuleMap, 'crypto', cryptoCjs);
registerBuiltin(builtinModuleMap, 'child_process', childProcessCjs);
registerBuiltin(builtinModuleMap, 'string_decoder', stringDecoderCjs);
registerBuiltin(builtinModuleMap, 'process', processCjs);
registerBuiltin(builtinModuleMap, 'assert', assertCjs);
registerBuiltin(builtinModuleMap, 'assert/strict', assertStrictCjs);
registerBuiltin(builtinModuleMap, 'test', nodeTestCjs);
registerBuiltin(builtinModuleMap, 'querystring', querystringCjs);
registerBuiltin(builtinModuleMap, 'punycode', punycodeCjs);
registerBuiltin(builtinModuleMap, 'url', nodeUrlCjs);
registerBuiltin(builtinModuleMap, 'vm', vmCjs);
registerBuiltin(builtinModuleMap, 'timers', timersCjs);
registerBuiltin(builtinModuleMap, 'timers/promises', timersPromisesCjs);
Object.defineProperty(builtinModuleMap, 'console', {
    get() {
        const c = globalThis.console;
        if (c && consoleMod.Console) c.Console = consoleMod.Console;
        return c || consoleCjs;
    },
    configurable: true,
    enumerable: true,
});
Object.defineProperty(builtinModuleMap, 'node:console', {
    get() {
        return builtinModuleMap['console'];
    },
    configurable: true,
    enumerable: true,
});
registerBuiltin(builtinModuleMap, 'async_hooks', asyncHooksCjs);
registerBuiltin(builtinModuleMap, 'cluster', clusterCjs);
registerBuiltin(builtinModuleMap, 'constants', constantsCjs);
registerBuiltin(builtinModuleMap, 'dgram', dgramCjs);
registerBuiltin(builtinModuleMap, 'diagnostics_channel', diagnosticsChannelCjs);
registerBuiltin(builtinModuleMap, 'dns', dnsCjs);
registerBuiltin(builtinModuleMap, 'dns/promises', dnsPromisesCjs);
registerBuiltin(builtinModuleMap, 'domain', domainCjs);
registerBuiltin(builtinModuleMap, '_http_common', httpCommonCjs);
registerBuiltin(builtinModuleMap, '_http_agent', httpAgentCjs);
registerBuiltin(builtinModuleMap, 'http', httpCjs);
registerBuiltin(builtinModuleMap, 'http2', http2Cjs);
registerBuiltin(builtinModuleMap, 'https', httpsCjs);
registerBuiltin(builtinModuleMap, 'net', netCjs);
registerBuiltin(builtinModuleMap, 'perf_hooks', perfHooksCjs);
registerBuiltin(builtinModuleMap, 'readline', readlineCjs);
registerBuiltin(builtinModuleMap, 'readline/promises', readlinePromisesCjs);
registerBuiltin(builtinModuleMap, 'repl', replCjs);
registerBuiltin(builtinModuleMap, 'tls', tlsCjs);
registerBuiltin(builtinModuleMap, 'trace_events', traceEventsCjs);
registerBuiltin(builtinModuleMap, 'tty', ttyCjs);
registerBuiltin(builtinModuleMap, 'v8', v8Cjs);
registerBuiltin(builtinModuleMap, 'worker_threads', workerThreadsCjs);
registerBuiltin(builtinModuleMap, 'zlib', zlibCjs);
builtinModuleMap['node:sqlite'] = sqliteCjs;
registerBuiltin(builtinModuleMap, 'util/types', utilTypes);
registerBuiltin(builtinModuleMap, '_stream_readable', streamCjs && streamCjs.Readable);
registerBuiltin(builtinModuleMap, '_stream_writable', streamCjs && streamCjs.Writable);
registerBuiltin(builtinModuleMap, '_stream_duplex', streamCjs && streamCjs.Duplex);
registerBuiltin(builtinModuleMap, '_stream_transform', streamCjs && streamCjs.Transform);
registerBuiltin(builtinModuleMap, '_stream_passthrough', streamCjs && streamCjs.PassThrough);
builtinModuleMap['internal/http'] = internalHttpCjs;
builtinModuleMap['internal/fs/utils'] = internalFsUtilsCjs;
builtinModuleMap['internal/url'] = internalUrlCjs;
builtinModuleMap['internal/errors'] = internalErrorsCjs;
builtinModuleMap['internal/util'] = internalUtilCjs;
builtinModuleMap['internal/util/debuglog'] = internalUtilDebuglogCjs;
builtinModuleMap['internal/webstreams/util'] = internalWebstreamsUtilCjs;
builtinModuleMap['internal/streams/add-abort-signal'] = internalStreamsAddAbortSignalCjs;
builtinModuleMap['internal/streams/state'] = internalStreamsStateCjs;
builtinModuleMap['internal/test/binding'] = internalTestBindingCjs;

// --- Module mock registry (used by node:test mock.module()) ---
const _moduleMockRegistry = Object.create(null);
const _moduleMockRegistryById = Object.create(null);
let _moduleMockNextId = 1;
Object.defineProperty(globalThis, '__wasm_rquickjs_module_mocks', {
    value: _moduleMockRegistry,
    writable: false,
    configurable: false,
});

function _mockCanonicalKey(specifier, base) {
    if (typeof specifier === 'object' && specifier !== null && typeof specifier.href === 'string') {
        specifier = specifier.href;
    }
    if (typeof specifier !== 'string') return null;

    const builtinSpecifier = builtinResolveSpecifier(specifier);
    if (builtinSpecifier !== undefined) {
        return 'builtin:' + builtinSpecifier.slice(5);
    }

    // file:// URL
    if (specifier.startsWith('file://')) {
        try {
            const filePath = nodeUrl.fileURLToPath(specifier);
            return 'path:' + pathModule.resolve(filePath);
        } catch (e) {
            return 'path:' + specifier;
        }
    }

    // Absolute path
    if (specifier.startsWith('/')) {
        return 'path:' + pathModule.resolve(specifier);
    }

    // Relative path — resolve against base (from ESM resolver) or current module context
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        let baseDir = '/';
        if (typeof base === 'string' && base) {
            try {
                if (base.startsWith('file://')) {
                    baseDir = pathModule.dirname(nodeUrl.fileURLToPath(base));
                } else {
                    baseDir = pathModule.dirname(base);
                }
            } catch (e) {
                // fall through to context
            }
        }
        if (baseDir === '/') {
            const ctx = globalThis.__wasm_rquickjs_current_module;
            if (ctx && ctx.filename) {
                baseDir = pathModule.dirname(ctx.filename);
            }
        }
        return 'path:' + pathModule.resolve(baseDir, specifier);
    }

    // Bare specifier (could be node_modules)
    return 'bare:' + specifier;
}

function _detectMockModuleKind(canonicalKey) {
    if (!canonicalKey) return 'esm';
    if (canonicalKey.startsWith('builtin:')) return 'cjs';
    if (!canonicalKey.startsWith('path:')) return 'esm';
    const filename = canonicalKey.slice(5);
    if (filename.endsWith('.mjs') || filename.endsWith('.mts')) return 'esm';
    // Default to CJS for .js, .cjs, and everything else
    return 'cjs';
}

function _materializeCjsMock(entry) {
    let result;
    const hasDefault = 'defaultExport' in entry;
    const hasNamed = entry.namedExports !== undefined;

    if (hasDefault) {
        result = entry.defaultExport;
    } else {
        result = {};
    }

    if (hasNamed) {
        if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
            const err = new Error('Cannot create mock: named exports cannot be applied to non-object defaultExport');
            err.code = 'ERR_INVALID_STATE';
            throw err;
        }
        const keys = Object.keys(entry.namedExports);
        for (let i = 0; i < keys.length; i++) {
            result[keys[i]] = entry.namedExports[keys[i]];
        }
    }

    return result;
}

function _registerModuleMock(specifier, options) {
    const key = _mockCanonicalKey(specifier);
    if (!key) return null;

    if (_moduleMockRegistry[key]) {
        const err = new Error('The module is already mocked');
        err.code = 'ERR_INVALID_STATE';
        throw err;
    }

    const id = _moduleMockNextId++;
    const kind = _detectMockModuleKind(key);
    const entry = {
        id: id,
        canonicalKey: key,
        specifier: specifier,
        kind: kind,
        namedExports: options.namedExports,
        cache: options.cache !== undefined ? options.cache : false,
        _cachedCjsResult: undefined,
        _cachedCjsReady: false,
    };
    if ('defaultExport' in options) {
        entry.defaultExport = options.defaultExport;
    }

    _moduleMockRegistry[key] = entry;
    _moduleMockRegistryById[id] = entry;

    return {
        canonicalKey: key,
        id: id,
        restore: function() {
            delete _moduleMockRegistry[key];
            delete _moduleMockRegistryById[id];
            // Clean up ESM storage
            const storageKey = '__wasm_rquickjs_mock_data_' + id;
            delete globalThis[storageKey];
            entry._cachedCjsResult = undefined;
            entry._cachedCjsReady = false;
        }
    };
}

function _resolveRequireMock(id) {
    // CJS require() does not support file:// URLs — don't intercept them
    if (typeof id === 'string' && id.startsWith('file://')) return null;
    const key = _mockCanonicalKey(id);
    if (!key) return null;
    return _moduleMockRegistry[key] || null;
}

function _hasImportMock(specifier, base) {
    const key = _mockCanonicalKey(specifier, base);
    return !!(key && _moduleMockRegistry[key]);
}

Object.defineProperty(globalThis, '__wasm_rquickjs_mock_canonical_key', {
    value: _mockCanonicalKey,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_register_module_mock', {
    value: _registerModuleMock,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_resolve_require_mock', {
    value: _resolveRequireMock,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_materialize_cjs_mock', {
    value: _materializeCjsMock,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_has_import_mock', {
    value: _hasImportMock,
    writable: false,
    configurable: false,
});

function traceModuleRequire(id, parentFilename, fn) {
    if (globalThis.__wasm_rquickjs_suppress_module_require_diagnostics) {
        return fn();
    }
    if (!moduleRequireTrace.hasSubscribers) {
        return fn();
    }
    return moduleRequireTrace.traceSync(fn, {
        id,
        parentFilename,
    });
}

function traceModuleImport(url, parentFilename, fn) {
    if (!parentFilename || !moduleImportTrace.hasSubscribers) return fn();
    return moduleImportTrace.tracePromise(fn, {
        url,
        parentURL: nodeUrl.pathToFileURL(parentFilename).href,
    });
}

function dynamicImportWithTrace(parentFilename, baseUrl, specifier, options, hasOptions, importer) {
    const url = String(specifier);
    if (hasOptions) {
        const parsedOptions = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_import_attr_read_options(options);
        return traceModuleImport(
            url,
            parentFilename,
            async () => {
                return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_import_attr_dynamic_import_parsed(
                    baseUrl,
                    url,
                    parsedOptions,
                    true,
                    importer,
                );
            },
        );
    }
    return traceModuleImport(
        url,
        parentFilename,
        async () => wasmRquickjsModuleGlobalThis.__wasm_rquickjs_import_attr_dynamic_import(
            baseUrl,
            url,
            undefined,
            true,
            importer,
        ),
    );
}

function dynamicImportReaction(fn) {
    return wasmRquickjsModulePromiseResolve().then(fn);
}

Object.defineProperty(globalThis, '__wasm_rquickjs_trace_module_import', {
    value: traceModuleImport,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_dynamic_import_with_trace', {
    value: dynamicImportWithTrace,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_dynamic_import_reaction', {
    value: dynamicImportReaction,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_prepare_cjs_eval_source', {
    value: prepareCjsEvalSource,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_native_eval', {
    value: wasmRquickjsModuleEval,
    writable: false,
    configurable: false,
});
function withSuppressedModuleRequireDiagnostics(fn) {
    const previous = globalThis.__wasm_rquickjs_suppress_module_require_diagnostics;
    globalThis.__wasm_rquickjs_suppress_module_require_diagnostics = true;
    try {
        return fn();
    } finally {
        if (previous === undefined) {
            delete globalThis.__wasm_rquickjs_suppress_module_require_diagnostics;
        } else {
            globalThis.__wasm_rquickjs_suppress_module_require_diagnostics = previous;
        }
    }
}
Object.defineProperty(globalThis, '__wasm_rquickjs_with_suppressed_module_require_diagnostics', {
    value: withSuppressedModuleRequireDiagnostics,
    writable: false,
    configurable: false,
});

// Lookup mock entry by ID (for ESM source generation)
function getMockModuleEntry(mockId) {
    return _moduleMockRegistryById[mockId] || null;
}

Object.defineProperty(globalThis, '__wasm_rquickjs_get_mock_module_entry', {
    value: getMockModuleEntry,
    writable: false,
    configurable: false,
});

// Generate ESM module source for a mock entry (called from Rust MockModuleLoader)
function getMockModuleSource(mockId) {
    const entry = _moduleMockRegistryById[mockId];
    if (!entry) {
        throw new Error('Mock entry not found for id: ' + mockId);
    }
    return _generateMockEsmSource(entry);
}

Object.defineProperty(globalThis, '__wasm_rquickjs_get_mock_module_source', {
    value: getMockModuleSource,
    writable: false,
    configurable: false,
});

function _generateMockEsmSource(entry) {
    const storageKey = '__wasm_rquickjs_mock_data_' + entry.id;
    globalThis[storageKey] = entry;

    const lines = [];
    lines.push('var __entry = globalThis["' + storageKey + '"];');
    lines.push('var __named = __entry.namedExports;');
    lines.push('var __hasDefault = "defaultExport" in __entry;');

    if (entry.kind === 'cjs') {
        // CJS-style mock: default export is the materialized object with named exports applied
        lines.push('var __result;');
        lines.push('if (__hasDefault) { __result = __entry.defaultExport; } else { __result = {}; }');
        lines.push('if (__named) {');
        lines.push('  if (__result === null || (typeof __result !== "object" && typeof __result !== "function")) {');
        lines.push('    await Promise.reject(new Error("Cannot create mock: named exports cannot be applied to non-object defaultExport"));');
        lines.push('  }');
        lines.push('  var __nk = Object.keys(__named);');
        lines.push('  for (var __i = 0; __i < __nk.length; __i++) { __result[__nk[__i]] = __named[__nk[__i]]; }');
        lines.push('}');
        lines.push('export default __result;');
        // Also export named entries individually for ESM consumers
        if (entry.namedExports) {
            const nkeys = Object.keys(entry.namedExports);
            for (let i = 0; i < nkeys.length; i++) {
                const k = nkeys[i];
                if (k === 'default') continue;
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) {
                    lines.push('export var ' + k + ' = __named["' + k + '"];');
                }
            }
        }
    } else {
        // ESM-style mock: named exports are independent, default is separate
        if (entry.namedExports) {
            const nkeys = Object.keys(entry.namedExports);
            for (let i = 0; i < nkeys.length; i++) {
                const k = nkeys[i];
                if (k === 'default') {
                    lines.push('export default __named["default"];');
                } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) {
                    lines.push('export var ' + k + ' = __named["' + k + '"];');
                }
            }
        }
        // Add default export if not already handled via namedExports
        if (!entry.namedExports || !entry.namedExports.hasOwnProperty('default')) {
            lines.push('var __defVal = __hasDefault ? __entry.defaultExport : undefined;');
            lines.push('export { __defVal as default };');
        }
    }

    return lines.join('\n');
}

// Self-reference will be added after the module object is created (see bottom of file)

function setFromArray(values, mapper) {
    const set = new Set();
    for (let i = 0; i < values.length; i++) {
        set.add(mapper ? mapper(values, i) : values[i]);
    }
    return set;
}

// Modules that require the 'node:' prefix (cannot be required as bare specifiers)
const schemelessBlockList = setFromArray(['test', 'sqlite']);

const builtinModuleNames = Object.keys(builtinModuleMap).filter(
    (name) => !name.startsWith('node:') && !name.startsWith('internal/') &&
        !name.startsWith('_') && !schemelessBlockList.has(name)
);

const publicBuiltinIdSet = new Set();
for (const name of Object.keys(builtinModuleMap)) {
    if (name.startsWith('node:')) {
        publicBuiltinIdSet.add(name.slice(5));
    } else if (!name.startsWith('internal/')) {
        publicBuiltinIdSet.add(name);
    }
}

function builtinResolveSpecifier(id) {
    if (typeof id !== 'string') return undefined;
    if (id.startsWith('node:')) {
        return publicBuiltinIdSet.has(id.slice(5)) ? id : undefined;
    }
    if (id.startsWith('internal/') || schemelessBlockList.has(id)) {
        return undefined;
    }
    return publicBuiltinIdSet.has(id) ? 'node:' + id : undefined;
}

function isBuiltin(id) {
    return builtinResolveSpecifier(id) !== undefined;
}

function builtinModuleForSpecifier(id) {
    if (typeof id !== 'string' || schemelessBlockList.has(id)) return undefined;
    if (objectPrototypeHasOwnProperty(builtinModuleMap, id)) return builtinModuleMap[id];
    return undefined;
}

function requireBuiltinModule(id) {
    const builtin = builtinModuleForSpecifier(id);
    if (builtin !== undefined) return builtin;
    if (typeof id === 'string' && id.startsWith('node:')) {
        const err = new Error('No such built-in module: ' + id);
        err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
        throw err;
    }
    return undefined;
}

Object.defineProperty(globalThis, '__wasm_rquickjs_import_meta_resolve_builtin', {
    value: builtinResolveSpecifier,
    writable: false,
    configurable: false,
});

// Runtime-local CommonJS cache: resolved absolute path -> Module object. Like
// Node's require.cache, it does not stat or hash files after first load. A new
// QuickJS runtime (including every wasm-rquickjs execution job) starts empty;
// within one runtime callers must delete the entry to observe an updated file.
const moduleCache = Object.create(null);
let moduleExportsInitialized = false;

function currentModuleCache() {
    return moduleExportsInitialized ? moduleExports._cache : moduleCache;
}

function shouldPreserveSymlinks(isMainModuleLoad) {
    return rustHasExecArgvFlag(isMainModuleLoad ? '--preserve-symlinks-main' : '--preserve-symlinks');
}

function toCjsCanonicalFilename(filename, isMainModuleLoad) {
    if (shouldPreserveSymlinks(isMainModuleLoad)) return filename;
    return fsModule.realpathSync.native(filename);
}

function tryReadFile(filename) {
    try {
        return fsModule.readFileSync(filename, 'utf8');
    } catch (e) {
        return null;
    }
}

const packageJsonParseCache = Object.create(null);

function readPackageJson(pkgJsonPath) {
    if (Object.prototype.hasOwnProperty.call(packageJsonParseCache, pkgJsonPath)) {
        return packageJsonParseCache[pkgJsonPath];
    }
    const content = tryReadFile(pkgJsonPath);
    if (content === null) return null;
    const entry = { path: pkgJsonPath, content, pkg: JSON.parse(content) };
    packageJsonParseCache[pkgJsonPath] = entry;
    return entry;
}

// Shared require.extensions registry (mirrors Node.js Module._extensions)
const requireExtensions = Object.create(null);
const defaultJsExtensionHandler = function _defaultJs(mod, filename) { /* built-in */ };
const defaultJsonExtensionHandler = function _defaultJson(mod, filename) { /* built-in */ };
const defaultNodeExtensionHandler = function _defaultNode(mod, filename) { /* built-in */ };
requireExtensions['.js'] = defaultJsExtensionHandler;
requireExtensions['.json'] = defaultJsonExtensionHandler;
requireExtensions['.node'] = defaultNodeExtensionHandler;
const _defaultExtHandlers = setFromArray([
    defaultJsExtensionHandler,
    defaultJsonExtensionHandler,
    defaultNodeExtensionHandler,
]);

function cjsPathCacheObject() {
    return moduleExports._pathCache;
}

function cjsPathCacheValue(key) {
    return cjsPathCacheObject()[key];
}

function cjsSetPathCacheValue(key, filename) {
    cjsPathCacheObject()[key] = filename;
}

function cjsSetPathCacheResolvedFilename(key, filename) {
    cjsSetPathCacheValue(key, toCjsCanonicalFilename(filename, false));
}

function cjsCachedPathResolution(filename) {
    if (!filename) return null;
    return { filename, __wasmPathCacheHit: true };
}

function cjsPathCacheKey(id, lookupPaths) {
    return id + '\x00' + lookupPaths.join('\x00');
}

function findLongestRegisteredExtension(filename) {
    const name = pathModule.basename(filename);
    let startIndex = 0;
    let index;
    while ((index = name.indexOf('.', startIndex)) !== -1) {
        startIndex = index + 1;
        if (index === 0) continue; // Skip leading dot (dotfiles)
        const ext = name.slice(index);
        if (requireExtensions[ext]) return ext;
    }
    return '.js';
}

function getPackageScopeInfo(filename) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_package_scope_info !== 'function') {
        throw new Error('Internal CJS package scope classifier is not initialized');
    }
    const scope = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_package_scope_info(filename);
    return scope == null ? null : scope;
}

function isPathDirectory(filename) {
    try {
        return fsModule.statSync(filename).isDirectory();
    } catch (_) {
        return false;
    }
}

function loadAsFile(candidate, skipExact) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_file_candidate !== 'function') {
        throw new Error('Internal CJS file candidate resolver is not initialized');
    }
    const filename = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_file_candidate(
        candidate,
        Object.keys(requireExtensions),
        !skipExact,
    );
    if (filename === null || filename === undefined) {
        return null;
    }
    return { filename: String(filename) };
}

function loadAsDirectory(candidate, id, parentDir, seen) {
    seen = seen || Object.create(null);
    if (seen[candidate]) return null;
    seen[candidate] = true;

    const pkgJsonPath = pathModule.join(candidate, 'package.json');
    let packageJsonEntry;
    let invalidMain = null;
    try {
        packageJsonEntry = readPackageJson(pkgJsonPath);
    } catch (e) {
        const pkgErr = new Error(
            'Invalid package config ' + pkgJsonPath +
            ' while resolving "' + id + '" from ' + parentDir + '.' +
            (e.message ? ' ' + e.message : '')
        );
        pkgErr.code = 'ERR_INVALID_PACKAGE_CONFIG';
        throw pkgErr;
    }
    if (packageJsonEntry !== null) {
        let pkg;
        pkg = packageJsonEntry.pkg;

        if (Object.prototype.hasOwnProperty.call(pkg, 'main') && typeof pkg.main === 'string' && pkg.main.length > 0) {
            const mainPath = pathModule.resolve(candidate, pkg.main);
            let resolved = loadAsFile(mainPath, false);
            if (resolved !== null) return resolved;
            resolved = loadAsDirectory(mainPath, id, parentDir, seen);
            if (resolved !== null) return resolved;
            invalidMain = { field: pkg.main, path: mainPath };
        }
    }

    const indexResolved = loadAsFile(pathModule.join(candidate, 'index'), true);
    if (indexResolved !== null) {
        emitInvalidMainWarning(pkgJsonPath, invalidMain);
        return indexResolved;
    }
    if (invalidMain !== null) {
        const err = new Error("Cannot find module '" + invalidMain.path + "'. Please verify that the package.json has a valid \"main\" entry");
        err.code = 'MODULE_NOT_FOUND';
        err.path = pkgJsonPath;
        err.requestPath = id;
        throw err;
    }
    return null;
}

function emitInvalidMainWarning(pkgJsonPath, invalidMain) {
    if (invalidMain === null) return;
    const processObject = globalThis.process;
    if (!processObject || typeof processObject.emitWarning !== 'function') return;
    processObject.emitWarning(
        "Invalid 'main' field in '" + pathModule.toNamespacedPath(pkgJsonPath) + "' of '" + invalidMain.field + "'. Please either fix that or report it to the module author",
        'DeprecationWarning',
        'DEP0128'
    );
}

function packageConditions(mode) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_package_global_conditions !== 'function') {
        throw new Error('Internal package condition provider is not initialized');
    }
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_package_global_conditions(mode);
}

function cjsPackageConditions() {
    return packageConditions('cjs-analysis');
}

function esmPackageConditions() {
    return packageConditions('import');
}

function loaderHookConditions() {
    return packageConditions('loader');
}

function resolvePackageWithRustBridge(parentURL, specifier, conditions, mode, missingProviderMessage) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_loader_default_resolve_package !== 'function') {
        throw new Error(missingProviderMessage);
    }
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_loader_default_resolve_package(
        parentURL,
        specifier,
        conditions,
        mode,
    );
}

function makeModuleNotFoundError(id) {
    const err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    return err;
}

function makeCjsModuleNotFoundFromErrModuleNotFound(err, fallbackId) {
    const cjsErr = new Error(
        err && typeof err.message === 'string'
            ? err.message
            : "Cannot find module '" + fallbackId + "'"
    );
    cjsErr.code = 'MODULE_NOT_FOUND';
    return cjsErr;
}

function makeCjsResolutionState() {
    return { exactFileCache: Object.create(null) };
}

function resolveExactPackageFile(filename, resolution) {
    if (resolution && Object.prototype.hasOwnProperty.call(resolution.exactFileCache, filename)) {
        const cached = resolution.exactFileCache[filename];
        if (cached !== null) return cached;
        throw makeModuleNotFoundError(filename);
    }
    let exists = false;
    try {
        exists = fsModule.statSync(filename).isFile();
    } catch (_) {}
    if (resolution) {
        resolution.exactFileCache[filename] = exists ? { filename } : null;
    }
    if (exists) return { filename };
    throw makeModuleNotFoundError(filename);
}

function resolvePackageFileFromRustResult(resolved, resolution) {
    if (!resolved || !resolved.url || !String(resolved.url).startsWith('file://')) return undefined;
    return resolveExactPackageFile(nodeUrl.fileURLToPath(String(resolved.url)), resolution);
}

function resolvePackageExportsEntry(parts, packageDir, conditions, resolution) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_exports !== 'function') {
        throw new Error('Internal CJS package exports resolver is not initialized');
    }
    let resolved;
    try {
        resolved = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_exports(
            packageDir,
            parts.name,
            parts.subpath,
            conditions || cjsPackageConditions(),
        );
    } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
            throw makeCjsModuleNotFoundFromErrModuleNotFound(err, parts.name);
        }
        throw err;
    }
    resolved = resolvePackageFileFromRustResult(resolved, resolution);
    if (!resolved) return undefined;
    resolved.packageDir = packageDir;
    return resolved;
}

function resolvePackageSelfReference(parts, parentDir, conditions, resolution) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_self_reference !== 'function') {
        throw new Error('Internal CJS package self-reference resolver is not initialized');
    }
    let resolved;
    try {
        resolved = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_self_reference(
            parentDir,
            parts.name,
            parts.subpath,
            conditions || cjsPackageConditions(),
        );
    } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
            throw makeCjsModuleNotFoundFromErrModuleNotFound(err, parts.name);
        }
        throw err;
    }
    const resolvedFile = resolvePackageFileFromRustResult(resolved, resolution);
    if (!resolvedFile) return undefined;
    if (typeof resolved.packageDir === 'string' && resolved.packageDir.length > 0) {
        resolvedFile.packageDir = resolved.packageDir;
    }
    return resolvedFile;
}

function readCjsPackageCandidate(filename, packageDir) {
    return { filename, packageDir };
}

function cjsPackageExtensionKeys() {
    return Object.keys(requireExtensions);
}

function resolveCjsPackageFallbacks(parts, pkgDir, id, fromPart) {
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_fallback !== 'function') {
        throw new Error('Internal CJS package fallback resolver is not initialized');
    }
    const resolved = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_cjs_resolve_package_fallback(
        pkgDir,
        parts.subpath,
        cjsPackageExtensionKeys(),
        id,
        fromPart,
    );
    if (resolved === null || resolved === undefined) return null;
    return readCjsPackageCandidate(String(resolved.filename), String(resolved.packageDir || pkgDir));
}

function resolvePackageImports(id, parentFilename, conditions, resolution) {
    let resolved;
    try {
        resolved = resolvePackageWithRustBridge(
            nodeUrl.pathToFileURL(parentFilename).href,
            id,
            conditions || cjsPackageConditions(),
            'cjs-analysis',
            'Internal package resolver is not initialized',
        );
    } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
            throw makeCjsModuleNotFoundFromErrModuleNotFound(err, id);
        }
        throw err;
    }
    const resolvedFile = resolvePackageFileFromRustResult(resolved, resolution);
    if (!resolvedFile) {
        throw new Error('Internal package resolver did not resolve package import ' + JSON.stringify(id));
    }
    return resolvedFile;
}

function resolveCjsPackageImportOrNodeModules(id, parentDir, parentFilename, parentLookupPaths, resolution) {
    if (typeof parentFilename !== 'string') {
        throw makeModuleNotFoundError(id);
    }
    resolution = resolution || makeCjsResolutionState();
    try {
        return resolvePackageImports(id, parentFilename, cjsPackageConditions(), resolution);
    } catch (err) {
        if (!err || err.code !== 'ERR_PACKAGE_IMPORT_NOT_DEFINED') {
            throw err;
        }
        const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename, undefined, parentLookupPaths, resolution);
        if (nmResolved) return nmResolved;
        if (err.__wasmNoImportsField === true) {
            throw makeModuleNotFoundError(id);
        }
        throw err;
    }
}

function resolveFilename(id, parentDir) {
    const hasTrailingSlash = /\/$/.test(id);
    const forceDirectory = hasTrailingSlash || /(?:^|\/)\.\.?$/.test(id);
    const candidate = pathModule.isAbsolute(id)
        ? pathModule.normalize(id)
        : pathModule.resolve(parentDir, id);

    let resolved = null;
    if (!forceDirectory) {
        resolved = loadAsFile(candidate, false);
        if (resolved !== null) return resolved;
    }

    if (forceDirectory || isPathDirectory(candidate)) {
        resolved = loadAsDirectory(candidate, id, parentDir);
        if (resolved !== null) return resolved;
    }

    const err = new Error("Cannot find module '" + id + "' from '" + parentDir + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
}

function addRequireStackToModuleNotFound(err, request, parentFilename) {
    if (!err || err.code !== 'MODULE_NOT_FOUND' || typeof parentFilename !== 'string') return err;
    if (typeof err.path === 'string' && typeof err.requestPath === 'string') return err;
    err.requireStack = [parentFilename];
    err.message = "Cannot find module '" + request + "'\nRequire stack:\n- " + parentFilename;
    return err;
}

function hasAllowNativesSyntaxFlag() {
    const runtimeFlags = globalThis.__wasm_rquickjs_v8_runtime_flags;
    if (runtimeFlags && runtimeFlags.allowNativesSyntax === true) {
        return true;
    }

    const processObject = globalThis.process;
    if (!processObject || !Array.isArray(processObject.execArgv)) {
        return false;
    }

    let enabled = false;
    for (let i = 0; i < processObject.execArgv.length; i++) {
        const arg = String(processObject.execArgv[i]).replace(/_/g, '-');
        if (arg === '--allow-natives-syntax') {
            enabled = true;
            continue;
        }

        if (arg === '--noallow-natives-syntax' || arg === '--no-allow-natives-syntax') {
            enabled = false;
        }
    }

    return enabled;
}

function stripV8OptimizationIntrinsics(source) {
    if (!hasAllowNativesSyntaxFlag()) {
        return source;
    }

    // QuickJS cannot parse V8-native `%...` syntax used in eval strings.
    // These intrinsics only force optimization and are semantically no-ops.
    return source
        .replace(/eval\(\s*(['"])%PrepareFunctionForOptimization\([^'"\\\r\n]*\)\1\s*\)\s*;?/g, 'undefined;')
        .replace(/eval\(\s*(['"])%OptimizeFunctionOnNextCall\([^'"\\\r\n]*\)\1\s*\)\s*;?/g, 'undefined;');
}

function prepareCjsEvalSource(value, filename, reactionName, traceName, prepareEvalName, nativeEvalName, evalFunction) {
    if (typeof value !== 'string') return value;
    if (evalFunction !== undefined && evalFunction !== wasmRquickjsModuleEval) return value;
    const decodedIdentifierSource = value.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g, (_, braced, fixed) => {
        const codePoint = numberParseInt(braced === undefined ? fixed : braced, 16);
        return codePoint <= 0x10FFFF ? stringFromCodePoint(codePoint) : '';
    });
    let bridgeName = '__wasm_rquickjs_cjs_eval_bridge';
    let sequence = 0;
    function isInstalledBridge(name) {
        const descriptor = objectGetOwnPropertyDescriptor(wasmRquickjsModuleGlobalThis, name);
        return descriptor !== undefined && descriptor.value === cjsEvalBridge &&
            descriptor.writable === false && descriptor.enumerable === false && descriptor.configurable === false;
    }
    while (value.indexOf(bridgeName) !== -1 || decodedIdentifierSource.indexOf(bridgeName) !== -1 ||
        (objectPrototypeHasOwnProperty(wasmRquickjsModuleGlobalThis, bridgeName) && !isInstalledBridge(bridgeName))) {
        sequence++;
        bridgeName = '__wasm_rquickjs_cjs_eval_bridge_' + sequence;
    }
    if (!isInstalledBridge(bridgeName)) {
        objectDefineProperty(wasmRquickjsModuleGlobalThis, bridgeName, {
            value: cjsEvalBridge,
            writable: false,
            enumerable: false,
            configurable: false,
        });
    }
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_prepare_cjs_source(
        value,
        filename,
        bridgeName + '.reaction',
        bridgeName + '.trace',
        bridgeName + '.prepareEval',
        bridgeName + '.nativeEval',
    ).source;
}

const cjsEvalBridge = {};
Object.defineProperties(cjsEvalBridge, {
    reaction: { value: dynamicImportReaction },
    trace: { value: dynamicImportWithTrace },
    prepareEval: { value: prepareCjsEvalSource },
    nativeEval: { value: wasmRquickjsModuleEval },
});
function rustHasExecArgvFlag(flag) {
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_module_has_exec_argv_flag(flag);
}

function isExperimentalTransformTypesEnabled() {
    return rustHasExecArgvFlag('--experimental-transform-types');
}

function isSourceMapsEnabled() {
    if (rustHasExecArgvFlag('--no-enable-source-maps')) {
        return false;
    }

    return rustHasExecArgvFlag('--enable-source-maps') || isExperimentalTransformTypesEnabled();
}

function getSimpleSourceMapRegistry() {
    let registry = globalThis.__wasm_rquickjs_simple_source_maps;
    if (!registry || typeof registry !== 'object') {
        registry = Object.create(null);
        globalThis.__wasm_rquickjs_simple_source_maps = registry;
    }
    return registry;
}

function getCjsSourceMapOwnerRegistry() {
    let registry = globalThis.__wasm_rquickjs_cjs_source_map_owners;
    if (!registry || typeof registry !== 'object') {
        registry = Object.create(null);
        globalThis.__wasm_rquickjs_cjs_source_map_owners = registry;
    }
    return registry;
}

function getCjsLineOffsetRegistry() {
    let registry = globalThis.__wasm_rquickjs_cjs_line_offsets;
    if (!registry || typeof registry !== 'object') {
        registry = Object.create(null);
        globalThis.__wasm_rquickjs_cjs_line_offsets = registry;
    }
    return registry;
}

const cjsLineOffset = 6;

function derefWeakRef(ref) {
    if (ref === undefined || ref === null) return undefined;
    try {
        if (typeof ref.deref === 'function') return ref.deref();
    } catch (_) {
        return ref;
    }
    try {
        if (typeof WeakRef === 'function' && WeakRef.prototype && typeof WeakRef.prototype.deref === 'function') {
            return WeakRef.prototype.deref.call(ref);
        }
    } catch (_) {
        return ref;
    }
    return ref;
}

function makeWeakRef(value) {
    if (typeof WeakRef !== 'function') return undefined;
    try {
        return new WeakRef(value);
    } catch (err) {
        return undefined;
    }
}

const sourceMapVlqChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const sourceMapVlqMap = Object.create(null);
for (let i = 0; i < sourceMapVlqChars.length; i++) {
    sourceMapVlqMap[sourceMapVlqChars.charAt(i)] = i;
}

function sourceMapInvalidPayloadError(payload) {
    let received;
    if (payload === null) {
        received = ' Received null';
    } else if (typeof payload === 'number') {
        received = ' Received type number (' + payload + ')';
    } else if (typeof payload === 'string') {
        received = " Received type string ('" + payload + "')";
    } else {
        received = ' Received type ' + typeof payload + ' (' + String(payload) + ')';
    }
    const err = new TypeError('The "payload" argument must be of type object.' + received);
    err.code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

function cloneSourceMapPayload(payload) {
    return JSON.parse(JSON.stringify(payload));
}

function decodeSourceMapVlq(text, state) {
    let result = 0;
    let shift = 0;
    let continuation = true;
    while (continuation) {
        if (state.index >= text.length) throw new Error('Unexpected end of source map VLQ');
        const value = sourceMapVlqMap[text.charAt(state.index++)];
        if (value === undefined) throw new Error('Invalid source map VLQ character');
        continuation = (value & 32) !== 0;
        result += (value & 31) * Math.pow(2, shift);
        shift += 5;
    }
    const negative = (result % 2) === 1;
    result = Math.floor(result / 2);
    if (negative && result === 0) return -2147483648;
    return negative ? -result : result;
}

function resolveSourceMapSource(source, sourceRoot, sourceBasePath) {
    source = String(source);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) return source;
    if (sourceBasePath) {
        const resolved = pathModule.resolve(sourceBasePath, sourceRoot || '', source);
        return nodeUrl.pathToFileURL(resolved).href;
    }
    if (!sourceRoot) return source;
    sourceRoot = String(sourceRoot);
    if (sourceRoot.endsWith('/') || source.startsWith('/')) return sourceRoot + source;
    return sourceRoot + '/' + source;
}

function parseSourceMapMappings(payload, sourceBasePath) {
    const mappings = String(payload.mappings);
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const names = Array.isArray(payload.names) ? payload.names : [];
    const sourceRoot = payload.sourceRoot || '';
    const lines = [];
    let generatedLine = 0;
    let previousGeneratedColumn = 0;
    let previousSource = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let previousName = 0;
    let i = 0;

    while (i <= mappings.length) {
        if (!lines[generatedLine]) lines[generatedLine] = [];
        if (i === mappings.length) break;
        const ch = mappings.charAt(i);
        if (ch === ';') {
            generatedLine++;
            previousGeneratedColumn = 0;
            i++;
            continue;
        }
        if (ch === ',') {
            i++;
            continue;
        }

        const segmentStart = i;
        while (i < mappings.length && mappings.charAt(i) !== ',' && mappings.charAt(i) !== ';') {
            i++;
        }
        const segmentText = mappings.slice(segmentStart, i);
        if (segmentText.length === 0) continue;
        const state = { index: 0 };
        const generatedColumn = previousGeneratedColumn + decodeSourceMapVlq(segmentText, state);
        previousGeneratedColumn = generatedColumn;
        if (state.index >= segmentText.length) {
            lines[generatedLine].push({ generatedLine, generatedColumn });
            continue;
        }

        const sourceIndex = previousSource + decodeSourceMapVlq(segmentText, state);
        const originalLine = previousOriginalLine + decodeSourceMapVlq(segmentText, state);
        const originalColumn = previousOriginalColumn + decodeSourceMapVlq(segmentText, state);
        previousSource = sourceIndex;
        previousOriginalLine = originalLine;
        previousOriginalColumn = originalColumn;
        let name;
        if (state.index < segmentText.length) {
            const nameIndex = previousName + decodeSourceMapVlq(segmentText, state);
            previousName = nameIndex;
            name = names[nameIndex];
        }

        lines[generatedLine].push({
            generatedLine,
            generatedColumn,
            originalSource: resolveSourceMapSource(sources[sourceIndex], sourceRoot, sourceBasePath),
            originalLine,
            originalColumn,
            name,
        });
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (lines[lineIndex]) {
            lines[lineIndex].sort((a, b) => a.generatedColumn - b.generatedColumn);
        }
    }
    return lines;
}

function parseIndexSourceMapMappings(payload, sourceBasePath) {
    const lines = [];
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || !section.map || !section.offset) continue;
        const offsetLine = Number(section.offset.line) || 0;
        const offsetColumn = Number(section.offset.column) || 0;
        const sectionMap = parseSourceMapMappings(section.map, sourceBasePath);
        for (let line = 0; line < sectionMap.length; line++) {
            const segments = sectionMap[line];
            if (!segments) continue;
            const targetLine = line + offsetLine;
            if (!lines[targetLine]) lines[targetLine] = [];
            for (let j = 0; j < segments.length; j++) {
                const segment = Object.assign({}, segments[j]);
                segment.generatedLine += offsetLine;
                if (line === 0) segment.generatedColumn += offsetColumn;
                lines[targetLine].push(segment);
            }
        }
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (lines[lineIndex]) {
            lines[lineIndex].sort((a, b) => a.generatedColumn - b.generatedColumn);
        }
    }
    return lines;
}

function decodeSourceMapPayload(payload, sourceBasePath) {
    try {
        if (Array.isArray(payload.sections)) return parseIndexSourceMapMappings(payload, sourceBasePath);
        return parseSourceMapMappings(payload, sourceBasePath);
    } catch (_) {
        return [];
    }
}

function cloneSourceMapEntry(entry) {
    if (!entry || entry.originalSource === undefined) return {};
    return {
        generatedLine: entry.generatedLine,
        generatedColumn: entry.generatedColumn,
        originalSource: entry.originalSource,
        originalLine: entry.originalLine,
        originalColumn: entry.originalColumn,
        name: entry.name,
    };
}

function findSourceMapMapping(lines, lineOffset, columnOffset) {
    lineOffset = Math.floor(lineOffset);
    columnOffset = Math.floor(columnOffset);
    for (let lineIndex = lineOffset; lineIndex >= 0; lineIndex--) {
        const line = lines[lineIndex];
        if (!line || line.length === 0) continue;
        let match = null;
        if (lineIndex === lineOffset) {
            for (let i = 0; i < line.length; i++) {
                if (line[i].generatedColumn <= columnOffset) match = line[i];
                else break;
            }
            if (match) return match;
        } else {
            return line[line.length - 1];
        }
    }
    return null;
}

class SourceMap {
    constructor(payload, options) {
        if (payload === null || typeof payload !== 'object') {
            throw sourceMapInvalidPayloadError(payload);
        }
        options = options || {};
        this.payload = cloneSourceMapPayload(payload);
        if (options.lineLengths !== undefined) {
            this.lineLengths = Array.prototype.slice.call(options.lineLengths);
        }
        this._decodedMappings = decodeSourceMapPayload(this.payload, options.sourceBasePath);
    }

    findEntry(lineOffset, columnOffset) {
        lineOffset = Number(lineOffset);
        columnOffset = Number(columnOffset);
        if (!Number.isFinite(lineOffset) || !Number.isFinite(columnOffset)) return {};
        return cloneSourceMapEntry(findSourceMapMapping(this._decodedMappings, lineOffset, columnOffset));
    }

    findOrigin(lineNumber, columnNumber) {
        const generatedLine = Number(lineNumber) - 1;
        const generatedColumn = Number(columnNumber) - 1;
        if (!Number.isFinite(generatedLine) || !Number.isFinite(generatedColumn)) return {};
        const match = findSourceMapMapping(this._decodedMappings, generatedLine, generatedColumn);
        if (!match) return {};
        return {
            name: match.name,
            fileName: match.originalSource,
            lineNumber: match.originalLine + 1,
            columnNumber: match.originalColumn + (generatedColumn - match.generatedColumn) + 1,
        };
    }
}

function findSourceMap(path) {
    path = String(path);
    const owners = getCjsSourceMapOwnerRegistry();
    const ownerRef = owners[path];
    if (ownerRef !== undefined && derefWeakRef(ownerRef) === undefined) {
        delete owners[path];
        delete getSimpleSourceMapRegistry()[path];
        return undefined;
    }
    const registry = getSimpleSourceMapRegistry();
    return registry[path];
}

function sourceMapLineLengths(source) {
    return String(source).split(/\r\n|[\n\r\u2028\u2029]/).map(line => line.length);
}

function decodeInlineSourceMap(url) {
    const marker = 'base64,';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    try {
        const encoded = url.slice(idx + marker.length);
        const decoded = buffer.Buffer.from(encoded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (_) {
        return null;
    }
}

function registerSourceMapForCjs(filename, source, moduleObject) {
    const registry = getSimpleSourceMapRegistry();
    const owners = getCjsSourceMapOwnerRegistry();
    if (!isSourceMapsEnabled()) {
        delete registry[filename];
        delete owners[filename];
        return;
    }

    const sourceText = String(source);
    const directiveRe = /\/\/[#@]\s*sourceMappingURL=([^\r\n]+)|\/\*[#@]\s*sourceMappingURL=([\s\S]*?)\*\//g;
    let match;
    let url = null;
    while ((match = directiveRe.exec(sourceText)) !== null) {
        url = (match[1] !== undefined ? match[1] : match[2]).trim();
    }
    if (url === null) {
        delete registry[filename];
        delete owners[filename];
        return;
    }

    let payload = null;
    let sourceBasePath = pathModule.dirname(filename);
    if (url.startsWith('data:')) {
        payload = decodeInlineSourceMap(url);
    } else {
        const mapPath = pathModule.resolve(pathModule.dirname(filename), url);
        sourceBasePath = pathModule.dirname(mapPath);
        const content = tryReadFile(mapPath);
        if (content !== null) {
            try {
                payload = JSON.parse(content);
            } catch (_) {
                payload = null;
            }
        }
    }
    if (payload === null) {
        delete registry[filename];
        delete owners[filename];
        return;
    }
    registry[filename] = new SourceMap(payload, {
        lineLengths: sourceMapLineLengths(source),
        sourceBasePath,
    });
    if (moduleObject) {
        const ownerRef = makeWeakRef(moduleObject);
        if (ownerRef !== undefined) {
            owners[filename] = ownerRef;
        } else {
            delete owners[filename];
        }
    } else {
        delete owners[filename];
    }
}

function isTypeScriptFilename(filename) {
    return filename.endsWith('.ts') || filename.endsWith('.cts') || filename.endsWith('.mts');
}

let recordTypeScriptModuleTransform = () => {};
let recordCommonJsExportAnalysis = () => {};
if (testObservabilityEnabledNative()) {
    let typeScriptModuleTransformCount = 0;
    let commonJsExportAnalysisCount = 0;
    recordTypeScriptModuleTransform = () => { typeScriptModuleTransformCount += 1; };
    recordCommonJsExportAnalysis = () => { commonJsExportAnalysisCount += 1; };
    Object.defineProperties(globalThis, {
        __wasm_rquickjs_record_typescript_module_transform: {
            value: recordTypeScriptModuleTransform,
            writable: false,
            configurable: false,
        },
        __wasm_rquickjs_get_typescript_module_transform_count: {
            value: () => typeScriptModuleTransformCount,
            writable: false,
            configurable: false,
        },
        __wasm_rquickjs_reset_typescript_module_transform_count: {
            value: () => { typeScriptModuleTransformCount = 0; },
            writable: false,
            configurable: false,
        },
        __wasm_rquickjs_record_commonjs_export_analysis: {
            value: recordCommonJsExportAnalysis,
            writable: false,
            configurable: false,
        },
        __wasm_rquickjs_get_commonjs_export_analysis_count: {
            value: () => commonJsExportAnalysisCount,
            writable: false,
            configurable: false,
        },
        __wasm_rquickjs_reset_commonjs_export_analysis_count: {
            value: () => { commonJsExportAnalysisCount = 0; },
            writable: false,
            configurable: false,
        },
    });
}

function transpileTypeScriptModule(filename, source, module = undefined) {
    if (!isTypeScriptFilename(filename)) {
        return source;
    }
    // Rust owns the transform semantics. This adapter only applies CommonJS
    // loader policy; the Rust filesystem loader applies the same service for ESM.
    const output = JSON.parse(transformTypeScriptModuleNative(
        String(source), filename, module
    ));
    recordTypeScriptModuleTransform();
    return output.code;
}

function prepareCommonJsTypeScript(filename, source) {
    return isTypeScriptFilename(filename)
        ? transpileTypeScriptModule(filename, source, false)
        : source;
}

function clearPreparedTypeScriptGraph(graph) {
    // This graph belongs only to the active load transaction. require.cache is
    // the durable per-runtime owner once a module finishes loading.
    if (!graph || typeof graph !== 'object') return;
    for (const filename of Object.keys(graph)) delete graph[filename];
}

export function stripTypeScriptTypes(code, options = undefined) {
    if (typeof code !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('code', 'string', code);
    }
    if (options !== undefined &&
        (options === null || typeof options !== 'object' || Array.isArray(options))) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }
    const normalized = options === undefined ? {} : options;
    const mode = normalized.mode === undefined ? 'strip' : normalized.mode;
    if (mode !== 'strip' && mode !== 'transform') {
        throw new ERR_INVALID_ARG_VALUE('options.mode', mode, "must be 'strip' or 'transform'");
    }
    const sourceMap = normalized.sourceMap === undefined ? false : normalized.sourceMap;
    if (typeof sourceMap !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.sourceMap', 'boolean', sourceMap);
    }
    const sourceUrl = normalized.sourceUrl;
    if (sourceUrl !== undefined && typeof sourceUrl !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('options.sourceUrl', 'string', sourceUrl);
    }
    if (mode === 'strip' && sourceMap) {
        throw new ERR_INVALID_ARG_VALUE(
            'options.sourceMap', sourceMap, "cannot be used when mode is 'strip'"
        );
    }

    internalUtil.emitExperimentalWarning('stripTypeScriptTypes');
    const transformed = JSON.parse(transformTypeScriptNative(
        code, sourceUrl === undefined ? '' : sourceUrl, mode, sourceMap, undefined
    ));
    let result = transformed.code;
    if (sourceMap) {
        const encoded = buffer.Buffer.from(transformed.sourceMap, 'utf8').toString('base64');
        result += `\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
    }
    if (sourceUrl !== undefined) {
        result += `\n\n//# sourceURL=${sourceUrl}`;
    }
    return result;
}

function getArrowMessagePrivateSymbol() {
    const privateSymbols = globalThis.__wasm_rquickjs_internal_private_symbols;
    if (!privateSymbols || typeof privateSymbols !== 'object') {
        return undefined;
    }

    const arrowMessageSymbol = privateSymbols.arrow_message_private_symbol;
    return typeof arrowMessageSymbol === 'symbol' ? arrowMessageSymbol : undefined;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maybeSetArrowMessageOnSyntaxError(err, filename, source) {
    if (!err || err.name !== 'SyntaxError') {
        return;
    }

    const arrowMessageSymbol = getArrowMessagePrivateSymbol();
    if (arrowMessageSymbol === undefined || err[arrowMessageSymbol] !== undefined) {
        return;
    }

    let line = 1;
    let column = 1;

    if (typeof err.lineNumber === 'number' && Number.isFinite(err.lineNumber) && err.lineNumber > 0) {
        line = Math.floor(err.lineNumber);
    }
    if (typeof err.columnNumber === 'number' && Number.isFinite(err.columnNumber) && err.columnNumber > 0) {
        column = Math.floor(err.columnNumber);
    }

    if (typeof err.stack === 'string') {
        const stackMatch = err.stack.match(new RegExp(escapeRegExp(filename) + ':(\\d+)(?::(\\d+))?'));
        if (stackMatch) {
            line = parseInt(stackMatch[1], 10);
            if (stackMatch[2] !== undefined) {
                column = parseInt(stackMatch[2], 10);
            }
        }
    }

    const sourceLines = String(source).split('\n');
    let sourceLine = '';
    if (line >= 1 && line <= sourceLines.length) {
        sourceLine = sourceLines[line - 1].replace(/\r$/, '');
    }

    if (!Number.isFinite(column) || column < 1) {
        column = 1;
    }

    let arrowMessage = filename + ':' + line;
    if (sourceLine.length > 0) {
        arrowMessage += '\n' + sourceLine + '\n' + ' '.repeat(column - 1) + '^';
    }

    err[arrowMessageSymbol] = arrowMessage;
}

function wrapEsmNamespace(ns) {
    if (!ns || typeof ns !== 'object') return ns;
    if (!Object.hasOwn(ns, 'default') || Object.hasOwn(ns, '__esModule')) return ns;
    const wrapped = Object.create(null);
    const namespaceKeys = Object.keys(ns);
    Object.defineProperty(wrapped, '__esModule', {
        value: true,
        writable: true,
        configurable: false,
        enumerable: true,
    });
    for (let i = 0; i < namespaceKeys.length; i++) {
        const k = namespaceKeys[i];
        Object.defineProperty(wrapped, k, {
            value: ns[k],
            writable: true,
            enumerable: true,
            configurable: false,
        });
    }
    Object.defineProperty(wrapped, Symbol.toStringTag, {
        value: 'Module',
        writable: false,
        configurable: false,
        enumerable: false,
    });
    Object.preventExtensions(wrapped);
    function namespaceDescriptor(prop) {
        if (prop === '__esModule') {
            return {
                value: true,
                writable: true,
                enumerable: true,
                configurable: false,
            };
        }
        if (typeof prop === 'string' && Object.hasOwn(ns, prop)) {
            return {
                value: ns[prop],
                writable: true,
                enumerable: true,
                configurable: false,
            };
        }
        return Object.getOwnPropertyDescriptor(wrapped, prop);
    }
    return new Proxy(wrapped, {
        get: function(target, prop, receiver) {
            if (prop === '__esModule') return true;
            if (typeof prop === 'string' && Object.hasOwn(ns, prop)) return ns[prop];
            return Reflect.get(target, prop, receiver);
        },
        getOwnPropertyDescriptor: function(_target, prop) {
            return namespaceDescriptor(prop);
        },
        set: function() {
            return false;
        },
        defineProperty: function() {
            return false;
        },
        deleteProperty: function() {
            return false;
        },
    });
}

// Normalize QuickJS SyntaxError messages for ESM keywords to match Node.js/V8 format.
// QuickJS: "unsupported keyword: export" → Node.js: "Unexpected token 'export'"
function normalizeEsmSyntaxError(err) {
    if (!err || typeof err.message !== 'string') return;
    const m = err.message.match(/^unsupported keyword: (\w+)$/);
    if (m) {
        err.message = "Unexpected token '" + m[1] + "'";
    }
}

function markAsSyntaxError(err) {
    if (!err || err.name === 'SyntaxError') return;
    err.name = 'SyntaxError';
    if (typeof err.stack === 'string') {
        err.stack = err.stack.replace(/^Error:/, 'SyntaxError:');
    }
}

function rustModuleSourceAnalysis(source) {
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_analyze_module_source(source);
}

function isEsmGraphFile(filename, analysis) {
    const packageScope = (filename.endsWith('.js') || filename.endsWith('.ts'))
        ? getPackageScopeInfo(filename)
        : null;
    const explicitPackageType = packageScope ? packageScope.packageType : null;
    const isCommonJsPackage = explicitPackageType === 'commonjs' ||
        (explicitPackageType === null && packageScope !== null && packageScope.isNodeModulesPackage);
    if (filename.endsWith('.mjs') || filename.endsWith('.mts') ||
        ((filename.endsWith('.js') || filename.endsWith('.ts')) && explicitPackageType === 'module')) return true;
    if (filename.endsWith('.cjs') || filename.endsWith('.cts') || isCommonJsPackage) return false;
    return analysis.looksLikeEsm || analysis.hasCjsWrapperLexicalRedeclaration;
}

function readEsmGraphFileInfo(filename, cache) {
    if (Object.prototype.hasOwnProperty.call(cache, filename)) {
        return cache[filename];
    }
    const source = tryReadFile(filename);
    if (source === null) {
        return { source: null, isEsm: false };
    }
    const preparedSource = transpileTypeScriptModule(filename, source, true);
    const analysis = rustModuleSourceAnalysis(preparedSource);
    const info = {
        source: preparedSource,
        analysis,
        isEsm: isEsmGraphFile(filename, analysis),
    };
    cache[filename] = info;
    return info;
}

function esmGraphStaticSpecifiers(fileInfo) {
    return fileInfo.analysis.staticEdges.map((edge) => edge.specifier);
}

function esmGraphRequireSpecifiers(fileInfo) {
    return fileInfo.analysis.requireSpecifiers;
}

function esmGraphCreateRequireSpecifiers(fileInfo) {
    return fileInfo.analysis.createRequireSpecifiers;
}

function fileUrlForPath(filename) {
    return 'file://' + filename;
}

const cjsEsmDefaultSnapshotSymbol = Symbol('wasm-rquickjs.cjs-esm-default-snapshot');
const cjsTypeScriptAnalysisCache = new WeakMap();
const cjsTypeScriptAnalysisCacheQueue = [];
const cjsTypeScriptAnalysisCacheMaxEntries = 32;
const cjsTypeScriptAnalysisCacheMaxBytes = 1024 * 1024;
let cjsTypeScriptAnalysisCacheEntries = 0;
let cjsTypeScriptAnalysisCacheBytes = 0;
let cjsTypeScriptPreparedSourceEntries = 0;
let cjsTypeScriptPreparedSourceBytes = 0;
const cjsEsmDefaultSnapshotToken = {};

function installCjsEsmDefaultSnapshotSlot(mod) {
    if (!mod || (typeof mod !== 'object' && typeof mod !== 'function') || cjsFacadeHasOwnProperty(mod, cjsEsmDefaultSnapshotSymbol)) return;
    const state = { captured: false, value: undefined };
    Object.defineProperty(mod, cjsEsmDefaultSnapshotSymbol, {
        value: function cjsEsmDefaultSnapshotSlot(token, op, value) {
            if (token !== cjsEsmDefaultSnapshotToken) return undefined;
            if (op === 'set') {
                if (!state.captured) {
                    state.captured = true;
                    state.value = value;
                }
                return state.value;
            }
            if (op === 'has') return state.captured;
            if (op === 'get') return state.value;
            return undefined;
        },
        writable: false,
        configurable: false,
        enumerable: false,
    });
}

function cjsEsmDefaultSnapshotSlot(mod) {
    if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return undefined;
    const slot = mod[cjsEsmDefaultSnapshotSymbol];
    return typeof slot === 'function' ? slot : undefined;
}

function captureCjsEsmDefaultSnapshot(mod) {
    installCjsEsmDefaultSnapshotSlot(mod);
    const slot = cjsEsmDefaultSnapshotSlot(mod);
    if (!slot || slot(cjsEsmDefaultSnapshotToken, 'has')) return;
    slot(cjsEsmDefaultSnapshotToken, 'set', mod.exports);
}

function hasCjsEsmDefaultSnapshot(cache, filename) {
    if (!cache || typeof cache !== 'object') return false;
    const mod = cache[filename];
    const slot = cjsEsmDefaultSnapshotSlot(mod);
    return !!(slot && slot(cjsEsmDefaultSnapshotToken, 'has'));
}

function getCjsEsmDefaultSnapshot(cache, filename) {
    const mod = cache && cache[filename];
    const slot = cjsEsmDefaultSnapshotSlot(mod);
    return slot ? slot(cjsEsmDefaultSnapshotToken, 'get') : undefined;
}

function discardCjsTypeScriptAnalysisCacheEntry(mod) {
    const entry = mod && cjsTypeScriptAnalysisCache.get(mod);
    if (!entry) return;
    cjsTypeScriptAnalysisCache.delete(mod);
    entry.active = false;
    cjsTypeScriptAnalysisCacheEntries -= 1;
    cjsTypeScriptAnalysisCacheBytes -= entry.bytes;
    if (entry.preparedSource !== undefined) {
        cjsTypeScriptPreparedSourceEntries -= 1;
        cjsTypeScriptPreparedSourceBytes -= entry.preparedBytes;
    }
    entry.mod = undefined;
    entry.originalSource = undefined;
    entry.preparedSource = undefined;
    entry.exportNames = undefined;
    if (cjsTypeScriptAnalysisCacheQueue.length > cjsTypeScriptAnalysisCacheMaxEntries * 2) {
        const active = cjsTypeScriptAnalysisCacheQueue.filter((queued) => queued.active);
        cjsTypeScriptAnalysisCacheQueue.splice(
            0,
            cjsTypeScriptAnalysisCacheQueue.length,
            ...active,
        );
    }
}

function pruneCjsTypeScriptAnalysisCache() {
    while (cjsTypeScriptAnalysisCacheEntries > cjsTypeScriptAnalysisCacheMaxEntries ||
           cjsTypeScriptAnalysisCacheBytes > cjsTypeScriptAnalysisCacheMaxBytes) {
        const entry = cjsTypeScriptAnalysisCacheQueue.shift();
        if (!entry || !entry.active) continue;
        discardCjsTypeScriptAnalysisCacheEntry(entry.mod);
    }
}

function captureCjsTypeScriptAnalysisCacheEntry(mod, originalSource, preparedSource, exportNames) {
    if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return;
    discardCjsTypeScriptAnalysisCacheEntry(mod);
    const names = Array.isArray(exportNames) ? exportNames.slice() : undefined;
    const preparedBytes = preparedSource === undefined ? 0 : preparedSource.length * 2;
    const namesBytes = names === undefined
        ? 0
        : names.reduce((total, name) => total + String(name).length * 2, 0);
    const bytes = originalSource.length * 2 + preparedBytes + namesBytes;
    if (bytes > cjsTypeScriptAnalysisCacheMaxBytes) return;
    const entry = {
        mod,
        originalSource,
        preparedSource,
        exportNames: names,
        bytes,
        preparedBytes,
        active: true,
    };
    cjsTypeScriptAnalysisCache.set(mod, entry);
    cjsTypeScriptAnalysisCacheQueue.push(entry);
    cjsTypeScriptAnalysisCacheEntries += 1;
    cjsTypeScriptAnalysisCacheBytes += bytes;
    if (preparedSource !== undefined) {
        cjsTypeScriptPreparedSourceEntries += 1;
        cjsTypeScriptPreparedSourceBytes += preparedBytes;
    }
    pruneCjsTypeScriptAnalysisCache();
}

function captureCjsTypeScriptExportNames(mod, names, originalSource) {
    captureCjsTypeScriptAnalysisCacheEntry(mod, originalSource, undefined, names);
}

function captureCjsTypeScriptPreparedSource(mod, originalSource, preparedSource) {
    captureCjsTypeScriptAnalysisCacheEntry(mod, originalSource, preparedSource, undefined);
}

Object.defineProperty(globalThis, '__wasm_rquickjs_has_cjs_esm_default_snapshot', {
    value: hasCjsEsmDefaultSnapshot,
    writable: false,
    configurable: false,
});

Object.defineProperty(globalThis, '__wasm_rquickjs_get_cjs_esm_default_snapshot', {
    value: getCjsEsmDefaultSnapshot,
    writable: false,
    configurable: false,
});

function getCachedCjsTypeScriptAnalysisEntry(filename, source) {
    const require = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_create_require(filename);
    const resolvedFilename = require.resolve(filename);
    const mod = require.cache[resolvedFilename];
    const entry = mod && cjsTypeScriptAnalysisCache.get(mod);
    if (!entry || entry.originalSource !== source) {
        discardCjsTypeScriptAnalysisCacheEntry(mod);
        return undefined;
    }
    return entry;
}

function getCachedCjsTypeScriptAnalysis(filename, source) {
    const entry = getCachedCjsTypeScriptAnalysisEntry(filename, source);
    return entry === undefined ? undefined : {
        exportNames: entry.exportNames,
        preparedSource: entry.preparedSource,
    };
}

function setCachedCjsTypeScriptExportNames(filename, names, source) {
    const require = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_create_require(filename);
    const resolvedFilename = require.resolve(filename);
    const mod = require.cache[resolvedFilename];
    if (mod) {
        captureCjsTypeScriptExportNames(mod, names, source);
    }
}

Object.defineProperty(globalThis, '__wasm_rquickjs_get_cached_cjs_typescript_analysis', {
    value: getCachedCjsTypeScriptAnalysis,
    writable: false,
    configurable: false,
});
Object.defineProperty(globalThis, '__wasm_rquickjs_set_cached_cjs_typescript_export_names', {
    value: setCachedCjsTypeScriptExportNames,
    writable: false,
    configurable: false,
});
if (testObservabilityEnabledNative()) {
    Object.defineProperty(globalThis, '__wasm_rquickjs_get_cjs_typescript_prepared_source_cache_stats', {
        value: () => ({
            entries: cjsTypeScriptAnalysisCacheEntries,
            bytes: cjsTypeScriptAnalysisCacheBytes,
            preparedEntries: cjsTypeScriptPreparedSourceEntries,
            preparedBytes: cjsTypeScriptPreparedSourceBytes,
            maxEntries: cjsTypeScriptAnalysisCacheMaxEntries,
            maxBytes: cjsTypeScriptAnalysisCacheMaxBytes,
        }),
        writable: false,
        configurable: false,
    });
}

function takePreparedCjsTypeScript(meta) {
    const prepared = meta.__wasm_rquickjs_prepared_cjs_typescript;
    delete meta.__wasm_rquickjs_prepared_cjs_typescript;
    return prepared;
}

Object.defineProperty(globalThis, '__wasm_rquickjs_take_prepared_cjs_typescript', {
    value: takePreparedCjsTypeScript,
    writable: false,
    configurable: false,
});

function loadCjsEsmFacadeDefault(filename, preparedTypeScriptGraph) {
    const require = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_create_require(filename);
    const resolvedFilename = require.resolve(filename);
    return hasCjsEsmDefaultSnapshot(require.cache, resolvedFilename)
        ? getCjsEsmDefaultSnapshot(require.cache, resolvedFilename)
        : preparedTypeScriptGraph
            ? loadPreparedCjsTypeScript(
                resolvedFilename,
                preparedTypeScriptGraph,
                filename,
            )
            : require(filename);
}

function loadPreparedCjsTypeScript(resolvedFilename, graph, traceId) {
    // An ESM facade has no real CommonJS parent; do not invent a self-parent.
    return traceModuleRequire(traceId, null, () => {
        try {
            return loadFilesystemCommonJs(resolvedFilename, null, graph).exports;
        } finally {
            clearPreparedTypeScriptGraph(graph);
        }
    });
}

Object.defineProperty(globalThis, '__wasm_rquickjs_load_cjs_esm_facade_default', {
    value: loadCjsEsmFacadeDefault,
    writable: false,
    configurable: false,
});

function resolveEsmGraphSpecifier(specifier, parentFilename, conditions, mode) {
    mode = mode || 'import';
    if (specifier.startsWith('node:') || specifier.startsWith('data:')) return null;
    const parentDir = pathModule.dirname(parentFilename);
    if (rustClassifiesPathSpecifier(specifier)) {
        try {
            return resolveFilename(specifier, parentDir);
        } catch (_) {
            return null;
        }
    }
    conditions = conditions || (mode === 'cjs-analysis' ? cjsPackageConditions() : esmPackageConditions());
    if (specifier.startsWith('#')) {
        try {
            const resolved = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_require_esm_graph_resolve_package(
                parentFilename,
                specifier,
                conditions,
                mode,
            );
            if (resolved) return { filename: resolved };
        } catch (_) {
            return null;
        }
        return null;
    }
    try {
        const resolved = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_require_esm_graph_resolve_package(
            parentFilename,
            specifier,
            conditions,
            mode,
        );
        return resolved ? { filename: resolved } : null;
    } catch (_) {
        return null;
    }
}

function addRequireEsmGraphMark(filename, marked) {
    const graph = globalThis.__wasm_rquickjs_require_esm_graph_in_progress || Object.create(null);
    const counts = globalThis.__wasm_rquickjs_require_esm_graph_counts || Object.create(null);
    globalThis.__wasm_rquickjs_require_esm_graph_in_progress = graph;
    globalThis.__wasm_rquickjs_require_esm_graph_counts = counts;

    counts[filename] = (counts[filename] || 0) + 1;
    graph[filename] = true;
    marked.push(filename);

    const fileUrl = fileUrlForPath(filename);
    counts[fileUrl] = (counts[fileUrl] || 0) + 1;
    graph[fileUrl] = true;
    marked.push(fileUrl);
}

function stackContains(stack, filename) {
    for (let i = 0; i < stack.length; i++) {
        if (stack[i] === filename) return true;
    }
    return false;
}

function esmGraphReachesAny(filename, stack, seen, fileInfoCache) {
    if (stackContains(stack, filename)) return true;
    seen = seen || Object.create(null);
    if (seen[filename]) return false;
    seen[filename] = true;

    const fileInfo = readEsmGraphFileInfo(filename, fileInfoCache);
    if (fileInfo.source === null) return false;

    const isEsm = fileInfo.isEsm;
    const specifiers = isEsm
        ? esmGraphStaticSpecifiers(fileInfo)
        : esmGraphRequireSpecifiers(fileInfo);
    const conditions = specifiers.length === 0
        ? null
        : (isEsm ? esmPackageConditions() : cjsPackageConditions());
    for (let i = 0; i < specifiers.length; i++) {
        const resolved = resolveEsmGraphSpecifier(specifiers[i], filename, conditions, isEsm ? 'import' : 'cjs-analysis');
        if (resolved && resolved.filename && esmGraphReachesAny(resolved.filename, stack, seen, fileInfoCache)) return true;
    }

    if (isEsm) {
        const bridgeSpecifiers = esmGraphCreateRequireSpecifiers(fileInfo);
        const cjsConditions = bridgeSpecifiers.length === 0 ? null : cjsPackageConditions();
        for (let i = 0; i < bridgeSpecifiers.length; i++) {
            const resolved = resolveEsmGraphSpecifier(bridgeSpecifiers[i], filename, cjsConditions, 'cjs-analysis');
            if (resolved && resolved.filename && esmGraphReachesAny(resolved.filename, stack, seen, fileInfoCache)) return true;
        }
    }

    return false;
}

function scanRequireEsmGraph(filename, marked, seen, stack, fileInfoCache) {
    if (seen[filename]) return;
    seen[filename] = true;

    const fileInfo = readEsmGraphFileInfo(filename, fileInfoCache);
    if (fileInfo.source === null) return;

    const isEsm = fileInfo.isEsm;
    const cjsConditions = isEsm ? null : cjsPackageConditions();
    if (!isEsm) {
        const requireSpecifiers = esmGraphRequireSpecifiers(fileInfo);
        for (let i = 0; i < requireSpecifiers.length; i++) {
            const resolved = resolveEsmGraphSpecifier(requireSpecifiers[i], filename, cjsConditions, 'cjs-analysis');
            if (resolved && resolved.filename) {
                const targetInfo = readEsmGraphFileInfo(resolved.filename, fileInfoCache);
                if (targetInfo.source !== null && targetInfo.isEsm && esmGraphReachesAny(resolved.filename, stack, undefined, fileInfoCache)) {
                    addRequireEsmGraphMark(resolved.filename, marked);
                } else {
                    scanRequireEsmGraph(resolved.filename, marked, seen, stack, fileInfoCache);
                }
            }
        }
        return;
    }

    stack.push(filename);

    const specifiers = esmGraphStaticSpecifiers(fileInfo);
    const esmConditions = specifiers.length === 0 ? null : esmPackageConditions();
    for (let i = 0; i < specifiers.length; i++) {
        const resolved = resolveEsmGraphSpecifier(specifiers[i], filename, esmConditions, 'import');
        if (resolved && resolved.filename) {
            scanRequireEsmGraph(resolved.filename, marked, seen, stack, fileInfoCache);
        }
    }
    const createRequireSpecifiers = esmGraphCreateRequireSpecifiers(fileInfo);
    const createRequireConditions = createRequireSpecifiers.length === 0 ? null : cjsPackageConditions();
    for (let i = 0; i < createRequireSpecifiers.length; i++) {
        const resolved = resolveEsmGraphSpecifier(createRequireSpecifiers[i], filename, createRequireConditions, 'cjs-analysis');
        if (resolved && resolved.filename) {
            const targetInfo = readEsmGraphFileInfo(resolved.filename, fileInfoCache);
            if (targetInfo.source !== null && targetInfo.isEsm && esmGraphReachesAny(resolved.filename, stack, undefined, fileInfoCache)) {
                addRequireEsmGraphMark(resolved.filename, marked);
            } else {
                scanRequireEsmGraph(resolved.filename, marked, seen, stack, fileInfoCache);
            }
        }
    }
    stack.pop();
}

function markRequireEsmGraph(filename) {
    const marked = [];
    scanRequireEsmGraph(filename, marked, Object.create(null), [], Object.create(null));
    return marked;
}

function unmarkRequireEsmGraph(marked) {
    const graph = globalThis.__wasm_rquickjs_require_esm_graph_in_progress;
    const counts = globalThis.__wasm_rquickjs_require_esm_graph_counts;
    if (!graph || !counts) return;
    for (let i = 0; i < marked.length; i++) {
        const key = marked[i];
        counts[key] = (counts[key] || 1) - 1;
        if (counts[key] <= 0) {
            delete counts[key];
            delete graph[key];
        }
    }
}

function throwIfRequireEsmGraphCycle(resolvedFilename) {
    const graph = globalThis.__wasm_rquickjs_require_esm_graph_in_progress;
    if (graph && (graph[resolvedFilename] || graph[fileUrlForPath(resolvedFilename)])) {
        const err = new Error('Cannot require() ES Module ' + resolvedFilename + ' in a cycle.');
        err.code = 'ERR_REQUIRE_CYCLE_MODULE';
        throw err;
    }
}

const wrapper = [
    '(function (exports, require, module, __filename, __dirname) { ',
    '\n});'
];

function wrap(script) {
    const activeWrapper = (typeof moduleExports !== 'undefined' && moduleExports.wrapper) || wrapper;
    return activeWrapper[0] + script + activeWrapper[1];
}

function wrapForCompile(script, dynamicImportBindings) {
    const activeWrapper = (typeof moduleExports !== 'undefined' && moduleExports.wrapper) || wrapper;
    if (dynamicImportBindings) {
        return '(function(' + dynamicImportBindings.reactionName + ',' + dynamicImportBindings.traceName + ',' + dynamicImportBindings.prepareEvalName + ',' + dynamicImportBindings.nativeEvalName + '){return ' +
            activeWrapper[0] + script + activeWrapper[1] +
            '\n})(__wasm_rquickjs_dynamic_import_reaction,__wasm_rquickjs_dynamic_import_with_trace,__wasm_rquickjs_prepare_cjs_eval_source,__wasm_rquickjs_native_eval);';
    }
    return activeWrapper[0] + script + activeWrapper[1];
}

function compileCjs(filename, source, isPreparedTypeScript = false) {
    if (source.length > 0 && source.charCodeAt(0) === 0xFEFF) {
        source = source.slice(1);
    }
    // Strip shebang
    if (source.length > 1 && source.charCodeAt(0) === 0x23 && source.charCodeAt(1) === 0x21) {
        source = '//' + source;
    }

    if (!isPreparedTypeScript) {
        source = transpileTypeScriptModule(filename, source, false);
    }
    source = stripV8OptimizationIntrinsics(source);
    const strippedImportAttributes = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_prepare_cjs_source(
        source,
        filename,
        null,
        null,
        null,
        null,
    );
    source = strippedImportAttributes.source;

    const cjsLineOffsets = getCjsLineOffsetRegistry();
    cjsLineOffsets[filename] = cjsLineOffset;

    const wrappedSource = wrapForCompile(source + '\n//# sourceURL=' + filename + '\n', strippedImportAttributes.dynamicImportBindings);
    return _evalWithFilename(wrappedSource, filename);
}

function callCompiledCjsFunction(mod, compiledFn, source, filename, dirname, childRequire) {
    const previousModuleContext = globalThis.__wasm_rquickjs_current_module;
    globalThis.__wasm_rquickjs_current_module = {
        filename: filename,
        source: source
    };
    const previousCjsImportDir = globalThis.__wasm_rquickjs_cjs_import_dir;
    globalThis.__wasm_rquickjs_cjs_import_dir = dirname;
    try {
        return compiledFn.call(mod.exports, mod.exports, childRequire, mod, filename, dirname);
    } finally {
        globalThis.__wasm_rquickjs_current_module = previousModuleContext;
        if (previousCjsImportDir !== undefined) {
            globalThis.__wasm_rquickjs_cjs_import_dir = previousCjsImportDir;
        } else {
            delete globalThis.__wasm_rquickjs_cjs_import_dir;
        }
    }
}

function compileModuleInto(mod, source, filename, requireOverride) {
    filename = filename === undefined || filename === null ? mod.filename : filename;
    source = String(source);
    registerSourceMapForCjs(filename, source, mod);
    const requireParentFilename = filename === '' && mod && typeof mod.filename === 'string'
        ? mod.filename
        : filename;
    const dirname = pathModule.dirname(filename);
    const requireDirname = pathModule.dirname(requireParentFilename);
    const childRequire = requireOverride || makeRequire(requireDirname, mod, requireParentFilename);
    const compiledFn = compileCjs(filename, source);
    return callCompiledCjsFunction(mod, compiledFn, source, filename, dirname, childRequire);
}

function loaderValueTypeName(value) {
    if (value === null) return 'null';
    const type = typeof value;
    if (type !== 'object') return type;
    if (Array.isArray(value)) return 'Array';
    if (value && value.constructor && typeof value.constructor.name === 'string') return value.constructor.name;
    return 'Object';
}

function makeLoaderInvalidReturnValueError(hookName, value) {
    const err = new TypeError(`Expected an object to be returned from the '${hookName}' hook but got ${loaderValueTypeName(value)}.`);
    err.code = 'ERR_INVALID_RETURN_VALUE';
    return err;
}

function makeLoaderInvalidReturnPropertyValueError(propertyName, hookName, expected, value) {
    const err = new TypeError(`Expected ${expected} for "${propertyName}" from the '${hookName}' hook but got type ${loaderValueTypeName(value)}.`);
    err.code = 'ERR_INVALID_RETURN_PROPERTY_VALUE';
    return err;
}

function makeLoaderUnknownModuleFormatError(format) {
    const err = new RangeError(`Unknown module format: ${String(format)}`);
    err.code = 'ERR_UNKNOWN_MODULE_FORMAT';
    return err;
}

function makeLoaderInvalidUrlError(hookName, loaderUrl, value) {
    const err = new TypeError(`Expected a URL string to be returned for "url" from the '${hookName}' hook in ${String(loaderUrl)} but got ${JSON.stringify(String(value))}.`);
    err.code = 'ERR_INVALID_RETURN_PROPERTY_VALUE';
    return err;
}

function makeLoaderMissingUrlError(hookName, loaderUrl, value) {
    const err = new TypeError(`Expected a URL string to be returned for "url" from the '${hookName}' hook in ${String(loaderUrl)} but got type ${loaderValueTypeName(value)}.`);
    err.code = 'ERR_INVALID_RETURN_PROPERTY_VALUE';
    return err;
}

function makeLoaderChainError(hook) {
    const err = new Error(`${hook} hook did not call the next hook and did not explicitly short circuit`);
    err.code = 'ERR_LOADER_CHAIN_INCOMPLETE';
    return err;
}

function makeEsmModuleNotFoundError(specifier) {
    const err = new Error("Cannot find module '" + specifier + "'");
    err.code = 'ERR_MODULE_NOT_FOUND';
    return err;
}

function makeEsmUnsupportedDirImportError(filename) {
    const err = new Error('Directory import ' + JSON.stringify(filename) + ' is not supported resolving ES modules');
    err.code = 'ERR_UNSUPPORTED_DIR_IMPORT';
    return err;
}

function rustClassifiesPathSpecifier(specifier) {
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_classify_module_specifier(specifier);
}

function defaultLoaderFormatForFilename(filename) {
    if (filename.endsWith('.json')) return 'json';
    if (filename.endsWith('.mjs') || filename.endsWith('.mts')) return 'module';
    if (filename.endsWith('.cjs') || filename.endsWith('.cts')) return 'commonjs';
    return undefined;
}

function loaderFormatOrUndefined(format) {
    return format === undefined || format === null ? undefined : String(format);
}

function registeredLoaderUrlResult(url) {
    return { url };
}

function registeredLoaderUrlFormatResult(url, format) {
    return { url, format };
}

function registeredLoaderUrlFormatSourceResult(url, format, source) {
    const result = registeredLoaderUrlFormatResult(url, format);
    result.source = source;
    return result;
}

function resultForEsmFileUrl(url) {
    const filename = nodeUrl.fileURLToPath(url);
    const stat = _stat(filename);
    if (stat === 1) throw makeEsmUnsupportedDirImportError(filename);
    if (stat !== 0) throw makeEsmModuleNotFoundError(url.href);
    return registeredLoaderUrlFormatResult(url.href, defaultLoaderFormatForFilename(filename));
}

function parentFilenameForLoaderResolve(parentURL, baseUrl) {
    parentURL = String(parentURL || baseUrl);
    if (
        parentURL.startsWith('data:') &&
        typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_lookup_loader_source_url === 'function'
    ) {
        parentURL = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_lookup_loader_source_url(parentURL) || parentURL;
    }
    if (parentURL.startsWith('file://')) {
        return nodeUrl.fileURLToPath(parentURL);
    }
    if (parentURL.startsWith('/')) {
        return parentURL;
    }
    return null;
}

function registeredLoaderBuiltinResolve(specifier, cjsMode) {
    const resolved = builtinResolveSpecifier(specifier);
    if (resolved === undefined) return undefined;
    if (specifier.startsWith('node:')) {
        return cjsMode ? registeredLoaderUrlFormatResult(resolved, 'builtin') : registeredLoaderUrlResult(resolved);
    }
    return registeredLoaderUrlFormatResult(resolved, 'builtin');
}

    function packageConditionArrayForLoaderResolve(context, defaultConditions) {
        if (context && Array.isArray(context.conditions)) {
            const conditions = setFromArray(context.conditions);
            conditions.add('default');
            return Array.from(conditions);
        }
        return defaultConditions;
    }

    function packageResolutionForLoaderResult(resolved) {
        if (!resolved || !resolved.url) return undefined;
        return registeredLoaderUrlFormatResult(String(resolved.url), loaderFormatOrUndefined(resolved.format));
    }

    function cjsLoaderFileFormat(filename, format) {
        return format || (filename.endsWith('.json') ? 'json' : 'commonjs');
    }

    function cjsLoaderFileResult(filename, source, format, url) {
        const resultUrl = url === undefined ? nodeUrl.pathToFileURL(filename).href : String(url);
        const resultFormat = cjsLoaderFileFormat(filename, format);
        return source === null || source === undefined
            ? registeredLoaderUrlFormatResult(resultUrl, resultFormat)
            : registeredLoaderUrlFormatSourceResult(resultUrl, resultFormat, source);
    }

    function cjsLoaderFileUrlResult(url, format, resultUrl) {
        const filename = nodeUrl.fileURLToPath(url);
        if (_stat(filename) !== 0) return undefined;
        return cjsLoaderFileResult(filename, undefined, format, resultUrl);
    }

    function cjsPackageResolutionForLoaderResult(resolved) {
        const packageResolved = packageResolutionForLoaderResult(resolved);
        if (!packageResolved) return undefined;
        if (!packageResolved.url.startsWith('file://')) return packageResolved;
        return cjsLoaderFileUrlResult(packageResolved.url, packageResolved.format, packageResolved.url);
    }

    function resolvePackageDefaultForLoader(specifier, parentURL, context, defaultConditions, mode, mapNotFoundToCjs) {
        try {
            return resolvePackageWithRustBridge(
                parentURL,
                specifier,
                packageConditionArrayForLoaderResolve(context, defaultConditions),
                mode,
                'Internal package resolver provider is not initialized',
            );
        } catch (err) {
            if (mapNotFoundToCjs && err && err.code === 'ERR_MODULE_NOT_FOUND') {
                throw makeModuleNotFoundError(specifier);
            }
            throw err;
        }
    }

    function resolveEsmPackageDefaultForLoader(specifier, parentURL, context) {
        return packageResolutionForLoaderResult(
            resolvePackageDefaultForLoader(specifier, parentURL, context, esmPackageConditions(), 'import', false)
        );
    }

    function resolveCjsPackageDefaultForLoader(specifier, parentURL, context) {
        const resolved = resolvePackageDefaultForLoader(
            specifier,
            parentURL,
            context,
            cjsPackageConditions(),
            'cjs-analysis',
            true,
        );
        return cjsPackageResolutionForLoaderResult(resolved);
    }

    function resolveCjsDefaultForLoader(specifier, parentURL, context) {
        const parentFilename = parentFilenameForLoaderResolve(parentURL, fileUrlForPath('/'));
        const parentDir = parentFilename ? pathModule.dirname(parentFilename) : '/';
        if (specifier.startsWith('file://')) {
            return cjsLoaderFileUrlResult(specifier);
        }
        if (rustClassifiesPathSpecifier(specifier)) {
            const resolved = resolveFilename(specifier, parentDir);
            return cjsLoaderFileResult(resolved.filename, undefined);
        }
        if (specifier.startsWith('#') && parentFilename) {
            return resolveCjsPackageDefaultForLoader(specifier, parentURL, context);
        }
        const packageResolved = resolveCjsPackageDefaultForLoader(specifier, parentURL, context);
        if (packageResolved) return packageResolved;
        return undefined;
    }

    function resultForRelativeOrAbsoluteSpecifier(specifier, parentURL) {
        return resultForEsmFileUrl(new URL(specifier, parentURL));
    }

function isLoaderSourceValue(value) {
    return typeof value === 'string' ||
        value instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) ||
        ArrayBuffer.isView(value);
}

function registeredLoaderHasOwnSource(result) {
    return result && Object.prototype.hasOwnProperty.call(result, 'source');
}

function registeredLoaderHasSource(result) {
    return registeredLoaderHasOwnSource(result) && result.source !== null && result.source !== undefined;
}

function validateRegisteredLoaderResult(result, hookName, context) {
    if (!result || typeof result !== 'object') {
        throw makeLoaderInvalidReturnValueError(hookName, result);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'format')) {
        const format = result.format;
        if (format !== undefined && format !== null && typeof format !== 'string') {
            throw makeLoaderInvalidReturnPropertyValueError('format', hookName, 'a string or nullish value', format);
        }
    }
    if (hookName === 'load' && registeredLoaderHasOwnSource(result)) {
        const source = result.source;
        if (source === null || source === undefined) {
            if (result.format === 'commonjs' || (result.format === undefined && context && context.format === 'commonjs')) return result;
            throw makeLoaderInvalidReturnPropertyValueError('source', hookName, 'a string, ArrayBuffer, or ArrayBufferView', source);
        }
        if (!isLoaderSourceValue(source)) {
            throw makeLoaderInvalidReturnPropertyValueError('source', hookName, 'a string, ArrayBuffer, or ArrayBufferView', source);
        }
    }
    return result;
}

function validateRegisteredLoaderLoadFormat(format) {
    if (format === undefined || format === null) return undefined;
    if (format === 'module' || format === 'commonjs' || format === 'json' || format === 'builtin' || format === 'wasm') {
        return format;
    }
    throw makeLoaderUnknownModuleFormatError(format);
}

function validateRegisteredLoaderResolveUrl(url, loaderUrl) {
    if (typeof url !== 'string') {
        throw makeLoaderMissingUrlError('resolve', loaderUrl, url);
    }
    try {
        new URL(url);
    } catch (_) {
        throw makeLoaderInvalidUrlError('resolve', loaderUrl, url);
    }
}

function loaderSourceToString(source) {
    if (typeof source === 'string') {
        return source;
    }
    if (source instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(source));
    }
    if (typeof SharedArrayBuffer !== 'undefined' && source instanceof SharedArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(source));
    }
    if (ArrayBuffer.isView(source) && source.buffer instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    }
    if (
        typeof SharedArrayBuffer !== 'undefined' &&
        ArrayBuffer.isView(source) &&
        source.buffer instanceof SharedArrayBuffer
    ) {
        return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    }
    throw makeLoaderInvalidReturnPropertyValueError('source', 'load', 'a string, ArrayBuffer, or ArrayBufferView', source);
}

function loaderCommonJsSourceModule(source, url) {
    source = loaderSourceToString(source);
    const filename = loaderCommonJsFilename(url);
    const cacheKey = loaderCommonJsCacheKey(url, filename);
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_build_loader_cjs_facade !== 'function') {
        throw new Error('Internal loader CommonJS facade builder is not initialized');
    }
    const facade = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_build_loader_cjs_facade(
        filename,
        String(url || ''),
        cacheKey,
        source,
    );
    return facade;
}

function loaderFileUrlSource(url) {
    if (!String(url).startsWith('file://')) return null;
    try {
        return tryReadFile(nodeUrl.fileURLToPath(url));
    } catch (_) {
        return null;
    }
}

function registeredLoaderPathOrUrlReturn(url, preserveFileUrlSuffix) {
    url = String(url);
    if (!url.startsWith('file://')) return url;
    const path = nodeUrl.fileURLToPath(url);
    if (!preserveFileUrlSuffix) return path;
    if (/[?#]/.test(path)) return url;
    const suffixStart = url.search(/[?#]/);
    return suffixStart < 0 ? path : path + url.slice(suffixStart);
}

function loaderCommonJsFilename(url) {
    url = String(url || '');
    if (url.startsWith('file://')) {
        return nodeUrl.fileURLToPath(url);
    }
    if (url.startsWith('/')) {
        return url;
    }
    return url || 'anonymous';
}

function loaderCommonJsCacheKey(url, filename) {
    return filename;
}

function validateRequireId(id) {
    if (typeof id !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('id', 'string', id);
    }
    if (id === '') {
        const argErr = new TypeError("The argument 'id' must be a non-empty string. Received ''");
        argErr.code = 'ERR_INVALID_ARG_VALUE';
        throw argErr;
    }
}

function validateRequireRequest(request) {
    if (typeof request !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('request', 'string', request);
    }
}

function markRequireEsmForcedModule(resolvedFilename) {
    let registry = globalThis.__wasm_rquickjs_require_esm_forced_module;
    if (!registry || typeof registry !== 'object') {
        registry = Object.create(null);
        Object.defineProperty(globalThis, '__wasm_rquickjs_require_esm_forced_module', {
            value: registry,
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
    registry[resolvedFilename] = true;
    registry[nodeUrl.pathToFileURL(resolvedFilename).href] = true;
}

function unmarkRequireEsmForcedModule(resolvedFilename) {
    const registry = globalThis.__wasm_rquickjs_require_esm_forced_module;
    if (!registry || typeof registry !== 'object') return;
    delete registry[resolvedFilename];
    delete registry[nodeUrl.pathToFileURL(resolvedFilename).href];
}

function requireEsmWithCacheGuard(mod, resolvedFilename, forceModule) {
    throwIfRequireEsmGraphCycle(resolvedFilename);
    const markedGraph = markRequireEsmGraph(resolvedFilename);
    Object.defineProperty(mod, '__wasmRequireEsmInProgress', {
        value: true,
        writable: true,
        configurable: true,
        enumerable: false,
    });
    try {
        if (forceModule) markRequireEsmForcedModule(resolvedFilename);
        const namespace = _requireEsm(resolvedFilename);
        if (namespace && typeof namespace === 'object' && Object.hasOwn(namespace, 'module.exports')) {
            return namespace['module.exports'];
        }
        return wrapEsmNamespace(namespace);
    } finally {
        if (forceModule) unmarkRequireEsmForcedModule(resolvedFilename);
        unmarkRequireEsmGraph(markedGraph);
        delete mod.__wasmRequireEsmInProgress;
    }
}

function currentMainScriptFilename() {
    if (!globalThis.process || !globalThis.process.argv || typeof globalThis.process.argv[1] !== 'string') {
        return null;
    }
    const mainScript = globalThis.process.argv[1];
    if (!mainScript) return null;
    try {
        return toCjsCanonicalFilename(mainScript, true);
    } catch (_) {
        const absolute = pathModule.isAbsolute(mainScript) ? mainScript : pathModule.resolve('/', mainScript);
        return absolute;
    }
}

function isMainEntryFilename(resolvedFilename) {
    if (typeof mainModule === 'undefined' || mainModule.filename !== '/') return false;
    const mainScript = currentMainScriptFilename();
    if (!mainScript) return false;
    try {
        return toCjsCanonicalFilename(resolvedFilename, true) === mainScript;
    } catch (_) {
        const absolute = pathModule.isAbsolute(resolvedFilename) ? resolvedFilename : pathModule.resolve('/', resolvedFilename);
        return absolute === mainScript;
    }
}

function unlinkModuleFromParent(parentModule, mod) {
    if (!parentModule || !parentModule.children) return;
    const index = parentModule.children.indexOf(mod);
    if (index !== -1) parentModule.children.splice(index, 1);
}

function discardCjsModuleLoad(cacheKey, parentModule, mod) {
    delete currentModuleCache()[cacheKey];
    unlinkModuleFromParent(parentModule, mod);
}

function defineEnumerableWritable(obj, name, value) {
    Object.defineProperty(obj, name, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}

function initializeCjsModuleRecord(mod, id, filename, dirname, parentModule, pathsBase) {
    defineEnumerableWritable(mod, 'id', id);
    defineEnumerableWritable(mod, 'filename', filename);
    defineEnumerableWritable(mod, 'path', dirname);
    defineEnumerableWritable(mod, 'exports', {});
    defineEnumerableWritable(mod, 'loaded', false);
    defineEnumerableWritable(mod, 'parent', parentModule || null);
    defineEnumerableWritable(mod, 'children', []);
    defineEnumerableWritable(mod, 'paths', _nodeModulePaths(pathsBase));
    moduleRequireOverrides.delete(mod);
    installCjsEsmDefaultSnapshotSlot(mod);
    return mod;
}

function loadCommonJsTransaction(descriptor) {
    const filename = descriptor.filename;
    let source = descriptor.source;
    const parentModule = descriptor.parentModule || null;
    const isLoaderSource = descriptor.sourceKind === 'loader';
    const isMainModuleLoad = descriptor.isMainModule === true;
    const canFallbackToEsm = descriptor.allowEsmFallback === true;
    const preparedTypeScriptGraph = descriptor.preparedTypeScriptGraph;
    const preparedTypeScript = preparedTypeScriptGraph && preparedTypeScriptGraph[filename];
    if (preparedTypeScript) delete preparedTypeScriptGraph[filename];
    const cacheKey = descriptor.cacheKey;
    const dirname = pathModule.dirname(filename);
    const pathsBase = isLoaderSource && !pathModule.isAbsolute(filename) ? '/' : dirname;

    // Check cache
    if (currentModuleCache()[cacheKey]) {
        throwIfRequireEsmGraphCycle(cacheKey);
        const cached = currentModuleCache()[cacheKey];
        if (cached.__wasmRequireEsmInProgress) {
            const err = new Error('Cannot require() ES Module ' + filename + ' in a cycle.');
            err.code = 'ERR_REQUIRE_CYCLE_MODULE';
            throw err;
        }
        if (parentModule && parentModule.children && !parentModule.children.includes(cached)) {
            parentModule.children.push(cached);
        }
        return cached;
    }

    let mod;
    if (isMainModuleLoad) {
        mod = mainModule;
        initializeCjsModuleRecord(mod, '.', filename, dirname, null, dirname);
        if (globalThis.process) {
            globalThis.process.mainModule = mod;
        }
    } else {
        mod = initializeCjsModuleRecord(
            Object.create(Module.prototype),
            filename,
            filename,
            dirname,
            parentModule,
            pathsBase,
        );
    }

    // Cache before executing (handles circular dependencies)
    currentModuleCache()[cacheKey] = mod;
    if (parentModule && parentModule.children) {
        parentModule.children.push(mod);
    }

    let cjsEsmDefaultSnapshotEligible = false;

    if (isLoaderSource) {
        try {
            if (descriptor.sourceFormat === 'json') {
                if (source.length > 0 && source.charCodeAt(0) === 0xFEFF) {
                    source = source.slice(1);
                }
                try {
                    mod.exports = JSON.parse(source);
                } catch (error) {
                    const invalidJson = new SyntaxError(filename + ': ' + error.message);
                    invalidJson.code = 'ERR_INVALID_JSON';
                    throw invalidJson;
                }
            } else {
                const loaderRequire = makeLoaderCommonJsRequire(
                    descriptor.sourceUrl || (pathModule.isAbsolute(filename) ? fileUrlForPath(filename) : filename),
                    pathModule.isAbsolute(filename) ? dirname : '/',
                    mod,
                    filename,
                );
                moduleRequireOverrides.set(mod, loaderRequire);
                compileModuleInto(mod, source, filename, loaderRequire);
            }
            cjsEsmDefaultSnapshotEligible = true;
        } catch (err) {
            discardCjsModuleLoad(cacheKey, parentModule, mod);
            throw err;
        }
    } else {
    // Check for custom extension handler
    const ext = findLongestRegisteredExtension(filename);
    const handler = requireExtensions[ext];
    if (handler && !_defaultExtHandlers.has(handler)) {
        try {
            handler(mod, filename);
            cjsEsmDefaultSnapshotEligible = true;
        } catch (err) {
            discardCjsModuleLoad(cacheKey, parentModule, mod);
            throw err;
        }
    } else if (handler === defaultNodeExtensionHandler) {
        discardCjsModuleLoad(cacheKey, parentModule, mod);
        const err = new Error("Native .node modules are not supported in WASM: '" + filename + "'");
        err.code = 'ERR_DLOPEN_FAILED';
        throw err;
    } else if (handler === defaultJsonExtensionHandler) {
        try {
            source = fsModule.readFileSync(filename, 'utf8');
            registerSourceMapForCjs(filename, source, mod);
        } catch (err) {
            discardCjsModuleLoad(cacheKey, parentModule, mod);
            throw err;
        }
        try {
            if (source.length > 0 && source.charCodeAt(0) === 0xFEFF) {
                source = source.slice(1);
            }
            mod.exports = JSON.parse(source);
        } catch (e) {
            discardCjsModuleLoad(cacheKey, parentModule, mod);
            const err = new SyntaxError(filename + ': ' + e.message);
            err.code = 'ERR_INVALID_JSON';
            throw err;
        }
    } else {
        const packageScope = (filename.endsWith('.js') || filename.endsWith('.ts'))
            ? getPackageScopeInfo(filename)
            : null;
        const explicitPackageType = packageScope ? packageScope.packageType : null;
        const isCommonJsPackage = explicitPackageType === 'commonjs' ||
            (explicitPackageType === null && packageScope !== null && packageScope.isNodeModulesPackage);
        const isEsm = filename.endsWith('.mjs') || filename.endsWith('.mts') ||
            ((filename.endsWith('.js') || filename.endsWith('.ts')) && explicitPackageType === 'module');
        if (isEsm && rustHasExecArgvFlag('--no-experimental-require-module')) {
            discardCjsModuleLoad(cacheKey, parentModule, mod);
            const esmErr = new Error(
                "require() of ES Module " + filename + " not supported. " +
                "Instead change the require of " + filename + " to a dynamic " +
                "import() which is available in all CommonJS modules."
            );
            esmErr.code = 'ERR_REQUIRE_ESM';
            throw esmErr;
        }
        if (isEsm) {
            try {
                mod.exports = requireEsmWithCacheGuard(mod, filename);
            } catch (err) {
                discardCjsModuleLoad(cacheKey, parentModule, mod);
                throw err;
            }
        } else {
            try {
                source = preparedTypeScript
                    ? preparedTypeScript.originalSource
                    : fsModule.readFileSync(filename, 'utf8');
                registerSourceMapForCjs(filename, source, mod);
            } catch (err) {
                discardCjsModuleLoad(cacheKey, parentModule, mod);
                throw err;
            }
            const dirname = pathModule.dirname(filename);
            let compiledSource;
            let typeScriptExportNames;
            try {
                compiledSource = preparedTypeScript
                    ? preparedTypeScript.preparedSource
                    : prepareCommonJsTypeScript(filename, source);
                typeScriptExportNames = preparedTypeScript && preparedTypeScript.exportNames;
            } catch (err) {
                discardCjsModuleLoad(cacheKey, parentModule, mod);
                throw err;
            }
            const childRequire = makeRequire(
                dirname,
                mod,
                undefined,
                mainModule,
                preparedTypeScriptGraph,
            );
            let compiledFn;
            let cjsSyntaxError = null;
            const shouldFallbackToEsm = canFallbackToEsm &&
                !filename.endsWith('.cjs') && !filename.endsWith('.cts') && !isCommonJsPackage;
            let cjsWrapperLexicalRedeclaration = false;
            let cjsSourceLooksEsm = false;
            try {
                compiledFn = compileCjs(
                    filename,
                    compiledSource,
                    true,
                );
            } catch (err) {
                // Normalize QuickJS SyntaxError messages for ESM keywords in CJS context
                if (err && err.name === 'SyntaxError') {
                    normalizeEsmSyntaxError(err);
                } else if (err && typeof err.message === 'string' && err.message === 'return not in a function') {
                    markAsSyntaxError(err);
                }
                // For .js files (not .cjs), detect ESM syntax and fall back to ESM loading
                if (shouldFallbackToEsm && err && err.name === 'SyntaxError') {
                    const analysis = rustModuleSourceAnalysis(source);
                    cjsSourceLooksEsm = analysis.looksLikeEsm;
                    cjsWrapperLexicalRedeclaration = analysis.hasCjsWrapperLexicalRedeclaration;
                }
                if (shouldFallbackToEsm && err && err.name === 'SyntaxError' && (cjsSourceLooksEsm || cjsWrapperLexicalRedeclaration)) {
                    cjsSyntaxError = err;
                } else {
                    discardCjsModuleLoad(cacheKey, parentModule, mod);
                    maybeSetArrowMessageOnSyntaxError(err, filename, source);
                    throw err;
                }
            }
            if (cjsSyntaxError || cjsWrapperLexicalRedeclaration) {
                if (rustHasExecArgvFlag('--no-experimental-require-module') && cjsSyntaxError) {
                    discardCjsModuleLoad(cacheKey, parentModule, mod);
                    maybeSetArrowMessageOnSyntaxError(cjsSyntaxError, filename, source);
                    throw cjsSyntaxError;
                }
                // SyntaxError in a .js file — try loading as ESM (entry point detection)
                try {
                    mod.exports = requireEsmWithCacheGuard(mod, filename, true);
                } catch (esmErr) {
                    discardCjsModuleLoad(cacheKey, parentModule, mod);
                    if (cjsSourceLooksEsm || cjsWrapperLexicalRedeclaration) {
                        normalizeEsmSyntaxError(esmErr);
                        throw esmErr;
                    }
                    // ESM loading also failed — throw the original CJS SyntaxError
                    maybeSetArrowMessageOnSyntaxError(cjsSyntaxError, filename, source);
                    throw cjsSyntaxError;
                }
            } else if (compiledFn) {
                try {
                    callCompiledCjsFunction(mod, compiledFn, source, filename, dirname, childRequire);
                } catch (err) {
                    discardCjsModuleLoad(cacheKey, parentModule, mod);
                    maybeSetArrowMessageOnSyntaxError(err, filename, source);
                    throw err;
                }
                if (typeScriptExportNames !== undefined) {
                    captureCjsTypeScriptExportNames(
                        mod,
                        typeScriptExportNames,
                        source,
                    );
                }
                if (isTypeScriptFilename(filename) && typeScriptExportNames === undefined) {
                    captureCjsTypeScriptPreparedSource(
                        mod,
                        source,
                        compiledSource,
                    );
                }
                cjsEsmDefaultSnapshotEligible = true;
            }
        }
    }

    }

    mod.loaded = true;
    if (cjsEsmDefaultSnapshotEligible) {
        captureCjsEsmDefaultSnapshot(mod);
    }
    return mod;
}

function loadFilesystemCommonJs(resolvedFilename, parentModule, preparedTypeScriptGraph = undefined) {
    const isMainModule = isMainEntryFilename(resolvedFilename);
    const filename = toCjsCanonicalFilename(resolvedFilename, isMainModule);
    return loadCommonJsTransaction({
        cacheKey: filename,
        filename,
        parentModule,
        sourceKind: 'filesystem',
        source: undefined,
        sourceUrl: undefined,
        isMainModule,
        allowEsmFallback: true,
        preparedTypeScriptGraph,
    });
}

function makeLoaderCommonJsRequire(parentUrl, parentDir, parentModule, parentFilename) {
    const fallbackRequire = makeRequire(parentDir, parentModule, parentFilename);
    function loaderRequire(id) {
        validateRequireId(id);
        if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders_sync === 'function') {
            const loaded = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders_sync(parentUrl, id);
            if (loaded) {
                if (loaded.format === 'builtin' && loaded.url) {
                    const id = String(loaded.url).startsWith('node:') ? String(loaded.url) : 'node:' + String(loaded.url);
                    const builtin = builtinModuleForSpecifier(id);
                    if (builtin !== undefined) return builtin;
                }
                if (loaded.format === 'commonjs' && registeredLoaderHasSource(loaded)) {
                    const filename = loaderCommonJsFilename(loaded.url);
                    return loadCommonJsLoaderSourceExports(filename, loaded.source, loaded.url, loaderCommonJsCacheKey(loaded.url, filename), parentModule);
                }
                if (loaded.format === 'json' && registeredLoaderHasSource(loaded)) {
                    const filename = loaderCommonJsFilename(loaded.url);
                    return loadJsonLoaderSourceExports(
                        filename,
                        loaded.source,
                        loaded.url,
                        loaderCommonJsCacheKey(loaded.url, filename),
                        parentModule,
                    );
                }
                if (
                    (loaded.format === 'commonjs' || loaded.format === 'json') &&
                    loaded.url &&
                    String(loaded.url).startsWith('file://')
                ) {
                    return loadFilesystemCommonJs(loaderCommonJsFilename(loaded.url), parentModule).exports;
                }
            }
        }
        return fallbackRequire(id);
    }
    loaderRequire.cache = fallbackRequire.cache;
    loaderRequire.extensions = fallbackRequire.extensions;
    loaderRequire.resolve = function resolve(id, options) {
        validateRequireRequest(id);
        if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders_sync === 'function') {
            const loaded = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders_sync(parentUrl, id, true);
            if (loaded && loaded.url) {
                const loadedUrl = String(loaded.url);
                if (loadedUrl.startsWith('node:')) return id.startsWith('node:') ? loadedUrl : loadedUrl.slice(5);
                return registeredLoaderPathOrUrlReturn(loadedUrl);
            }
        }
        return fallbackRequire.resolve(id, options);
    };
    loaderRequire.resolve.paths = fallbackRequire.resolve.paths;
    loaderRequire.main = fallbackRequire.main;
    return loaderRequire;
}

function loadCommonJsLoaderSourceExports(filename, source) {
    const sourceUrl = arguments.length > 2 ? String(arguments[2]) : undefined;
    const cacheKey = arguments.length > 3 ? String(arguments[3]) : undefined;
    const parentModule = arguments.length > 4 ? arguments[4] : null;
    filename = String(filename);
    return loadCommonJsTransaction({
        cacheKey: cacheKey || filename,
        filename,
        parentModule,
        sourceKind: 'loader',
        sourceFormat: 'commonjs',
        source: loaderSourceToString(source),
        sourceUrl,
        isMainModule: false,
        allowEsmFallback: false,
    }).exports;
}

function loadJsonLoaderSourceExports(filename, source) {
    const sourceUrl = arguments.length > 2 ? String(arguments[2]) : undefined;
    const cacheKey = arguments.length > 3 ? String(arguments[3]) : undefined;
    const parentModule = arguments.length > 4 ? arguments[4] : null;
    filename = String(filename);
    return loadCommonJsTransaction({
        cacheKey: cacheKey || filename,
        filename,
        parentModule,
        sourceKind: 'loader',
        sourceFormat: 'json',
        source: loaderSourceToString(source),
        sourceUrl,
        isMainModule: false,
        allowEsmFallback: false,
    }).exports;
}

if (typeof globalThis.__wasm_rquickjs_load_commonjs_loader_source !== 'function') {
    Object.defineProperty(globalThis, '__wasm_rquickjs_load_commonjs_loader_source', {
        value: loadCommonJsLoaderSourceExports,
        writable: false,
        configurable: false,
    });
}

// The root "main" module
const mainModule = Object.assign(Object.create(Module.prototype), {
    id: '.',
    filename: '/',
    path: '/',
    exports: {},
    loaded: true,
    parent: null,
    children: [],
});
installCjsEsmDefaultSnapshotSlot(mainModule);

function rustSplitPackageName(id) {
    return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_split_module_package_name(id);
}

function resolveFromNodeModules(id, parentDir, parentFilename, conditions, lookupPaths, resolution) {
    resolution = resolution || makeCjsResolutionState();
    conditions = conditions || cjsPackageConditions();
    const dirs = Array.isArray(lookupPaths) ? lookupPaths : _nodeModulePaths(parentDir);
    const cacheKey = cjsPathCacheKey(id, dirs);
    const cached = cjsCachedPathResolution(cjsPathCacheValue(cacheKey));
    if (cached !== null) return cached;

    // Split into package name and subpath for packages with subpath specifiers
    const parts = rustSplitPackageName(id);

    const selfResolved = resolvePackageSelfReference(parts, parentDir, conditions, resolution);
    if (selfResolved !== undefined) {
        cjsSetPathCacheResolvedFilename(cacheKey, selfResolved.filename);
        return selfResolved;
    }

    for (let i = 0; i < dirs.length; i++) {
        const pkgDir = pathModule.join(dirs[i], parts.name);
        const exportsResolved = resolvePackageExportsEntry(parts, pkgDir, conditions, resolution);
        if (exportsResolved !== undefined) {
            cjsSetPathCacheResolvedFilename(cacheKey, exportsResolved.filename);
            return exportsResolved;
        }

        const fallbackResolved = resolveCjsPackageFallbacks(parts, pkgDir, id, parentFilename || parentDir);
        if (fallbackResolved !== null) {
            cjsSetPathCacheResolvedFilename(cacheKey, fallbackResolved.filename);
            return fallbackResolved;
        }

    }
    return null;
}

function cjsLookupPathsForResolveOptions(searchPaths) {
    const lookupPaths = [];
    function pushUnique(path) {
        if (!lookupPaths.includes(path)) lookupPaths.push(path);
    }
    for (let pi = 0; pi < searchPaths.length; pi++) {
        if (typeof searchPaths[pi] !== 'string') {
            const argErr = new TypeError("The argument 'paths[" + pi + "]' must be a string. Received " + typeof searchPaths[pi]);
            argErr.code = 'ERR_INVALID_ARG_VALUE';
            throw argErr;
        }
        const nodeModulePaths = _nodeModulePaths(pathModule.resolve(searchPaths[pi]));
        for (let i = 0; i < nodeModulePaths.length; i++) {
            pushUnique(nodeModulePaths[i]);
        }
    }
    for (let i = 0; i < globalPaths.length; i++) {
        pushUnique(globalPaths[i]);
    }
    return lookupPaths;
}

function resolveForRequire(id, options, parentDir, parentFilename, parentLookupPaths) {
    validateRequireRequest(id);
    if (isBuiltin(id)) {
        return id;
    }
    if (id.startsWith('node:')) {
        const err = new Error("Cannot find module '" + id + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    // If paths option is provided, resolve relative to each path
    if (options && options.paths !== undefined) {
        const searchPaths = options.paths;
        if (!Array.isArray(searchPaths)) {
            const argErr = new TypeError("The argument 'paths' must be an array of strings. Received " + typeof searchPaths);
            argErr.code = 'ERR_INVALID_ARG_VALUE';
            throw argErr;
        }
        const isRelative = rustClassifiesPathSpecifier(id);
        if (!isRelative) {
            const lookupPaths = cjsLookupPathsForResolveOptions(searchPaths);
            const resolution = makeCjsResolutionState();
            const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename, undefined, lookupPaths, resolution);
            if (nmResolved) {
                return nmResolved.__wasmPathCacheHit
                    ? nmResolved.filename
                    : toCjsCanonicalFilename(nmResolved.filename, false);
            }
            const err = new Error("Cannot find module '" + id + "'");
            err.code = 'MODULE_NOT_FOUND';
            throw addRequireStackToModuleNotFound(err, id, parentFilename);
        }
        for (let pi = 0; pi < searchPaths.length; pi++) {
            if (typeof searchPaths[pi] !== 'string') {
                const argErr = new TypeError("The argument 'paths[" + pi + "]' must be a string. Received " + typeof searchPaths[pi]);
                argErr.code = 'ERR_INVALID_ARG_VALUE';
                throw argErr;
            }
            const searchDir = pathModule.resolve(searchPaths[pi]);
            const cacheKey = cjsPathCacheKey(id, pathModule.isAbsolute(id) ? [''] : [searchDir]);
            const cached = cjsCachedPathResolution(cjsPathCacheValue(cacheKey));
            if (cached !== null) return cached.filename;
            try {
                const resolved = resolveFilename(id, searchDir);
                const canonical = toCjsCanonicalFilename(resolved.filename, false);
                cjsSetPathCacheValue(cacheKey, canonical);
                return canonical;
            } catch (e) {
                addRequireStackToModuleNotFound(e, id, parentFilename);
                // Try next path
            }
        }
        const err = new Error("Cannot find module '" + id + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw addRequireStackToModuleNotFound(err, id, parentFilename);
    }
    if (rustClassifiesPathSpecifier(id)) {
        const cacheKey = cjsPathCacheKey(id, pathModule.isAbsolute(id) ? [''] : [parentDir]);
        const cached = cjsCachedPathResolution(cjsPathCacheValue(cacheKey));
        if (cached !== null) return cached.filename;
        try {
            const resolved = resolveFilename(id, parentDir);
            const canonical = toCjsCanonicalFilename(resolved.filename, false);
            cjsSetPathCacheValue(cacheKey, canonical);
            return canonical;
        } catch (err) {
            throw addRequireStackToModuleNotFound(err, id, parentFilename);
        }
    }
    if (id.startsWith('#')) {
        const resolution = makeCjsResolutionState();
        const importsResolved = resolveCjsPackageImportOrNodeModules(id, parentDir, parentFilename, parentLookupPaths, resolution);
        if (importsResolved.builtin) return importsResolved.builtin;
        return toCjsCanonicalFilename(importsResolved.filename, false);
    }
    // node_modules resolution for bare specifiers
    const resolution = makeCjsResolutionState();
    const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename, undefined, parentLookupPaths, resolution);
    if (nmResolved) {
        return nmResolved.__wasmPathCacheHit
            ? nmResolved.filename
            : toCjsCanonicalFilename(nmResolved.filename, false);
    }
    const err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
}

function currentRequireMain() {
    return mainModule.filename === '/' ? undefined : mainModule;
}

function makeRequire(parentDir, parentModule, parentFilenameOverride, requireMainOverride, preparedTypeScriptGraph) {
    const parentFilename = parentFilenameOverride || (parentModule && parentModule.filename) || null;
    const parentLookupPaths = parentModule && Array.isArray(parentModule.paths)
        ? parentModule.paths.concat(globalPaths)
        : null;
    function localRequire(id) {
        validateRequireId(id);

        return traceModuleRequire(id, parentFilename, () => {
        // Capture buffer.kMaxLength for zlib on first require (matches Node.js CJS capture-at-require semantics)
        if ((id === 'zlib' || id === 'node:zlib') && zlib._captureKMaxLength) {
            zlib._captureKMaxLength();
        }

        // Check module mock registry
        const mockEntry = _resolveRequireMock(id);
        if (mockEntry) {
            if (mockEntry.cache && mockEntry._cachedCjsReady) {
                return mockEntry._cachedCjsResult;
            }
            const mockResult = _materializeCjsMock(mockEntry);
            if (mockEntry.cache) {
                mockEntry._cachedCjsResult = mockResult;
                mockEntry._cachedCjsReady = true;
            }
            return mockResult;
        }

        // node:-prefixed requires always go to builtins, bypassing cache
        if (id.startsWith('node:')) {
            const builtin = requireBuiltinModule(id);
            if (builtin !== undefined) {
                return builtin;
            }
        }

        // Check require.cache before builtins for non-node: specifiers
        // (allows shadowing builtins via require.cache)
        const cached = currentModuleCache()[id];
        if (cached !== undefined) {
            throwIfRequireEsmGraphCycle(id);
            if (cached.__wasmRequireEsmInProgress) {
                const err = new Error('Cannot require() ES Module ' + id + ' in a cycle.');
                err.code = 'ERR_REQUIRE_CYCLE_MODULE';
                throw err;
            }
            return cached.exports;
        }

        // Builtin modules
        const builtin = requireBuiltinModule(id);
        if (builtin !== undefined) {
            return builtin;
        }

        // Relative or absolute file paths
        if (rustClassifiesPathSpecifier(id)) {
            const cacheKey = cjsPathCacheKey(id, pathModule.isAbsolute(id) ? [''] : [parentDir]);
            const cached = cjsCachedPathResolution(cjsPathCacheValue(cacheKey));
            if (cached !== null) {
                const mod = loadFilesystemCommonJs(cached.filename, parentModule || null, preparedTypeScriptGraph);
                return mod.exports;
            }
            let resolved;
            try {
                resolved = resolveFilename(id, parentDir);
            } catch (err) {
                throw addRequireStackToModuleNotFound(err, id, parentFilename);
            }
            cjsSetPathCacheResolvedFilename(cacheKey, resolved.filename);
            const mod = loadFilesystemCommonJs(resolved.filename, parentModule || null, preparedTypeScriptGraph);
            return mod.exports;
        }

        if (id.startsWith('#')) {
            const resolution = makeCjsResolutionState();
            const importsResolved = resolveCjsPackageImportOrNodeModules(id, parentDir, parentFilename, parentLookupPaths, resolution);
            if (importsResolved.builtin) return requireBuiltinModule(importsResolved.builtin);
            const mod = loadFilesystemCommonJs(importsResolved.filename, parentModule || null, preparedTypeScriptGraph);
            return mod.exports;
        }

        // node_modules resolution for bare specifiers
        const resolution = makeCjsResolutionState();
        const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename, undefined, parentLookupPaths, resolution);
        if (nmResolved) {
            const mod = loadFilesystemCommonJs(nmResolved.filename, parentModule || null, preparedTypeScriptGraph);
            return mod.exports;
        }

        const err = new Error("Cannot find module '" + id + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
        });
    }

    localRequire.cache = currentModuleCache();
    localRequire.extensions = requireExtensions;

    localRequire.resolve = function resolve(id, options) {
        return resolveForRequire(id, options, parentDir, parentFilename, parentLookupPaths);
    };

    localRequire.resolve.paths = function paths(request) {
        validateRequireRequest(request);
        if (isBuiltin(request)) {
            return null;
        }
        return _resolveLookupPaths(request, parentModule);
    };

    Object.defineProperty(localRequire, 'main', {
        value: arguments.length >= 4 ? requireMainOverride : mainModule,
        writable: true,
        configurable: true,
        enumerable: true,
    });

    return localRequire;
}

// The global require, rooted at '/'
const globalRequire = makeRequire('/', mainModule);

export let require = globalRequire;

export let createRequire = function createRequire(filename) {
    let filepath;
    const isUrlObj = filename instanceof URL ||
        (filename !== null && typeof filename === 'object' &&
         typeof filename.href === 'string' && typeof filename.protocol === 'string');

    if (isUrlObj || (typeof filename === 'string' && !pathModule.isAbsolute(filename))) {
        try {
            filepath = nodeUrl.fileURLToPath(filename);
        } catch (e) {
            const inspected = typeof filename === 'string' ? "'" + filename + "'" :
                (typeof util.inspect === 'function' ? util.inspect(filename) : String(filename));
            const err = new TypeError(
                "The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received " + inspected
            );
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
    } else if (typeof filename !== 'string') {
        const inspected2 = typeof util.inspect === 'function' ? util.inspect(filename) : String(filename);
        const err2 = new TypeError(
            "The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received " + inspected2
        );
        err2.code = 'ERR_INVALID_ARG_VALUE';
        throw err2;
    } else {
        filepath = filename;
    }
    const dir = pathModule.dirname(filepath);
    const syntheticParent = {
        id: filepath,
        filename: filepath,
        path: dir,
        exports: {},
        loaded: true,
        parent: null,
        children: [],
        paths: _nodeModulePaths(dir),
    };
    return makeRequire(dir, syntheticParent, filepath, currentRequireMain());
};

Object.defineProperty(globalThis, '__wasm_rquickjs_create_require', {
    value: createRequire,
    writable: false,
    configurable: false,
});

function isUrlInstance(value) {
    return value instanceof URL ||
        (value !== null && typeof value === 'object' &&
            typeof value.href === 'string' && typeof value.protocol === 'string');
}

function normalizeFindPackageJsonSpecifier(specifier) {
    if (specifier === undefined) {
        throw new ERR_MISSING_ARGS('specifier');
    }

    if (isUrlInstance(specifier)) {
        const filePath = nodeUrl.fileURLToPath(specifier);
        return {
            kind: 'absolute',
            path: filePath,
            source: filePath,
        };
    }

    if (typeof specifier !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('specifier', ['string', 'URL'], specifier);
    }

    if (specifier.startsWith('file://')) {
        const filePath = nodeUrl.fileURLToPath(specifier);
        return {
            kind: 'absolute',
            path: filePath,
            source: specifier,
        };
    }

    if (pathModule.isAbsolute(specifier)) {
        return {
            kind: 'absolute',
            path: pathModule.normalize(specifier),
            source: specifier,
        };
    }

    if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
        return {
            kind: 'relative',
            value: specifier,
        };
    }

    return {
        kind: 'bare',
        value: specifier,
    };
}

function normalizeFindPackageJsonBase(base, baseRequired) {
    if (base === undefined) {
        if (baseRequired) {
            throw new ERR_INVALID_ARG_TYPE('base', ['string', 'URL'], base);
        }
        return null;
    }

    if (isUrlInstance(base) || (typeof base === 'string' && base.startsWith('file://'))) {
        const filename = nodeUrl.fileURLToPath(base);
        return {
            filename,
            dir: pathModule.dirname(pathModule.resolve(filename)),
        };
    }

    if (typeof base !== 'string') {
        throw new ERR_INVALID_ARG_TYPE('base', ['string', 'URL'], base);
    }

    if (!pathModule.isAbsolute(base)) {
        throw new ERR_INVALID_ARG_TYPE('base', ['string', 'URL'], base);
    }

    const filename = pathModule.resolve(base);
    return {
        filename,
        dir: pathModule.dirname(filename),
    };
}

function findNearestPackageJsonPath(startDir) {
    let dir = pathModule.resolve(startDir || '/');
    while (true) {
        if (pathModule.basename(dir) === 'node_modules') return undefined;
        const pkgJsonPath = pathModule.join(dir, 'package.json');
        if (tryReadFile(pkgJsonPath) !== null) {
            return pathModule.toNamespacedPath(pkgJsonPath);
        }
        const parent = pathModule.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

function packageSearchStartDir(resolvedPath, sourceSpecifier) {
    if (typeof sourceSpecifier === 'string' &&
        (/\/$/.test(sourceSpecifier) || /(?:^|\/)\.\.?$/.test(sourceSpecifier))) {
        return pathModule.resolve(resolvedPath);
    }

    if (_stat(resolvedPath) === 1) {
        return pathModule.resolve(resolvedPath);
    }

    return pathModule.dirname(pathModule.resolve(resolvedPath));
}

function findBarePackageJson(specifier, parentDir, parentFilename) {
    const resolved = resolveFromNodeModules(
        specifier,
        parentDir,
        parentFilename,
        cjsPackageConditions(),
        undefined,
        makeCjsResolutionState(),
    );
    if (resolved === null) return undefined;

    if (typeof resolved.packageDir === 'string' && resolved.packageDir.length > 0) {
        const pkgJsonPath = pathModule.join(resolved.packageDir, 'package.json');
        if (tryReadFile(pkgJsonPath) !== null) {
            return pathModule.toNamespacedPath(pkgJsonPath);
        }
    }

    return undefined;
}

export let findPackageJSON = function findPackageJSON(specifier, base) {
    const normalizedSpecifier = normalizeFindPackageJsonSpecifier(specifier);
    if (normalizedSpecifier.kind === 'absolute') {
        const startDir = packageSearchStartDir(normalizedSpecifier.path, normalizedSpecifier.source);
        return findNearestPackageJsonPath(startDir);
    }

    const normalizedBase = normalizeFindPackageJsonBase(base, true);
    if (normalizedSpecifier.kind === 'relative') {
        const resolvedPath = pathModule.resolve(normalizedBase.dir, normalizedSpecifier.value);
        const startDir = packageSearchStartDir(resolvedPath, normalizedSpecifier.value);
        return findNearestPackageJsonPath(startDir);
    }

    return findBarePackageJson(normalizedSpecifier.value, normalizedBase.dir, normalizedBase.filename);
};

export let builtinModules = builtinModuleNames;

export let isBuiltinModule = function isBuiltinModule(id) {
    return isBuiltin(id);
};

export let register = function register(specifier, parentURL, options) {
    const url = String(specifier);
    let parent = parentURL;
    let data;
    if (parentURL && typeof parentURL === 'object' && !isUrlInstance(parentURL)) {
        parent = parentURL.parentURL;
        data = parentURL.data;
    } else if (options && typeof options === 'object') {
        data = options.data;
    }
    parent = parent === undefined ? undefined : String(parent);
    const loaders = globalThis.__wasm_rquickjs_registered_loaders ||
        (globalThis.__wasm_rquickjs_registered_loaders = []);
    const realm = globalThis.__wasm_rquickjs_registered_loader_realm_counter =
        (globalThis.__wasm_rquickjs_registered_loader_realm_counter || 0) + 1;
    const loader = { url, parent, data, realm, module: undefined, initialized: false, initializing: undefined };
    loaders.push(loader);
    globalThis.__wasm_rquickjs_registered_loader_generation =
        (globalThis.__wasm_rquickjs_registered_loader_generation || 0) + 1;
    globalThis.__wasm_rquickjs_static_registered_loader_cache = Object.create(null);
    globalThis.__wasm_rquickjs_sync_registered_loader_cache = Object.create(null);
    if (typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_start_registered_loader === 'function') {
        wasmRquickjsModuleGlobalThis.__wasm_rquickjs_start_registered_loader(loader);
    }
};

if (typeof globalThis.__wasm_rquickjs_run_registered_loaders !== 'function') {
    function normalizeLoaderResolvedUrl(url) {
        if (url.startsWith('/')) {
            const query = url.indexOf('?');
            const hash = url.indexOf('#');
            const end = query < 0 ? hash : (hash < 0 ? query : Math.min(query, hash));
            if (end >= 0) {
                url = nodeUrl.pathToFileURL(url.slice(0, end)).href + url.slice(end);
            } else {
                url = nodeUrl.pathToFileURL(url).href;
            }
        }
        return url;
    }

    function resolveRegisteredLoaderUrl(loader) {
        const url = loader.parent !== undefined
            ? normalizeLoaderResolvedUrl(wasmRquickjsModuleGlobalThis.__wasm_rquickjs_import_meta_resolve(loader.parent, loader.url))
            : loader.url;
        return loaderRealmUrl(url, loader.realm);
    }

    function loaderRealmUrl(url, realm) {
        if (!url.startsWith('file://')) return url;
        const hashIndex = url.indexOf('#');
        const beforeHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
        const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
        const separator = beforeHash.includes('?') ? '&' : '?';
        return beforeHash + separator + '__wasm_rquickjs_loader_realm=' + encodeURIComponent(String(realm)) + hash;
    }

    function startRegisteredLoader(loader) {
        if (loader.initialized || loader.initializing) return loader.initializing;
        loader.initializing = (async () => {
            const module = await import(resolveRegisteredLoaderUrl(loader));
            loader.module = module;
            if (typeof module.initialize === 'function') {
                await module.initialize(loader.data);
            }
            loader.initialized = true;
        })();
        loader.initializing.catch(() => {});
        return loader.initializing;
    }
    Object.defineProperty(globalThis, '__wasm_rquickjs_start_registered_loader', {
        value: startRegisteredLoader,
        writable: false,
        configurable: false,
    });

    function normalizeRegisteredLoaderResolvedResult(resolved) {
        if (!resolved || typeof resolved !== 'object' || resolved.url === undefined) return undefined;
        return {
            url: normalizeLoaderResolvedUrl(String(resolved.url)),
            format: loaderFormatOrUndefined(resolved.format),
        };
    }

    function validateRegisteredLoaderResolveResult(hookResult, context, loaderUrl) {
        const result = validateRegisteredLoaderResult(hookResult, 'resolve', context);
        validateRegisteredLoaderResolveUrl(result.url, loaderUrl);
        return result;
    }

    function registeredLoaderLoadContext(baseContext, resolved, resolvedFormat) {
        return {
            conditions: baseContext.conditions,
            importAttributes: resolved.importAttributes && typeof resolved.importAttributes === 'object'
                ? resolved.importAttributes
                : baseContext.importAttributes,
            format: resolvedFormat,
        };
    }

    function registeredLoaderBaseContext(conditions, importAttributes, parentURL) {
        return {
            conditions,
            importAttributes,
            parentURL: String(parentURL),
        };
    }

    function registeredLoaderResolvedState(baseContext, resolved) {
        const normalizedResolved = normalizeRegisteredLoaderResolvedResult(resolved);
        if (!normalizedResolved) return undefined;
        const resolvedFormat = normalizedResolved.format;
        return {
            normalizedResolved,
            resolvedFormat,
            loadContext: registeredLoaderLoadContext(baseContext, resolved, resolvedFormat),
        };
    }

    function registeredLoaderDefaultLoad(_nextUrl, context) {
        return { format: context && context.format };
    }

    function registeredLoaderFinalLoadFormat(loaded, fallbackFormat) {
        return loaded && loaded.format !== undefined && loaded.format !== null
            ? validateRegisteredLoaderLoadFormat(loaded.format)
            : validateRegisteredLoaderLoadFormat(fallbackFormat);
    }

    function validateRegisteredLoaderLoadResultFormat(result) {
        if (result.format !== undefined && result.format !== null && result.format !== '') {
            validateRegisteredLoaderLoadFormat(result.format);
        }
    }

    function validateRegisteredLoaderLoadResult(hookResult, context) {
        const result = validateRegisteredLoaderResult(hookResult, 'load', context);
        validateRegisteredLoaderLoadResultFormat(result);
        return result;
    }

    function registeredLoaderResolveResult(hookResult, context, loaderUrl, nextCalled, allowUndefinedFromNext) {
        if (allowUndefinedFromNext && hookResult === undefined) {
            if (!nextCalled()) throw makeLoaderChainError('resolve');
            return undefined;
        }
        const result = validateRegisteredLoaderResolveResult(hookResult, context, loaderUrl);
        assertRegisteredLoaderChainComplete('resolve', result, nextCalled());
        return result;
    }

    function registeredLoaderLoadResult(hookResult, context, nextCalled) {
        const result = validateRegisteredLoaderLoadResult(hookResult, context);
        assertRegisteredLoaderChainComplete('load', result, nextCalled());
        return result;
    }

    function registeredLoaderNextContext(context, contextForNext) {
        return contextForNext === undefined ? context : Object.assign({}, context, contextForNext);
    }

    function registeredLoaderNextSpecifier(currentSpecifier, specifierForNext) {
        return specifierForNext === undefined ? currentSpecifier : specifierForNext;
    }

    function registeredLoaderNextUrl(currentUrl, urlForNext) {
        return urlForNext === undefined ? currentUrl : String(urlForNext);
    }

    function registeredLoaderResolveInputs(nextSpecifier, context, fallbackParentURL) {
        return {
            specifier: String(nextSpecifier),
            parentURL: context && context.parentURL ? String(context.parentURL) : fallbackParentURL,
        };
    }

    function registeredLoaderHookEntry(loader) {
        return loader.module ? { module: loader.module, url: loader.url } : undefined;
    }

    function assertRegisteredLoaderChainComplete(hookName, result, nextCalled) {
        if (!nextCalled && (!result || result.shortCircuit !== true)) {
            throw makeLoaderChainError(hookName);
        }
    }

    function normalizedRegisteredLoaderResult(resolvedState, resolved, loaded) {
        if (!resolvedState) return undefined;
        const result = {
            url: resolvedState.normalizedResolved.url,
            format: registeredLoaderFinalLoadFormat(loaded, resolvedState.resolvedFormat),
            shortCircuit: !!(
                (resolved && resolved.shortCircuit === true) ||
                (loaded && loaded.shortCircuit === true)
            ),
        };
        if (registeredLoaderHasSource(loaded)) result.source = loaded.source;
        return Object.freeze(result);
    }

    function normalizedRegisteredLoaderCacheResult(result, value, error) {
        const cached = {
            url: result && result.url,
            format: result && result.format,
            shortCircuit: !!(result && result.shortCircuit),
            value,
        };
        if (registeredLoaderHasSource(result)) cached.source = result.source;
        if (error !== undefined) cached.error = error;
        return Object.freeze(cached);
    }

    function registeredLoaderFileSourceFallback(url) {
        url = String(url);
        return url.startsWith('file://') ? loaderFileUrlSource(url) : undefined;
    }

    function registeredLoaderModuleSourceReturn(source, url) {
        return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_loader_source_url(
            'data:text/javascript,' + encodeURIComponent(loaderSourceToString(source)),
            String(url),
        );
    }

    function registeredLoaderJsonSourceReturn(source, url) {
        const registered = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_loader_source_url(
            'data:application/json,' + encodeURIComponent(loaderSourceToString(source)),
            String(url),
        );
        return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_import_attr_rewrite(
            registered,
            'json',
        );
    }

    function registeredLoaderCommonJsReturn(loaded, url, missingSourceReturn) {
        if (registeredLoaderHasSource(loaded)) {
            return loaderCommonJsSourceModule(loaded.source, url);
        }
        return String(url).startsWith('file://')
            ? registeredLoaderPathOrUrlReturn(url, true)
            : missingSourceReturn;
    }

    function resolveEsmDefaultForLoader(specifier, parentURL, context, baseUrl, missingAsUndefined, allowRootedWithoutFileParent) {
        if (specifier.startsWith('data:')) {
            return registeredLoaderUrlResult(specifier);
        }
        const builtin = registeredLoaderBuiltinResolve(specifier, false);
        if (builtin) return builtin;
        if (specifier.startsWith('file://')) {
            return resultForEsmFileUrl(new URL(specifier));
        }
        const parentFilename = parentFilenameForLoaderResolve(parentURL, baseUrl);
        if (specifier.startsWith('/')) {
            if (parentFilename === null && !allowRootedWithoutFileParent) {
                if (missingAsUndefined) return undefined;
                throw makeEsmModuleNotFoundError(specifier);
            }
            return resultForEsmFileUrl(new URL(normalizeLoaderResolvedUrl(specifier)));
        }

        if (parentFilename !== null && rustClassifiesPathSpecifier(specifier)) {
            return resultForRelativeOrAbsoluteSpecifier(specifier, parentURL);
        }

        if (parentFilename !== null) {
            const packageResolved = resolveEsmPackageDefaultForLoader(specifier, parentURL, context);
            if (packageResolved) return packageResolved;
            if (missingAsUndefined) return undefined;
            throw makeEsmModuleNotFoundError(specifier);
        }
        if (missingAsUndefined) return undefined;

        let url = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_import_meta_resolve(parentURL, specifier);
        return registeredLoaderUrlResult(normalizeLoaderResolvedUrl(url));
    }

    async function runRegisteredLoaders(baseUrl, specifier, attrs, mode) {
        const loaders = globalThis.__wasm_rquickjs_registered_loaders;
        if (!loaders || loaders.length === 0) return undefined;

        const entries = [];
        for (let i = 0; i < loaders.length; i++) {
            const loader = loaders[i];
            try {
                await wasmRquickjsModuleGlobalThis.__wasm_rquickjs_start_registered_loader(loader);
            } catch (e) {
                loader.initializing = undefined;
                throw e;
            }
            const entry = registeredLoaderHookEntry(loader);
            if (entry) entries.push(entry);
        }

        const importAttributes = attrs && attrs.typeValue !== undefined
            ? { type: attrs.typeValue }
            : {};

        const baseContext = registeredLoaderBaseContext(loaderHookConditions(), importAttributes, baseUrl);

        const defaultResolve = async (nextSpecifier, context) => {
            const inputs = registeredLoaderResolveInputs(nextSpecifier, context, String(baseUrl));
            return resolveEsmDefaultForLoader(inputs.specifier, inputs.parentURL, context, baseUrl, false, true);
        };

        const runResolve = async (index, nextSpecifier, context) => {
            if (index < 0) return defaultResolve(nextSpecifier, context);
            const entry = entries[index];
            const module = entry.module;
            if (typeof module.resolve === 'function') {
                let nextCalled = false;
                const nextResolve = async (specifierForNext, contextForNext) => {
                    nextCalled = true;
                    return runResolve(
                        index - 1,
                        registeredLoaderNextSpecifier(nextSpecifier, specifierForNext),
                        registeredLoaderNextContext(context, contextForNext),
                    );
                };
                return registeredLoaderResolveResult(await module.resolve(nextSpecifier, context, nextResolve), context, entry.url, () => nextCalled, false);
            }
            return runResolve(index - 1, nextSpecifier, context);
        };

        const resolved = await runResolve(entries.length - 1, specifier, baseContext);
        const resolvedState = registeredLoaderResolvedState(baseContext, resolved);
        if (!resolvedState) return undefined;
        const normalizedResolved = resolvedState.normalizedResolved;

        const runLoad = async (index, nextUrl, context) => {
            if (index < 0) return registeredLoaderDefaultLoad(nextUrl, context);
            const module = entries[index].module;
            if (typeof module.load === 'function') {
                let nextCalled = false;
                const nextLoad = async (urlForNext, contextForNext) => {
                    nextCalled = true;
                    return runLoad(
                        index - 1,
                        registeredLoaderNextUrl(nextUrl, urlForNext),
                        registeredLoaderNextContext(context, contextForNext),
                    );
                };
                return registeredLoaderLoadResult(await module.load(nextUrl, context, nextLoad), context, () => nextCalled);
            }
            return runLoad(index - 1, nextUrl, context);
        };

        const loaded = await runLoad(entries.length - 1, normalizedResolved.url, resolvedState.loadContext);
        const result = normalizedRegisteredLoaderResult(resolvedState, resolved, loaded);
        const loadedHasSource = registeredLoaderHasSource(result);
        const loadedFormat = result.format;
        if (mode === 'static-raw') {
            return result;
        }

        if (loadedHasSource && loadedFormat === 'module') {
            return registeredLoaderModuleSourceReturn(result.source, normalizedResolved.url);
        }
        if (!loadedHasSource && loadedFormat === 'module') {
            if (String(normalizedResolved.url).startsWith('file://')) {
                try {
                    if (nodeUrl.fileURLToPath(normalizedResolved.url).endsWith('.mjs')) return normalizedResolved.url;
                } catch (_) {}
            }
            const fileSource = registeredLoaderFileSourceFallback(normalizedResolved.url);
            if (fileSource !== null && fileSource !== undefined) {
                return registeredLoaderModuleSourceReturn(fileSource, normalizedResolved.url);
            }
        }
        if (loadedFormat === 'commonjs') {
            return registeredLoaderCommonJsReturn(result, normalizedResolved.url, undefined);
        }
        if (loadedHasSource && loadedFormat === 'json') {
            return registeredLoaderJsonSourceReturn(result.source, normalizedResolved.url);
        }
        if (resolvedState.loadContext.importAttributes && resolvedState.loadContext.importAttributes.type === 'json') {
            return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_import_attr_rewrite(normalizedResolved.url, 'json');
        }
        return undefined;
    }
    Object.defineProperty(globalThis, '__wasm_rquickjs_run_registered_loaders', {
        value: runRegisteredLoaders,
        writable: false,
        configurable: false,
    });

    function isLoaderThenable(value) {
        return value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
    }

    function assertSyncLoaderResult(value, hookName, operation) {
        if (isLoaderThenable(value)) {
            const err = new Error('Async registered loader ' + hookName + ' hooks are not supported from ' + (operation || 'CommonJS require()'));
            err.code = 'ERR_REQUIRE_ASYNC_MODULE';
            throw err;
        }
        return value;
    }

    function runRegisteredLoadersSync(baseUrl, specifier, resolveOnly, mode) {
        const loaders = globalThis.__wasm_rquickjs_registered_loaders;
        if (!loaders || loaders.length === 0) return undefined;
        const isImportMode = mode === 'import';
        const useLoadCache = !resolveOnly && !isImportMode;
        const loadCacheKey = useLoadCache
            ? String(globalThis.__wasm_rquickjs_registered_loader_generation || 0) +
                '\0' + String(baseUrl || fileUrlForPath('/')) + '\0' + String(specifier)
            : undefined;
        const loadCache = useLoadCache
            ? (globalThis.__wasm_rquickjs_sync_registered_loader_cache ||
                (globalThis.__wasm_rquickjs_sync_registered_loader_cache = Object.create(null)))
            : undefined;
        if (loadCache && Object.prototype.hasOwnProperty.call(loadCache, loadCacheKey)) {
            return loadCache[loadCacheKey];
        }
        const entries = [];
        for (let i = 0; i < loaders.length; i++) {
            const loader = loaders[i];
            if (!loader.initialized) {
                if (isImportMode) {
                    continue;
                }
                if (loader.initializing) {
                    const err = new Error('Registered loader initialization has not completed');
                    err.code = 'ERR_REQUIRE_ASYNC_MODULE';
                    throw err;
                }
                continue;
            }
            const entry = registeredLoaderHookEntry(loader);
            if (entry) entries.push(entry);
        }
        if (entries.length === 0) return undefined;

        const baseContext = registeredLoaderBaseContext(
            isImportMode ? loaderHookConditions() : cjsPackageConditions(),
            {},
            baseUrl || fileUrlForPath('/'),
        );

        const defaultResolve = (nextSpecifier, context) => {
            const inputs = registeredLoaderResolveInputs(nextSpecifier, context, baseContext.parentURL);
            const builtin = registeredLoaderBuiltinResolve(inputs.specifier, !isImportMode);
            if (builtin) return builtin;
            if (isImportMode) {
                return resolveEsmDefaultForLoader(inputs.specifier, inputs.parentURL, context, baseContext.parentURL, true, false);
            }
            return resolveCjsDefaultForLoader(inputs.specifier, inputs.parentURL, context);
        };

        const runResolve = (index, nextSpecifier, context) => {
            if (index < 0) return defaultResolve(nextSpecifier, context);
            const entry = entries[index];
            const module = entry.module;
            if (typeof module.resolve === 'function') {
                let nextCalled = false;
                const nextResolve = (specifierForNext, contextForNext) => {
                    nextCalled = true;
                    return runResolve(
                        index - 1,
                        registeredLoaderNextSpecifier(nextSpecifier, specifierForNext),
                        registeredLoaderNextContext(context, contextForNext),
                    );
                };
                const hookResult = assertSyncLoaderResult(module.resolve(nextSpecifier, context, nextResolve), 'resolve', isImportMode ? 'static ES module resolution' : undefined);
                return registeredLoaderResolveResult(hookResult, context, entry.url, () => nextCalled, true);
            }
            return runResolve(index - 1, nextSpecifier, context);
        };

        const initialSpecifier = isImportMode && typeof specifier === 'string'
            ? normalizeLoaderResolvedUrl(specifier)
            : specifier;
        const resolved = runResolve(entries.length - 1, initialSpecifier, baseContext);
        const resolvedState = registeredLoaderResolvedState(baseContext, resolved);
        if (!resolvedState) return undefined;
        const normalizedResolved = resolvedState.normalizedResolved;
        const resolvedFormat = resolvedState.resolvedFormat;
        if (resolveOnly) return registeredLoaderUrlFormatResult(normalizedResolved.url, resolvedFormat);

        const runLoad = (index, nextUrl, context) => {
            if (index < 0) return registeredLoaderDefaultLoad(nextUrl, context);
            const module = entries[index].module;
            if (typeof module.load === 'function') {
                let nextCalled = false;
                const nextLoad = (urlForNext, contextForNext) => {
                    nextCalled = true;
                    return runLoad(
                        index - 1,
                        registeredLoaderNextUrl(nextUrl, urlForNext),
                        registeredLoaderNextContext(context, contextForNext),
                    );
                };
                return registeredLoaderLoadResult(
                    assertSyncLoaderResult(module.load(nextUrl, context, nextLoad), 'load', isImportMode ? 'static ES module resolution' : undefined),
                    context,
                    () => nextCalled,
                );
            }
            return runLoad(index - 1, nextUrl, context);
        };

        const loaded = runLoad(entries.length - 1, normalizedResolved.url, resolvedState.loadContext);
        const result = normalizedRegisteredLoaderResult(resolvedState, resolved, loaded);
        if (loadCache) loadCache[loadCacheKey] = result;
        return result;
    }
    Object.defineProperty(globalThis, '__wasm_rquickjs_run_registered_loaders_sync', {
        value: runRegisteredLoadersSync,
        writable: false,
        configurable: false,
    });

    function staticRegisteredLoaderCacheParts(specifier, attrs) {
        let value = String(specifier);
        let typeValue = attrs && attrs.typeValue !== undefined ? String(attrs.typeValue) : '';
        if (typeValue === '') {
            let match = /^data:([^,]*);__wasm_rquickjs_import_type=([^;,]+)(,.*)$/.exec(value);
            if (match) {
                value = 'data:' + match[1] + match[3];
                typeValue = match[2].split('-')[0];
            } else {
                match = /([?#&])__wasm_rquickjs_import_type=([^&#]+)(&?)/.exec(value);
                if (match) {
                    const tokenStart = match.index;
                    const tokenEnd = tokenStart + match[0].length;
                    const prefix = value.slice(0, tokenStart);
                    const suffix = value.slice(tokenEnd);
                    const separator = match[1];
                    if (separator === '&') {
                        value = prefix + (suffix ? '&' + suffix : '');
                    } else if (match[3] === '&') {
                        value = prefix + separator + suffix;
                    } else {
                        value = prefix + suffix;
                    }
                    if (value.endsWith('?') || value.endsWith('#')) value = value.slice(0, -1);
                    typeValue = match[2].split('-')[0];
                }
            }
        }
        return { specifier: value, typeValue };
    }

    function staticRegisteredLoaderCacheKey(baseUrl, specifier, attrs) {
        const parts = staticRegisteredLoaderCacheParts(specifier, attrs);
        const generation = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_registered_loader_generation || 0;
        const importAttributes = parts.typeValue === ''
            ? '{}'
            : JSON.stringify({ type: parts.typeValue });
        return String(generation) + '\0' + String(baseUrl) + '\0' + parts.specifier + '\0' + importAttributes + '\0';
    }

    function staticRegisteredLoaderPathReturn(url) {
        return registeredLoaderPathOrUrlReturn(url, true);
    }

    function staticRegisteredLoaderReturn(loaded) {
        if (!loaded || !loaded.url) return undefined;
        const url = String(loaded.url);
        const format = loaderFormatOrUndefined(loaded.format);
        const hasSource = registeredLoaderHasSource(loaded);
        if (hasSource && (format === undefined || format === 'module')) {
            return registeredLoaderModuleSourceReturn(loaded.source, url);
        }
        if (!hasSource && format === 'module') {
            return staticRegisteredLoaderPathReturn(url);
        }
        if (format === 'commonjs') {
            return registeredLoaderCommonJsReturn(loaded, url, staticRegisteredLoaderPathReturn(url));
        }
        if (hasSource && format === 'json') {
            return registeredLoaderJsonSourceReturn(loaded.source, url);
        }
        return staticRegisteredLoaderPathReturn(url);
    }

    function staticRegisteredLoaderReturnForEdge(loaded, attrs) {
        if (
            attrs &&
            attrs.typeValue === 'json' &&
            loaded &&
            loaded.format === 'json' &&
            !registeredLoaderHasOwnSource(loaded) &&
            loaded.url &&
            typeof wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_import_attr_rewrite === 'function'
        ) {
            const url = String(loaded.url);
            const target = staticRegisteredLoaderPathReturn(url);
            return wasmRquickjsModuleGlobalThis.__wasm_rquickjs_register_import_attr_rewrite(target, 'json');
        }
        return staticRegisteredLoaderReturn(loaded);
    }

    function staticRegisteredLoaderSourceForUrl(url) {
        url = String(url);
        if (url.startsWith('file://')) {
            return loaderFileUrlSource(url);
        }
        if (url.startsWith('/')) {
            return tryReadFile(url);
        }
        if (url.startsWith('data:')) {
            const comma = url.indexOf(',');
            if (comma < 0) return null;
            const meta = url.slice(5, comma).toLowerCase();
            if (meta.indexOf('text/javascript') < 0 && meta.indexOf('application/javascript') < 0) {
                return null;
            }
            const body = url.slice(comma + 1);
            try {
                return meta.indexOf(';base64') >= 0 ? atob(body) : decodeURIComponent(body);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    function staticRegisteredLoaderChildUrl(loaded, fallback) {
        fallback = String(fallback);
        if (fallback.startsWith('data:')) return fallback;
        if (loaded && loaded.url) return String(loaded.url);
        return normalizeLoaderResolvedUrl(fallback);
    }

    function staticRegisteredLoaderParentAliases(parentUrl) {
        const aliases = [parentUrl];
        const virtualPrefix = 'file:///__wasm_rquickjs_virtual__/';
        if (parentUrl.startsWith(virtualPrefix) && parentUrl.endsWith('.mjs')) {
            aliases.push('file:///' + parentUrl.slice(virtualPrefix.length, -4));
        }
        return aliases;
    }

    function staticRegisteredLoaderCacheEntry(parentUrl, specifier, attrs, edgeReturn) {
        const key = staticRegisteredLoaderCacheKey(parentUrl, specifier, attrs);
        const cache = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_static_registered_loader_cache;
        if (Object.prototype.hasOwnProperty.call(cache, key)) {
            return { cached: cache[key], created: false };
        }
        return (async () => {
            try {
                const loaded = await wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders(parentUrl, specifier, attrs, 'static-raw');
                const value = edgeReturn
                    ? staticRegisteredLoaderReturnForEdge(loaded, attrs)
                    : staticRegisteredLoaderReturn(loaded);
                cache[key] = normalizedRegisteredLoaderCacheResult(loaded, value, undefined);
            } catch (error) {
                cache[key] = normalizedRegisteredLoaderCacheResult(undefined, undefined, error);
            }
            return { cached: cache[key], created: true };
        })();
    }

    async function prepareStaticRegisteredLoaderGraph(parentUrl, seen) {
        parentUrl = normalizeLoaderResolvedUrl(String(parentUrl));
        seen = seen || Object.create(null);
        if (seen[parentUrl]) return;
        seen[parentUrl] = true;

        const source = staticRegisteredLoaderSourceForUrl(parentUrl);
        if (source === null) return;
        const edges = rustModuleSourceAnalysis(source).staticEdges;
        for (let i = 0; i < edges.length; i++) {
            const specifier = edges[i].specifier;
            const attrs = edges[i].attrs;
            let cacheEntry = staticRegisteredLoaderCacheEntry(parentUrl, specifier, attrs, true);
            if (isLoaderThenable(cacheEntry)) cacheEntry = await cacheEntry;
            const { cached } = cacheEntry;
            if (cached && cached.error) continue;
            if (cached && !cached.error && cached.value !== undefined) {
                await prepareStaticRegisteredLoaderGraph(
                    staticRegisteredLoaderChildUrl(cached, cached.value),
                    seen,
                );
            }
        }
    }

    async function prepareStaticRegisteredLoaderEntry(entryUrl, entrySpecifier, entryParentUrl, entryAttrs) {
        if (!wasmRquickjsModuleGlobalThis.__wasm_rquickjs_static_registered_loader_cache) {
            wasmRquickjsModuleGlobalThis.__wasm_rquickjs_static_registered_loader_cache = Object.create(null);
        }
        if (entrySpecifier !== undefined && entryParentUrl !== undefined) {
            const parentUrl = normalizeLoaderResolvedUrl(String(entryParentUrl));
            const specifier = String(entrySpecifier);
            let cacheEntry = staticRegisteredLoaderCacheEntry(parentUrl, specifier, entryAttrs, false);
            if (isLoaderThenable(cacheEntry)) cacheEntry = await cacheEntry;
            const { cached, created } = cacheEntry;
            if (created && cached && cached.error) return;
            const aliases = staticRegisteredLoaderParentAliases(parentUrl);
            for (let i = 1; i < aliases.length; i++) {
                wasmRquickjsModuleGlobalThis.__wasm_rquickjs_static_registered_loader_cache[
                    staticRegisteredLoaderCacheKey(aliases[i], specifier, entryAttrs)
                ] = cached;
            }
        }
        await prepareStaticRegisteredLoaderGraph(entryUrl, Object.create(null));
    }
    Object.defineProperty(globalThis, '__wasm_rquickjs_prepare_static_registered_loader_graph', {
        value: prepareStaticRegisteredLoaderEntry,
        writable: false,
        configurable: false,
    });

    function resolveStaticRegisteredLoader(baseUrl, specifier) {
        const cache = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_static_registered_loader_cache;
        const key = staticRegisteredLoaderCacheKey(baseUrl, specifier);
        if (cache && Object.prototype.hasOwnProperty.call(cache, key)) {
            const cached = cache[key];
            if (cached.error) throw cached.error;
            return cached.value;
        }
        const loaded = wasmRquickjsModuleGlobalThis.__wasm_rquickjs_run_registered_loaders_sync(baseUrl, specifier, false, 'import');
        return staticRegisteredLoaderReturn(loaded);
    }
    Object.defineProperty(globalThis, '__wasm_rquickjs_resolve_static_registered_loader', {
        value: resolveStaticRegisteredLoader,
        writable: false,
        configurable: false,
    });
}

// "node_modules" reversed as char codes: s-e-l-u-d-o-m-_-e-d-o-n
const nmChars = [115, 101, 108, 117, 100, 111, 109, 95, 101, 100, 111, 110];
const nmLen = nmChars.length;

function _nodeModulePaths(from) {
    from = pathModule.resolve(from);

    if (from === '/') {
        return ['/node_modules'];
    }

    const paths = [];
    for (let i = from.length - 1, p = 0, last = from.length; i >= 0; --i) {
        const code = from.charCodeAt(i);
        if (code === 47) { // '/'
            if (p !== nmLen) {
                paths.push(from.slice(0, last) + '/node_modules');
            }
            last = i;
            p = 0;
        } else if (p !== -1) {
            if (nmChars[p] === code) {
                ++p;
            } else {
                p = -1;
            }
        }
    }

    paths.push('/node_modules');

    return paths;
}

function _resolveLookupPaths(request, parent) {
    if (isBuiltinModule(request)) {
        return null;
    }

    // Check if request is a relative path (starts with ./ or ../)
    // On non-Windows, .\ is NOT a relative path separator
    let isRelative = false;
    if (request.length > 0 && request.charAt(0) === '.') {
        if (request.length === 1) {
            isRelative = true;
        } else {
            const second = request.charAt(1);
            if (second === '/' || second === '.') {
                isRelative = true;
            }
        }
    }

    if (!isRelative) {
        let paths;
        if (parent && parent.paths && parent.paths.length) {
            paths = parent.paths.concat(globalPaths);
        } else {
            paths = globalPaths.slice();
        }
        return paths.length > 0 ? paths : null;
    }

    // Relative path with no parent
    if (!parent || !parent.id || !parent.filename) {
        return ['.'];
    }

    return [pathModule.dirname(parent.filename)];
}

function setSourceMapsSupport(enabled, options) {
    if (typeof enabled !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('enabled', 'boolean', enabled);
    }
    if (options === undefined) {
        options = {};
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }
    const { nodeModules, generatedCode } = options;
    if (nodeModules !== undefined && typeof nodeModules !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.nodeModules', 'boolean', nodeModules);
    }
    if (generatedCode !== undefined && typeof generatedCode !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.generatedCode', 'boolean', generatedCode);
    }
}

const globalPaths = [];

function _initPaths() {
    const nodePath = globalThis.process && globalThis.process.env && globalThis.process.env.NODE_PATH;
    const paths = [];
    if (nodePath) {
        const parts = nodePath.split(':');
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i].trim();
            if (p.length > 0) {
                paths.push(pathModule.resolve(p));
            }
        }
    }

    const homeDir = (globalThis.process && globalThis.process.env && globalThis.process.env.HOME) || '/root';
    paths.push(pathModule.resolve(homeDir, '.node_modules'));
    paths.push(pathModule.resolve(homeDir, '.node_libraries'));
    paths.push('/usr/local/lib/node');

    globalPaths.length = 0;
    for (let j = 0; j < paths.length; j++) {
        globalPaths.push(paths[j]);
    }
}

_initPaths();

function _stat(filename) {
    try {
        const st = fsModule.statSync(filename);
        if (st.isDirectory()) return 1;
        if (st.isFile()) return 0;
        return -2;
    } catch (e) {
        return -2;
    }
}

function runMain() {
    const mainScript = process.argv[1];
    if (mainScript) {
        globalRequire(mainScript);
    }
}

export let syncBuiltinESMExports = function() {
    const registry = globalThis.__wasm_rquickjs_sync_builtin_esm_exports;
    if (!registry) return;
    if (typeof registry.fs === 'function') registry.fs();
    if (typeof registry.events === 'function') registry.events();
    require = moduleExports.require;
    createRequire = moduleExports.createRequire;
    findPackageJSON = moduleExports.findPackageJSON;
    builtinModules = moduleExports.builtinModules;
    isBuiltinModule = moduleExports.isBuiltin;
    register = moduleExports.register;
    syncBuiltinESMExports = moduleExports.syncBuiltinESMExports;
};

function Module(id, parent) {
    defineEnumerableWritable(this, 'id', id === undefined ? '' : id);
    defineEnumerableWritable(this, 'path', pathModule.dirname(this.id));
    defineEnumerableWritable(this, 'exports', {});
    defineEnumerableWritable(this, 'filename', null);
    defineEnumerableWritable(this, 'loaded', false);
    defineEnumerableWritable(this, 'children', []);
    defineEnumerableWritable(this, 'parent', parent || null);
    if (parent && parent.children) {
        Array.prototype.push.call(parent.children, this);
    }
    installCjsEsmDefaultSnapshotSlot(this);
}

const moduleRequireOverrides = new WeakMap();

Module.prototype.require = function require(id) {
    const override = moduleRequireOverrides.get(this);
    if (override) {
        return override(id);
    }
    const baseDir = this && typeof this.filename === 'string'
        ? pathModule.dirname(this.filename)
        : '.';
    return makeRequire(baseDir, this || null)(id);
};

Module.prototype._compile = function _compile(content, filename) {
    if (!(this instanceof Module)) {
        throw new ERR_INVALID_ARG_TYPE('mod', 'Module', this);
    }
    return compileModuleInto(this, content, arguments.length > 1 ? filename : this.filename);
};

function moduleLoad(request, parent, isMain) {
    void isMain;
    if (parent && typeof parent.filename === 'string') {
        return makeRequire(pathModule.dirname(parent.filename), parent)(request);
    }
    return makeRequire('.', parent || null)(request);
}

function moduleResolveFilename(request, parent, isMain, options) {
    void isMain;
    const baseDir = parent && typeof parent.filename === 'string'
        ? pathModule.dirname(parent.filename)
        : '.';
    const parentFilename = parent && typeof parent.filename === 'string'
        ? parent.filename
        : null;
    const parentLookupPaths = parent && Array.isArray(parent.paths)
        ? parent.paths.concat(globalPaths)
        : null;
    return resolveForRequire(request, options, baseDir, parentFilename, parentLookupPaths);
}

const moduleExports = Object.assign(Module, {
    require: globalRequire,
    createRequire,
    findPackageJSON,
    findSourceMap,
    SourceMap,
    builtinModules: builtinModuleNames,
    syncBuiltinESMExports,
    isBuiltin: isBuiltinModule,
    register,
    wrap: wrap,
    wrapper: wrapper,
    runMain: runMain,
    _nodeModulePaths: _nodeModulePaths,
    _resolveLookupPaths: _resolveLookupPaths,
    _resolveFilename: moduleResolveFilename,
    _load: moduleLoad,
    _initPaths: _initPaths,
    _pathCache: Object.create(null),
    _cache: moduleCache,
    _extensions: requireExtensions,
    _stat: _stat,
    globalPaths: globalPaths,
    setSourceMapsSupport,
    stripTypeScriptTypes,
});
moduleExportsInitialized = true;
Object.defineProperties(moduleExports, {
    __wasm_rquickjs_cjs_facade_has_own: {
        value: cjsFacadeHasOwnProperty,
        writable: false,
        configurable: false,
    },
    __wasm_rquickjs_dynamic_import_with_trace: {
        value: dynamicImportWithTrace,
        writable: false,
        configurable: false,
    },
    __wasm_rquickjs_load_cjs_esm_facade_default: {
        value: loadCjsEsmFacadeDefault,
        writable: false,
        configurable: false,
    },
    __wasm_rquickjs_load_commonjs_loader_source: {
        value: loadCommonJsLoaderSourceExports,
        writable: false,
        configurable: false,
    },
});
moduleExports.Module = Module;

// Add self-reference so require('module') works
builtinModuleMap['module'] = moduleExports;
builtinModuleMap['node:module'] = moduleExports;
publicBuiltinIdSet.add('module');
if (!builtinModuleNames.includes('module')) {
    builtinModuleNames.push('module');
}

export default moduleExports;
