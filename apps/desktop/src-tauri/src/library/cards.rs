//! Desktop knowledge cards. The outgoing contract is an explicit allowlist;
//! neither local document objects nor source quotes are serialized into it.
use super::*;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CardStore {
    device_id: String,
    records: Vec<CardRecord>,
}

#[derive(Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Scope { #[default] Local, Shared }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRecord {
    card: KnowledgeCard,
    scope: Scope,
    source_metadata_version: u64,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCard {
    id: String,
    version: u64,
    name: String,
    file_type: String,
    summary: String,
    categories: Vec<String>,
    tags: Vec<String>,
    tips: Vec<CardTip>,
    source: CardSource,
    analysis_stale: bool,
    classification_locked: bool,
    updated_at: u64,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CardSource {
    device_id: String,
    device_name: String,
    revision: String,
    last_seen_at: Option<u64>,
    availability: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
struct CardTip { id: String, content: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSnapshot {
    schema: &'static str,
    device_id: String,
    generated_at: u64,
    cards: Vec<KnowledgeCard>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardReview {
    id: String,
    expected_version: u64,
    summary: String,
    categories: Vec<String>,
    tags: Vec<String>,
    scope: Scope,
}

fn uuid() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("无法创建资料编号：{e}"))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..]))
}

pub(super) fn reconcile(data: &mut Library) -> Result<bool, String> {
    let store = &mut data.knowledge_cards;
    let mut changed = false;
    if store.device_id.is_empty() { store.device_id = uuid()?; changed = true; }
    let mut identities = HashSet::new();
    for record in &store.records {
        if !valid_mobile_id(&record.card.id) || !identities.insert(record.card.id.clone()) {
            return Err("知识卡片编号异常，已停止保存；请保留索引以便恢复。".into());
        }
    }
    let mut seen = HashSet::new();
    for doc in &mut data.documents {
        if doc.resource_id.is_empty() { doc.resource_id = uuid()?; changed = true; }
        if !valid_mobile_id(&doc.resource_id) || !seen.insert(doc.resource_id.clone()) {
            return Err("资料位置绑定重复，已停止保存；原索引未被覆盖。".into());
        }
        let root = data.roots.iter().find(|r| r.id == doc.root_id);
        let availability = match root { Some(r) if r.paused => "paused", Some(r) if r.issue.is_none() => "indexed", _ => "unavailable" };
        let existing = store.records.iter_mut().find(|r| r.card.id == doc.resource_id);
        let name = doc.path.rsplit(['/', '\\']).next().unwrap_or(&doc.path).to_string();
        let mut card = KnowledgeCard {
            id: doc.resource_id.clone(), version: 1, name,
            file_type: Path::new(&doc.path).extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase(),
            summary: doc.summary.clone(), categories: normalize_categories(if doc.categories.is_empty() { std::slice::from_ref(&doc.category) } else { &doc.categories }),
            tags: doc.tags.clone(), tips: doc.tips.iter().map(|t| CardTip { id: t.id.clone(), content: t.content.clone() }).collect(),
            source: CardSource { device_id: store.device_id.clone(), device_name: "电脑".into(), revision: doc.revision.clone(),
                last_seen_at: root.and_then(|r| r.last_scan), availability: availability.into() },
            analysis_stale: !doc.analysis_revision.is_empty() && doc.analysis_revision != doc.revision,
            classification_locked: doc.classification_locked, updated_at: now(),
        };
        if let Some(record) = existing {
            // Do not increment the optimistic edit version merely for scan timestamps.
            card.version = record.card.version;
            card.updated_at = record.card.updated_at;
            let previous_seen = record.card.source.last_seen_at;
            card.source.last_seen_at = previous_seen;
            if card != record.card {
                card.version += 1; card.updated_at = now(); changed = true;
            }
            card.source.last_seen_at = root.and_then(|r| r.last_scan).or(previous_seen);
            if card.source.last_seen_at != previous_seen { changed = true; }
            record.card = card;
            if record.source_metadata_version != doc.metadata_version { changed = true; }
            record.source_metadata_version = doc.metadata_version;
        } else {
            store.records.push(CardRecord { card, scope: Scope::Local, source_metadata_version: doc.metadata_version });
            changed = true;
        }
    }
    for record in &mut store.records {
        if !seen.contains(&record.card.id) && record.card.source.availability != "unavailable" {
            record.card.source.availability = "unavailable".into(); record.card.version += 1;
            record.card.updated_at = now(); changed = true;
        }
    }
    Ok(changed)
}

