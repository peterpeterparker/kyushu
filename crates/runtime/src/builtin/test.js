// node:test — Phase 1 implementation
// Provides test(), describe(), it(), suite(), and lifecycle hooks.
// Tests run synchronously/eagerly when called. Failures are collected
// and an aggregate error is thrown after all tests in a suite complete.

import assert from 'node:assert';
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from '__wasm_rquickjs_builtin/internal/errors';
import { validateNumber, validateInteger } from '__wasm_rquickjs_builtin/internal/validators';

let currentSuite = null;
// Check for globalThis-based filter (set by test harness before file execution)
let _subtestFilter = (typeof globalThis.__wasm_rquickjs_node_test_filter === 'number')
    ? globalThis.__wasm_rquickjs_node_test_filter
    : null;
let _subtestRegistrationIndex = 0;

// --- Custom assertions registry (testAssertions.register) ---
const _customAssertions = {};

const testAssertionsModule = {
    register: function register(name, fn) {
        if (typeof name !== 'string') {
            throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
        }
        if (typeof fn !== 'function') {
            throw new ERR_INVALID_ARG_TYPE('fn', 'function', fn);
        }
        _customAssertions[name] = fn;
    }
};

// --- Suite context ---

function SuiteContext(name, parent, filePath) {
    this.name = name;
    this.parent = parent;
    this.filePath = filePath || (parent ? parent.filePath : undefined);
    this.tests = [];
    this.beforeFns = [];
    this.afterFns = [];
    this.beforeEachFns = [];
    this.afterEachFns = [];
}

Object.defineProperty(SuiteContext.prototype, 'fullName', {
    get: function () {
        if (this.parent && this.parent.name) {
            return `${this.parent.fullName} > ${this.name}`;
        }
        return this.name || '';
    }
});

SuiteContext.prototype.collectBeforeEach = function () {
    let fns = [];
    if (this.parent) {
        fns = this.parent.collectBeforeEach();
    }
    return fns.concat(this.beforeEachFns);
};

SuiteContext.prototype.collectAfterEach = function () {
    let fns = this.afterEachFns.slice();
    if (this.parent) {
        fns = fns.concat(this.parent.collectAfterEach());
    }
    return fns;
};

// --- Test context (t) ---

function TestContext(name, parent, filePath) {
    this.name = name;
    this.signal = { aborted: false };
    this.filePath = filePath || (parent ? parent.filePath : undefined);
    this._parent = parent;
    this._suite = (parent instanceof SuiteContext) ? parent : (parent ? parent._suite : null);
    this._diagnostics = [];
    this._skipMessage = undefined;
    this._todoMessage = undefined;
    this._beforeFns = [];
    this._afterFns = [];
    this._beforeEachFns = [];
    this._afterEachFns = [];
    this.mock = new MockTracker();
    this._planCount = undefined;
    this._assertionCount = 0;

    // Build t.assert: copy assert methods excluding AssertionError, CallTracker, strict,
    // and add snapshot/fileSnapshot per Node.js spec.
    // All methods are wrapped to track assertion count for t.plan().
    const uncopiedKeys = ['AssertionError', 'CallTracker', 'strict'];
    const tAssert = {};
    const self = this;
    const assertKeys = Object.keys(assert);
    for (let i = 0; i < assertKeys.length; i++) {
        const key = assertKeys[i];
        if (!uncopiedKeys.includes(key)) {
            tAssert[key] = wrapAssertForPlan(assert[key], self);
        }
    }
    tAssert.snapshot = wrapAssertForPlan(function snapshot(_value, _options) {
        throw new Error('snapshot is not supported in this context');
    }, self);
    tAssert.fileSnapshot = wrapAssertForPlan(function fileSnapshot(_value, _path) {
        throw new Error('fileSnapshot is not supported in this context');
    }, self);
    // Apply custom assertions registered via testAssertions.register()
    const customKeys = Object.keys(_customAssertions);
    for (let ci = 0; ci < customKeys.length; ci++) {
        const ckey = customKeys[ci];
        tAssert[ckey] = wrapAssertForPlan(wrapCustomAssertion(_customAssertions[ckey], this), self);
    }
    this.assert = tAssert;
}

Object.defineProperty(TestContext.prototype, 'fullName', {
    get: function () {
        const parentName = this._parent ? this._parent.fullName : '';
        if (parentName) {
            return `${parentName} > ${this.name}`;
        }
        return this.name;
    }
});

TestContext.prototype.diagnostic = function (msg) {
    this._diagnostics.push(msg);
};

TestContext.prototype.skip = function (msg) {
    this._skipMessage = msg || 'skipped';
    throw new SkipError(this._skipMessage);
};

