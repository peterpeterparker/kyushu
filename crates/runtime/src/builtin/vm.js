import { eval_in_new_context as evalInNewContext } from '__wasm_rquickjs_builtin/vm_native';

let contextIdCounter = 1;
const contextSymbol = Symbol('vm.context');
const identifierPattern = /^[$A-Z_a-z][$0-9A-Z_a-z]*$/;
const moduleNamespaceExportsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceExports');
const moduleNamespaceBindingsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceBindings');

function splitDeclarators(declarationList) {
    const result = [];
    let current = '';
    let depth = 0;
    let quote = '';

    for (let i = 0; i < declarationList.length; i++) {
        const ch = declarationList[i];
        const prev = i > 0 ? declarationList[i - 1] : '';

        if (quote) {
            current += ch;
            if (ch === quote && prev !== '\\') {
                quote = '';
            }
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            current += ch;
            continue;
        }

        if (ch === ')' || ch === ']' || ch === '}') {
            if (depth > 0) depth--;
            current += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            if (current.trim().length > 0) {
                result.push(current.trim());
            }
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim().length > 0) {
        result.push(current.trim());
    }

    return result;
}

function parseSourceTextModuleBindings(source) {
    const bindings = [];
    const exportDeclarationPattern = /export\s+(const|let|var)\s+([^;]+)/g;
    let match;

    while ((match = exportDeclarationPattern.exec(source)) !== null) {
        const kind = match[1];
        const declarators = splitDeclarators(match[2]);

        for (let i = 0; i < declarators.length; i++) {
            const declarator = declarators[i];
            const eq = declarator.indexOf('=');
            const bindingName = (eq === -1 ? declarator : declarator.slice(0, eq)).trim();

            if (!identifierPattern.test(bindingName)) {
                throw new SyntaxError('Unsupported export declaration in vm.SourceTextModule');
            }

            bindings.push({
                name: bindingName,
                kind,
            });
        }
    }

    if (source.indexOf('export ') !== -1 && bindings.length === 0) {
        throw new SyntaxError('Unsupported export declaration in vm.SourceTextModule');
    }

    return bindings;
}

function compileSourceTextModuleEvaluator(source, names) {
    const executableSource = source.replace(/\bexport\s+(?=(?:const|let|var)\b)/g, '');
    const exportObjectEntries = names.map(function(name) {
        return JSON.stringify(name) + ': ' + name;
    }).join(', ');

    return new Function('"use strict";\n' + executableSource + '\nreturn { ' + exportObjectEntries + ' };');
}

function createModuleNamespace(module) {
    const namespaceTarget = Object.create(null);
    const names = module._names.slice().sort();

    // QuickJS does not expose virtual export keys from this proxy via
    // Object.getOwnPropertyNames() while bindings are uninitialized.
    // Store names out-of-band so util.inspect can still enumerate exports.
    Object.defineProperty(namespaceTarget, moduleNamespaceExportsSymbol, {
        value: names.slice(),
        enumerable: false,
        writable: false,
        configurable: false,
    });
    Object.defineProperty(namespaceTarget, moduleNamespaceBindingsSymbol, {
        value: module._bindings,
        enumerable: false,
        writable: false,
        configurable: false,
    });

    Object.defineProperty(namespaceTarget, Symbol.toStringTag, {
        value: 'Module',
        enumerable: false,
        writable: false,
        configurable: true,
    });

    return new Proxy(namespaceTarget, {
        ownKeys: function() {
            return names.concat([Symbol.toStringTag]);
        },
        has: function(_target, prop) {
            if (typeof prop === 'string' && module._bindings[prop] !== undefined) {
                return true;
            }
            return prop in namespaceTarget;
        },
        get: function(_target, prop, receiver) {
            if (typeof prop === 'string' && module._bindings[prop] !== undefined) {
                const binding = module._bindings[prop];
                if (!binding.initialized) {
                    throw new ReferenceError(prop + ' is not initialized');
                }
                return binding.value;
            }
            return Reflect.get(namespaceTarget, prop, receiver);
        },
        getOwnPropertyDescriptor: function(_target, prop) {
            if (typeof prop === 'string' && module._bindings[prop] !== undefined) {
                const binding = module._bindings[prop];
                if (!binding.initialized) {
                    throw new ReferenceError(prop + ' is not initialized');
                }

                return {
                    value: binding.value,
                    writable: true,
                    enumerable: true,
                    configurable: true,
                };
            }

            return Object.getOwnPropertyDescriptor(namespaceTarget, prop);
        },
    });
}

function createIndirectEvalSource(code) {
    return '(0, eval)(' + JSON.stringify(code) + ')';
}

export function runInNewContext(code, sandbox, options) {
    if (code === undefined || code === null) code = '';
    code = String(code);

    const keys = [];
    const values = [];

    if (sandbox && typeof sandbox === 'object') {
        const sandboxKeys = Object.keys(sandbox);
        for (let i = 0; i < sandboxKeys.length; i++) {
            keys.push(sandboxKeys[i]);
            values.push(sandbox[sandboxKeys[i]]);
        }
    }

    return evalInNewContext(createIndirectEvalSource(code), keys, values);
}

export function createContext(sandbox) {
    if (sandbox === undefined || sandbox === null) {
        sandbox = {};
    }
    if (typeof sandbox !== 'object') {
        throw new TypeError('sandbox must be an object');
    }
    sandbox[contextSymbol] = contextIdCounter++;
    return sandbox;
}

export function isContext(obj) {
    return obj != null && typeof obj === 'object' && contextSymbol in obj;
}

export function runInContext(code, context, options) {
    if (!isContext(context)) {
        throw new TypeError('argument must be a vm.Context');
    }
    if (code === undefined || code === null) code = '';
    code = String(code);

    const keys = [];
    const values = [];
    for (const k of Object.keys(context)) {
        if (typeof context[contextSymbol] !== 'undefined' && k === String(contextSymbol)) {
            continue;
        }
        keys.push(k);
        values.push(context[k]);
    }

    return evalInNewContext(createIndirectEvalSource(code), keys, values);
}

export function runInThisContext(code, options) {
    if (code === undefined || code === null) return undefined;
    code = String(code);
    return (0, eval)(code);
}

export function compileFunction(code, params, options) {
    params = params || [];
    return new Function(...params, code);
}

export class Script {
    constructor(code, options) {
        this._code = String(code);
    }

    runInNewContext(sandbox, options) {
        return runInNewContext(this._code, sandbox, options);
    }

    runInContext(context, options) {
        return runInContext(this._code, context, options);
    }

    runInThisContext(options) {
        return runInThisContext(this._code, options);
    }

    createCachedData() {
        return new Uint8Array(0);
    }
}

export class SourceTextModule {
    constructor(code, options) {
        this._source = String(code);
        this._status = 'unlinked';

        const declaredBindings = parseSourceTextModuleBindings(this._source);
        this._bindings = Object.create(null);
        this._names = [];

        for (let i = 0; i < declaredBindings.length; i++) {
            const binding = declaredBindings[i];
            this._names.push(binding.name);
            this._bindings[binding.name] = {
                kind: binding.kind,
                initialized: binding.kind === 'var',
                value: undefined,
            };
        }

        this._evaluateSource = compileSourceTextModuleEvaluator(this._source, this._names);
        this._namespace = createModuleNamespace(this);
    }

    get status() {
        return this._status;
    }

    get namespace() {
        if (this._status === 'unlinked') {
            throw new Error('Module status must be linked');
        }
        return this._namespace;
    }

    async link(linker) {
        this._status = 'linked';
    }

    async evaluate(options) {
        if (this._status === 'unlinked') {
            throw new Error('Module status must be linked before evaluate()');
        }
        if (this._status === 'evaluated') {
            return undefined;
        }

        this._status = 'evaluating';

        try {
            const evaluatedExports = this._evaluateSource();
            for (let i = 0; i < this._names.length; i++) {
                const name = this._names[i];
                const binding = this._bindings[name];
                binding.initialized = true;
                binding.value = evaluatedExports[name];
            }
            this._status = 'evaluated';
            return undefined;
        } catch (err) {
            this._status = 'errored';
            throw err;
        }
    }
}

export function createScript(code, options) {
    return new Script(code, options);
}

const vmExports = {
    runInNewContext,
    runInContext,
    runInThisContext,
    createContext,
    isContext,
    compileFunction,
    Script,
    SourceTextModule,
    createScript,
};

export default vmExports;
