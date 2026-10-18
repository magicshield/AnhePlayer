use std::fs;
use std::path::Path;

#[tauri::command]
pub fn fs_write_file(path: String, content: serde_json::Value, is_binary: bool) -> Result<(), String> {
    if is_binary {
        if let Some(arr) = content.as_array() {
            let bytes: Vec<u8> = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();
            fs::write(path, bytes).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    if let Some(s) = content.as_str() {
        fs::write(path, s).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Invalid content format".to_string())
}

#[tauri::command]
pub fn fs_read_file(path: String, encoding: Option<String>) -> Result<serde_json::Value, String> {
    if encoding.is_some() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        return Ok(serde_json::Value::String(text));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let json_bytes: Vec<serde_json::Value> = bytes.into_iter().map(|b| serde_json::Value::from(b)).collect();
    Ok(serde_json::Value::Array(json_bytes))
}

#[tauri::command]
pub fn fs_is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub fn fs_is_folder(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_dir(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    Ok(names)
}

#[tauri::command]
pub fn fs_rename(src: String, dest: String) -> Result<(), String> {
    fs::rename(src, dest).map_err(|e| e.to_string())
}
