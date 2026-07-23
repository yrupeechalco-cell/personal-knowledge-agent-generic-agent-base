use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use quick_xml::{events::Event as XmlEvent, Reader as XmlReader};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};
use zip::{write::SimpleFileOptions, ZipWriter};

const TRASH_DIR: &str = ".knowledge-agent-trash";
const TRASH_FILES_DIR: &str = "files";
const TRASH_INDEX_FILE: &str = "index.json";
const CANVAS_DIR: &str = ".knowledge-agent";
const CANVAS_FILE: &str = "canvas.json";
const TRASH_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const MAX_READ_ONLY_STRUCTURE_ENTRIES: usize = 900;
const MAX_READ_ONLY_DIRECTORY_ENTRIES: usize = 1_000;
const MAX_READ_ONLY_PREVIEW_BYTES: u64 = 1_048_576;
const MAX_CANVAS_BYTES: usize = 5 * 1_048_576;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteFile {
    path: String,
    content: String,
    modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadOnlyStructureScan {
    files: Vec<NoteFile>,
    folder_count: usize,
    file_count: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageRoot {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadOnlyDirectoryEntry {
    name: String,
    path: String,
    kind: String,
    extension: Option<String>,
    size: Option<u64>,
    modified_at_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadOnlyDirectoryListing {
    root: String,
    path: String,
    entries: Vec<ReadOnlyDirectoryEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadOnlyFilePreview {
    root: String,
    path: String,
    name: String,
    preview_kind: String,
    content: Option<String>,
    message: Option<String>,
    size: u64,
    modified_at_ms: Option<u64>,
}

#[derive(Clone)]
struct StructureEntry {
    path: String,
    is_directory: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashEntry {
    id: String,
    original_path: String,
    trash_path: String,
    deleted_at_ms: u64,
    purge_after_ms: u64,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashIndex {
    entries: Vec<TrashEntry>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    vault_path: Option<String>,
    github_repo: Option<String>,
    model_provider: Option<String>,
    model: Option<String>,
    agent_mode: Option<String>,
    deep_seek_api_key_configured: Option<bool>,
    deep_seek_api_key_updated_at_ms: Option<u64>,
    deep_seek_api_key_status: Option<String>,
    deep_seek_api_key_validated_at_ms: Option<u64>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSecrets {
    deep_seek_api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSettings {
    provider: String,
    model: String,
    agent_mode: String,
    deep_seek_api_key_configured: bool,
    deep_seek_api_key_storage: String,
    deep_seek_api_key_updated_at_ms: Option<u64>,
    deep_seek_api_key_status: String,
    deep_seek_api_key_validated_at_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathMove {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashEntryPreview {
    id: String,
    original_path: String,
    trash_path: String,
    content: String,
    size: u64,
    truncated: bool,
    deleted_at_ms: u64,
    purge_after_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMessage {
    role: String,
    content: String,
    tool_call_id: Option<String>,
    tool_calls: Option<Vec<ModelToolCall>>,
    reasoning_content: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRequest {
    system: String,
    messages: Vec<ModelMessage>,
    model: Option<String>,
    thinking: Option<bool>,
    reasoning_effort: Option<String>,
    tools: Option<Vec<ModelToolDefinition>>,
}

#[derive(Deserialize)]
struct ModelToolDefinition {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Deserialize)]
struct DeepSeekResponse {
    choices: Option<Vec<DeepSeekChoice>>,
}

#[derive(Deserialize)]
struct DeepSeekChoice {
    message: Option<DeepSeekMessage>,
}

#[derive(Deserialize)]
struct DeepSeekMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
    tool_calls: Option<Vec<DeepSeekToolCall>>,
}

#[derive(Deserialize)]
struct DeepSeekToolCall {
    id: String,
    function: DeepSeekFunctionCall,
}

#[derive(Deserialize)]
struct DeepSeekFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelTurnResponse {
    content: String,
    reasoning_content: Option<String>,
    tool_calls: Vec<ModelToolCall>,
}

#[derive(Deserialize, Serialize)]
struct ModelToolCall {
    id: String,
    name: String,
    arguments: String,
}

struct VaultWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChangedPayload {
    root: String,
    paths: Vec<String>,
}

#[tauri::command]
fn select_vault_dir() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择知识库文件夹")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn select_read_only_structure_dir() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择要读取结构的磁盘或文件夹（只读）")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn list_storage_roots() -> Vec<StorageRoot> {
    available_storage_roots()
}

#[tauri::command]
fn list_directory_read_only(
    root: String,
    path: String,
) -> Result<ReadOnlyDirectoryListing, String> {
    list_directory_read_only_at(Path::new(&root), &path)
}

#[tauri::command]
fn read_file_preview_read_only(root: String, path: String) -> Result<ReadOnlyFilePreview, String> {
    read_file_preview_read_only_at(Path::new(&root), &path)
}

#[tauri::command]
fn start_vault_watcher(
    app: tauri::AppHandle,
    state: State<'_, VaultWatcherState>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    ensure_existing_dir(&root_path)?;
    let canonical_root = root_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let emit_root = root_path.to_string_lossy().to_string();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };
            if !is_relevant_watch_event(&event.kind) {
                return;
            }

            let paths = event
                .paths
                .iter()
                .filter_map(|path| watched_relative_path(&canonical_root, path))
                .collect::<Vec<_>>();

            if paths.is_empty() {
                return;
            }

            let _ = app_handle.emit(
                "vault-changed",
                VaultChangedPayload {
                    root: emit_root.clone(),
                    paths,
                },
            );
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    let mut current = state.watcher.lock().map_err(|error| error.to_string())?;
    *current = Some(watcher);
    Ok(())
}

#[tauri::command]
fn stop_vault_watcher(state: State<'_, VaultWatcherState>) -> Result<(), String> {
    let mut current = state.watcher.lock().map_err(|error| error.to_string())?;
    *current = None;
    Ok(())
}

#[tauri::command]
fn create_vault_dir(name: String) -> Result<Option<String>, String> {
    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择新知识库文件夹的位置")
        .pick_folder()
    else {
        return Ok(None);
    };

    let created = create_vault_dir_at(&parent, &name)?;
    Ok(Some(created.to_string_lossy().to_string()))
}

#[tauri::command]
fn create_interlinked_demo_vault(
    parent: String,
    folder_name: String,
    count: u32,
) -> Result<String, String> {
    let parent_path = PathBuf::from(parent);
    ensure_existing_dir(&parent_path)?;
    let note_count = usize::try_from(count).map_err(|_| "invalid note count".to_string())?;
    if !(1..=200).contains(&note_count) {
        return Err("note count must be between 1 and 200".to_string());
    }
    let root = create_unique_vault_dir_at(&parent_path, &folder_name)?;
    write_interlinked_demo_notes(&root, note_count)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn create_word_document_on_desktop(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| error.to_string())?;
    ensure_existing_dir(&desktop)?;
    let path = unique_word_document_path(&desktop, &name)?;
    write_minimal_docx(&path, &document_title_from_path(&path)?)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_vault_notes(root: String) -> Result<Vec<NoteFile>, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    purge_expired_trash(&root_path)?;
    let mut files = Vec::new();
    collect_markdown_files(&root_path, &root_path, &mut files)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

#[tauri::command]
fn load_canvas_document(root: String) -> Result<Option<serde_json::Value>, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    let canvas_path = root_path.join(CANVAS_DIR).join(CANVAS_FILE);
    if !canvas_path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&canvas_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_CANVAS_BYTES as u64 {
        return Err("canvas document is larger than the 5 MiB safety limit".to_string());
    }
    let text = fs::read_to_string(canvas_path).map_err(|error| error.to_string())?;
    let value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
fn save_canvas_document(root: String, document: serde_json::Value) -> Result<(), String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    let text = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    if text.len() > MAX_CANVAS_BYTES {
        return Err("canvas document is larger than the 5 MiB safety limit".to_string());
    }
    let canvas_dir = root_path.join(CANVAS_DIR);
    fs::create_dir_all(&canvas_dir).map_err(|error| error.to_string())?;
    fs::write(canvas_dir.join(CANVAS_FILE), text).map_err(|error| error.to_string())
}

#[tauri::command]
fn scan_directory_structure_read_only(root: String) -> Result<ReadOnlyStructureScan, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;

    let mut entries = Vec::new();
    let mut truncated = false;
    collect_read_only_structure(&root_path, &root_path, &mut entries, &mut truncated)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));

    let folder_count = entries.iter().filter(|entry| entry.is_directory).count();
    let file_count = entries.len().saturating_sub(folder_count);
    Ok(ReadOnlyStructureScan {
        files: structure_entries_as_notes(&entries),
        folder_count,
        file_count,
        truncated,
    })
}

#[tauri::command]
fn list_trash_entries(root: String) -> Result<Vec<TrashEntry>, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    purge_expired_trash(&root_path)?;
    Ok(load_trash_index(&root_path)?.entries)
}

#[tauri::command]
fn preview_trash_entry(root: String, id: String) -> Result<TrashEntryPreview, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    purge_expired_trash(&root_path)?;
    let index = load_trash_index(&root_path)?;
    let entry = index
        .entries
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "trash entry not found or already purged".to_string())?;
    let full_path = safe_internal_join(&root_path, &entry.trash_path)?;
    let metadata = fs::metadata(&full_path).map_err(|error| error.to_string())?;
    let (content, truncated) = read_utf8_preview(&full_path, MAX_READ_ONLY_PREVIEW_BYTES as usize)?;
    Ok(TrashEntryPreview {
        id: entry.id,
        original_path: entry.original_path,
        trash_path: entry.trash_path,
        content,
        size: metadata.len(),
        truncated,
        deleted_at_ms: entry.deleted_at_ms,
        purge_after_ms: entry.purge_after_ms,
    })
}

fn read_utf8_preview(path: &Path, max_bytes: usize) -> Result<(String, bool), String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut buffer)
        .map_err(|error| error.to_string())?;
    let truncated = buffer.len() > max_bytes;
    if truncated {
        buffer.truncate(max_bytes);
    }
    Ok((String::from_utf8_lossy(&buffer).into_owned(), truncated))
}

#[tauri::command]
fn save_note(root: String, path: String, content: String) -> Result<(), String> {
    ensure_allowed_path(&path)?;
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    let full_path = safe_join(&root_path, &path)?;
    if full_path.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("only markdown notes can be saved".to_string());
    }
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(full_path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn move_notes_atomic(root: String, moves: Vec<PathMove>) -> Result<(), String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    move_notes_atomic_in_root(&root_path, moves)
}

#[tauri::command]
fn delete_note(root: String, path: String) -> Result<(), String> {
    ensure_allowed_path(&path)?;
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    purge_expired_trash(&root_path)?;
    let full_path = safe_join(&root_path, &path)?;
    if full_path.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("only markdown notes can be deleted".to_string());
    }
    if full_path.exists() {
        move_note_to_trash(&root_path, &path, &full_path)?;
    }
    Ok(())
}