TestContext.prototype.todo = function (msg) {
    this._todoMessage = msg || 'TODO';
    throw new TodoError(this._todoMessage);
};

TestContext.prototype.test = function (name, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(name, optionsOrFn, maybeFn);
    const fn = parsed.fn;
    const parentTest = this;

    // Handle skip
    if (isSkipOption(parsed.options.skip)) {
        return Promise.resolve();
    }

    const childCtx = new TestContext(parsed.name, parentTest);
    const restoreMocks = function () { childCtx.mock.restoreAll(); };

    try {
        if (fn.length >= 2) {
            // done callback pattern
            return new Promise(function (resolve, reject) {
                const done = function (err) {
                    restoreMocks();
                    if (err) reject(err);
                    else resolve();
                };
                try {
                    fn.call(childCtx, childCtx, done);
                } catch (e) {
                    restoreMocks();
                    reject(e);
                }
            });
        }

        const result = fn.call(childCtx, childCtx);
        if (result && typeof result.then === 'function') {
            return result.then(function () {
                restoreMocks();
            }, function (e) {
                restoreMocks();
                throw e;
            });
        }
        restoreMocks();
        return Promise.resolve();
    } catch (e) {
        restoreMocks();
        if (e instanceof SkipError) {
            return Promise.resolve();
        }
        return Promise.reject(e);
    }
};

TestContext.prototype.before = function (fn) {
    this._beforeFns.push(fn);
};

TestContext.prototype.after = function (fn) {
    this._afterFns.push(fn);
};

TestContext.prototype.beforeEach = function (fn) {
    this._beforeEachFns.push(fn);
};

TestContext.prototype.afterEach = function (fn) {
    this._afterEachFns.push(fn);
};

TestContext.prototype.plan = function plan(count) {
    validateInteger(count, 'count', 0);
    this._planCount = count;
    this._assertionCount = 0;
};

TestContext.prototype.waitFor = function waitFor(condition, options) {
    if (typeof condition !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('condition', 'function', condition);
    }

    if (options !== undefined && (options === null || typeof options !== 'object')) {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }

    const opts = options || {};

    if (opts.interval !== undefined && typeof opts.interval !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('options.interval', 'number', opts.interval);
    }

    if (opts.timeout !== undefined && typeof opts.timeout !== 'number') {
        throw new ERR_INVALID_ARG_TYPE('options.timeout', 'number', opts.timeout);
    }

    const interval = opts.interval !== undefined ? opts.interval : 50;
    const timeout = opts.timeout !== undefined ? opts.timeout : 30000;

    return new Promise(function (resolve, reject) {
        let lastError = null;
        let done = false;
        let pollTimerId = null;

        const timeoutId = setTimeout(function () {
            if (done) return;
            done = true;
            if (pollTimerId !== null) {
                clearTimeout(pollTimerId);
            }
            const err = new Error('waitFor() timed out');
            if (lastError) {
                err.cause = lastError;
            }
            reject(err);
        }, timeout);

        let running = false;

        function poll() {
            if (done || running) return;
            running = true;

            try {
                const result = condition();
                if (result && typeof result.then === 'function') {
                    result.then(function (val) {
                        running = false;
                        if (!done) {
                            done = true;
                            clearTimeout(timeoutId);
                            resolve(val);
                        }
                    }, function (e) {
                        running = false;
                        lastError = e;
                        if (!done) {
                            pollTimerId = setTimeout(poll, interval);
                        }
                    });
                } else {
                    running = false;
                    if (!done) {
                        done = true;
                        clearTimeout(timeoutId);
                        resolve(result);
                    }
                }
            } catch (e) {
                running = false;
                lastError = e;
                if (!done) {
                    pollTimerId = setTimeout(poll, interval);
                }
            }
        }

        poll();
    });
};

// --- Helpers ---

function isSkipOption(skip) {
    return skip === true || (typeof skip === 'string' && skip);
}

function wrapCustomAssertion(fn, ctx) {
    return function () { return fn.apply(ctx, arguments); };
}

function wrapAssertForPlan(fn, ctx) {
    return function () {
        ctx._assertionCount++;
        return fn.apply(this, arguments);
    };
}

function checkPlan(ctx) {
    if (ctx._planCount !== undefined && ctx._assertionCount !== ctx._planCount) {
        throw new Error(
            'Expected ' + ctx._planCount + ' assertion(s) but received ' + ctx._assertionCount
        );
    }
}

function runHookList(hooks) {
    for (let i = 0; i < hooks.length; i++) hooks[i]();
}

function runHookListSafe(hooks) {
    for (let i = 0; i < hooks.length; i++) {
        try { hooks[i](); } catch (ignored) {}
    }
}

// --- Sentinel errors ---

