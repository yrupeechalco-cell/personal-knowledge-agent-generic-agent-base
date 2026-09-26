//! Opt-in LAN synchronization. Only indexed library data is accessible; never
//! expose arbitrary Tauri commands, filesystem paths, model keys or shell access.
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, io::Read, net::{IpAddr, UdpSocket}, path::{Component, Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const PORT: u16 = 5177;
const MAX_BODY: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Config { enabled: bool, token: String, server_id: String, inbox: String }
struct Running { stop: Arc<AtomicBool>, thread: std::thread::JoinHandle<()> }
#[derive(Default)]
pub struct MobileSyncState(Mutex<Option<Running>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { enabled: bool, running: bool, urls: Vec<String>, inbox: String, error: Option<String> }

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("mobile-sync.json"))
}
fn load_config(app: &tauri::AppHandle) -> Result<Config, String> {
    let path = config_path(app)?;
    if !path.exists() { return Ok(Config::default()); }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn persist_config(app: &tauri::AppHandle, config: &Config) -> Result<(), String> {
    let path = config_path(app)?; let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    super::replace_file_atomic(&temporary, &path)
}
fn secret() -> Result<String, String> {
    let mut bytes = [0u8; 32]; getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn addresses() -> Vec<String> {
    let mut result = Vec::new();
    // UDP connect selects the active LAN interface without sending a packet.
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(address) = socket.local_addr() { if let IpAddr::V4(ip) = address.ip() { if ip.is_private() { result.push(ip.to_string()); } } }
        }
    }
    result.push("127.0.0.1".into()); result
}

#[tauri::command]
pub fn mobile_sync_status(app: tauri::AppHandle) -> Result<Status, String> {
    let config = load_config(&app)?;
    let running = app.state::<MobileSyncState>().0.lock().map_err(|e| e.to_string())?.is_some();
    Ok(Status { enabled: config.enabled, running,
        urls: if running { addresses().iter().map(|ip| format!("http://{ip}:{PORT}/?mobile=1#pair={}", config.token)).collect() } else { vec![] },
        inbox: config.inbox, error: if config.enabled && !running { Some("同步服务未启动，请重新开启；检查 5177 端口是否被占用。".into()) } else { None } })
}

#[tauri::command]
pub async fn mobile_sync_enable(app: tauri::AppHandle) -> Result<Status, String> {
    enable(app, false).await
}

#[tauri::command]
pub async fn mobile_sync_choose_inbox(app: tauri::AppHandle) -> Result<Status, String> {
    enable(app, true).await
}

async fn enable(app: tauri::AppHandle, choose_inbox: bool) -> Result<Status, String> {
    let mut config = load_config(&app)?;
    if config.inbox.is_empty() || choose_inbox || !Path::new(&config.inbox).is_dir() {
        let picked = rfd::AsyncFileDialog::new().set_title("手机新笔记保存到哪个文件夹？请选择一个现有监测根目录或新的资料目录").pick_folder().await;
        let Some(picked) = picked else { return mobile_sync_status(app); };
        let path = picked.path().canonicalize().map_err(|e| e.to_string())?;
        super::library::mobile_add_inbox(app.clone(), path.clone()).await?;
        config.inbox = path.to_string_lossy().into();
        shutdown(&app);
    }
    if config.server_id.is_empty() { config.server_id = secret()?; }
    if config.token.is_empty() { config.token = secret()?; }
    config.enabled = true;
    start(&app, config.clone())?;
    if let Err(error) = persist_config(&app, &config) { shutdown(&app); return Err(error); }
    mobile_sync_status(app)
}

#[tauri::command]
pub fn mobile_sync_disable(app: tauri::AppHandle) -> Result<Status, String> {
    let mut config = load_config(&app)?; config.enabled = false; config.token.clear();
    persist_config(&app, &config)?; shutdown(&app); mobile_sync_status(app)
}