#[tauri::command]
fn restore_trash_entry(root: String, id: String) -> Result<(), String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    purge_expired_trash(&root_path)?;
    restore_trash_entry_by_id(&root_path, &id)
}

#[tauri::command]
fn git_status(root: String) -> Result<String, String> {
    run_git(&root, &["status", "--short"])
}

#[tauri::command]
fn git_commit(root: String, paths: Vec<String>, message: String) -> Result<String, String> {
    ensure_existing_dir(Path::new(&root))?;
    for path in &paths {
        ensure_allowed_path(path)?;
    }
    let mut add_args = vec!["add"];
    add_args.extend(paths.iter().map(String::as_str));
    run_git(&root, &add_args)?;
    run_git(&root, &["commit", "-m", &message])
}

#[tauri::command]
fn git_push(root: String) -> Result<String, String> {
    run_git(&root, &["push"])
}

#[tauri::command]
fn load_app_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    parse_json_document(&text)
}

#[tauri::command]
fn save_app_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let existing = load_app_settings(app.clone()).unwrap_or_default();
    let merged = AppSettings {
        vault_path: settings.vault_path.or(existing.vault_path),
        github_repo: settings.github_repo.or(existing.github_repo),
        model_provider: settings.model_provider.or(existing.model_provider),
        model: settings.model.or(existing.model),
        agent_mode: settings.agent_mode.or(existing.agent_mode),
        deep_seek_api_key_configured: settings
            .deep_seek_api_key_configured
            .or(existing.deep_seek_api_key_configured),
        deep_seek_api_key_updated_at_ms: settings
            .deep_seek_api_key_updated_at_ms
            .or(existing.deep_seek_api_key_updated_at_ms),
        deep_seek_api_key_status: settings
            .deep_seek_api_key_status
            .or(existing.deep_seek_api_key_status),
        deep_seek_api_key_validated_at_ms: settings
            .deep_seek_api_key_validated_at_ms
            .or(existing.deep_seek_api_key_validated_at_ms),
    };
    write_app_settings(&app, &merged)
}

#[tauri::command]
fn load_model_settings(app: tauri::AppHandle) -> Result<ModelSettings, String> {
    let settings = load_app_settings(app.clone()).unwrap_or_default();
    let credential = deepseek_credential_info(&app)?;
    Ok(ModelSettings {
        provider: settings
            .model_provider
            .unwrap_or_else(|| "deepseek".to_string()),
        model: normalize_model_name(settings.model),
        agent_mode: normalize_agent_mode(settings.agent_mode),
        deep_seek_api_key_configured: credential.configured,
        deep_seek_api_key_storage: credential.storage,
        deep_seek_api_key_updated_at_ms: settings.deep_seek_api_key_updated_at_ms,
        deep_seek_api_key_status: normalize_credential_status(
            settings.deep_seek_api_key_status,
            credential.configured,
        ),
        deep_seek_api_key_validated_at_ms: settings.deep_seek_api_key_validated_at_ms,
    })
}

#[tauri::command]
fn save_model_settings(
    app: tauri::AppHandle,
    provider: String,
    model: String,
    agent_mode: String,
) -> Result<ModelSettings, String> {
    let mut settings = load_app_settings(app.clone()).unwrap_or_default();
    settings.model_provider = Some(if provider.trim().is_empty() {
        "deepseek".to_string()
    } else {
        provider
    });
    settings.model = Some(normalize_model_name(Some(model)));
    settings.agent_mode = Some(normalize_agent_mode(Some(agent_mode)));
    save_app_settings(app.clone(), settings)?;
    load_model_settings(app)
}

#[tauri::command]
fn save_deepseek_api_key(app: tauri::AppHandle, api_key: String) -> Result<ModelSettings, String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("DeepSeek API key cannot be empty".to_string());
    }
    save_protected_deepseek_api_key(&app, trimmed)?;
    let mut settings = load_app_settings(app.clone()).unwrap_or_default();
    settings.model_provider = Some("deepseek".to_string());
    settings.deep_seek_api_key_configured = Some(true);
    settings.deep_seek_api_key_updated_at_ms = Some(now_ms()?);
    settings.deep_seek_api_key_status = Some("unchecked".to_string());
    settings.deep_seek_api_key_validated_at_ms = None;
    write_app_settings(&app, &settings)?;
    load_model_settings(app)
}

#[tauri::command]
fn delete_deepseek_api_key(app: tauri::AppHandle) -> Result<ModelSettings, String> {
    for path in [protected_secrets_path(&app)?, legacy_secrets_path(&app)?] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    let mut settings = load_app_settings(app.clone()).unwrap_or_default();
    settings.deep_seek_api_key_configured = Some(false);
    settings.deep_seek_api_key_updated_at_ms = None;
    settings.deep_seek_api_key_status = Some("unchecked".to_string());
    settings.deep_seek_api_key_validated_at_ms = None;
    write_app_settings(&app, &settings)?;
    load_model_settings(app)
}

#[tauri::command]
async fn validate_deepseek_api_key(app: tauri::AppHandle) -> Result<ModelSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api_key = load_deepseek_api_key(&app)?
            .ok_or_else(|| "DeepSeek API key is not configured".to_string())?;
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?
            .get("https://api.deepseek.com/models")
            .bearer_auth(api_key)
            .send()
            .map_err(|error| format!("API key validation request failed: {error}"))?;
        let status = if response.status().is_success() {
            "valid".to_string()
        } else if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            "invalid".to_string()
        } else {
            return Err(format!(
                "API key validation service returned HTTP {}",
                response.status()
            ));
        };
        let mut persisted = load_app_settings(app.clone()).unwrap_or_default();
        persisted.deep_seek_api_key_status = Some(status);
        persisted.deep_seek_api_key_validated_at_ms = Some(now_ms()?);
        write_app_settings(&app, &persisted)?;
        load_model_settings(app)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn deepseek_chat_completion(
    app: tauri::AppHandle,
    request: ModelRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || deepseek_chat_completion_blocking(app, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn deepseek_tool_completion(
    app: tauri::AppHandle,
    request: ModelRequest,
) -> Result<ModelTurnResponse, String> {
    tauri::async_runtime::spawn_blocking(move || deepseek_tool_completion_blocking(app, request))
        .await
        .map_err(|error| error.to_string())?
}

fn deepseek_tool_completion_blocking(
    app: tauri::AppHandle,
    request: ModelRequest,
) -> Result<ModelTurnResponse, String> {
    let api_key = load_deepseek_api_key(&app)?
        .ok_or_else(|| "DeepSeek API key is not configured".to_string())?;
    let settings = load_app_settings(app.clone()).unwrap_or_default();
    let messages = std::iter::once(json!({
        "role": "system",
        "content": request.system
    }))
    .chain(request.messages.into_iter().map(model_message_json))
    .collect::<Vec<_>>();
    let tools = request
        .tools
        .unwrap_or_default()
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            })
        })
        .collect::<Vec<_>>();

    let mut body = json!({
        "model": normalize_model_name(request.model.or(settings.model)),
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.2,
        "stream": false
    });

    if request.thinking.unwrap_or(true) {
        body["thinking"] = json!({ "type": "enabled" });
        body["reasoning_effort"] = json!(request
            .reasoning_effort
            .unwrap_or_else(|| "high".to_string()));
    }

    let response = reqwest::blocking::Client::new()
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("DeepSeek request failed: {status} {text}"));
    }
    let data: DeepSeekResponse = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let message = data
        .choices
        .and_then(|mut choices| choices.pop())
        .and_then(|choice| choice.message)
        .ok_or_else(|| "DeepSeek returned no message".to_string())?;

    Ok(ModelTurnResponse {
        content: message.content.unwrap_or_default(),
        reasoning_content: message.reasoning_content,
        tool_calls: message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|call| ModelToolCall {
                id: call.id,
                name: call.function.name,
                arguments: call.function.arguments,
            })
            .collect(),
    })
}

