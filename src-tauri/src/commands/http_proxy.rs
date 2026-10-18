use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct HttpOptions {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponsePayload {
    #[serde(rename = "statusCode")]
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn http_request(
    url: String,
    options: Option<HttpOptions>,
) -> Result<HttpResponsePayload, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let method_str = options
        .as_ref()
        .and_then(|o| o.method.clone())
        .unwrap_or_else(|| "GET".to_string());

    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut req_builder = client.request(method, &url);

    if let Some(opt) = options {
        if let Some(headers_map) = opt.headers {
            let mut header_map = HeaderMap::new();
            for (k, v) in headers_map {
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_bytes(k.as_bytes()),
                    HeaderValue::from_str(&v),
                ) {
                    header_map.insert(name, val);
                }
            }
            req_builder = req_builder.headers(header_map);
        }

        if let Some(body_val) = opt.body {
            if let Some(s) = body_val.as_str() {
                req_builder = req_builder.body(s.to_string());
            } else {
                req_builder = req_builder.json(&body_val);
            }
        }
    }

    let resp = req_builder.send().await.map_err(|e| e.to_string())?;
    let status_code = resp.status().as_u16();

    let mut res_headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(val) = v.to_str() {
            res_headers.insert(k.as_str().to_string(), val.to_string());
        }
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpResponsePayload {
        status_code,
        headers: res_headers,
        body,
    })
}
