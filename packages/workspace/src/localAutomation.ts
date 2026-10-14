import { buildVaultGraph, buildVaultIndex, type NoteFile } from "@knowledge-agent/core";
import { normalizeCanvasDocument, type KnowledgeCanvasDocument } from "@knowledge-agent/ui";
import type { KnowledgeWorkspaceAdapter, LoadedVault, ModelConnectionSettings } from "./KnowledgeWorkspace";
import { aiReview, categoryTree, parseLibrarySuggestion, searchLibrary, type KnowledgeCardReview } from "./libraryModel";
import { LIBRARY_CHANGED } from "./useLibraryController";
import { expandEvidence, retrieveLibrary, RETRIEVAL_PROPERTIES, EXPAND_PROPERTIES, type RetrievalRequest, type EvidenceAnchor } from "./libraryEvidence";

type ObjectValue = Record<string, any>;
type Schema = { type?: string | string[]; description?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; minimum?: number; maximum?: number; maxItems?: number };
export interface LocalAutomationMethod { name: string; description: string; parameters: Schema; mutates: boolean; changesOriginals: boolean }
export interface LocalAutomationAdapter {
  connect(methods: LocalAutomationMethod[], run: (method: string, params: ObjectValue) => Promise<unknown>): Promise<() => void>;
  openSettings(): void;
  openVaultPath(path: string): Promise<LoadedVault>;
  document(operation: string, root: string, params: ObjectValue): Promise<any>;
  native(method: string, params: ObjectValue): Promise<any>;
}
export interface AutomationContext {
  adapter: KnowledgeWorkspaceAdapter;
  state(): { sourceName: string; sourceKind: string; view: string; dirty: boolean; currentPath: string; theme: string };
  files(): NoteFile[];
  openVault(vault: LoadedVault): void;
  refresh(vault: LoadedVault): void;
  show(view: string, path?: string): void;
  filterGraph(query: string): void;
  setTheme(theme: "dark" | "light"): void;
  canvas(): KnowledgeCanvasDocument;
  canvasDirty(): boolean;
  setCanvas(value: KnowledgeCanvasDocument): void;
  setModel(value: ModelConnectionSettings): void;
}

const str = (description = ""): Schema => ({ type: "string", description });
const integer = (maximum = 10000000): Schema => ({ type: "integer", minimum: 0, maximum });
const bool: Schema = { type: "boolean" };
const strings = (maxItems: number): Schema => ({ type: "array", items: str(), maxItems });
const enumeration = (...values: string[]): Schema => ({ type: "string", enum: values });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const page = { offset: integer(), limit: { type: "integer", minimum: 1, maximum: 100 } as Schema };
const docVersion = { id: str("Document ID from library.search/read"), revision: str(), metadataVersion: integer() };
const noteVersion = { path: str("Vault-relative .md path"), expectedRevision: { type: ["string", "null"], description: "Use the revision from notes.read; null only creates a missing note." } as Schema };
function method(name: string, description: string, parameters = obj({}), mutates = false, changesOriginals = false): LocalAutomationMethod {
  return { name, description, parameters, mutates, changesOriginals };
}