fn model_message_json(message: ModelMessage) -> serde_json::Value {
    let mut value = json!({
        "role": normalize_model_role(&message.role),
        "content": message.content
    });
    if let Some(tool_call_id) = message.tool_call_id {
        value["tool_call_id"] = json!(tool_call_id);
    }
    if let Some(tool_calls) = message.tool_calls {
        value["tool_calls"] = json!(tool_calls
            .into_iter()
            .map(|call| json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": call.arguments
                }
            }))
            .collect::<Vec<_>>());
    }
    if let Some(reasoning_content) = message.reasoning_content {
        value["reasoning_content"] = json!(reasoning_content);
    }
    value
}

fn deepseek_chat_completion_blocking(
    app: tauri::AppHandle,
    request: ModelRequest,
) -> Result<String, String> {
    let api_key = load_deepseek_api_key(&app)?
        .ok_or_else(|| "DeepSeek API key is not configured".to_string())?;
    let settings = load_app_settings(app.clone()).unwrap_or_default();
    let messages = std::iter::once(json!({
        "role": "system",
        "content": request.system
    }))
    .chain(request.messages.into_iter().map(|message| {
        json!({
            "role": normalize_model_role(&message.role),
            "content": message.content
        })
    }))
    .collect::<Vec<_>>();

    let mut body = json!({
        "model": normalize_model_name(request.model.or(settings.model)),
        "messages": messages,
        "temperature": 0.2,
        "stream": false
    });

    if request.thinking.unwrap_or(true) {
        body["thinking"] = json!({ "type": "enabled" });
        body["reasoning_effort"] = json!(request
            .reasoning_effort
            .unwrap_or_else(|| "high".to_string()));
    }

    let response = reqwest::blocking::Client::new()
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("DeepSeek request failed: {status} {text}"));
    }
    let data: DeepSeekResponse = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(data
        .choices
        .and_then(|mut choices| choices.pop())
        .and_then(|choice| choice.message)
        .and_then(|message| message.content)
        .unwrap_or_default())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(VaultWatcherState {
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            select_vault_dir,
            select_read_only_structure_dir,
            list_storage_roots,
            list_directory_read_only,
            read_file_preview_read_only,
            create_vault_dir,
            create_interlinked_demo_vault,
            create_word_document_on_desktop,
            start_vault_watcher,
            stop_vault_watcher,
            load_vault_notes,
            load_canvas_document,
            save_canvas_document,
            scan_directory_structure_read_only,
            list_trash_entries,
            preview_trash_entry,
            save_note,
            move_notes_atomic,
            delete_note,
            restore_trash_entry,
            git_status,
            git_commit,
            git_push,
            load_app_settings,
            save_app_settings,
            load_model_settings,
            save_model_settings,
            save_deepseek_api_key,
            delete_deepseek_api_key,
            validate_deepseek_api_key,
            deepseek_chat_completion,
            deepseek_tool_completion
        ])
        .run(tauri::generate_context!())
        .expect("error while running knowledge agent desktop");
}

fn collect_markdown_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<NoteFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if !is_allowed_path(&relative) {
            continue;
        }
        if path.is_dir() {
            collect_markdown_files(root, &path, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("md") {
            let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(|time| format!("{time:?}"));
            files.push(NoteFile {
                path: relative,
                content,
                modified_at,
            });
        }
    }
    Ok(())
}

// This scanner intentionally never opens a source file. It only enumerates names,
// relative paths, and directory/file types so the UI can render a structure graph.
fn collect_read_only_structure(
    root: &Path,
    current: &Path,
    entries: &mut Vec<StructureEntry>,
    truncated: &mut bool,
) -> Result<(), String> {
    let directory = match fs::read_dir(current) {
        Ok(directory) => directory,
        Err(_) => return Ok(()),
    };

    for entry in directory {
        if entries.len() >= MAX_READ_ONLY_STRUCTURE_ENTRIES {
            *truncated = true;
            return Ok(());
        }
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if relative.is_empty() {
            continue;
        }

        let is_directory = file_type.is_dir();
        entries.push(StructureEntry {
            path: relative,
            is_directory,
        });
        if is_directory {
            collect_read_only_structure(root, &path, entries, truncated)?;
            if *truncated {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn available_storage_roots() -> Vec<StorageRoot> {
    #[cfg(windows)]
    {
        (b'A'..=b'Z')
            .filter_map(|letter| {
                let path = format!("{}:\\", letter as char);
                Path::new(&path).is_dir().then(|| StorageRoot {
                    name: format!("本地磁盘 ({}:)", letter as char),
                    path,
                })
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![StorageRoot {
            name: "文件系统".to_string(),
            path: "/".to_string(),
        }]
    }
}

fn list_directory_read_only_at(
    root: &Path,
    relative: &str,
) -> Result<ReadOnlyDirectoryListing, String> {
    let directory_path = resolve_read_only_path(root, relative)?;
    if !directory_path.is_dir() {
        return Err("the requested read-only path is not a directory".to_string());
    }

    let mut entries = Vec::new();
    let mut truncated = false;
    let directory = fs::read_dir(&directory_path).map_err(|error| error.to_string())?;
    for item in directory {
        if entries.len() >= MAX_READ_ONLY_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(item) = item else { continue };
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let metadata = item.metadata().ok();
        let name = item.file_name().to_string_lossy().to_string();
        let item_relative = if relative.trim().is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative.trim_matches(&['/', '\\'][..]), name)
        };
        let kind = if file_type.is_dir() {
            "directory"
        } else if file_type.is_file() {
            "file"
        } else if file_type.is_symlink() {
            "symlink"
        } else {
            "other"
        };
        entries.push(ReadOnlyDirectoryEntry {
            name,
            path: item_relative.replace('\\', "/"),
            kind: kind.to_string(),
            extension: item
                .path()
                .extension()
                .map(|value| value.to_string_lossy().to_lowercase()),
            size: metadata
                .as_ref()
                .filter(|_| file_type.is_file())
                .map(|value| value.len()),
            modified_at_ms: metadata.and_then(|value| modified_time_ms(&value)),
        });
    }
    entries.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(ReadOnlyDirectoryListing {
        root: root.to_string_lossy().to_string(),
        path: relative.trim_matches(&['/', '\\'][..]).replace('\\', "/"),
        entries,
        truncated,
    })
}

fn read_file_preview_read_only_at(
    root: &Path,
    relative: &str,
) -> Result<ReadOnlyFilePreview, String> {
    let file_path = resolve_read_only_path(root, relative)?;
    if !file_path.is_file() {
        return Err("the requested read-only path is not a regular file".to_string());
    }
    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    let size = metadata.len();
    let name = file_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| relative.to_string());
    let extension = file_path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let modified_at_ms = modified_time_ms(&metadata);

    if size > MAX_READ_ONLY_PREVIEW_BYTES {
        return Ok(ReadOnlyFilePreview {
            root: root.to_string_lossy().to_string(),
            path: relative.replace('\\', "/"),
            name,
            preview_kind: "too-large".to_string(),
            content: None,
            message: Some("文件超过 1 MB，只显示结构和元数据，未加载正文。".to_string()),
            size,
            modified_at_ms,
        });
    }

    if extension == "docx" {
        let content = read_docx_text(&file_path)?;
        return Ok(ReadOnlyFilePreview {
            root: root.to_string_lossy().to_string(),
            path: relative.replace('\\', "/"),
            name,
            preview_kind: "docx".to_string(),
            content: Some(content),
            message: None,
            size,
            modified_at_ms,
        });
    }

    if !is_text_preview_extension(&extension) {
        return Ok(ReadOnlyFilePreview {
            root: root.to_string_lossy().to_string(),
            path: relative.replace('\\', "/"),
            name,
            preview_kind: "unsupported".to_string(),
            content: None,
            message: Some("当前版本只读预览文本、Markdown、常见代码/数据文件和 Word .docx；该文件仅显示元数据。".to_string()),
            size,
            modified_at_ms,
        });
    }

    let bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
    if bytes.iter().take(8_192).any(|byte| *byte == 0) {
        return Ok(ReadOnlyFilePreview {
            root: root.to_string_lossy().to_string(),
            path: relative.replace('\\', "/"),
            name,
            preview_kind: "unsupported".to_string(),
            content: None,
            message: Some("检测到二进制内容，因此未把文件作为文本打开。".to_string()),
            size,
            modified_at_ms,
        });
    }
    Ok(ReadOnlyFilePreview {
        root: root.to_string_lossy().to_string(),
        path: relative.replace('\\', "/"),
        name,
        preview_kind: "text".to_string(),
        content: Some(String::from_utf8_lossy(&bytes).to_string()),
        message: None,
        size,
        modified_at_ms,
    })
}

fn resolve_read_only_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_existing_dir(root)?;
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let normalized = relative.trim_matches(&['/', '\\'][..]);
    if !normalized.is_empty() {
        ensure_safe_relative(normalized)?;
    }
    let candidate = if normalized.is_empty() {
        canonical_root.clone()
    } else {
        canonical_root
            .join(normalized)
            .canonicalize()
            .map_err(|error| error.to_string())?
    };
    if !candidate.starts_with(&canonical_root) {
        return Err("read-only path escapes the selected storage root".to_string());
    }
    Ok(candidate)
}

fn modified_time_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn is_text_preview_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "jsonl"
            | "yaml"
            | "yml"
            | "toml"
            | "csv"
            | "tsv"
            | "log"
            | "xml"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "cs"
            | "sh"
            | "ps1"
            | "bat"
            | "cmd"
            | "ini"
            | "cfg"
            | "conf"
            | "sql"
            | "tex"
            | "rtf"
    )
}

