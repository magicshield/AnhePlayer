use std::fs;
use std::path::PathBuf;
use serde_json::Value;

fn get_config_file_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("AnhePlayer");
    let _ = fs::create_dir_all(&path);
    path.push("app-config.json");
    path
}

#[tauri::command]
pub fn app_config_sync() -> Result<Value, String> {
    let path = get_config_file_path();
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_config_set(config: Value) -> Result<(), String> {
    let path = get_config_file_path();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn app_config_reset() -> Result<(), String> {
    let path = get_config_file_path();
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}
