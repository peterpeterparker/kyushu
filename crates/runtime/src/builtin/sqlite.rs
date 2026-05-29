use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::panic::{RefUnwindSafe, UnwindSafe};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use rquickjs::qjs;
use rusqlite::OpenFlags;
use rusqlite::functions::FunctionFlags;
use rusqlite::types::ValueRef;

const MAX_SAFE_INTEGER: i64 = 9007199254740991; // 2^53 - 1
const MIN_SAFE_INTEGER: i64 = -9007199254740991;

use rusqlite::ffi::sqlite3_errstr;

struct ConnectionTable {
    connections: HashMap<u32, rusqlite::Connection>,
    next_id: u32,
}

impl ConnectionTable {
    fn new() -> Self {
        Self {
            connections: HashMap::new(),
            next_id: 1,
        }
    }

    fn insert(&mut self, conn: rusqlite::Connection) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.connections.insert(id, conn);
        id
    }
}

struct IteratorState {
    col_names: Vec<String>,
    values: Vec<Vec<rusqlite::types::Value>>,
    position: usize,
}

struct IteratorTable {
    iterators: HashMap<u32, IteratorState>,
    next_id: u32,
}

impl IteratorTable {
    fn new() -> Self {
        Self {
            iterators: HashMap::new(),
            next_id: 1,
        }
    }

    fn insert(&mut self, state: IteratorState) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.iterators.insert(id, state);
        id
    }
}

struct SessionState {
    session: rusqlite::session::Session<'static>,
    conn_id: u32,
}

// SAFETY: WASM is single-threaded; Session is never actually sent across threads.
unsafe impl Send for SessionState {}

struct SessionTable {
    sessions: HashMap<u32, SessionState>,
    next_id: u32,
}

impl SessionTable {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    fn insert(&mut self, state: SessionState) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.sessions.insert(id, state);
        id
    }
}

static CONN_TABLE: LazyLock<Mutex<ConnectionTable>> =
    LazyLock::new(|| Mutex::new(ConnectionTable::new()));

static ITER_TABLE: LazyLock<Mutex<IteratorTable>> =
    LazyLock::new(|| Mutex::new(IteratorTable::new()));

static SESSION_TABLE: LazyLock<Mutex<SessionTable>> =
    LazyLock::new(|| Mutex::new(SessionTable::new()));

thread_local! {
    static JS_CTX_PTR: Cell<*mut qjs::JSContext> = const { Cell::new(std::ptr::null_mut()) };
}

struct JsCtxGuard {
    prev: *mut qjs::JSContext,
}

impl JsCtxGuard {
    fn new(ctx_ptr: *mut qjs::JSContext) -> Self {
        let prev = JS_CTX_PTR.with(|p| {
            let prev = p.get();
            p.set(ctx_ptr);
            prev
        });
        JsCtxGuard { prev }
    }
}

impl Drop for JsCtxGuard {
    fn drop(&mut self) {
        JS_CTX_PTR.with(|p| p.set(self.prev));
    }
}

thread_local! {
    static PENDING_JS_EXCEPTION: RefCell<Option<rquickjs::Persistent<rquickjs::Value<'static>>>> = const { RefCell::new(None) };
}

fn save_pending_js_exception<'js>(ctx: &rquickjs::Ctx<'js>, val: rquickjs::Value<'js>) {
    PENDING_JS_EXCEPTION.with(|p| {
        *p.borrow_mut() = Some(rquickjs::Persistent::save(ctx, val));
    });
}

fn take_pending_js_exception<'js>(ctx: &rquickjs::Ctx<'js>) -> Option<rquickjs::Value<'js>> {
    PENDING_JS_EXCEPTION.with(|p| {
        p.borrow_mut()
            .take()
            .and_then(|persistent| persistent.restore(ctx).ok())
    })
}

fn map_sqlite_or_udf_error<'js>(ctx: &rquickjs::Ctx<'js>, err: rusqlite::Error) -> rquickjs::Error {
    if let Some(pending) = take_pending_js_exception(ctx) {
        return ctx.throw(pending);
    }
    sqlite_error(ctx, &err)
}

#[derive(Clone)]
struct SendPersistent<T>(rquickjs::Persistent<T>);

// SAFETY: WASM is single-threaded; Persistent is never actually sent across threads.
unsafe impl<T> Send for SendPersistent<T> {}
unsafe impl<T> Sync for SendPersistent<T> {}

impl<T: Clone> SendPersistent<T> {
    fn clone_inner(&self) -> rquickjs::Persistent<T> {
        self.0.clone()
    }
}

fn sqlite_error<'js>(ctx: &rquickjs::Ctx<'js>, err: &rusqlite::Error) -> rquickjs::Error {
    match create_sqlite_error(ctx, err) {
        Ok(e) => e,
        Err(_) => rquickjs::Exception::throw_message(ctx, &format!("SQLite error: {}", err)),
    }
}

fn create_sqlite_error<'js>(
    ctx: &rquickjs::Ctx<'js>,
    err: &rusqlite::Error,
) -> rquickjs::Result<rquickjs::Error> {
    let (message, errcode_val, errstr_val) = match err {
        rusqlite::Error::SqliteFailure(ffi_err, msg) => {
            let message = msg.as_deref().unwrap_or("unknown error").to_string();
            let extended = ffi_err.extended_code;
            let primary = extended & 0xFF;
            let errstr = unsafe {
                let ptr = sqlite3_errstr(primary);
                std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
            };
            (message, Some(extended), Some(errstr))
        }
        _ => (err.to_string(), None, None),
    };

    let globals = ctx.globals();
    let error_ctor: rquickjs::Function = globals.get("Error")?;
    let error_obj: rquickjs::Object = error_ctor.call((&message,))?;
    error_obj.set("code", "ERR_SQLITE_ERROR")?;
    if let Some(ec) = errcode_val {
        error_obj.set("errcode", ec)?;
    }
    if let Some(es) = errstr_val {
        error_obj.set("errstr", es)?;
    }
    Ok(ctx.throw(error_obj.into_value()))
}

fn create_error_object<'js>(
    ctx: &rquickjs::Ctx<'js>,
    error_type: &str,
    message: &str,
    code: &str,
) -> rquickjs::Result<rquickjs::Object<'js>> {
    let globals = ctx.globals();
    let error_ctor: rquickjs::Function = globals.get(error_type)?;
    let error_obj: rquickjs::Object = error_ctor.call((message,))?;
    error_obj.set("code", code)?;
    Ok(error_obj)
}

fn throw_coded_error<'js>(
    ctx: &rquickjs::Ctx<'js>,
    error_type: &str,
    message: &str,
    code: &str,
) -> rquickjs::Error {
    match create_error_object(ctx, error_type, message, code) {
        Ok(obj) => ctx.throw(obj.into_value()),
        Err(_) => rquickjs::Exception::throw_message(ctx, message),
    }
}

fn save_udf_error<'js>(
    ctx: &rquickjs::Ctx<'js>,
    error_type: &str,
    message: &str,
    code: &str,
) -> rusqlite::Error {
    if let Ok(error_obj) = create_error_object(ctx, error_type, message, code) {
        save_pending_js_exception(ctx, error_obj.into_value());
    }
    rusqlite::Error::UserFunctionError(message.to_string().into())
}

