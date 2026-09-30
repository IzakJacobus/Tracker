//! What the desktop app remembers between runs: the paired server (id, name,
//! pinned CA, last known addresses) and the session token. Stored in the app's
//! config folder (e.g. %APPDATA%\za.co.stint.desktop\stint.json).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairedServer {
    pub id: String,
    pub name: String,
    /// base64 (standard) DER of the server's CA certificate
    pub ca_der: String,
    pub fingerprint: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub server: Option<PairedServer>,
    pub token: Option<String>,
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self { path: dir.join("stint.json") }
    }

    pub fn load(&self) -> Stored {
        std::fs::read(&self.path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, s: &Stored) {
        let tmp = self.path.with_extension("json.tmp");
        if let Ok(bytes) = serde_json::to_vec_pretty(s) {
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
        }
    }
}
