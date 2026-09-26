//! Bounded, authenticated media transfers. Paths are always resolved by the library.
pub const MAX_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_METADATA: usize = 2 * 1024 * 1024;
pub const MAX_REQUEST: usize = MAX_BYTES + MAX_METADATA + 4;

pub fn mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"), "png" => Some("image/png"), "gif" => Some("image/gif"), "webp" => Some("image/webp"),
        "heic" => Some("image/heic"), "heif" => Some("image/heif"), "avif" => Some("image/avif"),
        "mp3" => Some("audio/mpeg"), "m4a" => Some("audio/mp4"), "wav" => Some("audio/wav"), "aac" => Some("audio/aac"), "ogg" => Some("audio/ogg"),
        "mp4" => Some("video/mp4"), "mov" => Some("video/quicktime"), "webm" => Some("video/webm"), _ => None,
    }
}
pub fn validate(name: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err("附件不能为空，单个最大 50 MB。".into()); }
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
}
