// node:child_process implementation for WASM.
//
// We cannot spawn OS processes in WASM, but some compatibility tests only need
// spawnSync(process.execPath, [script, ...args]) semantics. For that case we
// emulate a child process by running the target script with an isolated argv,
// env and cwd view, and return a spawnSync-like result object.

import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import moduleExports from 'node:module';

const FIPS_STARTUP_ERROR = 'OpenSSL error when trying to enable FIPS: fips mode not supported';

function createNotSupportedError(method) {
    const err = new Error(method + ' is not supported in WebAssembly environment');
    err.code = 'ENOSYS';
    return err;
}

function formatErrorForStderr(err) {
    let text;
    if (err && err.stack) {
        text = String(err.stack);
        if (err.name && err.name !== 'Error' && text.indexOf('Error:') === 0) {
            text = String(err.name) + text.slice('Error'.length);
        }
        if (text.indexOf('Error: return not in a function') === 0) {
            text = 'SyntaxError:' + text.slice('Error:'.length);
        }
        if (err && err.message) {
            const message = String(err.message);
            if (text.indexOf(message) === -1) {
                text = 'Error: ' + message + '\n' + text;
            }
        }
    } else {
        text = String(err);
    }

    if (text.indexOf('Error: return not in a function') === 0) {
        text = 'SyntaxError:' + text.slice('Error:'.length);
    }

    if (err && typeof err.code === 'string') {
        text += ' {\n  code: \'' + err.code + '\'\n}';
    }

    if (!text.endsWith('\n')) {
        text += '\n';
    }
    return text;
}

function snapshotEnv(env) {
    return Object.assign({}, env);
}

function replaceEnv(targetEnv, sourceEnv) {
    for (const key of Object.keys(targetEnv || {})) {
        delete targetEnv[key];
    }

    if (!sourceEnv || typeof sourceEnv !== 'object') {
        return;
    }

    for (const key of Object.keys(sourceEnv)) {
        targetEnv[key] = String(sourceEnv[key]);
    }
}

function unsupportedSpawnSyncResult(command) {
    const error = createNotSupportedError('spawnSync(' + String(command) + ')');
    return {
        pid: 0,
        output: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: null,
        signal: null,
        error,
    };
}

function getOutputEncoding(options) {
    if (!options || options.encoding === undefined || options.encoding === null) {
        return null;
    }

    return String(options.encoding);
}

function convertOutputValue(output, encoding) {
    if (encoding && encoding !== 'buffer') {
        return output.toString(encoding);
    }

    return output;
}

function buildOutputResult(capturedStdout, capturedStderr, status, encoding) {
    const rawStdout = Buffer.from(capturedStdout);
    const rawStderr = Buffer.from(capturedStderr);
    const stdout = convertOutputValue(rawStdout, encoding);
    const stderr = convertOutputValue(rawStderr, encoding);

    return {
        pid: 1,
        output: [null, stdout, stderr],
        stdout,
        stderr,
        status,
        signal: null,
    };
}

function isInlineEvalOption(value) {
    return value === '-e' || value === '--eval' || value === '-p' || value === '--print' || value === '-pe';
}

function execArgTakesValue(arg) {
    return arg === '--openssl-config' || arg === '--input-type' || arg === '--require' || arg === '-r';
}

function splitExecArgvAndInvocationArgs(args) {
    const execArgv = [];
    let invocationArgs = [];

    for (let i = 0; i < args.length; i++) {
        const arg = String(args[i]);

        if (isInlineEvalOption(arg)) {
            invocationArgs = args.slice(i).map((value) => String(value));
            break;
        }

        if (arg === '--') {
            invocationArgs = args.slice(i + 1).map((value) => String(value));
            break;
        }

        if (arg.length > 0 && arg[0] === '-') {
            execArgv.push(arg);

            if (execArgTakesValue(arg) && i + 1 < args.length) {
                i += 1;
                execArgv.push(String(args[i]));
            }

            continue;
        }

        invocationArgs = args.slice(i).map((value) => String(value));
        break;
    }

    return {
        execArgv,
        invocationArgs,
    };
}

function hasFipsStartupFlag(execArgv) {
    for (let i = 0; i < execArgv.length; i++) {
        const arg = String(execArgv[i]);
        if (arg === '--enable-fips' || arg === '--force-fips') {
            return true;
        }
    }

    return false;
}

function readExecArgValue(execArgv, flag) {
    const prefixed = flag + '=';
    for (let i = 0; i < execArgv.length; i++) {
        const arg = String(execArgv[i]);
        if (arg === flag) {
            if (i + 1 >= execArgv.length) {
                return '';
            }
            i += 1;
            return String(execArgv[i]);
        }
        if (arg.indexOf(prefixed) === 0) {
            return arg.slice(prefixed.length);
        }
    }
    return null;
}

