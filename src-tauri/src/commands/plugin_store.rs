use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct PluginEntry {
    pub hash: String,
    pub code: String,
}

fn get_plugins_dir() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("AnhePlayer");
    dir.push("plugins");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn plugin_save(hash: String, code: String) -> Result<(), String> {
    let mut file_path = get_plugins_dir();
    file_path.push(format!("{}.js", hash));
    fs::write(file_path, code).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_delete(hash: String) -> Result<(), String> {
    let mut file_path = get_plugins_dir();
    file_path.push(format!("{}.js", hash));
    if file_path.exists() {
        let _ = fs::remove_file(file_path);
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_load_all() -> Result<Vec<PluginEntry>, String> {
    let dir = get_plugins_dir();
    let mut list = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("js") {
                if let Some(hash) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(code) = fs::read_to_string(&path) {
                        list.push(PluginEntry {
                            hash: hash.to_string(),
                            code,
                        });
                    }
                }
            }
        }
    }
    Ok(list)
}
