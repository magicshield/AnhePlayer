use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Emitter;

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
pub fn app_config_set(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let path = get_config_file_path();

    // 1. 读取已有配置并与新 patch 进行合并，防止单项配置覆盖抹除其余所有项
    let mut existing: Value = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let (Some(existing_map), Some(patch_map)) = (existing.as_object_mut(), config.as_object()) {
        for (k, v) in patch_map {
            existing_map.insert(k.clone(), v.clone());
        }
    } else {
        existing = config.clone();
    }

    let content = serde_json::to_string_pretty(&existing).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;

    // 2. 广播 app-config-update 事件给前端窗口，驱动 UI 响应式更新与内存缓存同步
    let _ = app.emit(
        "app-config-update",
        serde_json::json!({
            "patch": config,
            "source": "tauri"
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn app_config_reset(app: tauri::AppHandle) -> Result<(), String> {
    let path = get_config_file_path();
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    let _ = app.emit(
        "app-config-update",
        serde_json::json!({
            "patch": {},
            "source": "tauri"
        }),
    );
    Ok(())
}

