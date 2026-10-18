// 本地音乐：目录递归扫描 + 音频标签解析（lofty）。
//
// - local_scan_dir：递归发现音频文件（不跟随符号链接，天然防循环），返回 path/size/mtime(ms)
// - local_parse_meta：解析标题/歌手/专辑/时长（不做 CJK 编码修正与封面读取，对齐 Electron 版 skipCovers/skipLyrics）

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileInfo {
    pub path: String,
    pub size: u64,
    /// 文件修改时间（毫秒时间戳）
    pub mtime: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetaResult {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 时长（秒）
    pub duration: Option<f64>,
}

#[tauri::command]
pub fn local_scan_dir(
    folder_path: String,
    excluded_paths: Option<Vec<String>>,
    extensions: Option<Vec<String>>,
) -> Result<Vec<LocalFileInfo>, String> {
    let excluded: Vec<String> = excluded_paths
        .unwrap_or_default()
        .iter()
        .map(|p| normalize_lower(p))
        .filter(|p| !p.is_empty())
        .collect();
    let exts: Vec<String> = extensions
        .unwrap_or_default()
        .iter()
        .map(|e| e.to_lowercase())
        .collect();

    let mut out = Vec::new();
    walk_dir(Path::new(&folder_path), &excluded, &exts, &mut out, 0);
    Ok(out)
}

fn normalize_lower(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn is_excluded(normalized_path: &str, excluded: &[String]) -> bool {
    excluded
        .iter()
        .any(|ep| normalized_path == ep || normalized_path.starts_with(&format!("{ep}/")))
}

fn walk_dir(
    dir: &Path,
    excluded: &[String],
    exts: &[String],
    out: &mut Vec<LocalFileInfo>,
    depth: u32,
) {
    if depth > 16 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let normalized = normalize_lower(&path.to_string_lossy());
        if is_excluded(&normalized, excluded) {
            continue;
        }

        // DirEntry::metadata 不跟随符号链接，天然避免循环
        let Ok(meta) = entry.metadata() else {
            continue;
        };

        if meta.is_dir() {
            walk_dir(&path, excluded, exts, out, depth + 1);
        } else if meta.is_file() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let Some(dot) = name.rfind('.') else {
                continue;
            };
            let ext = &name[dot..];
            if !exts.iter().any(|e| e == ext) {
                continue;
            }
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(LocalFileInfo {
                path: path.to_string_lossy().to_string(),
                size: meta.len(),
                mtime,
            });
        }
    }
}

#[tauri::command]
pub async fn local_parse_meta(file_path: String) -> Result<AudioMetaResult, String> {
    // lofty 解析是同步 CPU/IO 操作，放到阻塞线程池执行
    tauri::async_runtime::spawn_blocking(move || parse_meta_inner(&file_path))
        .await
        .map_err(|e| e.to_string())?
}

fn parse_meta_inner(file_path: &str) -> Result<AudioMetaResult, String> {
    let tagged = Probe::open(file_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let duration = {
        let millis = tagged.properties().duration().as_millis();
        if millis == 0 {
            None
        } else {
            Some(millis as f64 / 1000.0)
        }
    };

    let mut result = AudioMetaResult {
        duration,
        ..Default::default()
    };

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        result.title = tag
            .title()
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        result.artist = tag
            .artist()
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        result.album = tag
            .album()
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
    }

    Ok(result)
}