fn js_value_to_sqlite<'js>(
    ctx: &rquickjs::Ctx<'js>,
    val: &rquickjs::Value<'js>,
    param_pos: usize,
) -> rquickjs::Result<rusqlite::types::Value> {
    if val.is_null() {
        return Ok(rusqlite::types::Value::Null);
    }
    if let Some(b) = val.as_bool() {
        return Ok(rusqlite::types::Value::Integer(if b { 1 } else { 0 }));
    }
    if let Some(i) = val.as_int() {
        return Ok(rusqlite::types::Value::Integer(i as i64));
    }
    if let Some(f) = val.as_float() {
        if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
            return Ok(rusqlite::types::Value::Integer(f as i64));
        }
        return Ok(rusqlite::types::Value::Real(f));
    }
    if val.is_big_int() {
        // Convert BigInt to string and parse as i128 to reliably check range,
        // because QuickJS's to_i64() truncates instead of returning an error.
        let globals = ctx.globals();
        let string_fn: rquickjs::Function = globals.get("String")?;
        let str_val: String = string_fn.call((val.clone(),))?;
        return match str_val.parse::<i128>() {
            Ok(big) if big >= i64::MIN as i128 && big <= i64::MAX as i128 => {
                Ok(rusqlite::types::Value::Integer(big as i64))
            }
            _ => Err(throw_coded_error(
                ctx,
                "RangeError",
                &format!(
                    "BigInt value is too large to bind to a SQLite parameter: parameter {}",
                    param_pos
                ),
                "ERR_INVALID_ARG_VALUE",
            )),
        };
    }
    if let Some(s) = val.as_string() {
        let s = s.to_string()?;
        return Ok(rusqlite::types::Value::Text(s));
    }
    if let Ok(ta) = rquickjs::TypedArray::<u8>::from_value(val.clone()) {
        let bytes = ta
            .as_bytes()
            .ok_or_else(|| rquickjs::Exception::throw_message(ctx, "detached TypedArray buffer"))?
            .to_vec();
        return Ok(rusqlite::types::Value::Blob(bytes));
    }
    // Check for other TypedArray types or DataView (has .buffer property)
    if let Some(obj) = val.as_object() {
        if let Ok(buffer_val) = obj.get::<_, rquickjs::Value<'js>>("buffer") {
            if !buffer_val.is_undefined() && !buffer_val.is_null() {
                let byte_offset: usize = obj.get::<_, f64>("byteOffset").unwrap_or(0.0) as usize;
                let byte_length: usize = obj.get::<_, f64>("byteLength").unwrap_or(0.0) as usize;
                if let Some(ab) = rquickjs::ArrayBuffer::from_value(buffer_val) {
                    if let Some(raw_bytes) = ab.as_bytes() {
                        let buf_len = raw_bytes.len();
                        let end = (byte_offset + byte_length).min(buf_len);
                        let start = byte_offset.min(end);
                        let bytes = raw_bytes[start..end].to_vec();
                        return Ok(rusqlite::types::Value::Blob(bytes));
                    }
                }
            }
        }
    }
    // Unsupported type (undefined, function, symbol, regex, Promise, Map, Set, etc.)
    Err(throw_coded_error(
        ctx,
        "TypeError",
        &format!(
            "Provided value cannot be bound to SQLite parameter {}",
            param_pos
        ),
        "ERR_INVALID_ARG_TYPE",
    ))
}

fn sqlite_value_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    val: &ValueRef<'_>,
    read_big_ints: bool,
    col_index: usize,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    use rquickjs::IntoJs;
    match val {
        ValueRef::Null => Ok(rquickjs::Value::new_null(ctx.clone())),
        ValueRef::Integer(i) => {
            if read_big_ints {
                let bigint = rquickjs::BigInt::from_i64(ctx.clone(), *i)?;
                Ok(rquickjs::Value::from_big_int(bigint))
            } else if *i > MAX_SAFE_INTEGER || *i < MIN_SAFE_INTEGER {
                Err(throw_coded_error(
                    ctx,
                    "RangeError",
                    &format!(
                        "The value of column {} is too large to be represented as a JavaScript number: {}",
                        col_index, i
                    ),
                    "ERR_OUT_OF_RANGE",
                ))
            } else if *i >= i32::MIN as i64 && *i <= i32::MAX as i64 {
                (*i as i32).into_js(ctx)
            } else {
                (*i as f64).into_js(ctx)
            }
        }
        ValueRef::Real(f) => f.into_js(ctx),
        ValueRef::Text(bytes) => {
            let s = std::str::from_utf8(bytes).map_err(|_| {
                rquickjs::Exception::throw_message(ctx, "Invalid UTF-8 in SQLite TEXT value")
            })?;
            s.into_js(ctx)
        }
        ValueRef::Blob(bytes) => {
            let typed_array =
                rquickjs::TypedArray::<u8>::new_copy(ctx.clone(), bytes).map_err(|_| {
                    rquickjs::Exception::throw_message(ctx, "Failed to create TypedArray for BLOB")
                })?;
            Ok(typed_array.into_value())
        }
    }
}

fn sqlite_owned_value_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    val: &rusqlite::types::Value,
    read_big_ints: bool,
    col_index: usize,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    use rquickjs::IntoJs;
    match val {
        rusqlite::types::Value::Null => Ok(rquickjs::Value::new_null(ctx.clone())),
        rusqlite::types::Value::Integer(i) => {
            if read_big_ints {
                let bigint = rquickjs::BigInt::from_i64(ctx.clone(), *i)?;
                Ok(rquickjs::Value::from_big_int(bigint))
            } else if *i > MAX_SAFE_INTEGER || *i < MIN_SAFE_INTEGER {
                Err(throw_coded_error(
                    ctx,
                    "RangeError",
                    &format!(
                        "The value of column {} is too large to be represented as a JavaScript number: {}",
                        col_index, i
                    ),
                    "ERR_OUT_OF_RANGE",
                ))
            } else if *i >= i32::MIN as i64 && *i <= i32::MAX as i64 {
                (*i as i32).into_js(ctx)
            } else {
                (*i as f64).into_js(ctx)
            }
        }
        rusqlite::types::Value::Real(f) => f.into_js(ctx),
        rusqlite::types::Value::Text(s) => s.as_str().into_js(ctx),
        rusqlite::types::Value::Blob(bytes) => {
            let typed_array =
                rquickjs::TypedArray::<u8>::new_copy(ctx.clone(), bytes).map_err(|_| {
                    rquickjs::Exception::throw_message(ctx, "Failed to create TypedArray for BLOB")
                })?;
            Ok(typed_array.into_value())
        }
    }
}

fn create_null_proto_object<'js>(
    ctx: &rquickjs::Ctx<'js>,
) -> rquickjs::Result<rquickjs::Object<'js>> {
    let globals = ctx.globals();
    let object_ctor: rquickjs::Object = globals.get("Object")?;
    let create_fn: rquickjs::Function = object_ctor.get("create")?;
    create_fn.call((rquickjs::Value::new_null(ctx.clone()),))
}

fn row_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    col_names: &[String],
    row: &rusqlite::Row,
    return_arrays: bool,
    read_big_ints: bool,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    if return_arrays {
        let arr = rquickjs::Array::new(ctx.clone())?;
        for i in 0..col_names.len() {
            let val = row.get_ref(i).map_err(|e| sqlite_error(ctx, &e))?;
            let js_val = sqlite_value_to_js(ctx, &val, read_big_ints, i)?;
            arr.set(i, js_val)?;
        }
        Ok(arr.into_value())
    } else {
        let obj = create_null_proto_object(ctx)?;
        for (i, name) in col_names.iter().enumerate() {
            let val = row.get_ref(i).map_err(|e| sqlite_error(ctx, &e))?;
            let js_val = sqlite_value_to_js(ctx, &val, read_big_ints, i)?;
            obj.set(name.as_str(), js_val)?;
        }
        Ok(obj.into_value())
    }
}

fn owned_row_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    col_names: &[String],
    values: &[rusqlite::types::Value],
    return_arrays: bool,
    read_big_ints: bool,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    if return_arrays {
        let arr = rquickjs::Array::new(ctx.clone())?;
        for (i, val) in values.iter().enumerate() {
            let js_val = sqlite_owned_value_to_js(ctx, val, read_big_ints, i)?;
            arr.set(i, js_val)?;
        }
        Ok(arr.into_value())
    } else {
        let obj = create_null_proto_object(ctx)?;
        for (i, name) in col_names.iter().enumerate() {
            let js_val = sqlite_owned_value_to_js(ctx, &values[i], read_big_ints, i)?;
            obj.set(name.as_str(), js_val)?;
        }
        Ok(obj.into_value())
    }
}

fn lock_conn_table<'js>(
    ctx: &rquickjs::Ctx<'js>,
) -> rquickjs::Result<std::sync::MutexGuard<'static, ConnectionTable>> {
    CONN_TABLE.lock().map_err(|_| {
        rquickjs::Exception::throw_message(ctx, "sqlite connection table lock poisoned")
    })
}

fn bind_params<'js>(
    ctx: &rquickjs::Ctx<'js>,
    stmt: &mut rusqlite::Statement,
    params: &rquickjs::Value<'js>,
    allow_bare_named: bool,
) -> rquickjs::Result<()> {
    if params.is_null() || params.is_undefined() {
        return Ok(());
    }

    if let Some(arr) = params.as_array() {
        for i in 0..arr.len() {
            let val: rquickjs::Value<'js> = arr.get(i)?;
            let sql_val = js_value_to_sqlite(ctx, &val, i + 1)?;
            stmt.raw_bind_parameter(i + 1, sql_val)
                .map_err(|e| sqlite_error(ctx, &e))?;
        }
    } else if params.is_object() {
        let obj = params.as_object().ok_or_else(|| {
            rquickjs::Exception::throw_message(ctx, "expected object for named parameters")
        })?;
        let count = stmt.parameter_count();
        for idx in 1..=count {
            if let Some(name) = stmt.parameter_name(idx) {
                let val: rquickjs::Value<'js> = obj
                    .get::<_, rquickjs::Value<'js>>(name)
                    .unwrap_or_else(|_| rquickjs::Value::new_null(ctx.clone()));

                let val = if (val.is_undefined() || val.is_null())
                    && allow_bare_named
                    && name.len() > 1
                    && matches!(name.as_bytes()[0], b':' | b'@' | b'$')
                {
                    let bare = &name[1..];
                    obj.get::<_, rquickjs::Value<'js>>(bare)
                        .unwrap_or_else(|_| rquickjs::Value::new_null(ctx.clone()))
                } else {
                    val
                };

                // For named params, treat undefined as NULL (unbound)
                let val = if val.is_undefined() {
                    rquickjs::Value::new_null(ctx.clone())
                } else {
                    val
                };

                let sql_val = js_value_to_sqlite(ctx, &val, idx)?;
                stmt.raw_bind_parameter(idx, sql_val)
                    .map_err(|e| sqlite_error(ctx, &e))?;
            }
        }
    }

    Ok(())
}