export const LOCAL_AUTOMATION_METHODS: LocalAutomationMethod[] = [
  method("app.state", "Read current view, source, unsaved state, and model settings (no secrets)."),
  method("app.show", "Switch the existing main view; graph shows note links, tags shows the tag map; no new feature tabs.", obj({ view: enumeration("graph", "tags", "files", "canvas", "library", "typewords", "explorer", "bases", "slides", "trash", "settings", "agent", "cli"), path: str("Optional note path for slides") }, ["view"]), true),
  method("app.theme", "Set and persist application theme.", obj({ theme: enumeration("dark", "light") }), true),
  method("vault.open", "Explicitly open a local Markdown vault or browse a folder read-only; never scans the whole device.", obj({ path: str("Absolute folder selected by the user"), mode: enumeration("notes", "files") }, ["path"]), true),
  method("files.list", "List one directory within the open source; directories are not read recursively.", obj({ path: str("Relative directory, empty for source root") }, [])),
  method("files.preview", "Preview a supported file inside the open source; format limits are returned explicitly.", obj({ path: str("Source-relative file path") })),
  method("notes.list", "Search current Markdown notes by path or content. Returns names, not full bodies.", obj({ query: str(), ...page }, [])),
  method("notes.read", "Read a Markdown note and its disk revision; missing files return content/revision null.", obj({ path: str() })),
  method("notes.open", "Open an existing note in the editor.", obj({ path: str() }), true),
  method("notes.write", "Create or replace a Markdown note; checks disk revision, preserves undo backup, refreshes UI.", obj({ ...noteVersion, content: str() }), true, true),
  method("notes.delete", "Move a note to the app's recoverable 30-day trash, after revision check.", obj(noteVersion), true, true),
  method("notes.undo", "Restore a previous CLI note edit by backupId and current disk revision.", obj({ ...noteVersion, backupId: str() }), true, true),
  method("trash.list", "List recoverable notes in the open vault."),
  method("trash.read", "Read a note in the trash without restoring it.", obj({ id: str() })),
  method("trash.restore", "Restore a trashed note with the app's normal collision handling.", obj({ id: str() }), true, true),
  method("graph.read", "Return the note graph: links derived from the current Markdown vault, not inferred relationships."),
  method("graph.filter", "Set the visible note graph filter.", obj({ query: str() }), true),
  method("canvas.read", "Read the saved canvas and revision; a new canvas is supplied when none is saved."),
  method("canvas.write", "Replace the saved canvas with cards, connections and groups; checks revision and saves undo copy.", obj({ expectedRevision: noteVersion.expectedRevision, document: { type: "object" } }), true, true),
  method("library.status", "Read watched folders, document counts, categories and AI queue state."),
  method("library.add_folder", "Register an explicitly selected folder. Call library.scan separately to read files.", obj({ path: str("Absolute folder path") }), true),
  method("library.scan", "Scan the registered folders using the app's normal incremental indexer; no AI calls.", obj({}), true),
  method("library.update_root", "Pause, resume or unregister one watched root; source files are not deleted.", obj({ id: str(), action: enumeration("pause", "resume", "remove") }), true),
  method("library.search", "Search names, indexed text, labels and tips; use document IDs for subsequent calls.", obj({ query: str(), filter: enumeration("all", "pending", "reviewed", "ignored", "issues"), ...page }, [])),
  method("library.read", "Read indexed source text in pages plus revisions needed for saving annotations.", obj({ id: str(), offset: integer() }, ["id"])),
  method("library.retrieve", "Retrieve bounded cross-file excerpts with indexed-text source locations, exact-text duplicate groups and a versioned plan. Read-only; no model calls or disk scans. Reuse request + planId + nextOffset for subsequent batches. Candidate matches are not full-document reads.", obj(RETRIEVAL_PROPERTIES, ["query"])),
  method("library.expand", "Expand an excerpt using id, revision, textHash, start and end from library.retrieve. Rejects changed indexed text. Locations are UTF-16 index offsets, not PDF pages. No disk freshness check.", obj(EXPAND_PROPERTIES, ["id", "revision", "textHash", "start", "end"])),
  method("library.annotate", "Save Codex-generated summary, categories, tags and source-quoted tips. Preserves user-locked classification. No model API call or source write.", obj({ ...docVersion, summary: str(), categories: strings(12), tags: strings(20), tips: { type: "array", maxItems: 16, items: obj({ content: str(), quote: str("Exact continuous source excerpt") }) } }), true),
  method("library.configure", "Control the existing Agent's AI queue. Running/autoAnalyze can invoke the configured model.", obj({ autoAnalyze: bool, queueState: enumeration("idle", "running", "paused"), retryFailed: bool }, []), true),
  method("library.source_write", "Replace a supported text source with revision check and existing source backup. Does not support editing PDF/DOCX binaries.", obj({ id: str(), revision: str(), content: str() }), true, true),
  method("library.source_restore", "Undo a source edit using the app's existing revision-checked backup.", obj({ id: str(), revision: str() }), true, true),
  method("library.source_open", "Open the indexed original in its system application.", obj({ id: str() }), true),
  method("cards.list", "Read annotation cards, including offline source metadata; no originals need to be transferred.", obj({ query: str(), ...page }, [])),
  method("cards.update", "Explicitly change a card's manual categories/tags/summary/sharing scope using expectedVersion; affects only app annotations.", obj({ id: str(), expectedVersion: integer(), summary: str(), categories: strings(12), tags: strings(20), scope: enumeration("local", "shared") }), true),
  method("cards.export", "Return only cards marked shared in export format. No original text, attachments or local paths; does not upload."),
  method("typewords.status", "Read plugin process availability; learning records remain owned by TypeWords."),
  method("typewords.start", "Start the bundled English learning plugin and open its app view.", obj({}), true),
  method("typewords.stop", "Stop only the plugin process owned by this app and disable automatic startup.", obj({}), true),
  method("typewords.use_bundled", "Switch back to the bundled TypeWords, preserving learning records.", obj({}), true),
  method("settings.model", "Read selected Agent model and credential status; API keys are never returned."),
  method("settings.set_model", "Change the existing Agent model settings; does not send a model request.", obj({ provider: enumeration("codex", "deepseek"), model: str(), agentMode: enumeration("daily", "organizer", "linker") }), true),
];

