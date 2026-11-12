//! Best-effort text recovery from raw legacy bytes.
//!
//! Legacy Works formats are proprietary and only partially documented. Rather
//! than fail, this module recovers readable text by scanning for runs of
//! printable characters in both single-byte (Latin-1) and UTF-16LE encodings,
//! then picks whichever yields more text. This is the graceful-degradation
//! path required by `AC-LEG-2`.

use crate::report::Encoding;

/// Minimum length (in characters, after trimming) for a run to be kept.
const MIN_RUN: usize = 4;

/// Text recovered from a byte payload.
pub(crate) struct Recovered {
    /// Recovered text blocks (paragraphs / rows), in order.
    pub blocks: Vec<String>,
    /// The encoding the text was recovered with.
    pub encoding: Encoding,
    /// Total number of characters recovered across all blocks.
    pub chars: usize,
}

/// Recover text from `payload`, choosing the encoding that yields the most text.
pub(crate) fn recover_text(payload: &[u8]) -> Recovered {
    let latin1 = scan_latin1(payload);
    let utf16 = scan_utf16le(payload);

    let latin1_chars = count_chars(&latin1);
    let utf16_chars = count_chars(&utf16);

    if utf16_chars > latin1_chars {
        Recovered {
            blocks: utf16,
            encoding: Encoding::Utf16Le,
            chars: utf16_chars,
        }
    } else {
        Recovered {
            blocks: latin1,
            encoding: Encoding::Latin1,
            chars: latin1_chars,
        }
    }
}

fn count_chars(blocks: &[String]) -> usize {
    blocks.iter().map(|b| b.chars().count()).sum()
}

/// Whether a character counts as readable Western text.
///
/// Restricted to printable ASCII and the Latin-1 supplement. This deliberately
/// excludes characters that arise from *misinterpreting* binary (e.g. CJK or
/// combining marks produced by decoding arbitrary bytes as UTF-16), which keeps
/// the encoding heuristic from being fooled by noise.
fn is_readable(ch: char) -> bool {
    matches!(ch, ' '..='~') || matches!(u32::from(ch), 0x00A0..=0x00FF)
}

/// Push `current` as a block if it has enough readable content, then clear it.
fn flush(blocks: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if trimmed.chars().count() >= MIN_RUN {
        blocks.push(trimmed.to_owned());
    }
    current.clear();
}

/// Scan single-byte (Latin-1) text: each byte maps to U+00xx.
fn scan_latin1(bytes: &[u8]) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    for &byte in bytes {
        let ch = char::from(byte);
        if is_readable(ch) {
            current.push(ch);
        } else {
            flush(&mut blocks, &mut current);
        }
    }
    flush(&mut blocks, &mut current);
    blocks
}

/// Scan UTF-16LE text: each little-endian `u16` is decoded to a `char`.
fn scan_utf16le(bytes: &[u8]) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    for pair in bytes.chunks_exact(2) {
        let unit = u16::from(pair[0]) | (u16::from(pair[1]) << 8);
        match char::from_u32(u32::from(unit)) {
            Some(ch) if is_readable(ch) => current.push(ch),
            _ => flush(&mut blocks, &mut current),
        }
    }
    flush(&mut blocks, &mut current);
    blocks
}
