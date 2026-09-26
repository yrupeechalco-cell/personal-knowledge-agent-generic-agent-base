//! Folder-backed knowledge views. Metadata never moves or rewrites originals;
//! source changes use separate, revision-checked commands with an undo backup.
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::Manager;

static STORE_LOCK: Mutex<()> = Mutex::new(());
const MAX_FILES: usize = 1500;
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const MAX_INDEX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    version: u32,
    roots: Vec<Root>,
    documents: Vec<Document>,
    #[serde(default)] auto_analyze: bool,
    #[serde(default = "idle")] queue_state: String,
    #[serde(default)] store_revision: u64,
    #[serde(default)] mobile_receipts: HashMap<String, MobileReceipt>,
}
fn idle() -> String { "idle".into() }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    id: String,
    path: String,
    paused: bool,
    last_scan: Option<u64>,
    issue: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    id: String,
    root_id: String,
    path: String,
    revision: String,
    size: u64,
    updated_at: u64,
    text: String,
    issue: Option<String>,
    status: String,
    summary: String,
    category: String,
    tags: Vec<String>,
    #[serde(default)] categories: Vec<String>,
    #[serde(default)] tips: Vec<Tip>,
    #[serde(default)] analysis_revision: String,
    #[serde(default)] classification_locked: bool,
    #[serde(default)] metadata_version: u64,
    #[serde(default)] ai_error: String,
}

#[derive(Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Tip { id: String, content: String, quote: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileReceipt { id: String, revision: String, metadata_version: u64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileBase { revision: String, metadata_version: u64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileChange { pub operation_id: String, pub doc: Document, base: Option<MobileBase> }

pub fn mobile_document_id(change: &MobileChange) -> String { change.doc.id.clone() }

pub fn mobile_public_snapshot(data: &Library) -> serde_json::Value {
    let mut value = serde_json::to_value(data).unwrap_or_default();
    if let Some(object) = value.as_object_mut() { object.remove("mobileReceipts"); }
    value
}

pub fn mobile_find(data: &Library, id: &str) -> Option<Document> { data.documents.iter().find(|doc| doc.id == id).cloned() }
pub fn mobile_conflict(data: &Library, id: &str, operation: &str) -> Option<Document> {
    mobile_find(data, data.mobile_receipts.get(operation).map(|receipt| receipt.id.as_str()).unwrap_or(id))
}

pub async fn mobile_add_inbox(app: tauri::AppHandle, path: PathBuf) -> Result<Library, String> {
    transaction(app, move |data| {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if !data.roots.iter().any(|root| Path::new(&root.id) == canonical) { add_root(data, &canonical)?; }
        scan(data); Ok(())
    }).await
}

fn mobile_review(doc: &Document, current: &Document) -> Review {
    Review { id: current.id.clone(), revision: current.revision.clone(), status: doc.status.clone(),
        summary: doc.summary.clone(), category: doc.category.clone(), categories: doc.categories.clone(), tags: doc.tags.clone(), tips: doc.tips.clone(),
        classification_locked: Some(true), metadata_version: Some(current.metadata_version), source: "manual".into(), analysis_revision: Some(if doc.summary == current.summary && doc.tips == current.tips && !current.analysis_revision.is_empty() { current.analysis_revision.clone() } else { current.revision.clone() }) }
}

fn valid_mobile_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, b)| if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() })
}

// Reuse the desktop's revision checks, metadata validation, lock and source backup.
// No client-supplied absolute path is ever used as a write destination.
fn mobile_apply(data: &mut Library, change: MobileChange, inbox: &Path, backups: &Path) -> Result<String, String> {
    mobile_apply_content(data, change, inbox, backups, None)
}
fn mobile_apply_content(data: &mut Library, change: MobileChange, inbox: &Path, backups: &Path, attachment: Option<&[u8]>) -> Result<String, String> {
    if !valid_mobile_id(&change.operation_id) { return Err("无效的同步操作编号。".into()); }
    scan(data);
    if let Some(receipt) = data.mobile_receipts.get(&change.operation_id) {
        let current = data.documents.iter().find(|doc| doc.id == receipt.id);
        if current.is_some_and(|doc| doc.revision == receipt.revision && doc.metadata_version == receipt.metadata_version) { return Ok(receipt.id.clone()); }
        return Err("conflict:已同步的资料又在电脑上更新，请合并两个版本。".into());
    }
    // Never silently evict idempotency receipts while an offline device might retry.
    if data.mobile_receipts.len() >= 100000 { return Err("同步历史已达容量上限，请导出备份后维护同步记录。".into()); }
    let incoming = change.doc;
    if let Some(bytes) = attachment {
        if change.base.is_some() || !incoming.text.is_empty() || incoming.size != bytes.len() as u64 { return Err("附件请求格式无效。".into()); }
        super::mobile_media::validate(&incoming.path, bytes)?;
    }
    if incoming.text.len() > MAX_TEXT_BYTES as usize || incoming.text.contains('\0') { return Err("原文最多 1 MB，且不能包含二进制内容。".into()); }
    let id = if let Some(base) = change.base {
        let current = data.documents.iter().find(|doc| doc.id == incoming.id).ok_or("conflict:电脑已移除此资料。")?.clone();
        if current.revision != base.revision || current.metadata_version != base.metadata_version { return Err("conflict:电脑与手机都修改了此资料。".into()); }
        let mut candidate = data.clone();
        let index = check_document(&candidate, &current.id, &current.revision).map_err(|e| format!("conflict:{e}"))?;
        let preserves_knowledge = incoming.summary == current.summary && incoming.tips == current.tips;
        if !preserves_knowledge { candidate.documents[index].text = incoming.text.clone(); }
        let review = mobile_review(&incoming, &current);
        // Validate metadata against the proposed body before touching the source.
        save_review(&mut candidate, review)?;
        if incoming.text != current.text { write_source(data, &current.id, &current.revision, &incoming.text, backups)?; }
        let updated = data.documents.iter().find(|doc| doc.id == current.id).ok_or("资料已移除。")?.clone();
        save_review(data, mobile_review(&incoming, &updated))?;
        current.id
    } else {
        let is_media = super::mobile_media::mime(&incoming.path).is_some();
        if is_media != attachment.is_some() { return Err("附件原文件未传输，请更新电脑 App 后重试。".into()); }
        let uuid = incoming.id.strip_prefix("mobile:").filter(|id| valid_mobile_id(id)).ok_or("新资料编号无效。")?;
        let root = data.roots.iter().find(|root| Path::new(&root.id) == inbox && !root.paused).ok_or("手机收件文件夹已移除或暂停，请在电脑上重新开启同步。")?.clone();
        let safe_name: String = incoming.path.split(['/', '\\']).next_back().unwrap_or("笔记").chars().filter(|ch| ch.is_alphanumeric() || ['-', '_', '（', '）', ' '].contains(ch)).take(45).collect();
        let extension = if is_media { incoming.path.rsplit('.').next().unwrap_or("").to_ascii_lowercase() } else { "md".into() };
        let relative = format!("手机-{}-{uuid}.{extension}", if safe_name.is_empty() { "笔记" } else { &safe_name });
        let destination = inbox.join(&relative);
        if linked(&fs::symlink_metadata(inbox).map_err(|e| e.to_string())?) || inbox.canonicalize().map_err(|e| e.to_string())? != inbox { return Err("收件目录已改变，请重新选择。".into()); }
        if !super::is_allowed_path(&relative) || data.documents.len() >= MAX_FILES || data.documents.iter().map(|doc| doc.text.len()).sum::<usize>() + incoming.text.len() > MAX_INDEX_BYTES { return Err("文件名受限或资料容量已达上限。".into()); }
        // Metadata constraints are checked before a new file can be created.
        if incoming.summary.chars().count() > 6000 || incoming.tags.len() > 20 || incoming.tags.iter().any(|tag| tag.chars().count() > 60) || incoming.categories.len() > 12 || incoming.categories.iter().any(|s| s.chars().count() > 120) || incoming.category.chars().count() > 120 || incoming.tips.len() > 16 || !["pending", "reviewed", "ignored"].contains(&incoming.status.as_str()) || incoming.tips.iter().any(|tip| tip.content.trim().is_empty() || tip.content.chars().count() > 1000 || tip.quote.trim().chars().count() < 4 || tip.quote.chars().count() > 500 || !incoming.text.contains(tip.quote.trim())) { return Err("摘要、分类、标签或知识 tip 不符合保存要求。".into()); }
        let content = attachment.unwrap_or(incoming.text.as_bytes());
        // An interrupted index save may leave a complete file. Retry adopts only
        // byte-identical content at this generated id, never overwriting a source.
        if destination.exists() {
            let metadata = fs::symlink_metadata(&destination).map_err(|e| e.to_string())?;
            if linked(&metadata) || metadata.len() != content.len() as u64 || fs::read(&destination).map_err(|e| e.to_string())? != content { return Err("同名资料已存在且内容不同，未覆盖。".into()); }
        } else {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|e| format!("新资料未写入：{e}"))?;
            if let Err(error) = file.write_all(content).and_then(|_| file.sync_all()) {
                drop(file); let _ = fs::remove_file(&destination); return Err(format!("附件写入失败：{error}"));
            }
            drop(file);
        }
        scan(data);
        let id = format!("{}\n{}", root.id, relative);
        let current = data.documents.iter().find(|doc| doc.id == id).ok_or("新文件已保存，但尚未收录，请在电脑上重新扫描。")?.clone();
        save_review(data, mobile_review(&incoming, &current))?;
        id
    };
    let current = data.documents.iter().find(|doc| doc.id == id).ok_or("资料已移除。")?;
    data.mobile_receipts.insert(change.operation_id, MobileReceipt { id: id.clone(), revision: current.revision.clone(), metadata_version: current.metadata_version });
    Ok(id)
}