fn validate_named_params<'js>(
    ctx: &rquickjs::Ctx<'js>,
    stmt: &rusqlite::Statement,
    params: &rquickjs::Value<'js>,
    allow_bare_named: bool,
    allow_unknown_named: bool,
) -> rquickjs::Result<()> {
    if params.is_null() || params.is_undefined() {
        return Ok(());
    }
    if params.as_array().is_some() {
        return Ok(());
    }
    let obj = match params.as_object() {
        Some(o) => o,
        None => return Ok(()),
    };

    let props = obj.props::<String, rquickjs::Value>();
    for entry in props {
        let (key, _) = entry?;

        // Check if key directly matches a SQL parameter name
        let direct_match = (1..=stmt.parameter_count())
            .any(|idx| stmt.parameter_name(idx).map_or(false, |name| name == key));
        if direct_match {
            continue;
        }

        // Check bare name matching if enabled
        if allow_bare_named {
            let matching_names: Vec<String> = (1..=stmt.parameter_count())
                .filter_map(|idx| stmt.parameter_name(idx))
                .filter(|name| {
                    name.len() > 1
                        && matches!(name.as_bytes()[0], b':' | b'@' | b'$')
                        && &name[1..] == key
                })
                .map(String::from)
                .collect();

            if matching_names.len() > 1 {
                return Err(throw_coded_error(
                    ctx,
                    "Error",
                    &format!(
                        "Cannot create bare named parameter '{}' because of conflicting names '{}' and '{}'.",
                        key, matching_names[0], matching_names[1]
                    ),
                    "ERR_INVALID_STATE",
                ));
            }

            if !matching_names.is_empty() {
                continue;
            }
        }

        // No match found
        if !allow_unknown_named {
            return Err(throw_coded_error(
                ctx,
                "Error",
                &format!("Unknown named parameter '{}'", key),
                "ERR_INVALID_STATE",
            ));
        }
    }
    Ok(())
}

fn open_database_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    path: String,
    read_only: bool,
    enable_foreign_keys: bool,
    enable_dqs: bool,
    timeout: u32,
) -> rquickjs::Result<u32> {
    let conn = if path == ":memory:" {
        rusqlite::Connection::open_in_memory().map_err(|e| sqlite_error(&ctx, &e))?
    } else {
        let flags = if read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
        };
        rusqlite::Connection::open_with_flags(&path, flags).map_err(|e| sqlite_error(&ctx, &e))?
    };

    // Node.js compiles sqlite with math functions enabled. libsqlite3-sys does not,
    // so expose PI() explicitly for node:sqlite compatibility.
    conn.create_scalar_function(
        "pi",
        0,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |_| Ok(std::f64::consts::PI),
    )
    .map_err(|e| sqlite_error(&ctx, &e))?;

    if enable_foreign_keys {
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .map_err(|e| sqlite_error(&ctx, &e))?;
    } else {
        conn.execute_batch("PRAGMA foreign_keys = OFF")
            .map_err(|e| sqlite_error(&ctx, &e))?;
    }

    conn.set_db_config(
        rusqlite::config::DbConfig::SQLITE_DBCONFIG_DQS_DML,
        enable_dqs,
    )
    .map_err(|e| sqlite_error(&ctx, &e))?;
    conn.set_db_config(
        rusqlite::config::DbConfig::SQLITE_DBCONFIG_DQS_DDL,
        enable_dqs,
    )
    .map_err(|e| sqlite_error(&ctx, &e))?;

    if timeout > 0 {
        conn.busy_timeout(Duration::from_millis(timeout as u64))
            .map_err(|e| sqlite_error(&ctx, &e))?;
    }

    conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let mut table = lock_conn_table(&ctx)?;
    let id = table.insert(conn);
    Ok(id)
}

fn close_database_impl<'js>(ctx: rquickjs::Ctx<'js>, conn_id: u32) -> rquickjs::Result<()> {
    // Clean up sessions associated with this connection first
    if let Ok(mut session_table) = SESSION_TABLE.lock() {
        session_table
            .sessions
            .retain(|_, state| state.conn_id != conn_id);
    }

    let mut table = lock_conn_table(&ctx)?;
    if table.connections.remove(&conn_id).is_none() {
        return Err(rquickjs::Exception::throw_message(
            &ctx,
            "database is not open",
        ));
    }
    Ok(())
}

fn exec_sql_impl<'js>(ctx: rquickjs::Ctx<'js>, conn_id: u32, sql: String) -> rquickjs::Result<()> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;
    conn.execute_batch(&sql)
        .map_err(|e| sqlite_error(&ctx, &e))?;
    Ok(())
}

fn is_open_impl(conn_id: u32) -> bool {
    CONN_TABLE
        .lock()
        .map(|t| t.connections.contains_key(&conn_id))
        .unwrap_or(false)
}

fn is_autocommit_impl(conn_id: u32) -> bool {
    CONN_TABLE
        .lock()
        .ok()
        .and_then(|t| t.connections.get(&conn_id).map(|c| c.is_autocommit()))
        .unwrap_or(false)
}

fn stmt_run_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
    params: rquickjs::Value<'js>,
    allow_bare_named: bool,
    allow_unknown_named: bool,
    read_big_ints: bool,
) -> rquickjs::Result<rquickjs::Object<'js>> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    {
        let mut stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
        validate_named_params(&ctx, &stmt, &params, allow_bare_named, allow_unknown_named)?;
        bind_params(&ctx, &mut stmt, &params, allow_bare_named)?;

        if stmt.column_count() > 0 {
            let mut rows = stmt.raw_query();
            while rows
                .next()
                .map_err(|e| map_sqlite_or_udf_error(&ctx, e))?
                .is_some()
            {}
        } else {
            stmt.raw_execute()
                .map_err(|e| map_sqlite_or_udf_error(&ctx, e))?;
        }
    }

    let changes = conn.changes();
    let last_rowid = conn.last_insert_rowid();

    let result = rquickjs::Object::new(ctx.clone())?;
    if read_big_ints {
        let changes_bi = rquickjs::BigInt::from_i64(ctx.clone(), changes as i64)?;
        result.set("changes", rquickjs::Value::from_big_int(changes_bi))?;
        let rowid_bi = rquickjs::BigInt::from_i64(ctx.clone(), last_rowid)?;
        result.set("lastInsertRowid", rquickjs::Value::from_big_int(rowid_bi))?;
    } else {
        result.set("changes", changes as f64)?;
        result.set("lastInsertRowid", last_rowid as f64)?;
    }
    Ok(result)
}

fn stmt_get_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
    params: rquickjs::Value<'js>,
    allow_bare_named: bool,
    allow_unknown_named: bool,
    read_big_ints: bool,
    return_arrays: bool,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let mut stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
    validate_named_params(&ctx, &stmt, &params, allow_bare_named, allow_unknown_named)?;
    bind_params(&ctx, &mut stmt, &params, allow_bare_named)?;

    let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = stmt.raw_query();

    match rows.next().map_err(|e| map_sqlite_or_udf_error(&ctx, e))? {
        Some(row) => row_to_js(&ctx, &col_names, row, return_arrays, read_big_ints),
        None => Ok(rquickjs::Value::new_undefined(ctx.clone())),
    }
}

fn stmt_all_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
    params: rquickjs::Value<'js>,
    allow_bare_named: bool,
    allow_unknown_named: bool,
    read_big_ints: bool,
    return_arrays: bool,
) -> rquickjs::Result<rquickjs::Array<'js>> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let mut stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
    validate_named_params(&ctx, &stmt, &params, allow_bare_named, allow_unknown_named)?;
    bind_params(&ctx, &mut stmt, &params, allow_bare_named)?;

    let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = stmt.raw_query();
    let result = rquickjs::Array::new(ctx.clone())?;
    let mut idx = 0u32;

    while let Some(row) = rows.next().map_err(|e| map_sqlite_or_udf_error(&ctx, e))? {
        let val = row_to_js(&ctx, &col_names, row, return_arrays, read_big_ints)?;
        result.set(idx as usize, val)?;
        idx += 1;
    }

    Ok(result)
}

