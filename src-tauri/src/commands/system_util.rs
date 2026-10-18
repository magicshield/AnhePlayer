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
