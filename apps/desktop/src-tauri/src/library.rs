//! Local, read-only document inbox. Originals are never written by this module.
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
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    id: String,
    path: String,
    paused: bool,
    last_scan: Option<u64>,
    issue: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
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
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    id: String,
    revision: String,
    status: String,
    summary: String,
    category: String,
    tags: Vec<String>,
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("document-library");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("index-v1.json"))
}

fn load(path: &Path) -> Result<Library, String> {
    if !path.exists() { return Ok(Library { version: 1, ..Library::default() }); }
    let file = fs::File::open(path).map_err(|e| format!("无法读取资料索引：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
        return Err("资料索引超过读取限制，请先备份检查；原索引未被覆盖。".into());
    }
    let data: Library = serde_json::from_reader(file).map_err(|e| format!("资料索引损坏，请先备份检查；原索引未被覆盖：{e}"))?;
    if data.version != 1 { return Err("资料索引版本不兼容，请更新 App。".into()); }
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

async fn transaction<F>(app: tauri::AppHandle, change: F) -> Result<Library, String>
where F: FnOnce(&mut Library) -> Result<(), String> + Send + 'static {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|_| "资料索引正处于错误状态，请重启 App。".to_string())?;
        let path = store_path(&app)?;
        let mut data = load(&path)?;
        change(&mut data)?;
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
    let picked = rfd::AsyncFileDialog::new().set_title("选择要监测的资料文件夹（仅读取）").pick_folder().await;
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
            let previous = docs.remove(&id);
            if let Some(old) = &previous { bytes = bytes.saturating_sub(old.text.len()); }
            let result = extract(&path, meta.len()).and_then(|text| {
                let current = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                if linked(&current) || revision(&current) != rev { return Err("文件在读取时发生变化，将在下次扫描重试。".into()); }
                if bytes + text.len() > MAX_INDEX_BYTES { return Err("正文索引总量达到 16 MB；请移除不需要的目录后重新扫描。".into()); }
                Ok(text)
            });
            let (text, issue) = match result { Ok(text) => (text, None), Err(error) => (String::new(), Some(error)) };
            let unchanged = previous.as_ref().is_some_and(|d| d.revision == rev && d.text == text && d.issue == issue);
            let document = if unchanged { previous.unwrap() } else {
                Document { id: id.clone(), root_id: root.id.clone(), path: relative, revision: rev, size: meta.len(), updated_at: now(), text, issue, status: "pending".into(), summary: String::new(), category: String::new(), tags: Vec::new() }
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
    let path = Path::new(&root.id).join(&doc.path);
    let canonical = path.canonicalize().map_err(|_| "源文件暂时不可访问，请重新扫描。")?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&root.id) || linked(&metadata) || doc.revision != expected || revision(&metadata) != expected {
        return Err("源文件已改变，请重新扫描并重新生成整理建议。".into());
    }
    Ok(index)
}

fn save_review(data: &mut Library, review: Review) -> Result<(), String> {
    if !["pending", "reviewed", "ignored"].contains(&review.status.as_str()) { return Err("无效的整理状态。".into()); }
    if review.summary.chars().count() > 6000 || review.category.chars().count() > 100 || review.tags.len() > 20 || review.tags.iter().any(|tag| tag.chars().count() > 60) {
        return Err("摘要、分类或标签过长，请缩短后保存。".into());
    }
    let index = check_document(data, &review.id, &review.revision)?;
    let doc = &mut data.documents[index];
    doc.status = review.status;
    doc.summary = review.summary;
    doc.category = review.category;
    doc.tags = review.tags;
    Ok(())
}

#[tauri::command]
pub async fn library_save_review(app: tauri::AppHandle, review: Review) -> Result<Library, String> {
    transaction(app, move |data| save_review(data, review)).await
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
        let content = format!("---\nsummary: {}\ncategory: {}\ntags: {}\n---\n\n# {}\n\n来源：{} / {}\n\n## 摘要\n\n{}\n\n> 这是整理卡片，原文件保留原位。\n", serde_json::to_string(&doc.summary).map_err(|e| e.to_string())?, serde_json::to_string(&doc.category).map_err(|e| e.to_string())?, serde_json::to_string(&doc.tags).map_err(|e| e.to_string())?, doc.path, root.path, doc.path, doc.summary);
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
        save_review(&mut data, Review { id: doc.id.clone(), revision: doc.revision.clone(), status: "reviewed".into(), summary: "摘要".into(), category: "学习".into(), tags: vec!["英语".into()] }).unwrap();
        scan(&mut data); assert_eq!(data.documents[0].status, "reviewed");
        assert_eq!(fs::read_to_string(&path).unwrap(), "正文独有的关键词");
        fs::write(&path, "文件变更后必须重新整理").unwrap(); scan(&mut data);
        assert_eq!(data.documents[0].status, "pending"); assert!(data.documents[0].summary.is_empty());
        fs::remove_file(path).unwrap(); scan(&mut data); assert!(data.documents.is_empty());
    }
    #[test]
    fn pause_offline_and_stale_review() {
        let fixture = Fixture::new(); let path = fixture.0.join("note.md"); fs::write(&path, "old").unwrap();
        let mut data = fixture.library(); scan(&mut data); let doc = data.documents[0].clone(); data.roots[0].paused = true;
        fs::write(&path, "new content").unwrap(); scan(&mut data); assert_eq!(data.documents[0].text, "old");
        assert!(save_review(&mut data, Review { id: doc.id, revision: doc.revision, status: "reviewed".into(), summary: "old result".into(), category: String::new(), tags: vec![] }).is_err());
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
}
