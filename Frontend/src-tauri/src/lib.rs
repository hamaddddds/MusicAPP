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
// FS HELPERS
// ============================

#[tauri::command]
async fn save_image_to_disk(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Windows keeps a child running after its parent dies, and this app leaves via `process::exit`
/// (window close, updater). A stray backend then held port 8000 and locked backend.exe so updates
/// could not replace it. A kill-on-close job ends the backend with this process, however it exits.
#[cfg(windows)]
fn tie_to_app(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if !process.is_null() {
            AssignProcessToJobObject(job, process);
            CloseHandle(process);
        }
        // `job` stays open on purpose: Windows closes it when this process ends.
    }
}

/// Ends backends left behind by builds before `tie_to_app`. Matched by full path, so another
/// program's backend.exe is never touched.
#[cfg(windows)]
fn kill_stale_backends(path: &std::path::Path) {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
    use windows_sys::Win32::System::Threading::*;
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else { return };
    let wanted = path.to_string_lossy().to_lowercase();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase() == name {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, 0, entry.th32ProcessID);
                if !process.is_null() {
                    let mut buf = [0u16; 1024];
                    let mut size = buf.len() as u32;
                    if QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size) != 0
                        && std::ffi::OsString::from_wide(&buf[..size as usize]).to_string_lossy().to_lowercase() == wanted
                    {
                        TerminateProcess(process, 1);
                    }
                    CloseHandle(process);
                }
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe {
        InitializeCore();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Ok(exe) = std::env::current_exe() {
                kill_stale_backends(&exe.with_file_name("backend.exe"));
            }
            // Start Python backend sidecar automatically in the background
            if let Ok(sidecar) = app.shell().sidecar("backend") {
                if let Ok((_events, _child)) = sidecar.spawn() {
                    #[cfg(windows)]
                    tie_to_app(_child.pid());
                }
            }
            // The updater leaves every downloaded installer in %TEMP% ("<app>-<version>-updater-XXXXXX")
            // because it exits without cleaning up. Once a new version runs they are dead weight.
            // One still locked by a finishing installer is skipped and removed on the next launch.
            let prefix = format!("{}-", app.package_info().name);
            std::thread::spawn(move || {
                let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with(&prefix) && name.contains("-updater-") {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            });
            Ok(())
        })
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
            save_image_to_disk
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
