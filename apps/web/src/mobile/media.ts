export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
export const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const formats: Record<string, [string, 'image' | 'audio' | 'video']> = {
  jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], png: ['image/png', 'image'],
  gif: ['image/gif', 'image'], webp: ['image/webp', 'image'], heic: ['image/heic', 'image'], heif: ['image/heif', 'image'], avif: ['image/avif', 'image'],
  mp3: ['audio/mpeg', 'audio'], m4a: ['audio/mp4', 'audio'], wav: ['audio/wav', 'audio'], aac: ['audio/aac', 'audio'], ogg: ['audio/ogg', 'audio'],
  mp4: ['video/mp4', 'video'], mov: ['video/quicktime', 'video'], webm: ['video/webm', 'video'],
};
export function mediaType(name: string) {
  const format = formats[name.split('.').pop()?.toLowerCase() ?? ''];
  return format ? { mime: format[0], kind: format[1], label: { image: '图片', audio: '音频', video: '视频' }[format[1]] } : null;
}
export const mobileFileAccept = ['.md', '.markdown', '.txt', ...Object.keys(formats).map(ext => `.${ext}`)].join(',');
export const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Prevent mislabeled text/executable files being accepted as media. Playback still
// depends on the device's codec support; signatures alone do not validate codecs.
export async function validateMedia(file: Blob, name: string) {
  const format = mediaType(name);
  if (!format) throw new Error(`${name}：暂不支持这种附件格式。`);
  if (!file.size) throw new Error(`${name}：手机返回了 0 字节，未读取到文件内容。若文件保存在 iCloud 或其他网盘，请先在“文件”App 下载完成，再重新选择。`);
  const limit = format.kind === 'image' ? 50 * 1024 * 1024 : MAX_MEDIA_BYTES;
  if (file.size > limit) throw new Error(`${name}：文件大小 ${formatBytes(file.size)}，超过${format.kind === 'image' ? '图片 50 MB' : '音视频 1 GB'}的上限，本次未导入。`);
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = (start: number, text: string) => [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0));
  const ext = name.split('.').pop()!.toLowerCase();
  const valid = ['mp4', 'mov', 'm4a', 'heic', 'heif', 'avif'].includes(ext) ? ascii(4, 'ftyp')
    : ['jpg', 'jpeg'].includes(ext) ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : ext === 'png' ? bytes[0] === 137 && ascii(1, 'PNG\r\n\x1a\n')
    : ext === 'gif' ? ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
    : ext === 'webp' ? ascii(0, 'RIFF') && ascii(8, 'WEBP')
    : ext === 'wav' ? ascii(0, 'RIFF') && ascii(8, 'WAVE')
    : ext === 'ogg' ? ascii(0, 'OggS')
    : ext === 'webm' ? bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    : ext === 'mp3' ? ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    : ext === 'aac' && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (!valid) throw new Error(`${name}：内容与文件格式不符，未导入。`);
  return format;
}
