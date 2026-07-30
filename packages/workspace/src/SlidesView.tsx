import type { ParsedNote } from "@knowledge-agent/core";
import { ChevronLeft, ChevronRight, Maximize2, Presentation, X } from "lucide-react";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@knowledge-agent/ui";
import { splitMarkdownSlides } from "./slidesModel";

export function SlidesView({ note, onClose }: { note: ParsedNote; onClose(): void }) {
  const { t } = useLocalization();
  const slides = useMemo(() => splitMarkdownSlides(note.content), [note.content]);
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const activeSlide = slides[Math.min(index, Math.max(0, slides.length - 1))];

  useEffect(() => setIndex(0), [note.path]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setIndex((current) => Math.min(slides.length - 1, current + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Home") {
        setIndex(0);
      } else if (event.key === "End") {
        setIndex(Math.max(0, slides.length - 1));
      } else if (event.key === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slides.length]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await rootRef.current?.requestFullscreen();
    }
  }

  return (
    <section className="slides-view" ref={rootRef}>
      <header>
        <div>
          <Presentation size={17} />
          <span>
            <strong>{note.title}</strong>
            <small>{activeSlide?.title ?? t("空白演示")}</small>
          </span>
        </div>
        <div>
          <button onClick={() => void toggleFullscreen()} title={t("全屏演示")} type="button"><Maximize2 size={15} /></button>
          <button onClick={onClose} title={t("关闭演示")} type="button"><X size={15} /></button>
        </div>
      </header>
      <div className="slide-stage">
        {activeSlide ? (
          <article>
            {activeSlide.lines.map((line, lineIndex) => renderSlideLine(line, lineIndex))}
          </article>
        ) : (
          <div className="slides-empty">{t("当前笔记没有可演示的正文")}</div>
        )}
      </div>
      <footer>
        <button disabled={index <= 0} onClick={() => setIndex((current) => Math.max(0, current - 1))} type="button">
          <ChevronLeft size={17} />
        </button>
        <span>{slides.length === 0 ? "0 / 0" : `${index + 1} / ${slides.length}`}</span>
        <div className="slides-progress" aria-hidden="true">
          <i style={{ width: `${slides.length ? ((index + 1) / slides.length) * 100 : 0}%` }} />
        </div>
        <button disabled={index >= slides.length - 1} onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))} type="button">
          <ChevronRight size={17} />
        </button>
      </footer>
    </section>
  );
}

function renderSlideLine(line: string, index: number) {
  const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading) return createElement(`h${Math.min(3, heading[1].length)}`, { key: index }, inlineText(heading[2]));
  if (/^\s*[-*+]\s+/.test(line)) return <li key={index}>{inlineText(line.replace(/^\s*[-*+]\s+/, ""))}</li>;
  if (/^\s*>\s?/.test(line)) return <blockquote key={index}>{inlineText(line.replace(/^\s*>\s?/, ""))}</blockquote>;
  if (!line.trim()) return <br key={index} />;
  return <p key={index}>{inlineText(line)}</p>;
}

function inlineText(value: string): string {
  return value
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_raw, target: string, alias?: string) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "");
}
