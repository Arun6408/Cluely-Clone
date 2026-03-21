#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod windows_capture;
mod system_audio_minimal;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri::Manager;

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Mutex, OnceLock,
};

#[tauri::command]
fn drag_window(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn toggle_overlay_visibility(window: tauri::Window) {
    if let Ok(visible) = window.is_visible() {
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

static SYSTEM_AUDIO_STOP: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

#[tauri::command]
fn start_system_audio_capture(app: tauri::AppHandle) -> Result<(), String> {
  let lock = SYSTEM_AUDIO_STOP.get_or_init(|| Mutex::new(None));
  let mut guard = lock.lock().map_err(|e| e.to_string())?;
  if guard.is_some() {
    return Ok(());
  }

  eprintln!("[SystemAudio] start_system_audio_capture command received");
  let stop = Arc::new(AtomicBool::new(false));
  let stop_clone = stop.clone();
  *guard = Some(stop);

  system_audio_minimal::start_system_audio_loopback_thread(app, stop_clone);
  Ok(())
}

#[tauri::command]
fn stop_system_audio_capture() -> Result<(), String> {
  let lock = SYSTEM_AUDIO_STOP.get_or_init(|| Mutex::new(None));
  if let Some(stop) = lock.lock().map_err(|e| e.to_string())?.take() {
    eprintln!("[SystemAudio] stop_system_audio_capture command received");
    stop.store(true, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    let script = r#"
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bmp)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $bytes = $ms.ToArray()
        [Convert]::ToBase64String($bytes)
    "#;
    let output = std::process::Command::new("powershell")
        .args(&["-NoProfile", "-Command", script])
        .output()
        .map_err(|e| e.to_string())?;
    
    if !output.status.success() {
        return Err("Powershell failed".to_string());
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // `tauri.conf.json` already defines the window(s). In dev mode, this setup hook
            // can be executed in scenarios where the window already exists, so guard creation.
            let main_window = if let Some(w) = app.get_webview_window("main") {
                w
            } else {
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .resizable(false)
                .build()?
            };

            windows_capture::windows_capture::exclude_from_capture(&main_window);

            // In dev mode, open DevTools so you can see console logs easily.
            #[cfg(debug_assertions)]
            {
                main_window.open_devtools();
            }

            // Global shortcuts
            // We use the plugin builder because the shortcut registration API is different
            // between plugin versions (and this avoids the old .init()/register mismatch).
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["ctrl+alt+space", "ctrl+alt+enter", "CommandOrControl+B"])?
                        .with_handler(|app, shortcut, event| {
                            if event.state != ShortcutState::Pressed {
                                return;
                            }

                            let is_space = shortcut.matches(
                                Modifiers::CONTROL | Modifiers::ALT,
                                Code::Space,
                            );
                            let is_enter = shortcut.matches(
                                Modifiers::CONTROL | Modifiers::ALT,
                                Code::Enter,
                            );
                            // tauri_plugin_global_shortcut parses "CommandOrControl" to Modifiers::CONTROL on Windows/Linux and Modifiers::SUPER on macOS.
                            let is_toggle = shortcut.matches(
                                Modifiers::CONTROL,
                                Code::KeyB,
                            ) || shortcut.matches(
                                Modifiers::SUPER,
                                Code::KeyB,
                            );

                            let Some(win) = app.get_webview_window("main") else {
                                return;
                            };

                            if is_toggle || is_space {
                                let _ =
                                    win.eval("window.postMessage('toggle_visibility', '*');");
                            } else if is_enter {
                                let _ = win.eval("window.postMessage('send_prompt', '*');");
                            }
                        })
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            drag_window,
            toggle_overlay_visibility,
            start_system_audio_capture,
            stop_system_audio_capture,
            take_screenshot,
            read_file_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

