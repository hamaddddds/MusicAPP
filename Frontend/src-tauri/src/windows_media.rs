use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use windows_sys::Win32::{System::Registry::*, UI::Shell::SetCurrentProcessExplicitAppUserModelID};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

/// Register the same identity used by the installed Start menu shortcut, before any UI exists.
pub fn register_identity(id: &str, name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let key_name = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
    unsafe {
        let mut key = std::ptr::null_mut();
        let status = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_name.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        );
        if status != 0 {
            return Err(std::io::Error::from_raw_os_error(status as i32).into());
        }
        let value = wide(name);
        let status = RegSetValueExW(
            key,
            wide("DisplayName").as_ptr(),
            0,
            REG_SZ,
            value.as_ptr().cast(),
            (value.len() * 2) as u32,
        );
        RegCloseKey(key);
        if status != 0 {
            return Err(std::io::Error::from_raw_os_error(status as i32).into());
        }
        let status = SetCurrentProcessExplicitAppUserModelID(wide(id).as_ptr());
        if status < 0 {
            return Err(format!("Unable to set app identity: {status:#x}").into());
        }
    }
    Ok(())
}

pub struct NativeMedia {
    controls: MediaControls,
    metadata: Option<(String, String, String, u64)>,
}

fn create_controls(app: &tauri::AppHandle) -> Result<NativeMedia, Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: "musicvenue",
        display_name: "Music Venue",
        hwnd: Some(window.hwnd()?.0.cast()),
    })?;
    let handle = app.clone();
    controls.attach(move |event| {
        let (action, position) = match event {
            MediaControlEvent::Play => ("play", None),
            MediaControlEvent::Pause | MediaControlEvent::Stop => ("pause", None),
            MediaControlEvent::Toggle => ("toggle", None),
            MediaControlEvent::Next => ("next", None),
            MediaControlEvent::Previous => ("previous", None),
            MediaControlEvent::SetPosition(p) => ("seek", Some(p.0.as_secs_f64())),
            MediaControlEvent::Seek(SeekDirection::Forward) => ("seekBy", Some(10.0)),
            MediaControlEvent::Seek(SeekDirection::Backward) => ("seekBy", Some(-10.0)),
            _ => return,
        };
        let _ = handle.emit(
            "native-media-action",
            serde_json::json!({ "action": action, "position": position }),
        );
    })?;
    controls.set_playback(MediaPlayback::Stopped)?;
    Ok(NativeMedia {
        controls,
        metadata: None,
    })
}

pub type MediaState = Mutex<Option<NativeMedia>>;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    title: String,
    artist: String,
    artwork: String,
    duration: f64,
    position: f64,
    playing: bool,
}

fn seconds(value: f64) -> Duration {
    Duration::from_secs_f64(if value.is_finite() {
        value.clamp(0.0, 86400.0)
    } else {
        0.0
    })
}

#[tauri::command]
pub fn update_native_media(
    app: tauri::AppHandle,
    state: tauri::State<'_, MediaState>,
    snapshot: Snapshot,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    // The hidden splash window has no native handle during Tauri's setup hook.
    // Initialize on the first player update, after the event loop owns the window.
    if guard.is_none() {
        *guard = Some(create_controls(&app).map_err(|e| e.to_string())?);
    }
    let state = guard.as_mut().ok_or("Native media controls unavailable")?;
    let duration = seconds(snapshot.duration);
    let metadata = (
        snapshot.title.clone(),
        snapshot.artist.clone(),
        snapshot.artwork.clone(),
        duration.as_millis() as u64,
    );
    if state.metadata.as_ref() != Some(&metadata) {
        state
            .controls
            .set_metadata(MediaMetadata {
                title: Some(&snapshot.title),
                artist: Some(&snapshot.artist),
                album: Some("Music Venue"),
                cover_url: if snapshot.artwork.starts_with("https://") {
                    Some(&snapshot.artwork)
                } else {
                    None
                },
                duration: Some(duration),
            })
            .map_err(|e| e.to_string())?;
        state.metadata = Some(metadata);
    }
    let progress = Some(MediaPosition(seconds(snapshot.position)));
    state
        .controls
        .set_playback(if snapshot.playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        })
        .map_err(|e| e.to_string())
}
