use std::ffi::CStr;
use std::os::raw::c_char;
use tauri::Manager;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use once_cell::sync::Lazy;
use std::net::TcpListener;
use std::io::{Read, Write};

static DISCORD_IPC: Lazy<Mutex<Option<DiscordIpcClient>>> = Lazy::new(|| Mutex::new(None));

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

// ============================
// DISCORD RPC COMMANDS
// ============================

#[tauri::command]
fn connect_rpc(client_id: String) -> Result<(), String> {
    let mut client = DiscordIpcClient::new(&client_id);
    
    client.connect().map_err(|e| format!("Gagal terhubung ke Discord RPC: {:?}", e))?;
    
    let mut guard = DISCORD_IPC.lock().unwrap();
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
fn disconnect_rpc() -> Result<(), String> {
    let mut guard = DISCORD_IPC.lock().unwrap();
    if let Some(mut client) = guard.take() {
        let _ = client.close();
    }
    Ok(())
}

#[tauri::command]
fn set_rpc_activity(details: String, state: String, large_image: String, large_text: String) -> Result<(), String> {
    let mut guard = DISCORD_IPC.lock().unwrap();
    if let Some(client) = guard.as_mut() {
        let assets = activity::Assets::new()
            .large_image(&large_image)
            .large_text(&large_text);

        let activity = activity::Activity::new()
            .details(&details)
            .state(&state)
            .assets(assets);

        client.set_activity(activity).map_err(|e| format!("Gagal set activity: {}", e))?;
    }
    Ok(())
}

// ============================
// OAUTH DEV SERVER
// ============================

#[tauri::command]
fn start_oauth_server(app: tauri::AppHandle) -> Result<u16, String> {
    // Bind to any available ephemeral port
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                let mut buffer = [0; 4096];
                if stream.read(&mut buffer).is_ok() {
                    let req = String::from_utf8_lossy(&buffer);
                    if let Some(line) = req.lines().next() {
                        if line.starts_with("GET /") {
                            // Extract payload query string parameter
                            if let Some(start) = line.find("payload=") {
                                let payload_part = &line[start + 8..];
                                let end = payload_part.find(' ').unwrap_or(payload_part.len());
                                let payload = &payload_part[..end];
                                
                                // Emit to frontend
                                let _ = app.emit("oauth-payload", payload);
                                
                                // Send response and close window
                                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!DOCTYPE html><html><body><h2 style='font-family:sans-serif;text-align:center;margin-top:20%'>Berhasil! Anda bisa menutup jendela ini.</h2><script>window.close();</script></body></html>";
                                let _ = stream.write_all(response.as_bytes());
                                break;
                            }
                        }
                    }
                }
            }
        }
    });
    
    Ok(port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe {
        InitializeCore();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_core_version,
            resolve_audio_url,
            download_track,
            show_main_window,
            connect_rpc,
            disconnect_rpc,
            set_rpc_activity,
            start_oauth_server
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
