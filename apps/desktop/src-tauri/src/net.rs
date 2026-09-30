//! HTTPS to the paired Stint Server, pinned to its CA, with address failover and
//! automatic rediscovery when the server's IP address changes.

use crate::discovery;
use crate::pin::{check_chain, client_config, CapturingVerifier, PinnedVerifier};
use crate::store::PairedServer;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ServerInfo {
    pub product: String,
    pub server_id: Option<String>,
    pub organization_name: Option<String>,
    pub version: String,
    pub ca_fingerprint: Option<String>,
}

pub fn pinned_client(server: &PairedServer) -> Result<reqwest::Client, String> {
    let ca = STANDARD.decode(&server.ca_der).map_err(|e| e.to_string())?;
    let cfg = client_config(Arc::new(PinnedVerifier::new(&ca)?))?;
    reqwest::Client::builder()
        .use_preconfigured_tls(cfg)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("Stint Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Connects to `addr` without trusting it yet, returns the server's info and the
/// certificate chain it presented.
pub async fn probe(addr: &str) -> Result<(ServerInfo, Vec<Vec<u8>>), String> {
    let capture = Arc::new(CapturingVerifier::default());
    let cfg = client_config(capture.clone())?;
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(cfg)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(format!("https://{addr}/api/info"))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach {addr}: {e}"))?;
    let info: ServerInfo = res.json().await.map_err(|_| format!("{addr} isn't a Stint Server."))?;
    if info.product != "stint" {
        return Err(format!("{addr} isn't a Stint Server."));
    }
    let chain = capture.chain.lock().unwrap().clone();
    Ok((info, chain))
}

/// Pairs with a server whose fingerprint we already expect (from discovery or a code).
pub async fn pair(addresses: &[String], accept: impl Fn(&str) -> bool) -> Result<PairedServer, String> {
    let mut last_err = "No address to try.".to_string();
    for addr in addresses {
        match probe(addr).await {
            Ok((info, chain)) => {
                let (ca, fp) = check_chain(&chain, &accept)?;
                if info.ca_fingerprint.as_deref().is_some_and(|f| f != fp) {
                    return Err("The server's certificate doesn't match what it advertises.".into());
                }
                return Ok(PairedServer {
                    id: info.server_id.unwrap_or_default(),
                    name: info.organization_name.unwrap_or_else(|| "Stint Server".into()),
                    ca_der: STANDARD.encode(ca),
                    fingerprint: fp,
                    addresses: addresses.to_vec(),
                });
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

pub struct Outcome {
    pub response: ApiResponse,
    /// the address that answered (so it can be tried first next time)
    pub address: String,
}

fn is_connect_error(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_timeout() || e.is_request()
}

pub async fn request(
    client: &reqwest::Client,
    addresses: &[String],
    method: &str,
    path: &str,
    body: Option<&Value>,
    token: Option<&str>,
) -> Result<Outcome, String> {
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut last = String::from("offline");
    for addr in addresses {
        let mut req = client
            .request(method.clone(), format!("https://{addr}/api{path}"))
            .header("x-stint-request", "1")
            .header("x-stint-client", "desktop");
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        match req.send().await {
            Ok(res) => {
                let status = res.status().as_u16();
                let text = res.text().await.unwrap_or_default();
                let body = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
                return Ok(Outcome { response: ApiResponse { status, body }, address: addr.clone() });
            }
            Err(e) if is_connect_error(&e) => last = e.to_string(),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(last)
}

/// Looks for the paired server again (e.g. after its IP address changed).
pub async fn rediscover(server: &PairedServer) -> Option<Vec<String>> {
    let id = server.id.clone();
    let fp = server.fingerprint.clone();
    let found = tokio::task::spawn_blocking(move || discovery::discover(Duration::from_millis(1800))).await.ok()?;
    found.into_iter().find(|f| f.id == id && f.fingerprint == fp).map(|f| f.addresses)
}