pub async fn mobile_save(app: tauri::AppHandle, change: MobileChange, inbox: PathBuf) -> Result<Document, String> {
    mobile_save_content(app, change, inbox, None).await
}
pub async fn mobile_save_content(app: tauri::AppHandle, change: MobileChange, inbox: PathBuf, attachment: Option<Vec<u8>>) -> Result<Document, String> {
    let backups = store_path(&app)?.parent().ok_or("索引目录不存在。")?.join("source-backups");
    let operation = change.operation_id.clone();
    let data = transaction(app, move |data| { mobile_apply_content(data, change, &inbox, &backups, attachment.as_deref())?; Ok(()) }).await?;
    let receipt = data.mobile_receipts.get(&operation).ok_or("同步记录未保存。")?;
    mobile_find(&data, &receipt.id).ok_or("资料已移除。".into())
}

pub async fn mobile_attachment(app: tauri::AppHandle, id: String, expected: String) -> Result<(Vec<u8>, &'static str), String> {
    let data = library_load(app).await?;
    attachment_bytes(&data, &id, &expected)
}
fn attachment_bytes(data: &Library, id: &str, expected: &str) -> Result<(Vec<u8>, &'static str), String> {
    let index = check_document(data, id, expected)?;
    let doc = &data.documents[index];
    let root = data.roots.iter().find(|root| root.id == doc.root_id && !root.paused).ok_or("资料目录已暂停或移除。")?;
    let mime = super::mobile_media::mime(&doc.path).ok_or("暂不提供此格式的附件。")?;
    if doc.size > super::mobile_media::MAX_BYTES as u64 { return Err("附件超过 50 MB，请在电脑上打开。".into()); }
    let path = source_path(root, doc)?;
    let mut bytes = Vec::new();
    fs::File::open(&path).map_err(|e| e.to_string())?.take(super::mobile_media::MAX_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    check_document(data, id, expected)?;
    super::mobile_media::validate(&doc.path, &bytes)?;
    Ok((bytes, mime))
}

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    id: String,
    revision: String,
    status: String,
    summary: String,
    category: String,
    tags: Vec<String>,
    #[serde(default)] categories: Vec<String>,
    #[serde(default)] tips: Vec<Tip>,
    #[serde(default)] classification_locked: Option<bool>,
    #[serde(default)] metadata_version: Option<u64>,
    #[serde(default)] source: String,
    #[serde(default)] analysis_revision: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config { auto_analyze: Option<bool>, queue_state: Option<String>, retry_failed: Option<bool> }

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("document-library");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("index-v1.json"))
}

fn load(path: &Path) -> Result<Library, String> {
    if !path.exists() { return Ok(Library { version: 2, queue_state: idle(), ..Library::default() }); }
    let file = fs::File::open(path).map_err(|e| format!("无法读取资料索引：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
        return Err("资料索引超过读取限制，请先备份检查；原索引未被覆盖。".into());
    }
    let mut data: Library = serde_json::from_reader(file).map_err(|e| format!("资料索引损坏，请先备份检查；原索引未被覆盖：{e}"))?;
    if ![1, 2].contains(&data.version) { return Err("资料索引版本不兼容，请更新 App。".into()); }
    if data.version == 1 {
        for doc in &mut data.documents {
            doc.categories = normalize_categories(&[doc.category.clone()]);
            doc.classification_locked = doc.status == "reviewed" || !doc.category.is_empty() || !doc.tags.is_empty();
            if !doc.summary.is_empty() { doc.analysis_revision = doc.revision.clone(); }
        }
        data.version = 2;
    }
    Ok(data)
}

fn persist(path: &Path, library: &Library) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, library).map_err(|e| e.to_string())?;
    file.flush().and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    super::replace_file_atomic(&temp, path)
}

// Keep concurrent Windows App instances from overwriting the same index/temp file.
// Windows releases the exclusive handle after a crash; the empty lock file may stay.
fn acquire_store(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0); }
    options.open(path.with_extension("lock")).map_err(|_| "另一个 App 窗口正在保存资料，请稍后重试。".into())
}

