// 本地请求转发代理（对齐 Electron 版 requestForwarder 的 URL 契约）。
//
// 契约：GET http://127.0.0.1:<port>/?url=<encoded>&headers=<JSON encoded>
//   - url 与 headers 均为 x-www-form-urlencoded 编码（URLSearchParams.toString()），
//     其中空格被编码为 '+'，需要先还原为空格再做 percent-decode。
//   - 支持透传 Range 请求头（206 分段响应），供音频元素 seek 使用。
// 安全：仅监听 127.0.0.1，不暴露公网。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// 代理端口状态（0 表示未启动）
#[derive(Default)]
pub struct ForwarderPortState(pub AtomicU16);

#[tauri::command]
pub fn forwarder_get_port(state: tauri::State<'_, ForwarderPortState>) -> Option<u16> {
    let port = state.0.load(Ordering::Relaxed);
    if port == 0 {
        None
    } else {
        Some(port)
    }
}

/// 启动代理服务器（独立线程），端口写入 state 并广播 forwarder-port-changed。
pub fn init_forwarder(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http("127.0.0.1:0") {
            Ok(server) => server,
            Err(err) => {
                log::error!("[forwarder] failed to bind 127.0.0.1: {err}");
                return;
            }
        };

        let port = match server.server_addr().to_ip() {
            Some(addr) => addr.port(),
            None => return,
        };

        if let Some(state) = app.try_state::<ForwarderPortState>() {
            state.0.store(port, Ordering::Relaxed);
        }
        let _ = app.emit("forwarder-port-changed", port);
        log::info!("[forwarder] listening on 127.0.0.1:{port}");

        for request in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || {
                handle_request(request, app);
            });
        }
    });
}

fn handle_request(request: tiny_http::Request, _app: AppHandle) {
    let raw_url = request.url().to_string();
    let query = raw_url.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params = parse_query(query);

    let Some(target_url) = params.get("url").cloned().filter(|u| !u.is_empty()) else {
        respond_plain(request, 400, "missing url parameter");
        return;
    };

    let extra_headers: HashMap<String, String> = params
        .get("headers")
        .and_then(|h| serde_json::from_str(h).ok())
        .unwrap_or_default();

    let client = match reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            respond_plain(request, 500, &format!("client build failed: {err}"));
            return;
        }
    };

    let mut upstream = client.get(&target_url);
    for (key, value) in &extra_headers {
        if is_forbidden_header(key) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(key.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            upstream = upstream.header(name, val);
        }
    }
    // 透传客户端 Range（音频 seek）
    if let Some(range) = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
    {
        upstream = upstream.header("Range", range.value.as_str());
    }

    let response = match upstream.send() {
        Ok(response) => response,
        Err(err) => {
            respond_plain(request, 502, &format!("upstream failed: {err}"));
            return;
        }
    };

    let status = response.status().as_u16();
    let content_length = response.content_length();

    // 仅转发客户端播放器关心的响应头
    let forwardable = [
        "content-type",
        "content-range",
        "accept-ranges",
        "last-modified",
        "etag",
        "cache-control",
        "expires",
    ];
    let mut out_headers = Vec::new();
    // 允许页面侧 fetch/XHR（如 hls.js）跨源读取代理响应
    if let Ok(acao) = tiny_http::Header::from_bytes(
        &b"Access-Control-Allow-Origin"[..],
        &b"*"[..],
    ) {
        out_headers.push(acao);
    }
    for (name, value) in response.headers() {
        let lower = name.as_str().to_ascii_lowercase();
        if forwardable.contains(&lower.as_str()) {
            if let Ok(header) =
                tiny_http::Header::from_bytes(name.as_str().as_bytes(), value.as_bytes())
            {
                out_headers.push(header);
            }
        }
    }

    // reqwest blocking Response 实现 Read，作为数据源流式转发
    let tiny_response = tiny_http::Response::new(
        tiny_http::StatusCode(status),
        out_headers,
        response,
        content_length.map(|len| len as usize),
        None,
    );
    let _ = request.respond(tiny_response);
}

/// 发送纯文本响应（Request::respond 按值消费，故这里取所有权）
fn respond_plain(request: tiny_http::Request, status: u16, message: &str) {
    let mut response =
        tiny_http::Response::from_string(message).with_status_code(tiny_http::StatusCode(status));
    // 错误响应同样允许跨源读取，便于页面侧 fetch 拿到状态码
    if let Ok(acao) = tiny_http::Header::from_bytes(
        &b"Access-Control-Allow-Origin"[..],
        &b"*"[..],
    ) {
        response = response.with_header(acao);
    }
    let _ = request.respond(response);
}

/// 这些头由底层 HTTP 栈管理，透传会破坏请求
fn is_forbidden_header(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "transfer-encoding" | "range"
    )
}

/// 解析 x-www-form-urlencoded query（'+' 视为空格）
fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        map.insert(percent_decode(key), percent_decode(value));
    }
    map
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
