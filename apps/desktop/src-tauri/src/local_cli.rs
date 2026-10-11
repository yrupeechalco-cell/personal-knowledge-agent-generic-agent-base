//! Independent, same-user CLI transport. Existing model/agent bridges stay untouched.
//! Only named application methods registered by the main window can be called.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Read, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, State};

const MAX_REQUEST: usize = 2 * 1024 * 1024;
const EVENT: &str = "local-cli-request";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String, method: String, state: String, created_at: u64,
    result: Option<Value>, error: Option<String>,
    #[serde(skip)] params: Value,
    #[serde(skip)] fingerprint: String,
}

#[derive(Default)]
struct Runtime {
    port: u16, token: String, ready: bool, methods: Vec<Value>,
    jobs: HashMap<String, Job>, stop: Option<Arc<AtomicBool>>,
    // Prevent two application instances from claiming the same CLI connection.
    lease: Option<fs::File>, error: Option<String>,
}
#[derive(Default)]
pub struct LocalCliState(Mutex<Runtime>);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call { id: String, method: String, #[serde(default = "empty_object")] params: Value }
fn empty_object() -> Value { json!({}) }
fn now() -> u64 { super::now_ms().unwrap_or_default() }
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("local-cli");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn shell_path(path: &std::path::Path) -> String {
    // resource_dir uses a verbatim Windows path; cmd.exe cannot launch the copied
    // batch entry through that prefix. Filesystem containment paths stay unchanged.
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") { format!("\\\\{unc}") }
    else { value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned() }
}
fn status(app: &tauri::AppHandle, runtime: &Runtime) -> Value {
    json!({"protocolVersion":1, "appVersion":env!("CARGO_PKG_VERSION"),
        "enabled":runtime.stop.is_some(), "ready":runtime.ready,
        "cliPath":app.path().resource_dir().ok().map(|p| shell_path(&p.join("cli/knowledge-cli.cmd"))),
        "connectionDirectory":directory(app).ok(), "error":runtime.error,
        "running":runtime.jobs.values().filter(|j| j.state == "running").count(),
        "capabilityCount":runtime.methods.len()})
}

#[tauri::command]
pub fn local_cli_status(app: tauri::AppHandle, state: State<'_, LocalCliState>) -> Result<Value, String> {
    let runtime = state.0.lock().map_err(|e| e.to_string())?;
    Ok(status(&app, &runtime))
}

#[tauri::command]
pub fn local_cli_configure(app: tauri::AppHandle, enabled: bool) -> Result<Value, String> {
    let state = app.state::<LocalCliState>();
    let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
    if enabled && runtime.stop.is_none() { start(&app, &mut runtime)?; }
    if !enabled { stop(&app, &mut runtime); }
    let preference = directory(&app)?.join("enabled.json");
    fs::write(preference, if enabled { "true" } else { "false" }).map_err(|e| e.to_string())?;
    let result = status(&app, &runtime);
    let _ = app.emit("local-cli-status", &result);
    Ok(result)
}

fn start(app: &tauri::AppHandle, runtime: &mut Runtime) -> Result<(), String> {
    let dir = directory(app)?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0); }
    let lease = options.open(dir.join("owner.lock")).map_err(|_| "另一个知识库窗口已提供 CLI 通道，请使用那个窗口或先关闭它。")?;
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().ok_or("CLI 本机端口不可用。")?.port();
    let token = random_id()?;
    let connection = json!({"protocolVersion":1,"port":port,"token":token,"pid":std::process::id()});
    // Windows DPAPI: another Windows account cannot decrypt the connection.
    let protected = super::protect_secret(connection.to_string().as_bytes())?;
    let temp = dir.join("connection.tmp");
    fs::write(&temp, protected).map_err(|e| e.to_string())?;
    super::replace_file_atomic(&temp, &dir.join("connection.bin"))?;
    let stopping = Arc::new(AtomicBool::new(false));
    runtime.port = port; runtime.token = token; runtime.stop = Some(stopping.clone());
    runtime.lease = Some(lease); runtime.error = None;
    let handle = app.clone();
    std::thread::spawn(move || {
        while !stopping.load(Ordering::Acquire) {
            match server.recv_timeout(Duration::from_millis(200)) {
                Ok(Some(request)) => serve(&handle, request),
                Ok(None) => {}, Err(_) => break,
            }
        }
    });
    Ok(())
}
fn stop(app: &tauri::AppHandle, runtime: &mut Runtime) {
    if let Some(stop) = runtime.stop.take() {
        stop.store(true, Ordering::Release);
        if let Ok(dir) = directory(app) { let _ = fs::remove_file(dir.join("connection.bin")); }
    }
    runtime.token.clear(); runtime.port = 0;
    for job in runtime.jobs.values_mut().filter(|j| j.state == "queued") {
        job.state = "cancelled".into(); job.error = Some("CLI 通道已关闭，排队任务未执行。".into());
    }
    runtime.lease = None;
}
pub fn restore(app: &tauri::AppHandle) {
    let enabled = std::env::args().any(|arg| arg == "--enable-local-cli") || directory(app).ok()
        .and_then(|p| fs::read_to_string(p.join("enabled.json")).ok()).as_deref() == Some("true");
    if enabled {
        if let Err(error) = local_cli_configure(app.clone(), true) {
            if let Ok(mut runtime) = app.state::<LocalCliState>().0.lock() { runtime.error = Some(error); }
        }
    }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut runtime) = app.state::<LocalCliState>().0.lock() { stop(app, &mut runtime); }
}

