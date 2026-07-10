import {
  NoteAgentKernel,
  classifyRestore,
  isStressGraphGenerationRequest,
  type AgentDiff,
  type AgentMessage,
  type AgentPermission,
  type AgentTool,
  type ModelRequest,
  type ModelTurnResponse
} from "@knowledge-agent/agent";
import {
  buildNoteGraph,
  buildSafetyManifest,
  buildVaultGraph,
  buildVaultIndex,
  ensureMarkdownPath,
  getNote,
  normalizePath,
  type NoteFile,
  type ParsedNote,
  type SafetyManifest
} from "@knowledge-agent/core";
import { AgentConsole, FileTree, NoteEditor, StarGraph, type FileTreeFolder, type Viewport } from "@knowledge-agent/ui";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  HardDrive,
  Network,
  PanelLeft,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

const GRAPH_TAB_ID = "graph-overview";
const EXPLORER_TAB_ID = "vault-explorer";

type CenterMode = "graph" | "edit" | "explorer";
type EditorMode = "edit" | "preview";
type SourceKind = "demo" | "browser-directory" | "desktop";
type DraftChangeKind = "created" | "modified" | "deleted";
type AgentMode = "daily" | "organizer" | "linker";

const AGENT_MODEL_OPTIONS = [
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "复杂整理、长上下文分析、重要写作提案。" },
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "快速总结、轻量问答、低延迟浏览辅助。" }
];

const AGENT_MODE_OPTIONS = [
  { value: "daily", label: "日常笔记 Agent", description: "围绕当前笔记做总结、问答、轻量改写和安全提案。" },
  { value: "organizer", label: "整理归档 Agent", description: "更关注标题、层级、MOC、目录和跨文件整理建议。" },
  { value: "linker", label: "建链图谱 Agent", description: "更关注双链、反链、未解析概念和语义关系候选。" }
];

const AGENT_MODE_PROMPTS: Record<AgentMode, string> = {
  daily: "Active Agent mode: daily note copilot. Help the user understand and continue the current note. Prefer concise answers and safe diff proposals.",
  organizer:
    "Active Agent mode: organizer. Focus on hierarchy, note structure, MOC creation, naming, splitting, merging, and storage relationships. Prefer explicit diff proposals.",
  linker:
    "Active Agent mode: link graph builder. Focus on outlinks, backlinks, unresolved concepts, semantic relationship candidates, and graph-friendly explanations."
};

const AGENT_MODE_REASONING: Record<AgentMode, ModelRequest["reasoningEffort"]> = {
  daily: "medium",
  organizer: "high",
  linker: "medium"
};

export interface LoadedVault {
  files: NoteFile[];
  sourceName: string;
  sourceKind: SourceKind;
  safetyManifest: SafetyManifest;
  unsupportedReason?: string;
}

export interface DraftChange {
  path: string;
  kind: DraftChangeKind;
  before?: string;
  after?: string;
}

export interface TrashEntry {
  id: string;
  originalPath: string;
  trashPath: string;
  deletedAtMs: number;
  purgeAfterMs: number;
}

export interface WriteChangesResult {
  message: string;
  files?: NoteFile[];
  safetyManifest?: SafetyManifest;
  trashEntries?: TrashEntry[];
}

export interface ModelConnectionSettings {
  provider: string;
  model: string;
  agentMode: string;
  deepSeekApiKeyConfigured: boolean;
}

export interface KnowledgeWorkspaceAdapter {
  canOpenVault: boolean;
  loadInitialVault(): Promise<LoadedVault> | LoadedVault;
  openVault(): Promise<LoadedVault>;
  loadDemoVault(): LoadedVault;
  createVaultFolder?(folderName: string): Promise<LoadedVault>;
  createInterlinkedVault?(options: InterlinkedVaultRequest): Promise<LoadedVault>;
  createWordDocumentOnDesktop?(request: WordDocumentRequest): Promise<WordDocumentResult>;
  watchVault?(onChange: (vault: LoadedVault, changedPaths: string[]) => void): Promise<() => void> | (() => void);
  writeChanges?(changes: DraftChange[]): Promise<WriteChangesResult>;
  listTrashEntries?(): Promise<TrashEntry[]> | TrashEntry[];
  restoreTrashEntry?(id: string): Promise<WriteChangesResult> | WriteChangesResult;
  loadModelSettings?(): Promise<ModelConnectionSettings> | ModelConnectionSettings;
  saveModelSettings?(settings: Pick<ModelConnectionSettings, "provider" | "model" | "agentMode">): Promise<ModelConnectionSettings> | ModelConnectionSettings;
  saveDeepSeekApiKey?(apiKey: string): Promise<ModelConnectionSettings> | ModelConnectionSettings;
  runModel?(request: ModelRequest): Promise<string>;
  runModelTurn?(request: ModelRequest): Promise<ModelTurnResponse>;
  getSourceLabel?(sourceKind: SourceKind): string;
}

export interface InterlinkedVaultRequest {
  parentPath: string;
  folderName: string;
  count: number;
}

export interface WordDocumentRequest {
  name: string;
}

export interface WordDocumentResult {
  path: string;
}

interface WorkspaceTab {
  id: string;
  mode: CenterMode;
  path?: string;
}

type ClipboardMode = "copy" | "cut";

type TreeContextMenu =
  | { type: "note"; x: number; y: number; note: ParsedNote }
  | { type: "folder"; x: number; y: number; folder: FileTreeFolder };

interface NoteClipboard {
  mode: ClipboardMode;
  paths: string[];
}

interface PendingGraphDelete {
  path: string;
  title: string;
  preview: string;
}

interface TrashAuthorization {
  permission: AgentPermission;
  reason: string;
  reviewedAtMs: number;
}

interface ExplorerModel {
  drives: Array<{ name: string; count: number }>;
  folderCount: number;
  notes: ReturnType<typeof buildVaultIndex>["notes"];
  totalNotes: number;
}

interface AgentSessionSnapshot {
  id: string;
  title: string;
  messages: AgentMessage[];
  diffs: AgentDiff[];
  prompt: string;
  pinnedPaths: string[];
  savedAt: string;
}

interface AgentConversationSession {
  id: string;
  label: string;
  messages: AgentMessage[];
  diffs: AgentDiff[];
  prompt: string;
  pinnedPaths: string[];
  createdAt: string;
}

function createAgentConversationSession(label: string): AgentConversationSession {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    messages: [],
    diffs: [],
    prompt: "",
    pinnedPaths: [],
    createdAt: new Date().toISOString()
  };
}

export function updateConversationById<T extends { id: string }>(items: T[], id: string, updater: (item: T) => T): T[] {
  return items.map((item) => (item.id === id ? updater(item) : item));
}

