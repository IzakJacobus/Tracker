//! Manual check against a running server:
//!   cargo run --example probe -- 127.0.0.1:47600 <PAIRING-CODE>
use stint_desktop_lib::debug_probe;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let addr = args.get(1).cloned().unwrap_or_else(|| "127.0.0.1:47600".into());
    let code = args.get(2).cloned();
    match debug_probe(&addr, code.as_deref()).await {
        Ok(msg) => println!("OK {msg}"),
        Err(e) => println!("ERR {e}"),
    }
}
