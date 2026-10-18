use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppPath {
    #[serde(rename = "defaultDownloadPath")]
    pub default_download_path: String,
    pub temp: String,
    #[serde(rename = "userData")]
    pub user_data: String,
    pub res: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlobalContext {
    #[serde(rename = "appVersion")]
    pub app_version: String,
    #[serde(rename = "appPath")]
    pub app_path: AppPath,
    pub platform: String,
    #[serde(rename = "isWin10OrAbove")]
    pub is_win10_or_above: bool,
}

#[tauri::command]
pub fn global_context_get() -> GlobalContext {
    let download_dir = dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    let config_dir = dirs::config_dir()
        .map(|p| p.join("AnhePlayer"))
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    let temp_dir = std::env::temp_dir().to_string_lossy().to_string();

    GlobalContext {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        app_path: AppPath {
            default_download_path: download_dir,
            temp: temp_dir,
            user_data: config_dir,
            res: String::new(),
        },
        platform: std::env::consts::OS.to_string(),
        is_win10_or_above: true,
    }
}
