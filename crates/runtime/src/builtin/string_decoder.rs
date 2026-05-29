// JS implementation of node:string_decoder
pub const STRING_DECODER_JS: &str = include_str!("string_decoder.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:string_decoder';
export { default } from 'node:string_decoder';"#;

// ── V8-compatible UTF-8 DFA decoder ──────────────────────────────────────────
//
// Ported from V8's utf8-decoder.h (Björn Höhrmann's DFA, V8 variant).
// Produces the same replacement characters as V8/Node.js by implementing the
// "maximal subpart" rule: on rejection mid-sequence the current byte is
// retried from the Accept state.

/// DFA states
const REJECT: u8 = 0;
const ACCEPT: u8 = 12;

/// Byte-class table: maps each byte 0x00–0xFF to a type 0–11.
/// Derived from V8's utf8-decoder.h.
#[rustfmt::skip]
const BYTE_CLASS: [u8; 256] = [
    // 00–0F: ASCII
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 10–1F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 20–2F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 30–3F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 40–4F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 50–5F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 60–6F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 70–7F
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    // 80–8F: continuation (low)
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    // 90–9F: continuation (mid)
    2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,
    // A0–AF: continuation (high)
    3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,
    // B0–BF: continuation (high)
    3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,
    // C0–C1: invalid lead (overlong)
    9,9,
    // C2–DF: 2-byte lead
    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
    // E0: 3-byte lead (overlong-sensitive)
    10,
    // E1–EC: 3-byte lead (ordinary)
    5,5,5,5,5,5,5,5,5,5,5,5,
    // ED: 3-byte lead (surrogate range)
    6,
    // EE–EF: 3-byte lead (ordinary)
    5,5,
    // F0: 4-byte lead (overlong-sensitive)
    11,
    // F1–F3: 4-byte lead (mid)
    7,7,7,
    // F4: 4-byte lead (high boundary)
    8,
    // F5–FF: invalid lead
    9,9,9,9,9,9,9,9,9,9,9,
];

/// State-transition table: indexed by (state + byte_class).
/// 9 states × 12 types = 108 entries.
#[rustfmt::skip]
const TRANSITIONS: [u8; 108] = [
    // state 0 = REJECT: all transitions stay in REJECT
     0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 12 = ACCEPT
    12, 0, 0, 0,24,36,84,60,72, 0,48,96,
    // state 24 = TWO_BYTE (need 1 continuation 80–BF)
     0,12,12,12, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 36 = THREE_BYTE (need 1 continuation 80–BF, then same)
     0,24,24,24, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 48 = THREE_BYTE_LOW_MID (after E0: need A0–BF)
     0, 0,24,24, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 60 = FOUR_BYTE (after F1–F3: need 80–BF continuation)
     0,36,36,36, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 72 = FOUR_BYTE_LOW (after F4: need 80–8F only)
     0,36, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 84 = THREE_BYTE_HIGH (after ED: need 80–9F only, reject A0–BF surrogates)
     0,24,24, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    // state 96 = FOUR_BYTE_MID_HIGH (after F0: need 90–BF)
     0, 0,36,36, 0, 0, 0, 0, 0, 0, 0, 0,
];

/// Decode a byte slice to a UTF-16 string using V8's maximal-subpart DFA.
/// Returns a String with U+FFFD for each maximal invalid subsequence.
fn utf8_decode_v8(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    let mut state = ACCEPT;
    let mut codepoint: u32 = 0;
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];
        let byte_type = BYTE_CLASS[byte as usize];
        let prev_state = state;

        state = TRANSITIONS[(state + byte_type) as usize];
        // Accumulate bits: for lead bytes use the mask based on byte type,
        // for continuation bytes use 0x3F
        codepoint = (codepoint << 6) | (byte as u32 & (0x7F >> (byte_type >> 1)));

        if state == REJECT {
            // Emit one U+FFFD for the maximal subpart
            out.push('\u{FFFD}');
            state = ACCEPT;
            codepoint = 0;
            if prev_state != ACCEPT {
                // Retry current byte from Accept state
                continue;
            }
            // else: bad lead byte itself — advance
        } else if state == ACCEPT {
            // Complete codepoint
            if let Some(c) = char::from_u32(codepoint) {
                out.push(c);
            } else {
                out.push('\u{FFFD}');
            }
            codepoint = 0;
        }
        // else: intermediate state — bits already accumulated above

        i += 1;
    }

    // Dangling incomplete sequence at end of input
    if state != ACCEPT {
        out.push('\u{FFFD}');
    }

    out
}

// Native functions for the string_decoder implementation
#[rquickjs::module]
pub mod native_module {
    use rquickjs::TypedArray;

