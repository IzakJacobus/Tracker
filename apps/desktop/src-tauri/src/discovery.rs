//! Finds Stint Servers on the local network: mDNS/DNS-SD first, UDP broadcast as a
//! fallback for networks that filter multicast.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

pub const SERVICE: &str = "_stint._tcp.local.";
pub const UDP_PORT: u16 = 47609;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub id: String,
    pub name: String,
    pub version: String,
    pub fingerprint: String,
    /// "ip:port" candidates, most likely first
    pub addresses: Vec<String>,
    pub via: String,
}

#[derive(Deserialize)]
struct UdpReply {
    product: String,
    id: String,
    name: String,
    version: String,
    port: u16,
    fp: String,
    #[serde(default)]
    addresses: Vec<String>,
}

fn merge(map: &mut HashMap<String, Found>, f: Found) {
    match map.get_mut(&f.id) {
        Some(existing) => {
            for a in f.addresses {
                if !existing.addresses.contains(&a) {
                    existing.addresses.push(a);
                }
            }
            if !existing.via.contains(&f.via) {
                existing.via = format!("{}+{}", existing.via, f.via);
            }
        }
        None => {
            map.insert(f.id.clone(), f);
        }
    }
}

fn udp_discover(timeout: Duration, out: &mut HashMap<String, Found>) {
    let Ok(sock) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else { return };
    let _ = sock.set_broadcast(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(200)));
    for target in [Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST] {
        let _ = sock.send_to(b"STINT?", SocketAddr::from((target, UDP_PORT)));
    }
    let deadline = Instant::now() + timeout;
    let mut buf = [0u8; 4096];
    while Instant::now() < deadline {
        if let Ok((n, from)) = sock.recv_from(&mut buf) {
            if let Ok(r) = serde_json::from_slice::<UdpReply>(&buf[..n]) {
                if r.product != "stint" {
                    continue;
                }
                let mut addresses = vec![format!("{}:{}", from.ip(), r.port)];
                for a in r.addresses {
                    let s = format!("{a}:{}", r.port);
                    if !addresses.contains(&s) {
                        addresses.push(s);
                    }
                }
                merge(out, Found { id: r.id, name: r.name, version: r.version, fingerprint: r.fp, addresses, via: "broadcast".into() });
            }
        }
    }
}

fn mdns_discover(timeout: Duration, out: &mut HashMap<String, Found>) {
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return };
    let Ok(rx) = daemon.browse(SERVICE) else { return };
    let deadline = Instant::now() + timeout;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                let prop = |k: &str| info.get_property_val_str(k).unwrap_or_default().to_string();
                let id = prop("id");
                if id.is_empty() {
                    continue;
                }
                let port = info.get_port();
                let mut addresses: Vec<String> = info.get_addresses_v4().iter().map(|ip| format!("{ip}:{port}")).collect();
                addresses.sort();
                merge(
                    out,
                    Found { id, name: prop("org"), version: prop("v"), fingerprint: prop("fp"), addresses, via: "mdns".into() },
                );
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
}

/// Runs both methods in parallel for `timeout` and merges results by server id.
pub fn discover(timeout: Duration) -> Vec<Found> {
    let t = timeout;
    let mdns = std::thread::spawn(move || {
        let mut m = HashMap::new();
        mdns_discover(t, &mut m);
        m
    });
    let mut all = HashMap::new();
    udp_discover(timeout, &mut all);
    if let Ok(m) = mdns.join() {
        for (_, f) in m {
            merge(&mut all, f);
        }
    }
    let mut list: Vec<Found> = all.into_values().collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}
