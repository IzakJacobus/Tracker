//! Manual check of idle detection on this desktop:
//!   cargo run --example idle            (prints the method and idle seconds every 2 s)
fn main() {
    for _ in 0..5 {
        let (method, secs) = stint_desktop_lib::debug_idle();
        println!("method={} idle={}s", method.unwrap_or("unsupported"), secs);
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
}
