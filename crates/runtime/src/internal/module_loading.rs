//! Module resolution and loading machinery shared by both WASI generation targets.
//!
//! Rust owns package resolution, module classification, static CommonJS analysis, and
//! facade declaration here. JavaScript owns mutable CommonJS state and lifecycle.

use indexmap::IndexMap;
use rquickjs::convert::Coerced;
use rquickjs::function::This;
use rquickjs::loader::{BuiltinResolver, FileResolver, ImportAttributes, Loader, Resolver};
use rquickjs::object::{Accessor, Property};
use rquickjs::prelude::Opt;
use rquickjs::{
    AsyncContext, AsyncRuntime, Ctx, Error, Exception, Function, IntoJs, Module, Object, Value,
    async_with,
};
use serde::de::Error as SerdeError;
use serde::{Deserialize, Deserializer};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;
use std::ops::ControlFlow;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const IMPORT_META_RESOLVE_JS: &str = r#"const __wasm_rquickjs_import_meta_resolve_global = globalThis;
function __wasm_rquickjs_import_meta_resolve_impl(baseUrl, specifier) {
  baseUrl = String(baseUrl);
  specifier = String(specifier);
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(specifier)) return specifier;
  var builtinResolved = typeof __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_builtin === 'function'
    ? __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_builtin(specifier)
    : undefined;
  if (builtinResolved !== undefined) return builtinResolved;
  function codedError(message, code, typeError) {
    var err = typeError ? new TypeError(message) : new Error(message);
    err.code = code;
    return err;
  }
  function ensureSupportedBase() {
    if (baseUrl.startsWith('data:')) {
      throw codedError('Failed to resolve module specifier "' + specifier + '" from "' + baseUrl + '": Invalid relative URL or base scheme is not hierarchical.', 'ERR_UNSUPPORTED_RESOLVE_REQUEST', false);
    }
  }
  function normalizePath(p) {
    var parts = p.split('/'); var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.') continue;
      if (parts[i] === '..') { if (out.length > 0) out.pop(); }
      else out.push(parts[i]);
    }
    return '/' + out.join('/');
  }
  function splitSuffix(value) {
    var query = value.indexOf('?');
    var hash = value.indexOf('#');
    var end = query < 0 ? hash : (hash < 0 ? query : Math.min(query, hash));
    return end < 0 ? [value, ''] : [value.substring(0, end), value.substring(end)];
  }
  function preserveTrailingSlash(path, original) {
    return original.endsWith('/') && !path.endsWith('/') ? path + '/' : path;
  }
  if (specifier.startsWith('/')) {
    ensureSupportedBase();
    if (typeof __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_path === 'function') {
      var pathResolved = __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_path(baseUrl, specifier);
      if (pathResolved !== undefined && pathResolved !== null) return pathResolved;
    }
    var parts = splitSuffix(specifier);
    var path = preserveTrailingSlash(normalizePath(parts[0]), parts[0]);
    return (baseUrl.startsWith('file://') ? 'file://' + path : path) + parts[1];
  }
  if (specifier.startsWith('.')) {
    ensureSupportedBase();
    if (typeof __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_path === 'function') {
      var pathResolved = __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_path(baseUrl, specifier);
      if (pathResolved !== undefined && pathResolved !== null) return pathResolved;
    }
    var base = baseUrl;
    if (base.startsWith('file://')) base = base.slice(7);
    base = splitSuffix(base)[0];
    var dir = base.substring(0, base.lastIndexOf('/') + 1);
    var parts = splitSuffix(specifier);
    var path = preserveTrailingSlash(normalizePath(dir + parts[0]), parts[0]);
    return (baseUrl.startsWith('file://') ? 'file://' + path : path) + parts[1];
  }
  ensureSupportedBase();
  if (typeof __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_package === 'function') {
    var packageResolved = __wasm_rquickjs_import_meta_resolve_global.__wasm_rquickjs_import_meta_resolve_package(baseUrl, specifier);
    if (packageResolved !== undefined && packageResolved !== null) return packageResolved;
  }
  if (specifier.endsWith('/') && baseUrl.startsWith('file://')) {
    var base = splitSuffix(baseUrl.slice(7))[0];
    var dir = base.endsWith('/') ? base : base.substring(0, base.lastIndexOf('/') + 1);
    var resolved = normalizePath(dir + 'node_modules/' + specifier);
    return 'file://' + (resolved.endsWith('/') ? resolved : resolved + '/');
  }
  throw codedError('Cannot find package "' + specifier + '" imported from ' + baseUrl, 'ERR_MODULE_NOT_FOUND', false);
}
Object.defineProperty(globalThis, '__wasm_rquickjs_import_meta_resolve', {
  value: __wasm_rquickjs_import_meta_resolve_impl,
  writable: false,
  configurable: false,
});"#;

pub(crate) const IMPORT_ATTRS_VALIDATE_JS: &str = r#"
const __wasm_rquickjs_import_attr_global = globalThis;

function __wasm_rquickjs_import_attr_read_options(options) {
  var typeValue;
  var unsupportedKey;
  var unsupportedValue;

  if (options !== undefined) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('The second argument to import() must be an object');
    }
    var w = options['with'];
    if (w !== undefined) {
      if (w === null || typeof w !== 'object') {
        throw new TypeError("The 'with' option must be an object");
      }
      var attrs = w;
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] === 'type') {
          typeValue = attrs.type;
          if (typeof typeValue !== 'string') {
            throw new TypeError('Import attribute value must be a string');
          }
        } else if (unsupportedKey === undefined) {
          unsupportedKey = keys[k];
          unsupportedValue = attrs[keys[k]];
        }
      }
    }
  }
  return { typeValue: typeValue, unsupportedKey: unsupportedKey, unsupportedValue: unsupportedValue };
}

function __wasm_rquickjs_import_attr_prepare_from_options(value, parsedOptions, asyncSemanticErrors) {
  value = String(value);
  parsedOptions = parsedOptions || {};
  var typeValue = parsedOptions.typeValue;
  var unsupportedKey = parsedOptions.unsupportedKey;
  var unsupportedValue = parsedOptions.unsupportedValue;

  function semanticError(error) {
    if (!asyncSemanticErrors) throw error;
    return 'data:text/javascript,' + encodeURIComponent(
      'await Promise.reject(Object.assign(new TypeError(' +
      JSON.stringify(error.message) + '), { code: ' + JSON.stringify(error.code) + ' }));'
    );
  }

  var format = null;
  if (value.startsWith('data:')) {
    var rest = value.substring(5);
    var ci = rest.indexOf(',');
    if (ci >= 0) {
      var meta = rest.substring(0, ci).split(';')[0].trim();
      if (meta === 'application/json') format = 'json';
      else if (meta === 'text/javascript' || meta === 'application/javascript') format = 'module';
      else if (meta === 'text/css') format = 'css';
    }
  } else if (value.startsWith('node:')) {
    format = 'module';
  } else if (value.endsWith('.json')) {
    format = 'json';
  } else if (value.endsWith('.js') || value.endsWith('.mjs') || value.endsWith('.cjs')) {
    format = 'module';
  }

  if (typeValue !== undefined && typeValue !== 'json' && !(typeValue === 'css' && format === 'css')) {
    return semanticError(Object.assign(
      new TypeError('Import attribute type "' + typeValue + '" is not supported'),
      { code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' }
    ));
  }

  var moduleTypeErrorCache;
  var moduleTypeErrorCacheKey;
  if (asyncSemanticErrors) {
    moduleTypeErrorCache = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_module_type_error_cache;
    if (moduleTypeErrorCache === undefined) {
      moduleTypeErrorCache = Object.create(null);
      __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_module_type_error_cache = moduleTypeErrorCache;
    }
    moduleTypeErrorCacheKey = value + '\x00type=' + (typeValue === undefined ? '' : typeValue);
    if (moduleTypeErrorCache[moduleTypeErrorCacheKey] !== undefined) {
      return moduleTypeErrorCache[moduleTypeErrorCacheKey];
    }
  }

  function moduleTypeSemanticError(error) {
    var prepared = semanticError(error);
    if (asyncSemanticErrors) moduleTypeErrorCache[moduleTypeErrorCacheKey] = prepared;
    return prepared;
  }

  if (unsupportedKey !== undefined) {
    var unsupportedValueText = typeof unsupportedValue === 'string'
      ? '"' + unsupportedValue + '"'
      : String(unsupportedValue);
    return semanticError(Object.assign(
      new TypeError('Import attribute "' + unsupportedKey + '" with value ' + unsupportedValueText + ' is not supported'),
      { code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' }
    ));
  }

  if (typeValue !== undefined) {
    if (typeValue === 'json') {
      if (format === 'module') {
        return moduleTypeSemanticError(Object.assign(
          new TypeError('Cannot use import attributes to change the type of a JavaScript module'),
          { code: 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE' }
        ));
      }
    } else if (typeValue === 'css' && format === 'css') {
      // Let the loader report unsupported CSS modules as an unknown format.
    }
  }

  if (format === 'json') {
    if (typeValue !== 'json') {
      return moduleTypeSemanticError(Object.assign(
        new TypeError('Module "' + value + '" needs an import attribute of "type: json"'),
        { code: 'ERR_IMPORT_ATTRIBUTE_MISSING' }
      ));
    }
  }

  if (typeValue !== 'json') return value;
  return __wasm_rquickjs_import_attr_global.__wasm_rquickjs_register_import_attr_rewrite(value, 'json');
}

function __wasm_rquickjs_import_attr_prepare(specifier, options, asyncSemanticErrors) {
  var value = String(specifier);
  var parsedOptions = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_read_options(options);
  return __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_prepare_from_options(value, parsedOptions, asyncSemanticErrors);
}

async function __wasm_rquickjs_import_attr_prepare_for_base(baseUrl, specifier, options, asyncSemanticErrors) {
  var originalValue = String(specifier);
  var parsedOptions = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_read_options(options);
  return __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_prepare_for_base_parsed(baseUrl, originalValue, parsedOptions, asyncSemanticErrors);
}

async function __wasm_rquickjs_import_attr_prepare_for_base_parsed(baseUrl, originalValue, parsedOptions, asyncSemanticErrors) {
  originalValue = String(originalValue);
  parsedOptions = parsedOptions || {};
  if (
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_registered_loaders &&
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_registered_loaders.length > 0
  ) {
    var hooked = await __wasm_rquickjs_import_attr_global.__wasm_rquickjs_run_registered_loaders(String(baseUrl), originalValue, parsedOptions);
    if (hooked !== undefined) return hooked;
  }
  var value = originalValue;
  if (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.startsWith('file://')
  ) {
    value = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_meta_resolve(String(baseUrl), value);
  }
  return __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_prepare_from_options(value, parsedOptions, asyncSemanticErrors);
}

async function __wasm_rquickjs_import_attr_dynamic_import(baseUrl, specifier, options, asyncSemanticErrors, importer) {
  var originalSpecifier = String(specifier);
  var parsedOptions = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_read_options(options);
  return __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_dynamic_import_parsed(baseUrl, originalSpecifier, parsedOptions, asyncSemanticErrors, importer);
}

async function __wasm_rquickjs_import_attr_dynamic_import_parsed(baseUrl, originalSpecifier, parsedOptions, asyncSemanticErrors, importer) {
  originalSpecifier = String(originalSpecifier);
  parsedOptions = parsedOptions || {};
  var prepared = await __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_prepare_for_base_parsed(baseUrl, originalSpecifier, parsedOptions, asyncSemanticErrors);
  var key = String(prepared);
  var completedKey = key;
  var originalHasRewriteToken = originalSpecifier.indexOf('__wasm_rquickjs_import_type=') >= 0;
  var tokenMatch = originalHasRewriteToken ? null : /^data:([^,]*);__wasm_rquickjs_import_type=([^;,]+)(,.*)$/.exec(key);
  if (tokenMatch) {
    completedKey = 'import-attr:' + tokenMatch[2].split('-')[0] + ':data:' + tokenMatch[1] + tokenMatch[3];
  } else {
    tokenMatch = originalHasRewriteToken ? null : /([?#&])__wasm_rquickjs_import_type=([^&#]+)(&?)/.exec(key);
    if (tokenMatch) {
      var tokenStart = tokenMatch.index;
      var tokenEnd = tokenStart + tokenMatch[0].length;
      var prefix = key.slice(0, tokenStart);
      var suffix = key.slice(tokenEnd);
      var separator = tokenMatch[1];
      if (separator === '&') {
        completedKey = prefix + (suffix ? '&' + suffix : '');
      } else if (tokenMatch[3] === '&') {
        completedKey = prefix + separator + suffix;
      } else {
        completedKey = prefix + suffix;
      }
      if (completedKey.endsWith('?') || completedKey.endsWith('#')) completedKey = completedKey.slice(0, -1);
      completedKey = 'import-attr:' + tokenMatch[2].split('-')[0] + ':' + completedKey;
    }
  }
  var generatedRewriteToken = completedKey !== key && !originalHasRewriteToken;
  function discardGeneratedRewriteToken() {
    if (generatedRewriteToken && typeof __wasm_rquickjs_import_attr_global.__wasm_rquickjs_discard_import_attr_rewrite === 'function') {
      __wasm_rquickjs_import_attr_global.__wasm_rquickjs_discard_import_attr_rewrite(key);
    }
  }
  var importFn = typeof importer === 'function' ? importer : function(value) { return import(value); };
  if (
    typeof __wasm_rquickjs_import_attr_global.__wasm_rquickjs_has_import_mock === 'function' &&
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_has_import_mock(prepared, baseUrl)
  ) {
    try {
      return await importFn(prepared);
    } finally {
      discardGeneratedRewriteToken();
    }
  }
  var cache = __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_inflight;
  if (!cache) {
    cache = Object.create(null);
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_import_attr_inflight = cache;
  }
  if (cache[completedKey] !== undefined) {
    var cached = cache[completedKey];
    if (cached.preparedKey !== key) {
      discardGeneratedRewriteToken();
    }
    return cached.promise;
  }
  if (
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_registered_loaders &&
    __wasm_rquickjs_import_attr_global.__wasm_rquickjs_registered_loaders.length > 0 &&
    typeof __wasm_rquickjs_import_attr_global.__wasm_rquickjs_prepare_static_registered_loader_graph === 'function' &&
    !String(prepared).startsWith('data:application/json') &&
    !/[.]json(?:[?#]|$)/.test(String(prepared))
  ) {
    await __wasm_rquickjs_import_attr_global.__wasm_rquickjs_prepare_static_registered_loader_graph(prepared, originalSpecifier, baseUrl, parsedOptions);
  }
  var promise = importFn(prepared);
  var entry = { promise: promise, preparedKey: key };
  cache[completedKey] = entry;
  try {
    var result = await promise;
    discardGeneratedRewriteToken();
    return result;
  } catch (error) {
    if (cache[completedKey] === entry) delete cache[completedKey];
    discardGeneratedRewriteToken();
    throw error;
  } finally {
  }
}

[
  ['__wasm_rquickjs_import_attr_read_options', __wasm_rquickjs_import_attr_read_options],
  ['__wasm_rquickjs_import_attr_prepare_from_options', __wasm_rquickjs_import_attr_prepare_from_options],
  ['__wasm_rquickjs_import_attr_prepare', __wasm_rquickjs_import_attr_prepare],
  ['__wasm_rquickjs_import_attr_prepare_for_base', __wasm_rquickjs_import_attr_prepare_for_base],
  ['__wasm_rquickjs_import_attr_prepare_for_base_parsed', __wasm_rquickjs_import_attr_prepare_for_base_parsed],
  ['__wasm_rquickjs_import_attr_dynamic_import', __wasm_rquickjs_import_attr_dynamic_import],
  ['__wasm_rquickjs_import_attr_dynamic_import_parsed', __wasm_rquickjs_import_attr_dynamic_import_parsed],
].forEach(function(entry) {
  var name = entry[0];
  var fn = entry[1];
  Object.defineProperty(__wasm_rquickjs_import_attr_global, name, {
    value: fn,
    writable: false,
    configurable: false,
  });
});
"#;

fn throw_native_coded_error<'js, T>(
    ctx: &Ctx<'js>,
    message: &str,
    code: &str,
    type_error: bool,
) -> rquickjs::Result<T> {
    let error_value = if type_error {
        let _ = Exception::throw_type(ctx, message);
        ctx.catch()
    } else {
        Exception::from_message(ctx.clone(), message)?.into_value()
    };
    let Some(error_obj) = error_value.clone().into_object() else {
        return Err(ctx.throw(error_value));
    };
    error_obj.prop(
        "code",
        Property::from(code).writable().enumerable().configurable(),
    )?;
    Err(ctx.throw(error_obj.into_value()))
}

/// Resolver that passes `data:` URLs through as-is.
struct DataUrlResolver;

impl Resolver for DataUrlResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        _base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if name.starts_with("data:") {
            Ok(name.to_string())
        } else {
            Err(Error::new_resolving(_base, name))
        }
    }
}

struct PrivateBuiltinResolverGuard;

impl PrivateBuiltinResolverGuard {
    fn is_private_builtin(name: &str) -> bool {
        name.starts_with("__wasm_rquickjs_builtin/")
    }

    fn is_user_referrer(base: &str) -> bool {
        base == crate::JS_EXPORT_MODULE_NAME
            || base == "<input>"
            || crate::JS_ADDITIONAL_MODULES
                .iter()
                .any(|(name, _)| base == *name)
            || base.starts_with("data:")
            || base.starts_with("file:")
            || base.starts_with('/')
            || base.starts_with("virtual:")
    }
}

impl Resolver for PrivateBuiltinResolverGuard {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if !Self::is_private_builtin(name) || !Self::is_user_referrer(base) {
            return Err(Error::new_resolving(base, name));
        }

        let message = format!("Cannot find module '{}'", name);
        throw_native_coded_error(ctx, &message, "ERR_MODULE_NOT_FOUND", false)
    }
}

/// Loader for `data:` URL modules (e.g. `data:text/javascript,export default 42`).
struct DataUrlLoader;

impl DataUrlLoader {
    fn content_separator_pos(rest: &str) -> Option<usize> {
        rest.find(',')
    }

    fn percent_decode(encoded: &str) -> Option<String> {
        let bytes = encoded.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%'
                && i + 2 < bytes.len()
                && let (Some(hi), Some(lo)) = (
                    FileUrlResolver::hex_val(bytes[i + 1]),
                    FileUrlResolver::hex_val(bytes[i + 2]),
                )
            {
                decoded.push(hi << 4 | lo);
                i += 3;
                continue;
            }
            decoded.push(bytes[i]);
            i += 1;
        }
        String::from_utf8(decoded).ok()
    }

    fn source_url(path: &str) -> Option<String> {
        let registered_path = strip_import_type_rewrite_token(path);
        LOADER_SOURCE_URLS.with(|urls| urls.borrow().get(&registered_path).cloned())
    }

    fn js_string_escape(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        for ch in s.chars() {
            match ch {
                '\'' => result.push_str("\\'"),
                '\\' => result.push_str("\\\\"),
                '\n' => result.push_str("\\n"),
                '\r' => result.push_str("\\r"),
                '\t' => result.push_str("\\t"),
                '\0' => result.push_str("\\0"),
                _ => result.push(ch),
            }
        }
        result
    }

    fn is_valid_json(s: &str) -> bool {
        let s = s.trim();
        if s.is_empty() {
            return false;
        }
        let bytes = s.as_bytes();
        let (ok, pos) = Self::skip_json_value(bytes, 0);
        if !ok {
            return false;
        }
        // Valid if we consumed the entire input
        let end = Self::skip_whitespace(bytes, pos);
        end == bytes.len()
    }

    fn skip_whitespace(bytes: &[u8], mut i: usize) -> usize {
        while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
        }
        i
    }

    fn skip_json_value(bytes: &[u8], i: usize) -> (bool, usize) {
        let i = Self::skip_whitespace(bytes, i);
        if i >= bytes.len() {
            return (false, i);
        }
        match bytes[i] {
            b'"' => Self::skip_json_string(bytes, i),
            b'{' => Self::skip_json_object(bytes, i),
            b'[' => Self::skip_json_array(bytes, i),
            b't' => Self::skip_literal(bytes, i, b"true"),
            b'f' => Self::skip_literal(bytes, i, b"false"),
            b'n' => Self::skip_literal(bytes, i, b"null"),
            b'-' | b'0'..=b'9' => Self::skip_json_number(bytes, i),
            _ => (false, i),
        }
    }

    fn skip_json_string(bytes: &[u8], mut i: usize) -> (bool, usize) {
        if i >= bytes.len() || bytes[i] != b'"' {
            return (false, i);
        }
        i += 1;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => {
                    i += 1;
                    if i >= bytes.len() {
                        return (false, i);
                    }
                    if bytes[i] == b'u' {
                        i += 1;
                        for _ in 0..4 {
                            if i >= bytes.len() || !bytes[i].is_ascii_hexdigit() {
                                return (false, i);
                            }
                            i += 1;
                        }
                    } else {
                        i += 1;
                    }
                }
                b'"' => return (true, i + 1),
                _ => i += 1,
            }
        }
        (false, i) // unterminated string
    }

    fn skip_json_object(bytes: &[u8], mut i: usize) -> (bool, usize) {
        i += 1; // skip '{'
        i = Self::skip_whitespace(bytes, i);
        if i < bytes.len() && bytes[i] == b'}' {
            return (true, i + 1);
        }
        loop {
            i = Self::skip_whitespace(bytes, i);
            let (ok, next) = Self::skip_json_string(bytes, i);
            if !ok {
                return (false, next);
            }
            i = Self::skip_whitespace(bytes, next);
            if i >= bytes.len() || bytes[i] != b':' {
                return (false, i);
            }
            i += 1;
            let (ok, next) = Self::skip_json_value(bytes, i);
            if !ok {
                return (false, next);
            }
            i = Self::skip_whitespace(bytes, next);
            if i >= bytes.len() {
                return (false, i);
            }
            if bytes[i] == b'}' {
                return (true, i + 1);
            }
            if bytes[i] != b',' {
                return (false, i);
            }
            i += 1;
        }
    }

    fn skip_json_array(bytes: &[u8], mut i: usize) -> (bool, usize) {
        i += 1; // skip '['
        i = Self::skip_whitespace(bytes, i);
        if i < bytes.len() && bytes[i] == b']' {
            return (true, i + 1);
        }
        loop {
            let (ok, next) = Self::skip_json_value(bytes, i);
            if !ok {
                return (false, next);
            }
            i = Self::skip_whitespace(bytes, next);
            if i >= bytes.len() {
                return (false, i);
            }
            if bytes[i] == b']' {
                return (true, i + 1);
            }
            if bytes[i] != b',' {
                return (false, i);
            }
            i += 1;
        }
    }

    fn skip_literal(bytes: &[u8], i: usize, expected: &[u8]) -> (bool, usize) {
        if i + expected.len() <= bytes.len() && &bytes[i..i + expected.len()] == expected {
            (true, i + expected.len())
        } else {
            (false, i)
        }
    }

    fn skip_json_number(bytes: &[u8], mut i: usize) -> (bool, usize) {
        if i < bytes.len() && bytes[i] == b'-' {
            i += 1;
        }
        if i >= bytes.len() || !bytes[i].is_ascii_digit() {
            return (false, i);
        }
        if bytes[i] == b'0' {
            i += 1;
        } else {
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        if i < bytes.len() && bytes[i] == b'.' {
            i += 1;
            if i >= bytes.len() || !bytes[i].is_ascii_digit() {
                return (false, i);
            }
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
            i += 1;
            if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
                i += 1;
            }
            if i >= bytes.len() || !bytes[i].is_ascii_digit() {
                return (false, i);
            }
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        (true, i)
    }

    fn make_json_error_module(source: &str) -> String {
        let bytes = source.as_bytes();
        let msg = if bytes.is_empty() {
            "Unexpected end of JSON input".to_string()
        } else if bytes[0] == b'"' {
            let (ok, pos) = Self::skip_json_string(bytes, 0);
            if !ok {
                format!("Unterminated string in JSON at position {}", pos)
            } else {
                let (_, pos) = Self::skip_json_value(bytes, 0);
                if pos >= bytes.len() {
                    "Unexpected end of JSON input".to_string()
                } else {
                    format!(
                        "Unexpected token {} in JSON at position {}",
                        bytes[pos] as char, pos
                    )
                }
            }
        } else {
            let (_, pos) = Self::skip_json_value(bytes, 0);
            if pos >= bytes.len() {
                "Unexpected end of JSON input".to_string()
            } else {
                format!(
                    "Unexpected token {} in JSON at position {}",
                    bytes[pos] as char, pos
                )
            }
        };
        let escaped_msg = Self::js_string_escape(&msg);
        format!(
            "export default undefined;\nawait Promise.reject(new SyntaxError('{escaped_msg}'));\n"
        )
    }
}

struct JsonModuleCjsCache<'a> {
    filename: &'a str,
    dirname: &'a str,
}

fn json_import_attribute_missing_module_source(path: &str) -> String {
    let escaped = DataUrlLoader::js_string_escape(path);
    format!(
        "await Promise.reject(Object.assign(new TypeError('Module \"{escaped}\" needs an import attribute of type: json'), {{code: 'ERR_IMPORT_ATTRIBUTE_MISSING'}}));\n"
    )
}

fn json_module_source(source: &str, cjs_cache: Option<JsonModuleCjsCache<'_>>) -> String {
    if !DataUrlLoader::is_valid_json(source) {
        return DataUrlLoader::make_json_error_module(source);
    }

    let escaped = DataUrlLoader::js_string_escape(source);
    if let Some(cjs_cache) = cjs_cache {
        format!(
            "const __wasm_rquickjs_require = import.meta.__wasm_rquickjs_global.__wasm_rquickjs_create_require(\"{}\");\nconst __wasm_rquickjs_filename = \"{}\";\nconst __wasm_rquickjs_cached = __wasm_rquickjs_require.cache[__wasm_rquickjs_filename];\nconst __wasm_rquickjs_value = __wasm_rquickjs_cached ? __wasm_rquickjs_cached.exports : JSON.parse('{escaped}');\nif (!__wasm_rquickjs_cached) __wasm_rquickjs_require.cache[__wasm_rquickjs_filename] = {{ id: __wasm_rquickjs_filename, filename: __wasm_rquickjs_filename, path: \"{}\", exports: __wasm_rquickjs_value, loaded: true, parent: null, children: [], paths: [] }};\nexport default __wasm_rquickjs_value;\n",
            escape_js_string(cjs_cache.filename),
            escape_js_string(cjs_cache.filename),
            escape_js_string(cjs_cache.dirname)
        )
    } else {
        format!("export default JSON.parse('{escaped}');\n")
    }
}

impl Loader for DataUrlLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let path_without_suffix = module_filesystem_path(path);
        let rest = path_without_suffix
            .strip_prefix("data:")
            .ok_or_else(|| Error::new_loading(path))?;

        // Find the comma separating metadata from content
        let comma_pos =
            Self::content_separator_pos(rest).ok_or_else(|| Error::new_loading(path))?;
        let metadata = &rest[..comma_pos];
        let raw_content = rest[comma_pos + 1..]
            .split_once('#')
            .map(|(content, _)| content)
            .unwrap_or(&rest[comma_pos + 1..]);

        // Parse metadata: e.g. "text/javascript" or "text/javascript;base64".
        let is_base64 = metadata
            .split(';')
            .skip(1)
            .any(|part| part.eq_ignore_ascii_case("base64"));

        // Extract base MIME type (before any parameters)
        let base_mime = metadata.split(';').next().unwrap_or(metadata).trim();

        let json_import_attr = if base_mime == "application/json" {
            import_attr_type_from_path(path)
        } else {
            None
        };

        let source = if is_base64 {
            // Simple base64 decoder for ASCII content
            let decoded = base64_decode(raw_content).ok_or_else(|| Error::new_loading(path))?;
            String::from_utf8(decoded).map_err(|_| Error::new_loading(path))?
        } else {
            Self::percent_decode(raw_content).ok_or_else(|| Error::new_loading(path))?
        };

        if base_mime == "application/json" {
            if json_import_attr.as_deref() != Some("json") {
                let module_source = json_import_attribute_missing_module_source(path);
                return Module::declare(ctx.clone(), path, module_source.as_bytes().to_vec());
            }
            let module_source = json_module_source(&source, None);
            Module::declare(ctx.clone(), path, module_source.as_bytes().to_vec())
        } else if base_mime == "text/javascript" || base_mime == "application/javascript" {
            // Check for static import attributes (e.g., `import "spec" with { type: "json" }`)
            // QuickJS doesn't support import attributes syntax, so we preprocess:
            // - If `with { ... }` is found and attributes are invalid, generate an error module
            // - If valid, strip the `with { ... }` clause
            // - `assert { ... }` is left as-is (QuickJS will throw SyntaxError, as expected)
            let processed = process_static_import_attrs(&source, path);
            if let Some(error_source) =
                esm_preflight_error_module_source(&processed.source, false, false)
            {
                return Module::declare(ctx.clone(), path, error_source.as_bytes().to_vec());
            }
            if let Some(error_source) =
                data_url_simple_identifier_error_module_source(&processed.source)
            {
                return Module::declare(ctx.clone(), path, error_source.as_bytes().to_vec());
            }

            let source_url = Self::source_url(path).unwrap_or_else(|| path.to_string());
            let init = FileUrlResolver::file_url_to_path_parts(&source_url)
                .map(|(filename, _)| file_import_meta_init(source_url.clone(), filename))
                .unwrap_or_else(|| url_only_import_meta_init(source_url));
            let injected = inject_module_source_prologue(
                init.filename.as_deref(),
                &processed.source,
                processed.dynamic_import_binding_names.as_ref(),
            );
            declare_module_with_import_meta(ctx, path, &injected, &init)
        } else {
            let escaped_mime = Self::js_string_escape(base_mime);
            let escaped_path = Self::js_string_escape(path);
            let module_source = format!(
                "await Promise.reject(Object.assign(new TypeError('Unknown module format: {escaped_mime} for URL {escaped_path}'), {{code: 'ERR_UNKNOWN_MODULE_FORMAT'}}));\n"
            );
            Module::declare(ctx.clone(), path, module_source.as_bytes().to_vec())
        }
    }
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(input.len() * 3 / 4);
    let mut accum: u32 = 0;
    let mut bits: u32 = 0;
    for b in input.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        };
        accum = (accum << 6) | val as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            buf.push((accum >> bits) as u8);
            accum &= (1 << bits) - 1;
        }
    }
    Some(buf)
}

const IMPORT_TYPE_QUERY_PREFIX: &str = "__wasm_rquickjs_import_type=";

thread_local! {
    static IMPORT_ATTR_REWRITE_TOKENS: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
    static LOADER_SOURCE_URLS: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
}

static IMPORT_ATTR_REWRITE_SEQ: AtomicUsize = AtomicUsize::new(1);
static LOADER_SOURCE_URL_SEQ: AtomicUsize = AtomicUsize::new(1);

fn next_import_attr_rewrite_token(import_type: &str) -> String {
    let seq = IMPORT_ATTR_REWRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(seq as u128);
    format!("{import_type}-{seq:x}-{nonce:x}")
}

fn register_loader_source_url(specifier: &str, source_url: &str) -> String {
    let seq = LOADER_SOURCE_URL_SEQ.fetch_add(1, Ordering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(seq as u128);
    let registered = format!("{specifier}#__wasm_rquickjs_loader_source={seq:x}-{nonce:x}");
    LOADER_SOURCE_URLS.with(|urls| {
        urls.borrow_mut()
            .insert(registered.clone(), source_url.to_string());
    });
    registered
}

fn register_import_attr_rewrite(token: &str, rewritten_specifier: &str) {
    IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
        tokens
            .borrow_mut()
            .insert(token.to_string(), rewritten_specifier.to_string());
    });
}

fn existing_import_attr_rewrite(specifier: &str, import_type: &str) -> Option<String> {
    IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
        tokens.borrow().iter().find_map(|(token, rewritten)| {
            let (token_import_type, _) = token.split_once('-')?;
            if token_import_type == import_type
                && strip_import_type_rewrite_token(rewritten) == specifier
            {
                Some(rewritten.clone())
            } else {
                None
            }
        })
    })
}

fn consume_import_type_rewrite_token(token: &str, path: &str) -> Option<String> {
    IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
        let mut tokens = tokens.borrow_mut();
        if tokens.get(token).is_some_and(|specifier| specifier == path) {
            tokens.remove(token);
            token
                .split_once('-')
                .map(|(import_type, _)| import_type.to_string())
        } else {
            None
        }
    })
}

fn transfer_import_type_rewrite_token(unresolved: &str, resolved: &str) {
    let token = import_type_rewrite_token(unresolved);
    if let Some(token) = token {
        IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
            let mut tokens = tokens.borrow_mut();
            if tokens
                .get(token)
                .is_some_and(|specifier| specifier == unresolved)
            {
                tokens.insert(token.to_string(), resolved.to_string());
            }
        });
    }
}

fn discard_import_type_rewrite_token(path: &str) {
    let token = import_type_rewrite_token(path);
    if let Some(token) = token {
        IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
            let mut tokens = tokens.borrow_mut();
            if tokens.get(token).is_some_and(|specifier| specifier == path) {
                tokens.remove(token);
            }
        });
    }
}

fn discard_generated_import_type_rewrite_token(path: &str) {
    let token = import_type_rewrite_token(path);
    if let Some(token) = token {
        IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
            tokens.borrow_mut().remove(token);
        });
    }
}

fn import_type_rewrite_token(path: &str) -> Option<&str> {
    if let Some(rest) = path.strip_prefix("data:")
        && let Some(comma_pos) = DataUrlLoader::content_separator_pos(rest)
    {
        let metadata = &rest[..comma_pos];
        return metadata
            .split(';')
            .find_map(|part| part.strip_prefix(IMPORT_TYPE_QUERY_PREFIX));
    }

    let suffix = split_module_path_suffix(path).1;
    if suffix.is_empty() {
        return None;
    }
    let query = suffix
        .strip_prefix('?')
        .or_else(|| suffix.strip_prefix('#'))
        .unwrap_or(suffix);
    query
        .split(['&', '#'])
        .find_map(|part| part.strip_prefix(IMPORT_TYPE_QUERY_PREFIX))
}

fn has_import_type_rewrite_token(path: &str) -> bool {
    import_type_rewrite_token(path).is_some_and(|token| {
        IMPORT_ATTR_REWRITE_TOKENS.with(|tokens| {
            tokens
                .borrow()
                .get(token)
                .is_some_and(|specifier| specifier == path)
        })
    })
}

fn read_import_specifier_literal(source: &str, pos: usize) -> Option<(usize, usize, usize, usize)> {
    let bytes = source.as_bytes();
    if !matches!(bytes.get(pos), Some(b'"' | b'\'')) {
        return None;
    }

    let literal_start = pos;
    let quote = bytes[pos];
    let mut i = pos + 1;
    let specifier_start = i;
    while i < bytes.len() && bytes[i] != quote {
        if bytes[i] == b'\\' {
            i += 1;
        }
        i += 1;
    }
    let specifier_end = i;
    if i < bytes.len() {
        i += 1;
    }
    Some((literal_start, i, specifier_start, specifier_end))
}

fn read_closed_import_specifier_literal(
    source: &str,
    pos: usize,
) -> Option<(usize, usize, usize, usize)> {
    let literal = read_import_specifier_literal(source, pos)?;
    let bytes = source.as_bytes();
    if literal.1 <= pos + 1 || literal.1 > bytes.len() || bytes.get(literal.1 - 1) != bytes.get(pos)
    {
        return None;
    }
    Some(literal)
}

/// Process static import attributes in JavaScript module source code.
///
/// Handles patterns like `import "specifier" with { type: "json" }`.
/// - If `with { ... }` is found and attributes are invalid, returns an error module source.
/// - If valid, strips the `with { ... }` clause so QuickJS can parse it.
/// - `assert { ... }` is left unchanged (QuickJS will throw SyntaxError).
struct ProcessedStaticImportAttrs {
    source: String,
    dynamic_import_binding_names: Option<(String, String)>,
}

impl ProcessedStaticImportAttrs {
    fn plain(source: String) -> Self {
        Self {
            source,
            dynamic_import_binding_names: None,
        }
    }
}

fn process_static_import_attrs(source: &str, module_path: &str) -> ProcessedStaticImportAttrs {
    process_import_attrs(source, module_path, None, "undefined", "import.meta.url")
}

fn process_import_attrs(
    source: &str,
    module_path: &str,
    inherited_dynamic_import_binding_names: Option<(String, String)>,
    parent_filename_expression: &str,
    parent_url_expression: &str,
) -> ProcessedStaticImportAttrs {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(len);
    let mut i = 0;
    let mut dynamic_import_binding_names = inherited_dynamic_import_binding_names;
    let mut rewrote_dynamic_import = false;

    while i < len {
        if let Some(next) = skip_non_code(source, i, true) {
            result.push_str(&source[i..next]);
            i = next;
            continue;
        }

        // Look for 'import' keyword
        if bytes[i] == b'i'
            && i + 6 <= len
            && &bytes[i..i + 6] == b"import"
            && (i == 0 || !is_ident_continue(bytes[i - 1]))
            && (i == 0 || (bytes[i - 1] != b'.' && bytes[i - 1] != b'#'))
            && (i + 6 >= len
                || !is_ident_continue(bytes[i + 6])
                || bytes[i + 6] == b'"'
                || bytes[i + 6] == b'\'')
        {
            let import_start = i;
            i += 6;

            let mut specifier_literal = None;

            i = skip_ws_comments(source, i);

            if i < len && bytes[i] == b'(' {
                if is_object_method_shorthand_import(source, import_start, i) {
                    result.push_str(&source[import_start..i]);
                    continue;
                }
                let (dynamic_import_reaction_name, dynamic_import_with_trace_name) =
                    dynamic_import_binding_names.get_or_insert_with(|| {
                        (
                            unique_internal_name(source, "__wasm_rquickjs_dynamic_import_reaction"),
                            unique_internal_name(
                                source,
                                "__wasm_rquickjs_dynamic_import_with_trace",
                            ),
                        )
                    });
                if let Some((rewritten, next)) = rewrite_dynamic_import_call(
                    source,
                    import_start,
                    i,
                    dynamic_import_reaction_name,
                    dynamic_import_with_trace_name,
                    module_path,
                    parent_filename_expression,
                    parent_url_expression,
                ) {
                    rewrote_dynamic_import = true;
                    result.push_str(&rewritten);
                    i = next;
                    continue;
                }
                result.push_str(&source[import_start..i]);
                continue;
            }

            if let Some(literal) = read_import_specifier_literal(source, i) {
                specifier_literal = Some(literal);
                i = literal.1;
            } else {
                while i < len {
                    if bytes[i] == b'f'
                        && i + 4 <= len
                        && &bytes[i..i + 4] == b"from"
                        && (i == 0 || !is_ident_continue(bytes[i - 1]))
                        && (i + 4 >= len || !is_ident_continue(bytes[i + 4]))
                    {
                        let mut j = i + 4;
                        j = skip_ws_comments(source, j);
                        if let Some(literal) = read_import_specifier_literal(source, j) {
                            specifier_literal = Some(literal);
                            i = literal.1;
                            break;
                        }
                    }
                    if matches!(bytes[i], b';' | b'\n' | b'\r') {
                        break;
                    }
                    i += 1;
                }
            }

            if let Some((spec_lit_start, spec_lit_end, spec_start, spec_end)) = specifier_literal {
                let specifier = &source[spec_start..spec_end];

                // Skip whitespace
                let after_spec = i;
                i = skip_ws_comments(source, i);

                if i + 6 <= len
                    && &bytes[i..i + 6] == b"assert"
                    && (i + 6 >= len || !is_ident_continue(bytes[i + 6]))
                {
                    return ProcessedStaticImportAttrs::plain(
                        "await Promise.reject(new SyntaxError('Unexpected identifier'));\n"
                            .to_string(),
                    );
                }

                // Check for 'with' keyword (not 'with(' which is a with-statement)
                if i + 4 <= len
                    && &bytes[i..i + 4] == b"with"
                    && (i + 4 >= len || !is_ident_continue(bytes[i + 4]) || bytes[i + 4] == b'{')
                {
                    let with_start = i;
                    i += 4;
                    i = skip_ws_comments(source, i);
                    if i < len && bytes[i] == b'{' {
                        i += 1;
                        let attrs_start = i;
                        let mut depth = 1u32;
                        while i < len && depth > 0 {
                            match bytes[i] {
                                b'{' => depth += 1,
                                b'}' => depth -= 1,
                                b'"' | b'\'' => {
                                    let next = skip_string_or_template(source, i);
                                    i = if next == len && bytes.get(len - 1) != Some(&bytes[i]) {
                                        len + 1
                                    } else {
                                        next
                                    };
                                    continue;
                                }
                                _ => {}
                            }
                            i += 1;
                        }
                        let attrs_content = &source[attrs_start..if i > 0 { i - 1 } else { i }];

                        let attr_info = extract_import_attr_info(attrs_content);
                        if attr_info.type_non_string {
                            return ProcessedStaticImportAttrs::plain(syntax_error_module_source(
                                "Import attribute value must be a string",
                            ));
                        }
                        let format = determine_data_url_format(specifier);

                        // Validate
                        if let Some(error_module) = validate_static_import_attrs(
                            attr_info.type_value.as_deref(),
                            attr_info.unsupported_key.as_deref(),
                            format,
                            specifier,
                            module_path,
                        ) {
                            return ProcessedStaticImportAttrs::plain(error_module);
                        }

                        // Valid: strip the with clause, keep everything else
                        result.push_str(&source[import_start..spec_lit_start]);
                        result.push_str(&rewrite_import_specifier_literal(
                            &source[spec_lit_start..spec_lit_end],
                            specifier,
                            attr_info.type_value.as_deref(),
                        ));
                        result.push_str(&source[spec_lit_end..after_spec]);
                        continue;
                    } else {
                        // 'with' not followed by '{', not import attrs
                        i = with_start;
                        result.push_str(&source[import_start..i]);
                        continue;
                    }
                }

                let format = determine_data_url_format(specifier);
                if let Some(error_module) =
                    validate_static_import_attrs(None, None, format, specifier, module_path)
                {
                    return ProcessedStaticImportAttrs::plain(error_module);
                }

                result.push_str(&source[import_start..i]);
                continue;
            }

            // Not a bare import string - check for named/namespace imports with 'from'
            // For now, scan for 'from' followed by a string and then 'with'
            // Skip complex patterns and output as-is
            result.push_str(&source[import_start..i]);
            continue;
        }

        if let Some(ch) = source[i..].chars().next() {
            result.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }

    ProcessedStaticImportAttrs {
        source: result,
        dynamic_import_binding_names: rewrote_dynamic_import.then(|| {
            dynamic_import_binding_names.expect(
                "dynamic import bindings must be initialized when a dynamic import was rewritten",
            )
        }),
    }
}

fn rewrite_import_specifier_literal(
    literal: &str,
    specifier: &str,
    type_value: Option<&str>,
) -> String {
    if type_value != Some("json") {
        return literal.to_string();
    }
    let rewritten = append_import_type_query(specifier, "json");
    format!("\"{}\"", escape_js_string(&rewritten))
}

fn unique_internal_name(source: &str, base: &str) -> String {
    let mut name = base.to_string();
    let mut seq = 0usize;
    while source.contains(&name) {
        seq += 1;
        name = format!("{base}_{seq}");
    }
    name
}

// Keeping the parser coordinates and injected binding expressions explicit makes the
// rewrite boundary easier to audit than grouping unrelated borrowed values together.
#[allow(clippy::too_many_arguments)]
fn rewrite_dynamic_import_call(
    source: &str,
    import_start: usize,
    open_paren: usize,
    dynamic_import_reaction_name: &str,
    dynamic_import_with_trace_name: &str,
    module_path: &str,
    parent_filename_expression: &str,
    parent_url_expression: &str,
) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = open_paren + 1;
    i = skip_ws_comments(source, i);
    if i >= len || (bytes[i] != b'"' && bytes[i] != b'\'') {
        return rewrite_dynamic_import_expression_call(
            source,
            open_paren,
            dynamic_import_reaction_name,
            dynamic_import_with_trace_name,
            module_path,
            parent_filename_expression,
            parent_url_expression,
        );
    }

    let (spec_literal_start, spec_literal_end, _, _) =
        read_closed_import_specifier_literal(source, i)?;
    i = spec_literal_end;

    i = skip_ws_comments(source, i);

    if i < len && bytes[i] == b')' {
        return Some((
            format!(
                "((__wasm_rquickjs_specifier)=>{}(()=>{}({},{},__wasm_rquickjs_specifier,undefined,false,(__wasm_rquickjs_prepared)=>import(__wasm_rquickjs_prepared))))({})",
                dynamic_import_reaction_name,
                dynamic_import_with_trace_name,
                parent_filename_expression,
                parent_url_expression,
                &source[spec_literal_start..spec_literal_end]
            ),
            i + 1,
        ));
    }
    if i >= len || bytes[i] != b',' {
        return None;
    }
    i += 1;
    let options_start = i;
    let mut paren_depth = 1usize;
    let mut brace_depth = 0usize;
    while i < len {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        match bytes[i] {
            b'(' => paren_depth += 1,
            b')' => {
                paren_depth = paren_depth.saturating_sub(1);
                if paren_depth == 0 {
                    let options = process_import_attrs(
                        &source[options_start..i],
                        module_path,
                        Some((
                            dynamic_import_reaction_name.to_string(),
                            dynamic_import_with_trace_name.to_string(),
                        )),
                        parent_filename_expression,
                        parent_url_expression,
                    )
                    .source;
                    return Some((
                        format!(
                            "((__wasm_rquickjs_specifier,__wasm_rquickjs_options)=>{}(()=>{}({},{},__wasm_rquickjs_specifier,__wasm_rquickjs_options,true,(__wasm_rquickjs_prepared)=>import(__wasm_rquickjs_prepared))))({},{})",
                            dynamic_import_reaction_name,
                            dynamic_import_with_trace_name,
                            parent_filename_expression,
                            parent_url_expression,
                            &source[spec_literal_start..spec_literal_end],
                            options
                        ),
                        i + 1,
                    ));
                }
            }
            b'{' => brace_depth += 1,
            b'}' => brace_depth = brace_depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }

    let _ = import_start;
    let _ = brace_depth;
    None
}

fn previous_non_whitespace_pos(source: &str, pos: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = pos;
    while i > 0 {
        i -= 1;
        if !bytes[i].is_ascii_whitespace() {
            return Some(i);
        }
    }
    None
}

fn previous_word(source: &str, pos: usize) -> Option<(&str, usize)> {
    let bytes = source.as_bytes();
    let mut end = pos;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && is_id_char(bytes[start - 1]) {
        start -= 1;
    }
    (start < end).then_some((&source[start..end], start))
}

fn next_non_whitespace_byte(source: &str, pos: usize) -> Option<u8> {
    let bytes = source.as_bytes();
    let mut i = pos;
    while i < bytes.len() {
        if !bytes[i].is_ascii_whitespace() {
            return Some(bytes[i]);
        }
        i += 1;
    }
    None
}

fn matching_paren_end(source: &str, open_paren: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = open_paren + 1;
    let mut depth = 1usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn is_object_method_shorthand_import(source: &str, import_start: usize, open_paren: usize) -> bool {
    if matching_paren_end(source, open_paren)
        .and_then(|close| next_non_whitespace_byte(source, close))
        != Some(b'{')
    {
        return false;
    }
    if previous_word(source, import_start).is_some_and(|(word, _)| word == "static") {
        return true;
    }

    let bytes = source.as_bytes();
    let mut pos = import_start;
    loop {
        let Some(prev) = previous_non_whitespace_pos(source, pos) else {
            return false;
        };
        match bytes[prev] {
            b'{' | b',' | b';' => return true,
            b'*' => {
                pos = prev;
                continue;
            }
            _ => {}
        }

        let Some((word, start)) = previous_word(source, pos) else {
            return false;
        };
        if matches!(word, "async" | "get" | "set" | "static") {
            pos = start;
            continue;
        }
        return false;
    }
}

fn rewrite_dynamic_import_expression_call(
    source: &str,
    open_paren: usize,
    dynamic_import_reaction_name: &str,
    dynamic_import_with_trace_name: &str,
    module_path: &str,
    parent_filename_expression: &str,
    parent_url_expression: &str,
) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = open_paren + 1;
    let expr_start = i;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    while i < len {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        match bytes[i] {
            b'(' => paren_depth += 1,
            b')' if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                let expr = process_import_attrs(
                    source[expr_start..i].trim(),
                    module_path,
                    Some((
                        dynamic_import_reaction_name.to_string(),
                        dynamic_import_with_trace_name.to_string(),
                    )),
                    parent_filename_expression,
                    parent_url_expression,
                )
                .source;
                return Some((
                    format!(
                        "((__wasm_rquickjs_specifier)=>{}(()=>{}({},{},__wasm_rquickjs_specifier,undefined,false,(__wasm_rquickjs_prepared)=>import(__wasm_rquickjs_prepared))))({})",
                        dynamic_import_reaction_name,
                        dynamic_import_with_trace_name,
                        parent_filename_expression,
                        parent_url_expression,
                        expr
                    ),
                    i + 1,
                ));
            }
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            b'{' => brace_depth += 1,
            b'}' => brace_depth = brace_depth.saturating_sub(1),
            b',' if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => break,
            _ => {}
        }
        i += 1;
    }
    if i >= len || bytes[i] != b',' {
        return None;
    }
    let expr = process_import_attrs(
        source[expr_start..i].trim(),
        module_path,
        Some((
            dynamic_import_reaction_name.to_string(),
            dynamic_import_with_trace_name.to_string(),
        )),
        parent_filename_expression,
        parent_url_expression,
    )
    .source;
    i += 1;
    let options_start = i;
    let mut call_paren_depth = 1usize;
    while i < len {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        match bytes[i] {
            b'(' => call_paren_depth += 1,
            b')' => {
                call_paren_depth = call_paren_depth.saturating_sub(1);
                if call_paren_depth == 0 {
                    let options = process_import_attrs(
                        &source[options_start..i],
                        module_path,
                        Some((
                            dynamic_import_reaction_name.to_string(),
                            dynamic_import_with_trace_name.to_string(),
                        )),
                        parent_filename_expression,
                        parent_url_expression,
                    )
                    .source;
                    return Some((
                        format!(
                            "((__wasm_rquickjs_specifier,__wasm_rquickjs_options)=>{}(()=>{}({},{},__wasm_rquickjs_specifier,__wasm_rquickjs_options,true,(__wasm_rquickjs_prepared)=>import(__wasm_rquickjs_prepared))))({},{})",
                            dynamic_import_reaction_name,
                            dynamic_import_with_trace_name,
                            parent_filename_expression,
                            parent_url_expression,
                            expr,
                            options
                        ),
                        i + 1,
                    ));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

#[derive(Default)]
struct ImportAttrInfo {
    type_value: Option<String>,
    unsupported_key: Option<String>,
    type_non_string: bool,
}

fn append_import_type_query(specifier: &str, import_type: &str) -> String {
    if let Some(rewritten) = existing_import_attr_rewrite(specifier, import_type) {
        return rewritten;
    }

    let token = next_import_attr_rewrite_token(import_type);
    if specifier.starts_with("data:") {
        if let Some(comma_pos) = specifier
            .strip_prefix("data:")
            .and_then(DataUrlLoader::content_separator_pos)
        {
            let insert_pos = "data:".len() + comma_pos;
            let rewritten = format!(
                "{};{IMPORT_TYPE_QUERY_PREFIX}{token}{}",
                &specifier[..insert_pos],
                &specifier[insert_pos..]
            );
            register_import_attr_rewrite(&token, &rewritten);
            return rewritten;
        }
        return specifier.to_string();
    }
    let (base, suffix) = split_module_path_suffix(specifier);
    let separator = if suffix.is_empty() { "?" } else { "&" };
    let rewritten = format!("{base}{suffix}{separator}{IMPORT_TYPE_QUERY_PREFIX}{token}");
    register_import_attr_rewrite(&token, &rewritten);
    rewritten
}

fn import_attr_type_from_path(path: &str) -> Option<String> {
    import_type_rewrite_token(path).and_then(|token| consume_import_type_rewrite_token(token, path))
}

fn strip_import_type_rewrite_token(path: &str) -> String {
    let Some(token) = import_type_rewrite_token(path) else {
        return path.to_string();
    };
    let marker = format!("{IMPORT_TYPE_QUERY_PREFIX}{token}");

    if let Some(rest) = path.strip_prefix("data:")
        && let Some(comma_pos) = DataUrlLoader::content_separator_pos(rest)
    {
        let metadata_end = "data:".len() + comma_pos;
        let metadata = &path[..metadata_end];
        if let Some(marker_start) = metadata.find(&marker) {
            let remove_start = marker_start
                .checked_sub(1)
                .filter(|idx| path.as_bytes().get(*idx) == Some(&b';'))
                .unwrap_or(marker_start);
            return format!(
                "{}{}",
                &path[..remove_start],
                &path[marker_start + marker.len()..]
            );
        }
    }

    let (base, suffix) = split_module_path_suffix(path);
    if suffix.is_empty() {
        return path.to_string();
    }
    let Some(marker_start) = suffix.find(&marker) else {
        return path.to_string();
    };
    let remove_start = marker_start
        .checked_sub(1)
        .filter(|idx| matches!(suffix.as_bytes().get(*idx), Some(b'?') | Some(b'&')))
        .unwrap_or(marker_start);
    let mut stripped_suffix = String::with_capacity(suffix.len().saturating_sub(marker.len()));
    stripped_suffix.push_str(&suffix[..remove_start]);
    stripped_suffix.push_str(&suffix[marker_start + marker.len()..]);
    if stripped_suffix == "?" || stripped_suffix == "#" {
        base.to_string()
    } else {
        format!("{base}{stripped_suffix}")
    }
}

fn is_id_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn extract_import_attr_info(attrs: &str) -> ImportAttrInfo {
    let bytes = attrs.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut info = ImportAttrInfo::default();

    while i < len {
        // Skip whitespace
        while i < len && (bytes[i].is_ascii_whitespace() || bytes[i] == b',') {
            i += 1;
        }
        if i >= len {
            break;
        }

        // Read key (identifier or quoted string)
        let key_start = i;
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let q = bytes[i];
            i += 1;
            while i < len && bytes[i] != q {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < len {
                i += 1;
            }
        } else {
            while i < len && is_id_char(bytes[i]) {
                i += 1;
            }
        }
        let key = attrs[key_start..i].trim_matches(|c: char| c == '"' || c == '\'');
        if key != "type" && info.unsupported_key.is_none() {
            info.unsupported_key = Some(key.to_string());
        }

        // Skip whitespace and colon
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < len && bytes[i] == b':' {
            i += 1;
        }
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }

        // Read value (string)
        if i < len && (bytes[i] == b'"' || bytes[i] == b'\'') {
            let q = bytes[i];
            i += 1;
            let val_start = i;
            while i < len && bytes[i] != q {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            let val = &attrs[val_start..i];
            if i < len {
                i += 1;
            }

            if key == "type" {
                info.type_value = Some(val.to_string());
            }
        } else {
            if key == "type" {
                info.type_non_string = true;
            }
            // Skip non-string values
            while i < len && bytes[i] != b',' && bytes[i] != b'}' {
                i += 1;
            }
        }
    }
    info
}

/// Determine module format from a data URL specifier.
fn determine_data_url_format(specifier: &str) -> Option<&'static str> {
    if let Some(rest) = specifier.strip_prefix("data:") {
        if let Some(comma_pos) = DataUrlLoader::content_separator_pos(rest) {
            let metadata = &rest[..comma_pos];
            let base_mime = metadata.split(';').next().unwrap_or(metadata).trim();
            return match base_mime {
                "application/json" => Some("json"),
                "text/javascript" | "application/javascript" => Some("module"),
                "text/css" => Some("css"),
                _ => None,
            };
        }
    } else if specifier.starts_with("node:") {
        return Some("module");
    } else if module_filesystem_path(specifier).ends_with(".json") {
        return Some("json");
    } else if module_filesystem_path(specifier).ends_with(".js")
        || module_filesystem_path(specifier).ends_with(".mjs")
        || module_filesystem_path(specifier).ends_with(".cjs")
        || cfg!(feature = "typescript-runtime")
            && matches!(
                std::path::Path::new(module_filesystem_path(specifier))
                    .extension()
                    .and_then(|extension| extension.to_str()),
                Some("ts" | "mts" | "cts")
            )
    {
        return Some("module");
    }
    None
}

/// Validate static import attributes. Returns Some(error_module_source) if invalid, None if valid.
fn validate_static_import_attrs(
    type_value: Option<&str>,
    unsupported_key: Option<&str>,
    format: Option<&str>,
    specifier: &str,
    _module_path: &str,
) -> Option<String> {
    let (code, message) =
        validate_import_attrs_error(type_value, unsupported_key, format, specifier)?;
    Some(import_attr_error_module_source(&code, &message))
}

fn validate_import_attrs_error(
    type_value: Option<&str>,
    unsupported_key: Option<&str>,
    format: Option<&str>,
    specifier: &str,
) -> Option<(String, String)> {
    if let Some(tv) = type_value {
        match tv {
            "json" => {
                if format == Some("module") {
                    return Some((
                        "ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE".to_string(),
                        "Cannot use import attributes to change the type of a JavaScript module"
                            .to_string(),
                    ));
                }
            }
            "css" => {
                if format != Some("css") {
                    return Some((
                        "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED".to_string(),
                        "Import attribute type \"css\" is not supported".to_string(),
                    ));
                }
            }
            other => {
                return Some((
                    "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED".to_string(),
                    format!("Import attribute type \"{other}\" is not supported"),
                ));
            }
        }
    }

    // Check for missing required attributes (JSON without type: "json")
    if format == Some("json") && type_value != Some("json") {
        return Some((
            "ERR_IMPORT_ATTRIBUTE_MISSING".to_string(),
            format!("Module \"{specifier}\" needs an import attribute of type: json"),
        ));
    }

    if let Some(key) = unsupported_key {
        return Some((
            "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED".to_string(),
            format!("Import attribute \"{key}\" is not supported"),
        ));
    }

    None
}

fn import_attr_error_module_source(code: &str, message: &str) -> String {
    format!("await {};\n", import_attr_error_expression(code, message))
}

fn syntax_error_module_source(message: &str) -> String {
    let escaped = DataUrlLoader::js_string_escape(message);
    format!("await Promise.reject(new SyntaxError('{escaped}'));\n")
}

fn import_attr_error_expression(code: &str, message: &str) -> String {
    let escaped_message = DataUrlLoader::js_string_escape(message);
    let escaped_code = DataUrlLoader::js_string_escape(code);
    format!(
        "Promise.reject(Object.assign(new TypeError('{escaped_message}'), {{code: '{escaped_code}'}}))"
    )
}

fn throw_import_attr_type_incompatible<'js, T>(ctx: &Ctx<'js>) -> rquickjs::Result<T> {
    let globals = ctx.globals();
    let type_error_ctor: Function = globals.get("TypeError")?;
    let error_obj: Object = type_error_ctor
        .call(("Cannot use import attributes to change the type of a JavaScript module",))?;
    error_obj.set("code", "ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE")?;
    Err(ctx.throw(error_obj.into_value()))
}

fn esm_preflight_error_module_source(
    source: &str,
    package_type_module_js: bool,
    raw_cjs_global_messages: bool,
) -> Option<String> {
    if package_type_module_js {
        let name = find_bare_cjs_global_in_esm(source)?;
        let message = format!(
            "{name} is not defined in ES module scope. This file is being treated as an ES module because it has a .js file extension and package.json contains \"type\": \"module\". To treat it as a CommonJS script, rename it to use the '.cjs' file extension."
        );
        let escaped = DataUrlLoader::js_string_escape(&message);
        return Some(format!(
            "await Promise.reject(new ReferenceError('{escaped}'));\n"
        ));
    }

    let name = find_bare_cjs_global_in_esm(source)?;
    let message = if raw_cjs_global_messages {
        match name {
            "require" => "require is not defined",
            "exports" => "exports is not defined",
            "module" => "module is not defined",
            "__filename" => "__filename is not defined",
            "__dirname" => "__dirname is not defined",
            _ => return None,
        }
    } else {
        match name {
            "require" => "require is not defined in ES module scope, you can use import instead",
            "exports" => "exports is not defined in ES module scope",
            "module" => "module is not defined in ES module scope",
            "__filename" => "__filename is not defined in ES module scope",
            "__dirname" => "__dirname is not defined in ES module scope",
            _ => return None,
        }
    };
    let escaped = DataUrlLoader::js_string_escape(message);
    Some(format!(
        "await Promise.reject(new ReferenceError('{escaped}'));\n"
    ))
}

fn esm_require_global_preflight_error_module_source(
    source: &str,
    raw_cjs_global_messages: bool,
) -> Option<String> {
    find_bare_cjs_global_in_esm_among(source, &["require"])?;
    let message = if raw_cjs_global_messages {
        "require is not defined"
    } else {
        "require is not defined in ES module scope, you can use import instead"
    };
    let escaped = DataUrlLoader::js_string_escape(message);
    Some(format!(
        "await Promise.reject(new ReferenceError('{escaped}'));\n"
    ))
}

#[derive(Debug, PartialEq, Eq)]
struct StaticNamedImport {
    imported: String,
    local: String,
}

fn cjs_named_import_error_module_source(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
) -> Option<String> {
    let esm_conditions = NodeModulesResolver::conditions_from_global(
        ctx,
        NodePackageResolveMode::EsmImport.condition_mode(),
    );
    let cjs_conditions = NodeModulesResolver::conditions_from_global(
        ctx,
        NodePackageResolveMode::CjsAnalysis.condition_mode(),
    );
    find_cjs_named_import_error(ctx, filename, source, &esm_conditions, &cjs_conditions).map(
        |message| {
            let escaped = DataUrlLoader::js_string_escape(&message);
            format!("await Promise.reject(new SyntaxError('{escaped}'));\n")
        },
    )
}

fn find_cjs_named_import_error(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
    esm_conditions: &[String],
    cjs_conditions: &[String],
) -> Option<String> {
    let mut result = None;
    let _ = scan_code_positions(source, true, |i, _| {
        if let Some((specifier, named_imports, next)) = parse_static_named_import(source, i) {
            if let Some(message) = cjs_named_import_error_message(
                ctx,
                filename,
                &specifier,
                &named_imports,
                esm_conditions,
                cjs_conditions,
            ) {
                result = Some(message);
                return ControlFlow::Break(());
            }
            return ControlFlow::Continue(Some(next));
        }
        ControlFlow::Continue(None)
    });
    result
}

fn cjs_named_import_error_message(
    ctx: &Ctx<'_>,
    filename: &str,
    specifier: &str,
    named_imports: &[StaticNamedImport],
    esm_conditions: &[String],
    cjs_conditions: &[String],
) -> Option<String> {
    if named_imports.is_empty() || !could_resolve_to_cjs_for_named_import_error(specifier) {
        return None;
    }
    let resolved =
        resolve_esm_named_import_candidate_path(ctx, filename, specifier, esm_conditions)
            .or_else(|| resolve_cjs_reexport_path(ctx, filename, specifier, cjs_conditions))?;
    if !resolved.ends_with(".cjs") && !is_cjs_js_file_for_named_import_error(ctx, &resolved) {
        return None;
    }
    let source_path = canonical_cjs_analysis_path(ctx, &resolved);
    let source = std::fs::read_to_string(&source_path).ok()?;
    let analysis =
        analyze_cjs_exports_for_file(ctx, &resolved, &source, &mut HashSet::new(), cjs_conditions);
    if !analysis.is_cjs && analysis.exports.is_empty() && analysis.reexports.is_empty() {
        return None;
    }

    for named_import in named_imports {
        if named_import.imported == "default" {
            continue;
        }
        if !analysis
            .exports
            .iter()
            .any(|name| name == &named_import.imported)
        {
            let mut message = format!(
                "Named export '{}' not found. The requested module '{}' is a CommonJS module, which may not support all module.exports as named exports.\nCommonJS modules can always be imported via the default export, for example using:\n\nimport pkg from '{}';\n",
                named_import.imported, specifier, specifier
            );
            if named_imports.len() == 1 {
                message.push_str(&format!(
                    "const {{ {} }} = pkg;\n",
                    format_cjs_named_import_binding(named_import)
                ));
            }
            return Some(message);
        }
    }
    None
}

fn resolve_esm_named_import_candidate_path(
    ctx: &Ctx<'_>,
    filename: &str,
    specifier: &str,
    conditions: &[String],
) -> Option<String> {
    if is_relative_or_absolute_specifier(specifier) {
        return None;
    }
    let resolver = NodeModulesResolver;
    let mut warnings = Vec::new();
    let mut resolution = esm_import_resolution_context(ctx, conditions, &mut warnings);
    resolver
        .try_resolve_with_context(filename, specifier, &mut resolution)
        .ok()
        .flatten()
}

fn could_resolve_to_cjs_for_named_import_error(specifier: &str) -> bool {
    if specifier.starts_with("node:") || specifier.starts_with("data:") || specifier.contains("://")
    {
        return false;
    }
    if is_relative_or_absolute_specifier(specifier) {
        let (path, _) = split_module_path_suffix(specifier);
        return match std::path::Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
        {
            Some("cjs" | "js") | None => true,
            Some(_) => false,
        };
    }
    true
}

fn is_relative_or_absolute_specifier(specifier: &str) -> bool {
    specifier == "."
        || specifier == ".."
        || specifier.starts_with("./")
        || specifier.starts_with("../")
        || specifier.starts_with('/')
}

fn format_cjs_named_import_binding(named_import: &StaticNamedImport) -> String {
    let imported = if is_valid_js_identifier_name(&named_import.imported) {
        named_import.imported.clone()
    } else {
        format!("\"{}\"", escape_js_string(&named_import.imported))
    };
    if named_import.imported == named_import.local {
        imported
    } else {
        format!("{}: {}", imported, named_import.local)
    }
}

fn is_valid_js_identifier_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    let Some((&first, rest)) = bytes.split_first() else {
        return false;
    };
    is_ident_start(first) && rest.iter().copied().all(is_ident_continue)
}

fn is_cjs_js_file_for_named_import_error(ctx: &Ctx<'_>, filename: &str) -> bool {
    filename.ends_with(".js") && package_scope_type(ctx, filename).as_deref() != Some("module")
}

const CJS_GLOBAL_NAMES: [&str; 5] = ["require", "exports", "module", "__filename", "__dirname"];

fn skip_esm_cjs_global_scanner_span(source: &str, pos: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    if let Some(next) = parse_object_method_span(source, pos) {
        return Some(next);
    }
    match bytes[pos] {
        b'\'' | b'"' | b'`' => Some(skip_string_or_template(source, pos)),
        b'/' if pos + 1 < bytes.len() && bytes[pos + 1] == b'/' => {
            let mut i = pos + 2;
            while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                i += 1;
            }
            Some(i)
        }
        b'/' if pos + 1 < bytes.len() && bytes[pos + 1] == b'*' => {
            let mut i = pos + 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            Some((i + 2).min(bytes.len()))
        }
        b'/' if is_regex_literal_start(source, pos) => Some(skip_regex_literal(source, pos)),
        _ => None,
    }
}

fn add_declared_cjs_global_bindings(
    bindings: Vec<String>,
    names: &[&str],
    declared: &mut Vec<String>,
) {
    for name in bindings {
        if names.contains(&name.as_str()) && !declared.iter().any(|existing| existing == &name) {
            declared.push(name);
        }
    }
}

fn collect_declared_cjs_globals_in_esm(source: &str) -> Vec<String> {
    let bytes = source.as_bytes();
    let mut i = 0usize;
    let mut declared = Vec::<String>::new();
    while i < bytes.len() {
        if let Some(next) = skip_esm_cjs_global_scanner_span(source, i) {
            i = next;
            continue;
        }

        if let Some((bindings, next)) = parse_import_declaration_bindings(source, i) {
            add_declared_cjs_global_bindings(bindings, &CJS_GLOBAL_NAMES, &mut declared);
            i = next;
            continue;
        }

        if let Some(next) = parse_arrow_function_span(source, i) {
            i = next;
            continue;
        }

        if let Some((bindings, next)) = parse_declaration_span(source, i) {
            add_declared_cjs_global_bindings(bindings, &CJS_GLOBAL_NAMES, &mut declared);
            i = next;
            continue;
        }

        i = next_char_boundary(source, i);
    }
    declared
}

fn find_bare_cjs_global_in_esm(source: &str) -> Option<&'static str> {
    find_bare_cjs_global_in_esm_among(source, &CJS_GLOBAL_NAMES)
}

struct CjsGlobalScannerScope {
    bindings: Vec<String>,
    end: Option<usize>,
}

fn find_bare_cjs_global_in_esm_among(
    source: &str,
    names: &'static [&'static str],
) -> Option<&'static str> {
    let bytes = source.as_bytes();
    let mut i = 0usize;
    let mut scopes = vec![CjsGlobalScannerScope {
        bindings: Vec::new(),
        end: None,
    }];
    let mut pending_block_scope_bindings = None;
    while i < bytes.len() {
        while scopes.len() > 1
            && scopes
                .last()
                .and_then(|scope| scope.end)
                .is_some_and(|end| i >= end)
        {
            scopes.pop();
        }

        if let Some(next) = skip_esm_cjs_global_scanner_span(source, i) {
            i = next;
            continue;
        }

        if bytes[i] == b'}' {
            if scopes.len() > 1 && scopes.last().is_some_and(|scope| scope.end.is_none()) {
                scopes.pop();
            }
            i = next_char_boundary(source, i);
            continue;
        }

        if let Some((bindings, body_start, body_end)) = parse_for_lexical_header_bindings(source, i)
        {
            let mut body_scope = Vec::new();
            add_declared_cjs_global_bindings(bindings, names, &mut body_scope);
            if bytes.get(body_start) == Some(&b'{') {
                pending_block_scope_bindings = Some(body_scope);
            } else {
                scopes.push(CjsGlobalScannerScope {
                    bindings: body_scope,
                    end: Some(body_end),
                });
            }
            i = body_start;
            continue;
        }

        if let Some((bindings, body_start)) = parse_catch_parameter_bindings(source, i) {
            let mut block_scope = Vec::new();
            add_declared_cjs_global_bindings(bindings, names, &mut block_scope);
            pending_block_scope_bindings = Some(block_scope);
            i = body_start;
            continue;
        }

        if let Some((bindings, next)) = parse_import_declaration_bindings(source, i) {
            if let Some(scope) = scopes.last_mut() {
                add_declared_cjs_global_bindings(bindings, names, &mut scope.bindings);
            }
            i = next;
            continue;
        }

        if let Some(next) = parse_arrow_function_span(source, i) {
            i = next;
            continue;
        }

        if let Some((bindings, _)) = parse_lexical_variable_declaration_span(source, i) {
            if let Some(scope) = scopes.last_mut() {
                add_declared_cjs_global_bindings(bindings, names, &mut scope.bindings);
            }
            i = next_char_boundary(source, i);
            continue;
        }

        if let Some((bindings, _)) = parse_var_variable_declaration_span(source, i) {
            if let Some(scope) = scopes.first_mut() {
                add_declared_cjs_global_bindings(bindings, names, &mut scope.bindings);
            }
            i = next_char_boundary(source, i);
            continue;
        }

        if let Some((bindings, next)) = parse_function_declaration_span(source, i)
            .or_else(|| parse_class_declaration_span(source, i))
        {
            if let Some(scope) = scopes.last_mut() {
                add_declared_cjs_global_bindings(bindings, names, &mut scope.bindings);
            }
            i = next;
            continue;
        }

        for name in names {
            if let Some(name_end) = parse_free_ident_name(source, i, name)
                && previous_significant_byte(source, i) != Some(b'.')
                && !is_typeof_operand(source, i)
                && !scopes
                    .iter()
                    .rev()
                    .any(|scope| scope.bindings.iter().any(|declared| declared == name))
            {
                let next = skip_ws_comments(source, name_end);
                if next < bytes.len() && bytes[next] == b':' {
                    break;
                }
                return Some(name);
            }
        }
        if bytes[i] == b'{' {
            scopes.push(CjsGlobalScannerScope {
                bindings: pending_block_scope_bindings.take().unwrap_or_default(),
                end: None,
            });
        } else if pending_block_scope_bindings.is_some() && !bytes[i].is_ascii_whitespace() {
            pending_block_scope_bindings = None;
        }
        i = next_char_boundary(source, i);
    }
    None
}

fn is_typeof_operand(source: &str, pos: usize) -> bool {
    let bytes = source.as_bytes();
    let mut end = pos;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    if end > 0 && bytes[end - 1] == b'(' {
        end -= 1;
        while end > 0 && bytes[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
    }
    let mut start = end;
    while start > 0 && is_ident_continue(bytes[start - 1]) {
        start -= 1;
    }
    start < end && &source[start..end] == "typeof" && is_ident_start_boundary(bytes, start)
}

fn find_statement_end(source: &str, pos: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = pos;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
            b';' | b'\n' | b'\r' => return i + 1,
            _ => i = next_char_boundary(source, i),
        }
    }
    i
}

fn parse_import_declaration_bindings(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "import")?);
    if i < bytes.len() && (bytes[i] == b'(' || bytes[i] == b'\'' || bytes[i] == b'"') {
        return Some((Vec::new(), find_statement_end(source, i)));
    }

    let mut bindings = Vec::new();
    if i < bytes.len() && bytes[i] == b'*' {
        i = skip_ws_comments(source, i + 1);
        if let Some(as_end) = parse_ident_name(source, i, "as") {
            i = skip_ws_comments(source, as_end);
            let (name, _) = read_ident(source, i)?;
            bindings.push(name);
        }
        return Some((bindings, find_statement_end(source, i)));
    }

    if i < bytes.len() && bytes[i] == b'{' {
        collect_named_import_bindings(source, i, &mut bindings)?;
        return Some((bindings, find_statement_end(source, i)));
    }

    if let Some((name, next)) = read_ident(source, i) {
        bindings.push(name);
        i = skip_ws_comments(source, next);
        if i < bytes.len() && bytes[i] == b',' {
            i = skip_ws_comments(source, i + 1);
            if i < bytes.len() && bytes[i] == b'*' {
                i = skip_ws_comments(source, i + 1);
                if let Some(as_end) = parse_ident_name(source, i, "as") {
                    i = skip_ws_comments(source, as_end);
                    let (name, _) = read_ident(source, i)?;
                    bindings.push(name);
                }
            } else if i < bytes.len() && bytes[i] == b'{' {
                collect_named_import_bindings(source, i, &mut bindings)?;
            }
        }
        return Some((bindings, find_statement_end(source, i)));
    }

    Some((bindings, find_statement_end(source, i)))
}

fn parse_static_named_import(
    source: &str,
    pos: usize,
) -> Option<(String, Vec<StaticNamedImport>, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "import")?);
    if i < bytes.len() && matches!(bytes[i], b'(' | b'\'' | b'"') {
        return None;
    }

    let mut named_imports = Vec::new();
    if i < bytes.len() && bytes[i] == b'{' {
        collect_named_import_specifiers(source, i, &mut named_imports)?;
        i = skip_ws_comments(source, find_matching_brace(source, i)? + 1);
    } else {
        if i < bytes.len() && bytes[i] == b'*' {
            return None;
        }
        let (_, next) = read_ident(source, i)?;
        i = skip_ws_comments(source, next);
        if i >= bytes.len() || bytes[i] != b',' {
            return None;
        }
        i = skip_ws_comments(source, i + 1);
        if i >= bytes.len() || bytes[i] != b'{' {
            return None;
        }
        collect_named_import_specifiers(source, i, &mut named_imports)?;
        i = skip_ws_comments(source, find_matching_brace(source, i)? + 1);
    }

    i = skip_ws_comments(source, parse_ident_name(source, i, "from")?);
    let (specifier, next) = read_js_string(source, i)?;
    Some((specifier, named_imports, find_statement_end(source, next)))
}

fn collect_named_import_specifiers(
    source: &str,
    start: usize,
    imports: &mut Vec<StaticNamedImport>,
) -> Option<()> {
    let bytes = source.as_bytes();
    let end = find_matching_brace(source, start)?;
    let mut i = start + 1;
    while i < end {
        i = skip_ws_comments(source, i);
        if i >= end {
            break;
        }
        let (imported, next, needs_alias) = if matches!(bytes[i], b'\'' | b'"') {
            let (name, next) = read_js_string(source, i)?;
            (name, next, true)
        } else {
            let (name, next) = read_ident(source, i)?;
            (name, next, false)
        };
        let mut local = imported.clone();
        i = skip_ws_comments(source, next);
        if let Some(as_end) = parse_ident_name(source, i, "as") {
            i = skip_ws_comments(source, as_end);
            let (alias, next) = read_ident(source, i)?;
            local = alias;
            i = next;
        } else if needs_alias {
            return None;
        }
        imports.push(StaticNamedImport { imported, local });
        while i < end && bytes[i] != b',' {
            i = next_char_boundary(source, i);
        }
        if i < end && bytes[i] == b',' {
            i += 1;
        }
    }
    Some(())
}

fn collect_named_import_bindings(
    source: &str,
    start: usize,
    bindings: &mut Vec<String>,
) -> Option<()> {
    let bytes = source.as_bytes();
    let end = find_matching_brace(source, start)?;
    let mut i = start + 1;
    while i < end {
        i = skip_ws_comments(source, i);
        if i >= end {
            break;
        }
        let (mut name, next) = read_ident(source, i)?;
        i = skip_ws_comments(source, next);
        if let Some(as_end) = parse_ident_name(source, i, "as") {
            i = skip_ws_comments(source, as_end);
            let (alias, next) = read_ident(source, i)?;
            name = alias;
            i = next;
        }
        bindings.push(name);
        while i < end && bytes[i] != b',' {
            i = next_char_boundary(source, i);
        }
        if i < end && bytes[i] == b',' {
            i += 1;
        }
    }
    Some(())
}

fn parse_declaration_span(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    if let Some((bindings, next)) = parse_variable_declaration_span(source, pos) {
        return Some((bindings, next));
    }
    if let Some((bindings, next)) = parse_function_declaration_span(source, pos) {
        return Some((bindings, next));
    }
    if let Some((bindings, next)) = parse_class_declaration_span(source, pos) {
        return Some((bindings, next));
    }
    None
}

fn parse_for_lexical_header_bindings(
    source: &str,
    pos: usize,
) -> Option<(Vec<String>, usize, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "for")?);
    if let Some(await_end) = parse_ident_name(source, i, "await") {
        i = skip_ws_comments(source, await_end);
    }
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let header_end = find_matching_paren(source, i)?;
    let header_start = skip_ws_comments(source, i + 1);
    if header_start >= header_end {
        return None;
    }
    let (bindings, _) = parse_lexical_variable_declaration_span(source, header_start)?;
    let body_start = skip_ws_comments(source, header_end + 1);
    let body_end = if bytes.get(body_start) == Some(&b'{') {
        find_matching_brace(source, body_start)? + 1
    } else {
        find_statement_end(source, body_start)
    };
    Some((bindings, body_start, body_end))
}

fn parse_catch_parameter_bindings(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "catch")?);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let params_end = find_matching_paren(source, i)?;
    let params_start = skip_ws_comments(source, i + 1);
    let bindings =
        collect_cjs_global_binding_names_in_variable_declaration(source, params_start, params_end);
    i = skip_ws_comments(source, params_end + 1);
    if bytes.get(i) != Some(&b'{') {
        return None;
    }
    Some((bindings, i))
}

fn parse_variable_declaration_span(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let start = parse_variable_declaration_binding_start(
        source,
        parse_variable_declaration_keyword(source, pos)?,
    )?;
    let end = find_variable_declaration_end(source, start);
    Some((
        collect_cjs_global_binding_names_in_variable_declaration(source, start, end),
        end,
    ))
}

fn parse_lexical_variable_declaration_span(
    source: &str,
    pos: usize,
) -> Option<(Vec<String>, usize)> {
    let start = parse_variable_declaration_binding_start(
        source,
        parse_lexical_variable_declaration_keyword(source, pos)?,
    )?;
    let end = find_variable_declaration_end(source, start);
    Some((
        collect_cjs_global_binding_names_in_variable_declaration(source, start, end),
        end,
    ))
}

fn parse_var_variable_declaration_span(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let start = parse_variable_declaration_binding_start(
        source,
        parse_free_ident_name(source, pos, "var")?,
    )?;
    let end = find_variable_declaration_end(source, start);
    Some((
        collect_cjs_global_binding_names_in_variable_declaration(source, start, end),
        end,
    ))
}

fn parse_variable_declaration_binding_start(source: &str, keyword_end: usize) -> Option<usize> {
    let start = skip_ws_comments(source, keyword_end);
    let bytes = source.as_bytes();
    if start >= bytes.len() || matches!(bytes[start], b':' | b'(') {
        return None;
    }
    Some(start)
}

fn parse_lexical_variable_declaration_keyword(source: &str, pos: usize) -> Option<usize> {
    parse_free_ident_name(source, pos, "const")
        .or_else(|| parse_free_ident_name(source, pos, "let"))
}

fn parse_variable_declaration_keyword(source: &str, pos: usize) -> Option<usize> {
    parse_free_ident_name(source, pos, "const")
        .or_else(|| parse_free_ident_name(source, pos, "let"))
        .or_else(|| parse_free_ident_name(source, pos, "var"))
}

fn find_variable_declaration_end(source: &str, pos: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = pos;
    let mut paren = 0usize;
    let mut brace = 0usize;
    let mut bracket = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
                continue;
            }
            b'(' => paren += 1,
            b')' => paren = paren.saturating_sub(1),
            b'{' => brace += 1,
            b'}' => {
                if paren == 0 && brace == 0 && bracket == 0 {
                    return i;
                }
                brace = brace.saturating_sub(1);
            }
            b'[' => bracket += 1,
            b']' => bracket = bracket.saturating_sub(1),
            b';' if paren == 0 && brace == 0 && bracket == 0 => return i + 1,
            _ => {}
        }
        i = next_char_boundary(source, i);
    }
    i
}

fn parse_function_declaration_span(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "function")?);
    if i < bytes.len() && bytes[i] == b'*' {
        i = skip_ws_comments(source, i + 1);
    }
    let mut bindings = Vec::new();
    if let Some((name, next)) = read_ident(source, i) {
        bindings.push(name);
        i = skip_ws_comments(source, next);
    }
    if i < bytes.len() && bytes[i] == b'(' {
        let params_end = find_matching_paren(source, i)?;
        i = skip_ws_comments(source, params_end + 1);
        if i < bytes.len() && bytes[i] == b'{' {
            return Some((bindings, find_matching_brace(source, i)? + 1));
        }
    }
    Some((bindings, i))
}

fn parse_arrow_function_span(source: &str, pos: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i;
    if pos < bytes.len() && bytes[pos] == b'(' {
        let params_end = find_matching_paren(source, pos)?;
        i = skip_ws_comments(source, params_end + 1);
    } else {
        let (_, next) = read_ident(source, pos)?;
        i = skip_ws_comments(source, next);
    }
    if i + 1 >= bytes.len() || bytes[i] != b'=' || bytes[i + 1] != b'>' {
        return None;
    }
    i = skip_ws_comments(source, i + 2);
    if i < bytes.len() && bytes[i] == b'{' {
        Some(find_matching_brace(source, i)? + 1)
    } else {
        Some(find_statement_end(source, i))
    }
}

fn parse_object_method_span(source: &str, pos: usize) -> Option<usize> {
    if !matches!(
        previous_significant_byte_before_method(source, pos),
        Some(b'{') | Some(b',')
    ) {
        return None;
    }
    let bytes = source.as_bytes();
    let mut i = pos;
    if let Some(async_end) = parse_ident_name(source, i, "async") {
        let next = skip_ws_comments(source, async_end);
        if next < bytes.len() && bytes[next] != b':' {
            i = next;
        }
    }
    if i < bytes.len() && bytes[i] == b'*' {
        i = skip_ws_comments(source, i + 1);
    }
    if let Some(accessor_end) =
        parse_ident_name(source, i, "get").or_else(|| parse_ident_name(source, i, "set"))
    {
        let next = skip_ws_comments(source, accessor_end);
        if next < bytes.len() && bytes[next] != b':' {
            i = next;
        }
    }
    if i >= bytes.len() {
        return None;
    }
    if matches!(bytes[i], b'\'' | b'"') {
        let (_, next) = read_js_string(source, i)?;
        i = next;
    } else if bytes[i].is_ascii_digit() {
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
    } else {
        let (_, next) = read_ident(source, i)?;
        i = next;
    }
    i = skip_ws_comments(source, i);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let params_end = find_matching_paren(source, i)?;
    i = skip_ws_comments(source, params_end + 1);
    if i < bytes.len() && bytes[i] == b'{' {
        Some(find_matching_brace(source, i)? + 1)
    } else {
        None
    }
}

fn previous_significant_byte_before_method(source: &str, pos: usize) -> Option<u8> {
    let bytes = source.as_bytes();
    let mut end = pos;
    loop {
        while end > 0 && bytes[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
        if end >= 2
            && bytes[end - 2] == b'*'
            && bytes[end - 1] == b'/'
            && let Some(start) = source[..end - 2].rfind("/*")
        {
            end = start;
            continue;
        }
        return if end == 0 { None } else { Some(bytes[end - 1]) };
    }
}

fn parse_class_declaration_span(source: &str, pos: usize) -> Option<(Vec<String>, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_ident_name(source, pos, "class")?);
    let mut bindings = Vec::new();
    if let Some((name, next)) = read_ident(source, i) {
        bindings.push(name);
        i = skip_ws_comments(source, next);
    }
    while i < bytes.len() && bytes[i] != b'{' {
        i = next_char_boundary(source, i);
    }
    if i < bytes.len() && bytes[i] == b'{' {
        return Some((bindings, find_matching_brace(source, i)? + 1));
    }
    Some((bindings, i))
}

fn collect_cjs_global_binding_names_in_variable_declaration(
    source: &str,
    start: usize,
    end: usize,
) -> Vec<String> {
    let bytes = source.as_bytes();
    let mut names = Vec::new();
    let mut i = start;
    let mut in_binding = true;
    let mut paren = 0usize;
    let mut brace = 0usize;
    let mut bracket = 0usize;
    while i < end && i < bytes.len() {
        if in_binding
            && bytes[i] == b'['
            && let Some(close) = find_matching_bracket(source, i)
            && close < end
            && bytes.get(skip_ws_comments(source, close + 1)) == Some(&b':')
        {
            i = close + 1;
            continue;
        }
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < end && i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < end
                    && i + 1 < bytes.len()
                    && !(bytes[i] == b'*' && bytes[i + 1] == b'/')
                {
                    i += 1;
                }
                i = (i + 2).min(end).min(bytes.len());
                continue;
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
                continue;
            }
            b'(' => paren += 1,
            b')' => paren = paren.saturating_sub(1),
            b'{' => brace += 1,
            b'}' => brace = brace.saturating_sub(1),
            b'[' => bracket += 1,
            b']' => bracket = bracket.saturating_sub(1),
            b'=' if paren == 0 && brace == 0 && bracket == 0 => in_binding = false,
            b',' if paren == 0 && brace == 0 && bracket == 0 => in_binding = true,
            _ => {}
        }

        if in_binding {
            for name in CJS_GLOBAL_NAMES {
                if let Some(name_end) = parse_ident_name(source, i, name)
                    && cjs_global_identifier_is_binding_name(source, i, name_end)
                    && !names.iter().any(|existing| existing == name)
                {
                    names.push(name.to_string());
                    break;
                }
            }
        }
        i = next_char_boundary(source, i);
    }
    names
}

fn cjs_global_identifier_is_binding_name(source: &str, pos: usize, name_end: usize) -> bool {
    if object_pattern_property_key_without_binding(source, name_end) {
        return false;
    }
    let bytes = source.as_bytes();
    let next = skip_ws_comments(source, name_end);
    if bytes.get(next) == Some(&b'(') {
        return false;
    }
    if previous_significant_byte(source, pos) == Some(b'=') {
        return false;
    }
    if previous_significant_byte(source, pos) == Some(b'[')
        && bytes.get(next) == Some(&b']')
        && bytes.get(skip_ws_comments(source, next + 1)) == Some(&b':')
    {
        return false;
    }
    true
}

fn find_matching_bracket(source: &str, start: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = start;
    let mut depth = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => i = skip_string_or_template(source, i),
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
            }
            b'[' => {
                depth += 1;
                i += 1;
            }
            b']' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
                i += 1;
            }
            _ => i = next_char_boundary(source, i),
        }
    }
    None
}

fn object_pattern_property_key_without_binding(source: &str, pos: usize) -> bool {
    let i = skip_ws_comments(source, pos);
    i < source.len() && source.as_bytes()[i] == b':'
}

fn data_url_simple_identifier_error_module_source(source: &str) -> Option<String> {
    let ident = source
        .trim()
        .strip_suffix(';')
        .unwrap_or(source.trim())
        .trim();
    if ident.is_empty()
        || ["require", "exports", "module", "__filename", "__dirname"].contains(&ident)
        || !is_ascii_js_identifier(ident)
    {
        return None;
    }
    let escaped = DataUrlLoader::js_string_escape(&format!("{ident} is not defined"));
    Some(format!(
        "await Promise.reject(new ReferenceError('{escaped}'));\n"
    ))
}

fn has_cjs_wrapper_lexical_redeclaration(source: &str) -> bool {
    let mut found = false;
    let mut brace_depth = 0usize;
    let _ = scan_code_positions(source, true, |i, byte| {
        match byte {
            b'{' => {
                brace_depth += 1;
                return ControlFlow::Continue(None);
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                return ControlFlow::Continue(None);
            }
            _ => {}
        }

        if brace_depth == 0 {
            if let Some((bindings, _)) = parse_lexical_variable_declaration_span(source, i) {
                for binding in bindings {
                    if binding == "require" {
                        let keyword_end =
                            parse_lexical_variable_declaration_keyword(source, i).unwrap_or(i);
                        let next = skip_ws_comments(source, keyword_end);
                        if is_create_require_import_meta_url_declaration(source, next) {
                            continue;
                        }
                    }
                    if CJS_GLOBAL_NAMES.contains(&binding.as_str()) {
                        found = true;
                        return ControlFlow::Break(());
                    }
                }
            } else if let Some((bindings, _)) = parse_class_declaration_span(source, i)
                && bindings
                    .iter()
                    .any(|binding| CJS_GLOBAL_NAMES.contains(&binding.as_str()))
            {
                found = true;
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(None)
    });
    found
}

fn is_create_require_import_meta_url_declaration(source: &str, require_pos: usize) -> bool {
    let mut next = skip_ws_comments(source, require_pos + "require".len());
    if source.as_bytes().get(next) != Some(&b'=') {
        return false;
    }
    next = skip_ws_comments(source, next + 1);
    let Some(create_require_end) = parse_ident_name(source, next, "createRequire") else {
        return false;
    };
    next = skip_ws_comments(source, create_require_end);
    if source.as_bytes().get(next) != Some(&b'(') {
        return false;
    }
    next = skip_ws_comments(source, next + 1);
    parse_import_meta_url(source, next).is_some()
}

fn parse_import_meta_url(source: &str, pos: usize) -> Option<usize> {
    let i = parse_import_meta(source, pos)?;
    parse_dot_member_name(source, i, "url")
}

fn parse_import_meta(source: &str, pos: usize) -> Option<usize> {
    let i = parse_ident_name(source, pos, "import")?;
    if source.as_bytes().get(skip_ws_comments(source, i)) == Some(&b'(') {
        return None;
    }
    parse_dot_member_name(source, i, "meta")
}

fn is_ascii_js_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || !(bytes[0] == b'_' || bytes[0] == b'$' || bytes[0].is_ascii_alphabetic())
    {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|byte| *byte == b'_' || *byte == b'$' || byte.is_ascii_alphanumeric())
}

/// Resolver that strips `file://` URL prefixes so that `import('file:///path/to/mod.mjs')`
/// resolves to the filesystem path `/path/to/mod.mjs`.
struct FileUrlResolver;

impl FileUrlResolver {
    /// Decode a `file://` URL into a filesystem path, handling percent-encoding.
    fn file_url_to_path(url: &str) -> Option<String> {
        let (mut path, suffix) = Self::file_url_to_path_parts(url)?;
        path.push_str(suffix);
        Some(path)
    }

    fn file_url_to_path_parts(url: &str) -> Option<(String, &str)> {
        let (encoded_path, suffix) = Self::file_url_path_and_suffix(url)?;
        let bytes = encoded_path.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%'
                && i + 2 < bytes.len()
                && let (Some(hi), Some(lo)) =
                    (Self::hex_val(bytes[i + 1]), Self::hex_val(bytes[i + 2]))
            {
                decoded.push(hi << 4 | lo);
                i += 3;
                continue;
            }
            decoded.push(bytes[i]);
            i += 1;
        }
        Some((String::from_utf8(decoded).ok()?, suffix))
    }

    fn file_url_path_and_suffix(url: &str) -> Option<(&str, &str)> {
        let encoded = url.strip_prefix("file://")?;
        let end = encoded.find(['?', '#']).unwrap_or(encoded.len());
        let encoded_path = &encoded[..end];
        let (host, path) = if encoded_path.starts_with('/') {
            ("", encoded_path)
        } else if let Some(slash) = encoded_path.find('/') {
            (&encoded_path[..slash], &encoded_path[slash..])
        } else {
            (encoded_path, "/")
        };

        if host.is_empty() || host.eq_ignore_ascii_case("localhost") {
            Some((path, &encoded[end..]))
        } else {
            None
        }
    }

    fn has_invalid_file_url_host(url: &str) -> bool {
        url.starts_with("file://") && Self::file_url_path_and_suffix(url).is_none()
    }

    fn with_loader_realm_suffix(base: &str, suffix: &str) -> String {
        append_loader_realm_param(suffix, loader_realm_param(base).as_deref())
    }

    fn is_same_directory_file_import(normalized: &str, base: &str) -> bool {
        let base_path = if let Some(path) = Self::file_url_to_path(base) {
            path
        } else if base.starts_with('/') {
            module_filesystem_path(base).to_string()
        } else {
            return false;
        };
        let Some(base_parent) = std::path::Path::new(&base_path).parent() else {
            return false;
        };
        let Some(target_parent) = std::path::Path::new(normalized).parent() else {
            return false;
        };
        CjsEvalResolver::normalize_path(base_parent)
            == CjsEvalResolver::normalize_path(target_parent)
    }

    fn file_url_resolution_base_path(base_path: &str) -> Option<std::path::PathBuf> {
        let path = std::path::Path::new(base_path);
        if base_path.ends_with('/') {
            Some(path.to_path_buf())
        } else {
            path.parent().map(|parent| parent.to_path_buf())
        }
    }

    fn file_url_package_resolution_base(base_path: String) -> String {
        if base_path.ends_with('/') {
            format!("{base_path}.wasm-rquickjs-import-meta-resolve-base")
        } else {
            base_path
        }
    }

    fn hex_val(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'A'..=b'F' => Some(b - b'A' + 10),
            b'a'..=b'f' => Some(b - b'a' + 10),
            _ => None,
        }
    }
}

impl Resolver for FileUrlResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if let Some(encoded) = name.strip_prefix("file://") {
            let end = encoded.find(['?', '#']).unwrap_or(encoded.len());
            if NodeFileResolver::has_encoded_path_separator(&encoded[..end]) {
                return NodeFileResolver::throw_invalid_encoded_separator(ctx, base, name);
            }
            if Self::has_invalid_file_url_host(name) {
                return NodeFileResolver::throw_invalid_file_url_host(
                    ctx,
                    format!("File URL host must be \"localhost\" or empty: {}", name),
                );
            }
        }

        if let Some((path, suffix)) = Self::file_url_to_path_parts(name) {
            let normalized = CjsEvalResolver::normalize_path(std::path::Path::new(&path));
            let url = NodeFileResolver::module_url_for_file_specifier(name);
            if NodeFileResolver::module_resolution_is_dir(ctx, &normalized) {
                discard_import_type_rewrite_token(name);
                return NodeFileResolver::throw_module_resolution_error(
                    ctx,
                    "ERR_UNSUPPORTED_DIR_IMPORT",
                    NodeFileResolver::directory_import_message(
                        ctx,
                        &normalized,
                        base,
                        !Self::is_same_directory_file_import(&normalized, base),
                    ),
                    url,
                );
            }
            if !NodeFileResolver::module_resolution_is_file(ctx, &normalized) {
                discard_import_type_rewrite_token(name);
                return NodeFileResolver::throw_module_resolution_error(
                    ctx,
                    "ERR_MODULE_NOT_FOUND",
                    format!("Cannot find module '{}'", name),
                    url,
                );
            }
            let preserve_symlinks =
                NodeFileResolver::has_exec_argv_flag(ctx, "--preserve-symlinks");
            let identity = NodeFileResolver::module_identity_path_for_existing_file(
                ctx,
                &normalized,
                preserve_symlinks,
            );
            let resolved = format!(
                "{}{}",
                identity,
                Self::with_loader_realm_suffix(base, suffix)
            );
            transfer_import_type_rewrite_token(name, &resolved);
            Ok(resolved)
        } else {
            Err(Error::new_resolving(base, name))
        }
    }
}

struct RegisteredLoaderResolver;

const STATIC_REGISTERED_FILE_URL_PREFIX: &str = "__wasm_rquickjs_static_file_url__:";

fn static_registered_file_url_id(url: &str) -> String {
    let mut encoded =
        String::with_capacity(STATIC_REGISTERED_FILE_URL_PREFIX.len() + url.len() * 2);
    encoded.push_str(STATIC_REGISTERED_FILE_URL_PREFIX);
    for byte in url.as_bytes() {
        encoded.push_str(&format!("{byte:02X}"));
    }
    encoded
}

fn static_registered_file_url_from_id(id: &str) -> Option<String> {
    let encoded = id.strip_prefix(STATIC_REGISTERED_FILE_URL_PREFIX)?;
    if encoded.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    let mut i = 0;
    while i < encoded.len() {
        let hi = FileUrlResolver::hex_val(encoded.as_bytes()[i])?;
        let lo = FileUrlResolver::hex_val(encoded.as_bytes()[i + 1])?;
        bytes.push(hi << 4 | lo);
        i += 2;
    }
    String::from_utf8(bytes)
        .ok()
        .filter(|url| url.starts_with("file://"))
}

impl Resolver for RegisteredLoaderResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        let globals = ctx.globals();
        let Ok(resolve_fn) =
            globals.get::<_, Function>("__wasm_rquickjs_resolve_static_registered_loader")
        else {
            return Err(Error::new_resolving(base, name));
        };
        let base_url = if let Some(url) = static_registered_file_url_from_id(base) {
            url
        } else if let Some(url) = DataUrlLoader::source_url(base) {
            url
        } else if base.starts_with("data:")
            || base.starts_with("file://")
            || base.starts_with("node:")
        {
            base.to_string()
        } else {
            path_to_file_url(base)
        };
        let resolved: Option<String> = resolve_fn.call((base_url, name.to_string()))?;
        match resolved {
            Some(resolved) if resolved.starts_with("file://") => {
                Ok(static_registered_file_url_id(&resolved))
            }
            Some(resolved) if !resolved.is_empty() => Ok(resolved),
            _ => Err(Error::new_resolving(base, name)),
        }
    }
}

struct StaticRegisteredFileUrlLoader;

impl Loader for StaticRegisteredFileUrlLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let Some(url) = static_registered_file_url_from_id(path) else {
            return Err(Error::new_loading(path));
        };
        let Some((file_path, _suffix)) = FileUrlResolver::file_url_to_path_parts(&url) else {
            return Err(Error::new_loading(path));
        };
        let fs_path = CjsEvalResolver::normalize_path(std::path::Path::new(&file_path));
        let source_path = crate::builtin::realpath_for_module_resolution(ctx, &fs_path)
            .unwrap_or_else(|| fs_path.clone());
        declare_esm_file_module(
            ctx,
            path,
            &fs_path,
            &source_path,
            url,
            EsmFilePreflightMode::RequireOnly,
        )
    }
}

/// Resolver that handles bare specifier imports by walking up the directory tree
/// looking for `node_modules/<name>/` directories, reading their `package.json`
/// to find the entry point.
/// Resolver that guards against dynamic import from contexts without a module referrer.
///
/// QuickJS currently reports `<input>` for both direct and indirect eval, so we
/// conservatively enforce Node's missing-callback error for `node:` specifiers.
/// This is enough for Node's `Promise.resolve(...).then(eval)` realm test case
/// while preserving successful direct-eval imports in CommonJS modules.
struct RealmGuardResolver;

impl Resolver for RealmGuardResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if base != "<input>" {
            return Err(Error::new_resolving(base, name));
        }

        if !name.starts_with("node:") {
            return Err(Error::new_resolving(base, name));
        }

        let globals = ctx.globals();
        let current_module: Value = globals
            .get("__wasm_rquickjs_current_module")
            .unwrap_or_else(|_| Value::new_undefined(ctx.clone()));

        if !current_module.is_undefined() && !current_module.is_null() {
            return Err(Error::new_resolving(base, name));
        }

        let eval_script: Value = globals
            .get("__wasm_rquickjs_current_eval_script_name")
            .unwrap_or_else(|_| Value::new_undefined(ctx.clone()));
        if !eval_script.is_undefined() && !eval_script.is_null() {
            return Err(Error::new_resolving(base, name));
        }

        let type_error_ctor: Function = globals.get("TypeError")?;
        let error_obj: Object =
            type_error_ctor.call(("A dynamic import callback was not specified.",))?;
        error_obj.set("code", "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING")?;
        Err(ctx.throw(error_obj.into_value()))
    }
}

/// Resolver that intercepts module resolution for mocked modules.
/// Checks `globalThis.__wasm_rquickjs_module_mocks` registry via JS helpers.
struct MockModuleResolver;

impl Resolver for MockModuleResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        let globals = ctx.globals();

        let canonical_key_fn: Function = globals
            .get::<_, Function>("__wasm_rquickjs_mock_canonical_key")
            .map_err(|_| Error::new_resolving(base, name))?;

        let key: Value = canonical_key_fn
            .call((name, base))
            .map_err(|_| Error::new_resolving(base, name))?;

        if key.is_null() || key.is_undefined() {
            return Err(Error::new_resolving(base, name));
        }

        let key_str: String = key
            .get::<String>()
            .map_err(|_| Error::new_resolving(base, name))?;

        let registry: Object = globals
            .get::<_, Object>("__wasm_rquickjs_module_mocks")
            .map_err(|_| Error::new_resolving(base, name))?;

        let entry: Value = registry
            .get::<_, Value>(&key_str as &str)
            .map_err(|_| Error::new_resolving(base, name))?;

        if entry.is_undefined() || entry.is_null() {
            return Err(Error::new_resolving(base, name));
        }

        let entry_obj: Object = entry
            .into_object()
            .ok_or_else(|| Error::new_resolving(base, name))?;

        let mock_id: i64 = entry_obj
            .get::<_, i64>("id")
            .map_err(|_| Error::new_resolving(base, name))?;

        let cache: bool = entry_obj.get::<_, bool>("cache").unwrap_or(false);

        if cache {
            Ok(format!("__wasm_rquickjs_mock__:{}", mock_id))
        } else {
            let seq_key = "__wasm_rquickjs_mock_seq";
            let seq: i64 = globals.get::<_, i64>(seq_key).unwrap_or(0);
            let next_seq = seq + 1;
            let _ = globals.set(seq_key, next_seq);
            Ok(format!("__wasm_rquickjs_mock__:{}:{}", mock_id, next_seq))
        }
    }
}

/// Loader that handles synthetic mock module IDs produced by MockModuleResolver.
/// Generates ESM source from the JS-side mock registry.
struct MockModuleLoader;

impl Loader for MockModuleLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        if !path.starts_with("__wasm_rquickjs_mock__:") {
            return Err(Error::new_loading(path));
        }

        let rest = &path["__wasm_rquickjs_mock__:".len()..];
        let mock_id_str = rest.split(':').next().unwrap_or(rest);
        let mock_id: i64 = mock_id_str.parse().map_err(|_| Error::new_loading(path))?;

        let globals = ctx.globals();
        let gen_fn: Function = globals
            .get::<_, Function>("__wasm_rquickjs_get_mock_module_source")
            .map_err(|_| Error::new_loading(path))?;

        let source: String = gen_fn
            .call::<_, String>((mock_id,))
            .map_err(|_| Error::new_loading(path))?;

        Module::declare(ctx.clone(), path, source.as_bytes().to_vec())
    }
}

/// Resolver that handles relative path imports from eval'd CJS code.
/// When base is `<input>` (from eval) and there's a CJS module context,
/// resolves relative paths against the module's directory.
struct CjsEvalResolver;

impl CjsEvalResolver {
    fn normalize_path(path: &std::path::Path) -> String {
        use std::path::Component;
        let mut parts: Vec<String> = Vec::new();
        let is_absolute = path.has_root();

        for component in path.components() {
            match component {
                Component::RootDir | Component::Prefix(_) => {}
                Component::CurDir => {}
                Component::ParentDir => {
                    parts.pop();
                }
                Component::Normal(part) => {
                    parts.push(part.to_string_lossy().into_owned());
                }
            }
        }

        if is_absolute {
            format!("/{}", parts.join("/"))
        } else {
            parts.join("/")
        }
    }
}

impl Resolver for CjsEvalResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if base != "<input>" {
            return Err(Error::new_resolving(base, name));
        }

        if !name.starts_with("./") && !name.starts_with("../") {
            return Err(Error::new_resolving(base, name));
        }

        let globals = ctx.globals();
        let import_dir: Value = globals
            .get("__wasm_rquickjs_cjs_import_dir")
            .unwrap_or_else(|_| Value::new_undefined(ctx.clone()));

        if import_dir.is_undefined() || import_dir.is_null() {
            return Err(Error::new_resolving(base, name));
        }

        let dir_str: String = import_dir
            .get::<String>()
            .map_err(|_| Error::new_resolving(base, name))?;

        let module_dir = std::path::Path::new(&dir_str);
        NodeFileResolver::resolve_candidate_with_extensions(
            ctx,
            module_dir.join(name),
            "",
            true,
            &["js", "mjs"],
            FileCandidateSemantics::DirectFilesystem,
        )
        .ok_or_else(|| Error::new_resolving(base, name))
    }
}

/// Resolver for filesystem-backed ES modules.
///
/// QuickJS gives dynamic imports from CommonJS `eval()` a synthetic `<input>`
/// base (handled by `CjsEvalResolver` above), but normal ESM resolution still
/// needs Node-style filesystem handling for absolute paths and paths relative
/// to the referrer module. `rquickjs::FileResolver` is kept as a fallback, but
/// it does not reliably accept already-absolute guest paths in this WASI setup.
#[derive(Clone, Copy)]
enum FileCandidateSemantics {
    ModuleResolution,
    DirectFilesystem,
}

struct NodeFileResolver;

impl NodeFileResolver {
    fn decode_module_path<'js, 'path>(
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        path: &'path str,
    ) -> rquickjs::Result<Cow<'path, str>> {
        if path.as_bytes().contains(&b'%') {
            if Self::has_encoded_path_separator(path) {
                return Self::throw_invalid_encoded_separator(ctx, base, name);
            }
            percent_decode(path)
                .map(Cow::Owned)
                .ok_or_else(|| Error::new_resolving(base, name))
        } else {
            Ok(Cow::Borrowed(path))
        }
    }

    fn has_encoded_path_separator(path: &str) -> bool {
        let bytes = path.as_bytes();
        let mut i = 0;
        while i + 2 < bytes.len() {
            if bytes[i] == b'%' && bytes[i + 1] == b'2' && matches!(bytes[i + 2], b'f' | b'F') {
                return true;
            }
            if bytes[i] == b'%' && bytes[i + 1] == b'5' && matches!(bytes[i + 2], b'c' | b'C') {
                return true;
            }
            i += 1;
        }
        false
    }

    fn throw_invalid_encoded_separator<'js, T>(
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
    ) -> rquickjs::Result<T> {
        let msg = format!(
            "Invalid module \"{}\" must not include encoded \"/\" or \"\\\" characters imported from {}",
            name, base
        );
        let type_error_ctor: Function = ctx.globals().get("TypeError")?;
        let error_obj: Object = type_error_ctor.call((&msg,))?;
        error_obj.set("code", "ERR_INVALID_MODULE_SPECIFIER")?;
        Err(ctx.throw(error_obj.into_value()))
    }

    fn throw_invalid_file_url_host<'js, T>(ctx: &Ctx<'js>, message: String) -> rquickjs::Result<T> {
        let _ = Exception::throw_type(ctx, &message);
        let error_value = ctx.catch();
        let Some(error_obj) = error_value.clone().into_object() else {
            return Err(ctx.throw(error_value));
        };
        Self::define_error_property(&error_obj, "code", "ERR_INVALID_FILE_URL_HOST")?;
        Err(ctx.throw(error_obj.into_value()))
    }

    fn has_exec_argv_flag(ctx: &Ctx<'_>, flag: &str) -> bool {
        let Ok(process) = ctx.globals().get::<_, Object>("process") else {
            return false;
        };
        let Ok(exec_argv) = process.get::<_, rquickjs::Array>("execArgv") else {
            return false;
        };
        let prefixed = format!("{flag}=");
        for i in 0..exec_argv.len() {
            let Ok(arg) = exec_argv.get::<String>(i) else {
                continue;
            };
            if arg == flag || arg.starts_with(&prefixed) {
                return true;
            }
        }
        false
    }

    fn module_identity_path_for_existing_file(
        ctx: &Ctx<'_>,
        normalized: &str,
        preserve_symlinks: bool,
    ) -> String {
        if preserve_symlinks {
            return normalized.to_string();
        }
        crate::builtin::realpath_for_module_resolution(ctx, normalized)
            .unwrap_or_else(|| normalized.to_string())
    }

    fn module_resolution_is_file(ctx: &Ctx<'_>, normalized: &str) -> bool {
        let services = ctx
            .userdata::<crate::internal::runtime_services::RuntimeServices>()
            .expect("runtime services not initialized");
        module_resolution_path_matches(
            &services.cjs_module_probe_session,
            #[cfg(feature = "typescript-compiler-profiling")]
            services.execution_profile().as_deref(),
            normalized,
            ModulePathProbeKind::File,
        )
    }

    fn module_resolution_is_dir(ctx: &Ctx<'_>, normalized: &str) -> bool {
        let services = ctx
            .userdata::<crate::internal::runtime_services::RuntimeServices>()
            .expect("runtime services not initialized");
        module_resolution_path_matches(
            &services.cjs_module_probe_session,
            #[cfg(feature = "typescript-compiler-profiling")]
            services.execution_profile().as_deref(),
            normalized,
            ModulePathProbeKind::Directory,
        )
    }

    fn resolve_candidate(
        ctx: &Ctx<'_>,
        candidate: std::path::PathBuf,
        suffix: &str,
        preserve_symlinks: bool,
    ) -> Option<String> {
        Self::resolve_candidate_with_extensions(
            ctx,
            candidate,
            suffix,
            preserve_symlinks,
            &["js", "mjs", "json"],
            FileCandidateSemantics::ModuleResolution,
        )
    }

    fn resolve_candidate_with_extensions(
        ctx: &Ctx<'_>,
        candidate: std::path::PathBuf,
        suffix: &str,
        preserve_symlinks: bool,
        extensions: &[&str],
        semantics: FileCandidateSemantics,
    ) -> Option<String> {
        let normalized = CjsEvalResolver::normalize_path(&candidate);
        if Self::candidate_is_file(ctx, &normalized, semantics) {
            let identity = Self::candidate_identity(ctx, &normalized, preserve_symlinks, semantics);
            return Some(format!("{identity}{suffix}"));
        }

        if std::path::Path::new(&normalized).extension().is_none() {
            for ext in extensions {
                let with_ext = format!("{}.{}", normalized, ext);
                if Self::candidate_is_file(ctx, &with_ext, semantics) {
                    let identity =
                        Self::candidate_identity(ctx, &with_ext, preserve_symlinks, semantics);
                    return Some(format!("{identity}{suffix}"));
                }
            }
        }

        None
    }

    fn candidate_is_file(
        ctx: &Ctx<'_>,
        normalized: &str,
        semantics: FileCandidateSemantics,
    ) -> bool {
        match semantics {
            FileCandidateSemantics::ModuleResolution => {
                Self::module_resolution_is_file(ctx, normalized)
            }
            FileCandidateSemantics::DirectFilesystem => std::path::Path::new(normalized).is_file(),
        }
    }

    fn candidate_identity(
        ctx: &Ctx<'_>,
        normalized: &str,
        preserve_symlinks: bool,
        semantics: FileCandidateSemantics,
    ) -> String {
        match semantics {
            FileCandidateSemantics::ModuleResolution => {
                Self::module_identity_path_for_existing_file(ctx, normalized, preserve_symlinks)
            }
            FileCandidateSemantics::DirectFilesystem => normalized.to_string(),
        }
    }

    fn module_url_for_encoded_path(path: &str, suffix: &str) -> String {
        let path = normalize_encoded_module_path(path);
        format!(
            "{}{}",
            path_with_preserved_escapes_to_file_url(&path),
            serialize_url_preserving_escapes(suffix)
        )
    }

    fn module_url_for_file_specifier(specifier: &str) -> String {
        if !specifier.starts_with("file://") {
            return serialize_url_preserving_escapes(specifier);
        }
        let Some((encoded_path, suffix)) = FileUrlResolver::file_url_path_and_suffix(specifier)
        else {
            return serialize_url_preserving_escapes(specifier);
        };
        let encoded_path = normalize_encoded_module_path(encoded_path);
        format!(
            "{}{}",
            path_with_preserved_escapes_to_file_url(&encoded_path),
            serialize_url_preserving_escapes(suffix)
        )
    }

    fn throw_module_resolution_error<'js, T>(
        ctx: &Ctx<'js>,
        code: &str,
        message: String,
        url: String,
    ) -> rquickjs::Result<T> {
        let error_obj = Exception::from_message(ctx.clone(), &message)?.into_object();
        let error_proto = error_obj.get_prototype();
        let coded_proto = Object::new(ctx.clone())?;
        coded_proto.set_prototype(error_proto.as_ref())?;
        coded_proto.prop(
            "name",
            Property::from(format!("Error [{code}]"))
                .writable()
                .configurable(),
        )?;
        error_obj.set_prototype(Some(&coded_proto))?;
        Self::define_error_property(&error_obj, "code", code)?;
        Self::define_error_property(&error_obj, "url", &url)?;
        Err(ctx.throw(error_obj.into_value()))
    }

    fn directory_import_message(
        ctx: &Ctx<'_>,
        normalized_dir: &str,
        importer: &str,
        include_suggestion: bool,
    ) -> String {
        let mut message = format!(
            "Directory import '{}' is not supported resolving ES modules imported from {}",
            normalized_dir,
            Self::format_importer(importer)
        );
        if include_suggestion {
            let conditions = Vec::new();
            let mut warnings = Vec::new();
            let mut resolution = esm_import_resolution_context(ctx, &conditions, &mut warnings);
            let package_json_path = std::path::Path::new(normalized_dir).join("package.json");
            if let Ok(Some(package)) = NodeModulesResolver::read_package_json_optional_with_context(
                &package_json_path,
                &resolution,
            ) && let Some(main) = package.main.as_deref()
                && let Some((suggestion, _)) = NodeModulesResolver::resolve_package_legacy_main(
                    std::path::Path::new(normalized_dir),
                    main,
                    &mut resolution,
                )
            {
                message.push_str(&format!("\nDid you mean to import \"{suggestion}\"?"));
            }
        }
        message
    }

    fn format_importer(importer: &str) -> String {
        FileUrlResolver::file_url_to_path(importer).unwrap_or_else(|| importer.to_string())
    }

    fn define_error_property<'js>(
        error_obj: &Object<'js>,
        name: &str,
        value: &str,
    ) -> rquickjs::Result<()> {
        error_obj.prop(
            name,
            Property::from(value).writable().enumerable().configurable(),
        )
    }
}

impl Resolver for NodeFileResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if name.contains("://") || name.starts_with("node:") {
            return Err(Error::new_resolving(base, name));
        }

        let (name_path, suffix) = split_module_path_suffix(name);
        let (candidate, url, include_directory_suggestion) = if name_path.starts_with('/') {
            let encoded_path = CjsEvalResolver::normalize_path(std::path::Path::new(name_path));
            let url = Self::module_url_for_encoded_path(&encoded_path, suffix);
            let name_path = match Self::decode_module_path(ctx, base, name, name_path) {
                Ok(path) => path,
                Err(err) => {
                    discard_import_type_rewrite_token(name);
                    return Err(err);
                }
            };
            (std::path::PathBuf::from(name_path.as_ref()), url, true)
        } else if name_path.starts_with("./") || name_path.starts_with("../") {
            let base_path = if let Some(path) = FileUrlResolver::file_url_to_path(base) {
                path
            } else {
                base.to_string()
            };
            let base_path = module_filesystem_path(&base_path);

            if base_path == "<input>" {
                discard_import_type_rewrite_token(name);
                return Err(Error::new_resolving(base, name));
            }

            let Some(base_dir) = std::path::Path::new(&base_path).parent() else {
                discard_import_type_rewrite_token(name);
                return Err(Error::new_resolving(base, name));
            };
            let encoded_candidate = base_dir.join(name_path);
            let encoded_path = CjsEvalResolver::normalize_path(&encoded_candidate);
            let url = Self::module_url_for_encoded_path(&encoded_path, suffix);
            let name_path = match Self::decode_module_path(ctx, base, name, name_path) {
                Ok(path) => path,
                Err(err) => {
                    discard_import_type_rewrite_token(name);
                    return Err(err);
                }
            };
            (base_dir.join(name_path.as_ref()), url, false)
        } else {
            return Err(Error::new_resolving(base, name));
        };

        let normalized = CjsEvalResolver::normalize_path(&candidate);
        if Self::module_resolution_is_dir(ctx, &normalized) {
            discard_import_type_rewrite_token(name);
            return Self::throw_module_resolution_error(
                ctx,
                "ERR_UNSUPPORTED_DIR_IMPORT",
                Self::directory_import_message(
                    ctx,
                    &normalized,
                    base,
                    include_directory_suggestion
                        && !FileUrlResolver::is_same_directory_file_import(&normalized, base),
                ),
                url,
            );
        }

        let suffix = append_loader_realm_param(suffix, loader_realm_param(base).as_deref());
        let preserve_symlinks = Self::has_exec_argv_flag(ctx, "--preserve-symlinks");
        if let Some(resolved) = Self::resolve_candidate(ctx, candidate, &suffix, preserve_symlinks)
        {
            transfer_import_type_rewrite_token(name, &resolved);
            return Ok(resolved);
        }

        discard_import_type_rewrite_token(name);
        Self::throw_module_resolution_error(
            ctx,
            "ERR_MODULE_NOT_FOUND",
            format!("Cannot find module '{}'", name),
            url,
        )
    }
}

/// Resolver that provides Node.js-style error codes for failed module resolution.
/// This should be the LAST resolver in the chain, catching everything that
/// preceding resolvers couldn't handle.
struct NodeModuleErrorResolver;

struct NodeBuiltinNamespaceGuard;

impl Resolver for NodeBuiltinNamespaceGuard {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if !name.starts_with("node:") {
            return Err(Error::new_resolving(base, name));
        }
        let msg = format!("No such built-in module: {}", name);
        throw_native_coded_error(ctx, &msg, "ERR_UNKNOWN_BUILTIN_MODULE", true)
    }
}

impl Resolver for NodeModuleErrorResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        _base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        discard_import_type_rewrite_token(name);
        if name.starts_with("node:") {
            let msg = format!("No such built-in module: {}", name);
            return throw_native_coded_error(ctx, &msg, "ERR_UNKNOWN_BUILTIN_MODULE", true);
        }

        if let Some(scheme_end) = name.find("://") {
            let scheme = &name[..scheme_end];
            if scheme != "file" && scheme != "data" {
                let msg = format!(
                    "Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol '{}:'",
                    scheme
                );
                return throw_native_coded_error(
                    ctx,
                    &msg,
                    "ERR_UNSUPPORTED_ESM_URL_SCHEME",
                    false,
                );
            }
        }

        let msg = format!("Cannot find module '{}'", name);
        throw_native_coded_error(ctx, &msg, "ERR_MODULE_NOT_FOUND", false)
    }
}

enum NodePackageResolveError {
    InvalidModuleSpecifier {
        specifier: String,
        base: String,
    },
    InvalidPackagePatternMatch {
        specifier: String,
        message: String,
    },
    PackagePathNotExported {
        package_name: String,
        subpath: String,
        no_exports_main: bool,
    },
    PackageImportNotDefined {
        specifier: String,
        package_json_path: Option<String>,
        importer: Option<String>,
        no_imports_field: bool,
    },
    InvalidPackageTarget {
        kind: &'static str,
        target: String,
    },
    InvalidPackageConfig {
        path: String,
        reason: Option<String>,
    },
    UnsupportedDirectoryImport {
        request: String,
    },
    ModuleNotFound {
        request: String,
    },
}

enum PackageTargetResolution {
    Resolved(String),
    NoMatch,
    Blocked,
}

type PackageMapTargetMatch<'a> = (&'a PackageTarget, Option<String>, Option<&'a str>);

struct PackageTargetResolveContext<'a> {
    package_dir: &'a std::path::Path,
    allow_bare_target: bool,
    nested_bare_target_resolution_mode: NodePackageResolveMode,
    kind: &'static str,
    conditions: &'a [String],
    pattern_substitution: Option<&'a str>,
    warning_specifier: &'a str,
    warning_pattern_key: Option<&'a str>,
    warning_importer: Option<&'a str>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum PackageTarget {
    String(String),
    Array(Vec<PackageTarget>),
    Object(IndexMap<String, PackageTarget>),
    Bool(bool),
    Null,
    Invalid(serde_json::Value),
}

fn deserialize_optional_package_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| value.as_str().map(|value| value.to_string())))
}

fn deserialize_strict_package_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::String(value) => Ok(Some(value)),
        value => Err(D::Error::custom(format!(
            "invalid package field type {}, expected string",
            value
        ))),
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct PackageJson {
    #[serde(default, deserialize_with = "deserialize_strict_package_string")]
    name: Option<String>,
    #[serde(deserialize_with = "deserialize_optional_package_string")]
    main: Option<String>,
    exports: Option<PackageTarget>,
    imports: Option<PackageTarget>,
    #[serde(rename = "type")]
    #[serde(default, deserialize_with = "deserialize_strict_package_string")]
    package_type: Option<String>,
}

/// Parsed package metadata owned by one QuickJS runtime.
///
/// Node keeps successful package.json parses stable for the lifetime of a
/// runtime. Keeping this handle in `RuntimeServices` preserves that behavior
/// without leaking cached package state between sibling runner runtimes.
#[derive(Clone, Default)]
pub(crate) struct PackageJsonCache(Rc<RefCell<HashMap<String, Rc<PackageJson>>>>);

impl PackageJsonCache {
    fn get(&self, key: &str) -> Option<Rc<PackageJson>> {
        self.0.borrow().get(key).cloned()
    }

    fn insert(&self, key: String, package: Rc<PackageJson>) {
        self.0.borrow_mut().insert(key, package);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ModulePathClassification {
    File,
    Directory,
}

#[derive(Default)]
struct CjsModuleProbeSessionState {
    depth: usize,
    entries: HashMap<String, ModulePathClassification>,
    #[cfg(feature = "test-observability")]
    hit_count: u64,
    #[cfg(feature = "test-observability")]
    bypass_cache: bool,
}

impl CjsModuleProbeSessionState {
    fn cache_enabled(&self) -> bool {
        #[cfg(feature = "test-observability")]
        {
            !self.bypass_cache
        }
        #[cfg(not(feature = "test-observability"))]
        {
            true
        }
    }
}

/// Positive filesystem classifications shared while an outer CommonJS wrapper runs.
///
/// Node's internal `Module._stat` cache retains positive observations during an
/// outer main-module compile. This runtime also brackets an outer `createRequire()`
/// graph so real ESM-to-CJS package workloads benefit, but deliberately invalidates
/// observations after filesystem mutations instead of exposing Node's stale result.
/// Missing observations are never retained, and sibling QuickJS runtimes never share
/// this RuntimeServices-owned state. Rust depth keeps the private runner reentrant;
/// the normal JS adapter crosses the bridge only at its own outermost depth.
#[derive(Clone, Default)]
pub(crate) struct CjsModuleProbeSession(Rc<RefCell<CjsModuleProbeSessionState>>);

struct ModulePathProbe {
    classification: Option<ModulePathClassification>,
    _session_hit: bool,
}

impl CjsModuleProbeSession {
    pub(crate) fn invalidate(&self) {
        self.0.borrow_mut().entries.clear();
    }

    fn begin(&self) {
        let mut state = self.0.borrow_mut();
        if state.depth == 0 {
            state.entries.clear();
        }
        state.depth = state.depth.saturating_add(1);
    }

    fn end(&self) {
        let mut state = self.0.borrow_mut();
        if state.depth == 0 {
            state.entries.clear();
            return;
        }
        state.depth -= 1;
        if state.depth == 0 {
            state.entries.clear();
        }
    }

    fn probe(&self, normalized: &str) -> ModulePathProbe {
        let cached = {
            let state = self.0.borrow();
            (state.depth > 0 && state.cache_enabled())
                .then(|| state.entries.get(normalized).copied())
                .flatten()
        };
        if let Some(classification) = cached {
            #[cfg(feature = "test-observability")]
            {
                let mut state = self.0.borrow_mut();
                state.hit_count = state.hit_count.saturating_add(1);
            }
            return ModulePathProbe {
                classification: Some(classification),
                _session_hit: true,
            };
        }

        let classification = std::fs::metadata(normalized).ok().and_then(|metadata| {
            if metadata.is_file() {
                Some(ModulePathClassification::File)
            } else if metadata.is_dir() {
                Some(ModulePathClassification::Directory)
            } else {
                None
            }
        });

        let mut state = self.0.borrow_mut();
        if state.depth > 0
            && state.cache_enabled()
            && let Some(classification) = classification
        {
            state.entries.insert(normalized.to_string(), classification);
        }
        ModulePathProbe {
            classification,
            _session_hit: false,
        }
    }

    #[cfg(feature = "test-observability")]
    fn hit_count(&self) -> u64 {
        self.0.borrow().hit_count
    }

    #[cfg(feature = "test-observability")]
    fn reset_hit_count(&self) {
        self.0.borrow_mut().hit_count = 0;
    }

    #[cfg(feature = "test-observability")]
    fn set_enabled(&self, enabled: bool) {
        let mut state = self.0.borrow_mut();
        state.bypass_cache = !enabled;
        state.entries.clear();
    }
}

#[derive(Clone, Copy)]
enum ModulePathProbeKind {
    File,
    Directory,
    Classification,
}

impl ModulePathProbeKind {
    #[cfg(feature = "typescript-compiler-profiling")]
    fn counter_prefix(self) -> &'static str {
        match self {
            Self::File => "modules.fileProbe",
            Self::Directory => "modules.directoryProbe",
            Self::Classification => "modules.classificationProbe",
        }
    }

    fn matches(self, classification: Option<ModulePathClassification>) -> bool {
        matches!(
            (self, classification),
            (Self::File, Some(ModulePathClassification::File))
                | (Self::Directory, Some(ModulePathClassification::Directory))
                | (Self::Classification, Some(_))
        )
    }
}

fn module_resolution_path_probe(
    session: &CjsModuleProbeSession,
    #[cfg(feature = "typescript-compiler-profiling")] profile: Option<
        &crate::internal::runtime_services::ExecutionProfile,
    >,
    normalized: &str,
    _kind: ModulePathProbeKind,
) -> ModulePathProbe {
    let probe = session.probe(normalized);

    #[cfg(feature = "typescript-compiler-profiling")]
    if let Some(profile) = profile {
        let found = _kind.matches(probe.classification);
        let prefix = _kind.counter_prefix();
        profile.increment(&format!("{prefix}.calls"));
        profile.increment(&format!(
            "{prefix}.{}",
            if found { "found" } else { "missing" }
        ));
        if probe._session_hit {
            profile.increment(&format!("{prefix}.cacheHits"));
            profile.increment(&format!("{prefix}.sessionCacheHits"));
            profile.increment(&format!(
                "{prefix}.sessionCacheHits{}",
                if found { "Found" } else { "Missing" }
            ));
            profile.increment("modules.pathProbe.sessionHits");
        } else {
            profile.increment(&format!("{prefix}.systemCalls"));
            profile.increment("modules.pathProbe.systemCalls");
        }
    }

    probe
}

fn module_resolution_path_matches(
    session: &CjsModuleProbeSession,
    #[cfg(feature = "typescript-compiler-profiling")] profile: Option<
        &crate::internal::runtime_services::ExecutionProfile,
    >,
    normalized: &str,
    kind: ModulePathProbeKind,
) -> bool {
    kind.matches(
        module_resolution_path_probe(
            session,
            #[cfg(feature = "typescript-compiler-profiling")]
            profile,
            normalized,
            kind,
        )
        .classification,
    )
}

fn cjs_module_path_stat(ctx: Ctx<'_>, filename: String) -> i32 {
    let services = ctx
        .userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized");
    let Ok(resolved) = services
        .process
        .resolve_path(std::path::Path::new(&filename))
    else {
        return -2;
    };
    let normalized = resolved.to_string_lossy();
    let probe = module_resolution_path_probe(
        &services.cjs_module_probe_session,
        #[cfg(feature = "typescript-compiler-profiling")]
        services.execution_profile().as_deref(),
        &normalized,
        ModulePathProbeKind::Classification,
    );
    match probe.classification {
        Some(ModulePathClassification::File) => 0,
        Some(ModulePathClassification::Directory) => 1,
        None => -2,
    }
}

fn with_cjs_module_probe_session<'js>(
    ctx: Ctx<'js>,
    callback: Function<'js>,
) -> rquickjs::Result<Value<'js>> {
    let session = ctx
        .userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .cjs_module_probe_session
        .clone();
    session.begin();
    let result = callback.call(());
    session.end();
    result
}

#[cfg(feature = "test-observability")]
fn cjs_module_probe_session_hit_count(ctx: Ctx<'_>) -> u64 {
    ctx.userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .cjs_module_probe_session
        .hit_count()
}

#[cfg(feature = "test-observability")]
fn reset_cjs_module_probe_session_hit_count(ctx: Ctx<'_>) {
    ctx.userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .cjs_module_probe_session
        .reset_hit_count();
}

#[cfg(feature = "test-observability")]
fn set_cjs_module_probe_session_enabled(ctx: Ctx<'_>, enabled: bool) {
    ctx.userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .cjs_module_probe_session
        .set_enabled(enabled);
}

struct NodePackageWarning {
    message: String,
    code: &'static str,
    dedupe_key: Option<String>,
}

pub(crate) fn node_package_deprecation_warning_seen(ctx: &Ctx<'_>, key: &str) -> bool {
    ctx.userdata::<super::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .node_package_deprecation_warnings
        .borrow()
        .contains(key)
}

pub(crate) fn mark_node_package_deprecation_warning_seen(ctx: &Ctx<'_>, key: String) {
    ctx.userdata::<super::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .node_package_deprecation_warnings
        .borrow_mut()
        .insert(key);
}

struct NodeModulesResolver;

#[derive(Clone, Copy, PartialEq, Eq)]
enum NodePackageResolveMode {
    EsmImport,
    CjsAnalysis,
}

enum NodePackageConditionMode {
    EsmImport,
    CjsAnalysis,
    Loader,
}

impl NodePackageConditionMode {
    const ESM_CONDITIONS: [&'static str; 5] = ["golem", "node", "module-sync", "import", "default"];
    const CJS_ANALYSIS_CONDITIONS: [&'static str; 5] =
        ["golem", "node", "require", "module-sync", "default"];
    const LOADER_CONDITIONS: [&'static str; 4] = ["node", "import", "module-sync", "node-addons"];

    fn default_conditions(&self) -> &'static [&'static str] {
        match self {
            NodePackageConditionMode::EsmImport => &Self::ESM_CONDITIONS,
            NodePackageConditionMode::CjsAnalysis => &Self::CJS_ANALYSIS_CONDITIONS,
            NodePackageConditionMode::Loader => &Self::LOADER_CONDITIONS,
        }
    }

    fn from_js_mode(mode: &str) -> Option<Self> {
        match mode {
            "import" => Some(Self::EsmImport),
            "cjs-analysis" | "require" => Some(Self::CjsAnalysis),
            "loader" => Some(Self::Loader),
            _ => None,
        }
    }
}

impl NodePackageResolveMode {
    fn from_js_mode(mode: &str) -> Option<Self> {
        match mode {
            "import" => Some(Self::EsmImport),
            "cjs-analysis" | "require" => Some(Self::CjsAnalysis),
            _ => None,
        }
    }

    fn condition_mode(&self) -> NodePackageConditionMode {
        match self {
            NodePackageResolveMode::EsmImport => NodePackageConditionMode::EsmImport,
            NodePackageResolveMode::CjsAnalysis => NodePackageConditionMode::CjsAnalysis,
        }
    }

    fn package_exports_importer<'a>(&self, base: &'a str) -> Option<&'a str> {
        match self {
            NodePackageResolveMode::EsmImport => Some(base),
            NodePackageResolveMode::CjsAnalysis => None,
        }
    }

    fn probes_missing_package_root_file(&self) -> bool {
        matches!(self, NodePackageResolveMode::CjsAnalysis)
    }
}

fn package_global_conditions<'js>(
    ctx: Ctx<'js>,
    mode: String,
) -> rquickjs::Result<rquickjs::Array<'js>> {
    let Some(mode) = NodePackageConditionMode::from_js_mode(&mode) else {
        return throw_native_coded_error(
            &ctx,
            "Unknown internal package condition mode",
            "ERR_INVALID_ARG_VALUE",
            false,
        );
    };
    let conditions = NodeModulesResolver::conditions_from_global(&ctx, mode);
    let result = rquickjs::Array::new(ctx)?;
    for (index, condition) in conditions.iter().enumerate() {
        result.set(index, condition.as_str())?;
    }
    Ok(result)
}

fn set_non_replaceable_global<'js, T>(
    global: &Object<'js>,
    name: &str,
    value: T,
) -> rquickjs::Result<()>
where
    T: IntoJs<'js>,
{
    global.prop(name, Property::from(value))
}

struct NodePackageResolutionContext<'a, 'w> {
    mode: NodePackageResolveMode,
    conditions: &'a [String],
    warnings: &'w mut Vec<NodePackageWarning>,
    file_probe_cache: HashMap<String, bool>,
    directory_probe_cache: HashMap<String, bool>,
    probe_session: CjsModuleProbeSession,
    package_json_cache: PackageJsonCache,
    #[cfg(feature = "typescript-compiler-profiling")]
    profile: Option<Rc<crate::internal::runtime_services::ExecutionProfile>>,
}

impl<'a, 'w> NodePackageResolutionContext<'a, 'w> {
    fn new(
        ctx: &Ctx<'_>,
        mode: NodePackageResolveMode,
        conditions: &'a [String],
        warnings: &'w mut Vec<NodePackageWarning>,
    ) -> Self {
        let services = ctx
            .userdata::<crate::internal::runtime_services::RuntimeServices>()
            .expect("runtime services not initialized");
        let package_json_cache = services.package_json_cache.clone();
        let probe_session = services.cjs_module_probe_session.clone();
        Self {
            mode,
            conditions,
            warnings,
            file_probe_cache: HashMap::new(),
            directory_probe_cache: HashMap::new(),
            probe_session,
            package_json_cache,
            #[cfg(feature = "typescript-compiler-profiling")]
            profile: services.execution_profile(),
        }
    }

    fn normalized_is_file(&mut self, normalized: &str) -> bool {
        if let Some(cached) = self.file_probe_cache.get(normalized) {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &self.profile {
                profile.increment("modules.fileProbe.calls");
                profile.increment("modules.fileProbe.cacheHits");
                profile.increment(if *cached {
                    "modules.fileProbe.cacheHitsFound"
                } else {
                    "modules.fileProbe.cacheHitsMissing"
                });
                profile.increment(if *cached {
                    "modules.fileProbe.found"
                } else {
                    "modules.fileProbe.missing"
                });
            }
            return *cached;
        }
        let is_file = module_resolution_path_matches(
            &self.probe_session,
            #[cfg(feature = "typescript-compiler-profiling")]
            self.profile.as_deref(),
            normalized,
            ModulePathProbeKind::File,
        );
        self.file_probe_cache
            .insert(normalized.to_string(), is_file);
        is_file
    }

    fn is_file(&mut self, path: &std::path::Path) -> bool {
        let normalized = CjsEvalResolver::normalize_path(path);
        self.normalized_is_file(&normalized)
    }

    fn is_dir(&mut self, path: &std::path::Path) -> bool {
        let normalized = CjsEvalResolver::normalize_path(path);
        if let Some(cached) = self.directory_probe_cache.get(&normalized) {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &self.profile {
                profile.increment("modules.directoryProbe.calls");
                profile.increment("modules.directoryProbe.cacheHits");
                profile.increment(if *cached {
                    "modules.directoryProbe.cacheHitsFound"
                } else {
                    "modules.directoryProbe.cacheHitsMissing"
                });
                profile.increment(if *cached {
                    "modules.directoryProbe.found"
                } else {
                    "modules.directoryProbe.missing"
                });
            }
            return *cached;
        }
        let is_dir = module_resolution_path_matches(
            &self.probe_session,
            #[cfg(feature = "typescript-compiler-profiling")]
            self.profile.as_deref(),
            &normalized,
            ModulePathProbeKind::Directory,
        );
        self.directory_probe_cache.insert(normalized, is_dir);
        is_dir
    }

    fn with_mode<T>(
        &mut self,
        mode: NodePackageResolveMode,
        f: impl FnOnce(&mut Self) -> Result<T, NodePackageResolveError>,
    ) -> Result<T, NodePackageResolveError> {
        let previous_mode = self.mode;
        self.mode = mode;
        let result = f(self);
        self.mode = previous_mode;
        result
    }
}

#[derive(Clone, Copy)]
enum CjsAnalysisPackageFallbackStep {
    RootFile,
    PackageMain,
    Subpath,
    RootDirectory,
}

#[derive(Clone, Copy)]
enum CjsAnalysisDirectoryFallbackStep {
    RootFile,
    PackageMain,
    RootDirectory,
}

#[derive(Clone, Copy)]
enum CjsAnalysisProbe {
    Exact,
    Extension(&'static str),
    Index(&'static str),
}

impl NodeModulesResolver {
    fn try_resolve_with_context(
        &self,
        base: &str,
        name: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<String>, NodePackageResolveError> {
        use std::path::Path;

        if name.starts_with('#') {
            return self.try_resolve_package_import_with_context(base, name, resolution);
        }

        if name.starts_with('.') || name.starts_with('/') || name.contains("://") {
            return Ok(None);
        }

        let Some((package_name, subpath)) = Self::split_package_name(name) else {
            return Ok(None);
        };
        Self::validate_package_name(base, name, package_name)?;
        let package_root_trailing_slash = name.ends_with('/') && subpath.is_empty();

        let Some(base_dir) = Path::new(base).parent() else {
            return Ok(None);
        };
        if let Some((resolved, _package_dir)) =
            Self::try_resolve_package_self(base_dir, Some(base), package_name, subpath, resolution)?
        {
            return Ok(Some(resolved));
        }

        let mut dir = base_dir.to_path_buf();
        loop {
            let skip_nested_node_modules = resolution.mode == NodePackageResolveMode::CjsAnalysis
                && dir.file_name().is_some_and(|name| name == "node_modules");
            if !skip_nested_node_modules {
                let package_path = dir.join("node_modules").join(package_name);
                if resolution.is_dir(&package_path)
                    && let Some(resolved) = Self::try_resolve_package_directory(
                        base,
                        name,
                        package_name,
                        subpath,
                        package_root_trailing_slash,
                        &package_path,
                        resolution,
                    )?
                {
                    return Ok(Some(resolved));
                }

                if resolution.mode.probes_missing_package_root_file()
                    && subpath.is_empty()
                    && let Some(resolved) =
                        Self::resolve_cjs_analysis_package_root_file(&package_path, resolution)
                {
                    return Ok(Some(resolved));
                }
            }

            if !dir.pop() {
                break;
            }
        }

        Ok(None)
    }

    fn try_resolve_package_directory(
        base: &str,
        specifier: &str,
        package_name: &str,
        subpath: &str,
        package_root_trailing_slash: bool,
        package_path: &std::path::Path,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<String>, NodePackageResolveError> {
        let pkg_path = package_path.join("package.json");
        let package = Self::read_package_json_optional_with_context(&pkg_path, resolution)?;

        if let Some(package) = package.as_ref()
            && let Some(exports_field) = package
                .exports
                .as_ref()
                .filter(|exports| Self::is_active_package_exports(exports))
        {
            Self::validate_package_exports_map(&pkg_path, exports_field)?;
            return Self::resolve_package_exports(
                package_name,
                package_path,
                exports_field,
                subpath,
                resolution,
                resolution.mode.package_exports_importer(base),
            )
            .map(Some);
        }

        match resolution.mode {
            NodePackageResolveMode::EsmImport => Self::try_resolve_package_directory_esm(
                base,
                specifier,
                subpath,
                package_root_trailing_slash,
                package_path,
                package.as_deref(),
                resolution,
            ),
            NodePackageResolveMode::CjsAnalysis => {
                Ok(Self::try_resolve_package_directory_for_cjs_analysis(
                    subpath,
                    package_path,
                    package.as_deref(),
                    resolution,
                ))
            }
        }
    }

    fn is_active_package_exports(exports: &PackageTarget) -> bool {
        matches!(
            exports,
            PackageTarget::String(_) | PackageTarget::Array(_) | PackageTarget::Object(_)
        )
    }

    fn read_package_json_optional_with_context(
        pkg_path: &std::path::Path,
        resolution: &NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<Rc<PackageJson>>, NodePackageResolveError> {
        let cache_key = CjsEvalResolver::normalize_path(pkg_path);
        if let Some(cached) = resolution.package_json_cache.get(&cache_key) {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &resolution.profile {
                profile.increment("modules.packageJson.cacheHits");
            }
            return Ok(Some(cached));
        }
        match std::fs::read_to_string(pkg_path) {
            Ok(pkg_content) => {
                #[cfg(feature = "typescript-compiler-profiling")]
                if let Some(profile) = &resolution.profile {
                    profile.increment("modules.packageJson.reads");
                    profile.add("modules.packageJson.bytes", pkg_content.len() as u64);
                }
                let package = Rc::new(serde_json::from_str::<PackageJson>(&pkg_content).map_err(
                    |_| NodePackageResolveError::InvalidPackageConfig {
                        path: pkg_path.to_string_lossy().into_owned(),
                        reason: None,
                    },
                )?);
                resolution
                    .package_json_cache
                    .insert(cache_key, package.clone());
                Ok(Some(package))
            }
            Err(_error) => {
                #[cfg(feature = "typescript-compiler-profiling")]
                if let Some(profile) = &resolution.profile {
                    profile.increment(if _error.kind() == std::io::ErrorKind::NotFound {
                        "modules.packageJson.notFound"
                    } else {
                        "modules.packageJson.errors"
                    });
                }
                Ok(None)
            }
        }
    }

    fn try_resolve_package_directory_esm(
        base: &str,
        specifier: &str,
        subpath: &str,
        package_root_trailing_slash: bool,
        package_path: &std::path::Path,
        package: Option<&PackageJson>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<String>, NodePackageResolveError> {
        let package_type = package.and_then(|package| package.package_type.as_ref());
        if subpath.is_empty()
            && !package_root_trailing_slash
            && let Some(package) = package
            && let Some(main) = package.main.as_ref()
        {
            let is_module_package = package.package_type.as_deref() == Some("module");
            let resolved = Self::resolve_package_legacy_main(package_path, main, resolution);
            if let Some((resolved, used_extension_lookup)) = resolved {
                if is_module_package && used_extension_lookup {
                    resolution.warnings.push(NodePackageWarning {
                        message: format!(
                            "Package {}/ has a \"main\" field set to {:?}, excluding the full filename and extension to the resolved file at {:?}, imported from {}.\nAutomatic extension resolution of the \"main\" field is deprecated for ES modules.",
                            package_path.to_string_lossy().trim_end_matches('/'),
                            main,
                            std::path::Path::new(&resolved)
                                .strip_prefix(package_path)
                                .ok()
                                .map(|path| path.to_string_lossy().into_owned())
                                .unwrap_or_else(|| resolved.clone()),
                            base
                        ),
                        code: "DEP0151",
                        dedupe_key: None,
                    });
                }
                return Ok(Some(resolved));
            }
        }

        if !subpath.is_empty()
            && let Some(resolved) =
                Self::resolve_package_subpath(package_path, subpath, base, specifier, resolution)?
        {
            return Ok(Some(resolved));
        }

        if subpath.is_empty() {
            let is_module_package =
                package_type.is_some_and(|package_type| package_type == "module");
            let fallbacks = [
                package_path.join("index.js"),
                package_path.join("index.json"),
                package_path.join("index.node"),
            ];
            for fallback in &fallbacks {
                if resolution.is_file(fallback) {
                    if is_module_package
                        && fallback.extension().and_then(|ext| ext.to_str()) == Some("js")
                    {
                        resolution.warnings.push(NodePackageWarning {
                            message: format!(
                                "No \"main\" or \"exports\" field defined in the package.json for {}/ resolving the main entry point \"index.js\", imported from {}.\nDefault \"index\" lookups for the main are deprecated for ES modules.",
                                package_path.to_string_lossy().trim_end_matches('/'),
                                base
                            ),
                            code: "DEP0151",
                            dedupe_key: None,
                        });
                    }
                    return Ok(Some(fallback.to_string_lossy().into_owned()));
                }
            }
        }

        Ok(None)
    }

    fn try_resolve_package_directory_for_cjs_analysis(
        subpath: &str,
        package_path: &std::path::Path,
        package: Option<&PackageJson>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        for step in Self::CJS_ANALYSIS_PACKAGE_FALLBACK_STEPS {
            if let Some(resolved) = Self::resolve_cjs_analysis_package_fallback_step(
                step,
                subpath,
                package_path,
                package,
                resolution,
            ) {
                return Some(resolved);
            }
        }

        None
    }

    fn resolve_cjs_analysis_package_fallback_step(
        step: CjsAnalysisPackageFallbackStep,
        subpath: &str,
        package_path: &std::path::Path,
        package: Option<&PackageJson>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        match step {
            CjsAnalysisPackageFallbackStep::RootFile => subpath
                .is_empty()
                .then(|| {
                    Self::resolve_cjs_analysis_directory_fallback_step(
                        CjsAnalysisDirectoryFallbackStep::RootFile,
                        package_path,
                        package,
                        resolution,
                    )
                })
                .flatten(),
            CjsAnalysisPackageFallbackStep::PackageMain => {
                if !subpath.is_empty() {
                    return None;
                }
                Self::resolve_cjs_analysis_directory_fallback_step(
                    CjsAnalysisDirectoryFallbackStep::PackageMain,
                    package_path,
                    package,
                    resolution,
                )
            }
            CjsAnalysisPackageFallbackStep::Subpath => {
                if subpath.is_empty() {
                    None
                } else {
                    Self::resolve_cjs_analysis_file_or_directory(package_path, subpath, resolution)
                }
            }
            CjsAnalysisPackageFallbackStep::RootDirectory => subpath
                .is_empty()
                .then(|| {
                    Self::resolve_cjs_analysis_directory_fallback_step(
                        CjsAnalysisDirectoryFallbackStep::RootDirectory,
                        package_path,
                        package,
                        resolution,
                    )
                })
                .flatten(),
        }
    }

    fn try_resolve_package_import_with_context(
        &self,
        base: &str,
        name: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<String>, NodePackageResolveError> {
        use std::path::Path;

        if resolution.mode == NodePackageResolveMode::EsmImport {
            Self::validate_package_import_specifier(name)?;
        }

        let Some(parent) = Path::new(base).parent() else {
            return Ok(None);
        };
        let mut dir = parent.to_path_buf();
        loop {
            if dir.file_name().is_some_and(|name| name == "node_modules") {
                return Err(NodePackageResolveError::PackageImportNotDefined {
                    specifier: name.to_string(),
                    package_json_path: None,
                    importer: Some(base.to_string()),
                    no_imports_field: true,
                });
            }

            let pkg_path = dir.join("package.json");
            if let Some(package) =
                Self::read_package_json_optional_with_context(&pkg_path, resolution)?
            {
                let Some(imports) = package.imports.as_ref() else {
                    return Err(NodePackageResolveError::PackageImportNotDefined {
                        specifier: name.to_string(),
                        package_json_path: Some(pkg_path.to_string_lossy().into_owned()),
                        importer: Some(base.to_string()),
                        no_imports_field: true,
                    });
                };
                Self::validate_package_import_specifier(name)?;
                return Self::resolve_package_import(&dir, imports, name, resolution, Some(base))
                    .map(Some);
            }

            if !dir.pop() {
                break;
            }
        }

        Err(NodePackageResolveError::PackageImportNotDefined {
            specifier: name.to_string(),
            package_json_path: None,
            importer: Some(base.to_string()),
            no_imports_field: true,
        })
    }

    fn try_resolve_package_self(
        base_dir: &std::path::Path,
        importer: Option<&str>,
        package_name: &str,
        subpath: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<(String, String)>, NodePackageResolveError> {
        let mut dir = base_dir.to_path_buf();
        loop {
            if dir.file_name().is_some_and(|name| name == "node_modules") {
                return Ok(None);
            }

            let pkg_path = dir.join("package.json");
            if let Some(package) =
                Self::read_package_json_optional_with_context(&pkg_path, resolution)?
            {
                if package.name.as_deref() == Some(package_name)
                    && let Some(exports_field) = package
                        .exports
                        .as_ref()
                        .filter(|exports| Self::is_active_package_exports(exports))
                {
                    Self::validate_package_exports_map(&pkg_path, exports_field)?;
                    let resolved = Self::resolve_package_exports(
                        package_name,
                        &dir,
                        exports_field,
                        subpath,
                        resolution,
                        importer,
                    )?;
                    return Ok(Some((resolved, CjsEvalResolver::normalize_path(&dir))));
                }
                return Ok(None);
            }

            if !dir.pop() {
                break;
            }
        }

        Ok(None)
    }

    fn split_package_name(name: &str) -> Option<(&str, &str)> {
        if name.starts_with('@') {
            let Some(first) = name.find('/') else {
                return Some((name, ""));
            };
            let rest = &name[first + 1..];
            if rest.is_empty() {
                return Some((name, ""));
            }
            if let Some(second_rel) = rest.find('/') {
                let second = first + 1 + second_rel;
                Some((&name[..second], &name[second + 1..]))
            } else {
                Some((name, ""))
            }
        } else if let Some(idx) = name.find('/') {
            Some((&name[..idx], &name[idx + 1..]))
        } else {
            Some((name, ""))
        }
    }

    fn validate_package_name(
        base: &str,
        specifier: &str,
        package_name: &str,
    ) -> Result<(), NodePackageResolveError> {
        let invalid_scoped_name = package_name.starts_with('@') && !package_name.contains('/');
        if invalid_scoped_name || package_name.contains('%') || package_name.contains('\\') {
            return Err(NodePackageResolveError::InvalidModuleSpecifier {
                specifier: specifier.to_string(),
                base: base.to_string(),
            });
        }
        Ok(())
    }

    fn validate_package_import_specifier(specifier: &str) -> Result<(), NodePackageResolveError> {
        if specifier == "#" || specifier.starts_with("#/") || specifier.ends_with('/') {
            return Err(NodePackageResolveError::InvalidPackagePatternMatch {
                specifier: specifier.to_string(),
                message: "is not a valid internal imports specifier name".to_string(),
            });
        }
        Ok(())
    }

    fn resolve_package_subpath(
        package_dir: &std::path::Path,
        subpath: &str,
        base: &str,
        specifier: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<String>, NodePackageResolveError> {
        if Self::has_encoded_slash_or_backslash(subpath) {
            return Err(NodePackageResolveError::InvalidModuleSpecifier {
                specifier: specifier.to_string(),
                base: base.to_string(),
            });
        }
        let decoded_subpath = percent_decode(subpath).unwrap_or_else(|| subpath.to_string());
        let target_path = package_dir.join(decoded_subpath);
        if resolution.is_file(&target_path) {
            return Ok(Some(target_path.to_string_lossy().into_owned()));
        }
        if resolution.is_dir(&target_path) {
            return Err(NodePackageResolveError::UnsupportedDirectoryImport {
                request: target_path.to_string_lossy().into_owned(),
            });
        }
        Ok(None)
    }

    fn resolve_package_legacy_main(
        package_dir: &std::path::Path,
        target: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<(String, bool)> {
        let target_path = package_dir.join(target.strip_prefix("./").unwrap_or(target));
        if resolution.is_file(&target_path) {
            return Some((target_path.to_string_lossy().into_owned(), false));
        }
        if target_path.extension().is_none() {
            let js_target = Self::with_appended_extension(&target_path, ".js");
            if resolution.is_file(&js_target) {
                return Some((js_target.to_string_lossy().into_owned(), true));
            }
            let json_target = Self::with_appended_extension(&target_path, ".json");
            if resolution.is_file(&json_target) {
                return Some((json_target.to_string_lossy().into_owned(), false));
            }
            let node_target = Self::with_appended_extension(&target_path, ".node");
            if resolution.is_file(&node_target) {
                return Some((node_target.to_string_lossy().into_owned(), false));
            }
        }
        let index_js = target_path.join("index.js");
        if resolution.is_file(&index_js) {
            return Some((index_js.to_string_lossy().into_owned(), true));
        }
        let index_json = target_path.join("index.json");
        if resolution.is_file(&index_json) {
            return Some((index_json.to_string_lossy().into_owned(), false));
        }
        let index_node = target_path.join("index.node");
        if resolution.is_file(&index_node) {
            return Some((index_node.to_string_lossy().into_owned(), false));
        }
        None
    }

    const CJS_ANALYSIS_ROOT_FILE_PROBES: [CjsAnalysisProbe; 4] = [
        CjsAnalysisProbe::Exact,
        CjsAnalysisProbe::Extension(".js"),
        CjsAnalysisProbe::Extension(".json"),
        CjsAnalysisProbe::Extension(".node"),
    ];
    const CJS_ANALYSIS_FILE_OR_DIRECTORY_PROBES: [CjsAnalysisProbe; 7] = [
        CjsAnalysisProbe::Exact,
        CjsAnalysisProbe::Extension(".js"),
        CjsAnalysisProbe::Extension(".json"),
        CjsAnalysisProbe::Extension(".node"),
        CjsAnalysisProbe::Index("index.js"),
        CjsAnalysisProbe::Index("index.json"),
        CjsAnalysisProbe::Index("index.node"),
    ];
    const CJS_ANALYSIS_ROOT_DIRECTORY_PROBES: [CjsAnalysisProbe; 3] = [
        CjsAnalysisProbe::Index("index.js"),
        CjsAnalysisProbe::Index("index.json"),
        CjsAnalysisProbe::Index("index.node"),
    ];
    const CJS_ANALYSIS_PACKAGE_FALLBACK_STEPS: [CjsAnalysisPackageFallbackStep; 4] = [
        CjsAnalysisPackageFallbackStep::RootFile,
        CjsAnalysisPackageFallbackStep::PackageMain,
        CjsAnalysisPackageFallbackStep::Subpath,
        CjsAnalysisPackageFallbackStep::RootDirectory,
    ];
    const CJS_ANALYSIS_RELATIVE_DIRECTORY_FALLBACK_STEPS: [CjsAnalysisDirectoryFallbackStep; 2] = [
        CjsAnalysisDirectoryFallbackStep::PackageMain,
        CjsAnalysisDirectoryFallbackStep::RootDirectory,
    ];

    fn first_existing_cjs_analysis_probe(
        target_path: &std::path::Path,
        probes: &[CjsAnalysisProbe],
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        for probe in probes {
            let candidate = match probe {
                CjsAnalysisProbe::Exact => target_path.to_path_buf(),
                CjsAnalysisProbe::Extension(extension) => {
                    Self::with_appended_extension(target_path, extension)
                }
                CjsAnalysisProbe::Index(index) => target_path.join(index),
            };
            let normalized = CjsEvalResolver::normalize_path(&candidate);
            if resolution.normalized_is_file(&normalized) {
                return Some(normalized);
            }
        }

        None
    }

    fn first_existing_runtime_cjs_probe(
        target_path: &std::path::Path,
        extensions: &[String],
        include_exact: bool,
        include_index: bool,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        if include_exact {
            let normalized = CjsEvalResolver::normalize_path(target_path);
            if resolution.normalized_is_file(&normalized) {
                return Some(normalized);
            }
        }

        for extension in extensions {
            let candidate = Self::with_appended_extension(target_path, extension);
            let normalized = CjsEvalResolver::normalize_path(&candidate);
            if resolution.normalized_is_file(&normalized) {
                return Some(normalized);
            }
        }

        if include_index {
            for extension in extensions {
                let candidate = target_path.join(format!("index{}", extension));
                let normalized = CjsEvalResolver::normalize_path(&candidate);
                if resolution.normalized_is_file(&normalized) {
                    return Some(normalized);
                }
            }
        }

        None
    }

    fn with_appended_extension(path: &std::path::Path, extension: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(format!("{}{}", path.to_string_lossy(), extension))
    }

    fn resolve_runtime_cjs_file_or_index(
        package_dir: &std::path::Path,
        target: &str,
        extensions: &[String],
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        let target_path = package_dir.join(target.strip_prefix("./").unwrap_or(target));
        Self::first_existing_runtime_cjs_probe(&target_path, extensions, true, true, resolution)
    }

    fn resolve_runtime_cjs_package_directory(
        candidate: &std::path::Path,
        fallback_package_dir: &std::path::Path,
        extensions: &[String],
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<(String, String)>, NodePackageResolveError> {
        let nested_pkg_path = candidate.join("package.json");
        if let Some(package) =
            Self::read_package_json_optional_with_context(&nested_pkg_path, resolution)?
            && let Some(main) = package.main.as_ref()
            && let Some(resolved) =
                Self::resolve_runtime_cjs_file_or_index(candidate, main, extensions, resolution)
        {
            return Ok(Some((
                resolved,
                CjsEvalResolver::normalize_path(fallback_package_dir),
            )));
        }

        Ok(
            Self::first_existing_runtime_cjs_probe(candidate, extensions, false, true, resolution)
                .map(|resolved| {
                    (
                        resolved,
                        CjsEvalResolver::normalize_path(fallback_package_dir),
                    )
                }),
        )
    }

    fn resolve_runtime_cjs_package_fallback(
        package_dir: &std::path::Path,
        subpath: &str,
        extensions: &[String],
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<Option<(String, String)>, NodePackageResolveError> {
        let package_dir_key = CjsEvalResolver::normalize_path(package_dir);
        if !subpath.is_empty() {
            let sub_candidate = Self::join_package_subpath(package_dir, subpath);
            if let Some(resolved) = Self::first_existing_runtime_cjs_probe(
                &sub_candidate,
                extensions,
                true,
                false,
                resolution,
            ) {
                return Ok(Some((resolved, package_dir_key)));
            }
            return Self::resolve_runtime_cjs_package_directory(
                &sub_candidate,
                package_dir,
                extensions,
                resolution,
            );
        }

        if let Some(resolved) =
            Self::first_existing_runtime_cjs_probe(package_dir, extensions, true, false, resolution)
        {
            return Ok(Some((resolved, package_dir_key)));
        }

        let pkg_path = package_dir.join("package.json");
        if let Some(package) = Self::read_package_json_optional_with_context(&pkg_path, resolution)?
            && let Some(main) = package.main.as_ref()
            && let Some(resolved) =
                Self::resolve_runtime_cjs_file_or_index(package_dir, main, extensions, resolution)
        {
            return Ok(Some((resolved, package_dir_key)));
        }

        Ok(
            Self::first_existing_runtime_cjs_probe(
                package_dir,
                extensions,
                false,
                true,
                resolution,
            )
            .map(|resolved| (resolved, package_dir_key)),
        )
    }

    fn join_package_subpath(package_dir: &std::path::Path, subpath: &str) -> std::path::PathBuf {
        package_dir.join(subpath.trim_start_matches('/'))
    }

    fn resolve_cjs_analysis_file_or_directory(
        package_dir: &std::path::Path,
        target: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        let target_path = package_dir.join(target.strip_prefix("./").unwrap_or(target));
        Self::first_existing_cjs_analysis_probe(
            &target_path,
            &Self::CJS_ANALYSIS_FILE_OR_DIRECTORY_PROBES,
            resolution,
        )
    }

    fn resolve_cjs_analysis_package_root_file(
        package_dir: &std::path::Path,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        Self::first_existing_cjs_analysis_probe(
            package_dir,
            &Self::CJS_ANALYSIS_ROOT_FILE_PROBES,
            resolution,
        )
    }

    fn resolve_cjs_analysis_package_root_directory(
        package_dir: &std::path::Path,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        Self::first_existing_cjs_analysis_probe(
            package_dir,
            &Self::CJS_ANALYSIS_ROOT_DIRECTORY_PROBES,
            resolution,
        )
    }

    fn resolve_cjs_analysis_directory_fallback_step(
        step: CjsAnalysisDirectoryFallbackStep,
        directory_path: &std::path::Path,
        package: Option<&PackageJson>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        match step {
            CjsAnalysisDirectoryFallbackStep::RootFile => {
                Self::resolve_cjs_analysis_package_root_file(directory_path, resolution)
            }
            CjsAnalysisDirectoryFallbackStep::PackageMain => {
                let main = package.and_then(|package| package.main.as_ref())?;
                Self::resolve_cjs_analysis_file_or_directory(directory_path, main, resolution)
            }
            CjsAnalysisDirectoryFallbackStep::RootDirectory => {
                Self::resolve_cjs_analysis_package_root_directory(directory_path, resolution)
            }
        }
    }

    fn first_existing_cjs_analysis_directory_fallback(
        steps: &[CjsAnalysisDirectoryFallbackStep],
        directory_path: &std::path::Path,
        package: Option<&PackageJson>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        for step in steps {
            if let Some(resolved) = Self::resolve_cjs_analysis_directory_fallback_step(
                *step,
                directory_path,
                package,
                resolution,
            ) {
                return Some(resolved);
            }
        }

        None
    }

    fn resolve_cjs_analysis_relative(
        target_path: &std::path::Path,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Option<String> {
        if let Some(resolved) = Self::resolve_cjs_analysis_directory_fallback_step(
            CjsAnalysisDirectoryFallbackStep::RootFile,
            target_path,
            None,
            resolution,
        ) {
            return Some(resolved);
        }

        if !resolution.is_dir(target_path) {
            return None;
        }

        let pkg_path = target_path.join("package.json");
        let package = match Self::read_package_json_optional_with_context(&pkg_path, resolution) {
            Ok(package) => package,
            Err(_) => return None,
        };
        Self::first_existing_cjs_analysis_directory_fallback(
            &Self::CJS_ANALYSIS_RELATIVE_DIRECTORY_FALLBACK_STEPS,
            target_path,
            package.as_deref(),
            resolution,
        )
    }

    fn resolve_package_exports(
        package_name: &str,
        package_dir: &std::path::Path,
        exports: &PackageTarget,
        subpath: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
        importer: Option<&str>,
    ) -> Result<String, NodePackageResolveError> {
        let key = if subpath.is_empty() {
            ".".to_string()
        } else {
            format!("./{}", subpath)
        };

        if matches!(exports, PackageTarget::String(_) | PackageTarget::Array(_))
            || Self::is_conditions_object(exports)
        {
            if key != "." {
                return Err(NodePackageResolveError::PackagePathNotExported {
                    package_name: package_name.to_string(),
                    subpath: subpath.to_string(),
                    no_exports_main: false,
                });
            }
            let ctx = PackageTargetResolveContext {
                package_dir,
                allow_bare_target: false,
                nested_bare_target_resolution_mode: NodePackageResolveMode::EsmImport,
                kind: "exports",
                conditions: resolution.conditions,
                pattern_substitution: None,
                warning_specifier: &key,
                warning_pattern_key: None,
                warning_importer: importer,
            };
            return Self::resolve_package_target_with_context(exports, ctx, resolution).and_then(
                |resolution| {
                    Self::target_resolution_to_export_result(
                        resolution,
                        package_name,
                        subpath,
                        key == "." && Self::is_conditions_object(exports),
                    )
                },
            );
        }

        if let PackageTarget::Object(map) = exports
            && let Some((target, pattern_substitution, pattern_key)) =
                Self::find_package_map_target(map, &key, "is not a valid match in pattern")?
        {
            let ctx = PackageTargetResolveContext {
                package_dir,
                allow_bare_target: false,
                nested_bare_target_resolution_mode: NodePackageResolveMode::EsmImport,
                kind: "exports",
                conditions: resolution.conditions,
                pattern_substitution: pattern_substitution.as_deref(),
                warning_specifier: &key,
                warning_pattern_key: pattern_key,
                warning_importer: importer,
            };
            return Self::resolve_package_target_with_context(target, ctx, resolution).and_then(
                |resolution| {
                    Self::target_resolution_to_export_result(
                        resolution,
                        package_name,
                        subpath,
                        false,
                    )
                },
            );
        }

        Err(NodePackageResolveError::PackagePathNotExported {
            package_name: package_name.to_string(),
            subpath: subpath.to_string(),
            no_exports_main: false,
        })
    }

    fn resolve_package_import(
        package_dir: &std::path::Path,
        imports: &PackageTarget,
        specifier: &str,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
        importer: Option<&str>,
    ) -> Result<String, NodePackageResolveError> {
        if let PackageTarget::Object(map) = imports
            && let Some((target, pattern_substitution, pattern_key)) =
                Self::find_package_map_target(
                    map,
                    specifier,
                    "request is not a valid match in pattern",
                )?
        {
            let ctx = PackageTargetResolveContext {
                package_dir,
                allow_bare_target: true,
                // Bare targets inside package imports are resolved with ESM package
                // fallback rules even when the surrounding caller is CJS export analysis.
                nested_bare_target_resolution_mode: NodePackageResolveMode::EsmImport,
                kind: "imports",
                conditions: resolution.conditions,
                pattern_substitution: pattern_substitution.as_deref(),
                warning_specifier: specifier,
                warning_pattern_key: pattern_key,
                warning_importer: importer,
            };
            return Self::resolve_package_target_with_context(target, ctx, resolution).and_then(
                |resolution| {
                    Self::target_resolution_to_import_result(
                        resolution,
                        specifier,
                        package_dir,
                        importer,
                    )
                },
            );
        }
        Err(NodePackageResolveError::PackageImportNotDefined {
            specifier: specifier.to_string(),
            package_json_path: Some(
                package_dir
                    .join("package.json")
                    .to_string_lossy()
                    .into_owned(),
            ),
            importer: importer.map(str::to_string),
            no_imports_field: false,
        })
    }

    fn is_conditions_object(value: &PackageTarget) -> bool {
        matches!(
            value,
            PackageTarget::Object(map) if !map.is_empty() && !map.iter().any(|(key, _)| key.starts_with('.'))
        )
    }

    fn validate_package_exports_map(
        pkg_path: &std::path::Path,
        exports: &PackageTarget,
    ) -> Result<(), NodePackageResolveError> {
        let PackageTarget::Object(map) = exports else {
            return Ok(());
        };
        let has_subpath_key = map.keys().any(|key| key.starts_with('.'));
        let has_condition_key = map.keys().any(|key| !key.starts_with('.'));
        if has_subpath_key && has_condition_key {
            return Err(NodePackageResolveError::InvalidPackageConfig {
                path: pkg_path.to_string_lossy().into_owned(),
                reason: Some(
                    "\"exports\" cannot contain some keys starting with '.' and some not. The exports object must either be an object of package subpath keys or an object of main entry condition name keys only."
                        .to_string(),
                ),
            });
        }
        Ok(())
    }

    fn decode_package_target_path(target: &str) -> String {
        percent_decode(target).unwrap_or_else(|| target.to_string())
    }

    fn resolve_package_target_with_context(
        target: &PackageTarget,
        ctx: PackageTargetResolveContext<'_>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<PackageTargetResolution, NodePackageResolveError> {
        Self::add_invalid_package_target_context(
            Self::resolve_package_target_value(target, &ctx, resolution),
            ctx.warning_specifier,
        )
    }

    fn resolve_package_target_value(
        target: &PackageTarget,
        ctx: &PackageTargetResolveContext<'_>,
        resolution: &mut NodePackageResolutionContext<'_, '_>,
    ) -> Result<PackageTargetResolution, NodePackageResolveError> {
        match target {
            PackageTarget::Null => Ok(PackageTargetResolution::Blocked),
            PackageTarget::Bool(false) => Err(NodePackageResolveError::InvalidPackageTarget {
                kind: ctx.kind,
                target: "false".to_string(),
            }),
            PackageTarget::Bool(true) => Err(NodePackageResolveError::InvalidPackageTarget {
                kind: ctx.kind,
                target: "true".to_string(),
            }),
            PackageTarget::Invalid(value) => Err(NodePackageResolveError::InvalidPackageTarget {
                kind: ctx.kind,
                target: value.to_string(),
            }),
            PackageTarget::String(target_str) => {
                let target_str = if let Some(pattern_substitution) = ctx.pattern_substitution {
                    target_str.replace('*', pattern_substitution)
                } else {
                    target_str.clone()
                };
                Self::push_package_deprecation_warning(resolution.warnings, ctx, &target_str);
                if ctx.allow_bare_target && Self::is_bare_package_specifier(&target_str) {
                    let base = ctx.package_dir.join("package.json");
                    let base_str = base.to_string_lossy();
                    let resolver = NodeModulesResolver;
                    if let Some(resolved) = resolution.with_mode(
                        ctx.nested_bare_target_resolution_mode,
                        |resolution| {
                            resolver.try_resolve_with_context(&base_str, &target_str, resolution)
                        },
                    )? {
                        return Ok(PackageTargetResolution::Resolved(resolved));
                    }
                    return Err(NodePackageResolveError::ModuleNotFound {
                        request: target_str,
                    });
                }
                if Self::has_encoded_slash_or_backslash(&target_str) {
                    return Err(NodePackageResolveError::InvalidPackagePatternMatch {
                        specifier: target_str,
                        message: "must not include encoded \"/\" or \"\\\" characters".to_string(),
                    });
                }
                if !target_str.starts_with("./") {
                    return Err(NodePackageResolveError::InvalidPackageTarget {
                        kind: ctx.kind,
                        target: target_str,
                    });
                }
                if !Self::is_valid_package_target_path(&target_str) {
                    return Err(NodePackageResolveError::InvalidPackageTarget {
                        kind: ctx.kind,
                        target: target_str,
                    });
                }
                let decoded_target = Self::decode_package_target_path(&target_str);
                let candidate = Self::resolve_package_target_path(ctx.package_dir, &decoded_target);
                if resolution.is_file(&candidate) {
                    return Ok(PackageTargetResolution::Resolved(
                        candidate.to_string_lossy().into_owned(),
                    ));
                }
                if resolution.is_dir(&candidate) {
                    if resolution.mode == NodePackageResolveMode::CjsAnalysis {
                        return Err(NodePackageResolveError::ModuleNotFound {
                            request: candidate.to_string_lossy().into_owned(),
                        });
                    }
                    return Err(NodePackageResolveError::UnsupportedDirectoryImport {
                        request: candidate.to_string_lossy().into_owned(),
                    });
                }
                Err(NodePackageResolveError::ModuleNotFound {
                    request: candidate.to_string_lossy().into_owned(),
                })
            }
            PackageTarget::Array(array) => {
                if array.is_empty() {
                    return Ok(PackageTargetResolution::Blocked);
                }
                let mut last_fallback_error = None;
                let mut last_fallback_was_blocked = false;
                for item in array {
                    match Self::resolve_package_target_value(item, ctx, resolution) {
                        Ok(PackageTargetResolution::Resolved(path)) => {
                            return Ok(PackageTargetResolution::Resolved(path));
                        }
                        Ok(PackageTargetResolution::Blocked) => {
                            last_fallback_error = None;
                            last_fallback_was_blocked = true;
                        }
                        Ok(PackageTargetResolution::NoMatch) => continue,
                        Err(err @ NodePackageResolveError::InvalidPackageTarget { .. }) => {
                            last_fallback_error = Some(err);
                            last_fallback_was_blocked = false;
                        }
                        Err(err) => return Err(err),
                    }
                }
                if let Some(err) = last_fallback_error {
                    return Err(err);
                }
                if last_fallback_was_blocked {
                    return Ok(PackageTargetResolution::Blocked);
                }
                Ok(PackageTargetResolution::NoMatch)
            }
            PackageTarget::Object(map) => {
                if map.keys().any(|key| Self::is_array_index(key)) {
                    return Err(NodePackageResolveError::InvalidPackageConfig {
                        path: ctx
                            .package_dir
                            .join("package.json")
                            .to_string_lossy()
                            .into_owned(),
                        reason: Some(
                            "\"exports\" cannot contain numeric property keys.".to_string(),
                        ),
                    });
                }
                for (condition, value) in map {
                    if condition == "default"
                        || ctx
                            .conditions
                            .iter()
                            .any(|candidate| candidate == condition)
                    {
                        match Self::resolve_package_target_value(value, ctx, resolution)? {
                            PackageTargetResolution::NoMatch => continue,
                            resolution => return Ok(resolution),
                        }
                    }
                }
                Ok(PackageTargetResolution::NoMatch)
            }
        }
    }

    fn package_pattern_key_match(pattern_key: &str, key: &str) -> Option<String> {
        let star = pattern_key.find('*')?;
        if pattern_key[star + 1..].contains('*') {
            return None;
        }
        let prefix = &pattern_key[..star];
        let suffix = &pattern_key[star + 1..];
        if !key.starts_with(prefix) || !key.ends_with(suffix) {
            return None;
        }
        if key.len() <= prefix.len() + suffix.len() {
            return None;
        }
        Some(key[prefix.len()..key.len() - suffix.len()].to_string())
    }

    fn has_encoded_slash_or_backslash(value: &str) -> bool {
        let lower = value.to_ascii_lowercase();
        lower.contains("%2f") || lower.contains("%5c")
    }

    fn is_invalid_package_pattern_substitution(substitution: &str) -> bool {
        if Self::has_encoded_slash_or_backslash(substitution) {
            return true;
        }
        substitution
            .split(['/', '\\'])
            .any(|segment| !segment.is_empty() && Self::is_invalid_package_target_segment(segment))
    }

    fn invalid_package_pattern_substitution_message(substitution: &str, fallback: &str) -> String {
        if Self::has_encoded_slash_or_backslash(substitution) {
            "must not include encoded \"/\" or \"\\\" characters".to_string()
        } else {
            fallback.to_string()
        }
    }

    fn add_invalid_package_target_context(
        result: Result<PackageTargetResolution, NodePackageResolveError>,
        specifier: &str,
    ) -> Result<PackageTargetResolution, NodePackageResolveError> {
        result.map_err(|err| match err {
            NodePackageResolveError::InvalidPackageTarget { kind, target } => {
                NodePackageResolveError::InvalidPackageTarget {
                    kind,
                    target: if target.contains(specifier) {
                        target
                    } else {
                        format!("{} for {}", target, specifier)
                    },
                }
            }
            other => other,
        })
    }

    fn find_best_package_pattern<'a>(
        map: &'a IndexMap<String, PackageTarget>,
        key: &str,
    ) -> Option<(&'a str, String)> {
        let mut best: Option<(&str, String)> = None;
        for pattern_key in map.keys() {
            if !pattern_key.contains('*') {
                continue;
            }
            let Some(substitution) = Self::package_pattern_key_match(pattern_key, key) else {
                continue;
            };
            if best.as_ref().is_none_or(|(best_key, _)| {
                Self::package_pattern_compare(pattern_key, best_key).is_lt()
            }) {
                best = Some((pattern_key.as_str(), substitution));
            }
        }
        best
    }

    fn find_package_map_target<'a>(
        map: &'a IndexMap<String, PackageTarget>,
        specifier: &str,
        invalid_pattern_message: &str,
    ) -> Result<Option<PackageMapTargetMatch<'a>>, NodePackageResolveError> {
        if let Some(target) = map.get(specifier) {
            return Ok(Some((target, None, None)));
        }

        let Some((pattern_key, pattern_substitution)) =
            Self::find_best_package_pattern(map, specifier)
        else {
            return Ok(None);
        };
        if Self::is_invalid_package_pattern_substitution(&pattern_substitution) {
            return Err(NodePackageResolveError::InvalidPackagePatternMatch {
                specifier: specifier.to_string(),
                message: Self::invalid_package_pattern_substitution_message(
                    &pattern_substitution,
                    invalid_pattern_message,
                ),
            });
        }
        Ok(map
            .get(pattern_key)
            .map(|target| (target, Some(pattern_substitution), Some(pattern_key))))
    }

    fn package_pattern_compare(a: &str, b: &str) -> std::cmp::Ordering {
        let a_star = a.find('*').unwrap_or(a.len());
        let b_star = b.find('*').unwrap_or(b.len());
        match b_star.cmp(&a_star) {
            std::cmp::Ordering::Equal => {}
            ordering => return ordering,
        }
        let a_trailer = a.len().saturating_sub(a_star + 1);
        let b_trailer = b.len().saturating_sub(b_star + 1);
        match b_trailer.cmp(&a_trailer) {
            std::cmp::Ordering::Equal => {}
            ordering => return ordering,
        }
        match b.len().cmp(&a.len()) {
            std::cmp::Ordering::Equal => std::cmp::Ordering::Equal,
            ordering => ordering,
        }
    }

    fn is_array_index(key: &str) -> bool {
        key.parse::<u32>()
            .is_ok_and(|index| index != u32::MAX && index.to_string() == key)
    }

    fn target_resolution_to_export_result(
        resolution: PackageTargetResolution,
        package_name: &str,
        subpath: &str,
        no_exports_main: bool,
    ) -> Result<String, NodePackageResolveError> {
        match resolution {
            PackageTargetResolution::Resolved(path) => Ok(path),
            PackageTargetResolution::NoMatch | PackageTargetResolution::Blocked => {
                Err(NodePackageResolveError::PackagePathNotExported {
                    package_name: package_name.to_string(),
                    subpath: subpath.to_string(),
                    no_exports_main,
                })
            }
        }
    }

    fn target_resolution_to_import_result(
        resolution: PackageTargetResolution,
        specifier: &str,
        package_dir: &std::path::Path,
        importer: Option<&str>,
    ) -> Result<String, NodePackageResolveError> {
        match resolution {
            PackageTargetResolution::Resolved(path) => Ok(path),
            PackageTargetResolution::NoMatch | PackageTargetResolution::Blocked => {
                Err(NodePackageResolveError::PackageImportNotDefined {
                    specifier: specifier.to_string(),
                    package_json_path: Some(
                        package_dir
                            .join("package.json")
                            .to_string_lossy()
                            .into_owned(),
                    ),
                    importer: importer.map(str::to_string),
                    no_imports_field: false,
                })
            }
        }
    }

    fn is_bare_package_specifier(target: &str) -> bool {
        !target.is_empty()
            && !target.starts_with('.')
            && !target.starts_with('/')
            && !target.starts_with('#')
            && !target.contains(':')
    }

    fn is_valid_package_target_path(target: &str) -> bool {
        target.strip_prefix("./").is_some_and(|rest| {
            rest.split(['/', '\\'])
                .all(|part| part.is_empty() || !Self::is_invalid_package_target_segment(part))
        })
    }

    fn resolve_package_target_path(
        package_dir: &std::path::Path,
        target: &str,
    ) -> std::path::PathBuf {
        let mut relative_parts = Vec::<&str>::new();
        if let Some(rest) = target.strip_prefix("./") {
            for part in rest.split(['/', '\\']) {
                if !part.is_empty() {
                    relative_parts.push(part);
                }
            }
        }
        let mut candidate = package_dir.to_path_buf();
        for part in relative_parts {
            candidate.push(part);
        }
        candidate
    }

    fn is_invalid_package_target_segment(segment: &str) -> bool {
        if matches!(segment, "." | ".." | "node_modules") {
            return true;
        }
        let decoded = percent_decode(segment).unwrap_or_else(|| segment.to_string());
        matches!(
            decoded.to_ascii_lowercase().as_str(),
            "." | ".." | "node_modules"
        )
    }

    fn has_deprecated_double_slash(value: &str) -> bool {
        value.contains("//")
    }

    fn has_deprecated_leading_or_trailing_slash(value: Option<&str>) -> bool {
        value.is_some_and(|value| value.starts_with('/') || value.ends_with('/'))
    }

    fn package_warning_location(
        package_dir: &std::path::Path,
        kind: &str,
        importer: Option<&str>,
    ) -> String {
        let package_json = package_dir.join("package.json");
        let mut location = format!(
            " in the \"{}\" field module resolution of the package at {}",
            kind,
            package_json.to_string_lossy()
        );
        if let Some(importer) = importer {
            location.push_str(" imported from ");
            location.push_str(importer);
        }
        location.push('.');
        location
    }

    fn push_package_deprecation_warning(
        warnings: &mut Vec<NodePackageWarning>,
        ctx: &PackageTargetResolveContext<'_>,
        target: &str,
    ) {
        if ctx.kind == "exports"
            && ctx
                .pattern_substitution
                .is_some_and(|substitution| substitution.ends_with('/'))
        {
            let location =
                Self::package_warning_location(ctx.package_dir, ctx.kind, ctx.warning_importer);
            warnings.push(NodePackageWarning {
                message: format!(
                    "Use of deprecated trailing slash pattern mapping {:?}{} Mapping specifiers ending in \"/\" is no longer supported.",
                    ctx.warning_specifier, location
                ),
                code: "DEP0155",
                dedupe_key: Some(format!(
                    "{}:{}",
                    ctx.package_dir.to_string_lossy(),
                    ctx.warning_specifier
                )),
            });
            return;
        }
        if Self::has_deprecated_double_slash(target) {
            let location =
                Self::package_warning_location(ctx.package_dir, ctx.kind, ctx.warning_importer);
            let matched_pattern = ctx
                .warning_pattern_key
                .map(|pattern_key| format!(" matched to {:?}", pattern_key))
                .unwrap_or_default();
            warnings.push(NodePackageWarning {
                message: format!(
                    "Use of deprecated double slash resolving {:?} for module request {:?}{}{}",
                    target, ctx.warning_specifier, matched_pattern, location
                ),
                code: "DEP0166",
                dedupe_key: None,
            });
        } else if Self::has_deprecated_leading_or_trailing_slash(ctx.pattern_substitution) {
            let location =
                Self::package_warning_location(ctx.package_dir, ctx.kind, ctx.warning_importer);
            let matched_pattern = ctx
                .warning_pattern_key
                .map(|pattern_key| format!(" matched to {:?}", pattern_key))
                .unwrap_or_default();
            warnings.push(NodePackageWarning {
                message: format!(
                    "Use of deprecated leading or trailing slash matching resolving {:?} for module request {:?}{}{}",
                    target, ctx.warning_specifier, matched_pattern, location
                ),
                code: "DEP0166",
                dedupe_key: None,
            });
        } else if Self::has_deprecated_double_slash(ctx.warning_specifier) {
            let location =
                Self::package_warning_location(ctx.package_dir, ctx.kind, ctx.warning_importer);
            let matched_pattern = ctx
                .warning_pattern_key
                .map(|pattern_key| format!(" matched to {:?}", pattern_key))
                .unwrap_or_default();
            warnings.push(NodePackageWarning {
                message: format!(
                    "Use of deprecated double slash resolving {:?} for module request {:?}{}{}",
                    target, ctx.warning_specifier, matched_pattern, location
                ),
                code: "DEP0166",
                dedupe_key: None,
            });
        }
    }

    fn conditions_from_global(ctx: &Ctx<'_>, mode: NodePackageConditionMode) -> Vec<String> {
        let mut conditions = mode
            .default_conditions()
            .iter()
            .map(|condition| (*condition).to_string())
            .collect();

        if let Ok(user_conditions) = ctx
            .globals()
            .get::<_, rquickjs::Array>("__wasm_rquickjs_package_conditions")
        {
            for i in 0..user_conditions.len() {
                if let Ok(condition) = user_conditions.get::<String>(i) {
                    Self::add_condition(&mut conditions, &condition);
                }
            }
        }

        conditions
    }

    fn add_condition(conditions: &mut Vec<String>, condition: &str) {
        if condition.is_empty() || conditions.iter().any(|existing| existing == condition) {
            return;
        }
        conditions.push(condition.to_string());
    }
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (
                FileUrlResolver::hex_val(bytes[i + 1]),
                FileUrlResolver::hex_val(bytes[i + 2]),
            )
        {
            decoded.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(decoded).ok()
}

fn emit_node_package_deprecation_warnings<'js>(
    ctx: &Ctx<'js>,
    warnings: &[NodePackageWarning],
) -> rquickjs::Result<()> {
    if warnings.is_empty() {
        return Ok(());
    }
    let process_object = match ctx.globals().get::<_, Object>("process") {
        Ok(process_object) => process_object,
        Err(_) => {
            let error_ctor: Function = ctx.globals().get("Error")?;
            let error_obj: Object =
                error_ctor.call(("Internal process object is not initialized",))?;
            return Err(ctx.throw(error_obj.into_value()));
        }
    };
    for warning in warnings {
        let key = warning
            .dedupe_key
            .as_deref()
            .unwrap_or(warning.message.as_str());
        let warning_key = if warning.code == "DEP0155" {
            Some(format!("{}:{}", warning.code, key))
        } else {
            None
        };
        let no_deprecation = process_object.get::<_, Coerced<bool>>("noDeprecation")?.0;
        if no_deprecation {
            continue;
        }
        if let Some(warning_key) = warning_key.as_deref()
            && node_package_deprecation_warning_seen(ctx, warning_key)
        {
            continue;
        }
        if let Some(warning_key) = warning_key.as_ref() {
            mark_node_package_deprecation_warning_seen(ctx, warning_key.clone());
        }
        let emit_warning: Function = process_object.get("emitWarning")?;
        let _: Value = emit_warning.call((
            This(process_object.clone()),
            warning.message.as_str(),
            "DeprecationWarning",
            warning.code,
        ))?;
    }
    Ok(())
}

fn throw_node_package_resolve_error<'js>(
    ctx: &Ctx<'js>,
    err: NodePackageResolveError,
) -> rquickjs::Result<String> {
    let err = match err {
        NodePackageResolveError::PackageImportNotDefined {
            specifier,
            package_json_path,
            importer,
            no_imports_field,
        } => {
            let mut message = format!("Package import specifier \"{}\" is not defined", specifier);
            if let Some(package_json_path) = package_json_path {
                message.push_str(" in package ");
                message.push_str(&package_json_path);
            }
            if let Some(importer) = importer {
                message.push_str(" imported from ");
                message.push_str(&importer);
            }
            let error_value = Exception::from_message(ctx.clone(), &message)?.into_value();
            let Some(error_obj) = error_value.clone().into_object() else {
                return Err(ctx.throw(error_value));
            };
            error_obj.prop(
                "code",
                Property::from("ERR_PACKAGE_IMPORT_NOT_DEFINED")
                    .writable()
                    .enumerable()
                    .configurable(),
            )?;
            if no_imports_field {
                error_obj.prop(
                    "__wasmNoImportsField",
                    Property::from(true).writable().configurable(),
                )?;
            }
            return Err(ctx.throw(error_obj.into_value()));
        }
        err => err,
    };

    let (code, message, type_error) = match err {
        NodePackageResolveError::InvalidModuleSpecifier { specifier, base } => (
            "ERR_INVALID_MODULE_SPECIFIER",
            format!(
                "Invalid module \"{}\" is not a valid package name imported from {}",
                specifier, base
            ),
            true,
        ),
        NodePackageResolveError::InvalidPackagePatternMatch { specifier, message } => (
            "ERR_INVALID_MODULE_SPECIFIER",
            format!("Invalid module \"{}\" {}", specifier, message),
            true,
        ),
        NodePackageResolveError::PackagePathNotExported {
            package_name,
            subpath,
            no_exports_main,
        } => {
            if no_exports_main {
                (
                    "ERR_PACKAGE_PATH_NOT_EXPORTED",
                    format!("No \"exports\" main defined in package {}", package_name),
                    false,
                )
            } else {
                let subpath = if subpath.is_empty() {
                    ".".to_string()
                } else {
                    format!("./{}", subpath)
                };
                (
                    "ERR_PACKAGE_PATH_NOT_EXPORTED",
                    format!(
                        "Package subpath '{}' is not defined by \"exports\" in package {}",
                        subpath, package_name
                    ),
                    false,
                )
            }
        }
        NodePackageResolveError::InvalidPackageTarget { kind, target } => {
            let mut message = format!("Invalid \"{}\" target '{}'", kind, target);
            if kind == "exports" && !target.starts_with("./") {
                message.push_str("; targets must start with \"./\"");
            }
            ("ERR_INVALID_PACKAGE_TARGET", message, false)
        }
        NodePackageResolveError::PackageImportNotDefined { .. } => {
            unreachable!("package import errors are handled before generic error mapping")
        }
        NodePackageResolveError::InvalidPackageConfig { path, reason } => (
            "ERR_INVALID_PACKAGE_CONFIG",
            match reason {
                Some(reason) => format!("Invalid package config {}. {}", path, reason),
                None => format!("Invalid package config {}.", path),
            },
            false,
        ),
        NodePackageResolveError::UnsupportedDirectoryImport { request } => (
            "ERR_UNSUPPORTED_DIR_IMPORT",
            format!(
                "Directory import '{}' is not supported resolving ES modules",
                request
            ),
            false,
        ),
        NodePackageResolveError::ModuleNotFound { request } => (
            "ERR_MODULE_NOT_FOUND",
            format!("Cannot find module '{}'", request),
            false,
        ),
    };

    throw_native_coded_error(ctx, &message, code, type_error)
}

fn try_resolve_package_with_global_conditions<'js>(
    ctx: &Ctx<'js>,
    resolver: &NodeModulesResolver,
    base: &str,
    specifier: &str,
    mode: NodePackageResolveMode,
) -> rquickjs::Result<Result<Option<String>, NodePackageResolveError>> {
    let conditions = NodeModulesResolver::conditions_from_global(ctx, mode.condition_mode());
    try_resolve_package_with_conditions(ctx, resolver, base, specifier, &conditions, mode, true)
}

fn try_resolve_package_with_conditions<'js>(
    ctx: &Ctx<'js>,
    resolver: &NodeModulesResolver,
    base: &str,
    specifier: &str,
    conditions: &[String],
    mode: NodePackageResolveMode,
    emit_warnings: bool,
) -> rquickjs::Result<Result<Option<String>, NodePackageResolveError>> {
    let mut warnings = Vec::new();
    let mut resolution = NodePackageResolutionContext::new(ctx, mode, conditions, &mut warnings);
    let result = resolver.try_resolve_with_context(base, specifier, &mut resolution);
    if emit_warnings {
        emit_node_package_deprecation_warnings(ctx, &warnings)?;
    }
    Ok(result)
}

fn esm_package_identity_path(ctx: &Ctx<'_>, resolved: &str) -> String {
    let preserve_symlinks = NodeFileResolver::has_exec_argv_flag(ctx, "--preserve-symlinks");
    NodeFileResolver::module_identity_path_for_existing_file(ctx, resolved, preserve_symlinks)
}

fn import_meta_resolve_package(
    ctx: Ctx<'_>,
    base_url: String,
    specifier: String,
) -> rquickjs::Result<Option<String>> {
    let base = if let Some(path) = FileUrlResolver::file_url_to_path(&base_url) {
        path
    } else {
        base_url.clone()
    };
    let base = FileUrlResolver::file_url_package_resolution_base(base);
    let resolver = NodeModulesResolver;
    if specifier.ends_with('/')
        && !specifier.starts_with('#')
        && let Some((package_name, subpath)) = NodeModulesResolver::split_package_name(&specifier)
        && subpath.is_empty()
    {
        if let Err(err) =
            NodeModulesResolver::validate_package_name(&base, &specifier, package_name)
        {
            return throw_node_package_resolve_error(&ctx, err).map(Some);
        }
        let trailing_slash_package_has_exports =
            match import_meta_trailing_slash_package_has_exports(&ctx, &base, package_name) {
                Ok(value) => value,
                Err(err) => return throw_node_package_resolve_error(&ctx, err).map(Some),
            };
        if trailing_slash_package_has_exports {
            return throw_node_package_resolve_error(
                &ctx,
                NodePackageResolveError::PackagePathNotExported {
                    package_name: package_name.to_string(),
                    subpath: "/".to_string(),
                    no_exports_main: false,
                },
            )
            .map(Some);
        }
    }
    let result = try_resolve_package_with_global_conditions(
        &ctx,
        &resolver,
        &base,
        &specifier,
        NodePackageResolveMode::EsmImport,
    )?;
    match result {
        Ok(Some(resolved)) => {
            let resolved = esm_package_identity_path(&ctx, &resolved);
            Ok(Some(path_to_file_url(&resolved)))
        }
        Ok(None) => Ok(None),
        Err(err) => throw_node_package_resolve_error(&ctx, err).map(Some),
    }
}

fn import_meta_resolve_path(base_url: String, specifier: String) -> Option<String> {
    if !(specifier.starts_with('.') || specifier.starts_with('/')) {
        return None;
    }
    if !base_url.starts_with("file://") {
        return None;
    }

    let (specifier_path, suffix) = split_module_path_suffix(&specifier);
    let resolved = if specifier_path.starts_with('/') {
        std::path::PathBuf::from(specifier_path)
    } else {
        let (base_path, _) = FileUrlResolver::file_url_to_path_parts(&base_url)?;
        let base_dir = FileUrlResolver::file_url_resolution_base_path(&base_path)?;
        base_dir.join(specifier_path)
    };

    let mut normalized = CjsEvalResolver::normalize_path(&resolved);
    if specifier_path.ends_with('/') && !normalized.ends_with('/') {
        normalized.push('/');
    }

    let mut url = path_with_preserved_escapes_to_file_url(&normalized);
    url.push_str(suffix);
    Some(url)
}

fn package_resolve_mode_from_loader_mode<'js>(
    ctx: &Ctx<'js>,
    mode: &str,
) -> rquickjs::Result<NodePackageResolveMode> {
    let Some(mode) = NodePackageResolveMode::from_js_mode(mode) else {
        return throw_native_coded_error(
            ctx,
            "Unknown internal package resolution mode",
            "ERR_INVALID_ARG_VALUE",
            false,
        );
    };
    Ok(mode)
}

fn package_conditions_from_js_array<'js>(conditions: &rquickjs::Array<'js>) -> Vec<String> {
    let mut condition_vec = Vec::new();
    for i in 0..conditions.len() {
        if let Ok(condition) = conditions.get::<String>(i) {
            NodeModulesResolver::add_condition(&mut condition_vec, &condition);
        }
    }
    condition_vec
}

fn package_extensions_from_js_array<'js>(extensions: &rquickjs::Array<'js>) -> Vec<String> {
    let mut extension_vec = Vec::new();
    for i in 0..extensions.len() {
        if let Ok(extension) = extensions.get::<String>(i) {
            extension_vec.push(extension);
        }
    }
    extension_vec
}

fn cjs_analysis_resolution_context<'a, 'w>(
    ctx: &Ctx<'_>,
    conditions: &'a [String],
    warnings: &'w mut Vec<NodePackageWarning>,
) -> NodePackageResolutionContext<'a, 'w> {
    NodePackageResolutionContext::new(
        ctx,
        NodePackageResolveMode::CjsAnalysis,
        conditions,
        warnings,
    )
}

fn esm_import_resolution_context<'a, 'w>(
    ctx: &Ctx<'_>,
    conditions: &'a [String],
    warnings: &'w mut Vec<NodePackageWarning>,
) -> NodePackageResolutionContext<'a, 'w> {
    NodePackageResolutionContext::new(ctx, NodePackageResolveMode::EsmImport, conditions, warnings)
}

fn loader_package_result_format(
    resolved: &str,
    mode: NodePackageResolveMode,
) -> Option<&'static str> {
    match std::path::Path::new(resolved)
        .extension()
        .and_then(|ext| ext.to_str())
    {
        Some("json") => Some("json"),
        Some("mjs") if mode == NodePackageResolveMode::EsmImport => Some("module"),
        Some("cjs") | Some("mjs") => Some("commonjs"),
        _ if mode == NodePackageResolveMode::CjsAnalysis => Some("commonjs"),
        _ => None,
    }
}

fn package_resolved_url_object<'js>(
    ctx: &Ctx<'js>,
    resolved: &str,
) -> rquickjs::Result<Object<'js>> {
    let result = Object::new(ctx.clone())?;
    result.set("url", path_to_file_url(resolved))?;
    Ok(result)
}

fn loader_package_resolved_object<'js>(
    ctx: &Ctx<'js>,
    resolved: &str,
    mode: NodePackageResolveMode,
) -> rquickjs::Result<Object<'js>> {
    let result = package_resolved_url_object(ctx, resolved)?;
    if let Some(format) = loader_package_result_format(resolved, mode) {
        result.set("format", format)?;
    }
    Ok(result)
}

fn try_resolve_package_with_js_conditions<'js>(
    ctx: &Ctx<'js>,
    base: &str,
    specifier: &str,
    conditions: &rquickjs::Array<'js>,
    mode: NodePackageResolveMode,
    emit_warnings: bool,
) -> rquickjs::Result<Result<Option<String>, NodePackageResolveError>> {
    let condition_vec = package_conditions_from_js_array(conditions);
    let resolver = NodeModulesResolver;
    try_resolve_package_with_conditions(
        ctx,
        &resolver,
        base,
        specifier,
        &condition_vec,
        mode,
        emit_warnings,
    )
}

fn loader_default_resolve_package<'js>(
    ctx: Ctx<'js>,
    base_url: String,
    specifier: String,
    conditions: rquickjs::Array<'js>,
    mode: String,
) -> rquickjs::Result<Option<Object<'js>>> {
    let mode = package_resolve_mode_from_loader_mode(&ctx, &mode)?;
    let Some((base, _)) = FileUrlResolver::file_url_to_path_parts(&base_url) else {
        return Ok(None);
    };
    let result =
        try_resolve_package_with_js_conditions(&ctx, &base, &specifier, &conditions, mode, true)?;
    match result {
        Ok(Some(resolved)) => {
            let resolved = if mode == NodePackageResolveMode::EsmImport {
                esm_package_identity_path(&ctx, &resolved)
            } else {
                resolved
            };
            loader_package_resolved_object(&ctx, &resolved, mode).map(Some)
        }
        Ok(None) => Ok(None),
        Err(err) => {
            let _: String = throw_node_package_resolve_error(&ctx, err)?;
            unreachable!()
        }
    }
}

fn cjs_resolve_package_exports<'js>(
    ctx: Ctx<'js>,
    package_dir: String,
    package_name: String,
    subpath: String,
    conditions: rquickjs::Array<'js>,
) -> rquickjs::Result<Option<Object<'js>>> {
    let condition_vec = package_conditions_from_js_array(&conditions);
    let mut warnings = Vec::new();
    let mut resolution = cjs_analysis_resolution_context(&ctx, &condition_vec, &mut warnings);
    let package_dir = std::path::PathBuf::from(package_dir);
    let pkg_path = package_dir.join("package.json");
    let package = match NodeModulesResolver::read_package_json_optional_with_context(
        &pkg_path,
        &resolution,
    ) {
        Ok(Some(package)) => package,
        Ok(None) => return Ok(None),
        Err(err) => {
            let _: String = throw_node_package_resolve_error(&ctx, err)?;
            unreachable!()
        }
    };
    let Some(exports) = package
        .exports
        .as_ref()
        .filter(|exports| NodeModulesResolver::is_active_package_exports(exports))
    else {
        return Ok(None);
    };
    if let Err(err) = NodeModulesResolver::validate_package_exports_map(&pkg_path, exports) {
        let _: String = throw_node_package_resolve_error(&ctx, err)?;
        unreachable!()
    }

    let result = NodeModulesResolver::resolve_package_exports(
        &package_name,
        &package_dir,
        exports,
        &subpath,
        &mut resolution,
        None,
    );
    emit_node_package_deprecation_warnings(&ctx, &warnings)?;
    match result {
        Ok(resolved) => package_resolved_url_object(&ctx, &resolved).map(Some),
        Err(err) => {
            let _: String = throw_node_package_resolve_error(&ctx, err)?;
            unreachable!()
        }
    }
}

fn cjs_resolve_package_self_reference<'js>(
    ctx: Ctx<'js>,
    parent_dir: String,
    package_name: String,
    subpath: String,
    conditions: rquickjs::Array<'js>,
) -> rquickjs::Result<Option<Object<'js>>> {
    let condition_vec = package_conditions_from_js_array(&conditions);
    let mut warnings = Vec::new();
    let mut resolution = cjs_analysis_resolution_context(&ctx, &condition_vec, &mut warnings);
    let result = NodeModulesResolver::try_resolve_package_self(
        &std::path::PathBuf::from(parent_dir),
        None,
        &package_name,
        &subpath,
        &mut resolution,
    );
    emit_node_package_deprecation_warnings(&ctx, &warnings)?;
    match result {
        Ok(Some((resolved, package_dir))) => {
            let result = package_resolved_url_object(&ctx, &resolved)?;
            result.set("packageDir", package_dir)?;
            Ok(Some(result))
        }
        Ok(None) => Ok(None),
        Err(err) => {
            let _: String = throw_node_package_resolve_error(&ctx, err)?;
            unreachable!()
        }
    }
}

fn throw_invalid_package_config_while_importing<'js, T>(
    ctx: &Ctx<'js>,
    path: String,
    id: &str,
    from_part: &str,
    reason: Option<String>,
) -> rquickjs::Result<T> {
    let mut message = format!(
        "Invalid package config {} while importing \"{}\" from {}.",
        path, id, from_part
    );
    if let Some(reason) = reason
        && !reason.is_empty()
    {
        message.push(' ');
        message.push_str(&reason);
    }
    throw_native_coded_error(ctx, &message, "ERR_INVALID_PACKAGE_CONFIG", false)
}

fn throw_esm_package_resolve_error<'js>(
    ctx: &Ctx<'js>,
    err: NodePackageResolveError,
    specifier: &str,
    base: &str,
) -> rquickjs::Result<String> {
    match err {
        NodePackageResolveError::InvalidPackageConfig { path, reason } => {
            throw_invalid_package_config_while_importing(ctx, path, specifier, base, reason)
        }
        err => throw_node_package_resolve_error(ctx, err),
    }
}

fn cjs_resolve_package_fallback<'js>(
    ctx: Ctx<'js>,
    package_dir: String,
    subpath: String,
    extensions: rquickjs::Array<'js>,
    id: String,
    from_part: String,
) -> rquickjs::Result<Option<Object<'js>>> {
    let extension_vec = package_extensions_from_js_array(&extensions);
    let mut warnings = Vec::new();
    let mut resolution = cjs_analysis_resolution_context(&ctx, &[], &mut warnings);
    let result = NodeModulesResolver::resolve_runtime_cjs_package_fallback(
        &std::path::PathBuf::from(package_dir),
        &subpath,
        &extension_vec,
        &mut resolution,
    );
    match result {
        Ok(Some((filename, package_dir))) => {
            let result = Object::new(ctx.clone())?;
            result.set("filename", filename)?;
            result.set("packageDir", package_dir)?;
            Ok(Some(result))
        }
        Ok(None) => Ok(None),
        Err(NodePackageResolveError::InvalidPackageConfig { path, reason }) => {
            throw_invalid_package_config_while_importing(&ctx, path, &id, &from_part, reason)
        }
        Err(err) => {
            let _: String = throw_node_package_resolve_error(&ctx, err)?;
            unreachable!()
        }
    }
}

fn cjs_resolve_file_candidate<'js>(
    ctx: Ctx<'js>,
    candidate: String,
    extensions: rquickjs::Array<'js>,
    include_exact: bool,
) -> rquickjs::Result<Option<String>> {
    let extension_vec = package_extensions_from_js_array(&extensions);
    let mut warnings = Vec::new();
    let mut resolution = cjs_analysis_resolution_context(&ctx, &[], &mut warnings);
    Ok(NodeModulesResolver::first_existing_runtime_cjs_probe(
        &std::path::PathBuf::from(candidate),
        &extension_vec,
        include_exact,
        false,
        &mut resolution,
    ))
}

fn require_esm_graph_resolve_package<'js>(
    _ctx: Ctx<'js>,
    parent_filename: String,
    specifier: String,
    conditions: rquickjs::Array<'js>,
    mode: String,
) -> rquickjs::Result<Option<String>> {
    let mode = package_resolve_mode_from_loader_mode(&_ctx, &mode)?;
    Ok(try_resolve_package_with_js_conditions(
        &_ctx,
        &parent_filename,
        &specifier,
        &conditions,
        mode,
        false,
    )?
    .ok()
    .flatten())
}

fn import_meta_trailing_slash_package_has_exports(
    ctx: &Ctx<'_>,
    base: &str,
    package_name: &str,
) -> Result<bool, NodePackageResolveError> {
    let mut warnings = Vec::new();
    let mut resolution = NodePackageResolutionContext::new(
        ctx,
        NodePackageResolveMode::EsmImport,
        &[],
        &mut warnings,
    );
    let Some(base_dir) = std::path::Path::new(base).parent() else {
        return Ok(false);
    };

    let mut dir = base_dir.to_path_buf();
    loop {
        if dir.file_name().is_some_and(|name| name == "node_modules") {
            return Ok(false);
        }

        let pkg_path = dir.join("package.json");
        if let Some(package) =
            NodeModulesResolver::read_package_json_optional_with_context(&pkg_path, &resolution)?
        {
            if package.name.as_deref() == Some(package_name) {
                return Ok(package.exports.as_ref().is_some_and(|exports| {
                    NodeModulesResolver::is_active_package_exports(exports)
                }));
            }
            break;
        }

        if !dir.pop() {
            break;
        }
    }

    let mut dir = base_dir.to_path_buf();
    loop {
        let package_path = dir.join("node_modules").join(package_name);
        if resolution.is_dir(&package_path) {
            let pkg_path = package_path.join("package.json");
            return NodeModulesResolver::read_package_json_optional_with_context(
                &pkg_path,
                &resolution,
            )
            .map(|package| {
                package.is_some_and(|package| {
                    package.exports.as_ref().is_some_and(|exports| {
                        NodeModulesResolver::is_active_package_exports(exports)
                    })
                })
            });
        }

        if !dir.pop() {
            break;
        }
    }

    Ok(false)
}

impl Resolver for NodeModulesResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        #[cfg(feature = "typescript-compiler-profiling")]
        let profile = ctx
            .userdata::<crate::internal::runtime_services::RuntimeServices>()
            .expect("runtime services not initialized")
            .execution_profile();
        #[cfg(feature = "typescript-compiler-profiling")]
        if let Some(profile) = &profile {
            profile.increment("modules.resolve.calls");
            profile.increment(if name.starts_with('#') {
                "modules.resolve.specifier.packageImport"
            } else if name.starts_with('.') {
                "modules.resolve.specifier.relative"
            } else if name.starts_with('/') {
                "modules.resolve.specifier.absolute"
            } else if name.contains("://") {
                "modules.resolve.specifier.url"
            } else {
                "modules.resolve.specifier.package"
            });
        }
        let (resolution_name, suffix) = if has_import_type_rewrite_token(name) {
            split_module_path_suffix(name)
        } else {
            (name, "")
        };
        let package_like = resolution_name.starts_with('#')
            || !(resolution_name.starts_with('.')
                || resolution_name.starts_with('/')
                || resolution_name.contains("://"));
        let result = try_resolve_package_with_global_conditions(
            ctx,
            self,
            base,
            resolution_name,
            NodePackageResolveMode::EsmImport,
        )?;
        match result {
            Ok(Some(resolved)) => {
                #[cfg(feature = "typescript-compiler-profiling")]
                if let Some(profile) = &profile {
                    profile.increment("modules.resolve.success");
                }
                let suffix = append_loader_realm_param(suffix, loader_realm_param(base).as_deref());
                let resolved = esm_package_identity_path(ctx, &resolved);
                let resolved = if suffix.is_empty() {
                    resolved
                } else {
                    format!("{resolved}{suffix}")
                };
                transfer_import_type_rewrite_token(name, &resolved);
                Ok(resolved)
            }
            Ok(None) => {
                #[cfg(feature = "typescript-compiler-profiling")]
                if let Some(profile) = &profile {
                    profile.increment("modules.resolve.missing");
                }
                if package_like {
                    discard_import_type_rewrite_token(name);
                }
                Err(Error::new_resolving(base, name))
            }
            Err(err) => {
                #[cfg(feature = "typescript-compiler-profiling")]
                if let Some(profile) = &profile {
                    profile.increment("modules.resolve.errors");
                }
                discard_import_type_rewrite_token(name);
                if package_like {
                    throw_esm_package_resolve_error(ctx, err, resolution_name, base)
                } else {
                    throw_node_package_resolve_error(ctx, err)
                }
            }
        }
    }
}

/// Loader that wraps CommonJS sources in ESM-compatible wrappers when loaded via `import()`.
/// This enables ESM modules to import CJS packages from `node_modules`.
struct CjsCompatLoader;

#[cfg(feature = "typescript-runtime")]
fn is_typescript_module_path(path: &str) -> bool {
    matches!(
        std::path::Path::new(module_filesystem_path(path))
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("ts" | "mts" | "cts")
    )
}

#[cfg(feature = "typescript-runtime")]
struct CachedCjsTypeScriptAnalysis {
    prepared_source: Option<String>,
    export_names: Option<Vec<String>>,
}

#[cfg(feature = "typescript-runtime")]
fn cached_cjs_typescript_analysis_for_filename(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
) -> rquickjs::Result<Option<CachedCjsTypeScriptAnalysis>> {
    let get_analysis: Function = ctx
        .globals()
        .get("__wasm_rquickjs_get_cached_cjs_typescript_analysis")?;
    let Some(value) = get_analysis.call::<_, Option<Object>>((filename, source))? else {
        return Ok(None);
    };
    Ok(Some(CachedCjsTypeScriptAnalysis {
        prepared_source: value.get("preparedSource")?,
        export_names: value.get("exportNames")?,
    }))
}

#[cfg(feature = "typescript-runtime")]
fn cache_cjs_typescript_export_names_for_filename(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
    names: &[String],
) -> rquickjs::Result<()> {
    let value = rquickjs::Array::new(ctx.clone())?;
    for (index, name) in names.iter().enumerate() {
        value.set(index, name.clone())?;
    }
    let set_names: Function = ctx
        .globals()
        .get("__wasm_rquickjs_set_cached_cjs_typescript_export_names")?;
    set_names.call((filename, value, source))
}

#[cfg(feature = "typescript-runtime")]
fn transform_typescript_module_source<'js>(
    ctx: &Ctx<'js>,
    fs_path: &str,
    source: String,
) -> rquickjs::Result<String> {
    #[cfg(feature = "typescript-compiler-profiling")]
    let (profile, started) = (
        ctx.userdata::<crate::internal::runtime_services::RuntimeServices>()
            .expect("runtime services not initialized")
            .execution_profile(),
        std::time::Instant::now(),
    );
    let source_map = crate::internal::typescript::source_maps_enabled(ctx);
    match crate::internal::typescript::transform_module(
        source,
        fs_path,
        source_map,
        match std::path::Path::new(fs_path)
            .extension()
            .and_then(|extension| extension.to_str())
        {
            Some("mts") => Some(true),
            Some("cts") => Some(false),
            _ => None,
        },
    ) {
        Ok(output) => {
            record_typescript_module_transform(ctx)?;
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &profile {
                profile.increment("modules.typescriptTransform.success");
                profile.add(
                    "modules.typescriptTransform.micros",
                    started.elapsed().as_micros().min(u64::MAX as u128) as u64,
                );
            }
            Ok(output.into_code_with_inline_source_map())
        }
        Err(error) => {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &profile {
                profile.increment("modules.typescriptTransform.errors");
                profile.add(
                    "modules.typescriptTransform.micros",
                    started.elapsed().as_micros().min(u64::MAX as u128) as u64,
                );
            }
            let constructor_name = match error.kind {
                crate::internal::typescript::TypeScriptErrorKind::Error => "Error",
                crate::internal::typescript::TypeScriptErrorKind::SyntaxError => "SyntaxError",
            };
            let constructor: rquickjs::Function<'_> = ctx.globals().get(constructor_name)?;
            let object: rquickjs::Object<'_> = constructor.call((error.message,))?;
            object.set("code", error.code)?;
            Err(ctx.throw(object.into_value()))
        }
    }
}

#[cfg(feature = "typescript-runtime")]
fn record_typescript_module_transform(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    #[cfg(feature = "test-observability")]
    {
        let record: Function = ctx
            .globals()
            .get("__wasm_rquickjs_record_typescript_module_transform")?;
        record.call::<_, ()>(())?;
    }
    #[cfg(not(feature = "test-observability"))]
    let _ = ctx;
    Ok(())
}

fn record_commonjs_export_analysis(ctx: &Ctx<'_>) {
    #[cfg(feature = "test-observability")]
    if let Ok(record) = ctx
        .globals()
        .get::<_, Function>("__wasm_rquickjs_record_commonjs_export_analysis")
    {
        let _ = record.call::<_, ()>(());
    }
    #[cfg(not(feature = "test-observability"))]
    let _ = ctx;
}

#[derive(Default)]
struct CjsExportAnalysis {
    exports: Vec<String>,
    reexports: Vec<String>,
    is_cjs: bool,
}

fn add_unique(items: &mut Vec<String>, item: String) {
    if !items.iter().any(|existing| existing == &item) {
        items.push(item);
    }
}

fn is_ident_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic() || byte >= 0x80
}

fn is_ident_continue(byte: u8) -> bool {
    is_ident_start(byte) || byte.is_ascii_digit()
}

fn is_ident_boundary(source: &[u8], pos: usize) -> bool {
    pos >= source.len() || !is_ident_continue(source[pos])
}

fn is_ident_start_boundary(source: &[u8], pos: usize) -> bool {
    pos == 0 || !is_ident_continue(source[pos - 1])
}

fn is_free_ident_start(source: &[u8], pos: usize) -> bool {
    is_ident_start_boundary(source, pos) && (pos == 0 || !matches!(source[pos - 1], b'.' | b'#'))
}

fn skip_ws_comments(source: &str, pos: usize) -> usize {
    skip_ws_comments_impl::<false>(source, pos).0
}

fn skip_ws_comments_with_line_terminator(source: &str, pos: usize) -> (usize, bool) {
    skip_ws_comments_impl::<true>(source, pos)
}

fn skip_ws_comments_impl<const TRACK_LINE_TERMINATOR: bool>(
    source: &str,
    mut pos: usize,
) -> (usize, bool) {
    let bytes = source.as_bytes();
    let mut has_line_terminator = false;
    loop {
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            if TRACK_LINE_TERMINATOR && matches!(bytes[pos], b'\n' | b'\r') {
                has_line_terminator = true;
            }
            pos += 1;
        }
        if pos + 1 < bytes.len() && bytes[pos] == b'/' && bytes[pos + 1] == b'/' {
            pos += 2;
            while pos < bytes.len() && !matches!(bytes[pos], b'\n' | b'\r') {
                pos += 1;
            }
            continue;
        }
        if pos + 1 < bytes.len() && bytes[pos] == b'/' && bytes[pos + 1] == b'*' {
            pos += 2;
            while pos + 1 < bytes.len() && !(bytes[pos] == b'*' && bytes[pos + 1] == b'/') {
                if TRACK_LINE_TERMINATOR && matches!(bytes[pos], b'\n' | b'\r') {
                    has_line_terminator = true;
                }
                pos += 1;
            }
            pos = (pos + 2).min(bytes.len());
            continue;
        }
        return (pos, has_line_terminator);
    }
}

fn read_ident_span(source: &str, mut pos: usize) -> Option<(usize, usize)> {
    let bytes = source.as_bytes();
    if pos >= bytes.len() || !is_ident_start(bytes[pos]) {
        return None;
    }
    let start = pos;
    pos += 1;
    while pos < bytes.len() && is_ident_continue(bytes[pos]) {
        pos += 1;
    }
    Some((start, pos))
}

fn read_ident(source: &str, pos: usize) -> Option<(String, usize)> {
    let (start, end) = read_ident_span(source, pos)?;
    Some((source[start..end].to_string(), end))
}

fn parse_ident_name(source: &str, pos: usize, name: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    if !is_ident_start_boundary(bytes, pos)
        || !source[pos..].starts_with(name)
        || !is_ident_boundary(bytes, pos + name.len())
    {
        return None;
    }
    Some(pos + name.len())
}

fn parse_free_ident_name(source: &str, pos: usize, name: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    if !is_free_ident_start(bytes, pos) {
        return None;
    }
    parse_ident_name(source, pos, name)
}

fn read_js_string(source: &str, pos: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    if pos >= bytes.len() || !matches!(bytes[pos], b'\'' | b'"') {
        return None;
    }
    let quote = bytes[pos];
    let mut units = Vec::<u16>::new();
    let mut i = pos + 1;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == quote {
            return String::from_utf16(&units).ok().map(|s| (s, i + 1));
        }
        if byte == b'\\' {
            i += 1;
            if i >= bytes.len() {
                return None;
            }
            match bytes[i] {
                b'n' => units.push(b'\n' as u16),
                b'r' => units.push(b'\r' as u16),
                b't' => units.push(b'\t' as u16),
                b'b' => units.push(8),
                b'f' => units.push(12),
                b'v' => units.push(11),
                b'x' if i + 2 < bytes.len()
                    && bytes[i + 1].is_ascii_hexdigit()
                    && bytes[i + 2].is_ascii_hexdigit() =>
                {
                    let value = hex_byte(bytes[i + 1])? * 16 + hex_byte(bytes[i + 2])?;
                    units.push(value as u16);
                    i += 2;
                }
                b'x' => return None,
                b'u' if i + 1 < bytes.len() && bytes[i + 1] == b'{' => {
                    let start = i + 2;
                    let end = source[start..].find('}')? + start;
                    let code = u32::from_str_radix(&source[start..end], 16).ok()?;
                    if code <= 0xFFFF {
                        units.push(code as u16);
                    } else {
                        let code = code - 0x1_0000;
                        units.push(0xD800 | ((code >> 10) as u16));
                        units.push(0xDC00 | ((code & 0x3FF) as u16));
                    }
                    i = end;
                }
                b'u' if i + 4 < bytes.len()
                    && bytes[i + 1].is_ascii_hexdigit()
                    && bytes[i + 2].is_ascii_hexdigit()
                    && bytes[i + 3].is_ascii_hexdigit()
                    && bytes[i + 4].is_ascii_hexdigit() =>
                {
                    let value = u16::from(hex_byte(bytes[i + 1])?) << 12
                        | u16::from(hex_byte(bytes[i + 2])?) << 8
                        | u16::from(hex_byte(bytes[i + 3])?) << 4
                        | u16::from(hex_byte(bytes[i + 4])?);
                    units.push(value);
                    i += 4;
                }
                b'u' => return None,
                other => units.push(other as u16),
            }
            i += 1;
            continue;
        }
        if byte == b'\n' || byte == b'\r' {
            return None;
        }
        let ch = source[i..].chars().next()?;
        let mut buf = [0u16; 2];
        units.extend_from_slice(ch.encode_utf16(&mut buf));
        i += ch.len_utf8();
    }
    None
}

fn hex_byte(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn skip_string_or_template(source: &str, pos: usize) -> usize {
    let bytes = source.as_bytes();
    if pos >= bytes.len() {
        return pos;
    }
    let quote = bytes[pos];
    let mut i = pos + 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
        } else if quote == b'`' && bytes[i] == b'$' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            i = skip_template_expression(source, i + 2);
        } else if bytes[i] == quote {
            return i + 1;
        } else {
            i += 1;
        }
    }
    i
}

fn skip_template_expression(source: &str, start: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = start;
    let mut depth = 1usize;
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'\'' | b'"' | b'`' => i = skip_string_or_template(source, i),
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'/' if is_regex_literal_start(source, i) => i = skip_regex_literal(source, i),
            b'{' | b'(' | b'[' => {
                depth += 1;
                i += 1;
            }
            b'}' | b')' | b']' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            _ => i += 1,
        }
    }
    i
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CjsExportTarget {
    Exports,
    ModuleExports,
}

fn parse_exports_target(source: &str, pos: usize) -> Option<(CjsExportTarget, usize)> {
    let bytes = source.as_bytes();
    if let Some(exports_end) = parse_free_ident_name(source, pos, "exports") {
        return Some((CjsExportTarget::Exports, exports_end));
    }
    if let Some(module_end) = parse_free_ident_name(source, pos, "module") {
        let mut i = skip_ws_comments(source, module_end);
        if i < bytes.len() && bytes[i] == b'.' {
            i = skip_ws_comments(source, i + 1);
            if let Some(exports_end) = parse_ident_name(source, i, "exports") {
                return Some((CjsExportTarget::ModuleExports, exports_end));
            }
        }
    }
    None
}

fn parse_export_member(source: &str, pos: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let (_, mut i) = parse_exports_target(source, pos)?;
    i = skip_ws_comments(source, i);
    let name;
    if i < bytes.len() && bytes[i] == b'.' {
        i = skip_ws_comments(source, i + 1);
        let (ident, next) = read_ident(source, i)?;
        name = ident;
        i = next;
    } else if i < bytes.len() && bytes[i] == b'[' {
        i = skip_ws_comments(source, i + 1);
        let (string_name, next) = read_js_string(source, i)?;
        i = skip_ws_comments(source, next);
        if i >= bytes.len() || bytes[i] != b']' {
            return None;
        }
        name = string_name;
        i += 1;
    } else {
        return None;
    }
    i = skip_ws_comments(source, i);
    parse_assignment_operator(source, i).map(|next| (name, next))
}

fn parse_require_string(source: &str, pos: usize) -> Option<(String, usize)> {
    parse_require_call_string(source, pos, true)
}

fn parse_require_string_loose(source: &str, pos: usize) -> Option<(String, usize)> {
    parse_require_call_string(source, pos, false)
}

fn parse_require_call_string(
    source: &str,
    pos: usize,
    require_free_start: bool,
) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let require_end = if require_free_start {
        parse_free_ident_name(source, pos, "require")?
    } else {
        parse_ident_name(source, pos, "require")?
    };
    let mut i = skip_ws_comments(source, require_end);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (specifier, next) = read_js_string(source, i)?;
    i = skip_ws_comments(source, next);
    if i < bytes.len() && bytes[i] == b')' {
        Some((specifier, i + 1))
    } else {
        None
    }
}

fn parse_object_define_property_call(source: &str, pos: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_free_ident_name(source, pos, "Object")?);
    if i >= bytes.len() || bytes[i] != b'.' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    i = skip_ws_comments(source, parse_ident_name(source, i, "defineProperty")?);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    Some(skip_ws_comments(source, i + 1))
}

fn parse_define_property_export(source: &str, pos: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let mut i = parse_object_define_property_call(source, pos)?;
    let (_, next) = parse_exports_target(source, i)?;
    i = next;
    i = skip_ws_comments(source, i);
    if i >= bytes.len() || bytes[i] != b',' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (name, next) = read_js_string(source, i)?;
    i = skip_ws_comments(source, next);
    if i >= bytes.len() || bytes[i] != b',' {
        return None;
    }
    let descriptor_start = i + 1;
    let end = find_matching_paren(source, pos)?;
    let descriptor = &source[descriptor_start..end];
    if descriptor_has_named_property(descriptor) {
        Some((name, end + 1))
    } else {
        None
    }
}

enum DescriptorNamedProperty {
    Value,
    Getter,
}

fn descriptor_function_getter_body(
    source: &str,
    pos: usize,
    descriptor_end: usize,
) -> Option<(usize, usize, usize)> {
    let bytes = source.as_bytes();
    let mut next = skip_ws_comments(source, parse_ident_name(source, pos, "function")?);
    if let Some((_, ident_end)) = read_ident(source, next) {
        next = skip_ws_comments(source, ident_end);
    }
    if next >= descriptor_end || bytes[next] != b'(' {
        return None;
    }
    let body = getter_body_after_empty_params(source, next, descriptor_end)?;
    Some((body.0, body.1, body.1 + 1))
}

fn descriptor_function_getter_end(
    source: &str,
    pos: usize,
    descriptor_end: usize,
) -> Option<usize> {
    let body = descriptor_function_getter_body(source, pos, descriptor_end)?;
    if !is_simple_getter_body(&source[body.0..body.1]) {
        return None;
    }
    Some(body.2)
}

fn getter_body_after_empty_params(
    source: &str,
    params_open: usize,
    limit: usize,
) -> Option<(usize, usize)> {
    let params_end = find_matching_paren(source, params_open)?;
    if params_end > limit || skip_ws_comments(source, params_open + 1) != params_end {
        return None;
    }
    let body_open = skip_ws_comments(source, params_end + 1);
    if body_open >= limit || source.as_bytes()[body_open] != b'{' {
        return None;
    }
    let body_end = find_matching_brace(source, body_open)?;
    if body_end > limit {
        return None;
    }
    Some((body_open + 1, body_end))
}

fn descriptor_object_span(descriptor: &str) -> Option<(usize, usize)> {
    let bytes = descriptor.as_bytes();
    let descriptor_start = skip_ws_comments(descriptor, 0);
    if descriptor_start >= bytes.len() || bytes[descriptor_start] != b'{' {
        return None;
    }
    let descriptor_end = find_matching_brace(descriptor, descriptor_start)?;
    Some((
        skip_ws_comments(descriptor, descriptor_start + 1),
        descriptor_end,
    ))
}

fn next_object_literal_entry(source: &str, cursor: usize, object_end: usize) -> Option<usize> {
    if cursor >= object_end {
        return Some(object_end);
    }
    if source.as_bytes()[cursor] != b',' {
        return None;
    }
    Some(skip_ws_comments(source, cursor + 1))
}

fn is_spread_token_at(source: &str, pos: usize) -> bool {
    let bytes = source.as_bytes();
    bytes.get(pos).copied() == Some(b'.')
        && bytes.get(pos + 1).copied() == Some(b'.')
        && bytes.get(pos + 2).copied() == Some(b'.')
}

fn descriptor_has_named_property(descriptor: &str) -> bool {
    let bytes = descriptor.as_bytes();
    let Some((mut cursor, descriptor_end)) = descriptor_object_span(descriptor) else {
        return false;
    };
    let mut found: Option<DescriptorNamedProperty> = None;
    while cursor < descriptor_end {
        if bytes[cursor] == b',' {
            cursor = skip_ws_comments(descriptor, cursor + 1);
            continue;
        }
        if is_spread_token_at(descriptor, cursor) {
            return false;
        }
        if bytes[cursor] == b'[' {
            if matches!(found, Some(DescriptorNamedProperty::Value)) {
                cursor = skip_ws_comments(
                    descriptor,
                    skip_object_literal_value(descriptor, cursor, descriptor_end),
                );
                let Some(next_cursor) =
                    next_object_literal_entry(descriptor, cursor, descriptor_end)
                else {
                    return false;
                };
                cursor = next_cursor;
                continue;
            }
            return false;
        }

        let Some((name, key_is_ident, key_end)) = parse_exports_literal_key(descriptor, cursor)
        else {
            return false;
        };
        let next = skip_ws_comments(descriptor, key_end);
        if !key_is_ident {
            if !matches!(found, Some(DescriptorNamedProperty::Value)) {
                return false;
            }
            cursor = skip_ws_comments(
                descriptor,
                skip_object_literal_value(descriptor, next, descriptor_end),
            );
        } else if name == "value" {
            if matches!(found, Some(DescriptorNamedProperty::Getter)) {
                return false;
            }
            if matches!(found, Some(DescriptorNamedProperty::Value)) {
                let value_start = if next < descriptor_end && bytes[next] == b':' {
                    next + 1
                } else {
                    next
                };
                cursor = skip_ws_comments(
                    descriptor,
                    skip_object_literal_value(descriptor, value_start, descriptor_end),
                );
            } else {
                if next >= descriptor_end || bytes[next] != b':' {
                    return false;
                }
                found = Some(DescriptorNamedProperty::Value);
                cursor = skip_ws_comments(
                    descriptor,
                    skip_object_literal_value(descriptor, next + 1, descriptor_end),
                );
            }
        } else if name == "get" {
            if found.is_some() {
                return false;
            }
            if next < descriptor_end && bytes[next] == b'(' {
                let Some((body_start, body_end)) =
                    getter_body_after_empty_params(descriptor, next, descriptor_end)
                else {
                    return false;
                };
                if !is_simple_getter_body(&descriptor[body_start..body_end]) {
                    return false;
                }
                found = Some(DescriptorNamedProperty::Getter);
                cursor = skip_ws_comments(descriptor, body_end + 1);
            } else if next < descriptor_end && bytes[next] == b':' {
                let function_end = descriptor_function_getter_end(
                    descriptor,
                    skip_ws_comments(descriptor, next + 1),
                    descriptor_end,
                );
                let Some(function_end) = function_end else {
                    return false;
                };
                found = Some(DescriptorNamedProperty::Getter);
                cursor = skip_ws_comments(descriptor, function_end);
            } else {
                return false;
            }
        } else if name == "enumerable" {
            if next >= descriptor_end || bytes[next] != b':' {
                return false;
            }
            if matches!(found, Some(DescriptorNamedProperty::Value)) {
                cursor = skip_ws_comments(
                    descriptor,
                    skip_object_literal_value(descriptor, next + 1, descriptor_end),
                );
                let Some(next_cursor) =
                    next_object_literal_entry(descriptor, cursor, descriptor_end)
                else {
                    return false;
                };
                cursor = next_cursor;
                continue;
            }
            if matches!(found, Some(DescriptorNamedProperty::Getter)) {
                return false;
            }
            let value_start = skip_ws_comments(descriptor, next + 1);
            let Some(true_end) = parse_ident_name(descriptor, value_start, "true") else {
                return false;
            };
            cursor = skip_ws_comments(descriptor, true_end);
        } else {
            if matches!(found, Some(DescriptorNamedProperty::Value)) {
                cursor = skip_ws_comments(
                    descriptor,
                    skip_object_literal_value(descriptor, next, descriptor_end),
                );
            } else {
                return false;
            }
        }

        let Some(next_cursor) = next_object_literal_entry(descriptor, cursor, descriptor_end)
        else {
            return false;
        };
        cursor = next_cursor;
    }

    found.is_some()
}

fn find_matching_paren(source: &str, start: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = source[start..].find('(')? + start;
    let mut depth = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => i = skip_string_or_template(source, i),
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

fn find_matching_brace(source: &str, start: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = start;
    let mut depth = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' => i = skip_string_or_template(source, i),
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
            }
            b'{' => {
                depth += 1;
                i += 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

enum GetterReturnMember<'a> {
    Bare,
    Dot,
    BracketString,
    BracketIdentifier { receiver: &'a str, member: &'a str },
}

fn parse_getter_return_member_body(body: &str) -> Option<GetterReturnMember<'_>> {
    let bytes = body.as_bytes();
    let mut i = skip_ws_comments(body, 0);
    let return_end = parse_free_ident_name(body, i, "return")?;
    i = skip_ws_comments(body, return_end);
    let (receiver_start, next) = read_ident_span(body, i)?;
    let receiver = &body[receiver_start..next];
    i = skip_ws_comments(body, next);
    let member = if i < body.len() && bytes[i] == b'.' {
        i = skip_ws_comments(body, i + 1);
        let (_, next) = read_ident_span(body, i)?;
        i = next;
        GetterReturnMember::Dot
    } else if i < body.len() && bytes[i] == b'[' {
        i = skip_ws_comments(body, i + 1);
        let quote = bytes.get(i).copied();
        let member = if matches!(quote, Some(b'\'') | Some(b'"')) {
            let (_, next) = read_js_string(body, i)?;
            i = skip_ws_comments(body, next);
            GetterReturnMember::BracketString
        } else {
            let (member_start, next) = read_ident_span(body, i)?;
            let member = &body[member_start..next];
            i = skip_ws_comments(body, next);
            GetterReturnMember::BracketIdentifier { receiver, member }
        };
        if i >= body.len() || bytes[i] != b']' {
            return None;
        }
        i += 1;
        member
    } else {
        GetterReturnMember::Bare
    };
    i = skip_ws_comments(body, i);
    if i < body.len() && bytes[i] == b';' {
        i = skip_ws_comments(body, i + 1);
    }
    if i >= body.len() { Some(member) } else { None }
}

fn is_simple_getter_body(body: &str) -> bool {
    matches!(
        parse_getter_return_member_body(body),
        Some(
            GetterReturnMember::Bare | GetterReturnMember::Dot | GetterReturnMember::BracketString
        )
    )
}

fn parse_exports_assign_require_value(source: &str, pos: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    if let Some((specifier, next)) = parse_require_string(source, pos) {
        return Some((specifier, next));
    }

    let mut i = skip_ws_comments(
        source,
        parse_free_ident_name(source, pos, "_interopRequireWildcard")?,
    );
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (specifier, next) = parse_require_string(source, i)?;
    i = skip_ws_comments(source, next);
    if i >= bytes.len() || bytes[i] != b')' {
        return None;
    }

    Some((specifier, i + 1))
}

fn parse_require_binding(source: &str, pos: usize) -> Option<(String, String, usize)> {
    let mut i = skip_ws_comments(source, parse_variable_declaration_keyword(source, pos)?);
    let (name, next) = read_ident(source, i)?;
    i = skip_ws_comments(source, next);
    if i >= source.len() || source.as_bytes()[i] != b'=' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (specifier, next) = parse_exports_assign_require_value(source, i)?;
    if !is_statement_boundary(source, next) {
        return None;
    }
    Some((name, specifier, next))
}

fn is_statement_boundary(source: &str, pos: usize) -> bool {
    let (next, has_line_terminator) = skip_ws_comments_with_line_terminator(source, pos);
    if next >= source.len() {
        return true;
    }
    if matches!(source.as_bytes()[next], b';' | b'}') {
        return true;
    }
    has_line_terminator && !is_asi_continuation_next(source, next)
}

fn is_asi_continuation_previous(byte: u8) -> bool {
    is_asi_continuation_operator(byte) || matches!(byte, b'!' | b'~')
}

fn is_asi_continuation_next(source: &str, pos: usize) -> bool {
    let bytes = source.as_bytes();
    if pos + 1 < bytes.len() {
        let current = bytes[pos];
        let next = bytes[pos + 1];
        if (current == b'+' && next == b'+') || (current == b'-' && next == b'-') {
            return false;
        }
    }
    is_asi_continuation_operator(bytes[pos])
}

fn is_asi_continuation_operator(byte: u8) -> bool {
    matches!(
        byte,
        b'(' | b'['
            | b'.'
            | b','
            | b':'
            | b'?'
            | b'+'
            | b'-'
            | b'*'
            | b'/'
            | b'%'
            | b'&'
            | b'|'
            | b'^'
            | b'<'
            | b'>'
            | b'='
    )
}

fn parse_module_exports_reexport(source: &str, pos: usize) -> Option<(String, usize)> {
    let (target, mut i) = parse_exports_target(source, pos)?;
    if target != CjsExportTarget::ModuleExports {
        return None;
    }
    i = skip_ws_comments(source, i);
    if i >= source.len() || source.as_bytes()[i] != b'=' {
        return None;
    }
    let (specifier, next) = parse_require_string(source, skip_ws_comments(source, i + 1))?;
    let after_require = skip_ws_comments(source, next);
    Some((specifier, after_require.min(source.len())))
}

fn parse_export_star_reexport(source: &str, pos: usize) -> Option<(String, usize)> {
    fn parse_export_star_callee(source: &str, pos: usize) -> Option<usize> {
        let bytes = source.as_bytes();
        let member_access = previous_significant_byte(source, pos) == Some(b'.');
        if !member_access {
            if let Some(export_star_end) = parse_free_ident_name(source, pos, "__exportStar") {
                return Some(export_star_end);
            }
            if let Some(export_end) = parse_free_ident_name(source, pos, "__export") {
                return Some(export_end);
            }
        }
        if is_free_ident_start(bytes, pos) {
            let (_, mut i) = read_ident_span(source, pos)?;
            loop {
                i = skip_ws_comments(source, i);
                if i >= bytes.len() || bytes[i] != b'.' {
                    return None;
                }
                i = skip_ws_comments(source, i + 1);
                let (member_start, member_end) = read_ident_span(source, i)?;
                let member = &source[member_start..member_end];
                if member == "__exportStar" || member == "__export" {
                    return Some(member_end);
                }
                i = member_end;
            }
        }
        None
    }

    let bytes = source.as_bytes();
    let mut i = parse_export_star_callee(source, pos)?;
    i = skip_ws_comments(source, i);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }

    i = skip_ws_comments(source, i + 1);
    let (specifier, next) = parse_require_string(source, i)?;
    i = skip_ws_comments(source, next);

    if i < bytes.len() && bytes[i] == b',' {
        i = skip_ws_comments(source, i + 1);
        let (_, next_target) = parse_exports_target(source, i)?;
        i = skip_ws_comments(source, next_target);
    }

    if i >= bytes.len() || bytes[i] != b')' {
        return None;
    }

    let after_call = skip_ws_comments(source, i + 1);
    if is_statement_boundary(source, after_call) {
        Some((specifier, after_call.min(source.len())))
    } else {
        None
    }
}

fn parse_module_exports_assignment(source: &str, pos: usize) -> Option<usize> {
    let (target, mut i) = parse_exports_target(source, pos)?;
    if target != CjsExportTarget::ModuleExports {
        return None;
    }
    i = skip_ws_comments(source, i);
    parse_assignment_operator(source, i)
}

fn parse_exports_literal_key(source: &str, pos: usize) -> Option<(String, bool, usize)> {
    if let Some((ident, next)) = read_ident(source, pos) {
        return Some((ident, true, next));
    }
    let (name, next) = read_js_string(source, pos)?;
    Some((name, false, next))
}

fn skip_object_literal_value(source: &str, pos: usize, object_end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = pos;
    let mut brace_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    while i < object_end {
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'/' if i + 1 < object_end && bytes[i + 1] == b'/' => {
                i += 2;
                while i < object_end && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < object_end && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < object_end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(object_end);
                continue;
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i).min(object_end);
                continue;
            }
            b'{' => brace_depth += 1,
            b'}' => brace_depth = brace_depth.saturating_sub(1),
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            b',' if brace_depth == 0 && paren_depth == 0 && bracket_depth == 0 => return i,
            _ => {}
        }
        i = next_char_boundary(source, i);
    }
    object_end
}

enum ObjectLiteralValueExport {
    NamedContinue,
    NamedStop,
}

fn named_export_object_literal_value(
    source: &str,
    pos: usize,
    object_end: usize,
) -> Option<ObjectLiteralValueExport> {
    let (ident, mut next) = read_ident(source, pos)?;
    next = skip_ws_comments(source, next);
    if next >= object_end
        || source.as_bytes()[next] == b','
        || matches!(ident.as_str(), "true" | "false" | "null" | "undefined")
    {
        Some(ObjectLiteralValueExport::NamedContinue)
    } else {
        Some(ObjectLiteralValueExport::NamedStop)
    }
}

fn parse_module_exports_object_literal(
    source: &str,
    pos: usize,
) -> Option<(Vec<String>, Vec<String>, usize)> {
    let bytes = source.as_bytes();
    let (target, mut i) = parse_exports_target(source, pos)?;
    if target != CjsExportTarget::ModuleExports {
        return None;
    }

    i = skip_ws_comments(source, i);
    i = skip_ws_comments(source, parse_assignment_operator(source, i)?);
    if i >= bytes.len() || bytes[i] != b'{' {
        return None;
    }
    let object_end = find_matching_brace(source, i)?;

    let mut exports = Vec::new();
    let mut reexports = Vec::new();
    let mut cursor = skip_ws_comments(source, i + 1);

    while cursor < object_end {
        if bytes[cursor] == b',' {
            cursor = skip_ws_comments(source, cursor + 1);
            continue;
        }

        if is_spread_token_at(source, cursor) {
            let spread_start = skip_ws_comments(source, cursor + 3);
            if let Some((specifier, next)) = parse_require_string_loose(source, spread_start) {
                add_unique(&mut reexports, specifier);
                cursor = skip_ws_comments(source, next);
                if cursor < object_end && bytes[cursor] != b',' {
                    break;
                }
            } else if let Some((_, next)) = read_ident(source, spread_start) {
                let after_ident = skip_ws_comments(source, next);
                if after_ident < object_end && bytes[after_ident] != b',' {
                    break;
                }
                cursor = after_ident;
            } else {
                break;
            };
            cursor = next_object_literal_entry(source, cursor, object_end)?;
            continue;
        }

        let Some((name, key_is_ident, key_end)) = parse_exports_literal_key(source, cursor) else {
            break;
        };
        let mut next = skip_ws_comments(source, key_end);
        if next < object_end && bytes[next] == b':' {
            next = skip_ws_comments(source, next + 1);
            if parse_require_string_loose(source, next).is_some() {
                add_unique(&mut exports, name);
                break;
            }
            match named_export_object_literal_value(source, next, object_end) {
                Some(ObjectLiteralValueExport::NamedContinue) => {
                    add_unique(&mut exports, name);
                    cursor = skip_ws_comments(
                        source,
                        skip_object_literal_value(source, next, object_end),
                    );
                }
                Some(ObjectLiteralValueExport::NamedStop) => {
                    add_unique(&mut exports, name);
                    break;
                }
                None => break,
            }
        } else if key_is_ident {
            add_unique(&mut exports, name);
            cursor = next;
            if cursor < object_end && bytes[cursor] != b',' {
                break;
            }
        } else {
            break;
        }

        cursor = next_object_literal_entry(source, cursor, object_end)?;
    }

    let after_object = skip_ws_comments(source, object_end + 1);
    if is_statement_boundary(source, after_object) {
        Some((exports, reexports, after_object.min(source.len())))
    } else {
        None
    }
}

fn parse_object_keys_reexport(
    source: &str,
    pos: usize,
    bindings: &HashMap<String, String>,
) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, parse_free_ident_name(source, pos, "Object")?);
    if i >= bytes.len() || bytes[i] != b'.' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    i = skip_ws_comments(source, parse_ident_name(source, i, "keys")?);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (binding, next) = read_ident(source, i)?;
    let specifier = bindings.get(&binding)?.clone();
    i = skip_ws_comments(source, next);
    if i >= bytes.len() || bytes[i] != b')' {
        return None;
    }
    let after_keys = skip_ws_comments(source, i + 1);
    if after_keys >= bytes.len() || bytes[after_keys] != b'.' {
        return None;
    }
    i = skip_ws_comments(source, after_keys + 1);
    i = skip_ws_comments(source, parse_ident_name(source, i, "forEach")?);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let end = find_matching_paren(source, i)?;
    let (callback_key, callback_body) = extract_for_each_callback_body(source, i, end)?;
    if callback_has_transpiler_reexport(callback_body, &binding, &callback_key) {
        Some((specifier, end + 1))
    } else {
        None
    }
}

fn extract_for_each_callback_body(
    source: &str,
    call_open: usize,
    end: usize,
) -> Option<(String, &str)> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, call_open + 1);
    i = skip_ws_comments(source, parse_free_ident_name(source, i, "function")?);
    if i < end && is_ident_start(bytes[i]) {
        let (_, next) = read_ident(source, i)?;
        i = skip_ws_comments(source, next);
    }
    if i >= end || bytes[i] != b'(' {
        return None;
    }
    let params_end = find_matching_paren(source, i)?;
    if params_end > end {
        return None;
    }
    let mut param_pos = skip_ws_comments(source, i + 1);
    let (key, next) = read_ident(source, param_pos)?;
    param_pos = skip_ws_comments(source, next);
    if param_pos != params_end || bytes[param_pos] != b')' {
        return None;
    }
    i = skip_ws_comments(source, params_end + 1);
    if i >= end || bytes[i] != b'{' {
        return None;
    }
    let body_end = find_matching_brace(source, i)?;
    if body_end > end || skip_ws_comments(source, body_end + 1) != end {
        return None;
    }
    Some((key, &source[i + 1..body_end]))
}

fn callback_has_transpiler_reexport(callback: &str, binding: &str, key: &str) -> bool {
    let mut found = false;
    let statement_starts = statement_starts(callback);
    let _ = scan_code_positions_with_brace_depth(callback, true, |i, _, brace_depth| {
        if brace_depth != 0 {
            return ControlFlow::Continue(None);
        }
        if !statement_starts.get(i).copied().unwrap_or(false) {
            return ControlFlow::Continue(None);
        }
        if parse_export_star_conditional_reexport(callback, i, binding, key).is_some() {
            found = true;
            return ControlFlow::Break(());
        }
        if let Some(next) = parse_export_star_return_guard(callback, i, key) {
            let mut write_pos = skip_statement_separator(callback, next);
            while let Some(next_guard) =
                parse_duplicate_export_return_guard(callback, write_pos, binding, key)
            {
                write_pos = skip_statement_separator(callback, next_guard);
            }
            if statement_starts.get(write_pos).copied().unwrap_or(false)
                && (parse_define_property_reexport(callback, write_pos, binding, key).is_some()
                    || parse_direct_exports_reexport_assignment(callback, write_pos, binding, key)
                        .is_some())
            {
                found = true;
                return ControlFlow::Break(());
            }
            return ControlFlow::Continue(Some(next));
        }
        ControlFlow::Continue(None)
    });
    found
}

fn skip_statement_separator(source: &str, pos: usize) -> usize {
    let mut i = skip_ws_comments(source, pos);
    if i < source.len() && source.as_bytes()[i] == b';' {
        i = skip_ws_comments(source, i + 1);
    }
    i
}

fn parse_if_condition(source: &str, pos: usize) -> Option<(&str, usize)> {
    let bytes = source.as_bytes();
    let i = skip_ws_comments(source, parse_free_ident_name(source, pos, "if")?);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let condition_end = find_matching_paren(source, i)?;
    Some((
        &source[i + 1..condition_end],
        skip_ws_comments(source, condition_end + 1),
    ))
}

fn parse_export_star_conditional_reexport(
    source: &str,
    pos: usize,
    binding: &str,
    key: &str,
) -> Option<usize> {
    parse_if_guarded_body(
        source,
        pos,
        |condition| is_export_star_has_own_guard_condition(condition, key),
        |source, body_start| {
            parse_direct_exports_reexport_assignment(source, body_start, binding, key)
        },
    )
}

fn parse_export_star_return_guard(source: &str, pos: usize, key: &str) -> Option<usize> {
    parse_if_return_guard(source, pos, |condition| {
        is_export_star_guard_condition(condition, key)
    })
}

fn parse_duplicate_export_return_guard(
    source: &str,
    pos: usize,
    binding: &str,
    key: &str,
) -> Option<usize> {
    parse_if_return_guard(source, pos, |condition| {
        is_duplicate_export_guard_condition(condition, binding, key)
    })
}

fn parse_if_return_guard(
    source: &str,
    pos: usize,
    condition_matches: impl FnOnce(&str) -> bool,
) -> Option<usize> {
    parse_if_guarded_body(source, pos, condition_matches, |source, body_start| {
        parse_free_ident_name(source, body_start, "return")
    })
}

fn parse_if_guarded_body(
    source: &str,
    pos: usize,
    condition_matches: impl FnOnce(&str) -> bool,
    body_parser: impl FnOnce(&str, usize) -> Option<usize>,
) -> Option<usize> {
    let (condition, i) = parse_if_condition(source, pos)?;
    if !condition_matches(condition) {
        return None;
    }
    body_parser(source, i)
}

fn is_duplicate_export_guard_condition(condition: &str, binding: &str, key: &str) -> bool {
    let i = skip_ws_comments(condition, 0);
    if let Some(next) = parse_exports_has_own_key(condition, i, key)
        && skip_ws_comments(condition, next) >= condition.len()
    {
        return true;
    }

    let Some(next) = parse_key_in_export_target_condition(condition, i, key) else {
        return false;
    };
    let Some(next) = parse_operator(condition, skip_ws_comments(condition, next), "&&") else {
        return false;
    };
    let mut i = skip_ws_comments(condition, next);
    let Some(next) = parse_export_target_bracket_key(condition, i, key) else {
        return false;
    };
    i = skip_ws_comments(condition, next);
    let Some(next) = parse_operator(condition, i, "===") else {
        return false;
    };
    i = skip_ws_comments(condition, next);
    let Some(next) = parse_binding_bracket_key(condition, i, binding, key) else {
        return false;
    };
    skip_ws_comments(condition, next) >= condition.len()
}

fn is_export_star_guard_condition(condition: &str, key: &str) -> bool {
    let mut i = skip_ws_comments(condition, 0);
    let (first, next) = match parse_key_equals_string(condition, i, key) {
        Some(result) => result,
        None => return false,
    };
    if first != "default" {
        return false;
    }
    let Some(next) = parse_operator(condition, skip_ws_comments(condition, next), "||") else {
        return false;
    };
    i = skip_ws_comments(condition, next);
    let (second, next) = match parse_key_equals_string(condition, i, key) {
        Some(result) => result,
        None => return false,
    };
    if second != "__esModule" {
        return false;
    }
    skip_ws_comments(condition, next) >= condition.len()
}

fn is_export_star_has_own_guard_condition(condition: &str, key: &str) -> bool {
    let mut i = skip_ws_comments(condition, 0);
    let (first, next) = match parse_key_not_equals_string(condition, i, key) {
        Some(result) => result,
        None => return false,
    };
    if first != "default" {
        return false;
    }
    let Some(next) = parse_operator(condition, skip_ws_comments(condition, next), "&&") else {
        return false;
    };
    i = skip_ws_comments(condition, next);
    let Some(next) = parse_negated_exports_has_own_key(condition, i, key) else {
        return false;
    };
    skip_ws_comments(condition, next) >= condition.len()
}

fn parse_key_equals_string(source: &str, pos: usize, key: &str) -> Option<(String, usize)> {
    parse_key_string_comparison(source, pos, key, "===")
}

fn parse_key_not_equals_string(source: &str, pos: usize, key: &str) -> Option<(String, usize)> {
    parse_key_string_comparison(source, pos, key, "!==")
}

fn parse_key_string_comparison(
    source: &str,
    pos: usize,
    key: &str,
    operator: &str,
) -> Option<(String, usize)> {
    let mut i = skip_ws_comments(source, parse_free_ident_name(source, pos, key)?);
    i = skip_ws_comments(source, parse_operator(source, i, operator)?);
    let (value, next) = read_js_string(source, i)?;
    Some((value, next))
}

fn parse_operator(source: &str, pos: usize, operator: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    let operator_bytes = operator.as_bytes();
    for (offset, expected) in operator_bytes.iter().enumerate() {
        if bytes.get(pos + offset).copied() != Some(*expected) {
            return None;
        }
    }
    Some(pos + operator_bytes.len())
}

fn parse_assignment_operator(source: &str, pos: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    if bytes.get(pos).copied() != Some(b'=')
        || matches!(bytes.get(pos + 1).copied(), Some(b'=' | b'>'))
    {
        return None;
    }
    Some(pos + 1)
}

fn parse_exports_has_own_key(source: &str, pos: usize, key: &str) -> Option<usize> {
    let (target, next) = parse_object_has_own_property_call(source, pos, key, true)?;
    if target != "exports" {
        return None;
    }
    Some(next)
}

fn parse_negated_exports_has_own_key(source: &str, pos: usize, key: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    if pos >= bytes.len() || bytes[pos] != b'!' {
        return None;
    }
    let mut i = skip_ws_comments(source, pos + 1);

    let (receiver, next) = read_ident(source, i)?;
    if receiver == "Object"
        && let Some((_, next)) = parse_object_has_own_property_call(source, i, key, false)
    {
        return Some(next);
    }

    {
        i = parse_dot_member_name(source, next, "hasOwnProperty")?;
        if i >= bytes.len() || bytes[i] != b'(' {
            return None;
        }
        i = skip_ws_comments(source, i + 1);
        i = skip_ws_comments(source, parse_free_ident_name(source, i, key)?);
        if i >= bytes.len() || bytes[i] != b')' {
            return None;
        }
        Some(i + 1)
    }
}

fn parse_object_has_own_property_call(
    source: &str,
    pos: usize,
    key: &str,
    require_prototype: bool,
) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    let (receiver, next) = read_ident(source, pos)?;
    if receiver != "Object" {
        return None;
    }
    let mut i = next;
    if let Some(next) = parse_dot_member_name(source, i, "prototype") {
        i = next;
    } else if require_prototype {
        return None;
    }
    i = parse_dot_member_name(source, i, "hasOwnProperty")?;
    i = parse_dot_member_name(source, i, "call")?;
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let (target, next) = read_ident(source, i)?;
    i = skip_ws_comments(source, next);
    if i >= bytes.len() || bytes[i] != b',' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    i = skip_ws_comments(source, parse_free_ident_name(source, i, key)?);
    if i >= bytes.len() || bytes[i] != b')' {
        return None;
    }
    Some((target, i + 1))
}

fn parse_key_in_export_target_condition(source: &str, pos: usize, key: &str) -> Option<usize> {
    let mut i = skip_ws_comments(source, parse_free_ident_name(source, pos, key)?);
    i = skip_ws_comments(source, parse_free_ident_name(source, i, "in")?);
    let (_, next) = parse_exports_target(source, i)?;
    Some(next)
}

fn parse_export_target_bracket_key(source: &str, pos: usize, key: &str) -> Option<usize> {
    let (_, next) = parse_exports_target(source, pos)?;
    parse_bracket_key(source, next, key)
}

fn parse_binding_bracket_key(source: &str, pos: usize, binding: &str, key: &str) -> Option<usize> {
    parse_bracket_key(source, parse_free_ident_name(source, pos, binding)?, key)
}

fn parse_bracket_key(source: &str, pos: usize, key: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, pos);
    if i >= bytes.len() || bytes[i] != b'[' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    i = skip_ws_comments(source, parse_free_ident_name(source, i, key)?);
    if i >= bytes.len() || bytes[i] != b']' {
        return None;
    }
    Some(i + 1)
}

fn parse_dot_member_name(source: &str, pos: usize, name: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = skip_ws_comments(source, pos);
    if i >= bytes.len() || bytes[i] != b'.' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    Some(skip_ws_comments(source, parse_ident_name(source, i, name)?))
}

fn parse_direct_exports_reexport_assignment(
    source: &str,
    pos: usize,
    binding: &str,
    key: &str,
) -> Option<usize> {
    let mut i = skip_ws_comments(source, parse_export_target_bracket_key(source, pos, key)?);
    i = skip_ws_comments(source, parse_assignment_operator(source, i)?);
    let after_rhs = skip_ws_comments(source, parse_binding_bracket_key(source, i, binding, key)?);
    if is_statement_boundary(source, after_rhs) {
        Some(after_rhs.min(source.len()))
    } else {
        None
    }
}

fn parse_define_property_reexport(
    source: &str,
    pos: usize,
    binding: &str,
    key: &str,
) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut i = parse_object_define_property_call(source, pos)?;
    let (target, next) = parse_exports_target(source, i)?;
    if target != CjsExportTarget::Exports {
        return None;
    }
    i = skip_ws_comments(source, next);
    if i >= bytes.len() || bytes[i] != b',' {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    let key_end = parse_free_ident_name(source, i, key)?;
    i = skip_ws_comments(source, key_end);
    if i >= bytes.len() || bytes[i] != b',' {
        return None;
    }
    let descriptor_start = i + 1;
    let end = find_matching_paren(source, pos)?;
    let descriptor = &source[descriptor_start..end];
    if descriptor_getter_returns_binding_key(descriptor, binding, key) {
        Some(end + 1)
    } else {
        None
    }
}

fn descriptor_getter_returns_binding_key(descriptor: &str, binding: &str, key: &str) -> bool {
    let bytes = descriptor.as_bytes();
    let Some((mut cursor, descriptor_end)) = descriptor_object_span(descriptor) else {
        return false;
    };
    let mut seen_enumerable = false;
    let mut found = false;
    while cursor < descriptor_end {
        if bytes[cursor] == b',' {
            cursor = skip_ws_comments(descriptor, cursor + 1);
            continue;
        }
        if is_spread_token_at(descriptor, cursor) || bytes[cursor] == b'[' {
            return false;
        }
        let Some((name, key_is_ident, key_end)) = parse_exports_literal_key(descriptor, cursor)
        else {
            return false;
        };
        if !key_is_ident {
            return false;
        }
        let mut next = skip_ws_comments(descriptor, key_end);
        if name == "enumerable" {
            if seen_enumerable || found || next >= descriptor_end || bytes[next] != b':' {
                return false;
            }
            let value_start = skip_ws_comments(descriptor, next + 1);
            let Some(true_end) = parse_ident_name(descriptor, value_start, "true") else {
                return false;
            };
            seen_enumerable = true;
            cursor = skip_ws_comments(descriptor, true_end);
        } else if name == "get" {
            if found {
                return false;
            }
            if next < descriptor_end && bytes[next] == b'(' {
                let Some((body_start, body_end)) =
                    getter_body_after_empty_params(descriptor, next, descriptor_end)
                else {
                    return false;
                };
                if !getter_body_returns_binding_key(&descriptor[body_start..body_end], binding, key)
                {
                    return false;
                }
                found = true;
                cursor = skip_ws_comments(descriptor, body_end + 1);
            } else if next < descriptor_end && bytes[next] == b':' {
                next = skip_ws_comments(descriptor, next + 1);
                let Some((body_start, body_end, function_end)) =
                    descriptor_function_getter_body(descriptor, next, descriptor_end)
                else {
                    return false;
                };
                if !getter_body_returns_binding_key(&descriptor[body_start..body_end], binding, key)
                {
                    return false;
                }
                found = true;
                cursor = skip_ws_comments(descriptor, function_end);
            } else {
                return false;
            }
        } else {
            return false;
        }

        let Some(next_cursor) = next_object_literal_entry(descriptor, cursor, descriptor_end)
        else {
            return false;
        };
        cursor = next_cursor;
    }

    found && seen_enumerable
}

fn getter_body_returns_binding_key(body: &str, binding: &str, key: &str) -> bool {
    matches!(
        parse_getter_return_member_body(body),
        Some(GetterReturnMember::BracketIdentifier { receiver, member })
            if receiver == binding && member == key
    )
}

fn next_char_boundary(source: &str, pos: usize) -> usize {
    if pos >= source.len() {
        return source.len();
    }
    pos + source[pos..].chars().next().map_or(1, char::len_utf8)
}

fn previous_significant_byte(source: &str, pos: usize) -> Option<u8> {
    let bytes = source.as_bytes();
    let mut i = pos;
    while i > 0 {
        i -= 1;
        if !bytes[i].is_ascii_whitespace() {
            return Some(bytes[i]);
        }
    }
    None
}

fn previous_significant_byte_before_import_meta(source: &str, pos: usize) -> Option<u8> {
    previous_significant_code_byte(source, pos)
}

fn previous_significant_code_byte(source: &str, pos: usize) -> Option<u8> {
    let mut previous = None;
    let _ = scan_code_positions(&source[..pos], true, |_, byte| {
        if !byte.is_ascii_whitespace() {
            previous = Some(byte);
        }
        ControlFlow::Continue(None)
    });
    previous
}

fn previous_identifier_before(source: &str, pos: usize) -> Option<(usize, &str)> {
    let mut previous = None;
    let _ = scan_code_positions(&source[..pos], true, |i, byte| {
        if is_js_identifier_start(byte) {
            let mut end = i + 1;
            let bytes = source.as_bytes();
            while end < pos && is_js_identifier_continue(bytes[end]) {
                end += 1;
            }
            previous = Some((i, &source[i..end]));
            return ControlFlow::Continue(Some(end));
        }
        ControlFlow::Continue(None)
    });
    previous
}

fn is_regex_literal_start(source: &str, pos: usize) -> bool {
    let bytes = source.as_bytes();
    let mut start = 0usize;
    for i in (0..pos).rev() {
        if matches!(bytes[i], b'\n' | b'\r' | b';' | b'{' | b'}') {
            start = i + 1;
            break;
        }
    }
    let mut token_start = None;
    let mut token_end = 0usize;
    let mut token_byte = None;
    let mut i = start;
    while i < pos {
        if let Some(next) = skip_non_code(source, i, false) {
            i = next;
            continue;
        }
        let byte = bytes[i];
        if byte.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if is_js_identifier_continue(byte) {
            let begin = i;
            i += 1;
            while i < pos && is_js_identifier_continue(bytes[i]) {
                i += 1;
            }
            token_start = Some(begin);
            token_end = i;
            token_byte = None;
            continue;
        }
        token_start = None;
        token_byte = Some(byte);
        i = next_char_boundary(source, i);
    }
    if let Some(byte) = token_byte {
        return b"({[=,:;!?&|+-*~^%>".contains(&byte);
    }
    token_start
        .map(|start| {
            matches!(
                &source[start..token_end],
                "return" | "throw" | "case" | "yield"
            )
        })
        .unwrap_or(true)
}

fn skip_regex_literal(source: &str, pos: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = pos + 1;
    let mut in_class = false;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'[' => {
                in_class = true;
                i += 1;
            }
            b']' => {
                in_class = false;
                i += 1;
            }
            b'/' if !in_class => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                    i += 1;
                }
                return i;
            }
            b'\n' | b'\r' => return pos + 1,
            _ => i += 1,
        }
    }
    pos + 1
}

fn skip_non_code(source: &str, pos: usize, skip_regex: bool) -> Option<usize> {
    let bytes = source.as_bytes();
    match bytes.get(pos).copied()? {
        b'\'' | b'"' | b'`' => Some(skip_string_or_template(source, pos)),
        b'/' if pos + 1 < bytes.len() && bytes[pos + 1] == b'/' => {
            let mut i = pos + 2;
            while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                i += 1;
            }
            Some(i)
        }
        b'/' if pos + 1 < bytes.len() && bytes[pos + 1] == b'*' => {
            let mut i = pos + 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            Some((i + 2).min(bytes.len()))
        }
        b'/' if skip_regex && is_regex_literal_start(source, pos) => {
            Some(skip_regex_literal(source, pos))
        }
        _ => None,
    }
}

fn scan_code_positions<F>(source: &str, skip_regex: bool, mut visitor: F) -> ControlFlow<()>
where
    F: FnMut(usize, u8) -> ControlFlow<(), Option<usize>>,
{
    let bytes = source.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some(next) = skip_non_code(source, i, skip_regex) {
            i = next;
            continue;
        }

        match visitor(i, bytes[i]) {
            ControlFlow::Break(()) => return ControlFlow::Break(()),
            ControlFlow::Continue(Some(next)) => i = next,
            ControlFlow::Continue(None) => i = next_char_boundary(source, i),
        }
    }
    ControlFlow::Continue(())
}

fn scan_code_positions_with_brace_depth<F>(
    source: &str,
    skip_regex: bool,
    mut visitor: F,
) -> ControlFlow<()>
where
    F: FnMut(usize, u8, usize) -> ControlFlow<(), Option<usize>>,
{
    let bytes = source.as_bytes();
    let mut i = 0usize;
    let mut brace_depth = 0usize;
    while i < bytes.len() {
        if let Some(next) = skip_non_code(source, i, skip_regex) {
            i = next;
            continue;
        }

        let current = bytes[i];
        match visitor(i, current, brace_depth) {
            ControlFlow::Break(()) => return ControlFlow::Break(()),
            ControlFlow::Continue(Some(next)) => i = next,
            ControlFlow::Continue(None) => i = next_char_boundary(source, i),
        }

        match current {
            b'{' => brace_depth += 1,
            b'}' => brace_depth = brace_depth.saturating_sub(1),
            _ => {}
        }
    }
    ControlFlow::Continue(())
}

fn statement_starts(source: &str) -> Vec<bool> {
    let bytes = source.as_bytes();
    let mut starts = vec![false; bytes.len() + 1];
    let mut i = 0usize;
    let mut brace_depth = 0usize;
    let mut previous_code = None;
    let mut line_terminator_since_code = false;
    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            if matches!(bytes[i], b'\n' | b'\r') {
                line_terminator_since_code = true;
            }
            i += 1;
            continue;
        }
        if let Some(next) = skip_non_code(source, i, true) {
            if source[i..next]
                .bytes()
                .any(|byte| matches!(byte, b'\n' | b'\r'))
            {
                line_terminator_since_code = true;
            }
            i = next;
            continue;
        }

        let current = bytes[i];
        if brace_depth == 0
            && (matches!(previous_code, None | Some(b';' | b'}'))
                || (line_terminator_since_code
                    && !previous_code.is_some_and(is_asi_continuation_previous)
                    && !is_asi_continuation_next(source, i)))
        {
            starts[i] = true;
        }

        match current {
            b'{' => brace_depth += 1,
            b'}' => brace_depth = brace_depth.saturating_sub(1),
            _ => {}
        }
        previous_code = Some(current);
        line_terminator_since_code = false;
        i = next_char_boundary(source, i);
    }
    starts
}

fn analyze_cjs_exports(source: &str) -> CjsExportAnalysis {
    let mut analysis = CjsExportAnalysis::default();
    let mut require_bindings = HashMap::<String, String>::new();
    let statement_starts = statement_starts(source);
    let _ = scan_code_positions_with_brace_depth(source, true, |i, _, brace_depth| {
        if let Some((name, next)) = parse_export_member(source, i) {
            analysis.is_cjs = true;
            add_unique(&mut analysis.exports, name);
            return ControlFlow::Continue(Some(next));
        }
        if let Some((name, next)) = parse_define_property_export(source, i) {
            analysis.is_cjs = true;
            add_unique(&mut analysis.exports, name);
            return ControlFlow::Continue(Some(next));
        }
        if brace_depth == 0
            && statement_starts.get(i).copied().unwrap_or(false)
            && let Some((binding, specifier, next)) = parse_require_binding(source, i)
        {
            require_bindings.insert(binding, specifier);
            return ControlFlow::Continue(Some(next));
        }
        if brace_depth == 0
            && let Some((specifier, next)) = parse_export_star_reexport(source, i)
        {
            analysis.is_cjs = true;
            add_unique(&mut analysis.reexports, specifier);
            return ControlFlow::Continue(Some(next));
        }
        if let Some((specifier, next)) = parse_module_exports_reexport(source, i) {
            analysis.is_cjs = true;
            analysis.reexports.clear();
            add_unique(&mut analysis.reexports, specifier);
            return ControlFlow::Continue(Some(next));
        }
        if let Some((exports, reexports, next)) = parse_module_exports_object_literal(source, i) {
            analysis.is_cjs = true;
            analysis.reexports.clear();
            for name in exports {
                add_unique(&mut analysis.exports, name);
            }
            for specifier in reexports {
                add_unique(&mut analysis.reexports, specifier);
            }
            return ControlFlow::Continue(Some(next));
        }
        if let Some(next) = parse_module_exports_assignment(source, i) {
            analysis.is_cjs = true;
            return ControlFlow::Continue(Some(next));
        }
        if brace_depth == 0
            && statement_starts.get(i).copied().unwrap_or(false)
            && let Some((specifier, next)) =
                parse_object_keys_reexport(source, i, &require_bindings)
        {
            analysis.is_cjs = true;
            add_unique(&mut analysis.reexports, specifier);
            return ControlFlow::Continue(Some(next));
        }
        ControlFlow::Continue(None)
    });
    analysis
}

fn is_node_builtin_specifier(specifier: &str) -> bool {
    let bare = specifier.strip_prefix("node:").unwrap_or(specifier);
    matches!(
        bare,
        "fs" | "path"
            | "os"
            | "crypto"
            | "http"
            | "https"
            | "url"
            | "util"
            | "stream"
            | "events"
            | "buffer"
            | "querystring"
            | "string_decoder"
            | "zlib"
            | "assert"
            | "module"
            | "net"
            | "tls"
            | "child_process"
            | "timers"
            | "dns"
            | "dgram"
            | "cluster"
            | "constants"
            | "readline"
            | "tty"
            | "v8"
            | "vm"
            | "worker_threads"
            | "perf_hooks"
            | "async_hooks"
            | "diagnostics_channel"
            | "trace_events"
            | "inspector"
            | "punycode"
            | "console"
            | "process"
            | "test"
            | "sqlite"
            | "domain"
            | "http2"
            | "repl"
    )
}

fn resolve_cjs_reexport_path(
    ctx: &Ctx<'_>,
    filename: &str,
    specifier: &str,
    conditions: &[String],
) -> Option<String> {
    if is_node_builtin_specifier(specifier) || specifier.contains(':') {
        return None;
    }
    let mut warnings = Vec::new();
    let mut resolution = cjs_analysis_resolution_context(ctx, conditions, &mut warnings);
    if !is_relative_or_absolute_specifier(specifier) {
        let resolver = NodeModulesResolver;
        return resolver
            .try_resolve_with_context(filename, specifier, &mut resolution)
            .ok()
            .flatten();
    }
    let base = if specifier.starts_with('/') {
        std::path::PathBuf::from(specifier)
    } else {
        std::path::Path::new(filename).parent()?.join(specifier)
    };
    NodeModulesResolver::resolve_cjs_analysis_relative(&base, &mut resolution)
}

fn is_cjs_analysis_source_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str());
    !matches!(extension, Some("json" | "node"))
}

fn canonical_cjs_analysis_path(ctx: &Ctx<'_>, path: &str) -> String {
    crate::builtin::realpath_for_module_resolution(ctx, path).unwrap_or_else(|| path.to_string())
}

#[derive(Clone)]
struct PreparedCjsTypeScript {
    original_source: String,
    prepared_source: String,
    export_names: Vec<String>,
}

// Ephemeral ownership transfer for one CommonJS load transaction. Entries carry
// already-transformed source from Rust analysis into JavaScript execution; they
// are consumed and cleared rather than retained as a filesystem cache.
type PreparedCjsTypeScriptGraph = HashMap<String, PreparedCjsTypeScript>;

fn analyze_cjs_reexport_specifier_names(
    ctx: &Ctx<'_>,
    filename: &str,
    reexport_specifiers: Vec<String>,
    seen: &mut HashSet<String>,
    conditions: &[String],
    mut prepared_typescript: Option<&mut PreparedCjsTypeScriptGraph>,
) -> Vec<String> {
    let mut names = Vec::new();
    for reexport in reexport_specifiers {
        if let Some(logical_path) = resolve_cjs_reexport_path(ctx, filename, &reexport, conditions)
            && let physical_path = canonical_cjs_analysis_path(ctx, &logical_path)
            && !seen.contains(&physical_path)
            && is_cjs_analysis_source_path(&physical_path)
        {
            let child_filename = if NodeFileResolver::has_exec_argv_flag(ctx, "--preserve-symlinks")
            {
                logical_path
            } else {
                physical_path
            };
            let Ok(source) = std::fs::read_to_string(&child_filename) else {
                continue;
            };
            #[cfg(feature = "typescript-runtime")]
            let original_source_for_cache = source.clone();
            #[cfg(feature = "typescript-runtime")]
            let cached_typescript_analysis = if is_typescript_module_path(&child_filename) {
                cached_cjs_typescript_analysis_for_filename(ctx, &child_filename, &source)
                    .ok()
                    .flatten()
            } else {
                None
            };
            #[cfg(feature = "typescript-runtime")]
            if let Some(exports) = cached_typescript_analysis
                .as_ref()
                .and_then(|cached| cached.export_names.clone())
            {
                for name in exports {
                    add_unique(&mut names, name);
                }
                continue;
            }
            #[cfg(feature = "typescript-runtime")]
            let cached_prepared_source =
                cached_typescript_analysis.and_then(|cached| cached.prepared_source);
            #[cfg(feature = "typescript-runtime")]
            let had_cached_prepared_source = cached_prepared_source.is_some();
            #[cfg(feature = "typescript-runtime")]
            let source = if is_typescript_module_path(&child_filename) {
                if !had_cached_prepared_source
                    && typescript_module_path_is_esm(
                        &child_filename,
                        &source,
                        package_scope_type(ctx, &child_filename).as_deref(),
                    )
                {
                    continue;
                }
                if let Some(prepared) = prepared_typescript
                    .as_deref()
                    .and_then(|graph| graph.get(&child_filename))
                {
                    prepared.prepared_source.clone()
                } else if let Some(cached) = cached_prepared_source {
                    cached
                } else {
                    let original_source = source;
                    let Ok(output) = crate::internal::typescript::transform_module(
                        original_source.clone(),
                        &child_filename,
                        crate::internal::typescript::source_maps_enabled(ctx),
                        match std::path::Path::new(&child_filename)
                            .extension()
                            .and_then(|extension| extension.to_str())
                        {
                            Some("mts") => Some(true),
                            Some("cts") => Some(false),
                            _ => None,
                        },
                    ) else {
                        continue;
                    };
                    let prepared_source = output.into_code_with_inline_source_map();
                    if let Some(graph) = prepared_typescript.as_deref_mut() {
                        let _ = record_typescript_module_transform(ctx);
                        graph.insert(
                            child_filename.clone(),
                            PreparedCjsTypeScript {
                                original_source,
                                prepared_source: prepared_source.clone(),
                                export_names: Vec::new(),
                            },
                        );
                    }
                    prepared_source
                }
            } else {
                source
            };
            let child = analyze_cjs_exports_for_file_impl(
                ctx,
                &child_filename,
                &source,
                seen,
                conditions,
                prepared_typescript.as_deref_mut(),
            );
            if let Some(graph) = prepared_typescript.as_deref_mut()
                && let Some(prepared) = graph.get_mut(&child_filename)
            {
                prepared.export_names = child.exports.clone();
            }
            #[cfg(feature = "typescript-runtime")]
            if had_cached_prepared_source {
                let _ = cache_cjs_typescript_export_names_for_filename(
                    ctx,
                    &child_filename,
                    &original_source_for_cache,
                    &child.exports,
                );
            }
            for name in child.exports {
                add_unique(&mut names, name);
            }
        }
    }
    names
}

fn analyze_cjs_exports_for_file(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
    seen: &mut HashSet<String>,
    conditions: &[String],
) -> CjsExportAnalysis {
    analyze_cjs_exports_for_file_impl(ctx, filename, source, seen, conditions, None)
}

fn analyze_cjs_exports_for_file_impl(
    ctx: &Ctx<'_>,
    filename: &str,
    source: &str,
    seen: &mut HashSet<String>,
    conditions: &[String],
    prepared_typescript: Option<&mut PreparedCjsTypeScriptGraph>,
) -> CjsExportAnalysis {
    record_commonjs_export_analysis(ctx);
    let mut analysis = analyze_cjs_exports(source);
    if !seen.insert(canonical_cjs_analysis_path(ctx, filename)) {
        return analysis;
    }
    let reexports = analysis.reexports.clone();
    for name in analyze_cjs_reexport_specifier_names(
        ctx,
        filename,
        reexports,
        seen,
        conditions,
        prepared_typescript,
    ) {
        add_unique(&mut analysis.exports, name);
    }
    analysis
}

fn prepared_cjs_typescript_graph_object<'js>(
    ctx: &Ctx<'js>,
    graph: &PreparedCjsTypeScriptGraph,
) -> rquickjs::Result<Object<'js>> {
    let value = Object::new(ctx.clone())?;
    for (filename, prepared) in graph {
        let entry = Object::new(ctx.clone())?;
        entry.set("originalSource", prepared.original_source.clone())?;
        entry.set("preparedSource", prepared.prepared_source.clone())?;
        let export_names = rquickjs::Array::new(ctx.clone())?;
        for (index, name) in prepared.export_names.iter().enumerate() {
            export_names.set(index, name.clone())?;
        }
        entry.set("exportNames", export_names)?;
        value.set(filename, entry)?;
    }
    Ok(value)
}

struct PackageScopeInfo {
    package_type: Option<String>,
    is_node_modules_package: bool,
}

fn package_scope_type(ctx: &Ctx<'_>, filename: &str) -> Option<String> {
    package_scope_info(ctx, filename)
        .ok()
        .flatten()
        .and_then(|scope| scope.package_type)
}

fn package_scope_info(
    ctx: &Ctx<'_>,
    filename: &str,
) -> Result<Option<PackageScopeInfo>, NodePackageResolveError> {
    let Some(parent) = std::path::Path::new(filename).parent() else {
        return Ok(None);
    };
    let mut dir = parent.to_path_buf();
    let mut warnings = Vec::new();
    let resolution = cjs_analysis_resolution_context(ctx, &[], &mut warnings);
    loop {
        if dir.file_name().is_some_and(|name| name == "node_modules") {
            return Ok(None);
        }
        let pkg_path = dir.join("package.json");
        if let Some(package) =
            NodeModulesResolver::read_package_json_optional_with_context(&pkg_path, &resolution)?
        {
            return Ok(Some(PackageScopeInfo {
                package_type: package.package_type.clone(),
                is_node_modules_package: is_node_modules_package_scope(&dir),
            }));
        }
        if !dir.pop() {
            break;
        }
    }
    Ok(None)
}

fn package_scope_info_or_throw<'js>(
    ctx: &Ctx<'js>,
    filename: &str,
) -> rquickjs::Result<Option<PackageScopeInfo>> {
    match package_scope_info(ctx, filename) {
        Ok(scope) => Ok(scope),
        Err(err) => {
            let _: String = throw_node_package_resolve_error(ctx, err)?;
            unreachable!()
        }
    }
}

fn cjs_package_scope_info<'js>(
    ctx: Ctx<'js>,
    filename: String,
) -> rquickjs::Result<Option<Object<'js>>> {
    let Some(scope) = package_scope_info_or_throw(&ctx, &filename)? else {
        return Ok(None);
    };
    let result = Object::new(ctx.clone())?;
    match scope.package_type {
        Some(package_type) => result.set("packageType", package_type)?,
        None => result.set("packageType", Value::new_null(ctx.clone()))?,
    }
    result.set("isNodeModulesPackage", scope.is_node_modules_package)?;
    Ok(Some(result))
}

fn source_uses_esm_format(source: String) -> bool {
    source_looks_like_esm(&source) || has_cjs_wrapper_lexical_redeclaration(&source)
}

#[cfg(feature = "typescript-runtime")]
fn typescript_module_path_is_esm(filename: &str, source: &str, package_type: Option<&str>) -> bool {
    if filename.ends_with(".mts") {
        return true;
    }
    if filename.ends_with(".cts") {
        return false;
    }
    if package_type == Some("module") {
        return true;
    }
    if package_type == Some("commonjs") {
        return false;
    }
    crate::internal::typescript::source_uses_esm_format(source, filename).unwrap_or(false)
}

fn is_node_modules_package_scope(dir: &std::path::Path) -> bool {
    let Some(parent) = dir.parent() else {
        return false;
    };
    if parent
        .file_name()
        .is_some_and(|name| name == "node_modules")
    {
        return true;
    }
    parent
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('@'))
        && parent
            .parent()
            .and_then(|grandparent| grandparent.file_name())
            .is_some_and(|name| name == "node_modules")
}

fn cjs_named_export_source(names: &[String], host_global: &str) -> String {
    let mut out = String::new();
    for (index, name) in names.iter().enumerate() {
        if name == "default" {
            continue;
        }
        let local = format!("__cjs_export_{}", index);
        let escaped = escape_js_string(name);
        out.push_str(&format!(
            "var {local} = {host_global}.__wasm_rquickjs_cjs_facade_has_own(__cjs_default, \"{escaped}\") ? __cjs_default[\"{escaped}\"] : undefined;\nexport {{ {local} as \"{escaped}\" }};\n"
        ));
    }
    out
}

fn build_cjs_facade_source(default_member_expression: &str, names: &[String]) -> String {
    let host_global = "__wasm_rquickjs_global";
    let named_exports = cjs_named_export_source(names, host_global);
    format!(
        r#"const {host_global}=import.meta.__wasm_rquickjs_global;
var __cjs_default = {host_global}.{default_member_expression};
export default __cjs_default;
{}
"#,
        named_exports,
    )
}

const LOADER_CJS_FACADE_PREFIX: &str = "__wasm_rquickjs_loader_cjs_facade__:";

type LoaderCjsFacadeRegistryState = (
    u64,
    std::collections::hash_map::RandomState,
    HashMap<String, String>,
);

#[derive(Clone)]
struct LoaderCjsFacadeRegistry {
    inner: Rc<RefCell<LoaderCjsFacadeRegistryState>>,
}

impl Default for LoaderCjsFacadeRegistry {
    fn default() -> Self {
        Self {
            inner: Rc::new(RefCell::new((
                0,
                std::collections::hash_map::RandomState::new(),
                HashMap::new(),
            ))),
        }
    }
}

impl LoaderCjsFacadeRegistry {
    fn register(&self, source: String) -> String {
        let mut inner = self.inner.borrow_mut();
        loop {
            inner.0 = inner.0.wrapping_add(1);
            let counter = inner.0;
            let hash = inner.1.hash_one(counter);
            let id = format!("{LOADER_CJS_FACADE_PREFIX}{hash:016x}");
            if !inner.2.contains_key(&id) {
                inner.2.insert(id.clone(), source);
                return id;
            }
        }
    }

    fn contains(&self, id: &str) -> bool {
        self.inner.borrow().2.contains_key(id)
    }

    fn take(&self, id: &str) -> Option<String> {
        self.inner.borrow_mut().2.remove(id)
    }
}

struct LoaderCjsFacadeLoader(LoaderCjsFacadeRegistry);

struct LoaderCjsFacadeResolver(LoaderCjsFacadeRegistry);

impl Resolver for LoaderCjsFacadeResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        _base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if name.starts_with(LOADER_CJS_FACADE_PREFIX) && self.0.contains(name) {
            Ok(name.to_string())
        } else {
            Err(Error::new_resolving(_base, name))
        }
    }
}

impl Loader for LoaderCjsFacadeLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        if !path.starts_with(LOADER_CJS_FACADE_PREFIX) {
            return Err(Error::new_loading(path));
        }
        let source = self.0.take(path);
        let Some(source) = source else {
            return Err(Error::new_loading(path));
        };
        let init = url_only_import_meta_init(path.to_string());
        declare_module_with_import_meta(ctx, path, &source, &init)
    }
}

fn build_loader_cjs_facade(
    registry: &LoaderCjsFacadeRegistry,
    ctx: Ctx<'_>,
    filename: String,
    source_url: String,
    cache_key: String,
    source: String,
) -> String {
    let cjs_conditions = NodeModulesResolver::conditions_from_global(
        &ctx,
        NodePackageResolveMode::CjsAnalysis.condition_mode(),
    );
    let analysis = analyze_cjs_exports_for_file(
        &ctx,
        &filename,
        &source,
        &mut HashSet::new(),
        &cjs_conditions,
    );
    let default_member_expression = format!(
        "__wasm_rquickjs_load_commonjs_loader_source(\"{}\",\"{}\",\"{}\",\"{}\")",
        escape_js_string(&filename),
        escape_js_string(&source),
        escape_js_string(&source_url),
        escape_js_string(&cache_key),
    );
    registry.register(build_cjs_facade_source(
        &default_member_expression,
        &analysis.exports,
    ))
}

impl Loader for CjsCompatLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let fs_path = module_filesystem_path(path);
        let is_extensionless = std::path::Path::new(fs_path).extension().is_none();
        let is_cjs_ext = fs_path.ends_with(".cjs");
        #[cfg(feature = "typescript-runtime")]
        let is_typescript = is_typescript_module_path(fs_path);
        #[cfg(not(feature = "typescript-runtime"))]
        let is_typescript = false;
        if !fs_path.ends_with(".js") && !is_cjs_ext && !is_extensionless && !is_typescript {
            return Err(Error::new_loading(path));
        }
        if import_attr_type_from_path(path).as_deref() == Some("json") {
            return throw_import_attr_type_incompatible(ctx);
        }

        let fs_abs_path = ensure_absolute_path(fs_path);
        let package_scope =
            if fs_abs_path.ends_with(".js") || fs_abs_path.ends_with(".ts") || is_extensionless {
                package_scope_info_or_throw(ctx, &fs_abs_path)?
            } else {
                None
            };
        let package_type = package_scope
            .as_ref()
            .and_then(|scope| scope.package_type.clone());
        let is_module_package_js = package_type.as_deref() == Some("module");
        let is_commonjs_package_js = package_type.as_deref() == Some("commonjs")
            || (package_type.is_none()
                && package_scope
                    .as_ref()
                    .is_some_and(|scope| scope.is_node_modules_package));

        let source_path = module_source_filesystem_path(ctx, path);
        let source = read_module_source_or_throw(ctx, path, &source_path)?;
        #[cfg(feature = "typescript-runtime")]
        let original_source_for_cache = source.clone();
        #[cfg(feature = "typescript-runtime")]
        let cached_typescript_analysis = if is_typescript {
            cached_cjs_typescript_analysis_for_filename(ctx, &fs_abs_path, &source)?
        } else {
            None
        };
        #[cfg(feature = "typescript-runtime")]
        let cached_typescript_export_names = cached_typescript_analysis
            .as_ref()
            .and_then(|cached| cached.export_names.clone());
        #[cfg(feature = "typescript-runtime")]
        let cached_typescript_prepared_source =
            cached_typescript_analysis.and_then(|cached| cached.prepared_source);
        #[cfg(not(feature = "typescript-runtime"))]
        let cached_typescript_export_names: Option<Vec<String>> = None;
        #[cfg(not(feature = "typescript-runtime"))]
        let cached_typescript_prepared_source: Option<String> = None;
        let has_cached_typescript_export_names = cached_typescript_export_names.is_some();
        let has_cached_typescript_prepared_source = cached_typescript_prepared_source.is_some();
        let has_cached_cjs_typescript =
            has_cached_typescript_export_names || has_cached_typescript_prepared_source;
        #[cfg(feature = "typescript-runtime")]
        let raw_typescript_looks_esm = is_typescript
            && !has_cached_cjs_typescript
            && typescript_module_path_is_esm(&fs_abs_path, &source, package_type.as_deref());
        #[cfg(not(feature = "typescript-runtime"))]
        let raw_typescript_looks_esm = false;
        #[cfg(feature = "typescript-runtime")]
        let should_prepare_typescript_source = is_typescript
            && !has_cached_cjs_typescript
            && !raw_typescript_looks_esm
            && (fs_path.ends_with(".cts") || (!fs_path.ends_with(".mts") && !is_module_package_js));
        #[cfg(feature = "typescript-runtime")]
        let original_typescript_source = should_prepare_typescript_source.then(|| source.clone());
        #[cfg(feature = "typescript-runtime")]
        let source = if let Some(cached_source) = cached_typescript_prepared_source {
            cached_source
        } else if is_typescript && !has_cached_cjs_typescript {
            transform_typescript_module_source(ctx, fs_path, source)?
        } else {
            source
        };

        let url = path_to_file_url(path);
        let force_module = require_esm_forced_module(ctx, &fs_abs_path, &url);

        let cjs_url = url.clone();
        let has_esm_syntax = force_module
            || raw_typescript_looks_esm
            || (!is_typescript
                && (source_looks_like_esm(&source)
                    || has_cjs_wrapper_lexical_redeclaration(&source)));
        // .cjs files are always CommonJS; JS-like files outside a module package
        // remain CommonJS unless syntax detection finds ESM.
        let is_cjs = has_cached_cjs_typescript
            || fs_path.ends_with(".cts")
            || is_cjs_ext
            || (!fs_path.ends_with(".mts")
                && (is_commonjs_package_js || (!is_module_package_js && !has_esm_syntax)));
        if !is_cjs {
            let preflight_mode = if fs_path.ends_with(".js") && is_module_package_js {
                EsmFilePreflightMode::PackageTypeModuleJs
            } else {
                EsmFilePreflightMode::RequireOnly
            };
            return declare_esm_file_module_from_source(
                ctx,
                path,
                fs_path,
                source,
                url,
                preflight_mode,
            );
        }

        let cjs_conditions = NodeModulesResolver::conditions_from_global(
            ctx,
            NodePackageResolveMode::CjsAnalysis.condition_mode(),
        );
        let mut prepared_typescript = PreparedCjsTypeScriptGraph::new();
        #[cfg(feature = "typescript-runtime")]
        if let Some(original_source) = original_typescript_source {
            prepared_typescript.insert(
                fs_abs_path.clone(),
                PreparedCjsTypeScript {
                    original_source,
                    prepared_source: source.clone(),
                    export_names: Vec::new(),
                },
            );
        }
        let detected_analysis = if let Some(exports) = cached_typescript_export_names {
            CjsExportAnalysis {
                exports,
                ..CjsExportAnalysis::default()
            }
        } else {
            analyze_cjs_exports_for_file_impl(
                ctx,
                &fs_abs_path,
                &source,
                &mut HashSet::new(),
                &cjs_conditions,
                Some(&mut prepared_typescript),
            )
        };
        #[cfg(feature = "typescript-runtime")]
        if has_cached_typescript_prepared_source && !has_cached_typescript_export_names {
            cache_cjs_typescript_export_names_for_filename(
                ctx,
                &fs_abs_path,
                &original_source_for_cache,
                &detected_analysis.exports,
            )?;
        }
        if let Some(prepared) = prepared_typescript.get_mut(&fs_abs_path) {
            prepared.export_names = detected_analysis.exports.clone();
        }
        // Let the existing CommonJS loader execute and cache the module. The
        // facade only exposes the shared module.exports object to ESM.
        let mut init = file_import_meta_init(cjs_url, fs_abs_path.clone());
        if !prepared_typescript.is_empty() {
            init.prepared_cjs_typescript = Some(prepared_typescript);
        }
        let default_member_expression = if init.prepared_cjs_typescript.is_some() {
            format!(
                "__wasm_rquickjs_load_cjs_esm_facade_default(\"{}\",__wasm_rquickjs_take_prepared_cjs_typescript(import.meta))",
                escape_js_string(&fs_abs_path),
            )
        } else {
            format!(
                "__wasm_rquickjs_load_cjs_esm_facade_default(\"{}\")",
                escape_js_string(&fs_abs_path),
            )
        };
        let wrapped =
            build_cjs_facade_source(&default_member_expression, &detected_analysis.exports);

        declare_module_with_import_meta(ctx, path, &wrapped, &init)
    }
}

struct ImportMetaInit {
    url: String,
    filename: Option<String>,
    dirname: Option<String>,
    include_resolve: bool,
    prepared_cjs_typescript: Option<PreparedCjsTypeScriptGraph>,
}

fn declare_module_with_import_meta<'js>(
    ctx: &Ctx<'js>,
    path: &str,
    source: &str,
    init: &ImportMetaInit,
) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
    let module = Module::declare(ctx.clone(), path, source.as_bytes().to_vec())?;
    initialize_module_import_meta(ctx, &module, init)?;
    Ok(module)
}

fn initialize_module_import_meta<'js>(
    ctx: &Ctx<'js>,
    module: &Module<'js, rquickjs::module::Declared>,
    init: &ImportMetaInit,
) -> rquickjs::Result<()> {
    let meta = module.meta()?;
    let globals = ctx.globals();
    let internal_meta = meta.clone();
    let internal_globals = globals.clone();
    meta.prop(
        "__wasm_rquickjs_global",
        Accessor::from(move || -> rquickjs::Result<Object<'js>> {
            internal_meta.remove("__wasm_rquickjs_global")?;
            Ok(internal_globals.clone())
        })
        .configurable(),
    )?;
    if let Some(prepared) = &init.prepared_cjs_typescript {
        let value = prepared_cjs_typescript_graph_object(ctx, prepared)?;
        meta.prop(
            "__wasm_rquickjs_prepared_cjs_typescript",
            Property::from(value).configurable(),
        )?;
    }
    if let Some(ref dirname) = init.dirname {
        meta.prop(
            "dirname",
            Property::from(dirname.clone())
                .writable()
                .enumerable()
                .configurable(),
        )?;
    }
    if let Some(ref filename) = init.filename {
        meta.prop(
            "filename",
            Property::from(filename.clone())
                .writable()
                .enumerable()
                .configurable(),
        )?;
    }
    if init.include_resolve {
        let base_url = init.url.clone();
        let resolve = Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>,
                  specifier: String,
                  parent_url: Opt<Value<'js>>|
                  -> rquickjs::Result<String> {
                let globals = ctx.globals();
                let resolver: Function = globals.get("__wasm_rquickjs_import_meta_resolve")?;
                if let Some(parent_url) = parent_url.0
                    && !parent_url.is_undefined()
                {
                    if let Some(parent_url) = parent_url.as_string() {
                        return resolver.call((parent_url.to_string()?, specifier));
                    }
                    if let Some(parent_url) = parent_url.as_object() {
                        let url_ctor: Value = globals.get("URL")?;
                        if parent_url.is_instance_of(&url_ctor) {
                            let href: String = parent_url.get("href")?;
                            return resolver.call((href, specifier));
                        }
                    }
                    return throw_native_coded_error(
                        &ctx,
                        "The \"parentURL\" argument must be of type string or an instance of URL.",
                        "ERR_INVALID_ARG_TYPE",
                        true,
                    );
                }
                resolver.call((base_url.clone(), specifier))
            },
        )?
        .with_length(1)?;
        meta.prop(
            "resolve",
            Property::from(resolve)
                .writable()
                .enumerable()
                .configurable(),
        )?;
    }
    meta.prop(
        "url",
        Property::from(init.url.clone())
            .writable()
            .enumerable()
            .configurable(),
    )?;
    Ok(())
}

fn mark_async_esm_module<'js>(
    ctx: &Ctx<'js>,
    globals: &Object<'js>,
    filename: &str,
    file_url: &str,
) -> rquickjs::Result<()> {
    let registry = match globals.get::<_, Value>("__wasm_rquickjs_async_esm_modules") {
        Ok(value) if value.is_object() => value.into_object().unwrap(),
        _ => {
            let object = Object::new(ctx.clone())?;
            globals.set("__wasm_rquickjs_async_esm_modules", object.clone())?;
            object
        }
    };
    registry.set(filename, true)?;
    registry.set(file_url, true)?;
    if let Ok(in_progress) = globals.get::<_, Object>("__wasm_rquickjs_require_esm_in_progress") {
        for key in in_progress.keys::<String>().flatten() {
            registry.set(key, true)?;
        }
    }
    Ok(())
}

fn url_only_import_meta_init(url: String) -> ImportMetaInit {
    ImportMetaInit {
        url,
        filename: None,
        dirname: None,
        include_resolve: true,
        prepared_cjs_typescript: None,
    }
}

fn file_import_meta_init(url: String, filename: String) -> ImportMetaInit {
    let dirname = std::path::Path::new(&filename)
        .parent()
        .map(|p| p.to_string_lossy().into_owned());
    ImportMetaInit {
        url,
        filename: Some(filename),
        dirname,
        include_resolve: true,
        prepared_cjs_typescript: None,
    }
}

/// Ensure a path is absolute. If relative, prepend `/` (WASI cwd is `/`).
fn ensure_absolute_path(path: &str) -> String {
    let (path, suffix) = split_module_path_suffix(path);
    let mut absolute = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    };
    absolute.push_str(suffix);
    absolute
}

pub(crate) fn path_to_file_url(path: &str) -> String {
    let stripped_path = strip_loader_realm_param(path);
    let abs_path = ensure_absolute_path(&stripped_path);
    let (abs_path, suffix) = split_module_path_suffix(&abs_path);
    let mut url = path_without_suffix_to_file_url(abs_path);
    url.push_str(suffix);
    url
}

fn path_without_suffix_to_file_url(path: &str) -> String {
    let abs_path = if path.starts_with('/') {
        Cow::Borrowed(path)
    } else {
        Cow::Owned(format!("/{path}"))
    };
    let mut url = String::from("file://");
    for byte in abs_path.as_bytes() {
        match byte {
            b'%' => url.push_str("%25"),
            b' ' => url.push_str("%20"),
            b'#' => url.push_str("%23"),
            b'?' => url.push_str("%3F"),
            // Unreserved characters + path separators
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                url.push(*byte as char)
            }
            _ if *byte > 0x7F => {
                // Non-ASCII: percent-encode each byte
                url.push_str(&format!("%{:02X}", byte));
            }
            _ => {
                // Other ASCII special chars: percent-encode
                url.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    url
}

fn path_with_preserved_escapes_to_file_url(path: &str) -> String {
    let abs_path = if path.starts_with('/') {
        Cow::Borrowed(path)
    } else {
        Cow::Owned(format!("/{path}"))
    };
    let mut url = String::from("file://");
    let bytes = abs_path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len()
                && FileUrlResolver::hex_val(bytes[i + 1]).is_some()
                && FileUrlResolver::hex_val(bytes[i + 2]).is_some() =>
            {
                url.push('%');
                url.push(bytes[i + 1] as char);
                url.push(bytes[i + 2] as char);
                i += 3;
                continue;
            }
            b'%' => url.push_str("%25"),
            b' ' => url.push_str("%20"),
            b'#' => url.push_str("%23"),
            b'?' => url.push_str("%3F"),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                url.push(bytes[i] as char)
            }
            _ => {
                url.push_str(&format!("%{:02X}", bytes[i]));
            }
        }
        i += 1;
    }
    url
}

fn normalize_encoded_module_path(path: &str) -> String {
    let is_absolute = path.starts_with('/');
    let mut parts = Vec::new();

    for segment in path.split('/') {
        if segment.is_empty() || is_encoded_dot_segment(segment, ".") {
            continue;
        }
        if is_encoded_dot_segment(segment, "..") {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }

    if is_absolute {
        format!("/{}", parts.join("/"))
    } else {
        parts.join("/")
    }
}

fn is_encoded_dot_segment(segment: &str, expected: &str) -> bool {
    if segment == expected {
        return true;
    }
    percent_decode(segment).is_some_and(|decoded| decoded == expected)
}

fn serialize_url_preserving_escapes(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut encoded = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len()
                && FileUrlResolver::hex_val(bytes[i + 1]).is_some()
                && FileUrlResolver::hex_val(bytes[i + 2]).is_some() =>
            {
                encoded.push('%');
                encoded.push(bytes[i + 1] as char);
                encoded.push(bytes[i + 2] as char);
                i += 3;
                continue;
            }
            b' ' => encoded.push_str("%20"),
            0x00..=0x20 | b'"' | b'<' | b'>' | b'`' => {
                encoded.push_str(&format!("%{:02X}", bytes[i]));
            }
            _ if bytes[i] > 0x7F => {
                encoded.push_str(&format!("%{:02X}", bytes[i]));
            }
            _ => encoded.push(bytes[i] as char),
        }
        i += 1;
    }
    encoded
}

fn split_module_path_suffix(path: &str) -> (&str, &str) {
    if path.starts_with("data:") {
        return (path, "");
    }
    let suffix_start = path.find(['?', '#']).unwrap_or(path.len());
    (&path[..suffix_start], &path[suffix_start..])
}

fn module_filesystem_path(path: &str) -> &str {
    split_module_path_suffix(path).0
}

fn module_source_filesystem_path(ctx: &Ctx<'_>, path: &str) -> String {
    let fs_path = module_filesystem_path(path);
    crate::builtin::realpath_for_module_resolution(ctx, fs_path)
        .unwrap_or_else(|| fs_path.to_string())
}

fn read_module_source_or_throw<'js>(
    ctx: &Ctx<'js>,
    module_id: &str,
    source_path: &str,
) -> rquickjs::Result<String> {
    #[cfg(feature = "typescript-compiler-profiling")]
    let profile = ctx
        .userdata::<crate::internal::runtime_services::RuntimeServices>()
        .expect("runtime services not initialized")
        .execution_profile();
    #[cfg(feature = "typescript-compiler-profiling")]
    if let Some(profile) = &profile {
        profile.increment("modules.sourceRead.calls");
    }
    match std::fs::read_to_string(source_path) {
        Ok(source) => {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &profile {
                profile.increment("modules.sourceRead.success");
                profile.add("modules.sourceRead.bytes", source.len() as u64);
            }
            Ok(source)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &profile {
                profile.increment("modules.sourceRead.notFound");
            }
            let globals = ctx.globals();
            let msg = format!("Cannot find module '{}'", module_id);
            let error_ctor: Function = globals.get("Error")?;
            let error_obj: Object = error_ctor.call((&msg,))?;
            error_obj.set("code", "ERR_MODULE_NOT_FOUND")?;
            Err(ctx.throw(error_obj.into_value()))
        }
        Err(_) => {
            #[cfg(feature = "typescript-compiler-profiling")]
            if let Some(profile) = &profile {
                profile.increment("modules.sourceRead.errors");
            }
            Err(Error::new_loading(module_id))
        }
    }
}

fn require_esm_in_progress(ctx: &Ctx<'_>, filename: &str, file_url: &str) -> bool {
    let globals = ctx.globals();
    let Ok(registry) = globals.get::<_, Object>("__wasm_rquickjs_require_esm_in_progress") else {
        return false;
    };
    registry.get::<_, bool>(filename).unwrap_or(false)
        || registry.get::<_, bool>(file_url).unwrap_or(false)
}

fn require_esm_forced_module(ctx: &Ctx<'_>, filename: &str, file_url: &str) -> bool {
    let globals = ctx.globals();
    let Ok(registry) = globals.get::<_, Object>("__wasm_rquickjs_require_esm_forced_module") else {
        return false;
    };
    registry.get::<_, bool>(filename).unwrap_or(false)
        || registry.get::<_, bool>(file_url).unwrap_or(false)
}

const LOADER_REALM_QUERY_PARAM: &str = "__wasm_rquickjs_loader_realm";

fn loader_realm_param(path_or_suffix: &str) -> Option<String> {
    let suffix = if path_or_suffix.starts_with('?') || path_or_suffix.starts_with('#') {
        path_or_suffix
    } else {
        split_module_path_suffix(path_or_suffix).1
    };
    let query = suffix.strip_prefix('?')?;
    let query = query.split_once('#').map_or(query, |(query, _)| query);
    for part in query.split('&') {
        if part
            .split_once('=')
            .is_some_and(|(key, _)| key == LOADER_REALM_QUERY_PARAM)
        {
            return Some(part.to_string());
        }
    }
    None
}

fn append_loader_realm_param(suffix: &str, param: Option<&str>) -> String {
    let Some(param) = param else {
        return suffix.to_string();
    };
    if loader_realm_param(suffix).is_some() {
        return suffix.to_string();
    }
    let hash_start = suffix.find('#').unwrap_or(suffix.len());
    let (before_hash, hash) = suffix.split_at(hash_start);
    let separator = if before_hash.contains('?') { '&' } else { '?' };
    format!("{before_hash}{separator}{param}{hash}")
}

fn strip_loader_realm_param_from_suffix(suffix: &str) -> String {
    let Some(query) = suffix.strip_prefix('?') else {
        return suffix.to_string();
    };
    let (query, hash) = query
        .split_once('#')
        .map_or((query, ""), |(query, hash)| (query, hash));
    let kept: Vec<&str> = query
        .split('&')
        .filter(|part| {
            part.split_once('=')
                .is_none_or(|(key, _)| key != LOADER_REALM_QUERY_PARAM)
        })
        .collect();
    let mut stripped = String::new();
    if !kept.is_empty() {
        stripped.push('?');
        stripped.push_str(&kept.join("&"));
    }
    if !hash.is_empty() {
        stripped.push('#');
        stripped.push_str(hash);
    } else if suffix.contains('#') && suffix.ends_with('#') {
        stripped.push('#');
    }
    stripped
}

fn strip_loader_realm_param(path: &str) -> String {
    let (path, suffix) = split_module_path_suffix(path);
    let mut stripped = path.to_string();
    stripped.push_str(&strip_loader_realm_param_from_suffix(suffix));
    stripped
}

fn escape_js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if c < '\u{0020}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c => out.push(c),
        }
    }
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JsBraceContext {
    Normal { object_like: bool },
    Function,
    Class,
    TemplateExpression,
}

enum JsTemplateBoundary {
    End(usize),
    Expression(usize),
}

fn scan_template_characters(source: &str, start: usize) -> JsTemplateBoundary {
    let bytes = source.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i = (i + 2).min(bytes.len()),
            b'`' => return JsTemplateBoundary::End(i + 1),
            b'$' if i + 1 < bytes.len() && bytes[i + 1] == b'{' => {
                return JsTemplateBoundary::Expression(i + 2);
            }
            _ => i += 1,
        }
    }
    JsTemplateBoundary::End(i)
}

fn source_has_top_level_await(source: &str, scan_template_expressions: bool) -> bool {
    let bytes = source.as_bytes();
    let mut i = 0;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut function_depth = 0usize;
    let mut class_depth = 0usize;
    let mut braces = Vec::new();
    let mut pending_function_body = false;
    let mut pending_class_body = false;
    let mut after_arrow = false;
    let mut skip_arrow_expression: Option<(usize, usize, usize)> = None;

    while i < bytes.len() {
        let b = bytes[i];

        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        if b == b'/' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'/' {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' {
                    i += 1;
                }
                continue;
            }
            if bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
            if is_regex_literal_start(source, i) {
                i = skip_regex_literal(source, i);
                continue;
            }
        }

        if b == b'\'' || b == b'"' {
            i = skip_string_or_template(source, i);
            continue;
        }

        if b == b'`' {
            if !scan_template_expressions {
                i = skip_string_or_template(source, i);
                continue;
            }
            match scan_template_characters(source, i + 1) {
                JsTemplateBoundary::End(next) => i = next,
                JsTemplateBoundary::Expression(next) => {
                    braces.push(JsBraceContext::TemplateExpression);
                    i = next;
                }
            }
            continue;
        }

        if after_arrow {
            after_arrow = false;
            if b == b'{' {
                pending_function_body = true;
            } else {
                skip_arrow_expression = Some((paren_depth, bracket_depth, braces.len()));
            }
        }

        if is_js_identifier_start(b) {
            let start = i;
            i += 1;
            while i < bytes.len() && is_js_identifier_continue(bytes[i]) {
                i += 1;
            }
            let ident = &source[start..i];
            if skip_arrow_expression.is_none() {
                let in_object_like_brace = matches!(
                    braces.last(),
                    Some(JsBraceContext::Normal { object_like: true })
                );
                match ident {
                    "await"
                        if function_depth == 0
                            && class_depth == 0
                            && is_top_level_await_expression(
                                source,
                                start,
                                i,
                                in_object_like_brace,
                            ) =>
                    {
                        return true;
                    }
                    "function" => pending_function_body = true,
                    "class" => pending_class_body = true,
                    _ => {}
                }
            }
            continue;
        }

        if let Some((start_paren, start_bracket, start_brace)) = skip_arrow_expression
            && (b == b';'
                || b == b','
                || (b == b')' && paren_depth <= start_paren)
                || (b == b']' && bracket_depth <= start_bracket)
                || (b == b'}' && braces.len() <= start_brace))
        {
            skip_arrow_expression = None;
        }

        match b {
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            b'=' if i + 1 < bytes.len() && bytes[i + 1] == b'>' => {
                after_arrow = true;
                i += 1;
            }
            b'{' => {
                if pending_function_body {
                    braces.push(JsBraceContext::Function);
                    function_depth += 1;
                    pending_function_body = false;
                } else if pending_class_body {
                    braces.push(JsBraceContext::Class);
                    class_depth += 1;
                    pending_class_body = false;
                } else {
                    let in_object_like_brace = matches!(
                        braces.last(),
                        Some(JsBraceContext::Normal { object_like: true })
                    );
                    braces.push(JsBraceContext::Normal {
                        object_like: is_likely_object_literal_open(source, i, in_object_like_brace),
                    });
                }
            }
            b'}' => {
                if let Some(context) = braces.pop() {
                    match context {
                        JsBraceContext::Function => {
                            function_depth = function_depth.saturating_sub(1)
                        }
                        JsBraceContext::Class => class_depth = class_depth.saturating_sub(1),
                        JsBraceContext::Normal { .. } => {}
                        JsBraceContext::TemplateExpression => {
                            match scan_template_characters(source, i + 1) {
                                JsTemplateBoundary::End(next) => i = next,
                                JsTemplateBoundary::Expression(next) => {
                                    braces.push(JsBraceContext::TemplateExpression);
                                    i = next;
                                }
                            }
                            continue;
                        }
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }

    false
}

fn is_likely_object_literal_open(source: &str, pos: usize, in_object_like_brace: bool) -> bool {
    matches!(
        previous_significant_code_byte(source, pos),
        Some(b'=' | b'(' | b'[' | b',' | b'?')
    ) || (in_object_like_brace && previous_significant_code_byte(source, pos) == Some(b':'))
}

fn is_top_level_await_expression(
    source: &str,
    start: usize,
    end: usize,
    in_object_like_brace: bool,
) -> bool {
    if previous_significant_code_byte(source, start) == Some(b'.') {
        return false;
    }

    let next = skip_ws_comments(source, end);
    if matches!(source.as_bytes().get(next), Some(b':')) {
        return false;
    }
    if in_object_like_brace && is_object_await_key(source, start, next) {
        return false;
    }
    true
}

fn is_object_await_key(source: &str, start: usize, next: usize) -> bool {
    if matches!(
        previous_significant_code_byte(source, start),
        Some(b'{' | b',' | b'*')
    ) {
        return matches!(source.as_bytes().get(next), Some(b'(' | b'}' | b','));
    }
    let Some((ident_start, ident)) = previous_identifier_before(source, start) else {
        return false;
    };
    matches!(source.as_bytes().get(next), Some(b'('))
        && matches!(ident, "get" | "set" | "async")
        && matches!(
            previous_significant_code_byte(source, ident_start),
            Some(b'{' | b',')
        )
}

fn source_looks_like_esm(source: &str) -> bool {
    source_has_static_import_or_export(source)
        || source_has_import_meta(source)
        || source_has_top_level_await(source, false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StaticModuleEdge {
    specifier: String,
    import_type: Option<String>,
}

fn module_statement_end(source: &str, start: usize) -> usize {
    let bytes = source.as_bytes();
    let mut i = start;
    let (mut braces, mut parens) = (0usize, 0usize);
    while i < bytes.len() {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        match bytes[i] {
            b'{' => braces += 1,
            b'}' => braces = braces.saturating_sub(1),
            b'(' => parens += 1,
            b')' => parens = parens.saturating_sub(1),
            b';' | b'\n' | b'\r' if braces == 0 && parens == 0 => return i,
            _ => {}
        }
        i = next_char_boundary(source, i);
    }
    source.len()
}

fn static_import_type_after(source: &str, start: usize, end: usize) -> Option<String> {
    let mut i = skip_ws_comments(source, start);
    i = parse_ident_name(source, i, "with")?;
    i = skip_ws_comments(source, i);
    if i >= end || source.as_bytes().get(i) != Some(&b'{') {
        return None;
    }
    let close = find_matching_brace(source, i)?;
    if close > end {
        return None;
    }
    i += 1;
    while i < close {
        i = skip_ws_comments(source, i);
        if source.as_bytes().get(i) == Some(&b',') {
            i += 1;
            continue;
        }
        let (key, next) = if matches!(source.as_bytes().get(i), Some(b'\'' | b'"')) {
            read_js_string(source, i)?
        } else {
            read_ident(source, i)?
        };
        i = skip_ws_comments(source, next);
        if source.as_bytes().get(i) != Some(&b':') {
            return None;
        }
        i = skip_ws_comments(source, i + 1);
        if key == "type" {
            return read_js_string(source, i).map(|(value, _)| value);
        }
        i = match source.as_bytes().get(i) {
            Some(b'\'' | b'"') => read_js_string(source, i)?.1,
            _ => {
                while i < close && source.as_bytes()[i] != b',' {
                    i = next_char_boundary(source, i);
                }
                i
            }
        };
    }
    None
}

fn static_module_edge_at(source: &str, pos: usize) -> Option<StaticModuleEdge> {
    let keyword_end = if let Some(end) = parse_ident_name(source, pos, "import") {
        end
    } else {
        parse_ident_name(source, pos, "export")?
    };
    let mut i = skip_ws_comments(source, keyword_end);
    if source.as_bytes().get(i) == Some(&b'(') {
        return None;
    }
    let statement_end = module_statement_end(source, i);
    if let Some((specifier, next)) = read_js_string(source, i) {
        return Some(StaticModuleEdge {
            specifier,
            import_type: static_import_type_after(source, next, statement_end),
        });
    }
    while i < statement_end {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        if let Some(from_end) = parse_ident_name(source, i, "from") {
            let specifier_start = skip_ws_comments(source, from_end);
            if let Some((specifier, next)) = read_js_string(source, specifier_start) {
                return Some(StaticModuleEdge {
                    specifier,
                    import_type: static_import_type_after(source, next, statement_end),
                });
            }
        }
        i = next_char_boundary(source, i);
    }
    None
}

fn collect_static_module_edges(source: &str) -> Vec<StaticModuleEdge> {
    let mut edges = Vec::new();
    let _ = scan_code_positions(source, true, |i, _| {
        if let Some(edge) = static_module_edge_at(source, i) {
            edges.push(edge);
        }
        ControlFlow::Continue(None)
    });
    edges
}

fn collect_literal_call_specifiers(source: &str, names: &[String]) -> Vec<String> {
    let mut specifiers = Vec::new();
    let _ = scan_code_positions(source, true, |i, _| {
        if previous_significant_code_byte(source, i) == Some(b'.') {
            return ControlFlow::Continue(None);
        }
        for name in names {
            let Some(name_end) = parse_ident_name(source, i, name) else {
                continue;
            };
            let open = skip_ws_comments(source, name_end);
            if source.as_bytes().get(open) == Some(&b'(')
                && let Some((specifier, _)) =
                    read_js_string(source, skip_ws_comments(source, open + 1))
            {
                specifiers.push(specifier);
            }
        }
        ControlFlow::Continue(None)
    });
    specifiers
}

fn collect_create_require_factory_names(source: &str) -> Vec<String> {
    let mut names = Vec::new();
    let _ = scan_code_positions(source, false, |i, _| {
        let Some((specifier, imports, end)) = parse_static_named_import(source, i) else {
            return ControlFlow::Continue(None);
        };
        if specifier == "module" || specifier == "node:module" {
            for import in imports {
                if import.imported == "createRequire" {
                    names.push(import.local);
                }
            }
        }
        ControlFlow::Continue(Some(end))
    });
    names
}

fn collect_create_require_specifiers(source: &str) -> Vec<String> {
    let factories = collect_create_require_factory_names(source);
    if factories.is_empty() {
        return Vec::new();
    }
    let mut aliases = Vec::new();
    let _ = scan_code_positions(source, false, |i, _| {
        let Some(declaration_end) = parse_variable_declaration_keyword(source, i) else {
            return ControlFlow::Continue(None);
        };
        let Some((alias, next)) = read_ident(source, skip_ws_comments(source, declaration_end))
        else {
            return ControlFlow::Continue(None);
        };
        let mut next = skip_ws_comments(source, next);
        if source.as_bytes().get(next) != Some(&b'=') {
            return ControlFlow::Continue(None);
        }
        next = skip_ws_comments(source, next + 1);
        if factories.iter().any(|name| {
            parse_ident_name(source, next, name)
                .map(|end| source.as_bytes().get(skip_ws_comments(source, end)) == Some(&b'('))
                .unwrap_or(false)
        }) {
            aliases.push(alias);
        }
        ControlFlow::Continue(None)
    });

    let mut specifiers = Vec::new();
    let _ = scan_code_positions(source, true, |i, _| {
        if previous_significant_code_byte(source, i) == Some(b'.') {
            return ControlFlow::Continue(None);
        }
        for factory in &factories {
            let Some(factory_end) = parse_ident_name(source, i, factory) else {
                continue;
            };
            let first_open = skip_ws_comments(source, factory_end);
            if source.as_bytes().get(first_open) != Some(&b'(') {
                continue;
            }
            let Some(first_close) = find_matching_paren(source, first_open) else {
                continue;
            };
            let second_open = skip_ws_comments(source, first_close + 1);
            if source.as_bytes().get(second_open) == Some(&b'(')
                && let Some((specifier, _)) =
                    read_js_string(source, skip_ws_comments(source, second_open + 1))
            {
                specifiers.push(specifier);
            }
        }
        ControlFlow::Continue(None)
    });
    specifiers.extend(collect_literal_call_specifiers(source, &aliases));
    specifiers
}

#[derive(Clone)]
struct CjsSourceBindingNames {
    reaction: String,
    trace: String,
    prepare_eval: String,
    native_eval: String,
}

fn cjs_source_binding_names(source: &str, inherited: Option<[String; 4]>) -> CjsSourceBindingNames {
    if let Some([reaction, trace, prepare_eval, native_eval]) = inherited {
        return CjsSourceBindingNames {
            reaction,
            trace,
            prepare_eval,
            native_eval,
        };
    }
    CjsSourceBindingNames {
        reaction: unique_internal_name(source, "__wasm_rquickjs_dynamic_import_reaction"),
        trace: unique_internal_name(source, "__wasm_rquickjs_dynamic_import_with_trace"),
        prepare_eval: unique_internal_name(source, "__wasm_rquickjs_prepare_cjs_eval_source"),
        native_eval: unique_internal_name(source, "__wasm_rquickjs_native_eval"),
    }
}

fn rewrite_cjs_direct_eval(
    source: &str,
    filename: &str,
    names: &CjsSourceBindingNames,
) -> (String, bool) {
    let bytes = source.as_bytes();
    let mut result = String::with_capacity(source.len());
    let mut i = 0usize;
    let mut copied = 0usize;
    let mut rewrote = false;
    while i < bytes.len() {
        if let Some(next) = skip_non_code(source, i, true) {
            i = next;
            continue;
        }
        let Some(eval_end) = parse_ident_name(source, i, "eval") else {
            i = next_char_boundary(source, i);
            continue;
        };
        if matches!(previous_significant_code_byte(source, i), Some(b'.' | b'#')) {
            i = eval_end;
            continue;
        }
        let open = skip_ws_comments(source, eval_end);
        if bytes.get(open) != Some(&b'(') {
            i = eval_end;
            continue;
        }
        let Some(close) = find_matching_paren(source, open) else {
            i = eval_end;
            continue;
        };
        if next_non_whitespace_byte(source, close + 1) == Some(b'{')
            || previous_word(source, i).is_some_and(|(word, _)| word == "function")
        {
            i = eval_end;
            continue;
        }
        let mut first_arg_end = close;
        let mut pos = open + 1;
        let (mut paren, mut bracket, mut brace) = (0usize, 0usize, 0usize);
        while pos < close {
            if let Some(next) = skip_non_code(source, pos, true) {
                pos = next;
                continue;
            }
            match bytes[pos] {
                b'(' => paren += 1,
                b')' => paren = paren.saturating_sub(1),
                b'[' => bracket += 1,
                b']' => bracket = bracket.saturating_sub(1),
                b'{' => brace += 1,
                b'}' => brace = brace.saturating_sub(1),
                b',' if paren == 0 && bracket == 0 && brace == 0 => {
                    first_arg_end = pos;
                    break;
                }
                _ => {}
            }
            pos = next_char_boundary(source, pos);
        }
        let first_code = skip_ws_comments(source, open + 1);
        if first_code >= first_arg_end || source[first_code..first_arg_end].starts_with("...") {
            i = eval_end;
            continue;
        }

        let first_arg = &source[open + 1..first_arg_end];
        result.push_str(&source[copied..open + 1]);
        result.push_str(&names.prepare_eval);
        result.push('(');
        result.push_str(first_arg);
        result.push(',');
        result.push_str(&format!("\"{}\"", escape_js_string(filename)));
        for name in [
            &names.reaction,
            &names.trace,
            &names.prepare_eval,
            &names.native_eval,
        ] {
            result.push(',');
            result.push_str(&format!("\"{}\"", escape_js_string(name)));
        }
        result.push_str(",eval)");
        result.push_str(&source[first_arg_end..close]);
        copied = close;
        i = close + 1;
        rewrote = true;
    }
    if !rewrote {
        return (source.to_string(), false);
    }
    result.push_str(&source[copied..]);
    (result, true)
}

fn rewrite_cjs_template_expressions(
    source: &str,
    filename: &str,
    names: &CjsSourceBindingNames,
    filename_expression: &str,
    parent_url_expression: &str,
) -> (String, bool) {
    let bytes = source.as_bytes();
    let mut result = String::with_capacity(source.len());
    let mut i = 0usize;
    let mut copied = 0usize;
    let mut rewrote = false;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            if let Some(next) = skip_non_code(source, i, true) {
                i = next;
                continue;
            }
            i = next_char_boundary(source, i);
            continue;
        }
        i += 1;
        while i < bytes.len() {
            if bytes[i] == b'\\' {
                i = (i + 2).min(bytes.len());
                continue;
            }
            if bytes[i] == b'`' {
                i += 1;
                break;
            }
            if bytes[i] == b'$' && bytes.get(i + 1) == Some(&b'{') {
                let expression_start = i + 2;
                let expression_after = skip_template_expression(source, expression_start);
                if expression_after == 0 || bytes.get(expression_after - 1) != Some(&b'}') {
                    i = expression_after;
                    continue;
                }
                let expression_end = expression_after.saturating_sub(1);
                let expression = &source[expression_start..expression_end];
                let (nested_templates, nested_rewrote) = rewrite_cjs_template_expressions(
                    expression,
                    filename,
                    names,
                    filename_expression,
                    parent_url_expression,
                );
                let processed = process_import_attrs(
                    &nested_templates,
                    filename,
                    Some((names.reaction.clone(), names.trace.clone())),
                    filename_expression,
                    parent_url_expression,
                );
                let (prepared, eval_rewrote) =
                    rewrite_cjs_direct_eval(&processed.source, filename, names);
                if nested_rewrote
                    || processed.dynamic_import_binding_names.is_some()
                    || eval_rewrote
                {
                    result.push_str(&source[copied..expression_start]);
                    result.push_str(&prepared);
                    copied = expression_end;
                    rewrote = true;
                }
                i = expression_after;
                continue;
            }
            i = next_char_boundary(source, i);
        }
    }
    if !rewrote {
        return (source.to_string(), false);
    }
    result.push_str(&source[copied..]);
    (result, true)
}

fn prepare_cjs_source<'js>(
    ctx: Ctx<'js>,
    source: String,
    filename: String,
    reaction: Option<String>,
    trace: Option<String>,
    prepare_eval: Option<String>,
    native_eval: Option<String>,
) -> rquickjs::Result<Object<'js>> {
    let inherited = match (reaction, trace, prepare_eval, native_eval) {
        (Some(reaction), Some(trace), Some(prepare_eval), Some(native_eval)) => {
            Some([reaction, trace, prepare_eval, native_eval])
        }
        _ => None,
    };
    let names = cjs_source_binding_names(&source, inherited);
    let filename_expression = format!("\"{}\"", escape_js_string(&filename));
    let parent_url_expression = format!("\"{}\"", escape_js_string(&path_to_file_url(&filename)));
    let (template_prepared, rewrote_template) = rewrite_cjs_template_expressions(
        &source,
        &filename,
        &names,
        &filename_expression,
        &parent_url_expression,
    );
    let processed = process_import_attrs(
        &template_prepared,
        &filename,
        Some((names.reaction.clone(), names.trace.clone())),
        &filename_expression,
        &parent_url_expression,
    );
    let (prepared, rewrote_eval) = rewrite_cjs_direct_eval(&processed.source, &filename, &names);
    let result = Object::new(ctx.clone())?;
    result.set("source", prepared)?;
    if processed.dynamic_import_binding_names.is_some() || rewrote_eval || rewrote_template {
        let bindings = Object::new(ctx)?;
        bindings.set("reactionName", names.reaction)?;
        bindings.set("traceName", names.trace)?;
        bindings.set("prepareEvalName", names.prepare_eval)?;
        bindings.set("nativeEvalName", names.native_eval)?;
        result.set("dynamicImportBindings", bindings)?;
    }
    Ok(result)
}

fn analyze_module_source<'js>(ctx: Ctx<'js>, source: String) -> rquickjs::Result<Object<'js>> {
    let analysis = Object::new(ctx.clone())?;
    analysis.set("looksLikeEsm", source_looks_like_esm(&source))?;
    analysis.set(
        "hasCjsWrapperLexicalRedeclaration",
        has_cjs_wrapper_lexical_redeclaration(&source),
    )?;
    let static_edges = rquickjs::Array::new(ctx.clone())?;
    for (index, edge) in collect_static_module_edges(&source).into_iter().enumerate() {
        let value = Object::new(ctx.clone())?;
        value.set("specifier", edge.specifier)?;
        if let Some(import_type) = edge.import_type {
            let attrs = Object::new(ctx.clone())?;
            attrs.set("typeValue", import_type)?;
            value.set("attrs", attrs)?;
        }
        static_edges.set(index, value)?;
    }
    analysis.set("staticEdges", static_edges)?;
    let require_specifiers = rquickjs::Array::new(ctx.clone())?;
    for (index, specifier) in collect_literal_call_specifiers(&source, &["require".to_string()])
        .into_iter()
        .enumerate()
    {
        require_specifiers.set(index, specifier)?;
    }
    analysis.set("requireSpecifiers", require_specifiers)?;
    let create_require_specifiers = rquickjs::Array::new(ctx)?;
    for (index, specifier) in collect_create_require_specifiers(&source)
        .into_iter()
        .enumerate()
    {
        create_require_specifiers.set(index, specifier)?;
    }
    analysis.set("createRequireSpecifiers", create_require_specifiers)?;
    Ok(analysis)
}

fn module_has_exec_argv_flag(ctx: Ctx<'_>, flag: String) -> rquickjs::Result<bool> {
    let process_value: Value = ctx.globals().get("process")?;
    let Some(process) = process_value.into_object() else {
        return Ok(false);
    };
    let exec_argv_value: Value = process.get("execArgv")?;
    if rquickjs::Array::from_value(exec_argv_value).is_err() {
        return Ok(false);
    }
    let prefixed = format!("{flag}=");
    let mut i = 0;
    loop {
        let current_exec_argv: Value = process.get("execArgv")?;
        let Some(exec_argv) = current_exec_argv.into_object() else {
            return Ok(false);
        };
        let length: usize = exec_argv.get("length")?;
        if i >= length {
            break;
        }
        let value: Value = exec_argv.get(i as u32)?;
        let string_constructor: Function = ctx.globals().get("String")?;
        let arg: String = string_constructor.call((value,))?;
        if arg == flag || arg.starts_with(&prefixed) {
            return Ok(true);
        }
        i += 1;
    }
    Ok(false)
}

fn classify_module_specifier(specifier: String) -> bool {
    is_relative_or_absolute_specifier(&specifier)
}

fn split_module_package_name<'js>(
    ctx: Ctx<'js>,
    specifier: String,
) -> rquickjs::Result<Object<'js>> {
    let (name, subpath) =
        NodeModulesResolver::split_package_name(&specifier).unwrap_or((specifier.as_str(), ""));
    let result = Object::new(ctx)?;
    result.set("name", name)?;
    result.set("subpath", subpath)?;
    Ok(result)
}

fn source_has_static_import_or_export(source: &str) -> bool {
    scan_code_positions(source, true, |i, _| {
        if parse_ident_name(source, i, "export").is_some() && is_static_export_syntax(source, i) {
            return ControlFlow::Break(());
        }
        if parse_ident_name(source, i, "import").is_some() && is_static_import_syntax(source, i) {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(None)
    })
    .is_break()
        || source_has_line_start_static_import_or_export(source)
}

fn source_has_line_start_static_import_or_export(source: &str) -> bool {
    let bytes = source.as_bytes();
    let mut i = 0usize;
    let mut at_line_start = true;
    let mut in_block_comment = false;
    let mut in_string: Option<u8> = None;

    while i < bytes.len() {
        if in_block_comment {
            if i + 1 < bytes.len() && bytes[i] == b'*' && bytes[i + 1] == b'/' {
                in_block_comment = false;
                i += 2;
            } else {
                at_line_start = matches!(bytes[i], b'\n' | b'\r');
                i += 1;
            }
            continue;
        }

        if let Some(quote) = in_string {
            match bytes[i] {
                b'\\' => i = (i + 2).min(bytes.len()),
                b if b == quote => {
                    in_string = None;
                    at_line_start = false;
                    i += 1;
                }
                b'\n' | b'\r' => {
                    at_line_start = true;
                    i += 1;
                }
                _ => i += 1,
            }
            continue;
        }

        if at_line_start {
            while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | 0x0b | 0x0c) {
                i += 1;
            }
            if i >= bytes.len() {
                break;
            }
            if matches!(bytes[i], b'\n' | b'\r') {
                i += 1;
                at_line_start = true;
                continue;
            }
            if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                at_line_start = true;
                continue;
            }
            if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
                in_block_comment = true;
                i += 2;
                continue;
            }
            let line = &source[i..];
            if line_starts_with_static_export(line) || line_starts_with_static_import(line) {
                return true;
            }
            at_line_start = false;
        }

        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                in_string = Some(bytes[i]);
                i += 1;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                at_line_start = true;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                in_block_comment = true;
                i += 2;
            }
            b'\n' | b'\r' => {
                at_line_start = true;
                i += 1;
            }
            _ => i += 1,
        }
    }
    false
}

fn line_starts_with_static_export(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("export") else {
        return false;
    };
    if rest
        .chars()
        .next()
        .is_some_and(|ch| is_ident_continue(ch as u8))
    {
        return false;
    }
    let rest = rest.trim_start();
    rest.starts_with('{')
        || rest.starts_with('*')
        || ["default", "const", "let", "var", "function", "class"]
            .iter()
            .any(|keyword| {
                rest.starts_with(keyword)
                    && rest[keyword.len()..]
                        .chars()
                        .next()
                        .is_none_or(|ch| !is_ident_continue(ch as u8))
            })
}

fn line_starts_with_static_import(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("import") else {
        return false;
    };
    if rest
        .chars()
        .next()
        .is_some_and(|ch| is_ident_continue(ch as u8))
    {
        return false;
    }
    let rest = rest.trim_start();
    if rest.starts_with('(') || rest.starts_with(':') {
        return false;
    }
    rest.starts_with('"')
        || rest.starts_with('\'')
        || rest.starts_with('{')
        || rest.starts_with('*')
        || rest
            .chars()
            .next()
            .is_some_and(|ch| is_js_identifier_start(ch as u8))
}

fn source_has_import_meta(source: &str) -> bool {
    scan_import_meta_positions(source, |i| {
        if parse_import_meta(source, i).is_some()
            && !is_static_import_syntax(source, i)
            && previous_significant_byte(source, i) != Some(b'.')
        {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(None)
    })
    .is_break()
}

fn scan_import_meta_positions<F>(source: &str, mut visitor: F) -> ControlFlow<()>
where
    F: FnMut(usize) -> ControlFlow<(), Option<usize>>,
{
    let bytes = source.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' => {
                i = skip_string_or_template(source, i);
                continue;
            }
            b'`' => {
                if template_contains_import_meta(source, i) {
                    return ControlFlow::Break(());
                }
                i = skip_string_or_template(source, i);
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
            b'/' if is_regex_literal_start(source, i) => {
                i = skip_regex_literal(source, i);
                continue;
            }
            _ => {}
        }

        match visitor(i) {
            ControlFlow::Break(()) => return ControlFlow::Break(()),
            ControlFlow::Continue(Some(next)) => i = next,
            ControlFlow::Continue(None) => i = next_char_boundary(source, i),
        }
    }
    ControlFlow::Continue(())
}

fn template_contains_import_meta(source: &str, template_start: usize) -> bool {
    let bytes = source.as_bytes();
    let mut i = template_start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i = (i + 2).min(bytes.len()),
            b'`' => return false,
            b'$' if i + 1 < bytes.len() && bytes[i + 1] == b'{' => {
                let expression_start = i + 2;
                let expression_end = skip_template_expression(source, expression_start);
                let expression_end = expression_end.saturating_sub(1).min(source.len());
                if expression_start <= expression_end
                    && source
                        .get(expression_start..expression_end)
                        .is_some_and(source_has_import_meta)
                {
                    return true;
                }
                i = expression_end + 1;
            }
            _ => i += 1,
        }
    }
    false
}

fn is_static_export_syntax(source: &str, pos: usize) -> bool {
    if previous_significant_byte(source, pos) == Some(b'.') {
        return false;
    }
    let next = skip_ws_comments(source, pos + "export".len());
    if source.as_bytes().get(next) == Some(&b':') {
        return false;
    }
    match source.as_bytes().get(next).copied() {
        Some(b'{' | b'*') => true,
        _ => ["default", "const", "let", "var", "function", "class"]
            .iter()
            .any(|keyword| parse_ident_name(source, next, keyword).is_some()),
    }
}

fn is_static_import_syntax(source: &str, pos: usize) -> bool {
    if previous_significant_byte(source, pos) == Some(b'.') {
        return false;
    }
    let next = skip_ws_comments(source, pos + "import".len());
    if matches!(source.as_bytes().get(next), Some(b'(' | b':')) {
        return false;
    }
    matches!(
        source.as_bytes().get(next).copied(),
        Some(b'\'' | b'"' | b'{' | b'*')
    ) || source
        .as_bytes()
        .get(next)
        .copied()
        .is_some_and(is_js_identifier_start)
}

fn is_js_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic()
}

fn is_js_identifier_continue(byte: u8) -> bool {
    is_js_identifier_start(byte) || byte.is_ascii_digit()
}

fn inject_module_source_prologue(
    main_filename: Option<&str>,
    source: &str,
    dynamic_import_binding_names: Option<&(String, String)>,
) -> String {
    let global_name = unique_internal_name(source, "__wasm_rquickjs_global");
    let mut prologue = format!("const {global_name}=import.meta.__wasm_rquickjs_global;");
    if let Some((dynamic_import_reaction_name, dynamic_import_with_trace_name)) =
        dynamic_import_binding_names
    {
        prologue.push_str(&format!(
            "const {dynamic_import_reaction_name}={global_name}.__wasm_rquickjs_dynamic_import_reaction;const {dynamic_import_with_trace_name}={global_name}.__wasm_rquickjs_dynamic_import_with_trace;"
        ));
    }
    let declared_cjs_globals = collect_declared_cjs_globals_in_esm(source);
    let shadowed_cjs_globals: Vec<&str> = ["require"]
        .iter()
        .copied()
        .filter(|name| !declared_cjs_globals.iter().any(|declared| declared == name))
        .collect();
    if !shadowed_cjs_globals.is_empty() {
        prologue.push_str("var ");
        prologue.push_str(&shadowed_cjs_globals.join(","));
        prologue.push(';');
    }
    let main_expr = main_filename
        .map(|filename| {
            format!(
                "!!({global_name}.process&&{global_name}.Array.isArray({global_name}.process.argv)&&{global_name}.process.argv[1]===\"{}\")",
                escape_js_string(filename)
            )
        })
        .unwrap_or_else(|| "false".to_string());
    let source = rewrite_import_meta_main(source, &main_expr);

    if let Some(rest) = source.strip_prefix("#!") {
        if let Some(newline_pos) = rest.find('\n') {
            let shebang_line = &source[..2 + newline_pos + 1];
            let remaining = &source[2 + newline_pos + 1..];
            format!("{}{}\n{}", shebang_line, prologue, remaining)
        } else {
            // Shebang with no newline — entire file is the shebang
            format!("{}\n{}", source, prologue)
        }
    } else {
        format!("{}\n{}", prologue, source)
    }
}

fn virtual_builtin_module_source(source: &str) -> String {
    inject_module_source_prologue(None, source, None)
}

#[derive(Default)]
struct VirtualBuiltinModuleLoader {
    modules: HashMap<String, String>,
}

impl VirtualBuiltinModuleLoader {
    fn with_module(mut self, name: impl Into<String>, source: String) -> Self {
        self.modules.insert(name.into(), source);
        self
    }
}

impl Loader for VirtualBuiltinModuleLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let Some(source) = self.modules.get(path) else {
            return Err(Error::new_loading(path));
        };
        let init =
            url_only_import_meta_init(format!("file:///__wasm_rquickjs_virtual__/{}.mjs", path));
        declare_module_with_import_meta(ctx, path, source, &init)
    }
}

pub(crate) async fn initialize_module_loading(rt: &AsyncRuntime, ctx: &AsyncContext) {
    let mut builtin_resolver = BuiltinResolver::default().with_module(crate::JS_EXPORT_MODULE_NAME);
    for (name, _) in crate::JS_ADDITIONAL_MODULES.iter() {
        builtin_resolver = builtin_resolver.with_module(name.to_string());
    }
    let builtin_resolver = crate::modules::add_native_module_resolvers(builtin_resolver);
    let builtin_resolver = crate::builtin::add_module_resolvers(builtin_resolver);

    let file_resolver = FileResolver::default()
        .with_path("/")
        .with_pattern("{}.js")
        .with_pattern("{}.mjs")
        .with_pattern("{}.json");
    let loader_cjs_facades = LoaderCjsFacadeRegistry::default();

    let resolver = (
        (
            RealmGuardResolver,
            MockModuleResolver,
            DataUrlResolver,
            FileUrlResolver,
            PrivateBuiltinResolverGuard,
            LoaderCjsFacadeResolver(loader_cjs_facades.clone()),
            RegisteredLoaderResolver,
        ),
        (
            builtin_resolver,
            NodeBuiltinNamespaceGuard,
            NodeModulesResolver,
            NodeFileResolver,
        ),
        (CjsEvalResolver, file_resolver, NodeModuleErrorResolver),
    );

    let mut virtual_builtin_loader = VirtualBuiltinModuleLoader::default().with_module(
        crate::JS_EXPORT_MODULE_NAME,
        virtual_builtin_module_source(crate::js_export_module()),
    );
    for (name, get_module) in crate::JS_ADDITIONAL_MODULES.iter() {
        virtual_builtin_loader = virtual_builtin_loader.with_module(
            name.to_string(),
            virtual_builtin_module_source(&(get_module)()),
        );
    }

    let loader = (
        (
            MockModuleLoader,
            virtual_builtin_loader,
            crate::modules::module_loader(),
            crate::builtin::module_loader(),
            LoaderCjsFacadeLoader(loader_cjs_facades.clone()),
            DataUrlLoader,
            StaticRegisteredFileUrlLoader,
        ),
        (JsonFileLoader, CjsCompatLoader, ImportMetaLoader),
    );

    rt.set_loader(resolver, loader).await;

    async_with!(ctx => |ctx| {
        let global = ctx.globals();

        global.set("__wasm_rquickjs_mock_seq", 0i64)
            .expect("Failed to initialize mock sequence counter");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_register_import_attr_rewrite",
            Function::new(ctx.clone(), |specifier: String, import_type: String| {
                if import_type == "json" {
                    append_import_type_query(&specifier, &import_type)
                } else {
                    specifier
                }
            })
            .expect("Failed to create import attribute rewrite registrar"),
        )
        .expect("Failed to initialize import attribute rewrite registrar");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_register_loader_source_url",
            Function::new(
                ctx.clone(),
                |specifier: String, source_url: String| {
                    register_loader_source_url(&specifier, &source_url)
                },
            )
            .expect("Failed to create loader source URL registrar"),
        )
        .expect("Failed to initialize loader source URL registrar");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_lookup_loader_source_url",
            Function::new(ctx.clone(), |specifier: String| {
                DataUrlLoader::source_url(&specifier)
            })
            .expect("Failed to create loader source URL lookup"),
        )
        .expect("Failed to initialize loader source URL lookup");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_discard_import_attr_rewrite",
            Function::new(ctx.clone(), |specifier: String| {
                discard_generated_import_type_rewrite_token(&specifier);
            })
            .expect("Failed to create import attribute rewrite discard"),
        )
        .expect("Failed to initialize import attribute rewrite discard");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_build_loader_cjs_facade",
            Function::new(ctx.clone(), {
                let loader_cjs_facades = loader_cjs_facades.clone();
                move |ctx, filename, source_url, cache_key, source| {
                    build_loader_cjs_facade(
                        &loader_cjs_facades,
                        ctx,
                        filename,
                        source_url,
                        cache_key,
                        source,
                    )
                }
            })
            .expect("Failed to create loader CJS facade builder"),
        )
        .expect("Failed to initialize loader CJS facade builder");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_analyze_module_source",
            Function::new(ctx.clone(), analyze_module_source)
                .expect("Failed to create module source analyzer"),
        )
        .expect("Failed to initialize module source analyzer");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_prepare_cjs_source",
            Function::new(ctx.clone(), prepare_cjs_source)
                .expect("Failed to create CJS source preparer"),
        )
        .expect("Failed to initialize CJS source preparer");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_module_has_exec_argv_flag",
            Function::new(ctx.clone(), module_has_exec_argv_flag)
                .expect("Failed to create module runtime flag analyzer"),
        )
        .expect("Failed to initialize module runtime flag analyzer");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_classify_module_specifier",
            Function::new(ctx.clone(), classify_module_specifier)
                .expect("Failed to create module specifier classifier"),
        )
        .expect("Failed to initialize module specifier classifier");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_split_module_package_name",
            Function::new(ctx.clone(), split_module_package_name)
                .expect("Failed to create module package-name splitter"),
        )
        .expect("Failed to initialize module package-name splitter");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_import_meta_resolve_package",
            Function::new(ctx.clone(), import_meta_resolve_package)
                .expect("Failed to create import.meta package resolver"),
        )
        .expect("Failed to initialize import.meta package resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_import_meta_resolve_path",
            Function::new(ctx.clone(), import_meta_resolve_path)
                .expect("Failed to create import.meta path resolver"),
        )
        .expect("Failed to initialize import.meta path resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_loader_default_resolve_package",
            Function::new(ctx.clone(), loader_default_resolve_package)
                .expect("Failed to create loader default package resolver"),
        )
        .expect("Failed to initialize loader default package resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_resolve_package_exports",
            Function::new(ctx.clone(), cjs_resolve_package_exports)
                .expect("Failed to create CJS package exports resolver"),
        )
        .expect("Failed to initialize CJS package exports resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_with_cjs_module_probe_session",
            Function::new(ctx.clone(), with_cjs_module_probe_session)
                .expect("Failed to create scoped CJS module probe-session runner"),
        )
        .expect("Failed to initialize scoped CJS module probe-session runner");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_module_path_stat",
            Function::new(ctx.clone(), cjs_module_path_stat)
                .expect("Failed to create CJS module path classifier"),
        )
        .expect("Failed to initialize CJS module path classifier");

        #[cfg(feature = "test-observability")]
        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_get_cjs_module_probe_session_hit_count",
            Function::new(ctx.clone(), cjs_module_probe_session_hit_count)
                .expect("Failed to create CJS module probe-session hit counter"),
        )
        .expect("Failed to initialize CJS module probe-session hit counter");

        #[cfg(feature = "test-observability")]
        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_reset_cjs_module_probe_session_hit_count",
            Function::new(ctx.clone(), reset_cjs_module_probe_session_hit_count)
                .expect("Failed to create CJS module probe-session hit counter reset"),
        )
        .expect("Failed to initialize CJS module probe-session hit counter reset");

        #[cfg(feature = "test-observability")]
        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_set_cjs_module_probe_session_enabled",
            Function::new(ctx.clone(), set_cjs_module_probe_session_enabled)
                .expect("Failed to create CJS module probe-session test control"),
        )
        .expect("Failed to initialize CJS module probe-session test control");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_resolve_package_self_reference",
            Function::new(ctx.clone(), cjs_resolve_package_self_reference)
                .expect("Failed to create CJS package self-reference resolver"),
        )
        .expect("Failed to initialize CJS package self-reference resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_package_scope_info",
            Function::new(ctx.clone(), cjs_package_scope_info)
                .expect("Failed to create CJS package scope classifier"),
        )
        .expect("Failed to initialize CJS package scope classifier");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_source_uses_esm_format",
            Function::new(ctx.clone(), source_uses_esm_format)
                .expect("Failed to create source format classifier"),
        )
        .expect("Failed to initialize source format classifier");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_resolve_package_fallback",
            Function::new(ctx.clone(), cjs_resolve_package_fallback)
                .expect("Failed to create CJS package fallback resolver"),
        )
        .expect("Failed to initialize CJS package fallback resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_cjs_resolve_file_candidate",
            Function::new(ctx.clone(), cjs_resolve_file_candidate)
                .expect("Failed to create CJS file candidate resolver"),
        )
        .expect("Failed to initialize CJS file candidate resolver");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_package_global_conditions",
            Function::new(ctx.clone(), package_global_conditions)
                .expect("Failed to create package global condition provider"),
        )
        .expect("Failed to initialize package global condition provider");

        set_non_replaceable_global(
            &global,
            "__wasm_rquickjs_require_esm_graph_resolve_package",
            Function::new(ctx.clone(), require_esm_graph_resolve_package)
                .expect("Failed to create require(esm) graph package resolver"),
        )
        .expect("Failed to initialize require(esm) graph package resolver");
    })
    .await;
}

fn rewrite_import_meta_main(source: &str, replacement: &str) -> String {
    let mut spans = Vec::new();
    let _ = scan_code_positions(source, true, |i, _| {
        if let Some(end) = parse_import_meta_main_span(source, i) {
            spans.push((i, end));
            ControlFlow::Continue(Some(end))
        } else {
            ControlFlow::Continue(None)
        }
    });

    if spans.is_empty() {
        return source.to_string();
    }

    let mut rewritten = source.to_string();
    for (start, end) in spans.into_iter().rev() {
        rewritten.replace_range(start..end, replacement);
    }
    rewritten
}

fn parse_import_meta_main_span(source: &str, pos: usize) -> Option<usize> {
    let mut i = parse_ident_name(source, pos, "import")?;
    if matches!(
        previous_significant_byte_before_import_meta(source, pos),
        Some(b'.' | b'#')
    ) {
        return None;
    }
    i = skip_ws_comments(source, i);
    if source.as_bytes().get(i) != Some(&b'.') {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    i = parse_ident_name(source, i, "meta")?;
    i = skip_ws_comments(source, i);
    if source.as_bytes().get(i) != Some(&b'.') {
        return None;
    }
    i = skip_ws_comments(source, i + 1);
    parse_ident_name(source, i, "main")
}

#[derive(Clone, Copy)]
enum EsmFilePreflightMode {
    RequireOnly,
    PackageTypeModuleJs,
}

fn esm_file_preflight_error_module_source(
    source: &str,
    mode: EsmFilePreflightMode,
    raw_cjs_global_messages: bool,
) -> Option<String> {
    match mode {
        EsmFilePreflightMode::RequireOnly => {
            esm_require_global_preflight_error_module_source(source, raw_cjs_global_messages)
        }
        EsmFilePreflightMode::PackageTypeModuleJs => {
            esm_preflight_error_module_source(source, true, raw_cjs_global_messages)
        }
    }
}

fn declare_esm_file_module<'js>(
    ctx: &Ctx<'js>,
    module_id: &str,
    fs_path: &str,
    source_path: &str,
    url: String,
    preflight_mode: EsmFilePreflightMode,
) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
    let source = read_module_source_or_throw(ctx, module_id, source_path)?;
    declare_esm_file_module_from_source(ctx, module_id, fs_path, source, url, preflight_mode)
}

fn declare_esm_file_module_from_source<'js>(
    ctx: &Ctx<'js>,
    module_id: &str,
    fs_path: &str,
    raw_source: String,
    url: String,
    preflight_mode: EsmFilePreflightMode,
) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
    let fs_abs_path = ensure_absolute_path(fs_path);
    let module_abs_path = ensure_absolute_path(module_id);
    let processed = process_static_import_attrs(&raw_source, module_id);
    let source = &processed.source;
    let init = file_import_meta_init(url, fs_abs_path.clone());
    let raw_cjs_global_messages = require_esm_in_progress(ctx, &fs_abs_path, &init.url);

    let globals = ctx.globals();
    if let Ok(cache) = globals.get::<_, Object>("__esm_error_cache")
        && let Ok(cached_error) = cache.get::<_, Value>(module_id)
        && !cached_error.is_undefined()
    {
        return Err(ctx.throw(cached_error));
    }

    if let Some(error_source) =
        esm_file_preflight_error_module_source(source, preflight_mode, raw_cjs_global_messages)
    {
        return Module::declare(ctx.clone(), module_id, error_source.as_bytes().to_vec());
    }
    if let Some(error_source) = cjs_named_import_error_module_source(ctx, &fs_abs_path, source) {
        return Module::declare(ctx.clone(), module_id, error_source.as_bytes().to_vec());
    }

    let has_top_level_await = source_has_top_level_await(source, true);
    let injected = inject_module_source_prologue(
        init.filename.as_deref(),
        source,
        processed.dynamic_import_binding_names.as_ref(),
    );
    if let Ok(register_source_map) =
        globals.get::<_, Function>("__wasm_rquickjs_register_transformed_source_map")
    {
        register_source_map.call::<_, ()>((
            fs_abs_path.as_str(),
            injected.as_str(),
            module_id,
            1,
            0,
            true,
        ))?;
    }
    match declare_module_with_import_meta(ctx, module_id, &injected, &init) {
        Ok(module) => {
            if has_top_level_await {
                mark_async_esm_module(ctx, &globals, &module_abs_path, &init.url)?;
            }
            Ok(module)
        }
        Err(Error::Exception) => {
            let exception = ctx.catch();

            let cache: Object = match globals.get::<_, Value>("__esm_error_cache") {
                Ok(v) if v.is_object() => v.into_object().unwrap(),
                _ => {
                    let obj =
                        Object::new(ctx.clone()).map_err(|_| Error::new_loading(module_id))?;
                    globals
                        .set("__esm_error_cache", obj.clone())
                        .map_err(|_| Error::new_loading(module_id))?;
                    obj
                }
            };
            cache
                .set(module_id, exception.clone())
                .map_err(|_| Error::new_loading(module_id))?;

            Err(ctx.throw(exception))
        }
        Err(e) => Err(e),
    }
}

struct ImportMetaLoader;

impl Loader for ImportMetaLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let fs_path = module_filesystem_path(path);
        let is_extensionless = std::path::Path::new(fs_path).extension().is_none();
        if !fs_path.ends_with(".mjs") && !is_extensionless {
            let ext = std::path::Path::new(fs_path)
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| format!(".{}", ext))
                .unwrap_or_default();
            let globals = ctx.globals();
            let type_error_ctor: Function = globals.get("TypeError")?;
            let error_obj: Object = type_error_ctor
                .call((format!("Unknown file extension {:?} for {}", ext, fs_path),))?;
            error_obj.set("code", "ERR_UNKNOWN_FILE_EXTENSION")?;
            return Err(ctx.throw(error_obj.into_value()));
        }
        if import_attr_type_from_path(path).as_deref() == Some("json") {
            return throw_import_attr_type_incompatible(ctx);
        }

        let source_path = module_source_filesystem_path(ctx, path);
        declare_esm_file_module(
            ctx,
            path,
            fs_path,
            &source_path,
            path_to_file_url(path),
            EsmFilePreflightMode::RequireOnly,
        )
    }
}

/// Loader that handles `.json` files imported via `import()` with `type: 'json'`.
/// Wraps JSON content in a synthetic ESM module with a default export.
struct JsonFileLoader;

impl Loader for JsonFileLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let fs_path = module_filesystem_path(path);
        if !fs_path.ends_with(".json") {
            return Err(Error::new_loading(path));
        }

        let import_attr_type = import_attr_type_from_path(path);
        let source_path = module_source_filesystem_path(ctx, path);
        let source = std::fs::read_to_string(&source_path).map_err(|_| Error::new_loading(path))?;
        let module_source = if import_attr_type.as_deref() != Some("json") {
            json_import_attribute_missing_module_source(path)
        } else {
            let original_path = strip_import_type_rewrite_token(path);
            let cjs_cache = if split_module_path_suffix(&original_path).1.is_empty() {
                Some(JsonModuleCjsCache {
                    filename: fs_path,
                    dirname: std::path::Path::new(fs_path)
                        .parent()
                        .and_then(|path| path.to_str())
                        .unwrap_or("/"),
                })
            } else {
                None
            };
            json_module_source(&source, cjs_cache)
        };
        let init = file_import_meta_init(path_to_file_url(path), fs_path.to_string());
        declare_module_with_import_meta(ctx, path, &module_source, &init)
    }
}

#[cfg(test)]
mod cjs_export_analyzer_tests {
    use super::*;

    #[test]
    fn data_url_separator_uses_first_comma() {
        assert_eq!(
            DataUrlLoader::content_separator_pos(r#"application/json;foo="test,""this""#),
            Some(r#"application/json;foo="test"#.len())
        );
        assert_eq!(
            DataUrlLoader::content_separator_pos(r#"application/json;foo="test\,",0"#),
            Some(r#"application/json;foo="test\"#.len())
        );
        assert_eq!(
            DataUrlLoader::content_separator_pos("application/json;foo=test%2C,0"),
            Some("application/json;foo=test%2C".len())
        );
        let rewritten =
            append_import_type_query(r#"data:application/json;foo="test,""this""#, "json");
        assert!(
            rewritten.starts_with(
                r#"data:application/json;foo="test;__wasm_rquickjs_import_type=json-"#
            )
        );
        assert!(rewritten.ends_with(r#",""this""#));
        assert_eq!(
            import_attr_type_from_path(
                r#"data:application/json;__wasm_rquickjs_import_type=json,0"#
            ),
            None
        );
        assert_eq!(
            import_attr_type_from_path(&rewritten),
            Some("json".to_string())
        );
        assert_eq!(
            split_module_path_suffix(
                r#"data:application/json,"?__wasm_rquickjs_import_type=json""#
            ),
            (
                r#"data:application/json,"?__wasm_rquickjs_import_type=json""#,
                ""
            )
        );
        assert_eq!(
            split_module_path_suffix(r#"data:text/javascript,var x = "hello world?""#),
            (r#"data:text/javascript,var x = "hello world?""#, "")
        );

        let relative_rewritten = append_import_type_query("./test.json", "json");
        let (_, suffix) = split_module_path_suffix(&relative_rewritten);
        let resolved_rewritten = format!("/app/test.json{suffix}");
        assert_eq!(import_attr_type_from_path(&resolved_rewritten), None);

        let relative_rewritten = append_import_type_query("./test.json", "json");
        let (_, suffix) = split_module_path_suffix(&relative_rewritten);
        let resolved_rewritten = format!("/app/test.json{suffix}");
        transfer_import_type_rewrite_token(&relative_rewritten, &resolved_rewritten);
        assert_eq!(
            import_attr_type_from_path(&resolved_rewritten),
            Some("json".to_string())
        );
    }

    #[test]
    fn dynamic_import_rewrite_handles_array_commas() {
        let source = r#"
            await Promise.all([
                import("./plain.json"),
                import("./typed.json", { with: { type: "json" } }),
            ]);
        "#;
        let rewritten = process_static_import_attrs(source, "/app/main.mjs");

        assert!(
            rewritten
                .source
                .contains("__wasm_rquickjs_import_attr_dynamic_import")
        );
        assert!(
            rewritten
                .source
                .contains(r#"./typed.json", { with: { type: "json" } }"#)
        );
        assert!(!rewritten.source.contains(r#"import("./typed.json","#));
    }

    #[test]
    fn dynamic_import_rewrite_uses_collision_free_helper_names() {
        let source = r#"
            const __wasm_rquickjs_dynamic_import_reaction = "user";
            const __wasm_rquickjs_dynamic_import_with_trace = "user";
            await import("./plain.mjs");
        "#;
        let rewritten = process_static_import_attrs(source, "/app/main.mjs");
        let injected = inject_module_source_prologue(
            None,
            &rewritten.source,
            rewritten.dynamic_import_binding_names.as_ref(),
        );

        assert!(injected.contains(
            "const __wasm_rquickjs_dynamic_import_reaction_1=__wasm_rquickjs_global.__wasm_rquickjs_dynamic_import_reaction;const __wasm_rquickjs_dynamic_import_with_trace_1=__wasm_rquickjs_global.__wasm_rquickjs_dynamic_import_with_trace;"
        ));
        assert_eq!(
            injected
                .matches("import.meta.__wasm_rquickjs_global")
                .count(),
            1
        );
        assert!(!injected.contains("globalThis.__wasm_rquickjs_dynamic_import_reaction"));
        assert!(!injected.contains("globalThis.__wasm_rquickjs_dynamic_import_with_trace"));
        assert!(injected.contains("__wasm_rquickjs_dynamic_import_reaction_1(()=>__wasm_rquickjs_dynamic_import_with_trace_1("));
    }

    #[test]
    fn dynamic_import_rewrite_preserves_object_method_shorthand() {
        let source = r#"
            const obj = {
                import(value) { return ["method", value]; },
                async importAsync(value) { return value; },
                *importGenerator(value) { yield value; },
                get importGetter() { return "getter"; },
                set importSetter(value) { this.value = value; },
            };
            const asyncObj = { async import(value) { return value; } };
            const generatorObj = { *import(value) { yield value; } };
            const asyncGeneratorObj = { async * import(value) { yield value; } };
            const getterObj = { get import() { return "getter"; } };
            const setterObj = { set import(value) { this.value = value; } };
            class ImportMethods {
                import(value) { return value; }
                static import(value) { return value; }
                static get importGetterStatic() { return "getter"; }
                async importAsync(value) { return value; }
                *importGenerator(value) { yield value; }
                async * importAsyncGenerator(value) { yield value; }
                get importGetter() { return "getter"; }
                set importSetter(value) { this.value = value; }
            }
            class AsyncImportMethod { async import(value) { return value; } }
            class GeneratorImportMethod { *import(value) { yield value; } }
            class StaticImportMethod { static import(value) { return value; } }
            class StaticGetterImportMethod { static get import() { return "getter"; } }
            class AsyncGeneratorImportMethod { async * import(value) { yield value; } }
            class GetterImportMethod { get import() { return "getter"; } }
            class SetterImportMethod { set import(value) { this.value = value; } }
            obj.import("value");
        "#;

        let processed = process_static_import_attrs(source, "/app/main.mjs");
        assert_eq!(processed.source, source);
        assert!(processed.dynamic_import_binding_names.is_none());
    }

    #[test]
    fn import_attribute_scanner_handles_non_ascii_keyword_prefixes() {
        let source = r#"const imporあ = 1;
const あimport = () => "identifier";
const importあ = "identifier";
import { あfrom as fromあ, value as froあ } from "./dep.js";
import "./dep.js" assertあ;
import "./dep.js" withあ;
"#;

        let processed = process_static_import_attrs(source, "/app/main.mjs");

        assert_eq!(processed.source, source);
        assert!(processed.dynamic_import_binding_names.is_none());
    }

    fn assert_analysis(source: &str, is_cjs: bool, exports: &[&str], reexports: &[&str]) {
        let analysis = analyze_cjs_exports(source);
        assert_eq!(analysis.is_cjs, is_cjs, "is_cjs mismatch for {source}");
        assert_eq!(analysis.exports, exports, "exports mismatch for {source}");
        assert_eq!(
            analysis.reexports, reexports,
            "reexports mismatch for {source}"
        );
    }

    fn assert_cjs_global(source: &str, expected: Option<&str>) {
        assert_eq!(
            find_bare_cjs_global_in_esm(source),
            expected,
            "CJS global detection mismatch for {source}"
        );
    }

    #[test]
    fn detects_supported_cjs_export_patterns() {
        assert_analysis(
            r#"
                exports.foo = 1;
                module.exports.bar = 2;
                exports["baz"] = 3;
                Object.defineProperty(exports, "valueExport", { value: 4 });
                Object.defineProperty(module.exports, "getterExport", { get() { return dep.value; } });
                Object.defineProperty(exports, "functionGetter", { get: function () { return dep["other"]; } });
                Object.defineProperty(exports, "valueThenValue", { value: "first", value: "second" });
                Object.defineProperty(exports, "valueThenString", { value: "good", "value": "string-wins" });
                Object.defineProperty(exports, "valueThenComputed", { value: "good", ["value"]: "computed-wins" });
                Object.defineProperty(exports, "valueThenShorthand", { value: "first", value });
                Object.defineProperty(exports, "valueThenMethod", { value: "first", value() { return "method-value"; } });
                Object.defineProperty(exports, "valueThenFalseEnumerable", { value: dep.value, enumerable: false });
                if (false) Object.defineProperty(exports, "objectMemberDescriptor", { value: "bad" }.descriptor);
                if (false) Object.defineProperty(exports, "objectPlusDescriptor", { value: "bad" } + suffix);
            "#,
            true,
            &[
                "foo",
                "bar",
                "baz",
                "valueExport",
                "getterExport",
                "functionGetter",
                "valueThenValue",
                "valueThenString",
                "valueThenComputed",
                "valueThenShorthand",
                "valueThenMethod",
                "valueThenFalseEnumerable",
                "objectMemberDescriptor",
                "objectPlusDescriptor",
            ],
            &[],
        );
    }

    #[test]
    fn rejects_unsupported_cjs_define_property_descriptors() {
        assert_analysis(
            r#"
                const dep = { value: "getter-value" };
                const value = "shorthand-value";
                Object.defineProperty(exports, "arrowGetter", { get: () => dep.value });
                Object.defineProperty(exports, "stringKeyGetter", { "get": function () { return dep.value; } });
                Object.defineProperty(exports, "stringKeyValue", { "value": "string-key-value" });
                Object.defineProperty(exports, "shorthandValue", { value });
                Object.defineProperty(exports, "computedValue", { ["value"]: "computed-value" });
                Object.defineProperty(exports, "multiStatementGetter", { get() { const v = dep.value; return v; } });
                Object.defineProperty(exports, "helperValueDescriptor", makeDescriptor({ value: dep.value }));
                Object.defineProperty(exports, "parameterGetter", { get(a) { return dep.value; } });
                Object.defineProperty(exports, "parameterFunctionGetter", { get: function (a) { return dep.value; } });
                Object.defineProperty(exports, "helperDescriptor", makeDescriptor({ get() { return dep.value; } }));
                Object.defineProperty(exports, "nestedMemberGetter", { get() { return dep.value.nested; } });
                Object.defineProperty(exports, "nestedBracketGetter", { get() { return dep["value"]["nested"]; } });
                Object.defineProperty(exports, "duplicateGet", { get() { return dep.value; }, get: function (a) { return dep.value; } });
                Object.defineProperty(exports, "stringThenValue", { "value": "bad", value: dep.value });
                Object.defineProperty(exports, "computedThenValue", { ["value"]: "bad", value: dep.value });
                Object.defineProperty(exports, "writableThenValue", { writable: true, value: dep.value });
                Object.defineProperty(exports, "configurableThenValue", { configurable: true, value: dep.value });
                Object.defineProperty(exports, "quotedEnumerableThenValue", { "enumerable": true, value: dep.value });
            "#,
            false,
            &[],
            &[],
        );
    }

    #[test]
    fn malformed_non_ascii_escapes_do_not_panic() {
        assert_analysis(r#"exports["\xaé"] = 1;"#, false, &[], &[]);
        assert_analysis(r#"exports["\uabcé"] = 1;"#, false, &[], &[]);
    }

    #[test]
    fn detects_module_exports_assignments_with_comments() {
        assert_analysis(r#"module /*x*/ . /*y*/ exports = {};"#, true, &[], &[]);
        assert_analysis(
            r#"module /*x*/ . /*y*/ exports = require("./dep.cjs");"#,
            true,
            &[],
            &["./dep.cjs"],
        );
        assert_analysis(r#"exports = require("./dep.cjs");"#, true, &[], &[]);
        assert_analysis(
            r#"module.exports = require("./dep.cjs").nested;"#,
            true,
            &[],
            &["./dep.cjs"],
        );
        assert_analysis(
            r#"module.exports = require("./dep.cjs")();"#,
            true,
            &[],
            &["./dep.cjs"],
        );
        assert_analysis(
            r#"
                var dep = require("./dep.cjs").nested;
                Object.keys(dep).forEach(function (key) {
                    Object.defineProperty(exports, key, { get: function () { return dep[key]; } });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );
    }

    #[test]
    fn cjs_statement_start_asi_continuation_edges() {
        assert!(is_asi_continuation_previous(b'!'));
        assert!(is_asi_continuation_previous(b'~'));
        assert!(!is_asi_continuation_next("!", 0));
        assert!(!is_asi_continuation_next("~", 0));
        assert!(!is_asi_continuation_next("++x", 0));
        assert!(is_asi_continuation_next("+x", 0));

        let continued = "const dep = require('./dep')\n(exports.x = dep.x);";
        let continued_starts = statement_starts(continued);
        let continued_export = continued.find("exports").unwrap();
        assert!(!continued_starts[continued_export]);

        let separated = "const dep = require('./dep')\nexports.x = dep.x;";
        let separated_starts = statement_starts(separated);
        let separated_export = separated.find("exports").unwrap();
        assert!(separated_starts[separated_export]);
    }

    #[test]
    fn detects_module_exports_object_literal_names_and_spread_reexports() {
        assert_analysis(
            r#"
                const a = 1;
                const c = 2;
                const e = 4;
                module.exports = { a, b: c, "d": e, ...require("./dep.cjs") };
            "#,
            true,
            &["a", "b", "d"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                const a = 1;
                module.exports = { a, dynamic: factory() };
            "#,
            true,
            &["a", "dynamic"],
            &[],
        );

        assert_analysis(
            r#"
                const a = 1;
                module.exports = { a, b: require("./dep.cjs"), c: "not-detected" };
            "#,
            true,
            &["a", "b"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { booleanLiteral: true, nullLiteral: null, undefinedLiteral: undefined };
            "#,
            true,
            &["booleanLiteral", "nullLiteral", "undefinedLiteral"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { identifierValue: value, memberExpression: ns.x, callExpression: factory() };
            "#,
            true,
            &["identifierValue", "memberExpression"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { nestedMemberExpression: ns.x.y, after: value };
            "#,
            true,
            &["nestedMemberExpression"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { bracketMemberExpression: ns["x"], after: value };
            "#,
            true,
            &["bracketMemberExpression"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { binaryExpression: value + 1, after: value };
            "#,
            true,
            &["binaryExpression"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = {
                    stringLiteral: "not-detected",
                    numberLiteral: 1,
                    objectLiteral: {},
                    callExpression: factory(),
                    identifierValue: value,
                };
            "#,
            true,
            &[],
            &[],
        );

        assert_analysis(
            r#"
                const a = 1;
                const c = 3;
                module.exports = { a, ...require("./dep.cjs"), c };
            "#,
            true,
            &["a", "c"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                const a = 1;
                const c = 3;
                module.exports = { a, ...require("./dep.cjs").nested, c };
            "#,
            true,
            &["a"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                const a = 1;
                const b = 2;
                const other = {};
                module.exports = { a, ...other, b };
            "#,
            true,
            &["a", "b"],
            &[],
        );

        assert_analysis(
            r#"
                module.exports = { a, ...other(), b };
                module.exports = { c, ...(other), d };
                module.exports = { e, ...ns.other, f };
            "#,
            true,
            &["a", "c", "e"],
            &[],
        );

        assert_analysis(
            r#"
                const a = 1;
                module.exports = { a, [dynamic]: value, c: "not-detected" };
            "#,
            true,
            &["a"],
            &[],
        );
    }

    #[test]
    fn detects_export_star_helper_reexports() {
        assert_analysis(
            r#"
                __export(require("./dep-a.cjs"));
                __exportStar(require("./dep-b.cjs"), exports);
                tslib.__export(require("./dep-c.cjs"), exports);
                tslib.__exportStar(require("./dep-d.cjs"), exports);
                ns.helpers.__export(require("./dep-e.cjs"), exports);
                ns.helpers.__exportStar(require("./dep-f.cjs"), exports);
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[
                "./dep-a.cjs",
                "./dep-b.cjs",
                "./dep-c.cjs",
                "./dep-d.cjs",
                "./dep-e.cjs",
                "./dep-f.cjs",
            ],
        );

        assert_analysis(
            r#"
                function nested() {
                    __export(require("./dep-a.cjs"));
                }
                nested();
                helper.__export(require("./dep-b.cjs"), exports);
                __export(require(depName));
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep-b.cjs"],
        );
    }

    #[test]
    fn require_binding_alone_does_not_classify_esm_as_cjs() {
        assert_analysis(
            r#"
                import { createRequire } from "node:module";
                const require = createRequire(import.meta.url);
                const dep = require("./dep.cjs");
                export const value = dep.value;
            "#,
            false,
            &[],
            &[],
        );
    }

    #[test]
    fn detects_free_cjs_globals_for_esm_diagnostics() {
        assert_cjs_global("require;", Some("require"));
        assert_cjs_global("require('x');", Some("require"));
        assert_cjs_global("const x = require; export default x;", Some("require"));
        assert_cjs_global("exports = {};", Some("exports"));
        assert_cjs_global("module;", Some("module"));
        assert_cjs_global("__filename;", Some("__filename"));
        assert_cjs_global("__dirname;", Some("__dirname"));
    }

    #[test]
    fn ignores_bound_or_non_free_cjs_global_names() {
        assert_cjs_global("export default { require: 1 };", None);
        assert_cjs_global("export default import.meta.require;", None);
        assert_cjs_global("const require = 1; export default require;", None);
        assert_cjs_global("let exports = 1; export default exports;", None);
        assert_cjs_global("var module = 1; export default module;", None);
        assert_cjs_global("class __dirname {} export default __dirname;", None);
        assert_cjs_global(
            "import require from 'data:text/javascript,export default 1'; export default require;",
            None,
        );
        assert_cjs_global(
            "import * as module from 'data:text/javascript,export default {}'; export default module;",
            None,
        );
        assert_cjs_global(
            "import { value as exports } from 'data:text/javascript,export const value = 1'; export default exports;",
            None,
        );
        assert_cjs_global(
            "function f(require) { return require; } export default f(1);",
            None,
        );
        assert_cjs_global(
            "function f(require) { return require; } export default require;",
            Some("require"),
        );
        assert_cjs_global("const f = (require) => require; export default f(1);", None);
        assert_cjs_global("export default ((require) => require)(1);", None);
        assert_cjs_global(
            "const {\n  module\n} = { module: 1 };\nexport default module;",
            None,
        );
        assert_cjs_global(
            "const { require: localRequire } = { require: 1 };\nexport default localRequire;",
            None,
        );
        assert_cjs_global(
            "const x = 0,\n  require = 1;\nexport default require;",
            None,
        );
        assert_cjs_global(
            "class C { #require = 1; get() { return this.#require; } } export default C;",
            None,
        );
        assert_cjs_global(
            "class C { #exports = 1; get() { return this.#exports; } } export default C;",
            None,
        );
        assert_cjs_global(
            "class C { #module = 1; get() { return this.#module; } } export default C;",
            None,
        );
        assert_cjs_global("export default import.meta . require;", None);
        assert_cjs_global("export default globalThis . require;", None);
        assert_cjs_global("export default obj\n.\nmodule;", None);
        assert_cjs_global(
            "export default { require() { return 1; }, f(module) { return module; } }.f(2);",
            None,
        );
        assert_cjs_global("export default { async require() { return 1; } };", None);
        assert_cjs_global(
            "export default { *module() { yield 1; } }.module().next().value;",
            None,
        );
        assert_cjs_global(
            "export default { get exports() { return 1; } }.exports;",
            None,
        );
        assert_cjs_global(
            "export default { \"x\"(require) { return require; } }.x(1);",
            None,
        );
        assert_cjs_global(
            "export default { /* comment */ require() { return 1; } }.require();",
            None,
        );
        assert_cjs_global(
            "function* module() { yield 1; } export default module;",
            None,
        );
    }

    #[test]
    fn package_type_diagnostics_ignore_local_exports_binding() {
        assert!(
            esm_preflight_error_module_source(
                r#"
                const exports = {};
                Object.defineProperty(exports, "__esModule", { value: true });
                exports.default = "value";
                export default exports;
                export { exports as "module.exports" };
            "#,
                true,
                false,
            )
            .is_none()
        );
    }

    #[test]
    fn parses_static_named_import_specifiers_for_cjs_diagnostics() {
        assert_eq!(
            parse_static_named_import(r#"import { comeOn } from './fail.cjs';"#, 0),
            Some((
                "./fail.cjs".to_string(),
                vec![StaticNamedImport {
                    imported: "comeOn".to_string(),
                    local: "comeOn".to_string(),
                }],
                r#"import { comeOn } from './fail.cjs';"#.len()
            ))
        );
        assert_eq!(
            parse_static_named_import(r#"import { comeOn as renamed } from "deep-fail""#, 0)
                .map(|(specifier, imports, _)| (specifier, imports)),
            Some((
                "deep-fail".to_string(),
                vec![StaticNamedImport {
                    imported: "comeOn".to_string(),
                    local: "renamed".to_string(),
                }],
            ))
        );
        assert_eq!(
            parse_static_named_import(
                r#"import defaultValue, { comeOn, everybody } from './fail.cjs';"#,
                0,
            )
            .map(|(specifier, imports, _)| (specifier, imports)),
            Some((
                "./fail.cjs".to_string(),
                vec![
                    StaticNamedImport {
                        imported: "comeOn".to_string(),
                        local: "comeOn".to_string(),
                    },
                    StaticNamedImport {
                        imported: "everybody".to_string(),
                        local: "everybody".to_string(),
                    },
                ],
            ))
        );
        assert_eq!(
            parse_static_named_import(r#"import { default as cjsDefault } from './dep.cjs';"#, 0)
                .map(|(specifier, imports, _)| (specifier, imports)),
            Some((
                "./dep.cjs".to_string(),
                vec![StaticNamedImport {
                    imported: "default".to_string(),
                    local: "cjsDefault".to_string(),
                }],
            ))
        );
        assert_eq!(
            parse_static_named_import(
                r#"import { "missing-name" as missingName } from './dep.cjs';"#,
                0,
            )
            .map(|(specifier, imports, _)| (specifier, imports)),
            Some((
                "./dep.cjs".to_string(),
                vec![StaticNamedImport {
                    imported: "missing-name".to_string(),
                    local: "missingName".to_string(),
                }],
            ))
        );
        assert_eq!(
            format_cjs_named_import_binding(&StaticNamedImport {
                imported: "missing-name".to_string(),
                local: "missingName".to_string(),
            }),
            r#""missing-name": missingName"#
        );
    }

    #[test]
    fn package_type_diagnostics_use_first_cjs_global() {
        let require_diag = esm_preflight_error_module_source("require('x');", true, false).unwrap();
        assert!(require_diag.contains("require is not defined"));
        assert!(require_diag.contains(".cjs"));

        let filename_diag =
            esm_preflight_error_module_source("console.log(__filename);", true, false).unwrap();
        assert!(filename_diag.contains("__filename is not defined"));
        assert!(filename_diag.contains(".cjs"));

        assert!(
            esm_preflight_error_module_source(
                "const require = 1; export default require;",
                true,
                false
            )
            .is_none()
        );
        assert!(
            esm_preflight_error_module_source("export default typeof require;", false, false)
                .is_none()
        );
        assert!(
            esm_preflight_error_module_source("export default typeof (exports);", false, false)
                .is_none()
        );
        assert!(
            esm_preflight_error_module_source(
                "if (true) { const exports = 1; Object.keys(exports); }",
                false,
                false
            )
            .is_none()
        );
        let block_scoped_exports_diag = esm_preflight_error_module_source(
            "if (false) { const exports = 1; } Object.keys(exports);",
            false,
            false,
        )
        .unwrap();
        assert!(block_scoped_exports_diag.contains("exports is not defined in ES module scope"));
        let for_scoped_exports_diag = esm_preflight_error_module_source(
            "for (let exports of []) {} Object.keys(exports);",
            false,
            false,
        )
        .unwrap();
        assert!(for_scoped_exports_diag.contains("exports is not defined in ES module scope"));
        let unbraced_for_scoped_exports_diag = esm_preflight_error_module_source(
            "for (let exports of [1]) Object.keys(exports); Object.keys(exports);",
            false,
            false,
        )
        .unwrap();
        assert!(
            unbraced_for_scoped_exports_diag.contains("exports is not defined in ES module scope")
        );
        let for_await_scoped_exports_diag = esm_preflight_error_module_source(
            "for await (let exports of []) {} Object.keys(exports);",
            false,
            false,
        )
        .unwrap();
        assert!(
            for_await_scoped_exports_diag.contains("exports is not defined in ES module scope")
        );
        assert!(esm_preflight_error_module_source(
            "try { throw { a: 1 }; } catch (exports) { Object.keys(exports); } export default 1;",
            false,
            false,
        )
        .is_none());
        assert!(
            esm_preflight_error_module_source(
                "if (false) { var exports = 1; } Object.keys(exports);",
                false,
                false,
            )
            .is_none()
        );
        let object_key_exports_diag =
            esm_preflight_error_module_source("export default ({ var: exports });", false, false)
                .unwrap();
        assert!(object_key_exports_diag.contains("exports is not defined in ES module scope"));
        let lexical_object_key_exports_diag =
            esm_preflight_error_module_source("export default ({ const: exports });", false, false)
                .unwrap();
        assert!(
            lexical_object_key_exports_diag.contains("exports is not defined in ES module scope")
        );
        let raw_exports_diag =
            esm_preflight_error_module_source("Object.keys(exports);", false, true).unwrap();
        assert!(raw_exports_diag.contains("exports is not defined"));
        assert!(!raw_exports_diag.contains("ES module scope"));
    }

    #[test]
    fn cjs_wrapper_lexical_redeclaration_scanner_skips_non_code() {
        assert!(has_cjs_wrapper_lexical_redeclaration("const require = 1;"));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "let /*x*/ require = 1;"
        ));
        assert!(has_cjs_wrapper_lexical_redeclaration("const exports = 1;"));
        assert!(has_cjs_wrapper_lexical_redeclaration("let module = 1;"));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "const __filename = 1;"
        ));
        assert!(has_cjs_wrapper_lexical_redeclaration("class __dirname {}"));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "const { exports } = ns;"
        ));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "const x = 1, module = 2;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration("var require = 1;"));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const { x = require('node:path') } = {};"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const { [require('x')]: value } = obj;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const { [module.id]: value } = obj;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const { [exports.name]: value } = obj;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const { [__dirname + '/x']: value } = obj;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const require = createRequire(import.meta.url);"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const require = createRequire(import . meta . url);"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const require = createRequire(import/*x*/.meta.url);"
        ));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "const require = createRequire(import.meta.urls);"
        ));
        assert!(has_cjs_wrapper_lexical_redeclaration(
            "const require = createRequire(import.meta.urlx);"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const text = `const require = 1`; export default text;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "// const require = 1\nexport default 1;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "const re = /const require = 1/; export default re;"
        ));
        assert!(!has_cjs_wrapper_lexical_redeclaration(
            "function f() { const require = 1; return require; }"
        ));
    }

    #[test]
    fn esm_syntax_detection_includes_import_meta() {
        assert!(source_looks_like_esm(
            "// comment\n// another comment\nexport default 'module';\nconsole.log('executed');"
        ));
        assert!(source_looks_like_esm("globalThis.url = import.meta.url;"));
        assert!(source_looks_like_esm("globalThis.meta = import . meta;"));
        assert!(!source_looks_like_esm(
            "const obj = { import: { meta: 1 } };"
        ));
        assert!(!source_looks_like_esm("globalThis.meta = obj.import.meta;"));
        assert!(!source_looks_like_esm("const text = 'import.meta.url';"));
    }

    #[test]
    fn esm_syntax_detection_handles_top_level_await_around_templates() {
        assert!(source_looks_like_esm(
            "const banner = `${`don't`}`;\nawait Promise.resolve();"
        ));
        assert!(!source_looks_like_esm(
            "const value = `${await Promise.resolve(42)}`;"
        ));
        assert!(!source_looks_like_esm(
            "const value = `${`${await Promise.resolve(42)}`}`;"
        ));
        assert!(source_has_top_level_await(
            "const value = `${await Promise.resolve(42)}`;",
            true
        ));
        assert!(source_has_top_level_await(
            "const value = `${`${await Promise.resolve(42)}`}`;",
            true
        ));
        assert!(source_has_top_level_await(
            "const value = `${1}-${await Promise.resolve(42)}`;",
            true
        ));
        assert!(source_has_top_level_await(
            "const value = `${{ nested: { value: await Promise.resolve(42) } }}`;",
            true
        ));
        assert!(!source_has_top_level_await(
            "const text = `await value`;",
            true
        ));
        assert!(!source_has_top_level_await(
            "const text = `${async () => await value}`;",
            true
        ));
        assert!(!source_has_top_level_await(
            "const text = `${async function value() { await other; }}`;",
            true
        ));
        assert!(!source_has_top_level_await(
            "const text = `${class Value { async method() { await other; } }}`;",
            true
        ));
    }

    #[test]
    fn module_graph_analysis_collects_dependency_facts() {
        let source = r#"
            import value from './dep.mjs' with { type: 'json' };
            export { value as other } from "pkg";
            import { from as importedFrom } from './contextual-import.mjs';
            export { from } from './contextual-export.mjs';
            export { value as from } from './contextual-alias.mjs';
            const ignored = "require('not-code')";
            require('./plain.cjs');
            object.require('./member.cjs');
            import { createRequire as makeRequire } from 'node:module';
            const localRequire = makeRequire(import.meta.url);
            makeRequire(import.meta.url)('./direct.cjs');
            localRequire('./aliased.cjs');
        "#;

        assert_eq!(
            collect_static_module_edges(source),
            vec![
                StaticModuleEdge {
                    specifier: "./dep.mjs".to_string(),
                    import_type: Some("json".to_string()),
                },
                StaticModuleEdge {
                    specifier: "pkg".to_string(),
                    import_type: None,
                },
                StaticModuleEdge {
                    specifier: "./contextual-import.mjs".to_string(),
                    import_type: None,
                },
                StaticModuleEdge {
                    specifier: "./contextual-export.mjs".to_string(),
                    import_type: None,
                },
                StaticModuleEdge {
                    specifier: "./contextual-alias.mjs".to_string(),
                    import_type: None,
                },
                StaticModuleEdge {
                    specifier: "node:module".to_string(),
                    import_type: None,
                },
            ]
        );
        assert_eq!(
            collect_literal_call_specifiers(source, &["require".to_string()]),
            vec!["./plain.cjs"]
        );
        assert_eq!(
            collect_create_require_specifiers(source),
            vec!["./direct.cjs", "./aliased.cjs"]
        );
    }

    #[test]
    fn ignores_false_positive_assignments_and_define_property_descriptors() {
        assert_analysis(
            r#"
                if (module.exports === undefined) {}
                if (exports.fake == "no") {}
                exports.arrow => value;
                module.exports => {};
                module.exports => require("./dep.cjs");
                const template = `exports.templateOnly = "no";`;
                Object.defineProperty(exports, "setterOnly", { set(v) { return dep.value; } });
                Object.defineProperty(exports, "unrelated", { other: function () { return dep.value; } });
                Object.defineProperty(exports, "regexDescriptor", { enumerable: /value:/ });
                Object.defineProperty(exports, "hiddenGetter", { enumerable: false, get() { return dep.value; } });
                Object.defineProperty(exports, "truthyEnumerableGetter", { enumerable: 1, get() { return dep.value; } });
                Object.defineProperty(exports, "multipleReturn", { get() { return dep.value; return dynamic(); } });
                Object.defineProperty(exports, "conditionalReturn", { get() { if (dep) return dep.value; return dynamic(); } });
                class PrivateNames {
                    #exports = {};
                    #module = { exports: {} };
                    write() {
                        this.#exports.privateExport = 1;
                        this.#module.exports.privateModuleExport = 1;
                    }
                }
            "#,
            false,
            &[],
            &[],
        );
    }

    #[test]
    fn detects_only_real_transpiler_reexport_callbacks() {
        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    const π = 1;
                    Object.defineProperty(exports, key, {
                        enumerable: true,
                        get: function () { return _dep[key]; }
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        enumerable: true,
                        get: function () { return _dep[key]; }
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach /* comment */ (function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach;
                (function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    const msg = "Object.defineProperty(exports, key, { get: function () { return _dep[key]; } })";
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    Object.defineProperty(other, key, { value: 1 });
                    exports;
                    function unrelated() { return _dep[key]; }
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        enumerable: false,
                        get: function () { return _dep[key]; }
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        enumerable: true,
                        get: function () { return _dep[key]; },
                        configurable: true
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        enumerable: true,
                        enumerable: true,
                        get: function () { return _dep[key]; }
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        get: function () { return _dep[key]; }
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = require("./dep.cjs");
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    Object.defineProperty(exports, key, {
                        get: function () { return _dep[key]; },
                        enumerable: true
                    });
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                function copy() {
                    Object.keys(dep).forEach(function (key) {
                        if (key === "default" || key === "__esModule") return;
                        exports[key] = dep[key];
                    });
                }
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = {};
                function init() {
                    var dep = require("./dep.cjs");
                }
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !Object.prototype.hasOwnProperty.call(exports, key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !exports.hasOwnProperty(key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !Object.hasOwnProperty.call(exports, key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                var ignored = {};
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !ignored.hasOwnProperty(key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                var ignored = {};
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !Object.hasOwnProperty.call(ignored, key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                var ignored = {};
                Object.keys(dep).forEach(function (key) {
                    if (key !== "default" && !Object.prototype.hasOwnProperty.call(ignored, key)) exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs")
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key]
                })
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if ("default" === key || "__esModule" === key) return;
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    exports[key] = dep[key];
                    if (key === "default" || key === "__esModule") return;
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    function guard() {
                        if (key === "default" || key === "__esModule") return;
                    }
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                for (var dep = require("./dep.cjs"); false;) {}
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                /* header */ var dep = require("./dep.cjs");
                exports.own = "own";
                /* separator */ Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                exports.own = "own"; // trailing comment
                // separator
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach((key) => {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key];
                }, null);
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] => dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    exports[key] = other[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var dep = require("./dep.cjs");
                Object.keys(dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    exports[key] = dep[key].nested;
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (Object.prototype.hasOwnProperty.call(exports, key)) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (key in exports && exports[key] === _dep[key]) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (key in module.exports && module.exports[key] === _dep[key]) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (key in module.exports && module.exports[key] === _dep[key]) return;
                    module.exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &["./dep.cjs"],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                var skip = {};
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (skip.hasOwnProperty(key)) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                var skip = {};
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (key in skip && skip[key] === _dep[key]) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = _interopRequireWildcard(require("./dep.cjs"));
                var other = {};
                Object.keys(_dep).forEach(function (key) {
                    if (key === "default" || key === "__esModule") return;
                    if (key in exports && exports[key] === other[key]) return;
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var _dep = _interopWildcard(require("./dep.cjs"));
                Object.keys(_dep).forEach(function (key) {
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );

        assert_analysis(
            r#"
                var name = "./dep.cjs";
                var _dep = _interopRequireWildcard(require(name));
                Object.keys(_dep).forEach(function (key) {
                    exports[key] = _dep[key];
                });
                exports.own = "own";
            "#,
            true,
            &["own"],
            &[],
        );
    }
}