export function validateAutomationParams(schema: Schema, value: unknown, path = "params"): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type && !types.includes(kind) && !(types.includes("integer") && typeof value === "number" && Number.isInteger(value))) throw new Error(`${path}: 参数类型应为 ${types.join("/")}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: 无效选项`);
  if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path}: 数值超出范围`);
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path}: 项目过多`);
    value.forEach((item, i) => schema.items && validateAutomationParams(schema.items, item, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    const record = value as ObjectValue;
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) throw new Error(`${path}.${key}: 缺少参数`);
    for (const [key, item] of Object.entries(record)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`${path}.${key}: 未知参数`);
      if (schema.properties?.[key]) validateAutomationParams(schema.properties[key], item, `${path}.${key}`);
    }
  }
}
function paginate<T>(items: T[], p: ObjectValue) {
  const offset = p.offset ?? 0, limit = p.limit ?? 30;
  return { total: items.length, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}
function requireFunction<T>(fn: T | undefined): T { if (!fn) throw new Error("当前平台未开放该能力。"); return fn; }

export async function runLocalAutomation(context: AutomationContext, name: string, p: ObjectValue): Promise<unknown> {
  const definition = LOCAL_AUTOMATION_METHODS.find(m => m.name === name);
  if (!definition) throw new Error("未知 CLI 命令。");
  validateAutomationParams(definition.parameters, p);
  if (definition.mutates) {
    const detail = { reason: "", method: name };
    window.dispatchEvent(new CustomEvent("knowledge-cli-before-change", { detail }));
    if (detail.reason) throw new Error(detail.reason);
  }
  const a = context.adapter, bridge = requireFunction(a.automation), state = context.state();
  const writableVault = () => {
    if (state.sourceKind !== "desktop") throw new Error("请先用 vault.open 连接可写的本地笔记文件夹。");
    if (state.dirty) throw new Error("界面中有未保存内容或正在保存，请先完成保存再执行。");
  };
  const sourceRoot = () => {
    if (!["desktop", "structure"].includes(state.sourceKind)) throw new Error("请先打开本地文件夹。");
    return state.sourceName;
  };
  const library = () => requireFunction(a.library);
  const changed = (result: unknown) => { window.dispatchEvent(new Event(LIBRARY_CHANGED)); return result; };
  const libraryStatus = async () => {
    const data = await library().load();
    return { roots: data.roots, documents: data.documents.length, categories: categoryTree(data.documents), autoAnalyze: data.autoAnalyze, queueState: data.queueState, storeRevision: data.storeRevision };
  };
  switch (name) {
    case "app.state": return { ...state, noteCount: context.files().length, model: await a.loadModelSettings?.() };
    case "app.show": context.show(p.view, p.path); return { view: p.view };
    case "app.theme": context.setTheme(p.theme); return { theme: p.theme };
    case "vault.open": {
      if (state.dirty || context.canvasDirty()) throw new Error("当前有未保存内容，请先保存再切换文件夹。");
      const vault = p.mode === "files" ? await requireFunction(a.openReadOnlyRoot)(p.path) : await bridge.openVaultPath(p.path);
      context.openVault(vault); return { sourceName: vault.sourceName, sourceKind: vault.sourceKind, noteCount: vault.files.length };
    }
    case "files.list": return requireFunction(a.listReadOnlyDirectory)(sourceRoot(), p.path ?? "");
    case "files.preview": return requireFunction(a.readReadOnlyFile)(sourceRoot(), p.path);
    case "notes.list": return paginate(context.files().filter(f => `${f.path}\n${f.content}`.toLowerCase().includes((p.query ?? "").toLowerCase())).map(f => ({ path: f.path, characters: f.content.length })), p);
    case "notes.open":
      if (!context.files().some(f => f.path === p.path)) throw new Error("笔记不存在。");
      context.show("note", p.path); return { opened: p.path };
    case "notes.read": writableVault(); return bridge.document(name, state.sourceName, p);
    case "notes.write": case "notes.delete": case "notes.undo": {
      writableVault();
      const result = await bridge.document(name, state.sourceName, p);
      context.refresh(await bridge.openVaultPath(state.sourceName));
      return result;
    }
    case "trash.list": writableVault(); return requireFunction(a.listTrashEntries)();
    case "trash.read": writableVault(); return requireFunction(a.previewTrashEntry)(p.id);
    case "trash.restore": {
      writableVault(); const result = await requireFunction(a.restoreTrashEntry)(p.id);
      context.refresh(await bridge.openVaultPath(state.sourceName)); return { restored: true, message: result.message };
    }
    case "graph.read": return buildVaultGraph(buildVaultIndex(context.files()));
    case "graph.filter": context.filterGraph(p.query); context.show("graph"); return { query: p.query };
    case "canvas.read": {
      writableVault(); const saved = await bridge.document(name, state.sourceName, {});
      return { document: saved.content ? JSON.parse(saved.content) : context.canvas(), revision: saved.revision, hasUnsavedChanges: context.canvasDirty() };
    }
    case "canvas.write": {
      writableVault(); if (context.canvasDirty()) throw new Error("画布正在保存或有未保存改动。");
      const value = p.document;
      if (value.version !== 1 || !Array.isArray(value.cards) || !Array.isArray(value.connections) || !Array.isArray(value.groups)) throw new Error("请以 canvas.read 返回的完整 document 为基础修改。");
      const normalized = normalizeCanvasDocument(value);
      if (normalized.cards.length !== value.cards.length || normalized.connections.length !== value.connections.length || normalized.groups.length !== value.groups.length || new Set(normalized.cards.map(c => c.id)).size !== normalized.cards.length) throw new Error("画布包含无效或重复元素，已拒绝保存。");
      const result = await bridge.document(name, state.sourceName, { expectedRevision: p.expectedRevision, content: JSON.stringify(normalized) });
      context.setCanvas(normalized); context.show("canvas"); return result;
    }
    case "library.status": return libraryStatus();
    case "library.add_folder": await bridge.native(name, p); changed(null); return libraryStatus();
    case "library.scan": await library().scan(); changed(null); return libraryStatus();
    case "library.update_root": await library().updateRoot(p.id, p.action); changed(null); return libraryStatus();
    case "library.retrieve": return retrieveLibrary(await library().load(), p as RetrievalRequest);
    case "library.expand": return expandEvidence(await library().load(), p as EvidenceAnchor & { contextChars?: number });
    case "library.search": {
      const data = await library().load();
      return paginate(searchLibrary(data.documents, p.query ?? "", p.filter ?? "all").map(({ text, ...doc }) => ({ ...doc, textCharacters: text.length })), p);
    }
    case "library.read": {
      const doc = (await library().load()).documents.find(d => d.id === p.id);
      if (!doc) throw new Error("资料不存在，请先搜索。");
      const offset = p.offset ?? 0;
      return { ...doc, text: doc.text.slice(offset, offset + 12000), totalCharacters: doc.text.length, nextOffset: offset + 12000 < doc.text.length ? offset + 12000 : null };
    }
    case "library.annotate": {
      const doc = (await library().load()).documents.find(d => d.id === p.id);
      if (!doc || doc.revision !== p.revision || (doc.metadataVersion ?? 0) !== p.metadataVersion) throw new Error("资料版本已改变，请重新读取。");
      const review = aiReview(doc, parseLibrarySuggestion(JSON.stringify(p), doc.text));
      await library().saveReview(review);
      return changed({ saved: true, originalFileModified: false, classificationPreserved: review.classificationLocked });
    }
    case "library.configure": await requireFunction(library().configure)(p); changed(null); return libraryStatus();
    case "library.source_write": case "library.source_restore": {
      if (state.dirty) throw new Error("笔记编辑器有未保存改动，请先保存。");
      if (name.endsWith("write")) await requireFunction(library().saveSource)(p.id, p.revision, p.content);
      else await requireFunction(library().restoreSource)(p.id, p.revision);
      return changed({ saved: true, originalFileModified: true });
    }
    case "library.source_open": await requireFunction(library().openSource)(p.id); return { opened: true };
    case "cards.list": {
      const records = (await library().load()).knowledgeCards?.records ?? [];
      return paginate(records.filter(r => JSON.stringify(r.card).toLowerCase().includes((p.query ?? "").toLowerCase())), p);
    }
    case "cards.update": await requireFunction(library().saveKnowledgeCard)(p as KnowledgeCardReview); return changed({ saved: true, originalFileModified: false });
    case "cards.export": return requireFunction(library().previewKnowledgeCards)();
    case "typewords.status": return bridge.native(name, p);
    case "typewords.start":
      window.localStorage.setItem("knowledge-agent.plugins.typewords.enabled.v1", "true");
      await requireFunction(a.typewords).ensureStarted();
      window.dispatchEvent(new Event("typewords-preference-changed"));
      context.show("typewords"); return { running: true };
    case "typewords.stop":
      window.localStorage.setItem("knowledge-agent.plugins.typewords.enabled.v1", "false");
      window.dispatchEvent(new Event("typewords-preference-changed"));
      await bridge.native(name, p); return { stoppedOwnedProcess: true };
    case "typewords.use_bundled":
      await requireFunction(requireFunction(a.typewords).useBundled)();
      window.dispatchEvent(new Event("typewords-preference-changed")); return { selected: "bundled" };
    case "settings.model": return requireFunction(a.loadModelSettings)();
    case "settings.set_model": {
      const value = await requireFunction(a.saveModelSettings)(p as Pick<ModelConnectionSettings, "provider" | "model" | "agentMode">);
      context.setModel(value); return value;
    }
    default: throw new Error("命令未实现。");
  }
}