function SkipError(message) {
    this.message = message;
    this.name = 'SkipError';
}
SkipError.prototype = Object.create(Error.prototype);
SkipError.prototype.constructor = SkipError;

function TodoError(message) {
    this.message = message;
    this.name = 'TodoError';
}
TodoError.prototype = Object.create(Error.prototype);
TodoError.prototype.constructor = TodoError;

// --- Argument parsing ---

function parseTestArgs(nameOrOpts, optionsOrFn, maybeFn) {
    let name, options, fn;

    if (typeof nameOrOpts === 'function') {
        // (fn) form
        fn = nameOrOpts;
        name = fn.name || '<anonymous>';
        options = {};
    } else if (typeof nameOrOpts === 'string' || typeof nameOrOpts === 'undefined') {
        name = nameOrOpts || '<anonymous>';
        if (typeof optionsOrFn === 'function') {
            // (name, fn) form
            fn = optionsOrFn;
            options = {};
        } else if (typeof optionsOrFn === 'object' && optionsOrFn !== null) {
            // (name, opts, fn) form
            options = optionsOrFn;
            fn = maybeFn;
        } else {
            options = {};
            fn = maybeFn;
        }
    } else if (typeof nameOrOpts === 'object' && nameOrOpts !== null) {
        // (opts, fn) form
        options = nameOrOpts;
        fn = optionsOrFn;
        name = options.name || (fn && fn.name) || '<anonymous>';
    } else {
        name = String(nameOrOpts);
        options = {};
        fn = optionsOrFn;
    }

    if (!options) options = {};
    if (!fn) fn = function () {};

    // Validate timeout option
    if (options.timeout != null && options.timeout !== Infinity) {
        validateNumber(options.timeout, 'options.timeout', 0, 2147483647);
    }

    // Validate concurrency option
    if (options.concurrency != null && typeof options.concurrency !== 'boolean') {
        validateInteger(options.concurrency, 'options.concurrency', 1, 2 ** 31);
    }

    const moduleContext = globalThis.__wasm_rquickjs_current_module;
    let capturedModuleContext = undefined;
    if (moduleContext && typeof moduleContext.source === 'string') {
        capturedModuleContext = {
            filename: moduleContext.filename,
            source: moduleContext.source
        };
    }

    return { name: name, options: options, fn: fn, moduleContext: capturedModuleContext };
}

// --- Run a single test ---

function runTest(parsed, parentSuite) {
    const name = parsed.name;
    const options = parsed.options;
    const fn = parsed.fn;
    const moduleContext = parsed.moduleContext;

    const previousModuleContext = globalThis.__wasm_rquickjs_current_module;
    const hasModuleContext = !!(moduleContext && typeof moduleContext.source === 'string');
    if (hasModuleContext) {
        globalThis.__wasm_rquickjs_current_module = moduleContext;
    }

    const restoreModuleContext = function () {
        if (hasModuleContext) {
            globalThis.__wasm_rquickjs_current_module = previousModuleContext;
        }
    };

    let isAsync = false;

    // Handle skip
    if (isSkipOption(options.skip)) {
        restoreModuleContext();
        return { status: 'skip', name: name, message: typeof options.skip === 'string' ? options.skip : '' };
    }

    // Handle todo
    const isTodo = options.todo === true || typeof options.todo === 'string';

    const filePath = moduleContext ? moduleContext.filename : undefined;
    const ctx = new TestContext(name, parentSuite, filePath);

    // Collect beforeEach from parent suite chain
    const beforeEachFns = parentSuite ? parentSuite.collectBeforeEach() : [];
    const afterEachFns = parentSuite ? parentSuite.collectAfterEach() : [];

    const cleanup = function () {
        runHookListSafe(ctx._afterFns);
        ctx.mock.restoreAll();
    };

    try {
        // Run beforeEach hooks
        runHookList(beforeEachFns);

        // Handle done callback pattern (fn.length >= 2)
        if (fn.length >= 2) {
            const donePromise = new Promise(function (resolve, reject) {
                const done = function (err) {
                    if (err) reject(err);
                    else resolve();
                };
                try {
                    fn.call(ctx, ctx, done);
                } catch (e) {
                    reject(e);
                }
            });
            const asyncResult = donePromise.then(function () {
                checkPlan(ctx);
                cleanup();
                runHookList(afterEachFns);
                restoreModuleContext();
                if (isTodo) {
                    return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
                }
                return { status: 'pass', name: name };
            }, function (e) {
                cleanup();
                runHookListSafe(afterEachFns);
                restoreModuleContext();
                if (e instanceof SkipError) {
                    return { status: 'skip', name: name, message: e.message };
                }
                if (e instanceof TodoError) {
                    return { status: 'todo', name: name, message: e.message };
                }
                if (isTodo) {
                    return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
                }
                return { status: 'fail', name: name, error: e };
            });
            isAsync = true;
            return { status: 'async', name: name, promise: asyncResult };
        }

        // Run the test function with ctx as both `this` and first argument
        const result = fn.call(ctx, ctx);

        // If test returned a promise, return an async result that can be awaited
        if (result && typeof result.then === 'function') {
            const asyncResult = result.then(function () {
                checkPlan(ctx);
                cleanup();
                runHookList(afterEachFns);
                restoreModuleContext();
                if (isTodo) {
                    return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
                }
                return { status: 'pass', name: name };
            }, function (e) {
                cleanup();
                runHookListSafe(afterEachFns);
                restoreModuleContext();
                if (e instanceof SkipError) {
                    return { status: 'skip', name: name, message: e.message };
                }
                if (e instanceof TodoError) {
                    return { status: 'todo', name: name, message: e.message };
                }
                if (isTodo) {
                    return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
                }
                return { status: 'fail', name: name, error: e };
            });
            isAsync = true;
            return { status: 'async', name: name, promise: asyncResult };
        }

        checkPlan(ctx);
        cleanup();
        runHookList(afterEachFns);

        if (isTodo) {
            return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
        }

        return { status: 'pass', name: name };
    } catch (e) {
        cleanup();
        runHookListSafe(afterEachFns);

        if (e instanceof SkipError) {
            return { status: 'skip', name: name, message: e.message };
        }
        if (e instanceof TodoError) {
            return { status: 'todo', name: name, message: e.message };
        }
        if (isTodo) {
            return { status: 'todo', name: name, message: typeof options.todo === 'string' ? options.todo : '' };
        }
        return { status: 'fail', name: name, error: e };
    } finally {
        if (!isAsync) {
            restoreModuleContext();
        }
    }
}

