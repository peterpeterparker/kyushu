use futures::future::AbortHandle;
use futures_concurrency::future::Join;
use rquickjs::function::{Args, Constructor};
use rquickjs::loader::{
    BuiltinLoader, BuiltinResolver, FileResolver, ImportAttributes, Loader, Resolver,
};
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, Ctx, Error, Filter, FromJs, Function, Module,
    Object, Promise, Value, async_with,
};
use rquickjs::{CaughtError, prelude::*};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::AtomicUsize;
use wstd::runtime::block_on;

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

/// Loader for `data:` URL modules (e.g. `data:text/javascript,export default 42`).
struct DataUrlLoader;

impl DataUrlLoader {
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
        format!("await Promise.reject(new SyntaxError('{escaped_msg}'));\n")
    }
}

impl Loader for DataUrlLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let rest = path
            .strip_prefix("data:")
            .ok_or_else(|| Error::new_loading(path))?;

        // Find the comma separating metadata from content
        let comma_pos = rest.find(',').ok_or_else(|| Error::new_loading(path))?;
        let metadata = &rest[..comma_pos];
        let raw_content = &rest[comma_pos + 1..];

        // Parse metadata: e.g. "text/javascript" or "text/javascript;base64"
        let is_base64 = metadata.ends_with(";base64");

        let source = if is_base64 {
            // Simple base64 decoder for ASCII content
            let decoded = base64_decode(raw_content).ok_or_else(|| Error::new_loading(path))?;
            String::from_utf8(decoded).map_err(|_| Error::new_loading(path))?
        } else {
            Self::percent_decode(raw_content).ok_or_else(|| Error::new_loading(path))?
        };

        // Extract base MIME type (before any parameters)
        let base_mime = metadata.split(';').next().unwrap_or(metadata).trim();

        if base_mime == "application/json" {
            // Validate JSON by attempting a simple parse check.
            // For valid JSON: embed directly as a JS literal.
            // For invalid JSON: throw a SyntaxError with V8-compatible message.
            let json_valid = Self::is_valid_json(&source);
            let module_source = if json_valid {
                let escaped = Self::js_string_escape(&source);
                format!("export default JSON.parse('{escaped}');\n")
            } else {
                Self::make_json_error_module(&source)
            };
            Module::declare(ctx.clone(), path, module_source.as_bytes().to_vec())
        } else if base_mime == "text/javascript" || base_mime == "application/javascript" {
            // Check for static import attributes (e.g., `import "spec" with { type: "json" }`)
            // QuickJS doesn't support import attributes syntax, so we preprocess:
            // - If `with { ... }` is found and attributes are invalid, generate an error module
            // - If valid, strip the `with { ... }` clause
            // - `assert { ... }` is left as-is (QuickJS will throw SyntaxError, as expected)
            let source = process_static_import_attrs(&source, path);

            let init = ImportMetaInit {
                url: path.to_string(),
                filename: None,
                dirname: None,
                include_resolve: true,
            };
            let injected = inject_import_meta_prologue(&init, &source);
            Module::declare(ctx.clone(), path, injected.as_bytes().to_vec())
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

/// Process static import attributes in JavaScript module source code.
///
/// Handles patterns like `import "specifier" with { type: "json" }`.
/// - If `with { ... }` is found and attributes are invalid, returns an error module source.
/// - If valid, strips the `with { ... }` clause so QuickJS can parse it.
/// - `assert { ... }` is left unchanged (QuickJS will throw SyntaxError).
fn process_static_import_attrs(source: &str, module_path: &str) -> String {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(len);
    let mut i = 0;

    while i < len {
        // Look for 'import' keyword
        if bytes[i] == b'i'
            && i + 6 <= len
            && &source[i..i + 6] == "import"
            && (i == 0 || !is_id_char(bytes[i - 1]))
            && (i + 6 >= len
                || !is_id_char(bytes[i + 6])
                || bytes[i + 6] == b'"'
                || bytes[i + 6] == b'\'')
        {
            let import_start = i;
            i += 6;

            // Skip whitespace
            while i < len && bytes[i].is_ascii_whitespace() {
                i += 1;
            }

            // Check for string literal (bare import: import "spec")
            if i < len && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let quote = bytes[i];
                i += 1;
                let spec_start = i;
                while i < len && bytes[i] != quote {
                    if bytes[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
                let spec_end = i;
                if i < len {
                    i += 1; // skip closing quote
                }
                let specifier = &source[spec_start..spec_end];

                // Skip whitespace
                let after_spec = i;
                while i < len && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }

                // Check for 'with' keyword (not 'with(' which is a with-statement)
                if i + 4 <= len
                    && &source[i..i + 4] == "with"
                    && (i + 4 >= len || !is_id_char(bytes[i + 4]) || bytes[i + 4] == b'{')
                {
                    let with_start = i;
                    i += 4;
                    while i < len && bytes[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'{' {
                        i += 1;
                        let attrs_start = i;
                        let mut depth = 1u32;
                        while i < len && depth > 0 {
                            match bytes[i] {
                                b'{' => depth += 1,
                                b'}' => depth -= 1,
                                b'"' | b'\'' => {
                                    let q = bytes[i];
                                    i += 1;
                                    while i < len && bytes[i] != q {
                                        if bytes[i] == b'\\' {
                                            i += 1;
                                        }
                                        i += 1;
                                    }
                                }
                                _ => {}
                            }
                            i += 1;
                        }
                        let attrs_content = &source[attrs_start..if i > 0 { i - 1 } else { i }];

                        // Parse the type value from attributes
                        let type_value = extract_attr_type_value(attrs_content);
                        let format = determine_data_url_format(specifier);

                        // Validate
                        if let Some(error_module) = validate_static_import_attrs(
                            type_value.as_deref(),
                            format,
                            specifier,
                            module_path,
                        ) {
                            return error_module;
                        }

                        // Valid: strip the with clause, keep everything else
                        result.push_str(&source[import_start..after_spec]);
                        // Skip any remaining content after the with block
                        // and append the rest of the source
                        while i < len && bytes[i].is_ascii_whitespace() {
                            i += 1;
                        }
                        result.push_str(&source[i..]);
                        return result;
                    } else {
                        // 'with' not followed by '{', not import attrs
                        i = with_start;
                        result.push_str(&source[import_start..i]);
                        continue;
                    }
                }
                // No 'with' keyword, output as-is
                result.push_str(&source[import_start..i]);
                continue;
            }

            // Not a bare import string - check for named/namespace imports with 'from'
            // For now, scan for 'from' followed by a string and then 'with'
            // Skip complex patterns and output as-is
            result.push_str(&source[import_start..i]);
            continue;
        }

        result.push(bytes[i] as char);
        i += 1;
    }

    result
}

fn is_id_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

/// Extract the value of the `type` key from a simple attributes string like `type:"json"`.
fn extract_attr_type_value(attrs: &str) -> Option<String> {
    // Look for `type` key followed by `:` and a string value
    let bytes = attrs.as_bytes();
    let len = bytes.len();
    let mut i = 0;

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
                return Some(val.to_string());
            }
        } else {
            // Skip non-string values
            while i < len && bytes[i] != b',' && bytes[i] != b'}' {
                i += 1;
            }
        }
    }
    None
}

