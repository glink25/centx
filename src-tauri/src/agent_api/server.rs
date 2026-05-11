use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use super::state::{AgentApiState, BridgeResponse};

const REQUEST_EVENT: &str = "agent-api://request";
const BRIDGE_TIMEOUT_SECS: u64 = 60;

#[derive(Clone)]
struct AppState {
    app: AppHandle,
}

pub fn build_router(app: AppHandle) -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any)
        .allow_origin(Any);

    Router::new()
        .route("/health", get(health))
        .route("/skill", get(skill))
        .route("/tools", get(list_tools))
        .route("/tools/:name", post(call_tool))
        .with_state(AppState { app })
        .layer(cors)
}

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "name": "cent-agent-api", "version": env!("CARGO_PKG_VERSION") }))
}

fn check_auth(app: &AppHandle, headers: &HeaderMap) -> Result<(), Response> {
    let token = {
        let state = app.state::<AgentApiState>();
        let inner = state.inner.lock().unwrap();
        inner.token.clone()
    };
    let Some(token) = token else {
        return Err(unauthorized("server not configured"));
    };
    let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return Err(unauthorized("missing Authorization header"));
    };
    let provided = auth.strip_prefix("Bearer ").unwrap_or(auth);
    if provided.as_bytes().ct_eq(token.as_bytes()).unwrap_u8() == 1 {
        Ok(())
    } else {
        Err(unauthorized("invalid token"))
    }
}

fn unauthorized(msg: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "ok": false, "error": msg })),
    )
        .into_response()
}

async fn forward(app: &AppHandle, payload: Value) -> Result<BridgeResponse, Response> {
    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<BridgeResponse>();
    {
        let state = app.state::<AgentApiState>();
        let mut inner = state.inner.lock().unwrap();
        inner.pending.insert(request_id.clone(), tx);
    }

    let mut payload = payload;
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("request_id".into(), Value::String(request_id.clone()));
    }

    if let Err(e) = app.emit(REQUEST_EVENT, &payload) {
        let state = app.state::<AgentApiState>();
        state.inner.lock().unwrap().pending.remove(&request_id);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": format!("emit failed: {e}") })),
        )
            .into_response());
    }

    match tokio::time::timeout(Duration::from_secs(BRIDGE_TIMEOUT_SECS), rx).await {
        Ok(Ok(resp)) => Ok(resp),
        Ok(Err(_)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": "bridge dropped" })),
        )
            .into_response()),
        Err(_) => {
            let state = app.state::<AgentApiState>();
            state.inner.lock().unwrap().pending.remove(&request_id);
            Err((
                StatusCode::GATEWAY_TIMEOUT,
                Json(json!({ "ok": false, "error": "bridge timeout" })),
            )
                .into_response())
        }
    }
}

fn render(resp: BridgeResponse) -> Response {
    if resp.ok {
        (
            StatusCode::OK,
            Json(json!({ "ok": true, "data": resp.data })),
        )
            .into_response()
    } else {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": resp.error.unwrap_or_else(|| "unknown".into()) })),
        )
            .into_response()
    }
}

async fn skill(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&s.app, &headers) {
        return r;
    }
    match forward(&s.app, json!({ "kind": "skill" })).await {
        Ok(resp) if resp.ok => {
            let content = resp
                .data
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let content_type = resp
                .data
                .get("content_type")
                .and_then(|v| v.as_str())
                .unwrap_or("text/markdown; charset=utf-8")
                .to_string();
            ([(header::CONTENT_TYPE, content_type)], content).into_response()
        }
        Ok(resp) => render(resp),
        Err(r) => r,
    }
}

async fn list_tools(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(r) = check_auth(&s.app, &headers) {
        return r;
    }
    match forward(&s.app, json!({ "kind": "list" })).await {
        Ok(resp) => render(resp),
        Err(r) => r,
    }
}

async fn call_tool(
    State(s): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    if let Err(r) = check_auth(&s.app, &headers) {
        return r;
    }
    let args = body
        .map(|Json(v)| v.get("args").cloned().unwrap_or(Value::Null))
        .unwrap_or(Value::Null);
    match forward(
        &s.app,
        json!({ "kind": "tool", "tool_name": name, "args": args }),
    )
    .await
    {
        Ok(resp) => render(resp),
        Err(r) => r,
    }
}

pub async fn serve(
    app: AppHandle,
    requested_port: u16,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<u16, String> {
    let mut last_err: Option<String> = None;
    for offset in 0..10u16 {
        let port = requested_port.saturating_add(offset);
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                let router = build_router(app.clone());
                let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
                let server = axum::serve(listener, router.into_make_service())
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                    });
                // Spawn so we can return the port; if serve errors, log it.
                let _ = Arc::new(()); // keep arc usage if needed later
                tokio::spawn(async move {
                    if let Err(e) = server.await {
                        eprintln!("[agent-api] server error: {e}");
                    }
                });
                return Ok(actual_port);
            }
            Err(e) => {
                last_err = Some(format!("port {port}: {e}"));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| "failed to bind".into()))
}
