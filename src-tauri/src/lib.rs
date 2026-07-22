use std::ffi::CStr;
use std::os::raw::c_char;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

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

/// Resolve a directly-playable audio stream URL for a YouTube video id by
/// running the bundled `yt-dlp` sidecar locally. Because it runs on the user's
/// own machine/IP, the returned googlevideo URL is bound to that IP and plays
/// fine in the frontend <audio> element — no server or API key needed.
#[tauri::command]
async fn resolve_audio_url(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    // Guard: YouTube video ids are [A-Za-z0-9_-]. Reject anything else.
    if video_id.is_empty()
        || !video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid video id".into());
    }

    let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);

    let sidecar = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar not found: {e}"))?;

    let output = sidecar
        .args(["-f", "bestaudio/best", "--no-playlist", "-g", &watch_url])
        .output()
        .await
        .map_err(|e| format!("yt-dlp failed to run: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let url = stdout.lines().next().unwrap_or("").trim().to_string();
    if url.is_empty() {
        return Err("yt-dlp returned no url".into());
    }
    Ok(url)
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe {
        InitializeCore();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_core_version,
            show_main_window,
            resolve_audio_url
        ])
        .on_window_event(|_window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                std::process::exit(0);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
