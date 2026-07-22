use std::ffi::CStr;
use std::os::raw::c_char;
use tauri::Manager;

extern "C" {
    fn GetAppVersion() -> *const c_char;
    fn InitializeCore();
}

#[tauri::command]
fn get_core_version() -> String {
    unsafe {
        let c_str = CStr::from_ptr(GetAppVersion());
        c_str.to_string_lossy().into_owned()
    }
}

#[tauri::command]
fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe {
        InitializeCore();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_core_version, show_window])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Exit app completely on close, no background running.
                std::process::exit(0);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