pub(super) fn make_local(data: &mut Library, ids: &HashSet<String>) {
    for record in &mut data.knowledge_cards.records {
        if ids.contains(&record.card.id) && record.scope != Scope::Local {
            record.scope = Scope::Local; record.card.version += 1; record.card.updated_at = now();
        }
    }
}

// Share eligibility is not proof of upload. This first desktop slice only
// exports the full eligible snapshot; there is no account service yet.
pub fn public_snapshot(data: &Library) -> CardSnapshot {
    CardSnapshot { schema: "knowledge-cards/v1", device_id: data.knowledge_cards.device_id.clone(), generated_at: now(),
        cards: data.knowledge_cards.records.iter().filter(|r| r.scope == Scope::Shared).map(|r| r.card.clone()).collect() }
}

fn save(data: &mut Library, review: CardReview) -> Result<(), String> {
    if review.summary.chars().count() > 6000 || review.categories.len() > 12 || review.categories.iter().any(|s| s.chars().count() > 120)
        || review.tags.len() > 20 || review.tags.iter().any(|s| s.chars().count() > 60) {
        return Err("摘要、分类或标签超过长度或数量限制，请缩短后保存。".into());
    }
    let record = data.knowledge_cards.records.iter_mut().find(|r| r.card.id == review.id).ok_or("这张卡片不存在，请重新读取。")?;
    if record.card.version != review.expected_version { return Err("卡片已在其他操作中更新。请先保留草稿，再重新读取后保存。".into()); }
    let categories = normalize_categories(&review.categories);
    let mut tags: Vec<_> = review.tags.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    tags.sort(); tags.dedup();
    record.card.summary = review.summary;
    record.card.categories = categories;
    record.card.tags = tags;
    record.card.classification_locked = true;
    record.scope = review.scope;
    record.card.version += 1; record.card.updated_at = now();
    if let Some(doc) = data.documents.iter_mut().find(|doc| doc.resource_id == review.id) {
        // Update the legacy editor's local projection in the same transaction.
        // No source existence check or filesystem write is needed for annotations.
        doc.summary = record.card.summary.clone(); doc.categories = record.card.categories.clone();
        doc.category = doc.categories.first().cloned().unwrap_or_default(); doc.tags = record.card.tags.clone();
        doc.classification_locked = true; doc.metadata_version += 1;
        record.source_metadata_version = doc.metadata_version;
    }
    Ok(())
}

#[tauri::command]
pub async fn library_save_card(app: tauri::AppHandle, review: CardReview) -> Result<Library, String> {
    transaction(app, move |data| save(data, review)).await
}

#[tauri::command]
pub async fn library_card_snapshot(app: tauri::AppHandle) -> Result<CardSnapshot, String> {
    Ok(public_snapshot(&library_load(app).await?))
}

