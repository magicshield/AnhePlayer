mod commands;

use commands::{app_config::*, fs_util::*, global_context::*, http_proxy::*, plugin_store::*, system_util::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
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
            // Fs Util
            fs_write_file,
            fs_read_file,
            fs_is_file,
            fs_is_folder,
            fs_remove,
            fs_mkdir,
            fs_copy_file,
            fs_read_dir,
            // HTTP Request / Forwarder
            http_request,
            // Plugin Store
            plugin_save,
            plugin_delete,
            plugin_load_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running anhe-player tauri application");
}