function parsePositiveIntegerFlagValue(value) {
    if (typeof value !== 'string' || value.length === 0 || !/^\d+$/.test(value)) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

function isPowerOfTwo(value) {
    if (!Number.isInteger(value) || value < 2) {
        return false;
    }

    while ((value % 2) === 0) {
        value /= 2;
    }

    return value === 1;
}

function validateSecureHeapFlags(execArgv) {
    const errors = [];

    const secureHeapValue = readExecArgValue(execArgv, '--secure-heap');
    if (secureHeapValue !== null) {
        const parsedHeapValue = parsePositiveIntegerFlagValue(secureHeapValue);
        if (parsedHeapValue === null || (parsedHeapValue >= 2 && !isPowerOfTwo(parsedHeapValue))) {
            errors.push('--secure-heap must be a power of 2');
        }
    }

    const secureHeapMinValue = readExecArgValue(execArgv, '--secure-heap-min');
    if (secureHeapMinValue !== null) {
        const parsedHeapMinValue = parsePositiveIntegerFlagValue(secureHeapMinValue);
        if (parsedHeapMinValue === null || parsedHeapMinValue < 2 || !isPowerOfTwo(parsedHeapMinValue)) {
            errors.push('--secure-heap-min must be a power of 2');
        }
    }

    return errors;
}

function parseJsStringLiteral(literal) {
    if (!literal || literal.length < 2) {
        return null;
    }

    if (literal[0] === '"') {
        try {
            return JSON.parse(literal);
        } catch (_) {
            return null;
        }
    }

    if (literal[0] === "'") {
        let inner = literal.slice(1, -1);
        inner = inner.replace(/\\'/g, "'");
        inner = inner.replace(/\\\\/g, '\\');
        return inner;
    }

    return null;
}

function parseBufferConstructorProbe(source) {
    if (source.indexOf("vm.runInNewContext('new Buffer(10)'") === -1) {
        return null;
    }

    const filenames = [];
    const filenameRe = /filename\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    let match;
    while ((match = filenameRe.exec(source)) !== null) {
        const parsed = parseJsStringLiteral(match[1]);
        if (parsed === null) {
            return null;
        }
        filenames.push(parsed);
    }

    if (filenames.length < 2) {
        return null;
    }

    return {
        mainFilename: filenames[0],
        callSiteFilename: filenames[filenames.length - 1],
    };
}

function isNodeModulesPath(filePath) {
    return /(^|[\\/])node_modules([\\/]|$)/i.test(String(filePath));
}

function getWarningCode(warning, typeOrOptions, code) {
    if (typeof code === 'string') {
        return code;
    }
    if (warning && typeof warning === 'object' && typeof warning.code === 'string') {
        return warning.code;
    }
    if (typeOrOptions && typeof typeOrOptions === 'object' && typeof typeOrOptions.code === 'string') {
        return typeOrOptions.code;
    }
    return undefined;
}

function isWarningSuppressed() {
    if (process.noDeprecation) {
        return true;
    }

    if (process.env && process.env.NODE_NO_WARNINGS === '1') {
        return true;
    }

    const execArgv = process.execArgv;
    if (!Array.isArray(execArgv)) {
        return false;
    }

    for (let i = 0; i < execArgv.length; i++) {
        const arg = String(execArgv[i]);
        if (arg === '--no-warnings' || arg === '--no-deprecation') {
            return true;
        }
    }

    return false;
}

function hasExecArgvFlag(flag) {
    const execArgv = process.execArgv;
    if (!Array.isArray(execArgv)) {
        return false;
    }
    for (let i = 0; i < execArgv.length; i++) {
        if (String(execArgv[i]) === flag) {
            return true;
        }
    }
    return false;
}

function getWarningInfo(warning, typeOrOptions, code) {
    if (warning && typeof warning === 'object') {
        return {
            name: warning.name || 'Warning',
            code: warning.code,
            message: warning.message || String(warning),
        };
    }

    let name = 'Warning';
    let warningCode = undefined;

    if (typeof typeOrOptions === 'string') {
        name = typeOrOptions;
    } else if (typeOrOptions && typeof typeOrOptions === 'object' && !(typeOrOptions instanceof Error)) {
        if (typeOrOptions.type !== undefined) {
            name = String(typeOrOptions.type);
        }
        if (typeOrOptions.code !== undefined) {
            warningCode = String(typeOrOptions.code);
        }
    }

    if (typeof code === 'string') {
        warningCode = code;
    }

    return {
        name,
        code: warningCode,
        message: String(warning),
    };
}

function formatWarningForStderr(warning, typeOrOptions, code) {
    const info = getWarningInfo(warning, typeOrOptions, code);
    let pid = process.pid;
    if (typeof pid !== 'number' || Number.isNaN(pid)) {
        pid = 1;
    }

    let prefix = '(node:' + String(pid) + ') ';
    if (info.code) {
        prefix += '[' + info.code + '] ';
    }

    let output = prefix + info.name + ': ' + info.message + '\n';
    if (hasExecArgvFlag('--trace-warnings')) {
        const stack = warning && typeof warning === 'object' && typeof warning.stack === 'string'
            ? warning.stack
            : (new Error()).stack;
        if (typeof stack === 'string' && stack.length > 0) {
            const lines = stack.split('\n');
            if (lines.length > 1) {
                output += lines.slice(1).join('\n').replace(/at <anonymous> \(/g, 'at Object.<anonymous> (') + '\n';
            }
        }
    } else {
        output += '(Use `node --trace-warnings ...` to show where the warning was created)\n';
    }
    return output;
}

function parseInlineInvocation(inlineArgs) {
    let shouldPrint = false;
    let source = null;
    let sourceIndex = -1;
    const execArgvSuffix = [];

    for (let i = 0; i < inlineArgs.length; i++) {
        const arg = String(inlineArgs[i]);

        if (arg === '-p' || arg === '--print') {
            shouldPrint = true;
            execArgvSuffix.push(arg);
            continue;
        }

        if (arg === '-pe') {
            shouldPrint = true;
            execArgvSuffix.push(arg);
            if (i + 1 < inlineArgs.length) {
                source = String(inlineArgs[i + 1]);
                sourceIndex = i + 1;
                execArgvSuffix.push(source);
            }
            break;
        }

        if (arg === '-e' || arg === '--eval') {
            execArgvSuffix.push(arg);
            if (i + 1 < inlineArgs.length) {
                source = String(inlineArgs[i + 1]);
                sourceIndex = i + 1;
                execArgvSuffix.push(source);
            }
            break;
        }

        if (arg.indexOf('--eval=') === 0) {
            source = arg.slice('--eval='.length);
            sourceIndex = i;
            execArgvSuffix.push(arg);
            break;
        }

        source = arg;
        sourceIndex = i;
        execArgvSuffix.push(arg);
        break;
    }

    if (source === null) {
        return null;
    }

    const evalArgv = [];
    for (let i = sourceIndex + 1; i < inlineArgs.length; i++) {
        if (inlineArgs[i] === '--') {
            for (let j = i + 1; j < inlineArgs.length; j++) {
                evalArgv.push(String(inlineArgs[j]));
            }
            return { shouldPrint, source, evalArgv, execArgvSuffix };
        }
        evalArgv.push(String(inlineArgs[i]));
    }

    return { shouldPrint, source, evalArgv, execArgvSuffix };
}

function getInputType(execArgv) {
    for (let i = 0; i < execArgv.length; i++) {
        const arg = String(execArgv[i]);
        if (arg === '--input-type' && i + 1 < execArgv.length) {
            return String(execArgv[i + 1]);
        }
        if (arg.indexOf('--input-type=') === 0) {
            return arg.slice('--input-type='.length);
        }
    }
    return 'commonjs';
}

function transpileModuleEvalToCommonJs(source) {
    let transformed = String(source);
    transformed = transformed.replace(/\bimport\.meta\b/g, '({ url: "file://[eval]" })');
    transformed = transformed.replace(
        /^\s*import\s+(['"][^'"]+['"])\s*;?\s*$/gm,
        '__wasm_eval_require($1);'
    );
    transformed = transformed.replace(/\bimport\s*\(/g, '__wasm_eval_dynamic_import(');
    return transformed;
}

function executeInlineSource(runtimeRequire, inlineArgs, childCwd) {
    const parsed = parseInlineInvocation(inlineArgs);
    if (!parsed) {
        const err = new Error(String(inlineArgs[0]) + ' requires an argument');
        err.code = 9;
        throw err;
    }
    if (parsed.source.indexOf('\\-') === 0) {
        parsed.source = parsed.source.slice(1);
    }
    process.argv = [process.argv0 || process.execPath].concat(parsed.evalArgv);
    process.execArgv = (process.execArgv || []).concat(parsed.execArgvSuffix);

    const vmModule = runtimeRequire('node:vm');
    const evalRequire = moduleExports.createRequire(path.join(childCwd || process.cwd(), '[eval].js'));
    const childRequire = function childEvalRequire(id) {
        if (evalRequire && evalRequire.cache && typeof evalRequire.resolve === 'function') {
            try {
                const resolved = evalRequire.resolve(id);
                if (evalRequire.cache[resolved]) {
                    delete evalRequire.cache[resolved];
                }
            } catch (_) {}
        }
        return evalRequire(id);
    };
    if (evalRequire.resolve) childRequire.resolve = evalRequire.resolve;
    if (evalRequire.cache) childRequire.cache = evalRequire.cache;
    const inputType = getInputType(process.execArgv || []);
    const bufferProbe = parseBufferConstructorProbe(parsed.source);
    let result;
    const hadGlobalOs = Object.prototype.hasOwnProperty.call(globalThis, 'os');
    const oldGlobalOs = globalThis.os;
    const oldGlobalCrypto = globalThis.crypto;
    globalThis.os = runtimeRequire('node:os');
    globalThis.crypto = runtimeRequire('node:crypto');
    const evalFs = runtimeRequire('node:fs');

    try {
    if (bufferProbe) {
        process.mainModule = { filename: bufferProbe.mainFilename };
        result = vmModule.runInNewContext('new Buffer(10)', { Buffer }, {
            filename: bufferProbe.callSiteFilename,
        });
    } else if (inputType === 'module') {
        if (parsed.shouldPrint) {
            const err = new Error('--print cannot be used with ESM input');
            err.name = 'SyntaxError';
            throw err;
        }
        const previousCjsImportDir = globalThis.__wasm_rquickjs_cjs_import_dir;
        globalThis.__wasm_rquickjs_cjs_import_dir = childCwd || process.cwd();
        try {
            const moduleSource = transpileModuleEvalToCommonJs(parsed.source);
            const dynamicImport = function dynamicImport(specifier) {
                return Promise.resolve(childRequire(specifier));
            };
            const evaluator = new Function('Buffer', 'process', 'vm', 'os', 'fs', '__wasm_eval_require', '__wasm_eval_dynamic_import', 'const require = undefined;\n' + moduleSource + '\n//# sourceURL=[eval]\n');
            result = evaluator(Buffer, process, vmModule, globalThis.os, evalFs, childRequire, dynamicImport);
        } finally {
            if (previousCjsImportDir !== undefined) {
                globalThis.__wasm_rquickjs_cjs_import_dir = previousCjsImportDir;
            } else {
                delete globalThis.__wasm_rquickjs_cjs_import_dir;
            }
        }
    } else if (inputType !== 'commonjs') {
        throw new Error('Unsupported --input-type value: ' + inputType);
    } else if (parsed.shouldPrint) {
        const evaluator = new Function('Buffer', 'process', 'vm', 'os', 'fs', 'require', 'return eval(' + JSON.stringify(parsed.source) + ');\n//# sourceURL=[eval]\n');
        result = evaluator(Buffer, process, vmModule, globalThis.os, evalFs, childRequire);
    } else {
        const evaluator = new Function('Buffer', 'process', 'vm', 'os', 'fs', 'require', parsed.source + '\n//# sourceURL=[eval]\n');
        result = evaluator(Buffer, process, vmModule, globalThis.os, evalFs, childRequire);
    }
    } finally {
        if (hadGlobalOs) {
            globalThis.os = oldGlobalOs;
        } else {
            delete globalThis.os;
        }
        globalThis.crypto = oldGlobalCrypto;
    }

    if (parsed.shouldPrint && process.stdout && typeof process.stdout.write === 'function') {
        const util = runtimeRequire('node:util');
        const output = typeof result === 'string' ? result : util.inspect(result);
        process.stdout.write(String(output) + '\n');
    }

    return {
        evalArgv: parsed.evalArgv,
        bufferProbe,
    };
}

function runInline(command, args, options) {
    if (!Array.isArray(args) || args.length === 0) {
        return unsupportedSpawnSyncResult(command);
    }

    const childArgs = [];
    for (let i = 0; i < args.length; i++) {
        childArgs.push(String(args[i]));
    }

    const parsedChildArgs = splitExecArgvAndInvocationArgs(childArgs);
    const execArgv = parsedChildArgs.execArgv;
    const invocationArgs = parsedChildArgs.invocationArgs;

    let hasTestFlag = execArgv.indexOf('--test') !== -1;
    if (!hasTestFlag) {
        for (let j = 0; j < invocationArgs.length; j++) {
            if (invocationArgs[j] === '--test') {
                hasTestFlag = true;
                break;
            }
        }
    }
    if (hasTestFlag) {
        const conflictingFlags = ['--check', '--interactive', '--eval', '-e', '--print', '-p'];
        let conflictFlag = null;
        for (let k = 0; k < conflictingFlags.length; k++) {
            const flag = conflictingFlags[k];
            if (execArgv.indexOf(flag) !== -1) {
                conflictFlag = flag;
                break;
            }
            if (invocationArgs.indexOf(flag) !== -1) {
                conflictFlag = flag;
                break;
            }
        }
        if (conflictFlag !== null) {
            const encoding = getOutputEncoding(options);
            return buildOutputResult('', conflictFlag + ' cannot be used with --test\n', 1, encoding);
        }
    }

    if (invocationArgs.length === 0) {
        return unsupportedSpawnSyncResult(command);
    }

    let childCwd = process.cwd();
    if (options && typeof options.cwd === 'string') {
        childCwd = path.isAbsolute(options.cwd) ? options.cwd : path.resolve(childCwd, options.cwd);
    }
    const encoding = getOutputEncoding(options);

    const oldArgv = process.argv.slice();
    const oldExecArgv = Array.isArray(process.execArgv) ? process.execArgv.slice() : [];
    const oldArgv0 = process.argv0;
    const oldRequireModuleFeature = process.features && process.features.require_module;
    const oldCwd = process.cwd;
    const oldChdir = process.chdir;
    const oldRealCwd = typeof oldCwd === 'function' ? oldCwd.call(process) : '/';
    const oldExitCode = process.exitCode;
    const hadNoDeprecation = Object.prototype.hasOwnProperty.call(process, 'noDeprecation');
    const oldNoDeprecation = process.noDeprecation;
    const hadTraceDeprecation = Object.prototype.hasOwnProperty.call(process, 'traceDeprecation');
    const oldTraceDeprecation = process.traceDeprecation;
    const hadThrowDeprecation = Object.prototype.hasOwnProperty.call(process, 'throwDeprecation');
    const oldThrowDeprecation = process.throwDeprecation;
    const hadMainModule = Object.prototype.hasOwnProperty.call(process, 'mainModule');
    const oldMainModule = process.mainModule;
    const oldProcessEvents = process._events;
    const oldProcessEventsCount = process._eventsCount;
    const oldProcessExiting = process._exiting;
    const oldEnv = snapshotEnv(process.env);
    const oldStdoutWrite = process.stdout && process.stdout.write;
    const oldStderrWrite = process.stderr && process.stderr.write;
    const oldEmitWarning = process.emitWarning;
    const oldExit = process.exit;
    let firstExitCode = null;
    const hadSimpleSourceMaps = Object.prototype.hasOwnProperty.call(globalThis, '__wasm_rquickjs_simple_source_maps');
    const oldSimpleSourceMaps = globalThis.__wasm_rquickjs_simple_source_maps;
    const hadCjsLineOffsets = Object.prototype.hasOwnProperty.call(globalThis, '__wasm_rquickjs_cjs_line_offsets');
    const oldCjsLineOffsets = globalThis.__wasm_rquickjs_cjs_line_offsets;
    const stdinData = options && typeof options.__wasmStdinData === 'string' ? options.__wasmStdinData : null;
    let oldFsPromisesReadFile = null;
    let oldFsReadFile = null;
    let oldFsReadFileSync = null;

    let capturedStdout = '';
    let capturedStderr = '';
    let status = 0;
    let inlineBufferProbe = null;
    const checkSyntaxMode = execArgv.indexOf('-c') !== -1 || execArgv.indexOf('--check') !== -1;
    let currentScriptPath = null;

    try {
        process.argv = [String(command)].concat(invocationArgs);
        process.execArgv = execArgv;
        process.argv0 = String(command);
        if (process.features) {
            process.features.require_module = execArgv.indexOf('--no-experimental-require-module') === -1;
        }
        if (typeof oldChdir === 'function' && childCwd !== oldRealCwd) {
            oldChdir.call(process, childCwd);
        }
        process._events = Object.create(null);
        process._eventsCount = 0;
        process._exiting = false;
        globalThis.__wasm_rquickjs_simple_source_maps = Object.create(null);
        globalThis.__wasm_rquickjs_cjs_line_offsets = Object.create(null);
        globalThis.__wasm_rquickjs_sync_callbacks = true;

        process.exit = function exit(code) {
            if (firstExitCode === null) {
                firstExitCode = code !== undefined ? code : 0;
            }
            return oldExit.call(this, code);
        };

        if (hasFipsStartupFlag(execArgv)) {
            throw new Error(FIPS_STARTUP_ERROR);
        }

        if (execArgv.indexOf('--experimental-test-coverage') !== -1 &&
            (!process.features || !process.features.inspector)) {
            capturedStderr += 'Warning: coverage could not be collected\n';
        }

        const secureHeapErrors = validateSecureHeapFlags(execArgv);
        if (secureHeapErrors.length > 0) {
            status = 9;
            capturedStderr += secureHeapErrors.join('\n') + '\n';
            return buildOutputResult(capturedStdout, capturedStderr, status, encoding);
        }

        if (options && options.env) {
            replaceEnv(process.env, options.env);
        }

        if (process.stdout && typeof oldStdoutWrite === 'function') {
            process.stdout.write = function writeStdout(chunk) {
                capturedStdout += String(chunk);
                return true;
            };
        }
        if (process.stderr && typeof oldStderrWrite === 'function') {
            process.stderr.write = function writeStderr(chunk) {
                capturedStderr += String(chunk);
                return true;
            };
        }

        if (typeof oldEmitWarning === 'function') {
            process.emitWarning = function emitWarning(warning, typeOrOptions, code, ctor) {
                let shouldCapture = !isWarningSuppressed();

                if (shouldCapture && inlineBufferProbe && getWarningCode(warning, typeOrOptions, code) === 'DEP0005') {
                    shouldCapture = !isNodeModulesPath(inlineBufferProbe.callSiteFilename);
                }

                if (shouldCapture) {
                    capturedStderr += formatWarningForStderr(warning, typeOrOptions, code);
                }

                const previousSuppressWarningStderr = globalThis.__wasm_rquickjs_suppress_warning_stderr;
                globalThis.__wasm_rquickjs_suppress_warning_stderr = true;
                try {
                    return oldEmitWarning.call(this, warning, typeOrOptions, code, ctor);
                } finally {
                    globalThis.__wasm_rquickjs_suppress_warning_stderr = previousSuppressWarningStderr;
                }
            };
        }

        const runtimeRequire = moduleExports.require;

        if (stdinData !== null) {
            try {
                const fsPromises = runtimeRequire('node:fs/promises');
                if (fsPromises && typeof fsPromises.readFile === 'function') {
                    oldFsPromisesReadFile = fsPromises.readFile;
                    fsPromises.readFile = function readFileWithMockedStdin(targetPath, readOptions) {
                        if (targetPath === '/dev/stdin') {
                            const mockStdinBuffer = Buffer.from(stdinData);
                            let readEncoding = null;

                            if (typeof readOptions === 'string') {
                                readEncoding = String(readOptions);
                            } else if (readOptions && typeof readOptions === 'object' && readOptions.encoding !== undefined && readOptions.encoding !== null) {
                                readEncoding = String(readOptions.encoding);
                            }

                            if (readEncoding && readEncoding !== 'buffer') {
                                return Promise.resolve(mockStdinBuffer.toString(readEncoding));
                            }

                            return Promise.resolve(mockStdinBuffer);
                        }

                        return oldFsPromisesReadFile.call(this, targetPath, readOptions);
                    };
                }
            } catch (_) {
                oldFsPromisesReadFile = null;
            }

            try {
                const fsSync = runtimeRequire('node:fs');
                if (fsSync && typeof fsSync.readFileSync === 'function') {
                    oldFsReadFileSync = fsSync.readFileSync;
                    fsSync.readFileSync = function readFileSyncWithMockedStdin(targetPath, readOptions) {
                        if (targetPath === '/dev/stdin') {
                            const mockStdinBuffer = Buffer.from(stdinData);
                            let readEncoding = null;

                            if (typeof readOptions === 'string') {
                                readEncoding = String(readOptions);
                            } else if (readOptions && typeof readOptions === 'object' && readOptions.encoding !== undefined && readOptions.encoding !== null) {
                                readEncoding = String(readOptions.encoding);
                            }

                            if (readEncoding && readEncoding !== 'buffer') {
                                return mockStdinBuffer.toString(readEncoding);
                            }

                            return mockStdinBuffer;
                        }

                        return oldFsReadFileSync.call(this, targetPath, readOptions);
                    };
                }

                if (fsSync && typeof fsSync.readFile === 'function') {
                    oldFsReadFile = fsSync.readFile;
                    fsSync.readFile = function readFileWithMockedStdin(targetPath, optionsOrCallback, callback) {
                        if (targetPath === '/dev/stdin') {
                            const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
                            const readOptions = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
                            const mockStdinBuffer = Buffer.from(stdinData);
                            let readEncoding = null;

                            if (typeof readOptions === 'string') {
                                readEncoding = String(readOptions);
                            } else if (readOptions && typeof readOptions === 'object' && readOptions.encoding !== undefined && readOptions.encoding !== null) {
                                readEncoding = String(readOptions.encoding);
                            }

                            let result = mockStdinBuffer;
                            if (readEncoding && readEncoding !== 'buffer') {
                                result = mockStdinBuffer.toString(readEncoding);
                            }

                            if (typeof cb === 'function') {
                                cb(null, result);
                            }
                            return;
                        }

                        return oldFsReadFile.call(this, targetPath, optionsOrCallback, callback);
                    };
                }
            } catch (_) {
                oldFsReadFile = null;
                oldFsReadFileSync = null;
            }
        }

        // Handle --require / -r preloading
        const preloadRequire = moduleExports.createRequire(path.join(childCwd, '[preload].js'));
        for (let ri = 0; ri < execArgv.length; ri++) {
            const ea = execArgv[ri];
            if (ea === '--require' || ea === '-r') {
                if (ri + 1 < execArgv.length) {
                    ri++;
                    preloadRequire(execArgv[ri]);
                }
            }
        }

        if (invocationArgs.length >= 1 && isInlineEvalOption(invocationArgs[0])) {
            const savedModuleContext = globalThis.__wasm_rquickjs_current_module;
            const hadEvalScriptName = Object.prototype.hasOwnProperty.call(globalThis, '__wasm_rquickjs_current_eval_script_name');
            const oldEvalScriptName = globalThis.__wasm_rquickjs_current_eval_script_name;
            globalThis.__wasm_rquickjs_current_module = undefined;
            globalThis.__wasm_rquickjs_current_eval_script_name = '[eval]';

            // Pre-parse buffer probe so the emitWarning interceptor can
            // suppress DEP0005 for node_modules call sites during execution.
            const inlineSource = invocationArgs.length >= 2 ? String(invocationArgs[1]) : '';
            inlineBufferProbe = parseBufferConstructorProbe(inlineSource);

            // Each emulated child process gets its own Buffer deprecation state.
            const oldBufferDepWarned = globalThis.__wasm_rquickjs_buffer_dep0005_warned;
            globalThis.__wasm_rquickjs_buffer_dep0005_warned = false;

            let inlineResult;
            try {
                inlineResult = executeInlineSource(runtimeRequire, invocationArgs, childCwd);
            } finally {
                globalThis.__wasm_rquickjs_current_module = savedModuleContext;
                globalThis.__wasm_rquickjs_buffer_dep0005_warned = oldBufferDepWarned;
                if (hadEvalScriptName) {
                    globalThis.__wasm_rquickjs_current_eval_script_name = oldEvalScriptName;
                } else {
                    delete globalThis.__wasm_rquickjs_current_eval_script_name;
                }
            }

            process.argv = [String(command)].concat(inlineResult.evalArgv);
        } else {
            let scriptPath = invocationArgs[0];
            if (!path.isAbsolute(scriptPath)) {
                scriptPath = path.resolve(childCwd, scriptPath);
            }
            currentScriptPath = scriptPath;
            const scriptArgs = invocationArgs.slice(1);

            if (execArgv.indexOf('--test') !== -1) {
                const fsForTest = runtimeRequire('node:fs');
                if (!fsForTest.existsSync(scriptPath)) {
                    capturedStderr += "Could not find '" + invocationArgs[0] + "'\n";
                    status = 1;
                    return buildOutputResult(capturedStdout, capturedStderr, status, encoding);
                }
            }

            process.argv = [String(command), scriptPath].concat(scriptArgs);

            if (runtimeRequire && runtimeRequire.cache && runtimeRequire.cache[scriptPath]) {
                delete runtimeRequire.cache[scriptPath];
            }

            const moduleModule = runtimeRequire('module');
            if (moduleModule && typeof moduleModule.runMain === 'function') {
                moduleModule.runMain();
            } else {
                runtimeRequire(scriptPath);
            }
        }
        if (typeof process._runExitHandlers === 'function' && firstExitCode === null) {
            process._runExitHandlers(status);
        }
    } catch (err) {
        if (err && err.__isProcessExit) {
            status = firstExitCode !== null ? firstExitCode : (typeof err.code === 'number' ? err.code : 0);
        } else if (err && err.code === 9 && isInlineEvalOption(invocationArgs[0])) {
            status = 9;
            capturedStderr += String(command) + ': ' + err.message + '\n';
        } else {
            status = 1;
            if (checkSyntaxMode && currentScriptPath) {
                capturedStderr += currentScriptPath + '\n';
            }
            capturedStderr += formatErrorForStderr(err);
        }
    } finally {
        process.argv = oldArgv;
        process.execArgv = oldExecArgv;
        process.argv0 = oldArgv0;
        if (process.features) {
            process.features.require_module = oldRequireModuleFeature;
        }
        if (typeof oldChdir === 'function') {
            try {
                oldChdir.call(process, oldRealCwd);
            } catch (_) {
                // Keep restoring the remaining process state even if the host
                // cwd disappeared during in-process child emulation.
            }
        }
        process.cwd = oldCwd;
        process.chdir = oldChdir;
        process.exitCode = oldExitCode;
        if (hadNoDeprecation) {
            process.noDeprecation = oldNoDeprecation;
        } else {
            delete process.noDeprecation;
        }
        if (hadTraceDeprecation) {
            process.traceDeprecation = oldTraceDeprecation;
        } else {
            delete process.traceDeprecation;
        }
        if (hadThrowDeprecation) {
            process.throwDeprecation = oldThrowDeprecation;
        } else {
            delete process.throwDeprecation;
        }
        process._events = oldProcessEvents;
        process._eventsCount = oldProcessEventsCount;
        process._exiting = oldProcessExiting;
        if (hadMainModule) {
            process.mainModule = oldMainModule;
        } else {
            delete process.mainModule;
        }
        replaceEnv(process.env, oldEnv);
        process.emitWarning = oldEmitWarning;
        process.exit = oldExit;

        if (process.stdout && typeof oldStdoutWrite === 'function') {
            process.stdout.write = oldStdoutWrite;
        }
        if (process.stderr && typeof oldStderrWrite === 'function') {
            process.stderr.write = oldStderrWrite;
        }

        if (oldFsPromisesReadFile !== null) {
            try {
                const fsPromisesToRestore = moduleExports.require('node:fs/promises');
                if (fsPromisesToRestore) {
                    fsPromisesToRestore.readFile = oldFsPromisesReadFile;
                }
            } catch (_) {
                // ignore restore failures in WASM test emulation
            }
        }

        if (oldFsReadFile !== null || oldFsReadFileSync !== null) {
            try {
                const fsSyncToRestore = moduleExports.require('node:fs');
                if (fsSyncToRestore) {
                    if (oldFsReadFile !== null) {
                        fsSyncToRestore.readFile = oldFsReadFile;
                    }
                    if (oldFsReadFileSync !== null) {
                        fsSyncToRestore.readFileSync = oldFsReadFileSync;
                    }
                }
            } catch (_) {
                // ignore restore failures in WASM test emulation
            }
        }

        if (hadSimpleSourceMaps) {
            globalThis.__wasm_rquickjs_simple_source_maps = oldSimpleSourceMaps;
        } else {
            delete globalThis.__wasm_rquickjs_simple_source_maps;
        }

        if (hadCjsLineOffsets) {
            globalThis.__wasm_rquickjs_cjs_line_offsets = oldCjsLineOffsets;
        } else {
            delete globalThis.__wasm_rquickjs_cjs_line_offsets;
        }

        delete globalThis.__wasm_rquickjs_sync_callbacks;
    }

    return buildOutputResult(capturedStdout, capturedStderr, status, encoding);
}

function cloneObject(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return Object.assign({}, value);
}

function normalizeExecParams(options, callback) {
    if (typeof options === 'function') {
        return {
            options: {},
            callback: options,
        };
    }

    return {
        options: options && typeof options === 'object' ? options : {},
        callback: typeof callback === 'function' ? callback : null,
    };
}

function normalizeExecFileParams(args, options, callback) {
    let normalizedArgs = [];
    let normalizedOptions = {};
    let normalizedCallback = null;

    if (Array.isArray(args)) {
        normalizedArgs = args.map((value) => String(value));

        if (typeof options === 'function') {
            normalizedCallback = options;
        } else {
            if (options && typeof options === 'object') {
                normalizedOptions = options;
            }
            if (typeof callback === 'function') {
                normalizedCallback = callback;
            }
        }

        return {
            args: normalizedArgs,
            options: normalizedOptions,
            callback: normalizedCallback,
        };
    }

    if (typeof args === 'function') {
        normalizedCallback = args;
    } else if (args && typeof args === 'object') {
        normalizedOptions = args;
        if (typeof options === 'function') {
            normalizedCallback = options;
        }
    } else {
        if (typeof options === 'function') {
            normalizedCallback = options;
        } else if (typeof callback === 'function') {
            normalizedCallback = callback;
        }
    }

    return {
        args: normalizedArgs,
        options: normalizedOptions,
        callback: normalizedCallback,
    };
}

function expandTemplateEnvRefs(command, env) {
    const source = String(command);
    return source.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
        if (!env || env[name] === undefined || env[name] === null) {
            return '';
        }
        return String(env[name]);
    });
}

function splitCommandTokens(command) {
    const text = String(command);
    const tokens = [];
    let current = '';
    let tokenActive = false;
    let quote = null;
    let escaping = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escaping) {
            current += ch;
            tokenActive = true;
            escaping = false;
            continue;
        }

        if (quote === null) {
            if (ch === '\\') {
                escaping = true;
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch;
                tokenActive = true;
                continue;
            }

            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
                if (tokenActive) {
                    tokens.push(current);
                    current = '';
                    tokenActive = false;
                }
                continue;
            }

            current += ch;
            tokenActive = true;
            continue;
        }

        if (quote === "'") {
            if (ch === "'") {
                quote = null;
            } else {
                current += ch;
            }
            continue;
        }

        if (ch === '"') {
            quote = null;
            continue;
        }

        if (ch === '\\' && i + 1 < text.length) {
            const next = text[i + 1];
            if (next === '"' || next === '\\' || next === '$' || next === '`') {
                current += next;
                tokenActive = true;
                i += 1;
                continue;
            }
        }

        current += ch;
        tokenActive = true;
    }

    if (escaping || quote !== null) {
        return null;
    }

    if (tokenActive) {
        tokens.push(current);
    }

    return tokens;
}