    /// Decode a UTF-8 byte slice using V8-compatible replacement characters.
    /// Takes a Uint8Array and (start, end) offsets.
    #[rquickjs::function]
    pub fn utf8_decode(bytes: TypedArray<'_, u8>, start: usize, end: usize) -> String {
        let buf = bytes
            .as_bytes()
            .expect("Uint8Array passed to utf8_decode is detached");
        let end = end.min(buf.len());
        let start = start.min(end);
        super::utf8_decode_v8(&buf[start..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ascii() {
        assert_eq!(utf8_decode_v8(b"hello"), "hello");
    }

    #[test]
    fn test_valid_multibyte() {
        // € = E2 82 AC
        assert_eq!(utf8_decode_v8(&[0xE2, 0x82, 0xAC]), "€");
        // 𤭢 = F0 A4 AD A2
        assert_eq!(utf8_decode_v8(&[0xF0, 0xA4, 0xAD, 0xA2]), "𤭢");
    }

    #[test]
    fn test_f0_b8_41() {
        // F0 B8 41: F0 B8 is a valid start of a 4-byte seq, 41 breaks it
        // → one FFFD for the maximal subpart, then 'A'
        let result = utf8_decode_v8(&[0xF0, 0xB8, 0x41]);
        assert_eq!(result, "\u{FFFD}A");
    }

    #[test]
    fn test_cesu8_surrogates() {
        // ED A0 B5 ED B0 8D: CESU-8 surrogates → 6 × FFFD
        let result = utf8_decode_v8(&[0xED, 0xA0, 0xB5, 0xED, 0xB0, 0x8D]);
        assert_eq!(result, "\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}");
    }

    #[test]
    fn test_c9_b5_a9_41() {
        // C9 B5 A9 41
        let result = utf8_decode_v8(&[0xC9, 0xB5, 0xA9, 0x41]);
        assert_eq!(result, "\u{0275}\u{FFFD}A");
    }

    #[test]
    fn test_e2_alone() {
        // E2 alone → FFFD
        assert_eq!(utf8_decode_v8(&[0xE2]), "\u{FFFD}");
    }

    #[test]
    fn test_e2_41() {
        // E2 41 → FFFD A
        assert_eq!(utf8_decode_v8(&[0xE2, 0x41]), "\u{FFFD}A");
    }

    #[test]
    fn test_cc_cc_b8() {
        // CC CC B8
        let result = utf8_decode_v8(&[0xCC, 0xCC, 0xB8]);
        assert_eq!(result, "\u{FFFD}\u{0338}");
    }

    #[test]
    fn test_f0_b8_41_hex() {
        // F0 B8 41 → FFFD A
        let result = utf8_decode_v8(&[0xF0, 0xB8, 0x41]);
        assert_eq!(result, "\u{FFFD}A");
    }

    #[test]
    fn test_f1_cc_b8() {
        // F1 CC B8 → FFFD 0338
        let result = utf8_decode_v8(&[0xF1, 0xCC, 0xB8]);
        assert_eq!(result, "\u{FFFD}\u{0338}");
    }

    #[test]
    fn test_f0_fb_00() {
        // F0 FB 00 → FFFD FFFD NUL
        let result = utf8_decode_v8(&[0xF0, 0xFB, 0x00]);
        assert_eq!(result, "\u{FFFD}\u{FFFD}\0");
    }

    #[test]
    fn test_cc_e2_b8_b8() {
        // CC E2 B8 B8 → FFFD 2E38
        let result = utf8_decode_v8(&[0xCC, 0xE2, 0xB8, 0xB8]);
        assert_eq!(result, "\u{FFFD}\u{2E38}");
    }

    #[test]
    fn test_e2_b8_cc_b8() {
        // E2 B8 CC B8 → FFFD 0338
        let result = utf8_decode_v8(&[0xE2, 0xB8, 0xCC, 0xB8]);
        assert_eq!(result, "\u{FFFD}\u{0338}");
    }

    #[test]
    fn test_e2_fb_cc_01() {
        // E2 FB CC 01 → FFFD FFFD FFFD SOH
        let result = utf8_decode_v8(&[0xE2, 0xFB, 0xCC, 0x01]);
        assert_eq!(result, "\u{FFFD}\u{FFFD}\u{FFFD}\u{0001}");
    }

    #[test]
    fn test_cc_b8_cd_b9() {
        // CC B8 CD B9 → 0338 0379
        let result = utf8_decode_v8(&[0xCC, 0xB8, 0xCD, 0xB9]);
        assert_eq!(result, "\u{0338}\u{0379}");
    }
}
