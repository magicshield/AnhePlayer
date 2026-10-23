use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

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

/// 与前端 Node/Electron 语义对齐的 platform 字面量（前端按 'win32' / 'darwin' 分支）
fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

/// 自定义托盘菜单等能力仅存在于 Windows
fn win10_or_above() -> bool {
    cfg!(target_os = "windows")
}

#[tauri::command]
pub fn global_context_get(app: tauri::AppHandle) -> GlobalContext {
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
        // 以 tauri.conf.json 的 version 为唯一事实来源（与安装包/更新检查对齐），
        // 避免 Cargo.toml 与配置不一致时自报旧版本、误报"发现新版本"
        app_version: app.package_info().version.to_string(),
        app_path: AppPath {
            default_download_path: download_dir,
            temp: temp_dir,
            user_data: config_dir,
            res: String::new(),
        },
        platform: node_platform().to_string(),
        is_win10_or_above: win10_or_above(),
    }
}
