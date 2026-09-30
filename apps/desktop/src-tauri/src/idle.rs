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

/// Linux: no portable API across X11 and Wayland — idle detection is off.
#[cfg(not(any(windows, target_os = "macos")))]
pub fn idle_seconds() -> u64 {
    0
}