// --- Run a suite ---

function runSuite(name, options, fn, parentSuite, moduleContext) {
    // Handle skip
    if (isSkipOption(options.skip)) {
        return { status: 'skip', name: name };
    }

    const isTodo = options.todo === true || typeof options.todo === 'string';

    const filePath = moduleContext ? moduleContext.filename : undefined;
    const suite = new SuiteContext(name, parentSuite, filePath);
    const prevSuite = currentSuite;
    currentSuite = suite;

    try {
        // Run the describe/suite callback to discover tests
        const result = fn(suite);
        if (result && typeof result.then === 'function') {
            // Async suite discovery — need to await it
            return {
                status: 'async-suite',
                name: name,
                promise: result
            };
        }
    } catch (e) {
        currentSuite = prevSuite;
        if (isTodo) {
            return { status: 'todo', name: name };
        }
        return { status: 'fail', name: name, error: e };
    }

    currentSuite = prevSuite;
    return executeSuite(suite, isTodo, options.concurrency === true);
}

function executeSuite(suite, isTodo, concurrent) {
    let failures = 0;
    const errors = [];

    // Run before hooks
    for (let b = 0; b < suite.beforeFns.length; b++) {
        try {
            suite.beforeFns[b]();
        } catch (e) {
            if (!isTodo) {
                return { status: 'fail', name: suite.name, error: e };
            }
            return { status: 'todo', name: suite.name };
        }
    }

    function handleResult(result) {
        if (result && result.status === 'fail') {
            failures++;
            errors.push(result.error || new Error(`Test "${result.name}" failed`));
        }
    }

    function finalize() {
        // Run after hooks (always, even on failure)
        for (let a = 0; a < suite.afterFns.length; a++) {
            try {
                suite.afterFns[a]();
            } catch (e) {
                failures++;
                errors.push(e);
            }
        }

        if (isTodo) {
            return { status: 'todo', name: suite.name };
        }

        if (failures > 0) {
            let error;
            if (errors.length === 1) {
                error = errors[0];
            } else {
                error = new AggregateError(errors, `${failures} test(s) failed`);
            }
            return { status: 'fail', name: suite.name, error: error };
        }

        return { status: 'pass', name: suite.name };
    }

    let idx = 0;

    function runNext() {
        while (idx < suite.tests.length) {
            const entry = suite.tests[idx++];
            let result;
            if (entry.type === 'suite') {
                result = runSuite(entry.name, entry.options, entry.fn, suite, entry.moduleContext);
            } else {
                result = runTest(entry, suite);
            }

            if (result.status === 'async' || result.status === 'async-suite') {
                const promise = result.promise;
                if (concurrent) {
                    // Concurrent mode: push to pending and continue
                    if (promise) {
                        _pendingTestPromises.push(promise.then(function (resolved) {
                            if (resolved && resolved.status === 'fail') {
                                throw resolved.error || new Error(`Test "${resolved.name}" failed`);
                            }
                        }));
                    }
                    continue;
                } else {
                    // Sequential mode: await this test, then continue
                    if (promise) {
                        return promise.then(function (resolved) {
                            handleResult(resolved);
                            return runNext();
                        });
                    }
                    continue;
                }
            }

            handleResult(result);
        }

        return finalize();
    }

    const finalResult = runNext();

    if (finalResult && typeof finalResult.then === 'function') {
        // Sequential mode produced an async chain; return as async-suite
        return { status: 'async-suite', name: suite.name, promise: finalResult };
    }

    return finalResult;
}