#[tauri::command]
pub fn local_cli_register(state: State<'_, LocalCliState>, methods: Vec<Value>) -> Result<(), String> {
    if methods.len() > 100 || methods.iter().any(|m| m.get("name").and_then(Value::as_str).is_none()) {
        return Err("CLI 方法清单无效。".into());
    }
    let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
    runtime.methods = methods; runtime.ready = true; Ok(())
}

#[tauri::command]
pub fn local_cli_claim(state: State<'_, LocalCliState>, id: String) -> Result<Value, String> {
    let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
    if runtime.stop.is_none() { return Err("CLI 通道已关闭。".into()); }
    let job = runtime.jobs.get_mut(&id).ok_or("CLI 任务不存在。")?;
    if job.state != "queued" { return Err("此任务已被领取或结束，不能重复执行。".into()); }
    if now().saturating_sub(job.created_at) > 180_000 {
        job.state = "cancelled".into(); job.error = Some("排队超时，任务未执行。".into());
        return Err("排队超时，任务未执行。".into());
    }
    job.state = "running".into();
    Ok(json!({"method":job.method,"params":job.params}))
}

#[tauri::command]
pub fn local_cli_complete(app: tauri::AppHandle, id: String, result: Option<Value>, error: Option<String>) -> Result<(), String> {
    let state = app.state::<LocalCliState>();
    let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
    let job = runtime.jobs.get_mut(&id).ok_or("CLI 任务不存在。")?;
    if job.state != "running" { return Err("任务不是执行中状态。".into()); }
    job.state = if error.is_some() { "failed" } else { "succeeded" }.into();
    job.result = result; job.error = error;
    job.params = Value::Null; // Completed receipts must not retain private request bodies.
    // No arguments, document contents, paths, credentials or model keys in the audit log.
    if let Ok(dir) = directory(&app) {
        use std::io::Write;
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(dir.join("activity.jsonl")) {
            let _ = writeln!(file, "{}", json!({"id":job.id,"method":job.method,"state":job.state,"at":now()}));
        }
    }
    // Keep receipts for idempotency, but bound retained response data in a long session.
    let mut retained: Vec<_> = runtime.jobs.values().filter(|j| j.result.is_some()).map(|j| (j.created_at, j.id.clone(), j.result.as_ref().map(|v| v.to_string().len()).unwrap_or(0))).collect();
    retained.sort_by_key(|entry| entry.0);
    let mut bytes: usize = retained.iter().map(|entry| entry.2).sum();
    for (_, old_id, size) in retained {
        if bytes <= 16 * 1024 * 1024 { break; }
        if let Some(old) = runtime.jobs.get_mut(&old_id) { old.result = Some(json!({"resultExpired":true,"message":"结果缓存已释放，请读取当前 App 状态；此任务不会重复执行。"})); }
        bytes = bytes.saturating_sub(size);
    }
    Ok(())
}