/// Determine module format from a data URL specifier.
fn determine_data_url_format(specifier: &str) -> Option<&'static str> {
    if let Some(rest) = specifier.strip_prefix("data:") {
        if let Some(comma_pos) = rest.find(',') {
            let metadata = &rest[..comma_pos];
            let base_mime = metadata.split(';').next().unwrap_or(metadata).trim();
            return match base_mime {
                "application/json" => Some("json"),
                "text/javascript" | "application/javascript" => Some("module"),
                "text/css" => Some("css"),
                _ => None,
            };
        }
    } else if specifier.ends_with(".json") {
        return Some("json");
    }
    None
}

/// Validate static import attributes. Returns Some(error_module_source) if invalid, None if valid.
fn validate_static_import_attrs(
    type_value: Option<&str>,
    format: Option<&str>,
    specifier: &str,
    _module_path: &str,
) -> Option<String> {
    if let Some(tv) = type_value {
        match tv {
            "json" => {
                if format == Some("module") {
                    return Some(
                        "await Promise.reject(Object.assign(new TypeError('Cannot use import attributes to change the type of a JavaScript module'), {code: 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE'}));\n".to_string()
                    );
                }
            }
            "css" => {
                // CSS is a recognized type, let loader handle it
            }
            other => {
                let escaped_type = DataUrlLoader::js_string_escape(other);
                return Some(format!(
                    "await Promise.reject(Object.assign(new TypeError('Import attribute type \"{escaped_type}\" is not supported'), {{code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED'}}));\n"
                ));
            }
        }
    }

    // Check for missing required attributes (JSON without type: "json")
    if format == Some("json") && type_value != Some("json") {
        let escaped = DataUrlLoader::js_string_escape(specifier);
        return Some(format!(
            "await Promise.reject(Object.assign(new TypeError('Module \"{escaped}\" needs an import attribute of type: json'), {{code: 'ERR_IMPORT_ATTRIBUTE_MISSING'}}));\n"
        ));
    }

    None
}

/// Resolver that strips `file://` URL prefixes so that `import('file:///path/to/mod.mjs')`
/// resolves to the filesystem path `/path/to/mod.mjs`.
struct FileUrlResolver;

impl FileUrlResolver {
    /// Decode a `file://` URL into a filesystem path, handling percent-encoding.
    fn file_url_to_path(url: &str) -> Option<String> {
        let encoded = url.strip_prefix("file://")?;
        let bytes = encoded.as_bytes();
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
        String::from_utf8(decoded).ok()
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
        _ctx: &Ctx<'js>,
        _base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if let Some(path) = Self::file_url_to_path(name) {
            Ok(path)
        } else {
            Err(Error::new_resolving(_base, name))
        }
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
        let resolved = module_dir.join(name);
        let normalized = Self::normalize_path(&resolved);

        let candidates = [
            normalized.clone(),
            format!("{}.js", normalized),
            format!("{}.mjs", normalized),
        ];

        for candidate in &candidates {
            if std::path::Path::new(candidate).is_file() {
                return Ok(candidate.clone());
            }
        }

        Err(Error::new_resolving(base, name))
    }
}

/// Resolver for filesystem-backed ES modules.
///
/// QuickJS gives dynamic imports from CommonJS `eval()` a synthetic `<input>`
/// base (handled by `CjsEvalResolver` above), but normal ESM resolution still
/// needs Node-style filesystem handling for absolute paths and paths relative
/// to the referrer module. `rquickjs::FileResolver` is kept as a fallback, but
/// it does not reliably accept already-absolute guest paths in this WASI setup.
struct NodeFileResolver;

impl NodeFileResolver {
    fn resolve_candidate(candidate: std::path::PathBuf) -> Option<String> {
        let normalized = CjsEvalResolver::normalize_path(&candidate);
        if std::path::Path::new(&normalized).is_file() {
            return Some(normalized);
        }

        if std::path::Path::new(&normalized).extension().is_none() {
            for ext in ["js", "mjs", "json"] {
                let with_ext = format!("{}.{}", normalized, ext);
                if std::path::Path::new(&with_ext).is_file() {
                    return Some(with_ext);
                }
            }
        }

        None
    }
}

impl Resolver for NodeFileResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if name.contains("://") || name.starts_with("node:") {
            return Err(Error::new_resolving(base, name));
        }

        let candidate = if name.starts_with('/') {
            std::path::PathBuf::from(name)
        } else if name.starts_with("./") || name.starts_with("../") {
            let base_path = if let Some(path) = FileUrlResolver::file_url_to_path(base) {
                path
            } else {
                base.to_string()
            };

            if base_path == "<input>" {
                return Err(Error::new_resolving(base, name));
            }

            let base_dir = std::path::Path::new(&base_path)
                .parent()
                .ok_or_else(|| Error::new_resolving(base, name))?;
            base_dir.join(name)
        } else {
            return Err(Error::new_resolving(base, name));
        };

        Self::resolve_candidate(candidate).ok_or_else(|| Error::new_resolving(base, name))
    }
}

/// Resolver that provides Node.js-style error codes for failed module resolution.
/// This should be the LAST resolver in the chain, catching everything that
/// preceding resolvers couldn't handle.
struct NodeModuleErrorResolver;

impl Resolver for NodeModuleErrorResolver {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        _base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        let globals = ctx.globals();

        if name.starts_with("node:") {
            let msg = format!("No such built-in module: {}", name);
            let type_error_ctor: Function = globals.get("TypeError")?;
            let error_obj: Object = type_error_ctor.call((&msg,))?;
            error_obj.set("code", "ERR_UNKNOWN_BUILTIN_MODULE")?;
            return Err(ctx.throw(error_obj.into_value()));
        }

        if let Some(scheme_end) = name.find("://") {
            let scheme = &name[..scheme_end];
            if scheme != "file" && scheme != "data" {
                let msg = format!(
                    "Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol '{}:'",
                    scheme
                );
                let error_ctor: Function = globals.get("Error")?;
                let error_obj: Object = error_ctor.call((&msg,))?;
                error_obj.set("code", "ERR_UNSUPPORTED_ESM_URL_SCHEME")?;
                return Err(ctx.throw(error_obj.into_value()));
            }
        }

        let msg = format!("Cannot find module '{}'", name);
        let error_ctor: Function = globals.get("Error")?;
        let error_obj: Object = error_ctor.call((&msg,))?;
        error_obj.set("code", "ERR_MODULE_NOT_FOUND")?;
        Err(ctx.throw(error_obj.into_value()))
    }
}

struct NodeModulesResolver;

impl NodeModulesResolver {
    fn try_resolve(&self, base: &str, name: &str) -> Option<String> {
        use std::path::{Path, PathBuf};

        // Only handle bare specifiers (not relative, absolute, or URL)
        if name.starts_with('.') || name.starts_with('/') || name.contains("://") {
            return None;
        }

        // Extract directory from base module path
        let base_dir = Path::new(base).parent()?;

        // Walk up directory tree looking for node_modules
        let mut dir = base_dir.to_path_buf();
        loop {
            let nm_dir = dir.join("node_modules").join(name);
            if nm_dir.is_dir() {
                // Try package.json main field
                let pkg_path = nm_dir.join("package.json");
                if let Ok(pkg_content) = std::fs::read_to_string(&pkg_path)
                    && let Some(main) = Self::extract_json_string_field(&pkg_content, "main")
                {
                    // Try the main entry with various extensions
                    let main_path = nm_dir.join(&main);
                    let candidates = [
                        main_path.clone(),
                        main_path.with_extension("mjs"),
                        main_path.with_extension("js"),
                        main_path.join("index.mjs"),
                        main_path.join("index.js"),
                    ];
                    for candidate in &candidates {
                        if candidate.is_file() {
                            return Some(candidate.to_string_lossy().into_owned());
                        }
                    }
                }

                // Fallback: index.mjs, index.js
                let fallbacks: [PathBuf; 2] = [nm_dir.join("index.mjs"), nm_dir.join("index.js")];
                for fallback in &fallbacks {
                    if fallback.is_file() {
                        return Some(fallback.to_string_lossy().into_owned());
                    }
                }
            }

            if !dir.pop() {
                break;
            }
        }

        None
    }