pub fn restore(app: &tauri::AppHandle) {
    if let Ok(config) = load_config(app) { if config.enabled { let _ = start(app, config); } }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<MobileSyncState>().0.lock() {
        if let Some(running) = guard.take() { running.stop.store(true, Ordering::SeqCst); let _ = running.thread.join(); }
    }
}
fn start(app: &tauri::AppHandle, config: Config) -> Result<(), String> {
    let state = app.state::<MobileSyncState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() { return Ok(()); }
    let assets = app.path().resource_dir().map_err(|e| e.to_string())?.join("mobile-web");
    if !assets.join("index.html").is_file() { return Err("安装包缺少手机版页面，请更新完整安装包。".into()); }
    let server = Server::http(("0.0.0.0", PORT)).map_err(|e| format!("无法开启手机同步：{e}"))?;
    let stop = Arc::new(AtomicBool::new(false)); let stopping = stop.clone(); let app = app.clone();
    let thread = std::thread::spawn(move || {
        while !stopping.load(Ordering::SeqCst) {
            match server.recv_timeout(Duration::from_millis(200)) {
                Ok(Some(request)) => handle(request, &app, &config, &assets),
                Ok(None) => {}, Err(_) => break,
            }
        }
    });
    *guard = Some(Running { stop, thread }); Ok(())
}

