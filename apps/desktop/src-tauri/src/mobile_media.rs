//! Bounded, authenticated media transfers. Paths are always resolved by the library.
use std::{fs, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use tauri::Manager;
pub const MAX_BYTES: usize = 1024 * 1024 * 1024;
pub const CHUNK_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_METADATA: usize = 2 * 1024 * 1024;
pub const MAX_REQUEST: usize = 50 * 1024 * 1024 + MAX_METADATA + 4;

pub fn mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"), "png" => Some("image/png"), "gif" => Some("image/gif"), "webp" => Some("image/webp"),
        "heic" => Some("image/heic"), "heif" => Some("image/heif"), "avif" => Some("image/avif"),
        "mp3" => Some("audio/mpeg"), "m4a" => Some("audio/mp4"), "wav" => Some("audio/wav"), "aac" => Some("audio/aac"), "ogg" => Some("audio/ogg"),
        "mp4" => Some("video/mp4"), "mov" => Some("video/quicktime"), "webm" => Some("video/webm"), _ => None,
    }
}
pub fn validate(name: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err("附件不能为空，音视频单个最大 1 GB。".into()); }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let matches = |start: usize, signature: &[u8]| bytes.get(start..start + signature.len()) == Some(signature);
    let valid = match ext.as_str() {
        "jpg" | "jpeg" => matches(0, &[255,216,255]), "png" => matches(0, b"\x89PNG\r\n\x1a\n"),
        "gif" => matches(0, b"GIF87a") || matches(0, b"GIF89a"), "webp" => matches(0, b"RIFF") && matches(8, b"WEBP"),
        "wav" => matches(0, b"RIFF") && matches(8, b"WAVE"), "ogg" => matches(0, b"OggS"),
        "mp4" | "mov" | "m4a" | "heic" | "heif" | "avif" => matches(4, b"ftyp"),
        "webm" => matches(0, &[0x1a,0x45,0xdf,0xa3]),
        "mp3" => matches(0, b"ID3") || bytes.len() >= 2 && bytes[0] == 255 && bytes[1] & 0xe0 == 0xe0,
        "aac" => bytes.len() >= 2 && bytes[0] == 255 && bytes[1] & 0xf6 == 0xf0, _ => false,
    };
    if !valid { return Err("附件内容与文件格式不符。".into()); } Ok(())
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upload { pub operation_id: String, pub name: String, pub total: u64, pub offset: u64 }
pub fn decode_chunk(bytes: &[u8]) -> Result<(Upload, &[u8]), String> {
    if bytes.len() < 4 || bytes.len() > CHUNK_BYTES + 16388 { return Err("附件分块大小无效。".into()); }
    let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
    if length == 0 || length > 16384 || 4 + length >= bytes.len() { return Err("附件分块元数据无效。".into()); }
    let header = serde_json::from_slice(&bytes[4..4 + length]).map_err(|_| "附件分块元数据无效。")?;
    Ok((header, &bytes[4 + length..]))
}
pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("mobile-upload-staging");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?; Ok(path)
}
pub fn staged_path(directory: &Path, operation: &str) -> Result<PathBuf, String> {
    if !super::library::valid_mobile_id(operation) { return Err("无效的附件操作编号。".into()); }
    Ok(directory.join(format!("{operation}.part")))
}
pub fn receive(directory: &Path, upload: &Upload, bytes: &[u8]) -> Result<u64, String> {
    let path = staged_path(directory, &upload.operation_id)?;
    let mime = mime(&upload.name).ok_or("附件格式不支持。")?;
    let limit = if mime.starts_with("image/") { 50 * 1024 * 1024 } else { MAX_BYTES };
    if upload.name.len() > 1024 || upload.total == 0 || upload.total > limit as u64 || upload.offset >= upload.total || upload.offset % CHUNK_BYTES as u64 != 0 || bytes.len() != CHUNK_BYTES.min((upload.total - upload.offset) as usize) {
        return Err("附件分块范围无效；图片最大 50 MB，音视频最大 1 GB。".into());
    }
    if upload.offset == 0 { validate(&upload.name, bytes)?; }
    let manifest = path.with_extension("json");
    if manifest.exists() {
        let original: Upload = serde_json::from_slice(&fs::read(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if original.name != upload.name || original.total != upload.total { return Err("附件续传信息不一致。".into()); }
    } else {
        if upload.offset != 0 { return Err("附件上传已过期，请重新同步。".into()); }
        // Reclaim abandoned temporary uploads after 24 hours, never indexed originals.
        for item in fs::read_dir(directory).map_err(|e| e.to_string())?.flatten() {
            if item.path().extension().is_some_and(|ext| ext == "json") {
                let part = item.path().with_extension("part");
                let recent = fs::metadata(&part).or_else(|_| item.metadata()).ok().and_then(|meta| meta.modified().ok());
                if recent.and_then(|date| date.elapsed().ok()).is_some_and(|age| age.as_secs() > 86400) { let _ = fs::remove_file(item.path()); let _ = fs::remove_file(part); }
            }
        }
        let occupied: u64 = fs::read_dir(directory).map_err(|e| e.to_string())?.flatten()
            .filter(|item| item.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|item| fs::read(item.path()).ok()).filter_map(|bytes| serde_json::from_slice::<Upload>(&bytes).ok()).map(|item| item.total).sum();
        if occupied.saturating_add(upload.total) > 2 * MAX_BYTES as u64 { return Err("电脑临时上传空间已达 2 GB，请完成已有上传后重试。".into()); }
        fs::write(&manifest, serde_json::to_vec(upload).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    let mut file = fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(&path).map_err(|e| e.to_string())?;
    let mut current = file.metadata().map_err(|e| e.to_string())?.len();
    // Recover a partly written chunk after interruption; complete chunks stay intact.
    if current < upload.total && current % CHUNK_BYTES as u64 != 0 { current -= current % CHUNK_BYTES as u64; file.set_len(current).map_err(|e| e.to_string())?; }
    if current > upload.total || upload.offset > current { return Err("附件续传位置不一致，请重新同步。".into()); }
    if upload.offset < current {
        let mut existing = vec![0; bytes.len()]; file.seek(SeekFrom::Start(upload.offset)).and_then(|_| file.read_exact(&mut existing)).map_err(|e| e.to_string())?;
        if existing != bytes { return Err("已上传附件分块与本机内容不符，未覆盖。".into()); }
        return Ok(current);
    }
    file.seek(SeekFrom::Start(current)).and_then(|_| file.write_all(bytes)).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    Ok(current + bytes.len() as u64)
}
pub fn cleanup(directory: &Path, operation: &str) {
    if let Ok(path) = staged_path(directory, operation) { let _ = fs::remove_file(path.with_extension("json")); let _ = fs::remove_file(path); }
}
pub fn decode(bytes: &[u8]) -> Result<(super::library::MobileChange, &[u8]), String> {
    if bytes.len() < 4 || bytes.len() > MAX_REQUEST { return Err("附件请求大小无效。".into()); }
    let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
    if length == 0 || length > MAX_METADATA || 4 + length >= bytes.len() { return Err("附件元数据不完整。".into()); }
    let change = serde_json::from_slice(&bytes[4..4 + length]).map_err(|_| "附件元数据无效。")?;
    Ok((change, &bytes[4 + length..]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_fake_media_and_bad_frames() {
        assert!(validate("photo.png", b"\x89PNG\r\n\x1a\nhello").is_ok());
        assert!(validate("photo.png", b"<script>bad</script>").is_err());
        assert!(validate("file.exe", b"MZ").is_err());
        assert!(decode(&[255,255,255,255,0]).is_err());
        assert!(decode(&[]).is_err());
        assert!(validate("movie.mp4", b"\x00\x00\x00\x18ftypisom").is_ok());
    }
    #[test]
    fn large_upload_resumes_without_overwriting_completed_chunks() {
        let dir = std::env::temp_dir().join(format!("media-chunks-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let mut upload = Upload { operation_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa".into(), name: "large.mp4".into(), total: 60 * 1024 * 1024 + 17, offset: 0 };
        let mut chunk = vec![42u8; CHUNK_BYTES]; chunk[4..8].copy_from_slice(b"ftyp");
        assert_eq!(receive(&dir, &upload, &chunk).unwrap(), CHUNK_BYTES as u64);
        assert_eq!(receive(&dir, &upload, &chunk).unwrap(), CHUNK_BYTES as u64);
        let mut wrong = chunk.clone(); wrong[100] ^= 1;
        assert!(receive(&dir, &upload, &wrong).is_err());
        upload.offset = (CHUNK_BYTES * 2) as u64;
        assert!(receive(&dir, &upload, &chunk).is_err());
        // A partial chunk left by an interrupted write is safely retried.
        let path = staged_path(&dir, &upload.operation_id).unwrap();
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"partial").unwrap();
        upload.offset = CHUNK_BYTES as u64;
        while upload.offset < upload.total {
            let length = CHUNK_BYTES.min((upload.total - upload.offset) as usize);
            upload.offset = receive(&dir, &upload, &chunk[..length]).unwrap();
        }
        assert_eq!(fs::metadata(&path).unwrap().len(), upload.total);
        upload.offset = 0;
        assert_eq!(receive(&dir, &upload, &chunk).unwrap(), upload.total);
        upload.name = "changed.mp4".into(); assert!(receive(&dir, &upload, &chunk).is_err());
        assert!(staged_path(&dir, "../escape").is_err());
        cleanup(&dir, &upload.operation_id);
        assert!(!path.exists()); fs::remove_dir_all(dir).unwrap();
    }
}
