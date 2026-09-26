import { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import { readAttachment, type LocalDocument } from './libraryStore';

export function MediaThumbnail({ entry }: { entry: LocalDocument }) {
  const [url, setUrl] = useState(''); const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true; let objectUrl = '';
    const observer = new IntersectionObserver(items => {
      if (!items.some(item => item.isIntersecting)) return;
      observer.disconnect();
      if (entry.attachment?.revision !== entry.doc.revision) return;
      void readAttachment(entry.attachment.key).then(blob => {
        if (active && blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      }).catch(() => {});
    });
    observer.observe(host.current!);
    return () => { active = false; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.attachment?.key, entry.doc.revision]);
  return <span className="ml-thumbnail" ref={host}>{url ? <img src={url} alt="" loading="lazy" onError={() => setUrl('')}/> : <Image size={23}/>}</span>;
}