// --- Top-level collection ---

const rootSuite = new SuiteContext('', null);
let _pendingTestPromises = [];

// --- Public API ---

function shouldSkipByFilter() {
    if (_subtestFilter === null && typeof globalThis.__wasm_rquickjs_node_test_filter === 'number') {
        _subtestFilter = globalThis.__wasm_rquickjs_node_test_filter;
    }
    const currentIndex = _subtestRegistrationIndex++;
    return _subtestFilter !== null && currentIndex !== _subtestFilter;
}

function test(nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);

    if (currentSuite) {
        // Inside a describe/suite — register for later execution
        currentSuite.tests.push(parsed);
        return Promise.resolve(undefined);
    }

    if (shouldSkipByFilter()) {
        // Silently skip — filtered out
        return Promise.resolve(undefined);
    }

    // Top-level test — run immediately
    const result = runTest(parsed, rootSuite);
    if (result.status === 'async') {
        const p = result.promise.then(function (resolved) {
            if (resolved && resolved.status === 'fail') {
                throw resolved.error || new Error(`Test "${resolved.name}" failed`);
            }
            return undefined;
        });
        _pendingTestPromises.push(p);
        return p;
    }
    if (result.status === 'fail') {
        throw result.error;
    }
    return Promise.resolve(undefined);
}

test.skip = function (nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);
    parsed.options.skip = true;

    if (currentSuite) {
        currentSuite.tests.push(parsed);
        return Promise.resolve(undefined);
    }
    // Top-level skip — no-op (no failure)
    return Promise.resolve(undefined);
};

test.todo = function (nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);
    parsed.options.todo = true;

    if (currentSuite) {
        currentSuite.tests.push(parsed);
        return Promise.resolve(undefined);
    }
    // Top-level todo — run but don't fail on error
    runTest(parsed, rootSuite);
    return Promise.resolve(undefined);
};

test.only = function (nameOrOpts, optionsOrFn, maybeFn) {
    // only is a no-op filter for now, just run as normal test
    return test(nameOrOpts, optionsOrFn, maybeFn);
};

function describe(nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);

    if (currentSuite) {
        // Nested suite
        currentSuite.tests.push({
            type: 'suite',
            name: parsed.name,
            options: parsed.options,
            fn: parsed.fn,
            moduleContext: parsed.moduleContext
        });
        return;
    }

    if (shouldSkipByFilter()) {
        // Silently skip — filtered out
        return;
    }

    // Top-level suite — run immediately
    const result = runSuite(parsed.name, parsed.options, parsed.fn, rootSuite, parsed.moduleContext);
    if (result.status === 'async-suite') {
        if (result.promise) {
            _pendingTestPromises.push(result.promise.then(function (resolved) {
                if (resolved && resolved.status === 'fail') {
                    throw resolved.error || new Error(`Suite "${resolved.name}" failed`);
                }
            }));
        }
    } else if (result.status === 'fail') {
        throw result.error;
    }
}

describe.skip = function (nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);
    parsed.options.skip = true;

    if (currentSuite) {
        currentSuite.tests.push({
            type: 'suite',
            name: parsed.name,
            options: parsed.options,
            fn: parsed.fn,
            moduleContext: parsed.moduleContext
        });
        return;
    }
    // Top-level skip suite — no-op
};

describe.todo = function (nameOrOpts, optionsOrFn, maybeFn) {
    const parsed = parseTestArgs(nameOrOpts, optionsOrFn, maybeFn);
    parsed.options.todo = true;

    if (currentSuite) {
        currentSuite.tests.push({
            type: 'suite',
            name: parsed.name,
            options: parsed.options,
            fn: parsed.fn,
            moduleContext: parsed.moduleContext
        });
        return;
    }
    runSuite(parsed.name, parsed.options, parsed.fn, rootSuite, parsed.moduleContext);
};

describe.only = function (nameOrOpts, optionsOrFn, maybeFn) {
    return describe(nameOrOpts, optionsOrFn, maybeFn);
};

const it = test;
it.skip = test.skip;
it.todo = test.todo;
it.only = test.only;

const suite = describe;
suite.skip = describe.skip;
suite.todo = describe.todo;
suite.only = describe.only;

