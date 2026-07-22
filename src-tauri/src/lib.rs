use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::Mutex;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

extern "C" {
    fn GetAppVersion() -> *const c_char;
    fn InitializeCore();
}

// Holds the Discord IPC client between calls (connect once, update many times).
struct DiscordState(Mutex<Option<DiscordIpcClient>>);

#[tauri::command]
fn discord_connect(state: tauri::State<DiscordState>, client_id: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let mut client = DiscordIpcClient::new(&client_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
fn discord_set_activity(
    state: tauri::State<DiscordState>,
    details: String,
    state_text: String,
    large_image: Option<String>,
    large_text: Option<String>,
    start: Option<i64>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let client = guard.as_mut().ok_or("discord not connected")?;
    let img = large_image.unwrap_or_default();
    let lt = large_text.unwrap_or_default();
    let mut act = activity::Activity::new().details(&details).state(&state_text);
    if let Some(s) = start {
        act = act.timestamps(activity::Timestamps::new().start(s));
    }
    if !img.is_empty() {
        act = act.assets(activity::Assets::new().large_image(&img).large_text(&lt));
    }
    client.set_activity(act).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn discord_disconnect(state: tauri::State<DiscordState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
    *guard = None;
    Ok(())
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

/// Download the best audio track for a video id into the OS download folder,
/// using the bundled yt-dlp sidecar. No ffmpeg needed (keeps native container).
#[tauri::command]
async fn download_track(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    if video_id.is_empty()
        || !video_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid video id".into());
    }
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("no download dir: {e}"))?;
    let out = format!("{}/%(title)s [%(id)s].%(ext)s", dir.to_string_lossy());
    let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);

    let sidecar = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar not found: {e}"))?;
    let output = sidecar
        .args(["-f", "bestaudio/best", "--no-playlist", "-o", &out, &watch_url])
        .output()
        .await
        .map_err(|e| format!("yt-dlp failed to run: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(dir.to_string_lossy().to_string())
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DiscordState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_core_version,
            show_main_window,
            resolve_audio_url,
            download_track,
            discord_connect,
            discord_set_activity,
            discord_disconnect
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