async fn transaction<F>(app: tauri::AppHandle, change: F) -> Result<Library, String>
where F: FnOnce(&mut Library) -> Result<(), String> + Send + 'static {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|_| "资料索引正处于错误状态，请重启 App。".to_string())?;
        let path = store_path(&app)?;
        let _file_guard = acquire_store(&path)?;
        let mut data = load(&path)?;
        change(&mut data)?;
        data.store_revision += 1;
        persist(&path, &data)?;
        Ok(data)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_load(app: tauri::AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        load(&store_path(&app)?)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_add_folder(app: tauri::AppHandle) -> Result<Library, String> {
    let picked = rfd::AsyncFileDialog::new().set_title("选择知识资料文件夹（分类保存在 App 中）").pick_folder().await;
    let Some(picked) = picked else { return library_load(app).await; };
    let path = picked.path().to_path_buf();
    transaction(app, move |data| {
        add_root(data, &path)?;
        scan(data);
        Ok(())
    }).await
}

fn add_root(data: &mut Library, path: &Path) -> Result<(), String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_dir() { return Err("请选择一个文件夹。".into()); }
    if data.roots.iter().any(|r| canonical.starts_with(&r.id) || Path::new(&r.id).starts_with(&canonical)) {
        return Err("这个文件夹或它的上级/下级已在监测列表中，请勿重复添加。".into());
    }
    if data.roots.len() >= 10 { return Err("最多监测 10 个文件夹，请先移除不需要的目录。".into()); }
    data.roots.push(Root { id: canonical.to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), paused: false, last_scan: None, issue: None });
    Ok(())
}

#[tauri::command]
pub async fn library_scan(app: tauri::AppHandle) -> Result<Library, String> {
    transaction(app, |data| { scan(data); Ok(()) }).await
}

#[tauri::command]
pub async fn library_configure(app: tauri::AppHandle, config: Config) -> Result<Library, String> {
    transaction(app, move |data| {
        if let Some(state) = config.queue_state {
            if !["idle", "running", "paused"].contains(&state.as_str()) { return Err("无效的整理任务状态。".into()); }
            data.queue_state = state;
        }
        if let Some(enabled) = config.auto_analyze { data.auto_analyze = enabled; }
        if config.retry_failed == Some(true) { for doc in &mut data.documents { doc.ai_error.clear(); } }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn library_record_error(app: tauri::AppHandle, id: String, revision: String, error: String) -> Result<Library, String> {
    transaction(app, move |data| {
        if let Some(doc) = data.documents.iter_mut().find(|d| d.id == id && d.revision == revision && d.status == "pending") {
            doc.ai_error = error.chars().take(500).collect();
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn library_update_root(app: tauri::AppHandle, id: String, action: String) -> Result<Library, String> {
    transaction(app, move |data| {
        let root = data.roots.iter_mut().find(|r| r.id == id).ok_or("文件夹已移除。")?;
        match action.as_str() {
            "pause" => root.paused = true,
            "resume" => root.paused = false,
            "remove" => {
                data.roots.retain(|r| r.id != id);
                data.documents.retain(|d| d.root_id != id);
            },
            _ => return Err("未知的资料文件夹操作。".into()),
        }
        Ok(())
    }).await
}

fn linked(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return true; }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))] { false }
}

fn revision(metadata: &fs::Metadata) -> String {
    format!("{}:{}", metadata.len(), metadata.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0))
}

fn extract(path: &Path, size: u64) -> Result<String, String> {
    if super::mobile_media::mime(&path.to_string_lossy()).is_some() { return Ok(String::new()); }
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext == "docx" {
        if size > 20 * MAX_TEXT_BYTES { return Err("Word 文件超过 20 MB；未读取正文。".into()); }
        return super::read_docx_text(path).map_err(|e| format!("Word 正文读取失败（正文上限 1 MB）：{e}"));
    }
    if !["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm"].contains(&ext.as_str()) {
        return Err("暂不支持此格式的正文；可按文件名搜索。".into());
    }
    if size > MAX_TEXT_BYTES { return Err("文件超过 1 MB；未读取正文。".into()); }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_TEXT_BYTES { return Err("读取时文件超过 1 MB。".into()); }
    let text = String::from_utf8(bytes).map_err(|_| "不是 UTF-8 文本，请转换编码后重试。".to_string())?;
    if text.contains('\0') { return Err("文件含有二进制内容，未建立正文索引。".into()); }
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

struct Traversal {
    files: Vec<(PathBuf, String, fs::Metadata)>,
    seen_entries: usize,
    issue: Option<String>,
    started: Instant,
}

fn walk(root: &Path, dir: &Path, state: &mut Traversal) {
    if state.seen_entries >= 20000 || state.files.len() >= MAX_FILES || state.started.elapsed() > Duration::from_secs(15) {
        state.issue = Some("达到本次扫描限制（1500 个文件 / 20000 个目录项 / 15 秒）。请缩小监测文件夹；本次未移除旧索引。".into());
        return;
    }
    let entries = match fs::read_dir(dir) { Ok(entries) => entries, Err(e) => { state.issue = Some(format!("部分目录无法读取，本次保留旧索引：{e}")); return; } };
    for entry in entries {
        if state.seen_entries >= 20000 || state.files.len() >= MAX_FILES || state.started.elapsed() > Duration::from_secs(15) {
            state.issue = Some("扫描达到数量或时间限制。请缩小监测文件夹；本次保留旧索引。".into()); break;
        }
        state.seen_entries += 1;
        let entry = match entry { Ok(e) => e, Err(e) => { state.issue = Some(format!("目录项读取失败：{e}")); continue; } };
        let path = entry.path();
        let relative = match path.strip_prefix(root) { Ok(p) => p.to_string_lossy().replace('\\', "/"), Err(_) => continue };
        if !super::is_allowed_path(&relative) { continue; }
        let metadata = match fs::symlink_metadata(&path) { Ok(m) => m, Err(e) => { state.issue = Some(format!("文件信息读取失败：{e}")); continue; } };
        if linked(&metadata) { continue; }
        // Recheck containment after filesystem resolution. Do not follow junctions outside the chosen root.
        match path.canonicalize() {
            Ok(resolved) if resolved.starts_with(root) => {},
            _ => { state.issue = Some("部分路径已移动或无法确认，保留旧索引。".into()); continue; }
        }
        if metadata.is_dir() { walk(root, &path, state); }
        else if metadata.is_file() { state.files.push((path, relative, metadata)); }
    }
}

fn scan(data: &mut Library) {
    let mut docs: HashMap<String, Document> = data.documents.drain(..).map(|d| (d.id.clone(), d)).collect();
    let mut bytes = docs.values().map(|d| d.text.len()).sum::<usize>();
    for root in &mut data.roots {
        if root.paused { continue; }
        let root_path = PathBuf::from(&root.id);
        if !root_path.is_dir() { root.issue = Some("文件夹暂时不可访问，旧索引已保留。请连接磁盘或移除该目录。".into()); continue; }
        let mut traversal = Traversal { files: Vec::new(), seen_entries: 0, issue: None, started: Instant::now() };
        walk(&root_path, &root_path, &mut traversal);
        let seen: HashSet<String> = traversal.files.iter().map(|(_, rel, _)| format!("{}\n{}", root.id, rel)).collect();
        let mut removed = if traversal.issue.is_none() { docs.values().filter(|d| d.root_id == root.id && !seen.contains(&d.id)).cloned().collect::<Vec<_>>() } else { Vec::new() };
        if traversal.issue.is_none() {
            docs.retain(|id, d| {
                let keep = d.root_id != root.id || seen.contains(id);
                if !keep { bytes = bytes.saturating_sub(d.text.len()); }
                keep
            });
        }
        for (path, relative, meta) in traversal.files {
            let id = format!("{}\n{}", root.id, relative);
            let rev = revision(&meta);
            if docs.get(&id).is_some_and(|d| d.revision == rev && d.issue.is_none()) { continue; }
            if !docs.contains_key(&id) && docs.len() >= MAX_FILES {
                traversal.issue = Some("资料索引最多收录 1500 个文件；请移除不需要的监测目录。".into()); continue;
            }
            let mut previous = docs.remove(&id);
            if let Some(old) = &previous { bytes = bytes.saturating_sub(old.text.len()); }
            let result = extract(&path, meta.len()).and_then(|text| {
                let current = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                if linked(&current) || revision(&current) != rev { return Err("文件在读取时发生变化，将在下次扫描重试。".into()); }
                if bytes + text.len() > MAX_INDEX_BYTES { return Err("正文索引总量达到 16 MB；请移除不需要的目录后重新扫描。".into()); }
                Ok(text)
            });
            let (text, issue) = match result { Ok(text) => (text, None), Err(error) => (String::new(), Some(error)) };
            // Preserve metadata on an unambiguous in-folder rename. Identical duplicates
            // deliberately do not inherit each other's classification.
            if previous.is_none() && issue.is_none() && !text.is_empty() {
                let matches = removed.iter().enumerate().filter(|(_, old)| old.revision == rev && old.text == text).map(|(i, _)| i).collect::<Vec<_>>();
                if matches.len() == 1 { previous = Some(removed.remove(matches[0])); }
            }
            let unchanged = previous.as_ref().is_some_and(|d| d.id == id && d.revision == rev && d.text == text && d.issue == issue);
            let document = if unchanged { previous.unwrap() } else {
                let mut document = previous.unwrap_or_default();
                document.id = id.clone(); document.root_id = root.id.clone(); document.path = relative;
                document.revision = rev; document.size = meta.len(); document.updated_at = now();
                document.text = text; document.issue = issue; document.ai_error.clear();
                if document.status != "ignored" && document.analysis_revision != document.revision { document.status = "pending".into(); }
                if document.status.is_empty() { document.status = "pending".into(); }
                document.metadata_version += 1;
                // Preserve confirmed classification and old tips; analysis_revision exposes staleness.
                document
            };
            bytes += document.text.len();
            docs.insert(id, document);
        }
        root.last_scan = Some(now());
        root.issue = traversal.issue;
    }
    data.documents = docs.into_values().collect();
    data.documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.path.cmp(&b.path)));
}

fn check_document(data: &Library, id: &str, expected: &str) -> Result<usize, String> {
    let index = data.documents.iter().position(|d| d.id == id).ok_or("资料已移除，请重新扫描。")?;
    let doc = &data.documents[index];
    let root = data.roots.iter().find(|r| r.id == doc.root_id).ok_or("资料目录已移除。")?;
    let path = source_path(root, doc)?;
    let canonical = path.canonicalize().map_err(|_| "源文件暂时不可访问，请重新扫描。")?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&root.id) || linked(&metadata) || doc.revision != expected || revision(&metadata) != expected {
        return Err("源文件已改变，请重新扫描并重新生成整理建议。".into());
    }
    Ok(index)
}

