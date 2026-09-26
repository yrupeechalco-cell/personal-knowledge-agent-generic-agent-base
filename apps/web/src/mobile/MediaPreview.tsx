import { useEffect, useState } from 'react';
import type { LocalDocument } from './libraryStore';
import { loadMedia } from './sync';
import { formatBytes, mediaType } from './media';

export function MediaPreview({ entry }: { entry: LocalDocument }) {
  const media = mediaType(entry.doc.path)!;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [decodeError, setDecodeError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [progress, setProgress] = useState('');
  useEffect(() => {
    let active = true; let objectUrl = '';
    setError(''); setDecodeError(false); setUrl('');
    void loadMedia(entry, message => { if (active) setProgress(message); }).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.doc.id, entry.doc.revision, attempt]);
  return <section className="ml-media-preview" aria-label={`${media.label}预览`}>
    <div className="ml-media-heading"><strong>{media.label}</strong><span>{formatBytes(entry.doc.size)}</span></div>
    {!url && !error && <p role="status">{progress || '正在读取附件，首次从电脑下载可能需要一些时间…'}</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新读取附件</button></>}
    {url && <>
      {media.kind === 'image' && <button className={`ml-image${zoom ? ' enlarged' : ''}`} aria-label={zoom ? '缩小图片' : '放大图片'} onClick={() => setZoom(!zoom)}><img src={url} alt={entry.doc.path.split(/[\\/]/).pop()} onError={() => setDecodeError(true)}/></button>}
      {media.kind === 'audio' && <audio controls preload="metadata" src={url} onError={() => setDecodeError(true)}/>}
      {media.kind === 'video' && <video controls playsInline preload="metadata" src={url} onError={() => setDecodeError(true)}/>}
      {decodeError && <p role="status">当前设备无法预览此文件的编码，原文件已保留。可下载后用其他应用打开。</p>}
      <a className="ml-download" href={url} download={entry.doc.path.split(/[\\/]/).pop()}>导出原文件</a><small>附件已保存在本机，可在此页面断线查看。</small>
    </>}
    <p className="ml-muted">可填写摘要、分类和关键词；图片识别、音视频转写尚未接入。</p>
  </section>;
}