fn read_docx_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|error| error.to_string())?;
    if document.size() > MAX_READ_ONLY_PREVIEW_BYTES {
        return Err("Word document text exceeds the 1 MB preview limit".to_string());
    }
    let mut xml = String::new();
    document
        .read_to_string(&mut xml)
        .map_err(|error| error.to_string())?;

    let mut reader = XmlReader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(XmlEvent::Text(text)) => {
                if let Ok(value) = text.decode() {
                    if !output.is_empty() && !output.ends_with(['\n', '\t', ' ']) {
                        output.push(' ');
                    }
                    output.push_str(&value);
                }
            }
            Ok(XmlEvent::End(tag)) if tag.name().as_ref() == b"w:p" => output.push('\n'),
            Ok(XmlEvent::End(tag)) if tag.name().as_ref() == b"w:tc" => output.push('\t'),
            Ok(XmlEvent::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
    }
    Ok(output.trim().to_string())
}

fn structure_entries_as_notes(entries: &[StructureEntry]) -> Vec<NoteFile> {
    let mut children_by_parent: HashMap<String, Vec<&StructureEntry>> = HashMap::new();
    for entry in entries {
        let parent = Path::new(&entry.path)
            .parent()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        children_by_parent.entry(parent).or_default().push(entry);
    }

    entries
        .iter()
        .map(|entry| {
            let title = Path::new(&entry.path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| entry.path.clone());
            let kind = if entry.is_directory { "文件夹" } else { "文件" };
            let children = if entry.is_directory {
                children_by_parent
                    .get(&entry.path)
                    .into_iter()
                    .flatten()
                    .map(|child| format!("- [[{}]]", structure_note_target(child)))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            };
            let child_section = if children.is_empty() {
                String::new()
            } else {
                format!("\n\n## 包含项\n\n{children}")
            };

            NoteFile {
                path: structure_note_path(entry),
                content: format!(
                    "# {title}\n\n只读磁盘结构条目。App 未读取该文件的正文，也不会修改原始文件。\n\n- 类型：{kind}\n- 位置：{}{}",
                    entry.path, child_section
                ),
                modified_at: None,
            }
        })
        .collect()
}

fn structure_note_path(entry: &StructureEntry) -> String {
    if entry.is_directory {
        format!("{}/__folder.structure.md", entry.path)
    } else {
        format!("{}.structure-file.md", entry.path)
    }
}

fn structure_note_target(entry: &StructureEntry) -> String {
    structure_note_path(entry)
        .trim_end_matches(".md")
        .to_string()
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_safe_relative(relative)?;
    let full_path = root.join(relative);
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let nearest_existing_parent = nearest_existing_parent(&full_path);
    let canonical_parent = nearest_existing_parent
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("path escapes vault root".to_string());
    }
    Ok(full_path)
}

fn create_vault_dir_at(parent: &Path, name: &str) -> Result<PathBuf, String> {
    ensure_existing_dir(parent)?;
    let folder_name = validate_folder_name(name)?;
    let full_path = parent.join(folder_name);
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;

    if full_path.exists() && !full_path.is_dir() {
        return Err(format!(
            "target exists and is not a directory: {}",
            full_path.display()
        ));
    }

    let nearest_parent = nearest_existing_parent(&full_path);
    let canonical_nearest = nearest_parent
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_nearest.starts_with(&canonical_parent) {
        return Err("new folder escapes the selected parent directory".to_string());
    }

    fs::create_dir_all(&full_path).map_err(|error| error.to_string())?;
    Ok(full_path)
}

fn create_unique_vault_dir_at(parent: &Path, name: &str) -> Result<PathBuf, String> {
    ensure_existing_dir(parent)?;
    let folder_name = validate_folder_name(name)?;
    for index in 0..=999 {
        let candidate_name = if index == 0 {
            folder_name.clone()
        } else {
            format!("{folder_name} {index}")
        };
        let candidate = parent.join(candidate_name);
        if candidate.exists() {
            continue;
        }
        let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
        let nearest_parent = nearest_existing_parent(&candidate);
        let canonical_nearest = nearest_parent
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !canonical_nearest.starts_with(&canonical_parent) {
            return Err("new folder escapes the selected parent directory".to_string());
        }
        fs::create_dir_all(&candidate).map_err(|error| error.to_string())?;
        return Ok(candidate);
    }
    Err("could not create a unique vault folder name".to_string())
}

