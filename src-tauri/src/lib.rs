mod navigation;

use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    webview::NewWindowResponse,
    Manager, Url, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const STUDIO_URL: &str = "https://www.chordz.zerolitter.net";

fn safe_web_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
}

fn trusted_navigation(url: &Url) -> bool {
    let origin = if url.scheme() == "blob" {
        match Url::parse(&url.as_str()[5..]) {
            Ok(origin) => origin,
            Err(_) => return false,
        }
    } else {
        url.clone()
    };
    safe_web_url(&origin) && origin.host_str().is_some_and(navigation::trusted_host)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Native handlers open external links; the remote page has no IPC rights.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let studio_menu = SubmenuBuilder::new(app, "Studio")
                .text("studio", "Return to studio")
                .text("browser", "Open in browser")
                .separator()
                .text("quit", "Quit Chordz")
                .build()?;
            app.set_menu(MenuBuilder::new(app).item(&studio_menu).build()?)?;
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("The Chordz window configuration is missing.")?;
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| {
                    if trusted_navigation(url) {
                        return true;
                    }
                    if safe_web_url(url) {
                        let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .on_new_window(move |url, _| {
                    if safe_web_url(&url) {
                        let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "studio" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.navigate(STUDIO_URL.parse().expect("Valid studio URL"));
                }
            }
            "browser" => {
                let _ = app.opener().open_url(STUDIO_URL, None::<&str>);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("Unable to run Chordz");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_secure_studio_pages_and_exports() {
        for url in [
            STUDIO_URL,
            "https://auth.openai.com/authorize",
            "blob:https://www.chordz.zerolitter.net/recording",
        ] {
            assert!(trusted_navigation(&url.parse().unwrap()), "{url}");
        }
    }

    #[test]
    fn blocks_unsafe_schemes_credentials_and_ports() {
        for url in [
            "http://www.chordz.zerolitter.net",
            "https://user:password@www.chordz.zerolitter.net",
            "https://www.chordz.zerolitter.net:8443",
            "file:///C:/Windows/system.ini",
            "javascript:alert(1)",
            "blob:https://evil.example/recording",
            "blob:blob:https://www.chordz.zerolitter.net/recording",
        ] {
            assert!(!trusted_navigation(&url.parse().unwrap()), "{url}");
        }
    }

    #[test]
    fn external_links_do_not_replace_the_studio() {
        let url: Url = "https://github.com/Zerolitter/Chordz".parse().unwrap();
        assert!(safe_web_url(&url));
        assert!(!trusted_navigation(&url));
    }
}