    /// Extract a simple string field value from a JSON object string.
    fn extract_json_string_field(json: &str, field: &str) -> Option<String> {
        let pattern = format!("\"{}\"", field);
        let idx = json.find(&pattern)?;
        let after_key = &json[idx + pattern.len()..];
        let after_colon = after_key.trim_start();
        let after_colon = after_colon.strip_prefix(':')?;
        let after_colon = after_colon.trim_start();
        let after_colon = after_colon.strip_prefix('"')?;
        let end = after_colon.find('"')?;
        Some(after_colon[..end].to_string())
    }
}

impl Resolver for NodeModulesResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        self.try_resolve(base, name)
            .ok_or_else(|| Error::new_resolving(base, name))
    }
}

/// Loader that wraps CJS `.js` and `.cjs` files in ESM-compatible wrappers when loaded via `import()`.
/// This enables ESM modules to import CJS packages from `node_modules`.
struct CjsCompatLoader;

impl Loader for CjsCompatLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        let is_cjs_ext = path.ends_with(".cjs");
        if !path.ends_with(".js") && !is_cjs_ext {
            return Err(Error::new_loading(path));
        }

        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let globals = ctx.globals();
                let msg = format!("Cannot find module '{}'", path);
                let error_ctor: Function = globals.get("Error")?;
                let error_obj: Object = error_ctor.call((&msg,))?;
                error_obj.set("code", "ERR_MODULE_NOT_FOUND")?;
                return Err(ctx.throw(error_obj.into_value()));
            }
            Err(_) => return Err(Error::new_loading(path)),
        };

        let abs_path = ensure_absolute_path(path);
        let std_path = std::path::Path::new(&abs_path);
        let filename = Some(abs_path.clone());
        let dirname = std_path.parent().map(|p| p.to_string_lossy().into_owned());
        let url = path_to_file_url(path);

        let init = ImportMetaInit {
            url,
            filename,
            dirname,
            include_resolve: true,
        };

        // .cjs files are always CommonJS; for .js files, detect CJS patterns
        let is_cjs = is_cjs_ext
            || source.contains("module.exports")
            || source.contains("exports.")
            || (source.contains("require(") && !source.contains("import "));

        if !is_cjs {
            // Treat as ESM — inject import.meta prologue (handles shebangs)
            let injected = inject_import_meta_prologue(&init, &source);
            return Module::declare(ctx.clone(), path, injected.as_bytes().to_vec());
        }

        // Strip shebang before wrapping in IIFE (it would be invalid inside the wrapper)
        let cjs_source = if let Some(rest) = source.strip_prefix("#!") {
            if let Some(newline_pos) = rest.find('\n') {
                // Replace shebang with a comment to preserve line numbers
                format!(
                    "//{}{}",
                    &source[2..2 + newline_pos + 1],
                    &source[2 + newline_pos + 1..]
                )
            } else {
                String::new()
            }
        } else {
            source
        };

        // Wrap CJS source in ESM-compatible wrapper, with import.meta prologue before the wrapper
        let prologue = inject_import_meta_prologue(&init, "");
        let wrapped = format!(
            r#"{}
var module = {{ exports: {{}} }};
var exports = module.exports;
(function(module, exports) {{
{}
}})(module, exports);
var __cjs_default = module.exports;
export default __cjs_default;
export var __esModule = __cjs_default && __cjs_default.__esModule;
"#,
            prologue.trim(),
            cjs_source
        );

        Module::declare(ctx.clone(), path, wrapped.as_bytes().to_vec())
    }
}

struct ImportMetaInit {
    url: String,
    filename: Option<String>,
    dirname: Option<String>,
    include_resolve: bool,
}

/// Ensure a path is absolute. If relative, prepend `/` (WASI cwd is `/`).
fn ensure_absolute_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    }
}

fn path_to_file_url(path: &str) -> String {
    let abs_path = ensure_absolute_path(path);
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
    Normal,
    Function,
    Class,
}

fn source_has_top_level_await(source: &str) -> bool {
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
        }

        if b == b'\'' || b == b'"' || b == b'`' {
            let quote = b;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
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
                match ident {
                    "await" if function_depth == 0 && class_depth == 0 => return true,
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
                    braces.push(JsBraceContext::Normal);
                }
            }
            b'}' => {
                if let Some(context) = braces.pop() {
                    match context {
                        JsBraceContext::Function => {
                            function_depth = function_depth.saturating_sub(1)
                        }
                        JsBraceContext::Class => class_depth = class_depth.saturating_sub(1),
                        JsBraceContext::Normal => {}
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }

    false
}

fn is_js_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic()
}

fn is_js_identifier_continue(byte: u8) -> bool {
    is_js_identifier_start(byte) || byte.is_ascii_digit()
}