fn write_interlinked_demo_notes(root: &Path, count: usize) -> Result<(), String> {
    let folder = root.join("关系测试");
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    for index in 1..=count {
        let relative = linked_note_path(index);
        ensure_allowed_path(&relative)?;
        let full_path = safe_join(root, &relative)?;
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(full_path, build_interlinked_note(index, count))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn unique_word_document_path(desktop: &Path, name: &str) -> Result<PathBuf, String> {
    let stem = validate_document_name(name)?;
    for index in 0..=999 {
        let file_name = if index == 0 {
            format!("{stem}.docx")
        } else {
            format!("{stem} {index}.docx")
        };
        let candidate = desktop.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("could not create a unique Word document name on the desktop".to_string())
}

fn validate_document_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim().trim_end_matches(".docx").trim();
    if trimmed.is_empty() {
        return Err("document name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("document name cannot be . or ..".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("document name cannot end with a dot or space".to_string());
    }
    if trimmed.chars().any(|ch| {
        ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return Err(
            "document name contains characters that are not allowed on Windows".to_string(),
        );
    }
    let base = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&base.as_str()) {
        return Err("document name is reserved by Windows".to_string());
    }
    Ok(trimmed.to_string())
}

fn document_title_from_path(path: &Path) -> Result<String, String> {
    Ok(path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "document path has no valid file name".to_string())?
        .to_string())
}

fn write_minimal_docx(path: &Path, title: &str) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    zip.start_file("[Content_Types].xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(content_types_xml().as_bytes())
        .map_err(|error| error.to_string())?;
    zip.add_directory("_rels/", options)
        .map_err(|error| error.to_string())?;
    zip.start_file("_rels/.rels", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(root_rels_xml().as_bytes())
        .map_err(|error| error.to_string())?;
    zip.add_directory("word/", options)
        .map_err(|error| error.to_string())?;
    zip.start_file("word/document.xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(document_xml(title).as_bytes())
        .map_err(|error| error.to_string())?;
    zip.add_directory("docProps/", options)
        .map_err(|error| error.to_string())?;
    zip.start_file("docProps/core.xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(core_props_xml(title).as_bytes())
        .map_err(|error| error.to_string())?;
    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"#
}

fn root_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"#
}

fn document_xml(title: &str) -> String {
    let escaped = xml_escape(title);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>{escaped}</w:t>
      </w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#
    )
}

fn core_props_xml(title: &str) -> String {
    let escaped = xml_escape(title);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>{escaped}</dc:title>
</cp:coreProperties>"#
    )
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn linked_note_path(index: usize) -> String {
    format!("关系测试/节点 {:02}.md", index)
}

fn linked_note_stem(index: usize) -> String {
    linked_note_path(index).trim_end_matches(".md").to_string()
}

fn build_interlinked_note(index: usize, count: usize) -> String {
    let clusters = ["入口层", "概念层", "方法层", "应用层", "反思层"];
    let cluster_size = count.div_ceil(clusters.len());
    let cluster = clusters[((index - 1) / cluster_size).min(clusters.len() - 1)];
    let links = linked_targets(index, count)
        .into_iter()
        .map(|target| format!("- [[{}]]", linked_note_stem(target)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "---\ntags:\n  - 关系测试\n  - {cluster}\nnode: {index}\n---\n\n# 节点 {index:02}\n\n这是一个用于测试知识库极端图谱工况的互联笔记。它属于 **{cluster}**，用于观察文件树、双链、反链、图谱缩放和 Agent 读取能力。\n\n## 关系\n{links}\n\n## 内容\n节点 {index:02} 记录一个局部概念，并通过相邻、跨层和远距连接与其他节点形成网络。\n"
    )
}

fn linked_targets(index: usize, count: usize) -> Vec<usize> {
    let offsets = [
        1_usize,
        2,
        count.saturating_sub(1),
        count.saturating_sub(2),
        7,
        13,
    ];
    let mut targets = Vec::new();
    for offset in offsets {
        if count <= 1 {
            break;
        }
        let target = ((index - 1 + offset) % count) + 1;
        if target != index && !targets.contains(&target) {
            targets.push(target);
        }
    }
    targets
}

fn move_notes_atomic_in_root(root: &Path, moves: Vec<PathMove>) -> Result<(), String> {
    if moves.is_empty() {
        return Ok(());
    }

    let mut sources = HashSet::new();
    let mut destinations = HashSet::new();
    let mut validated = Vec::with_capacity(moves.len());
    for path_move in moves {
        let from = path_move.from.replace('\\', "/");
        let to = path_move.to.replace('\\', "/");
        ensure_allowed_path(&from)?;
        ensure_allowed_path(&to)?;
        if from == to {
            continue;
        }
        if !Path::new(&from)
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            || !Path::new(&to)
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err("only markdown notes can be moved".to_string());
        }
        if !sources.insert(from.to_lowercase()) {
            return Err(format!("duplicate move source: {from}"));
        }
        if !destinations.insert(to.to_lowercase()) {
            return Err(format!("duplicate move destination: {to}"));
        }
        let source_path = safe_join(root, &from)?;
        if !source_path.is_file() {
            return Err(format!("move source does not exist: {from}"));
        }
        validated.push((from, to, source_path));
    }
    if validated.is_empty() {
        return Ok(());
    }

    for (_, to, _) in &validated {
        let destination_path = safe_join(root, to)?;
        if destination_path.exists() && !sources.contains(&to.to_lowercase()) {
            return Err(format!("move destination already exists: {to}"));
        }
    }

    let transaction_root = root
        .join(CANVAS_DIR)
        .join("transactions")
        .join(format!("move-{}", now_ms()?));
    fs::create_dir_all(&transaction_root).map_err(|error| error.to_string())?;
    let staged = validated
        .into_iter()
        .enumerate()
        .map(|(index, (from, to, source_path))| {
            (
                from,
                to,
                source_path,
                transaction_root.join(format!("{index}.md")),
            )
        })
        .collect::<Vec<_>>();

    let mut staged_count = 0;
    for (_, _, source_path, temp_path) in &staged {
        if let Err(error) = fs::rename(source_path, temp_path) {
            for (_, _, rollback_source, rollback_temp) in staged[..staged_count].iter().rev() {
                let _ = fs::rename(rollback_temp, rollback_source);
            }
            let _ = fs::remove_dir_all(&transaction_root);
            return Err(format!("failed to stage move transaction: {error}"));
        }
        staged_count += 1;
    }

    let mut committed_count = 0;
    for (_, to, _, temp_path) in &staged {
        let destination_path = safe_join(root, to)?;
        if let Some(parent) = destination_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                rollback_move_transaction(root, &staged, committed_count);
                return Err(format!("failed to create move destination: {error}"));
            }
        }
        if let Err(error) = fs::rename(temp_path, &destination_path) {
            rollback_move_transaction(root, &staged, committed_count);
            return Err(format!("failed to commit move transaction: {error}"));
        }
        committed_count += 1;
    }

    let _ = fs::remove_dir_all(&transaction_root);
    Ok(())
}

fn rollback_move_transaction(
    root: &Path,
    staged: &[(String, String, PathBuf, PathBuf)],
    committed_count: usize,
) {
    for (_, to, source_path, _) in staged[..committed_count].iter().rev() {
        let Ok(destination_path) = safe_join(root, to) else {
            continue;
        };
        if let Some(parent) = source_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if destination_path.exists() {
            let _ = fs::rename(destination_path, source_path);
        }
    }
    for (_, _, source_path, temp_path) in staged[committed_count..].iter().rev() {
        if let Some(parent) = source_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if temp_path.exists() {
            let _ = fs::rename(temp_path, source_path);
        }
    }
    if let Some(transaction_root) = staged.first().and_then(|entry| entry.3.parent()) {
        let _ = fs::remove_dir_all(transaction_root);
    }
}

fn move_note_to_trash(
    root: &Path,
    original_path: &str,
    full_path: &Path,
) -> Result<TrashEntry, String> {
    move_note_to_trash_at(root, original_path, full_path, now_ms()?)
}

fn move_note_to_trash_at(
    root: &Path,
    original_path: &str,
    full_path: &Path,
    deleted_at_ms: u64,
) -> Result<TrashEntry, String> {
    let normalized = original_path.replace('\\', "/");
    let id = format!("{deleted_at_ms}-{}", sanitize_trash_id(&normalized));
    let trash_relative = format!("{TRASH_DIR}/{TRASH_FILES_DIR}/{id}/{normalized}");
    let trash_full_path = root.join(&trash_relative);
    if let Some(parent) = trash_full_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(full_path, &trash_full_path).map_err(|error| error.to_string())?;

    let entry = TrashEntry {
        id,
        original_path: normalized,
        trash_path: trash_relative,
        deleted_at_ms,
        purge_after_ms: deleted_at_ms.saturating_add(TRASH_RETENTION_MS),
    };
    let mut index = load_trash_index(root)?;
    index.entries.retain(|existing| existing.id != entry.id);
    index.entries.push(entry.clone());
    index
        .entries
        .sort_by(|left, right| right.deleted_at_ms.cmp(&left.deleted_at_ms));
    save_trash_index(root, &index)?;
    Ok(entry)
}

fn restore_trash_entry_by_id(root: &Path, id: &str) -> Result<(), String> {
    let mut index = load_trash_index(root)?;
    let Some(position) = index.entries.iter().position(|entry| entry.id == id) else {
        return Err("trash entry not found or already purged".to_string());
    };
    let entry = index.entries.remove(position);
    ensure_allowed_path(&entry.original_path)?;
    let trash_full_path = safe_internal_join(root, &entry.trash_path)?;
    if !trash_full_path.exists() {
        save_trash_index(root, &index)?;
        return Err("trash file is missing".to_string());
    }
    let restore_path = unique_restore_path(root, &entry.original_path)?;
    if let Some(parent) = restore_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&trash_full_path, restore_path).map_err(|error| error.to_string())?;
    cleanup_empty_parents(root, trash_full_path.parent());
    save_trash_index(root, &index)?;
    Ok(())
}

fn purge_expired_trash(root: &Path) -> Result<(), String> {
    purge_expired_trash_at(root, now_ms()?)
}

fn purge_expired_trash_at(root: &Path, now_ms: u64) -> Result<(), String> {
    if !trash_index_path(root).exists() {
        return Ok(());
    }
    let index = load_trash_index(root)?;
    let mut kept = Vec::new();
    for entry in index.entries {
        if now_ms >= entry.purge_after_ms {
            let trash_full_path = safe_internal_join(root, &entry.trash_path)?;
            if trash_full_path.exists() {
                fs::remove_file(&trash_full_path).map_err(|error| error.to_string())?;
                cleanup_empty_parents(root, trash_full_path.parent());
            }
        } else {
            kept.push(entry);
        }
    }
    kept.sort_by(|left, right| right.deleted_at_ms.cmp(&left.deleted_at_ms));
    save_trash_index(root, &TrashIndex { entries: kept })
}

