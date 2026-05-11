mod manifest;
mod state;

use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

pub use manifest::WebManifest;
pub use state::WebOtaState;

#[derive(Default)]
pub struct WebOta {
    pub state: Mutex<WebOtaState>,
}

#[derive(Debug, thiserror::Error)]
pub enum WebOtaError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("semver: {0}")]
    Semver(#[from] semver::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("signature verification failed: {0}")]
    Signature(String),
    #[error("hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("unsafe zip entry: {0}")]
    UnsafeEntry(String),
    #[error("pubkey missing or invalid in tauri.conf.json plugins.updater.pubkey")]
    MissingPubkey,
    #[error("hex: {0}")]
    Hex(#[from] hex::FromHexError),
}

impl Serialize for WebOtaError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CheckOutcome {
    NoUpdate,
    Skipped { reason: String },
    Downloaded { web_version: String },
}

const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/glink25/cent-tauri/releases/download/web-latest/web-latest.json";

pub fn manifest_url<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Ok(v) = std::env::var("CENT_WEB_OTA_MANIFEST_URL") {
        if !v.is_empty() {
            return v;
        }
    }
    let _ = app;
    DEFAULT_MANIFEST_URL.to_string()
}

pub fn web_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, WebOtaError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    let root = base.join("web");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn updater_pubkey<R: Runtime>(app: &AppHandle<R>) -> Result<PublicKey, WebOtaError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let cfg = app.config();
    let updater = cfg
        .plugins
        .0
        .get("updater")
        .ok_or(WebOtaError::MissingPubkey)?;
    let pubkey_b64 = updater
        .get("pubkey")
        .and_then(|v| v.as_str())
        .ok_or(WebOtaError::MissingPubkey)?;
    let decoded = STANDARD
        .decode(pubkey_b64)
        .map_err(|e| WebOtaError::Signature(e.to_string()))?;
    let pubkey_str = std::str::from_utf8(&decoded)
        .map_err(|e| WebOtaError::Signature(e.to_string()))?;
    PublicKey::decode(pubkey_str).map_err(|e| WebOtaError::Signature(e.to_string()))
}

fn native_version<R: Runtime>(app: &AppHandle<R>) -> Result<Version, WebOtaError> {
    Ok(Version::parse(app.package_info().version.to_string().as_str())?)
}

fn current_web_version(root: &Path) -> Option<Version> {
    let st = WebOtaState::load(root);
    st.active_version
        .as_deref()
        .and_then(|v| Version::parse(v).ok())
}

async fn fetch_manifest(url: &str) -> Result<WebManifest, WebOtaError> {
    let resp = reqwest::Client::builder()
        .user_agent("cent-web-ota/1")
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    let body = resp.bytes().await?;
    Ok(serde_json::from_slice(&body)?)
}