// --- Lifecycle hooks ---

function before(fn) {
    if (currentSuite) {
        currentSuite.beforeFns.push(fn);
    } else {
        rootSuite.beforeFns.push(fn);
    }
}

function after(fn) {
    if (currentSuite) {
        currentSuite.afterFns.push(fn);
    } else {
        rootSuite.afterFns.push(fn);
    }
}

function beforeEach(fn) {
    if (currentSuite) {
        currentSuite.beforeEachFns.push(fn);
    } else {
        rootSuite.beforeEachFns.push(fn);
    }
}

function afterEach(fn) {
    if (currentSuite) {
        currentSuite.afterEachFns.push(fn);
    } else {
        rootSuite.afterEachFns.push(fn);
    }
}

// --- MockTracker ---

function removeMockEntry(tracker, obj, methodName) {
    for (let i = tracker._mocks.length - 1; i >= 0; i--) {
        if (tracker._mocks[i].obj === obj && tracker._mocks[i].methodName === methodName) {
            tracker._mocks.splice(i, 1);
            break;
        }
    }
}

function MockTracker() {
    this._mocks = [];
    this._fnMocks = [];
    this._moduleMocks = [];
}

MockTracker.prototype.method = function (obj, methodName, implementation, options) {
    // Handle overloaded signature: method(obj, name, options) vs method(obj, name, impl, options)
    if (implementation !== null && typeof implementation === 'object' && !options) {
        options = implementation;
        implementation = undefined;
    }
    options = options || {};

    // Validate obj
    if (obj === null || obj === undefined) {
        throw new ERR_INVALID_ARG_TYPE('object', 'Object', obj);
    }

    // Validate methodName type
    if (typeof methodName !== 'string' && typeof methodName !== 'symbol') {
        throw new ERR_INVALID_ARG_TYPE('methodName', ['string', 'symbol'], methodName);
    }

    if (options.getter && options.setter) {
        throw new Error("The property 'options.setter' cannot be used with 'options.getter'");
    }

    // Check property exists on the object (own or inherited)
    if (!(methodName in obj) && !options.getter && !options.setter) {
        throw new ERR_INVALID_ARG_VALUE('methodName', methodName, 'must be a method');
    }

    // For regular method mocking (not getter/setter), check that the property is a function
    if (!options.getter && !options.setter && typeof obj[methodName] !== 'function') {
        throw new TypeError("The argument 'methodName' must be a method");
    }

    const tracker = this;
    const callLog = [];
    const mockInfo = {
        calls: callLog,
        callCount: function () { return callLog.length; },
        resetCalls: function () { callLog.length = 0; },
    };

    if (options.getter) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, methodName) || {};
        const originalGetter = descriptor.get;

        const spyGetter = function () {
            const callRecord = { arguments: [], result: undefined, error: undefined, target: undefined, this: this };
            try {
                let result;
                if (implementation) {
                    result = implementation.call(this);
                } else if (originalGetter) {
                    result = originalGetter.call(this);
                }
                callRecord.result = result;
                callLog.push(callRecord);
                return result;
            } catch (e) {
                callRecord.error = e;
                callLog.push(callRecord);
                throw e;
            }
        };

        mockInfo.restore = function () {
            Object.defineProperty(obj, methodName, {
                get: originalGetter,
                set: descriptor.set,
                configurable: true,
                enumerable: descriptor.enumerable !== false,
            });
            removeMockEntry(tracker, obj, methodName);
        };

        const getterWrapper = { mock: mockInfo };
        Object.defineProperty(obj, methodName, {
            get: spyGetter,
            set: descriptor.set,
            configurable: true,
            enumerable: descriptor.enumerable !== false,
        });
        this._mocks.push({ obj: obj, methodName: methodName, type: 'getter', originalDescriptor: descriptor });
        return getterWrapper;
    } else if (options.setter) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, methodName) || {};
        const originalSetter = descriptor.set;

        const spySetter = function (val) {
            const callRecord = { arguments: [val], result: undefined, error: undefined, target: undefined, this: this };
            try {
                let result;
                if (implementation) {
                    result = implementation.call(this, val);
                } else if (originalSetter) {
                    result = originalSetter.call(this, val);
                }
                callRecord.result = result;
                callLog.push(callRecord);
            } catch (e) {
                callRecord.error = e;
                callLog.push(callRecord);
                throw e;
            }
        };

        mockInfo.restore = function () {
            Object.defineProperty(obj, methodName, {
                get: descriptor.get,
                set: originalSetter,
                configurable: true,
                enumerable: descriptor.enumerable !== false,
            });
            removeMockEntry(tracker, obj, methodName);
        };

        const setterWrapper = { mock: mockInfo };
        Object.defineProperty(obj, methodName, {
            get: descriptor.get,
            set: spySetter,
            configurable: true,
            enumerable: descriptor.enumerable !== false,
        });
        this._mocks.push({ obj: obj, methodName: methodName, type: 'setter', originalDescriptor: descriptor });
        return setterWrapper;
    }

    // Regular method mocking (no getter/setter)

    // Check if property is configurable (for non-configurable own properties)
    const ownDescriptor = Object.getOwnPropertyDescriptor(obj, methodName);
    if (ownDescriptor && !ownDescriptor.configurable && !ownDescriptor.writable) {
        throw new TypeError('Cannot redefine property: ' + String(methodName));
    }

    const original = obj[methodName];

    mockInfo.restore = function () {
        obj[methodName] = original;
        removeMockEntry(tracker, obj, methodName);
    };

    const wrapper = function () {
        const args = Array.prototype.slice.call(arguments);
        const callRecord = { arguments: args, result: undefined, error: undefined, target: undefined, this: this };
        try {
            let result;
            if (implementation) {
                result = implementation.apply(this, arguments);
            } else {
                result = original.apply(this, arguments);
            }
            callRecord.result = result;
            callLog.push(callRecord);
            return result;
        } catch (e) {
            callRecord.error = e;
            callLog.push(callRecord);
            throw e;
        }
    };
    // Copy name and length from original function
    Object.defineProperty(wrapper, 'name', Object.getOwnPropertyDescriptor(original, 'name') || { value: '', configurable: true });
    Object.defineProperty(wrapper, 'length', Object.getOwnPropertyDescriptor(original, 'length') || { value: 0, configurable: true });
    wrapper.mock = mockInfo;

    obj[methodName] = wrapper;
    this._mocks.push({ obj: obj, methodName: methodName, original: original });

    return wrapper;
};