fn authorized(request: &tiny_http::Request, runtime: &Runtime) -> bool {
    let header = |name: &'static str| request.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str());
    valid_credentials(header("Host"), header("Origin"), header("Authorization"), runtime.port, &runtime.token, runtime.stop.is_some())
}
fn valid_credentials(host: Option<&str>, origin: Option<&str>, authorization: Option<&str>, port: u16, token: &str, enabled: bool) -> bool {
    // No browser origins or permissive CORS, including localhost web pages/iframes.
    if origin.is_some() || host != Some(format!("127.0.0.1:{port}").as_str()) { return false; }
    let expected = format!("Bearer {token}");
    let supplied = authorization.unwrap_or_default();
    enabled && !token.is_empty() && supplied.len() == expected.len() && supplied.bytes().zip(expected.bytes()).fold(0u8, |diff, (a,b)| diff | (a ^ b)) == 0
}

fn revision(content: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hash);
    format!("{}:{:016x}", content.len(), hash.finish())
}
fn read_document(path: &std::path::Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > super::MAX_CANVAS_BYTES as u64 { return Err("文档不是普通文件或超过 5 MiB，请使用文件资料接口。".into()); }
            fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn document_revision(path: &std::path::Path, content: &str) -> String {
    // A revision from another vault/file cannot authorize an edit with equal content.
    revision(&format!("{}\0{content}", path.canonicalize().unwrap_or_else(|_| path.to_path_buf()).display()))
}

/// Revision-checked writes with durable undo copies, shared by the CLI's UI handler.
/// Files remain confined to the explicitly opened vault; model credentials are excluded.
#[tauri::command]
pub fn local_cli_document(root: String, path: String, operation: String, expected_revision: Option<String>, content: Option<String>, backup_id: Option<String>) -> Result<Value, String> {
    static WRITE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = PathBuf::from(root);
    super::ensure_existing_dir(&root)?;
    let canvas = operation.starts_with("canvas.");
    let relative = if canvas { ".knowledge-agent/canvas.json" } else { &path };
    if !canvas {
        super::ensure_allowed_path(relative)?;
        if std::path::Path::new(relative).extension().and_then(|s| s.to_str()) != Some("md") { return Err("笔记接口仅支持 .md 文件。".into()); }
    }
    let full = if canvas { super::safe_internal_join(&root, relative)? } else { super::safe_join(&root, relative)? };
    let before = read_document(&full)?;
    let current_revision = before.as_deref().map(|text| document_revision(&full, text));
    if operation.ends_with(".read") {
        return Ok(json!({"path":relative,"content":before,"revision":current_revision}));
    }
    if !["notes.write", "notes.delete", "notes.undo", "canvas.write"].contains(&operation.as_str()) { return Err("未知文档操作。".into()); }
    if current_revision != expected_revision { return Err("文件已改变，请重新读取 revision 后再操作；未覆盖内容。".into()); }
    if operation == "notes.delete" {
        if before.is_none() { return Err("笔记不存在。".into()); }
        let entry = super::move_note_to_trash(&root, relative, &full)?;
        return Ok(json!({"deleted":true,"trashId":entry.id,"path":relative}));
    }
    let next = if operation == "notes.undo" {
        let id = backup_id.ok_or("缺少 backupId。")?;
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("无效的备份编号。".into()); }
        let backup = super::safe_internal_join(&root, &format!(".knowledge-agent/cli-backups/{id}.json"))?;
        let value: Value = serde_json::from_str(&read_document(&backup)?.ok_or("备份不存在。")?).map_err(|e| e.to_string())?;
        if value["path"] != relative { return Err("备份不属于这份笔记。".into()); }
        value["content"].as_str().ok_or("备份正文无效。")?.to_owned()
    } else { content.ok_or("缺少 content。")? };
    if next.len() > super::MAX_CANVAS_BYTES || next.contains('\0') { return Err("正文超过 5 MiB 或含有二进制字符。".into()); }
    if canvas { serde_json::from_str::<Value>(&next).map_err(|_| "画布需要有效 JSON。")?; }
    let backup = if let Some(before) = &before {
        let id = random_id()?;
        let location = super::safe_internal_join(&root, &format!(".knowledge-agent/cli-backups/{id}.json"))?;
        fs::create_dir_all(location.parent().ok_or("备份目录不存在。")?).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&location).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &json!({"path":relative,"content":before,"revision":current_revision})).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        Some(id)
    } else { None };
    fs::create_dir_all(full.parent().ok_or("文档目录不存在。")?).map_err(|e| e.to_string())?;
    let temp = full.with_extension(format!("{}.cli-tmp", random_id()?));
    {
        use std::io::Write;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
        file.write_all(next.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    }
    // Recheck after the backup write in case an external editor changed the source.
    if read_document(&full)?.as_deref().map(|text| document_revision(&full, text)) != current_revision {
        let _ = fs::remove_file(&temp); return Err("保存期间文件发生变化，请重新读取。".into());
    }
    if let Err(error) = super::replace_file_atomic(&temp, &full) { let _ = fs::remove_file(&temp); return Err(error); }
    Ok(json!({"saved":true,"path":relative,"revision":document_revision(&full, &next),"backupId":backup}))
}
fn respond(request: tiny_http::Request, code: u16, value: Value) {
    let response = tiny_http::Response::from_string(value.to_string()).with_status_code(code)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap())
        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap());
    let _ = request.respond(response);
}
fn serve(app: &tauri::AppHandle, mut request: tiny_http::Request) {
    let state = app.state::<LocalCliState>();
    let Ok(mut runtime) = state.0.lock() else { respond(request, 503, json!({"error":"CLI 状态不可用"})); return; };
    if !authorized(&request, &runtime) { respond(request, 403, json!({"error":"CLI 身份验证失败"})); return; }
    let route = request.url().to_owned();
    if request.method() == &tiny_http::Method::Get {
        let value = match route.as_str() {
            "/v1/status" => Some(status(app, &runtime)),
            "/v1/capabilities" => Some(json!({"protocolVersion":1,"methods":runtime.methods})),
            _ => route.strip_prefix("/v1/jobs/").and_then(|id| runtime.jobs.get(id)).map(|job| json!(job)),
        };
        respond(request, if value.is_some() { 200 } else { 404 }, value.unwrap_or(json!({"error":"任务不存在；App 重启后任务历史不保留，请核对结果再执行"}))); return;
    }
    if request.method() != &tiny_http::Method::Post || route != "/v1/call" { respond(request, 404, json!({"error":"未知 CLI 接口"})); return; }
    if !runtime.ready { respond(request, 503, json!({"error":"软件界面尚未就绪，请稍后重试"})); return; }
    if request.body_length().is_none_or(|len| len > MAX_REQUEST) { respond(request, 413, json!({"error":"请求需提供 Content-Length，且不能超过 2 MiB"})); return; }
    let mut bytes = Vec::new();
    if request.as_reader().take((MAX_REQUEST + 1) as u64).read_to_end(&mut bytes).is_err() || bytes.len() > MAX_REQUEST { respond(request, 400, json!({"error":"无法读取请求"})); return; }
    let call = match serde_json::from_slice::<Call>(&bytes) { Ok(c) => c, Err(_) => { respond(request, 400, json!({"error":"请求 JSON 格式无效"})); return; } };
    if call.id.len() != 36 || !call.id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') || !call.params.is_object() {
        respond(request, 400, json!({"error":"请求需要 UUID 编号及对象参数"})); return;
    }
    if let Some(job) = runtime.jobs.get(&call.id) {
        if job.method != call.method || job.fingerprint != revision(&call.params.to_string()) { respond(request, 409, json!({"error":"请求编号已用于其他操作"})); }
        else { respond(request, 200, json!(job)); }
        return;
    }
    if !runtime.methods.iter().any(|m| m["name"] == call.method) { respond(request, 400, json!({"error":"未知方法，请先查询 capabilities"})); return; }
    if runtime.jobs.len() >= 2000 { respond(request, 429, json!({"error":"本次启动已记录 2000 个任务，请完成任务后重启 App；未丢弃旧任务编号"})); return; }
    if runtime.jobs.values().filter(|j| j.state == "queued" || j.state == "running").count() >= 16 { respond(request, 429, json!({"error":"已有 16 个任务在处理或排队，请稍后提交新任务"})); return; }
    let fingerprint = revision(&call.params.to_string());
    let job = Job { id: call.id.clone(), method: call.method, params: call.params, fingerprint, state:"queued".into(), created_at:now(), result:None, error:None };
    runtime.jobs.insert(call.id.clone(), job.clone());
    drop(runtime);
    if app.emit_to("main", EVENT, &call.id).is_err() {
        if let Ok(mut runtime) = state.0.lock() {
            if let Some(job) = runtime.jobs.get_mut(&call.id) { job.state = "failed".into(); job.error = Some("主窗口未收到任务。".into()); }
        }
    }
    respond(request, 202, json!(job));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copied_cli_path_uses_shell_compatible_windows_spelling() {
        use std::path::Path;
        assert_eq!(shell_path(Path::new(r"\\?\C:\Users\测试 用户\cli\knowledge-cli.cmd")), r"C:\Users\测试 用户\cli\knowledge-cli.cmd");
        assert_eq!(shell_path(Path::new(r"\\?\UNC\server\share\cli\knowledge-cli.cmd")), r"\\server\share\cli\knowledge-cli.cmd");
        assert_eq!(shell_path(Path::new(r"C:\Tools\cli\knowledge-cli.cmd")), r"C:\Tools\cli\knowledge-cli.cmd");
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self { let path = std::env::temp_dir().join(format!("knowledge-cli-{}", random_id().unwrap())); fs::create_dir(&path).unwrap(); Self(path) }
        fn root(&self) -> String { self.0.to_string_lossy().into_owned() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn connection_rejects_browser_origins_wrong_host_tokens_and_disabled_state() {
        let valid = |host, origin, auth, enabled| valid_credentials(host, origin, auth, 4567, "secret", enabled);
        assert!(valid(Some("127.0.0.1:4567"), None, Some("Bearer secret"), true));
        assert!(!valid(Some("127.0.0.1:4567"), Some("http://localhost:5173"), Some("Bearer secret"), true));
        assert!(!valid(Some("evil.example:4567"), None, Some("Bearer secret"), true));
        assert!(!valid(Some("127.0.0.1:4567"), None, Some("Bearer wrong!"), true));
        assert!(!valid(Some("127.0.0.1:4567"), None, Some("Bearer secret"), false));
    }

    #[test]
    fn stale_write_is_rejected_and_successful_edit_has_working_undo() {
        let f = Fixture::new();
        let create = local_cli_document(f.root(), "note.md".into(), "notes.write".into(), None, Some("原文".into()), None).unwrap();
        let rev = create["revision"].as_str().unwrap().to_string();
        assert!(local_cli_document(f.root(), "note.md".into(), "notes.write".into(), None, Some("bad".into()), None).is_err());
        let updated = local_cli_document(f.root(), "note.md".into(), "notes.write".into(), Some(rev.clone()), Some("新内容".into()), None).unwrap();
        assert!(local_cli_document(f.root(), "note.md".into(), "notes.delete".into(), Some(rev), None, None).is_err());
        local_cli_document(f.root(), "note.md".into(), "notes.undo".into(), Some(updated["revision"].as_str().unwrap().into()), None, Some(updated["backupId"].as_str().unwrap().into())).unwrap();
        assert_eq!(fs::read_to_string(f.0.join("note.md")).unwrap(), "原文");
    }

    #[test]
    fn document_operations_reject_escape_and_non_markdown_paths() {
        let f = Fixture::new();
        for path in ["../outside.md", ".git/config", "credentials.json", "C:/outside.md"] {
            assert!(local_cli_document(f.root(), path.into(), "notes.write".into(), None, Some("bad".into()), None).is_err(), "{path}");
        }
    }
}