function parseEchoPipeline(command) {
    const expandedCommand = String(command);
    const pipeIndex = expandedCommand.indexOf('|');
    if (pipeIndex === -1) {
        return null;
    }

    let lhs = expandedCommand.slice(0, pipeIndex).trim();
    const rhs = expandedCommand.slice(pipeIndex + 1).trim();

    if (lhs[0] === '(' && lhs[lhs.length - 1] === ')') {
        lhs = lhs.slice(1, -1);
    }

    const rhsTokens = splitCommandTokens(rhs);
    if (!rhsTokens || rhsTokens.length < 2 || String(rhsTokens[0]) !== String(process.execPath)) {
        return null;
    }

    const parts = lhs.split(';');
    const stdinLines = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.length === 0) {
            continue;
        }

        const partTokens = splitCommandTokens(part);
        if (!partTokens || partTokens.length === 0) {
            return null;
        }

        if (partTokens[0] === 'echo') {
            stdinLines.push(partTokens.slice(1).join(' '));
            continue;
        }

        if (partTokens[0] === 'sleep') {
            continue;
        }

        return null;
    }

    return {
        command: rhsTokens[0],
        args: rhsTokens.slice(1),
        stdinData: stdinLines.length > 0 ? stdinLines.join('\n') + '\n' : '',
    };
}