fn stmt_expanded_sql_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
    params: rquickjs::Value<'js>,
    allow_bare_named: bool,
) -> rquickjs::Result<String> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let mut stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
    bind_params(&ctx, &mut stmt, &params, allow_bare_named)?;

    Ok(stmt.expanded_sql().unwrap_or(sql))
}

fn stmt_columns_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
) -> rquickjs::Result<rquickjs::Array<'js>> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
    let col_count = stmt.column_count();
    let result = rquickjs::Array::new(ctx.clone())?;

    for i in 0..col_count {
        let info = rquickjs::Object::new(ctx.clone())?;
        let name = stmt.column_name(i).map_err(|e| sqlite_error(&ctx, &e))?;
        info.set("name", name)?;
        info.set("column", rquickjs::Value::new_null(ctx.clone()))?;
        info.set("table", rquickjs::Value::new_null(ctx.clone()))?;
        info.set("database", rquickjs::Value::new_null(ctx.clone()))?;
        info.set("type", rquickjs::Value::new_null(ctx.clone()))?;
        result.set(i, info)?;
    }

    Ok(result)
}

fn stmt_iterate_init_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    sql: String,
    params: rquickjs::Value<'js>,
    allow_bare_named: bool,
    allow_unknown_named: bool,
) -> rquickjs::Result<u32> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());

    let state = {
        let table = lock_conn_table(&ctx)?;
        let conn = table
            .connections
            .get(&conn_id)
            .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

        let mut stmt = conn.prepare(&sql).map_err(|e| sqlite_error(&ctx, &e))?;
        validate_named_params(&ctx, &stmt, &params, allow_bare_named, allow_unknown_named)?;
        bind_params(&ctx, &mut stmt, &params, allow_bare_named)?;

        let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
        let mut rows = stmt.raw_query();
        let mut all_values = Vec::new();

        while let Some(row) = rows.next().map_err(|e| map_sqlite_or_udf_error(&ctx, e))? {
            let mut row_vals = Vec::with_capacity(col_names.len());
            for i in 0..col_names.len() {
                let val = row.get_ref(i).map_err(|e| sqlite_error(&ctx, &e))?;
                row_vals.push(rusqlite::types::Value::from(val.clone()));
            }
            all_values.push(row_vals);
        }

        IteratorState {
            col_names,
            values: all_values,
            position: 0,
        }
    };

    let mut iter_table = ITER_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "iterator table lock poisoned"))?;
    let id = iter_table.insert(state);
    Ok(id)
}

fn stmt_iterate_next_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    iter_id: u32,
    read_big_ints: bool,
    return_arrays: bool,
) -> rquickjs::Result<rquickjs::Object<'js>> {
    let mut iter_table = ITER_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "iterator table lock poisoned"))?;

    let state = iter_table
        .iterators
        .get_mut(&iter_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "invalid iterator id"))?;

    let result = rquickjs::Object::new(ctx.clone())?;
    if state.position < state.values.len() {
        let row_val = owned_row_to_js(
            &ctx,
            &state.col_names,
            &state.values[state.position],
            return_arrays,
            read_big_ints,
        )?;
        state.position += 1;
        result.set("value", row_val)?;
        result.set("done", false)?;
    } else {
        // Clean up exhausted iterator to prevent leaks
        iter_table.iterators.remove(&iter_id);
        result.set("value", rquickjs::Value::new_undefined(ctx.clone()))?;
        result.set("done", true)?;
    }
    Ok(result)
}

fn stmt_iterate_return_impl<'js>(ctx: rquickjs::Ctx<'js>, iter_id: u32) -> rquickjs::Result<()> {
    let mut iter_table = ITER_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "iterator table lock poisoned"))?;
    iter_table.iterators.remove(&iter_id);
    Ok(())
}

/// Reconstruct a temporary `Ctx` from the thread-local raw pointer.
///
/// # Safety
/// The caller must ensure that `JS_CTX_PTR` was set by a `JsCtxGuard` that is
/// still alive (i.e. the originating `Ctx<'js>` is on the stack). This is
/// guaranteed when called from within rusqlite UDF closures during statement
/// execution, because our `stmt_*` functions set the guard before executing.
///
/// `Ctx::from_raw` dups the context (increments refcount). When the returned
/// `Ctx` is dropped it frees once, so the net refcount change is zero.
unsafe fn get_udf_js_ctx() -> Result<rquickjs::Ctx<'static>, rusqlite::Error> {
    let raw_ctx = JS_CTX_PTR.with(|p| p.get());
    let nn = std::ptr::NonNull::new(raw_ctx).ok_or_else(|| {
        rusqlite::Error::UserFunctionError("No JS context available for UDF callback".into())
    })?;
    Ok(unsafe { rquickjs::Ctx::from_raw(nn) })
}

fn udf_sqlite_value_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    val: &ValueRef<'_>,
    use_big_int_args: bool,
) -> Result<rquickjs::Value<'js>, rusqlite::Error> {
    match val {
        ValueRef::Integer(i)
            if !use_big_int_args && (*i > MAX_SAFE_INTEGER || *i < MIN_SAFE_INTEGER) =>
        {
            let msg = format!(
                "Value is too large to be represented as a JavaScript number: {}",
                i
            );
            Err(save_udf_error(ctx, "RangeError", &msg, "ERR_OUT_OF_RANGE"))
        }
        _ => sqlite_value_to_js(ctx, val, use_big_int_args, 0)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into())),
    }
}

fn udf_js_result_to_sqlite<'js>(
    ctx: &rquickjs::Ctx<'js>,
    result: &rquickjs::Value<'js>,
) -> Result<rusqlite::types::Value, rusqlite::Error> {
    if result.is_null() || result.is_undefined() {
        return Ok(rusqlite::types::Value::Null);
    }
    if let Some(b) = result.as_bool() {
        return Ok(rusqlite::types::Value::Integer(if b { 1 } else { 0 }));
    }
    if let Some(i) = result.as_int() {
        return Ok(rusqlite::types::Value::Integer(i as i64));
    }
    if let Some(f) = result.as_float() {
        if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
            return Ok(rusqlite::types::Value::Integer(f as i64));
        }
        return Ok(rusqlite::types::Value::Real(f));
    }
    if result.is_big_int() {
        let bigint = result
            .as_big_int()
            .ok_or_else(|| rusqlite::Error::UserFunctionError("Failed to convert BigInt".into()))?;
        let i = bigint
            .clone()
            .to_i64()
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
        if i > MAX_SAFE_INTEGER || i < MIN_SAFE_INTEGER {
            return Err(save_udf_error(
                ctx,
                "RangeError",
                &format!("BigInt value is out of range: {}", i),
                "ERR_OUT_OF_RANGE",
            ));
        }
        return Ok(rusqlite::types::Value::Integer(i));
    }
    if let Some(s) = result.as_string() {
        let s = s
            .to_string()
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
        return Ok(rusqlite::types::Value::Text(s));
    }
    // Check for Promise (thenable) before TypedArray
    if let Some(obj) = result.as_object() {
        if let Ok(then_val) = obj.get::<_, rquickjs::Value>("then") {
            if then_val.is_function() {
                return Err(rusqlite::Error::UserFunctionError(
                    "Asynchronous user-defined functions are not supported".into(),
                ));
            }
        }
    }
    if let Ok(ta) = rquickjs::TypedArray::<u8>::from_value(result.clone()) {
        let bytes = ta
            .as_bytes()
            .ok_or_else(|| rusqlite::Error::UserFunctionError("detached TypedArray buffer".into()))?
            .to_vec();
        return Ok(rusqlite::types::Value::Blob(bytes));
    }
    if result.is_function() {
        return Err(rusqlite::Error::UserFunctionError(
            "Returned JavaScript value cannot be converted to a SQLite value".into(),
        ));
    }
    Ok(rusqlite::types::Value::Null)
}

fn build_function_flags(deterministic: bool, direct_only: bool) -> FunctionFlags {
    let mut flags = FunctionFlags::SQLITE_UTF8;
    if deterministic {
        flags |= FunctionFlags::SQLITE_DETERMINISTIC;
    }
    if direct_only {
        flags |= FunctionFlags::SQLITE_DIRECTONLY;
    }
    flags
}

