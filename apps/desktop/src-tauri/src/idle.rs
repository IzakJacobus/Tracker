//! Seconds since the last keyboard or mouse input, system-wide.

#[cfg(windows)]
pub fn idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: plain Win32 calls with a correctly sized struct.
    unsafe {
        if GetLastInputInfo(&mut info) == 0 {
            return 0;
        }
        u64::from(GetTickCount().wrapping_sub(info.dwTime)) / 1000
    }
}

#[cfg(target_os = "macos")]
pub fn idle_seconds() -> u64 {
    use core_graphics::event_source::CGEventSourceStateID;
    // kCGAnyInputEventType = !0
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(CGEventSourceStateID::CombinedSessionState, u32::MAX) };
    if secs.is_finite() && secs > 0.0 {
        secs as u64
    } else {
        0
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(source: core_graphics::event_source::CGEventSourceStateID, event_type: u32) -> f64;
}

/// Which mechanism reports idle time on this desktop, or `None` if idle detection is unavailable.
#[cfg(windows)]
pub fn idle_support() -> Option<&'static str> {
    Some("windows")
}

#[cfg(target_os = "macos")]
pub fn idle_support() -> Option<&'static str> {
    Some("macos")
}

#[cfg(target_os = "linux")]
pub use linux::{idle_seconds, idle_support};

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn idle_seconds() -> u64 {
    0
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn idle_support() -> Option<&'static str> {
    None
}

/// Linux has no single idle API across X11 and Wayland. In order of preference:
/// 1. GNOME's Mutter idle monitor over D-Bus (GNOME on Wayland and X11),
/// 2. the X11 screen saver extension (KDE, Xfce, Cinnamon, MATE… on X11).
/// Under XWayland the X11 extension only sees input to X11 windows, so it is not used in
/// Wayland sessions. Other Wayland desktops (KDE Plasma, Sway…) are reported as unsupported.
#[cfg(target_os = "linux")]
mod linux {
    use std::sync::{Mutex, OnceLock};

    #[derive(Clone, Copy, PartialEq, Debug)]
    enum Method {
        Mutter,
        X11,
    }

    struct State {
        method: Option<Method>,
        dbus: Option<zbus::blocking::Connection>,
    }