fn inject_import_meta_prologue(init: &ImportMetaInit, source: &str) -> String {
    let mut props = Vec::new();

    if let Some(ref dirname) = init.dirname {
        props.push(format!(
            "dirname:{{value:\"{}\",writable:true,enumerable:true,configurable:true}}",
            escape_js_string(dirname)
        ));
    }

    if let Some(ref filename) = init.filename {
        props.push(format!(
            "filename:{{value:\"{}\",writable:true,enumerable:true,configurable:true}}",
            escape_js_string(filename)
        ));
    }

    if init.include_resolve {
        props.push(format!(
            "resolve:{{value:(s)=>globalThis.__wasm_rquickjs_import_meta_resolve(\"{}\",s),writable:true,enumerable:true,configurable:true}}",
            escape_js_string(&init.url)
        ));
    }

    props.push(format!(
        "url:{{value:\"{}\",writable:true,enumerable:true,configurable:true}}",
        escape_js_string(&init.url)
    ));

    // Define import.meta properties and also shim __filename/__dirname as
    // top-level variables. Many libraries (especially Rollup-bundled CJS→ESM)
    // reference bare __dirname/__filename which don't exist in ESM scope.
    let mut prologue = format!(
        "Object.defineProperties(import.meta,{{{}}});",
        props.join(",")
    );
    if let Some(ref filename) = init.filename {
        prologue.push_str(&format!(
            "var __filename=\"{}\";",
            escape_js_string(filename)
        ));
    }
    if let Some(ref dirname) = init.dirname {
        prologue.push_str(&format!("var __dirname=\"{}\";", escape_js_string(dirname)));
    }

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

struct ImportMetaLoader;

impl Loader for ImportMetaLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        path: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
        if !path.ends_with(".mjs") {
            return Err(Error::new_loading(path));
        }

        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let globals = ctx.globals();
                let msg = format!("Cannot find module '{}'", path);
                let error_ctor: Function = globals.get("Error")?;
                let error_obj: Object = error_ctor.call((&msg,))?;
                error_obj.set("code", "ERR_MODULE_NOT_FOUND")?;
                return Err(ctx.throw(error_obj.into_value()));
            }
            Err(_) => return Err(Error::new_loading(path)),
        };

        let abs_path = ensure_absolute_path(path);
        let std_path = std::path::Path::new(&abs_path);
        let filename = Some(abs_path.clone());
        let dirname = std_path.parent().map(|p| p.to_string_lossy().into_owned());
        let url = path_to_file_url(path);

        let init = ImportMetaInit {
            url,
            filename,
            dirname,
            include_resolve: true,
        };

        // Check if there's a cached compilation error for this module.
        // When a module fails to compile (e.g. SyntaxError), we cache the
        // error so subsequent imports throw the exact same error object,
        // matching Node.js/V8 behavior (ES spec §16.2.1.5.2).
        let globals = ctx.globals();
        if let Ok(cache) = globals.get::<_, Object>("__esm_error_cache")
            && let Ok(cached_error) = cache.get::<_, Value>(path)
            && !cached_error.is_undefined()
        {
            return Err(ctx.throw(cached_error));
        }

        let mut injected = inject_import_meta_prologue(&init, &source);
        if source_has_top_level_await(&source) {
            let escaped_path = escape_js_string(&abs_path);
            let escaped_url = escape_js_string(&init.url);
            let marker = format!(
                "globalThis.__wasm_rquickjs_async_esm_modules=globalThis.__wasm_rquickjs_async_esm_modules||Object.create(null);globalThis.__wasm_rquickjs_async_esm_modules[\"{}\"]=true;globalThis.__wasm_rquickjs_async_esm_modules[\"{}\"]=true;\n",
                escaped_path, escaped_url
            );
            injected = format!("{}{}", marker, injected);
        }
        match Module::declare(ctx.clone(), path, injected.as_bytes().to_vec()) {
            Ok(module) => Ok(module),
            Err(Error::Exception) => {
                let exception = ctx.catch();

                let cache: Object = match globals.get::<_, Value>("__esm_error_cache") {
                    Ok(v) if v.is_object() => v.into_object().unwrap(),
                    _ => {
                        let obj = Object::new(ctx.clone()).map_err(|_| Error::new_loading(path))?;
                        globals
                            .set("__esm_error_cache", obj.clone())
                            .map_err(|_| Error::new_loading(path))?;
                        obj
                    }
                };
                cache
                    .set(path, exception.clone())
                    .map_err(|_| Error::new_loading(path))?;

                Err(ctx.throw(exception))
            }
            Err(e) => Err(e),
        }
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
        if !path.ends_with(".json") {
            return Err(Error::new_loading(path));
        }

        let source = std::fs::read_to_string(path).map_err(|_| Error::new_loading(path))?;
        let module_source = if DataUrlLoader::is_valid_json(&source) {
            let escaped = DataUrlLoader::js_string_escape(&source);
            format!("export default JSON.parse('{escaped}');\n")
        } else {
            DataUrlLoader::make_json_error_module(&source)
        };
        Module::declare(ctx.clone(), path, module_source.as_bytes().to_vec())
    }
}

pub const RESOURCE_TABLE_NAME: &str = "__wasm_rquickjs_resources";
pub const RESOURCE_ID_KEY: &str = "__wasm_rquickjs_resource_id";
pub const DISPOSE_SYMBOL: &str = "__wasm_rquickjs_symbol_dispose";

pub struct JsState {
    pub rt: AsyncRuntime,
    pub ctx: AsyncContext,
    pub last_resource_id: AtomicUsize,
    pub resource_drop_queue_tx: futures::channel::mpsc::UnboundedSender<usize>,
    pub resource_drop_queue_rx: RefCell<Option<futures::channel::mpsc::UnboundedReceiver<usize>>>,
    pub abort_handles: RefCell<HashMap<usize, AbortHandle>>,
    pub last_abort_id: AtomicUsize,
    pub unrefed_timers: RefCell<HashSet<usize>>,
    pub gc_pending: std::sync::atomic::AtomicBool,
}

/// Tracks which initialization phase the runtime is in.
/// Used to support Wizer pre-initialization and guard against re-entrant
/// `get_js_state()` calls during module evaluation (e.g. from `setTimeout`
/// callbacks that fire during init).
#[repr(u8)]
#[derive(Clone, Copy)]
enum InitPhase {
    /// No initialization has been performed yet.
    Uninitialized = 0,
    /// `STATE` is published but JS evaluation is still in progress.
    /// Re-entrant `get_js_state()` calls return the existing state without
    /// re-running initialization.
    Initializing = 1,
    /// Fully initialized including user module evaluation.
    FullyInitialized = 2,
    /// Wizer pre-initialized: JS state is snapshotted but runtime env (argv, env vars)
    /// needs to be refreshed from the actual host environment on first access.
    WizerPreInitialized = 3,
}