fn register_function_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    name: String,
    callback: rquickjs::Function<'js>,
    deterministic: bool,
    direct_only: bool,
    use_big_int_args: bool,
    varargs: bool,
    num_args: i32,
) -> rquickjs::Result<()> {
    let persistent_fn = SendPersistent(rquickjs::Persistent::save(&ctx, callback));
    let flags = build_function_flags(deterministic, direct_only);
    let n_arg = if varargs { -1 } else { num_args };

    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    conn.create_scalar_function(&*name, n_arg, flags, move |fctx| {
        // SAFETY: The UDF closure is called synchronously during statement
        // execution, which is always within a JsCtxGuard scope.
        let js_ctx = unsafe { get_udf_js_ctx()? };

        let func: rquickjs::Function<'_> = persistent_fn
            .clone_inner()
            .restore(&js_ctx)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;

        let args_count = fctx.len();
        let mut js_args = Vec::with_capacity(args_count);
        for i in 0..args_count {
            let val = fctx.get_raw(i);
            let js_val = udf_sqlite_value_to_js(&js_ctx, &val, use_big_int_args)?;
            js_args.push(js_val);
        }

        let mut call_args = rquickjs::function::Args::new(js_ctx.clone(), js_args.len());
        call_args
            .push_args(js_args)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
        let result: rquickjs::Value<'_> = func.call_arg(call_args).map_err(|e| {
            if matches!(e, rquickjs::Error::Exception) {
                let exception = js_ctx.catch();
                save_pending_js_exception(&js_ctx, exception);
            }
            rusqlite::Error::UserFunctionError(format!("{}", e).into())
        })?;

        udf_js_result_to_sqlite(&js_ctx, &result)
    })
    .map_err(|e| sqlite_error(&ctx, &e))?;

    Ok(())
}

struct JsAggregate {
    start: rquickjs::Persistent<rquickjs::Value<'static>>,
    step: rquickjs::Persistent<rquickjs::Function<'static>>,
    result_fn: Option<rquickjs::Persistent<rquickjs::Function<'static>>>,
    use_big_int_args: bool,
}

// SAFETY: WASM is single-threaded; these are never actually sent across threads.
unsafe impl Send for JsAggregate {}
unsafe impl Sync for JsAggregate {}

struct JsAccumulator(rquickjs::Persistent<rquickjs::Value<'static>>);

impl RefUnwindSafe for JsAccumulator {}
impl UnwindSafe for JsAccumulator {}

impl rusqlite::functions::Aggregate<JsAccumulator, rusqlite::types::Value> for JsAggregate {
    fn init(&self, _ctx: &mut rusqlite::functions::Context<'_>) -> rusqlite::Result<JsAccumulator> {
        let js_ctx = unsafe { get_udf_js_ctx()? };
        let start_val: rquickjs::Value<'_> = self
            .start
            .clone()
            .restore(&js_ctx)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;

        // If start is a function, call it to get the initial value
        let init_val = if start_val.is_function() {
            let func = start_val.as_function().ok_or_else(|| {
                rusqlite::Error::UserFunctionError("start is not a function".into())
            })?;
            func.call::<_, rquickjs::Value<'_>>(())
                .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?
        } else {
            start_val
        };

        Ok(JsAccumulator(rquickjs::Persistent::save(&js_ctx, init_val)))
    }

    fn step(
        &self,
        fctx: &mut rusqlite::functions::Context<'_>,
        acc: &mut JsAccumulator,
    ) -> rusqlite::Result<()> {
        let js_ctx = unsafe { get_udf_js_ctx()? };

        let step_fn: rquickjs::Function<'_> = self
            .step
            .clone()
            .restore(&js_ctx)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;

        let acc_val: rquickjs::Value<'_> = acc
            .0
            .clone()
            .restore(&js_ctx)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;

        let args_count = fctx.len();
        let mut js_args: Vec<rquickjs::Value<'_>> = Vec::with_capacity(args_count + 1);
        js_args.push(acc_val);
        for i in 0..args_count {
            let val = fctx.get_raw(i);
            let js_val = udf_sqlite_value_to_js(&js_ctx, &val, self.use_big_int_args)?;
            js_args.push(js_val);
        }

        let mut call_args = rquickjs::function::Args::new(js_ctx.clone(), js_args.len());
        call_args
            .push_args(js_args)
            .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
        let new_acc: rquickjs::Value<'_> = step_fn.call_arg(call_args).map_err(|e| {
            if matches!(e, rquickjs::Error::Exception) {
                let exception = js_ctx.catch();
                save_pending_js_exception(&js_ctx, exception);
            }
            rusqlite::Error::UserFunctionError(format!("{}", e).into())
        })?;

        acc.0 = rquickjs::Persistent::save(&js_ctx, new_acc);
        Ok(())
    }

    fn finalize(
        &self,
        _ctx: &mut rusqlite::functions::Context<'_>,
        acc: Option<JsAccumulator>,
    ) -> rusqlite::Result<rusqlite::types::Value> {
        let js_ctx = unsafe { get_udf_js_ctx()? };

        let acc_val = match acc {
            Some(a) => {
                a.0.restore(&js_ctx)
                    .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?
            }
            None => {
                // No rows: evaluate start to get initial value
                let start_val: rquickjs::Value<'_> = self
                    .start
                    .clone()
                    .restore(&js_ctx)
                    .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
                if start_val.is_function() {
                    let func = start_val.as_function().ok_or_else(|| {
                        rusqlite::Error::UserFunctionError("start is not a function".into())
                    })?;
                    func.call::<_, rquickjs::Value<'_>>(())
                        .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?
                } else {
                    start_val
                }
            }
        };

        if let Some(ref result_persistent) = self.result_fn {
            let result_func: rquickjs::Function<'_> = result_persistent
                .clone()
                .restore(&js_ctx)
                .map_err(|e| rusqlite::Error::UserFunctionError(format!("{}", e).into()))?;
            let result: rquickjs::Value<'_> = result_func.call((acc_val,)).map_err(|e| {
                if matches!(e, rquickjs::Error::Exception) {
                    let exception = js_ctx.catch();
                    save_pending_js_exception(&js_ctx, exception);
                }
                rusqlite::Error::UserFunctionError(format!("{}", e).into())
            })?;
            udf_js_result_to_sqlite(&js_ctx, &result)
        } else {
            udf_js_result_to_sqlite(&js_ctx, &acc_val)
        }
    }
}

fn register_aggregate_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    name: String,
    start: rquickjs::Value<'js>,
    step: rquickjs::Function<'js>,
    result_fn: rquickjs::Value<'js>,
    deterministic: bool,
    direct_only: bool,
    use_big_int_args: bool,
    varargs: bool,
    num_args: i32,
) -> rquickjs::Result<()> {
    let persistent_start = rquickjs::Persistent::save(&ctx, start);
    let persistent_step = rquickjs::Persistent::save(&ctx, step);
    let persistent_result = if result_fn.is_function() {
        let func = result_fn
            .into_function()
            .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "result must be a function"))?;
        Some(rquickjs::Persistent::save(&ctx, func))
    } else {
        None
    };

    let flags = build_function_flags(deterministic, direct_only);
    let n_arg = if varargs { -1 } else { num_args };

    let aggr = JsAggregate {
        start: persistent_start,
        step: persistent_step,
        result_fn: persistent_result,
        use_big_int_args,
    };

    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    conn.create_aggregate_function(&*name, n_arg, flags, aggr)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    Ok(())
}

fn create_session_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    table_name: rquickjs::Value<'js>,
    db_name: String,
) -> rquickjs::Result<u32> {
    let conn_table = lock_conn_table(&ctx)?;
    let conn = conn_table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    // SAFETY: Session internally stores raw pointers, not references. The
    // PhantomData<&'conn Connection> lifetime is a compile-time-only constraint.
    // We transmute to 'static because we guarantee the connection outlives the
    // session by tracking conn_id and cleaning up sessions when connections close.
    let mut session = unsafe {
        let s = rusqlite::session::Session::new_with_name(conn, db_name.as_str())
            .map_err(|e| sqlite_error(&ctx, &e))?;
        std::mem::transmute::<rusqlite::session::Session<'_>, rusqlite::session::Session<'static>>(
            s,
        )
    };

    if table_name.is_null() || table_name.is_undefined() {
        session
            .attach::<&str>(None)
            .map_err(|e| sqlite_error(&ctx, &e))?;
    } else if let Some(s) = table_name.as_string() {
        let name = s.to_string()?;
        session
            .attach(Some(name.as_str()))
            .map_err(|e| sqlite_error(&ctx, &e))?;
    }

    drop(conn_table);

    let state = SessionState { session, conn_id };
    let mut session_table = SESSION_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "session table lock poisoned"))?;
    let id = session_table.insert(state);
    Ok(id)
}

fn session_changeset_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    session_id: u32,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let mut session_table = SESSION_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "session table lock poisoned"))?;
    let state = session_table
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "session is not valid"))?;

    let mut output = Vec::new();
    state
        .session
        .changeset_strm(&mut output)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let typed_array = rquickjs::TypedArray::<u8>::new_copy(ctx.clone(), &output)
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "Failed to create TypedArray"))?;
    Ok(typed_array.into_value())
}

