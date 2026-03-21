#[cfg(target_os = "windows")]
pub mod windows_capture {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    pub fn exclude_from_capture(window: &tauri::WebviewWindow) {
        if let Ok(hwnd) = window.hwnd() {
            // Prevent this window from appearing in screen recordings (where supported).
            unsafe {
                let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub mod windows_capture {
    pub fn exclude_from_capture(_window: &tauri::WebviewWindow) {}
}

