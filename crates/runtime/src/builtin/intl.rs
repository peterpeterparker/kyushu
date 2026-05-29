use std::cmp::Ordering;

use chrono::{DateTime, Datelike, Timelike, Utc};

#[rquickjs::module]
pub mod native_module {
    use rquickjs::prelude::*;

    // Returns flat tuple: (year, month, day, hour, minute, second, weekday, utc_offset_minutes, error)
    #[rquickjs::function]
    #[allow(clippy::type_complexity)]
    pub fn intl_dtf_resolve_fields(
        timestamp_ms: f64,
        timezone: String,
    ) -> List<(i32, u32, u32, u32, u32, u32, u32, i32, Option<String>)> {
        match super::dtf_resolve_impl(timestamp_ms, &timezone) {
            Ok(r) => List((
                r.year,
                r.month,
                r.day,
                r.hour,
                r.minute,
                r.second,
                r.weekday,
                r.utc_offset_minutes,
                None,
            )),
            Err(error) => List((0, 0, 0, 0, 0, 0, 0, 0, Some(error))),
        }
    }

    #[rquickjs::function]
    pub fn intl_validate_timezone(tz: String) -> bool {
        super::validate_timezone_impl(&tz)
    }

    #[rquickjs::function]
    pub fn intl_collator_compare(
        a: String,
        b: String,
        sensitivity: String,
        numeric: bool,
        ignore_punctuation: bool,
    ) -> i32 {
        super::collator_compare_impl(&a, &b, &sensitivity, numeric, ignore_punctuation)
    }

    // Returns a JSON-encoded array of segments: [[utf16_start, segment_str, is_word_like], ...]
    // granularity: "grapheme" | "word" | "sentence"
    // For "grapheme" and "sentence", is_word_like is always false.
    // For "word", is_word_like indicates whether the segment is word-like (letters/numbers).
    #[rquickjs::function]
    pub fn intl_segment(text: String, granularity: String) -> String {
        super::segment_impl(&text, &granularity)
    }
}

struct DtfResolved {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    weekday: u32,
    utc_offset_minutes: i32,
}

fn dtf_resolve_impl(timestamp_ms: f64, timezone: &str) -> Result<DtfResolved, String> {
    let dt = DateTime::<Utc>::from_timestamp_millis(timestamp_ms as i64)
        .ok_or_else(|| format!("Invalid timestamp: {timestamp_ms}"))?;

    if timezone.eq_ignore_ascii_case("UTC") {
        Ok(DtfResolved {
            year: dt.year(),
            month: dt.month(),
            day: dt.day(),
            hour: dt.hour(),
            minute: dt.minute(),
            second: dt.second(),
            weekday: dt.weekday().num_days_from_monday() + 1,
            utc_offset_minutes: 0,
        })
    } else {
        resolve_named_timezone(dt, timezone)
    }
}

#[cfg(feature = "timezone")]
fn resolve_named_timezone(dt: DateTime<Utc>, timezone: &str) -> Result<DtfResolved, String> {
    use chrono::Offset;
    use std::str::FromStr;

    let tz =
        chrono_tz::Tz::from_str(timezone).map_err(|_| format!("Invalid timezone: {timezone}"))?;
    let civil = dt.with_timezone(&tz);
    let offset_seconds = civil.offset().fix().local_minus_utc();
    Ok(DtfResolved {
        year: civil.year(),
        month: civil.month(),
        day: civil.day(),
        hour: civil.hour(),
        minute: civil.minute(),
        second: civil.second(),
        weekday: civil.weekday().num_days_from_monday() + 1,
        utc_offset_minutes: offset_seconds / 60,
    })
}

#[cfg(not(feature = "timezone"))]
fn resolve_named_timezone(_dt: DateTime<Utc>, timezone: &str) -> Result<DtfResolved, String> {
    Err(format!(
        "Named timezone '{timezone}' is not supported without the 'timezone' feature"
    ))
}

fn validate_timezone_impl(tz: &str) -> bool {
    if tz.eq_ignore_ascii_case("UTC") {
        return true;
    }
    validate_named_timezone(tz)
}

#[cfg(feature = "timezone")]
fn validate_named_timezone(tz: &str) -> bool {
    use std::str::FromStr;
    chrono_tz::Tz::from_str(tz).is_ok()
}

#[cfg(not(feature = "timezone"))]
fn validate_named_timezone(_tz: &str) -> bool {
    false
}

fn collator_compare_impl(
    a: &str,
    b: &str,
    sensitivity: &str,
    numeric: bool,
    ignore_punctuation: bool,
) -> i32 {
    let filter_punct = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .collect()
    };
    let a_filtered;
    let b_filtered;
    let (a_str, b_str) = if ignore_punctuation {
        a_filtered = filter_punct(a);
        b_filtered = filter_punct(b);
        (a_filtered.as_str(), b_filtered.as_str())
    } else {
        (a, b)
    };

    let result = if numeric {
        natural_compare(a_str, b_str, sensitivity)
    } else {
        compare_text(a_str, b_str, sensitivity)
    };

    match result {
        Ordering::Less => -1,
        Ordering::Equal => 0,
        Ordering::Greater => 1,
    }
}

