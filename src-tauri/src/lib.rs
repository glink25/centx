mod agent_api;
mod web_ota;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "ios")]
    std::panic::set_hook(Box::new(|info| {
        println!("RUST PANIC: {}", info);
    }));
    let builder = tauri::Builder::default();

    // single-instance 必须最先注册：第二次启动（含 deep-link 触发的新实例）
    // 会通过该回调把参数转发给已运行的实例，避免出现重复窗口。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    let builder = builder
        .manage(web_ota::WebOta::default())
        .register_uri_scheme_protocol("centapp", |ctx, request| {
            web_ota::handle_request(ctx.app_handle(), request)
        })
        .setup(|app| {
            web_ota::check_trial_and_rollback(app.handle());
            web_ota::promote_pending(app.handle());
            Ok(())
        });

    #[cfg(not(target_os = "ios"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.manage(agent_api::AgentApiState::default());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            greet,
            agent_api::agent_api_supported,
            agent_api::agent_api_start,
            agent_api::agent_api_stop,
            agent_api::agent_api_status,
            agent_api::agent_api_respond,
            web_ota::web_ota_check,
            web_ota::web_ota_state,
            web_ota::web_ota_mark_healthy,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(desktop)]
        if matches!(
            _event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            use tauri::Manager;
            let state = _app_handle.state::<agent_api::AgentApiState>();
            // Send shutdown synchronously; we cannot await here, but signalling
            // graceful shutdown gives axum a chance to close the listener
            // before the process terminates.
            let (tx, task) = {
                let mut inner = state.inner.lock().unwrap();
                (inner.shutdown_tx.take(), inner.server_task.take())
            };
            if let Some(tx) = tx {
                let _ = tx.send(());
            }
            if let Some(task) = task {
                // Best effort: block briefly on the task so the port is freed
                // before the process exits.
                tauri::async_runtime::block_on(async {
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(500),
                        task,
                    )
                    .await;
                });
            }
        }
    });
}
