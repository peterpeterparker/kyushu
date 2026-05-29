import {
    open_database, close_database, exec_sql, is_open, is_autocommit,
    stmt_run, stmt_get, stmt_all, stmt_expanded_sql, stmt_columns,
    stmt_iterate_init, stmt_iterate_next, stmt_iterate_return,
    register_function, register_aggregate,
    create_session, session_changeset, session_patchset, session_close,
    apply_changeset,
    get_constants,
    enable_defensive, location, set_authorizer, native_backup,
    serialize_database, restore_database
} from '__wasm_rquickjs_builtin/sqlite_native';

export const constants = get_constants();
const _connIdSymbol = Symbol('connId');

function assertBoolean(value, name) {
    if (typeof value !== 'boolean') {
        const err = new TypeError(`The "${name}" argument must be a boolean`);
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
}

function throwDbNotOpen(code) {
    const err = new Error('database is not open');
    err.code = code;
    throw err;
}

class _DatabaseSyncImpl {
    #connId = null;
    #path;
    #options;

    constructor(path, options = {}) {
        if (typeof path !== 'string') {
            const err = new TypeError('The "path" argument must be a string');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (options !== undefined && (typeof options !== 'object' || options === null)) {
            const err = new TypeError('The "options" argument must be an object');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        this.#path = path;
        this.#options = {
            open: options.open ?? true,
            readOnly: options.readOnly ?? false,
            enableForeignKeyConstraints: options.enableForeignKeyConstraints ?? true,
            enableDoubleQuotedStringLiterals: options.enableDoubleQuotedStringLiterals ?? false,
            allowExtension: options.allowExtension ?? false,
            timeout: options.timeout ?? 0,
            readBigInts: options.readBigInts ?? false,
            returnArrays: options.returnArrays ?? false,
            allowBareNamedParameters: options.allowBareNamedParameters ?? true,
            allowUnknownNamedParameters: options.allowUnknownNamedParameters ?? false,
            defensive: options.defensive ?? true,
        };

        // Validate boolean options
        for (const key of ['open', 'readOnly', 'enableForeignKeyConstraints', 'enableDoubleQuotedStringLiterals', 'allowExtension', 'readBigInts', 'returnArrays', 'allowBareNamedParameters', 'allowUnknownNamedParameters', 'defensive']) {
            if (this.#options[key] !== undefined) {
                assertBoolean(this.#options[key], `options.${key}`);
            }
        }
        if (this.#options.timeout !== undefined && typeof this.#options.timeout !== 'number') {
            const err = new TypeError('The "options.timeout" argument must be a number');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (this.#options.open) {
            this.open();
        }
    }

    open() {
        if (this.#connId !== null) {
            throw Object.assign(new Error('database is already open'), { code: 'ERR_INVALID_STATE' });
        }
        this.#connId = open_database(
            this.#path,
            this.#options.readOnly,
            this.#options.enableForeignKeyConstraints,
            this.#options.enableDoubleQuotedStringLiterals,
            this.#options.timeout
        );
        this[_connIdSymbol] = this.#connId;
        if (!this.#options.defensive) {
            enable_defensive(this.#connId, false);
        }
    }

    close() {
        if (this.#connId === null) throwDbNotOpen('ERR_INVALID_STATE');
        close_database(this.#connId);
        this.#connId = null;
        this[_connIdSymbol] = null;
    }

    [Symbol.dispose]() {
        if (this.#connId !== null) {
            try { this.close(); } catch (e) {}
        }
    }

    exec(sql) {
        if (this.#connId === null) throwDbNotOpen('ERR_INVALID_STATE');
        if (typeof sql !== 'string') {
            const err = new TypeError('The "sql" argument must be a string');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        exec_sql(this.#connId, sql);
    }

    prepare(sql, options = {}) {
        if (this.#connId === null) throwDbNotOpen('ERR_INVALID_STATE');
        if (typeof sql !== 'string') {
            const err = new TypeError('The "sql" argument must be a string');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        const stmtOptions = {
            readBigInts: options.readBigInts ?? this.#options.readBigInts,
            returnArrays: options.returnArrays ?? this.#options.returnArrays,
            allowBareNamedParameters: options.allowBareNamedParameters ?? this.#options.allowBareNamedParameters,
            allowUnknownNamedParameters: options.allowUnknownNamedParameters ?? this.#options.allowUnknownNamedParameters,
        };
        return new StatementSync(_stmtSecret, this.#connId, sql, stmtOptions);
    }

    function(name, optionsOrFn, maybeFn) {
        if (this.#connId === null) throwDbNotOpen('ERR_INVALID_STATE');

        if (typeof name !== 'string') {
            const err = new TypeError('The "name" argument must be a string');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        let options = {};
        let fn;
        if (typeof optionsOrFn === 'function') {
            fn = optionsOrFn;
        } else {
            if (optionsOrFn !== undefined && (typeof optionsOrFn !== 'object' || optionsOrFn === null)) {
                const err = new TypeError('The "options" argument must be an object');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            options = optionsOrFn || {};
            fn = maybeFn;
        }

        if (typeof fn !== 'function') {
            const err = new TypeError('The "function" argument must be a function');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (options.deterministic !== undefined) assertBoolean(options.deterministic, 'options.deterministic');
        if (options.directOnly !== undefined) assertBoolean(options.directOnly, 'options.directOnly');
        if (options.useBigIntArguments !== undefined) assertBoolean(options.useBigIntArguments, 'options.useBigIntArguments');
        if (options.varargs !== undefined) assertBoolean(options.varargs, 'options.varargs');

        const numArgs = options.varargs ? 0 : fn.length;

        register_function(
            this.#connId,
            name,
            fn,
            !!options.deterministic,
            !!options.directOnly,
            !!options.useBigIntArguments,
            !!options.varargs,
            numArgs
        );
    }

    aggregate(name, options) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');

        if (typeof name !== 'string') {
            const err = new TypeError('The "name" argument must be a string');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (typeof options !== 'object' || options === null) {
            const err = new TypeError('The "options" argument must be an object');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (typeof options.step !== 'function') {
            const err = new TypeError('The "options.step" argument must be a function');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        if (options.result !== undefined && options.result !== null && typeof options.result !== 'function') {
            const err = new TypeError('The "options.result" argument must be a function');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }

        // step.length includes the accumulator parameter, so actual SQL args = step.length - 1
        const numArgs = options.varargs ? 0 : Math.max(0, options.step.length - 1);

        register_aggregate(
            this.#connId,
            name,
            options.start !== undefined ? options.start : null,
            options.step,
            options.result || null,
            !!options.deterministic,
            !!options.directOnly,
            !!options.useBigIntArguments,
            !!options.varargs,
            numArgs
        );
    }

    createSession(options) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        if (options !== undefined) {
            if (typeof options !== 'object' || options === null) {
                const err = new TypeError('The "options" argument must be an object.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (options.table !== undefined && typeof options.table !== 'string') {
                const err = new TypeError('The "options.table" argument must be a string.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (options.db !== undefined && typeof options.db !== 'string') {
                const err = new TypeError('The "options.db" argument must be a string.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
        const tableName = (options && options.table) || null;
        const dbName = (options && options.db) || 'main';
        const sessionId = create_session(this.#connId, tableName, dbName);
        return new Session(sessionId, this.#connId);
    }

    applyChangeset(changeset, options) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        if (!(changeset instanceof Uint8Array)) {
            const err = new TypeError('The "changeset" argument must be a Uint8Array.');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (options !== undefined) {
            if (typeof options !== 'object' || options === null) {
                const err = new TypeError('The "options" argument must be an object.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (options.filter !== undefined && typeof options.filter !== 'function') {
                const err = new TypeError('The "options.filter" argument must be a function.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            if (options.onConflict !== undefined && typeof options.onConflict !== 'function') {
                const err = new TypeError('The "options.onConflict" argument must be a function.');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
        }
        const onConflict = options && options.onConflict ? options.onConflict : null;
        const filter = options && options.filter ? options.filter : null;
        return apply_changeset(this.#connId, changeset, onConflict, filter);
    }

    createTagStore(maxSize = 1000) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        return new SQLTagStore(this, maxSize);
    }

    enableDefensive(active) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        assertBoolean(active, 'active');
        enable_defensive(this.#connId, active);
    }

    location(dbName) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        return location(this.#connId);
    }

    setAuthorizer(callback) {
        if (this.#connId === null) throwDbNotOpen('ERR_SQLITE_ERROR');
        if (callback !== null && callback !== undefined && typeof callback !== 'function') {
            const err = new TypeError('The "callback" argument must be a function or null');
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        set_authorizer(this.#connId, callback || null);
    }

    loadExtension(path) {
        const err = new Error('Extension loading is not supported in WASM');
        err.code = 'ERR_SQLITE_ERROR';
        throw err;
    }

    enableLoadExtension(allow) {
        const err = new Error('Extension loading is not supported in WASM');
        err.code = 'ERR_SQLITE_ERROR';
        throw err;
    }

    get isOpen() {
        return this.#connId !== null && is_open(this.#connId);
    }

    get isTransaction() {
        if (this.#connId === null) return false;
        return !is_autocommit(this.#connId);
    }
}

export function DatabaseSync(path, options) {
    if (!new.target) {
        const err = new TypeError('Cannot call constructor without `new`');
        err.code = 'ERR_CONSTRUCT_CALL_REQUIRED';
        throw err;
    }
    return new _DatabaseSyncImpl(path, options);
}
DatabaseSync.prototype = _DatabaseSyncImpl.prototype;

export class Session {
    #sessionId;
    #connId;
    #closed = false;

    constructor(sessionId, connId) {
        this.#sessionId = sessionId;
        this.#connId = connId;
        this.#closed = false;
    }

    #checkOpen() {
        if (this.#closed) {
            throw Object.assign(new Error('session is not open'), { code: 'ERR_SQLITE_ERROR' });
        }
        if (!is_open(this.#connId)) throwDbNotOpen('ERR_SQLITE_ERROR');
    }

    changeset() {
        this.#checkOpen();
        return session_changeset(this.#sessionId);
    }

    patchset() {
        this.#checkOpen();
        return session_patchset(this.#sessionId);
    }

    close() {
        this.#checkOpen();
        session_close(this.#sessionId);
        this.#closed = true;
    }

    [Symbol.dispose]() {
        if (!this.#closed) {
            try { this.close(); } catch(e) {}
        }
    }
}

const _stmtSecret = Symbol('stmtSecret');

export class StatementSync {
    #connId;
    #sql;
    #options;
    #lastParams = null;

    constructor(secret, connId, sql, options) {
        if (secret !== _stmtSecret) {
            const err = new TypeError('Illegal constructor');
            err.code = 'ERR_ILLEGAL_CONSTRUCTOR';
            throw err;
        }
        this.#connId = connId;
        this.#sql = sql;
        this.#options = options;
    }

    #processParams(args) {
        if (args.length === 0) return null;
        // If first arg is a plain object (not null, not array, not typed array, not DataView), use as named params
        const first = args[0];
        if (first !== null && first !== undefined && typeof first === 'object'
            && !Array.isArray(first) && !ArrayBuffer.isView(first)
            && !(first instanceof DataView)) {
            if (args.length > 1) {
                const err = new TypeError('Cannot mix named parameters object with positional arguments');
                err.code = 'ERR_INVALID_ARG_TYPE';
                throw err;
            }
            return first; // Return as object for named binding
        }
        // All args are positional — wrap in array
        return Array.from(args);
    }

    run(...args) {
        const params = this.#processParams(args);
        this.#lastParams = params;
        return stmt_run(this.#connId, this.#sql, params,
            this.#options.allowBareNamedParameters,
            this.#options.allowUnknownNamedParameters,
            this.#options.readBigInts);
    }

    get(...args) {
        const params = this.#processParams(args);
        this.#lastParams = params;
        return stmt_get(this.#connId, this.#sql, params,
            this.#options.allowBareNamedParameters,
            this.#options.allowUnknownNamedParameters,
            this.#options.readBigInts,
            this.#options.returnArrays);
    }

    all(...args) {
        const params = this.#processParams(args);
        this.#lastParams = params;
        return stmt_all(this.#connId, this.#sql, params,
            this.#options.allowBareNamedParameters,
            this.#options.allowUnknownNamedParameters,
            this.#options.readBigInts,
            this.#options.returnArrays);
    }

    columns() {
        return stmt_columns(this.#connId, this.#sql);
    }

    iterate(...args) {
        const params = this.#processParams(args);
        this.#lastParams = params;
        const iterId = stmt_iterate_init(this.#connId, this.#sql, params,
            this.#options.allowBareNamedParameters,
            this.#options.allowUnknownNamedParameters);
        const readBigInts = this.#options.readBigInts;
        const returnArrays = this.#options.returnArrays;

        return {
            [Symbol.iterator]() { return this; },
            next() {
                return stmt_iterate_next(iterId, readBigInts, returnArrays);
            },
            return() {
                stmt_iterate_return(iterId);
                return { value: undefined, done: true };
            },
            toArray() {
                const result = [];
                let step;
                while (!(step = this.next()).done) {
                    result.push(step.value);
                }
                return result;
            }
        };
    }

    get sourceSQL() {
        return this.#sql;
    }

    get expandedSQL() {
        if (this.#lastParams !== null && this.#lastParams !== undefined) {
            return stmt_expanded_sql(this.#connId, this.#sql, this.#lastParams,
                this.#options.allowBareNamedParameters);
        }
        return this.#sql;
    }

    setReadBigInts(enabled) {
        assertBoolean(enabled, 'readBigInts');
        this.#options.readBigInts = enabled;
    }
    setReturnArrays(enabled) {
        assertBoolean(enabled, 'returnArrays');
        this.#options.returnArrays = enabled;
    }
    setAllowBareNamedParameters(enabled) {
        assertBoolean(enabled, 'allowBareNamedParameters');
        this.#options.allowBareNamedParameters = enabled;
    }
    setAllowUnknownNamedParameters(enabled) {
        assertBoolean(enabled, 'allowUnknownNamedParameters');
        this.#options.allowUnknownNamedParameters = enabled;
    }
}

export class SQLTagStore {
    #db;
    #maxSize;
    #cache;
    #order;

    constructor(db, maxSize = 1000) {
        this.#db = db;
        this.#maxSize = maxSize;
        this.#cache = new Map();
        this.#order = [];
    }

    #getOrPrepare(strings) {
        if (this.#cache.has(strings)) {
            const idx = this.#order.indexOf(strings);
            if (idx !== -1) {
                this.#order.splice(idx, 1);
                this.#order.push(strings);
            }
            return this.#cache.get(strings).stmt;
        }

        let sql = strings[0];
        for (let i = 1; i < strings.length; i++) {
            sql += '?' + strings[i];
        }

        const stmt = this.#db.prepare(sql);

        while (this.#order.length >= this.#maxSize) {
            const oldest = this.#order.shift();
            this.#cache.delete(oldest);
        }

        this.#cache.set(strings, { stmt, sql });
        this.#order.push(strings);

        return stmt;
    }

    get(strings, ...values) {
        const stmt = this.#getOrPrepare(strings);
        return stmt.get(...values);
    }

    all(strings, ...values) {
        const stmt = this.#getOrPrepare(strings);
        return stmt.all(...values);
    }

    run(strings, ...values) {
        const stmt = this.#getOrPrepare(strings);
        return stmt.run(...values);
    }

    iterate(strings, ...values) {
        const stmt = this.#getOrPrepare(strings);
        return stmt.iterate(...values);
    }

    clear() {
        this.#cache.clear();
        this.#order = [];
    }

    get size() {
        return this.#cache.size;
    }

    get capacity() {
        return this.#maxSize;
    }

    get db() {
        return this.#db;
    }
}

export async function backup(sourceDb, path, options = {}) {
    if (!(sourceDb instanceof DatabaseSync)) {
        throw new TypeError('sourceDb must be a DatabaseSync instance');
    }
    const connId = sourceDb[_connIdSymbol];
    if (connId === null || connId === undefined) throwDbNotOpen('ERR_SQLITE_ERROR');
    if (typeof path !== 'string') {
        throw new TypeError('path must be a string');
    }
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new TypeError('options must be an object');
    }
    const source = (options && options.source) || 'main';
    const target = (options && options.target) || 'main';
    const rate = (options && options.rate) || 100;
    return native_backup(connId, path, source, target, rate);
}

export const serializeDatabase = serialize_database;
export const restoreDatabase = restore_database;

function _getConnId(db) {
    if (!(db instanceof DatabaseSync)) {
        throw new TypeError('db must be a DatabaseSync instance');
    }
    const connId = db[_connIdSymbol];
    if (connId === null || connId === undefined) throwDbNotOpen('ERR_SQLITE_ERROR');
    return connId;
}

export function serializeDatabaseSync(db) {
    return serialize_database(_getConnId(db));
}

export function restoreDatabaseSync(db, bytes) {
    return restore_database(_getConnId(db), bytes);
}

export function isAutocommitDatabaseSync(db) {
    return is_autocommit(_getConnId(db));
}

export default { DatabaseSync, StatementSync, Session, SQLTagStore, constants, backup, serializeDatabase, restoreDatabase, serializeDatabaseSync, restoreDatabaseSync, isAutocommitDatabaseSync };
