#[cfg(desktop)]
mod commands;
#[cfg(desktop)]
mod server;
#[cfg(desktop)]
mod state;

#[cfg(desktop)]
pub use commands::*;
#[cfg(desktop)]
pub use state::AgentApiState;

#[cfg(not(desktop))]
mod stub {
    use serde_json::Value;
    use tauri::ipc::InvokeError;

    #[tauri::command]
    pub fn agent_api_supported() -> bool {
        false
    }

    #[tauri::command]
    pub async fn agent_api_start(
        _port: Option<u16>,
        _token: String,
    ) -> Result<Value, InvokeError> {
        Err(InvokeError::from("agent-api is not supported on this platform"))
    }

    #[tauri::command]
    pub async fn agent_api_stop() -> Result<(), InvokeError> {
        Ok(())
    }

    #[tauri::command]
    pub fn agent_api_status() -> Value {
        serde_json::json!({ "running": false, "port": 0, "url": "" })
    }

    #[tauri::command]
    pub fn agent_api_respond(
        _request_id: String,
        _ok: bool,
        _data: Value,
        _error: Option<String>,
    ) -> Result<(), InvokeError> {
        Ok(())
    }
}

#[cfg(not(desktop))]
pub use stub::*;