#[tauri::command]
pub async fn library_export_cards(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new().set_title("导出可共享的知识卡片（不含原件）").set_file_name("knowledge-cards.json").add_filter("JSON", &["json"]).save_file().await;
    let Some(picked) = picked else { return Ok(None); };
    let snapshot = public_snapshot(&library_load(app).await?);
    let path = picked.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = serde_json::to_vec_pretty(&snapshot).map_err(|e| e.to_string())?;
        fs::write(&path, bytes).map_err(|e| format!("卡片导出失败：{e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("knowledge-cards-test-{}", uuid().unwrap()));
            fs::create_dir_all(dir.join("sources")).unwrap(); Self(dir)
        }
        fn source(&self) -> PathBuf { self.0.join("sources/note.txt") }
        fn library(&self) -> Library {
            fs::write(self.source(), "PRIVATE_FULL_TEXT and PRIVATE_QUOTE").unwrap();
            let mut data = Library { version: 2, ..Default::default() };
            add_root(&mut data, &self.0.join("sources")).unwrap(); scan(&mut data);
            data.documents[0].summary = "旧摘要".into();
            data.documents[0].tags = vec!["已确认标签".into()];
            data.documents[0].categories = vec!["项目/装修".into()];
            data.documents[0].classification_locked = true;
            data.documents[0].tips = vec![Tip { id: "tip-1".into(), content: "已提取要点".into(), quote: "PRIVATE_QUOTE".into() }];
            data.documents[0].analysis_revision = data.documents[0].revision.clone();
            data
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn review(data: &Library) -> CardReview {
        let record = &data.knowledge_cards.records[0];
        CardReview { id: record.card.id.clone(), expected_version: record.card.version, summary: "改后的摘要".into(), categories: vec!["项目/装修".into(), "主题/预算".into()], tags: vec!["人工标签".into()], scope: Scope::Shared }
    }

    #[test]
    fn migration_preserves_rollback_index_and_identity_across_restarts() {
        let fixture = Fixture::new(); let legacy = fixture.0.join("index-v1.json"); let path = fixture.0.join("index-v3.json");
        persist(&legacy, &fixture.library()).unwrap(); let original = fs::read(&legacy).unwrap();
        let first = load_current(&path).unwrap(); let second = load_current(&path).unwrap();
        assert_eq!(first.version, 3);
        assert_eq!(first.documents[0].resource_id, second.documents[0].resource_id);
        assert!(valid_mobile_id(&first.documents[0].resource_id));
        assert_eq!(first.knowledge_cards.device_id, second.knowledge_cards.device_id);
        assert_eq!(first.knowledge_cards.records[0].card.tags, vec!["已确认标签"]);
        assert_eq!(first.documents[0].tips[0].quote, "PRIVATE_QUOTE");
        assert!(first.knowledge_cards.records[0].card.classification_locked);
        assert!(matches!(first.knowledge_cards.records[0].scope, Scope::Local));
        assert_eq!(fs::read(&legacy).unwrap(), original);
        assert_eq!(load(&legacy).unwrap().version, 2);
        fs::write(&path, "broken").unwrap(); assert!(load_current(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken"); assert_eq!(fs::read(&legacy).unwrap(), original);
    }

    #[test]
    fn corrupt_legacy_aborts_migration_without_creating_empty_new_library() {
        let fixture = Fixture::new(); let legacy = fixture.0.join("index-v1.json"); let path = fixture.0.join("index-v3.json");
        fs::write(&legacy, "broken").unwrap(); assert!(load_current(&path).is_err()); assert!(!path.exists());
        assert_eq!(fs::read(&legacy).unwrap(), b"broken");
    }

    #[test]
    fn shared_snapshot_is_an_allowlist_and_private_cards_never_leave() {
        let fixture = Fixture::new(); let mut data = fixture.library(); reconcile(&mut data).unwrap();
        assert!(public_snapshot(&data).cards.is_empty());
        let mutation = review(&data); save(&mut data, mutation).unwrap(); reconcile(&mut data).unwrap();
        let value = serde_json::to_value(public_snapshot(&data)).unwrap(); let serialized = value.to_string();
        assert_eq!(value["cards"].as_array().unwrap().len(), 1);
        for forbidden in ["PRIVATE_FULL_TEXT", "PRIVATE_QUOTE", "rootId", "root_id", "sourceMetadataVersion", "text", "quote", "path", "roots", "mobileReceipts", "attachment"] {
            assert!(!serialized.contains(forbidden), "unexpected: {forbidden}");
        }
        assert!(!serialized.contains(&fixture.0.to_string_lossy().replace('\\', "\\\\")));
        assert_eq!(value["cards"][0]["tips"][0]["content"], "已提取要点");
        let mut private = review(&data); private.scope = Scope::Local; save(&mut data, private).unwrap();
        assert!(public_snapshot(&data).cards.is_empty());
        let mut invalid = serde_json::json!({"id":"id","expectedVersion":1,"summary":"x","categories":[],"tags":[],"scope":"shared"});
        invalid["text"] = serde_json::json!("must not write a source");
        assert!(serde_json::from_value::<CardReview>(invalid).is_err());
    }

    #[test]
    fn annotations_never_touch_source_and_stale_writes_preserve_newer_work() {
        let fixture = Fixture::new(); let mut data = fixture.library(); reconcile(&mut data).unwrap();
        let bytes = fs::read(fixture.source()).unwrap(); let modified = fs::metadata(fixture.source()).unwrap().modified().unwrap();
        let first = review(&data); let outdated = review(&data); save(&mut data, first).unwrap(); reconcile(&mut data).unwrap();
        assert!(save(&mut data, outdated).unwrap_err().contains("更新"));
        assert_eq!(data.documents[0].tags, vec!["人工标签"]);
        assert_eq!(fs::read(fixture.source()).unwrap(), bytes);
        assert_eq!(fs::metadata(fixture.source()).unwrap().modified().unwrap(), modified);
        assert_eq!(data.knowledge_cards.records[0].card.categories.len(), 2);
    }

    #[test]
    fn offline_and_missing_sources_keep_editable_cards() {
        let fixture = Fixture::new(); let mut data = fixture.library(); reconcile(&mut data).unwrap();
        let source = fixture.0.join("sources"); let offline = fixture.0.join("offline");
        fs::rename(&source, &offline).unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        assert_eq!(data.knowledge_cards.records[0].card.source.availability, "unavailable");
        let input = review(&data); save(&mut data, input).unwrap(); reconcile(&mut data).unwrap();
        fs::rename(&offline, &source).unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        assert_eq!(data.knowledge_cards.records[0].card.tags, vec!["人工标签"]);
        assert_eq!(data.knowledge_cards.records[0].card.source.availability, "indexed");
        fs::remove_file(fixture.source()).unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        assert!(data.documents.is_empty()); assert_eq!(data.knowledge_cards.records.len(), 1);
        let mut input = review(&data); input.summary = "原件未找到，仍保留我的标注".into(); save(&mut data, input).unwrap(); reconcile(&mut data).unwrap();
        assert_eq!(data.knowledge_cards.records[0].card.summary, "原件未找到，仍保留我的标注");
        assert!(!fixture.source().exists());
    }

    #[test]
    fn rename_keeps_card_identity_but_same_content_duplicates_are_distinct() {
        let fixture = Fixture::new(); let mut data = fixture.library(); reconcile(&mut data).unwrap();
        let id = data.documents[0].resource_id.clone(); let renamed = fixture.0.join("sources/renamed.txt");
        fs::rename(fixture.source(), &renamed).unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        assert_eq!(data.documents[0].resource_id, id); assert_eq!(data.knowledge_cards.records.len(), 1);
        fs::copy(&renamed, fixture.source()).unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        assert_eq!(data.knowledge_cards.records.len(), 2);
        assert_ne!(data.documents[0].resource_id, data.documents[1].resource_id);
        fs::write(&renamed, "new source content, no automatic relabel").unwrap(); scan(&mut data); reconcile(&mut data).unwrap();
        let updated = data.knowledge_cards.records.iter().find(|r| r.card.id == id).unwrap();
        assert!(updated.card.analysis_stale); assert_eq!(updated.card.tags, vec!["已确认标签"]);
    }
}
