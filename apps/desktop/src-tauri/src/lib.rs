//! Stint desktop app: the React UI (bundled) plus a small Rust core that
//! discovers and pairs with the office server, talks to it over pinned HTTPS,
//! keeps the session token out of the web view, shows a tray timer and measures
//! idle time.

mod discovery;
mod idle;
mod net;
mod pairing;
mod pin;
mod store;

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use store::{PairedServer, Store, Stored};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

struct AppState {
    store: Store,
    data: Mutex<Stored>,
    client: Mutex<Option<reqwest::Client>>,
    tray_toggle: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl AppState {
    fn save(&self) {
        let d = self.data.lock().unwrap().clone();
        self.store.save(&d);
    }
    fn client(&self) -> Result<reqwest::Client, String> {
        if let Some(c) = self.client.lock().unwrap().as_ref() {
            return Ok(c.clone());
        }
        let server = self.data.lock().unwrap().server.clone().ok_or("not paired")?;
        let c = net::pinned_client(&server)?;
        *self.client.lock().unwrap() = Some(c.clone());
        Ok(c)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingStatus {
    id: String,
    name: String,
    addresses: Vec<String>,
    fingerprint: String,
}

impl From<&PairedServer> for PairingStatus {
    fn from(s: &PairedServer) -> Self {
        Self { id: s.id.clone(), name: s.name.clone(), addresses: s.addresses.clone(), fingerprint: s.fingerprint.clone() }
    }
}

#[tauri::command]
fn pairing_status(state: State<'_, AppState>) -> Option<PairingStatus> {
    state.data.lock().unwrap().server.as_ref().map(PairingStatus::from)
}

#[tauri::command]
async fn discover_servers(timeout_ms: Option<u64>) -> Vec<discovery::Found> {
    let t = Duration::from_millis(timeout_ms.unwrap_or(2500).clamp(500, 10_000));
    tokio::task::spawn_blocking(move || discovery::discover(t)).await.unwrap_or_default()
}

fn finish_pairing(state: &AppState, server: PairedServer) -> PairingStatus {
    let status = PairingStatus::from(&server);
    {
        let mut d = state.data.lock().unwrap();
        // A different server means a different company: drop the old session.
        if d.server.as_ref().map(|s| &s.id) != Some(&server.id) {
            d.token = None;
        }
        d.server = Some(server);
    }
    *state.client.lock().unwrap() = None;
    state.save();
    status
}

/// Pair with a server found by discovery (its fingerprint came from the network).
#[tauri::command]
async fn pair_discovered(state: State<'_, AppState>, found: discovery::Found) -> Result<PairingStatus, String> {
    let expected = found.fingerprint.clone();
    let server = net::pair(&found.addresses, |fp| fp == expected).await?;
    Ok(finish_pairing(&state, server))
}

/// Pair with a code typed from the server's screen.
#[tauri::command]
async fn pair_with_code(state: State<'_, AppState>, code: String) -> Result<PairingStatus, String> {
    let c = pairing::decode(&code).ok_or("That code doesn't look right. It has 16 letters and numbers, like K7QM-4XDA-9WFH-3CPN.")?;
    let addr = format!("{}:{}", c.ip, c.port);
    let prefix = c.fingerprint_prefix;
    let server = net::pair(&[addr], |fp| pairing::fingerprint_matches_prefix(fp, &prefix)).await?;
    Ok(finish_pairing(&state, server))
}

#[tauri::command]
fn unpair(state: State<'_, AppState>) {
    *state.data.lock().unwrap() = Stored::default();
    *state.client.lock().unwrap() = None;
    state.save();
}

/// Adds addresses the server says it can be reached on (e.g. its Tailscale name) to the ones
/// tried when the usual address doesn't answer. Existing addresses keep their order.
#[tauri::command]
fn remember_addresses(state: State<'_, AppState>, addresses: Vec<String>) {
    {
        let mut d = state.data.lock().unwrap();
        let Some(s) = d.server.as_mut() else { return };
        merge_addresses(&mut s.addresses, &addresses);
    }
    state.save();
}

/// `host:port` entries only, at most 16 in total; new ones go to the end.
fn merge_addresses(current: &mut Vec<String>, new: &[String]) {
    for a in new {
        let valid = a.len() <= 270
            && a.rsplit_once(':').is_some_and(|(host, port)| {
                !host.is_empty()
                    && port.parse::<u16>().is_ok()
                    && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
            });
        if valid && !current.contains(a) && current.len() < 16 {
            current.push(a.clone());
        }
    }
}

/// Every API call from the web UI goes through here.
#[tauri::command]
async fn api_request(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<net::ApiResponse, String> {
    let client = state.client()?;
    let (addresses, token) = {
        let d = state.data.lock().unwrap();
        let s = d.server.as_ref().ok_or("not paired")?;
        (s.addresses.clone(), d.token.clone())
    };
    let body_ref = body.as_ref().filter(|b| !b.is_null());
    let outcome = match net::request(&client, &addresses, &method, &path, body_ref, token.as_deref()).await {
        Ok(o) => o,
        Err(first) => {
            // The server may have a new IP address: look for it again, then retry once.
            let server = state.data.lock().unwrap().server.clone().ok_or("not paired")?;
            let Some(found) = net::rediscover(&server).await else { return Err(first) };
            {
                let mut d = state.data.lock().unwrap();
                if let Some(s) = d.server.as_mut() {
                    s.addresses = found.clone();
                }
            }
            state.save();
            net::request(&client, &found, &method, &path, body_ref, token.as_deref()).await?
        }
    };
    let mut response = outcome.response;
    {
        let mut d = state.data.lock().unwrap();
        if let Some(s) = d.server.as_mut() {
            if s.addresses.first() != Some(&outcome.address) {
                s.addresses.retain(|a| a != &outcome.address);
                s.addresses.insert(0, outcome.address.clone());
            }
        }
        // The session token stays in this process; the web view never sees it.
        if path.starts_with("/auth/login") && response.status == 200 {
            if let Some(t) = response.body.get("token").and_then(|t| t.as_str()) {
                d.token = Some(t.to_string());
            }
            if let Some(obj) = response.body.as_object_mut() {
                obj.remove("token");
            }
        }
        if path.starts_with("/auth/logout") || response.status == 401 && path.starts_with("/auth/me") {
            d.token = None;
        }
    }
    state.save();
    Ok(response)
}

#[tauri::command]
fn idle_seconds() -> u64 {
    idle::idle_seconds()
}

#[tauri::command]
fn tray_update(state: State<'_, AppState>, app: AppHandle, running: bool, tooltip: String) {
    if let Some(item) = state.tray_toggle.lock().unwrap().as_ref() {
        let _ = item.set_text(if running { "Stop timer" } else { "Start timer" });
    }
    if let Some(tray) = app.tray_by_id("stint") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
async fn save_file(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_file_name(&name).save_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(path) = rx.await.map_err(|e| e.to_string())? else { return Ok(false) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("stint"));
            let store = Store::new(dir);
            let data = store.load();
            let toggle = MenuItem::with_id(app, "toggle", "Start timer", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Stint", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Stint", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
            app.manage(AppState { store, data: Mutex::new(data), client: Mutex::new(None), tray_toggle: Mutex::new(Some(toggle)) });

            TrayIconBuilder::with_id("stint")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Stint")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "toggle" => {
                        let _ = app.emit_to("main", "stint://tray-toggle", ());
                    }
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Stint (and a running timer) in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            pairing_status,
            discover_servers,
            pair_discovered,
            pair_with_code,
            unpair,
            api_request,
            remember_addresses,
            idle_seconds,
            tray_update,
            save_file,
            notify
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stint");
}

/// Used by `examples/probe.rs` to exercise pairing and pinned requests against a live server.
#[doc(hidden)]
pub async fn debug_probe(addr: &str, code: Option<&str>) -> Result<String, String> {
    let found = tokio::task::spawn_blocking(|| discovery::discover(Duration::from_millis(1500))).await.unwrap_or_default();
    let mut out = format!("discovered {} server(s): {:?}\n", found.len(), found.iter().map(|f| (&f.name, &f.via, &f.addresses)).collect::<Vec<_>>());
    let server = match code {
        Some(c) => {
            let p = pairing::decode(c).ok_or("bad code")?;
            net::pair(&[addr.to_string()], |fp| pairing::fingerprint_matches_prefix(fp, &p.fingerprint_prefix)).await?
        }
        None => {
            let f = found.first().ok_or("nothing discovered")?;
            let expected = f.fingerprint.clone();
            net::pair(&f.addresses, |fp| fp == expected).await?
        }
    };
    out += &format!("paired with {} ({}), pin {}\n", server.name, server.id, server.fingerprint);
    let client = net::pinned_client(&server)?;
    let r = net::request(&client, &[addr.to_string()], "GET", "/info", None, None).await?;
    out += &format!("pinned GET /api/info -> {} via {}\n", r.response.status, r.address);
    // A wrong pin must be refused.
    let wrong = net::pair(&[addr.to_string()], |_| false).await;
    out += &format!("wrong fingerprint refused: {}", wrong.is_err());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::merge_addresses;

    #[test]
    fn merges_new_addresses_after_the_known_ones() {
        let mut a = vec!["192.168.1.20:47600".to_string()];
        merge_addresses(
            &mut a,
            &[
                "192.168.1.20:47600".into(),
                "100.101.102.103:47600".into(),
                "office-pc.tail1234.ts.net:47600".into(),
                "not an address".into(),
                "evil.example:99999".into(),
                "x/y:47600".into(),
            ],
        );
        assert_eq!(a, vec!["192.168.1.20:47600", "100.101.102.103:47600", "office-pc.tail1234.ts.net:47600"]);
    }
}