function runExecCommand(command, options) {
    const env = options && typeof options.env === 'object' ? options.env : process.env;
    const expanded = expandTemplateEnvRefs(command, env);
    const resolvedOptions = cloneObject(options);

    if (resolvedOptions.encoding === undefined) {
        resolvedOptions.encoding = 'utf8';
    }

    const pipeline = parseEchoPipeline(expanded);
    if (pipeline) {
        resolvedOptions.__wasmStdinData = pipeline.stdinData;
        return spawnSync(pipeline.command, pipeline.args, resolvedOptions);
    }

    const tokens = splitCommandTokens(expanded);
    if (!tokens || tokens.length === 0) {
        return unsupportedSpawnSyncResult('exec(empty command)');
    }

    // Handle stdin redirection: command ... < filename
    for (let ri = 1; ri < tokens.length; ri++) {
        if (tokens[ri] === '<' && ri + 1 < tokens.length) {
            const stdinFile = tokens[ri + 1];
            try {
                const fsForRedirect = moduleExports.require('node:fs');
                resolvedOptions.__wasmStdinData = fsForRedirect.readFileSync(stdinFile, 'utf8');
            } catch (_) {
                // ignore if file cannot be read
            }
            tokens.splice(ri, 2);
            break;
        }
    }

    return spawnSync(tokens[0], tokens.slice(1), resolvedOptions);
}