export function KnowledgeWorkspace({ adapter }: { adapter: KnowledgeWorkspaceAdapter }) {
  const initialVault = useMemo(() => adapter.loadDemoVault(), [adapter]);
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [baseFiles, setBaseFiles] = useState<NoteFile[]>(initialVault.files);
  const [sourceName, setSourceName] = useState("demo vault");
  const [sourceKind, setSourceKind] = useState<SourceKind>("demo");
  const [currentPath, setCurrentPath] = useState("");
  const [centerMode, setCenterMode] = useState<CenterMode>("graph");
  const [editorMode, setEditorMode] = useState<EditorMode>("preview");
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([{ id: GRAPH_TAB_ID, mode: "graph" }]);
  const [activeTabId, setActiveTabId] = useState(GRAPH_TAB_ID);
  const [agentSessions, setAgentSessions] = useState<AgentConversationSession[]>(() => [createAgentConversationSession("1")]);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<string | null>(null);
  const [agentSessionHistory, setAgentSessionHistory] = useState<AgentSessionSnapshot[]>([]);
  const [agentSessionNumber, setAgentSessionNumber] = useState(1);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashAuthorizations, setTrashAuthorizations] = useState<Record<string, TrashAuthorization>>({});
  const [restoringTrashId, setRestoringTrashId] = useState<string | null>(null);
  const [runningAgentSessionIds, setRunningAgentSessionIds] = useState<Set<string>>(() => new Set());
  const [modelSettings, setModelSettings] = useState<ModelConnectionSettings>({
    provider: adapter.runModel ? "deepseek" : "offline",
    model: adapter.runModel ? "deepseek-v4-pro" : "offline",
    agentMode: "daily",
    deepSeekApiKeyConfigured: false
  });
  const [agentApiKeyInput, setAgentApiKeyInput] = useState("");
  const [savingAgentKey, setSavingAgentKey] = useState(false);
  const [modelSettingsLoaded, setModelSettingsLoaded] = useState(!adapter.loadModelSettings);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentKeyDialogOpen, setAgentKeyDialogOpen] = useState(false);
  const [agentKeyDialogDismissed, setAgentKeyDialogDismissed] = useState(false);
  const [status, setStatus] = useState("Demo 已载入。真实 vault 只会在浏览器本地读取，不上传。");
  const [sourceSafety, setSourceSafety] = useState(initialVault.safetyManifest);
  const [leftVisible, setLeftVisible] = useState(true);
  const [noteFilter, setNoteFilter] = useState("");
  const [explorerQuery, setExplorerQuery] = useState("");
  const [explorerScope, setExplorerScope] = useState("");
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false);
  const [graphFilter, setGraphFilter] = useState("");
  const [graphViewport, setGraphViewport] = useState<Viewport | null>(null);
  const [graphRadius, setGraphRadius] = useState(1);
  const [graphShowLabels, setGraphShowLabels] = useState(true);
  const [graphShowRelated, setGraphShowRelated] = useState(true);
  const [changesOpen, setChangesOpen] = useState(false);
  const [writingChanges, setWritingChanges] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [newVaultName, setNewVaultName] = useState("新知识库");
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenu | null>(null);
  const [graphDeleteTarget, setGraphDeleteTarget] = useState<PendingGraphDelete | null>(null);
  const [noteClipboard, setNoteClipboard] = useState<NoteClipboard | null>(null);
  const [leftWidth, setLeftWidth] = useState(248);
  const [agentWidth, setAgentWidth] = useState(380);
  const shellRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const selectedAgentMode = normalizeAgentMode(modelSettings.agentMode);
  const selectedAgentModel = normalizeAgentModel(modelSettings.model, Boolean(adapter.runModel));
  const agentModelOptions = adapter.runModel
    ? AGENT_MODEL_OPTIONS
    : [{ value: "offline", label: "Offline tools", description: "仅使用本地笔记工具，不调用在线模型。" }];
  const appAgentTools = useMemo<AgentTool[]>(
    () => [
      {
        name: "app_open_note",
        description: "Open an existing Markdown note in the app by vault-relative path.",
        parameters: objectSchema({ path: stringSchema("Vault-relative Markdown path to open.") }, ["path"]),
        run(input) {
          const { path } = parseAgentToolArguments(input);
          const notePath = ensureMarkdownPath(normalizePath(String(path ?? "")));
          if (!isVaultRelativeNotePath(notePath)) return `Blocked invalid note path: ${notePath || "(empty)"}`;
          const exists = filesRef.current.some((file) => normalizePath(file.path).toLowerCase() === notePath.toLowerCase());
          if (!exists) return `Cannot open note because it does not exist: ${notePath}`;
          openNoteTab(notePath);
          setStatus(`Agent 已打开笔记：${notePath}`);
          return `Opened note: ${notePath}`;
        }
      },
      {
        name: "app_create_note",
        description: "Create and open a Markdown note draft. Disk write-back still requires user confirmation.",
        parameters: objectSchema(
          {
            path: stringSchema("Vault-relative Markdown path for the new note."),
            content: stringSchema("Complete Markdown content for the new note.")
          },
          ["path", "content"]
        ),
        run(input) {
          const { path, content } = parseAgentToolArguments(input);
          const notePath = ensureMarkdownPath(normalizePath(String(path ?? "")));
          const safety = buildSafetyManifest([notePath]);
          if (!isVaultRelativeNotePath(notePath) || safety.excluded.length > 0) return `Blocked unsafe note path: ${notePath || "(empty)"}`;
          if (filesRef.current.some((file) => normalizePath(file.path).toLowerCase() === notePath.toLowerCase())) {
            return `Cannot create note because it already exists: ${notePath}`;
          }
          const nextFiles = [...filesRef.current, { path: notePath, content: String(content ?? ""), modifiedAt: new Date().toISOString() }];
          filesRef.current = nextFiles;
          setFiles(nextFiles);
          markDirty(notePath);
          openNoteTab(notePath);
          setStatus(`Agent 已创建笔记草稿：${notePath}`);
          return `Created note draft: ${notePath}. Disk write-back still requires user confirmation.`;
        }
      },
      {
        name: "app_replace_note",
        description: "Replace an existing note's Markdown content in the app session. Disk write-back still requires user confirmation.",
        parameters: objectSchema(
          {
            path: stringSchema("Vault-relative Markdown path to update."),
            content: stringSchema("Complete replacement Markdown content.")
          },
          ["path", "content"]
        ),
        run(input) {
          const { path, content } = parseAgentToolArguments(input);
          const notePath = ensureMarkdownPath(normalizePath(String(path ?? "")));
          if (!isVaultRelativeNotePath(notePath)) return `Blocked invalid note path: ${notePath || "(empty)"}`;
          if (!filesRef.current.some((file) => normalizePath(file.path).toLowerCase() === notePath.toLowerCase())) {
            return `Cannot update note because it does not exist: ${notePath}`;
          }
          const nextFiles = filesRef.current.map((file) =>
              normalizePath(file.path).toLowerCase() === notePath.toLowerCase()
                ? { ...file, content: String(content ?? ""), modifiedAt: new Date().toISOString() }
                : file
          );
          filesRef.current = nextFiles;
          setFiles(nextFiles);
          markDirty(notePath);
          openNoteTab(notePath);
          setStatus(`Agent 已修改笔记草稿：${notePath}`);
          return `Updated note draft: ${notePath}. Disk write-back still requires user confirmation.`;
        }
      },
      {
        name: "app_generate_stress_graph",
        description:
          "Generate a realistic high-complexity test knowledge set inside the current vault: one folder, an overview note, many content-rich Markdown notes, and dense cross-links. Use this when the user asks to create or simulate a complex relationship graph, not build_graph.",
        parameters: objectSchema(
          {
            folderName: stringSchema("Vault-relative folder name for the generated test set."),
            count: numberSchema("Total Markdown note count, from 8 to 80."),
            topic: stringSchema("Topic used to generate realistic note titles and content.")
          },
          ["folderName", "count", "topic"]
        ),
        run(input) {
          const { folderName, count, topic } = parseAgentToolArguments(input);
          const requestedFolder = normalizePath(String(folderName ?? "复杂关系图谱测试")).replace(/\/+$/g, "");
          if (!isVaultRelativeNotePath(`${requestedFolder}/index.md`)) {
            return `Blocked invalid test folder path: ${requestedFolder || "(empty)"}`;
          }
          const safeCount = clampNumber(Math.round(Number(count) || 30), 8, 80);
          const resolvedFolder = uniqueGeneratedFolder(filesRef.current, requestedFolder);
          const generated = buildStressGraphNotes(resolvedFolder, safeCount, String(topic ?? "复杂知识系统"));
          const nextFiles = [...filesRef.current, ...generated];
          filesRef.current = nextFiles;
          setFiles(nextFiles);
          setGraphFilter("");
          setCenterMode("graph");
          setActiveTabId(GRAPH_TAB_ID);
          setStatus(`Agent 已生成 ${generated.length} 篇高复杂度图谱测试文档：${resolvedFolder}`);
          return `已在“${resolvedFolder}”中生成 ${generated.length} 篇互相关联、包含实际内容的 Markdown 文档，并切换到关系图谱。当前先保存为 App 草稿，确认“写回本地”后才会成为磁盘文件。`;
        }
      },
      {
        name: "app_show_graph",
        description: "Switch the center workspace to the knowledge graph. Use this to show the graph UI; build_graph only returns analysis data.",
        parameters: objectSchema({}, []),
        run() {
          setCenterMode("graph");
          setActiveTabId(GRAPH_TAB_ID);
          setStatus("Agent 已切换到关系图谱。");
          return "Knowledge graph is now visible.";
        }
      },
      {
        name: "app_filter_graph",
        description: "Set the graph filter and switch the center workspace to the graph.",
        parameters: objectSchema({ query: stringSchema("Text used to filter or highlight graph notes.") }, ["query"]),
        run(input) {
          const { query } = parseAgentToolArguments(input);
          setGraphFilter(String(query ?? ""));
          setCenterMode("graph");
          setActiveTabId(GRAPH_TAB_ID);
          return `Graph filter set to: ${String(query ?? "")}`;
        }
      },
      {
        name: "app_filter_notes",
        description: "Filter the left note tree and focus the note search field.",
        parameters: objectSchema({ query: stringSchema("Text used to filter notes.") }, ["query"]),
        run(input) {
          const { query } = parseAgentToolArguments(input);
          const text = String(query ?? "");
          setLeftVisible(true);
          setNoteFilter(text);
          requestAnimationFrame(() => searchInputRef.current?.focus());
          return `Note tree filter set to: ${text}`;
        }
      },
      {
        name: "app_show_explorer",
        description: "Open the app's storage explorer view.",
        parameters: objectSchema({}, []),
        run() {
          openExplorerTab();
          return "Storage explorer is now visible.";
        }
      },
      {
        name: "app_request_delete_note",
        description: "Open the app's deletion confirmation dialog for an existing note. This never deletes immediately.",
        parameters: objectSchema({ path: stringSchema("Vault-relative Markdown path to request deletion for.") }, ["path"]),
        run(input) {
          const { path } = parseAgentToolArguments(input);
          const notePath = ensureMarkdownPath(normalizePath(String(path ?? "")));
          if (!isVaultRelativeNotePath(notePath)) return `Blocked invalid note path: ${notePath || "(empty)"}`;
          const note = filesRef.current.find((file) => normalizePath(file.path).toLowerCase() === notePath.toLowerCase());
          if (!note) return `Cannot request deletion because the note does not exist: ${notePath}`;
          setGraphDeleteTarget({
            path: note.path,
            title: leafName(note.path),
            preview: firstUsefulLines(note.content)
          });
          return `Deletion confirmation opened for: ${note.path}`;
        }
      }
    ],
    []
  );
  const agent = useMemo(
    () =>
      new NoteAgentKernel({
        ...(adapter.runModel
          ? {
              provider: {
                name: "workspace-model",
                generate: (request) =>
                  adapter.runModel?.({
                    ...request,
                    model: selectedAgentModel,
                    reasoningEffort: request.reasoningEffort ?? AGENT_MODE_REASONING[selectedAgentMode],
                    system: `${request.system}\n\n${AGENT_MODE_PROMPTS[selectedAgentMode]}`
                  }) ?? Promise.resolve(""),
                generateTurn: adapter.runModelTurn
                  ? (request) =>
                      adapter.runModelTurn!({
                        ...request,
                        model: selectedAgentModel,
                        reasoningEffort: request.reasoningEffort ?? AGENT_MODE_REASONING[selectedAgentMode],
                        system: `${request.system}\n\n${AGENT_MODE_PROMPTS[selectedAgentMode]}`
                      })
                  : undefined
              }
            }
          : {}),
        tools: appAgentTools
      }),
    [adapter, appAgentTools, selectedAgentMode, selectedAgentModel]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(adapter.loadInitialVault())
      .then((vault) => {
        if (!cancelled) {
          applyLoadedVault(vault, vault.unsupportedReason ?? "知识库已载入。");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          applyLoadedVault(adapter.loadDemoVault(), error instanceof Error ? error.message : "未能载入知识库，已切换到 Demo。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  useEffect(() => {
    if (!adapter.loadModelSettings) {
      setModelSettingsLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.resolve(adapter.loadModelSettings())
      .then((settings) => {
        if (!cancelled) {
          setModelSettings(normalizeModelSettings(settings, Boolean(adapter.runModel)));
          setModelSettingsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setModelSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  useEffect(() => {
    if (
      modelSettingsLoaded &&
      adapter.saveDeepSeekApiKey &&
      !modelSettings.deepSeekApiKeyConfigured &&
      !agentKeyDialogDismissed
    ) {
      setAgentKeyDialogOpen(true);
    }
  }, [adapter.saveDeepSeekApiKey, agentKeyDialogDismissed, modelSettings.deepSeekApiKeyConfigured, modelSettingsLoaded]);

  useEffect(() => {
    if (!treeContextMenu) return;
    function close() {
      setTreeContextMenu(null);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [treeContextMenu]);

  useEffect(() => {
    if (!graphDeleteTarget) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setGraphDeleteTarget(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [graphDeleteTarget]);

  useEffect(() => {
    if (!storageOpen) return;
    function closeStoragePanel(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".storage-panel") || target?.closest('[aria-label="存储空间"]')) return;
      setStorageOpen(false);
    }
    window.addEventListener("pointerdown", closeStoragePanel);
    return () => window.removeEventListener("pointerdown", closeStoragePanel);
  }, [storageOpen]);

  const index = useMemo(() => buildVaultIndex(files), [files]);
  const currentNote = currentPath ? getNote(index, currentPath) : undefined;
  const graph = useMemo(() => buildVaultGraph(index), [index]);
  const currentNoteGraph = useMemo(() => (currentPath ? buildNoteGraph(index, currentPath) : undefined), [currentPath, index]);
  const tags = useMemo(() => summarizeTags(index.notes.flatMap((note) => note.tags)), [index.notes]);
  const filteredNotes = useMemo(() => filterNotes(index.notes, noteFilter), [index.notes, noteFilter]);
  const explorerModel = useMemo(() => buildExplorerModel(index.notes, explorerQuery, explorerScope), [explorerQuery, explorerScope, index.notes]);
  const draftChanges = useMemo(() => buildDraftChanges(baseFiles, files), [baseFiles, files]);
  const dirtyPaths = useMemo(() => draftChanges.map((change) => change.path), [draftChanges]);
  const dirtySafety = buildSafetyManifest(dirtyPaths);
  const directoryPickerAvailable = adapter.canOpenVault;
  const sourceLabel = adapter.getSourceLabel?.(sourceKind) ?? (sourceKind === "demo" ? "Demo" : "本地 vault");
  const activeAgentSession = agentSessions.find((session) => session.id === activeAgentSessionId) ?? agentSessions[0];
  const activeAgentSessionKey = activeAgentSession?.id ?? "";
  const messages = activeAgentSession?.messages ?? [];
  const diffs = activeAgentSession?.diffs ?? [];
  const prompt = activeAgentSession?.prompt ?? "";
  const agentPinnedPaths = activeAgentSession?.pinnedPaths ?? [];
  const running = runningAgentSessionIds.has(activeAgentSessionKey);
  const agentSessionTabs = agentSessions.map((session) => ({
    id: session.id,
    label: session.label,
    running: runningAgentSessionIds.has(session.id)
  }));
  const reasoningEffort = AGENT_MODE_REASONING[selectedAgentMode] ?? "medium";
  const agentContextUsage = useMemo(
    () => estimateAgentContextUsage(messages, files, currentPath, agentPinnedPaths, selectedAgentModel),
    [agentPinnedPaths, currentPath, files, messages, selectedAgentModel]
  );
  const dirtyPathsRef = useRef<string[]>([]);

  function updateAgentSession(sessionId: string, updater: (session: AgentConversationSession) => AgentConversationSession) {
    setAgentSessions((current) => updateConversationById(current, sessionId, updater));
  }

  function updateActiveAgentSession(updater: (session: AgentConversationSession) => AgentConversationSession) {
    updateAgentSession(activeAgentSessionKey, updater);
  }

  function setAgentSessionRunning(sessionId: string, value: boolean) {
    setRunningAgentSessionIds((current) => {
      const next = new Set(current);
      if (value) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }

  function setMessages(next: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])) {
    setSessionMessages(activeAgentSessionKey, next);
  }

  function setSessionMessages(sessionId: string, next: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])) {
    updateAgentSession(sessionId, (session) => ({
      ...session,
      messages: typeof next === "function" ? next(session.messages) : next
    }));
  }

  function setDiffs(next: AgentDiff[] | ((current: AgentDiff[]) => AgentDiff[])) {
    updateActiveAgentSession((session) => ({
      ...session,
      diffs: typeof next === "function" ? next(session.diffs) : next
    }));
  }

  function setPrompt(next: string) {
    updateActiveAgentSession((session) => ({ ...session, prompt: next }));
  }

  function beginAgentOperation(sessionId: string, userMessage: AgentMessage, thinkingMessage: AgentMessage) {
    updateAgentSession(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, userMessage, thinkingMessage],
      prompt: ""
    }));
    setAgentSessionRunning(sessionId, true);
  }

  function setAgentPinnedPaths(next: string[] | ((current: string[]) => string[])) {
    updateActiveAgentSession((session) => ({
      ...session,
      pinnedPaths: typeof next === "function" ? next(session.pinnedPaths) : next
    }));
  }

  useEffect(() => {
    dirtyPathsRef.current = dirtyPaths;
  }, [dirtyPaths]);

  useEffect(() => {
    const ids = new Set(trashEntries.map((entry) => entry.id));
    setTrashAuthorizations((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [trashEntries]);

  useEffect(() => {
    if (!adapter.listTrashEntries || sourceKind !== "desktop") {
      setTrashEntries([]);
      return;
    }
    let cancelled = false;
    Promise.resolve(adapter.listTrashEntries())
      .then((entries) => {
        if (!cancelled) setTrashEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setTrashEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, sourceKind, sourceName]);

  useEffect(() => {
    if (!adapter.watchVault || sourceKind !== "desktop") return;

    let cancelled = false;
    let stopWatching: (() => void) | undefined;
    Promise.resolve(
      adapter.watchVault((vault, changedPaths) => {
        if (cancelled) return;
        if (dirtyPathsRef.current.length > 0) {
          setStatus(`检测到外部文件变化，但当前有 ${dirtyPathsRef.current.length} 个未写回草稿，已暂停自动刷新。`);
          return;
        }
        refreshLoadedVault(
          vault,
          changedPaths.length > 0 ? `检测到外部变化，已刷新：${changedPaths.slice(0, 3).join("、")}` : "检测到外部变化，已刷新知识库。"
        );
      })
    )
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        stopWatching = cleanup;
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? `文件监听未启动：${error.message}` : "文件监听未启动。");
        }
      });

    return () => {
      cancelled = true;
      stopWatching?.();
    };
  }, [adapter, sourceKind, sourceName]);

  function applyLoadedVault(vault: LoadedVault, nextStatus?: string, options?: { preserveAgentSessions?: boolean }) {
    const nextIndex = buildVaultIndex(vault.files);
    setFiles(vault.files);
    setBaseFiles(vault.files);
    setSourceName(vault.sourceName);
    setSourceKind(vault.sourceKind);
    setSourceSafety(vault.safetyManifest);
    setCurrentPath(nextIndex.notes[0]?.path ?? "");
    setCenterMode("graph");
    setWorkspaceTabs([{ id: GRAPH_TAB_ID, mode: "graph" }]);
    setActiveTabId(GRAPH_TAB_ID);
    if (!options?.preserveAgentSessions) {
      const initialAgentSession = createAgentConversationSession("1");
      setAgentSessions([initialAgentSession]);
      setActiveAgentSessionId(initialAgentSession.id);
      setAgentSessionHistory([]);
      setAgentSessionNumber(1);
      setRunningAgentSessionIds(new Set());
    }
    if (vault.sourceKind !== "desktop") setTrashEntries([]);
    setNoteFilter("");
    setExplorerQuery("");
    setExplorerScope("");
    setGraphFilter("");
    setGraphViewport(null);
    setStatus(nextStatus ?? vault.unsupportedReason ?? `已载入 ${vault.sourceName}。`);
  }

  function refreshLoadedVault(vault: LoadedVault, nextStatus: string) {
    const nextIndex = buildVaultIndex(vault.files);
    const existingPaths = new Set(nextIndex.notes.map((note) => note.path));
    setFiles(vault.files);
    setBaseFiles(vault.files);
    setSourceName(vault.sourceName);
    setSourceKind(vault.sourceKind);
    setSourceSafety(vault.safetyManifest);
    if (vault.sourceKind !== "desktop") setTrashEntries([]);
    setCurrentPath((path) => (path && existingPaths.has(path) ? path : nextIndex.notes[0]?.path ?? ""));
    setWorkspaceTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => !tab.path || existingPaths.has(tab.path));
      return nextTabs.length > 0 ? nextTabs : [{ id: GRAPH_TAB_ID, mode: "graph" }];
    });
    setActiveTabId((tabId) => {
      const activeTab = workspaceTabs.find((tab) => tab.id === tabId);
      return activeTab?.path && !existingPaths.has(activeTab.path) ? GRAPH_TAB_ID : tabId;
    });
    if (currentPath && !existingPaths.has(currentPath)) {
      setCenterMode("graph");
    }
    setStatus(nextStatus);
  }

  async function openLocalVault() {
    setStatus("正在等待你选择本地存储文件夹...");
    setStorageBusy(true);
    try {
      const vault = await adapter.openVault();
      applyLoadedVault(
        vault,
        vault.unsupportedReason ??
          `已连接 ${vault.sourceName}，读取 ${vault.files.length} 篇安全笔记，排除 ${vault.safetyManifest.excluded.length} 个路径。`
      );
      setStorageOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `未连接本地文件夹：${error.message}` : "未连接本地文件夹。");
    } finally {
      setStorageBusy(false);
    }
  }

  async function createLocalVaultFolder() {
    if (!adapter.createVaultFolder) {
      setStatus("当前入口不支持新建本地文件夹；请在桌面 App 中使用。");
      return;
    }
    const folderName = newVaultName.trim();
    if (folderName === "") {
      setStatus("请输入要新建的文件夹名称。");
      return;
    }
    setStatus(`正在选择位置并创建文件夹：${folderName}...`);
    setStorageBusy(true);
    try {
      const vault = await adapter.createVaultFolder(folderName);
      applyLoadedVault(vault, `已创建并连接本地存储空间：${vault.sourceName}`);
      setStorageOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `新建文件夹失败：${error.message}` : "新建文件夹失败。");
    } finally {
      setStorageBusy(false);
    }
  }

  function useDemoVault() {
    applyLoadedVault(adapter.loadDemoVault(), "已切换到 Demo。Demo 中的敏感路径会被安全规则排除。");
    setStorageOpen(false);
  }

  function createSessionNote() {
    const path = nextUntitledPath(files);
    const content = `# ${leafName(path)}\n\n`;
    setFiles((current) => [...current, { path, content, modifiedAt: new Date().toISOString() }]);
    openNoteTab(path);
    setEditorMode("edit");
    setNoteFilter("");
    markDirty(path);
    setStatus("已创建一篇会话笔记。Web v1 不会自动写回磁盘。");
  }

  function createNoteInContext(target: TreeContextMenu | null) {
    const folder = target?.type === "folder" ? target.folder.path : target?.type === "note" ? noteStemPath(target.note.path) : "Inbox";
    const parentLink = target?.type === "note" ? `\n上级：[[${target.note.path.replace(/\.md$/i, "")}]]\n` : "";
    const path = uniqueNotePath(files, `${folder}/新文档.md`);
    const content = `# ${leafName(path)}\n${parentLink}\n`;
    setFiles((current) => [...current, { path, content, modifiedAt: new Date().toISOString() }]);
    setTreeContextMenu(null);
    openNoteTab(path);
    setEditorMode("edit");
    markDirty(path);
    setStatus(`已在 ${folder} 新建文档草稿：${path}`);
  }

  function renameContextTarget(target: TreeContextMenu) {
    if (target.type === "note") {
      renameNoteInSession(target.note.path);
      return;
    }
    renameFolderInSession(target.folder.path);
  }

  function renameNoteInSession(path: string) {
    const oldPath = normalizePath(path);
    const input = window.prompt("重命名文档路径", oldPath);
    if (!input) return;
    const nextPath = ensureMarkdownPath(normalizePath(input));
    if (nextPath.toLowerCase() === oldPath.toLowerCase()) return;
    if (files.some((file) => normalizePath(file.path).toLowerCase() === nextPath.toLowerCase())) {
      setStatus(`重命名失败：${nextPath} 已存在。`);
      return;
    }
    setFiles((current) => current.map((file) => (normalizePath(file.path).toLowerCase() === oldPath.toLowerCase() ? { ...file, path: nextPath } : file)));
    replacePathInTabs(oldPath, nextPath);
    setTreeContextMenu(null);
    markDirty(nextPath);
    setStatus(`已重命名为：${nextPath}。写回本地前会在改动面板确认。`);
  }

  function renameFolderInSession(path: string) {
    const oldFolder = normalizePath(path).replace(/\/+$/g, "");
    const input = window.prompt("重命名文件夹路径", oldFolder);
    if (!input) return;
    const nextFolder = normalizePath(input).replace(/\/+$/g, "");
    if (!nextFolder || nextFolder.toLowerCase() === oldFolder.toLowerCase()) return;
    const moving = files.filter((file) => isPathInsideFolder(file.path, oldFolder));
    const existing = new Set(files.map((file) => normalizePath(file.path).toLowerCase()));
    for (const file of moving) {
      existing.delete(normalizePath(file.path).toLowerCase());
    }
    const replacements = new Map<string, string>();
    for (const file of moving) {
      const nextPath = `${nextFolder}/${normalizePath(file.path).slice(oldFolder.length + 1)}`;
      if (existing.has(nextPath.toLowerCase())) {
        setStatus(`重命名失败：${nextPath} 已存在。`);
        return;
      }
      replacements.set(normalizePath(file.path), nextPath);
    }
    setFiles((current) => current.map((file) => ({ ...file, path: replacements.get(normalizePath(file.path)) ?? file.path })));
    replaceManyPathsInTabs(replacements);
    setTreeContextMenu(null);
    setStatus(`已重命名文件夹：${oldFolder} -> ${nextFolder}。写回本地前会在改动面板确认。`);
  }

  function copyContextTarget(target: TreeContextMenu, mode: ClipboardMode) {
    const paths = target.type === "note" ? [target.note.path] : files.filter((file) => isPathInsideFolder(file.path, target.folder.path)).map((file) => file.path);
    if (paths.length === 0) {
      setStatus("没有可复制的文档。");
      return;
    }
    setNoteClipboard({ mode, paths });
    setTreeContextMenu(null);
    setStatus(`${mode === "copy" ? "已复制" : "已剪切"} ${paths.length} 篇文档。右键目标位置可以粘贴。`);
  }

  function pasteClipboard(target: TreeContextMenu) {
    if (!noteClipboard) return;
    const targetFolder = target.type === "folder" ? target.folder.path : folderPathOf(target.note.path);
    const clipboardFiles = noteClipboard.paths
      .map((path) => files.find((file) => normalizePath(file.path).toLowerCase() === normalizePath(path).toLowerCase()))
      .filter((file): file is NoteFile => Boolean(file));
    if (clipboardFiles.length === 0) {
      setStatus("剪贴板中的文档已经不存在。");
      setNoteClipboard(null);
      return;
    }

    const replacements = new Map<string, string>();
    const existingFiles = noteClipboard.mode === "cut" ? files.filter((file) => !clipboardFiles.includes(file)) : files;
    let nextFiles = [...existingFiles];
    for (const file of clipboardFiles) {
      const desired = `${targetFolder ? `${targetFolder}/` : ""}${leafName(file.path)}.md`;
      const nextPath = uniqueNotePath(nextFiles, desired);
      replacements.set(normalizePath(file.path), nextPath);
      nextFiles = [...nextFiles, { ...file, path: nextPath, modifiedAt: new Date().toISOString() }];
    }

    setFiles(nextFiles);
    if (noteClipboard.mode === "cut") {
      replaceManyPathsInTabs(replacements);
      setNoteClipboard(null);
    }
    setTreeContextMenu(null);
    const firstPath = [...replacements.values()][0];
    if (firstPath) openNoteTab(firstPath);
    setStatus(`已${noteClipboard.mode === "copy" ? "复制" : "移动"} ${clipboardFiles.length} 篇文档到：${targetFolder || "根目录"}。`);
  }

  function deleteContextTarget(target: TreeContextMenu) {
    if (target.type === "note") {
      deleteNoteFromSession(target.note.path);
      setTreeContextMenu(null);
      return;
    }
    const folderPath = target.folder.path;
    const paths = files.filter((file) => isPathInsideFolder(file.path, folderPath)).map((file) => file.path);
    if (paths.length === 0) {
      setStatus("这个文件夹里没有可删除的文档。");
      setTreeContextMenu(null);
      return;
    }
    const ok = window.confirm(`将 ${paths.length} 篇文档加入回收站待写回？\n\n${folderPath}`);
    if (!ok) return;
    setFiles((current) => current.filter((file) => !isPathInsideFolder(file.path, folderPath)));
    setWorkspaceTabs((current) => current.filter((tab) => !tab.path || !isPathInsideFolder(tab.path, folderPath)));
    if (currentPath && isPathInsideFolder(currentPath, folderPath)) {
      setActiveTabId(GRAPH_TAB_ID);
      setCenterMode("graph");
      setCurrentPath("");
    }
    setTreeContextMenu(null);
    setStatus(`已将 ${paths.length} 篇文档加入回收站待写回：${folderPath}`);
  }

  function updateCurrentNote(content: string) {
    if (!currentPath) return;
    setFiles((current) => current.map((file) => (file.path === currentPath ? { ...file, content } : file)));
    markDirty(currentPath);
    setStatus("当前改动只保存在本次浏览器会话中，尚未写回磁盘。");
  }

  async function saveAgentApiKey() {
    if (!adapter.saveDeepSeekApiKey || agentApiKeyInput.trim() === "") return;
    setSavingAgentKey(true);
    try {
      const settings = await adapter.saveDeepSeekApiKey(agentApiKeyInput);
      setModelSettings(normalizeModelSettings(settings, Boolean(adapter.runModel)));
      setAgentApiKeyInput("");
      setAgentKeyDialogOpen(false);
      setAgentKeyDialogDismissed(true);
      setStatus("DeepSeek API key saved locally. Note Agent is ready.");
    } catch (error) {
      setStatus(error instanceof Error ? `DeepSeek API key save failed: ${error.message}` : "DeepSeek API key save failed.");
    } finally {
      setSavingAgentKey(false);
    }
  }

  async function updateAgentModel(model: string) {
    const nextSettings = normalizeModelSettings({ ...modelSettings, provider: adapter.runModel ? "deepseek" : "offline", model }, Boolean(adapter.runModel));
    setModelSettings(nextSettings);
    await persistModelSettings(nextSettings);
  }

  async function updateAgentMode(agentMode: string) {
    const nextSettings = normalizeModelSettings({ ...modelSettings, agentMode }, Boolean(adapter.runModel));
    setModelSettings(nextSettings);
    await persistModelSettings(nextSettings);
  }

  async function persistModelSettings(settings: ModelConnectionSettings) {
    if (!adapter.saveModelSettings) return;
    try {
      const saved = await adapter.saveModelSettings({
        provider: settings.provider,
        model: settings.model,
        agentMode: settings.agentMode
      });
      setModelSettings(normalizeModelSettings(saved, Boolean(adapter.runModel)));
      setStatus(`Agent 设置已更新：${settings.model} / ${agentModeLabel(settings.agentMode)}`);
    } catch (error) {
      setStatus(error instanceof Error ? `Agent 设置保存失败：${error.message}` : "Agent 设置保存失败。");
    }
  }

  function snapshotAgentSession(title: string): AgentSessionSnapshot | null {
    if (messages.length === 0 && diffs.length === 0 && prompt.trim() === "" && agentPinnedPaths.length === 0) return null;
    return {
      id: crypto.randomUUID(),
      title,
      messages,
      diffs,
      prompt,
      pinnedPaths: agentPinnedPaths,
      savedAt: new Date().toISOString()
    };
  }

  function saveAgentSnapshot(title: string) {
    const snapshot = snapshotAgentSession(title);
    if (!snapshot) return;
    setAgentSessionHistory((current) => [snapshot, ...current].slice(0, 12));
  }

  function clearAgentWorkspace() {
    setMessages([]);
    setDiffs([]);
    setPrompt("");
    setAgentPinnedPaths([]);
  }

  function createAgentSession() {
    if (agentSessions.length >= 8) {
      setStatus("最多同时保留 8 个子 Agent；请先刷新或整理现有会话。");
      return;
    }
    const nextNumber = agentSessionNumber + 1;
    const nextSession = createAgentConversationSession(String(nextNumber));
    setAgentSessions((current) => [...current, nextSession]);
    setActiveAgentSessionId(nextSession.id);
    setAgentSessionNumber(nextNumber);
    setStatus(`已新建子 Agent ${nextSession.label}。底部编号可切换不同子 Agent 会话。`);
  }

  function resetAgentSession() {
    if (runningAgentSessionIds.has(activeAgentSessionKey)) {
      setStatus("当前子 Agent 仍在执行任务，完成后才能刷新这段会话。");
      return;
    }
    saveAgentSnapshot(`Agent ${activeAgentSession?.label ?? agentSessionNumber}`);
    clearAgentWorkspace();
    setStatus(`已刷新子 Agent ${activeAgentSession?.label ?? ""} 的当前聊天；快照已保存到最近记录。`);
  }

  function restoreAgentSession() {
    const [snapshot, ...rest] = agentSessionHistory;
    if (!snapshot) {
      setStatus("没有可回溯的 Agent 聊天记录。");
      return;
    }
    setMessages(snapshot.messages);
    setDiffs(snapshot.diffs);
    setPrompt(snapshot.prompt);
    setAgentPinnedPaths(snapshot.pinnedPaths);
    setAgentSessionHistory(rest);
    setStatus(`已回溯最近聊天：${snapshot.title}，聊天记忆和上下文附件已恢复。`);
  }

  function selectAgentSession(sessionId: string) {
    if (sessionId === activeAgentSessionKey) return;
    setActiveAgentSessionId(sessionId);
    const session = agentSessions.find((item) => item.id === sessionId);
    setStatus(`已切换到子 Agent ${session?.label ?? ""}。`);
  }

  function uploadCurrentNoteToAgent() {
    if (!currentPath) {
      setStatus("当前没有打开的笔记，无法加入 Agent 上下文。");
      return;
    }
    setAgentPinnedPaths((current) => (current.includes(currentPath) ? current : [...current, currentPath].slice(-6)));
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "tool",
        content: `已加入 Agent 上下文：${currentPath}`,
        createdAt: new Date().toISOString()
      }
    ]);
    setStatus(`已把当前笔记加入 Agent 上下文：${currentPath}`);
  }

  async function runAgent() {
    if (prompt.trim() === "") return;
    const sessionId = activeAgentSessionKey;
    if (!sessionId || runningAgentSessionIds.has(sessionId)) return;
    const input = prompt;
    const wordDocumentRequest = detectWordDocumentRequest(input);
    if (wordDocumentRequest) {
      await runWordDocumentOperation(sessionId, input, wordDocumentRequest);
      return;
    }
    const localOperation = detectInterlinkedVaultRequest(input);
    if (localOperation) {
      await runInterlinkedVaultOperation(sessionId, input, localOperation);
      return;
    }
    if (adapter.saveDeepSeekApiKey && !modelSettings.deepSeekApiKeyConfigured && !isStressGraphGenerationRequest(input)) {
      setAgentKeyDialogOpen(true);
      setAgentSettingsOpen(true);
      setStatus("请先填写本机 DeepSeek API key，再让 Agent 调用在线模型。");
      return;
    }
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString()
    };
    const thinkingMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "正在思考…你可以继续浏览、编辑或操作图谱。",
      createdAt: new Date().toISOString(),
      status: "thinking"
    };
    updateAgentSession(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, userMessage, thinkingMessage],
      prompt: ""
    }));
    setAgentSessionRunning(sessionId, true);
    try {
      const result = await agent.run(input, { currentPath, files, index, messages: [...messages, userMessage], pinnedPaths: agentPinnedPaths });
      updateAgentSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.flatMap((message) =>
          message.id === thinkingMessage.id
            ? [
                ...(result.toolCalls.length > 0
                  ? [
                      {
                        id: crypto.randomUUID(),
                        role: "tool" as const,
                        content: `已执行 ${result.toolCalls.join("、")}`,
                        createdAt: new Date().toISOString()
                      }
                    ]
                  : []),
                result.message
              ]
            : [message]
        ),
        diffs: [...result.diffs, ...session.diffs].slice(0, 8)
      }));
      setStatus(
        result.toolCalls.length > 0
          ? `Agent 已执行：${result.toolCalls.join("、")}`
          : result.diffs.length > 0
            ? "Agent 已生成 diff 提案，写回磁盘前仍需确认。"
            : "Agent 已完成。"
      );
    } catch (error) {
      const content = error instanceof Error ? error.message : "Agent failed.";
      updateAgentSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === thinkingMessage.id
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Agent error: ${content}`,
                createdAt: new Date().toISOString()
              }
            : message
        )
      }));
      setStatus(`Agent failed: ${content}`);
    } finally {
      setAgentSessionRunning(sessionId, false);
    }
  }

  async function runInterlinkedVaultOperation(sessionId: string, input: string, request: InterlinkedVaultRequest) {
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString()
    };
    const thinkingMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "正在思考…你可以继续浏览、编辑或操作图谱。",
      createdAt: new Date().toISOString(),
      status: "thinking"
    };
    beginAgentOperation(sessionId, userMessage, thinkingMessage);
    try {
      if (!adapter.createInterlinkedVault) {
        throw new Error("当前入口没有本地文件系统写入能力，请在桌面 App 中使用。");
      }
      const vault = await adapter.createInterlinkedVault(request);
      applyLoadedVault(
        vault,
        `Agent 已在 ${vault.sourceName} 创建 ${request.count} 个互相关联的 Markdown 文件，并载入为当前知识库。`,
        { preserveAgentSessions: true }
      );
      setSessionMessages(sessionId, (current) =>
        current.map((message) =>
          message.id === thinkingMessage.id
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `已完成：我在 ${vault.sourceName} 新建了一个本地知识库文件夹，并写入 ${request.count} 个互相关联的 Markdown 文件。它们已经载入当前 App，你可以在左侧文件树和图谱里检查。`,
                createdAt: new Date().toISOString()
              }
            : message
        )
      );
    } catch (error) {
      const content = error instanceof Error ? error.message : "本地文件操作失败。";
      setSessionMessages(sessionId, (current) =>
        current.map((message) =>
          message.id === thinkingMessage.id
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `本地文件操作失败：${content}`,
                createdAt: new Date().toISOString()
              }
            : message
        )
      );
      setStatus(`本地文件操作失败：${content}`);
    } finally {
      setAgentSessionRunning(sessionId, false);
    }
  }

  async function runWordDocumentOperation(sessionId: string, input: string, request: WordDocumentRequest) {
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString()
    };
    const thinkingMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "正在创建桌面 Word 文档…你可以继续使用 App。",
      createdAt: new Date().toISOString(),
      status: "thinking"
    };
    beginAgentOperation(sessionId, userMessage, thinkingMessage);
    try {
      if (!adapter.createWordDocumentOnDesktop) {
        throw new Error("当前入口没有创建桌面 Word 文档的本机工具，请在桌面 App 中使用。");
      }
      const result = await adapter.createWordDocumentOnDesktop(request);
      setSessionMessages(sessionId, (current) =>
        current.map((message) =>
          message.id === thinkingMessage.id
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `已完成：我已经在桌面创建 Word 文档：${result.path}`,
                createdAt: new Date().toISOString()
              }
            : message
        )
      );
      setStatus(`已创建桌面 Word 文档：${result.path}`);
    } catch (error) {
      const content = error instanceof Error ? error.message : "创建 Word 文档失败。";
      setSessionMessages(sessionId, (current) =>
        current.map((message) =>
          message.id === thinkingMessage.id
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `创建 Word 文档失败：${content}`,
                createdAt: new Date().toISOString()
              }
            : message
        )
      );
      setStatus(`创建 Word 文档失败：${content}`);
    } finally {
      setAgentSessionRunning(sessionId, false);
    }
  }

  function applyDiff(diff: AgentDiff) {
    if (diff.permission === "blocked") {
      setStatus(`已阻止：${diff.path}，原因：${diff.reason}`);
      return;
    }
    setFiles((current) => current.map((file) => (file.path === diff.path ? { ...file, content: diff.after } : file)));
    markDirty(diff.path);
    openNoteTab(diff.path);
    setStatus("Diff 已应用到浏览器会话副本。第一版不会直接写回本地 vault。");
  }

  function markDirty(path: string) {
    setStatus(`已记录草稿改动：${path}。写回本地前会显示 diff 和安全摘要。`);
  }

  function focusSearch() {
    setLeftVisible(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function focusAgent() {
    document.querySelector<HTMLTextAreaElement>(".agent-console textarea")?.focus();
  }

  function openTreeNoteMenu(note: ParsedNote, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setTreeContextMenu({ type: "note", note, x: event.clientX, y: event.clientY });
  }

  function openTreeFolderMenu(folder: FileTreeFolder, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setTreeContextMenu({ type: "folder", folder, x: event.clientX, y: event.clientY });
  }

  function selectGraphNode(path: string) {
    openNoteTab(path);
    setStatus(`已从图谱打开：${path}`);
  }

  function selectNote(path: string) {
    const existingNote = getNote(index, path) ?? getNote(index, ensureMarkdownPath(path));
    if (existingNote) {
      openNoteTab(existingNote.path);
      return;
    }

    if (!canCreateConceptNote(path)) {
      setStatus(`这个未解析目标不像 Markdown 笔记：${path}`);
      return;
    }

    const notePath = ensureMarkdownPath(path);
    const content = `# ${leafName(notePath)}\n\n`;
    setFiles((current) => {
      if (current.some((file) => normalizePath(file.path).toLowerCase() === notePath.toLowerCase())) return current;
      return [...current, { path: notePath, content, modifiedAt: new Date().toISOString() }];
    });
    markDirty(notePath);
    openNoteTab(notePath);
    setEditorMode("edit");
    setStatus(`已创建待发掘概念笔记：${notePath}。这是浏览器会话内草稿，尚未写回真实 vault。`);
  }

  function openGraphTab() {
    setWorkspaceTabs((current) => (current.some((tab) => tab.id === GRAPH_TAB_ID) ? current : [{ id: GRAPH_TAB_ID, mode: "graph" }, ...current]));
    setActiveTabId(GRAPH_TAB_ID);
    setCenterMode("graph");
  }

  function openExplorerTab() {
    setWorkspaceTabs((current) =>
      current.some((tab) => tab.id === EXPLORER_TAB_ID) ? current : [...current, { id: EXPLORER_TAB_ID, mode: "explorer" }]
    );
    setActiveTabId(EXPLORER_TAB_ID);
    setCenterMode("explorer");
  }

  function openNoteTab(path: string) {
    const id = tabIdForPath(path);
    setWorkspaceTabs((current) => (current.some((tab) => tab.id === id) ? current : [...current, { id, mode: "edit", path }]));
    setActiveTabId(id);
    setCurrentPath(path);
    setCenterMode("edit");
  }

  function activateTab(tab: WorkspaceTab) {
    setActiveTabId(tab.id);
    setCenterMode(tab.mode);
    if (tab.path) setCurrentPath(tab.path);
  }

  function closeTab(tabId: string) {
    if (tabId === GRAPH_TAB_ID || tabId === EXPLORER_TAB_ID) return;
    const tabIndex = workspaceTabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) return;
    const nextTabs = workspaceTabs.filter((tab) => tab.id !== tabId);
    setWorkspaceTabs(nextTabs.length > 0 ? nextTabs : [{ id: GRAPH_TAB_ID, mode: "graph" }]);
    if (activeTabId === tabId) {
      activateTab(nextTabs[Math.max(0, tabIndex - 1)] ?? nextTabs[0] ?? { id: GRAPH_TAB_ID, mode: "graph" });
    }
  }

  function replacePathInTabs(oldPath: string, nextPath: string) {
    const oldId = tabIdForPath(oldPath);
    const nextId = tabIdForPath(nextPath);
    setWorkspaceTabs((current) => current.map((tab) => (tab.id === oldId ? { ...tab, id: nextId, path: nextPath } : tab)));
    setActiveTabId((id) => (id === oldId ? nextId : id));
    setCurrentPath((path) => (normalizePath(path).toLowerCase() === normalizePath(oldPath).toLowerCase() ? nextPath : path));
  }

  function replaceManyPathsInTabs(replacements: Map<string, string>) {
    const normalized = new Map([...replacements].map(([from, to]) => [normalizePath(from).toLowerCase(), to]));
    setWorkspaceTabs((current) =>
      current.map((tab) => {
        if (!tab.path) return tab;
        const nextPath = normalized.get(normalizePath(tab.path).toLowerCase());
        return nextPath ? { ...tab, id: tabIdForPath(nextPath), path: nextPath } : tab;
      })
    );
    setActiveTabId((id) => {
      const notePrefix = "note:";
      if (!id.startsWith(notePrefix)) return id;
      const key = id.slice(notePrefix.length);
      const nextPath = normalized.get(key);
      return nextPath ? tabIdForPath(nextPath) : id;
    });
    setCurrentPath((path) => normalized.get(normalizePath(path).toLowerCase()) ?? path);
  }

  function deleteNoteFromSession(path: string) {
    const normalized = normalizePath(path);
    const id = tabIdForPath(normalized);
    setFiles((current) => current.filter((file) => normalizePath(file.path).toLowerCase() !== normalized.toLowerCase()));
    setWorkspaceTabs((current) => current.filter((tab) => tab.id !== id));
    if (tabIdForPath(currentPath) === id) {
      setActiveTabId(GRAPH_TAB_ID);
      setCenterMode("graph");
      setCurrentPath("");
    }
    setStatus(`已加入回收站待写回：${normalized}。写回本地后会移入 .knowledge-agent-trash，并保留 30 天。`);
  }

  function requestGraphDelete(path: string) {
    const normalized = normalizePath(path);
    const note = getNote(index, normalized);
    if (!note) {
      setStatus(`图谱节点不是可删除的本地文档：${normalized}`);
      return;
    }
    setGraphDeleteTarget({
      path: note.path,
      title: note.title || leafName(note.path),
      preview: firstUsefulLines(note.content)
    });
  }

  function confirmGraphDelete() {
    const target = graphDeleteTarget;
    setGraphDeleteTarget(null);
    if (!target) return;
    deleteNoteFromSession(target.path);
  }

  function startColumnResize(target: "left" | "agent", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    const startAgent = agentWidth;
    const shellWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const ribbonWidth = document.querySelector(".vault-ribbon")?.getBoundingClientRect().width ?? 42;
    const minWorkspace = 360;

    function move(pointerEvent: PointerEvent) {
      const delta = pointerEvent.clientX - startX;
      if (target === "left") {
        const maxLeft = Math.min(460, Math.max(180, shellWidth - ribbonWidth - startAgent - minWorkspace));
        setLeftWidth(clampNumber(startLeft + delta, 180, maxLeft));
        return;
      }

      const reservedLeft = leftVisible ? startLeft : 0;
      const maxAgent = Math.min(540, Math.max(260, shellWidth - ribbonWidth - reservedLeft - minWorkspace));
      setAgentWidth(clampNumber(startAgent - delta, 260, maxAgent));
    }

    function stop() {
      document.body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    }

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  async function writeDraftChanges() {
    if (!adapter.writeChanges) {
      setStatus("当前入口只支持预览草稿；桌面 App 才会写回真实本地文件。");
      return;
    }
    if (draftChanges.length === 0) {
      setStatus("当前没有需要写回的草稿。");
      return;
    }
    if (dirtySafety.excluded.length > 0) {
      setStatus(`安全规则阻止写回：${dirtySafety.excluded[0]?.path ?? "未知路径"}。`);
      return;
    }
    setWritingChanges(true);
    try {
      const result = await adapter.writeChanges(draftChanges);
      if (result.files) {
        setFiles(result.files);
        setBaseFiles(result.files);
      } else {
        setBaseFiles(files);
      }
      if (result.safetyManifest) {
        setSourceSafety(result.safetyManifest);
      }
      if (result.trashEntries) {
        setTrashEntries(result.trashEntries);
      }
      setChangesOpen(false);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? `写回失败：${error.message}` : "写回失败。");
    } finally {
      setWritingChanges(false);
    }
  }

  function authorizeTrashRestore(entry: TrashEntry) {
    const authorization = {
      ...classifyRestore(entry.originalPath, entry.purgeAfterMs),
      reviewedAtMs: Date.now()
    };
    setTrashAuthorizations((current) => ({ ...current, [entry.id]: authorization }));
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        authorization.permission === "blocked"
          ? `Agent 已阻止回溯：${entry.originalPath}\n原因：${authorization.reason}`
          : `Agent 已授权回溯：${entry.originalPath}\n权限：${authorization.permission}\n原因：${authorization.reason}`,
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, message]);
    setStatus(
      authorization.permission === "blocked"
        ? `Agent 阻止回溯：${entry.originalPath}。${authorization.reason}`
        : `Agent 已授权回溯：${entry.originalPath}。请在回收站面板确认恢复。`
    );
  }

  async function restoreAuthorizedTrashEntry(entry: TrashEntry) {
    if (!adapter.restoreTrashEntry) return;
    const authorization = trashAuthorizations[entry.id];
    if (!authorization || authorization.permission === "blocked") {
      authorizeTrashRestore(entry);
      return;
    }
    if (draftChanges.length > 0) {
      setStatus("请先写回或放弃当前会话改动，再从回收站恢复文档，避免覆盖未确认状态。");
      return;
    }
    setRestoringTrashId(entry.id);
    try {
      const result = await adapter.restoreTrashEntry(entry.id);
      if (result.files) {
        setFiles(result.files);
        setBaseFiles(result.files);
      }
      if (result.safetyManifest) {
        setSourceSafety(result.safetyManifest);
      }
      if (result.trashEntries) {
        setTrashEntries(result.trashEntries);
      }
      setStatus(`${result.message} 原路径：${entry.originalPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? `回收站恢复失败：${error.message}` : "回收站恢复失败。");
    } finally {
      setRestoringTrashId(null);
    }
  }

  const shellStyle = {
    "--left-width": `${leftWidth}px`,
    "--agent-width": `${agentWidth}px`
  } as CSSProperties;

  return (
    <div ref={shellRef} className={leftVisible ? "obsidian-shell" : "obsidian-shell left-collapsed"} style={shellStyle}>
      <header className="app-chrome">
        <div className="chrome-left">
          <IconButton active={leftVisible} label="切换侧栏" onClick={() => setLeftVisible((visible) => !visible)}>
            <PanelLeft />
          </IconButton>
          <IconButton active={storageOpen} label="存储空间" onClick={() => setStorageOpen((open) => !open)}>
            <FolderOpen />
          </IconButton>
          <IconButton label="搜索" onClick={focusSearch}>
            <Search />
          </IconButton>
          <IconButton label="笔记" onClick={() => (currentPath ? openNoteTab(currentPath) : undefined)}>
            <BookOpen />
          </IconButton>
        </div>
        <div className="tab-strip">
          <div className="tabs-scroll" role="tablist" aria-label="Open workspace tabs">
            {workspaceTabs.map((tab) => (
              <div
                aria-selected={tab.id === activeTabId}
                className={tab.id === activeTabId ? "tab active" : "tab"}
                key={tab.id}
                onClick={() => activateTab(tab)}
                role="tab"
                tabIndex={0}
                title={tab.path ?? "Graph"}
              >
                {tab.mode === "graph" ? <GitBranch size={13} /> : tab.mode === "explorer" ? <HardDrive size={13} /> : <BookOpen size={13} />}
                <span>{tabTitle(tab, index)}</span>
                {tab.path && dirtyPaths.includes(tab.path) ? <b className="tab-dirty" aria-label="Unsaved changes" /> : null}
                {tab.id !== GRAPH_TAB_ID && tab.id !== EXPLORER_TAB_ID ? (
                  <button
                    aria-label={`Close ${tabTitle(tab, index)}`}
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button aria-label="New note tab" className="tab-plus" onClick={createSessionNote} type="button">
            +
          </button>
        </div>
        <div className="chrome-right">
          {draftChanges.length > 0 || trashEntries.length > 0 ? (
            <button className="changes-pill" onClick={() => setChangesOpen((open) => !open)} type="button">
              改动 {draftChanges.length} · 回收站 {trashEntries.length}
            </button>
          ) : null}
          <span>{sourceLabel}</span>
          <span>{sourceName}</span>
        </div>
      </header>

      {storageOpen ? (
        <StoragePanel
          busy={storageBusy}
          canCreate={Boolean(adapter.createVaultFolder)}
          canOpen={adapter.canOpenVault}
          folderName={newVaultName}
          onClose={() => setStorageOpen(false)}
          onCreate={createLocalVaultFolder}
          onFolderNameChange={setNewVaultName}
          onOpen={openLocalVault}
          onUseDemo={useDemoVault}
          sourceLabel={sourceLabel}
          sourceName={sourceName}
        />
      ) : null}

      <aside className="vault-ribbon" aria-label="工具栏">
        <IconButton active={centerMode === "graph"} label="关系图谱" onClick={openGraphTab}>
          <Network />
        </IconButton>
        <IconButton active={centerMode === "explorer"} label="资源查询" onClick={openExplorerTab}>
          <HardDrive />
        </IconButton>
        <div className="ribbon-spacer" />
        <IconButton label="Agent" onClick={focusAgent}>
          <Bot />
        </IconButton>
        <IconButton active={graphSettingsOpen} label="设置" onClick={() => setGraphSettingsOpen((open) => !open)}>
          <Settings />
        </IconButton>
      </aside>

      <aside className="left-rail">
        <div className="rail-toolbar">
          <button onClick={openLocalVault} disabled={!directoryPickerAvailable} title="打开本地知识库" type="button">
            <FolderOpen size={16} />
          </button>
          <button onClick={createSessionNote} title="新建会话笔记" type="button">
            <FilePlus2 size={16} />
          </button>
        </div>

        <section className="vault-panel file-card">
          <div className="section-heading">
            <h2>读书</h2>
            <span>{filteredNotes.length}/{index.notes.length}</span>
          </div>
          <label className="search-box">
            <Search size={13} />
            <input
              ref={searchInputRef}
              aria-label="筛选笔记"
              onChange={(event) => setNoteFilter(event.target.value)}
              placeholder="筛选笔记"
              value={noteFilter}
            />
          </label>
          <FileTree
            currentPath={currentPath}
            notes={filteredNotes}
            onFolderContextMenu={(folder, event) => openTreeFolderMenu(folder, event)}
            onNoteContextMenu={(note, event) => openTreeNoteMenu(note, event)}
            onSelect={selectNote}
          />
        </section>

        <section className="vault-panel compact-panel">
          <div className="section-heading">
            <h2>标签</h2>
            <span>{tags.length}</span>
          </div>
          <div className="tag-list">
            {tags.length === 0 ? <p className="muted">暂无标签</p> : tags.map((tag) => <span key={tag.name}>#{tag.name} {tag.count}</span>)}
          </div>
        </section>

        <section className="vault-panel compact-panel safety-card">
          <div className="section-heading">
            <h2>安全状态</h2>
            <span>{sourceSafety.excluded.length === 0 ? "OK" : "已排除"}</span>
          </div>
          <p>
            <ShieldCheck size={13} />
            允许 {sourceSafety.allowed.length} / 排除 {sourceSafety.excluded.length}
          </p>
          <p>
            <CheckCircle2 size={13} />
            会话改动 {dirtySafety.allowed.length} / 阻止 {dirtySafety.excluded.length}
          </p>
          {sourceSafety.excluded.slice(0, 3).map((item) => (
            <small key={item.path}>{item.path} · {item.reason}</small>
          ))}
        </section>
      </aside>

      {changesOpen ? (
        <DraftChangesPanelWithTrash
          canWrite={Boolean(adapter.writeChanges)}
          changes={draftChanges}
          hasDraftChanges={draftChanges.length > 0}
          onClose={() => setChangesOpen(false)}
          onAuthorizeTrash={authorizeTrashRestore}
          onRestoreTrash={restoreAuthorizedTrashEntry}
          onWrite={writeDraftChanges}
          restoringTrashId={restoringTrashId}
          safety={dirtySafety}
          trashAuthorizations={trashAuthorizations}
          trashEntries={trashEntries}
          writing={writingChanges}
        />
      ) : null}

      {treeContextMenu ? (
        <TreeContextMenuPanel
          clipboard={noteClipboard}
          menu={treeContextMenu}
          onClose={() => setTreeContextMenu(null)}
          onCopy={(mode) => copyContextTarget(treeContextMenu, mode)}
          onCreate={() => createNoteInContext(treeContextMenu)}
          onDelete={() => deleteContextTarget(treeContextMenu)}
          onPaste={() => pasteClipboard(treeContextMenu)}
          onRename={() => renameContextTarget(treeContextMenu)}
        />
      ) : null}

      {graphDeleteTarget ? (
        <GraphDeleteConfirmDialog
          target={graphDeleteTarget}
          onCancel={() => setGraphDeleteTarget(null)}
          onConfirm={confirmGraphDelete}
        />
      ) : null}

      {agentKeyDialogOpen ? (
        <AgentApiKeyDialog
          apiKeyInput={agentApiKeyInput}
          modelLabel={selectedAgentModel}
          onApiKeyInputChange={setAgentApiKeyInput}
          onCancel={() => {
            setAgentKeyDialogOpen(false);
            setAgentKeyDialogDismissed(true);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void saveAgentApiKey();
          }}
          saving={savingAgentKey}
        />
      ) : null}

      {leftVisible ? (
        <div
          aria-label="调整左侧栏宽度"
          aria-orientation="vertical"
          className="column-resizer column-resizer-left"
          onPointerDown={(event) => startColumnResize("left", event)}
          role="separator"
        />
      ) : null}

      <div
        aria-label="调整右侧 Agent 栏宽度"
        aria-orientation="vertical"
        className="column-resizer column-resizer-agent"
        onPointerDown={(event) => startColumnResize("agent", event)}
        role="separator"
      />

      <main className="workspace">
        <header className="workspace-toolbar">
          <div className="nav-controls">
            <IconButton label="后退">
              <ChevronLeft />
            </IconButton>
            <IconButton label="前进">
              <ChevronRight />
            </IconButton>
          </div>
          <div className="breadcrumb">
            <span>{centerMode === "explorer" ? sourceName : currentPath.split("/").slice(0, -1).join(" / ") || "关系图谱"}</span>
            <strong>{centerMode === "graph" ? "关系图谱" : centerMode === "explorer" ? "资源查询" : leafName(currentPath)}</strong>
          </div>
        </header>
        <div className="status-line">{status}</div>
        {centerMode === "graph" ? (
          <div className="graph-workspace">
            <StarGraph
              filterText={graphFilter}
              graph={graph}
              onDelete={requestGraphDelete}
              onSelect={selectGraphNode}
              onViewportChange={setGraphViewport}
              radiusScale={graphRadius}
              showLabels={graphShowLabels}
              showSecondHop={graphShowRelated}
              viewport={graphViewport ?? undefined}
            />
            {graphSettingsOpen ? (
              <aside className="graph-settings-panel" aria-label="图谱设置">
                <header>
                  <span>图谱设置</span>
                  <button onClick={() => setGraphSettingsOpen(false)} type="button">
                    ×
                  </button>
                </header>
                <section>
                  <h3>筛选</h3>
                  <input
                    aria-label="筛选图谱节点"
                    onChange={(event) => {
                      setGraphViewport(null);
                      setGraphFilter(event.target.value);
                    }}
                    placeholder="节点标题或路径"
                    value={graphFilter}
                  />
                </section>
                <section>
                  <h3>显示</h3>
                  <label>
                    <input checked={graphShowLabels} onChange={(event) => setGraphShowLabels(event.target.checked)} type="checkbox" />
                    显示标签
                  </label>
                  <label>
                    <input
                      checked={graphShowRelated}
                      onChange={(event) => {
                        setGraphViewport(null);
                        setGraphShowRelated(event.target.checked);
                      }}
                      type="checkbox"
                    />
                    显示孤立节点
                  </label>
                </section>
                <section>
                  <h3>力</h3>
                  <label>
                    关系半径
                    <input
                      aria-label="图谱关系半径"
                      max="1.35"
                      min="0.7"
                      onChange={(event) => setGraphRadius(Number(event.target.value))}
                      step="0.05"
                      type="range"
                      value={graphRadius}
                    />
                  </label>
                </section>
              </aside>
            ) : null}
          </div>
        ) : centerMode === "explorer" ? (
          <VaultExplorer
            model={explorerModel}
            onOpenNote={selectNote}
            onQueryChange={setExplorerQuery}
            onScopeChange={setExplorerScope}
            query={explorerQuery}
            scope={explorerScope}
            sourceName={sourceName}
          />
        ) : (
          <NoteEditor
            miniGraph={currentNoteGraph}
            mode={editorMode}
            note={currentNote}
            onChange={updateCurrentNote}
            onModeChange={setEditorMode}
            onSelectGraphNode={selectNote}
          />
        )}
      </main>

      <AgentConsole
        activeSessionId={activeAgentSessionKey}
        agentModeOptions={AGENT_MODE_OPTIONS}
        canConfigureModel={Boolean(adapter.saveDeepSeekApiKey)}
        diffs={diffs}
        input={prompt}
        messages={messages}
        canRestoreSession={agentSessionHistory.length > 0}
        contextUploadLabel={currentPath ? `把 ${currentPath} 加入 Agent 上下文` : "当前没有可上传的笔记"}
        contextUsage={agentContextUsage}
        modelConfigured={modelSettings.deepSeekApiKeyConfigured}
        modelLabel={`${modelSettings.provider}:${modelSettings.model}`}
        modelShortLabel={modelShortLabel(selectedAgentModel)}
        modelOptions={agentModelOptions}
        onApply={applyDiff}
        onAgentModeChange={(mode) => void updateAgentMode(mode)}
        onNewSession={createAgentSession}
        onInputChange={setPrompt}
        onModelChange={(model) => void updateAgentModel(model)}
        onRequestApiKey={() => {
          setAgentApiKeyInput("");
          setAgentSettingsOpen(false);
          setAgentKeyDialogOpen(true);
        }}
        onResetSession={resetAgentSession}
        onRestoreSession={restoreAgentSession}
        onRun={runAgent}
        onSelectSession={selectAgentSession}
        onToggleSettings={() => setAgentSettingsOpen((open) => !open)}
        onUploadContext={uploadCurrentNoteToAgent}
        reasoningEffort={reasoningEffort}
        running={running}
        selectedAgentMode={selectedAgentMode}
        selectedModel={selectedAgentModel}
        sessions={agentSessionTabs}
        settingsOpen={agentSettingsOpen}
      />
    </div>
  );
}

interface TreeContextMenuPanelProps {
  clipboard: NoteClipboard | null;
  menu: TreeContextMenu;
  onClose(): void;
  onCopy(mode: ClipboardMode): void;
  onCreate(): void;
  onDelete(): void;
  onPaste(): void;
  onRename(): void;
}

function TreeContextMenuPanel({
  clipboard,
  menu,
  onClose,
  onCopy,
  onCreate,
  onDelete,
  onPaste,
  onRename
}: TreeContextMenuPanelProps) {
  const title = menu.type === "note" ? menu.note.title : menu.folder.name;
  return (
    <div
      className="tree-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: menu.x, top: menu.y } as CSSProperties}
    >
      <header>
        <strong>{title}</strong>
        <button aria-label="关闭菜单" onClick={onClose} type="button">
          <X size={12} />
        </button>
      </header>
      <button onClick={onCreate} role="menuitem" type="button">
        <FilePlus2 size={14} />
        在本文档中新建
      </button>
      <button onClick={onRename} role="menuitem" type="button">
        <FileText size={14} />
        重命名
      </button>
      <button onClick={() => onCopy("copy")} role="menuitem" type="button">
        <BookOpen size={14} />
        复制
      </button>
      <button onClick={() => onCopy("cut")} role="menuitem" type="button">
        <ScissorsIcon />
        剪切
      </button>
      <button disabled={!clipboard} onClick={onPaste} role="menuitem" type="button">
        <FolderOpen size={14} />
        粘贴到这里
      </button>
      <button className="danger" onClick={onDelete} role="menuitem" type="button">
        <Trash2 size={14} />
        删除
      </button>
    </div>
  );
}

interface GraphDeleteConfirmDialogProps {
  target: PendingGraphDelete;
  onCancel(): void;
  onConfirm(): void;
}

function GraphDeleteConfirmDialog({ target, onCancel, onConfirm }: GraphDeleteConfirmDialogProps) {
  return (
    <div
      className="graph-delete-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <section aria-label="确认删除图谱文档" aria-modal="true" className="graph-delete-dialog" role="dialog">
        <button aria-label="关闭" className="graph-delete-close" onClick={onCancel} type="button">
          <X size={14} />
        </button>
        <div className="graph-delete-icon">
          <Trash2 size={20} />
        </div>
        <div className="graph-delete-copy">
          <p>确认移除这个文档？</p>
          <h2>{target.title}</h2>
          <span>{target.path}</span>
        </div>
        <pre>{target.preview}</pre>
        <p className="graph-delete-note">这一步只会加入回收站待写回；写回本地后会移入 .knowledge-agent-trash，并保留 30 天。</p>
        <div className="graph-delete-actions">
          <button onClick={onCancel} type="button">
            取消
          </button>
          <button className="danger" onClick={onConfirm} type="button">
            加入回收站
          </button>
        </div>
      </section>
    </div>
  );
}

interface AgentApiKeyDialogProps {
  apiKeyInput: string;
  modelLabel: string;
  saving: boolean;
  onApiKeyInputChange(input: string): void;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

function AgentApiKeyDialog({
  apiKeyInput,
  modelLabel,
  saving,
  onApiKeyInputChange,
  onCancel,
  onSubmit
}: AgentApiKeyDialogProps) {
  return (
    <div
      className="agent-key-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <form aria-label="配置 DeepSeek API key" aria-modal="true" className="agent-key-dialog" onSubmit={onSubmit} role="dialog">
        <button aria-label="关闭" className="agent-key-close" onClick={onCancel} type="button">
          <X size={14} />
        </button>
        <div className="agent-key-icon">
          <Bot size={20} />
        </div>
        <div className="agent-key-copy">
          <p>首次使用在线 Agent</p>
          <h2>填写你的 DeepSeek API key</h2>
          <span>当前模型：{modelLabel}</span>
        </div>
        <label>
          <span>API key 只保存在本机 AppData，不会写入知识库或 GitHub。</span>
          <input
            autoFocus
            aria-label="DeepSeek API key"
            onChange={(event) => onApiKeyInputChange(event.target.value)}
            placeholder="sk-..."
            type="password"
            value={apiKeyInput}
          />
        </label>
        <div className="agent-key-actions">
          <button onClick={onCancel} type="button">
            稍后
          </button>
          <button className="primary" disabled={saving || apiKeyInput.trim() === ""} type="submit">
            {saving ? "保存中" : "保存并启用"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScissorsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M4 7.5a2.5 2.5 0 1 0 4.4 1.62L20 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M4 16.5a2.5 2.5 0 1 1 4.4-1.62L20 20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M8.5 12h3" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

interface StoragePanelProps {
  busy: boolean;
  canCreate: boolean;
  canOpen: boolean;
  folderName: string;
  onClose(): void;
  onCreate(): void;
  onFolderNameChange(value: string): void;
  onOpen(): void;
  onUseDemo(): void;
  sourceLabel: string;
  sourceName: string;
}

function StoragePanel({
  busy,
  canCreate,
  canOpen,
  folderName,
  onClose,
  onCreate,
  onFolderNameChange,
  onOpen,
  onUseDemo,
  sourceLabel,
  sourceName
}: StoragePanelProps) {
  return (
    <aside className="storage-panel" aria-label="本地存储空间">
      <header>
        <div>
          <h2>存储空间</h2>
          <p>
            {sourceLabel} · {sourceName}
          </p>
        </div>
        <button aria-label="关闭存储面板" onClick={onClose} type="button">
          <X size={14} />
        </button>
      </header>

      <section className="storage-actions">
        <button disabled={!canOpen || busy} onClick={onOpen} type="button">
          <FolderOpen size={15} />
          打开已有文件夹
        </button>

        <div className={canCreate ? "storage-create" : "storage-create disabled"}>
          <label htmlFor="new-vault-name">新建文件夹名称</label>
          <div>
            <input
              disabled={!canCreate || busy}
              id="new-vault-name"
              onChange={(event) => onFolderNameChange(event.target.value)}
              value={folderName}
            />
            <button disabled={!canCreate || busy || folderName.trim() === ""} onClick={onCreate} type="button">
              <FilePlus2 size={15} />
              选择位置并新建
            </button>
          </div>
        </div>

        <button disabled={busy} onClick={onUseDemo} type="button">
          <BookOpen size={15} />
          使用 Demo
        </button>
      </section>

      <footer>{canCreate ? "桌面端会记住连接位置；笔记写回仍需要在改动面板确认。" : "浏览器入口只能打开授权文件夹；新建任意本机文件夹请使用桌面 App。"}</footer>
    </aside>
  );
}

export function DraftChangesPanel({
  canWrite,
  changes,
  onClose,
  onWrite,
  safety,
  writing
}: {
  canWrite: boolean;
  changes: DraftChange[];
  onClose(): void;
  onWrite(): void;
  safety: SafetyManifest;
  writing: boolean;
}) {
  const blocked = safety.excluded.length > 0;
  return (
    <aside className="draft-panel" aria-label="Draft changes">
      <header>
        <div>
          <h2>改动</h2>
          <p>
            {changes.length} 个草稿 路 允许 {safety.allowed.length} / 阻止 {safety.excluded.length}
          </p>
        </div>
        <button aria-label="关闭改动面板" onClick={onClose} type="button">
          <X size={14} />
        </button>
      </header>
      <div className="draft-list">
        {changes.length === 0 ? (
          <p className="draft-empty">当前没有草稿改动。</p>
        ) : (
          changes.map((change) => (
            <article className={`draft-card ${change.kind}`} key={`${change.kind}:${change.path}`}>
              <div className="draft-card-heading">
                <span>{draftKindLabel(change.kind)}</span>
                <strong>{change.path}</strong>
              </div>
              <pre>{diffPreview(change)}</pre>
            </article>
          ))
        )}
      </div>
      {blocked ? (
        <div className="draft-warning">
          <ShieldCheck size={14} />
          <span>{safety.excluded[0]?.path} 被安全规则阻止：{safety.excluded[0]?.reason}</span>
        </div>
      ) : null}
      <footer>
        <button disabled={!canWrite || blocked || changes.length === 0 || writing} onClick={onWrite} type="button">
          {writing ? "正在写回..." : canWrite ? "写回本地" : "仅桌面端可写回"}
        </button>
      </footer>
    </aside>
  );
}

function DraftChangesPanelWithTrash({
  canWrite,
  changes,
  hasDraftChanges,
  onClose,
  onAuthorizeTrash,
  onRestoreTrash,
  onWrite,
  restoringTrashId,
  safety,
  trashAuthorizations,
  trashEntries,
  writing
}: {
  canWrite: boolean;
  changes: DraftChange[];
  hasDraftChanges: boolean;
  onClose(): void;
  onAuthorizeTrash(entry: TrashEntry): void;
  onRestoreTrash(entry: TrashEntry): void;
  onWrite(): void;
  restoringTrashId: string | null;
  safety: SafetyManifest;
  trashAuthorizations: Record<string, TrashAuthorization>;
  trashEntries: TrashEntry[];
  writing: boolean;
}) {
  const blocked = safety.excluded.length > 0;
  return (
    <aside className="draft-panel" aria-label="改动与回收站">
      <header>
        <div>
          <h2>改动与回收站</h2>
          <p>
            待写回 {changes.length} · 回收站 {trashEntries.length} · 允许 {safety.allowed.length} / 阻止 {safety.excluded.length}
          </p>
        </div>
        <button aria-label="关闭改动与回收站面板" onClick={onClose} type="button">
          <X size={14} />
        </button>
      </header>
      <div className="draft-list">
        {changes.length === 0 ? (
          <p className="draft-empty">当前没有待写回改动。</p>
        ) : (
          changes.map((change) => (
            <article className={`draft-card ${change.kind}`} key={`${change.kind}:${change.path}`}>
              <div className="draft-card-heading">
                <span>{draftKindLabel(change.kind)}</span>
                <strong>{change.path}</strong>
              </div>
              <pre>{diffPreview(change)}</pre>
            </article>
          ))
        )}
      </div>
      <section className="trash-section">
        <header>
          <div>
            <h3>回收站</h3>
            <p>.knowledge-agent-trash · 保留 30 天，到期自动清理</p>
          </div>
        </header>
        {trashEntries.length === 0 ? (
          <p className="trash-empty">回收站为空。</p>
        ) : (
          <div className="trash-list">
            {trashEntries.map((entry) => {
              const authorization = trashAuthorizations[entry.id];
              const blocked = authorization?.permission === "blocked";
              const authorized = authorization && !blocked;
              return (
                <article className={blocked ? "trash-card blocked" : authorized ? "trash-card authorized" : "trash-card"} key={entry.id}>
                  <div>
                    <strong>{entry.originalPath}</strong>
                    <span>
                      删除：{formatTrashTime(entry.deletedAtMs)} · 到期：{formatTrashTime(entry.purgeAfterMs)}
                    </span>
                    <small>{authorization ? `Agent：${authorization.reason}` : trashRemainingLabel(entry.purgeAfterMs)}</small>
                  </div>
                  {blocked ? (
                    <button disabled title={authorization.reason} type="button">
                      已阻止
                    </button>
                  ) : authorized ? (
                    <button
                      disabled={hasDraftChanges || restoringTrashId === entry.id}
                      onClick={() => onRestoreTrash(entry)}
                      title={hasDraftChanges ? "请先处理待写回改动，再恢复回收站文档" : "Agent 已授权，恢复到原路径"}
                      type="button"
                    >
                      {restoringTrashId === entry.id ? "恢复中" : "恢复"}
                    </button>
                  ) : (
                    <button onClick={() => onAuthorizeTrash(entry)} title="交给 Agent 审核回溯权限" type="button">
                      Agent 审核
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {blocked ? (
        <div className="draft-warning">
          <ShieldCheck size={14} />
          <span>{safety.excluded[0]?.path} 被安全规则阻止：{safety.excluded[0]?.reason}</span>
        </div>
      ) : null}
      <footer>
        <button disabled={!canWrite || blocked || changes.length === 0 || writing} onClick={onWrite} type="button">
          {writing ? "正在写回..." : canWrite ? "写回本地" : "仅桌面端可写回"}
        </button>
      </footer>
    </aside>
  );
}

function IconButton({
  active,
  children,
  label,
  onClick
}: {
  active?: boolean;
  children: React.ReactElement<{ size?: number }>;
  label: string;
  onClick?(): void;
}) {
  return (
    <button aria-label={label} className={active ? "icon-button active" : "icon-button"} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function VaultExplorer({
  model,
  onOpenNote,
  onQueryChange,
  onScopeChange,
  query,
  scope,
  sourceName
}: {
  model: ExplorerModel;
  onOpenNote(path: string): void;
  onQueryChange(query: string): void;
  onScopeChange(scope: string): void;
  query: string;
  scope: string;
  sourceName: string;
}) {
  return (
    <section className="vault-explorer" aria-label="Vault resource explorer">
      <header className="explorer-header">
        <div>
          <h1>资源查询</h1>
          <p>{sourceName} · {model.totalNotes} 篇文档 · {model.folderCount} 个文件夹</p>
        </div>
        <label className="explorer-search">
          <Search size={15} />
          <input onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索标题、路径、标签或正文" value={query} />
        </label>
      </header>

      <div className="drive-grid">
        <button className={scope === "" ? "drive-card active" : "drive-card"} onClick={() => onScopeChange("")} type="button">
          <HardDrive size={18} />
          <span>全部文档</span>
          <strong>{model.totalNotes}</strong>
        </button>
        {model.drives.map((drive) => (
          <button
            className={scope === drive.name ? "drive-card active" : "drive-card"}
            key={drive.name}
            onClick={() => onScopeChange(scope === drive.name ? "" : drive.name)}
            type="button"
          >
            <FolderOpen size={18} />
            <span>{drive.name}</span>
            <strong>{drive.count}</strong>
          </button>
        ))}
      </div>

      <div className="explorer-table" role="table" aria-label="文档列表">
        <div className="explorer-row header" role="row">
          <span>名称</span>
          <span>位置</span>
          <span>标签</span>
        </div>
        {model.notes.length === 0 ? (
          <div className="explorer-empty">没有匹配的文档。</div>
        ) : (
          model.notes.map((note) => (
            <button className="explorer-row" key={note.path} onClick={() => onOpenNote(note.path)} role="row" type="button">
              <span>
                <FileText size={14} />
                {note.title}
              </span>
              <span>{note.path}</span>
              <span>{note.tags.slice(0, 2).map((tag) => `#${tag}`).join(" ") || "—"}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function leafName(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
}

function folderPathOf(path: string): string {
  return normalizePath(path).split("/").slice(0, -1).join("/");
}

function noteStemPath(path: string): string {
  const normalized = normalizePath(path);
  return normalized.replace(/\.md$/i, "");
}

function isPathInsideFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  const normalizedFolder = normalizePath(folder).replace(/\/+$/g, "").toLowerCase();
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function tabIdForPath(path: string): string {
  return `note:${normalizePath(path).toLowerCase()}`;
}

function tabTitle(tab: WorkspaceTab, index: ReturnType<typeof buildVaultIndex>): string {
  if (tab.mode === "graph") return "关系图谱";
  if (tab.mode === "explorer") return "资源查询";
  if (!tab.path) return "笔记";
  return getNote(index, tab.path)?.title ?? leafName(tab.path);
}

function nextUntitledPath(files: NoteFile[]): string {
  const existing = new Set(files.map((file) => file.path.toLowerCase()));
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const path = `Inbox/Untitled${suffix}.md`;
    if (!existing.has(path.toLowerCase())) return path;
    index += 1;
  }
}

function uniqueNotePath(files: NoteFile[], desiredPath: string): string {
  const normalizedDesired = ensureMarkdownPath(normalizePath(desiredPath));
  const existing = new Set(files.map((file) => normalizePath(file.path).toLowerCase()));
  if (!existing.has(normalizedDesired.toLowerCase())) return normalizedDesired;

  const folder = folderPathOf(normalizedDesired);
  const base = leafName(normalizedDesired);
  let index = 2;
  while (true) {
    const path = `${folder ? `${folder}/` : ""}${base} ${index}.md`;
    if (!existing.has(path.toLowerCase())) return path;
    index += 1;
  }
}

export function buildDraftChanges(baseFiles: NoteFile[], files: NoteFile[]): DraftChange[] {
  const baseByPath = new Map(baseFiles.map((file) => [normalizePath(file.path).toLowerCase(), file]));
  const nextByPath = new Map(files.map((file) => [normalizePath(file.path).toLowerCase(), file]));
  const changes: DraftChange[] = [];

  for (const file of files) {
    const key = normalizePath(file.path).toLowerCase();
    const base = baseByPath.get(key);
    if (!base) {
      changes.push({ path: file.path, kind: "created", after: file.content });
      continue;
    }
    if (base.content !== file.content) {
      changes.push({ path: file.path, kind: "modified", before: base.content, after: file.content });
    }
  }

  for (const file of baseFiles) {
    const key = normalizePath(file.path).toLowerCase();
    if (!nextByPath.has(key)) {
      changes.push({ path: file.path, kind: "deleted", before: file.content });
    }
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN", { numeric: true }));
}

function draftKindLabel(kind: DraftChangeKind): string {
  if (kind === "created") return "新建";
  if (kind === "modified") return "修改";
  return "删除";
}

function normalizeModelSettings(settings: ModelConnectionSettings, canRunModel: boolean): ModelConnectionSettings {
  return {
    provider: canRunModel ? settings.provider || "deepseek" : "offline",
    model: normalizeAgentModel(settings.model, canRunModel),
    agentMode: normalizeAgentMode(settings.agentMode),
    deepSeekApiKeyConfigured: settings.deepSeekApiKeyConfigured
  };
}

interface AgentContextUsage {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  label: string;
}

function estimateAgentContextUsage(
  messages: AgentMessage[],
  files: NoteFile[],
  currentPath: string,
  pinnedPaths: string[],
  model: string
): AgentContextUsage {
  const current = files.find((file) => normalizePath(file.path).toLowerCase() === normalizePath(currentPath).toLowerCase());
  const pinned = pinnedPaths
    .map((path) => files.find((file) => normalizePath(file.path).toLowerCase() === normalizePath(path).toLowerCase()))
    .filter((file): file is NoteFile => Boolean(file));
  const messageText = messages
    .filter((message) => message.status !== "thinking")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const vaultOverview = files
    .slice(0, 32)
    .map((file) => file.path)
    .join("\n");
  const contextText = [
    messageText,
    current?.content.slice(0, 7000) ?? "",
    pinned.map((file) => `Pinned ${file.path}\n${file.content.slice(0, 2200)}`).join("\n\n"),
    vaultOverview
  ].join("\n\n");
  const usedTokens = estimateTokens(contextText);
  const maxTokens = contextLimitForModel(model);
  const percent = Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
  return {
    usedTokens,
    maxTokens,
    percent,
    label: `上下文：约 ${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens；包含聊天、当前笔记、上传笔记和 vault 概览。`
  };
}

function estimateTokens(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const other = text.length - cjk;
  return Math.ceil(cjk * 0.8 + other / 4);
}

function contextLimitForModel(model: string): number {
  if (/flash/i.test(model)) return 32_000;
  if (/offline/i.test(model)) return 16_000;
  return 64_000;
}

function modelShortLabel(model: string): string {
  if (/flash/i.test(model)) return "Flash";
  if (/pro/i.test(model)) return "Pro";
  if (/offline/i.test(model)) return "Local";
  return "Model";
}

export function detectInterlinkedVaultRequest(input: string): InterlinkedVaultRequest | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  const wantsFDrive = /\bf:\\|f盘|f 盘|ｆ盘/i.test(input);
  const wantsLinkedFiles = /互相.*关联|相互.*关联|有关联|关系图谱|测试库|极端.*工况/.test(input);
  const wantsFiles = /文件|文档|笔记|markdown|md\b/i.test(input);
  if (!wantsFDrive || !wantsLinkedFiles || !wantsFiles) return null;
  const count = parseRequestedCount(input) ?? 30;
  if (count < 1 || count > 200) return null;
  return {
    parentPath: "F:\\",
    folderName: "知识库Agent互联测试库",
    count
  };
}

export function detectWordDocumentRequest(input: string): WordDocumentRequest | null {
  const normalized = input.trim();
  if (!normalized) return null;
  const wantsDesktop = /桌面|desktop/i.test(normalized);
  const wantsWord = /word|docx|word\s*文档|Word\s*文档|文档/i.test(normalized);
  const wantsCreate = /建立|创建|新建|生成|建一个|建个/i.test(normalized);
  if (!wantsDesktop || !wantsWord || !wantsCreate) return null;
  const name = extractRequestedDocumentName(normalized);
  if (!name) return null;
  return { name };
}

function extractRequestedDocumentName(input: string): string | null {
  const patterns = [
    /名字叫\s*([^\s，。,.!?！？]+)/,
    /名称叫\s*([^\s，。,.!?！？]+)/,
    /名为\s*([^\s，。,.!?！？]+)/,
    /叫\s*([^\s，。,.!?！？]+)\s*(?:的)?(?:word|docx|文档)?/i
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/\.docx$/i, "");
  }
  return null;
}

