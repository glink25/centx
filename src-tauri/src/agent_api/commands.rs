use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

use super::server;
use super::state::{AgentApiState, AgentApiStatus, BridgeResponse};

#[tauri::command]
pub fn agent_api_supported() -> bool {
    true
}

#[tauri::command]
pub async fn agent_api_start(
    app: AppHandle,
    state: State<'_, AgentApiState>,
    port: Option<u16>,
    token: String,
) -> Result<AgentApiStatus, String> {
    if token.trim().is_empty() {
        return Err("token must not be empty".into());
    }
    // Stop any existing server first.
    {
        let mut inner = state.inner.lock().unwrap();
        if let Some(tx) = inner.shutdown_tx.take() {
            let _ = tx.send(());
        }
        inner.running = false;
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let requested = port.unwrap_or(47821);
    let actual = server::serve(app.clone(), requested, shutdown_rx)
        .await
        .map_err(|e| format!("failed to start agent-api server: {e}"))?;

    {
        let mut inner = state.inner.lock().unwrap();
        inner.running = true;
        inner.port = actual;
        inner.token = Some(token);
        inner.shutdown_tx = Some(shutdown_tx);
        inner.pending.clear();
    }

    Ok(AgentApiStatus {
        running: true,
        port: actual,
        url: format!("http://127.0.0.1:{actual}"),
    })
}

#[tauri::command]
pub async fn agent_api_stop(state: State<'_, AgentApiState>) -> Result<(), String> {
    let (tx, pending) = {
        let mut inner = state.inner.lock().unwrap();
        inner.running = false;
        inner.token = None;
        let tx = inner.shutdown_tx.take();
        let pending: Vec<_> = inner.pending.drain().collect();
        (tx, pending)
    };
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
    for (_, sender) in pending {
        let _ = sender.send(BridgeResponse {
            ok: false,
            data: Value::Null,
            error: Some("server stopped".into()),
        });
    }
    Ok(())
}

#[tauri::command]
pub fn agent_api_status(state: State<'_, AgentApiState>) -> AgentApiStatus {
    let inner = state.inner.lock().unwrap();
    AgentApiStatus {
        running: inner.running,
        port: inner.port,
        url: if inner.running {
            format!("http://127.0.0.1:{}", inner.port)
        } else {
            String::new()
        },
    }
}

#[tauri::command]
pub fn agent_api_respond(
    state: State<'_, AgentApiState>,
    request_id: String,
    ok: bool,
    data: Value,
    error: Option<String>,
) -> Result<(), String> {
    let sender = {
        let mut inner = state.inner.lock().unwrap();
        inner.pending.remove(&request_id)
    };
    if let Some(sender) = sender {
        let _ = sender.send(BridgeResponse { ok, data, error });
        Ok(())
    } else {
        Err(format!("no pending request: {request_id}"))
    }
}