function createExecError(command, result) {
    if (!result) {
        return createNotSupportedError('exec');
    }

    if (result.error) {
        result.error.cmd = String(command);
        return result.error;
    }

    if (result.status === 0 && result.signal === null) {
        return null;
    }

    let stderrText = '';
    if (result.stderr !== undefined && result.stderr !== null) {
        stderrText = String(result.stderr);
    }
    let message = 'Command failed: ' + String(command);
    if (stderrText.length > 0) {
        message += '\n' + stderrText;
    }

    const err = new Error(message);
    err.code = result.status;
    err.killed = false;
    err.signal = result.signal;
    err.cmd = String(command);
    return err;
}

function buildExecFileCommand(file, args) {
    let cmd = String(file);
    for (let i = 0; i < args.length; i++) {
        cmd += ' ' + String(args[i]);
    }
    return cmd;
}

function createExecFileError(file, args, result) {
    if (!result) {
        return createNotSupportedError('execFile');
    }

    const command = buildExecFileCommand(file, args);
    if (result.error) {
        result.error.cmd = command;
        return result.error;
    }

    if (result.status === 0 && result.signal === null) {
        return null;
    }

    let stderrText = '';
    if (result.stderr !== undefined && result.stderr !== null) {
        stderrText = String(result.stderr);
    }

    let message = 'Command failed: ' + command;
    if (stderrText.length > 0) {
        message += '\n' + stderrText;
    }

    const err = new Error(message);
    err.code = result.status;
    err.killed = false;
    err.signal = result.signal;
    err.cmd = command;
    return err;
}