fn session_patchset_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    session_id: u32,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let mut session_table = SESSION_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "session table lock poisoned"))?;
    let state = session_table
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "session is not valid"))?;

    let mut output = Vec::new();
    state
        .session
        .patchset_strm(&mut output)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let typed_array = rquickjs::TypedArray::<u8>::new_copy(ctx.clone(), &output)
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "Failed to create TypedArray"))?;
    Ok(typed_array.into_value())
}

fn session_close_impl<'js>(ctx: rquickjs::Ctx<'js>, session_id: u32) -> rquickjs::Result<()> {
    let mut session_table = SESSION_TABLE
        .lock()
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "session table lock poisoned"))?;
    if session_table.sessions.remove(&session_id).is_none() {
        return Err(rquickjs::Exception::throw_message(
            &ctx,
            "session is not valid",
        ));
    }
    Ok(())
}

fn apply_changeset_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    changeset: rquickjs::TypedArray<'js, u8>,
    on_conflict: rquickjs::Value<'js>,
    filter: rquickjs::Value<'js>,
) -> rquickjs::Result<bool> {
    let _guard = JsCtxGuard::new(ctx.as_raw().as_ptr());

    let conn_table = lock_conn_table(&ctx)?;
    let conn = conn_table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let bytes = changeset
        .as_bytes()
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "detached TypedArray buffer"))?;

    let has_on_conflict = on_conflict.is_function();
    let persistent_on_conflict = if has_on_conflict {
        Some(SendPersistent(rquickjs::Persistent::save(
            &ctx,
            on_conflict.into_function().unwrap(),
        )))
    } else {
        None
    };

    let has_filter = filter.is_function();
    let persistent_filter = if has_filter {
        Some(SendPersistent(rquickjs::Persistent::save(
            &ctx,
            filter.into_function().unwrap(),
        )))
    } else {
        None
    };

    let filter_fn: Option<Box<dyn Fn(&str) -> bool + Send + 'static>> = if has_filter {
        let pf = persistent_filter.unwrap();
        Some(Box::new(move |table_name: &str| -> bool {
            let js_ctx = match unsafe { get_udf_js_ctx() } {
                Ok(ctx) => ctx,
                Err(_) => return true,
            };
            let func: rquickjs::Function<'_> = match pf.clone_inner().restore(&js_ctx) {
                Ok(f) => f,
                Err(_) => return true,
            };
            match func.call::<_, rquickjs::Value<'_>>((table_name,)) {
                Ok(val) => val.as_bool().unwrap_or(true),
                Err(_) => true,
            }
        }))
    } else {
        None
    };

    let aborted = Arc::new(Mutex::new(false));
    let callback_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let aborted_clone = Arc::clone(&aborted);
    let error_clone = Arc::clone(&callback_error);

    let conflict_fn = move |conflict_type: rusqlite::session::ConflictType,
                            _item: rusqlite::session::ChangesetItem|
          -> rusqlite::session::ConflictAction {
        if let Some(ref pc) = persistent_on_conflict {
            let js_ctx = match unsafe { get_udf_js_ctx() } {
                Ok(ctx) => ctx,
                Err(_) => {
                    *aborted_clone.lock().unwrap() = true;
                    return rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT;
                }
            };
            let func: rquickjs::Function<'_> = match pc.clone_inner().restore(&js_ctx) {
                Ok(f) => f,
                Err(_) => {
                    *aborted_clone.lock().unwrap() = true;
                    return rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT;
                }
            };
            let conflict_type_int = conflict_type as i32;
            match func.call::<_, rquickjs::Value<'_>>((conflict_type_int,)) {
                Ok(val) => {
                    if let Some(action) = val.as_int() {
                        match action {
                            0 => rusqlite::session::ConflictAction::SQLITE_CHANGESET_OMIT,
                            1 => rusqlite::session::ConflictAction::SQLITE_CHANGESET_REPLACE,
                            2 => {
                                *aborted_clone.lock().unwrap() = true;
                                rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT
                            }
                            _ => {
                                *aborted_clone.lock().unwrap() = true;
                                rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT
                            }
                        }
                    } else {
                        *aborted_clone.lock().unwrap() = true;
                        rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT
                    }
                }
                Err(e) => {
                    *error_clone.lock().unwrap() = Some(format!("{}", e));
                    *aborted_clone.lock().unwrap() = true;
                    rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT
                }
            }
        } else {
            *aborted_clone.lock().unwrap() = true;
            rusqlite::session::ConflictAction::SQLITE_CHANGESET_ABORT
        }
    };

    let mut input: &[u8] = bytes;
    let result = conn.apply_strm(&mut input, filter_fn, conflict_fn);

    // Check if the JS callback threw an error
    if let Some(err_msg) = callback_error.lock().unwrap().as_ref() {
        return Err(rquickjs::Exception::throw_message(&ctx, err_msg));
    }

    match result {
        Ok(()) => Ok(!*aborted.lock().unwrap()),
        Err(e) => {
            if *aborted.lock().unwrap() {
                Ok(false)
            } else {
                Err(sqlite_error(&ctx, &e))
            }
        }
    }
}

fn get_constants_impl<'js>(ctx: rquickjs::Ctx<'js>) -> rquickjs::Result<rquickjs::Object<'js>> {
    let obj = rquickjs::Object::new(ctx.clone())?;

    // Authorizer results
    obj.set("SQLITE_OK", 0)?;
    obj.set("SQLITE_DENY", 1)?;
    obj.set("SQLITE_IGNORE", 2)?;

    // Authorizer actions
    obj.set("SQLITE_CREATE_INDEX", 1)?;
    obj.set("SQLITE_CREATE_TABLE", 2)?;
    obj.set("SQLITE_CREATE_TEMP_INDEX", 3)?;
    obj.set("SQLITE_CREATE_TEMP_TABLE", 4)?;
    obj.set("SQLITE_CREATE_TEMP_TRIGGER", 5)?;
    obj.set("SQLITE_CREATE_TEMP_VIEW", 6)?;
    obj.set("SQLITE_CREATE_TRIGGER", 7)?;
    obj.set("SQLITE_CREATE_VIEW", 8)?;
    obj.set("SQLITE_DELETE", 9)?;
    obj.set("SQLITE_DROP_INDEX", 10)?;
    obj.set("SQLITE_DROP_TABLE", 11)?;
    obj.set("SQLITE_DROP_TEMP_INDEX", 12)?;
    obj.set("SQLITE_DROP_TEMP_TABLE", 13)?;
    obj.set("SQLITE_DROP_TEMP_TRIGGER", 14)?;
    obj.set("SQLITE_DROP_TEMP_VIEW", 15)?;
    obj.set("SQLITE_DROP_TRIGGER", 16)?;
    obj.set("SQLITE_DROP_VIEW", 17)?;
    obj.set("SQLITE_INSERT", 18)?;
    obj.set("SQLITE_PRAGMA", 19)?;
    obj.set("SQLITE_READ", 20)?;
    obj.set("SQLITE_SELECT", 21)?;
    obj.set("SQLITE_TRANSACTION", 22)?;
    obj.set("SQLITE_UPDATE", 23)?;
    obj.set("SQLITE_ATTACH", 24)?;
    obj.set("SQLITE_DETACH", 25)?;
    obj.set("SQLITE_ALTER_TABLE", 26)?;
    obj.set("SQLITE_REINDEX", 27)?;
    obj.set("SQLITE_ANALYZE", 28)?;
    obj.set("SQLITE_CREATE_VTABLE", 29)?;
    obj.set("SQLITE_DROP_VTABLE", 30)?;
    obj.set("SQLITE_FUNCTION", 31)?;
    obj.set("SQLITE_SAVEPOINT", 32)?;
    obj.set("SQLITE_RECURSIVE", 33)?;

    // Changeset conflicts
    obj.set("SQLITE_CHANGESET_DATA", 1)?;
    obj.set("SQLITE_CHANGESET_NOTFOUND", 2)?;
    obj.set("SQLITE_CHANGESET_CONFLICT", 3)?;
    obj.set("SQLITE_CHANGESET_CONSTRAINT", 4)?;
    obj.set("SQLITE_CHANGESET_FOREIGN_KEY", 5)?;

    // Changeset resolution
    obj.set("SQLITE_CHANGESET_OMIT", 0)?;
    obj.set("SQLITE_CHANGESET_REPLACE", 1)?;
    obj.set("SQLITE_CHANGESET_ABORT", 2)?;

    Ok(obj)
}

fn enable_defensive_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    active: bool,
) -> rquickjs::Result<()> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;
    conn.set_db_config(
        rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE,
        active,
    )
    .map_err(|e| sqlite_error(&ctx, &e))?;
    Ok(())
}

fn location_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;
    match conn.path() {
        Some(path) if !path.is_empty() => {
            use rquickjs::IntoJs;
            path.to_string().into_js(&ctx)
        }
        _ => Ok(rquickjs::Value::new_null(ctx.clone())),
    }
}

