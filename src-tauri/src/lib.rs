mod commands;

use commands::{
    app_config::*, audio_tag::*, dialog::*, download::*, forwarder::*, fs_util::*,
    global_context::*, http_proxy::*, local_meta::*, netease::*, plugin_store::*, system_util::*,
    webdav::*,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

/// 从配置文件读取关闭行为（与 Electron 端 `normal.closeBehavior` 保持一致）
fn read_close_behavior() -> String {
    let path = dirs::config_dir()
        .map(|d| d.join("AnhePlayer").join("app-config.json"))
        .unwrap_or_default();
    let Ok(content) = std::fs::read_to_string(path) else {
        return "minimize".to_string();
    };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) else {
        return "minimize".to_string();
    };
    config
        .get("normal.closeBehavior")
        .and_then(|v| v.as_str())
        .unwrap_or("minimize")
        .to_string()
}

/// 显示并聚焦主窗口；同时恢复任务栏按钮（关闭到托盘时曾被隐藏）
/// 注意：命名需避开 `system_util::show_main_window` 命令，否则会遮蔽同名命令
fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ForwarderPortState::default())
        .manage(DownloadCancelState::default())
        .invoke_handler(tauri::generate_handler![
            // Global Context
            global_context_get,
            // App Config
            app_config_sync,
            app_config_set,
            app_config_reset,
            // System Util
            exit_app,
            minimize_window,
            show_main_window,
            toggle_maximize,
            toggle_visible,
            enter_minimode,
            exit_minimode,
            toggle_minimode,
            open_external,
            open_path,
            show_item_in_folder,
            ignore_mouse_event,
            log_entry,
            get_cache_size,
            clear_cache,
            // Dialog
            show_open_dialog,
            show_save_dialog,
            // Fs Util
            fs_write_file,
            fs_read_file,
            fs_is_file,
            fs_is_folder,
            fs_remove,
            fs_mkdir,
            fs_copy_file,
            fs_read_dir,
            fs_rename,
            // HTTP Request / Forwarder
            http_request,
            forwarder_get_port,
            // Local Music
            local_scan_dir,
            local_parse_meta,
            // Download
            download_file,
            download_cancel,
            // Audio Tag（下载完成后写入封面/歌词）
            write_audio_meta,
            // WebDAV
            webdav_test,
            webdav_put,
            webdav_get,
            // Plugin Store
            plugin_save,
            plugin_delete,
            plugin_load_all,
            // NetEase Account（登录窗口与带 Cookie 请求）
            netease_login_open,
            netease_login_wait,
            netease_login_close,
            netease_session,
            netease_request,
            netease_logout,
        ])
        .setup(|app| {
            commands::forwarder::init_forwarder(app.handle().clone());

            // ── 系统托盘 ──
            // 关闭按钮在「最小化」模式下只会隐藏窗口，必须提供托盘入口将其找回。
            let show_item = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, "tray-exit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &exit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                // 左键单击恢复窗口，右键才弹出菜单
                .show_menu_on_left_click(false)
                .tooltip("AnhePlayer")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => restore_main_window(app),
                    "tray-exit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        restore_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 主窗口关闭请求：按配置决定「退出」还是「隐藏到托盘」，
            // 避免窗口被销毁后进程与音频仍在后台运行却无法找回。
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if read_close_behavior() == "exit_app" {
                    window.app_handle().exit(0);
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running anhe-player tauri application");
}