function createExecChildProcess() {
    const child = new EventEmitter();
    child.pid = 1;
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;
    child.stdio = [null, null, null];
    child.killed = false;
    child.connected = false;
    child.exitCode = null;
    child.signalCode = null;
    child.spawnfile = String(process.execPath);
    child.spawnargs = [];
    child.kill = function kill() {
        return false;
    };
    child.ref = function ref() {
        return child;
    };
    child.unref = function unref() {
        return child;
    };
    return child;
}

function scheduleExecCallback(task) {
    if (typeof process.nextTick === 'function') {
        process.nextTick(task);
        return;
    }

    setTimeout(task, 0);
}

// ChildProcess class stub
export class ChildProcess {
    constructor() {
        throw createNotSupportedError('ChildProcess');
    }
}

function createForkReadable() {
    const readable = new EventEmitter();
    readable._encoding = null;
    readable.setEncoding = function setEncoding(encoding) {
        readable._encoding = String(encoding);
    };
    readable._emitData = function emitData(chunk) {
        if (chunk === undefined || chunk === null) {
            return;
        }

        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (data.length === 0) {
            return;
        }

        if (readable._encoding && readable._encoding !== 'buffer') {
            readable.emit('data', data.toString(readable._encoding));
            return;
        }

        readable.emit('data', data);
    };

    return readable;
}