fn set_authorizer_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    callback: rquickjs::Value<'js>,
) -> rquickjs::Result<()> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    if callback.is_null() || callback.is_undefined() {
        let _ = conn.authorizer(
            None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
        );
        return Ok(());
    }

    let func = callback.as_function().ok_or_else(|| {
        rquickjs::Exception::throw_message(&ctx, "callback must be a function or null")
    })?;
    let persistent_fn = SendPersistent(rquickjs::Persistent::save(&ctx, func.clone()));

    let _ = conn.authorizer(Some(
        move |auth_ctx: rusqlite::hooks::AuthContext<'_>| -> rusqlite::hooks::Authorization {
            let js_ctx = match unsafe { get_udf_js_ctx() } {
                Ok(ctx) => ctx,
                Err(_) => return rusqlite::hooks::Authorization::Deny,
            };
            let func: rquickjs::Function<'_> = match persistent_fn.clone_inner().restore(&js_ctx) {
                Ok(f) => f,
                Err(_) => return rusqlite::hooks::Authorization::Deny,
            };

            let action_code = auth_action_to_code(&auth_ctx.action);
            let (arg1, arg2) = auth_action_args(&auth_ctx.action);
            let db_name = auth_ctx.database_name.unwrap_or("");
            let accessor = auth_ctx.accessor.unwrap_or("");

            let result: Result<rquickjs::Value<'_>, _> =
                func.call((action_code, arg1, arg2, db_name, accessor));

            match result {
                Ok(val) => match val.as_int() {
                    Some(0) => rusqlite::hooks::Authorization::Allow,
                    Some(1) => rusqlite::hooks::Authorization::Deny,
                    Some(2) => rusqlite::hooks::Authorization::Ignore,
                    _ => rusqlite::hooks::Authorization::Deny,
                },
                Err(_) => rusqlite::hooks::Authorization::Deny,
            }
        },
    ));

    Ok(())
}

fn auth_action_to_code(action: &rusqlite::hooks::AuthAction<'_>) -> i32 {
    use rusqlite::hooks::AuthAction;
    match action {
        AuthAction::CreateIndex { .. } => 1,
        AuthAction::CreateTable { .. } => 2,
        AuthAction::CreateTempIndex { .. } => 3,
        AuthAction::CreateTempTable { .. } => 4,
        AuthAction::CreateTempTrigger { .. } => 5,
        AuthAction::CreateTempView { .. } => 6,
        AuthAction::CreateTrigger { .. } => 7,
        AuthAction::CreateView { .. } => 8,
        AuthAction::Delete { .. } => 9,
        AuthAction::DropIndex { .. } => 10,
        AuthAction::DropTable { .. } => 11,
        AuthAction::DropTempIndex { .. } => 12,
        AuthAction::DropTempTable { .. } => 13,
        AuthAction::DropTempTrigger { .. } => 14,
        AuthAction::DropTempView { .. } => 15,
        AuthAction::DropTrigger { .. } => 16,
        AuthAction::DropView { .. } => 17,
        AuthAction::Insert { .. } => 18,
        AuthAction::Pragma { .. } => 19,
        AuthAction::Read { .. } => 20,
        AuthAction::Select => 21,
        AuthAction::Transaction { .. } => 22,
        AuthAction::Update { .. } => 23,
        AuthAction::Attach { .. } => 24,
        AuthAction::Detach { .. } => 25,
        AuthAction::AlterTable { .. } => 26,
        AuthAction::Reindex { .. } => 27,
        AuthAction::Analyze { .. } => 28,
        AuthAction::CreateVtable { .. } => 29,
        AuthAction::DropVtable { .. } => 30,
        AuthAction::Function { .. } => 31,
        AuthAction::Savepoint { .. } => 32,
        AuthAction::Recursive => 33,
        _ => 0,
    }
}

fn auth_action_args<'a>(action: &'a rusqlite::hooks::AuthAction<'a>) -> (&'a str, &'a str) {
    use rusqlite::hooks::AuthAction;
    match action {
        AuthAction::CreateIndex {
            index_name,
            table_name,
        } => (index_name, table_name),
        AuthAction::CreateTable { table_name } => (table_name, ""),
        AuthAction::CreateTempIndex {
            index_name,
            table_name,
        } => (index_name, table_name),
        AuthAction::CreateTempTable { table_name } => (table_name, ""),
        AuthAction::CreateTempTrigger {
            trigger_name,
            table_name,
        } => (trigger_name, table_name),
        AuthAction::CreateTempView { view_name } => (view_name, ""),
        AuthAction::CreateTrigger {
            trigger_name,
            table_name,
        } => (trigger_name, table_name),
        AuthAction::CreateView { view_name } => (view_name, ""),
        AuthAction::Delete { table_name } => (table_name, ""),
        AuthAction::DropIndex {
            index_name,
            table_name,
        } => (index_name, table_name),
        AuthAction::DropTable { table_name } => (table_name, ""),
        AuthAction::DropTempIndex {
            index_name,
            table_name,
        } => (index_name, table_name),
        AuthAction::DropTempTable { table_name } => (table_name, ""),
        AuthAction::DropTempTrigger {
            trigger_name,
            table_name,
        } => (trigger_name, table_name),
        AuthAction::DropTempView { view_name } => (view_name, ""),
        AuthAction::DropTrigger {
            trigger_name,
            table_name,
        } => (trigger_name, table_name),
        AuthAction::DropView { view_name } => (view_name, ""),
        AuthAction::Insert { table_name } => (table_name, ""),
        AuthAction::Pragma {
            pragma_name,
            pragma_value,
        } => (pragma_name, pragma_value.unwrap_or("")),
        AuthAction::Read {
            table_name,
            column_name,
        } => (table_name, column_name),
        AuthAction::Select => ("", ""),
        AuthAction::Transaction { .. } => ("", ""),
        AuthAction::Update {
            table_name,
            column_name,
        } => (table_name, column_name),
        AuthAction::Attach { filename } => (filename, ""),
        AuthAction::Detach { database_name } => (database_name, ""),
        AuthAction::AlterTable {
            database_name,
            table_name,
        } => (database_name, table_name),
        AuthAction::Reindex { index_name } => (index_name, ""),
        AuthAction::Analyze { table_name } => (table_name, ""),
        AuthAction::CreateVtable {
            table_name,
            module_name,
        } => (table_name, module_name),
        AuthAction::DropVtable {
            table_name,
            module_name,
        } => (table_name, module_name),
        AuthAction::Function { function_name } => (function_name, ""),
        AuthAction::Savepoint { savepoint_name, .. } => (savepoint_name, ""),
        AuthAction::Recursive => ("", ""),
        _ => ("", ""),
    }
}

fn serialize_database_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let data = conn
        .serialize(rusqlite::MAIN_DB)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let bytes: &[u8] = &data;
    let typed_array = rquickjs::TypedArray::<u8>::new(ctx.clone(), bytes)
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "failed to create Uint8Array"))?;
    Ok(typed_array.into_value())
}

fn restore_database_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    bytes: rquickjs::TypedArray<'js, u8>,
) -> rquickjs::Result<()> {
    let mut table = lock_conn_table(&ctx)?;
    let conn = table
        .connections
        .get_mut(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    if conn
        .is_readonly(rusqlite::MAIN_DB)
        .map_err(|e| sqlite_error(&ctx, &e))?
    {
        return Err(throw_coded_error(
            &ctx,
            "Error",
            "cannot restore a read-only database",
            "ERR_SQLITE_ERROR",
        ));
    }

    if !conn.is_autocommit() {
        return Err(throw_coded_error(
            &ctx,
            "Error",
            "cannot restore database with an open transaction",
            "ERR_SQLITE_ERROR",
        ));
    }

    let data = bytes.as_bytes().ok_or_else(|| {
        rquickjs::Exception::throw_message(&ctx, "failed to read Uint8Array bytes")
    })?;

    // Use deserialize_read_exact into a temp in-memory connection, then backup into dest
    let mut temp_conn =
        rusqlite::Connection::open_in_memory().map_err(|e| sqlite_error(&ctx, &e))?;
    temp_conn
        .deserialize_read_exact(rusqlite::MAIN_DB, data, data.len(), false)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let backup =
        rusqlite::backup::Backup::new(&temp_conn, conn).map_err(|e| sqlite_error(&ctx, &e))?;
    backup
        .run_to_completion(100, Duration::ZERO, None)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    Ok(())
}

fn native_backup_impl<'js>(
    ctx: rquickjs::Ctx<'js>,
    conn_id: u32,
    path: String,
    source_db: String,
    target_db: String,
    rate: i32,
) -> rquickjs::Result<i32> {
    let table = lock_conn_table(&ctx)?;
    let src_conn = table
        .connections
        .get(&conn_id)
        .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "database is not open"))?;

    let mut dst_conn = rusqlite::Connection::open(&path).map_err(|e| sqlite_error(&ctx, &e))?;

    let src_name = std::ffi::CString::new(source_db)
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "invalid source database name"))?;
    let dst_name = std::ffi::CString::new(target_db)
        .map_err(|_| rquickjs::Exception::throw_message(&ctx, "invalid target database name"))?;

    let backup =
        rusqlite::backup::Backup::new_with_names(src_conn, &*src_name, &mut dst_conn, &*dst_name)
            .map_err(|e| sqlite_error(&ctx, &e))?;

    backup
        .run_to_completion(rate, Duration::ZERO, None)
        .map_err(|e| sqlite_error(&ctx, &e))?;

    let page_count = backup.progress().pagecount;

    Ok(page_count)
}

