use serde_json::json;
use std::io::{Read, Write};

#[cfg(windows)]
use std::fs::{File, OpenOptions};

#[cfg(unix)]
use std::os::unix::net::UnixStream;

pub struct CustomIpc {
    #[cfg(windows)]
    pipe: File,
    #[cfg(unix)]
    pipe: UnixStream,
}

impl CustomIpc {
    pub fn connect(client_id: &str) -> Result<Self, String> {
        let mut pipe = None;
        for i in 0..10 {
            #[cfg(windows)]
            {
                let path = format!(r#"\\.\pipe\discord-ipc-{}"#, i);
                if let Ok(file) = OpenOptions::new().read(true).write(true).open(&path) {
                    pipe = Some(file);
                    break;
                }
            }
            #[cfg(unix)]
            {
                let base = std::env::var("XDG_RUNTIME_DIR")
                    .or_else(|_| std::env::var("TMPDIR"))
                    .or_else(|_| std::env::var("TMP"))
                    .or_else(|_| std::env::var("TEMP"))
                    .unwrap_or_else(|_| "/tmp".to_string());
                let path = format!("{}/discord-ipc-{}", base, i);
                if let Ok(stream) = UnixStream::connect(&path) {
                    pipe = Some(stream);
                    break;
                }
            }
        }
        let mut pipe = pipe.ok_or("No discord IPC pipe found")?;
        
        let handshake = json!({"v": 1, "client_id": client_id}).to_string();
        Self::send_msg(&mut pipe, 0, &handshake)?;
        Self::recv_msg(&mut pipe)?;
        
        Ok(Self { pipe })
    }

    #[cfg(windows)]
    fn send_msg(pipe: &mut File, op: u32, payload: &str) -> Result<(), String> {
        let data = payload.as_bytes();
        let mut buf = Vec::new();
        buf.extend_from_slice(&op.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(data);
        pipe.write_all(&buf).map_err(|e| e.to_string())?;
        pipe.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(unix)]
    fn send_msg(pipe: &mut UnixStream, op: u32, payload: &str) -> Result<(), String> {
        let data = payload.as_bytes();
        let mut buf = Vec::new();
        buf.extend_from_slice(&op.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(data);
        pipe.write_all(&buf).map_err(|e| e.to_string())?;
        pipe.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(windows)]
    fn recv_msg(pipe: &mut File) -> Result<String, String> {
        let mut header = [0u8; 8];
        pipe.read_exact(&mut header).map_err(|e| e.to_string())?;
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap());
        let mut body = vec![0u8; length as usize];
        pipe.read_exact(&mut body).map_err(|e| e.to_string())?;
        String::from_utf8(body).map_err(|e| e.to_string())
    }

    #[cfg(unix)]
    fn recv_msg(pipe: &mut UnixStream) -> Result<String, String> {
        let mut header = [0u8; 8];
        pipe.read_exact(&mut header).map_err(|e| e.to_string())?;
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap());
        let mut body = vec![0u8; length as usize];
        pipe.read_exact(&mut body).map_err(|e| e.to_string())?;
        String::from_utf8(body).map_err(|e| e.to_string())
    }

    pub fn set_activity(&mut self, activity: serde_json::Value) -> Result<(), String> {
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": std::process::id(),
                "activity": activity
            },
            "nonce": "1"
        }).to_string();
        Self::send_msg(&mut self.pipe, 1, &payload)?;
        Self::recv_msg(&mut self.pipe)?;
        Ok(())
    }
}
