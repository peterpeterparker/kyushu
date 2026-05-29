#[cfg(feature = "encoding")]
use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE};
use rquickjs::JsLifetime;
use rquickjs::class::Trace;
use std::ptr;
use std::ptr::NonNull;

#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::convert::Coerced;
    use rquickjs::prelude::*;
    use rquickjs::{Ctx, TypedArray};

    #[rquickjs::function]
    pub fn supports_encoding(encoding: Coerced<String>) -> bool {
        let encoding = encoding.0;
        #[cfg(feature = "encoding")]
        {
            encoding_rs::Encoding::for_label(encoding.as_bytes()).is_some()
        }
        #[cfg(not(feature = "encoding"))]
        {
            let label = encoding.trim().to_ascii_lowercase();
            matches!(label.as_str(), "utf-8" | "utf8" | "unicode-1-1-utf-8")
        }
    }

    #[rquickjs::function]
    pub fn canonical_encoding(encoding: Coerced<String>) -> Option<String> {
        let encoding = encoding.0;
        #[cfg(feature = "encoding")]
        {
            encoding_rs::Encoding::for_label(encoding.as_bytes())
                .map(|encoding| encoding.name().to_ascii_lowercase())
        }
        #[cfg(not(feature = "encoding"))]
        {
            let label = encoding.trim().to_ascii_lowercase();
            match label.as_str() {
                "utf-8" | "utf8" | "unicode-1-1-utf-8" => Some("utf-8".to_string()),
                _ => None,
            }
        }
    }

    #[rquickjs::function]
    pub fn decode(
        bytes: TypedArray<'_, u8>,
        encoding: Coerced<String>,
        stream: bool,
        fatal: bool,
        ignore_bom: bool,
    ) -> List<(Option<String>, Option<String>)> {
        let encoding = encoding.0;
        let Some(bytes) = bytes.as_bytes() else {
            return List((Some(String::new()), None));
        };
        match super::decode_impl(bytes, encoding, stream, fatal, ignore_bom) {
            Ok(result) => List((Some(result), None)),
            Err(error) => List((None, Some(error))),
        }
    }

    #[rquickjs::function]
    pub fn encode(string: String, ctx: Ctx<'_>) -> TypedArray<'_, u8> {
        TypedArray::new_copy(ctx, string.as_bytes())
            .expect("failed to create UInt8Array from string")
    }

    #[rquickjs::function]
    pub fn encode_into(string: String, target: TypedArray<'_, u8>) -> super::EncodeIntoResult {
        let raw = target
            .as_raw()
            .expect("the UInt8Array passed to encodeInto is detached");
        super::encode_into_impl(&string, raw.len, raw.ptr)
    }
}

#[rquickjs::class]
#[derive(Trace, JsLifetime)]
pub struct EncodeIntoResult {
    #[qjs(get, enumerable)]
    pub read: usize,
    #[qjs(get, enumerable)]
    pub written: usize,
}

fn encode_into_impl(string: &str, target_len: usize, target: NonNull<u8>) -> EncodeIntoResult {
    let mut bytes_to_copy = 0;
    let mut chars_copied = 0;
    for (idx, ch) in string.char_indices() {
        let next = idx + ch.len_utf8();
        if next <= target_len {
            bytes_to_copy = next;
            chars_copied += 1;
        } else {
            break;
        }
    }
    unsafe { ptr::copy_nonoverlapping(string.as_ptr(), target.as_ptr(), bytes_to_copy) }

    EncodeIntoResult {
        read: chars_copied,
        written: bytes_to_copy,
    }
}

#[cfg(feature = "encoding")]
fn decode_impl(
    bytes: &[u8],
    encoding: String,
    _stream: bool,
    fatal: bool,
    ignore_bom: bool,
) -> Result<String, String> {
    let encoding = Encoding::for_label(encoding.as_bytes())
        .ok_or_else(|| format!("Unsupported encoding: {encoding}"))?;

    match (ignore_bom, fatal) {
        (false, false) => {
            let (result, _replaced) = encoding.decode_with_bom_removal(bytes);
            Ok(result.to_string())
        }
        (false, true) => {
            let without_bom = if encoding == UTF_8 && bytes.starts_with(b"\xEF\xBB\xBF") {
                &bytes[3..]
            } else if (encoding == UTF_16LE && bytes.starts_with(b"\xFF\xFE"))
                || (encoding == UTF_16BE && bytes.starts_with(b"\xFE\xFF"))
            {
                &bytes[2..]
            } else {
                bytes
            };
            let result = encoding
                .decode_without_bom_handling_and_without_replacement(without_bom)
                .ok_or_else(|| "Malformed input".to_string())?;
            Ok(result.to_string())
        }
        (true, false) => {
            let (result, _replaced) = encoding.decode_without_bom_handling(bytes);
            Ok(result.to_string())
        }
        (true, true) => {
            let result = encoding
                .decode_without_bom_handling_and_without_replacement(bytes)
                .ok_or_else(|| "Malformed input".to_string())?;
            Ok(result.to_string())
        }
    }
}

#[cfg(not(feature = "encoding"))]
fn decode_impl(
    bytes: &[u8],
    encoding: String,
    _stream: bool,
    fatal: bool,
    ignore_bom: bool,
) -> Result<String, String> {
    let label = encoding.trim().to_ascii_lowercase();
    if !matches!(label.as_str(), "utf-8" | "utf8" | "unicode-1-1-utf-8") {
        return Err(format!(
            "Encoding \"{encoding}\" is not supported (encoding feature is not enabled, only UTF-8 is available)"
        ));
    }

    let input = if !ignore_bom && bytes.starts_with(b"\xEF\xBB\xBF") {
        &bytes[3..]
    } else {
        bytes
    };

    if fatal {
        std::str::from_utf8(input)
            .map(|s| s.to_string())
            .map_err(|_| "Malformed input".to_string())
    } else {
        Ok(String::from_utf8_lossy(input).into_owned())
    }
}

pub const ENCODING_JS: &str = include_str!("encoding.js");

pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_encoding from '__wasm_rquickjs_builtin/encoding';
        globalThis.TextDecoder = __wasm_rquickjs_encoding.TextDecoder;
        globalThis.TextEncoder = __wasm_rquickjs_encoding.TextEncoder;
        globalThis.TextDecoderStream = __wasm_rquickjs_encoding.TextDecoderStream;
        globalThis.TextEncoderStream = __wasm_rquickjs_encoding.TextEncoderStream;
    "#;