fn load_trash_index(root: &Path) -> Result<TrashIndex, String> {
    let path = trash_index_path(root);
    if !path.exists() {
        return Ok(TrashIndex::default());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn save_trash_index(root: &Path, index: &TrashIndex) -> Result<(), String> {
    let trash_dir = root.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    fs::write(trash_index_path(root), text).map_err(|error| error.to_string())
}

fn trash_index_path(root: &Path) -> PathBuf {
    root.join(TRASH_DIR).join(TRASH_INDEX_FILE)
}

fn unique_restore_path(root: &Path, original_path: &str) -> Result<PathBuf, String> {
    let original = safe_join(root, original_path)?;
    if !original.exists() {
        return Ok(original);
    }
    let path = Path::new(original_path);
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("restored");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");
    for index in 1..=999 {
        let candidate = parent.join(format!("{stem} restored {index}.{extension}"));
        let candidate_text = candidate.to_string_lossy().replace('\\', "/");
        let full = safe_join(root, &candidate_text)?;
        if !full.exists() {
            return Ok(full);
        }
    }
    Err("could not find a non-conflicting restore path".to_string())
}

fn safe_internal_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_safe_relative(relative)?;
    let full_path = root.join(relative);
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let nearest_parent = nearest_existing_parent(&full_path);
    let canonical_parent = nearest_parent
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("internal path escapes vault root".to_string());
    }
    Ok(full_path)
}

fn cleanup_empty_parents(root: &Path, start: Option<&Path>) {
    let trash_root = root.join(TRASH_DIR).join(TRASH_FILES_DIR);
    let mut current = match start {
        Some(path) => path.to_path_buf(),
        None => return,
    };
    while current.starts_with(&trash_root) && current != trash_root {
        if fs::remove_dir(&current).is_err() {
            break;
        }
        if !current.pop() {
            break;
        }
    }
}

fn sanitize_trash_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect::<String>()
}

fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64)
}

fn validate_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("folder name cannot be . or ..".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("folder name cannot end with a dot or space".to_string());
    }
    if trimmed.chars().any(|ch| {
        ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return Err("folder name contains characters that are not allowed on Windows".to_string());
    }

    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let base = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    if reserved.contains(&base.as_str()) {
        return Err("folder name is reserved by Windows".to_string());
    }

    Ok(trimmed.to_string())
}

fn is_relevant_watch_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
    )
}

fn watched_relative_path(root: &Path, path: &Path) -> Option<String> {
    let candidate = if let Ok(relative) = path.strip_prefix(root) {
        relative.to_path_buf()
    } else if path.starts_with(root) {
        path.strip_prefix(root).ok()?.to_path_buf()
    } else {
        return None;
    };

    if candidate.as_os_str().is_empty() {
        return None;
    }

    let normalized = candidate.to_string_lossy().replace('\\', "/");
    if !is_allowed_path(&normalized) {
        return None;
    }

    let is_markdown = Path::new(&normalized)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"));
    let is_directory = path.is_dir() || Path::new(&normalized).extension().is_none();
    if is_markdown || is_directory {
        Some(normalized)
    } else {
        None
    }
}

fn nearest_existing_parent(path: &Path) -> PathBuf {
    let mut current = path.parent().unwrap_or(path).to_path_buf();
    while !current.exists() {
        if !current.pop() {
            break;
        }
    }
    current
}

fn ensure_existing_dir(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("not a directory: {}", path.display()))
    }
}

fn ensure_allowed_path(path: &str) -> Result<(), String> {
    if is_allowed_path(path) {
        Ok(())
    } else {
        Err(format!("blocked by safety rules: {path}"))
    }
}

fn ensure_safe_relative(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("absolute paths are not allowed inside the vault".to_string());
    }
    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("path traversal is not allowed".to_string());
    }
    Ok(())
}

fn is_allowed_path(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_lowercase();
    let sensitive_words = [
        "密码",
        "账号",
        "账户",
        "secret",
        "secrets",
        "password",
        "credential",
        "credentials",
        "private",
        "token",
        "apikey",
        "api-key",
    ];
    let blocked_segments = [
        ".obsidian",
        ".git",
        ".claude",
        ".venv",
        "node_modules",
        "target",
        "dist",
        "build",
        "private-vaults",
        "vaults",
    ];
    let segments: Vec<&str> = lower.split('/').collect();
    let base = segments.last().copied().unwrap_or("");
    if base == ".env" || base.starts_with(".env.") {
        return false;
    }
    if segments.iter().any(|segment| {
        blocked_segments.contains(segment) || (segment.starts_with('.') && *segment != ".kb")
    }) {
        return false;
    }
    !sensitive_words.iter().any(|word| lower.contains(word))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("settings.json"))
}

fn protected_secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("secrets.dat"))
}

fn legacy_secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("secrets.json"))
}

struct CredentialInfo {
    configured: bool,
    storage: String,
}

fn deepseek_credential_info(app: &tauri::AppHandle) -> Result<CredentialInfo, String> {
    let configured = load_deepseek_api_key(app)?.is_some();
    let storage = if protected_secrets_path(app)?.exists() {
        "windows-dpapi"
    } else if env::var("DEEPSEEK_API_KEY")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
    {
        "environment"
    } else {
        "none"
    };
    Ok(CredentialInfo {
        configured,
        storage: storage.to_string(),
    })
}

fn save_protected_deepseek_api_key(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let encrypted = protect_secret(key.as_bytes())?;
    let path = protected_secrets_path(app)?;
    let temp_path = path.with_extension("dat.tmp");
    fs::write(&temp_path, encrypted).map_err(|error| error.to_string())?;
    replace_file_atomic(&temp_path, &path)?;
    let legacy_path = legacy_secrets_path(app)?;
    if legacy_path.exists() {
        fs::remove_file(legacy_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_app_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&temp_path, text).map_err(|error| error.to_string())?;
    replace_file_atomic(&temp_path, &path)
}

#[cfg(windows)]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source_wide.as_ptr()),
            PCWSTR(destination_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| format!("atomic file replacement failed: {error}"))
    }
}

#[cfg(not(windows))]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| error.to_string())
}

fn load_deepseek_api_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let protected_path = protected_secrets_path(app)?;
    if protected_path.exists() {
        let encrypted = fs::read(protected_path).map_err(|error| error.to_string())?;
        let decrypted = unprotect_secret(&encrypted)?;
        let key = String::from_utf8(decrypted).map_err(|error| error.to_string())?;
        let trimmed = key.trim().to_string();
        return Ok((!trimmed.is_empty()).then_some(trimmed));
    }

    let legacy_path = legacy_secrets_path(app)?;
    if legacy_path.exists() {
        let text = fs::read_to_string(&legacy_path).map_err(|error| error.to_string())?;
        let secrets: AppSecrets = parse_json_document(&text)?;
        if let Some(key) = secrets
            .deep_seek_api_key
            .filter(|key| !key.trim().is_empty())
        {
            save_protected_deepseek_api_key(app, key.trim())?;
            return Ok(Some(key.trim().to_string()));
        }
        fs::remove_file(legacy_path).map_err(|error| error.to_string())?;
    }

    if let Ok(value) = env::var("DEEPSEEK_API_KEY") {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed));
        }
    }
    Ok(None)
}

#[cfg(windows)]
fn protect_secret(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value
            .len()
            .try_into()
            .map_err(|_| "API key is too large".to_string())?,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            w!("Knowledge Agent API Key"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows DPAPI encryption failed: {error}"))?;
        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(encrypted)
    }
}

#[cfg(windows)]
fn unprotect_secret(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value
            .len()
            .try_into()
            .map_err(|_| "encrypted API key is too large".to_string())?,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows DPAPI decryption failed: {error}"))?;
        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(decrypted)
    }
}

#[cfg(not(windows))]
fn protect_secret(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure API key storage currently requires Windows DPAPI".to_string())
}

#[cfg(not(windows))]
fn unprotect_secret(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure API key storage currently requires Windows DPAPI".to_string())
}

fn parse_json_document<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|error| error.to_string())
}

fn normalize_model_role(role: &str) -> &'static str {
    match role {
        "assistant" => "assistant",
        "tool" => "tool",
        _ => "user",
    }
}

fn normalize_model_name(model: Option<String>) -> String {
    match model.as_deref() {
        Some("deepseek-v4-flash") => "deepseek-v4-flash".to_string(),
        Some("deepseek-v4-pro") => "deepseek-v4-pro".to_string(),
        _ => "deepseek-v4-pro".to_string(),
    }
}

fn normalize_agent_mode(mode: Option<String>) -> String {
    match mode.as_deref() {
        Some("organizer") => "organizer".to_string(),
        Some("linker") => "linker".to_string(),
        Some("daily") => "daily".to_string(),
        _ => "daily".to_string(),
    }
}

