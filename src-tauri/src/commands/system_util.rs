use tauri::{AppHandle, Manager, WebviewWindow};

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn minimize_window(window: WebviewWindow, skip_task_bar: Option<bool>) {
    let _ = window.minimize();
    if let Some(true) = skip_task_bar {
        let _ = window.set_skip_taskbar(true);
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn toggle_maximize(window: WebviewWindow) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn toggle_visible(window: WebviewWindow) {
    if let Ok(visible) = window.is_visible() {
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
pub fn enter_minimode(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if let Some(mini) = app.get_webview_window("minimode") {
        let _ = mini.show();
        let _ = mini.set_focus();
    }
}

#[tauri::command]
pub fn exit_minimode(app: AppHandle) {
    if let Some(mini) = app.get_webview_window("minimode") {
        let _ = mini.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
pub fn toggle_minimode(app: AppHandle) {
    if let Some(mini) = app.get_webview_window("minimode") {
        if let Ok(is_vis) = mini.is_visible() {
            if is_vis {
                exit_minimode(app);
            } else {
                enter_minimode(app);
            }
        }
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_item_in_folder(path: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(path).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// 忽略鼠标事件（歌词窗口穿透点击等）
#[tauri::command]
pub fn ignore_mouse_event(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

/// 前端日志落点：输出到 stderr（env_logger 接管）
#[tauri::command]
pub fn log_entry(entry: serde_json::Value) {
    log::info!("[frontend] {}", entry);
}

/// WebView2 用户数据目录大小（字节）。目录不存在或统计失败返回 0。
#[tauri::command]
pub fn get_cache_size() -> u64 {
    let candidates = [
        dirs::data_local_dir().map(|d| d.join("com.anhe.player")),
        dirs::config_dir().map(|d| d.join("AnhePlayer").join("EBWebView")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.is_dir() {
            return dir_size(&candidate, 0);
        }
    }
    0
}

fn dir_size(dir: &std::path::Path, depth: u32) -> u64 {
    if depth > 12 {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size(&entry.path(), depth + 1);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

/// 清除 WebView 浏览数据（cookies/localStorage/IndexedDB/缓存）。
/// 注意：Tauri 未提供按类型清除的 API，此处为全量清除。
#[tauri::command]
pub fn clear_cache(window: WebviewWindow) -> Result<(), String> {
    window.clear_all_browsing_data().map_err(|e| e.to_string())
}