fn source_path(root: &Root, doc: &Document) -> Result<PathBuf, String> {
    let relative = Path::new(&doc.path);
    if relative.is_absolute() || !relative.components().all(|c| matches!(c, std::path::Component::Normal(_))) || !super::is_allowed_path(&doc.path) {
        return Err("资料路径不在已选择的文件夹内。".into());
    }
    let root_path = Path::new(&root.id);
    let root_meta = fs::symlink_metadata(root_path).map_err(|e| e.to_string())?;
    if linked(&root_meta) { return Err("资料根目录已变为链接，请重新选择目录。".into()); }
    let mut path = root_path.to_path_buf();
    for part in relative.components() {
        path.push(part.as_os_str());
        if linked(&fs::symlink_metadata(&path).map_err(|e| e.to_string())?) { return Err("资料路径含系统链接，已停止操作。".into()); }
    }
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(root_path) { return Err("资料路径已离开所选文件夹。".into()); }
    Ok(resolved)
}

fn normalize_categories(paths: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for path in paths {
        let value = path.split(['/', '>', '\\']).map(str::trim).filter(|s| !s.is_empty()).take(4).collect::<Vec<_>>().join("/");
        if !value.is_empty() && !result.contains(&value) { result.push(value); }
    }
    result
}

fn save_review(data: &mut Library, review: Review) -> Result<(), String> {
    if !["pending", "reviewed", "ignored"].contains(&review.status.as_str()) { return Err("无效的整理状态。".into()); }
    if review.summary.chars().count() > 6000 || review.category.chars().count() > 120 || review.tags.len() > 20 || review.tags.iter().any(|tag| tag.chars().count() > 60) {
        return Err("摘要、分类或标签过长，请缩短后保存。".into());
    }
    let index = check_document(data, &review.id, &review.revision)?;
    let doc = &mut data.documents[index];
    if review.metadata_version.is_some_and(|version| version != doc.metadata_version) { return Err("整理内容已在其他操作中更新，请重新读取后再保存。".into()); }
    let categories = normalize_categories(if review.categories.is_empty() { std::slice::from_ref(&review.category) } else { &review.categories });
    if categories.len() > 12 || categories.iter().any(|s| s.chars().count() > 120) || review.tips.len() > 16 { return Err("分类或知识 tip 超出数量限制。".into()); }
    let analysis_revision = review.analysis_revision.as_deref().unwrap_or(&doc.revision).to_string();
    let unchanged_stale = analysis_revision != doc.revision && analysis_revision == doc.analysis_revision && review.summary == doc.summary && review.tips == doc.tips;
    if analysis_revision != doc.revision && !unchanged_stale { return Err("旧版整理内容已变化，请先重新核对当前原文。".into()); }
    if !unchanged_stale && review.tips.iter().any(|tip| tip.content.trim().is_empty() || tip.content.chars().count() > 1000 || tip.quote.trim().chars().count() < 4 || tip.quote.chars().count() > 500 || !doc.text.contains(tip.quote.trim())) {
        return Err("知识 tip 必须附带能在当前原文中找到的连续引用，请重新生成或修正引用。".into());
    }
    doc.status = review.status;
    if unchanged_stale && doc.status == "reviewed" { doc.status = "pending".into(); }
    doc.summary = review.summary;
    if review.source != "ai" || !doc.classification_locked {
        doc.categories = categories;
        doc.category = doc.categories.first().cloned().unwrap_or_default();
        doc.tags = review.tags.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        doc.tags.sort(); doc.tags.dedup();
    }
    if review.source != "ai" { doc.classification_locked = review.classification_locked.unwrap_or(true); }
    doc.tips = review.tips.into_iter().enumerate().map(|(i, mut tip)| { tip.id = format!("tip-{}", i + 1); tip.quote = tip.quote.trim().into(); tip }).collect();
    doc.analysis_revision = analysis_revision;
    doc.ai_error.clear(); doc.metadata_version += 1;
    Ok(())
}