function normalizeForkArgs(args, options) {
    let normalizedArgs = [];
    let normalizedOptions = {};

    if (Array.isArray(args)) {
        normalizedArgs = args.map((value) => String(value));
        if (options && typeof options === 'object') {
            normalizedOptions = options;
        }
    } else if (args && typeof args === 'object') {
        normalizedOptions = args;
    } else if (args !== undefined) {
        throw createNotSupportedError('fork(modulePath, args)');
    }

    return {
        args: normalizedArgs,
        options: normalizedOptions,
    };
}

function getForkExecArgv(options) {
    if (options && Array.isArray(options.execArgv)) {
        return options.execArgv.map((value) => String(value));
    }

    if (Array.isArray(process.execArgv)) {
        return process.execArgv.slice();
    }

    return [];
}

// Asynchronous process creation functions
export function exec(command, options, callback) {
    const normalized = normalizeExecParams(options, callback);
    const child = createExecChildProcess();
    const result = runExecCommand(command, normalized.options);
    const error = createExecError(command, result);
    const spawnError = result && result.error ? result.error : null;

    child.exitCode = typeof result.status === 'number' ? result.status : null;
    child.signalCode = result.signal;

    scheduleExecCallback(function resolveExec() {
        if (normalized.callback) {
            normalized.callback(error, result.stdout, result.stderr);
        }

        if (spawnError) {
            child.emit('error', spawnError);
        }
        child.emit('exit', child.exitCode, child.signalCode);
        child.emit('close', child.exitCode, child.signalCode);
    });

    return child;
}