    fn state() -> &'static Mutex<State> {
        static S: OnceLock<Mutex<State>> = OnceLock::new();
        S.get_or_init(|| Mutex::new(detect()))
    }

    fn detect() -> State {
        if let Ok(conn) = zbus::blocking::Connection::session() {
            if mutter_idle_ms(&conn).is_some() {
                return State { method: Some(Method::Mutter), dbus: Some(conn) };
            }
        }
        if !is_wayland_session() && x11_idle_ms().is_some() {
            return State { method: Some(Method::X11), dbus: None };
        }
        State { method: None, dbus: None }
    }

    fn is_wayland_session() -> bool {
        std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t.eq_ignore_ascii_case("wayland"))
            || std::env::var_os("WAYLAND_DISPLAY").is_some()
    }

    fn mutter_idle_ms(conn: &zbus::blocking::Connection) -> Option<u64> {
        let reply = conn
            .call_method(
                Some("org.gnome.Mutter.IdleMonitor"),
                "/org/gnome/Mutter/IdleMonitor/Core",
                Some("org.gnome.Mutter.IdleMonitor"),
                "GetIdletime",
                &(),
            )
            .ok()?;
        reply.body().deserialize::<u64>().ok()
    }

    /// `XScreenSaverInfo` from <X11/extensions/scrnsaver.h>.
    #[repr(C)]
    struct XScreenSaverInfo {
        window: std::os::raw::c_ulong,
        state: std::os::raw::c_int,
        kind: std::os::raw::c_int,
        til_or_since: std::os::raw::c_ulong,
        idle: std::os::raw::c_ulong,
        event_mask: std::os::raw::c_ulong,
    }

    struct X11 {
        _x11: libloading::Library,
        _xss: libloading::Library,
        open_display: unsafe extern "C" fn(*const std::os::raw::c_char) -> *mut std::ffi::c_void,
        close_display: unsafe extern "C" fn(*mut std::ffi::c_void) -> std::os::raw::c_int,
        default_root: unsafe extern "C" fn(*mut std::ffi::c_void) -> std::os::raw::c_ulong,
        free: unsafe extern "C" fn(*mut std::ffi::c_void) -> std::os::raw::c_int,
        query_extension:
            unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::os::raw::c_int, *mut std::os::raw::c_int) -> std::os::raw::c_int,
        alloc_info: unsafe extern "C" fn() -> *mut XScreenSaverInfo,
        query_info: unsafe extern "C" fn(*mut std::ffi::c_void, std::os::raw::c_ulong, *mut XScreenSaverInfo) -> std::os::raw::c_int,
    }

    /// Loads libX11 and libXss by their runtime names (`.so.6`, `.so.1`): desktops have these
    /// without the -dev packages, which is why x11-dl's own loader isn't used here.
    fn x11() -> Option<&'static X11> {
        static X: OnceLock<Option<X11>> = OnceLock::new();
        X.get_or_init(|| {
            let open = |names: &[&str]| names.iter().find_map(|n| unsafe { libloading::Library::new(n).ok() });
            let x11 = open(&["libX11.so.6", "libX11.so"])?;
            let xss = open(&["libXss.so.1", "libXss.so"])?;
            // SAFETY: the symbol types match the Xlib / Xss C declarations; the libraries are
            // kept alive in the struct for as long as the pointers are used.
            unsafe {
                Some(X11 {
                    open_display: *x11.get(b"XOpenDisplay\0").ok()?,
                    close_display: *x11.get(b"XCloseDisplay\0").ok()?,
                    default_root: *x11.get(b"XDefaultRootWindow\0").ok()?,
                    free: *x11.get(b"XFree\0").ok()?,
                    query_extension: *xss.get(b"XScreenSaverQueryExtension\0").ok()?,
                    alloc_info: *xss.get(b"XScreenSaverAllocInfo\0").ok()?,
                    query_info: *xss.get(b"XScreenSaverQueryInfo\0").ok()?,
                    _x11: x11,
                    _xss: xss,
                })
            }
        })
        .as_ref()
    }

    /// One display connection for the life of the app. Opening and closing a connection on
    /// every check counts as activity on some X servers, which would reset the idle timer.
    struct Display(*mut std::ffi::c_void);
    // SAFETY: only ever used while holding the mutex below.
    unsafe impl Send for Display {}

    /// Milliseconds since the last input, from the X11 screen saver extension.
    pub(super) fn x11_idle_ms() -> Option<u64> {
        static DISPLAY: OnceLock<Mutex<Option<Display>>> = OnceLock::new();
        let x = x11()?;
        let lock = DISPLAY.get_or_init(|| {
            // SAFETY: XOpenDisplay with NULL uses $DISPLAY; checked for NULL below.
            let d = unsafe { (x.open_display)(std::ptr::null()) };
            if d.is_null() {
                return Mutex::new(None);
            }
            let (mut event_base, mut error_base) = (0, 0);
            // SAFETY: valid display; out-params are plain ints.
            let has_ext = unsafe { (x.query_extension)(d, &mut event_base, &mut error_base) } != 0;
            if !has_ext {
                // SAFETY: closing the display we just opened.
                unsafe { (x.close_display)(d) };
                return Mutex::new(None);
            }
            Mutex::new(Some(Display(d)))
        });
        let guard = lock.lock().ok()?;
        let display = guard.as_ref()?.0;
        // SAFETY: valid display (held open); info is freed before returning.
        unsafe {
            let info = (x.alloc_info)();
            if info.is_null() {
                return None;
            }
            let ok = (x.query_info)(display, (x.default_root)(display), info) != 0;
            let idle = (*info).idle as u64;
            (x.free)(info.cast());
            ok.then_some(idle)
        }
    }

    pub fn idle_support() -> Option<&'static str> {
        match state().lock().ok()?.method? {
            Method::Mutter => Some("gnome"),
            Method::X11 => Some("x11"),
        }
    }

    pub fn idle_seconds() -> u64 {
        let Ok(s) = state().lock() else { return 0 };
        let ms = match s.method {
            Some(Method::Mutter) => s.dbus.as_ref().and_then(mutter_idle_ms),
            Some(Method::X11) => x11_idle_ms(),
            None => None,
        };
        ms.unwrap_or(0) / 1000
    }
}