MockTracker.prototype.fn = function (original, implementation, options) {
    // Handle overloaded signatures:
    // fn() → no-op spy
    // fn(options) → no-op spy with options
    // fn(original) → spy on original
    // fn(original, implementation) → mock original with implementation
    // fn(original, options) → spy with options
    // fn(original, implementation, options) → mock with options
    if (typeof original === 'object' && original !== null) {
        options = original;
        original = undefined;
        implementation = undefined;
    } else if (typeof implementation === 'object' && implementation !== null) {
        options = implementation;
        implementation = undefined;
    }
    options = options || {};

    if ('times' in options) {
        if (typeof options.times !== 'number') {
            throw new TypeError('The "options.times" property must be of type number');
        }
        if (options.times < 1 || !Number.isInteger(options.times)) {
            throw new RangeError('The value of "options.times" is out of range');
        }
    }

    const originalFn = typeof original === 'function' ? original : function () {};
    let currentImpl = typeof implementation === 'function' ? implementation : originalFn;
    const callLog = [];
    let timesRemaining = options.times;
    const onceImpls = {};

    const mockInfo = {
        calls: callLog,
        callCount: function () { return callLog.length; },
        resetCalls: function () { callLog.length = 0; },
        restore: function () {
            currentImpl = originalFn;
            timesRemaining = undefined;
        },
        mockImplementation: function (newImpl) {
            currentImpl = newImpl;
        },
        mockImplementationOnce: function (newImpl, onCall) {
            if (onCall !== undefined) {
                if (onCall < callLog.length) {
                    throw new RangeError(`The value of "onCall" is out of range. It must be >= ${callLog.length}`);
                }
            } else {
                onCall = callLog.length;
                while (onceImpls.hasOwnProperty(onCall)) {
                    onCall++;
                }
            }
            onceImpls[onCall] = newImpl;
        },
    };

    const wrapper = function () {
        const args = Array.prototype.slice.call(arguments);
        const isConstructorCall = new.target !== undefined;
        const callRecord = { arguments: args, result: undefined, error: undefined, target: isConstructorCall ? originalFn : undefined, this: undefined };
        const callIndex = callLog.length;
        try {
            let fn;
            if (onceImpls.hasOwnProperty(callIndex)) {
                fn = onceImpls[callIndex];
                delete onceImpls[callIndex];
            } else if (timesRemaining !== undefined && timesRemaining > 0) {
                fn = currentImpl;
                timesRemaining--;
                if (timesRemaining === 0) {
                    currentImpl = originalFn;
                    timesRemaining = undefined;
                }
            } else {
                fn = currentImpl;
            }
            let result;
            if (isConstructorCall) {
                result = Reflect.construct(fn, args, originalFn);
                callRecord.this = result;
            } else {
                result = fn.apply(this, arguments);
                callRecord.this = this;
            }
            callRecord.result = result;
            callLog.push(callRecord);
            return result;
        } catch (e) {
            callRecord.error = e;
            callLog.push(callRecord);
            throw e;
        }
    };
    // Copy name and length from original function
    const nameDesc = Object.getOwnPropertyDescriptor(originalFn, 'name');
    const lengthDesc = Object.getOwnPropertyDescriptor(originalFn, 'length');
    if (nameDesc) Object.defineProperty(wrapper, 'name', nameDesc);
    if (lengthDesc) Object.defineProperty(wrapper, 'length', lengthDesc);
    wrapper.mock = mockInfo;
    this._fnMocks.push(mockInfo);
    return wrapper;
};

