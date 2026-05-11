use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

#[derive(Default)]
pub struct AgentApiState {
    pub inner: Mutex<AgentApiInner>,
}

#[derive(Default)]
pub struct AgentApiInner {
    pub running: bool,
    pub port: u16,
    pub token: Option<String>,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
    pub server_task: Option<JoinHandle<()>>,
    pub pending: HashMap<String, oneshot::Sender<BridgeResponse>>,
}

#[derive(Debug, Clone)]
pub struct BridgeResponse {
    pub ok: bool,
    pub data: Value,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct AgentApiStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
}