#[derive(Debug)]
enum Segment<'a> {
    Text(&'a str),
    Number(&'a str), // raw digit string, compared by magnitude without parsing
}

fn split_segments(s: &str) -> Vec<Segment<'_>> {
    let mut segments = Vec::new();
    let mut chars = s.char_indices().peekable();
    while chars.peek().is_some() {
        let (start, c) = *chars.peek().unwrap();
        if c.is_ascii_digit() {
            // Consume digit run
            while chars.peek().is_some_and(|(_, ch)| ch.is_ascii_digit()) {
                chars.next();
            }
            let end = chars.peek().map(|(i, _)| *i).unwrap_or(s.len());
            segments.push(Segment::Number(&s[start..end]));
        } else {
            // Consume non-digit run
            chars.next();
            while chars.peek().is_some_and(|(_, ch)| !ch.is_ascii_digit()) {
                chars.next();
            }
            let end = chars.peek().map(|(i, _)| *i).unwrap_or(s.len());
            segments.push(Segment::Text(&s[start..end]));
        }
    }
    segments
}

/// Compare two digit strings by numeric magnitude without parsing to integer.
/// Strips leading zeros, then compares by length (longer = larger), then lexicographically.
fn compare_numeric_strings(a: &str, b: &str) -> Ordering {
    let a_trimmed = a.trim_start_matches('0');
    let b_trimmed = b.trim_start_matches('0');
    a_trimmed
        .len()
        .cmp(&b_trimmed.len())
        .then_with(|| a_trimmed.cmp(b_trimmed))
}

fn compare_text(a: &str, b: &str, sensitivity: &str) -> Ordering {
    match sensitivity {
        "base" | "accent" => a.to_lowercase().cmp(&b.to_lowercase()),
        _ => a.cmp(b),
    }
}

fn natural_compare(a: &str, b: &str, sensitivity: &str) -> Ordering {
    let segs_a = split_segments(a);
    let segs_b = split_segments(b);

    for (sa, sb) in segs_a.iter().zip(segs_b.iter()) {
        let ord = match (sa, sb) {
            (Segment::Number(da), Segment::Number(db)) => compare_numeric_strings(da, db),
            (Segment::Text(ta), Segment::Text(tb)) => compare_text(ta, tb, sensitivity),
            // Number segments sort before text segments
            (Segment::Number(..), Segment::Text(_)) => Ordering::Less,
            (Segment::Text(_), Segment::Number(..)) => Ordering::Greater,
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }

    segs_a.len().cmp(&segs_b.len())
}

fn segment_impl(text: &str, granularity: &str) -> String {
    use std::fmt::Write;
    use unicode_segmentation::UnicodeSegmentation;

    let mut result = String::from("[");
    let mut first = true;

    match granularity {
        "grapheme" => {
            let mut utf16_offset: usize = 0;
            for grapheme in text.graphemes(true) {
                if !first {
                    result.push(',');
                }
                first = false;
                let escaped = json_escape(grapheme);
                let _ = write!(result, "[{utf16_offset},\"{escaped}\",false]");
                utf16_offset += grapheme.encode_utf16().count();
            }
        }
        "word" => {
            let mut utf16_offset: usize = 0;
            for (_, segment) in text.split_word_bound_indices() {
                if !first {
                    result.push(',');
                }
                first = false;
                let is_word_like = segment.chars().any(|c| c.is_alphanumeric());
                let escaped = json_escape(segment);
                let _ = write!(result, "[{utf16_offset},\"{escaped}\",{is_word_like}]");
                utf16_offset += segment.encode_utf16().count();
            }
        }
        "sentence" => {
            let mut utf16_offset: usize = 0;
            for (_, sentence) in text.split_sentence_bound_indices() {
                if !first {
                    result.push(',');
                }
                first = false;
                let escaped = json_escape(sentence);
                let _ = write!(result, "[{utf16_offset},\"{escaped}\",false]");
                utf16_offset += sentence.encode_utf16().count();
            }
        }
        _ => {}
    }

    result.push(']');
    result
}

fn json_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                escaped.push_str(&format!("\\u{:04x}", c as u32));
            }
            _ => escaped.push(c),
        }
    }
    escaped
}

pub const INTL_JS: &str = include_str!("intl.js");

pub const WIRE_JS: &str = r#"
        import * as __wasm_rquickjs_intl from '__wasm_rquickjs_builtin/intl';
        globalThis.Intl = __wasm_rquickjs_intl.Intl;
    "#;
