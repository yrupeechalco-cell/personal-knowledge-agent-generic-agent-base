import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelRequest } from "@knowledge-agent/agent";
import { aiReview, analyzeLibraryDocument, categoryTree, pendingDocuments, type LibraryAdapter, type LibraryConfig, type LibrarySnapshot } from "./libraryModel";

const EMPTY: LibrarySnapshot = { version: 2, roots: [], documents: [], queueState: "idle", autoAnalyze: false };
export const LIBRARY_CHANGED = "knowledge-library-changed";

export function useLibraryController(adapter: LibraryAdapter | undefined, runModel: ((request: ModelRequest) => Promise<string>) | undefined, model: string, modelReady: boolean, editing: boolean) {
  const [data, setData] = useState(EMPTY);
  const latest = useRef(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [autoScan, setAutoScan] = useState(true);
  const alive = useRef(true);
  const lock = useRef(false);
  const cancelled = useRef(false);
  const configuring = useRef(false);
  const failures = useRef(new Set<string>());
  const consecutiveFailures = useRef(0);
  const apply = useCallback((next: LibrarySnapshot) => {
    if (!alive.current || (next.storeRevision ?? 0) < (latest.current.storeRevision ?? 0)) return;
    latest.current = next; setData(next);
  }, []);
  const operate = useCallback(async (operation: () => Promise<LibrarySnapshot>, message = "") => {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError("");
    try { const next = await operation(); apply(next); if (alive.current && message) setNotice(message); return next; }
    catch (reason) { if (alive.current) setError(String(reason)); return null; }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }, [apply]);
  const configure = useCallback(async (config: LibraryConfig) => {
    if (!adapter?.configure || configuring.current) return;
    configuring.current = true;
    if (config.queueState === "paused") cancelled.current = true;
    if (config.retryFailed) { failures.current.clear(); consecutiveFailures.current = 0; }
    try { apply(await adapter.configure(config)); }
    catch (reason) { if (alive.current) setError(String(reason)); }
    finally { configuring.current = false; }
  }, [adapter, apply]);
  useEffect(() => {
    alive.current = true;
    if (adapter) void operate(adapter.load);
    return () => { alive.current = false; cancelled.current = true; };
  }, [adapter, operate]);
  useEffect(() => {
    if (!adapter) return;
    const refresh = () => { if (!editing && !lock.current) void operate(adapter.load); };
    window.addEventListener(LIBRARY_CHANGED, refresh);
    const interval = autoScan ? window.setInterval(() => { if (!editing) void operate(adapter.scan); }, 30000) : undefined;
    return () => { window.removeEventListener(LIBRARY_CHANGED, refresh); if (interval !== undefined) window.clearInterval(interval); };
  }, [adapter, autoScan, editing, operate]);
  useEffect(() => {
    if (!adapter?.configure || !runModel || !modelReady || busy || lock.current || configuring.current || editing || data.queueState === "paused") return;
    if (data.queueState !== "running" && !data.autoAnalyze) return;
    const doc = pendingDocuments(data).find((candidate) => !failures.current.has(`${candidate.id}:${candidate.revision}`));
    if (!doc) {
      if (data.queueState === "running") void configure({ queueState: "idle" });
      return;
    }
    cancelled.current = false;
    void operate(async () => {
      try {
        const suggestion = await analyzeLibraryDocument(doc, model, runModel, categoryTree(data.documents).map((node) => node.path), {
          cancelled: () => cancelled.current || !alive.current,
          onProgress: (part, total) => { if (alive.current) setProgress(`${doc.path.split("/").pop()} · 第 ${part}/${total} 段`); }
        });
        if (cancelled.current || !alive.current) return latest.current;
        const next = await adapter.saveReview(aiReview(doc, suggestion));
        consecutiveFailures.current = 0;
        if (alive.current) setNotice(`已整理并保存：${doc.path}。可在分类和知识 tip 中查看。`);
        return next;
      } catch (reason) {
        if (cancelled.current || !alive.current) return latest.current;
        failures.current.add(`${doc.id}:${doc.revision}`);
        consecutiveFailures.current++;
        if (alive.current) setNotice(`「${doc.path}」整理失败，已保留原结果；可点击「重试失败项」。`);
        let next = adapter.recordError ? await adapter.recordError(doc.id, doc.revision, String(reason)) : latest.current;
        if (consecutiveFailures.current >= 3) {
          next = await adapter.configure!({ queueState: "paused" });
          if (alive.current) setError("连续 3 份资料整理失败，已暂停。请检查模型连接后重试失败项。");
        }
        return next;
      } finally { if (alive.current) setProgress(""); }
    });
  }, [adapter, runModel, model, modelReady, editing, busy, data, configure, operate]);
  return { data, busy, error, notice, progress, autoScan, setAutoScan, operate, configure, setNotice };
}
