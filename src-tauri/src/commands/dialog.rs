// 原生文件对话框（tauri-plugin-dialog 封装），对齐 Electron dialog 的 options 契约。
//
// JS 侧传入形态：{ title?, buttonLabel?, defaultPath?, filters?: [{ name, extensions }], properties?: ['openFile'|'openDirectory'|'multiSelections'] }
// 返回值对齐 Electron：open → string[] | null（canceled 由 JS 包装），save → string | null。

use serde::Deserialize;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    pub name: Option<String>,
    pub extensions: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
    pub properties: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveDialogOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
}

/// 提取可用的扩展名列表（过滤空值、'*' 通配——rfd 不接受通配）。
fn usable_extensions(filter: &DialogFilter) -> Vec<String> {
    filter
        .extensions
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|e| !e.is_empty() && e.as_str() != "*" && !e.starts_with('.'))
        .cloned()
        .collect()
}

#[tauri::command]
pub async fn show_open_dialog(
    window: WebviewWindow,
    options: Option<OpenDialogOptions>,
) -> Result<Option<Vec<String>>, String> {
    let options = options.unwrap_or_default();
    let mut builder = window.dialog().file();

    if let Some(title) = &options.title {
        if !title.is_empty() {
            builder = builder.set_title(title.clone());
        }
    }
    if let Some(default_path) = &options.default_path {
        if !default_path.is_empty() {
            builder = builder.set_directory(default_path.clone());
        }
    }
    if let Some(filters) = &options.filters {
        for filter in filters {
            let exts = usable_extensions(filter);
            if exts.is_empty() {
                continue;
            }
            let ext_refs: Vec<&str> = exts.iter().map(|e| e.as_str()).collect();
            let name = filter
                .name
                .clone()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Files".to_string());
            builder = builder.add_filter(name, &ext_refs);
        }
    }

    let props = options.properties.unwrap_or_default();
    let is_dir = props.iter().any(|p| p == "openDirectory");
    let multi = props.iter().any(|p| p == "multiSelections");

    // blocking API 在非主线程（async command 运行于异步线程池）中调用是官方推荐用法。
    let picked: Option<Vec<String>> = if is_dir {
        if multi {
            builder
                .blocking_pick_folders()
                .map(|folders| folders.into_iter().map(|f| f.to_string()).collect())
        } else {
            builder.blocking_pick_folder().map(|f| vec![f.to_string()])
        }
    } else if multi {
        builder
            .blocking_pick_files()
            .map(|files| files.into_iter().map(|f| f.to_string()).collect())
    } else {
        builder.blocking_pick_file().map(|f| vec![f.to_string()])
    };

    Ok(picked.filter(|paths| !paths.is_empty()))
}

#[tauri::command]
pub async fn show_save_dialog(
    window: WebviewWindow,
    options: Option<SaveDialogOptions>,
) -> Result<Option<String>, String> {
    let options = options.unwrap_or_default();
    let mut builder = window.dialog().file();

    if let Some(title) = &options.title {
        if !title.is_empty() {
            builder = builder.set_title(title.clone());
        }
    }
    if let Some(filters) = &options.filters {
        for filter in filters {
            let exts = usable_extensions(filter);
            if exts.is_empty() {
                continue;
            }
            let ext_refs: Vec<&str> = exts.iter().map(|e| e.as_str()).collect();
            let name = filter
                .name
                .clone()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Files".to_string());
            builder = builder.add_filter(name, &ext_refs);
        }
    }
    if let Some(default_path) = &options.default_path {
        let normalized = default_path.replace('\\', "/");
        match normalized.rfind('/') {
            Some(idx) if idx > 0 => {
                let dir = &default_path[..idx];
                let name = &default_path[idx + 1..];
                if !dir.is_empty() {
                    builder = builder.set_directory(dir.to_string());
                }
                if !name.is_empty() {
                    builder = builder.set_file_name(name.to_string());
                }
            }
            _ => {
                if !default_path.is_empty() {
                    builder = builder.set_file_name(default_path.clone());
                }
            }
        }
    }

    Ok(builder.blocking_save_file().map(|f| f.to_string()))
}