fn normalize_credential_status(status: Option<String>, configured: bool) -> String {
    if !configured {
        return "unchecked".to_string();
    }
    match status.as_deref() {
        Some("valid") => "valid".to_string(),
        Some("invalid") => "invalid".to_string(),
        _ => "unchecked".to_string(),
    }
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    let root_path = PathBuf::from(root);
    ensure_existing_dir(&root_path)?;
    let output = Command::new("git")
        .args(args)
        .current_dir(&root_path)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git command failed".to_string()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod trash_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn delete_moves_note_to_trash_and_purges_after_exact_retention() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-trash-{stamp}"));
        let note_path = root.join("thinking").join("system.md");
        fs::create_dir_all(note_path.parent().expect("note should have parent"))
            .expect("note parent should be created");
        fs::write(&note_path, "# system").expect("note should be written");

        let deleted_at = 1_700_000_000_000;
        let entry = move_note_to_trash_at(&root, "thinking/system.md", &note_path, deleted_at)
            .expect("note should move to trash");

        assert!(!note_path.exists());
        assert!(root.join(&entry.trash_path).exists());
        assert_eq!(entry.purge_after_ms, deleted_at + TRASH_RETENTION_MS);

        purge_expired_trash_at(&root, entry.purge_after_ms - 1)
            .expect("trash should not purge before the exact deadline");
        assert!(root.join(&entry.trash_path).exists());
        assert_eq!(
            load_trash_index(&root)
                .expect("trash index should load")
                .entries
                .len(),
            1
        );

        purge_expired_trash_at(&root, entry.purge_after_ms)
            .expect("trash should purge at the exact deadline");
        assert!(!root.join(&entry.trash_path).exists());
        assert!(load_trash_index(&root)
            .expect("trash index should load")
            .entries
            .is_empty());

        fs::remove_dir_all(&root).expect("test trash root should be removed");
    }

    #[test]
    fn restores_note_from_trash_before_retention_expires() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-restore-{stamp}"));
        let note_path = root.join("A").join("B.md");
        fs::create_dir_all(note_path.parent().expect("note should have parent"))
            .expect("note parent should be created");
        fs::write(&note_path, "# B").expect("note should be written");

        let entry = move_note_to_trash_at(&root, "A/B.md", &note_path, 1_700_000_000_000)
            .expect("note should move to trash");
        restore_trash_entry_by_id(&root, &entry.id).expect("note should restore");

        assert!(root.join("A").join("B.md").exists());
        assert!(!root.join(&entry.trash_path).exists());
        assert!(load_trash_index(&root)
            .expect("trash index should load")
            .entries
            .is_empty());

        fs::remove_dir_all(&root).expect("test restore root should be removed");
    }

    #[test]
    fn bounds_large_trash_previews_without_affecting_restore_content() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-trash-preview-{stamp}"));
        let note_path = root.join("large.md");
        fs::create_dir_all(&root).expect("test root should be created");
        let original = "x".repeat(MAX_READ_ONLY_PREVIEW_BYTES as usize + 64);
        fs::write(&note_path, &original).expect("large note should be written");

        let entry = move_note_to_trash_at(
            &root,
            "large.md",
            &note_path,
            now_ms().expect("current time should be available"),
        )
        .expect("large note should move to trash");
        let preview = preview_trash_entry(root.to_string_lossy().to_string(), entry.id.clone())
            .expect("large trash note should have a bounded preview");

        assert!(preview.truncated);
        assert_eq!(preview.content.len(), MAX_READ_ONLY_PREVIEW_BYTES as usize);
        assert_eq!(preview.size, original.len() as u64);

        restore_trash_entry_by_id(&root, &entry.id).expect("large note should restore");
        assert_eq!(
            fs::read_to_string(&note_path).expect("restored note should be readable"),
            original
        );
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[test]
    fn moves_multiple_notes_as_one_validated_transaction() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-move-{stamp}"));
        fs::create_dir_all(root.join("old")).expect("source folder should be created");
        fs::write(root.join("old/a.md"), "# A").expect("first note should be written");
        fs::write(root.join("old/b.md"), "# B").expect("second note should be written");

        move_notes_atomic_in_root(
            &root,
            vec![
                PathMove {
                    from: "old/a.md".to_string(),
                    to: "new/a.md".to_string(),
                },
                PathMove {
                    from: "old/b.md".to_string(),
                    to: "new/b.md".to_string(),
                },
            ],
        )
        .expect("transaction should commit");

        assert!(!root.join("old/a.md").exists());
        assert!(!root.join("old/b.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("new/a.md")).expect("moved note should exist"),
            "# A"
        );
        assert_eq!(
            fs::read_to_string(root.join("new/b.md")).expect("moved note should exist"),
            "# B"
        );
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[test]
    fn rejects_move_collision_before_changing_any_source() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-move-collision-{stamp}"));
        fs::create_dir_all(root.join("old")).expect("source folder should be created");
        fs::create_dir_all(root.join("new")).expect("destination folder should be created");
        fs::write(root.join("old/a.md"), "# A").expect("source note should be written");
        fs::write(root.join("new/a.md"), "# Existing").expect("destination note should be written");

        let result = move_notes_atomic_in_root(
            &root,
            vec![PathMove {
                from: "old/a.md".to_string(),
                to: "new/a.md".to_string(),
            }],
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("old/a.md")).expect("source should remain"),
            "# A"
        );
        assert_eq!(
            fs::read_to_string(root.join("new/a.md")).expect("destination should remain"),
            "# Existing"
        );
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[test]
    fn rolls_back_every_note_when_a_later_move_cannot_commit() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-move-rollback-{stamp}"));
        fs::create_dir_all(root.join("old")).expect("source folder should be created");
        fs::write(root.join("old/a.md"), "# A").expect("first note should be written");
        fs::write(root.join("old/b.md"), "# B").expect("second note should be written");
        fs::write(root.join("blocked"), "not a directory")
            .expect("blocking file should be written");

        let result = move_notes_atomic_in_root(
            &root,
            vec![
                PathMove {
                    from: "old/a.md".to_string(),
                    to: "new/a.md".to_string(),
                },
                PathMove {
                    from: "old/b.md".to_string(),
                    to: "blocked/b.md".to_string(),
                },
            ],
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("old/a.md")).expect("first source should roll back"),
            "# A"
        );
        assert_eq!(
            fs::read_to_string(root.join("old/b.md")).expect("second source should roll back"),
            "# B"
        );
        assert!(!root.join("new/a.md").exists());
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn supports_case_only_note_renames_on_windows() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-case-move-{stamp}"));
        fs::create_dir_all(&root).expect("test root should be created");
        fs::write(root.join("Topic.md"), "# Topic").expect("source note should be written");

        move_notes_atomic_in_root(
            &root,
            vec![PathMove {
                from: "Topic.md".to_string(),
                to: "topic.md".to_string(),
            }],
        )
        .expect("case-only transaction should commit");

        assert_eq!(
            fs::read_to_string(root.join("topic.md")).expect("renamed note should exist"),
            "# Topic"
        );
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[test]
    fn atomic_replacement_overwrites_an_existing_file() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-replace-{stamp}"));
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("secrets.dat");
        let source = root.join("secrets.dat.tmp");
        fs::write(&destination, b"old").expect("old file should be written");
        fs::write(&source, b"new").expect("new file should be written");

        replace_file_atomic(&source, &destination).expect("replacement should succeed");

        assert_eq!(
            fs::read(&destination).expect("replacement should be readable"),
            b"new"
        );
        assert!(!source.exists());
        fs::remove_dir_all(&root).expect("test root should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn windows_dpapi_round_trip_does_not_store_plaintext() {
        let secret = b"sk-test-private-value";
        let encrypted = protect_secret(secret).expect("DPAPI should encrypt");
        assert_ne!(encrypted, secret);
        assert!(!String::from_utf8_lossy(&encrypted).contains("sk-test-private-value"));
        assert_eq!(
            unprotect_secret(&encrypted).expect("DPAPI should decrypt"),
            secret
        );
    }

    #[test]
    fn credential_status_is_cleared_when_no_key_is_configured() {
        assert_eq!(
            normalize_credential_status(Some("valid".to_string()), false),
            "unchecked"
        );
        assert_eq!(
            normalize_credential_status(Some("invalid".to_string()), true),
            "invalid"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_windows_utf8_settings_with_or_without_bom() {
        let json = r#"{"vaultPath":"F:\\demo","githubRepo":null}"#;
        let plain: AppSettings = parse_json_document(json).expect("plain JSON should parse");
        let with_bom: AppSettings =
            parse_json_document(&format!("\u{feff}{json}")).expect("BOM JSON should parse");

        assert_eq!(plain.vault_path.as_deref(), Some("F:\\demo"));
        assert_eq!(with_bom.vault_path.as_deref(), Some("F:\\demo"));
    }

    #[test]
    fn rejects_invalid_vault_folder_names() {
        for name in [
            "", "  ", ".", "..", "a/b", "a\\b", "notes:", "CON", "LPT1", "name.",
        ] {
            assert!(
                validate_folder_name(name).is_err(),
                "{name} should be rejected"
            );
        }
    }

    #[test]
    fn creates_vault_folder_under_selected_parent() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!("knowledge-agent-parent-{stamp}"));
        fs::create_dir_all(&parent).expect("test parent should be created");

        let created =
            create_vault_dir_at(&parent, "日用知识库").expect("vault folder should be created");
        assert!(created.is_dir());
        assert_eq!(created.parent(), Some(parent.as_path()));

        fs::remove_dir_all(&parent).expect("test folders should be removed");
    }

    #[test]
    fn saves_note_and_loads_it_again_from_the_vault() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-autosave-{stamp}"));
        fs::create_dir_all(&root).expect("test vault root should be created");

        save_note(
            root.to_string_lossy().to_string(),
            "Generated/Systems/overview.md".to_string(),
            "# Persistent overview\n\n[[Generated/Systems/node-a]]".to_string(),
        )
        .expect("note should be saved");

        let loaded =
            load_vault_notes(root.to_string_lossy().to_string()).expect("vault should reload");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].path, "Generated/Systems/overview.md");
        assert_eq!(
            loaded[0].content,
            "# Persistent overview\n\n[[Generated/Systems/node-a]]"
        );

        fs::remove_dir_all(&root).expect("test vault should be removed");
    }

    #[test]
    fn saves_and_loads_canvas_metadata_without_touching_markdown() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-canvas-{stamp}"));
        fs::create_dir_all(&root).expect("test vault root should be created");
        let note_path = root.join("notes.md");
        fs::write(&note_path, "# unchanged").expect("test note should be written");
        let document = json!({
            "version": 1,
            "id": "canvas-test",
            "name": "Research",
            "cards": [],
            "connections": [],
            "groups": [],
            "viewport": { "x": 0, "y": 0, "scale": 1 }
        });

        save_canvas_document(root.to_string_lossy().to_string(), document.clone())
            .expect("canvas should be saved");
        let reloaded =
            load_canvas_document(root.to_string_lossy().to_string()).expect("canvas should load");

        assert_eq!(reloaded, Some(document));
        assert_eq!(
            fs::read_to_string(note_path).expect("note should remain readable"),
            "# unchanged"
        );
        fs::remove_dir_all(&root).expect("test vault should be removed");
    }

    #[test]
    fn creates_unique_interlinked_demo_vault() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!("knowledge-agent-linked-{stamp}"));
        fs::create_dir_all(&parent).expect("test parent should be created");

        let root = create_unique_vault_dir_at(&parent, "linked vault")
            .expect("unique vault folder should be created");
        write_interlinked_demo_notes(&root, 30).expect("linked notes should be written");

        let mut files = Vec::new();
        collect_markdown_files(&root, &root, &mut files).expect("markdown files should load");
        assert_eq!(files.len(), 30);
        let first = fs::read_to_string(root.join("关系测试").join("节点 01.md"))
            .expect("first note should exist");
        assert!(first.contains("[[关系测试/节点 02]]"));
        assert!(first.contains("[[关系测试/节点 30]]"));

        fs::remove_dir_all(&parent).expect("test folders should be removed");
    }

    #[test]
    fn reads_directory_structure_without_reading_or_changing_source_content() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-read-only-{stamp}"));
        let source = root.join("资料").join("原始内容.txt");
        fs::create_dir_all(source.parent().expect("source should have parent"))
            .expect("test parent should be created");
        fs::write(&source, "this body must remain untouched").expect("source should be written");

        let before = fs::read(&source).expect("source bytes should be readable");
        let mut entries = Vec::new();
        let mut truncated = false;
        collect_read_only_structure(&root, &root, &mut entries, &mut truncated)
            .expect("structure scan should succeed");
        let notes = structure_entries_as_notes(&entries);

        assert!(!truncated);
        assert!(entries
            .iter()
            .any(|entry| entry.path == "资料" && entry.is_directory));
        assert!(entries
            .iter()
            .any(|entry| entry.path == "资料/原始内容.txt" && !entry.is_directory));
        assert!(notes
            .iter()
            .any(|note| note.path == "资料/__folder.structure.md"));
        assert!(notes
            .iter()
            .any(|note| note.path == "资料/原始内容.txt.structure-file.md"));
        assert!(notes
            .iter()
            .all(|note| !note.content.contains("this body must remain untouched")));
        assert_eq!(
            fs::read(&source).expect("source bytes should remain readable"),
            before
        );

        fs::remove_dir_all(&root).expect("test folder should be removed");
    }

    #[test]
    fn browses_and_previews_storage_without_mutating_source_files() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-file-browser-{stamp}"));
        let folder = root.join("资料");
        let source = folder.join("说明.md");
        fs::create_dir_all(&folder).expect("test folder should be created");
        fs::write(&source, "# 只读内容\n\n不能被改变").expect("test file should be written");
        let before = fs::read(&source).expect("source bytes should be readable");

        let root_listing = list_directory_read_only_at(&root, "").expect("root should list");
        assert!(root_listing
            .entries
            .iter()
            .any(|entry| entry.name == "资料" && entry.kind == "directory"));

        let folder_listing =
            list_directory_read_only_at(&root, "资料").expect("folder should list");
        assert!(folder_listing
            .entries
            .iter()
            .any(|entry| entry.name == "说明.md" && entry.kind == "file"));

        let preview = read_file_preview_read_only_at(&root, "资料/说明.md")
            .expect("text preview should load");
        assert_eq!(preview.preview_kind, "text");
        assert!(preview
            .content
            .expect("preview should include text")
            .contains("不能被改变"));
        assert_eq!(
            fs::read(&source).expect("source should still be readable"),
            before
        );
        assert!(resolve_read_only_path(&root, "../outside.md").is_err());

        fs::remove_dir_all(&root).expect("test folder should be removed");
    }

    #[test]
    fn extracts_word_text_for_read_only_preview() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("knowledge-agent-docx-preview-{stamp}"));
        fs::create_dir_all(&root).expect("test folder should be created");
        let path = root.join("项目说明.docx");
        write_minimal_docx(&path, "项目说明").expect("docx should be written");

        let preview = read_file_preview_read_only_at(&root, "项目说明.docx")
            .expect("docx preview should load");
        assert_eq!(preview.preview_kind, "docx");
        assert!(preview
            .content
            .expect("docx should contain text")
            .contains("项目说明"));

        fs::remove_dir_all(&root).expect("test folder should be removed");
    }

    #[test]
    fn creates_minimal_word_document() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be available")
            .as_nanos();
        let desktop = std::env::temp_dir().join(format!("knowledge-agent-docx-{stamp}"));
        fs::create_dir_all(&desktop).expect("test desktop should be created");

        let path = unique_word_document_path(&desktop, "张凯瑞")
            .expect("document path should be generated");
        write_minimal_docx(&path, "张凯瑞").expect("docx should be written");

        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("张凯瑞.docx")
        );
        let bytes = fs::read(&path).expect("docx should be readable");
        assert_eq!(&bytes[0..2], b"PK");

        fs::remove_dir_all(&desktop).expect("test desktop should be removed");
    }

    #[test]
    fn watch_filter_keeps_safe_markdown_and_blocks_tool_paths() {
        let root = PathBuf::from("C:/vault");
        assert_eq!(
            watched_relative_path(&root, Path::new("C:/vault/思考/系统.md")),
            Some("思考/系统.md".to_string())
        );
        assert!(
            watched_relative_path(&root, Path::new("C:/vault/.obsidian/workspace.json")).is_none()
        );
        assert!(watched_relative_path(&root, Path::new("C:/vault/账号/密码.md")).is_none());
        assert!(watched_relative_path(&root, Path::new("C:/vault/assets/image.png")).is_none());
    }

    #[test]
    fn serializes_tool_results_for_deepseek_follow_up_turns() {
        let value = model_message_json(ModelMessage {
            role: "assistant".to_string(),
            content: String::new(),
            tool_call_id: None,
            tool_calls: Some(vec![ModelToolCall {
                id: "call-1".to_string(),
                name: "app_show_graph".to_string(),
                arguments: "{}".to_string(),
            }]),
            reasoning_content: Some("use the graph tool".to_string()),
        });

        assert_eq!(value["role"], "assistant");
        assert_eq!(value["tool_calls"][0]["id"], "call-1");
        assert_eq!(value["tool_calls"][0]["type"], "function");
        assert_eq!(value["tool_calls"][0]["function"]["name"], "app_show_graph");
        assert_eq!(value["reasoning_content"], "use the graph tool");

        let tool_result = model_message_json(ModelMessage {
            role: "tool".to_string(),
            content: "Knowledge graph is now visible.".to_string(),
            tool_call_id: Some("call-1".to_string()),
            tool_calls: None,
            reasoning_content: None,
        });
        assert_eq!(tool_result["role"], "tool");
        assert_eq!(tool_result["tool_call_id"], "call-1");
    }
}
