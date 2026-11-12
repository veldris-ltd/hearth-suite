//! Bearer capability tokens for the sync relay (P2-SVC2).
//!
//! The relay needs only an opaque account id, never an identity or key. Instead
//! of trusting a raw bearer string, it verifies a *capability token*: the
//! account id bound by an HMAC-SHA256 over a shared issuer secret. Only the
//! issuer (the account/identity service) holds the secret, so a client cannot
//! forge an account id, and the relay still learns nothing but the opaque id.
//!
//! Token format: `{account}.{hex(HMAC-SHA256(secret, account))}`.
//!
//! An empty secret never verifies, so a relay with no token secret provisioned
//! fails closed and refuses every bearer rather than trusting it.

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use crate::relay::AccountId;

type HmacSha256 = Hmac<Sha256>;

/// Mint a capability token for `account`, signed with `secret` (issuer side;
/// also used by tests). Returns the bearer string a client presents.
#[must_use]
pub fn mint_capability_token(account: &str, secret: &[u8]) -> String {
    format!(
        "{account}.{}",
        encode_hex(&sign(account.as_bytes(), secret))
    )
}

/// Verify a bearer capability token and return its account id, or `None` if the
/// token is malformed, the signature does not match, or `secret` is empty.
///
/// The HMAC comparison is constant-time (via `verify_slice`).
#[must_use]
pub fn verify_capability_token(token: &str, secret: &[u8]) -> Option<AccountId> {
    if secret.is_empty() {
        return None;
    }
    let (account, sig_hex) = token.rsplit_once('.')?;
    if account.is_empty() {
        return None;
    }
    let provided = decode_hex(sig_hex)?;
    let mut mac = HmacSha256::new_from_slice(secret).ok()?;
    mac.update(account.as_bytes());
    mac.verify_slice(&provided).ok()?;
    Some(account.to_owned())
}

/// HMAC-SHA256 of `message` under `secret`.
fn sign(message: &[u8], secret: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

/// Lower-case hex encoding.
fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Decode a lower/upper-case hex string into bytes, or `None` if malformed.
fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || s.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = (bytes[i] as char).to_digit(16)?;
        let lo = (bytes[i + 1] as char).to_digit(16)?;
        out.push(u8::try_from(hi * 16 + lo).ok()?);
        i += 2;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = b"relay-issuer-secret";

    #[test]
    fn round_trips_a_valid_token() {
        let token = mint_capability_token("acct-7f3a", SECRET);
        assert_eq!(
            verify_capability_token(&token, SECRET).as_deref(),
            Some("acct-7f3a")
        );
    }

    #[test]
    fn rejects_a_wrong_secret() {
        let token = mint_capability_token("acct-7f3a", SECRET);
        assert_eq!(verify_capability_token(&token, b"not-the-secret"), None);
    }

    #[test]
    fn rejects_a_tampered_account() {
        let token = mint_capability_token("acct-7f3a", SECRET);
        // Swap the account but keep the old signature.
        let (_, sig) = token.rsplit_once('.').unwrap();
        let forged = format!("acct-admin.{sig}");
        assert_eq!(verify_capability_token(&forged, SECRET), None);
    }

    #[test]
    fn rejects_malformed_and_unsigned() {
        assert_eq!(verify_capability_token("no-signature", SECRET), None);
        assert_eq!(verify_capability_token("acct.zz", SECRET), None); // bad hex
        assert_eq!(verify_capability_token(".deadbeef", SECRET), None); // empty account
    }

    #[test]
    fn empty_secret_never_verifies() {
        let token = mint_capability_token("acct-7f3a", SECRET);
        assert_eq!(verify_capability_token(&token, b""), None);
    }
}