#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::{Array, Ctx, Object, Value};

    #[rquickjs::function]
    pub fn open_database<'js>(
        ctx: Ctx<'js>,
        path: String,
        read_only: bool,
        enable_foreign_keys: bool,
        enable_dqs: bool,
        timeout: u32,
    ) -> rquickjs::Result<u32> {
        super::open_database_impl(
            ctx,
            path,
            read_only,
            enable_foreign_keys,
            enable_dqs,
            timeout,
        )
    }

    #[rquickjs::function]
    pub fn close_database<'js>(ctx: Ctx<'js>, conn_id: u32) -> rquickjs::Result<()> {
        super::close_database_impl(ctx, conn_id)
    }

    #[rquickjs::function]
    pub fn exec_sql<'js>(ctx: Ctx<'js>, conn_id: u32, sql: String) -> rquickjs::Result<()> {
        super::exec_sql_impl(ctx, conn_id, sql)
    }

    #[rquickjs::function]
    pub fn is_open(conn_id: u32) -> bool {
        super::is_open_impl(conn_id)
    }

    #[rquickjs::function]
    pub fn is_autocommit(conn_id: u32) -> bool {
        super::is_autocommit_impl(conn_id)
    }

    #[rquickjs::function]
    pub fn stmt_run<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
        params: Value<'js>,
        allow_bare_named: bool,
        allow_unknown_named: bool,
        read_big_ints: bool,
    ) -> rquickjs::Result<Object<'js>> {
        super::stmt_run_impl(
            ctx,
            conn_id,
            sql,
            params,
            allow_bare_named,
            allow_unknown_named,
            read_big_ints,
        )
    }

    #[rquickjs::function]
    pub fn stmt_get<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
        params: Value<'js>,
        allow_bare_named: bool,
        allow_unknown_named: bool,
        read_big_ints: bool,
        return_arrays: bool,
    ) -> rquickjs::Result<Value<'js>> {
        super::stmt_get_impl(
            ctx,
            conn_id,
            sql,
            params,
            allow_bare_named,
            allow_unknown_named,
            read_big_ints,
            return_arrays,
        )
    }

    #[rquickjs::function]
    pub fn stmt_all<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
        params: Value<'js>,
        allow_bare_named: bool,
        allow_unknown_named: bool,
        read_big_ints: bool,
        return_arrays: bool,
    ) -> rquickjs::Result<Array<'js>> {
        super::stmt_all_impl(
            ctx,
            conn_id,
            sql,
            params,
            allow_bare_named,
            allow_unknown_named,
            read_big_ints,
            return_arrays,
        )
    }

    #[rquickjs::function]
    pub fn stmt_expanded_sql<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
        params: Value<'js>,
        allow_bare_named: bool,
    ) -> rquickjs::Result<String> {
        super::stmt_expanded_sql_impl(ctx, conn_id, sql, params, allow_bare_named)
    }

    #[rquickjs::function]
    pub fn stmt_columns<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
    ) -> rquickjs::Result<Array<'js>> {
        super::stmt_columns_impl(ctx, conn_id, sql)
    }

    #[rquickjs::function]
    pub fn stmt_iterate_init<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        sql: String,
        params: Value<'js>,
        allow_bare_named: bool,
        allow_unknown_named: bool,
    ) -> rquickjs::Result<u32> {
        super::stmt_iterate_init_impl(
            ctx,
            conn_id,
            sql,
            params,
            allow_bare_named,
            allow_unknown_named,
        )
    }

    #[rquickjs::function]
    pub fn stmt_iterate_next<'js>(
        ctx: Ctx<'js>,
        iter_id: u32,
        read_big_ints: bool,
        return_arrays: bool,
    ) -> rquickjs::Result<Object<'js>> {
        super::stmt_iterate_next_impl(ctx, iter_id, read_big_ints, return_arrays)
    }

    #[rquickjs::function]
    pub fn stmt_iterate_return<'js>(ctx: Ctx<'js>, iter_id: u32) -> rquickjs::Result<()> {
        super::stmt_iterate_return_impl(ctx, iter_id)
    }

    #[rquickjs::function]
    pub fn register_function<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        name: String,
        callback: rquickjs::Function<'js>,
        deterministic: bool,
        direct_only: bool,
        use_big_int_args: bool,
        varargs: bool,
        num_args: i32,
    ) -> rquickjs::Result<()> {
        super::register_function_impl(
            ctx,
            conn_id,
            name,
            callback,
            deterministic,
            direct_only,
            use_big_int_args,
            varargs,
            num_args,
        )
    }

    #[rquickjs::function]
    pub fn register_aggregate<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        name: String,
        start: Value<'js>,
        step: rquickjs::Function<'js>,
        result_fn: Value<'js>,
        deterministic: bool,
        direct_only: bool,
        use_big_int_args: bool,
        varargs: bool,
        num_args: i32,
    ) -> rquickjs::Result<()> {
        super::register_aggregate_impl(
            ctx,
            conn_id,
            name,
            start,
            step,
            result_fn,
            deterministic,
            direct_only,
            use_big_int_args,
            varargs,
            num_args,
        )
    }

    #[rquickjs::function]
    pub fn create_session<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        table_name: Value<'js>,
        db_name: String,
    ) -> rquickjs::Result<u32> {
        super::create_session_impl(ctx, conn_id, table_name, db_name)
    }

    #[rquickjs::function]
    pub fn session_changeset<'js>(ctx: Ctx<'js>, session_id: u32) -> rquickjs::Result<Value<'js>> {
        super::session_changeset_impl(ctx, session_id)
    }

    #[rquickjs::function]
    pub fn session_patchset<'js>(ctx: Ctx<'js>, session_id: u32) -> rquickjs::Result<Value<'js>> {
        super::session_patchset_impl(ctx, session_id)
    }

    #[rquickjs::function]
    pub fn session_close<'js>(ctx: Ctx<'js>, session_id: u32) -> rquickjs::Result<()> {
        super::session_close_impl(ctx, session_id)
    }

    #[rquickjs::function]
    pub fn apply_changeset<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        changeset: rquickjs::TypedArray<'js, u8>,
        on_conflict: Value<'js>,
        filter: Value<'js>,
    ) -> rquickjs::Result<bool> {
        super::apply_changeset_impl(ctx, conn_id, changeset, on_conflict, filter)
    }

    #[rquickjs::function]
    pub fn get_constants<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
        super::get_constants_impl(ctx)
    }

    #[rquickjs::function]
    pub fn enable_defensive<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        active: bool,
    ) -> rquickjs::Result<()> {
        super::enable_defensive_impl(ctx, conn_id, active)
    }

    #[rquickjs::function]
    pub fn location<'js>(ctx: Ctx<'js>, conn_id: u32) -> rquickjs::Result<Value<'js>> {
        super::location_impl(ctx, conn_id)
    }

    #[rquickjs::function]
    pub fn set_authorizer<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        callback: Value<'js>,
    ) -> rquickjs::Result<()> {
        super::set_authorizer_impl(ctx, conn_id, callback)
    }

    #[rquickjs::function]
    pub fn native_backup<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        path: String,
        source_db: String,
        target_db: String,
        rate: i32,
    ) -> rquickjs::Result<i32> {
        super::native_backup_impl(ctx, conn_id, path, source_db, target_db, rate)
    }

    #[rquickjs::function]
    pub fn serialize_database<'js>(ctx: Ctx<'js>, conn_id: u32) -> rquickjs::Result<Value<'js>> {
        super::serialize_database_impl(ctx, conn_id)
    }

    #[rquickjs::function]
    pub fn restore_database<'js>(
        ctx: Ctx<'js>,
        conn_id: u32,
        bytes: rquickjs::TypedArray<'js, u8>,
    ) -> rquickjs::Result<()> {
        super::restore_database_impl(ctx, conn_id, bytes)
    }
}

pub const SQLITE_JS: &str = include_str!("sqlite.js");

#[allow(dead_code)]
pub const WIRE_JS: &str = "";