function parseRequestedCount(input: string): number | null {
  const numeric = input.match(/(\d{1,3})\s*(?:个|篇|份|条)?/);
  if (numeric) return Number(numeric[1]);
  if (/三十/.test(input)) return 30;
  if (/二十/.test(input)) return 20;
  if (/十/.test(input)) return 10;
  return null;
}

function normalizeAgentModel(model: string, canRunModel: boolean): string {
  if (!canRunModel) return "offline";
  return AGENT_MODEL_OPTIONS.some((option) => option.value === model) ? model : "deepseek-v4-pro";
}

function normalizeAgentMode(mode: string): AgentMode {
  return AGENT_MODE_OPTIONS.some((option) => option.value === mode) ? (mode as AgentMode) : "daily";
}

function agentModeLabel(mode: string): string {
  return AGENT_MODE_OPTIONS.find((option) => option.value === normalizeAgentMode(mode))?.label ?? "日常笔记 Agent";
}

function formatTrashTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function trashRemainingLabel(purgeAfterMs: number): string {
  const remainingMs = purgeAfterMs - Date.now();
  if (remainingMs <= 0) return "已到期，下一次刷新会清理";
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.ceil((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
  return `剩余 ${Math.max(1, hours)} 小时`;
}

function diffPreview(change: DraftChange): string {
  if (change.kind === "created") return `+ ${firstUsefulLines(change.after ?? "")}`;
  if (change.kind === "deleted") return `- ${firstUsefulLines(change.before ?? "")}`;
  return [`- ${firstUsefulLines(change.before ?? "")}`, `+ ${firstUsefulLines(change.after ?? "")}`].join("\n");
}

function firstUsefulLines(content: string): string {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 6);
  return lines.length > 0 ? lines.join("\n") : "(empty note)";
}

function filterNotes(notes: ReturnType<typeof buildVaultIndex>["notes"], query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return notes;
  return notes.filter((note) => {
    return (
      note.title.toLowerCase().includes(normalized) ||
      note.path.toLowerCase().includes(normalized) ||
      note.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
      note.content.toLowerCase().includes(normalized)
    );
  });
}

function buildExplorerModel(notes: ReturnType<typeof buildVaultIndex>["notes"], query: string, scope: string): ExplorerModel {
  const normalizedQuery = query.trim().toLowerCase();
  const folderNames = new Set<string>();
  const driveCounts = new Map<string, number>();

  for (const note of notes) {
    const parts = note.path.split("/").filter(Boolean);
    const drive = parts.length > 1 ? parts[0] : "根目录";
    driveCounts.set(drive, (driveCounts.get(drive) ?? 0) + 1);
    for (let index = 0; index < parts.length - 1; index += 1) {
      folderNames.add(parts.slice(0, index + 1).join("/"));
    }
  }


  const filtered = notes.filter((note) => {
    const drive = topFolder(note.path);
    if (scope && drive !== scope) return false;
    if (!normalizedQuery) return true;
    return (
      note.title.toLowerCase().includes(normalizedQuery) ||
      note.path.toLowerCase().includes(normalizedQuery) ||
      note.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      note.content.toLowerCase().includes(normalizedQuery)
    );
  });

  return {
    drives: [...driveCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true })),
    folderCount: folderNames.size,
    notes: filtered,
    totalNotes: notes.length
  };
}

function topFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "根目录";
}

function summarizeTags(tags: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 20);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function canCreateConceptNote(path: string) {
  const normalized = normalizePath(path).trim();
  if (normalized === "") return false;
  const lastSegment = normalized.split("/").pop() ?? normalized;
  const extension = /\.[^./\\]+$/.exec(lastSegment)?.[0].toLowerCase();
  return extension === undefined || extension === ".md";
}

function parseAgentToolArguments(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberSchema(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function isVaultRelativeNotePath(path: string): boolean {
  const normalized = normalizePath(path).trim();
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
  return normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function uniqueGeneratedFolder(files: NoteFile[], requested: string): string {
  const normalized = normalizePath(requested).replace(/\/+$/g, "");
  const occupied = (candidate: string) =>
    files.some((file) => {
      const path = normalizePath(file.path).toLowerCase();
      const prefix = `${candidate.toLowerCase()}/`;
      return path === candidate.toLowerCase() || path.startsWith(prefix);
    });
  if (!occupied(normalized)) return normalized;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!occupied(candidate)) return candidate;
  }
  return `${normalized}-${Date.now()}`;
}

export function buildStressGraphNotes(folder: string, count: number, topic: string): NoteFile[] {
  const categories = ["基础模型", "方法工具", "应用案例", "质量评估", "扩展探索"];
  const concepts = [
    "问题边界",
    "输入信号",
    "核心假设",
    "数据结构",
    "决策规则",
    "反馈回路",
    "异常处理",
    "协作接口",
    "验证指标",
    "演进路线",
    "风险控制",
    "实践记录"
  ];
  const nodeCount = Math.max(7, count - 1);
  const nodePaths = Array.from({ length: nodeCount }, (_, index) => {
    const category = categories[index % categories.length];
    const concept = concepts[index % concepts.length];
    return `${folder}/${category}/${String(index + 1).padStart(2, "0")}-${concept}.md`;
  });
  const overviewPath = `${folder}/00-${topic}-总览.md`;
  const overviewLinks = nodePaths.map((path) => `- [[${path.replace(/\.md$/i, "")}]]`).join("\n");
  const now = new Date().toISOString();
  const files: NoteFile[] = [
    {
      path: overviewPath,
      content: `# ${topic}总览\n\n这是用于检验大型知识库文件树、关系图谱、缩放和 Agent 工作流的高复杂度模拟知识集。\n\n## 结构索引\n\n${overviewLinks}\n\n## 使用目标\n\n- 检查多层文件夹与跨层链接\n- 检查局部聚类和远距离连接\n- 检查密集图谱下的标签显隐和交互性能\n\n#压力测试 #关系图谱 #${topic.replace(/\s+/g, "-")}\n`,
      modifiedAt: now
    }
  ];

  for (let index = 0; index < nodePaths.length; index += 1) {
    const path = nodePaths[index];
    const category = categories[index % categories.length];
    const concept = concepts[index % concepts.length];
    const previous = nodePaths[(index - 1 + nodePaths.length) % nodePaths.length];
    const next = nodePaths[(index + 1) % nodePaths.length];
    const crossA = nodePaths[(index * 7 + 3) % nodePaths.length];
    const crossB = nodePaths[(index * 11 + 5) % nodePaths.length];
    const links = [...new Set([previous, next, crossA, crossB])].filter((target) => target !== path);
    files.push({
      path,
      content: `# ${concept}\n\n## 定位\n\n本笔记属于“${category}”，用于描述 ${topic} 中的${concept}。它既参与同层顺序关系，也通过跨层链接连接其他知识簇。\n\n## 核心内容\n\n- 当前编号：${index + 1}/${nodePaths.length}\n- 主要职责：说明${concept}如何影响系统设计与实际运行\n- 验证问题：该概念是否有明确输入、输出、限制条件和失败信号\n- 工况说明：在文档数量扩大后，仍应能通过文件树、搜索和图谱定位\n\n## 关联\n\n- 总览：[[${overviewPath.replace(/\.md$/i, "")}]]\n${links.map((target) => `- 关联：[[${target.replace(/\.md$/i, "")}]]`).join("\n")}\n\n## 待验证\n\n1. 与相邻概念是否存在重复职责。\n2. 跨知识簇连接是否具有可解释性。\n3. Agent 整理后是否仍保留原始关系。\n\n#${category} #${concept} #压力测试\n`,
      modifiedAt: now
    });
  }

  return files;
}
