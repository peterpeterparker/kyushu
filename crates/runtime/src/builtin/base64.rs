// JS functions for the base64 implementation
pub const BASE64_JS: &str = include_str!("base64.js");

// Native functions for the base64 implementation
#[rquickjs::module]
pub mod native_module {
    const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    #[rquickjs::function]
    pub fn btoa_raw(input: String) -> Option<String> {
        let mut bytes = Vec::with_capacity(input.len());
        for c in input.chars() {
            if c as u32 > 255 {
                return None;
            }
            bytes.push(c as u8);
        }

        let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

            result.push(BASE64_CHARS[(b0 >> 2) as usize] as char);
            result.push(BASE64_CHARS[((b0 & 3) << 4 | (b1 >> 4)) as usize] as char);
            if chunk.len() > 1 {
                result.push(BASE64_CHARS[((b1 & 0xF) << 2 | (b2 >> 6)) as usize] as char);
            } else {
                result.push('=');
            }
            if chunk.len() > 2 {
                result.push(BASE64_CHARS[(b2 & 0x3F) as usize] as char);
            } else {
                result.push('=');
            }
        }

        Some(result)
    }

    #[rquickjs::function]
    pub fn atob_raw(input: String) -> Option<String> {
        let encoded: String = input
            .chars()
            .filter(|c| !matches!(c, '\t' | '\n' | '\x0C' | '\r' | ' '))
            .collect();

        if encoded.len() % 4 == 1 {
            return None;
        }

        let mut lookup = [255u8; 128];
        for (i, &b) in BASE64_CHARS.iter().enumerate() {
            lookup[b as usize] = i as u8;
        }
        lookup[b'=' as usize] = 0;

        let chars: Vec<u8> = encoded.bytes().collect();
        let mut result = Vec::with_capacity(chars.len() * 3 / 4);

        for chunk in chars.chunks(4) {
            if chunk.len() < 2 {
                break;
            }
            let a = if (chunk[0] as usize) < 128 {
                lookup[chunk[0] as usize]
            } else {
                255
            };
            let b = if (chunk[1] as usize) < 128 {
                lookup[chunk[1] as usize]
            } else {
                255
            };

            if a == 255 || b == 255 {
                return None;
            }

            result.push((a << 2) | (b >> 4));

            if chunk.len() > 2 && chunk[2] != b'=' {
                let c = if (chunk[2] as usize) < 128 {
                    lookup[chunk[2] as usize]
                } else {
                    255
                };
                if c == 255 {
                    return None;
                }
                result.push(((b & 0xF) << 4) | (c >> 2));

                if chunk.len() > 3 && chunk[3] != b'=' {
                    let d = if (chunk[3] as usize) < 128 {
                        lookup[chunk[3] as usize]
                    } else {
                        255
                    };
                    if d == 255 {
                        return None;
                    }
                    result.push(((c & 3) << 6) | d);
                }
            }
        }

        Some(result.into_iter().map(|b| b as char).collect())
    }
}

// JS code wiring atob/btoa into the global context
pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_base64_native from '__wasm_rquickjs_builtin/base64_native';
        globalThis.btoa = function btoa() {
            if (arguments.length === 0) throw new TypeError("Failed to execute 'btoa': 1 argument required, but only 0 present.");
            var result = __wasm_rquickjs_base64_native.btoa_raw('' + arguments[0]);
            if (result == null) throw new DOMException("Failed to execute 'btoa': The string to be encoded contains characters outside of the Latin1 range.", "InvalidCharacterError");
            return result;
        };
        globalThis.atob = function atob() {
            if (arguments.length === 0) throw new TypeError("Failed to execute 'atob': 1 argument required, but only 0 present.");
            var result = __wasm_rquickjs_base64_native.atob_raw('' + arguments[0]);
            if (result == null) throw new DOMException("Failed to execute 'atob': The string to be decoded is not correctly encoded.", "InvalidCharacterError");
            return result;
        };
    "#;
