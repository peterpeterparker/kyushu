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
import * as nodeUrl from 'node:url';
import * as vm from 'node:vm';
import * as timers from 'node:timers';
import * as timersPromises from 'node:timers/promises';
import * as consoleMod from 'node:console';
import * as async_hooks from 'node:async_hooks';
import * as cluster from 'node:cluster';
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
import { ERR_INVALID_ARG_TYPE } from '__wasm_rquickjs_builtin/internal/errors';
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
const nodeUrlCjs = cjsExport(nodeUrl);
const vmCjs = cjsExport(vm);
const timersCjs = cjsExport(timers);
const timersPromisesCjs = cjsExport(timersPromises);
const consoleCjs = cjsExport(consoleMod);
const asyncHooksCjs = cjsExport(async_hooks);
const clusterCjs = cjsExport(cluster);
const dgramCjs = cjsExport(dgram);
const diagnosticsChannelCjs = cjsExport(diagnostics_channel);
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
builtinModuleMap['_stream_readable'] = streamCjs && streamCjs.Readable;
builtinModuleMap['_stream_writable'] = streamCjs && streamCjs.Writable;
builtinModuleMap['_stream_duplex'] = streamCjs && streamCjs.Duplex;
builtinModuleMap['_stream_transform'] = streamCjs && streamCjs.Transform;
builtinModuleMap['_stream_passthrough'] = streamCjs && streamCjs.PassThrough;
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
globalThis.__wasm_rquickjs_module_mocks = _moduleMockRegistry;

