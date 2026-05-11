mod agent_api;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(desktop)]
    let builder = builder.manage(agent_api::AgentApiState::default());

    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            agent_api::agent_api_supported,
            agent_api::agent_api_start,
            agent_api::agent_api_stop,
            agent_api::agent_api_status,
            agent_api::agent_api_respond,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