MockTracker.prototype.restoreAll = function () {
    for (let i = this._mocks.length - 1; i >= 0; i--) {
        const m = this._mocks[i];
        if (m.type === 'getter' || m.type === 'setter') {
            const desc = m.originalDescriptor;
            Object.defineProperty(m.obj, m.methodName, {
                get: desc.get,
                set: desc.set,
                configurable: true,
                enumerable: desc.enumerable !== false,
            });
        } else {
            m.obj[m.methodName] = m.original;
        }
    }
    this._mocks = [];
    for (let i = 0; i < this._fnMocks.length; i++) {
        this._fnMocks[i].restore();
    }
    this._fnMocks = [];
    // Restore module mocks in reverse order
    for (let i = this._moduleMocks.length - 1; i >= 0; i--) {
        this._moduleMocks[i].restore();
    }
    this._moduleMocks = [];
};

MockTracker.prototype.reset = function () {
    this.restoreAll();
};

MockTracker.prototype.getter = function (obj, methodName, implementation, options) {
    if (typeof implementation === 'object' && implementation !== null && !options) {
        options = implementation;
        implementation = undefined;
    }
    options = options || {};
    if (options.getter === false) {
        throw new Error("The property 'options.getter' cannot be false");
    }
    if (options.setter) {
        throw new Error("The property 'options.setter' cannot be used with 'options.getter'");
    }
    options.getter = true;
    return this.method(obj, methodName, implementation, options);
};

MockTracker.prototype.setter = function (obj, methodName, implementation, options) {
    if (typeof implementation === 'object' && implementation !== null && !options) {
        options = implementation;
        implementation = undefined;
    }
    options = options || {};
    if (options.setter === false) {
        throw new Error("The property 'options.setter' cannot be false");
    }
    if (options.getter) {
        throw new Error("The property 'options.setter' cannot be used with 'options.getter'");
    }
    options.setter = true;
    return this.method(obj, methodName, implementation, options);
};

MockTracker.prototype.module = function module(specifier, options) {
    if (typeof specifier !== 'string' && !(typeof specifier === 'object' && specifier !== null && typeof specifier.href === 'string')) {
        throw new ERR_INVALID_ARG_TYPE('specifier', 'string', specifier);
    }
    if (options !== undefined && options !== null && typeof options === 'object') {
        // valid
    } else if (options !== undefined) {
        throw new ERR_INVALID_ARG_TYPE('options', 'object', options);
    }

    var opts = options || {};

    if (opts.cache !== undefined && typeof opts.cache !== 'boolean') {
        throw new ERR_INVALID_ARG_TYPE('options.cache', 'boolean', opts.cache);
    }
    if (opts.namedExports !== undefined && (opts.namedExports === null || typeof opts.namedExports !== 'object')) {
        throw new ERR_INVALID_ARG_TYPE('options.namedExports', 'object', opts.namedExports);
    }

    var registerFn = globalThis.__wasm_rquickjs_register_module_mock;
    if (!registerFn) {
        throw new Error('Module mocking is not available');
    }

    var handle = registerFn(typeof specifier === 'object' ? specifier.href : specifier, opts);
    if (!handle) {
        throw new Error('Failed to register module mock');
    }

    this._moduleMocks.push(handle);

    return handle;
};

MockTracker.prototype.timers = { enable: function () {}, reset: function () {}, tick: function () {} };

const mock = new MockTracker();

function run() {
    // Stub — no-op for now
    return { on: function () { return this; }, once: function () { return this; } };
}

function __setFilterIndex(idx) {
    _subtestFilter = idx;
    _subtestRegistrationIndex = 0;
}

function __clearFilter() {
    _subtestFilter = null;
    _subtestRegistrationIndex = 0;
}

async function _awaitPendingTests() {
    while (_pendingTestPromises.length > 0) {
        const promises = _pendingTestPromises;
        _pendingTestPromises = [];
        await Promise.all(promises);
    }
}

export {
    test,
    describe,
    it,
    suite,
    before,
    after,
    beforeEach,
    afterEach,
    mock,
    run,
    testAssertionsModule as assert,
    _awaitPendingTests,
    __setFilterIndex,
    __clearFilter
};

export default test;