#[tauri::command]
pub async fn library_save_review(app: tauri::AppHandle, review: Review) -> Result<Library, String> {
    transaction(app, move |data| save_review(data, review)).await
}

fn editable(path: &Path) -> bool {
    matches!(path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase().as_str(), "md" | "markdown" | "txt" | "csv" | "tsv" | "json" | "yaml" | "yml" | "xml" | "html" | "htm")
}

#[derive(Serialize, Deserialize)]
struct SourceBackup { id: String, original: String, replacement: String }

fn backup_path(directory: &Path, id: &str) -> PathBuf {
    let hash = id.as_bytes().iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash ^ *byte as u64).wrapping_mul(0x100000001b3));
    directory.join(format!("{hash:016x}.json"))
}

fn write_source(data: &mut Library, id: &str, expected: &str, content: &str, backups: &Path) -> Result<(), String> {
    let index = check_document(data, id, expected)?;
    let doc = &data.documents[index];
    let root = data.roots.iter().find(|r| r.id == doc.root_id).ok_or("目录已移除。")?;
    let path = source_path(root, doc)?;
    if !editable(&path) || doc.issue.is_some() { return Err("App 内编辑支持已读取的 UTF-8 文本；Word 等格式请使用「打开原文件」。".into()); }
    if content.len() > MAX_TEXT_BYTES as usize || content.contains('\0') { return Err("原文最多 1 MB，且不能包含二进制内容。".into()); }
    let original = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if original.len() > MAX_TEXT_BYTES as usize || original.trim_start_matches('\u{feff}') != doc.text { return Err("原文件内容已改变，请重新扫描再编辑。".into()); }
    let mut replacement = content.trim_start_matches('\u{feff}').to_string();
    if original.contains("\r\n") && !original.replace("\r\n", "").contains('\n') { replacement = replacement.replace("\r\n", "\n").replace('\n', "\r\n"); }
    if original.starts_with('\u{feff}') { replacement.insert(0, '\u{feff}'); }
    if replacement.len() > MAX_TEXT_BYTES as usize { return Err("转换换行后原文超过 1 MB。".into()); }
    if replacement == original { return Ok(()); }
    let indexed_bytes = data.documents.iter().map(|d| d.text.len()).sum::<usize>();
    if indexed_bytes - doc.text.len() + replacement.len() > MAX_INDEX_BYTES { return Err("修改后超出正文索引总量限制，请先移除不需要的目录。".into()); }
    fs::create_dir_all(backups).map_err(|e| e.to_string())?;
    let backup = backup_path(backups, id);
    let temp_backup = backup.with_extension("tmp");
    let mut backup_file = fs::File::create(&temp_backup).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut backup_file, &SourceBackup { id: id.into(), original: original.clone(), replacement: replacement.clone() }).map_err(|e| e.to_string())?;
    backup_file.sync_all().map_err(|e| e.to_string())?; drop(backup_file);
    super::replace_file_atomic(&temp_backup, &backup)?;
    let temporary = path.with_file_name(format!(".knowledge-write-{}-{}.tmp", std::process::id(), now()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(replacement.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?; drop(file);
        check_document(data, id, expected)?;
        if fs::read_to_string(&path).map_err(|e| e.to_string())? != original { return Err("保存前原文件已被其他程序修改，未覆盖。".into()); }
        super::replace_file_atomic(&temporary, &path)?;
        let document = &mut data.documents[index];
        document.text = replacement.trim_start_matches('\u{feff}').into();
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        document.revision = revision(&metadata); document.size = metadata.len(); document.updated_at = now();
        document.status = "pending".into(); document.ai_error.clear(); document.metadata_version += 1;
        Ok(())
    })();
    if temporary.exists() { let _ = fs::remove_file(&temporary); }
    result
}

fn restore_source(data: &mut Library, id: &str, expected: &str, backups: &Path) -> Result<(), String> {
    let index = check_document(data, id, expected)?;
    let backup: SourceBackup = serde_json::from_slice(&fs::read(backup_path(backups, id)).map_err(|_| "这份资料没有可撤销的 App 原文修改。")?).map_err(|e| e.to_string())?;
    if backup.id != id || backup.replacement.trim_start_matches('\u{feff}') != data.documents[index].text { return Err("原文件已在其他操作中改变，不能直接撤销旧修改。".into()); }
    write_source(data, id, expected, &backup.original, backups)
}

#[tauri::command]
pub async fn library_save_source(app: tauri::AppHandle, id: String, revision: String, content: String) -> Result<Library, String> {
    let backups = store_path(&app)?.parent().ok_or("索引目录不存在。")?.join("source-backups");
    transaction(app, move |data| write_source(data, &id, &revision, &content, &backups)).await
}

#[tauri::command]
pub async fn library_restore_source(app: tauri::AppHandle, id: String, revision: String) -> Result<Library, String> {
    let backups = store_path(&app)?.parent().ok_or("索引目录不存在。")?.join("source-backups");
    transaction(app, move |data| restore_source(data, &id, &revision, &backups)).await
}