fn header(request: &Request, name: &'static str) -> String {
    request.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_owned()).unwrap_or_default()
}
fn local_ip(ip: IpAddr) -> bool { match ip { IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(), IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() } }
fn allowed_host(host: &str) -> bool {
    host.strip_suffix(&format!(":{PORT}")).and_then(|ip| ip.parse::<IpAddr>().ok()).is_some_and(local_ip)
}
fn authorized(value: &str, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    !token.is_empty() && value.len() == expected.len() && value.bytes().zip(expected.bytes()).fold(0u8, |sum, (a,b)| sum | (a ^ b)) == 0
}
fn reply(request: Request, status: u16, body: Vec<u8>, content_type: &str) {
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    for (key, value) in [("Content-Type", content_type), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"), ("X-Frame-Options", "DENY")] {
        if let Ok(header) = Header::from_bytes(key, value) { response.add_header(header); }
    }
    let _ = request.respond(response);
}
fn json_reply(request: Request, status: u16, value: serde_json::Value) { reply(request, status, value.to_string().into_bytes(), "application/json; charset=utf-8"); }
fn asset_path(root: &Path, url: &str) -> Option<PathBuf> {
    let relative = url.split('?').next()?.trim_start_matches('/');
    let relative = if relative.is_empty() { "index.html" } else { relative };
    if relative.contains('%') || relative.contains('\\') || !Path::new(relative).components().all(|c| matches!(c, Component::Normal(_))) { return None; }
    let path = root.join(relative).canonicalize().ok()?;
    if !path.starts_with(root.canonicalize().ok()?) || !path.is_file() { return None; }
    Some(path)
}
fn handle(mut request: Request, app: &tauri::AppHandle, config: &Config, assets: &Path) {
    let host = header(&request, "Host");
    if !request.remote_addr().is_some_and(|addr| local_ip(addr.ip())) || !allowed_host(&host) {
        return json_reply(request, 403, json!({"error":"仅允许本机和局域网连接。"}));
    }
    let origin = header(&request, "Origin");
    if !origin.is_empty() && origin != format!("http://{host}") { return json_reply(request, 403, json!({"error":"跨站请求已拒绝。"})); }
    let url = request.url().split('?').next().unwrap_or("").to_owned();
    if url.starts_with("/api/") {
        if !authorized(&header(&request, "Authorization"), &config.token) { return json_reply(request, 401, json!({"error":"需要设备配对。"})); }
        if url == "/api/mobile/snapshot" && request.method() == &Method::Get {
            return match tauri::async_runtime::block_on(super::library::library_scan(app.clone())) {
                Ok(snapshot) => json_reply(request, 200, json!({"serverId":config.server_id,"capabilities":{"media":true,"mediaChunks":true},"snapshot":super::library::mobile_public_snapshot(&snapshot)})),
                Err(error) => json_reply(request, 503, json!({"error":error})),
            };
        }
        if url == "/api/mobile/attachment" && request.method() == &Method::Post {
            if !header(&request, "Content-Type").starts_with("application/json") || request.body_length().is_none_or(|len| len > 16384) { return json_reply(request, 413, json!({"error":"附件请求格式无效。"})); }
            let mut body = Vec::new();
            if request.as_reader().take(16385).read_to_end(&mut body).is_err() || body.len() > 16384 { return json_reply(request, 413, json!({"error":"附件请求过大。"})); }
            #[derive(Deserialize)] struct AttachmentRequest { id: String, revision: String, #[serde(default)] offset: Option<u64> }
            let input = match serde_json::from_slice::<AttachmentRequest>(&body) { Ok(input) => input, Err(_) => return json_reply(request, 422, json!({"error":"附件编号无效。"})) };
            return match tauri::async_runtime::block_on(super::library::mobile_attachment(app.clone(), input.id, input.revision, input.offset)) {
                Ok((bytes, mime)) => reply(request, 200, bytes, mime),
                Err(error) => json_reply(request, 422, json!({"error":error})),
            };
        }
        if url == "/api/mobile/media-chunk" && request.method() == &Method::Post {
            let limit = super::mobile_media::CHUNK_BYTES + 16388;
            if header(&request, "Content-Type") != "application/octet-stream" || request.body_length().is_none_or(|len| len > limit) { return json_reply(request, 413, json!({"error":"附件分块请求过大或格式无效。"})); }
            let mut body = Vec::new();
            if request.as_reader().take(limit as u64 + 1).read_to_end(&mut body).is_err() { return json_reply(request, 422, json!({"error":"附件上传中断，请重试。"})); }
            let (upload, bytes) = match super::mobile_media::decode_chunk(&body) { Ok(input) => input, Err(error) => return json_reply(request, 422, json!({"error":error})) };
            // A lost final response must not make the phone upload the original again.
            if upload.offset == 0 && tauri::async_runtime::block_on(super::library::library_load(app.clone())).is_ok_and(|data| super::library::mobile_operation_saved(&data, &upload.operation_id)) {
                return json_reply(request, 200, json!({"offset":upload.total}));
            }
            return match super::mobile_media::directory(app).and_then(|dir| super::mobile_media::receive(&dir, &upload, bytes)) {
                Ok(offset) => json_reply(request, 200, json!({"offset":offset})),
                Err(error) => json_reply(request, 422, json!({"error":error})),
            };
        }
        if url == "/api/mobile/media-finish" && request.method() == &Method::Post {
            if !header(&request, "Content-Type").starts_with("application/json") || request.body_length().is_none_or(|len| len as u64 > MAX_BODY) { return json_reply(request, 413, json!({"error":"附件信息无效或过大。"})); }
            let mut body = Vec::new();
            if request.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY { return json_reply(request, 413, json!({"error":"无法读取附件信息。"})); }
            let change = match serde_json::from_slice::<super::library::MobileChange>(&body) { Ok(value) => value, Err(_) => return json_reply(request, 422, json!({"error":"附件信息格式无效。"})) };
            let id = super::library::mobile_document_id(&change); let operation = change.operation_id.clone();
            let directory = match super::mobile_media::directory(app) { Ok(dir) => dir, Err(error) => return json_reply(request, 422, json!({"error":error})) };
            let path = match super::mobile_media::staged_path(&directory, &operation) { Ok(path) => path, Err(error) => return json_reply(request, 422, json!({"error":error})) };
            return match tauri::async_runtime::block_on(super::library::mobile_save_file(app.clone(), change, PathBuf::from(&config.inbox), path)) {
                Ok(document) => { super::mobile_media::cleanup(&directory, &operation); let _ = app.emit("mobile-library-changed", ()); json_reply(request, 200, json!({"document":document})) },
                Err(error) if error.starts_with("conflict:") => {
                    let data = tauri::async_runtime::block_on(super::library::library_load(app.clone()));
                    let document = data.ok().and_then(|data| super::library::mobile_conflict(&data, &id, &operation));
                    json_reply(request, 409, json!({"error":error,"document":document}))
                },
                Err(error) => json_reply(request, 422, json!({"error":error})),
            };
        }
        if url == "/api/mobile/media-change" && request.method() == &Method::Post {
            if header(&request, "Content-Type") != "application/octet-stream" || request.body_length().is_none_or(|len| len > super::mobile_media::MAX_REQUEST) { return json_reply(request, 413, json!({"error":"附件请求过大或格式无效。"})); }
            let mut body = Vec::new();
            if request.as_reader().take(super::mobile_media::MAX_REQUEST as u64 + 1).read_to_end(&mut body).is_err() { return json_reply(request, 422, json!({"error":"附件上传中断，请重试。"})); }
            let (change, bytes) = match super::mobile_media::decode(&body) { Ok(input) => input, Err(error) => return json_reply(request, 422, json!({"error":error})) };
            let id = super::library::mobile_document_id(&change); let operation = change.operation_id.clone();
            return match tauri::async_runtime::block_on(super::library::mobile_save_content(app.clone(), change, PathBuf::from(&config.inbox), Some(bytes.to_vec()))) {
                Ok(document) => { let _ = app.emit("mobile-library-changed", ()); json_reply(request, 200, json!({"document":document})) },
                Err(error) if error.starts_with("conflict:") => {
                    let data = tauri::async_runtime::block_on(super::library::library_load(app.clone()));
                    let document = data.ok().and_then(|data| super::library::mobile_conflict(&data, &id, &operation));
                    json_reply(request, 409, json!({"error":error,"document":document}))
                },
                Err(error) => json_reply(request, 422, json!({"error":error})),
            };
        }
        if url == "/api/mobile/change" && request.method() == &Method::Post {
            if !header(&request, "Content-Type").starts_with("application/json") || request.body_length().is_none_or(|len| len as u64 > MAX_BODY) { return json_reply(request, 413, json!({"error":"请求格式无效或过大。"})); }
            let mut body = Vec::new();
            if request.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY { return json_reply(request, 413, json!({"error":"无法读取同步内容。"})); }
            let change = match serde_json::from_slice::<super::library::MobileChange>(&body) { Ok(value) => value, Err(_) => return json_reply(request, 422, json!({"error":"同步内容格式无效。"})) };
            let id = super::library::mobile_document_id(&change);
            let operation = change.operation_id.clone();
            return match tauri::async_runtime::block_on(super::library::mobile_save(app.clone(), change, PathBuf::from(&config.inbox))) {
                Ok(document) => { let _ = app.emit("mobile-library-changed", ()); json_reply(request, 200, json!({"document":document})) },
                Err(error) if error.starts_with("conflict:") => {
                    let snapshot = tauri::async_runtime::block_on(super::library::library_load(app.clone()));
                    let document = snapshot.ok().and_then(|data| super::library::mobile_conflict(&data, &id, &operation));
                    json_reply(request, 409, json!({"error":error,"document":document}))
                },
                Err(error) => json_reply(request, 422, json!({"error":error})),
            };
        }
        return json_reply(request, 404, json!({"error":"接口不存在。"}));
    }
    if request.method() != &Method::Get { return json_reply(request, 405, json!({"error":"不支持此方法。"})); }
    let Some(path) = asset_path(assets, &url) else { return json_reply(request, 404, json!({"error":"页面不存在。"})); };
    let content_type = match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") { "html" => "text/html; charset=utf-8", "js" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8", "svg" => "image/svg+xml", "png" => "image/png", "woff2" => "font/woff2", _ => "application/octet-stream" };
    match fs::read(path) { Ok(bytes) => reply(request, 200, bytes, content_type), Err(_) => json_reply(request, 404, json!({"error":"页面文件不可读。"})) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authentication_and_dns_rebinding_are_rejected() {
        assert!(authorized("Bearer abc", "abc")); assert!(!authorized("", "")); assert!(!authorized("Bearer abd", "abc"));
        assert!(allowed_host("192.168.0.103:5177")); assert!(allowed_host("127.0.0.1:5177"));
        assert!(!allowed_host("malicious.example:5177")); assert!(!allowed_host("8.8.8.8:5177")); assert!(!allowed_host("192.168.0.103:80"));
    }
    #[test]
    fn static_paths_cannot_escape_bundle() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(asset_path(root, "/Cargo.toml").is_some());
        assert!(asset_path(root, "/../package.json").is_none());
        assert!(asset_path(root, "/%2e%2e/package.json").is_none());
        assert!(asset_path(root, "/..\\package.json").is_none());
    }
}