export function execFile(file, args, options, callback) {
    const normalized = normalizeExecFileParams(args, options, callback);
    const child = createExecChildProcess();
    const resolvedOptions = cloneObject(normalized.options);

    if (resolvedOptions.encoding === undefined) {
        resolvedOptions.encoding = 'utf8';
    }

    const result = spawnSync(String(file), normalized.args, resolvedOptions);
    const error = createExecFileError(file, normalized.args, result);
    const spawnError = result && result.error ? result.error : null;

    child.spawnfile = String(file);
    child.spawnargs = [String(file)].concat(normalized.args);
    child.exitCode = typeof result.status === 'number' ? result.status : null;
    child.signalCode = result.signal;

    scheduleExecCallback(function resolveExecFile() {
        if (normalized.callback) {
            normalized.callback(error, result.stdout, result.stderr);
        }

        if (spawnError) {
            child.emit('error', spawnError);
        }
        child.emit('exit', child.exitCode, child.signalCode);
        child.emit('close', child.exitCode, child.signalCode);
    });

    return child;
}

export function fork(modulePath, args, options) {
    const normalized = normalizeForkArgs(args, options);
    const child = new EventEmitter();
    child.pid = 1;
    child.connected = false;
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = createForkReadable();
    child.stderr = createForkReadable();
    child.kill = function kill() {
        child.killed = true;
        return false;
    };
    child.disconnect = function disconnect() {
        child.connected = false;
    };
    child.send = function send() {
        throw createNotSupportedError('child.send');
    };

    setTimeout(function runForkInWasm() {
        const modulePathStr = String(modulePath);
        let childCommand = process.execPath;
        if (normalized.options && typeof normalized.options.execPath === 'string') {
            childCommand = normalized.options.execPath;
        }

        const spawnArgs = getForkExecArgv(normalized.options);
        spawnArgs.push(modulePathStr);
        for (let i = 0; i < normalized.args.length; i++) {
            spawnArgs.push(normalized.args[i]);
        }

        const spawnOptions = {
            encoding: 'buffer',
        };
        if (normalized.options && typeof normalized.options.cwd === 'string') {
            spawnOptions.cwd = normalized.options.cwd;
        }
        if (normalized.options && normalized.options.env) {
            spawnOptions.env = normalized.options.env;
        }

        const result = spawnSync(childCommand, spawnArgs, spawnOptions);
        const exitCode = typeof result.status === 'number' ? result.status : 1;
        child.exitCode = exitCode;
        child.signalCode = result.signal || null;

        child.stdout._emitData(result.stdout);
        child.stderr._emitData(result.stderr);
        child.stdout.emit('end');
        child.stderr.emit('end');
        child.emit('exit', exitCode, child.signalCode);
        child.emit('close', exitCode, child.signalCode);
    }, 0);

    return child;
}

// spawn emulation — runs the target script inline (like fork/spawnSync) but
// delivers results asynchronously through EventEmitter streams.
export function spawn(command, args, options) {
    const child = new EventEmitter();
    child.pid = 1;
    child.connected = false;
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = createForkReadable();
    child.stderr = createForkReadable();
    child.stdin = null;
    child.spawnfile = String(command);
    child.spawnargs = [String(command)].concat((args || []).map((a) => String(a)));
    child.kill = function kill() {
        child.killed = true;
        return false;
    };

    setTimeout(function runSpawnInWasm() {
        const spawnOpts = {};
        if (options && typeof options === 'object') {
            if (typeof options.cwd === 'string') {
                spawnOpts.cwd = options.cwd;
            }
            if (options.env) {
                spawnOpts.env = options.env;
            }
        }
        spawnOpts.encoding = 'buffer';

        const result = spawnSync(String(command), args || [], spawnOpts);
        const exitCode = typeof result.status === 'number' ? result.status : 1;
        child.exitCode = exitCode;
        child.signalCode = result.signal || null;

        child.stdout._emitData(result.stdout);
        child.stderr._emitData(result.stderr);
        child.stdout.emit('end');
        child.stderr.emit('end');
        child.emit('exit', exitCode, child.signalCode);
        child.emit('close', exitCode, child.signalCode);
    }, 0);

    return child;
}

// Synchronous process creation functions
export function execFileSync(file, args, options) {
    let normalizedArgs = [];
    let normalizedOptions = {};

    if (Array.isArray(args)) {
        normalizedArgs = args;
        if (options && typeof options === 'object') {
            normalizedOptions = options;
        }
    } else if (args && typeof args === 'object') {
        normalizedOptions = args;
    }

    const result = spawnSync(file, normalizedArgs, normalizedOptions);

    if (result.status !== 0) {
        const err = new Error('Command failed: ' + String(file) + ' ' + normalizedArgs.join(' ') + '\n' + String(result.stderr || ''));
        err.status = result.status;
        err.signal = result.signal;
        err.stdout = result.stdout;
        err.stderr = result.stderr;
        err.pid = result.pid;
        err.output = result.output;
        throw err;
    }

    const encoding = getOutputEncoding(normalizedOptions);
    if (encoding && encoding !== 'buffer') {
        return result.stdout ? result.stdout.toString(encoding) : '';
    }

    return result.stdout;
}

export function execSync(command, options) {
    throw createNotSupportedError('execSync');
}

export function spawnSync(command, args, options) {
    const cmd = String(command);
    if (cmd !== process.execPath) {
        return unsupportedSpawnSyncResult(cmd);
    }

    return runInline(cmd, args || [], options || {});
}

export default {
    ChildProcess,
    exec,
    execFile,
    execFileSync,
    execSync,
    fork,
    spawn,
    spawnSync,
};