function _mockCanonicalKey(specifier, base) {
    if (typeof specifier === 'object' && specifier !== null && typeof specifier.href === 'string') {
        specifier = specifier.href;
    }
    if (typeof specifier !== 'string') return null;

    // Check if it's a builtin (with or without node: prefix)
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    if (builtinModuleMap[bare] !== undefined || builtinModuleMap['node:' + bare] !== undefined) {
        return 'builtin:' + bare;
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
    if (filename.endsWith('.mjs')) return 'esm';
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

globalThis.__wasm_rquickjs_mock_canonical_key = _mockCanonicalKey;
globalThis.__wasm_rquickjs_register_module_mock = _registerModuleMock;
globalThis.__wasm_rquickjs_resolve_require_mock = _resolveRequireMock;
globalThis.__wasm_rquickjs_materialize_cjs_mock = _materializeCjsMock;

// Lookup mock entry by ID (for ESM source generation)
globalThis.__wasm_rquickjs_get_mock_module_entry = function(mockId) {
    return _moduleMockRegistryById[mockId] || null;
};

// Generate ESM module source for a mock entry (called from Rust MockModuleLoader)
globalThis.__wasm_rquickjs_get_mock_module_source = function(mockId) {
    const entry = _moduleMockRegistryById[mockId];
    if (!entry) {
        throw new Error('Mock entry not found for id: ' + mockId);
    }
    return _generateMockEsmSource(entry);
};

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

const builtinModuleNames = Object.keys(builtinModuleMap).filter(
    (name) => !name.startsWith('node:') && !name.startsWith('internal/') && !name.startsWith('_')
);

// Modules that require the 'node:' prefix (cannot be required as bare specifiers)
const schemelessBlockList = new Set(['test', 'sqlite']);

// Build public module ID sets matching Node.js semantics
const publicBuiltinIdSet = new Set();
const publicBuiltinWithoutSchemeSet = new Set();
for (let _i = 0; _i < builtinModuleNames.length; _i++) {
    const _name = builtinModuleNames[_i];
    publicBuiltinIdSet.add(_name);
    if (!schemelessBlockList.has(_name)) {
        publicBuiltinWithoutSchemeSet.add(_name);
    }
}

function isBuiltin(id) {
    if (typeof id !== 'string') return false;
    if (publicBuiltinWithoutSchemeSet.has(id)) return true;
    if (id.startsWith('node:')) {
        return publicBuiltinIdSet.has(id.slice(5));
    }
    return false;
}

function isBuiltinResolveTarget(id) {
    if (typeof id !== 'string') return false;
    if (id.startsWith('node:')) {
        return publicBuiltinIdSet.has(id.slice(5));
    }
    return publicBuiltinIdSet.has(id);
}

// Module cache: resolved absolute path -> Module object
const moduleCache = Object.create(null);

function tryReadFile(filename) {
    try {
        return fsModule.readFileSync(filename, 'utf8');
    } catch (e) {
        return null;
    }
}

// Shared require.extensions registry (mirrors Node.js Module._extensions)
const requireExtensions = Object.create(null);
requireExtensions['.js'] = function _defaultJs(mod, filename) { /* built-in */ };
requireExtensions['.json'] = function _defaultJson(mod, filename) { /* built-in */ };
requireExtensions['.node'] = function _defaultNode(mod, filename) { /* built-in */ };
const _defaultExtHandlers = new Set([requireExtensions['.js'], requireExtensions['.json'], requireExtensions['.node']]);

// Path cache (settable; used by tests to reset resolution state)
let _pathCache = Object.create(null);

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

function getPackageScopeType(filename) {
    let dir = pathModule.dirname(filename);
    while (true) {
        const pkgPath = pathModule.join(dir, 'package.json');
        const pkgContent = tryReadFile(pkgPath);
        if (pkgContent !== null) {
            try {
                const pkg = JSON.parse(pkgContent);
                return pkg.type || 'commonjs';
            } catch (e) {
                return 'commonjs';
            }
        }
        const parent = pathModule.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return 'commonjs';
}

function isPathDirectory(filename) {
    try {
        return fsModule.statSync(filename).isDirectory();
    } catch (_) {
        return false;
    }
}

function loadAsFile(candidate, skipExact) {
    let content = null;
    if (!skipExact) {
        content = tryReadFile(candidate);
        if (content !== null) {
            return { filename: candidate, content: content };
        }
    }

    const exts = Object.keys(requireExtensions);
    for (let i = 0; i < exts.length; i++) {
        content = tryReadFile(candidate + exts[i]);
        if (content !== null) {
            return { filename: candidate + exts[i], content: content };
        }
    }

    return null;
}

function loadAsDirectory(candidate, id, parentDir, seen) {
    seen = seen || Object.create(null);
    if (seen[candidate]) return null;
    seen[candidate] = true;

    const pkgJsonPath = pathModule.join(candidate, 'package.json');
    const pkgJson = tryReadFile(pkgJsonPath);
    if (pkgJson !== null) {
        try {
            const pkg = JSON.parse(pkgJson);
            if (Object.prototype.hasOwnProperty.call(pkg, 'main') && typeof pkg.main === 'string' && pkg.main.length > 0) {
                const mainPath = pathModule.resolve(candidate, pkg.main);
                let resolved = loadAsFile(mainPath, false);
                if (resolved !== null) return resolved;
                resolved = loadAsDirectory(mainPath, id, parentDir, seen);
                if (resolved !== null) return resolved;
            }
        } catch (e) {
            const pkgErr = new Error(
                'Invalid package config ' + pkgJsonPath +
                ' while resolving "' + id + '" from ' + parentDir + '.' +
                (e.message ? ' ' + e.message : '')
            );
            pkgErr.code = 'ERR_INVALID_PACKAGE_CONFIG';
            throw pkgErr;
        }
    }

    let content = tryReadFile(pathModule.join(candidate, 'index.js'));
    if (content !== null) {
        return { filename: pathModule.join(candidate, 'index.js'), content: content };
    }
    content = tryReadFile(pathModule.join(candidate, 'index.json'));
    if (content !== null) {
        return { filename: pathModule.join(candidate, 'index.json'), content: content };
    }
    return null;
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

function _iaSkipStr(s, i) {
    const q = s.charCodeAt(i);
    i++;
    while (i < s.length) {
        if (s.charCodeAt(i) === 0x5C) { i += 2; }
        else if (s.charCodeAt(i) === q) { return i + 1; }
        else { i++; }
    }
    return i;
}

function _iaSkipTpl(s, i) {
    i++;
    while (i < s.length) {
        let c = s.charCodeAt(i);
        if (c === 0x5C) { i += 2; }
        else if (c === 0x60) { return i + 1; }
        else if (c === 0x24 && i + 1 < s.length && s.charCodeAt(i + 1) === 0x7B) {
            i += 2;
            let d = 1;
            while (i < s.length && d > 0) {
                c = s.charCodeAt(i);
                if (c === 0x27 || c === 0x22) { i = _iaSkipStr(s, i); }
                else if (c === 0x60) { i = _iaSkipTpl(s, i); }
                else if (c === 0x7B || c === 0x28 || c === 0x5B) { d++; i++; }
                else if (c === 0x7D || c === 0x29 || c === 0x5D) { d--; i++; }
                else { i++; }
            }
        } else { i++; }
    }
    return i;
}

function stripImportAttributes(source) {
    const len = source.length;
    const out = [];
    let i = 0;
    while (i < len) {
        let ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            const s = i; i = _iaSkipStr(source, i); out.push(source.substring(s, i)); continue;
        }
        if (ch === 0x60) {
            const s = i; i = _iaSkipTpl(source, i); out.push(source.substring(s, i)); continue;
        }
        if (ch === 0x2F && i + 1 < len) {
            const nc = source.charCodeAt(i + 1);
            if (nc === 0x2F) { const s = i; while (i < len && source.charCodeAt(i) !== 0x0A) i++; out.push(source.substring(s, i)); continue; }
            if (nc === 0x2A) { const s = i; i += 2; while (i + 1 < len && !(source.charCodeAt(i) === 0x2A && source.charCodeAt(i + 1) === 0x2F)) i++; if (i + 1 < len) i += 2; out.push(source.substring(s, i)); continue; }
        }
        if (ch === 0x69 && i + 7 <= len && source.substring(i, i + 7) === 'import(' &&
            (i === 0 || !((ch = source.charCodeAt(i - 1)) >= 48 && ch <= 57 || ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch === 95 || ch === 36))) {
            i += 7;
            let depth = 1, commaPos = -1;
            const argStart = i;
            while (i < len && depth > 0) {
                ch = source.charCodeAt(i);
                if (ch === 0x27 || ch === 0x22) { i = _iaSkipStr(source, i); }
                else if (ch === 0x60) { i = _iaSkipTpl(source, i); }
                else if (ch === 0x2F && i + 1 < len && source.charCodeAt(i + 1) === 0x2F) { while (i < len && source.charCodeAt(i) !== 0x0A) i++; }
                else if (ch === 0x2F && i + 1 < len && source.charCodeAt(i + 1) === 0x2A) { i += 2; while (i + 1 < len && !(source.charCodeAt(i) === 0x2A && source.charCodeAt(i + 1) === 0x2F)) i++; if (i + 1 < len) i += 2; }
                else if (ch === 0x28 || ch === 0x5B || ch === 0x7B) { depth++; i++; }
                else if (ch === 0x29 || ch === 0x5D || ch === 0x7D) { depth--; i++; }
                else if (ch === 0x2C && depth === 1 && commaPos === -1) { commaPos = i; i++; }
                else { i++; }
            }
            if (commaPos > -1) {
                const firstArg = source.substring(argStart, commaPos);
                const secondArg = source.substring(commaPos + 1, i - 1);
                out.push('(globalThis.__wasm_rquickjs_validate_import_attrs(');
                out.push(firstArg);
                out.push(',');
                out.push(secondArg);
                out.push(') || import(');
                out.push(firstArg);
                out.push('))');
            } else {
                const spec = source.substring(argStart, i - 1);
                out.push('(globalThis.__wasm_rquickjs_validate_import_attrs(');
                out.push(spec);
                out.push(') || import(');
                out.push(spec);
                out.push('))');
            }
            continue;
        }
        out.push(source[i]);
        i++;
    }
    return out.join('');
}

function hasExecArgvFlag(flag) {
    const processObject = globalThis.process;
    if (!processObject || !Array.isArray(processObject.execArgv)) {
        return false;
    }

    const prefixed = flag + '=';
    for (let i = 0; i < processObject.execArgv.length; i++) {
        const arg = String(processObject.execArgv[i]);
        if (arg === flag || arg.indexOf(prefixed) === 0) {
            return true;
        }
    }

    return false;
}

function isExperimentalTransformTypesEnabled() {
    return hasExecArgvFlag('--experimental-transform-types');
}

function isSourceMapsEnabled() {
    if (hasExecArgvFlag('--no-enable-source-maps')) {
        return false;
    }

    return hasExecArgvFlag('--enable-source-maps') || isExperimentalTransformTypesEnabled();
}

function getSimpleSourceMapRegistry() {
    let registry = globalThis.__wasm_rquickjs_simple_source_maps;
    if (!registry || typeof registry !== 'object') {
        registry = Object.create(null);
        globalThis.__wasm_rquickjs_simple_source_maps = registry;
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

function countMatches(text, charCode) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === charCode) {
            count += 1;
        }
    }
    return count;
}

function transpileTypeScriptModule(filename, source) {
    if (!isExperimentalTransformTypesEnabled() || !filename.endsWith('.ts')) {
        return source;
    }

    const lines = String(source).split('\n');
    const transformedLines = [];
    const generatedLineToOriginalLine = Object.create(null);
    let insideInterface = false;
    let interfaceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (insideInterface) {
            interfaceDepth += countMatches(line, 123) - countMatches(line, 125);
            if (interfaceDepth <= 0) {
                insideInterface = false;
                interfaceDepth = 0;
            }
            continue;
        }

        const trimmed = line.trim();
        if (/^interface\s+[A-Za-z_$][A-Za-z0-9_$]*\b/.test(trimmed)) {
            interfaceDepth = countMatches(line, 123) - countMatches(line, 125);
            if (interfaceDepth > 0) {
                insideInterface = true;
            }
            continue;
        }

        if (trimmed.length === 0) {
            continue;
        }

        transformedLines.push(line);
        generatedLineToOriginalLine[transformedLines.length] = i + 1;
    }

    const transformed = transformedLines.join('\n');
    const sourceMapRegistry = getSimpleSourceMapRegistry();
    if (isSourceMapsEnabled()) {
        sourceMapRegistry[filename] = {
            generatedLineToOriginalLine,
        };
    } else {
        delete sourceMapRegistry[filename];
    }

    return transformed;
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

// Create a wrapper around an ESM namespace that adds __esModule: true
// while still passing isModuleNamespaceObject checks.
function wrapEsmNamespace(ns) {
    if (!ns || typeof ns !== 'object') return ns;
    if (!Object.hasOwn(ns, 'default') || Object.hasOwn(ns, '__esModule')) return ns;
    // Try to add __esModule directly to the namespace
    try {
        Object.defineProperty(ns, '__esModule', {
            value: true,
            writable: false,
            configurable: false,
            enumerable: false,
        });
        return ns;
    } catch (_) {}
    // Namespace is sealed — create a plain wrapper that looks like a module namespace
    const wrapped = Object.create(null);
    Object.defineProperty(wrapped, Symbol.toStringTag, { value: 'Module' });
    const keys = Object.keys(ns);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        Object.defineProperty(wrapped, k, {
            get: (function(key) { return function() { return ns[key]; }; })(k),
            enumerable: true,
            configurable: false,
        });
    }
    Object.defineProperty(wrapped, '__esModule', {
        value: true,
        writable: false,
        configurable: false,
        enumerable: false,
    });
    return wrapped;
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

function looksLikeEsmSource(source) {
    return /(^|[\r\n])\s*(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]|import\s*[\{\*]|export\s+)/.test(source);
}

const wrapper = [
    '(function (exports, require, module, __filename, __dirname) { ',
    '\n});'
];

function wrap(script) {
    const activeWrapper = (typeof moduleExports !== 'undefined' && moduleExports.wrapper) || wrapper;
    return activeWrapper[0] + script + activeWrapper[1];
}

function compileCjs(filename, source) {
    // Strip shebang
    if (source.length > 1 && source.charCodeAt(0) === 0x23 && source.charCodeAt(1) === 0x21) {
        source = '//' + source;
    }

    source = transpileTypeScriptModule(filename, source);
    source = stripV8OptimizationIntrinsics(source);
    source = stripImportAttributes(source);

    const cjsLineOffsets = getCjsLineOffsetRegistry();
    cjsLineOffsets[filename] = 2;

    const wrappedSource = wrap(source + '\n//# sourceURL=' + filename + '\n');
    return _evalWithFilename(wrappedSource, filename);
}

function loadModule(resolvedFilename, source, parentModule) {
    // Check cache
    if (moduleCache[resolvedFilename]) {
        const cached = moduleCache[resolvedFilename];
        if (parentModule && parentModule.children && !parentModule.children.includes(cached)) {
            parentModule.children.push(cached);
        }
        return cached;
    }

    let mod;
    if ((!parentModule || parentModule === mainModule || parentModule.filename === '/') && typeof mainModule !== 'undefined' && mainModule.filename === '/') {
        mod = mainModule;
        mod.id = '.';
        mod.filename = resolvedFilename;
        mod.path = pathModule.dirname(resolvedFilename);
        mod.exports = {};
        mod.loaded = false;
        mod.parent = null;
        mod.children = [];
        mod.paths = _nodeModulePaths(pathModule.dirname(resolvedFilename));
        if (globalThis.process) {
            globalThis.process.mainModule = mod;
        }
    } else {
        mod = {
            id: resolvedFilename,
            filename: resolvedFilename,
            path: pathModule.dirname(resolvedFilename),
            exports: {},
            loaded: false,
            parent: parentModule || null,
            children: [],
            paths: _nodeModulePaths(pathModule.dirname(resolvedFilename)),
        };
    }

    // Cache before executing (handles circular dependencies)
    moduleCache[resolvedFilename] = mod;

    if (parentModule && parentModule.children) {
        parentModule.children.push(mod);
    }

    // Check for custom extension handler
    const ext = findLongestRegisteredExtension(resolvedFilename);
    const handler = requireExtensions[ext];
    if (handler && !_defaultExtHandlers.has(handler)) {
        try {
            handler(mod, resolvedFilename);
        } catch (err) {
            delete moduleCache[resolvedFilename];
            throw err;
        }
    } else if (resolvedFilename.endsWith('.node')) {
        delete moduleCache[resolvedFilename];
        throw new Error("Native .node modules are not supported in WASM: '" + resolvedFilename + "'");
    } else if (resolvedFilename.endsWith('.json')) {
        try {
            mod.exports = JSON.parse(source);
        } catch (e) {
            delete moduleCache[resolvedFilename];
            const err = new SyntaxError(resolvedFilename + ': ' + e.message);
            err.code = 'ERR_INVALID_JSON';
            throw err;
        }
    } else {
        const isEsm = resolvedFilename.endsWith('.mjs') ||
            (resolvedFilename.endsWith('.js') && getPackageScopeType(resolvedFilename) === 'module');
        if (isEsm && hasExecArgvFlag('--no-experimental-require-module')) {
            delete moduleCache[resolvedFilename];
            const esmErr = new Error(
                "require() of ES Module " + resolvedFilename + " not supported. " +
                "Instead change the require of " + resolvedFilename + " to a dynamic " +
                "import() which is available in all CommonJS modules."
            );
            esmErr.code = 'ERR_REQUIRE_ESM';
            throw esmErr;
        }
        if (isEsm) {
            try {
                mod.exports = wrapEsmNamespace(_requireEsm(resolvedFilename));
            } catch (err) {
                delete moduleCache[resolvedFilename];
                throw err;
            }
        } else {
            const dirname = pathModule.dirname(resolvedFilename);
            const childRequire = makeRequire(dirname, mod);
            let compiledFn;
            let cjsSyntaxError = null;
            try {
                compiledFn = compileCjs(resolvedFilename, source);
            } catch (err) {
                // Normalize QuickJS SyntaxError messages for ESM keywords in CJS context
                if (err && err.name === 'SyntaxError') {
                    normalizeEsmSyntaxError(err);
                } else if (err && typeof err.message === 'string' && err.message === 'return not in a function') {
                    markAsSyntaxError(err);
                }
                // For .js files (not .cjs), detect ESM syntax and fall back to ESM loading
                if (!resolvedFilename.endsWith('.cjs') && err && err.name === 'SyntaxError') {
                    cjsSyntaxError = err;
                } else {
                    delete moduleCache[resolvedFilename];
                    maybeSetArrowMessageOnSyntaxError(err, resolvedFilename, source);
                    throw err;
                }
            }
            if (cjsSyntaxError) {
                // SyntaxError in a .js file — try loading as ESM (entry point detection)
                try {
                    mod.exports = wrapEsmNamespace(_requireEsm(resolvedFilename));
                } catch (esmErr) {
                    delete moduleCache[resolvedFilename];
                    if (looksLikeEsmSource(source)) {
                        normalizeEsmSyntaxError(esmErr);
                        throw esmErr;
                    }
                    // ESM loading also failed — throw the original CJS SyntaxError
                    maybeSetArrowMessageOnSyntaxError(cjsSyntaxError, resolvedFilename, source);
                    throw cjsSyntaxError;
                }
            } else if (compiledFn) {
                const previousModuleContext = globalThis.__wasm_rquickjs_current_module;
                globalThis.__wasm_rquickjs_current_module = {
                    filename: resolvedFilename,
                    source: source
                };
                const previousCjsImportDir = globalThis.__wasm_rquickjs_cjs_import_dir;
                globalThis.__wasm_rquickjs_cjs_import_dir = dirname;
                try {
                    compiledFn(mod.exports, childRequire, mod, resolvedFilename, dirname);
                } catch (err) {
                    delete moduleCache[resolvedFilename];
                    maybeSetArrowMessageOnSyntaxError(err, resolvedFilename, source);
                    throw err;
                } finally {
                    globalThis.__wasm_rquickjs_current_module = previousModuleContext;
                    if (previousCjsImportDir !== undefined) {
                        globalThis.__wasm_rquickjs_cjs_import_dir = previousCjsImportDir;
                    }
                }
            }
        }
    }

    mod.loaded = true;
    return mod;
}

// The root "main" module
const mainModule = {
    id: '.',
    filename: '/',
    path: '/',
    exports: {},
    loaded: true,
    parent: null,
    children: [],
};

function splitPackageName(id) {
    // Scoped packages: @scope/pkg or @scope/pkg/subpath
    if (id.charAt(0) === '@') {
        const slashIdx = id.indexOf('/');
        if (slashIdx === -1) return { name: id, subpath: '' };
        const secondSlash = id.indexOf('/', slashIdx + 1);
        if (secondSlash === -1) return { name: id, subpath: '' };
        return { name: id.substring(0, secondSlash), subpath: id.substring(secondSlash + 1) };
    }
    // Regular packages: pkg or pkg/subpath
    const idx = id.indexOf('/');
    if (idx === -1) return { name: id, subpath: '' };
    return { name: id.substring(0, idx), subpath: id.substring(idx + 1) };
}

function resolveFromNodeModules(id, parentDir, parentFilename) {
    const dirs = _nodeModulePaths(parentDir);

    // Split into package name and subpath for packages with subpath specifiers
    const parts = splitPackageName(id);
    const hasSubpath = parts.subpath.length > 0;

    for (let i = 0; i < dirs.length; i++) {
        // If there's a subpath, try resolving it relative to the package directory
        if (hasSubpath) {
            const pkgDir = pathModule.join(dirs[i], parts.name);
            const subCandidate = pathModule.join(pkgDir, parts.subpath);
            // Try exact subpath
            let content = tryReadFile(subCandidate);
            if (content !== null) return { filename: subCandidate, content: content };
            // Try with extensions
            content = tryReadFile(subCandidate + '.js');
            if (content !== null) return { filename: subCandidate + '.js', content: content };
            content = tryReadFile(subCandidate + '.mjs');
            if (content !== null) return { filename: subCandidate + '.mjs', content: content };
            content = tryReadFile(subCandidate + '.json');
            if (content !== null) return { filename: subCandidate + '.json', content: content };
            // Try as directory
            content = tryReadFile(pathModule.join(subCandidate, 'index.js'));
            if (content !== null) return { filename: pathModule.join(subCandidate, 'index.js'), content: content };
            content = tryReadFile(pathModule.join(subCandidate, 'index.json'));
            if (content !== null) return { filename: pathModule.join(subCandidate, 'index.json'), content: content };
        }

        const candidate = pathModule.join(dirs[i], id);

        // Try as directory: check package.json "main" field
        const pkgJsonPath = pathModule.join(candidate, 'package.json');
        const pkgJson = tryReadFile(pkgJsonPath);
        if (pkgJson !== null) {
            try {
                const pkg = JSON.parse(pkgJson);
                if (Object.prototype.hasOwnProperty.call(pkg, 'main') && typeof pkg.main === 'string') {
                    const mainPath = pathModule.resolve(candidate, pkg.main);
                    const mainCandidates = [
                        mainPath,
                        mainPath + '.js',
                        mainPath + '.json',
                        pathModule.join(mainPath, 'index.js'),
                        pathModule.join(mainPath, 'index.json'),
                    ];
                    for (let m = 0; m < mainCandidates.length; m++) {
                        const content = tryReadFile(mainCandidates[m]);
                        if (content !== null) return { filename: mainCandidates[m], content: content };
                    }
                }
            } catch (e) {
                const fromPart = parentFilename || parentDir;
                const pkgErr = new Error(
                    'Invalid package config ' + pkgJsonPath +
                    ' while importing "' + id + '" from ' + fromPart + '.' +
                    (e.message ? ' ' + e.message : '')
                );
                pkgErr.code = 'ERR_INVALID_PACKAGE_CONFIG';
                throw pkgErr;
            }
        }

        // Try as directory: index.js / index.json
        const indexJs = pathModule.join(candidate, 'index.js');
        let content = tryReadFile(indexJs);
        if (content !== null) return { filename: indexJs, content: content };

        const indexJson = pathModule.join(candidate, 'index.json');
        content = tryReadFile(indexJson);
        if (content !== null) return { filename: indexJson, content: content };

        // Try as file with extension
        content = tryReadFile(candidate + '.js');
        if (content !== null) return { filename: candidate + '.js', content: content };

        content = tryReadFile(candidate + '.json');
        if (content !== null) return { filename: candidate + '.json', content: content };
    }
    return null;
}

function makeRequire(parentDir, parentModule, parentFilenameOverride) {
    const parentFilename = parentFilenameOverride || (parentModule && parentModule.filename) || null;
    function localRequire(id) {
        if (typeof id !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('id', 'string', id);
        }
        if (id === '') {
            const argErr = new TypeError("The argument 'id' must be a non-empty string. Received ''");
            argErr.code = 'ERR_INVALID_ARG_VALUE';
            throw argErr;
        }

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
            const builtin = builtinModuleMap[id];
            if (builtin !== undefined) {
                return builtin;
            }
            const err = new Error('No such built-in module: ' + id);
            err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
            throw err;
        }

        // Check require.cache before builtins for non-node: specifiers
        // (allows shadowing builtins via require.cache)
        const cached = moduleCache[id];
        if (cached !== undefined) {
            return cached.exports;
        }

        // Builtin modules
        const builtin = schemelessBlockList.has(id) ? undefined : builtinModuleMap[id];
        if (builtin !== undefined) {
            return builtin;
        }

        // Relative or absolute file paths
        if (id === '.' || id === '..' || id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) {
            const resolved = resolveFilename(id, parentDir);
            const mod = loadModule(resolved.filename, resolved.content, parentModule || null);
            return mod.exports;
        }

        // node_modules resolution for bare specifiers
        const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename);
        if (nmResolved) {
            const mod = loadModule(nmResolved.filename, nmResolved.content, parentModule || null);
            return mod.exports;
        }

        const err = new Error("Cannot find module '" + id + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }

    localRequire.cache = moduleCache;
    localRequire.extensions = requireExtensions;

    localRequire.resolve = function resolve(id, options) {
        if (typeof id !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('request', 'string', id);
        }
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
            const isRelative = id === '.' || id === '..' || id.startsWith('./') || id.startsWith('../') || id.startsWith('/');
            for (let pi = 0; pi < searchPaths.length; pi++) {
                if (typeof searchPaths[pi] !== 'string') {
                    const argErr = new TypeError("The argument 'paths[" + pi + "]' must be a string. Received " + typeof searchPaths[pi]);
                    argErr.code = 'ERR_INVALID_ARG_VALUE';
                    throw argErr;
                }
                const searchDir = pathModule.resolve(searchPaths[pi]);
                if (isRelative) {
                    // Relative/absolute: resolve directly against the search path
                    try {
                        const resolved = resolveFilename(id, searchDir);
                        return resolved.filename;
                    } catch (e) {
                        // Try next path
                    }
                } else {
                    // Bare specifier: use node_modules resolution from search path
                    const nmResolved = resolveFromNodeModules(id, searchDir, parentFilename);
                    if (nmResolved) return nmResolved.filename;
                }
            }
            const err = new Error("Cannot find module '" + id + "'");
            err.code = 'MODULE_NOT_FOUND';
            throw err;
        }
        if (id === '.' || id === '..' || id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) {
            const resolved = resolveFilename(id, parentDir);
            return resolved.filename;
        }
        // node_modules resolution for bare specifiers
        const nmResolved = resolveFromNodeModules(id, parentDir, parentFilename);
        if (nmResolved) {
            return nmResolved.filename;
        }
        const err = new Error("Cannot find module '" + id + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    };

    localRequire.resolve.paths = function paths(request) {
        if (typeof request !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('request', 'string', request);
        }
        if (isBuiltinResolveTarget(request)) {
            return null;
        }
        return _resolveLookupPaths(request, parentModule);
    };

    Object.defineProperty(localRequire, 'main', {
        value: mainModule,
        writable: true,
        configurable: true,
        enumerable: true,
    });

    return localRequire;
}

// The global require, rooted at '/'
const globalRequire = makeRequire('/', mainModule);

export function require(id) {
    return globalRequire(id);
}

export function createRequire(filename) {
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
    return makeRequire(dir, syntheticParent, filepath);
}

export { builtinModuleNames as builtinModules };

export function isBuiltinModule(id) {
    return isBuiltin(id);
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

const moduleExports = {
    require: globalRequire,
    createRequire,
    builtinModules: builtinModuleNames,
    isBuiltin: isBuiltinModule,
    wrap: wrap,
    wrapper: wrapper,
    runMain: runMain,
    _nodeModulePaths: _nodeModulePaths,
    _resolveLookupPaths: _resolveLookupPaths,
    _initPaths: _initPaths,
    _pathCache: _pathCache,
    _extensions: requireExtensions,
    _stat: _stat,
    globalPaths: globalPaths,
    setSourceMapsSupport,
};

// Add self-reference so require('module') works
builtinModuleMap['module'] = moduleExports;
builtinModuleMap['node:module'] = moduleExports;

export default moduleExports;
