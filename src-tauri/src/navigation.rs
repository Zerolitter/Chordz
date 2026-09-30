pub fn trusted_host(host: &str) -> bool {
    matches!(
        host,
        "www.chordz.zerolitter.net"
            | "chordz-studio.pdekker24.chatgpt.site"
            | "accounts.google.com"
            | "login.microsoftonline.com"
            | "login.live.com"
            | "appleid.apple.com"
    ) || host == "openai.com"
        || host.ends_with(".openai.com")
        || host == "chatgpt.com"
        || host.ends_with(".chatgpt.com")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_studio_and_sign_in_hosts() {
        for host in [
            "www.chordz.zerolitter.net",
            "chordz-studio.pdekker24.chatgpt.site",
            "chatgpt.com",
            "auth.openai.com",
            "accounts.google.com",
            "login.microsoftonline.com",
            "appleid.apple.com",
        ] {
            assert!(trusted_host(host), "{host}");
        }
    }

    #[test]
    fn rejects_unrelated_and_deceptive_hosts() {
        for host in [
            "zerolitter.net",
            "www.zerolitter.net",
            "openai.com.evil.example",
            "evilopenai.com",
            "chatgpt.com.evil.example",
            "accounts.google.com.evil.example",
            "localhost",
            "127.0.0.1",
            "",
        ] {
            assert!(!trusted_host(host), "{host}");
        }
    }
}
