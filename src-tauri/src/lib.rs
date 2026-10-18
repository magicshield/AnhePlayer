mod commands;

use commands::{
    app_config::*, dialog::*, download::*, forwarder::*, fs_util::*, global_context::*,
    http_proxy::*, local_meta::*, plugin_store::*, system_util::*, webdav::*,
};

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
            // WebDAV
            webdav_test,
            webdav_put,
            webdav_get,
            // Plugin Store
            plugin_save,
            plugin_delete,
            plugin_load_all,
        ])
        .setup(|app| {
            commands::forwarder::init_forwarder(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running anhe-player tauri application");
}