async fn download_to_file(url: &str, dest: &Path) -> Result<[u8; 32], WebOtaError> {
    let resp = reqwest::Client::builder()
        .user_agent("cent-web-ota/1")
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?;

    let mut hasher = Sha256::new();
    let mut file = fs::File::create(dest)?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        hasher.update(&bytes);
        file.write_all(&bytes)?;
    }
    file.sync_all()?;
    Ok(hasher.finalize().into())
}

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), WebOtaError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    fs::create_dir_all(dest_dir)?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let raw_name = entry
            .enclosed_name()
            .ok_or_else(|| WebOtaError::UnsafeEntry(entry.name().to_string()))?
            .to_path_buf();

        if raw_name.is_absolute()
            || raw_name
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(WebOtaError::UnsafeEntry(entry.name().to_string()));
        }

        let out_path = dest_dir.join(&raw_name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

async fn run_check<R: Runtime>(app: AppHandle<R>) -> Result<CheckOutcome, WebOtaError> {
    let url = manifest_url(&app);
    let manifest = fetch_manifest(&url).await?;

    let new_ver = Version::parse(&manifest.web_version)?;
    let root = web_root(&app)?;

    if let Some(cur) = current_web_version(&root) {
        if new_ver <= cur {
            return Ok(CheckOutcome::NoUpdate);
        }
    }

    let min_native = Version::parse(&manifest.min_native_version)?;
    let native = native_version(&app)?;
    if native < min_native {
        return Ok(CheckOutcome::Skipped {
            reason: format!(
                "native {} < required {}",
                native, min_native
            ),
        });
    }

    let pubkey = updater_pubkey(&app)?;
    let sig = Signature::decode(&manifest.signature)
        .map_err(|e| WebOtaError::Signature(e.to_string()))?;

    let tmp_dir = root.join(".tmp");
    fs::create_dir_all(&tmp_dir)?;
    let zip_path = tmp_dir.join(format!("{}.zip", manifest.web_version));
    let actual_hash = download_to_file(&manifest.url, &zip_path).await?;

    let expected_hash = hex::decode(manifest.sha256.trim())?;
    if expected_hash != actual_hash {
        let _ = fs::remove_file(&zip_path);
        return Err(WebOtaError::HashMismatch {
            expected: manifest.sha256.clone(),
            actual: hex::encode(actual_hash),
        });
    }

    let zip_bytes = fs::read(&zip_path)?;
    pubkey
        .verify(&zip_bytes, &sig, false)
        .map_err(|e| WebOtaError::Signature(e.to_string()))?;
    drop(zip_bytes);

    let stage_dir = tmp_dir.join(&manifest.web_version);
    let _ = fs::remove_dir_all(&stage_dir);
    extract_zip(&zip_path, &stage_dir)?;
    let _ = fs::remove_file(&zip_path);

    let final_dir = root.join(&manifest.web_version);
    if final_dir.exists() {
        fs::remove_dir_all(&final_dir)?;
    }
    fs::rename(&stage_dir, &final_dir)?;

    let mut st = WebOtaState::load(&root);
    st.pending_version = Some(manifest.web_version.clone());
    st.trial_launches = 0;
    st.save(&root)?;

    Ok(CheckOutcome::Downloaded {
        web_version: manifest.web_version,
    })
}

/// Number of launches the active version is allowed to run on trial without
/// receiving a healthy signal before it gets rolled back.
pub const MAX_TRIAL_LAUNCHES: u32 = 3;

/// Inspect trial state at startup. If the active version has failed to send a
/// healthy signal across [`MAX_TRIAL_LAUNCHES`] consecutive launches, roll back
/// to `previous_version` (or fall back to embedded assets) and delete the bad
/// directory. Otherwise increment the trial counter.
pub fn check_trial_and_rollback<R: Runtime>(app: &AppHandle<R>) {
    let root = match web_root(app) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut st = WebOtaState::load(&root);
    if st.trial_launches == 0 || st.active_version.is_none() {
        return;
    }
    if st.trial_launches >= MAX_TRIAL_LAUNCHES {
        let bad = st.active_version.take();
        st.active_version = st.previous_version.take();
        st.trial_launches = 0;
        let _ = st.save(&root);
        if let Some(bad_ver) = bad {
            if Some(&bad_ver) != st.active_version.as_ref() {
                let _ = fs::remove_dir_all(root.join(bad_ver));
            }
        }
    } else {
        st.trial_launches += 1;
        let _ = st.save(&root);
    }
}

/// On startup: if pending_version directory is valid, move it to active.
/// Demote current active → previous. Drop stale older directories.
pub fn promote_pending<R: Runtime>(app: &AppHandle<R>) {
    let root = match web_root(app) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut st = WebOtaState::load(&root);
    let Some(pending) = st.pending_version.take() else {
        let _ = st.save(&root);
        return;
    };
    let pending_dir = root.join(&pending);
    if !pending_dir.is_dir() {
        // stale pending entry – drop it
        let _ = st.save(&root);
        return;
    }
    let prev_to_drop = st.previous_version.take();
    let demoted = st.active_version.take();
    st.previous_version = demoted;
    st.active_version = Some(pending);
    st.trial_launches = 1;
    let _ = st.save(&root);

    if let Some(ver) = prev_to_drop {
        if Some(&ver) != st.active_version.as_ref() && Some(&ver) != st.previous_version.as_ref() {
            let _ = fs::remove_dir_all(root.join(ver));
        }
    }
}

/// Path to the active web bundle directory, if any.
pub fn active_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let root = web_root(app).ok()?;
    let st = WebOtaState::load(&root);
    let ver = st.active_version?;
    let dir = root.join(ver);
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

fn mime_for(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn is_safe_rel(p: &str) -> bool {
    let path = std::path::Path::new(p);
    !path.is_absolute()
        && !path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
}

fn try_active(active: &Path, rel: &str) -> Option<Vec<u8>> {
    if !is_safe_rel(rel) {
        return None;
    }
    fs::read(active.join(rel)).ok()
}

fn try_embedded<R: Runtime>(app: &AppHandle<R>, rel: &str) -> Option<(Vec<u8>, String, Option<String>)> {
    if !is_safe_rel(rel) {
        return None;
    }
    let key = format!("/{}", rel);
    let asset = app.asset_resolver().get(key)?;
    Some((asset.bytes, asset.mime_type, asset.csp_header))
}

/// Handle a centapp:// request. Tries active version → embedded assets → SPA index.html fallback.
pub fn handle_request<R: Runtime>(
    app: &AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use tauri::http::Response;

    let raw = request.uri().path();
    let cleaned = raw.trim_start_matches('/');
    let cleaned = cleaned.split('?').next().unwrap_or("");
    let cleaned = cleaned.split('#').next().unwrap_or("");
    let first = if cleaned.is_empty() {
        "index.html".to_string()
    } else {
        cleaned.to_string()
    };

    let active = active_dir(app);
    let candidates: [String; 2] = [
        first.clone(),
        if first == "index.html" || first.contains('.') {
            first.clone()
        } else {
            "index.html".to_string()
        },
    ];

    for candidate in &candidates {
        if let Some(dir) = active.as_deref() {
            if let Some(bytes) = try_active(dir, candidate) {
                return Response::builder()
                    .status(200)
                    .header("Content-Type", mime_for(candidate))
                    .body(Cow::Owned(bytes))
                    .unwrap();
            }
        }
        if let Some((bytes, mime, csp)) = try_embedded(app, candidate) {
            let mut b = Response::builder().status(200).header("Content-Type", mime);
            if let Some(csp) = csp {
                b = b.header("Content-Security-Policy", csp);
            }
            return b.body(Cow::Owned(bytes)).unwrap();
        }
        if candidate == &first && (first == "index.html" || first.contains('.')) {
            break;
        }
    }

    Response::builder()
        .status(404)
        .header("Content-Type", "text/plain")
        .body(Cow::Borrowed(&b"not found"[..]))
        .unwrap()
}

#[tauri::command]
pub async fn web_ota_check<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CheckOutcome, WebOtaError> {
    run_check(app).await
}

#[tauri::command]
pub fn web_ota_state<R: Runtime>(
    app: AppHandle<R>,
    _ota: State<'_, WebOta>,
) -> Result<WebOtaState, WebOtaError> {
    let root = web_root(&app)?;
    Ok(WebOtaState::load(&root))
}

/// Frontend signals it has rendered successfully — clear the trial counter so
/// the active version is considered stable.
#[tauri::command]
pub fn web_ota_mark_healthy<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), WebOtaError> {
    let root = web_root(&app)?;
    let mut st = WebOtaState::load(&root);
    if st.trial_launches > 0 {
        st.trial_launches = 0;
        st.save(&root)?;
    }
    Ok(())
}