#[tauri::command]
pub async fn library_open_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        let data = load(&store_path(&app)?)?;
        let doc = data.documents.iter().find(|d| d.id == id).ok_or("资料已移除。")?;
        let root = data.roots.iter().find(|r| r.id == doc.root_id).ok_or("目录已移除。")?;
        let path = source_path(root, doc)?;
        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !editable(&path) && super::mobile_media::mime(&doc.path).is_none() && !["docx", "doc", "pdf", "xlsx", "xls", "pptx", "ppt"].contains(&extension.as_str()) { return Err("此格式请从资源管理器自行打开。".into()); }
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            let display = path.to_string_lossy();
            let ordinary = if let Some(unc) = display.strip_prefix("\\\\?\\UNC\\") { format!("\\\\{unc}") } else { display.trim_start_matches("\\\\?\\").to_string() };
            std::process::Command::new("explorer.exe").arg(ordinary).creation_flags(0x08000000).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))] {
            let command = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
            std::process::Command::new(command).arg(path).spawn().map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_export(app: tauri::AppHandle, id: String, revision: String) -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new().set_title("导出资料卡片（新建 Markdown 文件，不覆盖已有文件）").set_file_name("资料卡片.md").add_filter("Markdown", &["md"]).save_file().await;
    let Some(picked) = picked else { return Ok(None); };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        let data = load(&store_path(&app)?)?;
        let index = check_document(&data, &id, &revision)?;
        let doc = &data.documents[index];
        let root = data.roots.iter().find(|r| r.id == doc.root_id).ok_or("目录不存在。")?;
        let path = picked.path();
        if path.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()) != Some("md".into()) { return Err("请选择 .md 文件名。".into()); }
        let tips = doc.tips.iter().map(|tip| format!("- {}\n\n  > {}\n", tip.content, tip.quote.replace('\n', "\n  > "))).collect::<Vec<_>>().join("\n");
        let stale = !doc.analysis_revision.is_empty() && doc.analysis_revision != doc.revision;
        let content = format!("---\nsummary: {}\ncategories: {}\ntags: {}\n---\n\n# {}\n\n来源：{} / {}\n\n{}\n\n## 摘要\n\n{}\n\n## 知识 tip 与原文引用\n\n{}\n\n> 这是整理卡片，原文件保留原位。\n", serde_json::to_string(&doc.summary).map_err(|e| e.to_string())?, serde_json::to_string(&doc.categories).map_err(|e| e.to_string())?, serde_json::to_string(&doc.tags).map_err(|e| e.to_string())?, doc.path, root.path, doc.path, if stale { "> 原文件已更新，以下整理内容与引用来自旧版本，待重新核对。" } else { "" }, doc.summary, tips);
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| format!("无法新建卡片（同名文件不会覆盖）：{e}"))?;
        file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("knowledge-library-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir_all(&path).unwrap(); Self(path)
        }
        fn library(&self) -> Library { let mut data = Library { version: 1, ..Library::default() }; add_root(&mut data, &self.0).unwrap(); data }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn add_modify_delete_and_preserve_original() {
        let fixture = Fixture::new(); let path = fixture.0.join("日常.txt");
        fs::write(&path, "正文独有的关键词").unwrap(); let mut data = fixture.library(); scan(&mut data);
        assert_eq!(data.documents[0].text, "正文独有的关键词");
        let doc = data.documents[0].clone();
        save_review(&mut data, Review { id: doc.id.clone(), revision: doc.revision.clone(), status: "reviewed".into(), summary: "摘要".into(), category: "学习".into(), tags: vec!["英语".into()], ..Review::default() }).unwrap();
        scan(&mut data); assert_eq!(data.documents[0].status, "reviewed");
        assert_eq!(fs::read_to_string(&path).unwrap(), "正文独有的关键词");
        fs::write(&path, "文件变更后必须重新整理").unwrap(); scan(&mut data);
        assert_eq!(data.documents[0].status, "pending"); assert_eq!(data.documents[0].summary, "摘要"); assert_eq!(data.documents[0].tags, vec!["英语"]); assert_ne!(data.documents[0].analysis_revision, data.documents[0].revision);
        fs::remove_file(path).unwrap(); scan(&mut data); assert!(data.documents.is_empty());
    }
    #[test]
    fn pause_offline_and_stale_review() {
        let fixture = Fixture::new(); let path = fixture.0.join("note.md"); fs::write(&path, "old").unwrap();
        let mut data = fixture.library(); scan(&mut data); let doc = data.documents[0].clone(); data.roots[0].paused = true;
        fs::write(&path, "new content").unwrap(); scan(&mut data); assert_eq!(data.documents[0].text, "old");
        assert!(save_review(&mut data, Review { id: doc.id, revision: doc.revision, status: "reviewed".into(), summary: "old result".into(), category: String::new(), tags: vec![], ..Review::default() }).is_err());
        data.roots[0].paused = false;
        let moved = fixture.0.with_extension("offline"); fs::rename(&fixture.0, &moved).unwrap(); scan(&mut data);
        assert_eq!(data.documents.len(), 1); assert!(data.roots[0].issue.is_some()); fs::rename(moved, &fixture.0).unwrap();
    }
    #[test]
    fn exclusions_formats_limits_and_overlap() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("node_modules")).unwrap(); fs::write(fixture.0.join("node_modules/a.txt"), "skip").unwrap();
        fs::write(fixture.0.join("password.txt"), "skip").unwrap(); fs::write(fixture.0.join(".env"), "skip").unwrap();
        fs::write(fixture.0.join("file.pdf"), b"%PDF").unwrap(); fs::write(fixture.0.join("large.txt"), vec![b'a'; MAX_TEXT_BYTES as usize + 1]).unwrap();
        fs::write(fixture.0.join("bad.txt"), [0xff, 0xfe]).unwrap(); let mut data = fixture.library();
        assert!(add_root(&mut data, &fixture.0.join("node_modules")).is_err()); scan(&mut data);
        assert_eq!(data.documents.len(), 3); assert!(data.documents.iter().all(|d| d.issue.is_some() && d.text.is_empty()));
    }
    #[test]
    fn persistence_and_corruption_do_not_reset() {
        let fixture = Fixture::new(); let path = fixture.0.join("index.json"); let data = fixture.library();
        persist(&path, &data).unwrap(); assert_eq!(load(&path).unwrap().roots.len(), 1);
        fs::write(&path, "broken").unwrap(); assert!(load(&path).is_err()); assert_eq!(fs::read_to_string(path).unwrap(), "broken");
    }
    #[test]
    fn docx_and_text_are_fully_indexed_within_limits() {
        let fixture = Fixture::new();
        let text = format!("{}末尾检索词", "正文".repeat(14000));
        fs::write(fixture.0.join("long.txt"), &text).unwrap();
        let file = fs::File::create(fixture.0.join("word.docx")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>Word正文检索词</w:t></w:r></w:p></w:body></w:document>".as_bytes()).unwrap();
        zip.finish().unwrap();
        let mut data = fixture.library(); scan(&mut data);
        assert_eq!(data.documents.iter().find(|d| d.path == "long.txt").unwrap().text, text);
        assert!(data.documents.iter().find(|d| d.path == "word.docx").unwrap().text.contains("Word正文检索词"));
    }
    #[test]
    fn multiple_roots_stay_independent() {
        let a = Fixture::new(); let b = Fixture::new();
        fs::write(a.0.join("same.txt"), "目录甲").unwrap(); fs::write(b.0.join("same.txt"), "目录乙").unwrap();
        let mut data = a.library(); add_root(&mut data, &b.0).unwrap(); scan(&mut data);
        assert_eq!(data.documents.len(), 2); assert_ne!(data.documents[0].id, data.documents[1].id);
        fs::remove_file(a.0.join("same.txt")).unwrap(); scan(&mut data);
        assert_eq!(data.documents.len(), 1); assert_eq!(data.documents[0].text, "目录乙");
    }

    fn review_for(doc: &Document) -> Review {
        Review { id: doc.id.clone(), revision: doc.revision.clone(), metadata_version: Some(doc.metadata_version), status: "reviewed".into(), summary: "人物需要有清楚的动机".into(), category: "创作/人物".into(), categories: vec!["创作/人物".into(), "学习/叙事".into()], tags: vec!["人物动机".into()], tips: vec![Tip { id: "1".into(), content: "先写人物动机，再写行动".into(), quote: "人物动机决定行动".into() }], ..Review::default() }
    }

    fn mobile_change(doc: &Document, operation: &str) -> MobileChange {
        MobileChange { operation_id: operation.into(), base: Some(MobileBase { revision: doc.revision.clone(), metadata_version: doc.metadata_version }), doc: doc.clone() }
    }

    #[test]
    fn mobile_sync_is_idempotent_and_preserves_source_location() {
        let fixture = Fixture::new(); let path = fixture.0.join("资料.md"); fs::write(&path, "原文").unwrap();
        let backups = Fixture::new();
        let mut data = fixture.library(); scan(&mut data); let original = data.documents[0].clone();
        let operation = "12345678-1234-4234-8234-123456789abc";
        let mut change = mobile_change(&original, operation); change.doc.text = "手机修改的正文".into(); change.doc.categories = vec!["工作/项目".into()]; change.doc.tags = vec!["手机".into()];
        let encoded = serde_json::to_value(&change.doc).unwrap();
        let id = mobile_apply(&mut data, change, &fixture.0, &backups.0).unwrap();
        assert_eq!(id, original.id); assert_eq!(fs::read_to_string(&path).unwrap(), "手机修改的正文"); assert_eq!(data.documents[0].categories, vec!["工作/项目"]);
        let after = data.documents[0].clone();
        let retry = MobileChange { operation_id: operation.into(), base: Some(MobileBase { revision: original.revision.clone(), metadata_version: original.metadata_version }), doc: serde_json::from_value(encoded).unwrap() };
        mobile_apply(&mut data, retry, &fixture.0, &backups.0).unwrap();
        assert_eq!(data.documents[0].metadata_version, after.metadata_version);
        let stale = mobile_change(&original, "12345678-1234-4234-8234-123456789abd");
        assert!(mobile_apply(&mut data, stale, &fixture.0, &backups.0).unwrap_err().starts_with("conflict:"));
        assert_eq!(fs::read_to_string(path).unwrap(), "手机修改的正文");
    }

    #[test]
    fn mobile_sync_validates_before_writing_and_detects_external_changes() {
        let fixture = Fixture::new(); let path = fixture.0.join("资料.md"); fs::write(&path, "原文").unwrap();
        let mut data = fixture.library(); scan(&mut data); let original = data.documents[0].clone();
        let mut change = mobile_change(&original, "12345678-1234-4234-8234-123456789abc"); change.doc.text = "不应写入".into(); change.doc.tags = vec!["x".repeat(61)];
        assert!(mobile_apply(&mut data, change, &fixture.0, &fixture.0.join("backups")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "原文");
        fs::write(&path, "电脑外部修改，必须保留").unwrap();
        assert!(mobile_apply(&mut data, mobile_change(&original, "12345678-1234-4234-8234-123456789abd"), &fixture.0, &fixture.0.join("backups")).unwrap_err().starts_with("conflict:"));
        assert_eq!(fs::read_to_string(path).unwrap(), "电脑外部修改，必须保留");
    }

    #[test]
    fn mobile_new_notes_stay_in_selected_inbox_and_retries_do_not_duplicate() {
        let fixture = Fixture::new(); let mut data = fixture.library();
        let inbox = fixture.0.canonicalize().unwrap();
        let doc = Document { id: "mobile:12345678-1234-4234-8234-123456789abc".into(), path: "../../outside.md".into(), text: "手机新笔记".into(), status: "reviewed".into(), ..Document::default() };
        let make_change = || MobileChange { operation_id: "12345678-1234-4234-8234-123456789abd".into(), base: None, doc: doc.clone() };
        mobile_apply(&mut data, make_change(), &inbox, &fixture.0.join("backups")).unwrap();
        mobile_apply(&mut data, make_change(), &inbox, &fixture.0.join("backups")).unwrap();
        assert_eq!(data.documents.len(), 1); assert_eq!(data.documents[0].text, "手机新笔记");
        assert!(source_path(&data.roots[0], &data.documents[0]).unwrap().starts_with(inbox));
    }

    #[test]
    fn mobile_body_edit_keeps_old_knowledge_marked_stale() {
        let fixture = Fixture::new(); let backups = Fixture::new();
        fs::write(fixture.0.join("note.md"), "人物动机决定行动").unwrap();
        let mut data = fixture.library(); scan(&mut data);
        let review = review_for(&data.documents[0]); save_review(&mut data, review).unwrap();
        let original = data.documents[0].clone();
        let mut change = mobile_change(&original, "12345678-1234-4234-8234-123456789abc");
        change.doc.text = "删除旧段落之后的新正文".into();
        mobile_apply(&mut data, change, &fixture.0, &backups.0).unwrap();
        assert!(data.documents[0].tips == original.tips);
        assert_eq!(data.documents[0].analysis_revision, original.analysis_revision);
        assert_ne!(data.documents[0].analysis_revision, data.documents[0].revision);
        assert_eq!(data.documents[0].status, "pending");
    }

    #[test]
    fn virtual_classification_quotes_and_optimistic_metadata_writes() {
        let fixture = Fixture::new(); let path = fixture.0.join("创作.txt");
        fs::write(&path, "人物动机决定行动，行动推动情节。").unwrap();
        let mut data = fixture.library(); scan(&mut data); let first = data.documents[0].clone();
        let request = review_for(&first); save_review(&mut data, request.clone()).unwrap();
        assert_eq!(data.documents[0].categories.len(), 2);
        assert_eq!(fs::read_to_string(&path).unwrap(), "人物动机决定行动，行动推动情节。");
        assert!(save_review(&mut data, request).is_err(), "stale metadata must not overwrite newer human changes");
        let mut invalid = review_for(&data.documents[0]); invalid.tips[0].quote = "这句话原文不存在".into();
        assert!(save_review(&mut data, invalid).is_err());
        let mut ai = review_for(&data.documents[0]); ai.source = "ai".into(); ai.categories = vec!["AI不同分类".into()]; ai.tags = vec!["AI标签".into()];
        save_review(&mut data, ai).unwrap();
        assert_eq!(data.documents[0].categories, vec!["创作/人物", "学习/叙事"]);
        assert_eq!(data.documents[0].tags, vec!["人物动机"]);
    }

    #[test]
    fn changes_preserve_human_labels_and_mark_old_knowledge_as_stale() {
        let fixture = Fixture::new(); let path = fixture.0.join("创作.txt");
        fs::write(&path, "人物动机决定行动，行动推动情节。").unwrap();
        let mut data = fixture.library(); scan(&mut data);
        let request = review_for(&data.documents[0]); save_review(&mut data, request).unwrap();
        fs::write(&path, "更新后的正文有另一个观点，需要重新整理。").unwrap(); scan(&mut data);
        let doc = data.documents[0].clone(); assert_eq!(doc.status, "pending"); assert_eq!(doc.tags, vec!["人物动机"]); assert_eq!(doc.tips.len(), 1); assert_ne!(doc.analysis_revision, doc.revision);
        let mut metadata_only = review_for(&doc); metadata_only.analysis_revision = Some(doc.analysis_revision.clone()); metadata_only.tips = doc.tips.clone(); metadata_only.categories = vec!["我的新分类".into()];
        save_review(&mut data, metadata_only).unwrap();
        assert_eq!(data.documents[0].status, "pending"); assert_eq!(data.documents[0].categories, vec!["我的新分类"]);
    }

    #[test]
    fn version_one_index_migrates_without_losing_confirmed_labels() {
        let fixture = Fixture::new(); fs::write(fixture.0.join("创作.txt"), "人物动机决定行动").unwrap();
        let mut data = fixture.library(); scan(&mut data); data.documents[0].category = "以前的分类".into(); data.documents[0].summary = "旧摘要".into(); data.documents[0].status = "reviewed".into();
        let mut json = serde_json::to_value(&data).unwrap();
        for key in ["categories", "tips", "analysisRevision", "metadataVersion", "classificationLocked", "aiError"] { json["documents"][0].as_object_mut().unwrap().remove(key); }
        let path = fixture.0.join("old-index.json"); fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
        let migrated = load(&path).unwrap(); assert_eq!(migrated.version, 2); assert_eq!(migrated.documents[0].categories, vec!["以前的分类"]); assert!(migrated.documents[0].classification_locked);
        assert_eq!(migrated.documents[0].analysis_revision, migrated.documents[0].revision);
    }

    #[test]
    fn source_edit_and_undo_preserve_path_encoding_and_classification() {
        let fixture = Fixture::new(); let backup = Fixture::new(); let path = fixture.0.join("创作.txt");
        let original = "\u{feff}人物动机决定行动\r\n下一行\r\n";
        fs::write(&path, original).unwrap(); let mut data = fixture.library(); scan(&mut data);
        let request = review_for(&data.documents[0]); save_review(&mut data, request).unwrap();
        let doc = data.documents[0].clone(); write_source(&mut data, &doc.id, &doc.revision, "新的正文\n下一行\n", &backup.0).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "\u{feff}新的正文\r\n下一行\r\n"); assert_eq!(data.documents[0].tags, vec!["人物动机"]);
        assert!(write_source(&mut data, &doc.id, &doc.revision, "旧版覆盖", &backup.0).is_err());
        let updated = data.documents[0].clone(); restore_source(&mut data, &updated.id, &updated.revision, &backup.0).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn source_writes_reject_path_escape_and_external_edits() {
        let fixture = Fixture::new(); let backup = Fixture::new(); let path = fixture.0.join("note.txt");
        fs::write(&path, "最初的正文").unwrap(); let mut data = fixture.library(); scan(&mut data);
        let doc = data.documents[0].clone(); data.documents[0].path = "../outside.txt".into();
        assert!(write_source(&mut data, &doc.id, &doc.revision, "越界内容", &backup.0).is_err());
        data.documents[0] = doc.clone(); fs::write(&path, "外部编辑器更新过的正文").unwrap();
        assert!(write_source(&mut data, &doc.id, &doc.revision, "覆盖外部编辑", &backup.0).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "外部编辑器更新过的正文");
    }

    #[test]
    fn mobile_media_roundtrip_metadata_retry_and_scope() {
        let fixture = Fixture::new(); let backups = Fixture::new();
        let inbox = fixture.0.canonicalize().unwrap(); let mut data = fixture.library();
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        let incoming = Document { id: "mobile:12345678-1234-4234-8234-123456789abc".into(), path: "photo.png".into(), size: bytes.len() as u64,
            status: "pending".into(), tags: vec!["照片".into()], ..Default::default() };
        let make = || MobileChange { operation_id: "12345678-1234-4234-8234-123456789abd".into(), doc: incoming.clone(), base: None };
        let id = mobile_apply_content(&mut data, make(), &inbox, &backups.0, Some(bytes)).unwrap();
        mobile_apply_content(&mut data, make(), &inbox, &backups.0, Some(bytes)).unwrap();
        assert_eq!(data.documents.len(), 1);
        let doc = mobile_find(&data, &id).unwrap(); assert!(doc.path.ends_with(".png")); assert!(doc.text.is_empty());
        assert_eq!(attachment_bytes(&data, &id, &doc.revision).unwrap().0, bytes);
        assert!(attachment_bytes(&data, "../../outside.png", &doc.revision).is_err());
        assert!(attachment_bytes(&data, &id, "old-revision").is_err());
        let mut review = mobile_change(&doc, "12345678-1234-4234-8234-123456789abe"); review.doc.summary = "仅改摘要".into();
        mobile_apply(&mut data, review, &inbox, &backups.0).unwrap();
        assert_eq!(fs::read(inbox.join(&doc.path)).unwrap(), bytes);
        data.roots[0].paused = true;
        assert!(attachment_bytes(&data, &id, &doc.revision).is_err());
    }

    #[test]
    fn invalid_media_never_creates_a_file() {
        let fixture = Fixture::new(); let backups = Fixture::new();
        let inbox = fixture.0.canonicalize().unwrap(); let mut data = fixture.library();
        let doc = Document { id: "mobile:12345678-1234-4234-8234-123456789abc".into(), path: "photo.png".into(), size: 3, status: "pending".into(), ..Default::default() };
        let change = MobileChange { operation_id: "12345678-1234-4234-8234-123456789abd".into(), doc, base: None };
        assert!(mobile_apply_content(&mut data, change, &inbox, &backups.0, Some(b"bad")).is_err());
        assert_eq!(fs::read_dir(inbox).unwrap().count(), 0);
    }

    #[test]
    fn unambiguous_rename_preserves_virtual_knowledge() {
        let fixture = Fixture::new(); let path = fixture.0.join("before.txt");
        fs::write(&path, "人物动机决定行动").unwrap(); let mut data = fixture.library(); scan(&mut data);
        let request = review_for(&data.documents[0]); save_review(&mut data, request).unwrap();
        fs::rename(path, fixture.0.join("after.txt")).unwrap(); scan(&mut data);
        assert_eq!(data.documents.len(), 1); assert_eq!(data.documents[0].path, "after.txt"); assert_eq!(data.documents[0].status, "reviewed"); assert_eq!(data.documents[0].tips.len(), 1);
    }

    #[test]
    #[cfg(windows)]
    fn separate_app_instances_cannot_write_the_index_concurrently() {
        let fixture = Fixture::new(); let path = fixture.0.join("index.json");
        let first = acquire_store(&path).unwrap(); assert!(acquire_store(&path).is_err());
        drop(first); assert!(acquire_store(&path).is_ok());
    }
}
