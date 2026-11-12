//! Naming the artifact a client actually downloaded.
//!
//! The platform updater downloads one installer from a URL. The TUF check must
//! hash exactly that file, so the target name comes from the URL itself, never
//! from guessing by file extension: on Windows both an `.msi` and an
//! `-setup.exe` are published, and the sorted target list puts the `.exe` first
//! (AC-WIN-4, ADR-HS-010).

/// The TUF target name for a download URL: the last path segment,
/// percent-decoded, with any query or fragment removed.
///
/// Returns `None` when the URL has no file name, or when the decoded name is
/// not valid UTF-8 or would escape a directory (contains `/` or `\`).
///
/// ```
/// use hearth_release::artifact_name_from_url;
///
/// assert_eq!(
///     artifact_name_from_url("https://u.example/beta/Hearth%20Suite_0.1.5_x64_en-US.msi?x=1"),
///     Some("Hearth Suite_0.1.5_x64_en-US.msi".to_owned()),
/// );
/// assert_eq!(artifact_name_from_url("https://u.example/beta/"), None);
/// ```
#[must_use]
pub fn artifact_name_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let segment = path.rsplit('/').next()?;
    if segment.is_empty() {
        return None;
    }
    let name = percent_decode(segment)?;
    if name.contains(['/', '\\']) {
        return None;
    }
    Some(name)
}

/// Decode `%XX` escapes. Returns `None` on a malformed escape or non-UTF-8 output.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spaces_and_drops_query() {
        assert_eq!(
            artifact_name_from_url("https://h/beta/Hearth%20Suite_0.1.5_x64-setup.exe#frag")
                .as_deref(),
            Some("Hearth Suite_0.1.5_x64-setup.exe")
        );
    }

    #[test]
    fn rejects_malformed_escapes_and_traversal() {
        assert_eq!(artifact_name_from_url("https://h/a%2"), None);
        assert_eq!(artifact_name_from_url("https://h/a%zz"), None);
        assert_eq!(artifact_name_from_url("https://h/..%2Fsecret"), None);
        assert_eq!(artifact_name_from_url("https://h/a%5Cb"), None);
        assert_eq!(artifact_name_from_url("https://h/%FF"), None);
    }

    #[test]
    fn plain_names_pass_through() {
        assert_eq!(
            artifact_name_from_url("https://h/x/Hearth_1.0.0_amd64.AppImage").as_deref(),
            Some("Hearth_1.0.0_amd64.AppImage")
        );
    }
}
