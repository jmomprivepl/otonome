//! Mandatory egress shaping before cloud-bound user text leaves the desktop runtime tier (spec §4.2, §6).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EgressLimits {
    pub max_bytes: usize,
}

pub fn default_limits() -> EgressLimits {
    EgressLimits { max_bytes: 24 * 1024 }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EgressDisposition {
    Allow,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EgressDecision {
    pub disposition: EgressDisposition,
    pub sanitized_user_text: Option<String>,
    pub reason_codes: Vec<String>,
}

#[inline]
fn token_char_ok(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '+' || c == '-'
}

fn redact_whitespace_bounded_email_like_tokens(
    input: &str,
    reason_codes: &mut Vec<String>,
) -> String {
    let mut out = String::new();
    let mut first = true;
    for raw in input.split_whitespace() {
        if !first {
            out.push(' ');
        }
        first = false;

        if let Some(at) = raw.find('@') {
            let (Some(local), Some(domain)) = (raw.get(..at), raw.get(at + 1..)) else {
                out.push_str(raw);
                continue;
            };
            let ok = !local.is_empty()
                && !domain.is_empty()
                && domain.contains('.')
                && local.chars().all(token_char_ok)
                && domain.chars().all(token_char_ok);
            if ok {
                reason_codes.push("redacted_token:email_like".into());
                out.push_str("***@");
                out.push_str(domain);
                continue;
            }
        }

        out.push_str(raw);
    }
    out
}

pub fn evaluate_user_task_for_cloud(user_task: &str, limits: EgressLimits) -> EgressDecision {
    let mut reason_codes: Vec<String> = Vec::new();

    let mut text = user_task.trim().to_string();
    let original_len = text.len();
    if original_len > limits.max_bytes {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec![format!(
                "payload_too_large:original_len_bytes={}",
                original_len
            )],
        };
    }

    // Block obvious secret-like patterns commonly pasted into chat/agent prompts.
    // This is deliberately conservative — extend via OrgPolicy-backed tables later.
    if text.contains("sk-ant-") {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec!["blocked_substring:sk-ant-api-key-pattern".into()],
        };
    }
    if text.contains("Bearer ") {
        reason_codes.push("redacted_substring:bearer-token".into());
        let mut out = String::new();
        let mut rest = text.as_str();
        while let Some(pos) = rest.find("Bearer ") {
            out.push_str(&rest[..pos]);
            out.push_str("Bearer **[REDACTED]**");
            let tail = &rest[pos + "Bearer ".len()..];
            let trimmed = tail.trim_start();
            let skip_ws = tail.len() - trimmed.len();
            let token_len = trimmed
                .split_whitespace()
                .next()
                .map(|w| w.len())
                .unwrap_or(0);
            rest = &tail[skip_ws + token_len..];
        }
        out.push_str(rest);
        text = out;
    }

    // Lightweight email-like token redaction on whitespace-bounded tokens: `alice@example.com` -> `***@example.com`.
    // Intentionally conservative on token shape so normal prose with stray `@` is not mangled blindly.
    let out = redact_whitespace_bounded_email_like_tokens(&text, &mut reason_codes);

    let final_len = out.len();
    if final_len > limits.max_bytes {
        return EgressDecision {
            disposition: EgressDisposition::Deny,
            sanitized_user_text: None,
            reason_codes: vec![format!(
                "payload_too_large:after_sanitize_len_bytes={}",
                final_len
            )],
        };
    }

    EgressDecision {
        disposition: EgressDisposition::Allow,
        sanitized_user_text: Some(out),
        reason_codes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_oversized_payload() {
        let s = "a".repeat(25 * 1024);
        let d = evaluate_user_task_for_cloud(&s, default_limits());
        assert_eq!(d.disposition, EgressDisposition::Deny);
        assert!(d.sanitized_user_text.is_none());
        assert!(
            d.reason_codes
                .iter()
                .any(|c| c.starts_with("payload_too_large:")),
            "{d:?}"
        );
    }

    #[test]
    fn denies_sk_ant_pattern() {
        let d =
            evaluate_user_task_for_cloud("token sk-ant-xxxx", EgressLimits { max_bytes: 1024 });
        assert_eq!(d.disposition, EgressDisposition::Deny);
    }

    #[test]
    fn redacts_bearer_prefix() {
        let d =
            evaluate_user_task_for_cloud("Authorization: Bearer SECRETVALUE", default_limits());
        assert_eq!(d.disposition, EgressDisposition::Allow);
        let t = d.sanitized_user_text.as_ref().expect("sanitized text");
        assert!(!t.contains("SECRETVALUE"));
        assert!(t.contains("**[REDACTED]**"));
    }

    #[test]
    fn redacts_simple_email_like_token() {
        let d = evaluate_user_task_for_cloud(
            "Reach me at alice@example.com soon",
            default_limits(),
        );
        assert_eq!(d.disposition, EgressDisposition::Allow);
        let t = d.sanitized_user_text.as_ref().expect("sanitized text");
        assert!(
            !t.contains("alice@"),
            "{t:?}"
        );
        assert!(
            t.contains("***@example.com"),
            "{t:?}"
        );
        assert!(
            d.reason_codes
                .iter()
                .any(|c| *c == "redacted_token:email_like"),
            "{d:?}"
        );
    }
}