impl JsState {
    /// Phase 1: Create the runtime, context, resolvers, loaders, and all Rust-side
    /// state. Does NOT evaluate any JavaScript — safe to publish to `STATE` before
    /// JS module initialization runs.
    async fn new_base() -> Self {
        let rt = AsyncRuntime::new().expect("Failed to create AsyncRuntime");
        // Raise the GC threshold to reduce the chance of triggering a QuickJS-ng
        // shape refcount bug during heavy async/promise workloads. The default
        // threshold (0xFF) causes GC to run too frequently, which can trigger
        // a use-after-free in the shape reference counting code path.
        rt.set_gc_threshold(256 * 1024 * 1024).await;
        let ctx = AsyncContext::full(&rt)
            .await
            .expect("Failed to create AsyncContext");

        let mut builtin_resolver =
            BuiltinResolver::default().with_module(crate::JS_EXPORT_MODULE_NAME);
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

        let resolver = (
            (
                RealmGuardResolver,
                MockModuleResolver,
                DataUrlResolver,
                FileUrlResolver,
                builtin_resolver,
                NodeModulesResolver,
                NodeFileResolver,
            ),
            (CjsEvalResolver, file_resolver, NodeModuleErrorResolver),
        );

        let mut builtin_loader = BuiltinLoader::default().with_module(
            crate::JS_EXPORT_MODULE_NAME,
            inject_import_meta_prologue(
                &ImportMetaInit {
                    url: format!(
                        "file:///__wasm_rquickjs_virtual__/{}.mjs",
                        crate::JS_EXPORT_MODULE_NAME
                    ),
                    filename: None,
                    dirname: None,
                    include_resolve: true,
                },
                crate::js_export_module(),
            ),
        );
        for (name, get_module) in crate::JS_ADDITIONAL_MODULES.iter() {
            let source = (get_module)();
            let injected = inject_import_meta_prologue(
                &ImportMetaInit {
                    url: format!("file:///__wasm_rquickjs_virtual__/{}.mjs", name),
                    filename: None,
                    dirname: None,
                    include_resolve: true,
                },
                &source,
            );
            builtin_loader = builtin_loader.with_module(name.to_string(), injected);
        }

        let loader = (
            MockModuleLoader,
            builtin_loader,
            crate::modules::module_loader(),
            crate::builtin::module_loader(),
            DataUrlLoader,
            JsonFileLoader,
            CjsCompatLoader,
            ImportMetaLoader,
        );

        rt.set_loader(resolver, loader).await;

        async_with!(ctx => |ctx| {
            let global = ctx.globals();

            global.set(RESOURCE_TABLE_NAME, Object::new(ctx.clone()))
                .expect("Failed to initialize resource table");

            global.set("__wasm_rquickjs_mock_seq", 0i64)
                .expect("Failed to initialize mock sequence counter");
        })
        .await;

        rt.set_host_promise_rejection_tracker(Some(Box::new(
            |ctx, promise, reason, is_handled| {
                if let Ok(handler) = ctx
                    .globals()
                    .get::<_, Function>("__wasm_rquickjs_rejection_tracker")
                {
                    let _ = handler.call::<_, Value>((promise, reason, is_handled));
                }
            },
        )))
        .await;

        let (resource_drop_queue_tx, resource_drop_queue_rx) = futures::channel::mpsc::unbounded();

        let last_resource_id = AtomicUsize::new(1);
        Self {
            rt,
            ctx,
            last_resource_id,
            resource_drop_queue_tx,
            resource_drop_queue_rx: RefCell::new(Some(resource_drop_queue_rx)),
            abort_handles: RefCell::new(HashMap::new()),
            last_abort_id: AtomicUsize::new(0),
            unrefed_timers: RefCell::new(HashSet::new()),
            gc_pending: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Phase 2a: Initialize engine builtins — dispose symbols and builtin wiring.
    /// This can be pre-initialized by Wizer without user module code.
    async fn init_engine(&self) {
        // Dispose symbols must be initialized before builtins, since builtin
        // modules use [Symbol.dispose] in their class definitions.
        // In latest version of rquickjs Symbol.dispose are supported
        // async_with!(self.ctx => |ctx| {
        //     Module::evaluate(
        //         ctx.clone(),
        //         "dispose",
        //         format!(r#"
        //         const dispose = Symbol.for("dispose");
        //         globalThis.{DISPOSE_SYMBOL} = dispose;
        //         Symbol.dispose = dispose;
        //         const asyncDispose = Symbol.for("asyncDispose");
        //         Symbol.asyncDispose = asyncDispose;
        //         "#)
        //     ).catch(&ctx)
        //     .unwrap_or_else(|e| panic!("Failed to evaluate dispose module initialization:\n{}", format_caught_error(e)))
        //     .finish::<()>()
        //     .catch(&ctx)
        //     .unwrap_or_else(|e| panic!("Failed to finish dispose module initialization:\n{}", format_caught_error(e)));
        // })
        //     .await;
        // self.rt.idle().await;

        async_with!(self.ctx => |ctx| {
            // Wire built-in globals (globalThis.require, Buffer, process, etc.)
            // This must complete before user code runs, because bundled CJS-in-ESM code
            // (e.g. esbuild's __require shim) checks `typeof require` at the top level
            // during module evaluation. ES module semantics hoist all imports and evaluate
            // them before the module body, so wiring and user import cannot share a single
            // Module::evaluate call.
            let wiring = crate::builtin::wire_builtins();
            Module::evaluate(
                ctx.clone(),
                "__wasm_rquickjs_init_wiring",
                wiring,
            )
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to evaluate built-in wiring:\n{}", format_caught_error(e)))
            .finish::<()>()
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to finish built-in wiring:\n{}", format_caught_error(e)));
        })
            .await;
        drain_and_idle(self).await;
    }

    /// Phase 2b: Import and evaluate the user module.
    /// Must be called after init_engine().
    async fn init_user_module(&self) {
        async_with!(self.ctx => |ctx| {
            // Import the user module (now globalThis.require is available)
            Module::evaluate(
                ctx.clone(),
                "__wasm_rquickjs_init_entry",
                format!(r#"
                import * as userModule from '{}';
                globalThis.userModule = userModule;
                "#, crate::JS_EXPORT_MODULE_NAME),
            )
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to evaluate module initialization:\n{}", format_caught_error(e)))
            .finish::<()>()
            .catch(&ctx)
            .unwrap_or_else(|e| panic!("Failed to finish module initialization:\n{}", format_caught_error(e)));

            for (name, _) in crate::JS_ADDITIONAL_MODULES.iter() {
              Module::import(&ctx, name.to_string())
                 .catch(&ctx)
                 .unwrap_or_else(|e| panic!("Failed to import user module {name}:\n{}", format_caught_error(e)))
                 .finish::<()>()
                 .catch(&ctx)
                 .unwrap_or_else(|e| panic!("Failed to finish importing user module {name}:\n{}", format_caught_error(e)));
            }
        })
            .await;
        drain_and_idle(self).await;
    }

    /// Phase 2: Evaluate all JavaScript — dispose symbols, builtin wiring, user
    /// module import. Must be called after `STATE` is published so that any
    /// re-entrant `get_js_state()` calls (e.g. from `setTimeout` during module
    /// init) find the already-published state instead of recursing.
    async fn finish_init(&self) {
        self.init_engine().await;
        self.init_user_module().await;
    }

    /// Refresh `process.argv` and `process.env` from the actual WASI host
    /// environment. Called after a Wizer snapshot is restored so that
    /// snapshotted (empty) values are replaced with the real runtime values.
    /// Mutates objects in-place so ESM bindings remain valid.
    async fn refresh_process_env(state: &JsState) {
        let argv = wasip2::cli::environment::get_arguments();
        let env_vars: std::collections::HashMap<String, String> =
            wasip2::cli::environment::get_environment()
                .into_iter()
                .collect();

        async_with!(state.ctx => |ctx| {
            let globals = ctx.globals();
            if let Ok(process) = globals.get::<_, rquickjs::Object>("process") {
                // Refresh argv in-place so existing references stay valid
                if let Ok(existing_argv) = process.get::<_, rquickjs::Array>("argv") {
                    let _ = existing_argv.as_object().set("length", 0u32);
                    for (i, arg) in argv.iter().enumerate() {
                        let _ = existing_argv.set(i, arg.as_str());
                    }
                }
                let _ = process.set(
                    "argv0",
                    argv.first().map(|s| s.as_str()).unwrap_or(""),
                );

                // Refresh env via JS eval to trigger Proxy traps
                if let Ok(new_env) = rquickjs::Object::new(ctx.clone()) {
                    for (key, value) in &env_vars {
                        let _ = new_env.set(key.as_str(), value.as_str());
                    }
                    let _ = globals.set("__wasm_rquickjs_new_env", new_env);
                    let _ = ctx.eval::<(), &str>(
                        "(() => { \
                            const e = globalThis.__wasm_rquickjs_new_env; \
                            for (const k of Object.keys(process.env)) delete process.env[k]; \
                            for (const [k,v] of Object.entries(e)) process.env[k] = v; \
                            delete globalThis.__wasm_rquickjs_new_env; \
                        })()",
                    );
                }
            }
        })
        .await;
    }
}

fn abort_unrefed_timers(js_state: &JsState) {
    let unrefed = js_state.unrefed_timers.borrow().clone();
    let mut abort_handles = js_state.abort_handles.borrow_mut();
    let mut unrefed_mut = js_state.unrefed_timers.borrow_mut();
    for id in unrefed.iter() {
        if let Some(handle) = abort_handles.remove(id) {
            handle.abort();
        }
        unrefed_mut.remove(id);
    }
}

/// Runs GC if it was requested from JS (deferred to avoid re-entrancy issues).
async fn run_pending_gc(js_state: &JsState) {
    if js_state
        .gc_pending
        .swap(false, std::sync::atomic::Ordering::Relaxed)
    {
        async_with!(js_state.ctx => |ctx| {
            ctx.run_gc();
        })
        .await;
    }
}

/// Spawns a sentinel task that waits for all ref'd timers to complete,
/// then aborts remaining unref'd timers so that `idle()` can return.
async fn drain_and_idle(js_state: &JsState) {
    run_pending_gc(js_state).await;
    if js_state.unrefed_timers.borrow().is_empty() {
        js_state.rt.idle().await;
        return;
    }
    // Spawn a sentinel that polls until only unref'd timers remain, then aborts them.
    async_with!(js_state.ctx => |ctx| {
        ctx.spawn(async {
            loop {
                wstd::task::sleep(wstd::time::Duration::from_millis(1)).await;
                let state = get_js_state();
                let abort_count = state.abort_handles.borrow().len();
                let unref_count = state.unrefed_timers.borrow().len();
                // When the only remaining abort handles are for unref'd timers,
                // abort them all (the sentinel itself is not tracked in abort_handles).
                if abort_count > 0 && abort_count == unref_count {
                    abort_unrefed_timers(state);
                    break;
                }
                if unref_count == 0 {
                    break;
                }
            }
        });
    })
    .await;
    js_state.rt.idle().await;
}

static mut STATE: Option<JsState> = None;
static mut INIT_PHASE: InitPhase = InitPhase::Uninitialized;

/// True while `wizer_initialize` is running. Used by built-in modules to avoid
/// std::fs / std::env operations during Wizer pre-init: those would trigger
/// wasi-libc's lazy preopen-cache population with the empty wizer environment,
/// and the broken cache would then be snapshotted into the pre-initialized
/// component, breaking filesystem access at runtime. See issue #91.
static WIZER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[inline]
pub fn is_wizer_active() -> bool {
    WIZER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
}

#[allow(static_mut_refs)]
pub fn get_js_state() -> &'static JsState {
    unsafe {
        match INIT_PHASE {
            InitPhase::Uninitialized => {
                // Phase 1: Create the runtime and all Rust-side state (no JS evaluation).
                STATE = Some(block_on(JsState::new_base()));
                // Mark as Initializing so re-entrant get_js_state() calls (e.g.
                // from setTimeout callbacks during module init) return the existing
                // state instead of re-running initialization.
                INIT_PHASE = InitPhase::Initializing;
                // Phase 2: Evaluate JS modules.
                block_on(STATE.as_ref().unwrap().finish_init());
                INIT_PHASE = InitPhase::FullyInitialized;
            }
            InitPhase::WizerPreInitialized => {
                // Wizer snapshot restored — refresh argv/env from the real host.
                let state = STATE.as_ref().unwrap();
                block_on(JsState::refresh_process_env(state));
                INIT_PHASE = InitPhase::FullyInitialized;
            }
            InitPhase::Initializing | InitPhase::FullyInitialized => {
                // Already initialized or in progress — return existing state.
            }
        }
        STATE.as_ref().unwrap()
    }
}

pub fn async_exported_function<F: Future>(future: F) -> F::Output {
    let js_state = get_js_state();

    block_on(async move {
        use futures::StreamExt;

        if let Some(mut resource_drop_queue_rx) = js_state.resource_drop_queue_rx.take() {
            let resource_dropper = async move {
                while let Some(resource_id) = resource_drop_queue_rx.next().await {
                    if resource_id > 0 {
                        drop_js_resource(resource_id).await;
                    } else {
                        break;
                    }
                }
                resource_drop_queue_rx
            };

            // Finish resource dropper
            js_state
                .resource_drop_queue_tx
                .unbounded_send(0)
                .expect("Failed to enqueue resource dropper stop signal");
            let (result, resource_drop_queue_rx) = (future, resource_dropper).join().await;
            js_state
                .resource_drop_queue_rx
                .replace(Some(resource_drop_queue_rx));

            result
        } else {
            // This case will never happen because block_on does not allow reentry
            unreachable!()
        }
    })
}

pub async fn call_js_export<A, R>(wit_package: &str, function_path: &[&str], args: A) -> R
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
{
    call_js_export_internal(wit_package, function_path, args, |a| a, |_, _| None).await
}

pub async fn call_js_export_returning_result<A, R, E>(
    wit_package: &str,
    function_path: &[&str],
    args: A,
) -> crate::wrappers::JsResult<R, E>
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    E: for<'js> FromJs<'js> + 'static,
{
    call_js_export_internal(
        wit_package,
        function_path,
        args,
        |a| crate::wrappers::JsResult(Ok(a)),
        |ctx, value| {
            FromJs::from_js(ctx, value.clone())
                .ok()
                .map(|e| crate::wrappers::JsResult(Err(e)))
        },
    )
    .await
}

async fn call_js_export_internal<A, R, FR, TME>(
    wit_package: &str,
    function_path: &[&str],
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = get_js_state();

    let result: FR = async_with!(js_state.ctx => |ctx| {
        let module: Object = ctx.globals().get("userModule").expect("Failed to get userModule");
        let (user_function_obj, parent): (Object, Object) = get_path(&module, function_path).unwrap_or_else(|| panic!("{}", dump_cannot_find_export("exported JS function", function_path, &module, wit_package)));
        let user_function = user_function_obj.as_function().unwrap_or_else(|| panic!("Expected export {} to be a function", function_path.join("."))).clone();

        let parameter_count = user_function_obj.get::<&str, usize>("length").unwrap_or_else(|_| panic!("Failed to get parameter count of exported function {}", function_path.join(".")));
        if parameter_count != args.num_args() {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript function got {} parameters (exported function {} in WIT package {})",
                args.num_args(),
                parameter_count,
                function_path.join("."),
                wit_package
            );
        }

        let result: Result<Value, Error> = call_with_this(ctx.clone(), user_function, parent, args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                if let Some(result) = try_map_exception(&ctx, &exception) {
                    result
                } else {
                    panic! ("Exception during call of {fun}:\n{exception}", fun = function_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic! ("Error during call of {fun}:\n{e:?}", fun = function_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    let promise: Promise = value.into_promise().unwrap();
                    let promise_future = promise.into_future::<R> ();

                    match promise_future.await {
                        Ok(result) => {
                            map_result(result)
                        }
                        Err(e) => {
                            match e {
                                Error::Exception => {
                                    let exception = ctx.catch();
                                    if let Some(result) = try_map_exception(&ctx, &exception) {
                                        result
                                    } else {
                                        panic! ("Exception during awaiting call result for {function_path}:\n{exception}", function_path=function_path.join("."), exception = format_js_exception(&exception))
                                    }
                                }
                                _ => {
                                    panic ! ("Error during awaiting call result for {function_path}:\n{e:?}", function_path=function_path.join("."))
                                }
                            }
                        }
                    }
                }
                else {
                    (map_result)(
                        R::from_js(&ctx, value).unwrap_or_else(|err| panic!("Unexpected result value for exported function {path}: {err}", path=function_path.join(".")))
                    )
                }
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

pub async fn call_js_resource_constructor<A>(
    wit_package: &str,
    resource_path: &[&str],
    args: A,
) -> usize
where
    A: for<'js> IntoArgs<'js>,
{
    let js_state = get_js_state();

    let result = async_with!(js_state.ctx => |ctx| {
        let module: Object = ctx.globals().get("userModule").expect("Failed to get userModule");
        let (constructor_obj, _parent): (Constructor, Object) = get_path(&module, resource_path).unwrap_or_else(|| panic!("{}", dump_cannot_find_export("exported JS resource class", resource_path, &module, wit_package)));
        let constructor = constructor_obj.as_constructor().unwrap_or_else(|| panic!("Expected export {path} to be a class with a constructor", path = resource_path.join("."))).clone();

        let parameter_count = constructor_obj.get::<&str, usize>("length").unwrap_or_else(|_| panic!("Failed to get parameter count of exported constructor {}", resource_path.join(".")));
        if parameter_count != args.num_args() {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript constructor got {} parameters (exported constructor {} in WIT package {})",
                args.num_args(),
                parameter_count,
                resource_path.join("."),
                wit_package
            );
        }

        let result: Result<Object, Error> = constructor.construct(args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                panic! ("Exception during call of constructor {path}:\n{exception}", path= resource_path.join("."), exception = format_js_exception(&exception));
            }
            Err(e) => {
                panic! ("Error during call of constructor {path}: {e:?}", path= resource_path.join("."));
            }
            Ok(resource) => {
                let resource_id = get_free_resource_id();
                resource.set(RESOURCE_ID_KEY, resource_id)
                    .expect("Failed to set resource ID");
                let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
                    .expect("Failed to get the resource table");
                resource_table
                    .set(resource_id.to_string(), resource)
                    .expect("Failed to store resource instance");

                resource_id
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

pub fn get_free_resource_id() -> usize {
    get_js_state()
        .last_resource_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

pub async fn call_js_resource_method<A, R>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
) -> R
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
{
    call_js_resource_method_internal(
        wit_package,
        resource_path,
        resource_id,
        name,
        args,
        |a| a,
        |_, _| None,
    )
    .await
}

pub async fn call_js_resource_method_returning_result<A, R, E>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
) -> crate::wrappers::JsResult<R, E>
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    E: for<'js> FromJs<'js> + 'static,
{
    call_js_resource_method_internal(
        wit_package,
        resource_path,
        resource_id,
        name,
        args,
        |a| crate::wrappers::JsResult(Ok(a)),
        |ctx, value| {
            FromJs::from_js(ctx, value.clone())
                .ok()
                .map(|e| crate::wrappers::JsResult(Err(e)))
        },
    )
    .await
}

async fn call_js_resource_method_internal<A, R, FR, TME>(
    wit_package: &str,
    resource_path: &[&str],
    resource_id: usize,
    name: &str,
    args: A,
    map_result: impl Fn(R) -> FR,
    try_map_exception: TME,
) -> FR
where
    A: for<'js> IntoArgs<'js>,
    R: for<'js> FromJs<'js> + 'static,
    FR: 'static,
    TME: for<'js> Fn(&Ctx<'js>, &Value<'js>) -> Option<FR>,
{
    let js_state = get_js_state();

    let result: FR = async_with!(js_state.ctx => |ctx| {
        let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
            .expect("Failed to get the resource table");
        let resource_instance: Object = resource_table.get(resource_id.to_string())
            .unwrap_or_else(|_| panic!("Failed to get resource instance with id #{resource_id} of class {}", resource_path.join(".")));

        let method_obj: Object = resource_instance.get(name)
            .unwrap_or_else(|_| panic!("{}", dump_cannot_find_method(
                name,
                resource_path,
                &resource_instance,
                wit_package,
            )));

        let method = method_obj.as_function().unwrap_or_else(|| panic!("Expected method {name} to be a function in class {}", resource_path.join("."))).clone();

        let parameter_count = method.get::<&str, usize>("length").unwrap_or_else(|_| panic!("Failed to get parameter count of exported method {name} in class {}", resource_path.join(".")));
        if parameter_count != args.num_args() {
            panic!(
                "The WIT specification defines {} parameters,\nbut the exported JavaScript method got {} parameters (exported method {} of class {} representing a resource defined in WIT package {})",
                args.num_args(),
                parameter_count,
                name,
                resource_path.join("."),
                wit_package
            );
        }

        let result: Result<Value, Error> = call_with_this(ctx.clone(), method, resource_instance, args);

        match result {
            Err(Error::Exception) => {
                let exception = ctx.catch();
                if let Some(result) = try_map_exception(&ctx, &exception) {
                    result
                } else {
                    panic!("Exception during call of method {name} in {path}:\n{exception}", path=resource_path.join("."), exception = format_js_exception(&exception));
                }
            }
            Err(e) => {
                panic!("Error during call of method {name} in {path}:\n{e:?}", path=resource_path.join("."));
            }
            Ok(value) => {
                if value.is_promise() {
                    let promise: Promise = value.into_promise().unwrap();
                    let promise_future = promise.into_future::<R> ();
                    match promise_future.await {
                        Ok(result) => {
                            map_result(result)
                        }
                        Err(e) => {
                            match e {
                                Error::Exception => {
                                    let exception = ctx.catch();
                                    if let Some(result) = try_map_exception(&ctx, &exception) {
                                        result
                                    } else {
                                        panic!("Exception during awaiting call result of method {name} in {path}:\n{exception:?}", path=resource_path.join("."), exception = format_js_exception(&exception));
                                    }
                                }
                                _ => {
                                    panic!("Error during awaiting call result of method {name} in {path}:\n{e:?}", path=resource_path.join("."));
                                }
                            }
                        }
                    }
                }
                else {
                    map_result(R::from_js(&ctx, value).unwrap_or_else(|err| panic!("Unexpected result value for method {name} in exported class {path}: {err}",
                                path=resource_path.join("."))))
                }
            }
        }
    }).await;
    drain_and_idle(js_state).await;
    result
}

pub fn enqueue_drop_js_resource(resource_id: usize) {
    let js_state = get_js_state();
    js_state
        .resource_drop_queue_tx
        .unbounded_send(resource_id)
        .expect("Failed to enqueue resource drop");
}

async fn drop_js_resource(resource_id: usize) {
    let js_state = get_js_state();

    async_with!(js_state.ctx => |ctx| {
        let resource_table: Object = ctx.globals().get(RESOURCE_TABLE_NAME)
            .expect("Failed to get the resource table");
        if let Err(e) = resource_table.remove(resource_id.to_string()) {
            panic!("Failed to delete resource {resource_id}: {e:?}");
        }
    })
    .await;
    js_state.rt.idle().await;
}

fn call_with_this<'js, A, R>(
    ctx: Ctx<'js>,
    function: Function<'js>,
    this: Object<'js>,
    args: A,
) -> rquickjs::Result<R>
where
    A: IntoArgs<'js>,
    R: FromJs<'js>,
{
    let num = args.num_args();
    let mut accum_args = Args::new(ctx.clone(), num + 1);
    accum_args.this(this)?;
    args.into_args(&mut accum_args)?;
    function.call_arg(accum_args)
}

fn get_path<'js, V: FromJs<'js>>(root: &Object<'js>, path: &[&str]) -> Option<(V, Object<'js>)> {
    let (head, tail) = path.split_first()?;
    if tail.is_empty() {
        root.get(*head).ok().map(|v| (v, root.clone()))
    } else {
        let next: Object<'js> = root.get(*head).ok()?;
        get_path(&next, tail)
    }
}

fn dump_cannot_find_export(
    what: &str,
    path: &[&str],
    module: &Object,
    wit_package: &str,
) -> String {
    let mut panic_message = String::new();
    panic_message.push_str(&format!(
        "Cannot find {what} {} of WIT package {wit_package}",
        path.join(".")
    ));
    panic_message.push_str("\nProvided exports:\n");
    let mut keys: Vec<String> = vec![];
    for key in module.keys().flatten() {
        keys.push(key);
    }
    keys.sort();
    panic_message.push_str(&format!("  {}\n", keys.join(", ")));

    if path.len() == 1 {
        panic_message.push_str(&format!(
            "\nTry adding an export `export const {} = ...`\n",
            path[0]
        ));
    } else if path.len() > 1 {
        let mut current_object = module.clone();
        for i in 0..path.len() {
            match current_object.get::<&str, Object>(path[i]) {
                Ok(child) => {
                    current_object = child;
                }
                Err(_) => {
                    if i == 0 {
                        panic_message.push_str(&format!(
                            "\nTry adding an export `export const {} = {{ ... }}`\n",
                            path[i]
                        ));
                    } else {
                        panic_message.push_str(&format!("\nKeys in {}:\n", path[..i].join(".")));
                        let mut keys: Vec<String> = vec![];
                        for key in current_object.keys().flatten() {
                            keys.push(key);
                        }
                        keys.sort();
                        panic_message.push_str(&format!("  {}\n", keys.join(", ")));

                        panic_message.push_str(&format!(
                            "\nTry adding a field `{}` to {}\n",
                            path[i],
                            path[..i].join(".")
                        ));
                    }
                    break;
                }
            }
        }
    }
    panic_message
}

fn dump_cannot_find_method(
    name: &str,
    resource_path: &[&str],
    class_instance: &Object,
    wit_package: &str,
) -> String {
    let mut panic_message = String::new();
    panic_message.push_str(&format!(
        "Cannot find method {name} in an instance of class {path} of WIT package {wit_package}",
        path = resource_path.join(".")
    ));
    if let Some(prototype) = class_instance.get_prototype() {
        panic_message.push_str("\nKeys in the instance's prototype:\n");
        let mut keys: Vec<String> = vec![];
        for key in prototype
            .own_keys(Filter::new().symbol().string().private())
            .flatten()
        {
            keys.push(key);
        }
        keys.sort();
        panic_message.push_str(&format!("  {}\n", keys.join(", ")));
    }

    panic_message.push_str(&format!(
        "\nTry adding a method `{}() {{ ... }}` to class {path}\n",
        name,
        path = resource_path.join(".")
    ));

    panic_message
}

pub fn format_js_exception(exc: &Value) -> String {
    try_format_js_error(exc)
        .or_else(|| try_format_tagged_error(exc))
        .unwrap_or_else(|| {
            let formatted_exc = pretty_stringify_or_debug_print(exc);
            if formatted_exc.contains("\n") {
                format!("JavaScript exception:\n{formatted_exc}",)
            } else {
                format!("JavaScript exception: {formatted_exc}",)
            }
        })
}

pub fn try_format_js_error(err: &Value) -> Option<String> {
    let error_ctor: Object = err.ctx().globals().get("Error").ok()?;
    let obj = err.as_object()?;

    if !obj.is_instance_of(error_ctor) {
        return None;
    }

    let message: Option<String> = obj.get("message").ok();
    let stack: Option<String> = obj.get("stack").ok();

    match (message, stack) {
        (Some(msg), Some(st)) => Some(format!("JavaScript error: {msg}\nStack:\n{st}")),
        (Some(msg), None) => Some(format!("JavaScript error: {msg}")),
        (None, Some(st)) => Some(format!("JavaScript error: <no message>\nStack:\n{st}")),
        _ => None,
    }
}

pub fn try_format_tagged_error(err: &Value) -> Option<String> {
    let obj = err.as_object()?;
    let tag: Option<String> = obj.get("tag").ok();
    let val: Option<Value> = obj.get("val").ok();
    let val = val.and_then(|v| (!v.is_undefined()).then_some(v));

    match (tag, val) {
        (Some(tag), Some(val)) => {
            let formatted_val = pretty_stringify_or_debug_print(&val);
            if formatted_val.contains("\n") {
                Some(format!("Error: {tag}:\n{formatted_val}"))
            } else {
                Some(format!("Error: {tag}: {formatted_val}"))
            }
        }
        (Some(tag), None) => Some(format!("Error: {tag}")),
        _ => None,
    }
}

fn pretty_stringify_or_debug_print(val: &Value) -> String {
    if let Some(formatted) = try_pretty_stringify(val) {
        formatted
    } else {
        format!("{val:#?}")
    }
}

fn try_pretty_stringify(val: &Value) -> Option<String> {
    if val.is_undefined() {
        return Some("undefined".to_string());
    }

    // Return strings as they are
    if let Some(str) = val.as_string() {
        return str.to_string().ok();
    }

    // For other values try to use JSON.stringify()
    let json: Object = val.ctx().globals().get("JSON").ok()?;
    let stringify: Function = json.get("stringify").ok()?;
    let res: Result<String, Error> = stringify.call((val, rquickjs::Undefined, 2));
    res.ok()
}

pub fn format_caught_error(caught: CaughtError) -> String {
    match caught {
        CaughtError::Error(e) => {
            format!("Host error: {e:?}")
        }
        CaughtError::Exception(exc) => format_js_exception(&exc.into_value()),
        CaughtError::Value(val) => format_js_exception(&val),
    }
}

/// Wizer pre-initialization entry point: full initialization including user module.
/// After Wizer snapshots this state, the runtime is ready to handle exports immediately.
#[allow(static_mut_refs)]
pub fn wizer_initialize() {
    // Mark Wizer pre-init as active so built-in modules avoid touching
    // std::fs / std::env: those would trigger wasi-libc's lazy preopen-cache
    // population with the empty wizer environment, and the broken cache would
    // then be snapshotted into the pre-initialized component (issue #91).
    WIZER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);

    unsafe {
        // Phase 1: Create runtime
        STATE = Some(block_on(JsState::new_base()));

        // Mark as Initializing so re-entrant get_js_state() calls (e.g.
        // from setTimeout callbacks during module init) return the existing
        // state instead of re-running initialization.
        INIT_PHASE = InitPhase::Initializing;

        // Phase 2: Full initialization
        block_on(STATE.as_ref().unwrap().finish_init());

        // Run GC to compact the heap before snapshot
        block_on(async {
            let state = STATE.as_ref().unwrap();
            drain_and_idle(state).await;
            async_with!(state.ctx => |ctx| {
                ctx.run_gc();
                ctx.run_gc();
            })
            .await;
            drain_and_idle(state).await;

            // Verify clean state
            assert!(
                state.abort_handles.borrow().is_empty(),
                "pending timers/tasks at snapshot time"
            );
            assert!(
                state.unrefed_timers.borrow().is_empty(),
                "unrefed timers still tracked at snapshot time"
            );
        });

        INIT_PHASE = InitPhase::WizerPreInitialized;
    }

    WIZER_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
}
